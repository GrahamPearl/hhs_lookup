/* config.js
   Static configuration: data-file locations, Firebase project credentials,
   and small numeric constants used by more than one module. Nothing in here
   depends on any other seating-plan module, so it's safe to load right after
   namespace.js. */
(function (S) {
  'use strict';

  S.config = {
    // ===== Data sources =====
    STUDENTS_JSON_FILE: "students.json",           // internal Grade 12 candidates
    EXTERNAL_JSON_FILE: "external.json",            // external Grade 12 candidates
    LIST_OF_SUBJECTS_FILE: "list_of_subjects.txt",   // plain text, one subject name per line -> drives the dropdown
    SUBJECT_ROSTER_FILE: "Subjects-Grade12.json",    // per-subject roster records: { student_number, subject, ... } -> drives which candidates match a subject

    // =========================================================
    // FIREBASE CONFIG — replace with your own project's values.
    // Leave as-is to run the page in "local only" mode: JSON
    // save/load and image export still work without Firebase.
    // =========================================================
    firebaseConfig: {
      apiKey: "YOUR_API_KEY",
      authDomain: "YOUR_PROJECT.firebaseapp.com",
      projectId: "YOUR_PROJECT_ID",
      storageBucket: "YOUR_PROJECT.appspot.com",
      messagingSenderId: "YOUR_SENDER_ID",
      appId: "YOUR_APP_ID"
    },
    SEATING_COLLECTION: "seatingPlans",

    // ===== Misc constants =====
    COLUMNS_PER_IMAGE: 5   // desks-per-row columns included in each exported page image
  };
})(window.Seating);
