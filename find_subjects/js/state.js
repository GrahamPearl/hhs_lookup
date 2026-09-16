/* ==========================================================================
 * state.js — Application State and Configuration
 * ==========================================================================
 * CLAUDE INSTRUCTIONS FOR EDITING:
 * - This file contains global state definitions, dropdown configuration, 
 *   and column schemas.
 * - When adding new features like column visibility toggles or view mode 
 *   switchers, extend the `COLUMNS` array (e.g., adding a `visible` property) 
 *   or add new properties to the `state` object below.
 * - Keep DOM manipulation and network requests out of this file.
 * ========================================================================== */

export const GRADE_FILES = {
  '10': '../find_subjects/Subjects-Grade10.json',
  '11': '../find_subjects/Subjects-Grade11.json',
  '12': '../find_subjects/Subjects-Grade12.json',
};

export const COLUMNS = [
  { key: 'grade', label: 'Grade', sortable: true, visible: true },
  { key: 'student_number', label: 'Student #', sortable: true, visible: true },
  { key: 'name', label: 'Name', sortable: true, visible: true },
  { key: 'gender', label: 'Gender', sortable: true, visible: true },
  { key: 'class', label: 'Class', sortable: true, visible: true },
  { key: 'subject', label: 'Subject', sortable: true, visible: true },
  { key: 'line', label: 'Line', sortable: true, visible: true },
  { key: 'teacher', label: 'Teacher', sortable: true, visible: true },
];

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 0]; // 0 = "All"

// Central reactive state object
export const state = {
  allData: [],           // Raw records loaded from grade JSON files
  subjectsAvailable: [], // Unique sorted subjects derived from data
  results: [],           // Search results before live filtering
  filtered: [],          // Final records after live filter & layout rules
  sort: { key: null, dir: 'asc' },
  page: 1,
  pageSize: 25,
  liveFilter: '',
  viewMode: 'table',     // Future-proofing: supports 'table', 'cards', or 'grouped'
};