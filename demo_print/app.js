/**
 * TEACHER PRINTING & PHOTOCOPY BOOKING SYSTEM
 * Canonical app.js with extended analytics (strict reconstitution)
 * UPDATED: Web Workers, Debounced Search, Intersection Observer, Memoized Estimates
 */

/* ================= UTILITIES ================= */
const debounce = (func, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
};

/* ================= PERSISTENCE & GLOBAL STATE ================= */
const STORAGE_KEYS = {
  JOBS: "printqueue_jobs",
  SETTINGS: "printqueue_settings",
  TEACHERS: "printqueue_teachers",
  ID_COUNTER: "printqueue_idcounter",
  TEACHER_EMAILS: "printqueue_teacher_emails",
  EMAIL_ENABLED: "printqueue_email_enabled",
};

const NOTES_KEY = "printqueue_notes";

let ADMIN_CREDENTIALS = [];
let jobs = new Map();
let idCounter = 0;
let currentUser = { email: null, role: null, authenticated: false };
let dueDateFilter = "all";

let currentPage = 1;
const ITEMS_PER_PAGE = 5;

// Replaced completed pagination with Infinite Scroll
let completedJobsLimit = 10;
const COMPLETED_INCREMENT = 10;
let observer = null;

let searchQuery = "";

/* ================= APP STATE ================= */
const AppState = {
  settings: {
    priorityMode: "fifo",
    timePerPage: 5,
    loadTime: 60,
    checkTime: 120,
    trimmingTime: 30,
    staplingTime: 20,
  },
  load() {
    idCounter = parseInt(localStorage.getItem(STORAGE_KEYS.ID_COUNTER)) || 0;
    try {
      const savedJobs = JSON.parse(localStorage.getItem(STORAGE_KEYS.JOBS));
      if (savedJobs) {
        jobs.clear();
        savedJobs.forEach((j) => {
          // Memoize estimate if missing from older saves
          if (j.estimate === undefined) j.estimate = calculateJobEstimate(j);
          jobs.set(j.id, j);
        });
      }
      const savedSettings = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.SETTINGS),
      );
      if (savedSettings) this.settings = savedSettings;
    } catch (e) {
      console.error("Load failed", e);
    }
  },
  save() {
    localStorage.setItem(
      STORAGE_KEYS.JOBS,
      JSON.stringify(Array.from(jobs.values())),
    );
    localStorage.setItem(STORAGE_KEYS.ID_COUNTER, idCounter.toString());
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
  },
};

/* ================= DOM ELEMENTS (CACHED) ================= */
const elements = {
  teacherSelect: document.getElementById("teacherSelect"),
  authTeacherSelect: document.getElementById("authTeacherSelect"),
  pages: document.getElementById("pages"),
  copies: document.getElementById("copies"),
  printType: document.getElementById("printType"),
  sides: document.getElementById("sides"),
  additionalTask: document.getElementById("additionalTask"),
  scheduledFor: document.getElementById("scheduledFor"),
  effectivePages: document.getElementById("effectivePages"),
  estimate: document.getElementById("estimate"),
  queue: document.getElementById("queue"),
  searchInput: document.getElementById("searchInput"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  pageInfo: document.getElementById("pageInfo"),
  loginCard: document.getElementById("loginCard"),
  adminSettings: document.getElementById("adminSettings"),
  weeklyReportControls: document.getElementById("weeklyReportControls"),
  weeklySummary: document.getElementById("weeklySummaryContent"),
  logoutBtn: document.getElementById("logoutBtn"),
  priorityMode: document.getElementById("priorityMode"),
  todoFile: document.getElementById("todoFile"),
  teacherFile: document.getElementById("teacherFile"),
  jobCount: document.getElementById("jobCount"),
  dueDateFiltersContainer: document.getElementById("dueDateFilters"),
  jobNotes: document.getElementById("jobNotes"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  submitBtn: document.getElementById("submitBtn"),
  emailNotificationsEnabled: document.getElementById(
    "emailNotificationsEnabled",
  ),
  priorityHelp: document.getElementById("priorityHelp"),
  saveTodoBtn: document.getElementById("saveTodoBtn"),
  saveCompletedBtn: document.getElementById("saveCompletedBtn"),
  clearQueueBtn: document.getElementById("clearQueueBtn"),
  teacherEmailFile: document.getElementById("teacherEmailFile"),
  loginBtn: document.getElementById("loginBtn"),
  setting_timePerPage: document.getElementById("setting_timePerPage"),
  setting_loadTime: document.getElementById("setting_loadTime"),
  setting_checkTime: document.getElementById("setting_checkTime"),
  setting_trimmingTime: document.getElementById("setting_trimmingTime"),
  setting_staplingTime: document.getElementById("setting_staplingTime"),
  completedFile: document.getElementById("completedFile"),
  weeklyCalendarContainer: document.getElementById("weeklyCalendarContainer"),
  openWeeklyCalendarBtn: document.getElementById("openWeeklyCalendarBtn"),
  openGanttViewBtn: document.getElementById("openGanttViewBtn"),
};

/* ================= AUTH ================= */
fetch("./admin.env")
  .then((r) => r.text())
  .then((text) => {
    ADMIN_CREDENTIALS = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [email, password] = line.split(";");
        return { email: email.trim().toLowerCase(), password: password.trim() };
      });
  })
  .catch(() => console.warn("admin.env not found"));

function isEmailNotificationEnabled() {
  return localStorage.getItem(STORAGE_KEYS.EMAIL_ENABLED) === "true";
}

function saveJobNotes(reference, text) {
  const notes = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}");
  notes[reference] = text;
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function exportJobsToFile(jobsArray, defaultFilename) {
  if (!jobsArray.length) {
    alert("No jobs to export.");
    return;
  }

  const userFilename = prompt(
    "Enter filename (without extension):",
    defaultFilename.replace(".txt", ""),
  );

  if (!userFilename) return;

  const filename = userFilename.endsWith(".txt")
    ? userFilename
    : `${userFilename}.txt`;

  const content = jobsArray.map((job) => JSON.stringify(job)).join("\n");

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateJobReference() {
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = Array.from(jobs.values()).filter(
    (j) => j.reference && j.reference.startsWith(today),
  ).length;
  return `${today}-${todayCount + 1}`;
}

function getJobNotes(reference) {
  const notes = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}");
  return notes[reference] || "";
}

function jobHasNotes(reference) {
  return getJobNotes(reference).trim().length > 0;
}

window.downloadNotes = (reference) => {
  const notes = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}");
  if (!notes[reference]) return alert("No notes for this job.");

  const blob = new Blob([notes[reference]], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${reference}-notes.txt`;
  a.click();
};

function isUrgent(job) {
  if (job.status === "Completed") return false;
  if (!job.scheduledFor) return false;
  const hoursLeft = (job.scheduledFor - Date.now()) / 3600000;
  return hoursLeft <= 3 && hoursLeft > 0;
}

function isOverdue(job) {
  if (job.status === "Completed") return false;
  if (!job.scheduledFor) return false;
  const hoursLeft = (job.scheduledFor - Date.now()) / 3600000;
  return hoursLeft < 0;
}

function wasOverdue(job) {
  if (job.status !== "Completed") return false;
  if (!job.scheduledFor || !job.completedAt) return false;
  return new Date(job.completedAt) > new Date(job.scheduledFor);
}

function handleLogin() {
  const email = elements.emailInput.value.trim().toLowerCase();
  const password = elements.passwordInput.value;
  const match = ADMIN_CREDENTIALS.find(
    (c) => c.email === email && c.password === password,
  );
  if (!match) return alert("Invalid admin credentials");

  currentUser = { email, role: "admin", authenticated: true };
  elements.loginCard.classList.add("hidden");
  elements.logoutBtn.classList.remove("hidden");
  elements.adminSettings.classList.remove("hidden");
  elements.weeklyReportControls.classList.remove("hidden");
  rerenderAll();
}

function handleLogout() {
  currentUser = { email: null, role: null, authenticated: false };
  elements.loginCard.classList.remove("hidden");
  elements.logoutBtn.classList.add("hidden");
  elements.adminSettings.classList.add("hidden");
  elements.weeklyReportControls.classList.add("hidden");
  if (window.teacherChartInstance) window.teacherChartInstance.destroy();
  if (window.timeChartInstance) window.timeChartInstance.destroy();
  rerenderAll();
}

/* ================= CALCULATIONS (MEMOIZED) ================= */
function calculateJobEstimate(job) {
  let effective = job.pages;
  if (job.printType === "twoinone") effective = Math.ceil(effective / 2);
  if (job.sides === "double") effective = Math.ceil(effective / 2);
  effective *= job.copies;

  let taskTime = 0;
  if (job.additionalTask?.includes("trimming"))
    taskTime += AppState.settings.trimmingTime;
  if (job.additionalTask?.includes("stapling"))
    taskTime += AppState.settings.staplingTime;

  return Math.round(
    AppState.settings.loadTime +
      AppState.settings.checkTime +
      effective * AppState.settings.timePerPage +
      taskTime,
  );
}

function updateEstimate() {
  const p = parseInt(elements.pages.value) || 0;
  const c = parseInt(elements.copies.value) || 0;
  let effective = p;
  if (elements.printType.value === "twoinone")
    effective = Math.ceil(effective / 2);
  if (elements.sides.value === "double") effective = Math.ceil(effective / 2);
  effective *= c;
  elements.effectivePages.textContent = effective;
  elements.estimate.textContent = calculateJobEstimate({
    pages: p,
    copies: c,
    printType: elements.printType.value,
    sides: elements.sides.value,
    additionalTask: elements.additionalTask.value,
  });
}

/* ================= WEB WORKER & ANALYTICS ================= */
let analyticsWorker;
function getAnalyticsWorker() {
  if (!analyticsWorker) {
    const workerCode = `
      self.onmessage = function(e) {
        const completedJobs = e.data;
        const pagesByTeacher = {};
        const onTime = new Array(24).fill(0);
        const late = new Array(24).fill(0);

        completedJobs.forEach((j) => {
          pagesByTeacher[j.teacher] = (pagesByTeacher[j.teacher] || 0) + j.pages * j.copies;
          if (j.completedAt) {
            const hour = new Date(j.completedAt).getHours();
            if (j.scheduledFor && new Date(j.completedAt) > new Date(j.scheduledFor)) {
              late[hour]++;
            } else {
              onTime[hour]++;
            }
          }
        });
        self.postMessage({ pagesByTeacher, onTime, late });
      };
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    analyticsWorker = new Worker(URL.createObjectURL(blob));
  }
  return analyticsWorker;
}

function updateCharts(completedJobs) {
  if (currentUser.role !== "admin") return;

  const teacherCanvas = document.getElementById("teacherChart");
  const timeCanvas = document.getElementById("timeChart");
  if (!teacherCanvas || !timeCanvas) return;

  // Utilize Web Worker to prevent UI blocking during heavy iteration
  const worker = getAnalyticsWorker();

  worker.onmessage = function (e) {
    const { pagesByTeacher, onTime, late } = e.data;

    if (window.teacherChartInstance) window.teacherChartInstance.destroy();
    if (window.timeChartInstance) window.timeChartInstance.destroy();

    window.teacherChartInstance = new Chart(teacherCanvas, {
      type: "bar",
      data: {
        labels: Object.keys(pagesByTeacher),
        datasets: [
          {
            label: "Total Pages Printed",
            data: Object.values(pagesByTeacher),
            backgroundColor: "#28a745",
          },
        ],
      },
      options: { responsive: true },
    });

    window.timeChartInstance = new Chart(timeCanvas, {
      type: "bar",
      data: {
        labels: [...Array(24).keys()].map((h) => `${h}:00`),
        datasets: [
          {
            label: "Completed On Time",
            data: onTime,
            backgroundColor: "#007bff",
          },
          {
            label: "Completed Late",
            data: late,
            backgroundColor: "#dc3545",
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          yAxes: [{ ticks: { beginAtZero: true, precision: 0 } }],
        },
      },
    });
  };

  worker.postMessage(completedJobs);
}

/* ================= FILE IMPORTS ================= */
function handleTeacherEmailUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const map = {};
    e.target.result
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        const [name, email] = line.split(";").map((x) => x.trim());
        if (name && email) {
          map[name] = email;
        }
      });
    localStorage.setItem(STORAGE_KEYS.TEACHER_EMAILS, JSON.stringify(map));
    alert("Teacher email list imported successfully.");
  };
  reader.readAsText(file);
}

function loadTeacherDropdowns() {
  const list = JSON.parse(localStorage.getItem(STORAGE_KEYS.TEACHERS)) || [];
  if (list.length > 0) {
    const options = list
      .map((t) => `<option value="${t}">${t}</option>`)
      .join("");
    elements.teacherSelect.innerHTML = options;
    elements.authTeacherSelect.innerHTML =
      `<option value="">— Select —</option>` + options;
    elements.teacherSelect.disabled = false;
    elements.authTeacherSelect.disabled = false;
  }
}

const handleCompletedUpload = (file) => {
  if (!file) return;
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const lines = e.target.result.split("\n").filter((line) => line.trim());
      let importCount = 0;

      lines.forEach((line) => {
        let completedJob;

        // ✅ TRY JSON FIRST
        try {
          const data = JSON.parse(line);

          completedJob = {
            ...data,

            // ✅ normalize critical fields
            id: data.id || ++idCounter,
            status: "Completed",
            requestedAt: data.requestedAt || Date.now(),
            completedAt: data.completedAt || Date.now(),

            // ✅ FIX DATE TYPE
            scheduledFor: data.scheduledFor
              ? new Date(data.scheduledFor).getTime()
              : Date.now(),
          };
        } catch {
          // 🔁 FALLBACK: pipe format (your old format)
          const parts = line.split("|").map((p) => p.trim());
          if (parts.length < 8) return;

          const [
            id,
            teacher,
            auth,
            pages,
            copies,
            type,
            sides,
            tasks,
            due,
            notes,
          ] = parts;

          completedJob = {
            id: parseInt(id) || ++idCounter,
            teacher: teacher || "Unknown",
            authoriser: auth || "",
            pages: parseInt(pages) || 1,
            copies: parseInt(copies) || 1,
            printType: type || "normal",
            sides: sides || "single",
            additionalTask: tasks || "none",

            scheduledFor: due ? new Date(due).getTime() : Date.now(),
            requestedAt: Date.now(),
            completedAt: Date.now(),

            jobNotes: notes || "",
            status: "Completed",
          };
        }

        // ✅ prevent overwrite
        if (jobs.has(completedJob.id)) {
          completedJob.id = ++idCounter;
        }

        jobs.set(completedJob.id, completedJob);

        if (completedJob.id >= idCounter) {
          idCounter = completedJob.id + 1;
        }

        importCount++;
      });

      AppState.save();
      rerenderAll();

      console.log("Imported jobs:", importCount);
      console.log("Jobs Map:", jobs);

      alert(`Successfully imported ${importCount} completed jobs.`);
    } catch (err) {
      console.error("Import Error:", err);
      alert("Error parsing file.");
    }
  };

  reader.readAsText(file);
};

function handleTodoUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    e.target.result
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        try {
          const data = JSON.parse(line);
          idCounter++;
          const newJob = {
            id: idCounter,
            teacher: data.teacher || "Unknown",
            authoriser: data.authoriser || "",
            pages: parseInt(data.pages || data.originalPages) || 0,
            copies: parseInt(data.copies) || 1,
            printType: data.printType || "normal",
            sides: data.sides || "single",
            additionalTask: data.additionalTask || "none",
            scheduledFor: data.scheduledFor || "",
            status: data.status || "Queued",
            requestedAt: data.requestedAt || Date.now(),
            completedAt: data.completedAt || null,
          };
          // Memoize imported job estimate
          newJob.estimate = calculateJobEstimate(newJob);
          jobs.set(idCounter, newJob);
        } catch {}
      });
    AppState.save();
    elements.todoFile.value = "";
    rerenderAll();
  };
  reader.readAsText(file);
}

/* ================= RENDERING & INFINITE SCROLL ================= */
function setupInfiniteScroll() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        completedJobsLimit += COMPLETED_INCREMENT;
        rerenderAll();
      }
    },
    { threshold: 1.0 },
  );

  const sentinel = document.getElementById("summary-sentinel");
  if (sentinel) {
    observer.observe(sentinel);
  }
}

function generateJobCardHtml(j, isCompleted = false) {
  let statusBadgeClass;
  let statusText;

  if (isCompleted) {
    statusBadgeClass = "badge-success";
    statusText = "Finished";
  } else if (j.status === "In process") {
    statusBadgeClass = "badge-primary";
    statusText = j.status;
  } else {
    statusBadgeClass = "badge-secondary";
    statusText = j.status;
  }

  // Use memoized estimate directly
  const estTime =
    j.estimate !== undefined ? j.estimate : calculateJobEstimate(j);
  const dueTime = j.scheduledFor
    ? new Date(j.scheduledFor).toLocaleString()
    : "ASAP";
  const reqTime = new Date(j.requestedAt).toLocaleString();
  const doneTime = j.completedAt
    ? new Date(j.completedAt).toLocaleString()
    : "";

  let actions = "";
  if (currentUser.role == "admin") {
    if (!isCompleted) {
      if (j.status === "Queued")
        actions += `<button class="btn btn-outline-primary" data-action="updateStatus" data-id="${j.id}" data-status="In process">Start</button>`;
      else if (j.status === "In process")
        actions += `<button class="btn btn-success" data-action="updateStatus" data-id="${j.id}" data-status="Completed">Finish</button>`;
      if (currentUser.role === "admin")
        actions += `<button class="btn btn-danger ml-2" data-action="deleteJob" data-id="${j.id}">Delete</button>`;
    }
  }

  let notificationBadge = "";

  if (isCompleted) {
    if (j.notificationStatus === "sent") {
      notificationBadge =
        "<span class='badge badge-success ml-2'>Email Sent</span>";
    } else if (j.notificationStatus === "skipped") {
      notificationBadge =
        "<span class='badge badge-warning ml-2'>No Email</span>";
    } else if (j.notificationStatus === "disabled") {
      notificationBadge =
        "<span class='badge badge-secondary ml-2'>Email Disabled</span>";
    }
  }

  const notesText = getJobNotes(j.reference);

  const notesHtml = notesText
    ? `
      <div class="mt-2 small bg-light border rounded p-2">
        <strong>Notes:</strong><br>
        ${notesText.replace(/\n/g, "<br>")}
      </div>
    `
    : "";

  const notesBtnClass = jobHasNotes(j.reference)
    ? "btn-outline-primary"
    : "btn-outline-secondary";

  /*<div class="mt-2">
        <button class="btn btn-sm ${notesBtnClass}" data-action="downloadNotes" data-ref="${j.reference}">Notes</button>
      </div>
  */
  return `
  <div class="card-body p-3">
    <div class="d-flex justify-content-between mb-2">
    <small class="text-muted">Ref: ${j.reference || "—"}</small>
    <strong>${j.teacher}</strong>
      <div>
        <span class="badge ${statusBadgeClass}">
          ${statusText}
        </span>
        ${notificationBadge}
      </div>
    </div>

    <div class="small mb-2">
        Requested: ${reqTime}<br>
        ${isCompleted ? `Completed: ${doneTime}<br>` : ""}
        Due by Date: ${dueTime}
      </div>
      ${notesHtml}

      <div><strong>Type:</strong> ${j.printType} | <strong>Side:</strong> ${j.sides}</div>
      <div class="small mb-2 mt-2">EST: ${estTime}s | VOL: ${j.pages}p × ${j.copies}c TASKS: ${j.additionalTask} </div>
      ${actions}
  </div>
`;
}

if (elements.scheduledFor && !elements.scheduledFor.value) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);
  elements.scheduledFor.value = tomorrow.toISOString().slice(0, 16);
}

function renderGanttTimeline(completedJobs, targetElement) {
  const container = targetElement;
  if (!container) return;

  container.innerHTML = "";

  if (!completedJobs.length) {
    container.innerHTML = "<p class='text-muted'>No completed jobs found.</p>";
    return;
  }

  // Normalize + sort by start time
  const jobs = completedJobs
    .map((j) => ({
      ...j,
      start: j.requestedAt || j.completedAt,
      end: j.completedAt,
    }))
    .filter((j) => j.start && j.end)
    .sort((a, b) => a.start - b.start);

  const minTime = Math.min(...jobs.map((j) => j.start));
  const maxTime = Math.max(...jobs.map((j) => j.end));
  const totalSpan = maxTime - minTime || 1;

  let html = `
    <div style="position: relative; width: 100%;">
  `;

  jobs.forEach((j) => {
    const left = ((j.start - minTime) / totalSpan) * 100;
    const width = ((j.end - j.start) / totalSpan) * 100;

    const startTime = new Date(j.start).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const endTime = new Date(j.end).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    html += `
      <div style="margin-bottom: 8px;">
        <div class="small">
          <strong>${j.teacher}</strong> (${j.pages}p × ${j.copies})
          <span class="text-muted"> ${startTime} → ${endTime}</span>
        </div>

        <div style="position: relative; height: 20px; background: #eee; border-radius: 4px;">
          <div style="
            position: absolute;
            left: ${left}%;
            width: ${Math.max(width, 1)}%;
            height: 100%;
            background: #007bff;
            border-radius: 4px;
          "></div>
        </div>
      </div>
    `;
  });

  html += "</div>";

  container.innerHTML = html;
}

function renderWeeklyCalendar(completedJobs, targetElement) {
  const container = targetElement;
  if (!container) return;

  container.innerHTML = "";

  if (!completedJobs.length) {
    container.innerHTML = "<p class='text-muted'>No completed jobs found.</p>";
    return;
  }

  // Group jobs by day name
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const grouped = {};

  completedJobs.forEach((job) => {
    if (!job.completedAt) return;

    const date = new Date(job.completedAt);
    const dayName = days[date.getDay()];

    if (!grouped[dayName]) grouped[dayName] = [];

    grouped[dayName].push(job);
  });

  // Build table
  let html = `
    <table class="table table-sm table-bordered">
      <thead class="thead-light">
        <tr>
          <th>Day</th>
          <th>Jobs</th>
          <th>Details</th>
          <th>Total Time</th>
        </tr>
      </thead>
      <tbody>
  `;

  days.forEach((day) => {
    const jobs = grouped[day] || [];

    if (jobs.length === 0) {
      html += `
        <tr>
          <td>${day}</td>
          <td>0</td>
          <td class="text-muted">—</td>
          <td>0s</td>
        </tr>
      `;
      return;
    }

    // Sort jobs by start time
    jobs.sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0));

    let totalTime = 0;

    const details = jobs
      .map((j) => {
        const start = new Date(j.requestedAt || j.completedAt);
        const end = new Date(j.completedAt);

        const duration = Math.max(0, (end - start) / 1000);
        totalTime += duration;

        return `
        <div>
          <strong>${j.teacher}</strong> |
          ${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          →
          ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          | ${j.pages}p × ${j.copies}c
        </div>
      `;
      })
      .join("");

    html += `
      <tr>
        <td><strong>${day}</strong></td>
        <td>${jobs.length}</td>
        <td>${details}</td>
        <td><strong>${Math.round(totalTime)}s</strong></td>
      </tr>
    `;
  });

  html += "</tbody></table>";

  container.innerHTML = html;
}

function rerenderAll() {
  const all = Array.from(jobs.values());

  let active = all.filter((j) => j.status !== "Completed");
  const now = new Date();

  active = active.filter((j) => {
    if (!j.scheduledFor) return dueDateFilter === "all";

    const due = new Date(j.scheduledFor);

    switch (dueDateFilter) {
      case "today":
        return due.toDateString() === now.toDateString();
      case "tomorrow": {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        return due.toDateString() === tomorrow.toDateString();
      }
      case "week": {
        const weekEnd = new Date(now);
        weekEnd.setDate(now.getDate() + 7);
        return due >= now && due <= weekEnd;
      }
      case "overdue":
        return isOverdue(j);
      default:
        return true;
    }
  });

  let completed = all.filter((j) => j.status === "Completed");

  if (searchQuery) {
    active = active.filter((j) =>
      j.teacher.toLowerCase().includes(searchQuery),
    );
    completed = completed.filter((j) =>
      j.teacher.toLowerCase().includes(searchQuery),
    );
  }

  elements.jobCount.textContent = `${active.length} job${active.length === 1 ? "" : "s"}`;

  const mode = AppState.settings.priorityMode;

  if (mode === "overdue") {
    active.sort((a, b) => {
      const aOverdue = isOverdue(a) ? 0 : 1;
      const bOverdue = isOverdue(b) ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      return a.requestedAt - b.requestedAt;
    });
  } else if (mode === "estimate") {
    active.sort((a, b) => {
      const aTime = a.estimate; // utilizing memoization
      const bTime = b.estimate;
      if (aTime !== bTime) return aTime - bTime;
      return a.requestedAt - b.requestedAt;
    });
  } else if (mode === "quick") {
    const QUICK_THRESHOLD = 300;
    active.sort((a, b) => {
      const aQuick = a.estimate <= QUICK_THRESHOLD ? 0 : 1;
      const bQuick = b.estimate <= QUICK_THRESHOLD ? 0 : 1;
      if (aQuick !== bQuick) return aQuick - bQuick;
      return a.requestedAt - b.requestedAt;
    });
  } else if (mode === "due") {
    active.sort((a, b) =>
      (a.scheduledFor || "Z") > (b.scheduledFor || "Z") ? 1 : -1,
    );
  } else if (mode === "size") {
    active.sort((a, b) => a.pages * a.copies - b.pages * b.copies);
  } else {
    active.sort((a, b) => a.requestedAt - b.requestedAt);
  }

  const totalPages = Math.max(1, Math.ceil(active.length / ITEMS_PER_PAGE));
  const pageItems = active.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  elements.queue.innerHTML = "";
  const queueFragment = document.createDocumentFragment();

  pageItems.forEach((j) => {
    const card = document.createElement("div");
    card.className = "card mb-2 job";
    if (isOverdue(j)) {
      card.classList.add("job-overdue");
    } else if (isUrgent(j)) {
      card.classList.add("job-urgent");
    }
    card.innerHTML = generateJobCardHtml(j, false);
    queueFragment.appendChild(card);
  });

  elements.queue.appendChild(queueFragment);

  if (elements.weeklySummary) {
    // Sort completed jobs chronologically (newest first)
    completed.sort(
      (a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0),
    );

    // Apply limit based on Intersection Observer
    const visibleCompleted = completed.slice(0, completedJobsLimit);

    elements.weeklySummary.innerHTML = "";
    const completedFragment = document.createDocumentFragment();

    visibleCompleted.forEach((j) => {
      const card = document.createElement("div");
      card.className = "card mb-2";
      if (wasOverdue(j)) {
        card.classList.add("border-warning", "bg-light");
      }
      card.innerHTML = generateJobCardHtml(j, true);
      completedFragment.appendChild(card);
    });

    elements.weeklySummary.appendChild(completedFragment);

    // Create and attach sentinel for Infinite Scroll
    if (completed.length > completedJobsLimit) {
      const sentinel = document.createElement("div");
      sentinel.id = "summary-sentinel";
      sentinel.className = "text-center p-3 text-muted";
      sentinel.innerHTML = "<em>Loading more...</em>";
      elements.weeklySummary.appendChild(sentinel);
      setupInfiniteScroll();
    }

    updateCharts(completed);
  }

  elements.pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

/* ================= GLOBAL METHODS ================= */
function sendCompletionEmailViaMailto(job) {
  if (!isEmailNotificationEnabled()) return false;
  if (!job || !job.teacher) return;

  const emailMap = JSON.parse(
    localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS) || "{}",
  );
  const teacherEmail = emailMap[job.teacher];
  if (!teacherEmail) {
    console.warn(`No email address found for ${job.teacher}`);
    return true;
  }

  const subject = encodeURIComponent("Your print job has been completed");
  const body = encodeURIComponent(
    [
      `Dear ${job.teacher},`,
      "",
      "Your print / photocopy job has now been completed.",
      "",
      `Job ID: ${job.id}`,
      `Pages: ${job.pages}`,
      `Copies: ${job.copies}`,
      job.scheduledFor
        ? `Due: ${new Date(job.scheduledFor).toLocaleString()}`
        : "Due: ASAP",
      "",
      "Regards,",
      "Print Room",
    ].join("\n"),
  );

  window.location.href = `mailto:${teacherEmail}?subject=${subject}&body=${body}`;
}

window.updateStatus = (id, status) => {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;

  if (status === "Completed") {
    job.completedAt = Date.now();
    if (!isEmailNotificationEnabled()) {
      job.notificationStatus = "disabled";
    } else {
      const sent = sendCompletionEmailViaMailto(job);
      job.notificationStatus = sent ? "sent" : "skipped";
    }
    completedJobsLimit = 10; // reset scroll state
  }

  AppState.save();
  rerenderAll();
};

window.deleteJob = (id) => {
  if (!confirm("Delete job?")) return;
  jobs.delete(id);
  AppState.save();
  rerenderAll();
};

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {
  AppState.load();

  // Sync Modal Inputs with AppState
  const settingsMap = {
    timePerPage: elements.setting_timePerPage,
    loadTime: elements.setting_loadTime,
    checkTime: elements.setting_checkTime,
    trimmingTime: elements.setting_trimmingTime,
    staplingTime: elements.setting_staplingTime,
  };

  Object.entries(settingsMap).forEach(([key, el]) => {
    if (el) {
      // Set initial value from AppState
      el.value = AppState.settings[key];

      // Save on change
      el.oninput = () => {
        AppState.settings[key] = parseInt(el.value) || 0;
        AppState.save();
        updateEstimate(); // Recalculate any live estimates on the main form
      };
    }
  });

  loadTeacherDropdowns();

  elements.emailNotificationsEnabled.checked =
    localStorage.getItem(STORAGE_KEYS.EMAIL_ENABLED) === "true";

  elements.loginBtn.onclick = handleLogin;
  elements.logoutBtn.onclick = handleLogout;

  elements.openWeeklyCalendarBtn?.addEventListener("click", () => {
    const completed = Array.from(jobs.values())
      .filter((j) => j.status === "Completed")
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    document.querySelector("#weeklyCalendarModal .modal-title").textContent = "Weekly Calendar View";  
    renderWeeklyCalendar(completed, elements.weeklyCalendarContainer);

    // Show modal (Bootstrap 4)
    $("#weeklyCalendarModal").modal("show");
  });

  elements.openGanttViewBtn?.addEventListener("click", () => {
    const completed = Array.from(jobs.values())
      .filter((j) => j.status === "Completed")
      .sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));

    document.querySelector("#weeklyCalendarModal .modal-title").textContent = "Gantt Timeline View";  
    renderGanttTimeline(completed, elements.weeklyCalendarContainer);

    $("#weeklyCalendarModal").modal("show");
  });

  elements.priorityMode.onchange = () => {
    AppState.settings.priorityMode = elements.priorityMode.value;
    AppState.save();
    rerenderAll();
  };

  elements.completedFile.onchange = (e) =>
    handleCompletedUpload(e.target.files[0]);

  const priorityHelpText = {
    fifo: "Jobs are processed in the order they were submitted (fair and predictable).",
    due: "Jobs with the earliest required-by date are prioritised.",
    overdue: "Overdue jobs are prioritised to prevent missed deadlines.",
    estimate:
      "Jobs with the shortest estimated print time are processed first.",
    quick: "Very small jobs are prioritised to clear the queue quickly.",
    size: "Jobs are sorted by total size (pages × copies).",
  };

  elements.priorityMode.addEventListener("change", () => {
    const mode = elements.priorityMode.value;
    if (elements.priorityHelp && priorityHelpText[mode]) {
      elements.priorityHelp.textContent = priorityHelpText[mode];
    }
  });

  if (
    elements.priorityHelp &&
    priorityHelpText[AppState.settings.priorityMode]
  ) {
    elements.priorityHelp.textContent =
      priorityHelpText[AppState.settings.priorityMode];
  }

  // --- EVENT DELEGATION SETUP --- //

  elements.queue.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id);

    if (action === "updateStatus") window.updateStatus(id, btn.dataset.status);
    else if (action === "deleteJob") window.deleteJob(id);
    else if (action === "downloadNotes") window.downloadNotes(btn.dataset.ref);
  });

  elements.weeklySummary.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "downloadNotes") {
      window.downloadNotes(btn.dataset.ref);
    }
  });

  elements.dueDateFiltersContainer?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-filter]");
    if (!btn) return;

    dueDateFilter = btn.dataset.filter;

    elements.dueDateFiltersContainer
      .querySelectorAll("button")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    currentPage = 1;
    rerenderAll();
  });

  // ------------------------------ //

  elements.submitBtn.onclick = () => {
    elements.submitBtn.disabled = true;
    const scheduledValue = elements.scheduledFor.value;

    if (scheduledValue) {
      const scheduledTime = new Date(scheduledValue).getTime();
      const now = Date.now();
      if (scheduledTime < now) {
        alert("You cannot schedule a print job in the past.");
        elements.submitBtn.disabled = false;
        return;
      }
    }

    if (!elements.teacherSelect.value) {
      alert("Select teacher");
      elements.submitBtn.disabled = false;
      return;
    }

    idCounter++;
    const reference = generateJobReference();

    const newJob = {
      id: idCounter,
      reference,
      teacher: elements.teacherSelect.value,
      authoriser: elements.authTeacherSelect.value,
      pages: +elements.pages.value,
      copies: +elements.copies.value,
      printType: elements.printType.value,
      sides: elements.sides.value,
      additionalTask: elements.additionalTask.value,
      scheduledFor: elements.scheduledFor.value,
      status: "Queued",
      requestedAt: Date.now(),
      completedAt: null,
    };

    // Memoize on creation
    newJob.estimate = calculateJobEstimate(newJob);
    jobs.set(idCounter, newJob);

    const notesText = elements.jobNotes.value.trim();
    if (notesText) {
      saveJobNotes(reference, notesText);
    }

    AppState.save();

    if (elements.priorityMode) {
      elements.priorityMode.value = AppState.settings.priorityMode;
    }

    rerenderAll();
    elements.jobNotes.value = "";
    elements.submitBtn.disabled = false;

    alert(`Job ${reference} has been added to the queue.`);
  };

  /**
   * Unified Import: Handles "Name" or "Name;email@example.com"
   */
  const handleUnifiedTeacherImport = (file) => {
    if (!file) return;
    const reader = new FileReader();

    reader.onload = (e) => {
      const lines = e.target.result
        .split(/\r?\n/)
        .filter((line) => line.trim());
      const teacherList = [];
      const emailMap =
        JSON.parse(localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS)) || {};

      lines.forEach((line) => {
        // Split by semicolon to check for email
        const [name, email] = line.split(";").map((item) => item.trim());

        if (name) {
          teacherList.push(name);
          if (email) {
            emailMap[name] = email;
          }
        }
      });

      // Save both sets of data
      localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(teacherList));
      localStorage.setItem(
        STORAGE_KEYS.TEACHER_EMAILS,
        JSON.stringify(emailMap),
      );

      // Refresh UI
      loadTeacherDropdowns();
      alert(
        `Imported ${teacherList.length} teachers and updated email records.`,
      );
    };
    reader.readAsText(file);
  };

  // Register the listener
  elements.teacherFile.onchange = (e) =>
    handleUnifiedTeacherImport(e.target.files[0]);

  elements.saveTodoBtn.onclick = () => {
    const todoJobs = Array.from(jobs.values()).filter(
      (j) => j.status !== "Completed",
    );
    exportJobsToFile(todoJobs, "todo.txt");
  };

  elements.saveCompletedBtn.onclick = () => {
    const completedJobs = Array.from(jobs.values()).filter(
      (j) => j.status === "Completed",
    );
    exportJobsToFile(completedJobs, "completed.txt");
  };

  elements.clearQueueBtn.onclick = () => {
    completedJobsLimit = 10;
    if (
      !confirm(
        "This will permanently delete ALL jobs (queued and completed). Continue?",
      )
    ) {
      return;
    }
    jobs.clear();
    idCounter = 0;
    AppState.save();
    rerenderAll();
  };

  elements.todoFile.onchange = (e) => handleTodoUpload(e.target.files[0]);

  // Debounced search input
  elements.searchInput.oninput = debounce((e) => {
    searchQuery = e.target.value.toLowerCase();
    currentPage = 1;
    completedJobsLimit = 10; // reset infinite scroll on search
    rerenderAll();
  }, 250);

  elements.prevPageBtn.onclick = () => {
    currentPage--;
    rerenderAll();
  };

  elements.nextPageBtn.onclick = () => {
    currentPage++;
    rerenderAll();
  };

  [
    elements.pages,
    elements.copies,
    elements.printType,
    elements.sides,
    elements.additionalTask,
  ].forEach((el) => (el.oninput = updateEstimate));

  updateEstimate();
  rerenderAll();
});

$("#weeklyCalendarModal").on("hidden.bs.modal", function () {
  elements.weeklyCalendarContainer.innerHTML = "";
});
