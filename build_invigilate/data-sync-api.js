/**
 * DATA SYNCHRONIZATION AND BACKUP API
 * 
 * Provides methods for:
 * - Exporting all data to JSON/CSV
 * - Importing data from backups
 * - Comparing local and remote data
 * - Creating recovery points
 * - Incremental syncs
 */

const dataSyncAPI = {
    
    /**
     * Create a complete backup of all assignments
     */
    createBackup(app, includeMetadata = true) {
        const backup = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            batchId: app.currentBatchId,
            data: {
                scheduleData: app.scheduleData,
                teachersData: app.teachersData,
                allocations: Array.from(app.allocationMap.entries())
            }
        };

        if (includeMetadata) {
            backup.metadata = {
                totalSlots: app.scheduleData.length,
                totalTeachers: app.teachersData.length,
                assignedSlots: app.scheduleData.filter(s => s.educator || app.allocationMap.get(app.scheduleData.indexOf(s))).length,
                syncStatus: firebaseStorage.getStatus(),
                offlineStatus: offlineManager.getDetailedStatus()
            };
        }

        return backup;
    },

    /**
     * Export backup as JSON file
     */
    downloadBackupJSON(app) {
        const backup = this.createBackup(app, true);
        const json = JSON.stringify(backup, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `exam-backup-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    },

    /**
     * Export assignments as CSV
     */
    downloadAssignmentsCSV(app) {
        let csv = 'Date,Session,Grade,Exam,Venue,Duration,Teacher,Status\n';
        
        app.scheduleData.forEach((row, idx) => {
            const teacher = row.educator || app.allocationMap.get(idx) || 'Unassigned';
            const status = teacher !== 'Unassigned' ? 'Assigned' : 'Unassigned';
            csv += `"${row.date}",${row.session},"${row.grade}","${row.exam}","${row.venue}",${row.timeshift},"${teacher}","${status}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `assignments-${Date.now()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    },

    /**
     * Restore from backup JSON
     */
    async restoreFromBackup(app, backupFile) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const backup = JSON.parse(e.target.result);
                    
                    // Validate backup format
                    if (!backup.data || !backup.data.scheduleData) {
                        throw new Error('Invalid backup format');
                    }

                    // Restore data
                    app.scheduleData = backup.data.scheduleData;
                    app.teachersData = backup.data.teachersData;
                    app.allocationMap = new Map(backup.data.allocations);
                    app.currentBatchId = backup.batchId;

                    // Save to storage
                    app.saveToStorage();
                    app.updateDashboard();

                    resolve({
                        success: true,
                        message: `Restored ${backup.data.scheduleData.length} assignments`,
                        timestamp: backup.timestamp
                    });

                } catch (error) {
                    reject({
                        success: false,
                        error: error.message
                    });
                }
            };

            reader.onerror = () => {
                reject({
                    success: false,
                    error: 'Failed to read file'
                });
            };

            reader.readAsText(backupFile);
        });
    },

    /**
     * Compare local and remote data
     */
    async compareWithRemote(app) {
        if (!firebaseStorage.isInitialized) {
            return { error: 'Firebase not initialized' };
        }

        try {
            const remote = await firebaseStorage.loadAssignments(app.currentBatchId);
            
            const comparison = {
                localCount: app.scheduleData.length,
                remoteCount: remote.length,
                match: app.scheduleData.length === remote.length,
                differences: []
            };

            // Find differences
            app.scheduleData.forEach((local, idx) => {
                const remoteItem = remote[idx];
                if (remoteItem && local.educatorteacher !== remoteItem.allocatedTeacher) {
                    comparison.differences.push({
                        index: idx,
                        local: local.educator,
                        remote: remoteItem.allocatedTeacher
                    });
                }
            });

            return comparison;

        } catch (error) {
            return { error: error.message };
        }
    },

    /**
     * Get data statistics
     */
    getStatistics(app) {
        const total = app.scheduleData.length;
        const assigned = app.scheduleData.filter((s, idx) => 
            s.educator || app.allocationMap.get(idx)
        ).length;

        const teacherWorkload = {};
        app.teachersData.forEach(teacher => {
            teacherWorkload[teacher.name] = {
                slots: 0,
                hours: 0,
                grades: new Set()
            };
        });

        app.scheduleData.forEach((slot, idx) => {
            const teacher = slot.educator || app.allocationMap.get(idx);
            if (teacher && teacherWorkload[teacher]) {
                teacherWorkload[teacher].slots++;
                teacherWorkload[teacher].hours += slot.timeshift || 0;
                teacherWorkload[teacher].grades.add(slot.grade);
            }
        });

        // Convert Sets to Arrays
        Object.keys(teacherWorkload).forEach(teacher => {
            teacherWorkload[teacher].grades = Array.from(teacherWorkload[teacher].grades);
        });

        return {
            overview: {
                totalSlots: total,
                assignedSlots: assigned,
                unassignedSlots: total - assigned,
                assignmentRate: total > 0 ? ((assigned / total) * 100).toFixed(1) + '%' : '0%',
                totalTeachers: app.teachersData.length
            },
            teacherWorkload,
            gradeDistribution: this.getGradeDistribution(app),
            dateRange: this.getDateRange(app)
        };
    },

    /**
     * Get grade distribution
     */
    getGradeDistribution(app) {
        const distribution = {};
        app.scheduleData.forEach(slot => {
            distribution[slot.grade] = (distribution[slot.grade] || 0) + 1;
        });
        return distribution;
    },

    /**
     * Get date range
     */
    getDateRange(app) {
        const dates = app.scheduleData
            .map(s => new Date(s.date).getTime())
            .filter(d => !isNaN(d));

        if (dates.length === 0) return null;

        return {
            from: new Date(Math.min(...dates)).toLocaleDateString(),
            to: new Date(Math.max(...dates)).toLocaleDateString(),
            days: Math.ceil((Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24))
        };
    },

    /**
     * Merge two datasets (resolve conflicts)
     */
    mergeData(local, remote, strategy = 'local') {
        const merged = [...local];

        remote.forEach((remoteItem, idx) => {
            if (!merged[idx]) {
                merged[idx] = remoteItem;
            } else if (strategy === 'remote') {
                merged[idx].educator = remoteItem.educator;
            }
        });

        return merged;
    },

    /**
     * Validate data integrity
     */
    validateIntegrity(app) {
        const issues = [];

        // Check for required fields
        app.scheduleData.forEach((slot, idx) => {
            if (!slot.date) issues.push(`Slot ${idx}: Missing date`);
            if (!slot.exam) issues.push(`Slot ${idx}: Missing exam`);
        });

        // Check for invalid references
        app.allocationMap.forEach((teacher, idx) => {
            if (!app.teachersData.find(t => t.name === teacher)) {
                issues.push(`Allocation ${idx}: Unknown teacher "${teacher}"`);
            }
        });

        return {
            valid: issues.length === 0,
            issues
        };
    }
};

// Expose globally
window.dataSyncAPI = dataSyncAPI;
