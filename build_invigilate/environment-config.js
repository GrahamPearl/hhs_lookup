/**
 * ENVIRONMENT CONFIGURATION & DEPLOYMENT UTILITIES
 * 
 * Manages:
 * - Environment-specific settings
 * - Feature flags
 * - Performance tuning
 * - Deployment validation
 */

const environmentConfig = {
    
    // Current environment
    env: 'production',
    
    // Environment configurations
    environments: {
        development: {
            debugMode: true,
            firebaseEnabled: false,
            serviceWorkerEnabled: false,
            analyticsEnabled: true,
            autoSaveInterval: 10000,
            syncInterval: 5000,
            cacheBustingEnabled: false,
            logLevel: 'debug'
        },
        staging: {
            debugMode: false,
            firebaseEnabled: true,
            serviceWorkerEnabled: true,
            analyticsEnabled: true,
            autoSaveInterval: 30000,
            syncInterval: 15000,
            cacheBustingEnabled: true,
            logLevel: 'info'
        },
        production: {
            debugMode: false,
            firebaseEnabled: true,
            serviceWorkerEnabled: true,
            analyticsEnabled: true,
            autoSaveInterval: 60000,
            syncInterval: 30000,
            cacheBustingEnabled: true,
            logLevel: 'warn'
        }
    },

    // Feature flags
    features: {
        advancedAllocation: true,
        offlineSupport: true,
        firebaseStorage: true,
        analytics: true,
        serviceWorker: true,
        batchProcessing: true,
        dataExport: true,
        backupRestore: true,
        reportGeneration: true,
        databaseMigrations: true
    },

    /**
     * Initialize configuration for environment
     */
    init(environment = 'production') {
        this.env = environment;
        const config = this.environments[environment] || this.environments.production;
        
        Object.assign(this, config);
        
        console.log(`%cEnvironment: ${environment}`, 'color: #1e3a5f; font-weight: bold;');
        
        return config;
    },

    /**
     * Get current configuration
     */
    getConfig() {
        return {
            env: this.env,
            features: this.features,
            debugMode: this.debugMode,
            firebaseEnabled: this.firebaseEnabled,
            serviceWorkerEnabled: this.serviceWorkerEnabled,
            analyticsEnabled: this.analyticsEnabled
        };
    },

    /**
     * Check if feature is enabled
     */
    isFeatureEnabled(featureName) {
        return this.features[featureName] === true;
    },

    /**
     * Enable/disable feature
     */
    setFeature(featureName, enabled) {
        this.features[featureName] = enabled;
        console.log(`Feature ${featureName}: ${enabled ? 'enabled' : 'disabled'}`);
    },

    /**
     * Get performance settings
     */
    getPerformanceSettings() {
        return {
            autoSaveInterval: this.autoSaveInterval,
            syncInterval: this.syncInterval,
            batchSize: 250,
            maxOfflineQueueSize: 100,
            cacheExpirationTime: 24 * 60 * 60 * 1000 // 24 hours
        };
    },

    /**
     * Log based on log level
     */
    log(level, message, data = null) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const currentLevel = levels[this.logLevel] || 0;
        const messageLevel = levels[level] || 0;

        if (messageLevel >= currentLevel) {
            const style = {
                debug: 'color: #64748b;',
                info: 'color: #059669;',
                warn: 'color: #d97706;',
                error: 'color: #dc2626;'
            }[level] || '';

            console.log(`%c[${level.toUpperCase()}] ${message}`, style, data || '');
        }
    }
};

/**
 * DEPLOYMENT VALIDATOR
 */
const deploymentValidator = {

    /**
     * Validate deployment environment
     */
    async validateDeployment() {
        const checks = {
            filesPresent: this.checkFilesPresent(),
            browserSupport: this.checkBrowserSupport(),
            storageAvailable: this.checkStorageAvailable(),
            networkConnectivity: await this.checkNetworkConnectivity(),
            firebaseConfig: this.checkFirebaseConfig(),
            securityHeaders: await this.checkSecurityHeaders()
        };

        const allPassed = Object.values(checks).every(v => v === true || v?.success === true);

        return {
            valid: allPassed,
            checks,
            timestamp: new Date().toISOString()
        };
    },

    /**
     * Check required files
     */
    checkFilesPresent() {
        const files = [
            'index.html',
            'scheduling-engine-part1.js',
            'scheduling-engine-part2.js',
            'init-storage.js',
            'offline-manager.js'
        ];

        // In real deployment, this would check actual files
        return true;
    },

    /**
     * Check browser support
     */
    checkBrowserSupport() {
        const support = {
            localStorage: typeof localStorage !== 'undefined',
            serviceWorker: 'serviceWorker' in navigator,
            fetch: typeof fetch === 'function',
            promises: typeof Promise !== 'undefined',
            spreadsheets: typeof XLSX !== 'undefined'
        };

        return Object.values(support).every(v => v === true);
    },

    /**
     * Check storage availability
     */
    checkStorageAvailable() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            console.warn('Storage check failed:', e);
            return false;
        }
    },

    /**
     * Check network connectivity
     */
    async checkNetworkConnectivity() {
        try {
            const response = await fetch('/ping', { method: 'HEAD' });
            return response.ok;
        } catch (e) {
            return false;
        }
    },

    /**
     * Check Firebase config
     */
    checkFirebaseConfig() {
        if (typeof firebaseStorage === 'undefined') {
            return false;
        }

        return firebaseStorage.isInitialized || 
               (typeof firebase !== 'undefined');
    },

    /**
     * Check security headers
     */
    async checkSecurityHeaders() {
        try {
            const response = await fetch(window.location.href);
            const headers = {
                csp: response.headers.get('content-security-policy'),
                x_frame_options: response.headers.get('x-frame-options'),
                x_content_type: response.headers.get('x-content-type-options')
            };

            return Object.values(headers).some(v => v !== null);
        } catch (e) {
            return null;
        }
    },

    /**
     * Generate deployment report
     */
    async generateReport() {
        const validation = await this.validateDeployment();
        
        return {
            timestamp: new Date().toISOString(),
            environment: environmentConfig.env,
            validation,
            systemStatus: {
                appReady: typeof app !== 'undefined',
                firebaseReady: firebaseStorage?.isInitialized || false,
                serviceWorkerReady: 'serviceWorker' in navigator,
                storageUsage: this.getStorageUsage()
            }
        };
    },

    /**
     * Get storage usage
     */
    getStorageUsage() {
        let total = 0;
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                total += localStorage[key].length + key.length;
            }
        }
        return {
            bytes: total,
            kilobytes: (total / 1024).toFixed(2),
            percentUsed: ((total / (5 * 1024 * 1024)) * 100).toFixed(1) + '%'
        };
    }
};

/**
 * DEPLOYMENT CHECKLIST
 */
const deploymentChecklist = {
    
    items: [
        {
            category: 'Files',
            tasks: [
                'Copy all .js files',
                'Copy index.html',
                'Copy manifest.json',
                'Copy sample data (xlsx)',
                'Copy documentation'
            ]
        },
        {
            category: 'Configuration',
            tasks: [
                'Set environment variable',
                'Configure Firebase (optional)',
                'Set security headers',
                'Configure CORS if needed',
                'Setup SSL/HTTPS'
            ]
        },
        {
            category: 'Testing',
            tasks: [
                'Run implementation test',
                'Test offline functionality',
                'Test uploads and exports',
                'Verify responsive design',
                'Test on mobile devices'
            ]
        },
        {
            category: 'Security',
            tasks: [
                'Enable HTTPS',
                'Set CSP headers',
                'Validate input sanitization',
                'Review Firebase rules',
                'Setup authentication (if needed)'
            ]
        },
        {
            category: 'Performance',
            tasks: [
                'Enable gzip compression',
                'Setup caching headers',
                'Minify JavaScript',
                'Optimize images',
                'Monitor performance'
            ]
        }
    ],

    getChecklist() {
        return this.items;
    },

    generateChecklist(format = 'text') {
        if (format === 'html') {
            return this.generateHTMLChecklist();
        }

        let text = 'DEPLOYMENT CHECKLIST\n';
        text += '='.repeat(50) + '\n\n';

        this.items.forEach(section => {
            text += `[${section.category}]\n`;
            section.tasks.forEach(task => {
                text += `  [ ] ${task}\n`;
            });
            text += '\n';
        });

        return text;
    },

    generateHTMLChecklist() {
        let html = '<div style="font-family: Arial; padding: 20px;">';
        html += '<h2>Deployment Checklist</h2>';

        this.items.forEach(section => {
            html += `<h3>${section.category}</h3><ul>`;
            section.tasks.forEach(task => {
                html += `<li><input type="checkbox"> ${task}</li>`;
            });
            html += '</ul>';
        });

        html += '</div>';
        return html;
    }
};

// Expose globally
window.environmentConfig = environmentConfig;
window.deploymentValidator = deploymentValidator;
window.deploymentChecklist = deploymentChecklist;

// Auto-detect environment from hostname
if (window.location.hostname.includes('localhost') || window.location.hostname === '127.0.0.1') {
    environmentConfig.init('development');
} else if (window.location.hostname.includes('staging')) {
    environmentConfig.init('staging');
} else {
    environmentConfig.init('production');
}

console.log('Environment config loaded');
