/* plan-storage.js
   Serializes the current plan to the JSON save format and restores a loaded
   plan back into state.seats / the candidate tables / the layout inputs.
   Shared by both the local "Save/Load JSON" buttons and (via applyLoadedPlan)
   the Firebase "Load" buttons in firebase-sync.js. */
(function (S) {
  'use strict';

  const dom = S.dom;
  const state = S.state;
  const utils = S.utils;
  const candidates = S.candidates;

  function buildPlanObject() {
    return {
      examTitle: dom.$examTitle.val() || '',
      subject: dom.$subject.val() || '',
      concessionFilter: dom.$concessionFilter.val() || 'all',
      pattern: 's-snake',
      rowsPerRow: state.rows,       // desks per row
      numberOfRows: state.cols,     // number of rows of desks
      generatedAt: new Date().toISOString(),
      internalStudents: state.internalFiltered
        .filter(c => state.selectedInternalIds.has(c.adminNo))
        .map(candidates.candidateRef),
      externalStudents: state.externalFiltered
        .filter(c => state.selectedExternalIds.has(c.adminNo))
        .map(candidates.candidateRef),
      seats: state.seats.map(s => ({
        row: s.row,
        col: s.col,
        student: s.student ? candidates.candidateRef(s.student) : null
      })),
      unassigned: state.unassigned.map(candidates.candidateRef)
    };
  }

  function saveJson() {
    if (!S.filters.hasValidSelection()) { utils.setExportMessage('No candidate data is loaded yet.', 'status-err'); return; }
    const plan = buildPlanObject();
    const subj = (plan.subject || 'AllSubjects').replace(/[^\w\-]+/g, '_');
    const title = (plan.examTitle || 'SeatingPlan').replace(/[^\w\-]+/g, '_');
    utils.download(`${title}-${subj}.json`, JSON.stringify(plan, null, 2), 'application/json;charset=utf-8');
    utils.setExportMessage('Seating plan JSON downloaded.', 'status-ok');
  }

  function applyLoadedPlan(plan) {
    dom.$examTitle.val(plan.examTitle || '');
    if (plan.subject !== undefined) dom.$subject.val(plan.subject);
    if (plan.concessionFilter) dom.$concessionFilter.val(plan.concessionFilter);

    // Re-run filtering for the restored subject/concession combination, then
    // override the selection sets with exactly what was saved.
    S.filters.filterAndRenderCandidates();

    state.selectedInternalIds = new Set((plan.internalStudents || []).map(s => String(s.adminNo)));
    state.selectedExternalIds = new Set((plan.externalStudents || []).map(s => String(s.adminNo)));
    S.filters.renderCandidateTable(dom.$internalTbody, candidates.sortByName(state.internalFiltered), state.selectedInternalIds);
    S.filters.renderCandidateTable(dom.$externalTbody, candidates.sortByName(state.externalFiltered), state.selectedExternalIds);
    S.filters.updateCandidateCounts();

    state.rows = plan.rowsPerRow || state.rows;
    state.cols = plan.numberOfRows || state.cols;
    dom.$rowsInput.val(state.rows);
    dom.$colsInput.val(state.cols);

    state.seats = (plan.seats || []).map(s => ({
      row: s.row,
      col: s.col,
      student: candidates.resolveCandidateRef(s.student)
    }));
    state.unassigned = (plan.unassigned || []).map(candidates.resolveCandidateRef).filter(Boolean);
    state.selectedPoolId = null;
    S.seatingGrid.renderGrid();
    S.seatingGrid.renderPool();
    utils.setPlanMessage('Loaded seating plan from JSON.', 'status-ok');
    S.imageExport.hidePreview();
  }

  function loadJsonFile(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const plan = JSON.parse(e.target.result);
        applyLoadedPlan(plan);
      } catch (err) {
        utils.setPlanMessage('Could not read JSON file: ' + utils.esc(err.message), 'status-err');
      }
    };
    reader.readAsText(file);
  }

  S.planStorage = { buildPlanObject, saveJson, applyLoadedPlan, loadJsonFile };
})(window.Seating);
