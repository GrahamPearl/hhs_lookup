
const PREFIX = "teacher_";
let teacherCache = {};
let coverAssignments = {};
let tallies = {};
let absentTeachers = [];

function getAvailableTeachers(period, day, absentList = []) {
  let list = [];
  Object.keys(localStorage).forEach((k) => {
    if (!k.startsWith(PREFIX)) return;
    let name = k.replace(PREFIX, "");
    if (absentList.includes(name)) return;
    let data = JSON.parse(localStorage.getItem(k));
    let entry = data.entries?.find((e) => e.row == day && e.col == period);
    if (entry && (entry.type === "free" || entry.type === "meeting")) {
      list.push({ name, type: entry.type });
    }
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
    grid.innerHTML = "<div class='alert alert-info'>No absent teachers selected.</div>";
    document.getElementById("availableCoverList").innerHTML = "";
    return;
  }

  // Table for all absent teachers and their lessons
  let table = document.createElement("table");
  table.className = "table table-bordered";
  let absentThead = document.createElement("thead");
  let absentTrh = document.createElement("tr");
  absentTrh.innerHTML = "<th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assign Cover</th>";
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
      tr.innerHTML = `<td>${teacher}</td><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ''}</td><td>${e.venue || ''}</td>`;
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
          let available = getAvailableTeachers(e.col, day, absentTeachers).map(obj => obj.name);
          if (!available.includes(t)) {
            drop.innerHTML = `<span class='text-danger'>Teacher not available</span>`;
            setTimeout(() => { drop.innerHTML = "<small>Drop teacher here</small>"; }, 1200);
            return;
          }
          coverAssignments[key] = t;
          tallies[t] = (tallies[t] || 0) + 1;
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
        badge.className = "badge me-1 avail-badge " + (type === "free" ? "bg-primary" : "bg-secondary");
        badge.textContent = name + (type === "meeting" ? " (meeting)" : "");
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
  // Only show the absent teachers table with cover assignments in a modal for preview
  const printArea = document.getElementById("printArea");
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  let html = '<h3>Absent Teachers Cover Plan</h3>';
  html += '<table class="table table-bordered"><thead><tr><th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assigned Cover</th></tr></thead><tbody>';
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
      html += `<tr><td>${teacher}</td><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ''}</td><td>${e.venue || ''}</td><td>${assigned}</td></tr>`;
    });
  });
  html += '</tbody></table>';
  printArea.innerHTML = html;
  // Show modal
  let modal = new bootstrap.Modal(document.getElementById('printPreviewModal'));
  modal.show();
};

document.getElementById("confirmPrintBtn").onclick = () => {
  // Print only the printArea content
  const printArea = document.getElementById("printArea");
  let win = window.open('', '', 'width=900,height=700');
  win.document.write('<html><head><title>Print Cover Plan</title>');
  win.document.write('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">');
  win.document.write('</head><body>');
  win.document.write(printArea.innerHTML);
  win.document.write('</body></html>');
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
  let html = '<h3>Absent Teachers Cover Plan</h3>';
  html += '<table border="1" cellpadding="5" cellspacing="0"><thead><tr><th>Teacher</th><th>Period</th><th>Subject/Type</th><th>Class</th><th>Venue</th><th>Assigned Cover</th></tr></thead><tbody>';
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
      html += `<tr><td>${teacher}</td><td>${e.col + 1}</td><td>${e.subject || e.type}</td><td>${e.className || ''}</td><td>${e.venue || ''}</td><td>${assigned}</td></tr>`;
    });
  });
  html += '</tbody></table>';
  // Use mailto: (user must send manually)
  let subject = encodeURIComponent("Absent Teachers Cover Plan");
  let body = encodeURIComponent(html.replace(/<[^>]+>/g, ''));
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

refreshTeachers();
renderAbsentTeachersTable();
renderGrid();
