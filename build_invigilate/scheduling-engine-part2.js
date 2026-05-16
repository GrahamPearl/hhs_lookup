/**
 * EXAM SCHEDULING ENGINE - PART 2
 * Modules 5-8: Ranking, Operations, Main Algorithm, Validation & Reporting
 * 
 * REQUIRES: scheduling-engine-part1.js to be loaded first
 * Status: Completes the scheduling system with main algorithm
 */

// ============================================================================
// MODULE 5: RANKING & SELECTION (4 functions)
// ============================================================================

/**
 * Calculate ranking score for teacher assigned to slot
 * Factors: grade match, workload, language, session load
 * @param {string} teacherName - Teacher name
 * @param {Object} assignment - Assignment object
 * @param {Object} workloadMap - Workload map
 * @param {Map} teacherIndex - Teacher index
 * @returns {number} Score 0-100 (higher = better fit)
 */

/**  Add these helpers to bridge the gap between Part 1 and Part 2
 const schedulingConfig = {
    weights: { gradeMatch: 0.40, workload: 0.40, language: 0.10, sessionLoad: 0.10 }
};
*/

function getTeacherWorkload(teacherName, workloadMap) {
    return workloadMap[teacherName] || { totalHours: 0, bookings: {} };
}

function getTeacherGradeMatch(teacher, assignment) {
    // If teacher is assigned to "Grade 12" and exam is "Grade 12", score 100
    if (teacher.registerClass === assignment.grade) return 100;
    if (teacher.registerClass === 'ROTATE') return 50; // Flexible
    return 0;
}

function filterPreferredTeachers(assignment, teachers) {
    return teachers
        .filter(t => t.registerClass === assignment.grade)
        .map(t => t.name);
}

function filterEligibleTeachers(assignment, assignments, teachers, teacherIndex, workloadMap) {
    // Basic eligibility: Not double-booked and under max hours
    return teachers
        .map(t => t.name)
        .filter(name => !isDoubleBooked(name, assignment.date, assignment.session, assignments));
}


function rankTeacherForSlot(teacherName, assignment, workloadMap, teacherIndex) {
    const teacher = teacherIndex.get(teacherName);
    if (!teacher) return 0;

    const workload = getTeacherWorkload(teacherName, workloadMap);
    
    // Factor 1: Grade Match (weight 40%)
    const gradeMatch = getTeacherGradeMatch(teacher, assignment);
    const gradeFactor = (gradeMatch / 100) * 100;

    // Factor 2: Workload (weight 40%)
    // Lower hours = higher score
    const avgHours = Object.values(workloadMap)
        .reduce((sum, w) => sum + w.totalHours, 0) / Object.keys(workloadMap).length || 0;
    const normalizedHours = Math.max(0, avgHours > 0 ? 100 - (workload.totalHours / avgHours * 50) : 100);
    const workloadFactor = Math.max(0, Math.min(100, normalizedHours));

    // Factor 3: Language Match (weight 10%)
    const languageFactor = (assignment.is_zulu && teacher.is_zulu) ? 10 : 0;

    // Factor 4: Session Load (weight 10%)
    // Already scheduled in this session = penalty
    const sessionKey = `${assignment.date}_${assignment.session}`;
    const isInSession = workload.bookings[sessionKey] ? true : false;
    const sessionFactor = !isInSession ? 10 : 0;

    // Calculate weighted score
    const score = 
        (gradeFactor * schedulingConfig.weights.gradeMatch) +
        (workloadFactor * schedulingConfig.weights.workload) +
        (languageFactor * schedulingConfig.weights.language) +
        (sessionFactor * schedulingConfig.weights.sessionLoad);

    return Math.round(score);
}

/**
 * Sort candidate teachers by ranking score
 * @param {Array} candidateTeachers - Array of teacher names
 * @param {Object} assignment - Assignment object
 * @param {Object} workloadMap - Workload map
 * @param {Map} teacherIndex - Teacher index
 * @returns {Array} Sorted teacher names [best -> worst]
 */
function sortTeachersByRank(candidateTeachers, assignment, workloadMap, teacherIndex) {
    const scored = candidateTeachers.map(name => ({
        name: name,
        score: rankTeacherForSlot(name, assignment, workloadMap, teacherIndex)
    }));

    return scored
        .sort((a, b) => b.score - a.score)
        .map(item => item.name);
}

/**
 * Select best teacher for assignment (ranked by tiers)
 * Tier 1: Grade-matched + lowest workload
 * Tier 2: ROTATE teachers + lowest workload
 * Tier 3: Any eligible + lowest workload
 * @param {Object} assignment - Assignment object
 * @param {Array} assignments - All assignments
 * @param {Array} teachers - Array of teachers
 * @param {Object} workloadMap - Workload map
 * @param {Map} teacherIndex - Teacher index
 * @returns {string|null} Best teacher name or null
 */
function selectBestTeacher(assignment, assignments, teachers, workloadMap, teacherIndex) {
    const eligible = filterEligibleTeachers(assignment, assignments, teachers, teacherIndex, workloadMap);
    
    if (eligible.length === 0) return null;

    // Tier 1: Grade-matched teachers
    const preferred = filterPreferredTeachers(assignment, teachers);
    const tier1 = eligible.filter(name => preferred.includes(name));

    if (tier1.length > 0) {
        const sorted = sortTeachersByRank(tier1, assignment, workloadMap, teacherIndex);
        return sorted[0];
    }

    // Tier 2: ROTATE teachers
    const tier2 = eligible.filter(name => {
        const teacher = teacherIndex.get(name);
        return teacher && teacher.registerClass === 'ROTATE';
    });

    if (tier2.length > 0) {
        const sorted = sortTeachersByRank(tier2, assignment, workloadMap, teacherIndex);
        return sorted[0];
    }

    // Tier 3: Any eligible
    const sorted = sortTeachersByRank(eligible, assignment, workloadMap, teacherIndex);
    return sorted[0];
}

/**
 * Get top N ranked teachers for assignment
 * @param {Object} assignment - Assignment object
 * @param {Array} assignments - All assignments
 * @param {Array} teachers - Array of teachers
 * @param {Object} workloadMap - Workload map
 * @param {Map} teacherIndex - Teacher index
 * @param {number} count - Number of top candidates to return
 * @returns {Array} Top N teacher names sorted by rank
 */
function getTopCandidates(assignment, assignments, teachers, workloadMap, teacherIndex, count = 5) {
    const eligible = filterEligibleTeachers(assignment, assignments, teachers, teacherIndex, workloadMap);
    const sorted = sortTeachersByRank(eligible, assignment, workloadMap, teacherIndex);
    return sorted.slice(0, count);
}

// ============================================================================
// MODULE 6: ASSIGNMENT OPERATIONS (4 functions)
// ============================================================================

/**
 * Assign teacher to assignment slot and update workload
 * @param {number} assignmentIdx - Index in assignments array
 * @param {string} teacherName - Teacher name to assign
 * @param {Array} assignments - Array of assignments (modified in place)
 * @param {Object} workloadMap - Workload map (modified in place)
 * @returns {boolean} Success
 */
function assignTeacherToSlot(assignmentIdx, teacherName, assignments, workloadMap) {
    const assignment = assignments[assignmentIdx];
    
    if (!assignment) {
        logMessage(`Assignment index ${assignmentIdx} not found`, 'warn', 'assignTeacher');
        return false;
    }

    // Update assignment
    assignment.educator = teacherName;

    // Update workload
    if (!workloadMap[teacherName]) {
        workloadMap[teacherName] = {
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

    const workload = workloadMap[teacherName];
    workload.totalHours += assignment.timeshift || 0;
    workload.assignments.push(assignmentIdx);

    // Daily load
    if (!workload.dailyLoad[assignment.date]) {
        workload.dailyLoad[assignment.date] = 0;
    }
    workload.dailyLoad[assignment.date] += assignment.timeshift || 0;

    // Session load
    const sessionKey = `${assignment.date}_${assignment.session}`;
    if (!workload.sessionLoad[sessionKey]) {
        workload.sessionLoad[sessionKey] = 0;
    }
    workload.sessionLoad[sessionKey] += assignment.timeshift || 0;

    // Bookings
    if (!workload.bookings[sessionKey]) {
        workload.bookings[sessionKey] = 0;
    }
    workload.bookings[sessionKey]++;

    return true;
}

/**
 * Unassign teacher from slot and update workload
 * @param {number} assignmentIdx - Index in assignments array
 * @param {Array} assignments - Array of assignments
 * @param {Object} workloadMap - Workload map
 * @returns {boolean} Success
 */
function unassignTeacher(assignmentIdx, assignments, workloadMap) {
    const assignment = assignments[assignmentIdx];
    
    if (!assignment || !assignment.educator) return false;

    const educatorName = assignment.educator;
    const workload = workloadMap[educatorName];

    if (!workload) return false;

    // Update workload
    workload.totalHours -= assignment.timeshift || 0;
    workload.assignments = workload.assignments.filter(idx => idx !== assignmentIdx);

    // Daily load
    if (workload.dailyLoad[assignment.date]) {
        workload.dailyLoad[assignment.date] -= assignment.timeshift || 0;
    }

    // Session load
    const sessionKey = `${assignment.date}_${assignment.session}`;
    if (workload.sessionLoad[sessionKey]) {
        workload.sessionLoad[sessionKey] -= assignment.timeshift || 0;
    }

    // Bookings
    if (workload.bookings[sessionKey]) {
        workload.bookings[sessionKey]--;
    }

    // Clear assignment
    assignment.educator = null;

    return true;
}

/**
 * Swap educator between two slots
 * @param {number} idx1 - First assignment index
 * @param {number} idx2 - Second assignment index
 * @param {Array} assignments - Array of assignments
 * @returns {boolean} Success
 */
function swapAssignments(idx1, idx2, assignments) {
    if (!assignments[idx1] || !assignments[idx2]) return false;

    const temp = assignments[idx1].educator;
    assignments[idx1].educator = assignments[idx2].educator;
    assignments[idx2].educator = temp;

    return true;
}

/**
 * Record assignment history entry
 * @param {Object} entry - History entry with action, timestamp, details
 * @param {Array} history - History array
 */
function recordHistory(entry, history) {
    history.push({
        timestamp: new Date().toISOString(),
        ...entry
    });
}

// ============================================================================
// MODULE 7: MAIN SCHEDULING ALGORITHM
// ============================================================================

/**
 * Main scheduling function - assigns teachers to unassigned slots
 * @param {Array} assignments - Array of assignment objects
 * @param {Array} teachers - Array of teacher objects
 * @param {Object} options - Configuration options (optional)
 * @returns {Object} {assignments, statistics, report, warnings, log}
 */
function scheduleAssignments(assignments, teachers, options = {}) {
    const startTime = Date.now();
    const config = { ...schedulingConfig, ...options };
    const log = [];
    const history = [];

    logMessage('Starting scheduling algorithm', 'info', 'schedule');
    logMessage(`Input: ${assignments.length} assignments, ${teachers.length} teachers`, 'info', 'schedule');

    try {
        // ===== SETUP & VALIDATION =====
        logMessage('Validating inputs', 'debug', 'schedule');
        
        const assignValidation = validateAssignments(assignments);
        if (!assignValidation.isValid) {
            logMessage(`Invalid assignments: ${assignValidation.errors[0]}`, 'error', 'schedule');
            return {
                assignments: assignments,
                statistics: {},
                report: `Invalid input: ${assignValidation.errors[0]}`,
                warnings: [],
                log: log,
                status: 'failed'
            };
        }

        const teachValidation = validateTeachers(teachers);
        if (!teachValidation.isValid) {
            logMessage(`Invalid teachers: ${teachValidation.errors[0]}`, 'error', 'schedule');
            return {
                assignments: assignments,
                statistics: {},
                report: `Invalid input: ${teachValidation.errors[0]}`,
                warnings: [],
                log: log,
                status: 'failed'
            };
        }

        // Deep copy to avoid mutating input
        const assignmentsCopy = JSON.parse(JSON.stringify(assignments));
        const teachersCopy = JSON.parse(JSON.stringify(teachers));

        // Normalize dates and build indices
        const normalized = normalizeDates(assignmentsCopy);
        const teacherIndex = buildTeacherIndex(teachersCopy);
        const preassignedSlots = identifyPreassignedSlots(normalized);
        const emptySlots = identifyEmptySlots(normalized);

        logMessage(`Found ${preassignedSlots.length} pre-assigned, ${emptySlots.length} empty slots`, 'info', 'schedule');

        if (emptySlots.length === 0) {
            logMessage('All slots already assigned', 'info', 'schedule');
            return {
                assignments: normalized,
                statistics: generateStatistics(normalized, teachersCopy),
                report: 'All slots already assigned',
                warnings: [],
                log: log,
                status: 'success'
            };
        }

        // Build workload and eligibility
        let workloadMap = buildWorkloadMap(normalized, teachersCopy);
        const matrix = buildEligibilityMatrix(normalized, teachersCopy, teacherIndex, emptySlots, workloadMap);

        logMessage('Built eligibility matrix', 'debug', 'schedule');

        // Sort by difficulty (hardest first)
        const sortedSlots = sortByDifficulty(matrix);

        logMessage(`Processing ${sortedSlots.length} slots in difficulty order`, 'debug', 'schedule');

        // ===== MAIN ASSIGNMENT LOOP =====
        let assignedCount = 0;
        const unresolvableSlots = [];
        const conflictLog = [];

        for (const slotIdx of sortedSlots) {
            const assignment = normalized[slotIdx];

            // Skip already assigned
            if (assignment.educator) continue;

            logMessage(`Processing slot ${slotIdx}: ${assignment.date} session ${assignment.session} (${assignment.exam})`, 'trace', 'schedule');

            // Check feasibility
            const eligible = filterEligibleTeachers(assignment, normalized, teachersCopy, teacherIndex, workloadMap);

            if (eligible.length === 0) {
                logMessage(`No eligible teachers for slot ${slotIdx}`, 'warn', 'schedule');
                unresolvableSlots.push({
                    index: slotIdx,
                    assignment: assignment,
                    reason: 'No eligible teachers available'
                });
                continue;
            }

            // Select best teacher
            const bestTeacher = selectBestTeacher(assignment, normalized, teachersCopy, workloadMap, teacherIndex);

            if (!bestTeacher) {
                unresolvableSlots.push({
                    index: slotIdx,
                    assignment: assignment,
                    reason: 'Could not select best teacher'
                });
                continue;
            }

            // Assign teacher
            assignTeacherToSlot(slotIdx, bestTeacher, normalized, workloadMap);
            assignedCount++;

            logMessage(`Assigned ${bestTeacher} to slot ${slotIdx}`, 'debug', 'schedule');

            recordHistory({
                action: 'assign',
                slotIdx: slotIdx,
                educator: bestTeacher,
                reason: 'Initial assignment'
            }, history);
        }

        logMessage(`Assigned ${assignedCount} of ${emptySlots.length} slots`, 'info', 'schedule');

        // ===== CONFLICT RESOLUTION =====
        logMessage('Checking for conflicts', 'debug', 'schedule');

        const conflictCheck = validateConflictFree(normalized);
        let conflictIterations = 0;

        while (conflictCheck.hasConflicts && conflictIterations < config.maxConflictIterations) {
            conflictIterations++;
            logMessage(`Conflict resolution iteration ${conflictIterations}`, 'debug', 'schedule');

            for (const conflict of conflictCheck.conflicts) {
                // Find and resolve conflict
                const [date, session] = conflict.dateSession.split('_');
                const conflictSlots = normalized
                    .map((a, idx) => ({ idx, a }))
                    .filter(item => 
                        item.a.educator === conflict.educator &&
                        item.a.date === date &&
                        item.a.session === parseInt(session)
                    );

                if (conflictSlots.length > 1) {
                    // Keep the one with higher timeshift, unassign others
                    const sorted = conflictSlots.sort((a, b) => b.a.timeshift - a.a.timeshift);
                    
                    for (let i = 1; i < sorted.length; i++) {
                        const slotIdx = sorted[i].idx;
                        unassignTeacher(slotIdx, normalized, workloadMap);

                        // Try to reassign
                        const best = selectBestTeacher(
                            normalized[slotIdx],
                            normalized,
                            teachersCopy,
                            workloadMap,
                            teacherIndex
                        );

                        if (best) {
                            assignTeacherToSlot(slotIdx, best, normalized, workloadMap);
                            logMessage(`Resolved conflict by reassigning slot ${slotIdx}`, 'debug', 'schedule');
                        } else {
                            unresolvableSlots.push({
                                index: slotIdx,
                                assignment: normalized[slotIdx],
                                reason: 'Conflict resolution - no alternative'
                            });
                        }
                    }
                }
            }

            // Recheck
            const newConflictCheck = validateConflictFree(normalized);
            if (!newConflictCheck.hasConflicts) break;
        }

        // ===== LOAD BALANCING (Optional) =====
        if (config.enableLoadBalancing) {
            logMessage('Optimizing workload distribution', 'debug', 'schedule');

            const variance = calculateWorkloadVariance(workloadMap);
            const mean = Object.values(workloadMap).reduce((sum, w) => sum + w.totalHours, 0) / 
                        Object.keys(workloadMap).length;
            const threshold = mean * config.targetVariance;

            logMessage(`Variance: ${variance.toFixed(2)}, Threshold: ${threshold.toFixed(2)}`, 'debug', 'schedule');

            if (variance > threshold) {
                // Attempt swaps to improve balance
                let swapCount = 0;
                const maxSwaps = Math.floor(emptySlots.length / 10);

                for (let i = 0; i < normalized.length && swapCount < maxSwaps; i++) {
                    const assignment = normalized[i];
                    if (!assignment.educator) continue;

                    const workload = getTeacherWorkload(assignment.educator, workloadMap);
                    if (workload.totalHours <= mean) continue; // Over-loaded only

                    // Try to find swap with under-loaded teacher
                    for (let j = 0; j < normalized.length && swapCount < maxSwaps; j++) {
                        const other = normalized[j];
                        if (!other.educator) continue;

                        const otherWorkload = getTeacherWorkload(other.educator, workloadMap);
                        if (otherWorkload.totalHours >= mean) continue; // Under-loaded only

                        // Check if swap is feasible
                        if (isTeacherEligible(other.educator, assignment, normalized, teacherIndex, workloadMap) &&
                            isTeacherEligible(assignment.educator, other, normalized, teacherIndex, workloadMap)) {
                            
                            swapAssignments(i, j, normalized);
                            swapCount++;
                            logMessage(`Swapped assignments at indices ${i} and ${j}`, 'debug', 'schedule');
                        }
                    }
                }
            }
        }

        // ===== GENERATE REPORT =====
        const endTime = Date.now();
        const duration = endTime - startTime;

        logMessage('Scheduling complete', 'info', 'schedule');

        return {
            assignments: normalized,
            statistics: generateStatistics(normalized, teachersCopy),
            teacherStats: generateTeacherStats(normalized, workloadMap),
            report: {
                summary: `Successfully scheduled ${assignedCount} of ${emptySlots.length} slots (${Math.round(assignedCount/emptySlots.length*100)}%)`,
                totalSlots: normalized.length,
                assignedSlots: normalized.filter(a => a.educator).length,
                unassignedSlots: unresolvableSlots.length,
                duration: `${(duration/1000).toFixed(2)}s`,
                conflicts: conflictCheck.conflicts.length,
                conflictIterations: conflictIterations,
                unresolvable: unresolvableSlots
            },
            warnings: generateWarnings(normalized, workloadMap),
            log: log,
            history: history,
            status: unresolvableSlots.length === 0 ? 'success' : 'partial'
        };

    } catch (error) {
        logMessage(`Error: ${error.message}`, 'error', 'schedule');
        return {
            assignments: assignments,
            statistics: {},
            report: `Error: ${error.message}`,
            warnings: [],
            log: log,
            status: 'failed',
            error: error
        };
    }
}

// ============================================================================
// MODULE 8: VALIDATION & REPORTING (5 functions)
// ============================================================================

/**
 * Validate final schedule
 * @param {Array} assignments - Final assignments
 * @returns {Object} {isValid, violations}
 */
function validateSchedule(assignments) {
    const violations = [];

    // Check no double-bookings
    const conflict = validateConflictFree(assignments);
    if (conflict.hasConflicts) {
        violations.push({
            type: 'double_booking',
            details: conflict.conflicts
        });
    }

    // Validate all educator names are valid
    const invalidEducators = assignments.filter(a => 
        a.educator && typeof a.educator !== 'string'
    );
    if (invalidEducators.length > 0) {
        violations.push({
            type: 'invalid_educator',
            count: invalidEducators.length
        });
    }

    return {
        isValid: violations.length === 0,
        violations: violations
    };
}

/**
 * Generate schedule statistics
 * @param {Array} assignments - Assignments
 * @param {Array} teachers - Teachers
 * @returns {Object} Statistics object
 */
function generateStatistics(assignments, teachers) {
    const assigned = assignments.filter(a => a.educator).length;
    const assignedTeachers = new Set(assignments.filter(a => a.educator).map(a => a.educator));

    return {
        totalSlots: assignments.length,
        assignedSlots: assigned,
        unassignedSlots: assignments.length - assigned,
        assignmentPercentage: Math.round((assigned / assignments.length) * 100),
        totalTeachers: teachers.length,
        assignedTeachers: assignedTeachers.size,
        gradeDistribution: groupByGrade(assignments),
        sessionDistribution: groupBySession(assignments)
    };
}

/**
 * Generate per-teacher statistics
 * @param {Array} assignments - Assignments
 * @param {Object} workloadMap - Workload map
 * @returns {Object} Per-teacher stats
 */
function generateTeacherStats(assignments, workloadMap) {
    const stats = {};

    for (const [teacherName, workload] of Object.entries(workloadMap)) {
        if (workload.totalHours === 0) continue; // Skip unassigned teachers

        const teacherAssignments = assignments.filter(a => a.educator === teacherName);
        const dates = new Set(teacherAssignments.map(a => a.date));
        const grades = new Set(teacherAssignments.map(a => a.grade));

        stats[teacherName] = {
            totalHours: workload.totalHours,
            slotCount: teacherAssignments.length,
            datesScheduled: Array.from(dates).sort(),
            gradesAssigned: Array.from(grades),
            sessionCount: Object.values(workload.bookings).reduce((a, b) => a + b, 0),
            averageSessionLoad: (workload.totalHours / Object.keys(workload.bookings).length).toFixed(1)
        };
    }

    return stats;
}

/**
 * Generate warnings about schedule quality
 * @param {Array} assignments - Assignments
 * @param {Object} workloadMap - Workload map
 * @returns {Array} Warnings array
 */
function generateWarnings(assignments, workloadMap) {
    const warnings = [];

    // Check for overloaded teachers
    const avgHours = Object.values(workloadMap).reduce((sum, w) => sum + w.totalHours, 0) / 
                    Object.keys(workloadMap).length || 0;

    for (const [name, workload] of Object.entries(workloadMap)) {
        if (workload.totalHours > 35) {
            warnings.push({
                type: 'overloaded',
                teacher: name,
                hours: workload.totalHours,
                message: `${name} assigned ${workload.totalHours} hours (above recommendation of 30)`
            });
        }
    }

    // Check for unassigned slots
    const unassigned = assignments.filter(a => !a.educator);
    if (unassigned.length > 0) {
        warnings.push({
            type: 'unassigned_slots',
            count: unassigned.length,
            message: `${unassigned.length} slots remain unassigned`
        });
    }

    // Check workload variance
    const variance = calculateWorkloadVariance(workloadMap);
    if (variance > avgHours * 0.4) {
        warnings.push({
            type: 'high_workload_variance',
            variance: variance.toFixed(2),
            message: `Workload variance is ${variance.toFixed(2)} (high disparity in teacher assignments)`
        });
    }

    return warnings;
}

/**
 * Helper: Group assignments by grade
 * @param {Array} assignments - Assignments
 * @returns {Object} Count by grade
 */
function groupByGrade(assignments) {
    const groups = {};
    assignments.forEach(a => {
        groups[a.grade] = (groups[a.grade] || 0) + 1;
    });
    return groups;
}

/**
 * Helper: Group assignments by session
 * @param {Array} assignments - Assignments
 * @returns {Object} Count by session
 */
function groupBySession(assignments) {
    const groups = {};
    assignments.forEach(a => {
        groups[a.session] = (groups[a.session] || 0) + 1;
    });
    return groups;
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

// Module 5
window.rankTeacherForSlot = rankTeacherForSlot;
window.sortTeachersByRank = sortTeachersByRank;
window.selectBestTeacher = selectBestTeacher;
window.getTopCandidates = getTopCandidates;

// Module 6
window.assignTeacherToSlot = assignTeacherToSlot;
window.unassignTeacher = unassignTeacher;
window.swapAssignments = swapAssignments;
window.recordHistory = recordHistory;

// Module 7
window.scheduleAssignments = scheduleAssignments;

// Module 8
window.validateSchedule = validateSchedule;
window.generateStatistics = generateStatistics;
window.generateTeacherStats = generateTeacherStats;
window.generateWarnings = generateWarnings;

// Helpers
window.groupByGrade = groupByGrade;
window.groupBySession = groupBySession;

// ============================================================================
// NODE.JS EXPORT FOR TESTING
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        rankTeacherForSlot,
        sortTeachersByRank,
        selectBestTeacher,
        getTopCandidates,
        assignTeacherToSlot,
        unassignTeacher,
        swapAssignments,
        recordHistory,
        scheduleAssignments,
        validateSchedule,
        generateStatistics,
        generateTeacherStats,
        generateWarnings,
        groupByGrade,
        groupBySession
    };
}

/**
 * USAGE EXAMPLE
 * 
 * // Load both scripts first:
 * // <script src="scheduling-engine-part1.js"></script>
 * // <script src="scheduling-engine-part2.js"></script>
 * 
 * // Sample data
 * const assignments = [
 *     { date: '2026-05-25', session: 1, grade: '12', exam: 'Accounting', venue: '1', timeshift: 2.5, educator: null },
 *     { date: '2026-05-25', session: 1, grade: '12', exam: 'Economics', venue: '2', timeshift: 2.5, educator: null },
 *     { date: '2026-05-25', session: 2, grade: '10', exam: 'English', venue: '1', timeshift: 2.0, educator: null }
 * ];
 * 
 * const teachers = [
 *     { name: 'Smith', registerClass: 'Grade 12', is_zulu: false },
 *     { name: 'Jones', registerClass: 'Grade 12', is_zulu: false },
 *     { name: 'Nkosi', registerClass: 'Grade 10', is_zulu: true }
 * ];
 * 
 * // Run scheduling
 * const result = scheduleAssignments(assignments, teachers);
 * 
 * console.log('Result:', result);
 * console.log('Statistics:', result.statistics);
 * console.log('Warnings:', result.warnings);
 */
