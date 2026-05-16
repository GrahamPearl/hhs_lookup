/**
 * DATA MAPPING & PARSING UTILITY
 * Designed for Exam Invigilation Scheduler
 *
 * This utility maps specific Excel/CSV headers to the internal data structures 
 * required by the Scheduling Engine while ensuring no existing assignments are lost.
 */

const DataMappingUtility = {
    // Current configuration for weights (can be toggled/updated via UI)
    config: {
        weights: {
            gradeMatch: 0.40,
            workload: 0.40,
            language: 0.10,
            sessionLoad: 0.10
        },
        constraints: {
            enforceGradeMatch: false,
            maxHoursPerTeacher: 40
        }
    },

    /**
     * Maps raw rows from Invigilator_Assignment_To_Venues.xlsx
     * @param {Array} rawData - Array of objects from XLSX/CSV
     * @returns {Array} Normalized assignment objects
     */
    parseAssignments(rawData) {
        return rawData.map((row, index) => {
            const getVal = (keys) => {
                const found = keys.find(k => k in row);
                return found !== undefined ? row[found] : null;
            };

            const educatorVal = getVal(['Educator', 'educator', 'Teacher']);

            return {
                id: `assign_${index}`,
                date: getVal(['Date', 'date', 'DATE']),
                session: parseInt(getVal(['Session', 'session', 'SESSION']) || 1),
                grade: String(getVal(['Grade', 'grade', 'GRADE']) || ''),
                exam: getVal(['Exam', 'exam', 'EXAM']) || 'General Exam',
                venue: String(getVal(['Venue Number', 'Venue', 'venue']) || ''),
                timeshift: parseFloat(getVal(['TimeShift', 'Time Shift', 'timeshift']) || 0),
                // CRITICAL: Preserve existing educators. 
                // Only set if not null/empty in the source file.
                educator: (educatorVal && educatorVal.trim() !== '') ? educatorVal : null,
                is_zulu: String(getVal(['Is Zulu', 'Zulu', 'is_zulu'])).toLowerCase() === 'true'
            };
        });
    },

    /**
     * Maps raw rows from Teachers.xlsx
     * @param {Array} rawData - Array of objects from XLSX/CSV
     * @returns {Array} Normalized teacher objects
     */
    parseTeachers(rawData) {
        return rawData.map((row, index) => {
            const getVal = (keys) => {
                const found = keys.find(k => k in row);
                return found !== undefined ? row[found] : null;
            };

            const name = getVal(['Educator', 'Name', 'name', 'Teacher']);
            if (!name) return null;

            return {
                name: name,
                registerClass: String(getVal(['Register class', 'Grade', 'registerClass']) || 'ROTATE'),
                learners: parseInt(getVal(['Learners', 'learners']) || 0),
                is_zulu: String(getVal(['Zulu', 'is_zulu'])).toLowerCase() === 'true'
            };
        }).filter(t => t !== null);
    },

    /**
     * Update weights dynamically (Toggles)
     */
    updateWeights(newWeights) {
        this.config.weights = { ...this.config.weights, ...newWeights };
        if (window.schedulingConfig) {
            window.schedulingConfig.weights = this.config.weights;
        }
    }
};

window.DataMappingUtility = DataMappingUtility;