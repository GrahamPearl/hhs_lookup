/* candidate-model.js
   The single shared candidate shape used everywhere downstream (candidate
   tables, seats, unassigned pool, register, JSON export/import):

     { adminNo, examNo, firstName, lastName, concession, external }

   This module only knows how to build, display, sort, and (de)serialize that
   shape — it doesn't know about seating, filters, or exports. */
(function (S) {
  'use strict';

  function normalizeCandidate(raw, isExternal) {
    return {
      adminNo: String(raw.adminNo != null ? raw.adminNo : ''),
      examNo: raw.ExamNo || raw.examNo || '',
      firstName: raw.firstName || '',
      lastName: raw.lastName || '',
      concession: raw.Concession === 'True' || raw.concession === true,
      external: !!isExternal
    };
  }

  // Display priority: ExamNo first (primary line), then Surname, Firstname (secondary line).
  function candNumberLine(c) {
    return c.examNo || c.adminNo || '';
  }
  function candNameLine(c) {
    const sur = (c.lastName || '').toString().toUpperCase();
    const first = c.firstName || '';
    return sur ? `${sur}, ${first}` : (first || '(unnamed)');
  }
  function candSortKey(c) {
    return `${(c.lastName || '').toUpperCase()}, ${(c.firstName || '').toUpperCase()}`;
  }
  function sortByName(list) {
    return [...list].sort((a, b) => candSortKey(a).localeCompare(candSortKey(b)));
  }

  // A candidate "ref" is the shared candidate model, trimmed to what's needed
  // to re-match against freshly-loaded internal/external lists on load.
  function candidateRef(c) {
    return {
      adminNo: c.adminNo,
      examNo: c.examNo,
      firstName: c.firstName,
      lastName: c.lastName,
      concession: !!c.concession,
      external: !!c.external
    };
  }

  // Re-matches a stored candidate ref against the live internal/external pools
  // by adminNo, falling back to re-normalizing the stored ref itself if not
  // found (e.g. the candidate has since been removed from students.json/external.json).
  function resolveCandidateRef(ref) {
    if (!ref) return null;
    const state = S.state;
    const pool = ref.external ? state.externalAll : state.internalAll;
    return pool.find(c => c.adminNo === String(ref.adminNo)) || normalizeCandidate({
      adminNo: ref.adminNo, ExamNo: ref.examNo, firstName: ref.firstName,
      lastName: ref.lastName, Concession: ref.concession ? 'True' : 'False'
    }, !!ref.external);
  }

  S.candidates = {
    normalizeCandidate, candNumberLine, candNameLine, candSortKey, sortByName,
    candidateRef, resolveCandidateRef
  };
})(window.Seating);
