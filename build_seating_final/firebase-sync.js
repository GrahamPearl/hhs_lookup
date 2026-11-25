/* firebase-sync.js
   Optional Firestore persistence: saves the current plan as a new document
   and lists/loads recent plans. Degrades gracefully (with an inline warning
   instead of throwing) when config.firebaseConfig hasn't been filled in, so
   the rest of the app keeps working in "local only" mode. Depends on
   plan-storage.js (buildPlanObject / applyLoadedPlan) and filters.js
   (hasValidSelection), both resolved lazily at call time. */
(function (S) {
  'use strict';

  const dom = S.dom;
  const config = S.config;
  const utils = S.utils;

  let db = null;
  let firebaseReady = false;

  function initFirebase() {
    try {
      if (typeof firebase === 'undefined') return;
      if (config.firebaseConfig.apiKey === "YOUR_API_KEY") return; // not configured
      firebase.initializeApp(config.firebaseConfig);
      db = firebase.firestore();
      firebaseReady = true;
    } catch (e) {
      console.warn('Firebase not initialised:', e);
    }
  }
  initFirebase();

  async function saveToCloud() {
    if (!firebaseReady) {
      utils.setExportMessage('Firebase is not configured. Fill in <span class="mono">firebaseConfig</span> in config.js to enable cloud save.', 'status-warn');
      return;
    }
    if (!S.filters.hasValidSelection()) { utils.setExportMessage('No candidate data is loaded yet.', 'status-err'); return; }
    try {
      const plan = S.planStorage.buildPlanObject();
      await db.collection(config.SEATING_COLLECTION).add(plan);
      utils.setExportMessage('Seating plan saved to Firebase.', 'status-ok');
      refreshCloudList();
    } catch (e) {
      utils.setExportMessage('Firebase save failed: ' + utils.esc(e.message), 'status-err');
    }
  }

  async function refreshCloudList() {
    dom.$cloudPlanList.empty();
    if (!firebaseReady) {
      dom.$cloudPlanList.html('<li class="list-group-item text-muted">Firebase not configured.</li>');
      return;
    }
    try {
      const query = db.collection(config.SEATING_COLLECTION).orderBy('generatedAt', 'desc').limit(15);
      const snap = await query.get();
      if (snap.empty) {
        dom.$cloudPlanList.html('<li class="list-group-item text-muted">No saved plans yet.</li>');
        return;
      }
      snap.forEach(doc => {
        const d = doc.data();
        const li = $(`
          <li class="list-group-item d-flex justify-content-between align-items-center">
            <span>${utils.esc(d.examTitle || '(untitled)')} — ${utils.esc(d.subject || 'All subjects')} <span class="text-muted">(${utils.esc((d.generatedAt || '').slice(0, 10))})</span></span>
            <button class="btn btn-sm btn-outline-primary" data-doc="${doc.id}">Load</button>
          </li>
        `);
        li.find('button').on('click', () => S.planStorage.applyLoadedPlan(d));
        dom.$cloudPlanList.append(li);
      });
    } catch (e) {
      dom.$cloudPlanList.html(`<li class="list-group-item status-err">Could not load: ${utils.esc(e.message)}</li>`);
    }
  }

  S.firebaseSync = { initFirebase, saveToCloud, refreshCloudList, isReady: () => firebaseReady };
})(window.Seating);
