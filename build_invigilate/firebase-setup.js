/**
 * FIREBASE SETUP HELPER AND MONITORING UTILITIES
 * 
 * Provides utilities for:
 * - Interactive Firebase setup
 * - Connection monitoring
 * - Data statistics and reporting
 * - Health checks
 */

const firebaseSetup = {
    
    /**
     * Check Firebase dependencies
     */
    checkDependencies() {
        const checks = {
            firebase: typeof firebase !== 'undefined',
            firestore: typeof firebase !== 'undefined' && typeof firebase.firestore === 'function',
            storage: typeof firebaseStorage !== 'undefined',
            app: typeof app !== 'undefined'
        };

        const allReady = Object.values(checks).every(v => v);
        return { checks, ready: allReady };
    },

    /**
     * Initialize with config object
     */
    async setupWithConfig(firebaseConfig) {
        try {
            if (!firebaseConfig.projectId) {
                throw new Error('Firebase config missing projectId');
            }

            await app.initializeFirebase(firebaseConfig);
            
            return {
                success: true,
                message: 'Firebase initialized successfully'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Test Firestore connection
     */
    async testConnection() {
        if (!firebaseStorage.isInitialized) {
            return { connected: false, reason: 'Firebase not initialized' };
        }

        try {
            const testRef = firebaseStorage.db.collection('_metadata').doc('connection');
            await testRef.set({ tested: true, timestamp: new Date() });
            return { connected: true, timestamp: new Date() };

        } catch (error) {
            return {
                connected: false,
                reason: error.message
            };
        }
    },

    /**
     * Get system health status
     */
    getHealthStatus() {
        return {
            firebase: {
                initialized: firebaseStorage.isInitialized,
                online: firebaseStorage.isOnline,
                syncQueueSize: firebaseStorage.syncQueue.length
            },
            offline: {
                historyItems: offlineManager.syncHistory.length,
                conflicts: offlineManager.conflictLog.length
            },
            local: {
                scheduleSize: localStorage.getItem('scheduleData') ? 
                    JSON.parse(localStorage.getItem('scheduleData')).length : 0,
                storageUsage: this.getStorageUsage()
            }
        };
    },

    /**
     * Calculate localStorage usage
     */
    getStorageUsage() {
        let totalSize = 0;
        
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                totalSize += localStorage[key].length + key.length;
            }
        }

        // Convert to KB
        const sizeKB = (totalSize / 1024).toFixed(2);
        const estimatedQuota = 5120; // 5MB in KB
        const percentUsed = ((totalSize / (estimatedQuota * 1024)) * 100).toFixed(1);

        return {
            bytes: totalSize,
            kilobytes: sizeKB,
            percentUsed: percentUsed + '%'
        };
    },

    /**
     * Generate diagnostics report
     */
    async getDiagnostics() {
        const report = {
            timestamp: new Date().toISOString(),
            dependencies: this.checkDependencies(),
            health: this.getHealthStatus(),
            connection: null,
            integrity: null
        };

        // Test connection if available
        if (report.dependencies.ready) {
            report.connection = await this.testConnection();
            report.integrity = app ? dataSyncAPI.validateIntegrity(app) : null;
        }

        return report;
    },

    /**
     * Export diagnostics to JSON
     */
    async exportDiagnostics() {
        const diagnostics = await this.getDiagnostics();
        const json = JSON.stringify(diagnostics, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `diagnostics-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    },

    /**
     * Monitor connection status in real-time
     */
    monitorConnection(onStatusChange) {
        const checkStatus = async () => {
            const wasOnline = firebaseStorage.isOnline;
            const isNowOnline = navigator.onLine;

            if (wasOnline !== isNowOnline) {
                const status = {
                    online: isNowOnline,
                    timestamp: Date.now(),
                    syncQueueSize: firebaseStorage.syncQueue.length
                };

                if (typeof onStatusChange === 'function') {
                    onStatusChange(status);
                }
            }
        };

        // Check every 5 seconds
        return setInterval(checkStatus, 5000);
    },

    /**
     * Cleanup and reset
     */
    async reset() {
        try {
            // Clear all data
            firebaseStorage.syncQueue = [];
            firebaseStorage.saveSyncQueue();
            offlineManager.clearHistory();
            localStorage.clear();

            return { success: true, message: 'All data cleared' };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};

// Expose globally
window.firebaseSetup = firebaseSetup;

// Auto-check on load
document.addEventListener('DOMContentLoaded', () => {
    const deps = firebaseSetup.checkDependencies();
    console.log('Firebase Setup Check:', deps);
});
