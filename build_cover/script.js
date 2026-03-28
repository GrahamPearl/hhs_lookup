const PREFIX = "teacher_";
let teacherCache = {};
let coverAssignments = {};
let tallies = {};

function getAvailableTeachers(period, day, absent) {
  let list = [];
  Object.keys(localStorage).forEach((k) => {
    if (!k.startsWith(PREFIX)) return;
    let name = k.replace(PREFIX, "");
    if (name === absent) return;

    let data = JSON.parse(localStorage.getItem(k));
    let entry = data.entries?.find((e) => e.row == day && e.col == period);
    if (entry && (entry.type === "free" || entry.type === "meeting")) {
      list.push({ name, type: entry.type });
    }
  });
  return list;
}

function refreshTeachers() {
  let sel = document.getElementById("absenceTeacherSelect");
  sel.innerHTML = "";
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith(PREFIX)) {
      let name = k.replace(PREFIX, "");
      let o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    }
  });
}

function loadTeacher(name) {
  if (!teacherCache[name]) {
    teacherCache[name] = JSON.parse(localStorage.getItem(PREFIX + name));
  }
  return teacherCache[name];
}

function renderGrid() {
  const teacher = document.getElementById("absenceTeacherSelect").value;
  const day = parseInt(document.getElementById("absenceDaySelect").value);
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  let data = loadTeacher(teacher);
  if (!data) {
    grid.innerHTML = "No data";
    return;
  }

  // Get all lessons for the selected day and sort by period (col)
  let lessons = data.entries.filter((e) => e.row == day);
  lessons.sort((a, b) => a.col - b.col);

  lessons.forEach((e) => {
    // Skip Period 7 (sports)
    if (e.col === 6) return;

    let cell = document.createElement("div");
    cell.className = "col-2 cell " + e.type;
    cell.dataset.col = e.col; // Needed for correct period reference

    let key = day + "-" + e.col;

    // Period label: Period 1 for col 0, Period 2 for col 1, etc.
    cell.innerHTML = `<b>Period ${e.col + 1}</b><br>${e.subject || e.type}<br>${e.className} <br>${e.venue}`;

    if (e.type === "lesson") {
      let drop = document.createElement("div");
      drop.className = "border p-2 mt-2";
      drop.style.minHeight = "2.5em";

      let assigned = coverAssignments[key];

      if (assigned) {
        drop.innerHTML = `<span class="badge bg-success">${assigned}</span>
       <button class="btn btn-sm btn-danger ms-2" onclick="undo('${key}')">Undo</button>`;
      } else {
        drop.innerHTML = "<small>Drop teacher here</small>";
      }

      drop.ondragover = (e) => e.preventDefault();
      /*
      drop.ondrop = (e) => {
        let t = e.dataTransfer.getData("text");

        let available = getAvailableTeachers(
          e.target.parentElement.dataset.col,
          day,
          teacher,
        ).map(obj => obj.name);
        if (!available.includes(t)) {
          drop.innerHTML = `<span class="text-danger">Teacher not available</span>`;
          setTimeout(() => {
            drop.innerHTML = "<small>Drop teacher here</small>";
          }, 1200);
          return;
        }

        coverAssignments[key] = t;
        tallies[t] = (tallies[t] || 0) + 1;
        renderGrid();
      };
      */

      drop.ondrop = (ev) => {
        ev.preventDefault();

        let t = ev.dataTransfer.getData("text");

        // Always get the correct parent cell
        const parentCell = drop.closest(".cell");
        const period = parseInt(parentCell.dataset.col);

        let available = getAvailableTeachers(period, day, teacher).map(
          (obj) => obj.name,
        );

        if (!available.includes(t)) {
          drop.innerHTML = `<span class="text-danger">Teacher not available</span>`;
          setTimeout(() => {
            drop.innerHTML = "<small>Drop teacher here</small>";
          }, 1200);
          return;
        }

        coverAssignments[key] = t;
        tallies[t] = (tallies[t] || 0) + 1;
        renderGrid();
      };
      // AVAILABLE LIST
      let avail = getAvailableTeachers(e.col, day, teacher);
      let list = document.createElement("div");

      avail.forEach(({ name, type }) => {
        let badge = document.createElement("span");
        badge.className =
          "badge me-1 avail-badge " +
          (type === "free" ? "bg-primary" : "bg-secondary");
        badge.textContent = name + (type === "meeting" ? " (meeting)" : "");
        badge.draggable = true;
        badge.ondragstart = (ev) => ev.dataTransfer.setData("text", name);
        list.appendChild(badge);
      });

      cell.appendChild(drop);
      cell.appendChild(list);
    }

    grid.appendChild(cell);
  });
}

function undo(key) {
  delete coverAssignments[key];
  renderGrid();
}

document.getElementById("absenceTeacherSelect").onchange = renderGrid;
document.getElementById("absenceDaySelect").onchange = renderGrid;

document.getElementById("saveBtn").onclick = () => {
  localStorage.setItem("coverPlans", JSON.stringify(coverAssignments));
  alert("Saved");
};

document.getElementById("printBtn").onclick = () => window.print();

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
renderGrid();
