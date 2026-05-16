/**
 * ONLINE/OFFLINE DATA SYNCHRONIZATION INITIALIZATION
 * 
 * This script handles:
 * - Automatic sync of assignments when online
 * - Offline queue management
 * - Firebase Firestore integration
 * - LocalStorage fallback
 * 
 * Include in index.html:
 * <script src="init-storage.js"></script>
 */

(function() {
    'use strict';

    /**
     * Initialize storage system on page load
     */
    function initStorageSystem() {
        console.log('Storage system initializing...');

        // Monitor storage status
        monitorStorageStatus();

        // Setup auto-save on data changes
        setupAutoSave();

        // Restore any unsynced changes
        restoreUnsynced();

        console.log('Storage system ready');
    }

    /**
     * Monitor and display storage status
     */
    function monitorStorageStatus() {
        const updateStatus = () => {
            const status = firebaseStorage.getStatus();
            const indicator = document.getElementById('connection-status');
            
            if (!indicator) return;

            let statusHtml = '';
            
            if (status.initialized) {
                if (status.online) {
                    statusHtml = '<span>🟢 Online (Firebase)</span>';
                } else {
                    statusHtml = '<span>🟡 Offline (Sync Queued)</span>';
                    if (status.queueSize > 0) {
                        statusHtml += ` <span style="font-size:0.8rem;">${status.queueSize} pending</span>`;
                    }
                }
            } else {
                if (status.online) {
                    statusHtml = '<span>🟢 Online (LocalStorage)</span>';
                } else {
                    statusHtml = '<span>🔴 Offline (LocalStorage)</span>';
                }
            }

            indicator.innerHTML = statusHtml;
        };

        // Update status every 5 seconds
        setInterval(updateStatus, 5000);
        updateStatus();
    }

    /**
     * Setup auto-save functionality
     */
    function setupAutoSave() {
        if (typeof app === 'undefined') return;

        // Save after allocation changes
        const originalSaveAllocation = app.saveAllocation;
        app.saveAllocation = function(idx, teacher) {
            originalSaveAllocation.call(this, idx, teacher);
            
            // Auto-save to cloud
            if (firebaseStorage.isInitialized && firebaseStorage.isOnline) {
                const assignments = this.scheduleData.map((row, i) => ({
                    ...row,
                    allocatedTeacher: row.educator || this.allocationMap.get(i) || null
                }));
                
                firebaseStorage.saveAssignments(assignments, this.currentBatchId)
                    .catch(err => console.log('Auto-save to Firebase failed:', err));
            }
        };

        // Save after auto-allocate
        const originalAutoAllocate = app.autoAllocate;
        app.autoAllocate = function() {
            originalAutoAllocate.call(this);
            
            // Auto-save to cloud
            if (firebaseStorage.isInitialized && firebaseStorage.isOnline) {
                const assignments = this.scheduleData.map((row, i) => ({
                    ...row,
                    allocatedTeacher: row.educator || this.allocationMap.get(i) || null
                }));
                
                firebaseStorage.saveAssignments(assignments, this.currentBatchId)
                    .catch(err => console.log('Auto-save to Firebase failed:', err));
            }
        };
    }

    /**
     * Restore any unsynced changes from offline queue
     */
    function restoreUnsynced() {
        const queue = firebaseStorage.syncQueue;
        if (queue.length > 0) {
            console.log(`Restoring ${queue.length} unsynced operations...`);
            firebaseStorage.syncOfflineQueue().catch(err => {
                console.error('Failed to sync:', err);
            });
        }
    }

    /**
     * Sync current data when page is about to close
     */
    window.addEventListener('beforeunload', () => {
        if (typeof app !== 'undefined' && firebaseStorage.isInitialized) {
            const assignments = app.scheduleData.map((row, i) => ({
                ...row,
                allocatedTeacher: row.educator || app.allocationMap.get(i) || null
            }));
            
            // Try to save synchronously (but won't work with async)
            firebaseStorage.saveToLocalStorage(assignments, app.currentBatchId);
        }
    });

    /**
     * Handle Firebase authentication (optional)
     */
    function setupAuthentication() {
        if (typeof firebase === 'undefined') {
            console.log('Firebase not available - authentication skipped');
            return;
        }

        // Optional: Setup anonymous authentication
        firebase.auth().signInAnonymously().catch(error => {
            console.log('Anonymous auth failed (this is OK for read-only):', error.code);
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initStorageSystem);
    } else {
        initStorageSystem();
    }

    // Setup auth after a delay
    setTimeout(setupAuthentication, 1000);

})();
