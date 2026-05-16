/**
 * EXAM SCHEDULING ENGINE - PART 1
 * Modules 1-4: Input Validation, Conflict Detection, Workload, Eligibility
 * 
 * Purpose: Foundation functions for constraint satisfaction and data analysis
 * Status: Standalone, testable, no dependencies on Part 2
 */

// ============================================================================
// MODULE 1: INPUT VALIDATION & PREPARATION (6 functions)
// ============================================================================

/**
 * Validate assignments array structure
 * @param {Array} assignments - Array of assignment objects
 * @returns {Object} {isValid: boolean, errors: Array}
 */
function validateAssignments(assignments) {
    const errors = [];

    if (!Array.isArray(assignments)) {
        errors.push('Assignments must be an array');
        return { isValid: false, errors };
    }

    if (assignments.length === 0) {
        errors.push('Assignments array is empty');
        return { isValid: false, errors };
    }

    const requiredFields = ['date', 'session', 'grade', 'exam', 'venue', 'timeshift'];

    assignments.forEach((assignment, idx) => {
        if (typeof assignment !== 'object' || assignment === null) {
            errors.push(`Row ${idx}: Assignment is not an object`);
            return;
        }

        requiredFields.forEach(field => {
            if (!(field in assignment)) {
                errors.push(`Row ${idx}: Missing required field '${field}'`);
            }
        });

        // Validate field types
        if (typeof assignment.session !== 'number') {
            errors.push(`Row ${idx}: 'session' must be a number`);
        }

        if (typeof assignment.timeshift !== 'number' || assignment.timeshift <= 0) {
            errors.push(`Row ${idx}: 'timeshift' must be a positive number`);
        }
    });

    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * Validate teachers array structure
 * @param {Array} teachers - Array of teacher objects
 * @returns {Object} {isValid: boolean, errors: Array}
 */
function validateTeachers(teachers) {
    const errors = [];

    if (!Array.isArray(teachers)) {
        errors.push('Teachers must be an array');
        return { isValid: false, errors };
    }

    // Teachers array can be empty (no teachers available)
    if (teachers.length === 0) {
        return { isValid: true, errors: [] };
    }

    const requiredFields = ['name'];

    teachers.forEach((teacher, idx) => {
        if (typeof teacher !== 'object' || teacher === null) {
            errors.push(`Teacher ${idx}: Teacher is not an object`);
            return;
        }

        requiredFields.forEach(field => {
            if (!(field in teacher)) {
                errors.push(`Teacher ${idx}: Missing required field '${field}'`);
            }
        });

        if (typeof teacher.name !== 'string' || teacher.name.trim() === '') {
            errors.push(`Teacher ${idx}: 'name' must be non-empty string`);
        }
    });

    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * Identify unassigned (empty) slots
 * @param {Array} assignments - Array of assignments
 * @returns {Array} Indices of assignments where educator is null/undefined/NaN
 */
function identifyEmptySlots(assignments) {
    return assignments
        .map((assignment, idx) => ({
            idx: idx,
            educator: assignment.educator
        }))
        .filter(item => 
            item.educator === null || 
            item.educator === undefined || 
            item.educator === '' ||
            (typeof item.educator === 'string' && item.educator.trim() === '')
        )
        .map(item => item.idx);
}

/**
 * Identify pre-assigned (fixed) slots
 * @param {Array} assignments - Array of assignments
 * @returns {Array} Indices of assignments where educator has value
 */
function identifyPreassignedSlots(assignments) {
    return assignments
        .map((assignment, idx) => ({
            idx: idx,
            educator: assignment.educator
        }))
        .filter(item => 
            item.educator !== null && 
            item.educator !== undefined && 
            item.educator !== '' &&
            !(typeof item.educator === 'string' && item.educator.trim() === '')
        )
        .map(item => item.idx);
}

/**
 * Normalize dates to consistent format (YYYY-MM-DD)
 * @param {Array} assignments - Array of assignments
 * @returns {Array} Assignments with normalized date strings
 */
function normalizeDates(assignments) {
    return assignments.map(assignment => {
        let dateStr = assignment.date;

        // Convert Timestamp object to date string
        if (assignment.date && typeof assignment.date === 'object' && assignment.date.toDate) {
            dateStr = assignment.date.toDate().toISOString().split('T')[0];
        }
        // Convert Date object
        else if (assignment.date instanceof Date) {
            dateStr = assignment.date.toISOString().split('T')[0];
        }
        // Already a string, ensure YYYY-MM-DD format
        else if (typeof dateStr === 'string') {
            // Parse various date formats
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                dateStr = date.toISOString().split('T')[0];
            }
        }

        return {
            ...assignment,
            date: dateStr
        };
    });
}

/**
 * Build index for fast teacher lookups
 * @param {Array} teachers - Array of teachers
 * @returns {Map} Map of teacherName -> teacherObject
 */
function buildTeacherIndex(teachers) {
    const index = new Map();

    teachers.forEach(teacher => {
        if (teacher.name) {
            index.set(teacher.name, teacher);
        }
    });

    return index;
}

// ============================================================================
// MODULE 2: CONFLICT DETECTION (5 functions)
// ============================================================================

/**
 * Check if teacher is double-booked on given date+session
 * @param {string} teacherName - Teacher name to check
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} session - Session number
 * @param {Array} assignments - Array of assignments
 * @returns {boolean} True if teacher is already assigned to this date+session
 */
function isDoubleBooked(teacherName, date, session, assignments) {
    return assignments.some(assignment =>
        assignment.educator === teacherName &&
        assignment.date === date &&
        assignment.session === session
    );
}

/**
 * Get all assignments for teacher on specific date
 * @param {string} teacherName - Teacher name
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Array} assignments - Array of assignments
 * @returns {Array} Assignments for teacher on that date
 */
function getTeacherScheduleOnDate(teacherName, date, assignments) {
    return assignments.filter(assignment =>
        assignment.educator === teacherName &&
        assignment.date === date
    );
}

/**
 * Get all assignments for teacher in specific session
 * @param {string} teacherName - Teacher name
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} session - Session number
 * @param {Array} assignments - Array of assignments
 * @returns {Array} Assignments for teacher in that session
 */
function getTeacherScheduleInSession(teacherName, date, session, assignments) {
    return assignments.filter(assignment =>
        assignment.educator === teacherName &&
        assignment.date === date &&
        assignment.session === session
    );
}

/**
 * Build quick-lookup booking map: educator -> date_session -> count
 * @param {Array} assignments - Array of assignments
 * @returns {Object} Booking map structure
 */
function buildBookingMap(assignments) {
    const bookingMap = {};

    assignments.forEach(assignment => {
        if (!assignment.educator) return;

        const educator = assignment.educator;
        const key = `${assignment.date}_${assignment.session}`;

        if (!bookingMap[educator]) {
            bookingMap[educator] = {};
        }

        bookingMap[educator][key] = (bookingMap[educator][key] || 0) + 1;
    });

    return bookingMap;
}

/**
 * Validate that schedule is conflict-free (no double-bookings)
 * @param {Array} assignments - Array of assignments
 * @returns {Object} {hasConflicts: boolean, conflicts: Array}
 */
function validateConflictFree(assignments) {
    const bookingMap = buildBookingMap(assignments);
    const conflicts = [];

    for (const [educator, sessions] of Object.entries(bookingMap)) {
        for (const [dateSession, count] of Object.entries(sessions)) {
            if (count > 1) {
                conflicts.push({
                    educator: educator,
                    dateSession: dateSession,
                    count: count
                });
            }
        }
    }

    return {
        hasConflicts: conflicts.length > 0,
        conflicts: conflicts
    };
}

// ============================================================================
// MODULE 3: WORKLOAD CALCULATION & MANAGEMENT (6 functions)
// ============================================================================

/**
 * Calculate total hours assigned to a teacher
 * @param {string} teacherName - Teacher name
 * @param {Array} assignments - Array of assignments
 * @returns {number} Total hours
 */
function calculateTeacherHours(teacherName, assignments) {
    return assignments
        .filter(assignment => assignment.educator === teacherName)
        .reduce((sum, assignment) => sum + (assignment.timeshift || 0), 0);
}

/**
 * Build comprehensive workload map for all teachers
 * @param {Array} assignments - Array of assignments
 * @param {Array} teachers - Array of teachers
 * @returns {Object} Workload map with structure: {teacherName: {totalHours, dailyLoad, assignments}}
 */
function buildWorkloadMap(assignments, teachers) {
    const workloadMap = {};

    // Initialize for all teachers
    teachers.forEach(teacher => {
        workloadMap[teacher.name] = {
            name: teacher.name,
            grade: teacher.registerClass || teacher.grade || '',
            is_zulu: teacher.is_zulu || false,
            totalHours: 0,
            assignments: [],
            dailyLoad: {},
            sessionLoad: {},
            bookings: {}
        };
    });

    // Calculate from assignments
    assignments.forEach((assignment, idx) => {
        if (!assignment.educator) return;

        const educator = assignment.educator;
        if (!workloadMap[educator]) {
            workloadMap[educator] = {
                name: educator,
                grade: '',
                is_zulu: false,
                totalHours: 0,
                assignments: [],
                dailyLoad: {},
                sessionLoad: {},
                bookings: {}
            };
        }

        const load = workloadMap[educator];
        load.totalHours += assignment.timeshift || 0;
        load.assignments.push(idx);

        // Daily load
        if (!load.dailyLoad[assignment.date]) {
            load.dailyLoad[assignment.date] = 0;
        }
        load.dailyLoad[assignment.date] += assignment.timeshift || 0;

        // Session load
        const sessionKey = `${assignment.date}_${assignment.session}`;
        if (!load.sessionLoad[sessionKey]) {
            load.sessionLoad[sessionKey] = 0;
        }
        load.sessionLoad[sessionKey] += assignment.timeshift || 0;

        // Bookings count
        if (!load.bookings[sessionKey]) {
            load.bookings[sessionKey] = 0;
        }
        load.bookings[sessionKey]++;
    });

    return workloadMap;
}

/**
 * Get workload for specific teacher
 * @param {string} teacherName - Teacher name
 * @param {Object} workloadMap - Workload map from buildWorkloadMap()
 * @returns {Object} Teacher workload object
 */
function getTeacherWorkload(teacherName, workloadMap) {
    return workloadMap[teacherName] || {
        name: teacherName,
        grade: '',
        is_zulu: false,
        totalHours: 0,
        assignments: [],
        dailyLoad: {},
        sessionLoad: {},
        bookings: {}
    };
}

/**
 * Calculate workload variance across teachers
 * @param {Object} workloadMap - Workload map
 * @returns {number} Variance (standard deviation)
 */
function calculateWorkloadVariance(workloadMap) {
    const hours = Object.values(workloadMap).map(w => w.totalHours);

    if (hours.length === 0) return 0;

    const mean = hours.reduce((a, b) => a + b, 0) / hours.length;
    const squaredDiffs = hours.map(h => Math.pow(h - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / hours.length;

    return Math.sqrt(variance); // Return standard deviation
}

/**
 * Find teacher with lowest workload
 * @param {Array} teachers - Array of teachers
 * @param {Object} workloadMap - Workload map
 * @returns {Object|null} Teacher with lowest hours, or null if no teachers
 */
function findLeastLoadedTeacher(teachers, workloadMap) {
    if (!teachers || teachers.length === 0) return null;

    let leastLoaded = null;
    let minHours = Infinity;

    teachers.forEach(teacher => {
        const workload = getTeacherWorkload(teacher.name, workloadMap);
        if (workload.totalHours < minHours) {
            minHours = workload.totalHours;
            leastLoaded = teacher;
        }
    });

    return leastLoaded;
}

// ============================================================================
// MODULE 4: ELIGIBILITY & FILTERING (6 functions)
// ============================================================================

/**
 * Check if teacher is eligible for a given assignment (hard constraints only)
 * @param {string} teacherName - Teacher name
 * @param {Object} assignment - Assignment object
 * @param {Array} assignments - Array of all assignments (for conflict check)
 * @param {Map} teacherIndex - Teacher index map
 * @param {Object} workloadMap - Workload map
 * @returns {boolean} True if teacher meets hard constraints
 */
function isTeacherEligible(teacherName, assignment, assignments, teacherIndex, workloadMap) {
    const teacher = teacherIndex.get(teacherName);
    if (!teacher) return false;

    // Hard Constraint 1: Check for double-booking
    if (isDoubleBooked(teacherName, assignment.date, assignment.session, assignments)) {
        return false;
    }

    // Hard Constraint 2: Check availability date range (if defined)
    if (teacher.availableFromDate || teacher.availableToDate) {
        const assignDate = new Date(assignment.date);
        if (teacher.availableFromDate) {
            const fromDate = new Date(teacher.availableFromDate);
            if (assignDate < fromDate) return false;
        }
        if (teacher.availableToDate) {
            const toDate = new Date(teacher.availableToDate);
            if (assignDate > toDate) return false;
        }
    }

    // Hard Constraint 3: Language requirement (if applicable)
    if (assignment.is_zulu && !teacher.is_zulu) {
        return false;
    }

    return true;
}

/**
 * Filter teachers to get those eligible for assignment
 * @param {Object} assignment - Assignment object
 * @param {Array} assignments - Array of all assignments
 * @param {Array} teachers - Array of teachers
 * @param {Map} teacherIndex - Teacher index map
 * @param {Object} workloadMap - Workload map
 * @returns {Array} Array of eligible teacher names
 */
function filterEligibleTeachers(assignment, assignments, teachers, teacherIndex, workloadMap) {
    return teachers
        .map(t => t.name)
        .filter(teacherName =>
            isTeacherEligible(teacherName, assignment, assignments, teacherIndex, workloadMap)
        );
}

/**
 * Filter teachers by grade match (soft constraint, for ranking)
 * @param {Object} assignment - Assignment object
 * @param {Array} teachers - Array of teachers
 * @returns {Array} Array of teacher names with matching grade
 */
function filterPreferredTeachers(assignment, teachers) {
    return teachers
        .filter(teacher => {
            const gradeMatch = String(teacher.registerClass) === String(assignment.grade) ||
                             teacher.registerClass === 'ROTATE';
            return gradeMatch;
        })
        .map(t => t.name);
}

/**
 * Get grade match percentage (0-100)
 * @param {Object} teacher - Teacher object
 * @param {Object} assignment - Assignment object
 * @returns {number} Match percentage
 */
function getTeacherGradeMatch(teacher, assignment) {
    const teacherGrade = String(teacher.registerClass);
    const assignmentGrade = String(assignment.grade);

    if (teacherGrade === assignmentGrade) {
        return 100; // Exact match
    } else if (teacherGrade === 'ROTATE') {
        return 50; // Flexible teacher
    } else {
        return 0; // No match
    }
}

/**
 * Build eligibility matrix (for analysis and debugging)
 * @param {Array} assignments - Array of assignments
 * @param {Array} teachers - Array of teachers
 * @param {Map} teacherIndex - Teacher index map
 * @param {Array} emptySlots - Indices of empty slots
 * @param {Object} workloadMap - Workload map
 * @returns {Array} Eligibility matrix
 */
function buildEligibilityMatrix(assignments, teachers, teacherIndex, emptySlots, workloadMap) {
    const matrix = [];

    emptySlots.forEach(slotIdx => {
        const assignment = assignments[slotIdx];
        const eligible = filterEligibleTeachers(assignment, assignments, teachers, teacherIndex, workloadMap);
        const preferred = filterPreferredTeachers(assignment, teachers);

        matrix.push({
            assignmentIdx: slotIdx,
            date: assignment.date,
            session: assignment.session,
            grade: assignment.grade,
            exam: assignment.exam,
            venue: assignment.venue,
            timeshift: assignment.timeshift,
            preferredTeachers: preferred,
            eligibleTeachers: eligible,
            eligibleCount: eligible.length
        });
    });

    return matrix;
}

// ============================================================================
// CONFIGURATION OBJECT
// ============================================================================

const schedulingConfig = {
    // Algorithm selection
    algorithm: 'greedy', // 'greedy' or 'backtracking'

    // Load balancing
    enableLoadBalancing: true,
    targetVariance: 0.3, // Allow 30% workload variance
    maxSwaps: 10,

    // Conflict resolution
    maxConflictIterations: 10,
    conflictStrategy: 'unassign', // 'unassign' or 'escalate'

    // Ranking weights (must sum to 1.0)
    weights: {
        gradeMatch: 0.40,
        workload: 0.40,
        language: 0.10,
        sessionLoad: 0.10
    },

    // Constraints
    maxHoursPerTeacher: 40,
    enforceGradeMatch: false,
    allowDoubleBooking: false,

    // Performance
    enableCaching: true,
    batchSize: 50,
    timeout: 30000, // 30 seconds

    // Logging
    logLevel: 'info', // 'info', 'debug', 'trace'
    captureTrace: true
};

// ============================================================================
// HELPER UTILITIES
// ============================================================================

/**
 * Sort assignments by difficulty (hardest first = fewest eligible teachers)
 * @param {Array} matrix - Eligibility matrix
 * @returns {Array} Sorted matrix indices (by difficulty descending)
 */
function sortByDifficulty(matrix) {
    return matrix
        .map((item, idx) => ({
            idx: item.assignmentIdx,
            difficulty: 10 - Math.min(item.eligibleCount, 10) / 10
        }))
        .sort((a, b) => b.difficulty - a.difficulty)
        .map(item => item.idx);
}

/**
 * Generate batch ID for tracking uploads
 * @returns {string} Unique batch ID
 */
function generateBatchId() {
    return 'batch_' + new Date().toISOString().replace(/[^\d]/g, '').substring(0, 14);
}

/**
 * Calculate assignment difficulty score
 * @param {Object} matrixItem - Item from eligibility matrix
 * @returns {number} Difficulty 1-10 (10 = hardest)
 */
function getAssignmentDifficulty(matrixItem) {
    const eligibleCount = matrixItem.eligibleCount || 1;
    return Math.max(1, Math.min(10, 10 - (eligibleCount / 2)));
}

/**
 * Log message with level
 * @param {string} message - Message to log
 * @param {string} level - 'info', 'debug', 'trace'
 * @param {string} context - Logging context
 */
function logMessage(message, level = 'info', context = '') {
    if (schedulingConfig.logLevel === 'info' && level === 'trace') return;
    if (schedulingConfig.logLevel === 'info' && level === 'debug') return;

    const timestamp = new Date().toISOString();
    const prefix = context ? `[${context}]` : '';
    console.log(`${timestamp} ${prefix} [${level.toUpperCase()}] ${message}`);
}

// ============================================================================
// EXPORT FUNCTIONS (for testing and usage)
// ============================================================================

// Module 1
window.validateAssignments = validateAssignments;
window.validateTeachers = validateTeachers;
window.identifyEmptySlots = identifyEmptySlots;
window.identifyPreassignedSlots = identifyPreassignedSlots;
window.normalizeDates = normalizeDates;
window.buildTeacherIndex = buildTeacherIndex;

// Module 2
window.isDoubleBooked = isDoubleBooked;
window.getTeacherScheduleOnDate = getTeacherScheduleOnDate;
window.getTeacherScheduleInSession = getTeacherScheduleInSession;
window.buildBookingMap = buildBookingMap;
window.validateConflictFree = validateConflictFree;

// Module 3
window.calculateTeacherHours = calculateTeacherHours;
window.buildWorkloadMap = buildWorkloadMap;
window.getTeacherWorkload = getTeacherWorkload;
window.calculateWorkloadVariance = calculateWorkloadVariance;
window.findLeastLoadedTeacher = findLeastLoadedTeacher;

// Module 4
window.isTeacherEligible = isTeacherEligible;
window.filterEligibleTeachers = filterEligibleTeachers;
window.filterPreferredTeachers = filterPreferredTeachers;
window.getTeacherGradeMatch = getTeacherGradeMatch;
window.buildEligibilityMatrix = buildEligibilityMatrix;

// Config & Utilities
window.schedulingConfig = schedulingConfig;
window.sortByDifficulty = sortByDifficulty;
window.generateBatchId = generateBatchId;
window.getAssignmentDifficulty = getAssignmentDifficulty;
window.logMessage = logMessage;

// ============================================================================
// TEST EXAMPLE
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        validateAssignments,
        validateTeachers,
        identifyEmptySlots,
        identifyPreassignedSlots,
        normalizeDates,
        buildTeacherIndex,
        isDoubleBooked,
        getTeacherScheduleOnDate,
        getTeacherScheduleInSession,
        buildBookingMap,
        validateConflictFree,
        calculateTeacherHours,
        buildWorkloadMap,
        getTeacherWorkload,
        calculateWorkloadVariance,
        findLeastLoadedTeacher,
        isTeacherEligible,
        filterEligibleTeachers,
        filterPreferredTeachers,
        getTeacherGradeMatch,
        buildEligibilityMatrix,
        schedulingConfig,
        sortByDifficulty,
        generateBatchId,
        getAssignmentDifficulty,
        logMessage
    };
}

/**
 * QUICK TEST EXAMPLE
 * Uncomment to test in browser console
 */
/*
// Sample data
const testAssignments = [
    { date: '2026-05-25', session: 1, grade: '12', exam: 'Accounting', venue: '1', timeshift: 2.5, educator: 'Smith' },
    { date: '2026-05-25', session: 1, grade: '12', exam: 'Economics', venue: '2', timeshift: 2.5, educator: null },
    { date: '2026-05-25', session: 2, grade: '10', exam: 'English', venue: '1', timeshift: 2.0, educator: null }
];

const testTeachers = [
    { name: 'Smith', registerClass: 'Grade 12', is_zulu: false },
    { name: 'Jones', registerClass: 'Grade 12', is_zulu: false },
    { name: 'Nkosi', registerClass: 'Grade 10', is_zulu: true }
];

// Test validation
console.log('Validation:', validateAssignments(testAssignments));
console.log('Teacher validation:', validateTeachers(testTeachers));

// Test identification
console.log('Empty slots:', identifyEmptySlots(testAssignments));
console.log('Preassigned slots:', identifyPreassignedSlots(testAssignments));

// Test workload
const normalized = normalizeDates(testAssignments);
const teacherIndex = buildTeacherIndex(testTeachers);
const workloadMap = buildWorkloadMap(normalized, testTeachers);
console.log('Workload map:', workloadMap);
console.log('Variance:', calculateWorkloadVariance(workloadMap));

// Test eligibility
const emptySlots = identifyEmptySlots(normalized);
const matrix = buildEligibilityMatrix(normalized, testTeachers, teacherIndex, emptySlots, workloadMap);
console.log('Eligibility matrix:', matrix);
*/
