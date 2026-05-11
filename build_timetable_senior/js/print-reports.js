/*
  Print Reports Module
  ====================
  Provides comprehensive printing functionality:
  - Heat-map showing free period distribution (batting issues)
  - Individual teacher timetable printing
  - Professional single-page layouts
*/

// ─────────────────────────────────────────────────────────────
// HEAT-MAP REPORT (Free Periods Availability)
// ─────────────────────────────────────────────────────────────

function generateHeatMapReport() {
  const teachers = getAllTeacherNames();
  if (teachers.length === 0) {
    alert("No teachers found. Load or import timetables first.");
    return;
  }

  const config = getStoredConfig();
  if (!config || !config.rows || !config.cols) {
    alert("No timetable configuration found. Please load a teacher first.");
    return;
  }

  const { rows, cols, dayNames } = config;

  // Build heat-map data: count free teachers per slot
  const heatMapData = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let freeCount = 0;
      teachers.forEach((name) => {
        const key = getTeacherKey(name);
        const raw = localStorage.getItem(key);
        if (!raw) return;
        try {
          const payload = JSON.parse(raw);
          const entry = (payload.entries || []).find(
            (e) => e.row === r && e.col === c,
          );
          if (!entry || entry.type === "free") freeCount++;
        } catch {}
      });
      row.push(freeCount);
    }
    heatMapData.push(row);
  }

  // Find min/max for color scaling
  const allValues = heatMapData.flat();
  const minFree = Math.min(...allValues);
  const maxFree = Math.max(...allValues);

  // Generate HTML for print
  const today = new Date();
  const dateStr = today.toLocaleDateString();

  let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Heat-Map Report - Free Periods</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 20px;
          background: #f5f5f5;
        }
        .report-container {
          max-width: 1200px;
          margin: 0 auto;
          background: white;
          padding: 40px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .report-header {
          border-bottom: 3px solid #0d6efd;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .report-header h1 {
          font-size: 28px;
          color: #1a1a1a;
          margin-bottom: 10px;
        }
        .header-meta {
          display: flex;
          gap: 30px;
          color: #666;
          font-size: 14px;
        }
        .meta-item {
          display: flex;
          flex-direction: column;
        }
        .meta-label {
          font-weight: 600;
          color: #333;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .meta-value {
          margin-top: 4px;
          font-size: 16px;
        }

        .heat-map-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 13px;
        }
        .heat-map-table th,
        .heat-map-table td {
          padding: 12px 8px;
          text-align: center;
          border: 1px solid #ddd;
        }
        .heat-map-table th {
          background: #f8f9fa;
          font-weight: 600;
          color: #333;
        }
        .heat-map-table tbody tr:first-child td { border-top: 2px solid #333; }
        .heat-map-table tbody tr:last-child td { border-bottom: 2px solid #333; }
        .heat-map-table tbody td:first-child { border-left: 2px solid #333; }
        .heat-map-table tbody td:last-child { border-right: 2px solid #333; }

        .heat-cell {
          font-weight: 600;
          color: white;
          position: relative;
        }
        .heat-cell-value {
          position: relative;
          z-index: 1;
        }

        .legend {
          margin-top: 30px;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 6px;
          border-left: 4px solid #0d6efd;
        }
        .legend h3 {
          margin-bottom: 15px;
          font-size: 14px;
          color: #333;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .legend-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 10px;
          font-size: 13px;
        }
        .legend-swatch {
          width: 40px;
          height: 30px;
          border-radius: 3px;
          border: 1px solid #ccc;
        }

        .summary-section {
          margin-top: 30px;
          padding: 20px;
          background: #e7f1ff;
          border-radius: 6px;
          border-left: 4px solid #0d6efd;
        }
        .summary-section h3 {
          margin-bottom: 10px;
          color: #0d6efd;
          font-size: 14px;
          text-transform: uppercase;
        }
        .summary-section p {
          color: #333;
          font-size: 13px;
          line-height: 1.6;
          margin-bottom: 8px;
        }

        @media print {
          body { background: white; padding: 0; }
          .report-container { box-shadow: none; padding: 30px; max-width: 100%; }
          .print-btn { display: none; }
        }

        .print-btn {
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 12px 24px;
          background: #0d6efd;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(13, 110, 253, 0.3);
          z-index: 100;
        }
        .print-btn:hover {
          background: #0b5ed7;
          box-shadow: 0 6px 16px rgba(13, 110, 253, 0.4);
        }
      </style>
    </head>
    <body>
      <div class="report-container">
        <div class="report-header">
          <h1>📊 Free Periods Heat-Map Report</h1>
          <div class="header-meta">
            <div class="meta-item">
              <span class="meta-label">Generated</span>
              <span class="meta-value">${dateStr}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Total Teachers</span>
              <span class="meta-value">${teachers.length}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Timetable Size</span>
              <span class="meta-value">${rows} days × ${cols} periods</span>
            </div>
          </div>
        </div>

        <h2 style="font-size: 18px; color: #333; margin: 30px 0 15px 0;">Availability Density</h2>
        <p style="color: #666; font-size: 13px; margin-bottom: 20px;">
          Green (high availability) to red (low availability). Higher numbers indicate more free teachers available during that slot.
        </p>

        <table class="heat-map-table">
          <thead>
            <tr>
              <th>Day</th>
              ${Array.from({ length: cols }, (_, i) => `<th>P${i + 1}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${heatMapData
              .map(
                (row, dayIdx) => `
              <tr>
                <th style="text-align: left; background: #f8f9fa; font-weight: 600;">${dayNames[dayIdx] || `Day ${dayIdx + 1}`}</th>
                ${row
                  .map((freeCount) => {
                    const percent = ((freeCount - minFree) / (maxFree - minFree)) * 100;
                    const hue = (percent / 100) * 120; // green (120) to red (0)
                    const bgColor = `hsl(${hue}, 85%, 50%)`;
                    return `
                  <td class="heat-cell" style="background: ${bgColor};">
                    <span class="heat-cell-value">${freeCount}</span>
                  </td>
                `;
                  })
                  .join("")}
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>

        <div class="legend">
          <h3>Color Scale</h3>
          <div class="legend-row">
            <div class="legend-swatch" style="background: hsl(120, 85%, 50%); border: 1px solid #28a745;"></div>
            <span><strong>${maxFree} teachers</strong> free (high availability)</span>
          </div>
          <div class="legend-row">
            <div class="legend-swatch" style="background: hsl(60, 85%, 50%);"></div>
            <span><strong>${Math.round((minFree + maxFree) / 2)} teachers</strong> free (medium availability)</span>
          </div>
          <div class="legend-row">
            <div class="legend-swatch" style="background: hsl(0, 85%, 50%); border: 1px solid #dc3545;"></div>
            <span><strong>${minFree} teachers</strong> free (low availability / batting risk)</span>
          </div>
        </div>

        <div class="summary-section">
          <h3>📌 Key Insights</h3>
          <p><strong>Highest Risk Periods (Most Constrained):</strong> Slots with value ≤ ${minFree + 1} have minimal cover flexibility. Plan critical activities carefully.</p>
          <p><strong>Safest Periods (Most Flexible):</strong> Slots with value ≥ ${maxFree - 1} offer maximum cover availability.</p>
          <p><strong>Recommendation:</strong> Use this heat-map to identify scheduling bottlenecks and allocate senior staff to high-demand periods.</p>
        </div>

      </div>

      <button class="print-btn" onclick="window.print(); return false;">🖨️ Print Report</button>
    </body>
    </html>
  `;

  // Open in new window
  const printWindow = window.open("", "_blank");
  printWindow.document.write(html);
  printWindow.document.close();
}

// ─────────────────────────────────────────────────────────────
// INDIVIDUAL TEACHER TIMETABLE PRINT
// ─────────────────────────────────────────────────────────────

function printTeacherTimetable(teacherName) {
  if (!teacherName) {
    alert("No teacher name provided.");
    return;
  }

  const key = getTeacherKey(teacherName);
  const raw = localStorage.getItem(key);
  if (!raw) {
    alert(`No timetable found for ${teacherName}.`);
    return;
  }

  try {
    const payload = JSON.parse(raw);
    const config = payload.config || {};
    const entries = payload.entries || [];
    const { rows, cols, dayNames } = config;

    if (!rows || !cols) {
      alert("No valid timetable configuration for this teacher.");
      return;
    }

    // Build grid for display
    const grid = {};
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        grid[`${r}-${c}`] = null;
      }
    }
    entries.forEach((e) => {
      if (typeof e.row === "number" && typeof e.col === "number") {
        grid[`${e.row}-${e.col}`] = e;
      }
    });

    const today = new Date();
    const dateStr = today.toLocaleDateString();
    const timeStr = today.toLocaleTimeString();

    // Generate print-friendly HTML
    let html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Timetable - ${escapeHtml(teacherName)}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            padding: 20px;
            background: #f5f5f5;
          }
          .page {
            background: white;
            padding: 40px;
            max-width: 210mm;
            margin: 0 auto 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            page-break-inside: avoid;
            page-break-after: always;
          }

          .page-header {
            border-bottom: 3px solid #2e7d32;
            padding-bottom: 20px;
            margin-bottom: 30px;
            page-break-inside: avoid;
          }
          .page-header h1 {
            font-size: 26px;
            color: #1a1a1a;
            margin-bottom: 12px;
          }
          .header-meta {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            font-size: 12px;
          }
          .meta-item {
            display: flex;
            flex-direction: column;
          }
          .meta-label {
            font-weight: 700;
            color: #555;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-size: 11px;
          }
          .meta-value {
            margin-top: 4px;
            color: #2e7d32;
            font-size: 14px;
            font-weight: 600;
          }

          .timetable {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 12px;
            page-break-inside: avoid;
          }
          .timetable th {
            background: #e6f4ea;
            color: #1b5e20;
            font-weight: 700;
            padding: 10px 6px;
            border: 1px solid #4caf50;
            text-align: center;
          }
          .timetable td {
            padding: 10px 6px;
            border: 1px solid #ddd;
            min-height: 60px;
            vertical-align: top;
          }
          .timetable tbody td {
            font-size: 11px;
            background: white;
          }

          .cell-lesson {
            background: #e3f2fd;
            border-left: 4px solid #1976d2;
          }
          .cell-meeting {
            background: #fff3e0;
            border-left: 4px solid #f57c00;
          }
          .cell-free {
            background: #c8e6c9;
            border-left: 4px solid #27ae60;
            font-weight: 700;
            color: #1b5e20;
          }
          .cell-empty {
            background: #fafafa;
            color: #999;
            font-style: italic;
            text-align: center;
          }

          .cell-content {
            line-height: 1.5;
          }
          .cell-icon {
            font-size: 16px;
            margin-bottom: 4px;
            display: block;
          }
          .cell-title {
            font-weight: 600;
            color: #222;
            margin-bottom: 2px;
          }
          .cell-class {
            color: #666;
            font-size: 10px;
          }
          .cell-venue {
            color: #999;
            font-size: 10px;
          }
          .cell-dnd {
            display: inline-block;
            background: #d32f2f;
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 9px;
            font-weight: 600;
            margin-top: 4px;
          }

          .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            font-size: 11px;
            color: #999;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
          }

          .summary {
            margin-top: 20px;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 4px;
            font-size: 11px;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            page-break-inside: avoid;
          }
          .summary-item {
            text-align: center;
          }
          .summary-label {
            font-weight: 600;
            color: #666;
            font-size: 10px;
            text-transform: uppercase;
          }
          .summary-value {
            font-size: 18px;
            font-weight: 700;
            color: #2e7d32;
            margin-top: 4px;
          }

          @media print {
            body { background: white; padding: 0; }
            .page { box-shadow: none; margin: 0; padding: 15mm; max-width: 100%; }
            .print-btn { display: none; }
          }

          .print-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 24px;
            background: #2e7d32;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(46, 125, 50, 0.3);
            z-index: 100;
          }
          .print-btn:hover {
            background: #1b5e20;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="page-header">
            <h1>📋 Teacher Timetable</h1>
            <div class="header-meta">
              <div class="meta-item">
                <span class="meta-label">Teacher</span>
                <span class="meta-value">${escapeHtml(teacherName)}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Date</span>
                <span class="meta-value">${dateStr}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Time</span>
                <span class="meta-value">${timeStr}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Status</span>
                <span class="meta-value">${payload.lastResort ? "Last Resort" : "Standard"}</span>
              </div>
            </div>
          </div>

          <table class="timetable">
            <thead>
              <tr>
                <th>Day / Period</th>
                ${Array.from({ length: cols }, (_, i) => `<th>P${i + 1}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${Array.from({ length: rows }, (_, r) => {
                const dayName = dayNames[r] || `Day ${r + 1}`;
                return `
                <tr>
                  <th style="background: #e6f4ea; color: #1b5e20; font-weight: 700; padding: 10px 6px; border: 1px solid #4caf50; text-align: left;">
                    ${escapeHtml(dayName)}
                  </th>
                  ${Array.from({ length: cols }, (_, c) => {
                    const cellKey = `${r}-${c}`;
                    const entry = grid[cellKey];

                    if (!entry) {
                      return `<td class="cell-empty">—</td>`;
                    }

                    if (entry.type === "free") {
                      return `
                        <td class="cell-free">
                          <div class="cell-content">
                            <span class="cell-icon">☕</span>
                            <strong>Free Time</strong>
                          </div>
                        </td>
                      `;
                    }

                    if (entry.type === "meeting") {
                      const dndBadge = entry.doNotDisturb
                        ? `<div class="cell-dnd">🚫 DND</div>`
                        : "";
                      return `
                        <td class="cell-meeting">
                          <div class="cell-content">
                            <span class="cell-icon">🕐</span>
                            <div class="cell-title">${escapeHtml(entry.subject || "Meeting")}</div>
                            <div class="cell-class">${escapeHtml(entry.className || "")}</div>
                            <div class="cell-venue">${escapeHtml(entry.venue || "")}</div>
                            ${dndBadge}
                          </div>
                        </td>
                      `;
                    }

                    // Default: lesson
                    return `
                      <td class="cell-lesson">
                        <div class="cell-content">
                          <span class="cell-icon">📚</span>
                          <div class="cell-title">${escapeHtml(entry.subject || "Lesson")}</div>
                          <div class="cell-class">${escapeHtml(entry.className || "")}</div>
                          <div class="cell-venue">${escapeHtml(entry.venue || "")}</div>
                        </div>
                      </td>
                    `;
                  }).join("")}
                </tr>
              `;
              }).join("")}
            </tbody>
          </table>

          <div class="summary">
            <div class="summary-item">
              <div class="summary-label">📚 Lessons</div>
              <div class="summary-value">${entries.filter((e) => e.type === "lesson").length}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">🕐 Meetings</div>
              <div class="summary-value">${entries.filter((e) => e.type === "meeting").length}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">☕ Free Periods</div>
              <div class="summary-value">${entries.filter((e) => e.type === "free").length}</div>
            </div>
          </div>

          <div class="footer">
            <div>Teacher Timetable System</div>
            <div>Page 1 of 1</div>
            <div>${dateStr} at ${timeStr}</div>
          </div>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    printWindow.document.write(html);
    printWindow.document.close();
  } catch (e) {
    console.error("Error printing timetable", e);
    alert("Could not generate print view. Data may be corrupted.");
  }
}

// ─────────────────────────────────────────────────────────────
// BULK TEACHER PRINT (All Teachers on One Report)
// ─────────────────────────────────────────────────────────────

function printAllTeachersSummary() {
  const teachers = getAllTeacherNames();
  if (teachers.length === 0) {
    alert("No teachers found.");
    return;
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString();
  const timeStr = today.toLocaleTimeString();

  // Collect summary data for each teacher
  const summaries = teachers.map((name) => {
    const key = getTeacherKey(name);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw);
      const config = payload.config || {};
      const entries = payload.entries || [];
      const total = (config.rows || 0) * (config.cols || 0);
      const captured = entries.length;
      const percent = total ? Math.round((captured / total) * 100) : 0;
      const lessons = entries.filter((e) => e.type === "lesson").length;
      const meetings = entries.filter((e) => e.type === "meeting").length;
      const free = entries.filter((e) => e.type === "free").length;

      return {
        name,
        total,
        captured,
        percent,
        lessons,
        meetings,
        free,
        lastResort: !!payload.lastResort,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>All Teachers Summary Report</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 20px;
          background: #f5f5f5;
        }
        .report-container {
          max-width: 1200px;
          margin: 0 auto;
          background: white;
          padding: 40px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          page-break-inside: avoid;
        }
        .report-header {
          border-bottom: 3px solid #0d6efd;
          padding-bottom: 20px;
          margin-bottom: 30px;
          page-break-inside: avoid;
        }
        .report-header h1 {
          font-size: 28px;
          color: #1a1a1a;
          margin-bottom: 10px;
        }
        .header-meta {
          display: flex;
          gap: 30px;
          color: #666;
          font-size: 14px;
          flex-wrap: wrap;
        }
        .meta-item {
          display: flex;
          flex-direction: column;
        }
        .meta-label {
          font-weight: 600;
          color: #333;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .meta-value {
          margin-top: 4px;
          font-size: 16px;
        }

        .summary-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 13px;
          page-break-inside: avoid;
        }
        .summary-table th {
          background: #f8f9fa;
          font-weight: 600;
          color: #333;
          padding: 12px 10px;
          border: 1px solid #ddd;
          text-align: left;
        }
        .summary-table td {
          padding: 12px 10px;
          border: 1px solid #ddd;
        }
        .summary-table tbody tr:nth-child(even) {
          background: #f9f9f9;
        }
        .summary-table tbody tr:hover {
          background: #f0f8ff;
        }
        .teacher-name {
          font-weight: 600;
          color: #0d6efd;
        }
        .badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 600;
          margin-right: 4px;
        }
        .badge-last-resort {
          background: #fff3cd;
          color: #856404;
        }
        .badge-complete {
          background: #d4edda;
          color: #155724;
        }
        .badge-incomplete {
          background: #f8d7da;
          color: #721c24;
        }
        .percent-bar {
          display: inline-block;
          width: 100px;
          height: 20px;
          background: #e9ecef;
          border-radius: 3px;
          overflow: hidden;
          margin-right: 8px;
          vertical-align: middle;
        }
        .percent-fill {
          height: 100%;
          background: linear-gradient(90deg, #28a745, #20c997);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 10px;
          font-weight: 600;
        }

        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          font-size: 11px;
          color: #999;
          display: flex;
          justify-content: space-between;
          page-break-inside: avoid;
        }

        @media print {
          body { background: white; padding: 0; }
          .report-container { box-shadow: none; padding: 15mm; max-width: 100%; }
          .print-btn { display: none; }
        }

        .print-btn {
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 12px 24px;
          background: #0d6efd;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(13, 110, 253, 0.3);
          z-index: 100;
        }
        .print-btn:hover {
          background: #0b5ed7;
        }
      </style>
    </head>
    <body>
      <div class="report-container">
        <div class="report-header">
          <h1>📋 All Teachers Summary Report</h1>
          <div class="header-meta">
            <div class="meta-item">
              <span class="meta-label">Generated</span>
              <span class="meta-value">${dateStr}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Time</span>
              <span class="meta-value">${timeStr}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Total Teachers</span>
              <span class="meta-value">${summaries.length}</span>
            </div>
          </div>
        </div>

        <table class="summary-table">
          <thead>
            <tr>
              <th>📝 Teacher Name</th>
              <th>✓ Completion</th>
              <th>📚 Lessons</th>
              <th>🕐 Meetings</th>
              <th>☕ Free</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${summaries
              .map(
                (s) => `
              <tr>
                <td class="teacher-name">${escapeHtml(s.name)}</td>
                <td>
                  <div class="percent-bar">
                    <div class="percent-fill" style="width: ${s.percent}%;">
                      ${s.percent}%
                    </div>
                  </div>
                  <span style="font-size: 12px;">${s.captured}/${s.total}</span>
                </td>
                <td style="text-align: center; font-weight: 600;">📚 ${s.lessons}</td>
                <td style="text-align: center; font-weight: 600;">🕐 ${s.meetings}</td>
                <td style="text-align: center; font-weight: 600; color: #27ae60;">☕ ${s.free}</td>
                <td>
                  ${s.lastResort ? '<span class="badge badge-last-resort">⚠️ Last Resort</span>' : ""}
                  ${s.percent === 100 ? '<span class="badge badge-complete">✓ Complete</span>' : '<span class="badge badge-incomplete">✗ Incomplete</span>'}
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>

        <div class="footer">
          <div>Teacher Timetable System – Summary Report</div>
          <div>Page 1 of 1</div>
          <div>${dateStr} at ${timeStr}</div>
        </div>
      </div>

      <button class="print-btn" onclick="window.print(); return false;">🖨️ Print Report</button>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(html);
  printWindow.document.close();
}

// ─────────────────────────────────────────────────────────────
// BULK PRINT: All Teachers (Compact Layout - 2 per page)
// ─────────────────────────────────────────────────────────────

function printAllTeachersTimetablesBulk() {
  const teachers = getAllTeacherNames();
  if (teachers.length === 0) {
    alert("No teachers found.");
    return;
  }

  const config = getStoredConfig();
  if (!config || !config.rows || !config.cols) {
    alert("No timetable configuration found.");
    return;
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString();
  const timeStr = today.toLocaleTimeString();
  const { rows, cols, dayNames } = config;

  // Build timetable data for all teachers
  const timetablesByTeacher = {};
  teachers.forEach((name) => {
    const key = getTeacherKey(name);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      const grid = {};
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          grid[`${r}-${c}`] = null;
        }
      }
      (payload.entries || []).forEach((e) => {
        if (typeof e.row === "number" && typeof e.col === "number") {
          grid[`${e.row}-${e.col}`] = e;
        }
      });
      timetablesByTeacher[name] = { grid, payload };
    } catch {}
  });

  let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Bulk Timetables Print</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 10px;
          background: #f5f5f5;
        }
        .page {
          background: white;
          padding: 15mm;
          max-width: 210mm;
          margin: 0 auto 5mm;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          page-break-after: always;
          page-break-inside: avoid;
        }
        .page-header {
          border-bottom: 2px solid #333;
          padding-bottom: 10px;
          margin-bottom: 15px;
          text-align: center;
        }
        .page-header h1 {
          font-size: 20px;
          color: #1a1a1a;
          margin-bottom: 4px;
        }
        .page-meta {
          font-size: 10px;
          color: #666;
        }

        .timetables-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }

        .timetable-card {
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 12px;
          page-break-inside: avoid;
        }
        .card-header {
          background: #e6f4ea;
          padding: 8px 10px;
          border-radius: 3px;
          margin-bottom: 10px;
          border-left: 3px solid #27ae60;
        }
        .card-title {
          font-weight: 700;
          color: #1b5e20;
          font-size: 12px;
          margin-bottom: 2px;
        }
        .card-subtitle {
          font-size: 10px;
          color: #666;
        }

        .compact-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9px;
        }
        .compact-table th {
          background: #f0f0f0;
          color: #333;
          font-weight: 600;
          padding: 4px 2px;
          border: 1px solid #ddd;
          text-align: center;
        }
        .compact-table td {
          padding: 4px 2px;
          border: 1px solid #eee;
          text-align: center;
          min-height: 20px;
          vertical-align: top;
          font-size: 8px;
        }
        .compact-table tbody td:first-child { text-align: left; font-weight: 600; }

        .cell-lesson { background: #e3f2fd; }
        .cell-meeting { background: #fff3e0; }
        .cell-free { background: #c8e6c9; color: #1b5e20; font-weight: 600; }
        .cell-empty { background: #fafafa; color: #ccc; }

        .footer {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #ddd;
          font-size: 9px;
          color: #999;
          text-align: center;
        }

        @media print {
          body { background: white; padding: 0; }
          .page { box-shadow: none; margin: 0; }
          .print-btn { display: none; }
        }

        .print-btn {
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 12px 24px;
          background: #2e7d32;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(46, 125, 50, 0.3);
          z-index: 100;
        }
        .print-btn:hover { background: #1b5e20; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="page-header">
          <h1>📚 All Teacher Timetables – Bulk Print</h1>
          <div class="page-meta">Generated ${dateStr} at ${timeStr} | ${teachers.length} teachers | Timetable: ${rows}d × ${cols}p</div>
        </div>

        <div class="timetables-grid">
  `;

  // Add timetables 2 per page
  const teacherEntries = Object.entries(timetablesByTeacher);
  
  for (let i = 0; i < teacherEntries.length; i++) {
    const [name, data] = teacherEntries[i];
    const { grid, payload } = data;
    
    html += `
      <div class="timetable-card">
        <div class="card-header">
          <div class="card-title">📋 ${escapeHtml(name)}</div>
          <div class="card-subtitle">${payload.lastResort ? '⚠️ Last Resort' : '✓ Standard'}</div>
        </div>
        <table class="compact-table">
          <thead>
            <tr>
              <th>Day</th>
              ${Array.from({ length: cols }, (_, p) => `<th>P${p + 1}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${Array.from({ length: rows }, (_, r) => {
              const dayName = dayNames[r] || `D${r + 1}`;
              return `
              <tr>
                <td>${escapeHtml(dayName)}</td>
                ${Array.from({ length: cols }, (_, c) => {
                  const entry = grid[`${r}-${c}`];
                  if (!entry) return '<td class="cell-empty">—</td>';
                  if (entry.type === 'free') return '<td class="cell-free">☕</td>';
                  if (entry.type === 'meeting') return '<td class="cell-meeting">🕐</td>';
                  return '<td class="cell-lesson">📚</td>';
                }).join('')}
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Start new page after every 2 timetables
    if ((i + 1) % 2 === 0 && i + 1 < teacherEntries.length) {
      html += `
        </div>
        <div class="footer">Page ${Math.ceil((i + 1) / 2)} of ${Math.ceil(teacherEntries.length / 2)}</div>
      </div>

      <div class="page">
        <div class="page-header" style="border-bottom: 1px solid #ccc; padding-bottom: 6px; margin-bottom: 10px;">
          <div class="page-meta" style="font-size: 9px;">Continued... (${Math.ceil((i + 1) / 2)} of ${Math.ceil(teacherEntries.length / 2)})</div>
        </div>
        <div class="timetables-grid">
      `;
    }
  }

  // Close final page
  const finalPageNum = Math.ceil(teacherEntries.length / 2);
  html += `
        </div>
        <div class="footer">Page ${finalPageNum} of ${finalPageNum}</div>
      </div>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(html);
  printWindow.document.close();
}

// ─────────────────────────────────────────────────────────────
// COMPLETENESS ANALYSIS REPORT
// ─────────────────────────────────────────────────────────────

function printCompletenessAnalysisReport() {
  const teachers = getAllTeacherNames();
  if (teachers.length === 0) {
    alert("No teachers found.");
    return;
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString();
  const timeStr = today.toLocaleTimeString();

  // Analyze each teacher
  const analysis = teachers.map((name) => {
    const key = getTeacherKey(name);
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    try {
      const payload = JSON.parse(raw);
      const config = payload.config || {};
      const entries = payload.entries || [];
      const rows = parseInt(config.rows, 10) || 0;
      const cols = parseInt(config.cols, 10) || 0;
      const total = rows * cols;

      const lessons = entries.filter((e) => e.type === "lesson").length;
      const meetings = entries.filter((e) => e.type === "meeting").length;
      const free = entries.filter((e) => e.type === "free").length;
      const captured = entries.length;
      const missing = total - captured;
      const percent = total ? Math.round((captured / total) * 100) : 0;
      const dnd = entries.filter((e) => e.type === "meeting" && e.doNotDisturb).length;

      return {
        name,
        total,
        captured,
        missing,
        percent,
        lessons,
        meetings,
        free,
        dnd,
        lastResort: !!payload.lastResort,
        complete: percent === 100,
        hasGrid: total > 0,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  // Calculate statistics
  const completed = analysis.filter((a) => a.complete).length;
  const incomplete = analysis.filter((a) => !a.complete && a.hasGrid).length;
  const noGrid = analysis.filter((a) => !a.hasGrid).length;
  const totalCells = analysis.reduce((sum, a) => sum + a.total, 0);
  const totalCaptured = analysis.reduce((sum, a) => sum + a.captured, 0);
  const overallPercent = totalCells ? Math.round((totalCaptured / totalCells) * 100) : 0;

  let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Completeness Analysis Report</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 20px;
          background: #f5f5f5;
        }
        .report-container {
          max-width: 1200px;
          margin: 0 auto;
          background: white;
          padding: 40px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          page-break-inside: avoid;
        }
        .report-header {
          border-bottom: 3px solid #ff9800;
          padding-bottom: 20px;
          margin-bottom: 30px;
          page-break-inside: avoid;
        }
        .report-header h1 {
          font-size: 28px;
          color: #1a1a1a;
          margin-bottom: 10px;
        }
        .header-meta {
          display: flex;
          gap: 30px;
          color: #666;
          font-size: 14px;
          flex-wrap: wrap;
        }
        .meta-item {
          display: flex;
          flex-direction: column;
        }
        .meta-label {
          font-weight: 600;
          color: #333;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .meta-value {
          margin-top: 4px;
          font-size: 16px;
          font-weight: 600;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 15px;
          margin: 20px 0;
          page-break-inside: avoid;
        }
        .stat-box {
          padding: 20px;
          border-radius: 6px;
          text-align: center;
          border-left: 4px solid #333;
        }
        .stat-box.complete { background: #d4edda; border-color: #28a745; }
        .stat-box.incomplete { background: #fff3cd; border-color: #ff9800; }
        .stat-box.nogrid { background: #f8d7da; border-color: #dc3545; }
        .stat-box.overall { background: #d1ecf1; border-color: #0c5460; }
        .stat-label {
          font-size: 12px;
          font-weight: 600;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .stat-value {
          font-size: 28px;
          font-weight: 700;
          margin-top: 8px;
          color: #333;
        }
        .stat-box.complete .stat-value { color: #28a745; }
        .stat-box.incomplete .stat-value { color: #ff9800; }
        .stat-box.nogrid .stat-value { color: #dc3545; }
        .stat-box.overall .stat-value { color: #0c5460; }

        .analysis-table {
          width: 100%;
          border-collapse: collapse;
          margin: 30px 0;
          font-size: 13px;
          page-break-inside: avoid;
        }
        .analysis-table th {
          background: #f8f9fa;
          font-weight: 600;
          color: #333;
          padding: 12px 10px;
          border: 1px solid #ddd;
          text-align: left;
        }
        .analysis-table td {
          padding: 12px 10px;
          border: 1px solid #ddd;
        }
        .analysis-table tbody tr:nth-child(even) { background: #f9f9f9; }
        .analysis-table tbody tr:hover { background: #f0f8ff; }

        .teacher-name { font-weight: 600; color: #0d6efd; }
        .status-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 600;
        }
        .badge-complete { background: #d4edda; color: #155724; }
        .badge-incomplete { background: #fff3cd; color: #856404; }
        .badge-nogrid { background: #f8d7da; color: #721c24; }

        .progress-bar {
          display: inline-block;
          width: 100px;
          height: 20px;
          background: #e9ecef;
          border-radius: 3px;
          overflow: hidden;
          vertical-align: middle;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #ff9800, #ff9800);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 10px;
          font-weight: 600;
        }

        .insights-section {
          margin-top: 30px;
          padding: 20px;
          background: #f0f7ff;
          border-radius: 6px;
          border-left: 4px solid #ff9800;
          page-break-inside: avoid;
        }
        .insights-section h3 {
          color: #ff9800;
          margin-bottom: 15px;
          text-transform: uppercase;
          font-size: 14px;
        }
        .insights-section p {
          margin-bottom: 10px;
          font-size: 13px;
          color: #333;
          line-height: 1.6;
        }

        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          font-size: 11px;
          color: #999;
          display: flex;
          justify-content: space-between;
          page-break-inside: avoid;
        }

        @media print {
          body { background: white; padding: 0; }
          .report-container { box-shadow: none; padding: 15mm; }
          .print-btn { display: none; }
        }

        .print-btn {
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 12px 24px;
          background: #ff9800;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3);
          z-index: 100;
        }
        .print-btn:hover { background: #f57c00; }
      </style>
    </head>
    <body>
      <div class="report-container">
        <div class="report-header">
          <h1>✅ Timetable Completeness Analysis Report</h1>
          <div class="header-meta">
            <div class="meta-item">
              <span class="meta-label">Generated</span>
              <span class="meta-value">${dateStr}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Time</span>
              <span class="meta-value">${timeStr}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Total Teachers</span>
              <span class="meta-value">${teachers.length}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Overall Completion</span>
              <span class="meta-value">${overallPercent}%</span>
            </div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-box complete">
            <div class="stat-label">✓ Complete</div>
            <div class="stat-value">${completed}</div>
            <div style="font-size: 11px; color: #666; margin-top: 4px;">timetables</div>
          </div>
          <div class="stat-box incomplete">
            <div class="stat-label">⚠ Incomplete</div>
            <div class="stat-value">${incomplete}</div>
            <div style="font-size: 11px; color: #666; margin-top: 4px;">with grids</div>
          </div>
          <div class="stat-box nogrid">
            <div class="stat-label">✗ No Grid</div>
            <div class="stat-value">${noGrid}</div>
            <div style="font-size: 11px; color: #666; margin-top: 4px;">missing setup</div>
          </div>
          <div class="stat-box overall">
            <div class="stat-label">📊 Overall</div>
            <div class="stat-value">${overallPercent}%</div>
            <div style="font-size: 11px; color: #666; margin-top: 4px;">cells captured</div>
          </div>
        </div>

        <h2 style="font-size: 18px; color: #333; margin: 30px 0 15px 0;">📋 Detailed Teacher Analysis</h2>

        <table class="analysis-table">
          <thead>
            <tr>
              <th>Teacher Name</th>
              <th>Grid Size</th>
              <th>Captured</th>
              <th>Missing</th>
              <th>Completion %</th>
              <th>📚 Lessons</th>
              <th>🕐 Meetings</th>
              <th>☕ Free</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${analysis
              .sort((a, b) => b.percent - a.percent)
              .map(
                (a) => {
                  let badge = '';
                  if (!a.hasGrid) {
                    badge = '<span class="status-badge badge-nogrid">✗ No Grid</span>';
                  } else if (a.complete) {
                    badge = '<span class="status-badge badge-complete">✓ Complete</span>';
                  } else {
                    badge = '<span class="status-badge badge-incomplete">⚠ Incomplete</span>';
                  }

                  const progress = a.total > 0 ? a.percent : 0;
                  return `
                <tr>
                  <td class="teacher-name">\${escapeHtml(a.name)}</td>
                  <td>\${a.rows}×\${a.cols > 0 ? a.cols : '?'}</td>
                  <td>\${a.captured}</td>
                  <td>\${a.missing}</td>
                  <td>
                    <div class="progress-bar">
                      <div class="progress-fill" style="width: \${progress}%; background: \${progress === 100 ? '#28a745' : '#ff9800'};;">
                        \${progress}%
                      </div>
                    </div>
                  </td>
                  <td style="text-align: center;">\${a.lessons}</td>
                  <td style="text-align: center;">\${a.meetings} \${a.dnd ? '(' + a.dnd + ' DND)' : ''}</td>
                  <td style="text-align: center;">\${a.free}</td>
                  <td>\${badge} \${a.lastResort ? '<span class="status-badge" style="background: #fff3cd; color: #856404;">⚠ Last Resort</span>' : ''}</td>
                </tr>
              \`;
                }
              )
              .join('')}
          </tbody>
        </table>

        <div class="insights-section">
          <h3>🎯 Key Insights & Actions</h3>
          <p><strong>Overall Status:</strong> ${overallPercent === 100 ? '✓ All timetables are complete!' : `⚠ ${incomplete + noGrid} teachers need attention.`}</p>
          ${noGrid > 0 ? `<p><strong>No Grid Setup:</strong> ${noGrid} teacher(s) have no grid configuration. They need to set up their timetable structure first.</p>` : ''}
          ${incomplete > 0 ? `<p><strong>Incomplete Timetables:</strong> ${incomplete} teacher(s) have grids but missing cells. Use the Completeness & Auto-fill tool to audit and fill gaps.</p>` : ''}
          <p><strong>Next Steps:</strong> Review incomplete timetables, address missing cells, and verify all teaching commitments are captured.</p>
        </div>

        <div class="footer">
          <div>Timetable System – Completeness Analysis</div>
          <div>Page 1 of 1</div>
          <div>${dateStr} at ${timeStr}</div>
        </div>
      </div>

      <button class="print-btn" onclick="window.print(); return false;">🖨️ Print Report</button>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(html);
  printWindow.document.close();
}

// ─────────────────────────────────────────────────────────────
// DATA QUALITY METRICS REPORT
// ─────────────────────────────────────────────────────────────

function printDataQualityReport() {
  const teachers = getAllTeacherNames();
  if (teachers.length === 0) {
    alert("No teachers found.");
    return;
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString();

  // Analyze data quality for each teacher
  const qualityMetrics = teachers.map((name) => {
    const key = getTeacherKey(name);
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    try {
      const payload = JSON.parse(raw);
      const config = payload.config || {};
      const entries = payload.entries || [];

      let qualityScore = 100;
      const issues = [];

      // Check for missing subjects
      const noSubject = entries.filter((e) => e.type !== "free" && !e.subject).length;
      if (noSubject > 0) {
        issues.push(`${noSubject} entries missing subject`);
        qualityScore -= noSubject * 2;
      }

      // Check for missing class names
      const noClass = entries.filter((e) => e.type !== "free" && !e.className).length;
      if (noClass > 0) {
        issues.push(`${noClass} entries missing class`);
        qualityScore -= noClass * 1;
      }

      // Check for missing venues
      const noVenue = entries.filter((e) => e.type !== "free" && !e.venue).length;
      if (noVenue > 0) {
        issues.push(`${noVenue} entries missing venue`);
        qualityScore -= noVenue * 1;
      }

      // Check for grid completeness
      const total = (parseInt(config.rows, 10) || 0) * (parseInt(config.cols, 10) || 0);
      const captured = entries.length;
      const completeness = total > 0 ? (captured / total) * 100 : 0;

      if (completeness < 100 && total > 0) {
        issues.push(`Grid ${Math.round(completeness)}% complete`);
      }

      // Check for balanced schedule
      const lessons = entries.filter((e) => e.type === "lesson").length;
      const meetings = entries.filter((e) => e.type === "meeting").length;
      const free = entries.filter((e) => e.type === "free").length;
      const ratio = lessons + meetings + free;

      qualityScore = Math.max(0, qualityScore);

      return {
        name,
        qualityScore,
        issues,
        lessons,
        meetings,
        free,
        noSubject,
        noClass,
        noVenue,
        completeness: total > 0 ? Math.round(completeness) : 0,
        total,
        captured,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  const avgQuality = qualityMetrics.length
    ? Math.round(qualityMetrics.reduce((sum, m) => sum + m.qualityScore, 0) / qualityMetrics.length)
    : 0;

  let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Data Quality Report</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 20px;
          background: #f5f5f5;
        }
        .report-container {
          max-width: 1200px;
          margin: 0 auto;
          background: white;
          padding: 40px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          page-break-inside: avoid;
        }
        .report-header {
          border-bottom: 3px solid #6f42c1;
          padding-bottom: 20px;
          margin-bottom: 30px;
          page-break-inside: avoid;
        }
        .report-header h1 {
          font-size: 28px;
          color: #1a1a1a;
          margin-bottom: 10px;
        }
        .header-meta {
          display: flex;
          gap: 30px;
          color: #666;
          font-size: 14px;
          flex-wrap: wrap;
        }
        .meta-item {
          display: flex;
          flex-direction: column;
        }
        .meta-label {
          font-weight: 600;
          color: #333;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .meta-value {
          margin-top: 4px;
          font-size: 16px;
          font-weight: 600;
        }

        .quality-score-box {
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 6px;
          color: white;
          text-align: center;
          margin: 20px 0;
        }
        .score-value {
          font-size: 48px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .score-label {
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .quality-table {
          width: 100%;
          border-collapse: collapse;
          margin: 30px 0;
          font-size: 13px;
          page-break-inside: avoid;
        }
        .quality-table th {
          background: #f8f9fa;
          font-weight: 600;
          color: #333;
          padding: 12px 10px;
          border: 1px solid #ddd;
          text-align: left;
        }
        .quality-table td {
          padding: 12px 10px;
          border: 1px solid #ddd;
        }
        .quality-table tbody tr:nth-child(even) { background: #f9f9f9; }

        .teacher-name { font-weight: 600; color: #0d6efd; }
        .quality-score {
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 3px;
          text-align: center;
        }
        .score-excellent { background: #d4edda; color: #155724; }
        .score-good { background: #d1ecf1; color: #0c5460; }
        .score-fair { background: #fff3cd; color: #856404; }
        .score-poor { background: #f8d7da; color: #721c24; }

        .issues-list {
          font-size: 12px;
          color: #666;
          max-width: 300px;
        }
        .issues-list ul {
          margin: 0;
          padding-left: 18px;
        }
        .issues-list li {
          margin-bottom: 3px;
        }

        .insights-section {
          margin-top: 30px;
          padding: 20px;
          background: #f5e6ff;
          border-radius: 6px;
          border-left: 4px solid #6f42c1;
          page-break-inside: avoid;
        }
        .insights-section h3 {
          color: #6f42c1;
          margin-bottom: 15px;
          text-transform: uppercase;
          font-size: 14px;
        }
        .insights-section p {
          margin-bottom: 10px;
          font-size: 13px;
          color: #333;
          line-height: 1.6;
        }

        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          font-size: 11px;
          color: #999;
          display: flex;
          justify-content: space-between;
          page-break-inside: avoid;
        }

        @media print {
          body { background: white; padding: 0; }
          .report-container { box-shadow: none; padding: 15mm; }
          .print-btn { display: none; }
        }

        .print-btn {
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 12px 24px;
          background: #6f42c1;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(111, 66, 193, 0.3);
          z-index: 100;
        }
        .print-btn:hover { background: #5a32a3; }
      </style>
    </head>
    <body>
      <div class="report-container">
        <div class="report-header">
          <h1>📊 Data Quality & Completeness Metrics</h1>
          <div class="header-meta">
            <div class="meta-item">
              <span class="meta-label">Generated</span>
              <span class="meta-value">${dateStr}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Teachers Analyzed</span>
              <span class="meta-value">${qualityMetrics.length}</span>
            </div>
          </div>
        </div>

        <div class="quality-score-box">
          <div class="score-value">${avgQuality}</div>
          <div class="score-label">Average System Quality Score</div>
        </div>

        <h2 style="font-size: 18px; color: #333; margin: 30px 0 15px 0;">👤 Individual Teacher Metrics</h2>

        <table class="quality-table">
          <thead>
            <tr>
              <th>Teacher Name</th>
              <th>Quality Score</th>
              <th>Grid Completeness</th>
              <th>Missing Data Issues</th>
              <th>📚 Lessons</th>
              <th>🕐 Meetings</th>
              <th>☕ Free</th>
            </tr>
          </thead>
          <tbody>
            ${qualityMetrics
              .sort((a, b) => b.qualityScore - a.qualityScore)
              .map(
                (m) => {
                  let scoreClass = 'score-excellent';
                  if (m.qualityScore < 70) scoreClass = 'score-poor';
                  else if (m.qualityScore < 80) scoreClass = 'score-fair';
                  else if (m.qualityScore < 90) scoreClass = 'score-good';

                  const issuesHtml = m.issues.length
                    ? \`<ul>\${m.issues.map((i) => \`<li>\${i}</li>\`).join('')}</ul>\`
                    : '<em style="color: #28a745;">✓ No issues detected</em>';

                  return \`
                <tr>
                  <td class="teacher-name">\${escapeHtml(m.name)}</td>
                  <td class="quality-score \${scoreClass}">\${m.qualityScore}/100</td>
                  <td>\${m.completeness}% (\${m.captured}/\${m.total})</td>
                  <td class="issues-list">\${issuesHtml}</td>
                  <td style="text-align: center;">\${m.lessons}</td>
                  <td style="text-align: center;">\${m.meetings}</td>
                  <td style="text-align: center;">\${m.free}</td>
                </tr>
              \`;
                }
              )
              .join('')}
          </tbody>
        </table>

        <div class="insights-section">
          <h3>🔍 Quality Assessment Criteria</h3>
          <p><strong>Score Calculation:</strong> Based on completeness and data field accuracy (subjects, class names, venues).</p>
          <p><strong>Excellent (90-100):</strong> Timetable is complete with all required data fields filled.</p>
          <p><strong>Good (80-89):</strong> Mostly complete with minor data field gaps.</p>
          <p><strong>Fair (70-79):</strong> Significant gaps in either completeness or data fields.</p>
          <p><strong>Poor (&lt;70):</strong> Requires immediate attention for completeness and data quality.</p>
        </div>

        <div class="footer">
          <div>Timetable System – Data Quality Report</div>
          <div>Page 1 of 1</div>
          <div>${dateStr}</div>
        </div>
      </div>

      <button class="print-btn" onclick="window.print(); return false;">🖨️ Print Report</button>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(html);
  printWindow.document.close();
}

// ─────────────────────────────────────────────────────────────
// HELPER: Get stored config from any teacher
// ─────────────────────────────────────────────────────────────

function getStoredConfig() {
  const teachers = getAllTeacherNames();
  for (const name of teachers) {
    const key = getTeacherKey(name);
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const payload = JSON.parse(raw);
        if (payload.config) return payload.config;
      } catch {}
    }
  }
  return null;
}
