/**
 * SYSTEM HEALTH MONITORING & DIAGNOSTICS
 * 
 * Provides:
 * - Real-time system health checks
 * - Component status monitoring
 * - Performance metrics
 * - Health alerts
 * - Diagnostic reports
 */

const systemHealth = {

    components: {},
    healthHistory: [],
    maxHistorySize: 100,
    alertThresholds: {
        memoryUsage: 80, // percent
        storageUsage: 90, // percent
        errorRate: 10, // per minute
        responseTime: 5000 // milliseconds
    },

    /**
     * Initialize health monitoring
     */
    init() {
        this.registerComponents();
        this.startMonitoring();
        console.log('System health monitoring initialized');
    },

    /**
     * Register system components
     */
    registerComponents() {
        this.components = {
            'Application': {
                check: () => typeof app !== 'undefined',
                dependencies: ['DOM', 'Storage']
            },
            'Scheduling Engine': {
                check: () => typeof window.scheduleAssignments === 'function',
                dependencies: ['JavaScript Engine']
            },
            'Firebase Storage': {
                check: () => typeof firebaseStorage !== 'undefined',
                dependencies: ['Network', 'Firebase SDK']
            },
            'Offline Manager': {
                check: () => typeof offlineManager !== 'undefined',
                dependencies: ['Storage']
            },
            'Service Worker': {
                check: () => 'serviceWorker' in navigator,
                dependencies: ['Browser Support']
            },
            'Storage': {
                check: () => {
                    try {
                        localStorage.setItem('test', 'ok');
                        localStorage.removeItem('test');
                        return true;
                    } catch (e) {
                        return false;
                    }
                },
                dependencies: []
            },
            'Network': {
                check: () => navigator.onLine,
                dependencies: []
            },
            'DOM': {
                check: () => document.readyState === 'complete',
                dependencies: []
            }
        };
    },

    /**
     * Check all components
     */
    checkAll() {
        const status = {};
        const timestamp = Date.now();
        let healthy = 0;
        let total = 0;

        for (const [name, component] of Object.entries(this.components)) {
            try {
                const isHealthy = component.check();
                status[name] = {
                    healthy: isHealthy,
                    dependencies: component.dependencies
                };

                if (isHealthy) healthy++;
                total++;
            } catch (error) {
                status[name] = {
                    healthy: false,
                    error: error.message,
                    dependencies: component.dependencies
                };
                total++;
            }
        }

        const healthReport = {
            timestamp,
            overallHealth: (healthy / total) * 100,
            healthyComponents: healthy,
            totalComponents: total,
            components: status
        };

        this.recordHealth(healthReport);
        return healthReport;
    },

    /**
     * Record health status
     */
    recordHealth(report) {
        this.healthHistory.push(report);

        if (this.healthHistory.length > this.maxHistorySize) {
            this.healthHistory.shift();
        }

        // Check for alerts
        this.checkAlerts(report);
    },

    /**
     * Check for health alerts
     */
    checkAlerts(report) {
        const alerts = [];

        // Check component health
        for (const [name, status] of Object.entries(report.components)) {
            if (!status.healthy) {
                alerts.push({
                    type: 'component_unhealthy',
                    component: name,
                    severity: 'high'
                });
            }
        }

        // Check memory
        const memoryPercent = performanceMonitor?.getMemoryUsagePercent?.();
        if (memoryPercent && parseFloat(memoryPercent) > this.alertThresholds.memoryUsage) {
            alerts.push({
                type: 'high_memory',
                value: memoryPercent + '%',
                severity: 'warning'
            });
        }

        // Check storage
        const storageInfo = performanceOptimizer?.optimizeStorage?.();
        if (storageInfo && storageInfo.totalSize) {
            const sizeNum = parseFloat(storageInfo.totalSize);
            if (sizeNum > 4) { // > 4 MB
                alerts.push({
                    type: 'high_storage',
                    value: storageInfo.totalSize,
                    severity: 'warning'
                });
            }
        }

        return alerts;
    },

    /**
     * Start continuous monitoring
     */
    startMonitoring(interval = 60000) { // Check every minute
        setInterval(() => {
            this.checkAll();
        }, interval);
    },

    /**
     * Get system status
     */
    getStatus() {
        const latest = this.healthHistory[this.healthHistory.length - 1];

        return {
            timestamp: Date.now(),
            current: latest,
            trend: this.calculateTrend(),
            alerts: latest ? this.checkAlerts(latest) : [],
            summary: this.getSummary()
        };
    },

    /**
     * Calculate health trend
     */
    calculateTrend() {
        if (this.healthHistory.length < 2) return 'stable';

        const recent = this.healthHistory.slice(-5);
        const avg = recent.reduce((sum, h) => sum + h.overallHealth, 0) / recent.length;
        const latest = this.healthHistory[this.healthHistory.length - 1];

        if (latest.overallHealth > avg) return 'improving';
        if (latest.overallHealth < avg) return 'degrading';
        return 'stable';
    },

    /**
     * Get detailed summary
     */
    getSummary() {
        const latest = this.healthHistory[this.healthHistory.length - 1];
        if (!latest) return null;

        const unhealthy = Object.entries(latest.components)
            .filter(([, status]) => !status.healthy)
            .map(([name]) => name);

        return {
            overallHealth: latest.overallHealth.toFixed(1) + '%',
            healthyComponents: latest.healthyComponents + '/' + latest.totalComponents,
            unhealthyComponents: unhealthy,
            timestamp: new Date(latest.timestamp).toLocaleString()
        };
    }
};

/**
 * DIAGNOSTIC TOOLKIT
 */
const diagnostics = {

    /**
     * Run complete diagnostic
     */
    async runDiagnostic() {
        const diagnostic = {
            timestamp: new Date().toISOString(),
            environment: environmentConfig?.getConfig?.() || {},
            systemHealth: systemHealth.getStatus(),
            performance: performanceReporter?.generateReport?.() || {},
            storage: performanceOptimizer?.optimizeStorage?.() || {},
            errors: errorHandler?.getSummary?.() || {},
            firebase: firebaseStorage?.getStatus?.() || {},
            offline: offlineManager?.getDetailedStatus?.() || {}
        };

        return diagnostic;
    },

    /**
     * Export diagnostic report
     */
    async exportDiagnostic() {
        const diagnostic = await this.runDiagnostic();
        const json = JSON.stringify(diagnostic, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `diagnostic-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    },

    /**
     * Generate HTML report
     */
    async generateHTMLReport() {
        const diagnostic = await this.runDiagnostic();

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>System Diagnostic Report</title>
                <style>
                    body { font-family: Arial; margin: 20px; color: #333; }
                    h1 { color: #1e3a5f; }
                    h2 { color: #2d5a8c; margin-top: 30px; }
                    .section { margin: 20px 0; padding: 15px; background: #f0f0f0; border-radius: 5px; }
                    .healthy { color: #059669; font-weight: bold; }
                    .unhealthy { color: #dc2626; font-weight: bold; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                    th { background: #1e3a5f; color: white; }
                </style>
            </head>
            <body>
                <h1>System Diagnostic Report</h1>
                <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>

                <div class="section">
                    <h2>System Health</h2>
                    <p>Overall Health: <span class="${diagnostic.systemHealth.current?.overallHealth > 80 ? 'healthy' : 'unhealthy'}">
                        ${diagnostic.systemHealth.current?.overallHealth.toFixed(1)}%
                    </span></p>
                    <p>Components: ${diagnostic.systemHealth.current?.healthyComponents || 0} / ${diagnostic.systemHealth.current?.totalComponents || 0}</p>
                </div>

                <div class="section">
                    <h2>Performance</h2>
                    <p>Memory Usage: ${diagnostic.performance.memory?.percentUsed || 'N/A'}</p>
                    <p>Storage Usage: ${diagnostic.storage.totalSize || 'N/A'}</p>
                    <p>Page Load Time: ${diagnostic.performance.pageLoadTime || 'N/A'}</p>
                </div>

                <div class="section">
                    <h2>Errors</h2>
                    <p>Total Errors: ${diagnostic.errors.totalErrors || 0}</p>
                    <p>Last Error: ${diagnostic.errors.lastError?.message || 'None'}</p>
                </div>
            </body>
            </html>
        `;

        return html;
    }
};

/**
 * HEALTH CHECK API
 */
const healthCheck = {

    /**
     * Quick health check (async)
     */
    async quick() {
        return {
            app: typeof app !== 'undefined',
            storage: (() => {
                try {
                    localStorage.setItem('test', 'ok');
                    localStorage.removeItem('test');
                    return true;
                } catch (e) {
                    return false;
                }
            })(),
            online: navigator.onLine
        };
    },

    /**
     * Full health check
     */
    async full() {
        return await diagnostics.runDiagnostic();
    },

    /**
     * Component check
     */
    component(name) {
        const component = systemHealth.components[name];
        if (!component) return null;

        return {
            name,
            healthy: component.check(),
            dependencies: component.dependencies
        };
    }
};

// Initialize health monitoring
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        systemHealth.init();
    });
} else {
    systemHealth.init();
}

// Expose globally
window.systemHealth = systemHealth;
window.diagnostics = diagnostics;
window.healthCheck = healthCheck;

console.log('System health monitoring and diagnostics loaded');
