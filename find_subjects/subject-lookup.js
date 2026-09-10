
/
Subject Lookup - renewal
Subject Lookup - renewal
You are out of free messages until 2:20 PM

Type / for skills




Recents
Subject lookup project improvements
6 minutes ago
Instructions
Add instructions to tailor Claude’s responses

Memory
Only you
Project memory will show here after a few chats.

Context
37% of project capacity used

GrahamPearl/hhs_lookup
main

GITHUB




subject-lookup.js
17kB

js



subject-lookup.js
/* subject-lookup.js
 * Hillcrest High — Student Lookup (index.html)
 * Phase 1: cross-grade search, dynamically-populated subject list,
 * live result filtering, sortable columns, pagination, shareable URL state,
 * CSV export of the full filtered set.
 */
(function () {
  'use strict';
 
  const GRADE_FILES = {
    '10': '../find_subjects/Subjects-Grade10.json',
    '11': '../find_subjects/Subjects-Grade11.json',
    '12': '../find_subjects/Subjects-Grade12.json',
  };
  // NOTE: adjust the paths above if index.html does not live one level
  // below the project root relative to the Subjects-GradeXX.json files.
  // The original project referenced them as sibling files to subjects.html;
  // update GRADE_FILES to match wherever they actually sit relative to index.html.
 
  const COLUMNS = [
    { key: 'grade', label: 'Grade', sortable: true },
    { key: 'student_number', label: 'Student #', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'gender', label: 'Gender', sortable: true },
    { key: 'class', label: 'Class', sortable: true },
    { key: 'subject', label: 'Subject', sortable: true },
    { key: 'line', label: 'Line', sortable: true },
    { key: 'teacher', label: 'Teacher', sortable: true },
  ];
 
  const PAGE_SIZE_OPTIONS = [25, 50, 100, 0]; // 0 = "All"
 
  // ---- state -------------------------------------------------------------
  const state = {
    allData: [],          // every record from every grade, tagged with .grade
    subjectsAvailable: [], // sorted unique subject names, derived from data
    results: [],           // rows matching the main search (pre live-filter)
    filtered: [],           // results after the live filter box is applied
    sort: { key: null, dir: 'asc' },
    page: 1,
    pageSize: 25,
    liveFilter: '',
  };
 
  // ---- DOM refs ------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const el = {
    form: $('#searchForm'),
    field: $('#field'),
    grade: $('#gradeSelect'),
    subject: $('#subjectSelect'),
    line: $('#lineSelect'),
    query: $('#query'),
    resetBtn: $('#resetBtn'),
    status: $('#status'),
    exportBtn: $('#exportBtn'),
    messageArea: $('#messageArea'),
    resultArea: $('#resultArea'),
  };
 
  // ---- init ------------------------------------------------------------
  async function init() {
    injectToolbarExtras();
    setStatus('Loading student data…', 'bg-secondary');
    try {
      const grades = Object.keys(GRADE_FILES);
      const payloads = await Promise.all(
        grades.map((g) => fetchJson(GRADE_FILES[g]).then((rows) => tagGrade(rows, g)))
      );
      state.allData = payloads.flat();
      state.subjectsAvailable = uniqueSorted(state.allData.map((r) => r.subject).filter(Boolean));
      populateSubjectDropdown();
      setStatus('Ready', 'bg-secondary');
    } catch (err) {
      setStatus('Failed to load data', 'bg-danger');
      setMessage(
        `<div class="alert alert-danger mb-0"><strong>Couldn't load student data.</strong> ` +
        `${esc(err.message)}. Check that Subjects-Grade10/11/12.json are reachable from this page ` +
        `and that you're running this via a local server, not file://.</div>`
      );
      return;
    }
 
    restoreFromURL();
    wireEvents();
 
    // If the URL already encoded a search, run it immediately.
    if (el.query.value || el.subject.value || el.line.value || (el.grade.value)) {
      runSearch({ pushUrl: false });
    }
  }
 
  function tagGrade(rows, grade) {
    return (Array.isArray(rows) ? rows : []).map((r) => Object.assign({}, r, { grade }));
  }
 
  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then((resp) => {
      if (!resp.ok) throw new Error(`${url} (${resp.status})`);
      return resp.json();
    });
  }
 
  function uniqueSorted(arr) {
    return Array.from(new Set(arr)).sort((a, b) => String(a).localeCompare(String(b)));
  }
 
  function populateSubjectDropdown() {
    // Preserve the "All subjects" placeholder, replace everything else
    // with whatever subjects actually exist in the loaded data, so the
    // dropdown can never drift out of sync with the real dataset again.
    const current = el.subject.value;
    el.subject.innerHTML = '';
    el.subject.appendChild(new Option('All subjects', ''));
    state.subjectsAvailable.forEach((s) => el.subject.appendChild(new Option(s, s)));
    if (current && state.subjectsAvailable.includes(current)) el.subject.value = current;
  }
 
  // ---- toolbar extras (live filter + page size) ---------------------------
  function injectToolbarExtras() {
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar) return;
 
    const liveWrap = document.createElement('div');
    liveWrap.className = 'live-filter-wrap';
    liveWrap.innerHTML = `
      <label for="liveFilter" class="form-label mb-0 small text-muted">Filter results</label>
      <input type="text" id="liveFilter" class="form-control form-control-sm"
             placeholder="Narrow the results shown below…" autocomplete="off">
    `;
    toolbar.appendChild(liveWrap);
 
    const pageSizeWrap = document.createElement('div');
    pageSizeWrap.className = 'page-size-wrap';
    pageSizeWrap.innerHTML = `
      <label for="pageSize" class="form-label mb-0 small text-muted">Rows per page</label>
      <select id="pageSize" class="form-select form-select-sm" style="width:auto">
        ${PAGE_SIZE_OPTIONS.map((n) => `<option value="${n}">${n === 0 ? 'All' : n}</option>`).join('')}
      </select>
    `;
    toolbar.appendChild(pageSizeWrap);
 
    el.liveFilter = liveWrap.querySelector('#liveFilter');
    el.pageSize = pageSizeWrap.querySelector('#pageSize');
    el.pageSize.value = String(state.pageSize);
  }
 
  // ---- events ------------------------------------------------------------
  function wireEvents() {
    el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch({ pushUrl: true });
    });
 
    el.resetBtn.addEventListener('click', () => {
      el.form.reset();
      el.liveFilter.value = '';
      el.pageSize.value = '25';
      state.sort = { key: null, dir: 'asc' };
      state.page = 1;
      state.results = [];
      state.filtered = [];
      setMessage('');
      setStatus('Ready', 'bg-secondary');
      el.exportBtn.disabled = true;
      el.resultArea.innerHTML = '';
      history.replaceState({}, '', location.pathname);
    });
 
    el.liveFilter.addEventListener('input', debounce(() => {
      state.liveFilter = el.liveFilter.value.trim();
      state.page = 1;
      applyLiveFilterAndRender();
      syncURL();
    }, 150));
 
    el.pageSize.addEventListener('change', () => {
      state.pageSize = Number(el.pageSize.value);
      state.page = 1;
      render();
      syncURL();
    });
 
    el.grade.addEventListener('change', () => {
      // Line list can stay fixed 1–8; subject list is global across grades
      // on purpose, since the same subject can appear in multiple grades.
    });
 
    el.exportBtn.addEventListener('click', exportCsv);
  }
 
  // ---- search --------------------------------------------------------------
  function runSearch({ pushUrl }) {
    const field = el.field.value;
    const gradeSel = el.grade.value; // '' | '10' | '11' | '12'
    const subjectSel = el.subject.value;
    const lineSel = el.line.value;
    const query = el.query.value.trim();
 
    if (field === 'subject_line' && !gradeSel) {
      setMessage('<div class="alert alert-warning mb-0">Select a Grade to use Subject + Line search.</div>');
      return;
    }
 
    let pool = state.allData;
    if (gradeSel) pool = pool.filter((r) => r.grade === gradeSel);
    if (subjectSel) pool = pool.filter((r) => r.subject === subjectSel);
    if (lineSel) pool = pool.filter((r) => String(r.line ?? '') === lineSel);
 
    let rows;
    if (!query) {
      rows = pool;
    } else if (field === 'subject_line') {
      const parsed = parseSubjectLine(query);
      rows = pool.filter((r) => {
        const subjMatch = parsed.subject
          ? String(r.subject || '').toLowerCase().includes(parsed.subject)
          : true;
        const lineMatch = parsed.line != null ? String(r.line ?? '') === String(parsed.line) : true;
        return subjMatch && lineMatch;
      });
    } else if (field === 'auto') {
      const q = query.toLowerCase();
      rows = pool.filter((r) => matchesAuto(r, q));
    } else {
      const q = query.toLowerCase();
      rows = pool.filter((r) => String(r[field] ?? '').toLowerCase().includes(q));
    }
 
    state.results = rows;
    state.page = 1;
    setMessage('');
    applyLiveFilterAndRender();
    if (pushUrl) syncURL();
  }
 
  function matchesAuto(record, q) {
    return (
      String(record.student_number ?? '').toLowerCase().includes(q) ||
      String(record.name ?? '').toLowerCase().includes(q) ||
      String(record.subject ?? '').toLowerCase().includes(q) ||
      String(record.line ?? '').toLowerCase().includes(q) ||
      String(record.teacher ?? '').toLowerCase().includes(q) ||
      String(record.class ?? '').toLowerCase().includes(q)
    );
  }
 
  // Parses queries like "Tourism line 5" -> { subject: 'tourism', line: 5 }
  function parseSubjectLine(q) {
    const m = q.match(/^(.*?)(?:\s*,?\s*line\s*(\d+))?$/i);
    const subject = (m && m[1] ? m[1] : q).trim().toLowerCase();
    const line = m && m[2] ? Number(m[2]) : null;
    return { subject, line };
  }
 
  // ---- live filter + sort + paginate + render -----------------------------
  function applyLiveFilterAndRender() {
    const q = state.liveFilter.toLowerCase();
    state.filtered = !q
      ? state.results.slice()
      : state.results.filter((r) => COLUMNS.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)));
    render();
  }
 
  function render() {
    let rows = state.filtered.slice();
 
    if (state.sort.key) {
      const { key, dir } = state.sort;
      rows.sort((a, b) => {
        const av = a[key], bv = b[key];
        const an = Number(av), bn = Number(bv);
        let cmp;
        if (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '' && av != null && bv != null) {
          cmp = an - bn;
        } else {
          cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
        }
        return dir === 'asc' ? cmp : -cmp;
      });
    }
 
    const total = rows.length;
    const pageSize = state.pageSize; // 0 = all
    const totalPages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    if (state.page > totalPages) state.page = totalPages;
    const start = pageSize ? (state.page - 1) * pageSize : 0;
    const pageRows = pageSize ? rows.slice(start, start + pageSize) : rows;
 
    renderTable(pageRows);
    renderPagination(total, totalPages);
    updateStatus(total);
    el.exportBtn.disabled = total === 0;
  }
 
  function renderTable(rows) {
    if (!rows.length) {
      el.resultArea.innerHTML = '<div class="alert alert-light border">No students match this search.</div>';
      return;
    }
    const thead =
      '<thead><tr>' +
      COLUMNS.map((c) => {
        const sortAttr = state.sort.key === c.key ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        const arrow = state.sort.key === c.key ? (state.sort.dir === 'asc' ? '▲' : '▼') : '↕';
        return `<th scope="col" class="sortable" data-key="${c.key}" aria-sort="${sortAttr}">${esc(c.label)}<span class="sort-indicator">${arrow}</span></th>`;
      }).join('') +
      '</tr></thead>';
 
    const tbody =
      '<tbody>' +
      rows.map((r) => {
        const cells = COLUMNS.map((c) => {
          if (c.key === 'grade') return `<td><span class="grade-pill">Gr ${esc(r.grade)}</span></td>`;
          return `<td>${esc(r[c.key])}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      }).join('') +
      '</tbody>';
 
    el.resultArea.innerHTML =
      '<div class="table-responsive"><table class="table table-sm table-hover align-middle sticky-head">' +
      thead + tbody + '</table></div>';
 
    el.resultArea.querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-key');
        if (state.sort.key === key) {
          state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = { key, dir: 'asc' };
        }
        render();
        syncURL();
      });
    });
  }
 
  function renderPagination(total, totalPages) {
    let bar = document.querySelector('.results-pagination');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'results-pagination';
      el.resultArea.after(bar);
    }
    if (!total || !state.pageSize) {
      bar.innerHTML = '';
      return;
    }
    const from = (state.page - 1) * state.pageSize + 1;
    const to = Math.min(total, state.page * state.pageSize);
    bar.innerHTML = `
      <div class="page-info">Showing ${from}–${to} of ${total}</div>
      <div class="btn-group btn-group-sm" role="group">
        <button type="button" class="btn btn-outline-secondary" id="pgPrev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
        <button type="button" class="btn btn-outline-secondary disabled">Page ${state.page} of ${totalPages}</button>
        <button type="button" class="btn btn-outline-secondary" id="pgNext" ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
    bar.querySelector('#pgPrev')?.addEventListener('click', () => { state.page--; render(); syncURL(); });
    bar.querySelector('#pgNext')?.addEventListener('click', () => { state.page++; render(); syncURL(); });
  }
 
  function updateStatus(count) {
    setStatus(`${count} result${count === 1 ? '' : 's'}`, count ? 'bg-success' : 'bg-secondary');
  }
 
  // ---- CSV export (exports the full filtered set, not just current page) --
  function exportCsv() {
    const rows = state.filtered;
    if (!rows.length) return;
    const escCSV = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
    };
    const header = COLUMNS.map((c) => c.label).join(',');
    const lines = rows.map((r) => COLUMNS.map((c) => escCSV(r[c.key])).join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `student-lookup-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
 
  // ---- URL state -----------------------------------------------------------
  function syncURL() {
    const p = new URLSearchParams();
    if (el.field.value !== 'auto') p.set('field', el.field.value);
    if (el.grade.value) p.set('grade', el.grade.value);
    if (el.subject.value) p.set('subject', el.subject.value);
    if (el.line.value) p.set('line', el.line.value);
    if (el.query.value) p.set('q', el.query.value);
    if (state.liveFilter) p.set('filter', state.liveFilter);
    if (state.sort.key) { p.set('sort', state.sort.key); p.set('dir', state.sort.dir); }
    if (state.pageSize !== 25) p.set('pageSize', String(state.pageSize));
    if (state.page > 1) p.set('page', String(state.page));
    const qs = p.toString();
    history.replaceState({}, '', qs ? `?${qs}` : location.pathname);
  }
 
  function restoreFromURL() {
    const p = new URLSearchParams(location.search);
    if (p.has('field')) el.field.value = p.get('field');
    if (p.has('grade')) el.grade.value = p.get('grade');
    if (p.has('subject') && state.subjectsAvailable.includes(p.get('subject'))) el.subject.value = p.get('subject');
    if (p.has('line')) el.line.value = p.get('line');
    if (p.has('q')) el.query.value = p.get('q');
    if (p.has('filter')) { state.liveFilter = p.get('filter'); el.liveFilter.value = state.liveFilter; }
    if (p.has('sort')) state.sort = { key: p.get('sort'), dir: p.get('dir') === 'desc' ? 'desc' : 'asc' };
    if (p.has('pageSize')) { state.pageSize = Number(p.get('pageSize')); el.pageSize.value = String(state.pageSize); }
    if (p.has('page')) state.page = Math.max(1, Number(p.get('page')) || 1);
  }
 
  // ---- helpers ---------------------------------------------------------
  function setStatus(text, cls) {
    el.status.className = 'badge ' + cls;
    el.status.textContent = text;
  }
  function setMessage(html) { el.messageArea.innerHTML = html || ''; }
  function esc(s) {
    if (s == null) return '';
    return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
 
  document.addEventListener('DOMContentLoaded', init);
})();
 
