// reports.js — Complete file
// All reports wired: original 7 + 8 new insight reports
// Per-teacher absence reasons (absentTeacherReasons via window.coverApp)
// Depends on: Bootstrap 5, script.js (window.coverApp)

(function () {
  "use strict";

  let selectedReport      = null;
  let _cachedHistory      = null;
  let _cachedReportOutput = {};

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function fmtDateTime(iso) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  function ensureBootstrapModal() {
    if (!window.bootstrap || !bootstrap.Modal) {
      console.error("Bootstrap Modal not available.");
      return false;
    }
    return true;
  }

  function setPreviewButtonEnabled(enabled) {
    const btn = qs("#previewReportBtn");
    if (btn) btn.disabled = !enabled;
  }

  function highlightSelection(activeBtn) {
    qsa("[data-report]").forEach(b => b.classList.remove("active"));
    if (activeBtn) activeBtn.classList.add("active");
  }

  // ── Report selection binding ───────────────────────────────────
  function bindReportSelection() {
    qsa("[data-report]").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedReport = btn.dataset.report;
        highlightSelection(btn);
        const selectionUI = qs("#coverTeacherSelection");
        if (selectionUI) {
          if (selectedReport === "cover-teacher") {
            selectionUI.style.display = "block";
            populateCoverTeacherDropdown();
            setPreviewButtonEnabled(false);
          } else {
            selectionUI.style.display = "none";
            setPreviewButtonEnabled(true);
          }
        }
      });
    });
  }

  function populateCoverTeacherDropdown() {
    const history      = getHistory();
    const coverTeachers = [...new Set(history.map(h => h.coverTeacher))].sort();
    const select       = qs("#coverTeacherSelect");
    if (!select) return;
    select.innerHTML = '<option value="">-- Select a teacher --</option>';
    coverTeachers.forEach(teacher => {
      const opt = document.createElement("option");
      opt.value = teacher; opt.textContent = teacher;
      select.appendChild(opt);
    });

    const search = qs("#coverTeacherSearchInput");
    if (search) {
      search.value = "";
      search.addEventListener("input", e => {
        const query   = e.target.value.toLowerCase();
        const results = qs("#coverTeacherResults");
        if (query.length === 0) { results.style.display = "none"; return; }
        const matches = coverTeachers.filter(t => t.toLowerCase().includes(query));
        if (!matches.length) {
          results.innerHTML = '<div class="list-group-item text-muted">No teachers found</div>';
          results.style.display = "block"; return;
        }
        results.innerHTML = matches.map(t =>
          `<button class="list-group-item list-group-item-action" type="button" data-teacher="${t}">${escapeHtml(t)}</button>`
        ).join("");
        results.style.display = "block";
        results.querySelectorAll("button").forEach(btn => {
          btn.addEventListener("click", () => {
            select.value = btn.dataset.teacher;
            search.value = ""; results.style.display = "none";
            setPreviewButtonEnabled(true);
          });
        });
      });
    }
    select.addEventListener("change", () => setPreviewButtonEnabled(select.value !== ""));
  }

  // ── Preview button binding ─────────────────────────────────────
  function bindPreviewButton() {
    const previewBtn = qs("#previewReportBtn");
    if (!previewBtn) return;
    previewBtn.addEventListener("click", () => {
      if (!selectedReport) return;
      if (!ensureBootstrapModal()) return;
      invalidateCache();
      const body = qs("#reportPreviewBody");
      if (!body) return;
      body.innerHTML = generateReport(selectedReport);
      const modalEl = qs("#previewReportModal");
      if (!modalEl) { console.error("#previewReportModal not found."); return; }
      new bootstrap.Modal(modalEl).show();
    });
  }

  // ── Dispatcher ─────────────────────────────────────────────────
  function generateReport(type) {
    if (_cachedReportOutput[type]) return _cachedReportOutput[type];
    let html;
    switch (type) {
      case "daily-cover":             html = reportDailyCover();            break;
      case "daily-absence-summary":   html = reportDailyAbsenceSummary();   break;
      case "weekly-cover-load":       html = reportWeeklyCoverLoad();        break;
      case "ten-week-fairness":       html = reportTenWeekFairness();        break;
      case "auto-assign-effectiveness": html = reportAutoAssignEffectiveness(); break;
      case "audit-log":               html = reportAuditLog();               break;
      case "cover-teacher":           html = reportCoverTeacher();           break;
      case "day-of-week":             html = reportDayOfWeek();              break;
      case "consecutive-absence":     html = reportConsecutiveAbsence();     break;
      case "uncovered-lessons":       html = reportUncoveredLessons();       break;
      case "cover-refusal":           html = reportCoverRefusal();           break;
      case "subject-coverage":        html = reportSubjectCoverage();        break;
      case "absence-frequency":       html = reportAbsenceFrequency();       break;
      case "period-utilisation":      html = reportPeriodUtilisation();      break;
      case "availability-trend":      html = reportAvailabilityTrend();      break;
      default: html = "<p class='text-muted'>Report not available.</p>";
    }
    _cachedReportOutput[type] = html;
    return html;
  }

  // ── Data accessors ─────────────────────────────────────────────
  function getHistory() {
    if (_cachedHistory !== null) return _cachedHistory;
    if (typeof window.coverApp?.loadCoverHistory === "function") {
      _cachedHistory = window.coverApp.loadCoverHistory() || [];
    } else {
      console.error("loadCoverHistory() not available.");
      _cachedHistory = [];
    }
    return _cachedHistory;
  }

  function invalidateCache() {
    _cachedHistory      = null;
    _cachedReportOutput = {};
  }

  function getWeek() {
    const d = getSelectedDateStr();
    return typeof window.coverApp?.getWeekNumber === "function"
      ? window.coverApp.getWeekNumber(d) : null;
  }

  function getSelectedDateStr() {
    const el = document.getElementById("coverDate");
    return el && el.value ? el.value : new Date().toISOString().split("T")[0];
  }

  function getTeacherReasons() {
    return window.coverApp?.absentTeacherReasons || {};
  }

  // ── Report: Daily Cover Allocation ────────────────────────────
  function reportDailyCover() {
    const dateStr = getSelectedDateStr();
    const history = getHistory().filter(h => h.date === dateStr);
    if (!history.length)
      return `<h6>Daily Cover Allocation (${dateStr})</h6><p class='text-muted'>No cover data for this day.</p>`;

    const teacherReasons = getTeacherReasons();
    const partialAbsent  = window.coverApp?.partialAbsentTeachers || {};

    const byTeacher = {};
    history.forEach(h => {
      if (!byTeacher[h.coveredTeacher]) byTeacher[h.coveredTeacher] = [];
      byTeacher[h.coveredTeacher].push(h);
    });

    const teachers = Object.keys(byTeacher).sort();
    let html = `
      <h6>Daily Cover Allocation (${dateStr})</h6>
      <div class="table-responsive">
        <table class="table table-bordered align-middle"><tbody>`;

    teachers.forEach(teacher => {
      const periods = byTeacher[teacher]
        .sort((a,b) => ((a.day??0)-(b.day??0)) || ((a.period??0)-(b.period??0)));

      const isPartial    = partialAbsent[teacher];
      const absenceType  = isPartial
        ? `<span class="badge bg-warning text-dark">Partial: P${isPartial.map(p=>p+1).join(',')}</span>`
        : `<span class="badge bg-danger">Full Day</span>`;

      // Per-teacher reason: live state first, fall back to history field
      const absenceReason = teacherReasons[teacher] || periods[0]?.absentReason || "Not Specified";

      html += `
        <tr class="table-active">
          <td colspan="5" class="fw-bold">${escapeHtml(teacher)} ${absenceType}</td>
        </tr>
        <tr class="table-light">
          <td colspan="5" class="text-muted">
            <small><strong>Reason:</strong> ${escapeHtml(absenceReason)}</small>
          </td>
        </tr>
        <tr class="table-secondary">
          <th style="width:10%">Period</th>
          <th style="width:15%">Type</th>
          <th style="width:20%">Class</th>
          <th style="width:15%">Venue</th>
          <th style="width:40%">Cover Teacher</th>
        </tr>`;

      periods.forEach(h => {
        html += `
          <tr>
            <td>${escapeHtml(String(h.period))}</td>
            <td>${escapeHtml(h.subject||"")}</td>
            <td>${escapeHtml(h.className||"")}</td>
            <td>${escapeHtml(h.venue||"")}</td>
            <td><strong>${escapeHtml(h.coverTeacher)}</strong></td>
          </tr>`;
      });
      html += `<tr><td colspan="5" style="height:10px;background:#f8f9fa"></td></tr>`;
    });

    html += `</tbody></table></div>`;
    return html;
  }

  // ── Report: Daily Absence Summary ─────────────────────────────
  function reportDailyAbsenceSummary() {
    const dateStr    = getSelectedDateStr();
    const daySelect  = qs("#absenceDaySelect");
    const dayIdx     = daySelect ? parseInt(daySelect.value, 10) : 0;

    const absentList     = Array.isArray(window.coverApp?.absentTeachers)
      ? window.coverApp.absentTeachers : [];
    const partialAbsent  = window.coverApp?.partialAbsentTeachers || {};
    const partialCount   = Object.keys(partialAbsent).length;
    const assignments    = window.coverApp?.coverAssignments || {};
    const noCover        = window.coverApp?.noCoverNeeded    || {};

    let lessonsNeedingCover = 0, assignedCovers = 0, noCoverMarked = 0;

    const countForTeacher = (teacher, periods) => {
      (periods || Array.from({length:6},(_,i)=>i)).forEach(p => {
        const key  = `${teacher}:${dayIdx}-${p}`;
        let isLesson = false;
        if (typeof window.getTeacherEntry === "function") {
          const entry = window.getTeacherEntry(teacher, dayIdx, p);
          isLesson = !!(entry && entry.type === "lesson");
        }
        if (!isLesson) return;
        lessonsNeedingCover++;
        if (noCover[key]) noCoverMarked++;
        else if (assignments[key]) assignedCovers++;
      });
    };

    absentList.forEach(t => countForTeacher(t, null));
    Object.entries(partialAbsent).forEach(([t, periods]) => countForTeacher(t, periods));

    const unassigned = Math.max(lessonsNeedingCover - assignedCovers - noCoverMarked, 0);

    return `
      <h6>Daily Absence Summary (${dateStr})</h6>
      <div class="row g-3">
        <div class="col-md-6">
          <div class="card">
            <div class="card-body">
              ${[
                ["Full-day absent",       absentList.length,    ""],
                ["Partial-day absent",    partialCount,         ""],
                ["Lessons needing cover", lessonsNeedingCover,  ""],
                ["Assigned",              assignedCovers,       "text-success"],
                ["No cover needed",       noCoverMarked,        ""],
                ["Unassigned",            unassigned,           unassigned > 0 ? "text-danger" : "text-success"],
              ].map(([label, val, cls]) => `
                <div class="d-flex justify-content-between mt-2">
                  <span class="text-muted">${label}</span>
                  <span class="fw-semibold ${cls}">${val}</span>
                </div>`).join("")}
              <div class="small text-muted mt-3">Day view: Day ${dayIdx+1}</div>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card">
            <div class="card-body">
              <div class="fw-semibold mb-2">Absent teachers</div>
              ${absentList.length === 0 && partialCount === 0
                ? "<p class='text-muted mb-0'>None selected.</p>"
                : `${absentList.length > 0 ? `<div class="mb-2"><strong class="small">Full-day:</strong>
                     <ul class="mb-0">${absentList.map(t=>`<li>${escapeHtml(t)}</li>`).join("")}</ul></div>` : ""}
                   ${partialCount > 0 ? `<div><strong class="small">Partial-day:</strong>
                     <ul class="mb-0">${Object.entries(partialAbsent).map(([t,periods])=>
                       `<li>${escapeHtml(t)} <span class="badge bg-info">P${periods.map(p=>p+1).join(',')}</span></li>`
                     ).join("")}</ul></div>` : ""}` }
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── Report: Weekly Cover Load ──────────────────────────────────
  function reportWeeklyCoverLoad() {
    const week = getWeek();
    if (!week) return "<p class='text-muted'>Week calculation not available.</p>";
    const history = getHistory().filter(h => h.week === week);
    if (!history.length)
      return `<h6>Weekly Cover Load (Week ${week})</h6><p class='text-muted'>No covers recorded this week.</p>`;

    const counts = {};
    for (const h of history) counts[h.coverTeacher] = (counts[h.coverTeacher]||0) + 1;
    const rows = Object.entries(counts).sort((a,b)=>b[1]-a[1]);

    return `
      <h6>Weekly Cover Load (Week ${week})</h6>
      <div class="table-responsive">
        <table class="table table-sm table-striped align-middle">
          <thead class="table-light"><tr><th>Teacher</th><th style="width:120px">Covers</th></tr></thead>
          <tbody>
            ${rows.map(([teacher,covers])=>`
              <tr><td>${escapeHtml(teacher)}</td><td class="fw-semibold">${covers}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="small text-muted">Total cover sessions: ${history.length}</div>`;
  }

  // ── Report: 10-Week Fairness Overview ─────────────────────────
  function reportTenWeekFairness() {
    const history = getHistory();
    if (!history.length)
      return "<h6>10‑Week Fairness Overview</h6><p class='text-muted'>No history available.</p>";

    const totals = {}, reasonTotals = {};
    for (const h of history) {
      totals[h.coverTeacher] = (totals[h.coverTeacher]||0) + 1;
      const r = h.absentReason||"Unknown";
      reasonTotals[r] = (reasonTotals[r]||0) + 1;
    }

    let min = Infinity, max = 0, sum = 0;
    const list = [];
    for (const [teacher, total] of Object.entries(totals)) {
      list.push({ teacher, total });
      if (total < min) min = total;
      if (total > max) max = total;
      sum += total;
    }
    list.sort((a,b) => a.total - b.total);
    const avg   = sum / list.length;
    const ratio = min > 0 && min !== Infinity ? (max/min).toFixed(2) : "N/A";

    const reasonList = Object.entries(reasonTotals).sort((a,b)=>b[1]-a[1])
      .map(([reason,count]) => ({ reason, count, pct: ((count/history.length)*100).toFixed(1) }));

    return `
      <h6>10‑Week Fairness Overview</h6>
      <div class="row g-2 mb-3">
        ${[["Min",min===Infinity?0:min],["Max",max],["Avg",avg.toFixed(2)],["Max/Min",ratio]]
          .map(([l,v])=>`<div class="col-sm-3"><div class="border rounded p-2">
            <div class="small text-muted">${l}</div><div class="fw-semibold">${v}</div></div></div>`).join("")}
      </div>
      <div class="mb-4">
        <h6 class="border-bottom pb-2">Cover Distribution by Teacher</h6>
        <div class="table-responsive">
          <table class="table table-sm table-bordered align-middle">
            <thead class="table-light"><tr><th>Teacher</th><th style="width:140px">Total Covers</th><th style="width:160px">% of Total</th></tr></thead>
            <tbody>
              ${list.map(x => {
                const pct = ((x.total/history.length)*100).toFixed(1);
                return `<tr>
                  <td>${escapeHtml(x.teacher)}</td>
                  <td class="fw-semibold text-center">${x.total}</td>
                  <td><div class="progress" style="height:20px">
                    <div class="progress-bar" style="width:${pct}%">${pct}%</div></div></td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="mb-4">
        <h6 class="border-bottom pb-2">Absence Reasons Summary</h6>
        <div class="table-responsive">
          <table class="table table-sm table-striped">
            <thead class="table-light"><tr><th>Reason</th><th style="width:80px">Count</th><th style="width:100px">%</th></tr></thead>
            <tbody>
              ${reasonList.map(r=>`
                <tr>
                  <td><strong>${escapeHtml(r.reason)}</strong></td>
                  <td class="text-center">${r.count}</td>
                  <td><span class="badge bg-info">${r.pct}%</span></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <small class="text-muted">Total absences tracked: ${history.length}</small>
      </div>
      <div class="alert alert-info small">
        <strong>📈 Fairness Trend:</strong> Monitor the Max/Min ratio — lower values indicate better balance.
        Target: &lt; 2.0
      </div>`;
  }

  // ── Report: Auto-Assign Effectiveness ─────────────────────────
  function reportAutoAssignEffectiveness() {
    const log         = safeJsonParse(localStorage.getItem("coverHistoryLog")||"[]", []);
    const autoAssignLog = log.filter(e => String(e.action||"").startsWith("AUTO_ASSIGN"));
    if (!autoAssignLog.length)
      return "<h6>Auto‑Assign Effectiveness</h6><p class='text-muted'>No auto-assign events recorded.</p>";

    let applied = 0, undone = 0;
    for (const e of autoAssignLog) {
      if (e.action==="AUTO_ASSIGN_APPLIED") applied++;
      else if (e.action==="AUTO_ASSIGN_UNDONE") undone++;
    }

    const items = [];
    const start = Math.max(0, autoAssignLog.length - 25);
    for (let i = autoAssignLog.length - 1; i >= start; i--) items.push(autoAssignLog[i]);

    return `
      <h6>Auto‑Assign Effectiveness</h6>
      <div class="row g-2 mb-3">
        <div class="col-sm-6"><div class="border rounded p-2"><div class="small text-muted">Applied</div><div class="fw-semibold">${applied}</div></div></div>
        <div class="col-sm-6"><div class="border rounded p-2"><div class="small text-muted">Undone</div><div class="fw-semibold">${undone}</div></div></div>
      </div>
      <div class="list-group">
        ${items.map(e=>`
          <div class="list-group-item">
            <div class="d-flex justify-content-between">
              <div class="fw-semibold">${escapeHtml(e.action)}</div>
              <div class="small text-muted">${fmtDateTime(e.timestamp)}</div>
            </div>
            ${e.details?`<div class="small text-muted">${escapeHtml(JSON.stringify(e.details))}</div>`:""}
          </div>`).join("")}
      </div>`;
  }

  // ── Report: System Audit Log ───────────────────────────────────
  function reportAuditLog() {
    const log = safeJsonParse(localStorage.getItem("coverHistoryLog")||"[]", []);
    if (!log.length)
      return "<h6>System Audit Log</h6><p class='text-muted'>No audit entries found.</p>";

    const items = [];
    const start = Math.max(0, log.length - 50);
    for (let i = log.length - 1; i >= start; i--) items.push(log[i]);

    return `
      <h6>System Audit Log</h6>
      <div class="small text-muted mb-2">Showing latest 50 actions</div>
      <div class="list-group">
        ${items.map(e=>`
          <div class="list-group-item">
            <div class="d-flex justify-content-between">
              <div class="fw-semibold">${escapeHtml(e.action||"(unknown)")}</div>
              <div class="small text-muted">${fmtDateTime(e.timestamp)}</div>
            </div>
            ${e.details?`<div class="small text-muted">${escapeHtml(JSON.stringify(e.details))}</div>`:""}
          </div>`).join("")}
      </div>`;
  }

  // ── Report: Cover Teacher History ─────────────────────────────
  function reportCoverTeacher() {
    const history       = getHistory();
    const coverTeachers = [...new Set(history.map(h=>h.coverTeacher))].sort();
    if (!coverTeachers.length)
      return "<h6>Cover Teacher Report</h6><p class='text-muted'>No cover assignments recorded.</p>";

    const selectedTeacher = qs("#coverTeacherSelect")?.value || null;
    if (!selectedTeacher)
      return `<h6>Cover Teacher Report</h6>
        <p class='text-muted mb-3'>Select a cover teacher to view their assignment history.</p>
        <div class="alert alert-info"><small>Use the dropdown above to search and select a teacher.</small></div>`;

    const teacherHistory = history.filter(h=>h.coverTeacher===selectedTeacher);
    if (!teacherHistory.length)
      return `<h6>Cover Teacher Report: ${escapeHtml(selectedTeacher)}</h6>
        <p class='text-muted'>No cover assignments for this teacher.</p>`;

    const total     = teacherHistory.length;
    const uniqueAbs = new Set(teacherHistory.map(h=>h.coveredTeacher)).size;
    const teamTotal = history.length;
    const pctLoad   = ((total/teamTotal)*100).toFixed(1);
    const sorted    = [...teacherHistory].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));

    return `
      <h6>Cover Teacher Report: <strong>${escapeHtml(selectedTeacher)}</strong></h6>
      <div class="row g-2 mb-3">
        ${[["Total Covers",total],["% of Team Load",pctLoad+"%"],["Unique Teachers",uniqueAbs],
           ["Avg per Week",(total/10).toFixed(1)]].map(([l,v])=>`
          <div class="col-sm-3"><div class="border rounded p-2">
            <div class="small text-muted">${l}</div><div class="fw-semibold">${v}</div></div></div>`).join("")}
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-striped align-middle">
          <thead class="table-light">
            <tr><th>Date</th><th style="width:60px">Period</th><th>Absent Teacher</th><th>Reason</th><th>Class (Subject)</th></tr>
          </thead>
          <tbody>
            ${sorted.map(h=>`
              <tr>
                <td>${h.date?new Date(h.date).toLocaleDateString():"N/A"}</td>
                <td class="text-center">${h.period||"N/A"}</td>
                <td>${escapeHtml(h.coveredTeacher||"")}</td>
                <td><small class="text-muted fst-italic">${escapeHtml(h.absentReason||"—")}</small></td>
                <td><small>${escapeHtml(h.subject||"")} ${h.className?`(${escapeHtml(h.className)})`:""}</small></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  // ── Report: Day-of-Week Pattern ────────────────────────────────
  function reportDayOfWeek() {
    const history = getHistory();
    if (!history.length)
      return "<h6>Day-of-Week Pattern</h6><p class='text-muted'>No history available.</p>";

    const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const counts = {1:0,2:0,3:0,4:0,5:0};
    const absences = {1:new Set(),2:new Set(),3:new Set(),4:new Set(),5:new Set()};
    for (const h of history) {
      const d = new Date(h.date+"T00:00:00").getDay();
      if (counts[d] !== undefined) { counts[d]++; absences[d].add(h.coveredTeacher); }
    }
    const rows = [1,2,3,4,5]
      .map(d=>({ day:dayNames[d], covers:counts[d], uniqueAbsent:absences[d].size }))
      .sort((a,b)=>b.covers-a.covers);
    const max = Math.max(...rows.map(r=>r.covers))||1;

    return `
      <h6>Day-of-Week Pattern</h6>
      <p class="text-muted small">Cover load distribution across the school week over the full 10-week period.</p>
      <div class="table-responsive">
        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr><th>Day</th><th style="width:80px">Covers</th><th>Distribution</th><th style="width:140px">Unique Absences</th></tr>
          </thead>
          <tbody>
            ${rows.map(r=>`<tr>
              <td><strong>${escapeHtml(r.day)}</strong></td>
              <td class="text-center">${r.covers}</td>
              <td><div class="progress" style="height:20px">
                <div class="progress-bar" style="width:${((r.covers/max)*100).toFixed(0)}%">${r.covers}</div></div></td>
              <td class="text-center">${r.uniqueAbsent}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="alert alert-info small">
        <strong>💡 Tip:</strong> High counts on a specific day may indicate a recurring meeting, training
        schedule, or structural gap in cover capacity.
      </div>`;
  }

  // ── Report: Consecutive Absence ────────────────────────────────
  function reportConsecutiveAbsence() {
    const history = getHistory();
    if (!history.length)
      return "<h6>Consecutive Absence Report</h6><p class='text-muted'>No history available.</p>";

    const byTeacher = {};
    for (const h of history) {
      if (!byTeacher[h.coveredTeacher]) byTeacher[h.coveredTeacher] = new Set();
      byTeacher[h.coveredTeacher].add(h.date);
    }
    const runs = [];
    for (const [teacher, dateSet] of Object.entries(byTeacher)) {
      const dates = [...dateSet].sort();
      let streak  = [dates[0]];
      for (let i = 1; i < dates.length; i++) {
        const diff = (new Date(dates[i]+"T00:00:00") - new Date(dates[i-1]+"T00:00:00")) / 86400000;
        if (diff <= 4) { streak.push(dates[i]); }
        else { if (streak.length >= 2) runs.push({ teacher, dates:[...streak] }); streak = [dates[i]]; }
      }
      if (streak.length >= 2) runs.push({ teacher, dates:[...streak] });
    }

    if (!runs.length)
      return `<h6>Consecutive Absence Report</h6>
        <p class="text-success fw-semibold">✓ No consecutive absences detected in the current period.</p>`;

    runs.sort((a,b)=>b.dates.length-a.dates.length);
    return `
      <h6>Consecutive Absence Report</h6>
      <p class="text-muted small">
        Teachers absent on consecutive calendar days (weekends/long weekends bridged ≤4 days).
        Sorted by streak length.
      </p>
      <div class="table-responsive">
        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr><th>Teacher</th><th style="width:80px">Days</th><th>From</th><th>To</th></tr>
          </thead>
          <tbody>
            ${runs.map(r=>`<tr>
              <td>${escapeHtml(r.teacher)}</td>
              <td class="text-center">
                <span class="badge ${r.dates.length>=3?"bg-danger":"bg-warning text-dark"}">${r.dates.length}</span>
              </td>
              <td>${escapeHtml(r.dates[0])}</td>
              <td>${escapeHtml(r.dates[r.dates.length-1])}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <small class="text-muted">Streaks of 3+ days (red) — consider extended leave planning.</small>`;
  }

  // ── Report: Uncovered Lessons ──────────────────────────────────
  function reportUncoveredLessons() {
    const noCover = window.coverApp?.noCoverNeeded || {};
    const keys    = Object.keys(noCover);
    if (!keys.length)
      return `<h6>Uncovered Lessons Report</h6>
        <p class="text-success fw-semibold">✓ No lessons marked as uncovered in the current session.</p>`;

    return `
      <h6>Uncovered Lessons Report</h6>
      <p class="text-muted small">Lessons marked "No Cover Needed" in the current session.</p>
      <div class="table-responsive">
        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr><th>Absent Teacher</th><th style="width:80px">Day</th><th style="width:80px">Period</th></tr>
          </thead>
          <tbody>
            ${keys.map(key => {
              const [teacher, dp] = key.split(":");
              const [d, p]        = dp.split("-");
              return `<tr>
                <td>${escapeHtml(teacher)}</td>
                <td class="text-center">${parseInt(d)+1}</td>
                <td class="text-center">${parseInt(p)+1}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="alert alert-warning small">
        <strong>Total:</strong> ${keys.length} lesson(s) marked uncovered this session.
      </div>`;
  }

  // ── Report: Cover Refusal / Conflict ──────────────────────────
  function reportCoverRefusal() {
    const log    = safeJsonParse(localStorage.getItem("coverHistoryLog")||"[]", []);
    const events = log.filter(e=>e.action==="AUTO_ASSIGN_APPLIED")
                      .sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
    if (!events.length)
      return "<h6>Cover Refusal / Conflict Report</h6><p class='text-muted'>No auto-assign events recorded yet.</p>";

    const totalAssigned  = events.reduce((s,e)=>s+(e.details?.assignmentsMade||0),0);
    const totalConflicts = events.reduce((s,e)=>s+(e.details?.conflicts||0),0);
    return `
      <h6>Cover Refusal / Conflict Report</h6>
      <p class="text-muted small">Auto-assign sessions recorded in the audit log.</p>
      <div class="row g-2 mb-3">
        ${[["Sessions",events.length],["Total Assigned",totalAssigned],
           ["Unassigned (Conflicts)",totalConflicts],
           ["Avg / Session",(totalAssigned/events.length).toFixed(1)]]
          .map(([l,v])=>`<div class="col-sm-3"><div class="border rounded p-2 text-center">
            <div class="small text-muted">${l}</div>
            <div class="fw-semibold ${l.includes("Conflict")&&v>0?"text-danger":""}">${v}</div>
          </div></div>`).join("")}
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-striped table-bordered">
          <thead class="table-light">
            <tr><th>Timestamp</th><th>Strategy</th><th style="width:90px">Assigned</th><th style="width:90px">Conflicts</th></tr>
          </thead>
          <tbody>
            ${events.slice(0,25).map(e=>`<tr>
              <td><small>${fmtDateTime(e.timestamp)}</small></td>
              <td>${escapeHtml(e.details?.strategy||"unknown")}</td>
              <td class="text-center">${e.details?.assignmentsMade??0}</td>
              <td class="text-center ${(e.details?.conflicts||0)>0?"text-danger fw-semibold":""}">${e.details?.conflicts??0}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="alert alert-info small">
        <strong>💡 Note:</strong> Conflicts occur when no available teacher meets all fairness
        constraints for a period. Reduce caps or check DND exclusions if conflicts are frequent.
      </div>`;
  }

  // ── Report: Subject Coverage ───────────────────────────────────
  function reportSubjectCoverage() {
    const history = getHistory();
    if (!history.length)
      return "<h6>Subject Coverage Report</h6><p class='text-muted'>No history available.</p>";

    const counts = {};
    for (const h of history) {
      const s = h.subject||"Unknown";
      counts[s] = (counts[s]||0)+1;
    }
    const rows  = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    const total = history.length, max = rows[0]?.[1]||1;

    return `
      <h6>Subject Coverage Report</h6>
      <p class="text-muted small">Subjects most frequently requiring cover across the 10-week period.</p>
      <div class="table-responsive">
        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr><th>Subject</th><th style="width:80px">Covers</th><th>Distribution</th><th style="width:100px">% of Total</th></tr>
          </thead>
          <tbody>
            ${rows.map(([subject,count])=>{
              const pct = ((count/total)*100).toFixed(1);
              return `<tr>
                <td>${escapeHtml(subject)}</td>
                <td class="text-center">${count}</td>
                <td><div class="progress" style="height:20px">
                  <div class="progress-bar bg-info" style="width:${((count/max)*100).toFixed(0)}%">${count}</div></div></td>
                <td class="text-center"><span class="badge bg-secondary">${pct}%</span></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }

  // ── Report: Absence Frequency ──────────────────────────────────
  function reportAbsenceFrequency() {
    const history = getHistory();
    if (!history.length)
      return "<h6>Absence Frequency Report</h6><p class='text-muted'>No history available.</p>";

    const periodCounts = {}, dayCounts = {};
    for (const h of history) {
      const t = h.coveredTeacher;
      periodCounts[t] = (periodCounts[t]||0)+1;
      if (!dayCounts[t]) dayCounts[t] = new Set();
      dayCounts[t].add(h.date);
    }
    const rows = Object.entries(periodCounts).sort((a,b)=>b[1]-a[1]);

    return `
      <h6>Absence Frequency Report</h6>
      <p class="text-muted small">Teachers ranked by how often they have been absent (required cover).</p>
      <div class="table-responsive">
        <table class="table table-sm table-striped table-bordered">
          <thead class="table-light">
            <tr><th style="width:50px">Rank</th><th>Teacher</th>
                <th style="width:130px">Total Periods</th><th style="width:130px">Absence Days</th></tr>
          </thead>
          <tbody>
            ${rows.map(([teacher,count],i)=>`<tr>
              <td class="text-center fw-semibold">${i+1}</td>
              <td>${escapeHtml(teacher)}</td>
              <td class="text-center">${count}</td>
              <td class="text-center">${dayCounts[teacher].size}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="alert alert-warning small">
        <strong>⚠️ Note:</strong> High absence frequency from a small number of teachers significantly
        increases cover load on peers.
      </div>`;
  }

  // ── Report: Period Utilisation ─────────────────────────────────
  function reportPeriodUtilisation() {
    const history = getHistory();
    if (!history.length)
      return "<h6>Period Utilisation Report</h6><p class='text-muted'>No history available.</p>";

    const counts = {};
    for (const h of history) {
      const p = h.period??"?";
      counts[p] = (counts[p]||0)+1;
    }
    const rows  = Object.entries(counts).sort((a,b)=>Number(a[0])-Number(b[0]));
    const max   = Math.max(...rows.map(r=>r[1]))||1;
    const total = history.length;

    return `
      <h6>Period Utilisation Report</h6>
      <p class="text-muted small">Cover load by period across all weeks. Identifies consistently high-demand periods.</p>
      <div class="table-responsive">
        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr><th>Period</th><th style="width:80px">Covers</th><th>Distribution</th><th style="width:100px">% of Total</th></tr>
          </thead>
          <tbody>
            ${rows.map(([period,count])=>{
              const pct = ((count/total)*100).toFixed(1);
              return `<tr>
                <td class="text-center fw-semibold">P${escapeHtml(String(period))}</td>
                <td class="text-center">${count}</td>
                <td><div class="progress" style="height:20px">
                  <div class="progress-bar bg-success" style="width:${((count/max)*100).toFixed(0)}%">${count}</div></div></td>
                <td class="text-center"><span class="badge bg-secondary">${pct}%</span></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="alert alert-info small">
        <strong>💡 Tip:</strong> Consistently high periods may indicate structural timetabling issues —
        consider redistributing free periods across these slots.
      </div>`;
  }

  // ── Report: Cover Teacher Availability Trend ───────────────────
  function reportAvailabilityTrend() {
    const history = getHistory();
    if (!history.length)
      return "<h6>Cover Teacher Availability Trend</h6><p class='text-muted'>No history available.</p>";

    const weekData = {};
    for (const h of history) {
      const w = h.week;
      if (!weekData[w]) weekData[w] = { covers:0, teachers:new Set(), absences:new Set() };
      weekData[w].covers++;
      weekData[w].teachers.add(h.coverTeacher);
      weekData[w].absences.add(h.coveredTeacher);
    }
    const rows      = Object.entries(weekData).sort((a,b)=>Number(a[0])-Number(b[0]));
    const maxCovers = Math.max(...rows.map(r=>r[1].covers))||1;

    return `
      <h6>Cover Teacher Availability Trend</h6>
      <p class="text-muted small">
        Week-by-week pool usage. A shrinking "Unique Cover Teachers" count may indicate cover pool
        fatigue or DND/cap constraints tightening.
      </p>
      <div class="table-responsive">
        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr><th>Week</th><th>Total Covers</th><th>Load</th>
                <th>Unique Cover Teachers</th><th>Unique Absences</th><th>Avg/Teacher</th></tr>
          </thead>
          <tbody>
            ${rows.map(([week,data])=>{
              const avg = (data.covers/data.teachers.size).toFixed(1);
              const pct = ((data.covers/maxCovers)*100).toFixed(0);
              const hot = parseFloat(avg) > 3;
              return `<tr>
                <td class="text-center fw-semibold">W${escapeHtml(String(week))}</td>
                <td class="text-center">${data.covers}</td>
                <td><div class="progress" style="height:18px">
                  <div class="progress-bar bg-primary" style="width:${pct}%">${data.covers}</div></div></td>
                <td class="text-center">${data.teachers.size}</td>
                <td class="text-center">${data.absences.size}</td>
                <td class="text-center ${hot?"text-danger fw-bold":""}">${avg}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="alert alert-warning small">
        <strong>⚠️ Watch:</strong> Avg covers/teacher above 3 per week (highlighted red) suggests
        unsustainable load — review fairness caps.
      </div>`;
  }

  // ── XSS-safe escaping ──────────────────────────────────────────
  function escapeHtml(value) {
    return String(value??"")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  // ── Init ───────────────────────────────────────────────────────
  function init() {
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
