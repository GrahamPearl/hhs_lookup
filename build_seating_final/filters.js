/* filters.js
   Subject + concession filtering, the internal/external candidate checkbox
   tables, and the Select All / Select None controls. Owns the delegated
   checkbox-change handlers (tightly coupled to renderCandidateTable's output,
   same as in the original single-file version). */
(function (S) {
  'use strict';

  const dom = S.dom;
  const state = S.state;
  const utils = S.utils;
  const candidates = S.candidates;

  function getSubjectAdminSet() {
    const subj = dom.$subject.val();
    if (!subj) return null; // no subject chosen -> no subject filtering
    return state.subjectsData[utils.normalizeSubjectKey(subj)] || new Set();
  }

  function passesConcessionFilter(c) {
    const f = dom.$concessionFilter.val();
    if (f === 'concessionOnly') return c.concession === true;
    if (f === 'noConcession') return c.concession !== true;
    return true; // 'all'
  }

  function hasValidSelection() {
    // A "valid selection" now just means at least one candidate list has been loaded/filtered.
    return state.internalAll.length > 0 || state.externalAll.length > 0;
  }

  function filterAndRenderCandidates() {
    const subjSet = getSubjectAdminSet();
    state.internalFiltered = state.internalAll.filter(c => (!subjSet || subjSet.has(c.adminNo)) && passesConcessionFilter(c));
    state.externalFiltered = state.externalAll.filter(c => (!subjSet || subjSet.has(c.adminNo)) && passesConcessionFilter(c));

    // Fresh filter -> default to "everyone selected"; the person can then deselect individuals.
    state.selectedInternalIds = new Set(state.internalFiltered.map(c => c.adminNo));
    state.selectedExternalIds = new Set(state.externalFiltered.map(c => c.adminNo));

    renderCandidateTable(dom.$internalTbody, candidates.sortByName(state.internalFiltered), state.selectedInternalIds);
    renderCandidateTable(dom.$externalTbody, candidates.sortByName(state.externalFiltered), state.selectedExternalIds);
    updateCandidateCounts();

    const subj = dom.$subject.val();
    dom.$subjectConfirm.html(
      `<div class="alert alert-info py-2 mb-0">` +
      (subj ? `Subject selected: <strong>${utils.esc(subj)}</strong>. ` : `No subject filter applied — showing all Grade 12 candidates. `) +
      `${state.internalFiltered.length} internal, ${state.externalFiltered.length} external candidate(s) match the current filters.` +
      `</div>`
    );
    S.seatingGrid.resetGrid();
  }

  function renderCandidateTable($tbody, list, selectedSet) {
    $tbody.empty();
    list.forEach(c => {
      const checked = selectedSet.has(c.adminNo) ? 'checked' : '';
      const tr = $(`
        <tr data-id="${utils.esc(c.adminNo)}" class="${checked ? '' : 'is-unselected'}">
          <td class="text-center"><input type="checkbox" class="form-check-input cand-check" ${checked}></td>
          <td>${utils.esc(candidates.candNumberLine(c))}</td>
          <td>${utils.esc(candidates.candNameLine(c))}</td>
          <td class="text-center">${c.concession ? '<span class="badge bg-warning text-dark">Concession</span>' : ''}</td>
        </tr>
      `);
      $tbody.append(tr);
    });
  }

  function updateCandidateCounts() {
    dom.$internalCountBadge.text(`${state.internalFiltered.length} candidates (${state.selectedInternalIds.size} selected)`);
    dom.$externalCountBadge.text(`${state.externalFiltered.length} candidates (${state.selectedExternalIds.size} selected)`);
  }

  dom.$internalTbody.on('change', '.cand-check', function () {
    const id = String($(this).closest('tr').data('id'));
    if (this.checked) state.selectedInternalIds.add(id); else state.selectedInternalIds.delete(id);
    $(this).closest('tr').toggleClass('is-unselected', !this.checked);
    updateCandidateCounts();
  });
  dom.$externalTbody.on('change', '.cand-check', function () {
    const id = String($(this).closest('tr').data('id'));
    if (this.checked) state.selectedExternalIds.add(id); else state.selectedExternalIds.delete(id);
    $(this).closest('tr').toggleClass('is-unselected', !this.checked);
    updateCandidateCounts();
  });

  $('#internalSelectAllBtn').on('click', () => {
    state.selectedInternalIds = new Set(state.internalFiltered.map(c => c.adminNo));
    renderCandidateTable(dom.$internalTbody, candidates.sortByName(state.internalFiltered), state.selectedInternalIds);
    updateCandidateCounts();
  });
  $('#internalSelectNoneBtn').on('click', () => {
    state.selectedInternalIds = new Set();
    renderCandidateTable(dom.$internalTbody, candidates.sortByName(state.internalFiltered), state.selectedInternalIds);
    updateCandidateCounts();
  });
  $('#externalSelectAllBtn').on('click', () => {
    state.selectedExternalIds = new Set(state.externalFiltered.map(c => c.adminNo));
    renderCandidateTable(dom.$externalTbody, candidates.sortByName(state.externalFiltered), state.selectedExternalIds);
    updateCandidateCounts();
  });
  $('#externalSelectNoneBtn').on('click', () => {
    state.selectedExternalIds = new Set();
    renderCandidateTable(dom.$externalTbody, candidates.sortByName(state.externalFiltered), state.selectedExternalIds);
    updateCandidateCounts();
  });

  function getSelectedCandidates() {
    const internalSel = candidates.sortByName(state.internalFiltered.filter(c => state.selectedInternalIds.has(c.adminNo)));
    const externalSel = candidates.sortByName(state.externalFiltered.filter(c => state.selectedExternalIds.has(c.adminNo)));
    return { internalSel, externalSel };
  }

  S.filters = {
    getSubjectAdminSet, passesConcessionFilter, hasValidSelection,
    filterAndRenderCandidates, renderCandidateTable, updateCandidateCounts,
    getSelectedCandidates
  };
})(window.Seating);
