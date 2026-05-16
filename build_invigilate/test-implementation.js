/**
 * IMPLEMENTATION STATUS AND QUICK TEST
 * 
 * Run this in browser console to verify everything is working:
 * coreIntegration.selfTest()
 */

const implementationStatus = {
    
    /**
     * Run complete self-test
     */
    selfTest() {
        console.clear();
        console.log('%cEXAM SCHEDULER - IMPLEMENTATION TEST', 'color: #1e3a5f; font-size: 16px; font-weight: bold;');
        console.log('='.repeat(60));
        
        this.testModulesLoaded();
        this.testDataStorage();
        this.testSchedulingEngine();
        this.testUIFunctionality();
        this.testOfflineMode();
        this.testFirebaseIntegration();
        
        console.log('='.repeat(60));
        console.log('%cTest Complete', 'color: #059669; font-weight: bold;');
    },

    testModulesLoaded() {
        console.log('\n%c1. MODULES LOADED', 'color: #1e3a5f; font-weight: bold;');
        
        const modules = [
            'app',
            'firebaseStorage',
            'offlineManager',
            'dataSyncAPI',
            'firebaseSetup',
            'coreIntegration',
            'schedulingIntegration'
        ];

        modules.forEach(mod => {
            const loaded = typeof window[mod] !== 'undefined';
            const icon = loaded ? '✓' : '✗';
            const color = loaded ? '#059669' : '#dc2626';
            console.log(`   ${icon} %c${mod}`, `color: ${color};`);
        });
    },

    testDataStorage() {
        console.log('\n%c2. DATA STORAGE', 'color: #1e3a5f; font-weight: bold;');
        
        const storageTests = {
            'LocalStorage available': () => {
                try {
                    localStorage.setItem('test', 'ok');
                    localStorage.removeItem('test');
                    return true;
                } catch (e) {
                    return false;
                }
            },
            'Schedule data loaded': () => {
                const data = localStorage.getItem('scheduleData');
                return data ? JSON.parse(data).length > 0 : false;
            },
            'Teachers data loaded': () => {
                const data = localStorage.getItem('teachersData');
                return data ? JSON.parse(data).length > 0 : false;
            },
            'Firebase Storage initialized': () => firebaseStorage.isInitialized
        };

        Object.entries(storageTests).forEach(([name, test]) => {
            const result = test();
            const icon = result ? '✓' : '○';
            const color = result ? '#059669' : '#d97706';
            console.log(`   ${icon} %c${name}`, `color: ${color};`);
        });
    },

    testSchedulingEngine() {
        console.log('\n%c3. SCHEDULING ENGINE', 'color: #1e3a5f; font-weight: bold;');
        
        const engineTests = {
            'Part 1 Loaded': () => typeof window.scheduleAssignments === 'undefined',
            'Part 2 Loaded': () => typeof window.validateSchedule === 'undefined',
            'Algorithms available': () => {
                return typeof window.rankTeacherForSlot === 'function' &&
                       typeof window.selectBestTeacher === 'function';
            }
        };

        Object.entries(engineTests).forEach(([name, test]) => {
            const result = test();
            const icon = result ? '✓' : '○';
            const color = result ? '#059669' : '#d97706';
            console.log(`   ${icon} %c${name}`, `color: ${color};`);
        });
    },

    testUIFunctionality() {
        console.log('\n%c4. UI FUNCTIONALITY', 'color: #1e3a5f; font-weight: bold;');
        
        const uiTests = {
            'Dashboard visible': () => document.getElementById('dashboard') !== null,
            'Upload section exists': () => document.getElementById('upload') !== null,
            'Schedule section exists': () => document.getElementById('schedule') !== null,
            'Allocation section exists': () => document.getElementById('allocation') !== null,
            'Modal available': () => document.getElementById('edit-modal') !== null
        };

        Object.entries(uiTests).forEach(([name, test]) => {
            const result = test();
            const icon = result ? '✓' : '✗';
            const color = result ? '#059669' : '#dc2626';
            console.log(`   ${icon} %c${name}`, `color: ${color};`);
        });
    },

    testOfflineMode() {
        console.log('\n%c5. OFFLINE MODE', 'color: #1e3a5f; font-weight: bold;');
        
        const status = firebaseStorage.getStatus();
        
        console.log(`   Network: ${navigator.onLine ? 'Online' : 'Offline'}`);
        console.log(`   Firebase Initialized: ${status.initialized ? '✓' : '✗'}`);
        console.log(`   Sync Queue Size: ${status.queueSize}`);
        console.log(`   Storage Usage: ${firebaseSetup.getStorageUsage().percentUsed}`);
    },

    testFirebaseIntegration() {
        console.log('\n%c6. FIREBASE INTEGRATION', 'color: #1e3a5f; font-weight: bold;');
        
        const status = firebaseStorage.getStatus();
        
        if (status.initialized) {
            console.log(`   Firebase: Initialized`);
            console.log(`   Connection: ${status.online ? 'Online' : 'Offline'}`);
            console.log(`   Pending Syncs: ${status.queueSize}`);
        } else {
            console.log(`   Firebase: Not Initialized`);
            console.log(`   Using: LocalStorage only`);
            console.log(`   To enable: Uncomment firebase-config.js in index.html`);
        }
    },

    /**
     * Test save and load cycle
     */
    testSaveLoadCycle() {
        console.log('\n%cTesting Save/Load Cycle...', 'color: #1e3a5f; font-weight: bold;');
        
        const testKey = 'test_save_load_' + Date.now();
        const testData = { test: true, timestamp: Date.now() };
        
        try {
            // Save
            localStorage.setItem(testKey, JSON.stringify(testData));
            
            // Load
            const loaded = JSON.parse(localStorage.getItem(testKey));
            
            // Verify
            if (loaded.test && loaded.timestamp === testData.timestamp) {
                console.log('%c✓ Save/Load cycle working', 'color: #059669;');
                localStorage.removeItem(testKey);
                return true;
            } else {
                console.log('%c✗ Data mismatch', 'color: #dc2626;');
                return false;
            }
        } catch (error) {
            console.log('%c✗ ' + error.message, 'color: #dc2626;');
            return false;
        }
    },

    /**
     * Show quick reference
     */
    showQuickReference() {
        console.log('%cQUICK REFERENCE', 'color: #1e3a5f; font-weight: bold; font-size: 12px;');
        console.log(`
App Instance:        window.app
Firebase Storage:    window.firebaseStorage
Offline Manager:     window.offlineManager
Data Sync API:       window.dataSyncAPI
Firebase Setup:      window.firebaseSetup
Core Integration:    window.coreIntegration

Commands:
app.autoAllocate()                      // Auto-allocate teachers
coreIntegration.getStatus()            // Get system status
dataSyncAPI.getStatistics(app)        // Get data statistics
firebaseSetup.getDiagnostics()        // Get full diagnostics
offlineManager.getDetailedStatus()    // Get offline status
        `);
    }
};

// Make globally accessible
window.implementationStatus = implementationStatus;

// Auto-run test on page load (optional, comment out to disable)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('%cType: implementationStatus.selfTest() to run tests', 'color: #d97706;');
    });
} else {
    console.log('%cType: implementationStatus.selfTest() to run tests', 'color: #d97706;');
}
