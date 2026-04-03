const PREFIX = "teacher_";
let teacherCache = {};
let coverAssignments = {};
let noCoverNeeded = {}; // Track lessons that don't need coverage
let tallies = {};
let absentTeachers = [];
let coverDate = new Date().toISOString().split('T')[0]; // Today's date

const METRICS_KEY = "teacherMetrics";
const HISTORY_KEY = "coverHistory";
const TEN_WEEK_START = "tenWeekStart"; // localStorage key for 10-week period start date

// Initialize 10-week period if not set
function initializeTenWeekPeriod() {
  if (!localStorage.getItem(TEN_WEEK_START)) {
    localStorage.setItem(TEN_WEEK_START, new Date().toISOString().split('T')[0]);
  }
}

// Get week number (1-10) based on cover date
function getWeekNumber(dateStr) {
  initializeTenWeekPeriod();
  const startDate = new Date(localStorage.getItem(TEN_WEEK_START));
  const date = new Date(dateStr);
  const diffTime = date - startDate;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(week, 1), 10); // Clamp to 1-10
}

// Load metrics with enhanced structure
function loadMetrics() {
  return JSON.parse(localStorage.getItem(METRICS_KEY) || "{}");
}

// Save metrics
function saveMetrics(metrics) {
  localStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
}

// Load cover history
function loadCoverHistory() {
  return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
}

// Save cover history
function saveCoverHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// Add history entry when a cover is assigned
function addCoverHistoryEntry(coveredTeacher, coverTeacher, period, day, subject, className, venue) {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  
  history.push({
    date: coverDate,
    week: week,
    coveredTeacher: coveredTeacher,
    coverTeacher: coverTeacher,
    day: day,
    period: period,
    subject: subject || "Unknown",
    className: className || "Unknown",
    venue: venue || "Unknown",
    timestamp: new Date().toISOString()
  });
  
  saveCoverHistory(history);
}

// Calculate total free periods for a teacher (weekly)
function calculateFreePeriods(name) {
  let data = loadTeacher(name);
  if (!data || !data.entries) return 0;

  return data.entries.filter((e) => e.type === "free").length;
}

// Ensure teacher exists in metrics with enhanced structure
function ensureTeacherMetrics(name) {
  let metrics = loadMetrics();
  if (!metrics[name]) {
    metrics[name] = {
      freePeriods: calculateFreePeriods(name),
      coversDone: 0,
      coversThisWeek: 0,
      totalCovers: 0,
      lastCoverDate: null
    };
    saveMetrics(metrics);
  }
}

// Calculate covers per week average
function getCoversPerWeekAverage(coverTeacher) {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  
  const relevantEntries = history.filter(h => h.coverTeacher === coverTeacher && h.week <= week);
  if (relevantEntries.length === 0) return 0;
  
  return (relevantEntries.length / week).toFixed(2);
}

// Get covers done this week
function getCoversThisWeek(coverTeacher) {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  
  return history.filter(h => h.coverTeacher === coverTeacher && h.week === week).length;
}

// Get total covers for the 10-week period
function getTotalCovers(coverTeacher) {
  const history = loadCoverHistory();
  return history.filter(h => h.coverTeacher === coverTeacher).length;
}

// Auto-prune entries older than 10 weeks
function autoPruneOldEntries() {
  const history = loadCoverHistory();
  const tenWeekStart = localStorage.getItem(TEN_WEEK_START);
  if (!tenWeekStart) return;
  
  const startDate = new Date(tenWeekStart);
  const twoWeeksAgo = new Date(startDate);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() + 70); // 10 weeks = 70 days
  
  const prunedHistory = history.filter(h => {
    const entryDate = new Date(h.date);
    return entryDate >= twoWeeksAgo;
  });
  
  if (prunedHistory.length !== history.length) {
    saveCoverHistory(prunedHistory);
  }
}

// Initialize or update 10-week period
function initializePeriodModal() {
  const startDate = localStorage.getItem(TEN_WEEK_START);
  const dateInput = document.getElementById("tenWeekStartDate");
  
  if (startDate) {
    dateInput.value = startDate;
  } else {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
  }
  
  updatePeriodStatus();
}

// Update period status display
function updatePeriodStatus() {
  const startDate = localStorage.getItem(TEN_WEEK_START);
  if (!startDate) {
    document.getElementById("periodStatus").innerHTML = "Not set. Will initialize on first use.";
    return;
  }
  
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 69); // 10 weeks
  
  const today = new Date();
  const weeksElapsed = Math.floor((today - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
  
  document.getElementById("periodStatus").innerHTML = 
    `Started: ${start.toDateString()}<br>Ends: ${end.toDateString()}<br>Week: ${Math.min(weeksElapsed, 10)} of 10`;
}

// Display cover history in modal
function displayCoverHistory() {
  const history = loadCoverHistory();
  const tbody = document.getElementById("historyTableBody");
  tbody.innerHTML = "";
  
  if (history.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6' class='text-center text-muted'>No cover history yet</td></tr>";
    return;
  }
  
  history.forEach(entry => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${entry.date}</td>
      <td>${entry.week}</td>
      <td>${entry.coveredTeacher}</td>
      <td>${entry.coverTeacher}</td>
      <td>${entry.period}</td>
      <td>${entry.subject}</td>
    `;
    tbody.appendChild(row);
  });
}

// Check and display fairness warnings
function checkFairnessWarnings() {
  const history = loadCoverHistory();
  const week = getWeekNumber(coverDate);
  
  const teachers = new Set(history.map(h => h.coverTeacher));
  const coversPerTeacher = {};
  
  teachers.forEach(t => {
    coversPerTeacher[t] = history.filter(h => h.coverTeacher === t && h.week === week).length;
  });
  
  let warnings = [];
  Object.keys(coversPerTeacher).forEach(teacher => {
    if (coversPerTeacher[teacher] > 3) {
      warnings.push(`${teacher} has ${coversPerTeacher[teacher]} covers this week (unfair load)`);
    }
  });
  
  const warningDiv = document.getElementById("fairnessWarning");
  if (warnings.length > 0) {
    warningDiv.innerHTML = warnings.map(w => `⚠️ ${w}`).join("<br>");
    warningDiv.classList.remove("d-none");
  } else {
    warningDiv.classList.add("d-none");
  }
}

function getAvailableTeachers(period, day, absentList = []) {
  let list = [];

  // Find teachers already assigned as cover for this period
  let assignedCovers = new Set();
  Object.keys(coverAssignments).forEach((key) => {
    let parts = key.split(":");
    if (parts.length === 2) {
      let [_, dp] = parts;
      let [d, p] = dp.split("-");
      if (parseInt(d) === day && parseInt(p) === period) {
        assignedCovers.add(coverAssignments[key]);
      }
    }
  });

  Object.keys(localStorage).forEach((k) => {
    if (!k.startsWith(PREFIX)) return;

    let name = k.replace(PREFIX, "");
    if (absentList.includes(name)) return;
    if (assignedCovers.has(name)) return;

    let data = JSON.parse(localStorage.getItem(k));
    let entry = data.entries?.find((e) => e.row == day && e.col == period);

    if (entry && (entry.type === "free" || entry.type === "meeting")) {
      list.push({ name, type: entry.type });
    }
  });

  // ✅ ENSURE metrics exist FIRST
  list.forEach((t) => ensureTeacherMetrics(t.name));

  // ✅ RELOAD metrics AFTER ensuring
  let metrics = loadMetrics();

  // ✅ ATTACH enhanced metrics
  list.forEach((t) => {
    let m = metrics[t.name] || { freePeriods: 0, coversDone: 0 };
    t.freePeriods = m.freePeriods;
    t.coversDone = m.coversDone;
    t.coversThisWeek = getCoversThisWeek(t.name);
    t.totalCovers = getTotalCovers(t.name);
    t.coversPerWeek = getCoversPerWeekAverage(t.name);
  });

  // ✅ IMPROVED FAIRNESS SORTING
  // Sort by: lowest covers ever -> lowest this week -> lowest per-week-average -> most free periods
  list.sort((a, b) => {
    // First: who has done the least covers overall
    if (a.totalCovers !== b.totalCovers) {
      return a.totalCovers - b.totalCovers;
    }
    // Second: who has done the least this week
    if (a.coversThisWeek !== b.coversThisWeek) {
      return a.coversThisWeek - b.coversThisWeek;
    }
    // Third: lowest per-week average
    if (parseFloat(a.coversPerWeek) !== parseFloat(b.coversPerWeek)) {
      return parseFloat(a.coversPerWeek) - parseFloat(b.coversPerWeek);
    }
    // Fourth: most free periods available
    return b.freePeriods - a.freePeriods;
  });

  return list;
}

function refreshTeachers() {
  // For adding absent teachers
  let sel = document.getElementById("addAbsenceTeacherSelect");
  if (!sel) return;
  sel.innerHTML = "";
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith(PREFIX)) {
      let name = k.replace(PREFIX, "");
      if (!absentTeachers.includes(name)) {
        let o = document.createElement("option");
        o.value = name;
        o.textContent = name;
        sel.appendChild(o);
      }
    }
  });
}

function loadTeacher(name) {
  if (!teacherCache[name]) {
    teacherCache[name] = JSON.parse(localStorage.getItem(PREFIX + name));
  }
  return teacherCache[name];
}

function renderAbsentTeachersTable() {
  const tableBody = document.querySelector("#absentTeachersTable tbody");
  tableBody.innerHTML = "";
  absentTeachers.forEach((name, idx) => {
    let tr = document.createElement("tr");
    let tdName = document.createElement("td");
    tdName.textContent = name;
    let tdActions = document.createElement("td");
    let btn = document.createElement("button");
    btn.className = "btn btn-sm btn-danger";
    btn.textContent = "Remove";
    btn.onclick = () => {
      absentTeachers.splice(idx, 1);
      refreshTeachers();
      renderAbsentTeachersTable();
      renderGrid();
    };
    tdActions.appendChild(btn);
    tr.appendChild(tdName);
    tr.appendChild(tdActions);
    tableBody.appendChild(tr);
  });
}

function renderGrid() {
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const grid = document.getElementById("coverGrid");
  grid.innerHTML = "";

  if (absentTeachers.length === 0) {
    grid.innerHTML =
      "<div class='alert alert-info'>No absent teachers selected.</div>";
    document.getElementById("availableCoverList").innerHTML = "";
    return;
  }

  // Table for all absent teachers and their lessons
  let table = document.createElement("table");
  table.className = "table table-bordered";
  let absentThead = document.createElement("thead");
  let absentTrh = document.createElement("tr");
  absentTrh.innerHTML =
    "<th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assign Cover</th>";
  absentThead.appendChild(absentTrh);
  table.appendChild(absentThead);
  let absentTbody = document.createElement("tbody");

  absentTeachers.forEach((teacher) => {
    let data = loadTeacher(teacher);
    if (!data) return;
    let lessons = data.entries.filter((e) => e.row == day);
    lessons.sort((a, b) => a.col - b.col);
    lessons.forEach((e) => {
      if (e.col === 6) return; // skip period 7
      let tr = document.createElement("tr");
      tr.innerHTML = `<td>${teacher}</td><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ""}</td><td>${e.venue || ""}</td>`;
      let tdAssign = document.createElement("td");
      if (e.type === "lesson") {
        let key = teacher + ":" + day + "-" + e.col;
        let drop = document.createElement("div");
        drop.className = "border p-2";
        drop.style.minHeight = "3em";
        
        let assigned = coverAssignments[key];
        let noCover = noCoverNeeded[key];
        
        if (assigned) {
          drop.innerHTML = `<span class='badge bg-success'>${assigned}</span> <button class='btn btn-sm btn-danger ms-2' onclick=\"undo('${key}')\">Undo</button>`;
        } else if (noCover) {
          drop.innerHTML = `<span class='badge bg-secondary'>No Cover Needed</span> <button class='btn btn-sm btn-warning ms-2' onclick=\"undoNoCover('${key}')\">Assign</button>`;
          drop.style.backgroundColor = "#f8f9fa";
        } else {
          drop.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
              <small class="text-muted">Drop teacher here</small>
              <button class='btn btn-sm btn-outline-secondary' onclick=\"markNoCover('${key}')\" title="Mark as no cover needed">✗</button>
            </div>
          `;
        }
        
        drop.ondragover = (ev) => ev.preventDefault();
        drop.ondrop = (ev) => {
          ev.preventDefault();

          let t = ev.dataTransfer.getData("text");
          let available = getAvailableTeachers(e.col, day, absentTeachers).map(
            (obj) => obj.name,
          );
          if (!available.includes(t)) {
            drop.innerHTML = `<span class='text-danger'>Teacher not available</span>`;
            setTimeout(() => {
              drop.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                  <small class="text-muted">Drop teacher here</small>
                  <button class='btn btn-sm btn-outline-secondary' onclick=\"markNoCover('${key}')\" title="Mark as no cover needed">✗</button>
                </div>
              `;
            }, 1200);
            return;
          }
          
          // Remove from no cover if it was marked as such
          if (noCoverNeeded[key]) {
            delete noCoverNeeded[key];
          }
          
          coverAssignments[key] = t;

          // Record the cover in history
          addCoverHistoryEntry(
            teacher,
            t,
            e.col + 1,
            day + 1,
            e.subject || e.type,
            e.className,
            e.venue
          );

          let metrics = loadMetrics();
          ensureTeacherMetrics(t);

          metrics[t].coversDone += 1;
          metrics[t].totalCovers = getTotalCovers(t);
          metrics[t].coversThisWeek = getCoversThisWeek(t);
          metrics[t].lastCoverDate = coverDate;
          saveMetrics(metrics);

          renderGrid();
        };
        tdAssign.appendChild(drop);
      }
      tr.appendChild(tdAssign);
      absentTbody.appendChild(tr);
    });
  });
  table.appendChild(absentTbody);
  grid.appendChild(table);

  // Render available cover teachers in a table by period (1-6)
  let availDiv = document.getElementById("availableCoverList");
  availDiv.innerHTML = "";
  let availTable = document.createElement("table");
  availTable.className = "table table-bordered table-sm";
  let availThead = document.createElement("thead");
  let availTrh = document.createElement("tr");
  availTrh.innerHTML = "<th>Period</th><th>Available Teachers</th>";
  availThead.appendChild(availTrh);
  availTable.appendChild(availThead);
  let availTbody = document.createElement("tbody");
  for (let period = 0; period < 6; period++) {
    let avail = getAvailableTeachers(period, day, absentTeachers);
    let tr = document.createElement("tr");
    let tdPeriod = document.createElement("td");
    tdPeriod.textContent = `Period ${period + 1}`;
    let tdList = document.createElement("td");
    if (avail.length === 0) {
      tdList.innerHTML = '<span class="text-muted">None</span>';
    } else {
      avail.forEach((teacher) => {
        let badge = document.createElement("span");
        badge.className =
          "badge me-1 avail-badge " +
          (teacher.type === "free" ? "bg-primary" : "bg-secondary");
        
        let warningClass = "";
        if (teacher.totalCovers > 5) warningClass = " border border-danger";

        badge.innerHTML = `
  ${teacher.name}
  <span class="badge bg-light text-dark ms-1" title="Total covers">T:${teacher.totalCovers}</span>
  <span class="badge bg-light text-dark ms-1" title="This week">W:${teacher.coversThisWeek}</span>
  <span class="badge bg-light text-dark ms-1" title="Per-week avg">A:${teacher.coversPerWeek}</span>
  <span class="badge bg-light text-dark ms-1" title="Free periods">F:${teacher.freePeriods}</span>
  ${teacher.type === "meeting" ? " (M)" : ""}
`;

        badge.draggable = true;
        badge.ondragstart = (ev) => ev.dataTransfer.setData("text", teacher.name);
        if (warningClass) badge.className += warningClass;
        tdList.appendChild(badge);
      });
    }
    tr.appendChild(tdPeriod);
    tr.appendChild(tdList);
    availTbody.appendChild(tr);
  }
  availTable.appendChild(availTbody);
  availDiv.appendChild(availTable);
  
  // Check and display fairness warnings
  checkFairnessWarnings();
}

function undo(key) {
  // Remove from history
  const history = loadCoverHistory();
  const [teacher, dp] = key.split(":");
  const [d, p] = dp.split("-");
  
  const filteredHistory = history.filter(h => 
    !(h.coveredTeacher === teacher && h.day === (parseInt(d) + 1) && h.period === (parseInt(p) + 1))
  );
  saveCoverHistory(filteredHistory);
  
  delete coverAssignments[key];
  renderGrid();
}

// Mark a lesson as not needing cover
function markNoCover(key) {
  noCoverNeeded[key] = true;
  renderGrid();
}

// Undo the "no cover needed" marking
function undoNoCover(key) {
  delete noCoverNeeded[key];
  renderGrid();
}

// Auto-assign cover teachers using fairness algorithm
function autoAssignCoverTeachers() {
  if (absentTeachers.length === 0) {
    alert("No absent teachers to assign covers for.");
    return;
  }

  const day = parseInt(document.getElementById("absenceDaySelect").value);
  let assignmentsMade = 0;
  let conflicts = 0;

  // Track which teachers are already assigned to avoid double-booking
  let assignedTeachers = new Set();
  Object.values(coverAssignments).forEach(teacher => assignedTeachers.add(teacher));

  absentTeachers.forEach((teacher) => {
    let data = loadTeacher(teacher);
    if (!data) return;
    
    let lessons = data.entries.filter((e) => e.row == day && e.type === "lesson");
    lessons.sort((a, b) => a.col - b.col);
    
    lessons.forEach((e) => {
      if (e.col === 6) return; // skip period 7
      
      let key = teacher + ":" + day + "-" + e.col;
      
      // Skip if already assigned or marked as no cover needed
      if (coverAssignments[key] || noCoverNeeded[key]) return;
      
      // Get available teachers for this period, excluding already assigned ones
      let availableTeachers = getAvailableTeachers(e.col, day, absentTeachers);
      
      // Filter out teachers already assigned in this auto-assign session
      availableTeachers = availableTeachers.filter(t => !assignedTeachers.has(t.name));
      
      if (availableTeachers.length > 0) {
        // Pick the best teacher (first in sorted list - most fair)
        let bestTeacher = availableTeachers[0];
        
        // Assign the teacher
        coverAssignments[key] = bestTeacher.name;
        assignedTeachers.add(bestTeacher.name);
        
        // Record in history
        addCoverHistoryEntry(
          teacher,
          bestTeacher.name,
          e.col + 1,
          day + 1,
          e.subject || e.type,
          e.className,
          e.venue
        );
        
        // Update metrics
        let metrics = loadMetrics();
        ensureTeacherMetrics(bestTeacher.name);
        
        metrics[bestTeacher.name].coversDone += 1;
        metrics[bestTeacher.name].totalCovers = getTotalCovers(bestTeacher.name);
        metrics[bestTeacher.name].coversThisWeek = getCoversThisWeek(bestTeacher.name);
        metrics[bestTeacher.name].lastCoverDate = coverDate;
        saveMetrics(metrics);
        
        assignmentsMade++;
      } else {
        conflicts++;
      }
    });
  });
  
  renderGrid();
  
  // Show results
  let message = `Auto-assignment complete!\n\nAssignments made: ${assignmentsMade}`;
  if (conflicts > 0) {
    message += `\nUnassigned lessons: ${conflicts} (no suitable teachers available)`;
  }
  alert(message);
}

// Update week display based on date
function updateWeekDisplay() {
  const week = getWeekNumber(coverDate);
  document.getElementById("weekDisplay").textContent = week;
}

// Initialize date picker with today's date
function initializeDatePicker() {
  const dateInput = document.getElementById("coverDate");
  dateInput.value = coverDate;
  updateWeekDisplay();
}

document.getElementById("coverDate").addEventListener("change", (e) => {
  coverDate = e.target.value;
  updateWeekDisplay();
  renderGrid();
});

document.getElementById("absenceDaySelect").onchange = () => {
  renderGrid();
};

document.getElementById("addAbsenceTeacherBtn").onclick = () => {
  let sel = document.getElementById("addAbsenceTeacherSelect");
  let name = sel.value;
  if (name && !absentTeachers.includes(name)) {
    absentTeachers.push(name);
    refreshTeachers();
    renderAbsentTeachersTable();
    renderGrid();
  }
};

document.getElementById("saveBtn").onclick = () => {
  localStorage.setItem("coverPlans", JSON.stringify(coverAssignments));
  alert("Saved");
};

document.getElementById("autoAssignBtn").onclick = () => {
  if (confirm("This will automatically assign the most fair cover teachers to all unassigned lessons. Continue?")) {
    autoAssignCoverTeachers();
  }
};

document.getElementById("printBtn").onclick = () => {
  if (absentTeachers.length === 0) {
    alert("No absent teachers selected. Please add absent teachers first.");
    return;
  }

  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const tableHtml = buildCoverGridTableHtml(day, true);

  let win = window.open("", "_blank", "width=1100,height=850");
  win.document.write("<html><head><title>Cover Grid Print Preview</title>");
  win.document.write(
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">',
  );
  win.document.write(`
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
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  `);
  win.document.write("</head><body>");
  win.document.write(tableHtml);
  win.document.write("</body></html>");
  win.document.close();
  win.focus();

  const setupActions = () => {
    try {
      const doc = win.document;
      const rows = getCoverPlanRows(day);
      const makeText = () =>
        rows.map((r) => `${r.teacher} | P${r.period} | ${r.subject} | ${r.className} | ${r.venue} | ${r.assigned}`).join("\n");

      doc.getElementById("printPageBtn").onclick = () => win.print();

      doc.getElementById("downloadPdfBtn").onclick = () => {
        const { jsPDF } = window.jspdf;
        const content = doc.querySelector('.container');
        if (!content) return;

        win.html2canvas(content, { scale: 2 }).then((canvas) => {
          const imgData = canvas.toDataURL('image/png');
          const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = pdf.internal.pageSize.getHeight();
          const imgWidth = canvas.width;
          const imgHeight = canvas.height;
          const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
          const imgScaledWidth = imgWidth * ratio;
          const imgScaledHeight = imgHeight * ratio;

          if (imgScaledHeight <= pdfHeight) {
            pdf.addImage(imgData, 'PNG', 0, 0, imgScaledWidth, imgScaledHeight);
          } else {
            let remainingHeight = imgHeight;
            let position = 0;
            while (remainingHeight > 0) {
              const canvasPage = document.createElement('canvas');
              canvasPage.width = imgWidth;
              canvasPage.height = Math.min(remainingHeight, Math.floor(pdfHeight / ratio));
              const ctx = canvasPage.getContext('2d');
              ctx.drawImage(canvas, 0, position, imgWidth, canvasPage.height, 0, 0, imgWidth, canvasPage.height);

              const pageData = canvasPage.toDataURL('image/png');
              const pageScaledHeight = canvasPage.height * ratio;
              pdf.addImage(pageData, 'PNG', 0, 0, imgScaledWidth, pageScaledHeight);

              remainingHeight -= canvasPage.height;
              position += canvasPage.height;

              if (remainingHeight > 0) pdf.addPage();
            }
          }

          pdf.save(`cover_plan_day_${day + 1}.pdf`);
        }).catch((err) => {
          console.error('pdf generation failed', err);
          alert('Error generating PDF: ' + err);
        });
      };

      doc.getElementById("downloadPngBtn").onclick = () => {
        const content = doc.querySelector('.container');
        if (!content) return;
        win.html2canvas(content, { scale: 2 }).then((canvas) => {
          const link = doc.createElement('a');
          link.download = `cover_plan_day_${day + 1}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
        }).catch((err) => {
          console.error('png capture failed', err);
          alert('Error generating image: ' + err);
        });
      };

      doc.getElementById("emailExportBtn").onclick = () => {
        const subject = encodeURIComponent(`Absent Teachers Cover Plan - Day ${day + 1}`);
        const body = encodeURIComponent("" + makeText());
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      };
    } catch {
      // this can fail if window is blocked; ignore
    }
  };

  if (win.document.readyState === "complete") {
    setupActions();
  } else {
    win.addEventListener("load", setupActions);
  }
};

function getCoverPlanRows(day) {
  let rows = [];
  absentTeachers.forEach((teacher) => {
    let data = loadTeacher(teacher);
    if (!data) return;
    let lessons = data.entries.filter((e) => e.row == day);
    lessons.sort((a, b) => a.col - b.col);

    lessons.forEach((e) => {
      if (e.col === 6) return;
      let key = teacher + ":" + day + "-" + e.col;
      let assigned = coverAssignments[key] || "";
      rows.push({
        teacher,
        period: e.col + 1,
        subject: e.subject || e.type,
        className: e.className || "",
        venue: e.venue || "",
        assigned,
      });
    });
  });
  return rows;
}

function buildCoverGridTableHtml(day, includeActions = false) {
  let rows = getCoverPlanRows(day);
  let html = `<div class="container p-4" id="coverPrintContainer"><h3>Absent Teachers Cover Plan - Day ${day + 1}</h3>`;

  if (includeActions) {
    html += `<div class="mb-3 no-print">
      <button id="printPageBtn" class="btn btn-primary me-2">Print</button>
      <button id="downloadPdfBtn" class="btn btn-success me-2">Save as PDF</button>
      <button id="downloadPngBtn" class="btn btn-secondary me-2">Save as Image</button>
      <button id="emailExportBtn" class="btn btn-info">Email</button>
    </div>`;
  }

  if (rows.length === 0) {
    html += "<div class='alert alert-info'>No absent teacher lessons found for the selected day.</div>";
    html += "</div>";
    return html;
  }

  html +=
    '<table class="table table-bordered"><thead><tr><th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assigned Cover</th></tr></thead><tbody>';

  rows.forEach((r) => {
    html += `<tr><td>${r.teacher}</td><td>${r.period}</td><td>${r.subject}</td><td>${r.className}</td><td>${r.venue}</td><td>${r.assigned}</td></tr>`;
  });

  html += "</tbody></table></div>";
  return html;
}

document.getElementById("confirmPrintBtn").onclick = () => {
  // Print only the printArea content
  const printArea = document.getElementById("printArea");
  let win = window.open("", "", "width=900,height=700");
  win.document.write("<html><head><title>Print Cover Plan</title>");
  win.document.write(
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">',
  );
  win.document.write("</head><body>");
  win.document.write(printArea.innerHTML);
  win.document.write("</body></html>");
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
  // Build the table HTML as in print
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  let html = "<h3>Absent Teachers Cover Plan</h3>";
  html +=
    '<table border="1" cellpadding="5" cellspacing="0"><thead><tr><th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assigned Cover</th></tr></thead><tbody>';
  absentTeachers.forEach((teacher) => {
    let data = loadTeacher(teacher);
    if (!data) return;
    let lessons = data.entries.filter((e) => e.row == day);
    lessons.sort((a, b) => a.col - b.col);
    lessons.forEach((e) => {
      if (e.col === 6) return;
      if (e.type !== "lesson") return;
      let key = teacher + ":" + day + "-" + e.col;
      let assigned = coverAssignments[key] || "";
      html += `<tr><td>${teacher}</td><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ""}</td><td>${e.venue || ""}</td><td>${assigned}</td></tr>`;
    });
  });
  html += "</tbody></table>";
  // Use mailto: (user must send manually)
  let subject = encodeURIComponent("Absent Teachers Cover Plan");
  let body = encodeURIComponent(html.replace(/<[^>]+>/g, ""));
  window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
};

// BULK IMPORT
document.getElementById("bulkBtn").onclick = () => {
  document.getElementById("bulkInput").click();
};

document.getElementById("bulkInput").addEventListener("change", async (e) => {
  let files = Array.from(e.target.files);
  let count = 0;

  for (let f of files) {
    if (!f.name.endsWith(".json")) continue;
    let txt = await f.text();
    let data = JSON.parse(txt);
    let name = data.teacherName || f.name.replace(".json", "");
    localStorage.setItem(PREFIX + name, JSON.stringify(data));
    count++;
  }

  document.getElementById("status").innerText = "Imported " + count;
  refreshTeachers();
  renderGrid();
});

document.getElementById("clearBtn").onclick = () => {
  if (
    confirm(
      "Are you sure you want to clear ALL data? This includes timetables, covers, metrics, and history.",
    )
  ) {
    // Remove all teacher timetable entries and cover plans
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(PREFIX) || k === "coverPlans" || k === METRICS_KEY || k === HISTORY_KEY) {
        localStorage.removeItem(k);
      }
    });
    teacherCache = {};
    coverAssignments = {};
    noCoverNeeded = {};
    tallies = {};
    document.getElementById("status").innerText = "All data cleared.";
    refreshTeachers();
    renderAbsentTeachersTable();
    renderGrid();
  }
};

document.getElementById("exportBtn").onclick = () => {
  let data = {
    coverAssignments,
    noCoverNeeded,
    metrics: loadMetrics(),
    history: loadCoverHistory(),
    tenWeekStart: localStorage.getItem(TEN_WEEK_START)
  };

  let blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  let a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cover_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
};

document.getElementById("importBtn").onclick = () => {
  document.getElementById("importMetricsInput").click();
};

document
  .getElementById("importMetricsInput")
  .addEventListener("change", async (e) => {
    let file = e.target.files[0];
    if (!file) return;

    let text = await file.text();
    let data = JSON.parse(text);

    coverAssignments = data.coverAssignments || {};
    noCoverNeeded = data.noCoverNeeded || {};
    localStorage.setItem(METRICS_KEY, JSON.stringify(data.metrics || {}));
    
    // Restore history and 10-week start if available
    if (data.history) {
      saveCoverHistory(data.history);
    }
    if (data.tenWeekStart) {
      localStorage.setItem(TEN_WEEK_START, data.tenWeekStart);
    }

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

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [];
  summaryData.push(["Teacher", "Total Covers", "Covers This Week", "Per-Week Average", "Free Periods"]);
  
  Object.keys(metrics).forEach((teacher) => {
    const totalCovers = getTotalCovers(teacher);
    const coversThisWeek = getCoversThisWeek(teacher);
    const coversPerWeek = getCoversPerWeekAverage(teacher);
    const freePeriods = metrics[teacher].freePeriods || 0;
    
    summaryData.push([
      teacher,
      totalCovers,
      coversThisWeek,
      parseFloat(coversPerWeek).toFixed(2),
      freePeriods
    ]);
  });

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  // Sheet 2: Weekly Breakdown
  const weeklyData = [];
  weeklyData.push(["Teacher", "Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6", "Week 7", "Week 8", "Week 9", "Week 10"]);
  
  const teachers = new Set(history.map(h => h.coverTeacher));
  teachers.forEach((teacher) => {
    const row = [teacher];
    for (let week = 1; week <= 10; week++) {
      const count = history.filter(h => h.coverTeacher === teacher && h.week === week).length;
      row.push(count);
    }
    weeklyData.push(row);
  });

  const weeklySheet = XLSX.utils.aoa_to_sheet(weeklyData);
  XLSX.utils.book_append_sheet(wb, weeklySheet, "Weekly Breakdown");

  // Sheet 3: Detailed History
  const detailedData = [];
  detailedData.push(["Date", "Week", "Covered Teacher", "Cover Teacher", "Day", "Period", "Subject", "Class", "Venue"]);
  
  history.forEach((entry) => {
    detailedData.push([
      entry.date,
      entry.week,
      entry.coveredTeacher,
      entry.coverTeacher,
      entry.day,
      entry.period,
      entry.subject,
      entry.className,
      entry.venue
    ]);
  });

  const detailedSheet = XLSX.utils.aoa_to_sheet(detailedData);
  XLSX.utils.book_append_sheet(wb, detailedSheet, "Detailed History");

  // Sheet 4: Statistics
  const statsData = [];
  const totalCovers = history.length;
  const uniqueTeachers = teachers.size;
  const avgCoversPerTeacher = (totalCovers / uniqueTeachers).toFixed(2);
  const minCovers = Math.min(...Array.from(teachers).map(t => getTotalCovers(t)));
  const maxCovers = Math.max(...Array.from(teachers).map(t => getTotalCovers(t)));
  
  statsData.push(["Statistic", "Value"]);
  statsData.push(["Total Cover Sessions", totalCovers]);
  statsData.push(["Number of Teachers", uniqueTeachers]);
  statsData.push(["Average Covers per Teacher", avgCoversPerTeacher]);
  statsData.push(["Minimum Covers", minCovers]);
  statsData.push(["Maximum Covers", maxCovers]);
  statsData.push(["Fairness Ratio (Max/Min)", (maxCovers / minCovers).toFixed(2)]);
  
  const statsSheet = XLSX.utils.aoa_to_sheet(statsData);
  XLSX.utils.book_append_sheet(wb, statsSheet, "Statistics");

  // Download file
  XLSX.writeFile(wb, `cover_report_${new Date().toISOString().split('T')[0]}.xlsx`);
};

refreshTeachers();
renderAbsentTeachersTable();
renderGrid();
initializeDatePicker();

// Initialize 10-week period on page load
initializeTenWeekPeriod();
autoPruneOldEntries();

// Event handler for View History modal
document.addEventListener('show.bs.modal', (e) => {
  if (e.target.id === 'historyModal') {
    displayCoverHistory();
  } else if (e.target.id === 'tenWeekModal') {
    initializePeriodModal();
  }
});

// Sidebar hover trigger click handler
document.querySelector('.sidebar-hover-trigger')?.addEventListener('click', () => {
  const sidebar = document.getElementById('sidebarContainer');
  sidebar.style.left = sidebar.style.left === '0px' ? '-350px' : '0';
});

// Period modal save button
document.getElementById("savePeriodBtn").onclick = () => {
  const newStartDate = document.getElementById("tenWeekStartDate").value;
  if (newStartDate) {
    localStorage.setItem(TEN_WEEK_START, newStartDate);
    updatePeriodStatus();
    updateWeekDisplay();
    renderGrid();
    alert("10-week period updated!");
  }
};

// Period modal reset button
document.getElementById("resetPeriodBtn").onclick = () => {
  if (confirm("Reset the 10-week period? This will mark today as Week 1.")) {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(TEN_WEEK_START, today);
    document.getElementById("tenWeekStartDate").value = today;
    updatePeriodStatus();
    coverDate = today;
    document.getElementById("coverDate").value = today;
    updateWeekDisplay();
    renderGrid();
    alert("10-week period has been reset!");
  }
};

async function generatePDF() {
  try {
    if (!window.jspdf) {
      alert("jsPDF library not loaded. Please check your internet connection.");
      return;
    }
    if (absentTeachers.length === 0) {
      alert("No absent teachers selected. Please add absent teachers first.");
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape" });

    const day = parseInt(document.getElementById("absenceDaySelect").value) + 1;

    let y = 15;

    // Title
    doc.setFontSize(16);
    doc.text(`Absent Teachers Cover Plan - Day ${day}`, 14, y);
    y += 10;

    doc.setFontSize(10);

    absentTeachers.forEach((teacher) => {
      let data = loadTeacher(teacher);
      if (!data) return;

      let lessons = data.entries.filter((e) => e.row == (day - 1) && e.type === "lesson");
      lessons.sort((a, b) => a.col - b.col);

      if (lessons.length === 0) return;

      // Teacher heading
      doc.setFont(undefined, "bold");
      doc.text(teacher, 14, y);
      y += 6;

      doc.setFont(undefined, "normal");

      lessons.forEach((e) => {
        let key = teacher + ":" + (day - 1) + "-" + e.col;
        let assigned = coverAssignments[key] || "⚠ NOT ASSIGNED";

        let line = `P${e.col + 1} | ${e.subject || ""} | ${e.className || ""} | ${e.venue || ""} | Cover: ${assigned}`;

        // Wrap text if too long
        let split = doc.splitTextToSize(line, 180);
        doc.text(split, 16, y);
        y += split.length * 5;

        // Page break if needed
        if (y > 270) {
          doc.addPage();
          y = 15;
        }
      });

      y += 4; // spacing between teachers
    });

    // Generate blob and open in new tab
    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    window.open(url);
  } catch (error) {
    alert("Error generating PDF: " + error.message);
  }
}