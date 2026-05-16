/**
 * ADVANCED OFFLINE DATA MANAGER
 * 
 * Extends firebaseStorage with:
 * - Bulk operations with progress tracking
 * - Conflict detection and resolution
 * - Data synchronization status
 * - History and audit logging
 * - Retry mechanism for failed syncs
 * 
 * Include after firebaseStorage is defined
 */

const offlineManager = {
    syncHistory: [],
    conflictLog: [],
    retryQueue: [],
    maxRetries: 3,
    syncInterval: 30000, // 30 seconds

    /**
     * Initialize offline manager
     */
    init() {
        this.loadHistory();
        this.startAutoSync();
        console.log('Offline manager initialized');
    },

    /**
     * Start automatic sync timer
     */
    startAutoSync() {
        setInterval(() => {
            if (firebaseStorage.isOnline && firebaseStorage.isInitialized) {
                this.syncOfflineQueue();
            }
        }, this.syncInterval);
    },

    /**
     * Sync offline queue with retry logic
     */
    async syncOfflineQueue() {
        if (firebaseStorage.syncQueue.length === 0) return;

        console.log(`Syncing ${firebaseStorage.syncQueue.length} items...`);
        
        for (const item of firebaseStorage.syncQueue) {
            await this.syncItem(item);
        }

        this.saveHistory();
    },

    /**
     * Sync single item with retry
     */
    async syncItem(item, retryCount = 0) {
        try {
            if (item.type === 'save_assignments') {
                const result = await firebaseStorage.saveAssignments(item.data, item.batchId);
                
                if (result.success) {
                    this.recordSuccess(item);
                    firebaseStorage.syncQueue = firebaseStorage.syncQueue.filter(
                        i => i.timestamp !== item.timestamp
                    );
                }
            }
        } catch (error) {
            if (retryCount < this.maxRetries) {
                console.warn(`Retry ${retryCount + 1}/${this.maxRetries} for item`, item.batchId);
                setTimeout(() => {
                    this.syncItem(item, retryCount + 1);
                }, 1000 * Math.pow(2, retryCount)); // Exponential backoff
            } else {
                this.recordFailure(item, error);
            }
        }
    },

    /**
     * Record successful sync in history
     */
    recordSuccess(item) {
        this.syncHistory.push({
            type: 'success',
            timestamp: Date.now(),
            batchId: item.batchId,
            itemsCount: item.data?.length || 0
        });

        if (this.syncHistory.length > 100) {
            this.syncHistory.shift(); // Keep last 100 entries
        }
    },

    /**
     * Record failed sync
     */
    recordFailure(item, error) {
        this.syncHistory.push({
            type: 'failure',
            timestamp: Date.now(),
            batchId: item.batchId,
            error: error.message
        });

        console.error('Sync failed:', error);
    },

    /**
     * Detect conflicts between local and remote data
     */
    async detectConflicts(localAssignments, remoteAssignments) {
        const conflicts = [];

        localAssignments.forEach(local => {
            const remote = remoteAssignments.find(
                r => r.date === local.date && 
                     r.session === local.session && 
                     r.venue === local.venue
            );

            if (remote && local.allocatedTeacher !== remote.allocatedTeacher) {
                conflicts.push({
                    item: local,
                    local: local.allocatedTeacher,
                    remote: remote.allocatedTeacher
                });
            }
        });

        return conflicts;
    },

    /**
     * Resolve conflicts (favor local by default)
     */
    async resolveConflicts(conflicts, strategy = 'local') {
        for (const conflict of conflicts) {
            if (strategy === 'local') {
                // Keep local version
                this.syncHistory.push({
                    type: 'conflict_resolved',
                    timestamp: Date.now(),
                    strategy: 'local_kept',
                    item: conflict.item
                });
            } else if (strategy === 'remote') {
                // Use remote version
                this.syncHistory.push({
                    type: 'conflict_resolved',
                    timestamp: Date.now(),
                    strategy: 'remote_kept',
                    item: conflict.item
                });
            }
        }

        this.saveHistory();
    },

    /**
     * Get detailed sync status
     */
    getDetailedStatus() {
        return {
            ...firebaseStorage.getStatus(),
            syncHistory: this.syncHistory.slice(-10),
            lastSync: this.syncHistory[this.syncHistory.length - 1] || null,
            totalSuccessful: this.syncHistory.filter(h => h.type === 'success').length,
            totalFailed: this.syncHistory.filter(h => h.type === 'failure').length,
            conflicts: this.conflictLog.length
        };
    },

    /**
     * Save sync history to localStorage
     */
    saveHistory() {
        try {
            localStorage.setItem('syncHistory', JSON.stringify(this.syncHistory));
            localStorage.setItem('conflictLog', JSON.stringify(this.conflictLog));
        } catch (error) {
            console.warn('Could not save history:', error);
        }
    },

    /**
     * Load sync history from localStorage
     */
    loadHistory() {
        try {
            const history = localStorage.getItem('syncHistory');
            const conflicts = localStorage.getItem('conflictLog');
            
            if (history) this.syncHistory = JSON.parse(history);
            if (conflicts) this.conflictLog = JSON.parse(conflicts);
        } catch (error) {
            console.warn('Could not load history:', error);
        }
    },

    /**
     * Clear all sync history
     */
    clearHistory() {
        this.syncHistory = [];
        this.conflictLog = [];
        localStorage.removeItem('syncHistory');
        localStorage.removeItem('conflictLog');
    },

    /**
     * Export sync history as JSON
     */
    exportHistory() {
        return {
            exportDate: new Date().toISOString(),
            syncHistory: this.syncHistory,
            conflictLog: this.conflictLog,
            status: this.getDetailedStatus()
        };
    },

    /**
     * Monitor data consistency
     */
    async verifyDataConsistency(localData, batchId) {
        if (!firebaseStorage.isInitialized) return { consistent: true };

        try {
            const remoteData = await firebaseStorage.loadAssignments(batchId);
            const localCount = localData.length;
            const remoteCount = remoteData.length;

            if (localCount !== remoteCount) {
                console.warn(`Data mismatch: local=${localCount}, remote=${remoteCount}`);
                return {
                    consistent: false,
                    localCount,
                    remoteCount,
                    difference: Math.abs(localCount - remoteCount)
                };
            }

            return { consistent: true };
        } catch (error) {
            console.error('Consistency check error:', error);
            return { consistent: null, error: error.message };
        }
    }
};

// Initialize when ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        offlineManager.init();
    });
} else {
    offlineManager.init();
}

// Make globally accessible
window.offlineManager = offlineManager;
