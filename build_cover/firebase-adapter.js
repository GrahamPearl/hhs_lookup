// firebase-adapter.js
// Thin Firestore adapter — v8 compat CDN SDK (no npm required)
// Load AFTER firebase-app.js and firebase-firestore.js script tags
// Used by both index.html (via script.js) and history.html (inline)

const FirebaseAdapter = (() => {
  "use strict";

  const CONFIG_KEY   = "firebaseConfig";
  const SCHOOL_KEY   = "firebaseSchoolId";
  const BATCH_LIMIT  = 400; // Firestore max is 500; stay under safely

  let db        = null;
  let _schoolId = null;

  // ── Config helpers ─────────────────────────────────────────────
  function getStoredConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); }
    catch { return null; }
  }

  function getStoredSchoolId() {
    return localStorage.getItem(SCHOOL_KEY) || null;
  }

  function isConfigured() {
    const c = getStoredConfig();
    const s = getStoredSchoolId();
    return !!(c && c.apiKey && c.projectId && s);
  }

  // ── Initialise (idempotent) ────────────────────────────────────
  function init() {
    if (db) return true;
    const config = getStoredConfig();
    _schoolId    = getStoredSchoolId();
    if (!config || !_schoolId) return false;
    try {
      if (!firebase.apps.length) firebase.initializeApp(config);
      db = firebase.firestore();
      // Offline persistence — best effort; fails silently in multi-tab
      db.enablePersistence({ synchronizeTabs: true })
        .catch(err => console.warn("Firestore persistence:", err.code));
      return true;
    } catch (e) {
      console.error("Firebase init error:", e);
      db = null;
      return false;
    }
  }

  // ── Path helpers ───────────────────────────────────────────────
  function schoolRef() {
    if (!db) throw new Error("Firestore not initialised. Check Settings → Firebase Storage.");
    return db.collection("schools").doc(_schoolId);
  }

  // Safe Firestore document ID from arbitrary string
  function safeId(str) {
    return String(str).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  }

  // Chunk array into groups of n
  function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  // ── Save To Cloud ──────────────────────────────────────────────
  // Expects: {
  //   date, coverAssignments, noCoverNeeded,
  //   absentTeachers, partialAbsentTeachers, absentTeacherReasons,
  //   history[], metrics{}, fairnessSettings{}, tenWeekStart, absenceReasons[]
  // }
  async function saveTo(data) {
    if (!init()) throw new Error("Firebase not configured. Check Settings → Firebase Storage.");
    const ref   = schoolRef();
    const batch = db.batch();

    // 1. Daily allocation snapshot
    batch.set(
      ref.collection("allocations").doc(safeId(data.date)),
      {
        date:                  data.date                  || "",
        coverAssignments:      data.coverAssignments      || {},
        noCoverNeeded:         data.noCoverNeeded         || {},
        absentTeachers:        data.absentTeachers        || [],
        partialAbsentTeachers: data.partialAbsentTeachers || {},
        absentTeacherReasons:  data.absentTeacherReasons  || {},
        savedAt:               firebase.firestore.FieldValue.serverTimestamp(),
      }
    );

    // 2. Metrics
    batch.set(ref.collection("meta").doc("metrics"), data.metrics || {});

    // 3. Settings blob
    batch.set(ref.collection("meta").doc("settings"), {
      fairnessSettings: data.fairnessSettings || {},
      tenWeekStart:     data.tenWeekStart     || "",
      absenceReasons:   data.absenceReasons   || [],
    });

    await batch.commit();

    // 4. History — chunked to respect Firestore 500-doc batch limit
    const history = data.history || [];
    if (history.length) {
      for (const entries of chunk(history, BATCH_LIMIT)) {
        const hBatch = db.batch();
        entries.forEach(entry => {
          const id = safeId(
            `${entry.date}_${entry.coveredTeacher}_P${entry.period}_${entry.coverTeacher}`
          );
          hBatch.set(ref.collection("history").doc(id), entry);
        });
        await hBatch.commit();
      }
    }
  }

  // ── Read From Cloud ────────────────────────────────────────────
  // Returns: { allocation, history[], metrics{}, settings{} }
  // allocation is null if no data saved for that date yet
  async function readFrom(date) {
    if (!init()) throw new Error("Firebase not configured. Check Settings → Firebase Storage.");
    const ref = schoolRef();

    const [allocSnap, histSnap, metricsSnap, settingsSnap] = await Promise.all([
      ref.collection("allocations").doc(safeId(date)).get(),
      ref.collection("history").get(),
      ref.collection("meta").doc("metrics").get(),
      ref.collection("meta").doc("settings").get(),
    ]);

    return {
      allocation: allocSnap.exists    ? allocSnap.data()    : null,
      history:    histSnap.docs.map(d => d.data()),
      metrics:    metricsSnap.exists  ? metricsSnap.data()  : {},
      settings:   settingsSnap.exists ? settingsSnap.data() : {},
    };
  }

  // ── Read all history only (used by history.html) ───────────────
  async function readHistory() {
    if (!init()) throw new Error("Firebase not configured.");
    const snap = await schoolRef().collection("history").get();
    return snap.docs.map(d => d.data());
  }

  // ── Public API ─────────────────────────────────────────────────
  return {
    init,
    isConfigured,
    saveTo,
    readFrom,
    readHistory,
    getStoredSchoolId,
    getStoredConfig,
  };
})();
