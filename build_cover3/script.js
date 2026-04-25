const PREFIX = "teacher_";
const LAST_STRATEGY_KEY = "lastAutoAssignStrategy";
const LAST_REASON_KEY = "lastAbsenceReason";

let teacherCache = {};
let coverAssignments = {};
let noCoverNeeded = {};
let tallies = {};
let absentTeachers = [];
let partialAbsentTeachers = {}; // Format: { "teacherName": [period1, period2, ...], ... }
let nextPrintAction = null;
let coverDate = new Date().toISOString().split("T")[0];

// Preview and undo tracking
let previewAssignments = {};
let previewNoCoverNeeded = {};
let preAutoAssignState = null;

const METRICS_KEY = "teacherMetrics";
const HISTORY_KEY = "coverHistory";
const TEN_WEEK_START = "tenWeekStart";
const HISTORY_BACKUP_KEY = "coverHistoryBackup";
const LAST_AUTO_CLEAR_KEY = "lastAutoCleared";
const HISTORY_LOG_KEY = "coverHistoryLog";
const FAIRNESS_SETTINGS_KEY = "fairnessSettings";
const ABSENCE_REASONS_KEY = "reasonsForAbsent";

// Default fairness settings
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

// Dashboard Summary collapse (collapsed by default, remembers user choice)
const DASHBOARD_BODY_KEY = "dashboardSummaryExpanded";

document.addEventListener("DOMContentLoaded", () => {
  const body = document.getElementById("dashboardSummaryBody");
  const icon = document.getElementById("dashboardSummaryToggleIcon");
  const btn = document.getElementById("dashboardSummaryToggleBtn");
  if (!body || !icon || !btn || !window.bootstrap) return;

  // Default collapsed unless user has a saved preference
  const saved = localStorage.getItem(DASHBOARD_BODY_KEY);
  const expanded = saved === "true"; // null/false => collapsed

  // Dashboard Summary toggle icon sync (collapsed by default)
  document.addEventListener("DOMContentLoaded", () => {
    const body = document.getElementById("dashboardSummaryBody");
    const icon = document.getElementById("dashboardToggleIcon");
    const btn = document.getElementById("dashboardToggleBtn");
    if (!body || !icon || !btn) return;

    // Ensure initial icon matches the collapsed default
    const isShown = body.classList.contains("show");
    btn.setAttribute("aria-expanded", isShown ? "true" : "false");
    icon.textContent = isShown ? "▼" : "▶";

    body.addEventListener("shown.bs.collapse", () => {
      btn.setAttribute("aria-expanded", "true");
      icon.textContent = "▼";
    });

    body.addEventListener("hidden.bs.collapse", () => {
      btn.setAttribute("aria-expanded", "false");
      icon.textContent = "▶";
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

// Load fairness settings
function loadFairnessSettings() {
  const stored = localStorage.getItem(FAIRNESS_SETTINGS_KEY);
  if (stored) {
    return JSON.parse(stored);
  }
  return DEFAULT_FAIRNESS_SETTINGS;
}

function saveFairnessSettings(settings) {
  localStorage.setItem(FAIRNESS_SETTINGS_KEY, JSON.stringify(settings));
}

function getFairnessSettings() {
  return loadFairnessSettings();
}

// ── Smart Defaults (Remember Last Choices) ────────────────

function saveLastStrategy(strategy) {
  localStorage.setItem(LAST_STRATEGY_KEY, strategy);
}

function getLastStrategy() {
  return localStorage.getItem(LAST_STRATEGY_KEY) || "fair";
}

function saveLastReason(reason) {
  localStorage.setItem(LAST_REASON_KEY, reason);
}

function getLastReason() {
  return localStorage.getItem(LAST_REASON_KEY) || "";
}

// ── Absence Reason Management ─────────────────────────────────

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

function saveAbsenceReasons(reasons) {
  localStorage.setItem(ABSENCE_REASONS_KEY, JSON.stringify(reasons));
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

// ── [OPT-2] Indexed teacher entry lookup ───────────────────────
// Maps teacher name → Map("row-col" → entry) for O(1) lookups
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
  _startDateObj = null;
  localStorage.setItem(TEN_WEEK_START, val);
}

// ── [OPT-6] Cross-tab localStorage sync ────────────────────────
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
  if (!getCachedTenWeekStart()) {
    setCachedTenWeekStart(new Date().toISOString().split("T")[0]);
  }
}

function getWeekNumber(dateStr) {
  if (!_startDateObj) {
    initializeTenWeekPeriod();
    _startDateObj = new Date(getCachedTenWeekStart());
  }
  const diffDays = Math.floor((new Date(dateStr) - _startDateObj) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(week, 1), 10);
}

// ── Fairness constraint helpers ────────────────────────────

function isTeacherDnd(teacherName, day, period) {
  const data = loadTeacher(teacherName);
  if (!data || !data.entries) return false;
  const entry = getTeacherEntry(teacherName, day, period);
  return entry && entry.doNotDisturb === true;
}

function isLastResortTeacher(teacherName) {
  const data = loadTeacher(teacherName);
  return data && data.lastResort === true;
}

function countCoversForTeacherOnDay(teacherName, day) {
  const history = loadCoverHistory();
  const dateStr = coverDate;
  return history.filter(
    (h) =>
      h.coverTeacher === teacherName &&
      new Date(h.date).toISOString().split("T")[0] === dateStr,
  ).length;
}

function countCoversForTeacherThisWeek(teacherName) {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  return history.filter(
    (h) => h.coverTeacher === teacherName && h.week === week,
  ).length;
}

// ── Batch history stats ────────────────────────────────────────

function buildHistoryStats(history, currentWeek) {
  const stats = {};
  for (let i = 0, len = history.length; i < len; i++) {
    const h = history[i];
    const t = h.coverTeacher;
    if (!stats[t]) stats[t] = { total: 0, thisWeek: 0, relevantTotal: 0 };
    stats[t].total++;
    if (h.week === currentWeek) stats[t].thisWeek++;
    if (h.week <= currentWeek) stats[t].relevantTotal++;
  }
  for (const t in stats) {
    stats[t].coversPerWeek =
      currentWeek > 0
        ? (stats[t].relevantTotal / currentWeek).toFixed(2)
        : "0.00";
  }
  return stats;
}

// Legacy single-teacher accessors (used in drop handler & auto-assign metrics update)
function getCoversThisWeek(coverTeacher) {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  let count = 0;
  for (let i = 0, len = history.length; i < len; i++) {
    if (history[i].coverTeacher === coverTeacher && history[i].week === week)
      count++;
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
    if (history[i].coverTeacher === coverTeacher && history[i].week <= week)
      count++;
  }
  return count === 0 ? 0 : (count / week).toFixed(2);
}

// ── Teacher data helpers (with index building) ─────────────────

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
      lastCoverDate: null,
    };
    saveMetrics(metrics);
  }
}

// ── Pre-compute teacher name list from localStorage ────────────

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
    timestamp: new Date().toISOString(),
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
  const pruned = history.filter((h) => new Date(h.date) >= cutoff);
  if (pruned.length !== history.length) saveCoverHistory(pruned);
}

// ── [OPT-3] Compute available teachers for ALL periods at once ─
// Single pass over all teachers, returns Map<period, list[]>

function getAllAvailableTeachers(day, absentList) {
  // Load settings ONCE, BEFORE first use
  const settings = getFairnessSettings();

  // Build set of already-assigned covers per period
  const assignedByPeriod = {}; // period → Set of teacher names
  for (const key in coverAssignments) {
    const idx = key.indexOf(":");
    if (idx === -1) continue;
    const dp = key.slice(idx + 1);
    const dashIdx = dp.indexOf("-");
    const d = parseInt(dp.slice(0, dashIdx));
    const p = parseInt(dp.slice(dashIdx + 1));
    if (d === day) {
      if (!assignedByPeriod[p]) assignedByPeriod[p] = new Set();
      assignedByPeriod[p].add(coverAssignments[key]);
    }
  }

  const absentSet = new Set(absentList);
  const allNames = getTeacherNames();
  const result = {}; // period → [{name, type}]
  for (let p = 0; p < 6; p++) result[p] = [];

  // Single pass over all teachers — check all 6 periods per teacher
  for (let i = 0, len = allNames.length; i < len; i++) {
    const name = allNames[i];
    if (absentSet.has(name)) continue;

    const data = loadTeacher(name);
    if (!data || !data.entries) continue;

    for (let p = 0; p < 6; p++) {
      const assigned = assignedByPeriod[p];
      if (assigned && assigned.has(name)) continue;

      // Use indexed O(1) lookup instead of linear scan
      const entry = getTeacherEntry(name, day, p);
      if (entry && (entry.type === "free" || entry.type === "meeting")) {
        // Filter by Free Periods Only if setting enabled
        if (settings.freePeriodsOnly && entry.type === "meeting") continue;
        result[p].push({ name, type: entry.type });
      }
    }
  }

  // Ensure metrics exist (batch across all periods)
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

  // Build history stats once
  const history = loadCoverHistory();
  const currentWeek = getWeekNumber(coverDate);
  const histStats = buildHistoryStats(history, currentWeek);

  // Attach stats & sort each period's list
  for (let p = 0; p < 6; p++) {
    const list = result[p];

    // Filter based on fairness settings
    const filtered = list.filter((t) => {
      // Exclude DND teachers if setting enabled
      if (settings.excludeDnd && isTeacherDnd(t.name, day, p)) {
        return false;
      }

      // Check daily cap (for auto-assign)
      const dailyCovers = countCoversForTeacherOnDay(t.name, day);
      if (dailyCovers >= settings.maxCoversPerDay) {
        return false;
      }

      // Check weekly cap (for auto-assign)
      const weeklyCovers = countCoversForTeacherThisWeek(t.name);
      if (weeklyCovers >= settings.maxCoversPerWeek) {
        return false;
      }

      return true;
    });

    // Separate Last Resort and regular teachers
    let regularTeachers = [];
    let lastResortTeachers = [];

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

      if (settings.useLastResort && t.isLastResort) {
        lastResortTeachers.push(t);
      } else {
        regularTeachers.push(t);
      }
    }

    // Sort each group
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

    // Combine: regular teachers first, then Last Resort
    result[p] = regularTeachers.concat(lastResortTeachers);
  }

  return result;
}

// Legacy wrapper — used by drop handler validation (single period)
function getAvailableTeachers(period, day, absentList) {
  let available = getAllAvailableTeachers(day, absentList)[period] || [];

  // Filter out partial absent teachers during their own absent periods
  available = available.filter((teacher) => {
    if (partialAbsentTeachers[teacher.name]) {
      const absentPeriods = partialAbsentTeachers[teacher.name];
      return !absentPeriods.includes(period); // Exclude if absent in this period
    }
    return true; // Include if not partially absent
  });

  return available;
}

// ── UI: refresh teacher dropdown ───────────────────────────────

function refreshTeachers() {
  const sel = document.getElementById("addAbsenceTeacherSelect");
  if (!sel) return;
  const absentSet = new Set(absentTeachers);
  const names = getTeacherNames().filter((n) => !absentSet.has(n));
  names.sort();
  sel.innerHTML = names
    .map((n) => `<option value="${n}">${n}</option>`)
    .join("");
}

// ── UI: absent teachers table ──────────────────────────────────

function renderAbsentTeachersTable() {
  const tableBody = document.querySelector("#absentTeachersTable tbody");
  tableBody.innerHTML = absentTeachers
    .map(
      (name, idx) =>
        `<tr>
      <td>${name}</td>
      <td><span class="badge bg-danger">Full Day</span></td>
      <td><button class="btn btn-sm btn-danger" data-remove-idx="${idx}">Remove</button></td>
    </tr>`,
    )
    .join("");
  tableBody.onclick = (e) => {
    const btn = e.target.closest("[data-remove-idx]");
    if (!btn) return;
    absentTeachers.splice(parseInt(btn.dataset.removeIdx), 1);
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
      return `
      <div class="list-group-item d-flex justify-content-between align-items-center">
        <div>
          <strong>${name}</strong>
          <br><small class="text-muted">Absent: ${periodLabels}</small>
        </div>
        <button class="btn btn-sm btn-danger" onclick="removePartialAbsence('${name}')">Remove</button>
      </div>
    `;
    })
    .join("");

  list.innerHTML =
    partialList || '<div class="text-muted small">No partial absences</div>';
}

function removePartialAbsence(teacherName) {
  delete partialAbsentTeachers[teacherName];
  renderPartialAbsentList();
  refreshTeachers();
  scheduleRenderGrid();
}

// ── [OPT-1] Debounced renderGrid via requestAnimationFrame ─────

let _renderGridRAF = null;

function scheduleRenderGrid() {
  if (_renderGridRAF !== null) return; // already scheduled
  _renderGridRAF = requestAnimationFrame(() => {
    _renderGridRAF = null;
    renderGrid();
  });
}

// ── Dashboard Summary Widget Update ────────────────────────

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

  // Calculate fairness metrics
  const totals = {};
  for (const h of history) {
    totals[h.coverTeacher] = (totals[h.coverTeacher] || 0) + 1;
  }

  const values = Object.values(totals);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = (values.reduce((s, v) => s + v, 0) / values.length).toFixed(1);
  const ratio = (max / min).toFixed(2);

  // Calculate fairness score
  const imbalance = (max - min) / avg;
  const score = Math.max(0, Math.min(100, Math.round(100 - imbalance * 10)));

  // Update displays
  document.getElementById("fairnessScoreDisplay").textContent = score;
  document.getElementById("totalCoversDisplay").textContent = history.length;
  document.getElementById("teacherCountDisplay").textContent =
    Object.keys(totals).length;
  document.getElementById("imbalanceRatioDisplay").textContent = ratio;

  // Update trend message
  let trend = "";
  if (score >= 85) {
    trend = "✓ Excellent fairness balance. Continue current strategy.";
  } else if (score >= 70) {
    trend = "⚠️ Good fairness. Monitor for imbalance in next assignments.";
  } else if (score >= 50) {
    trend = "⚠️ Fair balance. Consider using Day-Balancing strategy.";
  } else {
    trend = "⚠️ Imbalanced. Strongly recommend Fair or Day-Balancing strategy.";
  }

  document.getElementById("dashboardTrend").textContent = trend;
}

function hasAnyAbsences() {
  return (
    absentTeachers.length > 0 || Object.keys(partialAbsentTeachers).length > 0
  );
}

function getCoverNeededLessons(day) {
  const items = [];

  // Full-day: all lesson entries
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
          periodCol: e.col, // 0-based
          entry: e,
          absenceType: "full",
          key: `${teacher}:${day}-${e.col}`,
        });
      });
  });

  // Partial-day: only selected absent periods
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

  // Stable ordering (nice for preview/printing)
  items.sort(
    (a, b) =>
      a.periodCol - b.periodCol ||
      a.coveredTeacher.localeCompare(b.coveredTeacher),
  );
  return items;
}

// ── UI: main cover grid ────────────────────────────────────────

function renderGrid() {
  // Cancel any pending scheduled render since we're rendering now
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

  // Get absence reason from UI
  const absenceReason =
    document.getElementById("absenceReasonSelect")?.value || "Not Specified";

  // Build absent teacher lessons table grouped by teacher
  const rowsHtml = [];

  // Process full-day absent teachers
  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    const lessons = data.entries
      .filter((e) => e.row == day && e.type === "lesson")
      .sort((a, b) => a.col - b.col);

    if (lessons.length === 0) return;

    // Teacher header row
    rowsHtml.push(`
      <tr class="table-active">
        <td colspan="6" class="fw-bold">
          <span class='badge bg-danger'>Full Day</span> ${teacher} 
        </td>
      </tr>
    `);

    // Reason row
    rowsHtml.push(`
      <tr class="table-light">
        <td colspan="6" class="text-muted">
          <small><strong>Reason:</strong> ${absenceReason}</small>
        </td>
      </tr>
    `);

    // Column headers for this teacher's periods
    rowsHtml.push(`
      <tr class="table-secondary">
        <th style="width: 10%;">Period</th>
        <th style="width: 15%;">Subject/Type</th>
        <th style="width: 20%;">Class</th>
        <th style="width: 15%;">Venue</th>
        <th style="width: 40%;">Assign Cover</th>
      </tr>
    `);

    // Period rows
    lessons.forEach((e) => {
      if (e.col === 6) return;
      const key = teacher + ":" + day + "-" + e.col;
      let assignHtml = "";

      const assigned = coverAssignments[key];
      const noCover = noCoverNeeded[key];

      if (assigned) {
        assignHtml = `<div class="border p-2" style="min-height:3em"><button class='btn btn-sm btn-danger ms-2' data-undo-key="${key}">Undo</button><span class='badge bg-success'> ${assigned}</span></div>`;
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

      rowsHtml.push(
        `<tr><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ""}</td><td>${e.venue || ""}</td><td>${assignHtml}</td></tr>`,
      );
    });

    // Spacer row between teachers
    rowsHtml.push(`
      <tr>
        <td colspan="6" style="height: 10px; background-color: #f8f9fa;"></td>
      </tr>
    `);
  });

  // Process partial-day absent teachers
  Object.entries(partialAbsentTeachers).forEach(([teacher, absentPeriods]) => {
    const data = loadTeacher(teacher);
    if (!data) return;
    const lessons = data.entries
      .filter(
        (e) =>
          e.row == day && e.type === "lesson" && absentPeriods.includes(e.col),
      )
      .sort((a, b) => a.col - b.col);

    if (lessons.length === 0) return;

    const periodLabels = absentPeriods.map((p) => `P${p + 1}`).join(",");

    // Teacher header row
    rowsHtml.push(`
      <tr class="table-active">
        <td colspan="6" class="fw-bold">
          <span class='badge bg-warning text-dark'>Partial: ${periodLabels}</span> ${teacher} 
        </td>
      </tr>
    `);

    // Reason row
    rowsHtml.push(`
      <tr class="table-light">
        <td colspan="6" class="text-muted">
          <small><strong>Reason:</strong> ${absenceReason}</small>
        </td>
      </tr>
    `);

    // Column headers for this teacher's periods
    rowsHtml.push(`
      <tr class="table-secondary">
        <th style="width: 10%;">Period</th>
        <th style="width: 15%;">Subject/Type</th>
        <th style="width: 20%;">Class</th>
        <th style="width: 15%;">Venue</th>
        <th style="width: 40%;">Assign Cover</th>
      </tr>
    `);

    // Period rows
    lessons.forEach((e) => {
      if (e.col === 6) return;
      const key = teacher + ":" + day + "-" + e.col;
      let assignHtml = "";

      const assigned = coverAssignments[key];
      const noCover = noCoverNeeded[key];

      if (assigned) {
        assignHtml = `<div class="border p-2" style="min-height:3em"><button class='btn btn-sm btn-danger ms-2' data-undo-key="${key}">Undo</button><span class='badge bg-success'> ${assigned}</span></div>`;
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

      rowsHtml.push(
        `<tr><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ""}</td><td>${e.venue || ""}</td><td>${assignHtml}</td></tr>`,
      );
    });

    // Spacer row between teachers
    rowsHtml.push(`
      <tr>
        <td colspan="6" style="height: 10px; background-color: #f8f9fa;"></td>
      </tr>
    `);
  });

  grid.innerHTML = `<table class="table table-bordered">
    <tbody>${rowsHtml.join("")}</tbody></table>`;

  // Event delegation for grid actions
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

  // Set up drag-drop on drop zones
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
      // Use indexed entry lookup
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

  // ── [OPT-3] Build available cover teachers table — single pass for all periods
  const allAvail = getAllAvailableTeachers(day, absentTeachers);
  const availRows = [];
  for (let period = 0; period < 6; period++) {
    const avail = allAvail[period];
    let tdContent;
    if (avail.length === 0) {
      tdContent = '<span class="text-muted">None</span>';
    } else {
      tdContent = avail
        .map((teacher) => {
          const warningClass =
            teacher.totalCovers > 5 ? " border border-danger" : "";
          return `<span class="badge me-1 avail-badge ${teacher.type === "free" ? "bg-primary" : "bg-secondary"}${warningClass}" draggable="true" data-teacher-name="${teacher.name}">
  ${teacher.name}
  <span class="badge bg-light text-dark ms-1" title="Total covers">T:${teacher.totalCovers}</span>
  <span class="badge bg-light text-dark ms-1" title="This week">W:${teacher.coversThisWeek}</span>
  <span class="badge bg-light text-dark ms-1" title="Per-week avg">A:${teacher.coversPerWeek}</span>
  <span class="badge bg-light text-dark ms-1" title="Free periods">F:${teacher.freePeriods}</span>
  ${teacher.type === "meeting" ? " (M)" : ""}
</span>`;
        })
        .join("");
    }
    availRows.push(
      `<tr><td>Period ${period + 1}</td><td>${tdContent}</td></tr>`,
    );
  }

  availDiv.innerHTML = `<table class="table table-bordered table-sm">
    <thead><tr><th>Period</th><th>Available Teachers</th></tr></thead>
    <tbody>${availRows.join("")}</tbody></table>`;

  checkFairnessWarnings();
  updateDashboardSummary();
}

// Assign dragstart once — prevents listener accumulation on every renderGrid call
document.getElementById("availableCoverList").ondragstart = (ev) => {
  const badge = ev.target.closest("[data-teacher-name]");
  if (badge) ev.dataTransfer.setData("text", badge.dataset.teacherName);
};

// ── Fairness warnings ──────────────────────────────────────────

function checkFairnessWarnings() {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  const settings = getFairnessSettings();
  const coversPerTeacher = {};

  for (let i = 0, len = history.length; i < len; i++) {
    if (history[i].week === week) {
      const t = history[i].coverTeacher;
      coversPerTeacher[t] = (coversPerTeacher[t] || 0) + 1;
    }
  }

  const warnings = [];
  for (const teacher in coversPerTeacher) {
    if (coversPerTeacher[teacher] > settings.maxCoversPerWeek) {
      warnings.push(
        `⚠️ ${teacher} has ${coversPerTeacher[teacher]} covers this week (exceeds fair limit of ${settings.maxCoversPerWeek})`,
      );
    }
  }

  // Add info about active constraints
  const constraintInfo = [];
  if (settings.excludeDnd) constraintInfo.push("DND teachers excluded");
  if (settings.useLastResort)
    constraintInfo.push("Last Resort used only as backup");
  if (constraintInfo.length > 0) {
    warnings.push(
      `ℹ️ Active fairness constraints: ${constraintInfo.join(", ")}`,
    );
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

// ── [OPT-4] Auto-assign with batched saveMetrics ───────────────

function autoAssignCoverTeachers() {
  if (absentTeachers.length === 0) {
    alert("No absent teachers to assign covers for.");
    return;
  }

  const day = parseInt(document.getElementById("absenceDaySelect").value);
  let assignmentsMade = 0,
    conflicts = 0;
  const assignedTeachers = new Set(Object.values(coverAssignments));

  // Load metrics ONCE before the loop
  const metrics = loadMetrics();

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;

    const lessons = data.entries
      .filter((e) => e.row == day && e.type === "lesson")
      .sort((a, b) => a.col - b.col);

    lessons.forEach((e) => {
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

        // Update metrics in-memory (no save per iteration)
        if (!metrics[best.name]) {
          metrics[best.name] = {
            freePeriods: calculateFreePeriods(best.name),
            coversDone: 0,
            coversThisWeek: 0,
            totalCovers: 0,
            lastCoverDate: null,
          };
        }
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

  // [OPT-4] Single save after all assignments
  saveMetrics(metrics);

  renderGrid();
  let message = `Auto-assignment complete!\n\nAssignments made: ${assignmentsMade}`;
  if (conflicts > 0)
    message += `\nUnassigned lessons: ${conflicts} (no suitable teachers available)`;
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
  dateInput.value = startDate || new Date().toISOString().split("T")[0];
  updatePeriodStatus();
}

function updatePeriodStatus() {
  const startDate = getCachedTenWeekStart();
  if (!startDate) {
    document.getElementById("periodStatus").innerHTML =
      "Not set. Will initialize on first use.";
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
    tbody.innerHTML =
      "<tr><td colspan='6' class='text-center text-muted'>No cover history yet</td></tr>";
    return;
  }
  tbody.innerHTML = history
    .map(
      (entry) =>
        `<tr><td>${entry.date}</td><td>${entry.week}</td><td>${entry.coveredTeacher}</td><td>${entry.coverTeacher}</td><td>${entry.period}</td><td>${entry.subject}</td></tr>`,
    )
    .join("");
}

// ── Print / Export helpers ─────────────────────────────────────

function getCoverPlanRows(day) {
  const rows = [];
  const coverNeeded = getCoverNeededLessons(day);

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

  const reason =
    document.getElementById("absenceReasonSelect")?.value || "Not specified";

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
    return (
      html +
      "<div class='alert alert-info'>No absent teacher lessons found for the selected day.</div></div>"
    );
  }

  Object.entries(groupedByTeacher).forEach(([teacher, teacherRows]) => {
    html += `
    <div class="mb-4 teacher-block">
      <table class="table table-borderless mb-1">
        <tr>
          <td colspan="2" class="fw-bold">${teacher}</td>
        </tr>
        <tr>
          <td colspan="2" class="text-muted">
            <strong>Reason:</strong> ${reason}
          </td>
        </tr>
      </table>

      <table class="table table-sm table-bordered">
        <thead class="table-light">
          <tr>
            <th style="width:40px">#</th>
            <th style="width:80px">Class</th>
            <th style="width:80px">Venue</th>
            <th>Subject</th>
            <th>Assigned Cover</th>
          </tr>
        </thead>
        <tbody>
  `;

    teacherRows.forEach((r, index) => {
      html += `
      <tr>
        <td>${r.period}</td>
        <td>${r.className}</td>
        <td>${r.venue}</td>
        <td>${r.subject}</td>
        <td>${r.assigned || "—"}</td>
      </tr>
    `;
    });

    html += `
        </tbody>
      </table>
    </div>
  `;
  });

  return html;
}

// ── [OPT-7] Lazy-load html2canvas & jsPDF ──────────────────────

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
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
  // [OPT-7] Only inject heavy libs when the print preview is actually opened
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

      // Lazy-load libs only when PDF/PNG buttons are clicked
      const ensureLibs = () => {
        const promises = [];
        if (!win.html2canvas) {
          promises.push(
            new Promise((res, rej) => {
              const s = doc.createElement("script");
              s.src = HTML2CANVAS_URL;
              s.onload = res;
              s.onerror = rej;
              doc.head.appendChild(s);
            }),
          );
        }
        if (!win.jspdf) {
          promises.push(
            new Promise((res, rej) => {
              const s = doc.createElement("script");
              s.src = JSPDF_URL;
              s.onload = res;
              s.onerror = rej;
              doc.head.appendChild(s);
            }),
          );
        }
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
                const pdfW = pdf.internal.pageSize.getWidth();
                const pdfH = pdf.internal.pageSize.getHeight();
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
            const content = doc.querySelector(".container");
            if (!content) return;
            win
              .html2canvas(content, { scale: 2 })
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

document.getElementById("addAbsenceTeacherBtn").onclick = () => {
  const sel = document.getElementById("addAbsenceTeacherSelect");
  const name = sel.value;
  if (name && !absentTeachers.includes(name)) {
    absentTeachers.push(name);
    refreshTeachers();
    renderAbsentTeachersTable();
    scheduleRenderGrid();
  }
};

// ── Partial Absence Modal Handlers ─────────────────────────

document
  .getElementById("addPartialAbsenceBtn")
  ?.addEventListener("click", () => {
    const sel = document.getElementById("addAbsenceTeacherSelect");
    const name = sel.value;

    if (!name) {
      alert("Please select a teacher first");
      return;
    }

    // Show teacher name in modal
    document.getElementById("partialTeacherDisplay").textContent = name;

    // Clear period checkboxes
    document
      .querySelectorAll(".period-checkbox")
      .forEach((cb) => (cb.checked = false));

    // Store teacher name for confirmation
    window.selectedPartialTeacher = name;
  });

document
  .getElementById("confirmPartialAbsenceBtn")
  ?.addEventListener("click", () => {
    const teacher = window.selectedPartialTeacher;
    const selectedPeriods = [];

    document.querySelectorAll(".period-checkbox:checked").forEach((cb) => {
      selectedPeriods.push(parseInt(cb.value));
    });

    if (selectedPeriods.length === 0) {
      alert("Please select at least one period");
      return;
    }

    // Add to partial absent
    partialAbsentTeachers[teacher] = selectedPeriods;

    // Remove from full absent if present
    const idx = absentTeachers.indexOf(teacher);
    if (idx > -1) {
      absentTeachers.splice(idx, 1);
    }

    refreshTeachers();
    renderAbsentTeachersTable();
    scheduleRenderGrid();

    // Close modal
    const modal = bootstrap.Modal.getInstance(
      document.getElementById("partialAbsenceModal"),
    );
    modal?.hide();
  });

document.getElementById("saveBtn").onclick = () => {
  localStorage.setItem("coverPlans", JSON.stringify(coverAssignments));
  alert("Saved");
};

// ── Round-Robin Auto-Assign ───────────────────────────────

function autoAssignRoundRobin() {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const allAvail = getAllAvailableTeachers(day, absentTeachers);
  const assignments = {};
  const noCoverAssignments = {};
  let assignmentsMade = 0;
  let conflicts = 0;

  // Flatten all available teachers
  const allTeachers = [];
  for (let p = 0; p < 6; p++) {
    allTeachers.push(...allAvail[p]);
  }

  let teacherIndex = 0;

  // Process each absent teacher's lessons
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

        // Find next available teacher (cycle through)
        let assigned = false;
        let attempts = 0;
        while (attempts < allTeachers.length) {
          const candidate = allTeachers[teacherIndex % allTeachers.length];
          teacherIndex++;
          attempts++;

          // Check if this candidate is available for this period
          const candidateAvail = allAvail[e.col].find(
            (t) => t.name === candidate.name,
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
  });

  // Process partial absent teachers
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
        const key = teacher + ":" + day + "-" + e.col;

        if (coverAssignments[key] || noCoverNeeded[key]) return;

        // Find next available teacher (cycle through)
        let assigned = false;
        let attempts = 0;
        while (attempts < allTeachers.length) {
          const candidate = allTeachers[teacherIndex % allTeachers.length];
          teacherIndex++;
          attempts++;

          // Check if this candidate is available for this period and not the partial absent teacher
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
  });

  return { assignments, noCoverAssignments, assignmentsMade, conflicts };
}

// ── Preview Auto-Assign ───────────────────────────────────

function previewAutoAssign() {
  if (!hasAnyAbsences()) {
    alert("No absent teachers selected.");
    return;
  }

  const strategy = document.getElementById("autoAssignStrategy").value;
  let result;

  if (strategy === "roundRobin") {
    result = autoAssignRoundRobin();
  } else if (strategy === "dayBalancing") {
    result = autoAssignDayBalancing();
  } else {
    result = generateAutoAssignments();
  }

  previewAssignments = result.assignments;
  previewNoCoverNeeded = result.noCoverAssignments;
  preAutoAssignState = {
    coverAssignments: { ...coverAssignments },
    noCoverNeeded: { ...noCoverNeeded },
  };

  // Detect back-to-back conflicts
  const conflicts = detectBackToBackConflicts(previewAssignments);

  // Build preview HTML with improved formatting
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  let strategyLabel;
  if (strategy === "roundRobin") {
    strategyLabel = "Round-Robin (Sequential)";
  } else if (strategy === "dayBalancing") {
    strategyLabel = "Day-Balancing (Spread Across Day)";
  } else {
    strategyLabel = "Fair (Minimize Unfairness)";
  }

  let html = `
    <div class="alert alert-info mb-3">
      <strong>Strategy:</strong> ${strategyLabel} | 
      <strong>Day:</strong> Day ${parseInt(day) + 1}
    </div>
    
    <table class="table table-striped table-hover table-sm">
      <thead class="table-dark">
        <tr>
          <th>Absent Teacher</th>
          <th style="width: 60px;">Period</th>
          <th>Subject</th>
          <th>Preview: Cover Assignment</th>
        </tr>
      </thead>
      <tbody>
  `;

  let count = 0;
  let successCount = 0;

  absentTeachers.forEach((teacher) => {
    const data = loadTeacher(teacher);
    if (!data) return;

    data.entries
      .filter((e) => e.row == day && e.type === "lesson")
      .sort((a, b) => a.col - b.col)
      .forEach((e) => {
        const key = teacher + ":" + day + "-" + e.col;
        const assigned = previewAssignments[key];
        const isAssigned = !!assigned;

        if (isAssigned) successCount++;
        count++;

        const rowClass = isAssigned ? "" : "table-danger";
        const assignedText = assigned
          ? `<strong>${assigned}</strong>`
          : `<span class="badge bg-danger">NOT ASSIGNED</span>`;

        html += `
        <tr class="${rowClass}">
          <td>${teacher}</td>
          <td style="text-align: center;">${e.col + 1}</td>
          <td>${e.subject || ""}</td>
          <td>${assignedText}</td>
        </tr>
      `;
      });
  });

  // Add partial absent teachers to preview
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
        const key = teacher + ":" + day + "-" + e.col;
        const assigned = previewAssignments[key];
        const isAssigned = !!assigned;

        if (isAssigned) successCount++;
        count++;

        const rowClass = isAssigned ? "" : "table-danger";
        const assignedText = assigned
          ? `<strong>${assigned}</strong>`
          : `<span class="badge bg-danger">NOT ASSIGNED</span>`;

        html += `
        <tr class="${rowClass}">
          <td>${teacher} <span class="badge bg-info">Partial</span></td>
          <td style="text-align: center;">${e.col + 1}</td>
          <td>${e.subject || ""}</td>
          <td>${assignedText}</td>
        </tr>
      `;
      });
  });

  html += `
      </tbody>
    </table>
    
    <div class="alert alert-secondary mt-3">
      <strong>Summary:</strong><br>
      ✓ ${successCount} assignments made<br>
      ⚠️ ${result.conflicts} unassigned lessons
    </div>
  `;

  // Add strategy notes
  if (strategy === "roundRobin") {
    html += `<small class="text-muted d-block mt-2"><i>Round-Robin cycles through available teachers sequentially.</i></small>`;
  } else {
    html += `<small class="text-muted d-block mt-2"><i>Fair strategy assigns to teachers with fewest total covers.</i></small>`;
  }

  document.getElementById("previewAssignmentsList").innerHTML = html;

  // Build warnings section with conflict detection and fairness score
  let warningsHtml = "";

  if (result.conflicts > 0) {
    warningsHtml += `<strong>⚠️ ${result.conflicts} lessons cannot be assigned</strong><br>
      <small>No suitable teachers available with current fairness constraints.</small><br>`;
  }

  if (conflicts.length > 0) {
    warningsHtml += `<strong>⚠️ Back-to-back conflicts detected (${conflicts.length})</strong><br>
      <small>Same teacher assigned to consecutive periods. Consider manually adjusting.</small><br>`;
  }

  // Calculate and display fairness score
  const history = loadCoverHistory
    ? typeof loadCoverHistory === "function"
      ? loadCoverHistory()
      : []
    : [];
  const fairnessMetrics = calculateFairnessScore(history);
  warningsHtml += `<strong>📊 Fairness Score: ${fairnessMetrics.score}/100</strong><br>
    <small>Min: ${fairnessMetrics.min}, Max: ${fairnessMetrics.max}, Avg: ${fairnessMetrics.avg}, Ratio: ${fairnessMetrics.ratio}</small>`;

  if (warningsHtml) {
    document.getElementById("previewWarnings").innerHTML = warningsHtml;
    document.getElementById("previewWarnings").style.display = "block";
  } else {
    document.getElementById("previewWarnings").style.display = "none";
  }

  const previewModal = new bootstrap.Modal(
    document.getElementById("previewAutoAssignModal"),
  );
  previewModal.show();
}

// ── Apply Assignments from Preview ────────────────────────

function applyPreviewAssignments() {
  Object.assign(coverAssignments, previewAssignments);
  Object.assign(noCoverNeeded, previewNoCoverNeeded);

  // Add to history (FULL + PARTIAL) using unified cover-needed list
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const coverNeeded = getCoverNeededLessons(day);

  coverNeeded.forEach((item) => {
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
    assignmentsMade: Object.keys(previewAssignments).length,
  });

  renderGrid();
  alert(
    `Auto-assign complete! ${Object.keys(previewAssignments).length} assignments applied.`,
  );
}

// ── Generate Auto-Assignments (Fair Strategy) ────────────

function generateAutoAssignments() {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const settings = getFairnessSettings();

  // ── FULL-DAY ABSENCES ──
  const assignments = {};
  const metrics = loadMetrics();
  let assignmentsMade = 0;
  let conflicts = 0;

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
        ).filter((t) => !Object.values(assignments).includes(t.name));

        // Apply fairness: choose teacher with fewest covers
        if (availableTeachers.length > 0) {
          availableTeachers.sort(
            (a, b) =>
              (metrics[a.name]?.totalCovers || 0) -
              (metrics[b.name]?.totalCovers || 0),
          );
          const best = availableTeachers[0];
          assignments[key] = best.name;
          assignmentsMade++;
        } else {
          conflicts++;
        }
      });
  });

  // ── PARTIAL-DAY ABSENCES ──
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
        const key = teacher + ":" + day + "-" + e.col;

        if (coverAssignments[key] || noCoverNeeded[key]) return;

        let availableTeachers = getAvailableTeachers(
          e.col,
          day,
          absentTeachers,
        ).filter(
          (t) =>
            !Object.values(assignments).includes(t.name) && t.name !== teacher,
        );

        // Apply fairness: choose teacher with fewest covers
        if (availableTeachers.length > 0) {
          availableTeachers.sort(
            (a, b) =>
              (metrics[a.name]?.totalCovers || 0) -
              (metrics[b.name]?.totalCovers || 0),
          );
          const best = availableTeachers[0];
          assignments[key] = best.name;
          assignmentsMade++;
        } else {
          conflicts++;
        }
      });
  });

  return { assignments, noCoverAssignments: {}, assignmentsMade, conflicts };
}

// ── Day-Balancing Auto-Assign Strategy (Phase 2) ────────────

function autoAssignDayBalancing() {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const allAvail = getAllAvailableTeachers(day, absentTeachers);
  const assignments = {};
  const metrics = loadMetrics();
  let assignmentsMade = 0;
  let conflicts = 0;

  // Track covers assigned per teacher today
  const coversAssignedToday = {};

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
        ).filter((t) => !Object.values(assignments).includes(t.name));

        if (availableTeachers.length > 0) {
          // Sort by: fewest covers TODAY first, then by total fairness
          availableTeachers.sort((a, b) => {
            const aToday = coversAssignedToday[a.name] || 0;
            const bToday = coversAssignedToday[b.name] || 0;
            if (aToday !== bToday) return aToday - bToday;
            return a.totalCovers - b.totalCovers;
          });

          const best = availableTeachers[0];
          assignments[key] = best.name;
          coversAssignedToday[best.name] =
            (coversAssignedToday[best.name] || 0) + 1;
          assignmentsMade++;
        } else {
          conflicts++;
        }
      });
  });

  // Process partial absent teachers
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
        const key = teacher + ":" + day + "-" + e.col;

        if (coverAssignments[key] || noCoverNeeded[key]) return;

        let availableTeachers = getAvailableTeachers(
          e.col,
          day,
          absentTeachers,
        ).filter(
          (t) =>
            !Object.values(assignments).includes(t.name) && t.name !== teacher,
        );

        if (availableTeachers.length > 0) {
          // Sort by: fewest covers TODAY first, then by total fairness
          availableTeachers.sort((a, b) => {
            const aToday = coversAssignedToday[a.name] || 0;
            const bToday = coversAssignedToday[b.name] || 0;
            if (aToday !== bToday) return aToday - bToday;
            return a.totalCovers - b.totalCovers;
          });

          const best = availableTeachers[0];
          assignments[key] = best.name;
          coversAssignedToday[best.name] =
            (coversAssignedToday[best.name] || 0) + 1;
          assignmentsMade++;
        } else {
          conflicts++;
        }
      });
  });

  return { assignments, noCoverAssignments: {}, assignmentsMade, conflicts };
}

// ── Conflict Detection (Back-to-Back Prevention) ────────────

function detectBackToBackConflicts(assignments) {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const conflicts = [];

  Object.entries(assignments).forEach(([key, teacher]) => {
    const [absent, dayCol] = key.split(":");
    const [dayNum, period] = dayCol.split("-");
    const periodNum = parseInt(period);

    // Check if same teacher assigned to consecutive periods
    const nextKey = absent + ":" + dayNum + "-" + (periodNum + 1);
    const prevKey = absent + ":" + dayNum + "-" + (periodNum - 1);

    if (assignments[nextKey] === teacher) {
      conflicts.push({
        teacher: teacher,
        absent: absent,
        periods: `${periodNum + 1}-${periodNum + 2}`,
        type: "back-to-back",
      });
    }
  });

  return conflicts;
}

// ── Fairness Score Calculation (for visualization) ──────────

function calculateFairnessScore(history) {
  if (history.length === 0) return { score: 100, details: "No data" };

  const totals = {};
  for (const h of history) {
    totals[h.coverTeacher] = (totals[h.coverTeacher] || 0) + 1;
  }

  const values = Object.values(totals);
  if (values.length <= 1) return { score: 100, details: "Only one teacher" };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;

  // Fairness score: 100 if perfectly balanced, lower if imbalanced
  // Formula: 100 - (((max - min) / avg) * 10), clamped to 0-100
  const ratio = (max - min) / avg;
  const score = Math.max(0, Math.min(100, 100 - ratio * 10));

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
    confirm(
      "Undo auto-assign? This will revert to the state before auto-assign was applied.",
    )
  ) {
    coverAssignments = preAutoAssignState.coverAssignments;
    noCoverNeeded = preAutoAssignState.noCoverNeeded;
    preAutoAssignState = null;
    previewAssignments = {};
    previewNoCoverNeeded = {};

    addToHistoryLog("AUTO_ASSIGN_UNDONE", {});

    renderGrid();
    alert("Auto-assign reverted.");
  }
};

document.getElementById("confirmAutoAssignBtn").onclick = () => {
  const modal = bootstrap.Modal.getInstance(
    document.getElementById("previewAutoAssignModal"),
  );
  modal.hide();
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

// BULK IMPORT
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
    _buildEntryIndex(name, data); // Build index on import
    _teacherNamesCache = null;
    count++;
  }
  document.getElementById("status").innerText = "Imported " + count;
  refreshTeachers();
  scheduleRenderGrid();
});

// Clear only absent teachers and current cover assignments (preserves history)
document.getElementById("clearBtn").onclick = () => {
  if (
    confirm(
      "Clear absent teachers and today's cover assignments?\n\nThis will NOT erase cover history (needed for fairness tracking).",
    )
  ) {
    absentTeachers = [];
    coverAssignments = {};
    noCoverNeeded = {};

    addToHistoryLog("CLEAR_DAY_DATA", {
      absentTeachersCleared: absentTeachers.length,
    });

    document.getElementById("status").innerText =
      "Absent teachers and assignments cleared. History preserved.";
    renderAbsentTeachersTable();
    renderGrid();
  }
};

// Full system reset with backup and confirmation
document.getElementById("clearAllBtn").onclick = () => {
  const confirmed = confirm(
    "⚠️ FULL SYSTEM RESET - This cannot be undone!\n\n" +
      "This will clear:\n" +
      "• All teacher timetables\n" +
      "• Cover history\n" +
      "• Metrics and fairness data\n\n" +
      "An automated backup will be exported.\n\n" +
      "Type 'CLEAR ALL' in the next prompt to confirm.",
  );

  if (!confirmed) return;

  const userInput = prompt("Type 'CLEAR ALL' to confirm full system reset:");
  if (userInput !== "CLEAR ALL") {
    alert("Reset cancelled.");
    return;
  }

  // Backup before clearing
  backupCoverHistory();
  autoExportAllData();
  addToHistoryLog("FULL_SYSTEM_RESET", {
    action: "All data cleared with backups exported",
  });

  // Clear everything
  const keysToRemove = [];
  for (let i = 0, len = localStorage.length; i < len; i++) {
    const k = localStorage.key(i);
    if (
      k.startsWith(PREFIX) ||
      k === "coverPlans" ||
      k === METRICS_KEY ||
      k === HISTORY_KEY
    ) {
      keysToRemove.push(k);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));

  teacherCache = {};
  coverAssignments = {};
  noCoverNeeded = {};
  tallies = {};
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
    coverAssignments,
    noCoverNeeded,
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

  // Sheet 2: Weekly Breakdown (single pass)
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

  // Sheet 3: Detailed History
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

  // Sheet 4: Statistics
  const totalCovers = history.length;
  const uniqueTeachers = teachers.size;
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

// ── History backup and accountability ──────────────────────

function backupCoverHistory() {
  const history = loadCoverHistory();
  const backup = {
    date: new Date().toISOString(),
    historyCount: history.length,
    data: history,
  };
  const backups = JSON.parse(localStorage.getItem(HISTORY_BACKUP_KEY) || "[]");
  backups.push(backup);
  // Keep last 10 backups only
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
  // Auto-clear log if older than 3 months OR over 100 entries
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const filtered = log.filter(
    (entry) => new Date(entry.timestamp) > threeMonthsAgo,
  );

  if (filtered.length > 100) {
    const oldEntries = log.slice(0, log.length - 100);
    // Export old entries before clearing
    if (oldEntries.length > 0) {
      autoExportHistoryLog(oldEntries);
    }
    localStorage.setItem(HISTORY_LOG_KEY, JSON.stringify(filtered.slice(-100)));
  } else {
    localStorage.setItem(HISTORY_LOG_KEY, JSON.stringify(filtered));
  }
}

function autoExportHistoryLog(entries) {
  const data = {
    exportDate: new Date().toISOString(),
    archiveType: "history-log-archive",
    entries: entries,
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

function shouldAutoCleanHistory() {
  const lastClear = localStorage.getItem(LAST_AUTO_CLEAR_KEY);
  if (!lastClear) return false;

  const lastClearDate = new Date(lastClear);
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  return lastClearDate < threeMonthsAgo;
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

// ── Teacher Search Filter ─────────────────────────────────

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

  // Add click handlers to results
  searchResults.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      document.getElementById("addAbsenceTeacherSelect").value =
        btn.dataset.teacherName;
      document.getElementById("teacherSearchInput").value = "";
      searchResults.style.display = "none";
      document.getElementById("addAbsenceTeacherBtn").click();
    };
  });
});

// Hide search results when clicking outside
document.addEventListener("click", (e) => {
  if (
    !e.target.closest("#teacherSearchInput") &&
    !e.target.closest("#searchResults")
  ) {
    document.getElementById("searchResults").style.display = "none";
  }
});

document.getElementById("autoAssignBtn").onclick = () => {
  previewAutoAssign();
};

// ── Keyboard Shortcuts for Workflow ────────────────────────

document.addEventListener("keydown", (e) => {
  // Ctrl/Cmd + 1-4 to jump to workflow steps
  if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "4") {
    e.preventDefault();
    focusStep(parseInt(e.key));
  }

  // Tab through workflow steps with Alt+Right/Left
  if ((e.ctrlKey || e.metaKey) && e.key === "ArrowRight") {
    e.preventDefault();
    const nextStep = Math.min(4, currentWorkflowStep + 1);
    focusStep(nextStep);
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft") {
    e.preventDefault();
    const prevStep = Math.max(1, currentWorkflowStep - 1);
    focusStep(prevStep);
  }

  // Alt+A to open auto-assign preview (when on step 3)
  if (
    (e.altKey || e.metaKey) &&
    e.key.toLowerCase() === "a" &&
    currentWorkflowStep >= 2
  ) {
    e.preventDefault();
    if (hasAnyAbsences()) {
      document.getElementById("autoAssignBtn")?.click();
    }
  }

  // Ctrl+Shift+A to auto-assign and SKIP preview (power users)
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
    if (strategy === "roundRobin") {
      result = autoAssignRoundRobin();
    } else if (strategy === "dayBalancing") {
      result = autoAssignDayBalancing();
    } else {
      result = generateAutoAssignments();
    }
    previewAssignments = result.assignments;
    previewNoCoverNeeded = result.noCoverAssignments;
    applyPreviewAssignments(); // Apply directly, no modal
    alert(`✓ Auto-assigned! ${result.assignmentsMade} covers assigned.`);
  }

  // Alt+E to export (when on step 4)
  if (
    (e.altKey || e.metaKey) &&
    e.key.toLowerCase() === "e" &&
    currentWorkflowStep >= 3
  ) {
    e.preventDefault();
    document.getElementById("exportExcelBtn")?.click();
  }
});

// ── Absence Reason Management ─────────────────────────────────

function populateAbsenceReasonDropdown() {
  const reasons = getAbsenceReasons();
  const select = document.getElementById("absenceReasonSelect");
  if (!select) return;

  select.innerHTML = '<option value="">-- Select reason --</option>';
  reasons.forEach((reason) => {
    const opt = document.createElement("option");
    opt.value = reason;
    opt.textContent = reason;
    select.appendChild(opt);
  });
}

function populateAbsenceReasonsList() {
  const reasons = getAbsenceReasons();
  const list = document.getElementById("absenceReasonsList");
  if (!list) return;

  list.innerHTML = reasons
    .map(
      (reason) => `
    <div class="list-group-item d-flex justify-content-between align-items-center">
      <span>${reason}</span>
      <button class="btn btn-sm btn-outline-danger" data-reason="${reason}" onclick="removeAbsenceReasonHandler('${reason}')">Remove</button>
    </div>
  `,
    )
    .join("");
}

function removeAbsenceReasonHandler(reason) {
  if (removeAbsenceReason(reason)) {
    populateAbsenceReasonDropdown();
    populateAbsenceReasonsList();
  }
}

// Event listeners for absence reasons modal
document
  .getElementById("addAbsenceReasonBtn")
  ?.addEventListener("click", () => {
    const input = document.getElementById("newAbsenceReasonInput");
    if (input && input.value.trim()) {
      if (addAbsenceReason(input.value)) {
        input.value = "";
        populateAbsenceReasonDropdown();
        populateAbsenceReasonsList();
      }
    }
  });

document
  .getElementById("resetAbsenceReasonsBtn")
  ?.addEventListener("click", () => {
    if (confirm("Reset absence reasons to defaults?")) {
      saveAbsenceReasons(DEFAULT_ABSENCE_REASONS);
      populateAbsenceReasonDropdown();
      populateAbsenceReasonsList();
    }
  });

document.getElementById("resetReasonBtn")?.addEventListener("click", () => {
  document.getElementById("absenceReasonSelect").value = "";
});

refreshTeachers();
renderGrid();
populateAbsenceReasonDropdown();
populateAbsenceReasonsList();
initializeDatePicker();
initializeTenWeekPeriod();
autoPruneOldEntries();

// Load smart defaults
document.getElementById("autoAssignStrategy").value = getLastStrategy();
document.getElementById("absenceReasonSelect").value = getLastReason();

// Save smart defaults when changed
document
  .getElementById("autoAssignStrategy")
  .addEventListener("change", (e) => {
    saveLastStrategy(e.target.value);
  });

document
  .getElementById("absenceReasonSelect")
  .addEventListener("change", (e) => {
    saveLastReason(e.target.value);
  });

document.addEventListener("show.bs.modal", (e) => {
  if (e.target.id === "historyModal") displayCoverHistory();
  else if (e.target.id === "tenWeekModal") initializePeriodModal();
  else if (e.target.id === "fairnessSettingsModal") {
    const settings = loadFairnessSettings();
    document.getElementById("excludeDndSwitch").checked = settings.excludeDnd;
    document.getElementById("freePeriodsOnlySwitch").checked =
      settings.freePeriodsOnly;
    document.getElementById("maxCoversPerDay").value = settings.maxCoversPerDay;
    document.getElementById("maxCoversPerWeek").value =
      settings.maxCoversPerWeek;
    document.getElementById("useLastResortSwitch").checked =
      settings.useLastResort;
  } else if (e.target.id === "settingsModal") {
    // Sync consolidated Settings modal with current data
    const settings = loadFairnessSettings();
    document.getElementById("excludeDndSwitch2").checked = settings.excludeDnd;
    document.getElementById("freePeriodsOnlySwitch2").checked =
      settings.freePeriodsOnly;
    document.getElementById("maxCoversPerDay2").value =
      settings.maxCoversPerDay;
    document.getElementById("maxCoversPerWeek2").value =
      settings.maxCoversPerWeek;
    document.getElementById("useLastResortSwitch2").checked =
      settings.useLastResort;

    // Populate absence reasons
    populateAbsenceReasonsList2();

    // Load 10-week period start
    const tenWeekStart = localStorage.getItem(TEN_WEEK_START);
    if (tenWeekStart) {
      document.getElementById("tenWeekStartDate2").value = tenWeekStart;
    }
  }
});

// Settings modal tab handlers
document
  .getElementById("saveFairnessSettings2")
  ?.addEventListener("click", () => {
    const settings = {
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
    saveFairnessSettings(settings);
    alert("✓ Fairness settings saved!");
  });

function populateAbsenceReasonsList2() {
  const reasons = getAbsenceReasons();
  const list = document.getElementById("absenceReasonsList2");
  list.innerHTML = reasons
    .map(
      (r) => `
    <div class="list-group-item d-flex justify-content-between align-items-center">
      ${r}
      <button class="btn btn-sm btn-danger" onclick="removeAbsenceReason2('${r}')">Remove</button>
    </div>
  `,
    )
    .join("");
}

function removeAbsenceReason2(reason) {
  removeAbsenceReason(reason);
  populateAbsenceReasonsList2();
  populateAbsenceReasonDropdown();
}

document
  .getElementById("addAbsenceReasonBtn2")
  ?.addEventListener("click", () => {
    const input = document.getElementById("newAbsenceReason2");
    const reason = input.value.trim();
    if (reason && addAbsenceReason(reason)) {
      input.value = "";
      populateAbsenceReasonsList2();
      populateAbsenceReasonDropdown();
    }
  });

document
  .getElementById("resetAbsenceReasonsBtn2")
  ?.addEventListener("click", () => {
    if (confirm("Reset to default absence reasons?")) {
      saveAbsenceReasons(DEFAULT_ABSENCE_REASONS);
      populateAbsenceReasonsList2();
      populateAbsenceReasonDropdown();
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

// Workflow collapse toggle icon
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

// ── Quick Navigation Workflow ──────────────────────────────

let currentWorkflowStep = 1;

function focusStep(step) {
  const stepNum = parseInt(step);
  let prerequisitesMet = true;
  let warnings = [];

  // Validate prerequisites for each step
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

  // Show warning if prerequisites not met
  if (!prerequisitesMet && stepNum > currentWorkflowStep) {
    const warningMsg = warnings.join("\n");
    alert(
      warningMsg +
        "\n\nYou can still continue, but complete these steps for best results.",
    );
  }

  // Update workflow step
  currentWorkflowStep = stepNum;
  updateWorkflowUI(stepNum);
  scrollToStep(stepNum);
}

function updateWorkflowUI(step) {
  // Update step indicators
  document.querySelectorAll(".workflow-step").forEach((btn, idx) => {
    const btnStep = parseInt(btn.dataset.step);
    if (btnStep === step) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Update progress display
  document.getElementById("workflowProgress").textContent = `${step}/4`;

  // Update badge colors
  for (let i = 1; i <= 4; i++) {
    const indicator = document.getElementById(`step${i}-indicator`);
    if (i < step) {
      indicator.textContent = "✓";
      indicator.className = "step-indicator text-success fw-bold";
    } else if (i === step) {
      indicator.textContent = "●";
      indicator.className = "step-indicator text-primary fw-bold";
    } else {
      indicator.textContent = "○";
      indicator.className = "step-indicator text-muted";
    }
  }
}

function scrollToStep(step) {
  // Scroll relevant section into view
  let targetElement;
  switch (step) {
    case 1:
      targetElement = document.getElementById("absenceDaySelect");
      break;
    case 2:
      targetElement = document.getElementById("teacherSearchInput");
      break;
    case 3:
      targetElement = document.getElementById("autoAssignStrategy");
      break;
    case 4:
      targetElement = document.getElementById("exportExcelBtn");
      break;
  }

  if (targetElement) {
    setTimeout(() => {
      targetElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
      targetElement.focus();
    }, 100);
  }
}

// Update workflow when key actions happen
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

// ── Fairness Settings Modal ────────────────────────────────

document.getElementById("saveFairnessBtn").onclick = () => {
  const settings = {
    excludeDnd: document.getElementById("excludeDndSwitch").checked,
    freePeriodsOnly: document.getElementById("freePeriodsOnlySwitch").checked,
    maxCoversPerDay: parseInt(document.getElementById("maxCoversPerDay").value),
    maxCoversPerWeek: parseInt(
      document.getElementById("maxCoversPerWeek").value,
    ),
    useLastResort: document.getElementById("useLastResortSwitch").checked,
  };

  saveFairnessSettings(settings);
  addToHistoryLog("FAIRNESS_SETTINGS_UPDATED", settings);
  alert("Fairness settings saved successfully!");

  // Close modal and re-render
  const modal = bootstrap.Modal.getInstance(
    document.getElementById("fairnessSettingsModal"),
  );
  if (modal) modal.hide();
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
    // [OPT-7] Lazy-load jsPDF only when needed
    if (!window.jspdf) {
      try {
        await loadScript(JSPDF_URL);
      } catch (err) {
        alert(
          "jsPDF library failed to load. Please check your internet connection.",
        );
        return;
      }
    }
    if (absentTeachers.length === 0) {
      alert("No absent teachers selected. Please add absent teachers first.");
      return;
    }

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
      const lessons = data.entries
        .filter((e) => e.row == day - 1 && e.type === "lesson")
        .sort((a, b) => a.col - b.col);
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
        if (y > 270) {
          doc.addPage();
          y = 15;
        }
      });
      y += 4;
    });

    const pdfBlob = doc.output("blob");
    const url = URL.createObjectURL(pdfBlob);
    window.open(url);
  } catch (error) {
    alert("Error generating PDF: " + error.message);
  }
}

// ---- Workflow Sidebar (full hide/show) ----
const WORKFLOW_SIDEBAR_STATE_KEY = "workflowSidebarVisible";

function setWorkflowBtnExpanded(expanded) {
  const btn = document.getElementById("workflowToggleBtn");
  if (!btn) return;
  btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  btn.classList.toggle("btn-outline-light", true);
  btn.classList.toggle("btn-light", false);
}

document.addEventListener("DOMContentLoaded", () => {
  const wrapper = document.getElementById("workflowSidebarCollapse");
  const btn = document.getElementById("workflowToggleBtn");
  if (!wrapper || !btn || !window.bootstrap) return;

  // Restore saved state (default = visible)
  const saved = localStorage.getItem(WORKFLOW_SIDEBAR_STATE_KEY);
  const visible = saved === null ? true : saved === "true";

  const collapse = bootstrap.Collapse.getOrCreateInstance(wrapper, {
    toggle: false,
  });
  if (visible) collapse.show();
  else collapse.hide();

  setWorkflowBtnExpanded(visible);

  // Persist + sync aria when user toggles
  wrapper.addEventListener("shown.bs.collapse", () => {
    localStorage.setItem(WORKFLOW_SIDEBAR_STATE_KEY, "true");
    setWorkflowBtnExpanded(true);
  });

  wrapper.addEventListener("hidden.bs.collapse", () => {
    localStorage.setItem(WORKFLOW_SIDEBAR_STATE_KEY, "false");
    setWorkflowBtnExpanded(false);
  });
});

window.coverApp = {
  loadCoverHistory,
  getWeekNumber,
  absentTeachers,
  partialAbsentTeachers,
  coverAssignments,
  noCoverNeeded,
};
