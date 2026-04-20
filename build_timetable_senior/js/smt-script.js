/*
  SMT Timetable Administration Script (Stable Build)
  -------------------------------------------------
  Fixes:
  - Restores valid JavaScript (previous file became syntactically corrupted).
  - Ensures Completeness Dashboard ALWAYS recalculates from current localStorage
    and updates #completenessSummary and #completenessTableBody.

  Features:
  - Folder bulk import (webkitdirectory)
  - Single JSON import
  - Export current teacher JSON
  - Backup Snapshot (all teacher_* keys)
  - Clear all timetables
  - Teacher rename/replace
  - Bulk remove titles (Mr/Mrs/Miss/Ms/Dr)
  - Timetable grid editor with per-cell modal
  - Meeting DND flag (doNotDisturb)
  - Teacher Last Resort flag (lastResort)
  - Audit missing cells + autofill
  - Bulk DND marking by day/period (for meeting entries)
  - 3-column layout helpers: Slim left nav + command palette (Ctrl/⌘+K)

  Storage contract:
  - All teacher timetables stored under localStorage key: teacher_<TeacherName>
*/

// ---------------------- STORAGE CONSTANTS ----------------------
const STORAGE_PREFIX = "teacher_";

// ---------------------- GLOBAL STATE ---------------------------
let timetableConfig = { rows: 0, cols: 0, dayNames: [] };
let timetableData = {};          // { "row-col": entry }
let currentTeacherName = "";
let currentTeacherKey = "";
let currentTeacherLastResort = false;
let unsavedChanges = false;

// Cached cell references for O(1) rendering
const _cellRefCache = new Map();
// Cached teacher list
let _teacherNamesCache = null;

// ---------------------- DOM READY ------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Core form & table
  const gridForm = document.getElementById("gridForm");
  const rowsInput = document.getElementById("rowsInput");
  const colsInput = document.getElementById("colsInput");
  const dayNamesInput = document.getElementById("dayNamesInput");
  const timetableTable = document.getElementById("timetableTable");
  const timetablePlaceholder = document.getElementById("timetablePlaceholder");
  const timetableWrapper = document.getElementById("timetableWrapper");

  // Search/select
  const teacherSearchInput = document.getElementById("teacherSearchInput");
  const teacherSelect = document.getElementById("teacherSelect");
  const currentTeacherLabel = document.getElementById("currentTeacherLabel");

  // Identity tools
  const teacherNameInput = document.getElementById("teacherNameInput");
  const renameTeacherBtn = document.getElementById("renameTeacherBtn");
  const removeTitlesBtn = document.getElementById("removeTitlesBtn");
  const lastResortSwitch = document.getElementById("lastResortSwitch");

  // Bulk folder import
  const bulkFolderBtn = document.getElementById("bulkFolderBtn");
  const bulkFolderInput = document.getElementById("bulkFolderInput");
  const bulkStatus = document.getElementById("bulkStatus");
  const bulkStatusDetail = document.getElementById("bulkStatusDetail");

  // Data & storage
  const saveBtn = document.getElementById("saveBtn");
  const loadBtn = document.getElementById("loadBtn");
  const clearBtn = document.getElementById("clearBtn");
  const clearAllTeachersBtn = document.getElementById("clearAllTeachersBtn");
  const importBtn = document.getElementById("importBtn");
  const importFileInput = document.getElementById("importFileInput");
  const exportBtn = document.getElementById("exportBtn");
  const snapshotBtn = document.getElementById("snapshotBtn");
  const snapshotStatus = document.getElementById("snapshotStatus");
  const copyJsonBtn = document.getElementById("copyJsonBtn");
  const jsonOutput = document.getElementById("jsonOutput");

  // Completeness & autofill
  const auditMissingBtn = document.getElementById("auditMissingBtn");
  const missingSummary = document.getElementById("missingSummary");
  const missingCellChips = document.getElementById("missingCellChips");
  const autofillBtn = document.getElementById("autofillBtn");

  // DND bulk marking
  const dndDaySelect = document.getElementById("dndDaySelect");
  const dndPeriodSelect = document.getElementById("dndPeriodSelect");
  const dndLoadTeachersBtn = document.getElementById("dndLoadTeachersBtn");
  const dndTeacherList = document.getElementById("dndTeacherList");
  const dndSelectAllBtn = document.getElementById("dndSelectAllBtn");
  const dndSelectNoneBtn = document.getElementById("dndSelectNoneBtn");
  const applyDndBtn = document.getElementById("applyDndBtn");
  const removeDndBtn = document.getElementById("removeDndBtn");
  const dndStatus = document.getElementById("dndStatus");

  // Completeness Dashboard
  const refreshCompletenessBtn = document.getElementById("refreshCompletenessBtn");
  const completenessSearchInput = document.getElementById("completenessSearchInput");
  const completenessIncompleteOnly = document.getElementById("completenessIncompleteOnly");
  const completenessSummary = document.getElementById("completenessSummary");
  const completenessTableBody = document.getElementById("completenessTableBody");

  // Unsaved badge
  const unsavedBadge = document.getElementById("unsavedBadge");

  // Summary panel
  const summaryTeacher = document.getElementById("summaryTeacher");
  const summaryCaptured = document.getElementById("summaryCaptured");
  const summaryUncaptured = document.getElementById("summaryUncaptured");
  const summaryNotes = document.getElementById("summaryNotes");

  // Modal elements
  const cellModalElement = document.getElementById("cellModal");
  const cellModal = cellModalElement ? new bootstrap.Modal(cellModalElement) : null;
  const cellForm = document.getElementById("cellForm");
  const cellRowInput = document.getElementById("cellRow");
  const cellColInput = document.getElementById("cellCol");
  const entryTypeSelect = document.getElementById("entryType");
  const entryTitleInput = document.getElementById("entryTitle");
  const entryClassInput = document.getElementById("entryClass");
  const entryVenueInput = document.getElementById("entryVenue");
  const detailFieldsDiv = document.getElementById("detailFields");
  const freeTimeHint = document.getElementById("freeTimeHint");
  const meetingConstraints = document.getElementById("meetingConstraints");
  const doNotDisturbSwitch = document.getElementById("doNotDisturbSwitch");
  const deleteCellBtn = document.getElementById("deleteCellBtn");

  // Rename confirm modal
  const renameConfirmModalEl = document.getElementById("renameConfirmModal");
  const renameConfirmModal = renameConfirmModalEl ? new bootstrap.Modal(renameConfirmModalEl) : null;
  const renameFromSpan = document.getElementById("renameFrom");
  const renameToSpan = document.getElementById("renameTo");
  const confirmRenameBtn = document.getElementById("confirmRenameBtn");

  // DND confirm modal
  const dndConfirmModalEl = document.getElementById("dndConfirmModal");
  const dndConfirmModal = dndConfirmModalEl ? new bootstrap.Modal(dndConfirmModalEl) : null;
  const dndConfirmSlot = document.getElementById("dndConfirmSlot");
  const dndConfirmCount = document.getElementById("dndConfirmCount");
  const confirmDndApplyBtn = document.getElementById("confirmDndApplyBtn");

  // ---------------------- HELPERS ----------------------------

  function setUnsaved(flag) {
    unsavedChanges = !!flag;
    if (unsavedBadge) unsavedBadge.classList.toggle("d-none", !unsavedChanges);
  }

  function normalizeTeacherName(name) {
    return (name || "").trim().replace(/\s+/g, " ");
  }

  function stripTitle(name) {
    const n = normalizeTeacherName(name);
    return n.replace(/^\s*(Mr|Mrs|Miss|Ms|Dr)\.?\s+/i, "").trim();
  }

  function getTeacherKey(name) {
    const t = normalizeTeacherName(name);
    return t ? STORAGE_PREFIX + t : "";
  }

  function getCellKey(row, col) {
    return `${row}-${col}`;
  }

  function parseDayNames(input, rows) {
    if (!input || !input.trim()) return [];
    return input.split(",").map(x => x.trim()).filter(Boolean).slice(0, rows);
  }

  function escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showPlaceholder() {
    timetablePlaceholder?.classList.remove("d-none");
    timetableWrapper?.classList.add("d-none");
    timetableTable.innerHTML = "";
    _cellRefCache.clear();
  }

  function showTable() {
    timetablePlaceholder?.classList.add("d-none");
    timetableWrapper?.classList.remove("d-none");
  }

  // ---------------------- TEACHER LIST ------------------------

  function rebuildTeacherNamesCache() {
    const names = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) names.push(k.slice(STORAGE_PREFIX.length));
    }
    names.sort((a, b) => a.localeCompare(b));
    _teacherNamesCache = names;
    return names;
  }

  function getAllTeacherNames() {
    return _teacherNamesCache || rebuildTeacherNamesCache();
  }

  function refreshTeacherSelect(filterText = "") {
    if (!teacherSelect) return [];

    const filter = (filterText || "").trim().toLowerCase();
    const names = getAllTeacherNames();

    teacherSelect.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = names.length === 0 ? "-- No saved timetables yet --" : "-- Select a teacher --";
    teacherSelect.appendChild(defaultOpt);

    const filtered = filter ? names.filter(n => n.toLowerCase().includes(filter)) : names;

    for (const name of filtered) {
      const opt = document.createElement("option");
      opt.value = getTeacherKey(name);
      opt.textContent = name;
      teacherSelect.appendChild(opt);
    }

    // Maintain selection
    if (currentTeacherName) teacherSelect.value = getTeacherKey(currentTeacherName);

    // Keep dashboard aligned
    refreshCompletenessDashboard();

    return filtered;
  }

  // ---------------------- TABLE BUILD -------------------------

  function buildTableStructure() {
    const { rows, cols, dayNames } = timetableConfig;
    if (!rows || !cols || rows <= 0 || cols <= 0) {
      showPlaceholder();
      return;
    }

    showTable();
    timetableTable.innerHTML = "";
    _cellRefCache.clear();

    const fragment = document.createDocumentFragment();

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const firstTh = document.createElement("th");
    firstTh.textContent = "Day";
    headerRow.appendChild(firstTh);

    for (let c = 0; c < cols; c++) {
      const th = document.createElement("th");
      th.textContent = "P" + (c + 1);
      headerRow.appendChild(th);
    }

    thead.appendChild(headerRow);
    fragment.appendChild(thead);

    const tbody = document.createElement("tbody");

    for (let r = 0; r < rows; r++) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = dayNames[r] || `Day ${r + 1}`;
      tr.appendChild(th);

      for (let c = 0; c < cols; c++) {
        const td = document.createElement("td");
        td.classList.add("timetable-cell");
        td.dataset.row = String(r);
        td.dataset.col = String(c);
        td.textContent = "Click to add";
        td.addEventListener("click", () => openCellEditor(r, c));
        tr.appendChild(td);
        _cellRefCache.set(getCellKey(r, c), td);
      }

      tbody.appendChild(tr);
    }

    fragment.appendChild(tbody);
    timetableTable.appendChild(fragment);

    renderAllEntries();
    updateSummary();
  }

  // ---------------------- CELL EDITOR -------------------------

  function toggleFields() {
    const type = entryTypeSelect.value;

    if (type === "free") {
      detailFieldsDiv.classList.add("d-none");
      freeTimeHint.classList.remove("d-none");
      meetingConstraints.classList.add("d-none");
      return;
    }

    detailFieldsDiv.classList.remove("d-none");
    freeTimeHint.classList.add("d-none");

    if (type === "meeting") meetingConstraints.classList.remove("d-none");
    else meetingConstraints.classList.add("d-none");
  }

  function openCellEditor(row, col) {
    if (!cellModal) return;

    const key = getCellKey(row, col);
    const entry = timetableData[key];

    cellRowInput.value = String(row);
    cellColInput.value = String(col);

    if (entry) {
      entryTypeSelect.value = entry.type || "lesson";
      entryTitleInput.value = entry.subject || entry.title || "";
      entryClassInput.value = entry.className || "";
      entryVenueInput.value = entry.venue || "";
      doNotDisturbSwitch.checked = !!entry.doNotDisturb;
    } else {
      entryTypeSelect.value = "lesson";
      entryTitleInput.value = "";
      entryClassInput.value = "";
      entryVenueInput.value = "";
      doNotDisturbSwitch.checked = false;
    }

    toggleFields();
    cellModal.show();
  }

  entryTypeSelect?.addEventListener("change", toggleFields);

  cellForm?.addEventListener("submit", (e) => {
    e.preventDefault();

    const row = parseInt(cellRowInput.value, 10);
    const col = parseInt(cellColInput.value, 10);
    const key = getCellKey(row, col);

    const type = entryTypeSelect.value;

    const entry = { row, col, type };

    if (type !== "free") {
      entry.subject = entryTitleInput.value.trim();
      entry.className = entryClassInput.value.trim();
      entry.venue = entryVenueInput.value.trim();
    }

    if (type === "meeting") {
      entry.doNotDisturb = !!doNotDisturbSwitch.checked;
    }

    timetableData[key] = entry;

    renderSingleCell(row, col);
    setUnsaved(true);
    updateSummary();
    refreshCompletenessDashboard();
    cellModal.hide();
  });

  deleteCellBtn?.addEventListener("click", () => {
    const row = parseInt(cellRowInput.value, 10);
    const col = parseInt(cellColInput.value, 10);
    const key = getCellKey(row, col);
    delete timetableData[key];
    renderSingleCell(row, col);
    setUnsaved(true);
    updateSummary();
    refreshCompletenessDashboard();
    cellModal?.hide();
  });

  // ---------------------- RENDERING --------------------------

  function renderAllEntries() {
    _cellRefCache.forEach((_, key) => {
      const [r, c] = key.split("-").map(n => parseInt(n, 10));
      renderSingleCell(r, c);
    });
  }

  function renderSingleCell(row, col) {
    const key = getCellKey(row, col);
    const cell = _cellRefCache.get(key);
    if (!cell) return;

    const entry = timetableData[key];

    cell.classList.remove("free-lesson", "meeting-lesson");

    if (!entry) {
      cell.textContent = "Click to add";
      return;
    }

    if (entry.type === "free") {
      cell.classList.add("free-lesson");
      cell.innerHTML = "<b>Free Time</b>";
      return;
    }

    if (entry.type === "meeting") {
      cell.classList.add("meeting-lesson");
      const title = entry.subject || "Meeting";
      const badge = entry.doNotDisturb ? " <span class='badge bg-danger ms-1' title='Do Not Disturb'>DND</span>" : "";
      cell.innerHTML = `
        <i class="fa-solid fa-clock me-1"></i>
        <b>${escapeHtml(title)}</b>${badge}<br>
        ${escapeHtml(entry.className || "")}<br>
        <small>${escapeHtml(entry.venue || "")}</small>
      `;
      return;
    }

    const subject = entry.subject || "Lesson";
    cell.innerHTML =
      `<b>${escapeHtml(subject)}</b><br>` +
      `${escapeHtml(entry.className || "")}<br>` +
      `<small>${escapeHtml(entry.venue || "")}</small>`;
  }

  // ---------------------- PAYLOAD BUILD ----------------------

  function buildPayload() {
    const teacherName = normalizeTeacherName(teacherNameInput.value || currentTeacherName || "Unknown");
    return {
      teacherName,
      config: { ...timetableConfig },
      entries: Object.values(timetableData),
      lastResort: !!currentTeacherLastResort,
    };
  }

  function loadPayload(payload) {
    currentTeacherName = normalizeTeacherName(payload.teacherName || "");
    currentTeacherKey = getTeacherKey(currentTeacherName);

    if (currentTeacherLabel) currentTeacherLabel.textContent = currentTeacherName || "None";
    if (teacherNameInput) teacherNameInput.value = currentTeacherName;

    timetableConfig = payload.config || { rows: 0, cols: 0, dayNames: [] };
    timetableConfig.rows = parseInt(timetableConfig.rows, 10) || 0;
    timetableConfig.cols = parseInt(timetableConfig.cols, 10) || 0;
    timetableConfig.dayNames = Array.isArray(timetableConfig.dayNames) ? timetableConfig.dayNames : [];

    timetableData = {};
    (payload.entries || []).forEach(e => {
      if (!e || typeof e.row !== "number" || typeof e.col !== "number") return;
      // Back-compat
      if (!e.subject && e.title) e.subject = e.title;
      timetableData[getCellKey(e.row, e.col)] = e;
    });

    currentTeacherLastResort = !!payload.lastResort;
    if (lastResortSwitch) lastResortSwitch.checked = currentTeacherLastResort;

    if (rowsInput) rowsInput.value = String(timetableConfig.rows || 5);
    if (colsInput) colsInput.value = String(timetableConfig.cols || 6);
    if (dayNamesInput) dayNamesInput.value = (timetableConfig.dayNames || []).join(",");

    buildTableStructure();
    setUnsaved(false);
    updateSummary();
    refreshCompletenessDashboard();
  }

  // ---------------------- SAVE / LOAD -------------------------

  function saveCurrentTimetable() {
    const teacherName = normalizeTeacherName(teacherNameInput.value);
    if (!teacherName) {
      alert("Please enter a teacher name before saving.");
      return;
    }

    const key = getTeacherKey(teacherName);
    const payload = buildPayload();
    payload.teacherName = teacherName;

    localStorage.setItem(key, JSON.stringify(payload));

    currentTeacherName = teacherName;
    currentTeacherKey = key;
    if (currentTeacherLabel) currentTeacherLabel.textContent = teacherName;

    _teacherNamesCache = null;
    rebuildTeacherNamesCache();
    refreshTeacherSelect(teacherSearchInput?.value || "");

    setUnsaved(false);
    updateSummary();
    refreshCompletenessDashboard();

    alert(`Timetable saved for ${teacherName}.`);
  }

  function loadTimetableByKey(storageKey) {
    if (!storageKey) return;
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      alert("No timetable data found for this teacher.");
      return;
    }
    try {
      const payload = JSON.parse(raw);
      loadPayload(payload);
      if (teacherSelect) teacherSelect.value = storageKey;
    } catch (e) {
      console.error(e);
      alert("Could not load timetable – data may be corrupted.");
    }
  }

  function loadTimetable() {
    const selectedKey = teacherSelect?.value;
    if (selectedKey) {
      if (unsavedChanges && !confirm("You have unsaved changes. Load another timetable anyway?")) return;
      loadTimetableByKey(selectedKey);
      return;
    }

    const teacherName = normalizeTeacherName(teacherNameInput.value);
    if (!teacherName) {
      alert("Select a teacher from the list or enter a teacher name to load.");
      return;
    }

    const key = getTeacherKey(teacherName);
    if (unsavedChanges && !confirm("You have unsaved changes. Load another timetable anyway?")) return;
    loadTimetableByKey(key);
  }

  function clearCurrentGrid() {
    if (!confirm("Clear the current timetable grid (unsaved changes will be lost)?")) return;

    timetableConfig = { rows: 0, cols: 0, dayNames: [] };
    timetableData = {};

    currentTeacherName = "";
    currentTeacherKey = "";
    currentTeacherLastResort = false;

    if (currentTeacherLabel) currentTeacherLabel.textContent = "None";
    if (teacherNameInput) teacherNameInput.value = "";
    if (lastResortSwitch) lastResortSwitch.checked = false;

    setUnsaved(false);
    showPlaceholder();
    updateSummary();
  }

  // ---------------------- IMPORT / EXPORT ----------------------

  function importFromJsonFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const payload = JSON.parse(String(e.target.result || "{}"));

        let teacherName = normalizeTeacherName(payload.teacherName || "");
        if (!teacherName) {
          teacherName = normalizeTeacherName(prompt("The JSON has no teacherName. Enter teacher name:", "New Teacher") || "");
          if (!teacherName) return;
        }

        if (Array.isArray(payload.entries)) {
          payload.entries.forEach(en => { if (en && !en.subject && en.title) en.subject = en.title; });
        }

        const safePayload = {
          teacherName,
          config: payload.config || { rows: 0, cols: 0, dayNames: [] },
          entries: Array.isArray(payload.entries) ? payload.entries : [],
          lastResort: !!payload.lastResort,
        };

        localStorage.setItem(getTeacherKey(teacherName), JSON.stringify(safePayload));
        _teacherNamesCache = null;
        rebuildTeacherNamesCache();
        refreshTeacherSelect(teacherSearchInput?.value || "");
        loadPayload(safePayload);
        alert(`Timetable imported for ${teacherName}.`);
      } catch (err) {
        console.error(err);
        alert("Could not import JSON. Please check the file format.");
      } finally {
        if (importFileInput) importFileInput.value = "";
      }
    };
    reader.readAsText(file);
  }

  function exportCurrentTimetable() {
    if (!timetableConfig.rows || !timetableConfig.cols) {
      alert("Nothing to export. Generate or load a timetable first.");
      return;
    }

    const payload = buildPayload();
    const jsonString = JSON.stringify(payload, null, 2);
    if (jsonOutput) jsonOutput.value = jsonString;

    const safeName = (payload.teacherName || "timetable").replace(/\s+/g, "_");
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function copyJsonToClipboard() {
    const text = (jsonOutput?.value || "").trim();
    if (!text) {
      alert("There is no JSON to copy yet. Export first.");
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => alert("JSON copied to clipboard."))
        .catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      jsonOutput.select();
      document.execCommand("copy");
      alert("JSON copied to clipboard.");
    }
  }

  function exportSnapshot() {
    const snapshot = {
      snapshotVersion: 1,
      createdAt: new Date().toISOString(),
      keys: [],
      timetables: {},
    };

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
      snapshot.keys.push(k);
      try {
        snapshot.timetables[k] = JSON.parse(localStorage.getItem(k));
      } catch (e) {
        snapshot.timetables[k] = { __error: "Failed to parse JSON" };
      }
    }

    snapshot.keys.sort();

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = snapshot.createdAt.split("T")[0];
    a.download = `timetable_snapshot_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (snapshotStatus) snapshotStatus.textContent = `Snapshot exported (${snapshot.keys.length} teacher(s)) on ${snapshot.createdAt}.`;
  }

  // ---------------------- BULK FOLDER IMPORT -------------------

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  async function bulkImportFromFolder(files) {
    const jsonFiles = Array.from(files || []).filter(f => (f.name || "").toLowerCase().endsWith(".json"));
    if (jsonFiles.length === 0) {
      if (bulkStatus) bulkStatus.textContent = "No JSON files found in selected folder.";
      if (bulkStatusDetail) bulkStatusDetail.textContent = "";
      return;
    }

    let imported = 0;
    let failed = 0;
    const failures = [];

    for (const f of jsonFiles) {
      try {
        const text = await readFileAsText(f);
        const payload = JSON.parse(text);

        let teacherName = normalizeTeacherName(payload.teacherName || "");
        if (!teacherName) teacherName = normalizeTeacherName((f.name || "").replace(/\.json$/i, ""));
        if (!teacherName) throw new Error("Missing teacherName");

        if (Array.isArray(payload.entries)) {
          payload.entries.forEach(en => { if (en && !en.subject && en.title) en.subject = en.title; });
        }

        const safePayload = {
          teacherName,
          config: payload.config || { rows: 0, cols: 0, dayNames: [] },
          entries: Array.isArray(payload.entries) ? payload.entries : [],
          lastResort: !!payload.lastResort,
        };

        localStorage.setItem(getTeacherKey(teacherName), JSON.stringify(safePayload));
        imported++;
      } catch (err) {
        failed++;
        failures.push(`${f.name}: ${err.message}`);
      }
    }

    _teacherNamesCache = null;
    rebuildTeacherNamesCache();
    refreshTeacherSelect(teacherSearchInput?.value || "");

    if (bulkStatus) bulkStatus.textContent = `Imported ${imported} timetable(s).`;
    if (bulkStatusDetail) {
      bulkStatusDetail.textContent = failed
        ? `Failed ${failed}. ${failures.slice(0, 5).join(" | ")}${failures.length > 5 ? " | ..." : ""}`
        : "All files imported successfully.";
    }
  }

  // ---------------------- RENAME TEACHER -----------------------

  function openRenameConfirm() {
    if (!renameConfirmModal) return;

    const from = currentTeacherName;
    const to = normalizeTeacherName(teacherNameInput.value);

    if (!from) return alert("Load a teacher timetable before renaming.");
    if (!to) return alert("Enter the new teacher name.");
    if (from === to) return alert("The new name is the same as the current name.");

    if (renameFromSpan) renameFromSpan.textContent = from;
    if (renameToSpan) renameToSpan.textContent = to;
    renameConfirmModal.show();
  }

  function doRenameTeacher() {
    const from = currentTeacherName;
    const to = normalizeTeacherName(teacherNameInput.value);

    if (!from || !to || from === to) {
      renameConfirmModal?.hide();
      return;
    }

    const fromKey = getTeacherKey(from);
    const toKey = getTeacherKey(to);

    if (localStorage.getItem(toKey)) return alert("A timetable already exists with the target name. Rename cancelled.");

    const raw = localStorage.getItem(fromKey);
    if (!raw) return alert("Source timetable could not be found. Rename cancelled.");

    try {
      const payload = JSON.parse(raw);
      payload.teacherName = to;
      localStorage.setItem(toKey, JSON.stringify(payload));
      localStorage.removeItem(fromKey);

      currentTeacherName = to;
      currentTeacherKey = toKey;
      if (currentTeacherLabel) currentTeacherLabel.textContent = to;
      teacherNameInput.value = to;

      _teacherNamesCache = null;
      rebuildTeacherNamesCache();
      refreshTeacherSelect(teacherSearchInput?.value || "");

      renameConfirmModal?.hide();
      alert(`Renamed timetable: ${from} → ${to}`);
    } catch (e) {
      console.error(e);
      alert("Rename failed. Data may be corrupted.");
    }
  }

  // ---------------------- BULK REMOVE TITLES -------------------

  function bulkRemoveTitles() {
    const names = getAllTeacherNames();
    if (names.length === 0) {
      alert("No timetables found.");
      return;
    }

    if (!confirm("This will bulk-remove titles (Mr/Mrs/Miss/Ms/Dr) from ALL teacher names. Continue?")) return;

    let changed = 0;
    let skipped = 0;
    const conflicts = [];

    const originalNames = [...names];

    for (const oldName of originalNames) {
      const newName = stripTitle(oldName);
      if (!newName || newName === oldName) continue;

      const oldKey = getTeacherKey(oldName);
      const newKey = getTeacherKey(newName);

      if (localStorage.getItem(newKey)) {
        skipped++;
        conflicts.push(`${oldName} → ${newName}`);
        continue;
      }

      const raw = localStorage.getItem(oldKey);
      if (!raw) continue;

      try {
        const payload = JSON.parse(raw);
        payload.teacherName = newName;
        localStorage.setItem(newKey, JSON.stringify(payload));
        localStorage.removeItem(oldKey);
        changed++;

        if (currentTeacherName === oldName) {
          currentTeacherName = newName;
          currentTeacherKey = newKey;
          if (currentTeacherLabel) currentTeacherLabel.textContent = newName;
          teacherNameInput.value = newName;
        }
      } catch (e) {
        skipped++;
        conflicts.push(`${oldName} → ${newName} (parse error)`);
      }
    }

    _teacherNamesCache = null;
    rebuildTeacherNamesCache();
    refreshTeacherSelect(teacherSearchInput?.value || "");

    alert(`Titles removed from ${changed} teacher(s).${skipped ? ` Skipped ${skipped}.` : ""}${conflicts.length ? `\nExamples: ${conflicts.slice(0, 5).join(" | ")}${conflicts.length > 5 ? " | ..." : ""}` : ""}`);
  }

  // ---------------------- SEARCH + QUICK LOAD ------------------

  function quickSearchUpdate() {
    const txt = teacherSearchInput?.value || "";
    return refreshTeacherSelect(txt);
  }

  teacherSearchInput?.addEventListener("input", () => {
    quickSearchUpdate();
  });

  teacherSearchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const filtered = quickSearchUpdate();
      if (filtered.length === 1) {
        const key = getTeacherKey(filtered[0]);
        if (key) {
          if (unsavedChanges && !confirm("You have unsaved changes. Load the matching timetable anyway?")) return;
          loadTimetableByKey(key);
        }
      }
    }
  });

  teacherSelect?.addEventListener("change", () => {
    const key = teacherSelect.value;
    if (!key) return;
    if (unsavedChanges && !confirm("You have unsaved changes. Load another timetable anyway?")) {
      teacherSelect.value = currentTeacherKey || "";
      return;
    }
    loadTimetableByKey(key);
  });

  // ---------------------- LAST RESORT TOGGLE -------------------

  lastResortSwitch?.addEventListener("change", () => {
    currentTeacherLastResort = !!lastResortSwitch.checked;
    setUnsaved(true);
    refreshCompletenessDashboard();
  });

  // ---------------------- COMPLETENESS AUDIT + AUTOFILL -------------------

  function auditMissingCells() {
    if (!timetableConfig.rows || !timetableConfig.cols) {
      if (missingSummary) missingSummary.textContent = "Generate or load a timetable first.";
      if (missingCellChips) missingCellChips.innerHTML = "";
      if (autofillBtn) autofillBtn.disabled = true;
      return [];
    }

    const missing = [];
    for (let r = 0; r < timetableConfig.rows; r++) {
      for (let c = 0; c < timetableConfig.cols; c++) {
        const key = getCellKey(r, c);
        if (!timetableData[key]) missing.push({ r, c });
      }
    }

    if (missingSummary) missingSummary.textContent = `${missing.length} uncaptured cell(s).`;
    if (missingCellChips) {
      missingCellChips.innerHTML = missing.slice(0, 60)
        .map(m => `<span class="teacher-chip chip-muted">Day ${m.r + 1} P${m.c + 1}</span>`)
        .join("") + (missing.length > 60 ? `<div class="small text-muted mt-1">+ ${missing.length - 60} more…</div>` : "");
    }

    if (autofillBtn) autofillBtn.disabled = missing.length === 0;

    return missing;
  }

  function getSelectedAutofillType() {
    const selected = document.querySelector("input[name='autofillType']:checked");
    return selected ? selected.value : "free";
  }

  function applyAutofill() {
    const missing = auditMissingCells();
    if (!missing.length) return;

    const type = getSelectedAutofillType();

    for (const { r, c } of missing) {
      const key = getCellKey(r, c);
      if (timetableData[key]) continue;

      if (type === "free") {
        timetableData[key] = { row: r, col: c, type: "free" };
      } else if (type === "meeting") {
        timetableData[key] = { row: r, col: c, type: "meeting", subject: "", className: "", venue: "", doNotDisturb: false };
      } else {
        timetableData[key] = { row: r, col: c, type: "lesson", subject: "", className: "", venue: "" };
      }
    }

    renderAllEntries();
    setUnsaved(true);
    updateSummary();
    refreshCompletenessDashboard();
    auditMissingCells();
  }

  // ---------------------- BULK DND BY SLOT ---------------------

  let _dndSlotTeachers = []; // [{name,key,entry,hasDnd}]
  let _dndActionMode = "apply";

  function buildSlotLabel(dayIdx, periodIdx) {
    return `Day ${dayIdx + 1}, Period ${periodIdx + 1}`;
  }

  function loadTeachersForDndSlot() {
    const day = parseInt(dndDaySelect?.value || "0", 10);
    const period = parseInt(dndPeriodSelect?.value || "0", 10);

    const names = getAllTeacherNames();
    const list = [];

    for (const name of names) {
      const key = getTeacherKey(name);
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const payload = JSON.parse(raw);
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        const entry = entries.find(e => e && e.row === day && e.col === period);
        if (entry && entry.type === "meeting") {
          if (!entry.subject && entry.title) entry.subject = entry.title;
          list.push({ name, key, entry, hasDnd: !!entry.doNotDisturb });
        }
      } catch (_) {}
    }

    _dndSlotTeachers = list;
    renderDndTeacherChecklist();

    if (dndStatus) {
      dndStatus.textContent = list.length
        ? `Loaded ${list.length} teacher(s) for ${buildSlotLabel(day, period)}.`
        : `No meetings found for ${buildSlotLabel(day, period)}.`;
    }
  }

  function renderDndTeacherChecklist() {
    if (!dndTeacherList) return;
    dndTeacherList.innerHTML = "";

    if (_dndSlotTeachers.length === 0) {
      dndTeacherList.innerHTML = `<div class="text-muted small p-2">No teachers found for selected slot.</div>`;
      if (applyDndBtn) applyDndBtn.disabled = true;
      if (removeDndBtn) removeDndBtn.disabled = true;
      return;
    }

    const frag = document.createDocumentFragment();

    _dndSlotTeachers.forEach((t, idx) => {
      const item = document.createElement("label");
      item.className = "list-group-item d-flex align-items-start gap-2";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "form-check-input mt-1";
      cb.dataset.idx = String(idx);

      const body = document.createElement("div");
      body.className = "flex-grow-1";
      body.innerHTML = `
        <div class="fw-semibold">${escapeHtml(t.name)}</div>
        <div class="small text-muted">${escapeHtml(t.entry.subject || "Meeting")}</div>
        <div class="mt-1">${t.hasDnd ? '<span class="badge bg-danger">Currently DND</span>' : '<span class="badge bg-secondary">Interruptible</span>'}</div>
      `;

      item.appendChild(cb);
      item.appendChild(body);
      frag.appendChild(item);

      cb.addEventListener("change", updateDndButtonsState);
    });

    dndTeacherList.appendChild(frag);
    updateDndButtonsState();
  }

  function getSelectedDndTeacherIndices() {
    if (!dndTeacherList) return [];
    return Array.from(dndTeacherList.querySelectorAll("input[type='checkbox']:checked"))
      .map(cb => parseInt(cb.dataset.idx || "-1", 10))
      .filter(n => Number.isFinite(n) && n >= 0);
  }

  function updateDndButtonsState() {
    const selected = getSelectedDndTeacherIndices();
    const has = selected.length > 0;
    if (applyDndBtn) applyDndBtn.disabled = !has;
    if (removeDndBtn) removeDndBtn.disabled = !has;
  }

  function selectAllDndTeachers(flag) {
    if (!dndTeacherList) return;
    dndTeacherList.querySelectorAll("input[type='checkbox']").forEach(cb => { cb.checked = !!flag; });
    updateDndButtonsState();
  }

  function openDndConfirm(mode) {
    if (!dndConfirmModal) return;

    _dndActionMode = mode;

    const day = parseInt(dndDaySelect?.value || "0", 10);
    const period = parseInt(dndPeriodSelect?.value || "0", 10);
    const selected = getSelectedDndTeacherIndices();

    if (dndConfirmSlot) dndConfirmSlot.textContent = buildSlotLabel(day, period);
    if (dndConfirmCount) dndConfirmCount.textContent = String(selected.length);
    if (confirmDndApplyBtn) confirmDndApplyBtn.textContent = mode === "remove" ? "Confirm Remove" : "Confirm Apply";

    dndConfirmModal.show();
  }

  function applyBulkDnd(mode) {
    const day = parseInt(dndDaySelect?.value || "0", 10);
    const period = parseInt(dndPeriodSelect?.value || "0", 10);
    const selectedIdx = getSelectedDndTeacherIndices();
    if (!selectedIdx.length) { dndConfirmModal?.hide(); return; }

    let updated = 0;
    let failed = 0;

    for (const i of selectedIdx) {
      const t = _dndSlotTeachers[i];
      if (!t) continue;

      const raw = localStorage.getItem(t.key);
      if (!raw) { failed++; continue; }

      try {
        const payload = JSON.parse(raw);
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        const entry = entries.find(e => e && e.row === day && e.col === period);
        if (!entry || entry.type !== "meeting") continue;

        if (mode === "apply") entry.doNotDisturb = true;
        else delete entry.doNotDisturb;

        localStorage.setItem(t.key, JSON.stringify(payload));
        updated++;

        // Update in-memory if current teacher matches
        if (currentTeacherName === t.name) {
          const kk = getCellKey(day, period);
          if (timetableData[kk] && timetableData[kk].type === "meeting") {
            if (mode === "apply") timetableData[kk].doNotDisturb = true;
            else delete timetableData[kk].doNotDisturb;
            renderSingleCell(day, period);
            setUnsaved(true);
          }
        }
      } catch (e) {
        failed++;
      }
    }

    loadTeachersForDndSlot();
    refreshCompletenessDashboard();

    if (dndStatus) {
      dndStatus.textContent = mode === "apply"
        ? `Applied DND to ${updated} teacher(s) for ${buildSlotLabel(day, period)}.${failed ? ` Failed: ${failed}.` : ""}`
        : `Removed DND from ${updated} teacher(s) for ${buildSlotLabel(day, period)}.${failed ? ` Failed: ${failed}.` : ""}`;
    }

    dndConfirmModal?.hide();
  }

  // ---------------------- SUMMARY -----------------------------

  function updateSummary() {
    const teacher = currentTeacherName || "—";
    if (summaryTeacher) summaryTeacher.textContent = teacher;

    if (!timetableConfig.rows || !timetableConfig.cols || !currentTeacherName) {
      if (summaryCaptured) summaryCaptured.textContent = "—";
      if (summaryUncaptured) summaryUncaptured.textContent = "—";
      if (summaryNotes) summaryNotes.textContent = "No teacher loaded.";
      return;
    }

    const total = timetableConfig.rows * timetableConfig.cols;
    const captured = Object.keys(timetableData).length;
    const capturedClamped = Math.min(captured, total);
    const uncaptured = Math.max(total - capturedClamped, 0);

    if (summaryCaptured) summaryCaptured.textContent = String(capturedClamped);
    if (summaryUncaptured) summaryUncaptured.textContent = String(uncaptured);

    const notes = [];
    if (currentTeacherLastResort) notes.push("Teacher is marked as Last Resort.");

    const dndCount = Object.values(timetableData).filter(e => e && e.type === "meeting" && e.doNotDisturb).length;
    if (dndCount) notes.push(`${dndCount} meeting(s) marked DND.`);

    if (uncaptured) notes.push("Timetable has uncaptured cells — consider auto-fill.");

    if (summaryNotes) summaryNotes.textContent = notes.length ? notes.join(" ") : "No notes.";
  }

  // ---------------------- COMPLETENESS DASHBOARD ----------------------

  function getTeacherKeysFromComboBox() {
    if (!teacherSelect) return [];

    const opts = Array.from(teacherSelect.options || []);
    const out = [];
    const seen = new Set();

    for (const opt of opts) {
      const key = (opt.value || "").trim();
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, name: (opt.textContent || key.slice(STORAGE_PREFIX.length)).trim() });
    }

    return out;
  }

  function computeCompletenessForPayload(payload) {
    const cfg = (payload && payload.config) ? payload.config : {};
    const rows = parseInt(cfg.rows, 10) || 0;
    const cols = parseInt(cfg.cols, 10) || 0;
    const total = (rows > 0 && cols > 0) ? rows * cols : 0;

    const entries = Array.isArray(payload && payload.entries) ? payload.entries : [];
    const set = new Set();
    let dndMeetings = 0;

    for (const e of entries) {
      if (!e || typeof e.row !== "number" || typeof e.col !== "number") continue;
      set.add(e.row + "-" + e.col);
      if (e.type === "meeting" && e.doNotDisturb) dndMeetings++;
    }

    const captured = set.size;
    const missing = total ? Math.max(total - captured, 0) : 0;
    const percent = total ? Math.round((captured / total) * 100) : 0;

    return { rows, cols, total, captured, missing, percent, dndMeetings, lastResort: !!payload.lastResort };
  }

  function refreshCompletenessDashboard() {
    if (!completenessSummary || !completenessTableBody) return;

    // Prefer the ComboBox contents; fallback to localStorage scan
    let teacherList = getTeacherKeysFromComboBox();
    if (teacherList.length === 0) {
      teacherList = getAllTeacherNames().map(n => ({ name: n, key: getTeacherKey(n) }));
    }

    if (teacherList.length === 0) {
      completenessSummary.textContent = "No teachers found.";
      completenessTableBody.innerHTML = "<tr><td colspan='4' class='text-muted text-center'>No teachers found.</td></tr>";
      return;
    }

    const rows = teacherList.map(t => {
      const raw = localStorage.getItem(t.key);
      if (!raw) {
        return { name: t.name, key: t.key, total: 0, captured: 0, missing: 0, percent: 0, dndMeetings: 0, lastResort: false, missingPayload: true };
      }
      try {
        const payload = JSON.parse(raw);
        const stats = computeCompletenessForPayload(payload);
        return { name: t.name, key: t.key, ...stats };
      } catch (e) {
        return { name: t.name, key: t.key, total: 0, captured: 0, missing: 0, percent: 0, dndMeetings: 0, lastResort: false, parseError: true };
      }
    });

    const filterText = (completenessSearchInput?.value || "").trim().toLowerCase();
    const incompleteOnly = !!completenessIncompleteOnly?.checked;

    const filtered = rows.filter(r => {
      const match = !filterText || (r.name || "").toLowerCase().includes(filterText);
      const incomplete = (r.total === 0) ? true : (r.missing > 0);
      return match && (!incompleteOnly || incomplete);
    });

    const totalTeachers = rows.length;
    const incompleteCount = rows.filter(r => (r.total === 0) || (r.missing > 0)).length;
    completenessSummary.textContent = `${totalTeachers} teacher(s). ${incompleteCount} incomplete.`;

    if (!filtered.length) {
      completenessTableBody.innerHTML = "<tr><td colspan='4' class='text-muted text-center'>No matches.</td></tr>";
      return;
    }

    completenessTableBody.innerHTML = filtered.map(r => {
      const scoreText = r.total === 0 ? "No grid" : `${r.percent}% (${r.captured}/${r.total})`;
      const scoreClass = r.total === 0 ? "text-danger" : (r.missing === 0 ? "text-success" : "text-warning");
      const missingText = r.total === 0 ? "—" : String(r.missing);
      const badges = `${r.lastResort ? '<span class="badge bg-warning text-dark me-1">Last Resort</span>' : ''}${r.dndMeetings ? `<span class="badge bg-danger">DND:${r.dndMeetings}</span>` : ''}`;

      return `
        <tr>
          <td>
            <div class="fw-semibold">${escapeHtml(r.name)}</div>
            <div class="small">${badges}</div>
          </td>
          <td class="text-center ${scoreClass}">${scoreText}</td>
          <td class="text-center">${missingText}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-outline-primary" data-load-key="${escapeHtml(r.key)}">Load</button>
          </td>
        </tr>
      `;
    }).join("");

    completenessTableBody.querySelectorAll('[data-load-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-load-key');
        if (!k) return;
        if (unsavedChanges && !confirm("You have unsaved changes. Load this timetable anyway?")) return;
        loadTimetableByKey(k);
      });
    });
  }

  refreshCompletenessBtn?.addEventListener('click', refreshCompletenessDashboard);
  completenessSearchInput?.addEventListener('input', refreshCompletenessDashboard);
  completenessIncompleteOnly?.addEventListener('change', refreshCompletenessDashboard);

  // ---------------------- CLEAR ALL TIMETABLES ----------------------

  function clearAllTeacherTimetables() {
    if (!confirm("This will delete ALL teacher timetables permanently. Continue?")) return;

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) localStorage.removeItem(k);
    }

    _teacherNamesCache = null;
    rebuildTeacherNamesCache();
    refreshTeacherSelect(teacherSearchInput?.value || "");
    refreshCompletenessDashboard();

    alert("All teacher timetables have been cleared.");
  }

  // ---------------------- SLIM NAV + COMMAND PALETTE ----------------------

  const sideNav = document.getElementById("sideNav");
  const actionsScroll = document.getElementById("actionsScroll");

  function setActiveNav(targetId) {
    if (!sideNav) return;
    sideNav.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
    const active = sideNav.querySelector(`[data-target="${targetId}"]`);
    if (active) active.classList.add('active');
  }

  function scrollToSection(targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveNav(targetId);
  }

  if (sideNav) {
    sideNav.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-target]');
      if (!link) return;
      e.preventDefault();
      const targetId = link.getAttribute('data-target');
      if (targetId) scrollToSection(targetId);
    });
  }

  if (actionsScroll && sideNav) {
    const sectionIds = Array.from(sideNav.querySelectorAll('a[data-target]')).map(a => a.getAttribute('data-target')).filter(Boolean);
    const updateActiveFromScroll = () => {
      let bestId = sectionIds[0];
      let bestTop = -Infinity;
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const top = rect.top;
        if (top <= 120 && top > bestTop) { bestTop = top; bestId = id; }
      }
      if (bestId) setActiveNav(bestId);
    };
    actionsScroll.addEventListener('scroll', () => {
      window.requestAnimationFrame(updateActiveFromScroll);
    }, { passive: true });
  }

  const cmdBtn = document.getElementById('cmdPaletteBtn');
  const cmdModalEl = document.getElementById('cmdPaletteModal');
  const cmdInput = document.getElementById('cmdPaletteInput');
  const cmdList = document.getElementById('cmdPaletteList');
  const cmdModal = cmdModalEl ? new bootstrap.Modal(cmdModalEl) : null;

  let _cmdItems = [];
  let _cmdFiltered = [];
  let _cmdIndex = 0;

  function command(label, keywords, run) {
    return { label, keywords: (keywords || '').toLowerCase(), run };
  }

  function buildCommands() {
    _cmdItems = [
      command('Find Teacher (focus search)', 'find search teacher', () => { document.getElementById('teacherSearchInput')?.focus(); }),
      command('Go to Find Teacher', 'go find section', () => scrollToSection('section-find')),
      command('Go to Completeness Dashboard', 'go completeness score dashboard', () => scrollToSection('section-dashboard')),
      command('Refresh Completeness Dashboard', 'refresh completeness dashboard', () => refreshCompletenessDashboard()),
      command('Go to Bulk Upload', 'go bulk upload import folder', () => scrollToSection('section-bulk')),
      command('Go to Identity Tools', 'go identity names last resort', () => scrollToSection('section-identity')),
      command('Go to Bulk DND', 'go dnd do not disturb', () => scrollToSection('section-dnd')),
      command('Load Teachers for DND Slot', 'dnd load slot', () => loadTeachersForDndSlot()),
      command('Go to Auto-fill', 'go autofill missing cells', () => scrollToSection('section-autofill')),
      command('Audit Missing Cells', 'audit missing cells', () => auditMissingCells()),
      command('Go to Setup Timetable', 'go setup grid', () => scrollToSection('section-setup')),
      command('Go to Data & Storage', 'go data storage snapshot', () => scrollToSection('section-data')),
      command('Backup Snapshot (ALL teachers)', 'backup snapshot archive export', () => exportSnapshot()),
      command('Save Current Teacher', 'save current teacher', () => saveCurrentTimetable()),
      command('Export Current Teacher JSON', 'export current teacher json', () => exportCurrentTimetable()),
    ];
  }

  function renderCmdList(items) {
    if (!cmdList) return;
    cmdList.innerHTML = '';
    if (!items.length) {
      cmdList.innerHTML = '<div class="list-group-item text-muted">No matches</div>';
      return;
    }
    items.forEach((it, idx) => {
      const div = document.createElement('div');
      div.className = 'list-group-item cmd-item' + (idx === _cmdIndex ? ' active' : '');
      div.setAttribute('role', 'option');
      div.textContent = it.label;
      div.addEventListener('click', () => {
        _cmdIndex = idx;
        runCmd();
      });
      cmdList.appendChild(div);
    });
  }

  function filterCmd() {
    const q = (cmdInput?.value || '').trim().toLowerCase();
    if (!q) _cmdFiltered = _cmdItems.slice();
    else _cmdFiltered = _cmdItems.filter(it => it.label.toLowerCase().includes(q) || it.keywords.includes(q));
    _cmdIndex = 0;
    renderCmdList(_cmdFiltered);
  }

  function runCmd() {
    const it = _cmdFiltered[_cmdIndex];
    if (!it) return;
    try { it.run(); } catch (_) {}
    cmdModal?.hide();
  }

  function openCmdPalette() {
    if (!cmdModal) return;
    buildCommands();
    cmdModal.show();
    setTimeout(() => {
      if (cmdInput) { cmdInput.value = ''; cmdInput.focus(); }
      _cmdFiltered = _cmdItems.slice();
      _cmdIndex = 0;
      renderCmdList(_cmdFiltered);
    }, 50);
  }

  cmdBtn?.addEventListener('click', openCmdPalette);

  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const meta = isMac ? e.metaKey : e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCmdPalette();
    }
  });

  cmdInput?.addEventListener('input', filterCmd);
  cmdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _cmdIndex = Math.min(_cmdIndex + 1, _cmdFiltered.length - 1); renderCmdList(_cmdFiltered); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _cmdIndex = Math.max(_cmdIndex - 1, 0); renderCmdList(_cmdFiltered); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(); }
  });

  // ---------------------- EVENT WIRING -------------------------

  gridForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    timetableConfig.rows = parseInt(rowsInput.value, 10);
    timetableConfig.cols = parseInt(colsInput.value, 10);
    timetableConfig.dayNames = parseDayNames(dayNamesInput.value, timetableConfig.rows);

    timetableData = {};
    buildTableStructure();
    setUnsaved(true);
    updateSummary();
    refreshCompletenessDashboard();
  });

  saveBtn?.addEventListener("click", saveCurrentTimetable);
  loadBtn?.addEventListener("click", loadTimetable);
  clearBtn?.addEventListener("click", clearCurrentGrid);
  clearAllTeachersBtn?.addEventListener("click", clearAllTeacherTimetables);

  importBtn?.addEventListener("click", () => importFileInput?.click());
  importFileInput?.addEventListener("change", () => importFromJsonFile(importFileInput.files[0]));

  exportBtn?.addEventListener("click", exportCurrentTimetable);
  snapshotBtn?.addEventListener("click", exportSnapshot);
  copyJsonBtn?.addEventListener("click", copyJsonToClipboard);

  bulkFolderBtn?.addEventListener("click", () => bulkFolderInput?.click());
  bulkFolderInput?.addEventListener("change", async () => {
    await bulkImportFromFolder(bulkFolderInput.files);
    bulkFolderInput.value = "";
  });

  renameTeacherBtn?.addEventListener("click", openRenameConfirm);
  confirmRenameBtn?.addEventListener("click", doRenameTeacher);

  removeTitlesBtn?.addEventListener("click", bulkRemoveTitles);

  auditMissingBtn?.addEventListener("click", auditMissingCells);
  autofillBtn?.addEventListener("click", applyAutofill);

  dndLoadTeachersBtn?.addEventListener("click", loadTeachersForDndSlot);
  dndSelectAllBtn?.addEventListener("click", () => selectAllDndTeachers(true));
  dndSelectNoneBtn?.addEventListener("click", () => selectAllDndTeachers(false));
  applyDndBtn?.addEventListener("click", () => openDndConfirm("apply"));
  removeDndBtn?.addEventListener("click", () => openDndConfirm("remove"));
  confirmDndApplyBtn?.addEventListener("click", () => applyBulkDnd(_dndActionMode));

  // Warn before leaving if unsaved
  window.addEventListener("beforeunload", (e) => {
    if (!unsavedChanges) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Cross-tab storage updates
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith(STORAGE_PREFIX)) {
      _teacherNamesCache = null;
      rebuildTeacherNamesCache();
      refreshTeacherSelect(teacherSearchInput?.value || "");
      refreshCompletenessDashboard();
    }
  });

  // ---------------------- INITIAL UI STATE ---------------------

  rebuildTeacherNamesCache();
  refreshTeacherSelect();
  refreshCompletenessDashboard();
  showPlaceholder();
  setUnsaved(false);
  updateSummary();
});
