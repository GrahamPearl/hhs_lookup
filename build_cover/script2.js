const PREFIX = "teacher_";
let teacherCache = {};
let coverAssignments = {};
let noCoverNeeded = {};
let tallies = {};
let absentTeachers = [];
let nextPrintAction = null;
let coverDate = new Date().toISOString().split('T')[0];

const METRICS_KEY = "teacherMetrics";
const HISTORY_KEY = "coverHistory";
const TEN_WEEK_START = "tenWeekStart";

// ── Cached localStorage accessors ──────────────────────────────
// Avoid repeated JSON.parse on every call; invalidate on write.

let _metricsCache = null;
let _historyCache = null;
let _tenWeekStartCache = undefined; // undefined = not yet read

function loadMetrics() {
  if (_metricsCache === null) {
    _metricsCache = JSON.parse(localStorage.getItem(METRICS_KEY) || "{}");
  }
  return _metricsCache;
}

function saveMetrics(metrics) {
  _metricsCache = metrics;
  localStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
}

function loadCoverHistory() {
  if (_historyCache === null) {
    _historyCache = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  }
  return _historyCache;
}

function saveCoverHistory(history) {
  _historyCache = history;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function getCachedTenWeekStart() {
  if (_tenWeekStartCache === undefined) {
    _tenWeekStartCache = localStorage.getItem(TEN_WEEK_START);
  }
  return _tenWeekStartCache;
}

function setCachedTenWeekStart(val) {
  _tenWeekStartCache = val;
  localStorage.setItem(TEN_WEEK_START, val);
}

// ── 10-week period helpers ─────────────────────────────────────

function initializeTenWeekPeriod() {
  if (!getCachedTenWeekStart()) {
    setCachedTenWeekStart(new Date().toISOString().split('T')[0]);
  }
}

function getWeekNumber(dateStr) {
  initializeTenWeekPeriod();
  const startDate = new Date(getCachedTenWeekStart());
  const diffDays = Math.floor((new Date(dateStr) - startDate) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(week, 1), 10);
}

// ── Batch history stats ────────────────────────────────────────
// Instead of filtering the full history array per-teacher per-stat,
// compute all stats in a single pass.

function buildHistoryStats(history, currentWeek) {
  const stats = {}; // { teacherName: { total, thisWeek } }
  for (let i = 0, len = history.length; i < len; i++) {
    const h = history[i];
    const t = h.coverTeacher;
    if (!stats[t]) stats[t] = { total: 0, thisWeek: 0, relevantTotal: 0, relevantWeeks: 0 };
    stats[t].total++;
    if (h.week === currentWeek) stats[t].thisWeek++;
    if (h.week <= currentWeek) stats[t].relevantTotal++;
  }
  // Compute per-week averages
  for (const t in stats) {
    stats[t].coversPerWeek = currentWeek > 0
      ? (stats[t].relevantTotal / currentWeek).toFixed(2)
      : "0.00";
  }
  return stats;
}

// Legacy single-teacher accessors (still used in some isolated spots)
function getCoversThisWeek(coverTeacher) {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  let count = 0;
  for (let i = 0, len = history.length; i < len; i++) {
    if (history[i].coverTeacher === coverTeacher && history[i].week === week) count++;
  }
  return count;
}

function getTotalCovers(coverTeacher) {
  const history = loadCoverHistory();
  let count = 0;
  for (let i = 0, len = history.length; i < len; i++) {
    if (history[i].coverTeacher === coverTeacher) count++;
  }
  return count;
}

function getCoversPerWeekAverage(coverTeacher) {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  let count = 0;
  for (let i = 0, len = history.length; i < len; i++) {
    if (history[i].coverTeacher === coverTeacher && history[i].week <= week) count++;
  }
  return count === 0 ? 0 : (count / week).toFixed(2);
}

// ── Teacher data helpers ───────────────────────────────────────

function loadTeacher(name) {
  if (!teacherCache[name]) {
    const raw = localStorage.getItem(PREFIX + name);
    if (raw) teacherCache[name] = JSON.parse(raw);
  }
  return teacherCache[name];
}

function calculateFreePeriods(name) {
  const data = loadTeacher(name);
  if (!data || !data.entries) return 0;
  let count = 0;
  for (let i = 0, len = data.entries.length; i < len; i++) {
    if (data.entries[i].type === "free") count++;
  }
  return count;
}

function ensureTeacherMetrics(name) {
  const metrics = loadMetrics();
  if (!metrics[name]) {
    metrics[name] = {
      freePeriods: calculateFreePeriods(name),
      coversDone: 0,
      coversThisWeek: 0,
      totalCovers: 0,
      lastCoverDate: null
    };
    saveMetrics(metrics);
  }
}

// ── Pre-compute teacher name list from localStorage ────────────

function getTeacherNames() {
  const names = [];
  for (let i = 0, len = localStorage.length; i < len; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(PREFIX)) names.push(k.slice(PREFIX.length));
  }
  return names;
}

// ── Cover history entry ────────────────────────────────────────

function addCoverHistoryEntry(coveredTeacher, coverTeacher, period, day, subject, className, venue) {
  const history = loadCoverHistory();
  history.push({
    date: coverDate,
    week: getWeekNumber(coverDate),
    coveredTeacher,
    coverTeacher,
    day,
    period,
    subject: subject || "Unknown",
    className: className || "Unknown",
    venue: venue || "Unknown",
    timestamp: new Date().toISOString()
  });
  saveCoverHistory(history);
}

// ── Auto-prune ─────────────────────────────────────────────────

function autoPruneOldEntries() {
  const history = loadCoverHistory();
  const tenWeekStart = getCachedTenWeekStart();
  if (!tenWeekStart) return;

  const cutoff = new Date(tenWeekStart);
  cutoff.setDate(cutoff.getDate() + 70);

  const pruned = history.filter(h => new Date(h.date) >= cutoff);
  if (pruned.length !== history.length) {
    saveCoverHistory(pruned);
  }
}

// ── Available teachers (hot path — heavily optimized) ──────────

function getAvailableTeachers(period, day, absentList) {
  // Build set of already-assigned covers for this period
  const assignedCovers = new Set();
  const suffix = day + "-" + period;
  for (const key in coverAssignments) {
    const idx = key.indexOf(":");
    if (idx !== -1 && key.slice(idx + 1) === suffix) {
      assignedCovers.add(coverAssignments[key]);
    }
  }

  const absentSet = new Set(absentList);
  const list = [];
  const allNames = getTeacherNames();

  for (let i = 0, len = allNames.length; i < len; i++) {
    const name = allNames[i];
    if (absentSet.has(name) || assignedCovers.has(name)) continue;

    const data = loadTeacher(name);
    if (!data || !data.entries) continue;

    // Find matching entry
    const entries = data.entries;
    let matchedEntry = null;
    for (let j = 0, elen = entries.length; j < elen; j++) {
      if (entries[j].row == day && entries[j].col == period) {
        matchedEntry = entries[j];
        break;
      }
    }

    if (matchedEntry && (matchedEntry.type === "free" || matchedEntry.type === "meeting")) {
      list.push({ name, type: matchedEntry.type });
    }
  }

  // Ensure metrics exist (batch)
  const metrics = loadMetrics();
  let metricsChanged = false;
  for (let i = 0; i < list.length; i++) {
    if (!metrics[list[i].name]) {
      metrics[list[i].name] = {
        freePeriods: calculateFreePeriods(list[i].name),
        coversDone: 0,
        coversThisWeek: 0,
        totalCovers: 0,
        lastCoverDate: null
      };
      metricsChanged = true;
    }
  }
  if (metricsChanged) saveMetrics(metrics);

  // Build history stats in a single pass
  const history = loadCoverHistory();
  const currentWeek = getWeekNumber(coverDate);
  const histStats = buildHistoryStats(history, currentWeek);

  // Attach stats
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const m = metrics[t.name] || { freePeriods: 0 };
    const hs = histStats[t.name] || { total: 0, thisWeek: 0, coversPerWeek: "0.00" };
    t.freePeriods = m.freePeriods;
    t.coversDone = m.coversDone || 0;
    t.coversThisWeek = hs.thisWeek;
    t.totalCovers = hs.total;
    t.coversPerWeek = hs.coversPerWeek;
  }

  // Sort by fairness
  list.sort((a, b) => {
    if (a.totalCovers !== b.totalCovers) return a.totalCovers - b.totalCovers;
    if (a.coversThisWeek !== b.coversThisWeek) return a.coversThisWeek - b.coversThisWeek;
    const aDiff = parseFloat(a.coversPerWeek), bDiff = parseFloat(b.coversPerWeek);
    if (aDiff !== bDiff) return aDiff - bDiff;
    return b.freePeriods - a.freePeriods;
  });

  return list;
}

// ── UI: refresh teacher dropdown ───────────────────────────────

function refreshTeachers() {
  const sel = document.getElementById("addAbsenceTeacherSelect");
  if (!sel) return;

  const absentSet = new Set(absentTeachers);
  const names = getTeacherNames().filter(n => !absentSet.has(n));
  names.sort();

  // Build options via innerHTML (faster than createElement loop)
  sel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join("");
}

// ── UI: absent teachers table ──────────────────────────────────

function renderAbsentTeachersTable() {
  const tableBody = document.querySelector("#absentTeachersTable tbody");
  tableBody.innerHTML = absentTeachers.map((name, idx) =>
    `<tr><td>${name}</td><td><button class="btn btn-sm btn-danger" data-remove-idx="${idx}">Remove</button></td></tr>`
  ).join("");

  // Delegate click events
  tableBody.onclick = (e) => {
    const btn = e.target.closest("[data-remove-idx]");
    if (!btn) return;
    absentTeachers.splice(parseInt(btn.dataset.removeIdx), 1);
    refreshTeachers();
    renderAbsentTeachersTable();
    renderGrid();
  };
}

// ── UI: main cover grid ────────────────────────────────────────

function renderGrid() {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const grid = document.getElementById("coverGrid");
  const availDiv = document.getElementById("availableCoverList");

  if (absentTeachers.length === 0) {
    grid.innerHTML = "<div class='alert alert-info'>No absent teachers selected.</div>";
    availDiv.innerHTML = "";
    return;
  }

  // Build absent teacher lessons table via string concat (faster than DOM API)
  const rowsHtml = [];
  const dropZones = []; // { key, period, teacher, lesson }

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    const lessons = data.entries.filter(e => e.row == day).sort((a, b) => a.col - b.col);

    lessons.forEach((e) => {
      if (e.col === 6) return;
      const key = teacher + ":" + day + "-" + e.col;
      let assignHtml = "";

      if (e.type === "lesson") {
        const assigned = coverAssignments[key];
        const noCover = noCoverNeeded[key];

        if (assigned) {
          assignHtml = `<div class="border p-2" style="min-height:3em"><span class='badge bg-success'>${assigned}</span> <button class='btn btn-sm btn-danger ms-2' data-undo-key="${key}">Undo</button></div>`;
        } else if (noCover) {
          assignHtml = `<div class="border p-2" style="min-height:3em;background-color:#f8f9fa"><span class='badge bg-secondary'>No Cover Needed</span> <button class='btn btn-sm btn-warning ms-2' data-undo-nocover="${key}">Assign</button></div>`;
        } else {
          assignHtml = `<div class="border p-2 drop-zone" style="min-height:3em" data-drop-key="${key}" data-period="${e.col}" data-day="${day}">
            <div class="d-flex justify-content-between align-items-center">
              <small class="text-muted">Drop teacher here</small>
              <button class='btn btn-sm btn-outline-secondary' data-mark-nocover="${key}" title="Mark as no cover needed">✗</button>
            </div>
          </div>`;
        }
      }

      rowsHtml.push(`<tr><td>${teacher}</td><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ""}</td><td>${e.venue || ""}</td><td>${assignHtml}</td></tr>`);
    });
  });

  grid.innerHTML = `<table class="table table-bordered">
    <thead><tr><th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assign Cover</th></tr></thead>
    <tbody>${rowsHtml.join("")}</tbody></table>`;

  // Event delegation for grid actions
  grid.onclick = (e) => {
    const undoBtn = e.target.closest("[data-undo-key]");
    if (undoBtn) { undo(undoBtn.dataset.undoKey); return; }

    const undoNoCoverBtn = e.target.closest("[data-undo-nocover]");
    if (undoNoCoverBtn) { undoNoCover(undoNoCoverBtn.dataset.undoNocover); return; }

    const markBtn = e.target.closest("[data-mark-nocover]");
    if (markBtn) { markNoCover(markBtn.dataset.markNocover); return; }
  };

  // Set up drag-drop on drop zones
  grid.querySelectorAll(".drop-zone").forEach(drop => {
    drop.ondragover = (ev) => ev.preventDefault();
    drop.ondrop = (ev) => {
      ev.preventDefault();
      const t = ev.dataTransfer.getData("text");
      const period = parseInt(drop.dataset.period);
      const dropDay = parseInt(drop.dataset.day);
      const key = drop.dataset.dropKey;

      const available = getAvailableTeachers(period, dropDay, absentTeachers).map(o => o.name);
      if (!available.includes(t)) {
        drop.innerHTML = `<span class='text-danger'>Teacher not available</span>`;
        setTimeout(() => renderGrid(), 1200);
        return;
      }

      if (noCoverNeeded[key]) delete noCoverNeeded[key];
      coverAssignments[key] = t;

      // Parse teacher name from key
      const teacher = key.split(":")[0];
      const teacherData = loadTeacher(teacher);
      const lesson = teacherData?.entries?.find(e => e.row == dropDay && e.col == period);

      addCoverHistoryEntry(teacher, t, period + 1, dropDay + 1, lesson?.subject || lesson?.type, lesson?.className, lesson?.venue);

      const metrics = loadMetrics();
      ensureTeacherMetrics(t);
      metrics[t].coversDone += 1;
      metrics[t].totalCovers = getTotalCovers(t);
      metrics[t].coversThisWeek = getCoversThisWeek(t);
      metrics[t].lastCoverDate = coverDate;
      saveMetrics(metrics);

      renderGrid();
    };
  });

  // Build available cover teachers table
  const availRows = [];
  for (let period = 0; period < 6; period++) {
    const avail = getAvailableTeachers(period, day, absentTeachers);
    let tdContent;
    if (avail.length === 0) {
      tdContent = '<span class="text-muted">None</span>';
    } else {
      tdContent = avail.map(teacher => {
        const warningClass = teacher.totalCovers > 5 ? " border border-danger" : "";
        return `<span class="badge me-1 avail-badge ${teacher.type === "free" ? "bg-primary" : "bg-secondary"}${warningClass}" draggable="true" data-teacher-name="${teacher.name}">
  ${teacher.name}
  <span class="badge bg-light text-dark ms-1" title="Total covers">T:${teacher.totalCovers}</span>
  <span class="badge bg-light text-dark ms-1" title="This week">W:${teacher.coversThisWeek}</span>
  <span class="badge bg-light text-dark ms-1" title="Per-week avg">A:${teacher.coversPerWeek}</span>
  <span class="badge bg-light text-dark ms-1" title="Free periods">F:${teacher.freePeriods}</span>
  ${teacher.type === "meeting" ? " (M)" : ""}
</span>`;
      }).join("");
    }
    availRows.push(`<tr><td>Period ${period + 1}</td><td>${tdContent}</td></tr>`);
  }

  availDiv.innerHTML = `<table class="table table-bordered table-sm">
    <thead><tr><th>Period</th><th>Available Teachers</th></tr></thead>
    <tbody>${availRows.join("")}</tbody></table>`;

  // Set up drag on badges via delegation
  availDiv.addEventListener("dragstart", (ev) => {
    const badge = ev.target.closest("[data-teacher-name]");
    if (badge) ev.dataTransfer.setData("text", badge.dataset.teacherName);
  });

  checkFairnessWarnings();
}

// ── Fairness warnings (optimized with single-pass stats) ───────

function checkFairnessWarnings() {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);

  const coversPerTeacher = {};
  for (let i = 0, len = history.length; i < len; i++) {
    if (history[i].week === week) {
      const t = history[i].coverTeacher;
      coversPerTeacher[t] = (coversPerTeacher[t] || 0) + 1;
    }
  }

  const warnings = [];
  for (const teacher in coversPerTeacher) {
    if (coversPerTeacher[teacher] > 3) {
      warnings.push(`⚠️ ${teacher} has ${coversPerTeacher[teacher]} covers this week (unfair load)`);
    }
  }

  const warningDiv = document.getElementById("fairnessWarning");
  if (warnings.length > 0) {
    warningDiv.innerHTML = warnings.join("<br>");
    warningDiv.classList.remove("d-none");
  } else {
    warningDiv.classList.add("d-none");
  }
}

// ── Undo / No-cover ───────────────────────────────────────────

function undo(key) {
  const history = loadCoverHistory();
  const [teacher, dp] = key.split(":");
  const [d, p] = dp.split("-");
  const dayNum = parseInt(d) + 1, periodNum = parseInt(p) + 1;

  saveCoverHistory(history.filter(h =>
    !(h.coveredTeacher === teacher && h.day === dayNum && h.period === periodNum)
  ));

  delete coverAssignments[key];
  renderGrid();
}

function markNoCover(key) {
  noCoverNeeded[key] = true;
  renderGrid();
}

function undoNoCover(key) {
  delete noCoverNeeded[key];
  renderGrid();
}

// ── Auto-assign ────────────────────────────────────────────────

function autoAssignCoverTeachers() {
  if (absentTeachers.length === 0) {
    alert("No absent teachers to assign covers for.");
    return;
  }

  const day = parseInt(document.getElementById("absenceDaySelect").value);
  let assignmentsMade = 0, conflicts = 0;

  const assignedTeachers = new Set(Object.values(coverAssignments));

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;

    const lessons = data.entries.filter(e => e.row == day && e.type === "lesson").sort((a, b) => a.col - b.col);

    lessons.forEach((e) => {
      if (e.col === 6) return;
      const key = teacher + ":" + day + "-" + e.col;
      if (coverAssignments[key] || noCoverNeeded[key]) return;

      let availableTeachers = getAvailableTeachers(e.col, day, absentTeachers)
        .filter(t => !assignedTeachers.has(t.name));

      if (availableTeachers.length > 0) {
        const best = availableTeachers[0];
        coverAssignments[key] = best.name;
        assignedTeachers.add(best.name);

        addCoverHistoryEntry(teacher, best.name, e.col + 1, day + 1, e.subject || e.type, e.className, e.venue);

        const metrics = loadMetrics();
        ensureTeacherMetrics(best.name);
        metrics[best.name].coversDone += 1;
        metrics[best.name].totalCovers = getTotalCovers(best.name);
        metrics[best.name].coversThisWeek = getCoversThisWeek(best.name);
        metrics[best.name].lastCoverDate = coverDate;
        saveMetrics(metrics);

        assignmentsMade++;
      } else {
        conflicts++;
      }
    });
  });

  renderGrid();
  let message = `Auto-assignment complete!\n\nAssignments made: ${assignmentsMade}`;
  if (conflicts > 0) message += `\nUnassigned lessons: ${conflicts} (no suitable teachers available)`;
  alert(message);
}

// ── Week display & date picker ─────────────────────────────────

function updateWeekDisplay() {
  document.getElementById("weekDisplay").textContent = getWeekNumber(coverDate);
}

function initializeDatePicker() {
  document.getElementById("coverDate").value = coverDate;
  updateWeekDisplay();
}

// ── Period modal ───────────────────────────────────────────────

function initializePeriodModal() {
  const startDate = getCachedTenWeekStart();
  const dateInput = document.getElementById("tenWeekStartDate");
  dateInput.value = startDate || new Date().toISOString().split('T')[0];
  updatePeriodStatus();
}

function updatePeriodStatus() {
  const startDate = getCachedTenWeekStart();
  if (!startDate) {
    document.getElementById("periodStatus").innerHTML = "Not set. Will initialize on first use.";
    return;
  }
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 69);
  const weeksElapsed = Math.floor((new Date() - start) / 604800000) + 1;
  document.getElementById("periodStatus").innerHTML =
    `Started: ${start.toDateString()}<br>Ends: ${end.toDateString()}<br>Week: ${Math.min(weeksElapsed, 10)} of 10`;
}

// ── Cover history display ──────────────────────────────────────

function displayCoverHistory() {
  const history = loadCoverHistory();
  const tbody = document.getElementById("historyTableBody");

  if (history.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6' class='text-center text-muted'>No cover history yet</td></tr>";
    return;
  }

  tbody.innerHTML = history.map(entry =>
    `<tr><td>${entry.date}</td><td>${entry.week}</td><td>${entry.coveredTeacher}</td><td>${entry.coverTeacher}</td><td>${entry.period}</td><td>${entry.subject}</td></tr>`
  ).join("");
}

// ── Print / Export helpers ─────────────────────────────────────

function getCoverPlanRows(day) {
  const rows = [];
  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    data.entries.filter(e => e.row == day).sort((a, b) => a.col - b.col).forEach((e) => {
      if (e.col === 6) return;
      rows.push({
        teacher,
        period: e.col + 1,
        subject: e.subject || e.type,
        className: e.className || "",
        venue: e.venue || "",
        assigned: coverAssignments[teacher + ":" + day + "-" + e.col] || "",
      });
    });
  });
  return rows;
}

function buildCoverGridTableHtml(day, includeActions = false) {
  const rows = getCoverPlanRows(day);
  let html = `<div class="container p-4" id="coverPrintContainer"><h3>Absent Teachers Cover Plan - Day ${day + 1}</h3>`;

  if (includeActions) {
    html += `<div hidden class="mb-3 no-print">
      <button id="printPageBtn" class="btn btn-primary me-2">Print</button>
      <button id="downloadPdfBtn" class="btn btn-success me-2">Save as PDF</button>
      <button id="downloadPngBtn" class="btn btn-secondary me-2">Save as Image</button>
      <button id="emailExportBtn" class="btn btn-info">Email</button>
    </div>`;
  }

  if (rows.length === 0) {
    return html + "<div class='alert alert-info'>No absent teacher lessons found for the selected day.</div></div>";
  }

  html += '<table class="table table-bordered"><thead><tr><th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assigned Cover</th></tr></thead><tbody>';
  html += rows.map(r => `<tr><td>${r.teacher}</td><td>${r.period}</td><td>${r.subject}</td><td>${r.className}</td><td>${r.venue}</td><td>${r.assigned}</td></tr>`).join("");
  html += "</tbody></table></div>";
  return html;
}

function openCoverPrintPreview(action = null) {
  if (absentTeachers.length === 0) {
    alert("No absent teachers selected. Please add absent teachers first.");
    return;
  }

  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const tableHtml = buildCoverGridTableHtml(day, true);

  let win = window.open("", "_blank", "width=1100,height=850");
  win.document.write(`<html><head><title>Cover Grid Print Preview</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">
    <style>
      body { background:#fff; color:#000; }
      table { table-layout: fixed; width: 100%; border-collapse: collapse; word-wrap: break-word; }
      th, td { border:1px solid #333; padding: 0.35rem; font-size:0.85rem; }
      th { background:#f4f4f4; }
      .print-table-container { page-break-inside: avoid; }
      @media print {
        body { margin: 0.5cm; }
        .no-print { display: none !important; }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; page-break-after: auto; }
      }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
  </head><body>${tableHtml}</body></html>`);
  win.document.close();
  win.focus();

  const setupActions = () => {
    try {
      const doc = win.document;
      const rows = getCoverPlanRows(day);
      const makeText = () =>
        rows.map(r => `${r.teacher} | P${r.period} | ${r.subject} | ${r.className} | ${r.venue} | ${r.assigned}`).join("\n");

      doc.getElementById("printPageBtn").onclick = () => win.print();

      doc.getElementById("downloadPdfBtn").onclick = () => {
        const { jsPDF } = window.jspdf;
        const content = doc.querySelector('.container');
        if (!content) return;
        win.html2canvas(content, { scale: 2 }).then((canvas) => {
          const imgData = canvas.toDataURL('image/png');
          const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
          const pdfW = pdf.internal.pageSize.getWidth();
          const pdfH = pdf.internal.pageSize.getHeight();
          const ratio = Math.min(pdfW / canvas.width, pdfH / canvas.height);
          const imgW = canvas.width * ratio, imgH = canvas.height * ratio;

          if (imgH <= pdfH) {
            pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
          } else {
            let remaining = canvas.height, pos = 0;
            while (remaining > 0) {
              const pageH = Math.min(remaining, Math.floor(pdfH / ratio));
              const c = document.createElement('canvas');
              c.width = canvas.width; c.height = pageH;
              c.getContext('2d').drawImage(canvas, 0, pos, canvas.width, pageH, 0, 0, canvas.width, pageH);
              pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, imgW, pageH * ratio);
              remaining -= pageH; pos += pageH;
              if (remaining > 0) pdf.addPage();
            }
          }
          pdf.save(`cover_plan_day_${day + 1}.pdf`);
        }).catch(err => { console.error('pdf generation failed', err); alert('Error generating PDF: ' + err); });
      };

      doc.getElementById("downloadPngBtn").onclick = () => {
        const content = doc.querySelector('.container');
        if (!content) return;
        win.html2canvas(content, { scale: 2 }).then(canvas => {
          const link = doc.createElement('a');
          link.download = `cover_plan_day_${day + 1}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
        }).catch(err => { console.error('png capture failed', err); alert('Error generating image: ' + err); });
      };

      doc.getElementById("emailExportBtn").onclick = () => {
        const subject = encodeURIComponent(`Absent Teachers Cover Plan - Day ${day + 1}`);
        const body = encodeURIComponent(makeText());
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      };

      if (action === "print") doc.getElementById("printPageBtn").click();
      else if (action === "pdf") doc.getElementById("downloadPdfBtn").click();
      else if (action === "image") doc.getElementById("downloadPngBtn").click();
      else if (action === "email") doc.getElementById("emailExportBtn").click();
    } catch (err) {
      console.error('setupActions failed', err);
    }
  };

  if (win.document.readyState === "complete") setupActions();
  else win.addEventListener("load", setupActions);
}

// ── Event bindings ─────────────────────────────────────────────

document.getElementById("coverDate").addEventListener("change", (e) => {
  coverDate = e.target.value;
  updateWeekDisplay();
  renderGrid();
});

document.getElementById("absenceDaySelect").onchange = () => renderGrid();

document.getElementById("addAbsenceTeacherBtn").onclick = () => {
  const sel = document.getElementById("addAbsenceTeacherSelect");
  const name = sel.value;
  if (name && !absentTeachers.includes(name)) {
    absentTeachers.push(name);
    refreshTeachers();
    renderAbsentTeachersTable();
    renderGrid();
  }
};

document.getElementById("saveBtn").onclick = () => {
  localStorage.setItem("coverPlans", JSON.stringify(coverAssignments));
  alert("Saved");
};

document.getElementById("autoAssignBtn").onclick = () => {
  if (confirm("This will automatically assign the most fair cover teachers to all unassigned lessons. Continue?")) {
    autoAssignCoverTeachers();
  }
};

document.getElementById("printBtn").onclick = () => openCoverPrintPreview();
document.getElementById("navPrintBtn").onclick = () => openCoverPrintPreview("print");
document.getElementById("navPdfBtn").onclick = () => openCoverPrintPreview("pdf");
document.getElementById("navImgBtn").onclick = () => openCoverPrintPreview("image");
document.getElementById("navEmailBtn").onclick = () => openCoverPrintPreview("email");

document.getElementById("confirmPrintBtn").onclick = () => {
  const printArea = document.getElementById("printArea");
  let win = window.open("", "", "width=900,height=700");
  win.document.write(`<html><head><title>Print Cover Plan</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">
  </head><body>${printArea.innerHTML}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
  win.close();
};

document.getElementById("emailBtn").onclick = async () => {
  const email = document.getElementById("emailInput").value;
  if (!email) { alert("Please enter a valid email address."); return; }

  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const parts = ['<h3>Absent Teachers Cover Plan</h3><table border="1" cellpadding="5" cellspacing="0"><thead><tr><th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assigned Cover</th></tr></thead><tbody>'];

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    data.entries.filter(e => e.row == day && e.type === "lesson").sort((a, b) => a.col - b.col).forEach((e) => {
      if (e.col === 6) return;
      const assigned = coverAssignments[teacher + ":" + day + "-" + e.col] || "";
      parts.push(`<tr><td>${teacher}</td><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ""}</td><td>${e.venue || ""}</td><td>${assigned}</td></tr>`);
    });
  });
  parts.push("</tbody></table>");

  const html = parts.join("");
  const subject = encodeURIComponent("Absent Teachers Cover Plan");
  const body = encodeURIComponent(html.replace(/<[^>]+>/g, ""));
  window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
};

// BULK IMPORT
document.getElementById("bulkBtn").onclick = () => document.getElementById("bulkInput").click();

document.getElementById("bulkInput").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  let count = 0;
  for (const f of files) {
    if (!f.name.endsWith(".json")) continue;
    const data = JSON.parse(await f.text());
    const name = data.teacherName || f.name.replace(".json", "");
    localStorage.setItem(PREFIX + name, JSON.stringify(data));
    teacherCache[name] = data; // populate cache immediately
    count++;
  }
  document.getElementById("status").innerText = "Imported " + count;
  refreshTeachers();
  renderGrid();
});

document.getElementById("clearBtn").onclick = () => {
  if (confirm("Are you sure you want to clear ALL data? This includes timetables, covers, metrics, and history.")) {
    const keysToRemove = [];
    for (let i = 0, len = localStorage.length; i < len; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(PREFIX) || k === "coverPlans" || k === METRICS_KEY || k === HISTORY_KEY) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    teacherCache = {};
    coverAssignments = {};
    noCoverNeeded = {};
    tallies = {};
    _metricsCache = null;
    _historyCache = null;
    document.getElementById("status").innerText = "All data cleared.";
    refreshTeachers();
    renderAbsentTeachersTable();
    renderGrid();
  }
};

document.getElementById("exportBtn").onclick = () => {
  const data = {
    coverAssignments,
    noCoverNeeded,
    metrics: loadMetrics(),
    history: loadCoverHistory(),
    tenWeekStart: getCachedTenWeekStart()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cover_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(a.href); // free memory
};

document.getElementById("importBtn").onclick = () => document.getElementById("importMetricsInput").click();

document.getElementById("importMetricsInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());

  coverAssignments = data.coverAssignments || {};
  noCoverNeeded = data.noCoverNeeded || {};
  saveMetrics(data.metrics || {});
  if (data.history) saveCoverHistory(data.history);
  if (data.tenWeekStart) setCachedTenWeekStart(data.tenWeekStart);

  renderGrid();
  alert("Backup restored successfully!");
});

// EXCEL EXPORT
document.getElementById("exportExcelBtn").onclick = () => {
  if (!window.XLSX) {
    alert("Excel library not loaded. Please check your internet connection.");
    return;
  }

  const history = loadCoverHistory();
  const metrics = loadMetrics();

  if (history.length === 0 && Object.keys(metrics).length === 0) {
    alert("No cover data to export. Please assign some covers first.");
    return;
  }

  const wb = XLSX.utils.book_new();
  const currentWeek = getWeekNumber(coverDate);
  const histStats = buildHistoryStats(history, currentWeek);

  // Sheet 1: Summary
  const summaryData = [["Teacher", "Total Covers", "Covers This Week", "Per-Week Average", "Free Periods"]];
  for (const teacher in metrics) {
    const hs = histStats[teacher] || { total: 0, thisWeek: 0, coversPerWeek: "0.00" };
    summaryData.push([teacher, hs.total, hs.thisWeek, parseFloat(hs.coversPerWeek).toFixed(2), metrics[teacher].freePeriods || 0]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "Summary");

  // Sheet 2: Weekly Breakdown (single pass)
  const teachers = new Set(history.map(h => h.coverTeacher));
  const weekCounts = {}; // { teacher: { week: count } }
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (!weekCounts[h.coverTeacher]) weekCounts[h.coverTeacher] = {};
    weekCounts[h.coverTeacher][h.week] = (weekCounts[h.coverTeacher][h.week] || 0) + 1;
  }
  const weeklyData = [["Teacher", "Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6", "Week 7", "Week 8", "Week 9", "Week 10"]];
  teachers.forEach(t => {
    const row = [t];
    for (let w = 1; w <= 10; w++) row.push((weekCounts[t] && weekCounts[t][w]) || 0);
    weeklyData.push(row);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(weeklyData), "Weekly Breakdown");

  // Sheet 3: Detailed History
  const detailedData = [["Date", "Week", "Covered Teacher", "Cover Teacher", "Day", "Period", "Subject", "Class", "Venue"]];
  history.forEach(e => detailedData.push([e.date, e.week, e.coveredTeacher, e.coverTeacher, e.day, e.period, e.subject, e.className, e.venue]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailedData), "Detailed History");

  // Sheet 4: Statistics
  const totalCovers = history.length;
  const uniqueTeachers = teachers.size;
  const coverCounts = Array.from(teachers).map(t => histStats[t]?.total || 0);
  const minC = Math.min(...coverCounts), maxC = Math.max(...coverCounts);
  const statsData = [
    ["Statistic", "Value"],
    ["Total Cover Sessions", totalCovers],
    ["Number of Teachers", uniqueTeachers],
    ["Average Covers per Teacher", (totalCovers / uniqueTeachers).toFixed(2)],
    ["Minimum Covers", minC],
    ["Maximum Covers", maxC],
    ["Fairness Ratio (Max/Min)", minC > 0 ? (maxC / minC).toFixed(2) : "N/A"]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statsData), "Statistics");

  XLSX.writeFile(wb, `cover_report_${new Date().toISOString().split('T')[0]}.xlsx`);
};

// ── Initialization ─────────────────────────────────────────────

refreshTeachers();
renderAbsentTeachersTable();
renderGrid();
initializeDatePicker();
initializeTenWeekPeriod();
autoPruneOldEntries();

document.addEventListener('show.bs.modal', (e) => {
  if (e.target.id === 'historyModal') displayCoverHistory();
  else if (e.target.id === 'tenWeekModal') initializePeriodModal();
});

document.querySelector('.sidebar-hover-trigger')?.addEventListener('click', () => {
  const sidebar = document.getElementById('sidebarContainer');
  sidebar.style.left = sidebar.style.left === '0px' ? '-350px' : '0';
});

document.getElementById("savePeriodBtn").onclick = () => {
  const newStartDate = document.getElementById("tenWeekStartDate").value;
  if (newStartDate) {
    setCachedTenWeekStart(newStartDate);
    updatePeriodStatus();
    updateWeekDisplay();
    renderGrid();
    alert("10-week period updated!");
  }
};

document.getElementById("resetPeriodBtn").onclick = () => {
  if (confirm("Reset the 10-week period? This will mark today as Week 1.")) {
    const today = new Date().toISOString().split('T')[0];
    setCachedTenWeekStart(today);
    document.getElementById("tenWeekStartDate").value = today;
    updatePeriodStatus();
    coverDate = today;
    document.getElementById("coverDate").value = today;
    updateWeekDisplay();
    renderGrid();
    alert("10-week period has been reset!");
  }
};

async function generatePDF() {
  try {
    if (!window.jspdf) { alert("jsPDF library not loaded. Please check your internet connection."); return; }
    if (absentTeachers.length === 0) { alert("No absent teachers selected. Please add absent teachers first."); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape" });
    const day = parseInt(document.getElementById("absenceDaySelect").value) + 1;
    let y = 15;

    doc.setFontSize(16);
    doc.text(`Absent Teachers Cover Plan - Day ${day}`, 14, y);
    y += 10;
    doc.setFontSize(10);

    absentTeachers.forEach((teacher) => {
      const data = loadTeacher(teacher);
      if (!data) return;
      const lessons = data.entries.filter(e => e.row == (day - 1) && e.type === "lesson").sort((a, b) => a.col - b.col);
      if (lessons.length === 0) return;

      doc.setFont(undefined, "bold");
      doc.text(teacher, 14, y);
      y += 6;
      doc.setFont(undefined, "normal");

      lessons.forEach((e) => {
        const key = teacher + ":" + (day - 1) + "-" + e.col;
        const assigned = coverAssignments[key] || "⚠ NOT ASSIGNED";
        const line = `P${e.col + 1} | ${e.subject || ""} | ${e.className || ""} | ${e.venue || ""} | Cover: ${assigned}`;
        const split = doc.splitTextToSize(line, 180);
        doc.text(split, 16, y);
        y += split.length * 5;
        if (y > 270) { doc.addPage(); y = 15; }
      });
      y += 4;
    });

    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    window.open(url);
  } catch (error) {
    alert("Error generating PDF: " + error.message);
  }
}
