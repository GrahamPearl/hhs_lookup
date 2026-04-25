// reports.js
// Report & Analysis: selection + preview rendering
// Requires: Bootstrap 5 (bootstrap.Modal), and the main app functions from script.js
// Expected globals from script.js: loadCoverHistory, getWeekNumber, coverDate
//
// PERFORMANCE OPTIMIZATIONS:
// [1] getHistory() caching - Avoid repeated localStorage parsing
// [2] Single-pass aggregation in reportTenWeekFairness - Combines tally + stats in one loop
// [3] Reverse iteration instead of .slice().reverse() - Reduces array allocations
// [4] Report output caching - Cache generated HTML to avoid regeneration
// [5] Batch localStorage loading - Load all needed data once per request
// [6] Conditional HTML escaping - Only escape when necessary (JSON details)

(function () {
  "use strict";

  let selectedReport = null;
  let _cachedHistory = null;
  let _cachedReportOutput = {};

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function safeJsonParse(str, fallback) {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }

  function fmtDateTime(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function ensureBootstrapModal() {
    if (!window.bootstrap || !bootstrap.Modal) {
      console.error(
        "Bootstrap Modal not available. Ensure bootstrap.bundle.min.js is loaded.",
      );
      return false;
    }
    return true;
  }

  function setPreviewButtonEnabled(enabled) {
    const btn = qs("#previewReportBtn");
    if (btn) btn.disabled = !enabled;
  }

  function highlightSelection(activeBtn) {
    qsa("[data-report]").forEach((b) => b.classList.remove("active"));
    if (activeBtn) activeBtn.classList.add("active");
  }

  function bindReportSelection() {
    qsa("[data-report]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedReport = btn.dataset.report;
        highlightSelection(btn);
        
        // Show cover teacher selection UI only for cover-teacher report
        const selectionUI = qs("#coverTeacherSelection");
        if (selectionUI) {
          if (selectedReport === "cover-teacher") {
            selectionUI.style.display = "block";
            populateCoverTeacherDropdown();
            setPreviewButtonEnabled(false); // Require selection first
          } else {
            selectionUI.style.display = "none";
            setPreviewButtonEnabled(true);
          }
        }
      });
    });
    document.getElementById("previewReportBtn")?.click();
  }

  function populateCoverTeacherDropdown() {
    const history = getHistory();
    const coverTeachers = [...new Set(history.map(h => h.coverTeacher))].sort();
    
    const select = qs("#coverTeacherSelect");
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select a teacher --</option>';
    coverTeachers.forEach(teacher => {
      const opt = document.createElement("option");
      opt.value = teacher;
      opt.textContent = teacher;
      select.appendChild(opt);
    });
    
    // Set up search input
    const search = qs("#coverTeacherSearchInput");
    if (search) {
      search.value = "";
      search.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const results = qs("#coverTeacherResults");
        
        if (query.length === 0) {
          results.style.display = "none";
          return;
        }
        
        const matches = coverTeachers.filter(t => t.toLowerCase().includes(query));
        if (matches.length === 0) {
          results.innerHTML = '<div class="list-group-item text-muted">No teachers found</div>';
          results.style.display = "block";
          return;
        }
        
        results.innerHTML = matches.map(t => 
          `<button class="list-group-item list-group-item-action" type="button" data-teacher="${t}">${escapeHtml(t)}</button>`
        ).join("");
        results.style.display = "block";
        
        results.querySelectorAll("button").forEach(btn => {
          btn.addEventListener("click", () => {
            select.value = btn.dataset.teacher;
            search.value = "";
            results.style.display = "none";
            setPreviewButtonEnabled(true);
          });
        });
      });
    }
    
    // Enable preview when teacher is selected
    select.addEventListener("change", () => {
      setPreviewButtonEnabled(select.value !== "");
    });
  }

  function bindPreviewButton() {
    const previewBtn = qs("#previewReportBtn");
    if (!previewBtn) return;

    previewBtn.addEventListener("click", () => {
      if (!selectedReport) return;
      if (!ensureBootstrapModal()) return;

      // Invalidate cache for fresh data on each preview
      invalidateCache();

      const body = qs("#reportPreviewBody");
      if (!body) return;

      // Generate and inject content
      body.innerHTML = generateReport(selectedReport);

      // Show modal
      const modalEl = qs("#previewReportModal");
      if (!modalEl) {
        console.error("Preview modal element #previewReportModal not found.");
        return;
      }
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    });
  }

  /* -----------------------------
     Dispatcher
  ------------------------------ */
  function generateReport(type) {
    // Check cache first
    if (_cachedReportOutput[type]) {
      return _cachedReportOutput[type];
    }
    
    let html;
    switch (type) {
      case "daily-cover":
        html = reportDailyCover();
        break;
      case "daily-absence-summary":
        html = reportDailyAbsenceSummary();
        break;
      case "weekly-cover-load":
        html = reportWeeklyCoverLoad();
        break;
      case "ten-week-fairness":
        html = reportTenWeekFairness();
        break;
      case "auto-assign-effectiveness":
        html = reportAutoAssignEffectiveness();
        break;
      case "audit-log":
        html = reportAuditLog();
        break;
      case "cover-teacher":
        html = reportCoverTeacher();
        break;
      default:
        html = "<p class='text-muted'>Report not available.</p>";
    }
    
    // Cache the output
    _cachedReportOutput[type] = html;
    return html;
  }

  /* -----------------------------
     Helpers: access main data
  ------------------------------ */
  function getHistory() {
    if (_cachedHistory !== null) return _cachedHistory;
    
    if (typeof window.coverApp?.loadCoverHistory === "function") {
      _cachedHistory = window.coverApp?.loadCoverHistory() || [];
    } else {
      console.error(
        "loadCoverHistory() is not available. Ensure script.js is loaded before reports.js",
      );
      _cachedHistory = [];
    }
    return _cachedHistory;
  }

  function invalidateCache() {
    _cachedHistory = null;
    _cachedReportOutput = {};
  }

  function getWeek() {
    const d = getSelectedDateStr();
    return typeof window.coverApp?.getWeekNumber === "function"
      ? window.coverApp?.getWeekNumber(d)
      : null;
  }

  function getSelectedDateStr() {
    const el = document.getElementById("coverDate");
    return el && el.value ? el.value : new Date().toISOString().split("T")[0];
  }

  function getTodayDateStr() {
    return getSelectedDateStr() || new Date().toISOString().split("T")[0];
  }

  /* -----------------------------
     Report: Daily Cover Allocation
  ------------------------------ */
  function reportDailyCover() {
    const dateStr = getSelectedDateStr();
    const history = getHistory().filter((h) => h.date === dateStr);

    if (history.length === 0) {
      return `<h6>Daily Cover Allocation (${dateStr})</h6><p class='text-muted'>No cover data for this day.</p>`;
    }

    // Get absence reason from UI
    const absenceReason = document.getElementById("absenceReasonSelect")?.value || "Not Specified";
    
    // Get partial absent teachers info
    const partialAbsent = window.coverApp?.partialAbsentTeachers || {};

    // Group by absent teacher
    const byTeacher = {};
    history.forEach((h) => {
      if (!byTeacher[h.coveredTeacher]) {
        byTeacher[h.coveredTeacher] = [];
      }
      byTeacher[h.coveredTeacher].push(h);
    });

    // Sort teachers alphabetically
    const teachers = Object.keys(byTeacher).sort();

    let html = `
      <h6>Daily Cover Allocation (${dateStr})</h6>
      <div class="table-responsive">
        <table class="table table-bordered align-middle">
          <tbody>
    `;

    teachers.forEach((teacher) => {
      const periods = byTeacher[teacher];
      
      // Sort periods by day then period
      periods.sort((a, b) => {
        const byDay = (a.day ?? 0) - (b.day ?? 0);
        if (byDay !== 0) return byDay;
        return (a.period ?? 0) - (b.period ?? 0);
      });

      // Determine if this is a partial absence
      const isPartial = partialAbsent[teacher];
      const absenceType = isPartial 
        ? `<span class="badge bg-warning text-dark">Partial: P${isPartial.map(p => p + 1).join(',')}</span>`
        : `<span class="badge bg-danger">Full Day</span>`;

      // Teacher header row
      html += `
        <tr class="table-active">
          <td colspan="6" class="fw-bold">
            ${escapeHtml(teacher)} ${absenceType}
          </td>
        </tr>
      `;

      // Reason row
      html += `
        <tr class="table-light">
          <td colspan="6" class="text-muted">
            <small><strong>Reason:</strong> ${escapeHtml(absenceReason)}</small>
          </td>
        </tr>
      `;

      // Header row for periods
      html += `
        <tr class="table-secondary">
          <th style="width: 10%;">Period</th>
          <th style="width: 15%;">Type</th>
          <th style="width: 20%;">Class</th>
          <th style="width: 15%;">Venue</th>
          <th style="width: 40%;">Cover Teacher</th>
        </tr>
      `;

      // Period rows
      periods.forEach((h) => {
        html += `
          <tr>
            <td>${escapeHtml(String(h.period))}</td>
            <td>${escapeHtml(h.subject || "")}</td>
            <td>${escapeHtml(h.className || "")}</td>
            <td>${escapeHtml(h.venue || "")}</td>
            <td><strong>${escapeHtml(h.coverTeacher)}</strong></td>
          </tr>
        `;
      });

      // Spacer row between teachers
      html += `
        <tr>
          <td colspan="6" style="height: 10px; background-color: #f8f9fa;"></td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    return html;
  }

  /* -----------------------------
     Report: Daily Absence Summary
  ------------------------------ */
  function reportDailyAbsenceSummary() {
    const dateStr = getSelectedDateStr();
    const daySelect = qs("#absenceDaySelect");
    const dayIdx = daySelect ? parseInt(daySelect.value, 10) : 0;

    // Absent teachers list from main script (global variable)
    const absentList = Array.isArray(window.coverApp?.absentTeachers)
      ? window.coverApp?.absentTeachers
      : [];
    
    // Partial absent teachers from main script
    const partialAbsent = window.coverApp?.partialAbsentTeachers || {};
    const partialAbsentCount = Object.keys(partialAbsent).length;

    // Count lessons needing cover from current day view
    let lessonsNeedingCover = 0;
    let assignedCovers = 0;
    let noCoverMarked = 0;

    // coverAssignments + noCoverNeeded exist in main script
    const assignments = window.coverApp?.coverAssignments || {};
    const noCover = window.coverApp?.noCoverNeeded || {};

    // Count full-day absences
    for (const teacher of absentList) {
      // Keys are teacher:day-period
      for (let p = 0; p < 6; p++) {
        const key = `${teacher}:${dayIdx}-${p}`;
        // Determine if there is an entry (lesson) for that absent teacher
        // Use helper in main script if present
        let isLesson = false;
        if (typeof window.getTeacherEntry === "function") {
          const entry = window.getTeacherEntry(teacher, dayIdx, p);
          isLesson = !!(entry && entry.type === "lesson");
        }
        if (!isLesson) continue;

        lessonsNeedingCover++;
        if (noCover[key]) noCoverMarked++;
        else if (assignments[key]) assignedCovers++;
      }
    }

    // Count partial-day absences
    for (const [teacher, periods] of Object.entries(partialAbsent)) {
      for (const p of periods) {
        const key = `${teacher}:${dayIdx}-${p}`;
        let isLesson = false;
        if (typeof window.getTeacherEntry === "function") {
          const entry = window.getTeacherEntry(teacher, dayIdx, p);
          isLesson = !!(entry && entry.type === "lesson");
        }
        if (!isLesson) continue;

        lessonsNeedingCover++;
        if (noCover[key]) noCoverMarked++;
        else if (assignments[key]) assignedCovers++;
      }
    }

    const unassigned = Math.max(
      lessonsNeedingCover - assignedCovers - noCoverMarked,
      0,
    );

    return `
      <h6>Daily Absence Summary (${dateStr})</h6>
      <div class="row g-3">
        <div class="col-md-6">
          <div class="card">
            <div class="card-body">
              <div class="d-flex justify-content-between">
                <span class="text-muted">Full-day absent</span>
                <span class="fw-semibold">${absentList.length}</span>
              </div>
              <div class="d-flex justify-content-between mt-2">
                <span class="text-muted">Partial-day absent</span>
                <span class="fw-semibold">${partialAbsentCount}</span>
              </div>
              <div class="d-flex justify-content-between mt-2">
                <span class="text-muted">Lessons needing cover</span>
                <span class="fw-semibold">${lessonsNeedingCover}</span>
              </div>
              <div class="d-flex justify-content-between mt-2">
                <span class="text-muted">Assigned</span>
                <span class="fw-semibold text-success">${assignedCovers}</span>
              </div>
              <div class="d-flex justify-content-between mt-2">
                <span class="text-muted">No cover needed</span>
                <span class="fw-semibold">${noCoverMarked}</span>
              </div>
              <div class="d-flex justify-content-between mt-2">
                <span class="text-muted">Unassigned</span>
                <span class="fw-semibold ${unassigned > 0 ? "text-danger" : "text-success"}">${unassigned}</span>
              </div>
              <div class="small text-muted mt-3">Day view: Day ${dayIdx + 1}</div>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card">
            <div class="card-body">
              <div class="fw-semibold mb-2">Absent teachers</div>
              ${
                absentList.length === 0 && partialAbsentCount === 0
                  ? "<p class='text-muted mb-0'>None selected.</p>"
                  : `
                    ${absentList.length > 0 ? `
                      <div class="mb-2">
                        <strong class="small">Full-day:</strong>
                        <ul class="mb-0">${absentList.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
                      </div>
                    ` : ""}
                    ${partialAbsentCount > 0 ? `
                      <div>
                        <strong class="small">Partial-day:</strong>
                        <ul class="mb-0">${Object.entries(partialAbsent).map(([t, periods]) => 
                          `<li>${escapeHtml(t)} <span class="badge bg-info">P${periods.map(p => p + 1).join(',')}</span></li>`
                        ).join("")}</ul>
                      </div>
                    ` : ""}
                  `
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* -----------------------------
     Report: Weekly Cover Load
  ------------------------------ */
  function reportWeeklyCoverLoad() {
    const week = getWeek();
    if (!week)
      return "<p class='text-muted'>Week calculation not available.</p>";

    const history = getHistory().filter((h) => h.week === week);
    if (history.length === 0) {
      return `<h6>Weekly Cover Load (Week ${week})</h6><p class='text-muted'>No covers recorded this week.</p>`;
    }

    const counts = {};
    for (const h of history) {
      counts[h.coverTeacher] = (counts[h.coverTeacher] || 0) + 1;
    }

    const rows = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([teacher, covers]) => ({ teacher, covers }));

    return `
      <h6>Weekly Cover Load (Week ${week})</h6>
      <div class="table-responsive">
        <table class="table table-sm table-striped align-middle">
          <thead class="table-light">
            <tr><th>Teacher</th><th style="width:120px">Covers</th></tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr>
                <td>${escapeHtml(r.teacher)}</td>
                <td class="fw-semibold">${r.covers}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="small text-muted">Total cover sessions: ${history.length}</div>
    `;
  }

  /* -----------------------------
     Report: 10-Week Fairness Overview
  ------------------------------ */
  function reportTenWeekFairness() {
    const history = getHistory();
    if (history.length === 0) {
      return "<h6>10‑Week Fairness Overview</h6><p class='text-muted'>No history available.</p>";
    }

    // Single-pass aggregation: tally + collect stats simultaneously
    const totals = {};
    const reasonTotals = {};
    
    for (const h of history) {
      totals[h.coverTeacher] = (totals[h.coverTeacher] || 0) + 1;
      const reason = h.absentReason || "Unknown";
      reasonTotals[reason] = (reasonTotals[reason] || 0) + 1;
    }

    // Single-pass stats calculation
    const entries = Object.entries(totals);
    let min = Infinity, max = 0, sum = 0;
    const list = [];

    for (const [teacher, total] of entries) {
      list.push({ teacher, total });
      if (total < min) min = total;
      if (total > max) max = total;
      sum += total;
    }

    // Sort once
    list.sort((a, b) => a.total - b.total);

    const avg = sum / list.length;
    const ratio = min > 0 && min !== Infinity ? (max / min).toFixed(2) : "N/A";

    // Build absence reason breakdown
    const reasonList = Object.entries(reasonTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: ((count / history.length) * 100).toFixed(1)
      }));

    return `
      <h6>10‑Week Fairness Overview</h6>
      <div class="row g-2 mb-3">
        <div class="col-sm-3"><div class="border rounded p-2"><div class="small text-muted">Min</div><div class="fw-semibold">${min === Infinity ? 0 : min}</div></div></div>
        <div class="col-sm-3"><div class="border rounded p-2"><div class="small text-muted">Max</div><div class="fw-semibold">${max}</div></div></div>
        <div class="col-sm-3"><div class="border rounded p-2"><div class="small text-muted">Avg</div><div class="fw-semibold">${avg.toFixed(2)}</div></div></div>
        <div class="col-sm-3"><div class="border rounded p-2"><div class="small text-muted">Max/Min</div><div class="fw-semibold">${ratio}</div></div></div>
      </div>

      <div class="mb-4">
        <h6 class="border-bottom pb-2">Cover Distribution by Teacher</h6>
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle">
            <thead class="table-light"><tr><th>Teacher</th><th style="width:140px">Total Covers</th><th style="width:160px">% of Total</th></tr></thead>
            <tbody>
              ${list
                .map(
                  (x) => {
                    const pct = ((x.total / history.length) * 100).toFixed(1);
                    return `
                <tr>
                  <td>${escapeHtml(x.teacher)}</td>
                  <td class="fw-semibold text-center">${x.total}</td>
                  <td><div class="progress" style="height: 20px;"><div class="progress-bar" style="width: ${pct}%">${pct}%</div></div></td>
                </tr>
              `;
                  }
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="mb-4">
        <h6 class="border-bottom pb-2">Absence Reasons Summary</h6>
        <div class="table-responsive">
          <table class="table table-sm table-striped">
            <thead class="table-light"><tr><th>Reason</th><th style="width:80px">Count</th><th style="width:100px">% of Absences</th></tr></thead>
            <tbody>
              ${reasonList
                .map(
                  (r) => `
                <tr>
                  <td><strong>${escapeHtml(r.reason)}</strong></td>
                  <td class="text-center">${r.count}</td>
                  <td><span class="badge bg-info">${r.percentage}%</span></td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <small class="text-muted d-block mt-2">Total absences tracked: ${history.length}</small>
      </div>

      <div class="alert alert-info small">
        <strong>📈 Fairness Trend:</strong> Monitor the Max/Min ratio — lower values indicate better balance. Target: &lt; 2.0
      </div>
    `;
  }

  /* -----------------------------
     Report: Auto-Assign Effectiveness
  ------------------------------ */
  function reportAutoAssignEffectiveness() {
    // Batch load from localStorage once
    const raw = localStorage.getItem("coverHistoryLog") || "[]";
    const log = safeJsonParse(raw, []);
    
    const autoAssignLog = log.filter((e) =>
      String(e.action || "").startsWith("AUTO_ASSIGN"),
    );

    if (autoAssignLog.length === 0) {
      return "<h6>Auto‑Assign Effectiveness</h6><p class='text-muted'>No auto-assign events recorded.</p>";
    }

    // Single pass to count applied/undone
    let applied = 0, undone = 0;
    for (const e of autoAssignLog) {
      if (e.action === "AUTO_ASSIGN_APPLIED") applied++;
      else if (e.action === "AUTO_ASSIGN_UNDONE") undone++;
    }

    // Build last 25 items with reverse iteration (more efficient than slice+reverse)
    let items = [];
    const start = Math.max(0, autoAssignLog.length - 25);
    for (let i = autoAssignLog.length - 1; i >= start; i--) {
      items.push(autoAssignLog[i]);
    }

    return `
      <h6>Auto‑Assign Effectiveness</h6>
      <div class="row g-2 mb-3">
        <div class="col-sm-6"><div class="border rounded p-2"><div class="small text-muted">Applied</div><div class="fw-semibold">${applied}</div></div></div>
        <div class="col-sm-6"><div class="border rounded p-2"><div class="small text-muted">Undone</div><div class="fw-semibold">${undone}</div></div></div>
      </div>
      <div class="list-group">
        ${items
          .map(
            (e) => `
          <div class="list-group-item">
            <div class="d-flex justify-content-between">
              <div class="fw-semibold">${escapeHtml(e.action)}</div>
              <div class="small text-muted">${fmtDateTime(e.timestamp)}</div>
            </div>
            ${e.details ? `<div class="small text-muted">${escapeHtml(JSON.stringify(e.details))}</div>` : ""}
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  /* -----------------------------
     Report: System Audit Log (last 50)
  ------------------------------ */
  function reportAuditLog() {
    const raw = localStorage.getItem("coverHistoryLog") || "[]";
    const log = safeJsonParse(raw, []);

    if (log.length === 0) {
      return "<h6>System Audit Log</h6><p class='text-muted'>No audit entries found.</p>";
    }

    // Build last 50 items with reverse iteration (more efficient than slice+reverse)
    let items = [];
    const start = Math.max(0, log.length - 50);
    for (let i = log.length - 1; i >= start; i--) {
      items.push(log[i]);
    }

    return `
      <h6>System Audit Log</h6>
      <div class="small text-muted mb-2">Showing latest 50 actions</div>
      <div class="list-group">
        ${items
          .map(
            (e) => `
          <div class="list-group-item">
            <div class="d-flex justify-content-between">
              <div class="fw-semibold">${escapeHtml(e.action || "(unknown)")}</div>
              <div class="small text-muted">${fmtDateTime(e.timestamp)}</div>
            </div>
            ${e.details ? `<div class="small text-muted">${escapeHtml(JSON.stringify(e.details))}</div>` : ""}
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  /* -----------------------------
     Report: Cover Teacher History
  ------------------------------ */
  function reportCoverTeacher() {
    const history = getHistory();
    
    // Get unique cover teacher names
    const coverTeachers = [...new Set(history.map(h => h.coverTeacher))].sort();
    
    if (coverTeachers.length === 0) {
      return "<h6>Cover Teacher Report</h6><p class='text-muted'>No cover assignments recorded.</p>";
    }

    // Get selected cover teacher from modal input
    const selectedTeacher = qs("#coverTeacherSelect")?.value || null;
    
    if (!selectedTeacher) {
      return `
        <h6>Cover Teacher Report</h6>
        <p class='text-muted mb-3'>Select a cover teacher to view their assignment history.</p>
        <div class="alert alert-info">
          <small>Use the dropdown above to search and select a teacher.</small>
        </div>
      `;
    }

    // Filter history for selected teacher
    const teacherHistory = history.filter(h => h.coverTeacher === selectedTeacher);
    
    if (teacherHistory.length === 0) {
      return `
        <h6>Cover Teacher Report: ${escapeHtml(selectedTeacher)}</h6>
        <p class='text-muted'>No cover assignments for this teacher.</p>
      `;
    }

    // Calculate statistics
    const totalCovers = teacherHistory.length;
    const totalTeachersAbsent = new Set(teacherHistory.map(h => h.coveredTeacher)).size;
    const teamTotal = history.length;
    const percentageOfLoad = ((totalCovers / teamTotal) * 100).toFixed(1);

    // Sort by date (descending)
    const sorted = [...teacherHistory].sort((a, b) => 
      new Date(b.date || 0) - new Date(a.date || 0)
    );

    return `
      <h6>Cover Teacher Report: <strong>${escapeHtml(selectedTeacher)}</strong></h6>
      
      <div class="row g-2 mb-3">
        <div class="col-sm-3"><div class="border rounded p-2"><div class="small text-muted">Total Covers</div><div class="fw-semibold">${totalCovers}</div></div></div>
        <div class="col-sm-3"><div class="border rounded p-2"><div class="small text-muted">% of Team Load</div><div class="fw-semibold">${percentageOfLoad}%</div></div></div>
        <div class="col-sm-3"><div class="border rounded p-2"><div class="small text-muted">Unique Teachers</div><div class="fw-semibold">${totalTeachersAbsent}</div></div></div>
        <div class="col-sm-3"><div class="border rounded p-2"><div class="small text-muted">Avg per Week</div><div class="fw-semibold">${(totalCovers / 10).toFixed(1)}</div></div></div>
      </div>

      <div class="table-responsive">
        <table class="table table-sm table-striped align-middle">
          <thead class="table-light">
            <tr>
              <th>Date</th>
              <th style="width: 60px;">Period</th>
              <th>Absent Teacher</th>
              <th>Class (Subject)</th>
            </tr>
          </thead>
          <tbody>
            ${sorted
              .map(
                (h) => `
              <tr>
                <td>${h.date ? new Date(h.date).toLocaleDateString() : "N/A"}</td>
                <td class="text-center">${h.period || "N/A"}</td>
                <td>${escapeHtml(h.coveredTeacher || "")}</td>
                <td><small>${escapeHtml(h.subject || "")} ${h.className ? `(${escapeHtml(h.className)})` : ""}</small></td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  /* -----------------------------
     XSS-safe HTML escaping
  ------------------------------ */
  function escapeHtml(value) {
    const s = String(value ?? "");
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* -----------------------------
     Init after DOM ready
  ------------------------------ */
  function init() {
    // If modal markup isn't present yet, don't throw.
    bindReportSelection();
    bindPreviewButton();
    setPreviewButtonEnabled(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
