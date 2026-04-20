/*
  Senior Management Timetable Administration Script
  ------------------------------------------------
  Purpose:
  - Extends the original Timetable Builder with Senior Management features:
    * Folder (bulk) import
    * Teacher rename (replace)
    * Bulk removal of titles from names
    * Partial search + quick load
    * Audit/auto-fill missing cells (uncaptured)
    * Per-meeting Do Not Disturb (DND)
    * Bulk DND marking by day/period
    * Teacher-level Last Resort flag

  Notes:
  - This script is client-side only and uses localStorage.
  - Storage prefix is aligned to the Cover Management Dashboard: "teacher_".
  - Data remains backwards compatible; unknown fields are ignored by other tools.
*/

// ---------------------- STORAGE CONSTANTS ----------------------
const STORAGE_PREFIX = "teacher_"; // aligns with Cover Management Dashboard

// ---------------------- GLOBAL STATE ---------------------------
let timetableConfig = { rows: 0, cols: 0, dayNames: [] };
let timetableData = {}; // { "row-col": entry }
let currentTeacherName = "";
let currentTeacherKey = "";
let currentTeacherLastResort = false;
let unsavedChanges = false;

// Cached cell references for O(1) rendering
const _cellRefCache = new Map();

// Cached teacher list (rebuilt when storage changes)
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

  // Data & Storage
  const saveBtn = document.getElementById("saveBtn");
  const loadBtn = document.getElementById("loadBtn");
  const clearBtn = document.getElementById("clearBtn");
  const importBtn = document.getElementById("importBtn");
  const importFileInput = document.getElementById("importFileInput");
  const exportBtn = document.getElementById("exportBtn");
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
    if (unsavedBadge) {
      unsavedBadge.classList.toggle("d-none", !unsavedChanges);
    }
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
    return input
      .split(",")
      .map(x => x.trim())
      .filter(Boolean)
      .slice(0, rows);
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
      if (k && k.startsWith(STORAGE_PREFIX)) {
        names.push(k.slice(STORAGE_PREFIX.length));
      }
    }
    names.sort((a, b) => a.localeCompare(b));
    _teacherNamesCache = names;
    return names;
  }

  function getAllTeacherNames() {
    return _teacherNamesCache || rebuildTeacherNamesCache();
  }

  function refreshTeacherSelect(filterText = "") {
    const filter = (filterText || "").trim().toLowerCase();
    const names = getAllTeacherNames();

    teacherSelect.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = names.length === 0 ? "-- No saved timetables yet --" : "-- Select a teacher --";
    teacherSelect.appendChild(defaultOpt);

    const filtered = filter
      ? names.filter(n => n.toLowerCase().includes(filter))
      : names;

    filtered.forEach(name => {
      const opt = document.createElement("option");
      opt.value = getTeacherKey(name);
      opt.textContent = name;
      teacherSelect.appendChild(opt);
    });

    // Keep selection if current teacher exists
    if (currentTeacherName) {
      const k = getTeacherKey(currentTeacherName);
      teacherSelect.value = k;
    }

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

    // Head
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

    // Body
    const tbody = document.createElement("tbody");
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = dayNames[r] || `Day ${r + 1}`;
      tr.appendChild(th);

      for (let c = 0; c < cols; c++) {
        const td = document.createElement("td");
        td.classList.add("timetable-cell");
        td.dataset.row = r;
        td.dataset.col = c;
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

    // free: hide details and meeting constraints
    if (type === "free") {
      detailFieldsDiv.classList.add("d-none");
      freeTimeHint.classList.remove("d-none");
      meetingConstraints.classList.add("d-none");
      return;
    }

    detailFieldsDiv.classList.remove("d-none");
    freeTimeHint.classList.add("d-none");

    if (type === "meeting") {
      meetingConstraints.classList.remove("d-none");
    } else {
      meetingConstraints.classList.add("d-none");
    }
  }

  function openCellEditor(row, col) {
    if (!cellModal) return;

    const key = getCellKey(row, col);
    const entry = timetableData[key];

    cellRowInput.value = row;
    cellColInput.value = col;

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
    const subject = entryTitleInput.value.trim();

    const entry = {
      row,
      col,
      type,
      // Use `subject` for compatibility with Cover Dashboard
      subject,
      className: entryClassInput.value.trim(),
      venue: entryVenueInput.value.trim(),
    };

    if (type === "meeting") {
      entry.doNotDisturb = !!doNotDisturbSwitch.checked;
    }

    if (type === "free") {
      // keep free minimal
      delete entry.subject;
      delete entry.className;
      delete entry.venue;
      delete entry.doNotDisturb;
    }

    timetableData[key] = entry;

    renderSingleCell(row, col);
    setUnsaved(true);
    updateSummary();
    cellModal?.hide();
  });

  deleteCellBtn?.addEventListener("click", () => {
    const row = parseInt(cellRowInput.value, 10);
    const col = parseInt(cellColInput.value, 10);
    const key = getCellKey(row, col);
    delete timetableData[key];
    renderSingleCell(row, col);
    setUnsaved(true);
    updateSummary();
    cellModal?.hide();
  });

  // ---------------------- RENDERING --------------------------

  function renderAllEntries() {
    _cellRefCache.forEach((_, key) => {
      const [r, c] = key.split("-").map(x => parseInt(x, 10));
      renderSingleCell(r, c);
    });
  }

  function renderSingleCell(row, col) {
    const key = getCellKey(row, col);
    const cell = _cellRefCache.get(key);
    if (!cell) return;

    const entry = timetableData[key];

    // Reset
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
      const badge = entry.doNotDisturb
        ? " <span class='badge bg-danger ms-1' title='Do Not Disturb'>DND</span>"
        : "";
      cell.innerHTML = `
        <i class="fa-solid fa-clock me-1"></i>
        <b>${escapeHtml(title)}</b>${badge}<br>
        ${escapeHtml(entry.className || "")}<br>
        <small>${escapeHtml(entry.venue || "")}</small>
      `;
      return;
    }

    // lesson default
    const subject = entry.subject || "Lesson";
    cell.innerHTML =
      `<b>${escapeHtml(subject)}</b><br>` +
      `${escapeHtml(entry.className || "")}<br>` +
      `<small>${escapeHtml(entry.venue || "")}</small>`;
  }

  function escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ---------------------- PAYLOAD BUILD ----------------------

  function buildPayload() {
    const teacherName = normalizeTeacherName(teacherNameInput.value || currentTeacherName || "Unknown");
    return {
      teacherName,
      config: { ...timetableConfig },
      // Save entries as array
      entries: Object.values(timetableData),
      // Teacher-level metadata
      lastResort: !!currentTeacherLastResort,
    };
  }

  function loadPayload(payload) {
    currentTeacherName = normalizeTeacherName(payload.teacherName || "");
    currentTeacherKey = getTeacherKey(currentTeacherName);
    currentTeacherLabel.textContent = currentTeacherName || "None";
    teacherNameInput.value = currentTeacherName;

    timetableConfig = payload.config || { rows: 0, cols: 0, dayNames: [] };

    // Ensure valid config defaults
    timetableConfig.rows = parseInt(timetableConfig.rows, 10) || 0;
    timetableConfig.cols = parseInt(timetableConfig.cols, 10) || 0;
    timetableConfig.dayNames = Array.isArray(timetableConfig.dayNames) ? timetableConfig.dayNames : [];

    timetableData = {};
    (payload.entries || []).forEach((e) => {
      if (typeof e?.row === "number" && typeof e?.col === "number") {
        // Compatibility: allow `title` from older builder
        if (!e.subject && e.title) e.subject = e.title;
        const key = getCellKey(e.row, e.col);
        timetableData[key] = e;
      }
    });

    currentTeacherLastResort = !!payload.lastResort;
    if (lastResortSwitch) lastResortSwitch.checked = currentTeacherLastResort;

    // Update config inputs for visibility
    rowsInput.value = timetableConfig.rows || 5;
    colsInput.value = timetableConfig.cols || 6;
    dayNamesInput.value = (timetableConfig.dayNames || []).join(",");

    buildTableStructure();
    setUnsaved(false);
  }

  // ---------------------- SAVE / LOAD -------------------------

  function saveCurrentTimetable() {
    const teacherName = normalizeTeacherName(teacherNameInput.value);
    if (!teacherName) {
      alert("Please enter a teacher name before saving.");
      return;
    }

    const key = getTeacherKey(teacherName);
    if (!key) {
      alert("Teacher name is not valid for saving.");
      return;
    }

    const payload = buildPayload();
    payload.teacherName = teacherName;

    localStorage.setItem(key, JSON.stringify(payload));

    // Refresh caches and UI
    _teacherNamesCache = null;
    rebuildTeacherNamesCache();
    refreshTeacherSelect(teacherSearchInput?.value || "");

    currentTeacherName = teacherName;
    currentTeacherKey = key;
    currentTeacherLabel.textContent = currentTeacherName;

    setUnsaved(false);
    updateSummary();

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
      teacherSelect.value = storageKey;
    } catch (e) {
      console.error("Error loading timetable", e);
      alert("Could not load timetable – data may be corrupted.");
    }
  }

  function loadTimetable() {
    const selectedKey = teacherSelect.value;
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
    currentTeacherLabel.textContent = "None";
    teacherNameInput.value = "";
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
        const payload = JSON.parse(e.target.result);
        if (!payload || typeof payload !== "object") {
          alert("Invalid JSON structure.");
          return;
        }

        let teacherName = normalizeTeacherName(payload.teacherName || "");
        if (!teacherName) {
          teacherName = normalizeTeacherName(prompt("JSON has no teacherName. Enter teacher name:", "New Teacher") || "");
          if (!teacherName) {
            alert("Import cancelled.");
            return;
          }
        }

        // Compatibility: older builder might use title instead of subject
        if (Array.isArray(payload.entries)) {
          payload.entries.forEach(e2 => {
            if (e2 && !e2.subject && e2.title) e2.subject = e2.title;
          });
        }

        const safePayload = {
          teacherName,
          config: payload.config || { rows: 0, cols: 0, dayNames: [] },
          entries: Array.isArray(payload.entries) ? payload.entries : [],
          lastResort: !!payload.lastResort,
        };

        const key = getTeacherKey(teacherName);
        localStorage.setItem(key, JSON.stringify(safePayload));

        _teacherNamesCache = null;
        rebuildTeacherNamesCache();
        refreshTeacherSelect(teacherSearchInput?.value || "");

        loadPayload(safePayload);
        alert(`Timetable imported for ${teacherName}.`);
      } catch (err) {
        console.error("Error importing JSON", err);
        alert("Could not import JSON. Please check the file format.");
      } finally {
        importFileInput.value = "";
      }
    };

    reader.onerror = () => {
      alert("Error reading file.");
      importFileInput.value = "";
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
    jsonOutput.value = jsonString;

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
    const text = (jsonOutput.value || "").trim();
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

  // ---------------------- BULK FOLDER IMPORT -------------------

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  async function bulkImportFromFolder(files) {
    const jsonFiles = Array.from(files || []).filter(f => f.name.toLowerCase().endsWith(".json"));
    if (jsonFiles.length === 0) {
      bulkStatus.textContent = "No JSON files found in selected folder.";
      bulkStatusDetail.textContent = "";
      return;
    }

    let imported = 0;
    let failed = 0;
    const failures = [];

    for (const f of jsonFiles) {
      try {
        const text = await readFileAsText(f);
        const payload = JSON.parse(text);

        // Determine teacher name
        let teacherName = normalizeTeacherName(payload.teacherName || "");
        if (!teacherName) {
          teacherName = normalizeTeacherName(f.name.replace(/\.json$/i, ""));
        }
        if (!teacherName) throw new Error("Missing teacherName");

        // Compatibility: title -> subject
        if (Array.isArray(payload.entries)) {
          payload.entries.forEach(e2 => {
            if (e2 && !e2.subject && e2.title) e2.subject = e2.title;
          });
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

    bulkStatus.textContent = `Imported ${imported} timetable(s).`;
    bulkStatusDetail.textContent = failed > 0
      ? `Failed ${failed}. ${failures.slice(0, 5).join(" | ")}${failures.length > 5 ? " | ..." : ""}`
      : "All files imported successfully.";
  }

  // ---------------------- RENAME TEACHER -----------------------

  function openRenameConfirm() {
    if (!renameConfirmModal) return;

    const from = currentTeacherName;
    const to = normalizeTeacherName(teacherNameInput.value);

    if (!from) {
      alert("Load a teacher timetable before renaming.");
      return;
    }
    if (!to) {
      alert("Enter the new teacher name.");
      return;
    }
    if (from === to) {
      alert("The new name is the same as the current name.");
      return;
    }

    renameFromSpan.textContent = from;
    renameToSpan.textContent = to;

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

    if (localStorage.getItem(toKey)) {
      alert("A timetable already exists with the target name. Rename cancelled.");
      return;
    }

    const raw = localStorage.getItem(fromKey);
    if (!raw) {
      alert("Source timetable could not be found. Rename cancelled.");
      return;
    }

    try {
      const payload = JSON.parse(raw);
      payload.teacherName = to;
      localStorage.setItem(toKey, JSON.stringify(payload));
      localStorage.removeItem(fromKey);

      // Update state
      currentTeacherName = to;
      currentTeacherKey = toKey;
      currentTeacherLabel.textContent = to;
      teacherNameInput.value = to;

      _teacherNamesCache = null;
      rebuildTeacherNamesCache();
      refreshTeacherSelect(teacherSearchInput?.value || "");

      renameConfirmModal?.hide();
      alert(`Renamed timetable: ${from} → ${to}`);
    } catch (e) {
      console.error("Rename failed", e);
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

    if (!confirm("This will bulk-remove titles (Mr/Mrs/Miss/Ms/Dr) from ALL teacher names. Continue?")) {
      return;
    }

    let changed = 0;
    let skipped = 0;
    const conflicts = [];

    // Work on a copy because localStorage keys will change
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

        // If current teacher renamed, update live state
        if (currentTeacherName === oldName) {
          currentTeacherName = newName;
          currentTeacherKey = newKey;
          currentTeacherLabel.textContent = newName;
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

    const msg = `Titles removed from ${changed} teacher(s).` +
      (skipped > 0 ? ` Skipped ${skipped} due to conflicts/errors.` : "");

    alert(msg + (conflicts.length ? `\nExamples: ${conflicts.slice(0, 5).join(" | ")}${conflicts.length > 5 ? " | ..." : ""}` : ""));
  }

  // ---------------------- SEARCH + QUICK LOAD ------------------

  function quickSearchUpdate() {
    const txt = teacherSearchInput.value;
    const filtered = refreshTeacherSelect(txt);

    // Optional: if only one match and user pressed Enter, handled in keydown
    return filtered;
  }

  teacherSearchInput?.addEventListener("input", quickSearchUpdate);

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
  });

  // ---------------------- COMPLETENESS AUDIT -------------------

  function auditMissingCells() {
    if (!timetableConfig.rows || !timetableConfig.cols) {
      missingSummary.textContent = "Generate or load a timetable first.";
      missingCellChips.innerHTML = "";
      autofillBtn.disabled = true;
      return;
    }

    const missing = [];
    for (let r = 0; r < timetableConfig.rows; r++) {
      for (let c = 0; c < timetableConfig.cols; c++) {
        const key = getCellKey(r, c);
        if (!timetableData[key]) {
          missing.push({ r, c });
        }
      }
    }

    missingSummary.textContent = `${missing.length} uncaptured cell(s).`;
    missingCellChips.innerHTML = missing.slice(0, 60).map(m => {
      return `<span class="teacher-chip chip-muted">Day ${m.r + 1} P${m.c + 1}</span>`;
    }).join("") + (missing.length > 60 ? `<div class="small text-muted mt-1">+ ${missing.length - 60} more…</div>` : "");

    autofillBtn.disabled = missing.length === 0;

    return missing;
  }

  function getSelectedAutofillType() {
    const selected = document.querySelector("input[name='autofillType']:checked");
    return selected ? selected.value : "free";
  }

  function applyAutofill() {
    const missing = auditMissingCells();
    if (!missing || missing.length === 0) return;

    const type = getSelectedAutofillType();

    missing.forEach(({ r, c }) => {
      const key = getCellKey(r, c);
      if (timetableData[key]) return;

      const base = { row: r, col: c, type };

      if (type === "free") {
        timetableData[key] = base;
        return;
      }

      // meeting/lesson placeholders — editable later
      timetableData[key] = {
        ...base,
        subject: "",
        className: "",
        venue: "",
        ...(type === "meeting" ? { doNotDisturb: false } : {}),
      };
    });

    renderAllEntries();
    setUnsaved(true);
    updateSummary();
    auditMissingCells();
  }

  // ---------------------- BULK DND BY SLOT ---------------------

  let _dndSlotTeachers = []; // [{name, key, entry, hasDnd}]
  let _dndActionMode = "apply"; // apply/remove

  function buildSlotLabel(dayIdx, periodIdx) {
    return `Day ${dayIdx + 1}, Period ${periodIdx + 1}`;
  }

  function loadTeachersForDndSlot() {
    const day = parseInt(dndDaySelect.value, 10);
    const period = parseInt(dndPeriodSelect.value, 10);

    const names = getAllTeacherNames();
    const list = [];

    for (const name of names) {
      const key = getTeacherKey(name);
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const payload = JSON.parse(raw);
        const entries = Array.isArray(payload.entries) ? payload.entries : [];

        // Find entry for this slot
        const entry = entries.find(e => e && e.row === day && e.col === period);
        if (entry && entry.type === "meeting") {
          if (!entry.subject && entry.title) entry.subject = entry.title;
          list.push({
            name,
            key,
            entry,
            hasDnd: !!entry.doNotDisturb,
          });
        }
      } catch (_) {
        // ignore corrupted
      }
    }

    _dndSlotTeachers = list;
    renderDndTeacherChecklist();

    dndStatus.textContent = list.length
      ? `Loaded ${list.length} teacher(s) for ${buildSlotLabel(day, period)}.`
      : `No meetings found for ${buildSlotLabel(day, period)}.`;
  }

  function renderDndTeacherChecklist() {
    dndTeacherList.innerHTML = "";

    if (_dndSlotTeachers.length === 0) {
      dndTeacherList.innerHTML = `<div class="text-muted small p-2">No teachers found for selected slot.</div>`;
      applyDndBtn.disabled = true;
      removeDndBtn.disabled = true;
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

      const title = document.createElement("div");
      title.className = "fw-semibold";
      title.textContent = t.name;

      const meta = document.createElement("div");
      meta.className = "small text-muted";
      meta.textContent = t.entry.subject ? `Meeting: ${t.entry.subject}` : "Meeting";

      const badges = document.createElement("div");
      badges.className = "mt-1";
      if (t.hasDnd) {
        badges.innerHTML = `<span class="badge bg-danger">Currently DND</span>`;
      } else {
        badges.innerHTML = `<span class="badge bg-secondary">Interruptible</span>`;
      }

      body.appendChild(title);
      body.appendChild(meta);
      body.appendChild(badges);

      item.appendChild(cb);
      item.appendChild(body);
      frag.appendChild(item);
    });

    dndTeacherList.appendChild(frag);

    // Enable buttons when selection changes
    dndTeacherList.querySelectorAll("input[type='checkbox']").forEach(cb => {
      cb.addEventListener("change", updateDndButtonsState);
    });

    updateDndButtonsState();
  }

  function getSelectedDndTeacherIndices() {
    const cbs = dndTeacherList.querySelectorAll("input[type='checkbox']:checked");
    return Array.from(cbs).map(cb => parseInt(cb.dataset.idx, 10)).filter(Number.isFinite);
  }

  function updateDndButtonsState() {
    const selected = getSelectedDndTeacherIndices();
    const hasSelection = selected.length > 0;
    applyDndBtn.disabled = !hasSelection;
    removeDndBtn.disabled = !hasSelection;
  }

  function selectAllDndTeachers(flag) {
    dndTeacherList.querySelectorAll("input[type='checkbox']").forEach(cb => { cb.checked = !!flag; });
    updateDndButtonsState();
  }

  function openDndConfirm(mode) {
    if (!dndConfirmModal) return;

    _dndActionMode = mode;

    const day = parseInt(dndDaySelect.value, 10);
    const period = parseInt(dndPeriodSelect.value, 10);
    const selected = getSelectedDndTeacherIndices();

    dndConfirmSlot.textContent = buildSlotLabel(day, period);
    dndConfirmCount.textContent = String(selected.length);

    // Button text could reflect mode (apply/remove)
    confirmDndApplyBtn.textContent = mode === "remove" ? "Confirm Remove" : "Confirm Apply";

    dndConfirmModal.show();
  }

  function applyBulkDnd(mode) {
    const day = parseInt(dndDaySelect.value, 10);
    const period = parseInt(dndPeriodSelect.value, 10);
    const selectedIdx = getSelectedDndTeacherIndices();

    if (selectedIdx.length === 0) {
      dndConfirmModal?.hide();
      return;
    }

    let updated = 0;
    let failed = 0;

    selectedIdx.forEach(i => {
      const t = _dndSlotTeachers[i];
      if (!t) return;

      const raw = localStorage.getItem(t.key);
      if (!raw) { failed++; return; }

      try {
        const payload = JSON.parse(raw);
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        const entry = entries.find(e => e && e.row === day && e.col === period);
        if (!entry || entry.type !== "meeting") return;

        if (mode === "apply") entry.doNotDisturb = true;
        else if (mode === "remove") delete entry.doNotDisturb;

        localStorage.setItem(t.key, JSON.stringify(payload));
        updated++;

        // If this teacher is currently loaded and same slot, update in-memory state too
        if (currentTeacherName === t.name) {
          const k = getCellKey(day, period);
          if (timetableData[k] && timetableData[k].type === "meeting") {
            if (mode === "apply") timetableData[k].doNotDisturb = true;
            else delete timetableData[k].doNotDisturb;
            renderSingleCell(day, period);
            setUnsaved(true);
          }
        }
      } catch (e) {
        failed++;
      }
    });

    // Refresh slot list status
    loadTeachersForDndSlot();

    dndStatus.textContent = mode === "apply"
      ? `Applied DND to ${updated} teacher(s) for ${buildSlotLabel(day, period)}.${failed ? ` Failed: ${failed}.` : ""}`
      : `Removed DND from ${updated} teacher(s) for ${buildSlotLabel(day, period)}.${failed ? ` Failed: ${failed}.` : ""}`;

    dndConfirmModal?.hide();
  }

  // ---------------------- SUMMARY -----------------------------

  function updateSummary() {
    const teacher = currentTeacherName || "—";
    summaryTeacher.textContent = teacher;

    if (!timetableConfig.rows || !timetableConfig.cols || !currentTeacherName) {
      summaryCaptured.textContent = "—";
      summaryUncaptured.textContent = "—";
      summaryNotes.textContent = "No teacher loaded.";
      return;
    }

    const total = timetableConfig.rows * timetableConfig.cols;
    const captured = Object.keys(timetableData).length;

    // Captured can exceed total if config changed; clamp display
    const capturedClamped = Math.min(captured, total);
    const uncaptured = Math.max(total - capturedClamped, 0);

    summaryCaptured.textContent = String(capturedClamped);
    summaryUncaptured.textContent = String(uncaptured);

    const notes = [];
    if (currentTeacherLastResort) notes.push("Teacher is marked as Last Resort.");

    // Count DND meetings
    const dndCount = Object.values(timetableData).filter(e => e?.type === "meeting" && e.doNotDisturb).length;
    if (dndCount) notes.push(`${dndCount} meeting(s) marked DND.`);

    if (uncaptured) notes.push("Timetable has uncaptured cells — consider auto-fill.");

    summaryNotes.textContent = notes.length ? notes.join(" ") : "No notes.";
  }

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
  });

  saveBtn?.addEventListener("click", saveCurrentTimetable);
  loadBtn?.addEventListener("click", loadTimetable);
  clearBtn?.addEventListener("click", clearCurrentGrid);

  importBtn?.addEventListener("click", () => importFileInput.click());
  importFileInput?.addEventListener("change", () => {
    const file = importFileInput.files[0];
    importFromJsonFile(file);
  });

  exportBtn?.addEventListener("click", exportCurrentTimetable);
  copyJsonBtn?.addEventListener("click", copyJsonToClipboard);

  bulkFolderBtn?.addEventListener("click", () => bulkFolderInput.click());
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
      refreshTeacherSelect(teacherSearchInput?.value || "");
    }
  });

  // ---------------------- INITIAL UI STATE ---------------------

  rebuildTeacherNamesCache();
  refreshTeacherSelect();
  showPlaceholder();
  setUnsaved(false);
  updateSummary();
});
