// viewer.js — Core viewer logic with date range and report support

const Viewer = (() => {
  let config = null;
  let allData = [];
  let filteredData = [];
  let currentSort = { field: "date", direction: "asc" };
  let currentReport = null;
  let currentReportData = null;
  let currentReportPage = 1;

  // Filter state
  let filters = {
    absentTeacher: "",
    coverTeacher: "",
    dateFrom: null,
    dateTo: null,
  };

  const STORAGE_FILTER_KEY = "viewerFilters";
  const STORAGE_CACHE_KEY = "viewerDataCache";

  // ── Init ───────────────────────────────────────────────────
  async function init() {
    config = await ViewerConfig.mergeConfig();
    loadFilters();
    setupEventListeners();
    setDefaultDateRange();
    await fetchData();
  }

  // ── Date Range Helpers ─────────────────────────────────────
  function setDefaultDateRange() {
    // Default: last 30 days
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    filters.dateTo = today.toISOString().split("T")[0];
    filters.dateFrom = thirtyDaysAgo.toISOString().split("T")[0];

    document.getElementById("filterDateFrom").value = filters.dateFrom;
    document.getElementById("filterDateTo").value = filters.dateTo;
    updateDateRangeDisplay();
  }

  function updateDateRangeDisplay() {
    const display = document.getElementById("dateRangeDisplay");
    if (filters.dateFrom && filters.dateTo) {
      display.textContent = `Date range: ${filters.dateFrom} to ${filters.dateTo}`;
    } else if (filters.dateFrom) {
      display.textContent = `Date range: from ${filters.dateFrom}`;
    } else if (filters.dateTo) {
      display.textContent = `Date range: until ${filters.dateTo}`;
    } else {
      display.textContent = "Date range: all data";
    }
  }

  function setQuickDateRange(days) {
    const today = new Date();
    if (days === null) {
      // All data
      filters.dateFrom = null;
      filters.dateTo = null;
      document.getElementById("filterDateFrom").value = "";
      document.getElementById("filterDateTo").value = "";
    } else {
      const startDate = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
      filters.dateFrom = startDate.toISOString().split("T")[0];
      filters.dateTo = today.toISOString().split("T")[0];
      document.getElementById("filterDateFrom").value = filters.dateFrom;
      document.getElementById("filterDateTo").value = filters.dateTo;
    }
    updateDateRangeDisplay();
    filterData();
    saveFilters();
  }

  // ── Setup event listeners ──────────────────────────────────
  function setupEventListeners() {
    // Date range
    document.getElementById("filterDateFrom").addEventListener("change", () => {
      filters.dateFrom = document.getElementById("filterDateFrom").value || null;
      updateDateRangeDisplay();
      filterData();
      saveFilters();
    });

    document.getElementById("filterDateTo").addEventListener("change", () => {
      filters.dateTo = document.getElementById("filterDateTo").value || null;
      updateDateRangeDisplay();
      filterData();
      saveFilters();
    });

    // Quick select buttons
    document.getElementById("quickLast7").addEventListener("click", () => setQuickDateRange(7));
    document.getElementById("quickLast30").addEventListener("click", () => setQuickDateRange(30));
    document.getElementById("quickAllData").addEventListener("click", () => setQuickDateRange(null));

    document.getElementById("refreshDataBtn").addEventListener("click", () => {
      fetchData();
    });

    document.getElementById("filterAbsentTeacher").addEventListener("input", (e) => {
      filters.absentTeacher = e.target.value.toLowerCase();
      showAbsentTeacherDropdown(e.target.value);
      filterData();
      saveFilters();
    });

    document.getElementById("filterCoverTeacher").addEventListener("input", (e) => {
      filters.coverTeacher = e.target.value.toLowerCase();
      showCoverTeacherDropdown(e.target.value);
      filterData();
      saveFilters();
    });

    document.getElementById("clearFiltersBtn").addEventListener("click", () => {
      filters = {
        absentTeacher: "",
        coverTeacher: "",
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
      };
      document.getElementById("filterAbsentTeacher").value = "";
      document.getElementById("filterCoverTeacher").value = "";
      document.getElementById("absentTeacherDropdown").style.display = "none";
      document.getElementById("coverTeacherDropdown").style.display = "none";
      filterData();
      saveFilters();
    });

    // Sorting
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const field = th.dataset.sort;
        currentSort.direction =
          currentSort.field === field && currentSort.direction === "asc"
            ? "desc"
            : "asc";
        currentSort.field = field;
        renderTable();
      });
    });

    // Settings modal
    document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
    document.getElementById("testConnectionBtn").addEventListener("click", testConnection);

    // Export/Report
    document.getElementById("viewReportBtn").addEventListener("click", viewSelectedReport);
    document.getElementById("exportCsvBtn").addEventListener("click", () => {
      ViewerExport.exportCSV(filteredData, config.schoolId);
    });
    document.getElementById("exportExcelBtn").addEventListener("click", () => {
      ViewerExport.exportExcel(filteredData, config.schoolId, allData);
    });
    document.getElementById("printBtn").addEventListener("click", () => {
      ViewerExport.printData(filteredData, config.schoolId);
    });

    // Report modal
    document.getElementById("reportExportExcelBtn").addEventListener("click", exportReportToExcel);
    document.getElementById("reportPrintBtn").addEventListener("click", printReport);

    // Close dropdowns on click outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#filterAbsentTeacher")) {
        document.getElementById("absentTeacherDropdown").style.display = "none";
      }
      if (!e.target.closest("#filterCoverTeacher")) {
        document.getElementById("coverTeacherDropdown").style.display = "none";
      }
    });
  }

  // ── Fetch data from Firebase ────────────────────────────────
  async function fetchData() {
    try {
      if (!ViewerConfig.isValid(config)) {
        showError("Firebase configuration incomplete. Please configure in Settings.");
        return;
      }

      showLoading("Fetching data...");

      // Initialize Firebase
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      const db = firebase.firestore();

      // Fetch history for this school
      const snap = await db
        .collection("schools")
        .doc(config.schoolId)
        .collection("history")
        .get();

      if (snap.empty) {
        showLoading("No data found for this school.");
        return;
      }

      allData = snap.docs.map((doc) => doc.data()).sort((a, b) => new Date(b.date) - new Date(a.date));

      // Cache data
      cacheData(allData);

      filterData();
    } catch (err) {
      showError(`Failed to fetch data: ${err.message}`);
      console.error(err);
    }
  }

  // ── Filter data ────────────────────────────────────────────
  function filterData() {
    filteredData = allData.filter((r) => {
      // Date range filter
      if (filters.dateFrom && r.date < filters.dateFrom) return false;
      if (filters.dateTo && r.date > filters.dateTo) return false;

      // Absent teacher filter
      if (
        filters.absentTeacher &&
        !(r.coveredTeacher || "")
          .toLowerCase()
          .includes(filters.absentTeacher)
      )
        return false;

      // Cover teacher filter
      if (
        filters.coverTeacher &&
        !(r.coverTeacher || "")
          .toLowerCase()
          .includes(filters.coverTeacher)
      )
        return false;

      return true;
    });

    // Sort
    const field = currentSort.field;
    const dir = currentSort.direction === "asc" ? 1 : -1;
    filteredData.sort((a, b) => {
      let aVal = a[field] || "";
      let bVal = b[field] || "";

      // Numeric fields
      if (["week", "period"].includes(field)) {
        aVal = parseInt(aVal) || 0;
        bVal = parseInt(bVal) || 0;
      }

      // Date field
      if (field === "date") {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }

      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });

    renderTable();
    updateStats();
    updateDropdowns();
  }

  // ── Render table ───────────────────────────────────────────
  function renderTable() {
    const tbody = document.getElementById("dataTable");

    if (filteredData.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted py-4">No records match filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filteredData
      .map(
        (r) => `
      <tr>
        <td><small>${r.date || ""}</small></td>
        <td><small>${r.week || ""}</small></td>
        <td>${r.coveredTeacher || ""}</td>
        <td><small class="text-muted fst-italic">${r.absentReason || "—"}</small></td>
        <td><strong>${r.coverTeacher || ""}</strong></td>
        <td class="text-center"><small>${r.period || ""}</small></td>
        <td><small>${r.subject || ""}</small></td>
        <td><small>${r.className || ""}</small></td>
        <td><small>${r.venue || ""}</small></td>
      </tr>
    `,
      )
      .join("");
  }

  // ── Update stats ───────────────────────────────────────────
  function updateStats() {
    const dates = new Set(filteredData.map((r) => r.date)).size;
    const absent = new Set(filteredData.map((r) => r.coveredTeacher)).size;
    const cover = new Set(filteredData.map((r) => r.coverTeacher)).size;

    // Top absent & cover
    const absenceCounts = {};
    const coverCounts = {};
    for (const r of filteredData) {
      absenceCounts[r.coveredTeacher] = (absenceCounts[r.coveredTeacher] || 0) + 1;
      coverCounts[r.coverTeacher] = (coverCounts[r.coverTeacher] || 0) + 1;
    }
    const topAbsent = Object.entries(absenceCounts).sort((a, b) => b[1] - a[1])[0];
    const topCover = Object.entries(coverCounts).sort((a, b) => b[1] - a[1])[0];

    document.getElementById("statTotal").textContent = filteredData.length;
    document.getElementById("statDates").textContent = dates;
    document.getElementById("statAbsentUnique").textContent = absent;
    document.getElementById("statCoverUnique").textContent = cover;
    document.getElementById("statTopAbsent").textContent = topAbsent
      ? `${topAbsent[0]} (${topAbsent[1]})`
      : "—";
    document.getElementById("statTopCover").textContent = topCover
      ? `${topCover[0]} (${topCover[1]})`
      : "—";

    document.getElementById("resultCount").textContent = `Showing ${filteredData.length} of ${allData.length} records`;
  }

  // ── Dropdown autocomplete ──────────────────────────────────
  function updateDropdowns() {
    const absent = [...new Set(filteredData.map((r) => r.coveredTeacher))].sort();
    const cover = [...new Set(filteredData.map((r) => r.coverTeacher))].sort();

    // Cache for display
    window._absentTeachers = absent;
    window._coverTeachers = cover;
  }

  function showAbsentTeacherDropdown(query) {
    const div = document.getElementById("absentTeacherDropdown");
    if (!query || !window._absentTeachers) {
      div.style.display = "none";
      return;
    }
    const matches = window._absentTeachers.filter((t) =>
      t.toLowerCase().includes(query.toLowerCase()),
    );
    if (matches.length === 0) {
      div.style.display = "none";
      return;
    }
    div.innerHTML = matches
      .map(
        (t) => `
      <button type="button" class="dropdown-item" onclick="
        document.getElementById('filterAbsentTeacher').value = '${t}';
        document.getElementById('absentTeacherDropdown').style.display = 'none';
        document.dispatchEvent(new Event('change'));
        Viewer.filterData();
      ">${t}</button>
    `,
      )
      .join("");
    div.style.display = "block";
  }

  function showCoverTeacherDropdown(query) {
    const div = document.getElementById("coverTeacherDropdown");
    if (!query || !window._coverTeachers) {
      div.style.display = "none";
      return;
    }
    const matches = window._coverTeachers.filter((t) =>
      t.toLowerCase().includes(query.toLowerCase()),
    );
    if (matches.length === 0) {
      div.style.display = "none";
      return;
    }
    div.innerHTML = matches
      .map(
        (t) => `
      <button type="button" class="dropdown-item" onclick="
        document.getElementById('filterCoverTeacher').value = '${t}';
        document.getElementById('coverTeacherDropdown').style.display = 'none';
        document.dispatchEvent(new Event('change'));
        Viewer.filterData();
      ">${t}</button>
    `,
      )
      .join("");
    div.style.display = "block";
  }

  // ── Report Viewing ─────────────────────────────────────────
  function viewSelectedReport() {
    const reportId = document.getElementById("reportSelector").value;
    if (!reportId) {
      alert("Please select a report to view.");
      return;
    }

    currentReport = ViewerReports.getReportById(reportId);
    if (!currentReport) {
      alert("Report not found.");
      return;
    }

    currentReportPage = 1;
    currentReportData = currentReport.generateData(filteredData);
    renderReport();

    const reportModal = new bootstrap.Modal(document.getElementById("reportModal"));
    reportModal.show();
  }

  function renderReport() {
    const report = currentReport;
    const data = currentReportData;

    // Update header
    document.getElementById("reportTitle").textContent = report.title;
    document.getElementById("reportTimestamp").textContent = data.timestamp;
    document.getElementById("reportRecordCount").textContent = data.recordCount;
    
    const dateRangeText = filters.dateFrom && filters.dateTo
      ? `${filters.dateFrom} to ${filters.dateTo}`
      : filters.dateFrom
      ? `from ${filters.dateFrom}`
      : filters.dateTo
      ? `until ${filters.dateTo}`
      : "all data";
    document.getElementById("reportDateRange").textContent = dateRangeText;

    // Clear containers
    document.getElementById("reportChartContainer").innerHTML = "";
    document.getElementById("reportTableContainer").innerHTML = "";
    document.getElementById("reportPaginationContainer").innerHTML = "";

    // Render chart if applicable
    if (report.hasChart && report.renderChart) {
      const chartSvg = report.renderChart(data);
      if (chartSvg) {
        document.getElementById("reportChartContainer").innerHTML = `
          <div class="card">
            <div class="card-body">
              ${chartSvg}
            </div>
          </div>
        `;
      }
    }

    // Render table
    const tableHtml = report.renderTable(data, currentReportPage);
    document.getElementById("reportTableContainer").innerHTML = `
      <div class="card">
        <div class="card-body">
          ${tableHtml}
        </div>
      </div>
    `;

    // Pagination (if applicable)
    if (report.hasPagination && data.data && data.data.length > report.defaultPageSize) {
      const totalPages = Math.ceil(data.data.length / report.defaultPageSize);
      let paginationHtml = `<ul class="pagination justify-content-center">`;

      for (let page = 1; page <= totalPages; page++) {
        const active = page === currentReportPage ? "active" : "";
        paginationHtml += `
          <li class="page-item ${active}">
            <button class="page-link" onclick="Viewer.goToReportPage(${page})">${page}</button>
          </li>
        `;
      }

      paginationHtml += `</ul>`;
      document.getElementById("reportPaginationContainer").innerHTML = paginationHtml;
    }
  }

  function goToReportPage(page) {
    currentReportPage = page;
    renderReport();
  }

  function exportReportToExcel() {
    if (!currentReport || !currentReportData) {
      alert("No report loaded.");
      return;
    }

    const exportFn = currentReport.exportToExcel;
    if (exportFn) {
      exportFn(currentReportData, config.schoolId, currentReport);
    } else {
      // Fallback: create basic Excel export
      ViewerExport.exportReportToExcel(currentReportData, config.schoolId, currentReport);
    }
  }

  function printReport() {
    if (!currentReport || !currentReportData) {
      alert("No report loaded.");
      return;
    }

    const reportHtml = currentReport.renderTable(currentReportData, 1);
    const chartHtml = currentReport.hasChart && currentReport.renderChart
      ? currentReport.renderChart(currentReportData)
      : "";

    let html = `<html><head><title>${currentReport.title}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 1cm; }
        h1 { margin-bottom: 0.5cm; }
        .timestamp { color: #666; font-size: 0.85em; margin-bottom: 1cm; }
        table { border-collapse: collapse; width: 100%; margin-top: 1cm; }
        th, td { border: 1px solid #333; padding: 0.5cm; text-align: left; font-size: 0.9em; }
        th { background: #f4f4f4; font-weight: bold; }
        tr:nth-child(even) { background: #f9f9f9; }
        .chart { margin: 1cm 0; }
        @media print {
          body { margin: 0; }
          .no-print { display: none; }
        }
      </style>
    </head><body>
      <h1>${currentReport.title}</h1>
      <div class="timestamp">Generated: ${new Date().toLocaleString()} | Records: ${currentReportData.recordCount}</div>
      ${chartHtml ? `<div class="chart">${chartHtml}</div>` : ""}
      <div>${reportHtml}</div>
    </body></html>`;

    const win = window.open("", "_blank", "width=1200,height=800");
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  // ── Filter persistence ────────────────────────────────────
  function saveFilters() {
    localStorage.setItem(STORAGE_FILTER_KEY, JSON.stringify(filters));
  }

  function loadFilters() {
    const stored = localStorage.getItem(STORAGE_FILTER_KEY);
    if (stored) {
      filters = JSON.parse(stored);
      document.getElementById("filterAbsentTeacher").value = filters.absentTeacher || "";
      document.getElementById("filterCoverTeacher").value = filters.coverTeacher || "";
      if (filters.dateFrom) document.getElementById("filterDateFrom").value = filters.dateFrom;
      if (filters.dateTo) document.getElementById("filterDateTo").value = filters.dateTo;
    }
  }

  // ── Data caching ───────────────────────────────────────────
  function cacheData(data) {
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(data));
  }

  // ── Settings ───────────────────────────────────────────────
  function populateSettings() {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || "";
    };
    set("settingSchoolId", config.schoolId);
    set("settingApiKey", config.apiKey);
    set("settingProjectId", config.projectId);
    set("settingAuthDomain", config.authDomain);
    set("settingStorageBucket", config.storageBucket);
    set("settingMessagingSenderId", config.messagingSenderId);
    set("settingAppId", config.appId);
  }

  function saveSettings() {
    const updatedConfig = {
      schoolId: document.getElementById("settingSchoolId").value,
      apiKey: document.getElementById("settingApiKey").value,
      projectId: document.getElementById("settingProjectId").value,
      authDomain: document.getElementById("settingAuthDomain").value,
      storageBucket: document.getElementById("settingStorageBucket").value,
      messagingSenderId: document.getElementById("settingMessagingSenderId").value,
      appId: document.getElementById("settingAppId").value,
    };
    ViewerConfig.save(updatedConfig);
    config = updatedConfig;
    alert("✅ Settings saved. Please refresh and reconfigure if Firebase credentials changed.");
  }

  async function testConnection() {
    const btn = document.getElementById("testConnectionBtn");
    try {
      btn.disabled = true;
      btn.textContent = "⏳ Testing...";

      const schoolId = document.getElementById("settingSchoolId").value;
      const projectId = document.getElementById("settingProjectId").value;
      if (!schoolId || !projectId) {
        alert("⚠️ School ID and Project ID required.");
        return;
      }

      // Simple validation (doesn't actually connect, just checks config)
      if (schoolId && projectId) {
        alert("✅ Configuration looks valid. Save and refresh to apply.");
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "🔗 Test Connection";
    }
  }

  // ── UI helpers ────────────────────────────────────────────
  function showLoading(msg) {
    const tbody = document.getElementById("dataTable");
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">${msg}</td></tr>`;
  }

  function showError(msg) {
    alert(`Error: ${msg}`);
    const tbody = document.getElementById("dataTable");
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger py-4">❌ ${msg}</td></tr>`;
  }

  // ── Public API ───────────────────────────────────────────
  return {
    init,
    filterData,
    refreshData: fetchData,
    populateSettings,
    goToReportPage,
  };
})();

// ── Init on page load ──────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await Viewer.init();

  // Populate settings when modal opens
  document.getElementById("settingsModal").addEventListener("show.bs.modal", () => {
    Viewer.populateSettings();
  });
});
