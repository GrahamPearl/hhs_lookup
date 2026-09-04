/* data-loader.js
   Loads the three data sources this page needs (internal candidates, external
   candidates, subject list + roster) and populates the subject dropdown.
   Calls into Seating.filters.filterAndRenderCandidates() once loading is
   done — that function is looked up on the shared namespace at call time, so
   filters.js does not need to load before this file, only before loadData()
   actually runs (i.e. before main.js's init call). */
(function (S) {
  'use strict';

  const dom = S.dom;
  const state = S.state;
  const config = S.config;
  const utils = S.utils;
  const candidates = S.candidates;

  async function loadData() {
    dom.$subject.prop('disabled', true).html('<option value="" selected disabled>Loading…</option>');
    dom.$subjectConfirm.html('');

    let studentsRaw = [], externalRaw = [], subjectListRaw = '', rosterRaw = [];
    try {
      studentsRaw = await utils.fetchJson(config.STUDENTS_JSON_FILE);
    } catch (e) {
      console.warn('Could not load ' + config.STUDENTS_JSON_FILE + ':', e.message);
    }
    try {
      externalRaw = await utils.fetchJson(config.EXTERNAL_JSON_FILE);
    } catch (e) {
      console.warn('Could not load ' + config.EXTERNAL_JSON_FILE + ':', e.message);
    }
    try {
      subjectListRaw = await utils.fetchText(config.LIST_OF_SUBJECTS_FILE);
    } catch (e) {
      console.warn('Could not load ' + config.LIST_OF_SUBJECTS_FILE + ':', e.message);
    }
    try {
      rosterRaw = await utils.fetchJson(config.SUBJECT_ROSTER_FILE);
    } catch (e) {
      console.warn('Could not load ' + config.SUBJECT_ROSTER_FILE + ':', e.message);
    }

    state.internalAll = (Array.isArray(studentsRaw) ? studentsRaw : [])
      .filter(s => String(s.grade) === '12')
      .map(s => candidates.normalizeCandidate(s, false));

    state.externalAll = (Array.isArray(externalRaw) ? externalRaw : [])
      .map(s => candidates.normalizeCandidate(s, true));

    // Dropdown labels come straight from list_of_subjects.txt, in file order,
    // one subject name per non-blank line.
    state.subjectNames = subjectListRaw
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    // Which candidates belong to which subject comes from Subjects-Grade12.json
    // (an array of { student_number, subject, ... } roster rows). Keyed by a
    // normalized subject name so minor wording differences between the two
    // files (e.g. "Physical Science" vs "Physical Sciences") still match.
    state.subjectsData = {};
    (Array.isArray(rosterRaw) ? rosterRaw : []).forEach(rec => {
      if (!rec || !rec.subject) return;
      const key = utils.normalizeSubjectKey(rec.subject);
      if (!state.subjectsData[key]) state.subjectsData[key] = new Set();
      if (rec.student_number != null) state.subjectsData[key].add(String(rec.student_number));
    });

    buildSubjectOptions();
    S.filters.filterAndRenderCandidates();
  }

  function buildSubjectOptions() {
    if (!state.subjectNames.length) {
      dom.$subject.html('<option value="" selected disabled>No entries found in list_of_subjects.txt</option>');
      dom.$subject.prop('disabled', false);
      dom.$subjectConfirm.html(`<div class="status-warn">Could not find any subjects in ${utils.esc(config.LIST_OF_SUBJECTS_FILE)}. Every Grade 12 candidate is currently shown below (no subject filter applied).</div>`);
      return;
    }
    dom.$subject.html(
      '<option value="" selected>All subjects (no filter)</option>' +
      state.subjectNames.map(s => `<option value="${utils.esc(s)}">${utils.esc(s)}</option>`).join('')
    );
    dom.$subject.prop('disabled', false);
  }

  S.dataLoader = { loadData, buildSubjectOptions };
})(window.Seating);
