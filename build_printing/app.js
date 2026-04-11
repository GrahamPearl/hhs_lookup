// FULL MERGED HIGH-PERFORMANCE SYSTEM + WEEKLY CALENDAR VIEW

/*************************************************
 * STATE (OPTIMIZED)
 *************************************************/
let jobs = new Map();
let sortedCache = [];
let cacheDirty = true;
let idCounter = 0;

/*************************************************
 * DOM ELEMENTS
 *************************************************/
const roleSelect = document.getElementById("roleSelect");
const adminSettings = document.getElementById("adminSettings");
const weeklyReportControls = document.getElementById("weeklyReportControls");

const teacherFile = document.getElementById("teacherFile");
const todoFile = document.getElementById("todoFile");

const teacherSelect = document.getElementById("teacherSelect");

const pagesInput = document.getElementById("pages");
const copiesInput = document.getElementById("copies");
const printTypeSelect = document.getElementById("printType");
const sidesSelect = document.getElementById("sides");
const scheduledForInput = document.getElementById("scheduledFor");

const timePerPageInput = document.getElementById("timePerPage");
const loadTimeInput = document.getElementById("loadTime");
const checkTimeInput = document.getElementById("checkTime");

const totalPagesSpan = document.getElementById("totalPages");
const estimateSpan = document.getElementById("estimate");

const submitBtn = document.getElementById("submitBtn");
const saveTodoBtn = document.getElementById("saveTodoBtn");
const saveCompletedBtn = document.getElementById("saveCompletedBtn");
const saveMonthlyJsonBtn = document.getElementById("saveMonthlyJsonBtn");
const saveTenWeekJsonBtn = document.getElementById("saveTenWeekJsonBtn");
const saveWeeklyReportBtn = document.getElementById("saveWeeklyReportBtn");

const priorityModeSelect = document.getElementById("priorityMode");
const queueDiv = document.getElementById("queue");

/*************************************************
 * CALENDAR VIEW CONTAINER (NEW)
 *************************************************/
const calendarDiv = document.createElement("div");
calendarDiv.className = "card";
calendarDiv.innerHTML = "<h2>Weekly Calendar View</h2>";
queueDiv.parentNode.appendChild(calendarDiv);

/*************************************************
 * NORMALIZATION
 *************************************************/
function normalizeImportedJob(data) {
  if (data.pages !== undefined && data.copies !== undefined) return data;

  const total = data.totalPrintedPages || 0;

  return {
    ...data,
    pages: data.originalPages || total,
    copies: data.copies || 1
  };
}


// Calculate effective (printed) pages
function calculateEffectivePages(pages, copies) {
  return pages * copies;
}

// Calculate estimated time in seconds
function calculateEstimatedTime(effectivePages) {
  return (
    Number(loadTimeInput.value || 0) +
    Number(checkTimeInput.value || 0) +
    effectivePages * Number(timePerPageInput.value || 0)
  );
}

// Update the preview shown in the Print Requests card
function updateEstimatePreview() {
  const pages = Number(pagesInput.value || 0);
  const copies = Number(copiesInput.value || 0);

  const effectivePages = calculateEffectivePages(pages, copies);
  const estimatedSeconds = calculateEstimatedTime(effectivePages);

  document.getElementById("effectivePages").textContent = effectivePages;
  document.getElementById("estimate").textContent = estimatedSeconds;
}


// Load teacher list from .txt file into requesting teacher comboBox
teacherFile.addEventListener("change", () => {
  const reader = new FileReader();

  reader.onload = () => {
    teacherSelect.innerHTML = "";
    teacherSelect.disabled = false;

    reader.result
      .split(/\r?\n/)
      .map(name => name.trim())
      .filter(Boolean)
      .forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        teacherSelect.appendChild(option);
      });
  };

  reader.readAsText(teacherFile.files[0]);
});

/*************************************************
 * ROLE HANDLING
 *************************************************/
roleSelect.addEventListener("change", () => {
  const role = roleSelect.value;
  adminSettings.classList.toggle("hidden", role !== "admin");
  weeklyReportControls.classList.toggle("hidden", role !== "weekly-report");

  if (role === "weekly-report") {
    renderWeeklyCalendar();
  } else {
    calendarDiv.innerHTML = "<h2>Weekly Calendar View</h2>";
  }

  rerenderAll();
});

/*************************************************
 * JOB CREATION
 *************************************************/
function createJob(data) {
  const id = ++idCounter;

  const pages = Number(data.pages || 0);
  const copies = Number(data.copies || 1);

  const job = {
    id,
    teacher: data.teacher,
    pages,
    copies,
    scheduledFor: data.scheduledFor ? new Date(data.scheduledFor).getTime() : null,
    estimatedSeconds: data.estimatedSeconds || 0,

    status: data.status || "Queued",
    requestedAt: data.requestedAt ? new Date(data.requestedAt).getTime() : Date.now(),
    startedAt: data.startedAt ? new Date(data.startedAt).getTime() : null,
    completedAt: data.completedAt ? new Date(data.completedAt).getTime() : null,
    actualSeconds: data.actualSeconds ?? null,

    printType: data.printType,
    sides: data.sides
  };

  jobs.set(id, job);
  cacheDirty = true;

  renderIncremental(job);
}

/*************************************************
 * SORTING
 *************************************************/
function getSortedJobs() {
  if (!cacheDirty) return sortedCache;

  const mode = priorityModeSelect?.value || "fifo";
  const arr = Array.from(jobs.values());

  switch (mode) {
    case "due":
      arr.sort((a, b) => (a.scheduledFor || Infinity) - (b.scheduledFor || Infinity));
      break;
    case "size":
      arr.sort((a, b) => (a.pages * a.copies) - (b.pages * b.copies));
      break;
    default:
      arr.sort((a, b) => a.requestedAt - b.requestedAt);
  }

  sortedCache = arr;
  cacheDirty = false;
  return arr;
}

/*************************************************
 * RENDERING
 *************************************************/
function renderIncremental(job) {
  if (roleSelect.value === "weekly-report" && job.status !== "Completed") return;

  const el = document.createElement("div");
  el.className = "job";
  el.dataset.id = job.id;

  updateJobElement(el, job);
  queueDiv.appendChild(el);
}

function rerenderAll() {
  queueDiv.innerHTML = "";
  const fragment = document.createDocumentFragment();

  getSortedJobs().forEach(job => {
    if (roleSelect.value === "weekly-report" && job.status !== "Completed") return;

    const el = document.createElement("div");
    el.className = "job";
    el.dataset.id = job.id;
    updateJobElement(el, job);
    fragment.appendChild(el);
  });

  queueDiv.appendChild(fragment);
}

function updateJobElement(el, job) {
  const totalPages = job.pages * job.copies;

  el.innerHTML = `
  <table class="queue-table">
    <tbody>
      <tr>
        <th>Teacher</th>
        <td><strong>${job.teacher}</strong></td>
      </tr>
      <tr>
        <th>Status</th>
        <td>${job.status}</td>
      </tr>
      <tr>
        <th>Original pages</th>
        <td>${job.pages}</td>
      </tr>
      <tr>
        <th>Copies</th>
        <td>${job.copies}</td>
      </tr>
      <tr>
        <th>Sides</th>
        <td>${job.sides}</td>
      </tr>
      <tr>
        <th>Printing type</th>
        <td>${job.printType}</td>
      </tr>
      <tr>
        <th>Printed pages</th>
        <td>${job.totalPrintedPages}</td>
      </tr>
      <tr>
        <th>Scheduled for</th>
        <td>${job.scheduledFor ? new Date(job.scheduledFor).toLocaleString() : "—"}</td>
      </tr>
      <tr>
        <th>Estimated time</th>
        <td>${job.estimatedSeconds}s</td>
      </tr>
      <tr>
        <th>Actual time</th>
        <td>${job.actualSeconds ?? "—"}</td>
      </tr>
      <tr>
        <th>Started</th>
        <td>${job.startedAt || "—"}</td>
      </tr>
      <tr>
        <th>Completed</th>
        <td>${job.completedAt || "—"}</td>
      </tr>
    </tbody>
  </table>
`;


  let btn = el.querySelector("button");
  if (!btn) {
    btn = document.createElement("button");
    el.appendChild(btn);
  }

  if (job.status === "Queued") {
    btn.textContent = "Start";
    btn.onclick = () => startJob(job.id);
  } else if (job.status === "In process") {
    btn.textContent = "Complete";
    btn.onclick = () => completeJob(job.id);
  } else {
    btn.textContent = "Completed";
    btn.disabled = true;
  }
}

function updateSingle(id) {
  const el = queueDiv.querySelector(`[data-id="${id}"]`);
  if (!el) return rerenderAll();

  updateJobElement(el, jobs.get(id));
}

/*************************************************
 * ACTIONS
 *************************************************/
function startJob(id) {
  const job = jobs.get(id);
  job.status = "In process";
  job.startedAt = Date.now();
  updateSingle(id);
}

function completeJob(id) {
  const job = jobs.get(id);
  job.completedAt = Date.now();
  job.actualSeconds = Math.round((job.completedAt - job.startedAt) / 1000);
  job.status = "Completed";
  updateSingle(id);

  if (roleSelect.value === "weekly-report") renderWeeklyCalendar();
}

/*************************************************
 * WEEKLY CALENDAR VIEW (NEW FEATURE)
 *************************************************/
function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getDayName(ts) {
  return new Date(ts).toLocaleDateString([], { weekday: 'long' });
}

function renderWeeklyCalendar() {
  const weeklyJobs = Array.from(jobs.values()).filter(
    j => j.status === "Completed" && isThisWeek(j.completedAt)
  );

  const grouped = {};

  weeklyJobs.forEach(job => {
    const day = getDayName(job.completedAt);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(job);
  });

  calendarDiv.innerHTML = "<h2>Weekly Calendar View</h2>";

  Object.keys(grouped).forEach(day => {
    const section = document.createElement("div");

    let html = `<h3>${day}</h3>`;
    html += `
      <table class="queue-table">
        <tr>
          <th>Teacher</th>
          <th>Start</th>
          <th>End</th>
          <th>Duration</th>
        </tr>
    `;

    grouped[day].forEach(job => {
      html += `
        <tr>
          <td>${job.teacher}</td>
          <td>${formatTime(job.startedAt)}</td>
          <td>${formatTime(job.completedAt)}</td>
          <td>${job.actualSeconds ?? "—"}s</td>
        </tr>
      `;
    });

    html += "</table>";
    section.innerHTML = html;
    calendarDiv.appendChild(section);
  });
}

/*************************************************
 * SUBMIT HANDLER
 *************************************************/
submitBtn.addEventListener("click", () => {
  if (!teacherSelect.value) {
    alert("Please select a requesting teacher.");
    return;
  }

  const pages = Number(pagesInput.value || 0);
  const copies = Number(copiesInput.value || 1);
  const total = pages * copies;

  createJob({
    teacher: teacherSelect.value,
    pages,
    copies,
    scheduledFor: scheduledForInput.value,
    estimatedSeconds:
      Number(loadTimeInput.value || 0) +
      Number(checkTimeInput.value || 0) +
      total * Number(timePerPageInput.value || 0),
    printType: printTypeSelect.value,
    sides: sidesSelect.value
  });
});

/*************************************************
 * EXPORTS
 *************************************************/
function downloadFile(content, filename, type = "text/plain") {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function getAllJobsArray() {
  return Array.from(jobs.values());
}

saveTodoBtn.onclick = () =>
  downloadFile(
    getAllJobsArray().filter(j => j.status !== "Completed").map(j => JSON.stringify(j)).join("\n"),
    `todo_${today()}.txt`
  );

saveCompletedBtn.onclick = () =>
  downloadFile(
    getAllJobsArray().filter(j => j.status === "Completed").map(j => JSON.stringify(j)).join("\n"),
    `completed_${today()}.txt`
  );

saveMonthlyJsonBtn.onclick = () =>
  downloadFile(JSON.stringify(getAllJobsArray(), null, 2), `jobs_monthly_${today()}.json`, "application/json");

saveTenWeekJsonBtn.onclick = () =>
  downloadFile(JSON.stringify(getAllJobsArray(), null, 2), `jobs_10week_${today()}.json`, "application/json");

/*************************************************
 * WEEKLY REPORT
 *************************************************/
saveWeeklyReportBtn.onclick = () => {
  const weeklyJobs = getAllJobsArray().filter(
    j => j.status === "Completed" && isThisWeek(j.completedAt)
  );

  const perTeacherTotals = {};
  weeklyJobs.forEach(j => {
    perTeacherTotals[j.teacher] =
      (perTeacherTotals[j.teacher] || 0) + (j.pages * j.copies);
  });

  let output = "WEEKLY PRINT REPORT (MON–FRI)\n\n";
  output += `Completed jobs: ${weeklyJobs.length}\n\n`;

  for (const t in perTeacherTotals) {
    output += ` - ${t}: ${perTeacherTotals[t]} pages\n`;
  }

  downloadFile(output, `weekly_report_${today()}.txt`);
};

/*************************************************
 * IMPORT
 *************************************************/
todoFile.addEventListener("change", () => {
  const reader = new FileReader();
  reader.onload = () => {
    reader.result.split(/\r?\n/).filter(Boolean).forEach(line => {
      let data = JSON.parse(line);
      data = normalizeImportedJob(data);
      createJob(data);
    });
  };
  reader.readAsText(todoFile.files[0]);
});

/*************************************************
 * DATE HELPERS
 *************************************************/
function today() {
  return new Date().toISOString().slice(0, 10);
}

function isThisWeek(ts) {
  if (!ts) return false;

  const d = new Date(ts);
  const now = new Date();

  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return d >= monday && d <= friday;
}

/*************************************************
 * PRIORITY CHANGE
 *************************************************/
priorityModeSelect.addEventListener("change", () => {
  cacheDirty = true;
  rerenderAll();
});


// Recalculate whenever the requesting teacher changes inputs
[
  pagesInput,
  copiesInput,
  printTypeSelect,
  sidesSelect,
  timePerPageInput,
  loadTimeInput,
  checkTimeInput
].forEach(el => el.addEventListener("input", updateEstimatePreview));
