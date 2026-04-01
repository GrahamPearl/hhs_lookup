const PREFIX = "teacher_";
let teacherCache = {};
let coverAssignments = {};
let tallies = {};
let absentTeachers = [];

const METRICS_KEY = "teacherMetrics";

// Load metrics
function loadMetrics() {
  return JSON.parse(localStorage.getItem(METRICS_KEY) || "{}");
}

// Save metrics
function saveMetrics(metrics) {
  localStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
}

// Calculate total free periods for a teacher (weekly)
function calculateFreePeriods(name) {
  let data = loadTeacher(name);
  if (!data || !data.entries) return 0;

  return data.entries.filter((e) => e.type === "free").length;
}

// Ensure teacher exists in metrics
function ensureTeacherMetrics(name) {
  let metrics = loadMetrics();
  if (!metrics[name]) {
    metrics[name] = {
      freePeriods: calculateFreePeriods(name),
      coversDone: 0,
    };
    saveMetrics(metrics);
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

  // ✅ SAFELY attach metrics
  list.forEach((t) => {
    let m = metrics[t.name] || { freePeriods: 0, coversDone: 0 };
    t.freePeriods = m.freePeriods;
    t.coversDone = m.coversDone;
  });

  // ✅ SORT properly
  list.sort((a, b) => {
    if (b.freePeriods !== a.freePeriods) {
      return b.freePeriods - a.freePeriods;
    }
    return a.coversDone - b.coversDone;
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
        drop.style.minHeight = "2.5em";
        let assigned = coverAssignments[key];
        if (assigned) {
          drop.innerHTML = `<span class='badge bg-success'>${assigned}</span> <button class='btn btn-sm btn-danger ms-2' onclick=\"undo('${key}')\">Undo</button>`;
        } else {
          drop.innerHTML = "<small>Drop teacher here</small>";
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
              drop.innerHTML = "<small>Drop teacher here</small>";
            }, 1200);
            return;
          }
          coverAssignments[key] = t;

          let metrics = loadMetrics();
          ensureTeacherMetrics(t);

          metrics[t].coversDone += 1;
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
      avail.forEach(({ name, type }) => {
        let badge = document.createElement("span");
        badge.className =
          "badge me-1 avail-badge " +
          (type === "free" ? "bg-primary" : "bg-secondary");
        ensureTeacherMetrics(name);
        let metrics = loadMetrics();

        let m = metrics[name] || { freePeriods: 0, coversDone: 0 };

        let free = m.freePeriods;
        let covers = m.coversDone;

        badge.innerHTML = `
  ${name}
  <span class="badge bg-light text-dark ms-1">F:${free}</span>
  <span class="badge bg-warning text-dark ms-1">C:${covers}</span>
  ${type === "meeting" ? " (M)" : ""}
`;

        badge.draggable = true;
        badge.ondragstart = (ev) => ev.dataTransfer.setData("text", name);
        tdList.appendChild(badge);
      });
    }
    tr.appendChild(tdPeriod);
    tr.appendChild(tdList);
    availTbody.appendChild(tr);
  }
  availTable.appendChild(availTbody);
  availDiv.appendChild(availTable);
}

function undo(key) {
  delete coverAssignments[key];
  renderGrid();
}

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

document.getElementById("printBtn").onclick = () => {
  generatePDF();
};

document.getElementById("printBtn").onclick = () => {
  const printArea = document.getElementById("printArea");

  // Clone the already rendered grid (this contains correct assignments)
  const grid = document.getElementById("coverGrid");

  let clone = grid.cloneNode(true);

  // Clean up buttons (remove undo buttons for print)
  clone.querySelectorAll("button").forEach(btn => btn.remove());

  // Optional: make badges clearer in print
  clone.querySelectorAll(".badge").forEach(b => {
    b.style.fontSize = "0.9em";
  });

  let html = "<h3>Absent Teachers Cover Plan</h3>";
  html += clone.outerHTML;

  printArea.innerHTML = html;

  let modal = new bootstrap.Modal(document.getElementById('printPreviewModal'));
  modal.show();
};

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
      "Are you sure you want to clear all stored teacher timetables and cover plans?",
    )
  ) {
    // Remove all teacher timetable entries and cover plans
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(PREFIX) || k === "coverPlans") {
        localStorage.removeItem(k);
      }
    });
    teacherCache = {};
    coverAssignments = {};
    tallies = {};
    document.getElementById("status").innerText = "All data cleared.";
    refreshTeachers();
    renderGrid();
  }
};

document.getElementById("exportBtn").onclick = () => {
  let data = {
    coverAssignments,
    metrics: loadMetrics(),
  };

  let blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  let a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cover_backup.json";
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
    localStorage.setItem(METRICS_KEY, JSON.stringify(data.metrics || {}));

    renderGrid();
  });

refreshTeachers();
renderAbsentTeachersTable();
renderGrid();

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
        let assigned = coverAssignments[key] || "NOT ASSIGNED";

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