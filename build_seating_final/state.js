/* state.js
   All mutable application state and cached jQuery DOM references, shared
   across every other seating-plan module via `Seating.state` / `Seating.dom`.
   Load after namespace.js; before any module that reads/writes state or dom.

   Every other module reaches this through the shared `Seating` object
   (e.g. `Seating.state.rows`, `Seating.dom.$subject`) rather than capturing
   local variables, so mutations made in one file are immediately visible to
   every other file — this is what stands in for module-scoped shared state
   without an ES-module bundler. */
(function (S) {
  'use strict';

  S.state = {
    internalAll: [],        // normalized candidate objects, all Grade 12 internal
    externalAll: [],        // normalized candidate objects, all Grade 12 external
    subjectNames: [],       // ordered list of subject names, from list_of_subjects.txt (dropdown source)
    subjectsData: {},       // normalized subject key -> Set of student_number/adminNo strings, from Subjects-Grade12.json

    internalFiltered: [],   // internalAll filtered by subject + concession filter
    externalFiltered: [],   // externalAll filtered by subject + concession filter
    selectedInternalIds: new Set(), // adminNo strings currently ticked (internal)
    selectedExternalIds: new Set(), // adminNo strings currently ticked (external)

    rows: 6, cols: 8,        // rows = desks per row, cols = number of rows of desks
    seats: [],                // flat array, length rows*cols: {row, col, student|null}
    unassigned: [],           // candidates not yet placed (mix of internal/external)
    selectedPoolId: null      // currently selected adminNo in the unassigned pool
  };

  S.dom = {
    $subject: $('#subjectSelect'),
    $concessionFilter: $('#concessionFilter'),
    $examTitle: $('#examTitle'),
    $subjectConfirm: $('#subjectConfirm'),
    $internalTbody: $('#internalCandidateTable tbody'),
    $externalTbody: $('#externalCandidateTable tbody'),
    $internalCountBadge: $('#internalCountBadge'),
    $externalCountBadge: $('#externalCountBadge'),
    $rowsInput: $('#rowsInput'),
    $colsInput: $('#colsInput'),
    $planMessage: $('#planMessage'),
    $seatGrid: $('#seatGrid'),
    $unassignedPool: $('#unassignedPool'),
    $exportMessage: $('#exportMessage'),
    $imagePreviewWrap: $('#imagePreviewWrap'),
    $imagePreviewPages: $('#imagePreviewPages'),
    $downloadImgBtn: $('#downloadImgBtn'),
    $downloadSingleImgBtn: $('#downloadSingleImgBtn'),
    $printImgBtn: $('#printImgBtn'),
    $cloudPlanList: $('#cloudPlanList')
  };
})(window.Seating);
