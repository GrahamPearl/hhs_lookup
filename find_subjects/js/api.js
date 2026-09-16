/* ==========================================================================
 * api.js — Data Fetching, Tagging, and URL State Management
 * ==========================================================================
 * CLAUDE INSTRUCTIONS FOR EDITING:
 * - This file handles asynchronous JSON loading from grade files and synchronizes
 *   search and filter parameters with the browser's URL query string.
 * - Do not place rendering or event-listener code here; keep it strictly 
 *   focused on data ingestion and URL router state.
 * ========================================================================== */

import { state, GRADE_FILES } from './state.js';

/**
 * Fetches and flattens student records across all configured grade files,
 * automatically tagging each record with its respective grade[cite: 3].
 */
export async function loadAllStudentData() {
  const grades = Object.keys(GRADE_FILES);
  const payloads = await Promise.all(
    grades.map((g) => fetchJson(GRADE_FILES[g]).then((rows) => tagGrade(rows, g)))
  );
  return payloads.flat();
}

function tagGrade(rows, grade) {
  return (Array.isArray(rows) ? rows : []).map((r) => Object.assign({}, r, { grade }));
}

export function fetchJson(url) {
  return fetch(url, { cache: 'no-store' }).then((resp) => {
    if (!resp.ok) throw new Error(`${url} (${resp.status})`);
    return resp.json();
  });
}

/**
 * Synchronizes current search inputs, filters, sort orders, and view modes to the URL[cite: 3].
 * @param {Object} formElements - DOM element references for search inputs
 */
export function syncURL(formElements) {
  const p = new URLSearchParams();
  const { field, grade, subject, line, query } = formElements;
  
  if (field.value !== 'auto') p.set('field', field.value);
  if (grade.value) p.set('grade', grade.value);
  if (subject.value) p.set('subject', subject.value);
  if (line.value) p.set('line', line.value);
  if (query.value) p.set('q', query.value);
  if (state.liveFilter) p.set('filter', state.liveFilter);
  if (state.sort.key) { p.set('sort', state.sort.key); p.set('dir', state.sort.dir); }
  if (state.pageSize !== 25) p.set('pageSize', String(state.pageSize));
  if (state.page > 1) p.set('page', String(state.page));
  if (state.viewMode !== 'table') p.set('view', state.viewMode);

  const qs = p.toString();
  history.replaceState({}, '', qs ? `?${qs}` : location.pathname);
}

/**
 * Restores filter state and pagination values from URL query parameters on load[cite: 3].
 * @param {Object} formElements - DOM element references for search inputs
 */
export function restoreFromURL(formElements) {
  const p = new URLSearchParams(location.search);
  const { field, grade, subject, line, query, liveFilter, pageSize } = formElements;

  if (p.has('field')) field.value = p.get('field');
  if (p.has('grade')) grade.value = p.get('grade');
  if (p.has('subject')) subject.value = p.get('subject');
  if (p.has('line')) line.value = p.get('line');
  if (p.has('q')) query.value = p.get('q');
  if (p.has('filter')) { state.liveFilter = p.get('filter'); liveFilter.value = state.liveFilter; }
  if (p.has('sort')) state.sort = { key: p.get('sort'), dir: p.get('dir') === 'desc' ? 'desc' : 'asc' };
  if (p.has('pageSize')) { state.pageSize = Number(p.get('pageSize')); pageSize.value = String(state.pageSize); }
  if (p.has('page')) state.page = Math.max(1, Number(p.get('page')) || 1);
  if (p.has('view')) state.viewMode = p.get('view');
}