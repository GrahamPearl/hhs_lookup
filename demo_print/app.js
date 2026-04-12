/**
 * TEACHER PRINTING & PHOTOCOPY BOOKING SYSTEM
 * Canonical app.js with extended analytics (strict reconstitution)
 */

/* ================= PERSISTENCE & GLOBAL STATE ================= */
const STORAGE_KEYS = {
  JOBS: "printqueue_jobs",
  SETTINGS: "printqueue_settings",
  TEACHERS: "printqueue_teachers",
  ID_COUNTER: "printqueue_idcounter",
  TEACHER_EMAILS: "printqueue_teacher_emails",
  EMAIL_ENABLED: "printqueue_email_enabled",
};

let ADMIN_CREDENTIALS = [];
let jobs = new Map();
let idCounter = 0;
let currentUser = { email: null, role: null, authenticated: false };
let dueDateFilter = "all";

let currentPage = 1;
const ITEMS_PER_PAGE = 5;

let completedPage = 1;
const COMPLETED_PER_PAGE = 5;

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
        savedJobs.forEach((j) => jobs.set(j.id, j));
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

/* ================= DOM ELEMENTS ================= */
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

function exportJobsToFile(jobsArray, defaultFilename) {
  if (!jobsArray.length) {
    alert("No jobs to export.");
    return;
  }

  const userFilename = prompt(
    "Enter filename (without extension):",
    defaultFilename.replace(".txt", ""),
  );

  if (!userFilename) return; // user cancelled

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
  // Only meaningful for completed jobs
  if (job.status !== "Completed") return false;

  // If there was no due date, it cannot be overdue
  if (!job.scheduledFor || !job.completedAt) return false;

  return new Date(job.completedAt) > new Date(job.scheduledFor);
}

function handleLogin() {
  const email = document
    .getElementById("emailInput")
    .value.trim()
    .toLowerCase();
  const password = document.getElementById("passwordInput").value;
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

/* ================= CALCULATIONS ================= */
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

/* ================= ANALYTICS & CHARTS ================= */
function updateCharts(completedJobs) {
  if (currentUser.role !== "admin") return;

  const teacherCanvas = document.getElementById("teacherChart");
  const timeCanvas = document.getElementById("timeChart");
  if (!teacherCanvas || !timeCanvas) return;

  const pagesByTeacher = {};
  const onTime = new Array(24).fill(0); // whole numbers only
  const late = new Array(24).fill(0); // whole numbers only

  completedJobs.forEach((j) => {
    pagesByTeacher[j.teacher] =
      (pagesByTeacher[j.teacher] || 0) + j.pages * j.copies;

    if (j.completedAt) {
      const hour = new Date(j.completedAt).getHours();
      if (
        j.scheduledFor &&
        new Date(j.completedAt) > new Date(j.scheduledFor)
      ) {
        late[hour]++; // completed past due
      } else {
        onTime[hour]++; // completed on time or no due date
      }
    }
  });

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
          jobs.set(idCounter, {
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
          });
        } catch {}
      });
    AppState.save();
    elements.todoFile.value = "";
    rerenderAll();
  };
  reader.readAsText(file);
}

/* ================= RENDERING ================= */
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

  const estTime = calculateJobEstimate(j);
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
        actions += `<button class="btn btn-outline-primary" onclick="updateStatus(${j.id}, 'In process')">Start</button>`;
      else if (j.status === "In process")
        actions += `<button class="btn btn-success" onclick="updateStatus(${j.id}, 'Completed')">Finish</button>`;
      if (currentUser.role === "admin")
        actions += `<button class="btn btn-danger ml-2" onclick="deleteJob(${j.id})">Delete</button>`;
    } else {
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

  return `
  <div class="card-body p-3">
    <div class="d-flex justify-content-between mb-2">
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
      <div class="small mb-2">EST: ${estTime}s | VOL: ${j.pages}p × ${j.copies}c TASKS: ${j.additionalTask} </div>
      ${actions}
  </div>
`;

  /*
  return `
    <div class="card-body p-3">
      <div class="d-flex justify-content-between mb-2">
        <strong>${j.teacher}</strong>
        <span class="badge ${isCompleted ? "badge-success" : j.status === "In process" ? "badge-primary" : "badge-secondary"}">${isCompleted ? "Finished" : j.status}</span>
      </div>
      <div class="small mb-2">
        Requested: ${reqTime}<br>
        ${isCompleted ? `Completed: ${doneTime}<br>` : ""}
        Due by Date: ${dueTime}
      </div>
      <div class="small mb-2">EST: ${estTime}s | VOL: ${j.pages}p × ${j.copies}c TASKS: ${j.additionalTask} </div>
      ${actions}
    </div>
  `;*/
}

const scheduledInput = elements.scheduledFor;

if (scheduledInput && !scheduledInput.value) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);

  // datetime-local requires YYYY-MM-DDTHH:MM
  scheduledInput.value = tomorrow.toISOString().slice(0, 16);
}

function rerenderAll() {
  const all = Array.from(jobs.values());

  let active = all.filter((j) => j.status !== "Completed");
  const now = new Date();

  active = active.filter((j) => {
    if (!j.scheduledFor) return dueDateFilter === "all"; // ASAP jobs

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
        return true; // "all"
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

  document.getElementById("jobCount").textContent =
    `${active.length} job${active.length === 1 ? "" : "s"}`;

  const completedTotalPages = Math.max(
    1,
    Math.ceil(completed.length / COMPLETED_PER_PAGE),
  );

  const completedPageItems = completed.slice(
    (completedPage - 1) * COMPLETED_PER_PAGE,
    completedPage * COMPLETED_PER_PAGE,
  );

  if (searchQuery)
    active = active.filter((j) =>
      j.teacher.toLowerCase().includes(searchQuery),
    );

  const mode = AppState.settings.priorityMode;

  if (mode === "overdue") {
    active.sort((a, b) => {
      const aOverdue = isOverdue(a) ? 0 : 1;
      const bOverdue = isOverdue(b) ? 0 : 1;

      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      return a.requestedAt - b.requestedAt; // FIFO tie‑breaker
    });
  } else if (mode === "estimate") {
    active.sort((a, b) => {
      const aTime = calculateJobEstimate(a);
      const bTime = calculateJobEstimate(b);

      if (aTime !== bTime) return aTime - bTime;
      return a.requestedAt - b.requestedAt;
    });
  } else if (mode === "quick") {
    const QUICK_THRESHOLD = 300; // seconds (5 minutes)

    active.sort((a, b) => {
      const aQuick = calculateJobEstimate(a) <= QUICK_THRESHOLD ? 0 : 1;
      const bQuick = calculateJobEstimate(b) <= QUICK_THRESHOLD ? 0 : 1;

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
    // FIFO
    active.sort((a, b) => a.requestedAt - b.requestedAt);
  }

  const totalPages = Math.max(1, Math.ceil(active.length / ITEMS_PER_PAGE));
  const pageItems = active.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  elements.queue.innerHTML = "";

  pageItems.forEach((j) => {
    const card = document.createElement("div");
    card.className = "card mb-2 job";

    // ✅ Apply urgency / overdue styling (Active Queue only)
    if (isOverdue(j)) {
      card.classList.add("job-overdue");
    } else if (isUrgent(j)) {
      card.classList.add("job-urgent");
    }

    card.innerHTML = generateJobCardHtml(j, false);
    elements.queue.appendChild(card);
  });

  if (currentUser.role === "admin") {
    elements.weeklySummary.innerHTML = "";

    completedPageItems.forEach((j) => {
      const card = document.createElement("div");
      card.className = "card mb-2";

      if (wasOverdue(j)) {
        card.classList.add("border-warning", "bg-light");
      }

      card.innerHTML = generateJobCardHtml(j, true);
      elements.weeklySummary.appendChild(card);
    });

    const pagination = document.createElement("div");
    pagination.className =
      "d-flex justify-content-between align-items-center mt-2 small";

    pagination.innerHTML = `
  <button class="btn btn-sm btn-outline-secondary" ${completedPage === 1 ? "disabled" : ""}>
    Previous
  </button>
  <span class="text-muted">
    Page ${completedPage} of ${completedTotalPages}
  </span>
  <button class="btn btn-sm btn-outline-secondary" ${completedPage === completedTotalPages ? "disabled" : ""}>
    Next
  </button>
`;

    const [prevBtn, , nextBtn] = pagination.children;

    prevBtn.onclick = () => {
      completedPage--;
      rerenderAll();
    };

    nextBtn.onclick = () => {
      completedPage++;
      rerenderAll();
    };

    elements.weeklySummary.appendChild(pagination);

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

function maybeSendCompletionEmail(job) {
  const enabled = localStorage.getItem(STORAGE_KEYS.EMAIL_ENABLED) === "true";
  if (!enabled) return;

  const emailMap = JSON.parse(
    localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS) || "{}",
  );

  const email = emailMap[job.teacher];
  if (!email) {
    console.warn("No email found for teacher:", job.teacher);
    return;
  }

  // ✅ STUB: this is where real email sending plugs in later
  console.info(
    `[EMAIL QUEUED] To: ${email}`,
    `Job #${job.id} has been completed.`,
  );
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

    completedPage = 1;
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
  loadTeacherDropdowns();

  const emailToggle = document.getElementById("emailNotificationsEnabled");

  emailToggle.checked =
    localStorage.getItem(STORAGE_KEYS.EMAIL_ENABLED) === "true";

  document.getElementById("loginBtn").onclick = handleLogin;
  document.getElementById("logoutBtn").onclick = handleLogout;

  elements.priorityMode.onchange = () => {
    AppState.settings.priorityMode = elements.priorityMode.value;
    AppState.save();
    rerenderAll();
  };

  const priorityHelpText = {
    fifo: "Jobs are processed in the order they were submitted (fair and predictable).",
    due: "Jobs with the earliest required-by date are prioritised.",
    overdue: "Overdue jobs are prioritised to prevent missed deadlines.",
    estimate:
      "Jobs with the shortest estimated print time are processed first.",
    quick: "Very small jobs are prioritised to clear the queue quickly.",
    size: "Jobs are sorted by total size (pages × copies).",
  };

  const helpEl = document.getElementById("priorityHelp");

  // ✅ SAFELY attach without overwriting existing handlers
  elements.priorityMode.addEventListener("change", () => {
    const mode = elements.priorityMode.value;

    if (helpEl && priorityHelpText[mode]) {
      helpEl.textContent = priorityHelpText[mode];
    }
  });

  // ✅ Initialise on page load
  if (helpEl && priorityHelpText[AppState.settings.priorityMode]) {
    helpEl.textContent = priorityHelpText[AppState.settings.priorityMode];
  }

  document.getElementById("submitBtn").onclick = () => {
    const scheduledValue = elements.scheduledFor.value;

    if (scheduledValue) {
      const scheduledTime = new Date(scheduledValue).getTime();
      const now = Date.now();

      if (scheduledTime < now) {
        alert("You cannot schedule a print job in the past.");
        return;
      }
    }

    document.querySelectorAll("#dueDateFilters button").forEach((btn) => {
      btn.onclick = () => {
        dueDateFilter = btn.dataset.filter;

        // Visual active state
        document
          .querySelectorAll("#dueDateFilters button")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        currentPage = 1; // reset pagination
        rerenderAll();
      };
    });

    if (!elements.teacherSelect.value) return alert("Select teacher");
    idCounter++;
    jobs.set(idCounter, {
      id: idCounter,
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
    });
    AppState.save();

    if (elements.priorityMode) {
      elements.priorityMode.value = AppState.settings.priorityMode;
    }

    rerenderAll();
  };

  document.getElementById("teacherEmailFile").onchange = (e) =>
    handleTeacherEmailUpload(e.target.files[0]);

  emailToggle.onchange = () => {
    localStorage.setItem(
      STORAGE_KEYS.EMAIL_ENABLED,
      emailToggle.checked.toString(),
    );
  };

  document.getElementById("saveTodoBtn").onclick = () => {
    const todoJobs = Array.from(jobs.values()).filter(
      (j) => j.status !== "Completed",
    );

    exportJobsToFile(todoJobs, "todo.txt");
  };

  document.getElementById("saveCompletedBtn").onclick = () => {
    const completedJobs = Array.from(jobs.values()).filter(
      (j) => j.status === "Completed",
    );

    exportJobsToFile(completedJobs, "completed.txt");
  };

  document.getElementById("clearQueueBtn").onclick = () => {
    completedPage = 1;
    if (
      !confirm(
        "This will permanently delete ALL jobs (queued and completed). Continue?",
      )
    ) {
      return;
    }

    jobs.clear(); // Clear the Map (active + completed)
    idCounter = 0; // Reset ID counter
    AppState.save(); // Persist empty state to localStorage
    rerenderAll(); // Refresh UI
  };

  elements.todoFile.onchange = (e) => handleTodoUpload(e.target.files[0]);

  elements.teacherFile.onchange = (e) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      localStorage.setItem(
        STORAGE_KEYS.TEACHERS,
        JSON.stringify(ev.target.result.split(/\r?\n/).filter(Boolean)),
      );
      loadTeacherDropdowns();
    };
    reader.readAsText(e.target.files[0]);
  };

  elements.searchInput.oninput = (e) => {
    searchQuery = e.target.value.toLowerCase();
    currentPage = 1;
    rerenderAll();
  };
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
