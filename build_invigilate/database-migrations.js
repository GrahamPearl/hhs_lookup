/**
 * DATABASE MIGRATION & BATCH PROCESSING UTILITIES
 * 
 * Provides:
 * - Data format migrations
 * - Batch insert/update
 * - Data validation
 * - Schema versioning
 * - Legacy data import
 */

const databaseMigrations = {
    
    /**
     * Current schema version
     */
    schemaVersion: 2,

    /**
     * Run all pending migrations
     */
    async runPendingMigrations() {
        const currentVersion = parseInt(localStorage.getItem('schemaVersion') || '1', 10);
        const pendingVersion = this.schemaVersion;

        if (currentVersion >= pendingVersion) {
            console.log('Schema up to date');
            return { success: true, migrationsRun: 0 };
        }

        let migrationsRun = 0;

        try {
            if (currentVersion < 2) {
                await this.migrate_v1_to_v2();
                migrationsRun++;
            }

            localStorage.setItem('schemaVersion', String(this.schemaVersion));
            console.log(`Applied ${migrationsRun} migrations`);

            return { success: true, migrationsRun };
        } catch (error) {
            console.error('Migration failed:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Migration from v1 to v2
     * Adds is_zulu and other fields to schedule data
     */
    async migrate_v1_to_v2() {
        console.log('Migrating schema v1 -> v2');

        const scheduleData = localStorage.getItem('scheduleData');
        if (!scheduleData) return;

        try {
            const data = JSON.parse(scheduleData);
            const migrated = data.map(row => ({
                ...row,
                is_zulu: row.is_zulu || false,
                uploadTimestamp: row.uploadTimestamp || new Date().toISOString()
            }));

            localStorage.setItem('scheduleData', JSON.stringify(migrated));
            console.log('Migration v1->v2 complete');
        } catch (error) {
            console.error('v1->v2 migration error:', error);
            throw error;
        }
    },

    /**
     * Validate data schema
     */
    validateSchema(data, type = 'assignment') {
        const errors = [];

        if (type === 'assignment') {
            data.forEach((row, idx) => {
                if (!row.date) errors.push(`Row ${idx}: Missing date`);
                if (!row.exam) errors.push(`Row ${idx}: Missing exam`);
                if (row.session === undefined) errors.push(`Row ${idx}: Missing session`);
                if (!row.grade) errors.push(`Row ${idx}: Missing grade`);
                if (!row.venue) errors.push(`Row ${idx}: Missing venue`);
                if (row.timeshift === undefined) errors.push(`Row ${idx}: Missing timeshift`);
            });
        }

        if (type === 'teacher') {
            data.forEach((row, idx) => {
                if (!row.name) errors.push(`Teacher ${idx}: Missing name`);
                if (!row.registerClass) errors.push(`Teacher ${idx}: Missing registerClass`);
            });
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
};

/**
 * BATCH PROCESSING UTILITIES
 */
const batchProcessor = {

    /**
     * Process data in batches
     */
    async processBatch(data, processor, batchSize = 100, onProgress = null) {
        const results = [];
        const totalBatches = Math.ceil(data.length / batchSize);

        for (let i = 0; i < totalBatches; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, data.length);
            const batch = data.slice(start, end);

            try {
                const batchResults = await processor(batch, i + 1, totalBatches);
                results.push(...batchResults);

                if (typeof onProgress === 'function') {
                    onProgress({
                        current: i + 1,
                        total: totalBatches,
                        percentage: Math.round(((i + 1) / totalBatches) * 100)
                    });
                }

                // Small delay between batches
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
                console.error(`Batch ${i + 1} failed:`, error);
                throw error;
            }
        }

        return results;
    },

    /**
     * Batch insert to Firestore
     */
    async batchInsertToFirestore(data, collection, batchSize = 250) {
        if (!firebaseStorage.isInitialized) {
            return this.batchInsertToLocalStorage(data, collection);
        }

        const batches = [];
        let currentBatch = firebaseStorage.db.batch();
        let docCount = 0;
        let totalInserted = 0;

        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            const docRef = firebaseStorage.db.collection(collection).doc(`${i}_${Date.now()}`);

            currentBatch.set(docRef, {
                ...item,
                insertedAt: firebase.firestore.FieldValue.serverTimestamp(),
                batchIndex: i
            });

            docCount++;
            totalInserted++;

            if (docCount >= batchSize) {
                batches.push(currentBatch.commit());
                currentBatch = firebaseStorage.db.batch();
                docCount = 0;
            }
        }

        if (docCount > 0) {
            batches.push(currentBatch.commit());
        }

        await Promise.all(batches);
        return { success: true, inserted: totalInserted };
    },

    /**
     * Batch insert to localStorage
     */
    batchInsertToLocalStorage(data, collection) {
        const batchId = `batch_${collection}_${Date.now()}`;

        data.forEach((item, idx) => {
            const key = `${collection}_${batchId}_${idx}`;
            localStorage.setItem(key, JSON.stringify(item));
        });

        localStorage.setItem(`${collection}_batchId`, batchId);
        return { success: true, inserted: data.length, batchId };
    },

    /**
     * Batch update with conflict resolution
     */
    async batchUpdate(data, keyField, strategy = 'local') {
        const updates = [];

        for (const item of data) {
            if (!item[keyField]) continue;

            const existing = localStorage.getItem(`item_${item[keyField]}`);

            if (existing) {
                const existingData = JSON.parse(existing);

                if (strategy === 'merge') {
                    Object.assign(existingData, item);
                    updates.push(existingData);
                } else if (strategy === 'local') {
                    updates.push(existingData);
                } else if (strategy === 'remote') {
                    updates.push(item);
                }
            } else {
                updates.push(item);
            }
        }

        return updates;
    },

    /**
     * Batch delete
     */
    async batchDelete(keys, collection = null) {
        if (firebaseStorage.isInitialized && collection) {
            const batch = firebaseStorage.db.batch();

            for (const key of keys) {
                const docRef = firebaseStorage.db.collection(collection).doc(key);
                batch.delete(docRef);
            }

            await batch.commit();
        }

        // Also delete from localStorage
        keys.forEach(key => {
            localStorage.removeItem(key);
        });

        return { success: true, deleted: keys.length };
    },

    /**
     * Get batch statistics
     */
    getBatchStats(data) {
        return {
            totalItems: data.length,
            estimatedBatches: Math.ceil(data.length / 100),
            estimatedTime: Math.ceil(data.length / 100) * 0.5 + 's',
            dataSize: new Blob([JSON.stringify(data)]).size
        };
    }
};

/**
 * LEGACY DATA IMPORT
 */
const legacyImport = {

    /**
     * Import from old format
     */
    convertLegacyFormat(legacyData) {
        if (Array.isArray(legacyData) && legacyData.length > 0) {
            // Detect and convert old format
            const firstItem = legacyData[0];

            // Old format detection
            if (firstItem.ExamDate || firstItem['Exam Date']) {
                return this.convertExamDateFormat(legacyData);
            }

            if (firstItem.TeacherName) {
                return this.convertTeacherFormat(legacyData);
            }
        }

        return legacyData;
    },

    /**
     * Convert old exam date format
     */
    convertExamDateFormat(data) {
        return data.map(row => ({
            date: row.ExamDate || row['Exam Date'],
            session: row.Session || row.session || 1,
            grade: row.Grade || row.grade,
            exam: row.Subject || row.Exam || row.exam,
            venue: row['Venue Number'] || row.Venue || row.venue,
            timeshift: parseFloat(row['Time Shift'] || row.TimeShift || row.timeshift || 0),
            educator: row.Educator || row.educator || null,
            is_zulu: (row.Zulu || row.is_zulu || 'No').toString().toLowerCase() === 'yes'
        }));
    },

    /**
     * Convert old teacher format
     */
    convertTeacherFormat(data) {
        return data.map(row => ({
            name: row.TeacherName || row.Educator || row.name,
            registerClass: row.Grade || row['Register class'] || row.registerClass,
            learners: parseInt(row.Learners || row.learners || 0),
            is_zulu: (row.Zulu || row.is_zulu || 'No').toString().toLowerCase() === 'yes'
        }));
    }
};

// Expose globally
window.databaseMigrations = databaseMigrations;
window.batchProcessor = batchProcessor;
window.legacyImport = legacyImport;

// Auto-run migrations on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        databaseMigrations.runPendingMigrations();
    });
} else {
    databaseMigrations.runPendingMigrations();
}
