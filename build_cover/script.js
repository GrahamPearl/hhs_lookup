const PREFIX = "teacher_";
const LAST_STRATEGY_KEY = "lastAutoAssignStrategy";
const LAST_REASON_KEY = "lastAbsenceReason";

let teacherCache = {};
let coverAssignments = {};
let noCoverNeeded = {};
let tallies = {};
let absentTeachers = [];
let partialAbsentTeachers = {};
let absentTeacherReasons = {}; // NEW: { teacherName: reasonString }
let nextPrintAction = null;
let coverDate = new Date().toISOString().split("T")[0];

let avoidYesterdayStrict = false;
let fallbackUsed = false;
let fallbackTeachers = new Set();
let previewAssignments = {};
let previewNoCoverNeeded = {};
let preAutoAssignState = null;
let _lastPreviewConflicts = 0;

const METRICS_KEY = "teacherMetrics";
const HISTORY_KEY = "coverHistory";
const TEN_WEEK_START = "tenWeekStart";
const HISTORY_BACKUP_KEY = "coverHistoryBackup";
const LAST_AUTO_CLEAR_KEY = "lastAutoCleared";
const HISTORY_LOG_KEY = "coverHistoryLog";
const FAIRNESS_SETTINGS_KEY = "fairnessSettings";
const ABSENCE_REASONS_KEY = "reasonsForAbsent";

const DEFAULT_FAIRNESS_SETTINGS = {
  excludeDnd: true,
  freePeriodsOnly: false,
  maxCoversPerDay: 2,
  maxCoversPerWeek: 3,
  useLastResort: true,
};

const DEFAULT_ABSENCE_REASONS = [
  "Sick Leave",
  "Annual Leave",
  "Professional Development",
  "Medical Appointment",
  "Training",
  "Conference",
  "Emergency",
  "Other",
];

const DASHBOARD_BODY_KEY = "dashboardSummaryExpanded";

document.addEventListener("DOMContentLoaded", () => {
  const body = document.getElementById("dashboardSummaryBody");
  const icon = document.getElementById("dashboardSummaryToggleIcon");
  const btn = document.getElementById("dashboardSummaryToggleBtn");
  if (!body || !icon || !btn || !window.bootstrap) return;

  const saved = localStorage.getItem(DASHBOARD_BODY_KEY);
  const expanded = saved === "true";

  document.addEventListener("DOMContentLoaded", () => {
    const body2 = document.getElementById("dashboardSummaryBody");
    const icon2 = document.getElementById("dashboardToggleIcon");
    const btn2 = document.getElementById("dashboardToggleBtn");
    if (!body2 || !icon2 || !btn2) return;
    const isShown = body2.classList.contains("show");
    btn2.setAttribute("aria-expanded", isShown ? "true" : "false");
    icon2.textContent = isShown ? "▼" : "▶";
    body2.addEventListener("shown.bs.collapse", () => {
      btn2.setAttribute("aria-expanded", "true");
      icon2.textContent = "▼";
    });
    body2.addEventListener("hidden.bs.collapse", () => {
      btn2.setAttribute("aria-expanded", "false");
      icon2.textContent = "▶";
    });
  });

  const collapse = bootstrap.Collapse.getOrCreateInstance(body, {
    toggle: false,
  });
  if (expanded) collapse.show();
  else collapse.hide();
  btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  icon.textContent = expanded ? "▼" : "▶";
  body.addEventListener("shown.bs.collapse", () => {
    localStorage.setItem(DASHBOARD_BODY_KEY, "true");
    btn.setAttribute("aria-expanded", "true");
    icon.textContent = "▼";
  });
  body.addEventListener("hidden.bs.collapse", () => {
    localStorage.setItem(DASHBOARD_BODY_KEY, "false");
    btn.setAttribute("aria-expanded", "false");
    icon.textContent = "▶";
  });
});

function getHeatmapClass(t) {
  const total = t.totalCovers || 0;
  const week = t.coversThisWeek || 0;

  // simple weighting
  const score = total + week * 1.5;

  if (score <= 2) return "heat-low";
  if (score <= 5) return "heat-medium";
  return "heat-high";
}

// ── Fairness settings ──────────────────────────────────────────
function loadFairnessSettings() {
  const stored = localStorage.getItem(FAIRNESS_SETTINGS_KEY);
  return stored ? JSON.parse(stored) : DEFAULT_FAIRNESS_SETTINGS;
}
function saveFairnessSettings(s) {
  localStorage.setItem(FAIRNESS_SETTINGS_KEY, JSON.stringify(s));
}
function getFairnessSettings() {
  return loadFairnessSettings();
}

// ── Smart defaults ─────────────────────────────────────────────
function saveLastStrategy(s) {
  localStorage.setItem(LAST_STRATEGY_KEY, s);
}
function getLastStrategy() {
  return localStorage.getItem(LAST_STRATEGY_KEY) || "fair";
}
function saveLastReason(r) {
  localStorage.setItem(LAST_REASON_KEY, r);
}
function getLastReason() {
  return localStorage.getItem(LAST_REASON_KEY) || "";
}

// ── Absence Reason Management ──────────────────────────────────
function loadAbsenceReasons() {
  const stored = localStorage.getItem(ABSENCE_REASONS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return DEFAULT_ABSENCE_REASONS;
    }
  }
  return DEFAULT_ABSENCE_REASONS;
}
function saveAbsenceReasons(r) {
  localStorage.setItem(ABSENCE_REASONS_KEY, JSON.stringify(r));
}
function getAbsenceReasons() {
  return loadAbsenceReasons();
}

function addAbsenceReason(reason) {
  if (!reason.trim()) return false;
  const reasons = loadAbsenceReasons();
  const trimmed = reason.trim();
  if (!reasons.includes(trimmed)) {
    reasons.push(trimmed);
    saveAbsenceReasons(reasons);
    return true;
  }
  return false;
}
function removeAbsenceReason(reason) {
  const reasons = loadAbsenceReasons();
  const filtered = reasons.filter((r) => r !== reason);
  if (filtered.length < reasons.length) {
    saveAbsenceReasons(filtered);
    return true;
  }
  return false;
}

// ── Indexed teacher entry lookup ───────────────────────────────
const _entryIndex = {};
function _buildEntryIndex(name, data) {
  if (!data || !data.entries) return;
  const idx = new Map();
  for (let i = 0, len = data.entries.length; i < len; i++) {
    const e = data.entries[i];
    idx.set(e.row + "-" + e.col, e);
  }
  _entryIndex[name] = idx;
}
function getTeacherEntry(name, row, col) {
  const idx = _entryIndex[name];
  return idx ? idx.get(row + "-" + col) : undefined;
}

// ── Cached localStorage accessors ──────────────────────────────
let _metricsCache = null;
let _historyCache = null;
let _tenWeekStartCache = undefined;
let _teacherNamesCache = null;
let _startDateObj = null;

function loadMetrics() {
  if (_metricsCache === null)
    _metricsCache = JSON.parse(localStorage.getItem(METRICS_KEY) || "{}");
  return _metricsCache;
}
function saveMetrics(m) {
  _metricsCache = m;
  localStorage.setItem(METRICS_KEY, JSON.stringify(m));
}

function loadCoverHistory() {
  if (_historyCache === null)
    _historyCache = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  return _historyCache;
}
function saveCoverHistory(h) {
  _historyCache = h;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}

function getCachedTenWeekStart() {
  if (_tenWeekStartCache === undefined)
    _tenWeekStartCache = localStorage.getItem(TEN_WEEK_START);
  return _tenWeekStartCache;
}
function setCachedTenWeekStart(val) {
  _tenWeekStartCache = val;
  _startDateObj = null;
  localStorage.setItem(TEN_WEEK_START, val);
}

window.addEventListener("storage", (e) => {
  if (e.key === METRICS_KEY) _metricsCache = null;
  else if (e.key === HISTORY_KEY) _historyCache = null;
  else if (e.key === TEN_WEEK_START) {
    _tenWeekStartCache = undefined;
    _startDateObj = null;
  } else if (e.key && e.key.startsWith(PREFIX)) {
    const name = e.key.slice(PREFIX.length);
    delete teacherCache[name];
    delete _entryIndex[name];
    _teacherNamesCache = null;
  }
});

// ── 10-week period helpers ─────────────────────────────────────
function initializeTenWeekPeriod() {
  if (!getCachedTenWeekStart())
    setCachedTenWeekStart(new Date().toISOString().split("T")[0]);
}
function getWeekNumber(dateStr) {
  if (!_startDateObj) {
    initializeTenWeekPeriod();
    _startDateObj = new Date(getCachedTenWeekStart());
  }
  const diffDays = Math.floor((new Date(dateStr) - _startDateObj) / 86400000);
  return Math.min(Math.max(Math.floor(diffDays / 7) + 1, 1), 10);
}

// ── Fairness constraint helpers ────────────────────────────────

function isTeacherDndGlobal(name) {
  const data = loadTeacher(name);
  if (!data || !data.entries) return false;
  return data.entries.some((e) => e.doNotDisturb);
}

function isTeacherDnd(name, day, period) {
  const entry = getTeacherEntry(name, day, period);
  return !!(entry && entry.doNotDisturb);
}
function isLastResortTeacher(name) {
  return !!loadTeacher(name)?.lastResort;
}
function countCoversForTeacherOnDay(name) {
  return loadCoverHistory().filter(
    (h) =>
      h.coverTeacher === name &&
      new Date(h.date).toISOString().split("T")[0] === coverDate,
  ).length;
}
function countCoversForTeacherThisWeek(name) {
  const week = getWeekNumber(coverDate);
  return loadCoverHistory().filter(
    (h) => h.coverTeacher === name && h.week === week,
  ).length;
}

// ── Partial absence period guard ──────────────────────────────
function isPartialAbsentInPeriod(name, period) {
  const periods = partialAbsentTeachers[name];
  return Array.isArray(periods) && periods.includes(period);
}
function buildTallies() {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  const t = {};
  for (const h of history) {
    const n = h.coverTeacher;
    if (!t[n]) t[n] = { daily: 0, weekly: 0 };
    if (new Date(h.date).toISOString().split("T")[0] === coverDate)
      t[n].daily++;
    if (h.week === week) t[n].weekly++;
  }
  return t;
}

// ── Strict per-candidate fairness check ────────────────────────
// Returns "ok" | "lastResort" | "capExceeded" | "skip"
function candidateStatus(name, day, period, tallies, settings) {
  const tc = tallies[name] || { daily: 0, weekly: 0 };
  const lr = isLastResortTeacher(name);
  const dnd = settings.excludeDnd && isTeacherDnd(name, day, period);

  if (dnd) return "skip";

  if (settings.freePeriodsOnly) {
    const entry = getTeacherEntry(name, day, period);
    if (!entry || entry.type !== "free") return "skip";
  }

  const dailyHit = tc.daily >= settings.maxCoversPerDay;
  const weeklyHit = tc.weekly >= settings.maxCoversPerWeek;

  if (dailyHit || weeklyHit) {
    // Cap exceeded — only usable if useLastResort is on; label as capExceeded
    return settings.useLastResort ? "capExceeded" : "skip";
  }

  // Within caps — distinguish LR-tagged teachers so they sort last
  return lr ? "lastResort" : "ok";
}

// ── Pick best candidate from a period's available list ─────────
// Returns { name, status } | null   (status: "ok"|"lastResort"|"capExceeded")
function pickCandidate(period, day, tallies, settings, skipNames) {
  const avail = getAllAvailableTeachers(day, absentTeachers)[period] || [];
  const ok = [],
    lr = [],
    cap = [];

  for (const t of avail) {
    if (skipNames.has(t.name)) continue;
    const status = candidateStatus(t.name, day, period, tallies, settings);
    if (status === "ok") ok.push(t);
    else if (status === "lastResort") lr.push(t);
    else if (status === "capExceeded") cap.push(t);
  }

  const sort = (arr) =>
    arr.sort(
      (a, b) =>
        (tallies[a.name]?.weekly || 0) - (tallies[b.name]?.weekly || 0) ||
        a.totalCovers - b.totalCovers,
    );
  sort(ok);
  sort(lr);
  sort(cap);

  // Priority: regular → last-resort-tagged → cap-exceeded
  if (ok.length) return { name: ok[0].name, status: "ok" };
  if (lr.length) return { name: lr[0].name, status: "lastResort" };
  if (cap.length) return { name: cap[0].name, status: "capExceeded" };
  return null;
}

// ── Batch history stats ────────────────────────────────────────
function buildHistoryStats(history, currentWeek) {
  const stats = {};
  for (let i = 0, len = history.length; i < len; i++) {
    const h = history[i],
      t = h.coverTeacher;
    if (!stats[t]) stats[t] = { total: 0, thisWeek: 0, relevantTotal: 0 };
    stats[t].total++;
    if (h.week === currentWeek) stats[t].thisWeek++;
    if (h.week <= currentWeek) stats[t].relevantTotal++;
  }
  for (const t in stats)
    stats[t].coversPerWeek =
      currentWeek > 0
        ? (stats[t].relevantTotal / currentWeek).toFixed(2)
        : "0.00";
  return stats;
}

function getCoversThisWeek(coverTeacher) {
  const week = getWeekNumber(coverDate);
  let count = 0;
  const history = loadCoverHistory();
  for (let i = 0, len = history.length; i < len; i++)
    if (history[i].coverTeacher === coverTeacher && history[i].week === week)
      count++;
  return count;
}
function getTotalCovers(coverTeacher) {
  const history = loadCoverHistory();
  let count = 0;
  for (let i = 0, len = history.length; i < len; i++)
    if (history[i].coverTeacher === coverTeacher) count++;
  return count;
}
function getCoversPerWeekAverage(coverTeacher) {
  const history = loadCoverHistory(),
    week = getWeekNumber(coverDate);
  let count = 0;
  for (let i = 0, len = history.length; i < len; i++)
    if (history[i].coverTeacher === coverTeacher && history[i].week <= week)
      count++;
  return count === 0 ? 0 : (count / week).toFixed(2);
}

// ── Teacher data helpers ───────────────────────────────────────
function loadTeacher(name) {
  if (!teacherCache[name]) {
    const raw = localStorage.getItem(PREFIX + name);
    if (raw) {
      const data = JSON.parse(raw);
      teacherCache[name] = data;
      _buildEntryIndex(name, data);
    }
  }
  return teacherCache[name];
}
function calculateFreePeriods(name) {
  const data = loadTeacher(name);
  if (!data || !data.entries) return 0;
  let count = 0;
  for (let i = 0, len = data.entries.length; i < len; i++)
    if (data.entries[i].type === "free") count++;
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
      lastCoverDate: null,
    };
    saveMetrics(metrics);
  }
}
function getTeacherNames() {
  if (_teacherNamesCache) return _teacherNamesCache;
  const names = [];
  for (let i = 0, len = localStorage.length; i < len; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(PREFIX)) names.push(k.slice(PREFIX.length));
  }
  _teacherNamesCache = names;
  return names;
}

// ── Cover history entry ────────────────────────────────────────
function addCoverHistoryEntry(
  coveredTeacher,
  coverTeacher,
  period,
  day,
  subject,
  className,
  venue,
) {
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
    absentReason: absentTeacherReasons[coveredTeacher] || "", // NEW
    timestamp: new Date().toISOString(),
  });
  saveCoverHistory(history);
}

// ── Auto-prune ─────────────────────────────────────────────────
function autoPruneOldEntries() {
  const history = loadCoverHistory(),
    tenWeekStart = getCachedTenWeekStart();
  if (!tenWeekStart) return;
  const cutoff = new Date(tenWeekStart);
  cutoff.setDate(cutoff.getDate() + 70);
  const pruned = history.filter((h) => new Date(h.date) >= cutoff);
  if (pruned.length !== history.length) saveCoverHistory(pruned);
}

// ── Available teachers (all periods, single pass) ──────────────
function getAllAvailableTeachers(day, absentList) {
  const settings = getFairnessSettings();
  const assignedByPeriod = {};

  for (const key in coverAssignments) {
    const idx = key.indexOf(":");
    if (idx === -1) continue;
    const dp = key.slice(idx + 1),
      dashIdx = dp.indexOf("-");
    const d = parseInt(dp.slice(0, dashIdx)),
      p = parseInt(dp.slice(dashIdx + 1));
    if (d === day) {
      if (!assignedByPeriod[p]) assignedByPeriod[p] = new Set();
      assignedByPeriod[p].add(coverAssignments[key]);
    }
  }
  const absentSet = new Set(absentList),
    allNames = getTeacherNames(),
    result = {};
  for (let p = 0; p < 6; p++) result[p] = [];

  for (let i = 0, len = allNames.length; i < len; i++) {
    const name = allNames[i];
    if (absentSet.has(name)) continue;
    const data = loadTeacher(name);
    if (!data || !data.entries) continue;
    for (let p = 0; p < 6; p++) {
      const assigned = assignedByPeriod[p];
      if (assigned && assigned.has(name)) continue;
      const entry = getTeacherEntry(name, day, p);
      if (entry && (entry.type === "free" || entry.type === "meeting")) {
        if (settings.freePeriodsOnly && entry.type === "meeting") continue;
        result[p].push({ name, type: entry.type });
      }
    }
  }

  const metrics = loadMetrics();
  let metricsChanged = false;
  const seen = new Set();
  for (let p = 0; p < 6; p++) {
    for (let j = 0; j < result[p].length; j++) {
      const tName = result[p][j].name;
      if (seen.has(tName)) continue;
      seen.add(tName);
      if (!metrics[tName]) {
        metrics[tName] = {
          freePeriods: calculateFreePeriods(tName),
          coversDone: 0,
          coversThisWeek: 0,
          totalCovers: 0,
          lastCoverDate: null,
        };
        metricsChanged = true;
      }
    }
  }
  if (metricsChanged) saveMetrics(metrics);

  const history = loadCoverHistory(),
    currentWeek = getWeekNumber(coverDate);
  const histStats = buildHistoryStats(history, currentWeek);

  for (let p = 0; p < 6; p++) {
    const fairness = fairnessFilterCandidates({
      candidates: result[p],
      day,
      period: p,
      settings,
    });

    let filtered = fairness.filtered;

    // ✅ propagate fallback info to UI
    if (fairness.fallbackUsedLocal) {
      fallbackUsed = true;
      fairness.fallbackTeachersLocal.forEach((t) => fallbackTeachers.add(t));
    }

    let regularTeachers = [],
      lastResortTeachers = [];
    for (let j = 0; j < filtered.length; j++) {
      const t = filtered[j];
      const m = metrics[t.name] || { freePeriods: 0, coversDone: 0 };
      const hs = histStats[t.name] || {
        total: 0,
        thisWeek: 0,
        coversPerWeek: "0.00",
      };
      t.freePeriods = m.freePeriods;
      t.coversDone = m.coversDone || 0;
      t.coversThisWeek = hs.thisWeek;
      t.totalCovers = hs.total;
      t.coversPerWeek = hs.coversPerWeek;

      t.isLastResort = isLastResortTeacher(t.name);
      if (settings.useLastResort && t.isLastResort) lastResortTeachers.push(t);
      else regularTeachers.push(t);
    }

    const sortFn = (a, b) => {
      if (a.totalCovers !== b.totalCovers) return a.totalCovers - b.totalCovers;
      if (a.coversThisWeek !== b.coversThisWeek)
        return a.coversThisWeek - b.coversThisWeek;
      const aDiff = parseFloat(a.coversPerWeek),
        bDiff = parseFloat(b.coversPerWeek);
      if (aDiff !== bDiff) return aDiff - bDiff;
      return b.freePeriods - a.freePeriods;
    };
    regularTeachers.sort(sortFn);
    lastResortTeachers.sort(sortFn);
    result[p] = regularTeachers.concat(lastResortTeachers);
  }

  return result;
}

function getAvailableTeachers(period, day, absentList) {
  let available = getAllAvailableTeachers(day, absentList)[period] || [];
  available = available.filter((teacher) => {
    if (partialAbsentTeachers[teacher.name]) {
      return !partialAbsentTeachers[teacher.name].includes(period);
    }
    return true;
  });
  return available;
}

// ── UI: refresh teacher dropdown ───────────────────────────────
function refreshTeachers() {
  const sel = document.getElementById("addAbsenceTeacherSelect");
  if (!sel) return;
  const absentSet = new Set([
    ...absentTeachers,
    ...Object.keys(partialAbsentTeachers),
  ]);
  const names = getTeacherNames().filter((n) => !absentSet.has(n));
  names.sort();
  sel.innerHTML = names
    .map((n) => `<option value="${n}">${n}</option>`)
    .join("");
}

// ── Unified Add Absence Modal ──────────────────────────────────
function openAddAbsenceModal(name) {
  if (!name) return;

  // Teacher display
  document.getElementById("addAbsenceTeacherDisplay").textContent = name;

  // Populate reason dropdown with current reasons list
  const sel = document.getElementById("addAbsenceReasonSelect");
  const reasons = getAbsenceReasons();
  sel.innerHTML = '<option value="">-- Select reason --</option>';
  reasons.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    sel.appendChild(opt);
  });
  // Pre-select last used reason as convenience default
  sel.value = getLastReason();

  // Reset type to Full Day
  document.getElementById("absenceTypeFull").checked = true;
  document.getElementById("addAbsencePeriodSection").style.display = "none";
  document
    .querySelectorAll(".add-period-checkbox")
    .forEach((cb) => (cb.checked = false));

  window._pendingAbsenceTeacher = name;
  new bootstrap.Modal(document.getElementById("addAbsenceModal")).show();
}

// Radio toggle: show/hide period checkboxes
document
  .getElementById("absenceTypePartial")
  ?.addEventListener("change", () => {
    document.getElementById("addAbsencePeriodSection").style.display = "block";
  });
document.getElementById("absenceTypeFull")?.addEventListener("change", () => {
  document.getElementById("addAbsencePeriodSection").style.display = "none";
});

// Confirm absence
document
  .getElementById("confirmAddAbsenceBtn")
  ?.addEventListener("click", () => {
    const teacher = window._pendingAbsenceTeacher;
    if (!teacher) return;

    const reason = document.getElementById("addAbsenceReasonSelect").value;
    const isPartial = document.getElementById("absenceTypePartial").checked;

    if (isPartial) {
      const selectedPeriods = [];
      document
        .querySelectorAll(".add-period-checkbox:checked")
        .forEach((cb) => selectedPeriods.push(parseInt(cb.value)));
      if (selectedPeriods.length === 0) {
        alert("Please select at least one period for partial absence.");
        return;
      }
      // Remove from full absent if present
      const idx = absentTeachers.indexOf(teacher);
      if (idx > -1) absentTeachers.splice(idx, 1);
      partialAbsentTeachers[teacher] = selectedPeriods;
    } else {
      if (!absentTeachers.includes(teacher)) absentTeachers.push(teacher);
      delete partialAbsentTeachers[teacher];
    }

    // Record reason per teacher and remember as last used
    absentTeacherReasons[teacher] = reason;
    saveLastReason(reason);

    bootstrap.Modal.getInstance(
      document.getElementById("addAbsenceModal"),
    )?.hide();
    window._pendingAbsenceTeacher = null;

    refreshTeachers();
    renderAbsentTeachersTable();
    scheduleRenderGrid();
  });

// ── UI: absent teachers table ──────────────────────────────────
function renderAbsentTeachersTable() {
  const tableBody = document.querySelector("#absentTeachersTable tbody");
  tableBody.innerHTML = absentTeachers
    .map((name, idx) => {
      const reason = absentTeacherReasons[name]
        ? `<br><small class="text-muted fst-italic">${absentTeacherReasons[name]}</small>`
        : "";
      return `<tr>
        <td>${name}${reason}</td>
        <td><span class="badge bg-danger">Full Day</span></td>
        <td><button class="btn btn-sm btn-danger" data-remove-idx="${idx}">Remove</button></td>
      </tr>`;
    })
    .join("");

  tableBody.onclick = (e) => {
    const btn = e.target.closest("[data-remove-idx]");
    if (!btn) return;
    const removedName = absentTeachers[parseInt(btn.dataset.removeIdx)];
    absentTeachers.splice(parseInt(btn.dataset.removeIdx), 1);
    delete absentTeacherReasons[removedName];
    refreshTeachers();
    renderAbsentTeachersTable();
    renderPartialAbsentList();
    scheduleRenderGrid();
  };

  renderPartialAbsentList();
}

function renderPartialAbsentList() {
  const list = document.getElementById("partialAbsentList");
  const partialList = Object.entries(partialAbsentTeachers)
    .map(([name, periods]) => {
      const periodLabels = periods.map((p) => `P${p + 1}`).join(", ");
      const reason = absentTeacherReasons[name]
        ? `<small class="text-muted fst-italic d-block">${absentTeacherReasons[name]}</small>`
        : "";
      return `
        <div class="list-group-item d-flex justify-content-between align-items-center">
          <div>
            <strong>${name}</strong>
            <br><small class="text-muted">Absent: ${periodLabels}</small>
            ${reason}
          </div>
          <button class="btn btn-sm btn-danger" onclick="removePartialAbsence('${name}')">Remove</button>
        </div>`;
    })
    .join("");
  list.innerHTML =
    partialList || '<div class="text-muted small">No partial absences</div>';
}

function removePartialAbsence(teacherName) {
  delete partialAbsentTeachers[teacherName];
  delete absentTeacherReasons[teacherName];
  renderPartialAbsentList();
  refreshTeachers();
  scheduleRenderGrid();
}

// ── Debounced renderGrid ───────────────────────────────────────
let _renderGridRAF = null;
function scheduleRenderGrid() {
  if (_renderGridRAF !== null) return;
  _renderGridRAF = requestAnimationFrame(() => {
    _renderGridRAF = null;
    renderGrid();
  });
}

// ── Dashboard Summary ──────────────────────────────────────────
function updateDashboardSummary() {
  const history = loadCoverHistory ? loadCoverHistory() : [];
  if (history.length === 0) {
    document.getElementById("fairnessScoreDisplay").textContent = "--";
    document.getElementById("totalCoversDisplay").textContent = "0";
    document.getElementById("teacherCountDisplay").textContent = "0";
    document.getElementById("imbalanceRatioDisplay").textContent = "--";
    document.getElementById("dashboardTrend").textContent =
      "No data yet. Complete assignments to see fairness metrics.";
    return;
  }
  const totals = {};
  for (const h of history)
    totals[h.coverTeacher] = (totals[h.coverTeacher] || 0) + 1;
  const values = Object.values(totals);
  const min = Math.min(...values),
    max = Math.max(...values);
  const avg = (values.reduce((s, v) => s + v, 0) / values.length).toFixed(1);
  const ratio = (max / min).toFixed(2);
  const imbalance = (max - min) / avg;
  const score = Math.max(0, Math.min(100, Math.round(100 - imbalance * 10)));

  document.getElementById("fairnessScoreDisplay").textContent = score;
  document.getElementById("totalCoversDisplay").textContent = history.length;
  document.getElementById("teacherCountDisplay").textContent =
    Object.keys(totals).length;
  document.getElementById("imbalanceRatioDisplay").textContent = ratio;

  let trend = "";
  if (score >= 85)
    trend = "✓ Excellent fairness balance. Continue current strategy.";
  else if (score >= 70)
    trend = "⚠️ Good fairness. Monitor for imbalance in next assignments.";
  else if (score >= 50)
    trend = "⚠️ Fair balance. Consider using Day-Balancing strategy.";
  else
    trend = "⚠️ Imbalanced. Strongly recommend Fair or Day-Balancing strategy.";
  document.getElementById("dashboardTrend").textContent = trend;
}

// ── Unified state accessors ────────────────────────────────────
function getAppState() {
  return {
    coverDate,
    day: parseInt(document.getElementById("absenceDaySelect").value),
    absentTeachers: [...absentTeachers],
    partialAbsentTeachers: { ...partialAbsentTeachers },
    absentTeacherReasons: { ...absentTeacherReasons },
    coverAssignments: { ...coverAssignments },
    noCoverNeeded: { ...noCoverNeeded },
  };
}

function applyAppState(data) {
  // Global variables
  if (data.coverDate) coverDate = data.coverDate;
  if (data.absentTeachers) absentTeachers = [...data.absentTeachers];
  if (data.partialAbsentTeachers)
    partialAbsentTeachers = { ...data.partialAbsentTeachers };
  if (data.absentTeacherReasons)
    absentTeacherReasons = { ...data.absentTeacherReasons };
  if (data.coverAssignments)
    Object.assign(coverAssignments, data.coverAssignments);
  if (data.noCoverNeeded) Object.assign(noCoverNeeded, data.noCoverNeeded);

  // Sync date inputs
  if (data.coverDate) {
    document.getElementById("coverDate").value = data.coverDate;
    updateWeekDisplay();
  }
  if (data.day !== undefined)
    document.getElementById("absenceDaySelect").value = String(data.day);

  // Render sequence
  refreshTeachers();
  renderAbsentTeachersTable();
  scheduleRenderGrid();
}

// ── Centralised full snapshot (includes persistence layers) ───
function getDailyAllocationState() {
  return {
    ...getAppState(),
    absenceReasons: loadAbsenceReasons(),
    fairnessSettings: loadFairnessSettings(),
    history: loadCoverHistory(),
    metrics: loadMetrics(),
    tenWeekStart: getCachedTenWeekStart(),
    weekday: new Date(coverDate).getDay(),
  };
}

// ── Dashboard operational stats ────────────────────────────────
function updateDashboardStats() {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const totalAbsent =
    absentTeachers.length + Object.keys(partialAbsentTeachers).length;

  let assigned = 0,
    uncovered = 0;
  const allAbsent = [
    ...absentTeachers.map((t) => ({ teacher: t, periods: null })),
    ...Object.entries(partialAbsentTeachers).map(([t, p]) => ({
      teacher: t,
      periods: p,
    })),
  ];

  for (const { teacher, periods } of allAbsent) {
    const data = loadTeacher(teacher);
    if (!data) continue;
    for (const e of data.entries) {
      if (e.row !== day || e.type !== "lesson" || e.col === 6) continue;
      if (periods && !periods.includes(e.col)) continue;
      const key = `${teacher}:${day}-${e.col}`;
      if (coverAssignments[key]) assigned++;
      else if (!noCoverNeeded[key]) uncovered++;
    }
  }

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("statAbsentCount", totalAbsent);
  set("statAssignedCount", assigned);
  set("statUncoveredCount", uncovered);
}

// ── Unified UI sync ────────────────────────────────────────────
function syncUiWithState() {
  // 1. Sync date input
  document.getElementById("coverDate").value = coverDate;
  updateWeekDisplay();

  // 2. Push operational stats
  updateDashboardStats();
  updateDashboardSummary();

  // 3. Render sequence
  renderAbsentTeachersTable();
  scheduleRenderGrid();
}

function hasAnyAbsences() {
  return (
    absentTeachers.length > 0 || Object.keys(partialAbsentTeachers).length > 0
  );
}

function getCoverNeededLessons(day) {
  const items = [];
  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    data.entries
      .filter((e) => e.row == day && e.type === "lesson")
      .sort((a, b) => a.col - b.col)
      .forEach((e) => {
        if (e.col === 6) return;
        items.push({
          coveredTeacher: teacher,
          periodCol: e.col,
          entry: e,
          absenceType: "full",
          key: `${teacher}:${day}-${e.col}`,
        });
      });
  });
  Object.entries(partialAbsentTeachers).forEach(([teacher, absentPeriods]) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    data.entries
      .filter(
        (e) =>
          e.row == day && e.type === "lesson" && absentPeriods.includes(e.col),
      )
      .sort((a, b) => a.col - b.col)
      .forEach((e) => {
        if (e.col === 6) return;
        items.push({
          coveredTeacher: teacher,
          periodCol: e.col,
          entry: e,
          absenceType: "partial",
          key: `${teacher}:${day}-${e.col}`,
        });
      });
  });
  items.sort(
    (a, b) =>
      a.periodCol - b.periodCol ||
      a.coveredTeacher.localeCompare(b.coveredTeacher),
  );
  return items;
}

// ── Main cover grid ────────────────────────────────────────────
function renderGrid() {
  if (_renderGridRAF !== null) {
    cancelAnimationFrame(_renderGridRAF);
    _renderGridRAF = null;
  }
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const grid = document.getElementById("coverGrid");
  const availDiv = document.getElementById("availableCoverList");

  if (!hasAnyAbsences()) {
    grid.innerHTML =
      "<div class='alert alert-info'>No absent teachers selected.</div>";
    availDiv.innerHTML = "";
    return;
  }

  const rowsHtml = [];

  // absentPeriods: null = full day absent, array = partial (only those cols absent)
  function buildTeacherRows(teacher, lessons, badgeHtml, absentPeriods) {
    if (!lessons.length) return;
    const reason = absentTeacherReasons[teacher] || "Not specified";
    rowsHtml.push(`
      <tr class="table-active">
        <td colspan="6" class="fw-bold">${badgeHtml} ${teacher}</td>
      </tr>
      <tr class="table-light">
        <td colspan="6" class="text-muted"><small><strong>Reason:</strong> ${reason}</small></td>
      </tr>
      <tr class="table-secondary">
        <th style="width:10%">Period</th>
        <th style="width:15%">Subject/Type</th>
        <th style="width:20%">Class</th>
        <th style="width:15%">Venue</th>
        <th style="width:40%">Assign Cover</th>
      </tr>`);

    lessons.forEach((e) => {
      if (e.col === 6) return;

      // Partial teacher — period not in absent list means "In School"
      const inSchool = absentPeriods && !absentPeriods.includes(e.col);

      if (inSchool) {
        rowsHtml.push(`
          <tr style="opacity:.4;background:#e9ecef;pointer-events:none">
            <td class="text-muted">${e.col + 1}</td>
            <td class="text-muted">${e.subject || e.type}</td>
            <td class="text-muted">${e.className || ""}</td>
            <td class="text-muted">${e.venue || ""}</td>
            <td>
              <span class="badge bg-light text-secondary border">
                🏫 In School — No Cover Required
              </span>
            </td>
          </tr>`);
        return;
      }

      const key = teacher + ":" + day + "-" + e.col;
      const assigned = coverAssignments[key];
      const noCover = noCoverNeeded[key];

      const teacherObj = {
        totalCovers: getTotalCovers(assigned),
        coversThisWeek: getCoversThisWeek(assigned),
      };

      const heatClass = getHeatmapClass(teacherObj);

      let assignHtml = "";
      if (assigned) {
        assignHtml = `<div class="border p-2" style="min-height:3em">
          <button class='btn btn-sm btn-danger ms-2' data-undo-key="${key}">Undo</button>
          <span class='badge ${heatClass}'> ${assigned}</span></div>`;
      } else if (noCover) {
        assignHtml = `<div class="border p-2" style="min-height:3em;background-color:#f8f9fa">
          <span class='badge bg-secondary'>No Cover Needed</span>
          <button class='btn btn-sm btn-warning ms-2' data-undo-nocover="${key}">Assign</button></div>`;
      } else {
        assignHtml = `<div class="border p-2 drop-zone" style="min-height:3em"
          data-drop-key="${key}" data-period="${e.col}" data-day="${day}">
          <div class="d-flex justify-content-between align-items-center">
            <small class="text-muted">Drop teacher here</small>
            <button class='btn btn-sm btn-outline-secondary' data-mark-nocover="${key}"
              title="Mark as no cover needed">✗</button>
          </div>
        </div>`;
      }
      rowsHtml.push(`<tr>
        <td>${e.col + 1}</td><td>${e.subject || e.type}</td>
        <td>${e.className || ""}</td><td>${e.venue || ""}</td>
        <td>${assignHtml}</td>
      </tr>`);
    });
    rowsHtml.push(
      `<tr><td colspan="6" style="height:10px;background-color:#f8f9fa;"></td></tr>`,
    );
  }

  // Full-day absent teachers — pass all lessons, no period filter
  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    const lessons = data.entries
      .filter((e) => e.row == day && e.type === "lesson")
      .sort((a, b) => a.col - b.col);
    buildTeacherRows(
      teacher,
      lessons,
      `<span class='badge bg-danger'>Full Day</span>`,
      null,
    );
  });

  // Partial-day absent teachers — pass ALL lessons so "In School" periods render greyed
  Object.entries(partialAbsentTeachers).forEach(([teacher, absentPeriods]) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    const lessons = data.entries
      .filter((e) => e.row == day && e.type === "lesson")
      .sort((a, b) => a.col - b.col);
    const periodLabels = absentPeriods.map((p) => `P${p + 1}`).join(",");
    buildTeacherRows(
      teacher,
      lessons,
      `<span class='badge bg-warning text-dark'>Partial: ${periodLabels}</span>`,
      absentPeriods,
    );
  });

  grid.innerHTML = `<table class="table table-bordered"><tbody>${rowsHtml.join("")}</tbody></table>`;

  grid.onclick = (e) => {
    const undoBtn = e.target.closest("[data-undo-key]");
    if (undoBtn) {
      undo(undoBtn.dataset.undoKey);
      return;
    }
    const undoNoCoverBtn = e.target.closest("[data-undo-nocover]");
    if (undoNoCoverBtn) {
      undoNoCover(undoNoCoverBtn.dataset.undoNocover);
      return;
    }
    const markBtn = e.target.closest("[data-mark-nocover]");
    if (markBtn) {
      markNoCover(markBtn.dataset.markNocover);
      return;
    }
  };

  grid.querySelectorAll(".drop-zone").forEach((drop) => {
    drop.ondragover = (ev) => ev.preventDefault();
    drop.ondrop = (ev) => {
      ev.preventDefault();
      const t = ev.dataTransfer.getData("text");
      const period = parseInt(drop.dataset.period);
      const dropDay = parseInt(drop.dataset.day);
      const key = drop.dataset.dropKey;
      const available = getAvailableTeachers(
        period,
        dropDay,
        absentTeachers,
      ).map((o) => o.name);
      if (!available.includes(t)) {
        drop.innerHTML = `<span class='text-danger'>Teacher not available</span>`;
        setTimeout(() => renderGrid(), 1200);
        return;
      }
      if (noCoverNeeded[key]) delete noCoverNeeded[key];
      coverAssignments[key] = t;
      const teacher = key.split(":")[0];
      const lesson = getTeacherEntry(teacher, dropDay, period);
      addCoverHistoryEntry(
        teacher,
        t,
        period + 1,
        dropDay + 1,
        lesson?.subject || lesson?.type,
        lesson?.className,
        lesson?.venue,
      );
      const metrics = loadMetrics();
      ensureTeacherMetrics(t);
      metrics[t].coversDone += 1;
      const _hs = buildHistoryStats(
        loadCoverHistory(),
        getWeekNumber(coverDate),
      );
      metrics[t].totalCovers = _hs[t]?.total || 0;
      metrics[t].coversThisWeek = _hs[t]?.thisWeek || 0;
      metrics[t].lastCoverDate = coverDate;
      saveMetrics(metrics);
      renderGrid();
    };
  });

  // Available cover teachers panel
  const allAvail = getAllAvailableTeachers(day, absentTeachers);

  // Count how many periods each teacher is still available across the whole day
  const teacherAvailCount = {};
  for (let p = 0; p < 6; p++)
    for (const t of allAvail[p])
      teacherAvailCount[t.name] = (teacherAvailCount[t.name] || 0) + 1;

  // Build set of teachers who covered on the prior calendar day
  const priorDate = new Date(coverDate + "T00:00:00");
  priorDate.setDate(priorDate.getDate() - 1);
  const priorDateStr = priorDate.toISOString().split("T")[0];
  const priorDayCovers = new Set(
    loadCoverHistory()
      .filter((h) => h.date === priorDateStr)
      .map((h) => h.coverTeacher),
  );

  const availRows = [];
  for (let period = 0; period < 6; period++) {
    const avail = allAvail[period];
    let tdContent =
      avail.length === 0
        ? '<span class="text-muted">None</span>'
        : avail
            .map((teacher) => {
              const lastFree = teacherAvailCount[teacher.name] === 1;
              const overloaded = teacher.totalCovers > 5;
              const coveredPrior = priorDayCovers.has(teacher.name);

              // ✅ NEW status flags
              const data = loadTeacher(teacher.name);
              const isDnd = isTeacherDndGlobal(teacher.name);
              const isLastResort = teacher.isLastResort;
              const isMeeting = teacher.type === "meeting";

              // ✅ Badge color (base)
              const badgeColor = lastFree
                ? "bg-warning text-dark"
                : isMeeting
                  ? "bg-info text-dark"
                  : "bg-primary";

              // ✅ Border priority (consistent hierarchy)
              let borderClass = "";
              if (overloaded) {
                borderClass = "border border-danger border-2";
              } else if (coveredPrior) {
                borderClass = "border border-info border-2";
              } else if (isMeeting) {
                borderClass = "border border-warning border-2";
              }

              // ✅ ICON SYSTEM
              const icons = [
                isMeeting ? "🗓️" : "",
                coveredPrior ? "↩" : "",
                isDnd ? "⛔" : "",
                isLastResort ? "🆘" : "",
              ]
                .filter(Boolean)
                .join(" ");

              // ✅ Mini badges
              const extraBadges = `
    ${isMeeting ? `<span class="badge bg-dark ms-1">MEET</span>` : ""}
    ${isDnd ? `<span class="badge bg-danger ms-1">DND</span>` : ""}
    ${isLastResort ? `<span class="badge bg-warning text-dark ms-1">LR</span>` : ""}
  `;

              const heatClass = getHeatmapClass(teacher);

              return `
  <span class="badge ${badgeColor} me-1 avail-badge ${heatClass} ${borderClass}"
        draggable="true"
        data-teacher-name="${teacher.name}"
        title="
          ${isMeeting ? "Meeting period" : ""}
          ${coveredPrior ? "Covered yesterday" : ""}
          ${isDnd ? "Do Not Disturb" : ""}
          ${isLastResort ? "Last Resort teacher" : ""}
        ">
    ${teacher.name} ${icons}
    ${extraBadges}

    <span class="badge bg-light text-dark ms-1">T:${teacher.totalCovers}</span>
    <span class="badge bg-light text-dark ms-1">W:${teacher.coversThisWeek}</span>
    <span class="badge bg-light text-dark ms-1">A:${teacher.coversPerWeek}</span>
    <span class="badge bg-light text-dark ms-1">F:${teacher.freePeriods}</span>
  </span>`;
            })
            .join("");
    availRows.push(
      `<tr><td>Period ${period + 1}</td><td>${tdContent}</td></tr>`,
    );
  }

  availDiv.innerHTML = `<table class="table table-bordered table-sm">
    <thead><tr><th>Period</th><th>Available Teachers</th></tr></thead>
    <tbody>${availRows.join("")}</tbody></table>`;

  checkFairnessWarnings();
  updateDashboardSummary();
  updateDashboardStats();
}

document.getElementById("availableCoverList").ondragstart = (ev) => {
  const badge = ev.target.closest("[data-teacher-name]");
  if (badge) ev.dataTransfer.setData("text", badge.dataset.teacherName);
};

// ── Fairness warnings ──────────────────────────────────────────
function checkFairnessWarnings() {
  const history = loadCoverHistory(),
    week = getWeekNumber(coverDate),
    settings = getFairnessSettings();
  const coversPerTeacher = {};
  for (let i = 0, len = history.length; i < len; i++)
    if (history[i].week === week)
      coversPerTeacher[history[i].coverTeacher] =
        (coversPerTeacher[history[i].coverTeacher] || 0) + 1;

  const warnings = [];
  for (const teacher in coversPerTeacher)
    if (coversPerTeacher[teacher] > settings.maxCoversPerWeek)
      warnings.push(
        `⚠️ ${teacher} has ${coversPerTeacher[teacher]} covers this week (exceeds fair limit of ${settings.maxCoversPerWeek})`,
      );

  const constraintInfo = [];
  if (settings.excludeDnd) constraintInfo.push("DND teachers excluded");
  if (settings.useLastResort)
    constraintInfo.push("Last Resort used only as backup");
  if (constraintInfo.length > 0)
    warnings.push(
      `ℹ️ Active fairness constraints: ${constraintInfo.join(", ")}`,
    );

  const warningDiv = document.getElementById("fairnessWarning");
  if (warnings.length > 0) {
    warningDiv.innerHTML = warnings.join("<br>");
    warningDiv.classList.remove("d-none");
  } else warningDiv.classList.add("d-none");
}

// ── Undo / No-cover ───────────────────────────────────────────
function undo(key) {
  const history = loadCoverHistory();
  const [teacher, dp] = key.split(":");
  const [d, p] = dp.split("-");
  const dayNum = parseInt(d) + 1,
    periodNum = parseInt(p) + 1;
  saveCoverHistory(
    history.filter(
      (h) =>
        !(
          h.coveredTeacher === teacher &&
          h.day === dayNum &&
          h.period === periodNum
        ),
    ),
  );
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

// ── Auto-assign (Fair) ─────────────────────────────────────────
function autoAssignCoverTeachers() {
  if (absentTeachers.length === 0) {
    alert("No absent teachers to assign covers for.");
    return;
  }
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  let assignmentsMade = 0,
    conflicts = 0;
  const assignedTeachers = new Set(Object.values(coverAssignments));
  const metrics = loadMetrics();

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    data.entries
      .filter((e) => e.row == day && e.type === "lesson")
      .sort((a, b) => a.col - b.col)
      .forEach((e) => {
        if (e.col === 6) return;
        const key = teacher + ":" + day + "-" + e.col;
        if (coverAssignments[key] || noCoverNeeded[key]) return;
        let availableTeachers = getAvailableTeachers(
          e.col,
          day,
          absentTeachers,
        ).filter((t) => !assignedTeachers.has(t.name));
        if (availableTeachers.length > 0) {
          const best = availableTeachers[0];
          coverAssignments[key] = best.name;
          assignedTeachers.add(best.name);
          addCoverHistoryEntry(
            teacher,
            best.name,
            e.col + 1,
            day + 1,
            e.subject || e.type,
            e.className,
            e.venue,
          );
          if (!metrics[best.name])
            metrics[best.name] = {
              freePeriods: calculateFreePeriods(best.name),
              coversDone: 0,
              coversThisWeek: 0,
              totalCovers: 0,
              lastCoverDate: null,
            };
          metrics[best.name].coversDone += 1;
          metrics[best.name].totalCovers = getTotalCovers(best.name);
          metrics[best.name].coversThisWeek = getCoversThisWeek(best.name);
          metrics[best.name].lastCoverDate = coverDate;
          assignmentsMade++;
        } else {
          conflicts++;
        }
      });
  });

  saveMetrics(metrics);
  renderGrid();
  let msg = `Auto-assignment complete!\n\nAssignments made: ${assignmentsMade}`;
  if (conflicts > 0)
    msg += `\nUnassigned lessons: ${conflicts} (no suitable teachers available)`;
  alert(msg);
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
  document.getElementById("tenWeekStartDate").value =
    startDate || new Date().toISOString().split("T")[0];
  updatePeriodStatus();
}
function updatePeriodStatus() {
  const startDate = getCachedTenWeekStart();
  if (!startDate) {
    document.getElementById("periodStatus").innerHTML =
      "Not set. Will initialize on first use.";
    return;
  }
  const start = new Date(startDate),
    end = new Date(start);
  end.setDate(end.getDate() + 69);
  const weeksElapsed = Math.floor((new Date() - start) / 604800000) + 1;
  document.getElementById("periodStatus").innerHTML =
    `Started: ${start.toDateString()}<br>Ends: ${end.toDateString()}<br>Week: ${Math.min(weeksElapsed, 10)} of 10`;
}

// ── Last 5 Days History Modal ──────────────────────────────────
function populateLast5DaysModal() {
  const body = document.getElementById("last5DaysModalBody");
  if (!body) return;
  const history = loadCoverHistory();
  if (history.length === 0) {
    body.innerHTML =
      "<p class='text-muted text-center py-3'>No cover history recorded yet.</p>";
    return;
  }
  const byDate = {};
  for (const h of history) {
    if (!byDate[h.date]) byDate[h.date] = [];
    byDate[h.date].push(h);
  }
  const dates = Object.keys(byDate)
    .sort((a, b) => new Date(b) - new Date(a))
    .slice(0, 5);
  let html = "";
  dates.forEach((date) => {
    const entries = byDate[date].sort(
      (a, b) => (a.period || 0) - (b.period || 0),
    );
    const weekNum = entries[0]?.week || "?";
    const fmt = new Date(date + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    html += `
      <div class="card mb-3">
        <div class="card-header bg-light d-flex justify-content-between align-items-center">
          <strong>${fmt}</strong>
          <span class="badge bg-secondary">Week ${weekNum} · ${entries.length} cover${entries.length !== 1 ? "s" : ""}</span>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-bordered mb-0">
            <thead class="table-secondary">
              <tr><th style="width:35px">P</th><th>Absent Teacher</th><th>Reason</th><th>Cover Teacher</th><th>Subject</th></tr>
            </thead>
            <tbody>
              ${entries
                .map(
                  (e) => `
                <tr>
                  <td class="text-center">${e.period ?? ""}</td>
                  <td>${e.coveredTeacher || ""}</td>
                  <td><small class="text-muted fst-italic">${e.absentReason || "—"}</small></td>
                  <td><strong>${e.coverTeacher || ""}</strong></td>
                  <td><small>${e.subject || ""}${e.className ? " · " + e.className : ""}</small></td>
                </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  });
  body.innerHTML = html;
}

// ── Cover history display ──────────────────────────────────────
function displayCoverHistory() {
  const history = loadCoverHistory(),
    tbody = document.getElementById("historyTableBody");
  if (history.length === 0) {
    tbody.innerHTML =
      "<tr><td colspan='6' class='text-center text-muted'>No cover history yet</td></tr>";
    return;
  }
  tbody.innerHTML = history
    .map(
      (e) =>
        `<tr><td>${e.date}</td><td>${e.week}</td><td>${e.coveredTeacher}</td><td>${e.coverTeacher}</td><td>${e.period}</td><td>${e.subject}</td></tr>`,
    )
    .join("");
}

// ── Print / Export helpers ─────────────────────────────────────
function getCoverPlanRows(day) {
  const rows = [],
    coverNeeded = getCoverNeededLessons(day);
  coverNeeded.forEach((item) => {
    rows.push({
      teacher: item.coveredTeacher,
      period: item.periodCol + 1,
      subject: item.entry?.subject || item.entry?.type || "",
      className: item.entry?.className || "",
      venue: item.entry?.venue || "",
      assigned: coverAssignments[item.key] || "",
      absenceType: item.absenceType,
    });
  });
  return rows;
}

function buildCoverGridTableHtml(day, includeActions = false) {
  const rows = getCoverPlanRows(day);
  const groupedByTeacher = rows.reduce((acc, row) => {
    if (!acc[row.teacher]) acc[row.teacher] = [];
    acc[row.teacher].push(row);
    return acc;
  }, {});

  const schoolName = localStorage.getItem("firebaseSchoolId") || "";
  const fmtDate = new Date(coverDate + "T00:00:00").toLocaleDateString(
    undefined,
    { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  );

  let html = `<div class="container p-4" id="coverPrintContainer">
    <div class="border-bottom pb-2 mb-3">
      ${schoolName ? `<div class="text-muted small text-uppercase fw-semibold">${schoolName}</div>` : ""}
      <h4 class="mb-0">Absent Teachers Cover Plan</h4>
      <div class="d-flex gap-3 mt-1">
        <span><strong>Date:</strong> ${fmtDate}</span>
        <span><strong>Day:</strong> Day ${day + 1}</span>
      </div>
    </div>`;
  if (includeActions) {
    html += `<div hidden class="mb-3 no-print">
      <button id="printPageBtn" class="btn btn-primary me-2">Print</button>
      <button id="downloadPdfBtn" class="btn btn-success me-2">Save as PDF</button>
      <button id="downloadPngBtn" class="btn btn-secondary me-2">Save as Image</button>
      <button id="emailExportBtn" class="btn btn-info">Email</button>
    </div>`;
  }
  if (rows.length === 0)
    return (
      html +
      "<div class='alert alert-info'>No absent teacher lessons found for the selected day.</div></div>"
    );

  Object.entries(groupedByTeacher).forEach(([teacher, teacherRows]) => {
    const reason = absentTeacherReasons[teacher] || "Not specified"; // per-teacher
    html += `
    <div class="mb-4 teacher-block">
      <table class="table table-borderless mb-1">
        <tr><td colspan="2" class="fw-bold">${teacher}</td></tr>
        <tr><td colspan="2" class="text-muted"><strong>Reason:</strong> ${reason}</td></tr>
      </table>
      <table class="table table-sm table-bordered">
        <thead class="table-light">
          <tr><th style="width:40px">#</th><th style="width:80px">Class</th><th style="width:80px">Venue</th><th>Subject</th><th>Assigned Cover</th></tr>
        </thead>
        <tbody>`;
    teacherRows.forEach((r) => {
      html += `<tr><td>${r.period}</td><td>${r.className}</td><td>${r.venue}</td><td>${r.subject}</td><td>${r.assigned || "—"}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  });
  return html;
}

// ── Lazy-load scripts ──────────────────────────────────────────
function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load " + url));
    document.head.appendChild(s);
  });
}
const HTML2CANVAS_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
const JSPDF_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

function openCoverPrintPreview(action = null) {
  if (!hasAnyAbsences()) {
    alert("No absent teachers selected. Please add absent teachers first.");
    return;
  }
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const tableHtml = buildCoverGridTableHtml(day, true);
  let win = window.open("", "_blank", "width=1100,height=850");
  win.document.write(`<html><head><title>Cover Grid Print Preview</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">
    <style>
      body{background:#fff;color:#000}
      table{table-layout:fixed;width:100%;border-collapse:collapse;word-wrap:break-word}
      th,td{border:1px solid #333;padding:.35rem;font-size:.85rem}
      th{background:#f4f4f4}
      .print-table-container{page-break-inside:avoid}
      @media print{body{margin:.5cm}.no-print{display:none!important}table{page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}}
    </style>
  </head><body>${tableHtml}</body></html>`);
  win.document.close();
  win.focus();

  const setupActions = () => {
    try {
      const doc = win.document;
      const rows = getCoverPlanRows(day);
      const makeText = () =>
        rows
          .map(
            (r) =>
              `${r.teacher} | P${r.period} | ${r.subject} | ${r.className} | ${r.venue} | ${r.assigned}`,
          )
          .join("\n");
      doc.getElementById("printPageBtn").onclick = () => win.print();
      const ensureLibs = () => {
        const promises = [];
        if (!win.html2canvas)
          promises.push(
            new Promise((res, rej) => {
              const s = doc.createElement("script");
              s.src = HTML2CANVAS_URL;
              s.onload = res;
              s.onerror = rej;
              doc.head.appendChild(s);
            }),
          );
        if (!win.jspdf)
          promises.push(
            new Promise((res, rej) => {
              const s = doc.createElement("script");
              s.src = JSPDF_URL;
              s.onload = res;
              s.onerror = rej;
              doc.head.appendChild(s);
            }),
          );
        return Promise.all(promises);
      };
      doc.getElementById("downloadPdfBtn").onclick = () => {
        ensureLibs()
          .then(() => {
            const { jsPDF } = win.jspdf;
            const content = doc.querySelector(".container");
            if (!content) return;
            win
              .html2canvas(content, { scale: 2 })
              .then((canvas) => {
                const imgData = canvas.toDataURL("image/png");
                const pdf = new jsPDF({
                  orientation: "landscape",
                  unit: "pt",
                  format: "a4",
                });
                const pdfW = pdf.internal.pageSize.getWidth(),
                  pdfH = pdf.internal.pageSize.getHeight();
                const ratio = Math.min(
                  pdfW / canvas.width,
                  pdfH / canvas.height,
                );
                const imgW = canvas.width * ratio,
                  imgH = canvas.height * ratio;
                if (imgH <= pdfH) {
                  pdf.addImage(imgData, "PNG", 0, 0, imgW, imgH);
                } else {
                  let remaining = canvas.height,
                    pos = 0;
                  while (remaining > 0) {
                    const pageH = Math.min(remaining, Math.floor(pdfH / ratio));
                    const c = document.createElement("canvas");
                    c.width = canvas.width;
                    c.height = pageH;
                    c.getContext("2d").drawImage(
                      canvas,
                      0,
                      pos,
                      canvas.width,
                      pageH,
                      0,
                      0,
                      canvas.width,
                      pageH,
                    );
                    pdf.addImage(
                      c.toDataURL("image/png"),
                      "PNG",
                      0,
                      0,
                      imgW,
                      pageH * ratio,
                    );
                    remaining -= pageH;
                    pos += pageH;
                    if (remaining > 0) pdf.addPage();
                  }
                }
                pdf.save(`cover_plan_day_${day + 1}.pdf`);
              })
              .catch((err) => {
                console.error("pdf generation failed", err);
                alert("Error generating PDF: " + err);
              });
          })
          .catch((err) => alert("Failed to load PDF libraries: " + err));
      };
      doc.getElementById("downloadPngBtn").onclick = () => {
        ensureLibs()
          .then(() => {
            win
              .html2canvas(doc.querySelector(".container"), { scale: 2 })
              .then((canvas) => {
                const link = doc.createElement("a");
                link.download = `cover_plan_day_${day + 1}.png`;
                link.href = canvas.toDataURL("image/png");
                link.click();
              })
              .catch((err) => {
                console.error("png capture failed", err);
                alert("Error generating image: " + err);
              });
          })
          .catch((err) => alert("Failed to load image libraries: " + err));
      };
      doc.getElementById("emailExportBtn").onclick = () => {
        const subject = encodeURIComponent(
          `Absent Teachers Cover Plan - Day ${day + 1}`,
        );
        const body = encodeURIComponent(makeText());
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      };
      if (action === "print") doc.getElementById("printPageBtn").click();
      else if (action === "pdf") doc.getElementById("downloadPdfBtn").click();
      else if (action === "image") doc.getElementById("downloadPngBtn").click();
      else if (action === "email") doc.getElementById("emailExportBtn").click();
    } catch (err) {
      console.error("setupActions failed", err);
    }
  };
  if (win.document.readyState === "complete") setupActions();
  else win.addEventListener("load", setupActions);
}

// ── Event bindings ─────────────────────────────────────────────
document.getElementById("coverDate").addEventListener("change", (e) => {
  coverDate = e.target.value;
  updateWeekDisplay();
  scheduleRenderGrid();
});
document.getElementById("absenceDaySelect").onchange = () =>
  scheduleRenderGrid();

// Add button → open unified modal
document.getElementById("addAbsenceTeacherBtn").onclick = () => {
  const name = document.getElementById("addAbsenceTeacherSelect").value;
  if (!name) return;
  openAddAbsenceModal(name);
};

// ── Save button ────────────────────────────────────────────────
document.getElementById("saveBtn").onclick = () => {
  localStorage.setItem("coverPlans", JSON.stringify(coverAssignments));
  alert("Saved");
};

// ── Round-Robin Auto-Assign ────────────────────────────────────
function autoAssignRoundRobin() {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const allAvail = getAllAvailableTeachers(day, absentTeachers);
  const assignments = {},
    noCoverAssignments = {};
  let assignmentsMade = 0,
    conflicts = 0;
  const allTeachers = [];
  for (let p = 0; p < 6; p++) allTeachers.push(...allAvail[p]);
  let teacherIndex = 0;

  const processTeacher = (teacher, lessons) => {
    lessons.forEach((e) => {
      if (e.col === 6) return;
      const key = teacher + ":" + day + "-" + e.col;
      if (coverAssignments[key] || noCoverNeeded[key]) return;
      let assigned = false,
        attempts = 0;
      while (attempts < allTeachers.length) {
        const candidate = allTeachers[teacherIndex % allTeachers.length];
        teacherIndex++;
        attempts++;
        const candidateAvail = allAvail[e.col].find(
          (t) => t.name === candidate.name && candidate.name !== teacher,
        );
        if (candidateAvail) {
          assignments[key] = candidate.name;
          assignmentsMade++;
          assigned = true;
          break;
        }
      }
      if (!assigned) conflicts++;
    });
  };

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    processTeacher(
      teacher,
      data.entries
        .filter((e) => e.row == day && e.type === "lesson")
        .sort((a, b) => a.col - b.col),
    );
  });
  Object.entries(partialAbsentTeachers).forEach(([teacher, absentPeriods]) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    processTeacher(
      teacher,
      data.entries
        .filter(
          (e) =>
            e.row == day &&
            e.type === "lesson" &&
            absentPeriods.includes(e.col),
        )
        .sort((a, b) => a.col - b.col),
    );
  });
  return { assignments, noCoverAssignments, assignmentsMade, conflicts };
}

// ── Preview Auto-Assign ────────────────────────────────────────
function previewAutoAssign() {
  fallbackUsed = false;
  fallbackTeachers.clear();

  if (!hasAnyAbsences()) {
    alert("No absent teachers selected.");
    return;
  }

  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const strategy = document.getElementById("autoAssignStrategy").value;
  let result;

  if (strategy === "roundRobin") result = autoAssignRoundRobin();
  else if (strategy === "dayBalancing") result = autoAssignDayBalancing();
  else result = generateAutoAssignments();

  previewAssignments = result.assignments;
  previewNoCoverNeeded = result.noCoverAssignments;
  _lastPreviewConflicts = result.conflicts || 0;

  // Store conflict count in history log so reportCoverRefusal can display it

  addToHistoryLog("AUTO_ASSIGN_PREVIEW", {
    strategy,
    date: coverDate,
    day,
    absentTeachers,
    assignmentsMade: result.assignmentsMade,
    conflicts: result.conflicts,
  });

  preAutoAssignState = getAppState();

  const conflicts = detectBackToBackConflicts(previewAssignments);
  const strategyLabel =
    strategy === "roundRobin"
      ? "Round-Robin (Sequential)"
      : strategy === "dayBalancing"
        ? "Day-Balancing (Spread Across Day)"
        : "Fair (Minimize Unfairness)";

  let html = `
    <div class="alert alert-info mb-3">
      <strong>Strategy:</strong> ${strategyLabel} | <strong>Day:</strong> Day ${parseInt(day) + 1}
    </div>
    <table class="table table-striped table-hover table-sm">
      <thead class="table-dark">
        <tr><th>Absent Teacher</th><th style="width:60px">Period</th><th>Subject</th><th>Preview: Cover Assignment</th></tr>
      </thead><tbody>`;

  const manualConflictKeys = new Set();
  let manualConflicts = 0;
  let count = 0,
    successCount = 0;
  let warningsHtml = "";

  const appendRows = (teacher, entries, badgeSuffix) => {
    entries.forEach((e) => {
      const key = teacher + ":" + day + "-" + e.col;
      const isConflict = manualConflictKeys.has(key);

      const assigned = previewAssignments[key];
      const isAssigned = !!assigned;
      // 1. Use statusMap with safe fallback
      const status =
        result.statusMap && result.statusMap[key]
          ? result.statusMap[key]
          : "ok";
      if (isAssigned) successCount++;
      count++;

      let assignedCell = `<span class="badge bg-danger">NOT ASSIGNED</span>`;

      if (assigned) {
        const isFallbackTeacher = fallbackTeachers.has(assigned);

        const lrBadge =
          status === "lastResort"
            ? ` <span class="badge bg-warning text-dark ms-1" title="Teacher marked Last Resort">Last Resort</span>`
            : status === "capExceeded"
              ? ` <span class="badge bg-danger ms-1" title="All preferred teachers at cap">[CAP EXCEEDED]</span>`
              : "";

        const conflictBadge = isConflict
          ? ` <span class="badge bg-warning text-dark ms-1">⚡ Conflict</span>`
          : "";

        const fallbackBadge = isFallbackTeacher
          ? ` <span class="badge bg-info text-dark ms-1">↩ Fallback</span>`
          : "";

        assignedCell = `<strong>${assigned}</strong>${lrBadge}${conflictBadge}${fallbackBadge}`;
      }

      html += `<tr class="${
        !isAssigned ? "table-danger" : isConflict ? "table-warning" : ""
      }">

        <td>${teacher}${badgeSuffix}</td>
        <td style="text-align:center">${e.col + 1}</td>
        <td>${e.subject || ""}</td>
        <td>${assignedCell}</td>
      </tr>`;
    });
  };

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    appendRows(
      teacher,
      data.entries
        .filter((e) => e.row == day && e.type === "lesson")
        .sort((a, b) => a.col - b.col),
      "",
    );
  });
  Object.entries(partialAbsentTeachers).forEach(([teacher, absentPeriods]) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    appendRows(
      teacher,
      data.entries
        .filter(
          (e) =>
            e.row == day &&
            e.type === "lesson" &&
            absentPeriods.includes(e.col),
        )
        .sort((a, b) => a.col - b.col),
      ` <span class="badge bg-info">Partial</span>`,
    );
  });

  html += `</tbody></table>
    <div class="alert alert-secondary mt-3">
      <strong>Summary:</strong><br>✓ ${successCount} assignments made<br>⚠️ ${result.conflicts} unassigned lessons
    </div>`;
  if (strategy === "roundRobin")
    html += `<small class="text-muted d-block mt-2"><i>Round-Robin cycles through available teachers sequentially.</i></small>`;
  else
    html += `<small class="text-muted d-block mt-2"><i>Fair strategy assigns to teachers with fewest total covers.</i></small>`;

  document.getElementById("previewAssignmentsList").innerHTML = html;

  for (const key in previewAssignments) {
    if (
      coverAssignments[key] &&
      coverAssignments[key] !== previewAssignments[key]
    ) {
      manualConflicts++;
      manualConflictKeys.add(key);
    }
  }

  for (const key in previewAssignments) {
    if (
      coverAssignments[key] &&
      coverAssignments[key] !== previewAssignments[key]
    ) {
      manualConflicts++;
    }
  }

  if (result.conflicts > 0)
    warningsHtml += `<strong>⚠️ ${result.conflicts} lesson(s) cannot be assigned</strong> — no suitable teacher available.<br>`;
  if (manualConflicts > 0)
    warningsHtml += `<strong class="text-warning">⚡ ${manualConflicts} conflict(s) — preview suggests changes to manual assignments</strong> — auto-assign suggests a different teacher for a manually assigned period. Manual entries will be preserved on Apply.<br>`;
  if (conflicts.length > 0)
    warningsHtml += `<strong>↩ ${conflicts.length} back-to-back assignment(s)</strong> — same teacher in consecutive periods.<br>`;
  if (fallbackUsed) {
    const list = Array.from(fallbackTeachers).join(", ");
    warningsHtml += `<strong>↩ Fallback used:</strong> ${list} assigned despite covering yesterday (no alternatives).<br>`;
  }

  const fm = calculateFairnessScore(loadCoverHistory());
  warningsHtml += `<strong>📊 Fairness Score: ${fm.score}/100</strong><br><small>Min: ${fm.min}, Max: ${fm.max}, Avg: ${fm.avg}, Ratio: ${fm.ratio}</small>`;
  document.getElementById("previewWarnings").innerHTML = warningsHtml;
  document.getElementById("previewWarnings").style.display = "block";

  new bootstrap.Modal(document.getElementById("previewAutoAssignModal")).show();
}

// ── Apply Preview ──────────────────────────────────────────────
function applyPreviewAssignments() {
  // 1. Only apply preview entries that don't overwrite existing manual assignments
  let applied = 0,
    skipped = 0;
  for (const [key, name] of Object.entries(previewAssignments)) {
    if (coverAssignments[key]) {
      skipped++;
      continue;
    } // manual entry — protect it
    if (noCoverNeeded[key]) {
      skipped++;
      continue;
    } // no-cover flag — protect it
    coverAssignments[key] = name;
    applied++;
  }

  for (const key in previewNoCoverNeeded) {
    if (!coverAssignments[key]) {
      noCoverNeeded[key] = true;
    }
  }

  const day = parseInt(document.getElementById("absenceDaySelect").value);
  getCoverNeededLessons(day).forEach((item) => {
    const assignedCover = previewAssignments[item.key];
    if (!assignedCover) return;
    addCoverHistoryEntry(
      item.coveredTeacher,
      assignedCover,
      item.periodCol + 1,
      day + 1,
      item.entry?.subject || item.entry?.type || "Unknown",
      item.entry?.className || "Unknown",
      item.entry?.venue || "Unknown",
    );
  });
  addToHistoryLog("AUTO_ASSIGN_APPLIED", {
    strategy: document.getElementById("autoAssignStrategy").value,
    assignmentsMade: applied,
    skippedManual: skipped,
    conflicts: _lastPreviewConflicts || 0,
  });
  renderGrid();
  alert(
    `Auto-assign complete!\n✓ ${applied} assignment(s) applied.\n⏭ ${skipped} manual/flagged period(s) preserved.`,
  );
}

// ── Generate Auto-Assignments (Fair) ──────────────────────────
function generateAutoAssignments() {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const assignments = {},
    metrics = loadMetrics();
  let assignmentsMade = 0,
    conflicts = 0;

  const processTeacher = (teacher, lessons, filterFn) => {
    lessons.forEach((e) => {
      if (e.col === 6) return;
      const key = teacher + ":" + day + "-" + e.col;
      if (coverAssignments[key] || noCoverNeeded[key]) return;
      let avail = getAvailableTeachers(e.col, day, absentTeachers).filter(
        (t) => !Object.values(assignments).includes(t.name),
      );
      if (filterFn) avail = avail.filter(filterFn);
      if (avail.length > 0) {
        avail.sort(
          (a, b) =>
            (metrics[a.name]?.totalCovers || 0) -
            (metrics[b.name]?.totalCovers || 0),
        );
        assignments[key] = avail[0].name;
        assignmentsMade++;
      } else {
        conflicts++;
      }
    });
  };

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    processTeacher(
      teacher,
      data.entries
        .filter((e) => e.row == day && e.type === "lesson")
        .sort((a, b) => a.col - b.col),
      null,
    );
  });
  Object.entries(partialAbsentTeachers).forEach(([teacher, absentPeriods]) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    processTeacher(
      teacher,
      data.entries
        .filter(
          (e) =>
            e.row == day &&
            e.type === "lesson" &&
            absentPeriods.includes(e.col),
        )
        .sort((a, b) => a.col - b.col),
      (t) => t.name !== teacher,
    );
  });
  return { assignments, noCoverAssignments: {}, assignmentsMade, conflicts };
}

// ── Day-Balancing Strategy ─────────────────────────────────────
function autoAssignDayBalancing() {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const allAvail = getAllAvailableTeachers(day, absentTeachers);
  const assignments = {},
    coversAssignedToday = {};
  let assignmentsMade = 0,
    conflicts = 0;

  const processTeacher = (teacher, lessons, extraFilter) => {
    lessons.forEach((e) => {
      if (e.col === 6) return;
      const key = teacher + ":" + day + "-" + e.col;
      if (coverAssignments[key] || noCoverNeeded[key]) return;
      let avail = getAvailableTeachers(e.col, day, absentTeachers).filter(
        (t) => !Object.values(assignments).includes(t.name),
      );
      if (extraFilter) avail = avail.filter(extraFilter);
      if (avail.length > 0) {
        avail.sort((a, b) => {
          const aT = coversAssignedToday[a.name] || 0,
            bT = coversAssignedToday[b.name] || 0;
          return aT !== bT ? aT - bT : a.totalCovers - b.totalCovers;
        });
        const best = avail[0];
        assignments[key] = best.name;
        coversAssignedToday[best.name] =
          (coversAssignedToday[best.name] || 0) + 1;
        assignmentsMade++;
      } else {
        conflicts++;
      }
    });
  };

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    processTeacher(
      teacher,
      data.entries
        .filter((e) => e.row == day && e.type === "lesson")
        .sort((a, b) => a.col - b.col),
      null,
    );
  });
  Object.entries(partialAbsentTeachers).forEach(([teacher, absentPeriods]) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    processTeacher(
      teacher,
      data.entries
        .filter(
          (e) =>
            e.row == day &&
            e.type === "lesson" &&
            absentPeriods.includes(e.col),
        )
        .sort((a, b) => a.col - b.col),
      (t) => t.name !== teacher,
    );
  });
  return { assignments, noCoverAssignments: {}, assignmentsMade, conflicts };
}

// ── Conflict detection ─────────────────────────────────────────
function detectBackToBackConflicts(assignments) {
  const conflicts = [];
  Object.entries(assignments).forEach(([key, teacher]) => {
    const [absent, dayCol] = key.split(":"),
      [dayNum, period] = dayCol.split("-"),
      periodNum = parseInt(period);
    const nextKey = absent + ":" + dayNum + "-" + (periodNum + 1);
    if (assignments[nextKey] === teacher)
      conflicts.push({
        teacher,
        absent,
        periods: `${periodNum + 1}-${periodNum + 2}`,
        type: "back-to-back",
      });
  });
  return conflicts;
}

// ── Fairness score ─────────────────────────────────────────────
function fairnessFilterCandidates({ candidates, day, period, settings }) {
  // ✅ Build prior-day coverage set
  const priorDate = new Date(coverDate + "T00:00:00");
  priorDate.setDate(priorDate.getDate() - 1);

  const priorDateStr = priorDate.toISOString().split("T")[0];

  const priorDayCovers = new Set(
    loadCoverHistory()
      .filter((h) => h.date === priorDateStr)
      .map((h) => h.coverTeacher),
  );

  // ✅ Base filtering (hard constraints)
  const base = candidates.filter((t) => {
    if (settings.excludeDnd && isTeacherDnd(t.name, day, period)) return false;
    if (countCoversForTeacherOnDay(t.name) >= settings.maxCoversPerDay)
      return false;
    if (countCoversForTeacherThisWeek(t.name) >= settings.maxCoversPerWeek)
      return false;
    return true;
  });

  // ✅ Strict filter
  let filtered = base.filter((t) => {
    if (avoidYesterdayStrict && priorDayCovers.has(t.name)) return false;
    return true;
  });

  let fallbackUsedLocal = false;
  let fallbackTeachersLocal = new Set();

  // ✅ Fallback logic
  if (avoidYesterdayStrict && filtered.length === 0) {
    filtered = base;
    fallbackUsedLocal = true;

    filtered.forEach((t) => {
      if (priorDayCovers.has(t.name)) {
        fallbackTeachersLocal.add(t.name);
      }
    });
  }

  // ✅ Soft penalty (only when NOT strict)
  if (!avoidYesterdayStrict) {
    filtered.forEach((t) => {
      if (priorDayCovers.has(t.name)) {
        t.totalCovers += 1;
      }
    });
  }

  return {
    filtered,
    fallbackUsedLocal,
    fallbackTeachersLocal,
  };
}

function calculateFairnessScore(history) {
  if (history.length === 0)
    return {
      score: 100,
      details: "No data",
      min: 0,
      max: 0,
      avg: "0",
      ratio: "0",
    };
  const totals = {};
  for (const h of history)
    totals[h.coverTeacher] = (totals[h.coverTeacher] || 0) + 1;
  const values = Object.values(totals);
  if (values.length <= 1)
    return {
      score: 100,
      details: "Only one teacher",
      min: values[0] || 0,
      max: values[0] || 0,
      avg: (values[0] || 0).toFixed(1),
      ratio: "1.00",
    };
  const min = Math.min(...values),
    max = Math.max(...values),
    avg = values.reduce((s, v) => s + v, 0) / values.length;
  const ratio = (max - min) / avg,
    score = Math.max(0, Math.min(100, 100 - ratio * 10));
  return {
    score: Math.round(score),
    min,
    max,
    avg: avg.toFixed(1),
    ratio: ratio.toFixed(2),
  };
}

document.getElementById("undoAutoAssignBtn").onclick = () => {
  if (!preAutoAssignState) {
    alert("Nothing to undo.");
    return;
  }
  if (
    !confirm(
      "Undo auto-assign? This will revert to the state before auto-assign was applied.",
    )
  )
    return;

  coverAssignments = { ...preAutoAssignState.coverAssignments };
  noCoverNeeded = { ...preAutoAssignState.noCoverNeeded };
  absentTeachers = [...preAutoAssignState.absentTeachers];
  partialAbsentTeachers = { ...preAutoAssignState.partialAbsentTeachers };
  absentTeacherReasons = { ...preAutoAssignState.absentTeacherReasons };

  preAutoAssignState = null;
  previewAssignments = {};
  previewNoCoverNeeded = {};

  addToHistoryLog("AUTO_ASSIGN_UNDONE", {});
  refreshTeachers();
  renderAbsentTeachersTable();
  scheduleRenderGrid();
  alert("Auto-assign reverted.");
};

document.getElementById("confirmAutoAssignBtn").onclick = () => {
  bootstrap.Modal.getInstance(
    document.getElementById("previewAutoAssignModal"),
  )?.hide();
  applyPreviewAssignments();
};

document.getElementById("printBtn").onclick = () => openCoverPrintPreview();
document.getElementById("navPrintBtn").onclick = () =>
  openCoverPrintPreview("print");
document.getElementById("navPdfBtn").onclick = () =>
  openCoverPrintPreview("pdf");
document.getElementById("navImgBtn").onclick = () =>
  openCoverPrintPreview("image");
document.getElementById("navEmailBtn").onclick = () =>
  openCoverPrintPreview("email");

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
  if (!email) {
    alert("Please enter a valid email address.");
    return;
  }
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const parts = [
    '<h3>Absent Teachers Cover Plan</h3><table border="1" cellpadding="5" cellspacing="0"><thead><tr><th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assigned Cover</th></tr></thead><tbody>',
  ];
  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    data.entries
      .filter((e) => e.row == day && e.type === "lesson")
      .sort((a, b) => a.col - b.col)
      .forEach((e) => {
        if (e.col === 6) return;
        const assigned =
          coverAssignments[teacher + ":" + day + "-" + e.col] || "";
        parts.push(
          `<tr><td>${teacher}</td><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ""}</td><td>${e.venue || ""}</td><td>${assigned}</td></tr>`,
        );
      });
  });
  parts.push("</tbody></table>");
  const html = parts.join("");
  const subject = encodeURIComponent("Absent Teachers Cover Plan");
  const body = encodeURIComponent(html.replace(/<[^>]+>/g, ""));
  window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
};

// ── Bulk import ────────────────────────────────────────────────
document.getElementById("bulkBtn").onclick = () =>
  document.getElementById("bulkInput").click();
document.getElementById("bulkInput").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  let count = 0;
  for (const f of files) {
    if (!f.name.endsWith(".json")) continue;
    const data = JSON.parse(await f.text());
    const name = data.teacherName || f.name.replace(".json", "");
    localStorage.setItem(PREFIX + name, JSON.stringify(data));
    teacherCache[name] = data;
    _buildEntryIndex(name, data);
    _teacherNamesCache = null;
    count++;
  }
  document.getElementById("status").innerText = "Imported " + count;
  refreshTeachers();
  scheduleRenderGrid();
});

// ── Clear / Reset ──────────────────────────────────────────────
document.getElementById("clearBtn").onclick = () => {
  if (
    confirm(
      "Clear absent teachers and today's cover assignments?\n\nThis will NOT erase cover history (needed for fairness tracking).",
    )
  ) {
    absentTeachers = [];
    coverAssignments = {};
    noCoverNeeded = {};
    absentTeacherReasons = {};
    addToHistoryLog("CLEAR_DAY_DATA", {});
    document.getElementById("status").innerText =
      "Absent teachers and assignments cleared. History preserved.";
    renderAbsentTeachersTable();
    renderGrid();
  }
};

document.getElementById("clearAllBtn").onclick = () => {
  const confirmed = confirm(
    "⚠️ FULL SYSTEM RESET - This cannot be undone!\n\nThis will clear:\n• All teacher timetables\n• Cover history\n• Metrics and fairness data\n\nAn automated backup will be exported.\n\nType 'CLEAR ALL' in the next prompt to confirm.",
  );
  if (!confirmed) return;
  const userInput = prompt("Type 'CLEAR ALL' to confirm full system reset:");
  if (userInput !== "CLEAR ALL") {
    alert("Reset cancelled.");
    return;
  }
  backupCoverHistory();
  autoExportAllData();
  addToHistoryLog("FULL_SYSTEM_RESET", {
    action: "All data cleared with backups exported",
  });
  const keysToRemove = [];
  for (let i = 0, len = localStorage.length; i < len; i++) {
    const k = localStorage.key(i);
    if (
      k.startsWith(PREFIX) ||
      k === "coverPlans" ||
      k === METRICS_KEY ||
      k === HISTORY_KEY
    )
      keysToRemove.push(k);
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
  teacherCache = {};
  coverAssignments = {};
  noCoverNeeded = {};
  tallies = {};
  absentTeacherReasons = {};
  _metricsCache = null;
  _historyCache = null;
  _teacherNamesCache = null;
  _startDateObj = null;
  absentTeachers = [];
  for (const k in _entryIndex) delete _entryIndex[k];
  document.getElementById("status").innerText =
    "Full system reset complete. Backup exported.";
  refreshTeachers();
  renderAbsentTeachersTable();
  renderGrid();
};

document.getElementById("exportBtn").onclick = () => {
  backupCoverHistory();
  const data = {
    /*
    coverAssignments,
    noCoverNeeded,
    metrics: loadMetrics(),
    history: loadCoverHistory(),
    tenWeekStart: getCachedTenWeekStart(),
    */

    ...getAppState(), // ✅ includes partial + reasons + date + day
    metrics: loadMetrics(),
    history: loadCoverHistory(),
    tenWeekStart: getCachedTenWeekStart(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cover_backup_${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  addToHistoryLog("MANUAL_BACKUP", { fileName: a.download });
};

document.getElementById("importBtn").onclick = () =>
  document.getElementById("importMetricsInput").click();
document
  .getElementById("importMetricsInput")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());

    // 1. Extract date and day from source
    const srcDate = data.coverDate || data.date || coverDate;
    const srcDay =
      data.day ?? parseInt(document.getElementById("absenceDaySelect").value);
    const fmtDate = new Date(srcDate + "T00:00:00").toLocaleDateString(
      undefined,
      { weekday: "long", year: "numeric", month: "long", day: "numeric" },
    );

    // 2. Confirm
    if (
      !confirm(
        `Restore backup?\n\nDate : ${fmtDate}\nDay  : Day ${srcDay + 1}\n\nThis will merge with current local data.`,
      )
    ) {
      e.target.value = "";
      return;
    }

    // 3. Apply session state via unified pattern
    coverAssignments = {};
    noCoverNeeded = {};
    absentTeachers = [];
    partialAbsentTeachers = {};
    absentTeacherReasons = {};

    applyAppState({ ...data, coverDate: srcDate, day: srcDay });

    // 4. Restore persistence layers
    if (data.metrics)
      saveMetrics(Object.assign({}, data.metrics, loadMetrics()));
    if (data.history) saveCoverHistory(data.history);
    if (data.tenWeekStart) setCachedTenWeekStart(data.tenWeekStart);
    if (data.absenceReasons) {
      saveAbsenceReasons(data.absenceReasons);
      populateAbsenceReasonDropdown();
    }
    if (data.fairnessSettings) saveFairnessSettings(data.fairnessSettings);

    addToHistoryLog("LOCAL_RESTORE", { date: srcDate });
    if (data.absenceReasons) populateAbsenceReasonDropdown();
    syncUiWithState();
    e.target.value = "";
    alert("✅ Backup restored successfully.");
  });

// ── Excel export ───────────────────────────────────────────────
document.getElementById("exportExcelBtn").onclick = () => {
  if (!window.XLSX) {
    alert("Excel library not loaded.");
    return;
  }
  const history = loadCoverHistory(),
    metrics = loadMetrics();
  if (history.length === 0 && Object.keys(metrics).length === 0) {
    alert("No cover data to export.");
    return;
  }
  const wb = XLSX.utils.book_new(),
    currentWeek = getWeekNumber(coverDate),
    histStats = buildHistoryStats(history, currentWeek);
  const summaryData = [
    [
      "Teacher",
      "Total Covers",
      "Covers This Week",
      "Per-Week Average",
      "Free Periods",
    ],
  ];
  for (const teacher in metrics) {
    const hs = histStats[teacher] || {
      total: 0,
      thisWeek: 0,
      coversPerWeek: "0.00",
    };
    summaryData.push([
      teacher,
      hs.total,
      hs.thisWeek,
      parseFloat(hs.coversPerWeek).toFixed(2),
      metrics[teacher].freePeriods || 0,
    ]);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(summaryData),
    "Summary",
  );

  const teachers = new Set(history.map((h) => h.coverTeacher));
  const weekCounts = {};
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (!weekCounts[h.coverTeacher]) weekCounts[h.coverTeacher] = {};
    weekCounts[h.coverTeacher][h.week] =
      (weekCounts[h.coverTeacher][h.week] || 0) + 1;
  }
  const weeklyData = [
    [
      "Teacher",
      "Week 1",
      "Week 2",
      "Week 3",
      "Week 4",
      "Week 5",
      "Week 6",
      "Week 7",
      "Week 8",
      "Week 9",
      "Week 10",
    ],
  ];
  teachers.forEach((t) => {
    const row = [t];
    for (let w = 1; w <= 10; w++)
      row.push((weekCounts[t] && weekCounts[t][w]) || 0);
    weeklyData.push(row);
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(weeklyData),
    "Weekly Breakdown",
  );

  const detailedData = [
    [
      "Date",
      "Week",
      "Covered Teacher",
      "Cover Teacher",
      "Day",
      "Period",
      "Subject",
      "Class",
      "Venue",
    ],
  ];
  history.forEach((e) =>
    detailedData.push([
      e.date,
      e.week,
      e.coveredTeacher,
      e.coverTeacher,
      e.day,
      e.period,
      e.subject,
      e.className,
      e.venue,
    ]),
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(detailedData),
    "Detailed History",
  );

  const totalCovers = history.length,
    uniqueTeachers = teachers.size;
  const coverCounts = Array.from(teachers).map((t) => histStats[t]?.total || 0);
  const minC = Math.min(...coverCounts),
    maxC = Math.max(...coverCounts);
  const statsData = [
    ["Statistic", "Value"],
    ["Total Cover Sessions", totalCovers],
    ["Number of Teachers", uniqueTeachers],
    ["Average Covers per Teacher", (totalCovers / uniqueTeachers).toFixed(2)],
    ["Minimum Covers", minC],
    ["Maximum Covers", maxC],
    ["Fairness Ratio (Max/Min)", minC > 0 ? (maxC / minC).toFixed(2) : "N/A"],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(statsData),
    "Statistics",
  );
  XLSX.writeFile(
    wb,
    `cover_report_${new Date().toISOString().split("T")[0]}.xlsx`,
  );
};

// ── History helpers ────────────────────────────────────────────
function backupCoverHistory() {
  const history = loadCoverHistory();
  const backup = {
    date: new Date().toISOString(),
    historyCount: history.length,
    data: history,
  };
  const backups = JSON.parse(localStorage.getItem(HISTORY_BACKUP_KEY) || "[]");
  backups.push(backup);
  if (backups.length > 10) backups.shift();
  localStorage.setItem(HISTORY_BACKUP_KEY, JSON.stringify(backups));
  return backup;
}

function addToHistoryLog(action, details) {
  const log = JSON.parse(localStorage.getItem(HISTORY_LOG_KEY) || "[]");
  log.push({
    timestamp: new Date().toISOString(),
    action,
    details,
    dataSnapshot: {
      historyCount: loadCoverHistory().length,
      metricsCount: Object.keys(loadMetrics()).length,
    },
  });
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const filtered = log.filter((e) => new Date(e.timestamp) > threeMonthsAgo);
  if (filtered.length > 100) {
    const old = log.slice(0, log.length - 100);
    if (old.length > 0) autoExportHistoryLog(old);
    localStorage.setItem(HISTORY_LOG_KEY, JSON.stringify(filtered.slice(-100)));
  } else localStorage.setItem(HISTORY_LOG_KEY, JSON.stringify(filtered));
}

function autoExportHistoryLog(entries) {
  const data = {
    exportDate: new Date().toISOString(),
    archiveType: "history-log-archive",
    entries,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cover_history_log_archive_${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function autoExportAllData() {
  const data = {
    exportDate: new Date().toISOString(),
    exportType: "full-system-backup",
    coverHistory: loadCoverHistory(),
    metrics: loadMetrics(),
    tenWeekStart: getCachedTenWeekStart(),
    historyLog: JSON.parse(localStorage.getItem(HISTORY_LOG_KEY) || "[]"),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cover_system_backup_${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

// ── Teacher Search Filter ──────────────────────────────────────
document.getElementById("teacherSearchInput").addEventListener("input", (e) => {
  const query = e.target.value.toLowerCase().trim();
  const searchResults = document.getElementById("searchResults");
  if (query.length === 0) {
    searchResults.style.display = "none";
    return;
  }
  const allNames = getTeacherNames().filter(
    (n) => !new Set(absentTeachers).has(n),
  );
  const matches = allNames.filter((name) => name.toLowerCase().includes(query));
  if (matches.length === 0) {
    searchResults.innerHTML =
      '<div class="list-group-item text-muted">No teachers found</div>';
    searchResults.style.display = "block";
    return;
  }
  searchResults.innerHTML = matches
    .map(
      (name) =>
        `<button class="list-group-item list-group-item-action" type="button" data-teacher-name="${name}">${name}</button>`,
    )
    .join("");
  searchResults.style.display = "block";
  // Search result click → open unified modal
  searchResults.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      document.getElementById("teacherSearchInput").value = "";
      searchResults.style.display = "none";
      openAddAbsenceModal(btn.dataset.teacherName);
    };
  });
});

document.addEventListener("click", (e) => {
  if (
    !e.target.closest("#teacherSearchInput") &&
    !e.target.closest("#searchResults")
  )
    document.getElementById("searchResults").style.display = "none";
});

document.getElementById("autoAssignBtn").onclick = () => previewAutoAssign();

// ── Keyboard Shortcuts ─────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "4") {
    e.preventDefault();
    focusStep(parseInt(e.key));
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "ArrowRight") {
    e.preventDefault();
    focusStep(Math.min(4, currentWorkflowStep + 1));
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft") {
    e.preventDefault();
    focusStep(Math.max(1, currentWorkflowStep - 1));
  }
  if (
    (e.altKey || e.metaKey) &&
    e.key.toLowerCase() === "a" &&
    currentWorkflowStep >= 2
  ) {
    e.preventDefault();
    if (hasAnyAbsences()) document.getElementById("autoAssignBtn")?.click();
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    e.shiftKey &&
    e.key.toLowerCase() === "a" &&
    currentWorkflowStep >= 2
  ) {
    e.preventDefault();
    if (!hasAnyAbsences()) {
      alert("No absent teachers selected.");
      return;
    }
    const strategy = document.getElementById("autoAssignStrategy").value;
    let result;
    if (strategy === "roundRobin") result = autoAssignRoundRobin();
    else if (strategy === "dayBalancing") result = autoAssignDayBalancing();
    else result = generateAutoAssignments();
    previewAssignments = result.assignments;
    previewNoCoverNeeded = result.noCoverAssignments;
    applyPreviewAssignments();
    alert(`✓ Auto-assigned! ${result.assignmentsMade} covers assigned.`);
  }
  if (
    (e.altKey || e.metaKey) &&
    e.key.toLowerCase() === "e" &&
    currentWorkflowStep >= 3
  ) {
    e.preventDefault();
    document.getElementById("exportExcelBtn")?.click();
  }
});

// ── Absence Reasons: Settings modal ───────────────────────────
function populateAbsenceReasonsList() {
  const reasons = getAbsenceReasons(),
    list = document.getElementById("absenceReasonsList");
  if (!list) return;
  list.innerHTML = reasons
    .map(
      (reason) => `
    <div class="list-group-item d-flex justify-content-between align-items-center">
      <span>${reason}</span>
      <button class="btn btn-sm btn-outline-danger" onclick="removeAbsenceReasonHandler('${reason}')">Remove</button>
    </div>`,
    )
    .join("");
}
function removeAbsenceReasonHandler(reason) {
  if (removeAbsenceReason(reason)) populateAbsenceReasonsList();
}

document
  .getElementById("addAbsenceReasonBtn")
  ?.addEventListener("click", () => {
    const input = document.getElementById("newAbsenceReasonInput");
    if (input && input.value.trim()) {
      if (addAbsenceReason(input.value)) {
        input.value = "";
        populateAbsenceReasonsList();
      }
    }
  });
document
  .getElementById("resetAbsenceReasonsBtn")
  ?.addEventListener("click", () => {
    if (confirm("Reset absence reasons to defaults?")) {
      saveAbsenceReasons(DEFAULT_ABSENCE_REASONS);
      populateAbsenceReasonsList();
    }
  });

// ── Init ───────────────────────────────────────────────────────
refreshTeachers();
renderGrid();
populateAbsenceReasonsList();
initializeDatePicker();
initializeTenWeekPeriod();
autoPruneOldEntries();

document.getElementById("autoAssignStrategy").value = getLastStrategy();
document
  .getElementById("autoAssignStrategy")
  .addEventListener("change", (e) => saveLastStrategy(e.target.value));

document.addEventListener("show.bs.modal", (e) => {
  if (e.target.id === "historyModal") displayCoverHistory();
  else if (e.target.id === "last5DaysModal") populateLast5DaysModal();
  else if (e.target.id === "tenWeekModal") initializePeriodModal();
  else if (e.target.id === "fairnessSettingsModal") {
    const s = loadFairnessSettings();
    document.getElementById("excludeDndSwitch").checked = s.excludeDnd;
    document.getElementById("freePeriodsOnlySwitch").checked =
      s.freePeriodsOnly;
    document.getElementById("maxCoversPerDay").value = s.maxCoversPerDay;
    document.getElementById("maxCoversPerWeek").value = s.maxCoversPerWeek;
    document.getElementById("useLastResortSwitch").checked = s.useLastResort;
  } else if (e.target.id === "settingsModal") {
    const s = loadFairnessSettings();
    document.getElementById("excludeDndSwitch2").checked = s.excludeDnd;
    document.getElementById("freePeriodsOnlySwitch2").checked =
      s.freePeriodsOnly;
    document.getElementById("maxCoversPerDay2").value = s.maxCoversPerDay;
    document.getElementById("maxCoversPerWeek2").value = s.maxCoversPerWeek;
    document.getElementById("useLastResortSwitch2").checked = s.useLastResort;
    populateAbsenceReasonsList2();
    const tenWeekStart = localStorage.getItem(TEN_WEEK_START);
    if (tenWeekStart)
      document.getElementById("tenWeekStartDate2").value = tenWeekStart;
  }
});

document
  .getElementById("saveFairnessSettings2")
  ?.addEventListener("click", () => {
    const s = {
      excludeDnd: document.getElementById("excludeDndSwitch2").checked,
      freePeriodsOnly: document.getElementById("freePeriodsOnlySwitch2")
        .checked,
      maxCoversPerDay: parseInt(
        document.getElementById("maxCoversPerDay2").value,
      ),
      maxCoversPerWeek: parseInt(
        document.getElementById("maxCoversPerWeek2").value,
      ),
      useLastResort: document.getElementById("useLastResortSwitch2").checked,
    };
    saveFairnessSettings(s);
    alert("✓ Fairness settings saved!");
  });

function populateAbsenceReasonsList2() {
  const reasons = getAbsenceReasons(),
    list = document.getElementById("absenceReasonsList2");
  list.innerHTML = reasons
    .map(
      (r) => `
    <div class="list-group-item d-flex justify-content-between align-items-center">
      ${r}<button class="btn btn-sm btn-danger" onclick="removeAbsenceReason2('${r}')">Remove</button>
    </div>`,
    )
    .join("");
}
function removeAbsenceReason2(reason) {
  removeAbsenceReason(reason);
  populateAbsenceReasonsList2();
}
document
  .getElementById("addAbsenceReasonBtn2")
  ?.addEventListener("click", () => {
    const input = document.getElementById("newAbsenceReason2"),
      reason = input.value.trim();
    if (reason && addAbsenceReason(reason)) {
      input.value = "";
      populateAbsenceReasonsList2();
    }
  });
document
  .getElementById("resetAbsenceReasonsBtn2")
  ?.addEventListener("click", () => {
    if (confirm("Reset to default absence reasons?")) {
      saveAbsenceReasons(DEFAULT_ABSENCE_REASONS);
      populateAbsenceReasonsList2();
      alert("✓ Absence reasons reset to defaults!");
    }
  });

document.getElementById("saveTenWeekPeriod2")?.addEventListener("click", () => {
  const dateStr = document.getElementById("tenWeekStartDate2").value;
  if (dateStr) {
    localStorage.setItem(TEN_WEEK_START, dateStr);
    alert("✓ 10-week period start saved!");
  }
});
document
  .getElementById("resetTenWeekPeriod2")
  ?.addEventListener("click", () => {
    if (
      confirm("⚠️ This will CLEAR ALL history and fairness data. Continue?")
    ) {
      localStorage.removeItem(HISTORY_KEY);
      localStorage.removeItem(METRICS_KEY);
      localStorage.removeItem(TEN_WEEK_START);
      alert("✓ Period reset complete. History cleared.");
      location.reload();
    }
  });

document
  .querySelector(".sidebar-hover-trigger")
  ?.addEventListener("click", () => {
    const sidebar = document.getElementById("sidebarContainer");
    sidebar.style.left = sidebar.style.left === "0px" ? "-350px" : "0";
  });

document
  .getElementById("workflowBody")
  ?.addEventListener("shown.bs.collapse", () => {
    document.getElementById("workflowToggleIcon").textContent = "▼";
  });
document
  .getElementById("workflowBody")
  ?.addEventListener("hidden.bs.collapse", () => {
    document.getElementById("workflowToggleIcon").textContent = "▶";
  });

document.getElementById("savePeriodBtn").onclick = () => {
  const newStartDate = document.getElementById("tenWeekStartDate").value;
  if (newStartDate) {
    setCachedTenWeekStart(newStartDate);
    updatePeriodStatus();
    updateWeekDisplay();
    scheduleRenderGrid();
    alert("10-week period updated!");
  }
};
document.getElementById("resetPeriodBtn").onclick = () => {
  if (confirm("Reset the 10-week period? This will mark today as Week 1.")) {
    const today = new Date().toISOString().split("T")[0];
    setCachedTenWeekStart(today);
    document.getElementById("tenWeekStartDate").value = today;
    updatePeriodStatus();
    coverDate = today;
    document.getElementById("coverDate").value = today;
    updateWeekDisplay();
    scheduleRenderGrid();
    alert("10-week period has been reset!");
  }
};

// ── Workflow ───────────────────────────────────────────────────
let currentWorkflowStep = 1;
function focusStep(step) {
  const stepNum = parseInt(step);
  let prerequisitesMet = true,
    warnings = [];
  if (stepNum >= 2 && !document.getElementById("absenceDaySelect").value) {
    warnings.push("⚠️ Step 1: Please select a day first");
    prerequisitesMet = false;
  }
  if (stepNum >= 3 && absentTeachers.length === 0) {
    warnings.push("⚠️ Step 2: Please add absent teachers first");
    prerequisitesMet = false;
  }
  if (stepNum >= 4 && Object.keys(coverAssignments).length === 0) {
    warnings.push(
      "⚠️ Step 3: Please run auto-assign or assign covers manually first",
    );
    prerequisitesMet = false;
  }
  if (!prerequisitesMet && stepNum > currentWorkflowStep)
    alert(
      warnings.join("\n") +
        "\n\nYou can still continue, but complete these steps for best results.",
    );
  currentWorkflowStep = stepNum;
  updateWorkflowUI(stepNum);
  scrollToStep(stepNum);
}
function updateWorkflowUI(step) {
  document.querySelectorAll(".workflow-step").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.step) === step);
  });
  document.getElementById("workflowProgress").textContent = `${step}/4`;
  for (let i = 1; i <= 4; i++) {
    const ind = document.getElementById(`step${i}-indicator`);
    if (i < step) {
      ind.textContent = "✓";
      ind.className = "step-indicator text-success fw-bold";
    } else if (i === step) {
      ind.textContent = "●";
      ind.className = "step-indicator text-primary fw-bold";
    } else {
      ind.textContent = "○";
      ind.className = "step-indicator text-muted";
    }
  }
}
function scrollToStep(step) {
  const targets = [
    null,
    "absenceDaySelect",
    "teacherSearchInput",
    "autoAssignStrategy",
    "exportExcelBtn",
  ];
  const el = targets[step] ? document.getElementById(targets[step]) : null;
  if (el)
    setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      el.focus();
    }, 100);
}
document.getElementById("absenceDaySelect")?.addEventListener("change", () => {
  if (currentWorkflowStep === 1) {
    currentWorkflowStep = 2;
    updateWorkflowUI(2);
  }
});
document
  .getElementById("addAbsenceTeacherBtn")
  ?.addEventListener("click", () => {
    if (absentTeachers.length > 0 && currentWorkflowStep === 2) {
      currentWorkflowStep = 3;
      updateWorkflowUI(3);
    }
  });

// ── Fairness Settings Modal ────────────────────────────────────

document
  .getElementById("avoidYesterdayStrictToggle")
  ?.addEventListener("change", (e) => {
    avoidYesterdayStrict = e.target.checked;
  });

document.getElementById("saveFairnessBtn").onclick = () => {
  const s = {
    excludeDnd: document.getElementById("excludeDndSwitch").checked,
    freePeriodsOnly: document.getElementById("freePeriodsOnlySwitch").checked,
    maxCoversPerDay: parseInt(document.getElementById("maxCoversPerDay").value),
    maxCoversPerWeek: parseInt(
      document.getElementById("maxCoversPerWeek").value,
    ),
    useLastResort: document.getElementById("useLastResortSwitch").checked,
  };
  saveFairnessSettings(s);
  addToHistoryLog("FAIRNESS_SETTINGS_UPDATED", s);
  alert("Fairness settings saved successfully!");
  bootstrap.Modal.getInstance(
    document.getElementById("fairnessSettingsModal"),
  )?.hide();
  scheduleRenderGrid();
};
document.getElementById("resetFairnessBtn").onclick = () => {
  if (confirm("Reset fairness settings to defaults?")) {
    saveFairnessSettings(DEFAULT_FAIRNESS_SETTINGS);
    document.getElementById("excludeDndSwitch").checked =
      DEFAULT_FAIRNESS_SETTINGS.excludeDnd;
    document.getElementById("maxCoversPerDay").value =
      DEFAULT_FAIRNESS_SETTINGS.maxCoversPerDay;
    document.getElementById("maxCoversPerWeek").value =
      DEFAULT_FAIRNESS_SETTINGS.maxCoversPerWeek;
    document.getElementById("useLastResortSwitch").checked =
      DEFAULT_FAIRNESS_SETTINGS.useLastResort;
    addToHistoryLog("FAIRNESS_SETTINGS_RESET", DEFAULT_FAIRNESS_SETTINGS);
    alert("Fairness settings reset to defaults!");
    scheduleRenderGrid();
  }
};

async function generatePDF() {
  try {
    if (!window.jspdf) {
      try {
        await loadScript(JSPDF_URL);
      } catch (err) {
        alert("jsPDF library failed to load.");
        return;
      }
    }
    if (absentTeachers.length === 0) {
      alert("No absent teachers selected.");
      return;
    }
    const { jsPDF } = window.jspdf,
      doc = new jsPDF({ orientation: "landscape" });
    const day = parseInt(document.getElementById("absenceDaySelect").value) + 1;
    let y = 15;
    doc.setFontSize(16);
    doc.text(`Absent Teachers Cover Plan - Day ${day}`, 14, y);
    y += 10;
    doc.setFontSize(10);
    absentTeachers.forEach((teacher) => {
      const data = loadTeacher(teacher);
      if (!data) return;
      const lessons = data.entries
        .filter((e) => e.row == day - 1 && e.type === "lesson")
        .sort((a, b) => a.col - b.col);
      if (lessons.length === 0) return;
      doc.setFont(undefined, "bold");
      doc.text(teacher, 14, y);
      y += 6;
      doc.setFont(undefined, "normal");
      lessons.forEach((e) => {
        const key = teacher + ":" + (day - 1) + "-" + e.col,
          assigned = coverAssignments[key] || "⚠ NOT ASSIGNED";
        const line = `P${e.col + 1} | ${e.subject || ""} | ${e.className || ""} | ${e.venue || ""} | Cover: ${assigned}`;
        const split = doc.splitTextToSize(line, 180);
        doc.text(split, 16, y);
        y += split.length * 5;
        if (y > 270) {
          doc.addPage();
          y = 15;
        }
      });
      y += 4;
    });
    window.open(URL.createObjectURL(doc.output("blob")));
  } catch (error) {
    alert("Error generating PDF: " + error.message);
  }
}

// ── Workflow sidebar ───────────────────────────────────────────
const WORKFLOW_SIDEBAR_STATE_KEY = "workflowSidebarVisible";
function setWorkflowBtnExpanded(expanded) {
  const btn = document.getElementById("workflowToggleBtn");
  if (!btn) return;
  btn.setAttribute("aria-expanded", expanded ? "true" : "false");
}
document.addEventListener("DOMContentLoaded", () => {
  const wrapper = document.getElementById("workflowSidebarCollapse"),
    btn = document.getElementById("workflowToggleBtn");
  if (!wrapper || !btn || !window.bootstrap) return;

  const saved = localStorage.getItem(WORKFLOW_SIDEBAR_STATE_KEY),
    visible = saved === null ? false : saved === "true";

  const collapse = bootstrap.Collapse.getOrCreateInstance(wrapper, {
    toggle: false,
  });
  if (visible) collapse.show();
  else collapse.hide();
  setWorkflowBtnExpanded(visible);
  wrapper.addEventListener("shown.bs.collapse", () => {
    localStorage.setItem(WORKFLOW_SIDEBAR_STATE_KEY, "true");
    setWorkflowBtnExpanded(true);
  });
  wrapper.addEventListener("hidden.bs.collapse", () => {
    localStorage.setItem(WORKFLOW_SIDEBAR_STATE_KEY, "false");
    setWorkflowBtnExpanded(false);
  });
});

// ── Firebase: Cloud Save ───────────────────────────────────────
async function cloudSaveTo() {
  const btn = document.getElementById("cloudSaveBtn");
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Saving…";
    }
    await FirebaseAdapter.saveTo(getDailyAllocationState());
    addToHistoryLog("CLOUD_SAVE", {
      date: coverDate,
      schoolId: FirebaseAdapter.getStoredSchoolId(),
    });
    alert("✅ Data saved to cloud successfully.");
  } catch (e) {
    alert("❌ Cloud save failed:\n" + e.message);
    console.error("cloudSaveTo:", e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "💾 Save To";
    }
  }
}

// ── Firebase: Cloud Read ───────────────────────────────────────
async function cloudReadFrom() {
  const btn = document.getElementById("cloudReadBtn");
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Reading…";
    }
    const data = await FirebaseAdapter.readFrom(coverDate);

    // 1. Extract date and day from source
    const srcDate =
      data.allocation?.coverDate || data.allocation?.date || coverDate;
    const srcDay =
      data.allocation?.day ??
      parseInt(document.getElementById("absenceDaySelect").value);
    const fmtDate = new Date(srcDate + "T00:00:00").toLocaleDateString(
      undefined,
      { weekday: "long", year: "numeric", month: "long", day: "numeric" },
    );

    // 2. Confirm
    if (
      !confirm(
        `Load cloud data?\n\nDate : ${fmtDate}\nDay  : Day ${srcDay + 1}\n\nThis will merge with current local data.`,
      )
    )
      return;

    // 3. Apply session state via unified pattern
    if (data.allocation)
      applyAppState({ ...data.allocation, coverDate: srcDate, day: srcDay });

    // 4. Merge history
    if (data.history?.length) {
      const existing = loadCoverHistory();
      const existingKeys = new Set(
        existing.map(
          (h) => `${h.date}_${h.coveredTeacher}_P${h.period}_${h.coverTeacher}`,
        ),
      );
      saveCoverHistory([
        ...existing,
        ...data.history.filter(
          (h) =>
            !existingKeys.has(
              `${h.date}_${h.coveredTeacher}_P${h.period}_${h.coverTeacher}`,
            ),
        ),
      ]);
    }

    // 5. Merge metrics — local wins
    if (data.metrics && Object.keys(data.metrics).length)
      saveMetrics(Object.assign({}, data.metrics, loadMetrics()));

    // 6. Apply settings
    if (data.settings?.fairnessSettings)
      saveFairnessSettings(data.settings.fairnessSettings);
    if (data.settings?.tenWeekStart)
      setCachedTenWeekStart(data.settings.tenWeekStart);
    if (data.settings?.absenceReasons) {
      saveAbsenceReasons(data.settings.absenceReasons);
      populateAbsenceReasonDropdown();
    }

    addToHistoryLog("CLOUD_READ", {
      date: srcDate,
      schoolId: FirebaseAdapter.getStoredSchoolId(),
    });
    syncUiWithState();
    if (data.settings?.absenceReasons) populateAbsenceReasonDropdown();
    alert("✅ Cloud data loaded successfully.");
  } catch (e) {
    alert("❌ Cloud read failed:\n" + e.message);
    console.error("cloudReadFrom:", e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "📥 Read From";
    }
  }
}

// ── Firebase: UI visibility ────────────────────────────────────
function initCloudUI() {
  const dot = document.getElementById("cloudStatusDot");
  const label = document.getElementById("cloudSchoolLabel");
  const saveBtn = document.getElementById("cloudSaveBtn");
  const readBtn = document.getElementById("cloudReadBtn");

  if (FirebaseAdapter.isConfigured()) {
    const schoolId = FirebaseAdapter.getStoredSchoolId();
    if (dot) {
      dot.textContent = "🟢";
      dot.title = "Firebase connected";
    }
    if (label) label.textContent = `School: ${schoolId}`;
    if (saveBtn) saveBtn.disabled = false;
    if (readBtn) readBtn.disabled = false;
    FirebaseAdapter.init();
  } else {
    if (dot) {
      dot.textContent = "🔴";
      dot.title = "Firebase not configured";
    }
    if (label) label.textContent = "Not configured";
    if (saveBtn) saveBtn.disabled = true;
    if (readBtn) readBtn.disabled = true;
  }
}

// "Configure Firebase…" dropdown item opens Settings → Firebase tab
document.getElementById("cloudConfigureBtn")?.addEventListener("click", () => {
  // Open Settings modal directly on the Firebase tab
  const settingsModal = new bootstrap.Modal(
    document.getElementById("settingsModal"),
  );
  settingsModal.show();
  // Switch to Firebase tab once modal is shown
  document.getElementById("settingsModal").addEventListener(
    "shown.bs.modal",
    () => {
      const firebaseTab = document.querySelector(
        '[data-bs-target="#firebaseTab"]',
      );
      if (firebaseTab) bootstrap.Tab.getOrCreateInstance(firebaseTab).show();
    },
    { once: true },
  );
});

// ── Firebase: Save settings from modal ────────────────────────
function saveFirebaseSettings() {
  const schoolId = document.getElementById("firebaseSchoolId")?.value.trim();
  const apiKey = document.getElementById("firebaseApiKey")?.value.trim();
  const projectId = document.getElementById("firebaseProjectId")?.value.trim();
  const authDomain = document
    .getElementById("firebaseAuthDomain")
    ?.value.trim();
  const storageBucket = document
    .getElementById("firebaseStorageBucket")
    ?.value.trim();
  const messagingSenderId = document
    .getElementById("firebaseMessagingSenderId")
    ?.value.trim();
  const appId = document.getElementById("firebaseAppId")?.value.trim();

  if (!schoolId || !apiKey || !projectId) {
    alert("School ID, API Key and Project ID are required.");
    return;
  }
  localStorage.setItem(
    "firebaseConfig",
    JSON.stringify({
      apiKey,
      authDomain,
      projectId,
      storageBucket,
      messagingSenderId,
      appId,
    }),
  );
  localStorage.setItem("firebaseSchoolId", schoolId);

  initCloudUI();
  alert(
    "✅ Firebase settings saved. Save To and Read From are now active in the ☁️ Cloud menu.",
  );
}

// ── Firebase: populate settings fields on modal open ──────────
function populateFirebaseSettingsFields() {
  const config = FirebaseAdapter.getStoredConfig() || {};
  const schoolId = FirebaseAdapter.getStoredSchoolId() || "";
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };
  set("firebaseSchoolId", schoolId);
  set("firebaseApiKey", config.apiKey);
  set("firebaseAuthDomain", config.authDomain);
  set("firebaseProjectId", config.projectId);
  set("firebaseStorageBucket", config.storageBucket);
  set("firebaseMessagingSenderId", config.messagingSenderId);
  set("firebaseAppId", config.appId);
}

// ── Firebase: initial prompt on first load ────────────────────
function checkInitialFirebasePrompt() {
  initCloudUI();
  if (FirebaseAdapter.isConfigured()) return;
  const modal = document.getElementById("firebasePromptModal");
  if (modal && window.bootstrap) {
    setTimeout(() => new bootstrap.Modal(modal).show(), 800);
  }
}

// Wire cloud buttons
document.getElementById("cloudSaveBtn")?.addEventListener("click", cloudSaveTo);
document
  .getElementById("cloudReadBtn")
  ?.addEventListener("click", cloudReadFrom);
document
  .getElementById("saveFirebaseSettingsBtn")
  ?.addEventListener("click", saveFirebaseSettings);

// Populate Firebase fields when Settings modal opens
document.addEventListener("show.bs.modal", (e) => {
  if (e.target.id === "settingsModal") populateFirebaseSettingsFields();
});

// Run on load
checkInitialFirebasePrompt();

// ── Expose to reports.js ───────────────────────────────────────
// Expose getTeacherEntry globally so reports.js can access it
window.getTeacherEntry = getTeacherEntry;

window.coverApp = {
  loadCoverHistory,
  getWeekNumber,
  getTeacherEntry,
  absentTeachers,
  partialAbsentTeachers,
  coverAssignments,
  noCoverNeeded,
  absentTeacherReasons,
};
