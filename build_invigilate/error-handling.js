/**
 * ADVANCED ERROR HANDLING & RECOVERY
 * 
 * Provides:
 * - Centralized error handling
 * - Automatic recovery
 * - Error reporting
 * - User notifications
 * - Fallback mechanisms
 */

const errorHandler = {

    errorLog: [],
    maxErrors: 500,
    recoveryStrategies: {},

    /**
     * Initialize error handler
     */
    init() {
        window.addEventListener('error', (event) => {
            this.handleError('uncaught', event.message, event.error);
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.handleError('promise-rejection', event.reason.message, event.reason);
        });

        // Handle app-specific errors
        this.registerRecoveryStrategies();
    },

    /**
     * Handle error
     */
    handleError(type, message, error = null) {
        const errorObj = {
            type,
            message,
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            url: window.location.href,
            stack: error?.stack || '',
            code: error?.code || 'unknown'
        };

        this.logError(errorObj);
        this.notifyUser(message);
        this.attemptRecovery(type, errorObj);

        return errorObj;
    },

    /**
     * Log error to storage
     */
    logError(errorObj) {
        this.errorLog.push(errorObj);

        // Keep last 500 errors
        if (this.errorLog.length > this.maxErrors) {
            this.errorLog.shift();
        }

        // Also save to localStorage
        try {
            localStorage.setItem('errorLog', JSON.stringify(this.errorLog));
        } catch (e) {
            console.warn('Could not save error log:', e);
        }

        console.error(`[${errorObj.type}] ${errorObj.message}`);
    },

    /**
     * Notify user of error
     */
    notifyUser(message) {
        if (typeof notifications !== 'undefined' && notifications.error) {
            notifications.error(message, 5000);
        }
    },

    /**
     * Register recovery strategies
     */
    registerRecoveryStrategies() {
        this.recoveryStrategies = {
            'storage-quota-exceeded': () => {
                console.log('Attempting storage cleanup...');
                performanceOptimizer.clearOldData(7 * 24 * 60 * 60 * 1000); // 7 days
                return true;
            },
            'network-error': () => {
                console.log('Attempting offline mode...');
                firebaseStorage.isOnline = false;
                return true;
            },
            'firebase-error': () => {
                console.log('Falling back to localStorage...');
                firebaseStorage.isInitialized = false;
                return true;
            },
            'parsing-error': () => {
                console.log('Clearing invalid data...');
                localStorage.removeItem('scheduleData');
                localStorage.removeItem('teachersData');
                return true;
            }
        };
    },

    /**
     * Attempt recovery based on error type
     */
    attemptRecovery(type, errorObj) {
        const strategy = Object.keys(this.recoveryStrategies).find(key => 
            errorObj.message.toLowerCase().includes(key.replace(/-/g, ' '))
        );

        if (strategy && this.recoveryStrategies[strategy]) {
            try {
                const recovered = this.recoveryStrategies[strategy]();
                if (recovered) {
                    console.log(`✓ Recovered from ${type}`);
                }
            } catch (e) {
                console.error('Recovery failed:', e);
            }
        }
    },

    /**
     * Get error summary
     */
    getSummary() {
        const byType = {};
        const byHour = {};

        this.errorLog.forEach(error => {
            byType[error.type] = (byType[error.type] || 0) + 1;

            const hour = new Date(error.timestamp).getHours();
            byHour[hour] = (byHour[hour] || 0) + 1;
        });

        return {
            totalErrors: this.errorLog.length,
            byType,
            byHour,
            lastError: this.errorLog[this.errorLog.length - 1] || null
        };
    },

    /**
     * Clear error log
     */
    clearLog() {
        this.errorLog = [];
        localStorage.removeItem('errorLog');
    },

    /**
     * Export error log
     */
    exportLog() {
        const json = JSON.stringify(this.errorLog, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `error-log-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }
};

/**
 * RECOVERY MANAGER
 */
const recoveryManager = {

    /**
     * Attempt full system recovery
     */
    async recoverSystem() {
        console.log('Initiating system recovery...');

        const steps = [
            { name: 'Stop sync', fn: () => this.stopSync() },
            { name: 'Validate data', fn: () => this.validateData() },
            { name: 'Restore backup', fn: () => this.restoreBackup() },
            { name: 'Clear cache', fn: () => this.clearCache() },
            { name: 'Reinitialize', fn: () => this.reinitialize() }
        ];

        const results = [];

        for (const step of steps) {
            try {
                console.log(`Executing: ${step.name}`);
                const result = await step.fn();
                results.push({ step: step.name, success: true, result });
            } catch (error) {
                results.push({ step: step.name, success: false, error: error.message });
            }
        }

        return results;
    },

    /**
     * Stop synchronization
     */
    stopSync() {
        if (typeof offlineManager !== 'undefined') {
            offlineManager.syncInProgress = false;
        }
        return true;
    },

    /**
     * Validate data integrity
     */
    validateData() {
        if (typeof app === 'undefined') return true;

        const validation = dataSyncAPI.validateIntegrity(app);
        return validation.valid;
    },

    /**
     * Restore from backup
     */
    restoreBackup() {
        const backup = localStorage.getItem('latest_emergency_backup');
        if (backup) {
            const data = JSON.parse(backup);
            if (typeof app !== 'undefined') {
                app.scheduleData = data.data.scheduleData;
                app.teachersData = data.data.teachersData;
                return true;
            }
        }
        return false;
    },

    /**
     * Clear cache
     */
    clearCache() {
        localStorage.removeItem('syncQueue');
        offlineManager.clearHistory();
        return true;
    },

    /**
     * Reinitialize system
     */
    reinitialize() {
        if (typeof coreIntegration !== 'undefined') {
            coreIntegration.init();
            return true;
        }
        return false;
    },

    /**
     * Generate recovery report
     */
    async generateReport() {
        const steps = await this.recoverSystem();
        const report = {
            timestamp: new Date().toISOString(),
            steps,
            success: steps.every(s => s.success),
            errorSummary: errorHandler.getSummary()
        };

        return report;
    }
};

/**
 * FAULT TOLERANCE
 */
const faultTolerance = {

    /**
     * Retry with exponential backoff
     */
    async retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
        let lastError;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const delay = initialDelay * Math.pow(2, attempt);
                console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    },

    /**
     * Fallback chain
     */
    async fallbackChain(functions) {
        for (const fn of functions) {
            try {
                return await fn();
            } catch (error) {
                console.warn('Fallback failed, trying next...', error);
            }
        }
        throw new Error('All fallback options exhausted');
    },

    /**
     * Circuit breaker
     */
    createCircuitBreaker(fn, failureThreshold = 5, timeout = 60000) {
        let failures = 0;
        let lastFailure = null;
        let isOpen = false;

        return async (...args) => {
            // Check if circuit should be reset
            if (isOpen && Date.now() - lastFailure > timeout) {
                isOpen = false;
                failures = 0;
            }

            if (isOpen) {
                throw new Error('Circuit breaker is open');
            }

            try {
                const result = await fn(...args);
                failures = 0;
                return result;
            } catch (error) {
                failures++;
                lastFailure = Date.now();

                if (failures >= failureThreshold) {
                    isOpen = true;
                    console.error('Circuit breaker opened');
                }

                throw error;
            }
        };
    }
};

/**
 * USER-FRIENDLY ERROR MESSAGES
 */
const errorMessages = {
    'QuotaExceededError': 'Storage is full. Please clear some data.',
    'NetworkError': 'Network connection lost. Working in offline mode.',
    'NotAllowedError': 'Permission denied. Check browser settings.',
    'InvalidStateError': 'Application state is invalid. Please refresh.',
    'AbortError': 'Operation cancelled.',
    'TypeError': 'A required value is missing or invalid.',
    'ReferenceError': 'A required resource could not be found.'
};

/**
 * Get user-friendly error message
 */
function getUserMessage(error) {
    const type = error.name || error.type || error.code || '';
    return errorMessages[type] || error.message || 'An unexpected error occurred.';
}

// Initialize error handler on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        errorHandler.init();
    });
} else {
    errorHandler.init();
}

// Expose globally
window.errorHandler = errorHandler;
window.recoveryManager = recoveryManager;
window.faultTolerance = faultTolerance;
window.getUserMessage = getUserMessage;

console.log('Error handling and recovery system initialized');
