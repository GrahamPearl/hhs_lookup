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

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAllTeacherNames() {
  try {
    return Object.keys(localStorage)
      .filter(key => key.startsWith("teacher_"))
      .map(key => key.replace("teacher_", ""));
  } catch {
    return [];
  }
}

function getTeacherKey(name) {
    const t = normalizeTeacherName(name);
    return t ? STORAGE_PREFIX + t : "";
  }

  function normalizeTeacherName(name) {
    return (name || "").trim().replace(/\s+/g, " ");
  }

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
      <link rel="stylesheet" href=".././css/print1.css">
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
        <link rel="stylesheet" href=".././css/print2.css">
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
      <link rel="stylesheet" href=".././css/print3.css">
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
                (s) => `<tr>
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
      <link rel="stylesheet" href=".././css/print4.css">
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
      <link rel="stylesheet" href=".././css/print5.css">
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
              `;
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
      <link rel="stylesheet" href=".././css/print6.css">
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

                  let issuesHtml = "";

if (m.issues.length) {
  const listItems = m.issues.map(function(i) {
    return "<li>" + i + "</li>";
  }).join("");

  issuesHtml = "<ul>" + listItems + "</ul>";
} else {
  issuesHtml = '<em style="color: #28a745;">✓ No issues detected</em>';
}

                  return `
                <tr>
                  <td class="teacher-name">\${escapeHtml(m.name)}</td>
                  <td class="quality-score \${scoreClass}">\${m.qualityScore}/100</td>
                  <td>\${m.completeness}% (\${m.captured}/\${m.total})</td>
                  <td class="issues-list">\${issuesHtml}</td>
                  <td style="text-align: center;">\${m.lessons}</td>
                  <td style="text-align: center;">\${m.meetings}</td>
                  <td style="text-align: center;">\${m.free}</td>
                </tr>
              `;
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
