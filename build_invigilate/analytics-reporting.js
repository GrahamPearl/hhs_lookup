/**
 * ADVANCED ANALYTICS & REPORTING MODULE
 * 
 * Provides:
 * - Real-time analytics
 * - Custom report generation
 * - Data visualization helpers
 * - Performance metrics
 * - Audit trails
 */

const analyticsEngine = {

    /**
     * Track event
     */
    trackEvent(eventName, eventData = {}) {
        const event = {
            name: eventName,
            timestamp: Date.now(),
            data: eventData,
            userId: this.getUserId()
        };

        // Store in localStorage
        const events = JSON.parse(localStorage.getItem('analyticsEvents') || '[]');
        events.push(event);

        // Keep last 1000 events
        if (events.length > 1000) {
            events.shift();
        }

        localStorage.setItem('analyticsEvents', JSON.stringify(events));

        // Send to Firebase if available
        if (firebaseStorage.isInitialized) {
            firebaseStorage.db.collection('analytics').add({
                ...event,
                uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.log('Analytics upload skipped'));
        }

        return event;
    },

    /**
     * Get unique user ID
     */
    getUserId() {
        let userId = localStorage.getItem('analyticsUserId');
        if (!userId) {
            userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('analyticsUserId', userId);
        }
        return userId;
    },

    /**
     * Get analytics summary
     */
    getAnalyticsSummary() {
        const events = JSON.parse(localStorage.getItem('analyticsEvents') || '[]');
        
        const summary = {
            totalEvents: events.length,
            eventTypes: {},
            eventsPerHour: {},
            topEvents: []
        };

        events.forEach(event => {
            summary.eventTypes[event.name] = (summary.eventTypes[event.name] || 0) + 1;

            const hour = new Date(event.timestamp).getHours();
            summary.eventsPerHour[hour] = (summary.eventsPerHour[hour] || 0) + 1;
        });

        // Top 5 events
        summary.topEvents = Object.entries(summary.eventTypes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        return summary;
    },

    /**
     * Clear analytics
     */
    clearAnalytics() {
        localStorage.removeItem('analyticsEvents');
        return { success: true };
    }
};

/**
 * REPORT GENERATOR
 */
const reportGenerator = {

    /**
     * Generate allocation report
     */
    generateAllocationReport(app) {
        if (typeof app === 'undefined') return null;

        const report = {
            title: 'Allocation Report',
            generated: new Date().toISOString(),
            summary: {
                totalSlots: app.scheduleData.length,
                assignedSlots: 0,
                unassignedSlots: 0,
                assignmentPercentage: 0
            },
            byGrade: {},
            byTeacher: {},
            byVenue: {},
            issues: []
        };

        // Count allocations
        app.scheduleData.forEach((slot, idx) => {
            const teacher = slot.educator || app.allocationMap.get(idx);

            if (teacher) {
                report.summary.assignedSlots++;
            } else {
                report.summary.unassignedSlots++;
            }

            // By grade
            if (!report.byGrade[slot.grade]) {
                report.byGrade[slot.grade] = { total: 0, assigned: 0 };
            }
            report.byGrade[slot.grade].total++;
            if (teacher) report.byGrade[slot.grade].assigned++;

            // By teacher
            if (teacher) {
                if (!report.byTeacher[teacher]) {
                    report.byTeacher[teacher] = { slots: 0, hours: 0, grades: new Set() };
                }
                report.byTeacher[teacher].slots++;
                report.byTeacher[teacher].hours += slot.timeshift || 0;
                report.byTeacher[teacher].grades.add(slot.grade);
            }

            // By venue
            if (!report.byVenue[slot.venue]) {
                report.byVenue[slot.venue] = { slots: 0, assigned: 0 };
            }
            report.byVenue[slot.venue].slots++;
            if (teacher) report.byVenue[slot.venue].assigned++;
        });

        report.summary.assignmentPercentage = app.scheduleData.length > 0
            ? Math.round((report.summary.assignedSlots / app.scheduleData.length) * 100)
            : 0;

        // Convert Sets to Arrays
        Object.keys(report.byTeacher).forEach(teacher => {
            report.byTeacher[teacher].grades = Array.from(report.byTeacher[teacher].grades);
        });

        // Identify issues
        const avgHours = Object.values(report.byTeacher)
            .reduce((sum, t) => sum + t.hours, 0) / Object.keys(report.byTeacher).length || 0;

        Object.entries(report.byTeacher).forEach(([name, stats]) => {
            if (stats.hours > avgHours * 1.4) {
                report.issues.push(`${name} overloaded: ${stats.hours} hours (avg: ${avgHours.toFixed(1)})`);
            }
        });

        return report;
    },

    /**
     * Generate workload report
     */
    generateWorkloadReport(app) {
        if (typeof app === 'undefined') return null;

        const workload = {};
        
        app.scheduleData.forEach((slot, idx) => {
            const teacher = slot.educator || app.allocationMap.get(idx);
            if (teacher) {
                if (!workload[teacher]) {
                    workload[teacher] = {
                        name: teacher,
                        slots: 0,
                        hours: 0,
                        dates: new Set(),
                        grades: new Set(),
                        venues: new Set()
                    };
                }
                workload[teacher].slots++;
                workload[teacher].hours += slot.timeshift || 0;
                workload[teacher].dates.add(slot.date);
                workload[teacher].grades.add(slot.grade);
                workload[teacher].venues.add(slot.venue);
            }
        });

        // Convert to array and clean up Sets
        const workloadArray = Object.values(workload).map(item => ({
            ...item,
            dates: Array.from(item.dates),
            grades: Array.from(item.grades),
            venues: Array.from(item.venues),
            avgHoursPerDay: (item.hours / (new Set(app.scheduleData.map(s => s.date)).size || 1)).toFixed(1)
        }));

        // Sort by hours descending
        workloadArray.sort((a, b) => b.hours - a.hours);

        return {
            title: 'Teacher Workload Report',
            generated: new Date().toISOString(),
            teachers: workloadArray,
            statistics: {
                totalTeachers: workloadArray.length,
                totalHours: workloadArray.reduce((sum, t) => sum + t.hours, 0),
                averageHours: (workloadArray.reduce((sum, t) => sum + t.hours, 0) / workloadArray.length).toFixed(1),
                maxHours: Math.max(...workloadArray.map(t => t.hours)),
                minHours: Math.min(...workloadArray.map(t => t.hours))
            }
        };
    },

    /**
     * Generate compliance report
     */
    generateComplianceReport(app) {
        const report = {
            title: 'Compliance & Validation Report',
            generated: new Date().toISOString(),
            checks: [],
            passed: 0,
            failed: 0
        };

        // Check 1: All slots assigned
        const unassigned = app.scheduleData.filter((slot, idx) => !slot.educator && !app.allocationMap.get(idx));
        const check1 = {
            name: 'All Slots Assigned',
            passed: unassigned.length === 0,
            details: `${app.scheduleData.length - unassigned.length}/${app.scheduleData.length} assigned`
        };
        report.checks.push(check1);
        if (check1.passed) report.passed++; else report.failed++;

        // Check 2: No double bookings
        const conflicts = this.detectConflicts(app);
        const check2 = {
            name: 'No Double Bookings',
            passed: conflicts.length === 0,
            details: `${conflicts.length} conflicts found`
        };
        report.checks.push(check2);
        if (check2.passed) report.passed++; else report.failed++;

        // Check 3: Workload balanced
        const workload = {};
        app.scheduleData.forEach((slot, idx) => {
            const teacher = slot.educator || app.allocationMap.get(idx);
            if (teacher) {
                workload[teacher] = (workload[teacher] || 0) + (slot.timeshift || 0);
            }
        });
        const hours = Object.values(workload);
        const avgHours = hours.reduce((a, b) => a + b, 0) / (hours.length || 1);
        const variance = Math.sqrt(hours.reduce((sum, h) => sum + Math.pow(h - avgHours, 2), 0) / (hours.length || 1));
        const check3 = {
            name: 'Workload Balanced',
            passed: variance < avgHours * 0.3,
            details: `Variance: ${variance.toFixed(1)} (avg: ${avgHours.toFixed(1)})`
        };
        report.checks.push(check3);
        if (check3.passed) report.passed++; else report.failed++;

        return report;
    },

    /**
     * Detect conflicts
     */
    detectConflicts(app) {
        const conflicts = [];
        const bookings = {};

        app.scheduleData.forEach((slot, idx) => {
            const teacher = slot.educator || app.allocationMap.get(idx);
            if (teacher) {
                const key = `${teacher}_${slot.date}_${slot.session}`;
                if (bookings[key]) {
                    conflicts.push({
                        teacher,
                        date: slot.date,
                        session: slot.session,
                        count: (bookings[key] || 0) + 1
                    });
                }
                bookings[key] = (bookings[key] || 0) + 1;
            }
        });

        return conflicts;
    },

    /**
     * Export report as HTML
     */
    exportReportAsHTML(report) {
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>${report.title}</title>
                <style>
                    body { font-family: Arial; margin: 20px; color: #333; }
                    h1 { color: #1e3a5f; }
                    .summary { background: #f0f0f0; padding: 15px; margin: 20px 0; border-radius: 5px; }
                    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
                    th { background: #1e3a5f; color: white; }
                    tr:hover { background: #f5f5f5; }
                </style>
            </head>
            <body>
                <h1>${report.title}</h1>
                <p>Generated: ${new Date(report.generated).toLocaleString()}</p>
        `;

        if (report.summary) {
            html += '<div class="summary">';
            Object.entries(report.summary).forEach(([key, value]) => {
                html += `<p><strong>${key}:</strong> ${value}</p>`;
            });
            html += '</div>';
        }

        html += '</body></html>';

        return html;
    }
};

// Expose globally
window.analyticsEngine = analyticsEngine;
window.reportGenerator = reportGenerator;

// Track page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        analyticsEngine.trackEvent('page_load', { 
            url: window.location.href,
            timestamp: new Date().toISOString()
        });
    });
} else {
    analyticsEngine.trackEvent('page_load', {
        url: window.location.href,
        timestamp: new Date().toISOString()
    });
}

// Track allocations
const originalAutoAllocate = typeof window.app !== 'undefined' ? window.app.autoAllocate : null;
if (originalAutoAllocate) {
    window.app.autoAllocate = function() {
        analyticsEngine.trackEvent('auto_allocate_started');
        const result = originalAutoAllocate.call(this);
        analyticsEngine.trackEvent('auto_allocate_completed');
        return result;
    };
}
