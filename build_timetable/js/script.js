// ---------------------- STORAGE CONSTANTS ----------------------
const STORAGE_PREFIX = "teacherTimetable_"; // per-teacher key prefix
const STORAGE_INDEX_KEY = "teacherTimetableIndex"; // list of saved teachers

// ---------------------- GLOBAL STATE --------------------------
let timetableConfig = {
  rows: 0,
  cols: 0,
  dayNames: [],
};

let timetableData = {}; // { "row-col": { row, col, type, title, className, venue } }
let currentTeacherName = "";

// ---------------------- DOM READY -----------------------------
document.addEventListener("DOMContentLoaded", function () {
  // Core form & table
  const gridForm = document.getElementById("gridForm");
  const rowsInput = document.getElementById("rowsInput");
  const colsInput = document.getElementById("colsInput");
  const dayNamesInput = document.getElementById("dayNamesInput");

  const timetableTable = document.getElementById("timetableTable");
  const timetablePlaceholder = document.getElementById("timetablePlaceholder");
  const timetableWrapper = document.getElementById("timetableWrapper");

  // Teacher controls (NEW)
  const teacherNameInput = document.getElementById("teacherNameInput");
  const teacherSelect = document.getElementById("teacherSelect");

  // Data buttons
  const saveBtn = document.getElementById("saveBtn");
  const loadBtn = document.getElementById("loadBtn");
  const clearBtn = document.getElementById("clearBtn");

  const importBtn = document.getElementById("importBtn"); // NEW
  const importFileInput = document.getElementById("importFileInput"); // NEW

  const exportBtn = document.getElementById("exportBtn");
  const copyJsonBtn = document.getElementById("copyJsonBtn");
  const jsonOutput = document.getElementById("jsonOutput");

  // Modal elements
  const cellModalElement = document.getElementById("cellModal");
  const cellModal = new bootstrap.Modal(cellModalElement);
  const cellForm = document.getElementById("cellForm");
  const cellRowInput = document.getElementById("cellRow");
  const cellColInput = document.getElementById("cellCol");
  const entryTypeSelect = document.getElementById("entryType");
  const entryTitleInput = document.getElementById("entryTitle");
  const entryClassInput = document.getElementById("entryClass");
  const entryVenueInput = document.getElementById("entryVenue");
  const detailFieldsDiv = document.getElementById("detailFields");
  const freeTimeHint = document.getElementById("freeTimeHint");
  const deleteCellBtn = document.getElementById("deleteCellBtn");

  // ---------------------- HELPER FUNCTIONS -------------------

  function sanitizeTeacherName(name) {
    const trimmed = name.trim();
    if (!trimmed) return "";
    // Replace spaces with underscores, strip bad characters
    return trimmed.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  }

  function getTeacherStorageKey(teacherName) {
    const safe = sanitizeTeacherName(teacherName);
    if (!safe) return null;
    return STORAGE_PREFIX + safe;
  }

  function loadTeacherIndex() {
    const raw = localStorage.getItem(STORAGE_INDEX_KEY);
    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.error("Failed to parse teacher index", e);
      return [];
    }
  }

  function saveTeacherIndex(list) {
    localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(list));
  }

  function ensureTeacherInIndex(teacherName) {
    const key = getTeacherStorageKey(teacherName);
    if (!key) return;

    const list = loadTeacherIndex();
    const exists = list.some((item) => item.key === key);
    if (!exists) {
      list.push({ name: teacherName, key });
      saveTeacherIndex(list);
    }
    refreshTeacherSelect(key);
  }

  function refreshTeacherSelect(selectedKey) {
    const list = loadTeacherIndex();

    // Clear existing options
    teacherSelect.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent =
      list.length === 0
        ? "-- No saved timetables yet --"
        : "-- Select a teacher --";
    teacherSelect.appendChild(defaultOption);

    list.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.key;
      opt.textContent = item.name;
      teacherSelect.appendChild(opt);
    });

    if (selectedKey) {
      teacherSelect.value = selectedKey;
    }
  }

  function setCurrentTeacherName(name) {
    currentTeacherName = name || "";
    teacherNameInput.value = currentTeacherName;
    const key = getTeacherStorageKey(currentTeacherName);
    refreshTeacherSelect(key);
  }

  function getCellKey(row, col) {
    return `${row}-${col}`;
  }

  function parseDayNames(input, rows) {
    if (!input || !input.trim()) return [];
    return input
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .slice(0, rows);
  }

  function showPlaceholder() {
    timetablePlaceholder.classList.remove("d-none");
    timetableWrapper.classList.add("d-none");
    timetableTable.innerHTML = "";
  }

  function showTable() {
    timetablePlaceholder.classList.add("d-none");
    timetableWrapper.classList.remove("d-none");
  }

  // ---------------------- TABLE BUILD -----------------------

  function buildTableStructure() {
    const { rows, cols, dayNames } = timetableConfig;

    if (!rows || !cols || rows <= 0 || cols <= 0) {
      showPlaceholder();
      return;
    }

    showTable();
    timetableTable.innerHTML = "";

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
    timetableTable.appendChild(thead);

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
        td.addEventListener("click", function () {
          openCellEditor(r, c);
        });
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    timetableTable.appendChild(tbody);
    renderAllEntries();
  }

  // ---------------------- CELL EDITOR -----------------------

  function openCellEditor(row, col) {
    const key = getCellKey(row, col);
    const entry = timetableData[key];

    cellRowInput.value = row;
    cellColInput.value = col;

    if (entry) {
      entryTypeSelect.value = entry.type;
      entryTitleInput.value = entry.title || "";
      entryClassInput.value = entry.className || "";
      entryVenueInput.value = entry.venue || "";
    } else {
      entryTypeSelect.value = "lesson";
      entryTitleInput.value = "";
      entryClassInput.value = "";
      entryVenueInput.value = "";
    }

    toggleFields();
    cellModal.show();
  }

  function toggleFields() {
    if (entryTypeSelect.value === "free") {
      detailFieldsDiv.classList.add("d-none");
      freeTimeHint.classList.remove("d-none");
    } else {
      detailFieldsDiv.classList.remove("d-none");
      freeTimeHint.classList.add("d-none");
    }
  }

  entryTypeSelect.addEventListener("change", toggleFields);

  // ---------------------- SAVE / DELETE CELL ----------------

  cellForm.addEventListener("submit", function (e) {
    e.preventDefault();

    const row = parseInt(cellRowInput.value, 10);
    const col = parseInt(cellColInput.value, 10);
    const key = getCellKey(row, col);
    const type = entryTypeSelect.value;

    timetableData[key] = {
      row,
      col,
      type,
      title: entryTitleInput.value.trim(),
      className: entryClassInput.value.trim(),
      venue: entryVenueInput.value.trim(),
    };

    renderSingleCell(row, col);
    cellModal.hide();
  });

  deleteCellBtn.addEventListener("click", function () {
    const row = parseInt(cellRowInput.value, 10);
    const col = parseInt(cellColInput.value, 10);
    const key = getCellKey(row, col);

    delete timetableData[key];
    renderSingleCell(row, col);
    cellModal.hide();
  });

  // ---------------------- RENDER CELLS ----------------------

  function renderAllEntries() {
    document.querySelectorAll(".timetable-cell").forEach((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      renderSingleCell(r, c);
    });
  }

  function renderSingleCell(row, col) {
    const key = getCellKey(row, col);
    const cell = document.querySelector(
      `.timetable-cell[data-row="${row}"][data-col="${col}"]`,
    );
    if (!cell) return;

    const entry = timetableData[key];
    if (!entry) {
      cell.textContent = "Click to add";
      return;
    }

    if (entry.type === "free") {
      cell.innerHTML = "<b>Free Time</b>";
    } else {
      cell.innerHTML =
        `<b>${entry.title || "Lesson"}</b><br>` +
        `${entry.className || ""}<br>` +
        `<small>${entry.venue || ""}</small>`;
    }
  }

  // ---------------------- SAVE / LOAD TIMETABLE -------------

  function buildPayload() {
    const teacherName =
      currentTeacherName || teacherNameInput.value.trim() || "Unknown";
    return {
      teacherName,
      config: { ...timetableConfig },
      entries: Object.values(timetableData),
    };
  }

  function saveCurrentTimetable() {
    const teacherName = teacherNameInput.value.trim();
    if (!teacherName) {
      alert("Please enter a teacher name before saving.");
      return;
    }

    const storageKey = getTeacherStorageKey(teacherName);
    if (!storageKey) {
      alert("Teacher name is not valid for saving.");
      return;
    }

    const payload = buildPayload();
    payload.teacherName = teacherName;

    localStorage.setItem(storageKey, JSON.stringify(payload));
    setCurrentTeacherName(teacherName);
    ensureTeacherInIndex(teacherName);

    alert(`Timetable saved for ${teacherName}.`);
  }

  function loadTimetableFromStorageKey(storageKey) {
    if (!storageKey) return;

    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      alert("No timetable data found for this teacher.");
      refreshTeacherSelect();
      return;
    }

    try {
      const payload = JSON.parse(raw);
      currentTeacherName = payload.teacherName || currentTeacherName;
      teacherNameInput.value = currentTeacherName;

      timetableConfig = payload.config || { rows: 0, cols: 0, dayNames: [] };
      timetableData = {};

      (payload.entries || []).forEach((entry) => {
        const key = getCellKey(entry.row, entry.col);
        timetableData[key] = entry;
      });

      buildTableStructure();
    } catch (e) {
      console.error("Error loading timetable", e);
      alert("Could not load timetable – data may be corrupted.");
    }
  }

  function loadTimetable() {
    const selectedKey = teacherSelect.value;
    if (selectedKey) {
      loadTimetableFromStorageKey(selectedKey);
      return;
    }

    const teacherName = teacherNameInput.value.trim();
    if (!teacherName) {
      alert("Select a teacher from the list or enter a teacher name to load.");
      return;
    }

    const storageKey = getTeacherStorageKey(teacherName);
    loadTimetableFromStorageKey(storageKey);
  }

  function clearCurrentGrid() {
    if (
      !confirm(
        "Clear the current timetable grid (unsaved changes will be lost)?",
      )
    ) {
      return;
    }
    timetableConfig = { rows: 0, cols: 0, dayNames: [] };
    timetableData = {};
    showPlaceholder();
  }

  // ---------------------- IMPORT FROM JSON ------------------

  function importFromJsonFile(file) {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (e) {
      try {
        const text = e.target.result;
        const payload = JSON.parse(text);

        // Basic validation
        if (typeof payload !== "object" || payload === null) {
          alert("Invalid JSON structure.");
          return;
        }

        // Get teacherName from payload or ask user
        let teacherName = (payload.teacherName || "").trim();
        if (!teacherName) {
          teacherName = prompt(
            "The JSON file does not contain a teacherName.\nPlease enter the teacher's name:",
            "New Teacher",
          );
          if (!teacherName) {
            alert("Import cancelled (no teacher name provided).");
            return;
          }
        }

        const storageKey = getTeacherStorageKey(teacherName);
        if (!storageKey) {
          alert("Teacher name is not valid for saving.");
          return;
        }

        // Normalise payload to our expected shape
        const config = payload.config || {};
        const entries = Array.isArray(payload.entries) ? payload.entries : [];

        const safePayload = {
          teacherName: teacherName,
          config: {
            rows: parseInt(config.rows, 10) || 0,
            cols: parseInt(config.cols, 10) || 0,
            dayNames: Array.isArray(config.dayNames) ? config.dayNames : [],
          },
          entries: entries,
        };

        // Save to localStorage under per-teacher key
        localStorage.setItem(storageKey, JSON.stringify(safePayload));

        // Make sure teacher appears in index + combo box
        ensureTeacherInIndex(teacherName);
        setCurrentTeacherName(teacherName);

        // Load into current view
        timetableConfig = safePayload.config;
        timetableData = {};
        safePayload.entries.forEach((entry) => {
          if (typeof entry.row === "number" && typeof entry.col === "number") {
            const key = getCellKey(entry.row, entry.col);
            timetableData[key] = entry;
          }
        });

        buildTableStructure();
        alert(`Timetable imported for ${teacherName}.`);
      } catch (err) {
        console.error("Error importing JSON", err);
        alert("Could not import JSON. Please check the file format.");
      } finally {
        // Reset file input so the same file can be selected again if needed
        importFileInput.value = "";
      }
    };

    reader.onerror = function () {
      alert("Error reading file.");
      importFileInput.value = "";
    };

    reader.readAsText(file);
  }

  // ---------------------- EXPORT / COPY JSON ----------------

  function exportCurrentTimetable() {
    if (!timetableConfig.rows || !timetableConfig.cols) {
      alert("Nothing to export. Generate or load a timetable first.");
      return;
    }

    const payload = buildPayload();
    const jsonString = JSON.stringify(payload, null, 2);
    jsonOutput.value = jsonString;

    const safeName = sanitizeTeacherName(payload.teacherName) || "timetable";
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
    const text = jsonOutput.value.trim();
    if (!text) {
      alert("There is no JSON to copy yet. Export first.");
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
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

  // ---------------------- EVENT WIRING ----------------------

  // Generate timetable grid
  gridForm.addEventListener("submit", function (e) {
    e.preventDefault();

    timetableConfig.rows = parseInt(rowsInput.value, 10);
    timetableConfig.cols = parseInt(colsInput.value, 10);
    timetableConfig.dayNames = parseDayNames(
      dayNamesInput.value,
      timetableConfig.rows,
    );

    timetableData = {};
    buildTableStructure();
  });

  // Save / Load / Clear / Export / Copy
  saveBtn.addEventListener("click", saveCurrentTimetable);
  loadBtn.addEventListener("click", loadTimetable);
  clearBtn.addEventListener("click", clearCurrentGrid);
  exportBtn.addEventListener("click", exportCurrentTimetable);
  copyJsonBtn.addEventListener("click", copyJsonToClipboard);

  // When combobox changes, load that teacher automatically
  teacherSelect.addEventListener("change", function () {
    const key = teacherSelect.value;
    if (key) {
      loadTimetableFromStorageKey(key);
    }
  });

  // Import: open file dialog
  importBtn.addEventListener("click", function () {
    importFileInput.click();
  });

  // When a file is chosen, import it
  importFileInput.addEventListener("change", function () {
    const file = importFileInput.files[0];
    importFromJsonFile(file);
  });

  // Initial UI state
  refreshTeacherSelect();
  showPlaceholder();
});
