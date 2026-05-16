/**
 * PERFORMANCE OPTIMIZATION & MONITORING
 * 
 * Tracks and optimizes:
 * - Memory usage
 * - Load times
 * - Render performance
 * - Storage efficiency
 * - Network optimization
 */

const performanceMonitor = {

    metrics: {
        startTime: performance.now(),
        pageLoadTime: 0,
        apiCallTimes: [],
        memorySnapshots: [],
        renderTimes: []
    },

    /**
     * Record page load time
     */
    recordPageLoad() {
        if (window.performance && window.performance.timing) {
            const timing = window.performance.timing;
            this.metrics.pageLoadTime = timing.loadEventEnd - timing.navigationStart;
            
            console.log(`Page load time: ${this.metrics.pageLoadTime}ms`);
        }
    },

    /**
     * Record API call duration
     */
    recordAPICall(name, duration) {
        this.metrics.apiCallTimes.push({
            name,
            duration,
            timestamp: Date.now()
        });

        // Keep last 100 calls
        if (this.metrics.apiCallTimes.length > 100) {
            this.metrics.apiCallTimes.shift();
        }
    },

    /**
     * Take memory snapshot
     */
    takeMemorySnapshot() {
        if (performance.memory) {
            const snapshot = {
                timestamp: Date.now(),
                usedJSHeapSize: performance.memory.usedJSHeapSize,
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
            };

            this.metrics.memorySnapshots.push(snapshot);

            // Keep last 50 snapshots
            if (this.metrics.memorySnapshots.length > 50) {
                this.metrics.memorySnapshots.shift();
            }

            return snapshot;
        }
        return null;
    },

    /**
     * Get memory usage percentage
     */
    getMemoryUsagePercent() {
        if (performance.memory) {
            return (
                (performance.memory.usedJSHeapSize / 
                 performance.memory.jsHeapSizeLimit) * 100
            ).toFixed(1);
        }
        return null;
    },

    /**
     * Get performance summary
     */
    getSummary() {
        const apiTimes = this.metrics.apiCallTimes;
        const avgAPITime = apiTimes.length > 0
            ? (apiTimes.reduce((sum, t) => sum + t.duration, 0) / apiTimes.length).toFixed(2)
            : 0;

        const memory = this.takeMemorySnapshot();

        return {
            pageLoadTime: this.metrics.pageLoadTime,
            averageAPICallTime: avgAPITime,
            totalAPICalls: apiTimes.length,
            memory: {
                currentUsage: memory ? (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB' : 'N/A',
                percentUsed: this.getMemoryUsagePercent() + '%'
            },
            uptime: ((performance.now() - this.metrics.startTime) / 1000).toFixed(1) + 's'
        };
    }
};

/**
 * PERFORMANCE OPTIMIZER
 */
const performanceOptimizer = {

    /**
     * Optimize localStorage usage
     */
    optimizeStorage() {
        const items = {};
        let totalSize = 0;

        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                const value = localStorage[key];
                const size = new Blob([value]).size;
                items[key] = size;
                totalSize += size;
            }
        }

        // Identify large items
        const largeItems = Object.entries(items)
            .filter(([k, v]) => v > 100000) // > 100KB
            .sort((a, b) => b[1] - a[1]);

        return {
            totalSize: (totalSize / 1024).toFixed(2) + ' KB',
            itemCount: Object.keys(items).length,
            largeItems: largeItems.map(([k, v]) => ({
                key: k,
                size: (v / 1024).toFixed(2) + ' KB'
            }))
        };
    },

    /**
     * Clear old data
     */
    clearOldData(olderThan = 30 * 24 * 60 * 60 * 1000) { // 30 days default
        const now = Date.now();
        let cleared = 0;

        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key) && key.includes('_timestamp')) {
                const timestamp = parseInt(localStorage[key]);
                if (now - timestamp > olderThan) {
                    const dataKey = key.replace('_timestamp', '');
                    localStorage.removeItem(dataKey);
                    localStorage.removeItem(key);
                    cleared++;
                }
            }
        }

        return { cleared };
    },

    /**
     * Compress data
     */
    compressData(data) {
        const json = JSON.stringify(data);
        const compressed = this.lz_encode(json);
        return compressed;
    },

    /**
     * Decompress data
     */
    decompressData(compressed) {
        const json = this.lz_decode(compressed);
        return JSON.parse(json);
    },

    /**
     * Simple LZ compression (for demo purposes)
     */
    lz_encode(s) {
        const dict = {};
        const data = (s + '').split('');
        const out = [];
        let currChar;
        let phrase = data[0];
        let code = 256;

        for (let i = 1; i < data.length; i++) {
            currChar = data[i];
            if (dict[phrase + currChar] != null) {
                phrase += currChar;
            } else {
                out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
                dict[phrase + currChar] = code;
                code += 1;
                phrase = currChar;
            }
        }

        out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));

        for (let i = 0; i < data.length; i++) {
            data[i] = String.fromCharCode(data[i]);
        }

        return out.map(x => String.fromCharCode(x)).join('');
    },

    /**
     * Simple LZ decompression
     */
    lz_decode(s) {
        const dict = {};
        const data = (s + '').split('');
        let currChar = data[0];
        let oldPhrase = currChar;
        const out = [currChar];
        let code = 256;
        let phrase;

        for (let i = 1; i < data.length; i++) {
            const currCode = data[i].charCodeAt(0);
            if (currCode < 256) {
                phrase = data[i];
            } else {
                phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
            }

            out.push(phrase);
            currChar = phrase.charAt(0);
            dict[code] = oldPhrase + currChar;
            code += 1;
            oldPhrase = phrase;
        }

        return out.join('');
    },

    /**
     * Get optimization recommendations
     */
    getRecommendations() {
        const recommendations = [];
        const storage = this.optimizeStorage();

        if (storage.totalSize.includes('MB')) {
            recommendations.push('Storage exceeds 1MB - consider archiving old data');
        }

        if (storage.largeItems.length > 5) {
            recommendations.push('Multiple large items found - consider splitting data');
        }

        const memory = performanceMonitor.getMemoryUsagePercent();
        if (memory && parseFloat(memory) > 80) {
            recommendations.push('High memory usage detected - consider clearing cache');
        }

        return recommendations;
    }
};

/**
 * NETWORK OPTIMIZER
 */
const networkOptimizer = {

    /**
     * Check connection quality
     */
    async checkConnectionQuality() {
        const startTime = performance.now();

        try {
            const response = await fetch('/ping', { 
                method: 'HEAD',
                cache: 'no-cache'
            });

            const duration = performance.now() - startTime;
            const speed = 1 / (duration / 1000); // requests per second

            return {
                online: response.ok,
                latency: duration.toFixed(0) + 'ms',
                speed: speed.toFixed(2) + ' req/s',
                quality: this.assessQuality(duration)
            };
        } catch (error) {
            return {
                online: false,
                error: error.message
            };
        }
    },

    /**
     * Assess connection quality
     */
    assessQuality(latency) {
        if (latency < 50) return 'Excellent';
        if (latency < 150) return 'Good';
        if (latency < 300) return 'Fair';
        return 'Poor';
    },

    /**
     * Batch API requests
     */
    batchRequests(requests, batchSize = 10) {
        const batches = [];
        for (let i = 0; i < requests.length; i += batchSize) {
            batches.push(requests.slice(i, i + batchSize));
        }
        return batches;
    },

    /**
     * Optimize download size
     */
    getDownloadOptimization() {
        return {
            minifyJS: true,
            minifyCSS: true,
            compressHTML: true,
            enableGzip: true,
            optimizeImages: true,
            lazyLoadContent: true
        };
    }
};

/**
 * PERFORMANCE REPORTER
 */
const performanceReporter = {

    /**
     * Generate performance report
     */
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            performance: performanceMonitor.getSummary(),
            storage: performanceOptimizer.optimizeStorage(),
            recommendations: performanceOptimizer.getRecommendations(),
            optimizations: networkOptimizer.getDownloadOptimization()
        };

        return report;
    },

    /**
     * Export report as JSON
     */
    exportReport() {
        const report = this.generateReport();
        const json = JSON.stringify(report, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `performance-report-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    },

    /**
     * Log report to console
     */
    logReport() {
        const report = this.generateReport();
        console.table(report.performance);
        console.log('Storage Analysis:', report.storage);
        console.log('Recommendations:', report.recommendations);
    }
};

// Expose globally
window.performanceMonitor = performanceMonitor;
window.performanceOptimizer = performanceOptimizer;
window.networkOptimizer = networkOptimizer;
window.performanceReporter = performanceReporter;

// Record page load time when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        performanceMonitor.recordPageLoad();
    });
} else {
    performanceMonitor.recordPageLoad();
}

// Take periodic memory snapshots
setInterval(() => {
    performanceMonitor.takeMemorySnapshot();
}, 60000); // Every minute
