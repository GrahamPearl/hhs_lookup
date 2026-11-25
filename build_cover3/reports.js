// =============================================================
// CHANGE 1 — reportDailyCover()
// Replace the single global reason lookup:
//
//   const absenceReason = document.getElementById("absenceReasonSelect")?.value || "Not Specified";
//
// with a per-teacher lookup helper placed BEFORE the forEach loop:
// =============================================================

  function reportDailyCover() {
    const dateStr = getSelectedDateStr();
    const history = getHistory().filter((h) => h.date === dateStr);

    if (history.length === 0) {
      return `<h6>Daily Cover Allocation (${dateStr})</h6><p class='text-muted'>No cover data for this day.</p>`;
    }

    // ── CHANGED: reasons are now per-teacher, not a single global value ──
    const teacherReasons = window.coverApp?.absentTeacherReasons || {};

    const partialAbsent = window.coverApp?.partialAbsentTeachers || {};

    const byTeacher = {};
    history.forEach((h) => {
      if (!byTeacher[h.coveredTeacher]) byTeacher[h.coveredTeacher] = [];
      byTeacher[h.coveredTeacher].push(h);
    });

    const teachers = Object.keys(byTeacher).sort();

    let html = `
      <h6>Daily Cover Allocation (${dateStr})</h6>
      <div class="table-responsive">
        <table class="table table-bordered align-middle">
          <tbody>
    `;

    teachers.forEach((teacher) => {
      const periods = byTeacher[teacher];
      periods.sort((a, b) => {
        const byDay = (a.day ?? 0) - (b.day ?? 0);
        if (byDay !== 0) return byDay;
        return (a.period ?? 0) - (b.period ?? 0);
      });

      const isPartial = partialAbsent[teacher];
      const absenceType = isPartial
        ? `<span class="badge bg-warning text-dark">Partial: P${isPartial.map(p => p + 1).join(',')}</span>`
        : `<span class="badge bg-danger">Full Day</span>`;

      // ── CHANGED: look up reason per teacher ──
      const absenceReason = teacherReasons[teacher]
        || h?.absentReason          // fall back to history field if available
        || "Not Specified";

      html += `
        <tr class="table-active">
          <td colspan="6" class="fw-bold">
            ${escapeHtml(teacher)} ${absenceType}
          </td>
        </tr>
        <tr class="table-light">
          <td colspan="6" class="text-muted">
            <small><strong>Reason:</strong> ${escapeHtml(absenceReason)}</small>
          </td>
        </tr>
        <tr class="table-secondary">
          <th style="width: 10%;">Period</th>
          <th style="width: 15%;">Type</th>
          <th style="width: 20%;">Class</th>
          <th style="width: 15%;">Venue</th>
          <th style="width: 40%;">Cover Teacher</th>
        </tr>
      `;

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

      html += `<tr><td colspan="6" style="height: 10px; background-color: #f8f9fa;"></td></tr>`;
    });

    html += `</tbody></table></div>`;
    return html;
  }


// =============================================================
// CHANGE 2 — reportDailyAbsenceSummary()
// Replace the single global reason lookup line:
//
//   const daySelect = qs("#absenceDaySelect");
//
// No removal needed there — but DELETE this line that follows it
// in the original (if present):
//
//   // Get absence reason from UI
//   const absenceReason = document.getElementById("absenceReasonSelect")?.value || "Not Specified";
//
// The summary report does not display the per-teacher reason,
// so no replacement is required — simply remove that line.
// The rest of reportDailyAbsenceSummary() is unchanged.
// =============================================================
