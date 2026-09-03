const fs = require("fs");
const path = require("path");

const STUDENTS_FILE = "students.json";
const SUBJECTS_FILE = "Subjects-Grade12.json";
const OUTPUT_FILE = "subjects.json";
const REPORT_FILE = "subjects_validation_report.json";

let fatalErrors = 0;

function logError(message) {
    console.error(`ERROR: ${message}`);
    fatalErrors++;
}

function logWarning(message) {
    console.warn(`WARNING: ${message}`);
}

function fileExists(file) {
    return fs.existsSync(path.resolve(file));
}

function readJson(file) {
    try {
        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );
    } catch (err) {
        logError(`Unable to parse ${file}: ${err.message}`);
        process.exit(1);
    }
}

console.log("");
console.log("======================================");
console.log(" SUBJECT CONVERSION");
console.log("======================================");
console.log("");

//
// Validate files
//
if (!fileExists(STUDENTS_FILE)) {
    logError(`${STUDENTS_FILE} not found`);
    process.exit(1);
}

if (!fileExists(SUBJECTS_FILE)) {
    logError(`${SUBJECTS_FILE} not found`);
    process.exit(1);
}

//
// Load data
//
const students = readJson(STUDENTS_FILE);
const subjectRows = readJson(SUBJECTS_FILE);

if (!Array.isArray(students)) {
    logError("students.json must contain an array");
    process.exit(1);
}

if (!Array.isArray(subjectRows)) {
    logError("Subjects-Grade12.json must contain an array");
    process.exit(1);
}

console.log(`Loaded ${students.length} students`);
console.log(`Loaded ${subjectRows.length} subject records`);
console.log("");

//
// Build student lookup
//
const adminLookup = new Map();

const duplicateAdmins = [];
const missingExamNos = [];

students.forEach((student, index) => {

    const adminNo =
        String(
            student.adminNo ||
            student.ADMNO ||
            ""
        ).trim();

    const examNo =
        String(
            student.ExamNo ||
            student.examNo ||
            ""
        ).trim();

    if (!adminNo) {
        logWarning(
            `Student index ${index} has no adminNo`
        );
        return;
    }

    if (adminLookup.has(adminNo)) {
        duplicateAdmins.push(adminNo);
    }

    if (!examNo) {
        missingExamNos.push({
            adminNo,
            name:
                `${student.lastName || ""}, ${student.firstName || ""}`
        });
    }

    adminLookup.set(adminNo, student);
});

//
// Build subjects
//
const subjects = {};

const missingStudents = [];
const duplicateSubjectEntries = [];
const processedPairs = new Set();

subjectRows.forEach((row, index) => {

    const subject =
        String(row.subject || "")
            .trim();

    const studentNumber =
        String(row.student_number || "")
            .trim();

    if (!subject) {
        logWarning(
            `Row ${index}: missing subject`
        );
        return;
    }

    if (!studentNumber) {
        logWarning(
            `Row ${index}: missing student_number`
        );
        return;
    }

    const uniqueKey =
        `${subject}|${studentNumber}`;

    if (processedPairs.has(uniqueKey)) {
        duplicateSubjectEntries.push({
            subject,
            studentNumber
        });
        return;
    }

    processedPairs.add(uniqueKey);

    const student =
        adminLookup.get(studentNumber);

    if (!student) {
        missingStudents.push({
            subject,
            studentNumber
        });
        return;
    }

    const examNo =
        String(
            student.ExamNo ||
            student.examNo ||
            ""
        ).trim();

    if (!examNo) {
        missingExamNos.push({
            adminNo: studentNumber,
            subject
        });
        return;
    }

    if (!subjects[subject]) {
        subjects[subject] = [];
    }

    subjects[subject].push(examNo);
});

//
// Cleanup
//
Object.keys(subjects).forEach(subject => {

    const unique =
        [...new Set(subjects[subject])];

    unique.sort();

    subjects[subject] = unique;
});

//
// Write output
//
fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(subjects, null, 2)
);

//
// Build report
//
const report = {
    generated: new Date().toISOString(),
    statistics: {
        studentsLoaded:
            students.length,
        subjectRowsLoaded:
            subjectRows.length,
        subjectsGenerated:
            Object.keys(subjects).length
    },
    missingStudents,
    missingExamNos,
    duplicateAdmins,
    duplicateSubjectEntries
};

fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify(report, null, 2)
);

//
// Summary
//
console.log("");
console.log("======================================");
console.log(" SUMMARY");
console.log("======================================");
console.log("");

console.log(
    `Subjects generated : ${Object.keys(subjects).length}`
);

console.log(
    `Missing students   : ${missingStudents.length}`
);

console.log(
    `Missing ExamNos    : ${missingExamNos.length}`
);

console.log(
    `Duplicate AdminNos : ${duplicateAdmins.length}`
);

console.log(
    `Duplicate Entries  : ${duplicateSubjectEntries.length}`
);

console.log("");
console.log(`Created: ${OUTPUT_FILE}`);
console.log(`Created: ${REPORT_FILE}`);
console.log("");

//
// Detailed warnings
//
if (missingStudents.length > 0) {

    console.log("Students referenced by subjects but not found:");
    console.log("");

    missingStudents
        .slice(0, 25)
        .forEach(s => {
            console.log(
                `  ${s.studentNumber} -> ${s.subject}`
            );
        });

    console.log("");
}

if (missingExamNos.length > 0) {

    console.log("Students missing ExamNo:");
    console.log("");

    missingExamNos
        .slice(0, 25)
        .forEach(s => {
            console.log(
                `  ${s.adminNo || "UNKNOWN"}`
            );
        });

    console.log("");
}

if (
    missingStudents.length > 0 ||
    missingExamNos.length > 0
) {
    console.log(
        "Validation completed with warnings."
    );
} else {
    console.log(
        "Validation completed successfully."
    );
}

process.exit(fatalErrors > 0 ? 1 : 0);