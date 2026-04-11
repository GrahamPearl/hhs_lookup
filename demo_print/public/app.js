// TEACHER PRINTING & PHOTOCOPY BOOKING SYSTEM
// Vanilla JS with localStorage persistence

/*************************************************
 * PERSISTENCE LAYER
 *************************************************/
const STORAGE_KEYS = {
  JOBS: "printqueue_jobs",
  SETTINGS: "printqueue_settings",
  TEACHERS: "printqueue_teachers",
  AUTH_TEACHERS: "printqueue_auth_teachers",
  TEACHER_EMAILS: "printqueue_teacher_emails",
  ID_COUNTER: "printqueue_idcounter"
};

function persistJobs() {
  localStorage.setItem(STORAGE_KEYS.JOBS, JSON.stringify(Array.from(jobs.values())));
}

function persistSettings() {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({
    priorityMode: priorityModeSelect?.value || "fifo",
    timePerPage: Number(timePerPageInput?.value || 5),
    loadTime: Number(loadTimeInput?.value || 60),
    checkTime: Number(checkTimeInput?.value || 120),
    trimmingTime: Number(trimmingTimeInput?.value || 0),
    staplingTime: Number(staplingTimeInput?.value || 0)
  }));
}

function persistTeachers() {
  const options = Array.from(teacherSelect.options).map(o => o.value).filter(Boolean);
  localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(options));
}

function persistAuthTeachers() {
  const options = Array.from(authTeacherSelect.options).map(o => o.value).filter(Boolean);
  localStorage.setItem(STORAGE_KEYS.AUTH_TEACHERS, JSON.stringify(options));
}

function loadPersistedData() {
  // Load ID counter
  const savedId = localStorage.getItem(STORAGE_KEYS.ID_COUNTER);
  if (savedId) idCounter = Number(savedId);

  // Load settings
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || "null");
    if (settings) {
      if (priorityModeSelect) priorityModeSelect.value = settings.priorityMode || "fifo";
      if (timePerPageInput) timePerPageInput.value = settings.timePerPage || 5;
      if (loadTimeInput) loadTimeInput.value = settings.loadTime || 60;
      if (checkTimeInput) checkTimeInput.value = settings.checkTime || 120;
      if (trimmingTimeInput) trimmingTimeInput.value = settings.trimmingTime || 0;
      if (staplingTimeInput) staplingTimeInput.value = settings.staplingTime || 0;
    }
  } catch {}

  // Load teachers
  try {
    const teachers = JSON.parse(localStorage.getItem(STORAGE_KEYS.TEACHERS) || "null");
    if (teachers && teachers.length > 0) {
      teacherSelect.innerHTML = "";
      teachers.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        teacherSelect.appendChild(opt);
      });
      teacherSelect.disabled = false;
    }
  } catch {}

  // Load authorising teachers
  try {
    const authTeachers = JSON.parse(localStorage.getItem(STORAGE_KEYS.AUTH_TEACHERS) || "null");
    if (authTeachers && authTeachers.length > 0) {
      authTeacherSelect.innerHTML = '<option value="">— Select —</option>';
      authTeachers.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        authTeacherSelect.appendChild(opt);
      });
      authTeacherSelect.disabled = false;
    }
  } catch {}

  // Load teacher emails
  try {
    const emails = JSON.parse(localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS) || "null");
    if (emails) teacherEmails = emails;
  } catch {}

  // Load jobs
  try {
    const savedJobs = JSON.parse(localStorage.getItem(STORAGE_KEYS.JOBS) || "null");
    if (savedJobs && Array.isArray(savedJobs)) {
      savedJobs.forEach(j => {
        jobs.set(j.id, j);
        if (j.id > idCounter) idCounter = j.id;
      });
      cacheDirty = true;
      rerenderAll();
    }
  } catch {}
}

/*************************************************
 * STATE
 *************************************************/
let jobs = new Map();
let sortedCache = [];
let cacheDirty = true;
let idCounter = 0;
let teacherEmails = {}; // { "Teacher Name": "email@example.com" }

/*************************************************
 * DOM ELEMENTS
 *************************************************/
const roleSelect = document.getElementById("roleSelect");
const adminSettings = document.getElementById("adminSettings");
const weeklyReportControls = document.getElementById("weeklyReportControls");

const teacherFile = document.getElementById("teacherFile");
const authTeacherFile = document.getElementById("authTeacherFile");
const teacherEmailFile = document.getElementById("teacherEmailFile");
const todoFile = document.getElementById("todoFile");

const teacherSelect = document.getElementById("teacherSelect");
const authTeacherSelect = document.getElementById("authTeacherSelect");
const additionalTaskSelect = document.getElementById("additionalTask");

const pagesInput = document.getElementById("pages");
const copiesInput = document.getElementById("copies");
const printTypeSelect = document.getElementById("printType");
const sidesSelect = document.getElementById("sides");
const scheduledForInput = document.getElementById("scheduledFor");

const timePerPageInput = document.getElementById("timePerPage");
const loadTimeInput = document.getElementById("loadTime");
const checkTimeInput = document.getElementById("checkTime");
const trimmingTimeInput = document.getElementById("trimmingTime");
const staplingTimeInput = document.getElementById("staplingTime");

const effectivePagesSpan = document.getElementById("effectivePages");
const estimateSpan = document.getElementById("estimate");

const submitBtn = document.getElementById("submitBtn");
const saveTodoBtn = document.getElementById("saveTodoBtn");
const saveCompletedBtn = document.getElementById("saveCompletedBtn");
const saveMonthlyJsonBtn = document.getElementById("saveMonthlyJsonBtn");
const saveTenWeekJsonBtn = document.getElementById("saveTenWeekJsonBtn");
const saveWeeklyReportBtn = document.getElementById("saveWeeklyReportBtn");

const priorityModeSelect = document.getElementById("priorityMode");
const queueDiv = document.getElementById("queue");
const jobCountSpan = document.getElementById("jobCount");

/*************************************************
 * CALENDAR VIEW CONTAINER
 *************************************************/
const calendarDiv = document.createElement("div");
calendarDiv.className = "card hidden";
calendarDiv.innerHTML = "<h2>📅 Weekly Calendar View</h2>";
queueDiv.parentNode.parentNode.appendChild(calendarDiv);

/*************************************************
 * LIVE ESTIMATE CALCULATION
 *************************************************/
function getAdditionalTaskTime() {
  const task = additionalTaskSelect?.value || "none";
  let extra = 0;
  if (task === "trimming" || task === "trimming_stapling") extra += Number(trimmingTimeInput?.value || 0);
  if (task === "stapling" || task === "trimming_stapling") extra += Number(staplingTimeInput?.value || 0);
  return extra;
}

function updateEstimate() {
  const pages = Number(pagesInput.value || 0);
  const copies = Number(copiesInput.value || 1);
  let effective = pages;
  if (printTypeSelect.value === "twoinone") effective = Math.ceil(effective / 2);
  if (sidesSelect.value === "double") effective = Math.ceil(effective / 2);
  effective *= copies;

  const est = Number(loadTimeInput.value || 0) + Number(checkTimeInput.value || 0) + effective * Number(timePerPageInput.value || 0) + getAdditionalTaskTime();
  if (effectivePagesSpan) effectivePagesSpan.textContent = effective;
  if (estimateSpan) estimateSpan.textContent = est;
}

[pagesInput, copiesInput, printTypeSelect, sidesSelect, timePerPageInput, loadTimeInput, checkTimeInput, trimmingTimeInput, staplingTimeInput, additionalTaskSelect].forEach(el => {
  if (el) el.addEventListener("input", updateEstimate);
  if (el) el.addEventListener("change", updateEstimate);
});

/*************************************************
 * NORMALIZATION
 *************************************************/
function normalizeImportedJob(data) {
  if (data.pages !== undefined && data.copies !== undefined) return data;
  const total = data.totalPrintedPages || 0;
  return { ...data, pages: data.originalPages || total, copies: data.copies || 1 };
}

/*************************************************
 * ROLE HANDLING
 *************************************************/
roleSelect.addEventListener("change", () => {
  const role = roleSelect.value;
  adminSettings.classList.toggle("hidden", role !== "admin");
  weeklyReportControls.classList.toggle("hidden", role !== "weekly-report");

  if (role === "weekly-report") {
    calendarDiv.classList.remove("hidden");
    renderWeeklyCalendar();
  } else {
    calendarDiv.classList.add("hidden");
    calendarDiv.innerHTML = "<h2>📅 Weekly Calendar View</h2>";
  }

  rerenderAll();
});

/*************************************************
 * JOB CREATION
 *************************************************/
function createJob(data) {
  const id = ++idCounter;
  localStorage.setItem(STORAGE_KEYS.ID_COUNTER, String(idCounter));

  const pages = Number(data.pages || 0);
  const copies = Number(data.copies || 1);

  const job = {
    id,
    teacher: data.teacher,
    authoriser: data.authoriser || "",
    pages,
    copies,
    additionalTask: data.additionalTask || "none",
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
  persistJobs();
  updateJobCount();
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
function statusBadgeHTML(status) {
  const cls = status === "Queued" ? "badge-queued" : status === "In process" ? "badge-in-progress" : "badge-completed";
  return `<span class="badge ${cls}">${status}</span>`;
}

function isUrgent(job) {
  if (job.status === "Completed") return false;
  if (!job.scheduledFor) return false;
  const hoursLeft = (job.scheduledFor - Date.now()) / 3600000;
  return hoursLeft <= 3 && hoursLeft > 0;
}

function renderIncremental(job) {
  if (roleSelect.value === "weekly-report" && job.status !== "Completed") return;

  const el = document.createElement("div");
  el.className = "job" + (job.status === "Completed" ? " job-completed" : isUrgent(job) ? " job-urgent" : "");
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
    el.className = "job" + (job.status === "Completed" ? " job-completed" : isUrgent(job) ? " job-urgent" : "");
    el.dataset.id = job.id;
    updateJobElement(el, job);
    fragment.appendChild(el);
  });

  queueDiv.appendChild(fragment);
  updateJobCount();
}

function taskLabel(task) {
  if (task === "trimming") return "✂️ Trimming";
  if (task === "stapling") return "📎 Stapling";
  if (task === "trimming_stapling") return "✂️📎 Trim+Staple";
  return "";
}

function updateJobElement(el, job) {
  const totalPages = job.pages * job.copies;
  const taskTag = job.additionalTask && job.additionalTask !== "none" ? `<span>${taskLabel(job.additionalTask)}</span>` : "";
  const authTag = job.authoriser ? `<span>Auth: ${job.authoriser}</span>` : "";

  el.innerHTML = `
    <div class="job-info">
      <div class="job-teacher">${job.teacher} ${statusBadgeHTML(job.status)}</div>
      <div class="job-meta">
        <span>${totalPages} pages</span>
        ${authTag}
        ${taskTag}
        ${job.scheduledFor ? `<span>⏰ ${new Date(job.scheduledFor).toLocaleString()}</span>` : ""}
        <span>Est: ${job.estimatedSeconds}s</span>
        ${job.actualSeconds != null ? `<span>Actual: ${job.actualSeconds}s</span>` : ""}
      </div>
    </div>
  `;

  const btn = document.createElement("button");

  if (job.status === "Queued") {
    btn.className = "btn btn-primary btn-sm";
    btn.textContent = "▶ Start";
    btn.onclick = () => startJob(job.id);
    el.appendChild(btn);
  } else if (job.status === "In process") {
    btn.className = "btn btn-outline btn-sm";
    btn.style.borderColor = "var(--success)";
    btn.style.color = "var(--success)";
    btn.textContent = "✓ Complete";
    btn.onclick = () => completeJob(job.id);
    el.appendChild(btn);
  }
}

function updateSingle(id) {
  const el = queueDiv.querySelector(`[data-id="${id}"]`);
  const job = jobs.get(id);
  if (!el || !job) return rerenderAll();
  el.className = "job" + (job.status === "Completed" ? " job-completed" : isUrgent(job) ? " job-urgent" : "");
  updateJobElement(el, job);
}

function updateJobCount() {
  if (jobCountSpan) jobCountSpan.textContent = `${jobs.size} jobs`;
}

/*************************************************
 * ACTIONS
 *************************************************/
function startJob(id) {
  const job = jobs.get(id);
  job.status = "In process";
  job.startedAt = Date.now();
  persistJobs();
  updateSingle(id);
}

function completeJob(id) {
  const job = jobs.get(id);
  job.completedAt = Date.now();
  job.actualSeconds = Math.round((job.completedAt - job.startedAt) / 1000);
  job.status = "Completed";
  persistJobs();
  updateSingle(id);
  if (roleSelect.value === "weekly-report") renderWeeklyCalendar();

  // Offer to email the requesting teacher
  const email = teacherEmails[job.teacher];
  if (email) {
    const subject = encodeURIComponent("Your print job is complete");
    const body = encodeURIComponent(`Hi ${job.teacher},\n\nYour print job (${job.pages * job.copies} pages) has been completed.\n\nRegards,\nPrint Room`);
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
  }
}

/*************************************************
 * WEEKLY CALENDAR VIEW
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

  calendarDiv.innerHTML = "<h2>📅 Weekly Calendar View</h2>";

  if (Object.keys(grouped).length === 0) {
    calendarDiv.innerHTML += '<p style="text-align:center;color:var(--text-muted);padding:1.5rem 0;">No completed jobs this week</p>';
    return;
  }

  Object.keys(grouped).forEach(day => {
    const section = document.createElement("div");
    let html = `<h3 style="font-size:0.9rem;color:var(--primary);margin:1rem 0 0.5rem;">${day}</h3>`;
    html += `<table class="queue-table"><tr><th>Teacher</th><th>Start</th><th>End</th><th>Duration</th></tr>`;
    grouped[day].forEach(job => {
      html += `<tr><td>${job.teacher}</td><td>${formatTime(job.startedAt)}</td><td>${formatTime(job.completedAt)}</td><td>${job.actualSeconds ?? "—"}s</td></tr>`;
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

  let effective = pages;
  if (printTypeSelect.value === "twoinone") effective = Math.ceil(effective / 2);
  if (sidesSelect.value === "double") effective = Math.ceil(effective / 2);
  effective *= copies;

  createJob({
    teacher: teacherSelect.value,
    authoriser: authTeacherSelect.value || "",
    pages,
    copies,
    additionalTask: additionalTaskSelect.value,
    scheduledFor: scheduledForInput.value,
    estimatedSeconds:
      Number(loadTimeInput.value || 0) +
      Number(checkTimeInput.value || 0) +
      effective * Number(timePerPageInput.value || 0) +
      getAdditionalTaskTime(),
    printType: printTypeSelect.value,
    sides: sidesSelect.value
  });

  pagesInput.value = "";
  copiesInput.value = "1";
  scheduledForInput.value = "";
  additionalTaskSelect.value = "none";
  updateEstimate();
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
  URL.revokeObjectURL(link.href);
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
    perTeacherTotals[j.teacher] = (perTeacherTotals[j.teacher] || 0) + (j.pages * j.copies);
  });

  let output = "WEEKLY PRINT REPORT (MON–FRI)\n\n";
  output += `Completed jobs: ${weeklyJobs.length}\n\n`;
  for (const t in perTeacherTotals) {
    output += ` - ${t}: ${perTeacherTotals[t]} pages\n`;
  }
  downloadFile(output, `weekly_report_${today()}.txt`);
};

/*************************************************
 * TEACHER FILE IMPORT
 *************************************************/
teacherFile.addEventListener("change", () => {
  const file = teacherFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const teachers = reader.result.split(/\r?\n/).filter(Boolean);
    teacherSelect.innerHTML = "";
    teachers.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      teacherSelect.appendChild(opt);
    });
    teacherSelect.disabled = false;
    persistTeachers();
  };
  reader.readAsText(file);
});

/*************************************************
 * AUTHORISING TEACHER FILE IMPORT
 *************************************************/
authTeacherFile.addEventListener("change", () => {
  const file = authTeacherFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const teachers = reader.result.split(/\r?\n/).filter(Boolean);
    authTeacherSelect.innerHTML = '<option value="">— Select —</option>';
    teachers.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      authTeacherSelect.appendChild(opt);
    });
    authTeacherSelect.disabled = false;
    persistAuthTeachers();
  };
  reader.readAsText(file);
});

/*************************************************
 * TEACHER EMAIL FILE IMPORT
 * Format per line: TeacherName TeacherEmail
 *************************************************/
teacherEmailFile.addEventListener("change", () => {
  const file = teacherEmailFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const lines = reader.result.split(/\r?\n/).filter(Boolean);
    lines.forEach(line => {
      const match = line.match(/^(.+?)\s+(\S+@\S+)$/);
      if (match) {
        teacherEmails[match[1].trim()] = match[2].trim();
      }
    });
    localStorage.setItem(STORAGE_KEYS.TEACHER_EMAILS, JSON.stringify(teacherEmails));
  };
  reader.readAsText(file);
});

/*************************************************
 * JOB FILE IMPORT
 *************************************************/
todoFile.addEventListener("change", () => {
  const reader = new FileReader();
  reader.onload = () => {
    reader.result.split(/\r?\n/).filter(Boolean).forEach(line => {
      try {
        let data = JSON.parse(line);
        data = normalizeImportedJob(data);
        createJob(data);
      } catch {}
    });
  };
  reader.readAsText(todoFile.files[0]);
});

/*************************************************
 * CLEAR BUTTONS
 *************************************************/
document.getElementById("clearQueueBtn").onclick = () => {
  if (!confirm("Clear all jobs from the queue?")) return;
  jobs.clear();
  cacheDirty = true;
  idCounter = 0;
  localStorage.removeItem(STORAGE_KEYS.JOBS);
  localStorage.removeItem(STORAGE_KEYS.ID_COUNTER);
  rerenderAll();
};

document.getElementById("clearStorageBtn").onclick = () => {
  if (!confirm("Clear ALL stored data (jobs, teachers, settings)?")) return;
  Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
  jobs.clear();
  teacherEmails = {};
  cacheDirty = true;
  idCounter = 0;
  teacherSelect.innerHTML = '<option value="">No teachers loaded</option>';
  teacherSelect.disabled = true;
  authTeacherSelect.innerHTML = '<option value="">No authorisers loaded</option>';
  authTeacherSelect.disabled = true;
  rerenderAll();
};

/*************************************************
 * PERSIST SETTINGS ON CHANGE
 *************************************************/
[priorityModeSelect, timePerPageInput, loadTimeInput, checkTimeInput, trimmingTimeInput, staplingTimeInput].forEach(el => {
  if (el) el.addEventListener("change", persistSettings);
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

/*************************************************
 * BOOT — Load persisted data
 *************************************************/
loadPersistedData();
updateEstimate();

// Re-check urgency every 60 seconds
setInterval(() => { rerenderAll(); }, 60000);
