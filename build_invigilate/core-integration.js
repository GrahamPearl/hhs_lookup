/**
 * CORE INTEGRATION MODULE
 * 
 * Ties together all storage and synchronization systems:
 * - Firebase Firestore for cloud storage
 * - LocalStorage for offline persistence
 * - Offline queue management
 * - Automatic synchronization
 * - Data consistency checks
 * 
 * This module is loaded automatically and provides the unified API
 */

const coreIntegration = {
    
    /**
     * System configuration
     */
    config: {
        autoSaveEnabled: true,
        autoSaveInterval: 30000, // 30 seconds
        conflictResolution: 'local', // 'local' or 'remote'
        maxOfflineQueueSize: 100,
        enableConsistencyChecks: true
    },

    /**
     * Initialize all systems
     */
    async init() {
        console.log('Core Integration: Initializing...');

        // Load sync queue
        firebaseStorage.loadSyncQueue();

        // Initialize offline manager
        offlineManager.init();

        // Check Firebase config in window
        if (typeof window.firebaseConfigReady !== 'undefined' && window.firebaseConfigReady) {
            await this.initializeFirebase(window.firebaseConfig);
        }

        this.setupAutoSave();
        this.setupConnectionMonitoring();
        this.setupErrorHandling();

        console.log('Core Integration: Ready');
        return this;
    },

    /**
     * Initialize Firebase with config
     */
    async initializeFirebase(config) {
        if (!config || !config.projectId) {
            console.log('Firebase config not available');
            return false;
        }

        try {
            const result = await firebaseStorage.init(config);
            if (result) {
                console.log('Firebase Firestore connected');
                // Sync any offline changes
                await firebaseStorage.syncOfflineQueue();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Firebase initialization failed:', error);
            return false;
        }
    },

    /**
     * Setup automatic saving
     */
    setupAutoSave() {
        if (!this.config.autoSaveEnabled) return;

        setInterval(() => {
            if (typeof app !== 'undefined') {
                app.saveToStorage();
            }
        }, this.config.autoSaveInterval);
    },

    /**
     * Monitor connection and sync
     */
    setupConnectionMonitoring() {
        window.addEventListener('online', async () => {
            console.log('Connection restored - syncing...');
            if (firebaseStorage.isInitialized) {
                await firebaseStorage.syncOfflineQueue();
            }
        });

        window.addEventListener('offline', () => {
            console.log('Connection lost - using offline mode');
        });
    },

    /**
     * Setup global error handling
     */
    setupErrorHandling() {
        window.addEventListener('unhandledrejection', event => {
            console.error('Unhandled promise rejection:', event.reason);
            
            // Record in sync history for debugging
            offlineManager.syncHistory.push({
                type: 'error',
                timestamp: Date.now(),
                error: event.reason.message
            });
        });
    },

    /**
     * Get unified status
     */
    getStatus() {
        return {
            firebase: firebaseStorage.getStatus(),
            offline: offlineManager.getDetailedStatus(),
            app: typeof app !== 'undefined' ? {
                scheduleSlotsLoaded: app.scheduleData.length,
                teachersLoaded: app.teachersData.length,
                allocationsCount: app.allocationMap.size,
                batchId: app.currentBatchId
            } : null,
            config: this.config
        };
    },

    /**
     * Export all data for backup
     */
    exportAll() {
        if (typeof app === 'undefined') return null;

        return {
            backup: dataSyncAPI.createBackup(app, true),
            statistics: dataSyncAPI.getStatistics(app),
            syncHistory: offlineManager.exportHistory(),
            diagnostics: firebaseSetup.checkDependencies()
        };
    },

    /**
     * Sync and verify data consistency
     */
    async syncAndVerify() {
        if (!firebaseStorage.isInitialized) {
            return { synced: false, reason: 'Firebase not initialized' };
        }

        try {
            // Sync offline queue
            await firebaseStorage.syncOfflineQueue();

            // Verify consistency
            if (typeof app !== 'undefined') {
                const consistency = await offlineManager.verifyDataConsistency(
                    app.scheduleData,
                    app.currentBatchId
                );

                return {
                    synced: true,
                    consistent: consistency.consistent,
                    details: consistency
                };
            }

            return { synced: true };

        } catch (error) {
            return {
                synced: false,
                error: error.message
            };
        }
    },

    /**
     * Emergency backup (call when offline)
     */
    emergencyBackup() {
        if (typeof app === 'undefined') return false;

        try {
            const backup = dataSyncAPI.createBackup(app, true);
            const json = JSON.stringify(backup);
            
            // Store multiple copies
            localStorage.setItem(`emergency_backup_${Date.now()}`, json);
            localStorage.setItem('latest_emergency_backup', json);

            // Keep last 5 backups
            const keys = Object.keys(localStorage).filter(k => k.startsWith('emergency_backup_'));
            if (keys.length > 5) {
                const oldestKey = keys.sort()[0];
                localStorage.removeItem(oldestKey);
            }

            return { success: true, backups: keys.length };

        } catch (error) {
            console.error('Emergency backup failed:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Restore from emergency backup
     */
    restoreEmergencyBackup() {
        try {
            const backup = localStorage.getItem('latest_emergency_backup');
            if (!backup) return { success: false, error: 'No backup found' };

            const data = JSON.parse(backup);
            if (typeof app !== 'undefined') {
                app.scheduleData = data.data.scheduleData;
                app.teachersData = data.data.teachersData;
                app.allocationMap = new Map(data.data.allocations);
                app.currentBatchId = data.batchId;
                app.updateDashboard();
                
                return {
                    success: true,
                    slotsRestored: data.data.scheduleData.length,
                    timestamp: data.timestamp
                };
            }

            return { success: false, error: 'App not ready' };

        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Get API reference for debugging
     */
    getAPIs() {
        return {
            firebaseStorage,
            offlineManager,
            dataSyncAPI,
            firebaseSetup,
            coreIntegration: this
        };
    }
};

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        coreIntegration.init();
    });
} else {
    coreIntegration.init();
}

// Expose globally
window.coreIntegration = coreIntegration;

// Log initialization complete
console.log('%cCore Integration System Ready', 'color: #059669; font-weight: bold; font-size: 14px;');
console.log('APIs Available:', {
    firebaseStorage: typeof firebaseStorage !== 'undefined',
    offlineManager: typeof offlineManager !== 'undefined',
    dataSyncAPI: typeof dataSyncAPI !== 'undefined',
    firebaseSetup: typeof firebaseSetup !== 'undefined',
    coreIntegration: typeof coreIntegration !== 'undefined'
});
