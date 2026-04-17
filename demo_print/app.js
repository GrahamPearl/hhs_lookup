/**
 * Teacher Print Queue System (Grade-aware + Custom Grade Labels)
 * - Vanilla JS, client-side only
 * - jobs stored in Map; persisted to localStorage
 * - rerenderAll() is the only DOM render pipeline
 */

/* ================= UTILITIES ================= */
const debounce = (func, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(null, args), delay);
  };
};

const safeJsonParse = (txt, fallback) => {
  try {
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
};

const intersects = (a, b) => {
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
};

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

/* ================= STORAGE KEYS ================= */
const STORAGE_KEYS = {
  JOBS: "printqueue_jobs",
  SETTINGS: "printqueue_settings",
  TEACHERS: "printqueue_teachers",
  ID_COUNTER: "printqueue_idcounter",
  TEACHER_EMAILS: "printqueue_teacher_emails",
  EMAIL_ENABLED: "printqueue_email_enabled",
  NOTES: "printqueue_notes",
  ADMIN_GRADE_MAP: "printqueue_admin_grade_map",
  GRADE_LIST: "printqueue_grade_list",
};

const DEFAULT_GRADES = [
  "Grade 8",
  "Grade 9",
  "Grade 10",
  "Grade 11",
  "Grade 12",
];

/* ================= GLOBAL STATE ================= */
let ADMIN_CREDENTIALS = []; // {email,password,role}
let jobs = new Map();
let idCounter = 0;
let currentUser = {
  email: null,
  role: null,
  authenticated: false,
  assignedGrades: [],
};
let dueDateFilter = "all";
let currentPage = 1;
const ITEMS_PER_PAGE = 5;

let completedJobsLimit = 10;
const COMPLETED_INCREMENT = 10;
let observer = null;

let searchQuery = "";

/* ================= READ-ONLY SELECTORS ================= */
const getAllJobs = () => Array.from(jobs.values());
const getActiveJobs = () =>
  getAllJobs().filter((j) => j.status !== "Completed");
const getCompletedJobs = () =>
  getAllJobs().filter((j) => j.status === "Completed");

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
    idCounter = parseInt(
      localStorage.getItem(STORAGE_KEYS.ID_COUNTER) || "0",
      10,
    );

    const savedJobs = safeJsonParse(
      localStorage.getItem(STORAGE_KEYS.JOBS) || "[]",
      [],
    );
    jobs.clear();
    savedJobs.forEach((j) => {
      const job = normalizeJob(j);
      jobs.set(job.id, job);
    });

    const savedSettings = safeJsonParse(
      localStorage.getItem(STORAGE_KEYS.SETTINGS) || "null",
      null,
    );
    if (savedSettings) this.settings = { ...this.settings, ...savedSettings };

    const maxId = Math.max(0, ...Array.from(jobs.keys()));
    if (idCounter < maxId) idCounter = maxId;
  },
  save() {
    localStorage.setItem(STORAGE_KEYS.JOBS, JSON.stringify(getAllJobs()));
    localStorage.setItem(STORAGE_KEYS.ID_COUNTER, String(idCounter));
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
  gradeChecklist: document.getElementById("gradeChecklist"),
  jobNotes: document.getElementById("jobNotes"),
  effectivePages: document.getElementById("effectivePages"),
  estimate: document.getElementById("estimate"),
  submitBtn: document.getElementById("submitBtn"),

  queue: document.getElementById("queue"),
  jobCount: document.getElementById("jobCount"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  pageInfo: document.getElementById("pageInfo"),

  searchInput: document.getElementById("searchInput"),
  dueDateFiltersContainer: document.getElementById("dueDateFilters"),

  loginCard: document.getElementById("loginCard"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),

  adminSettings: document.getElementById("adminSettings"),
  weeklyReportControls: document.getElementById("weeklyReportControls"),
  weeklySummary: document.getElementById("weeklySummaryContent"),

  priorityMode: document.getElementById("priorityMode"),
  priorityHelp: document.getElementById("priorityHelp"),

  emailNotificationsEnabled: document.getElementById(
    "emailNotificationsEnabled",
  ),

  teacherFile: document.getElementById("teacherFile"),
  todoFile: document.getElementById("todoFile"),
  completedFile: document.getElementById("completedFile"),

  saveTodoBtn: document.getElementById("saveTodoBtn"),
  saveCompletedBtn: document.getElementById("saveCompletedBtn"),
  clearQueueBtn: document.getElementById("clearQueueBtn"),

  setting_timePerPage: document.getElementById("setting_timePerPage"),
  setting_loadTime: document.getElementById("setting_loadTime"),
  setting_checkTime: document.getElementById("setting_checkTime"),
  setting_trimmingTime: document.getElementById("setting_trimmingTime"),
  setting_staplingTime: document.getElementById("setting_staplingTime"),

  weeklyCalendarContainer: document.getElementById("weeklyCalendarContainer"),
  openWeeklyCalendarBtn: document.getElementById("openWeeklyCalendarBtn"),
  openGanttViewBtn: document.getElementById("openGanttViewBtn"),

  superAdminPanel: document.getElementById("superAdminPanel"),
  adminUserSelect: document.getElementById("adminUserSelect"),
  adminGradeChecklist: document.getElementById("adminGradeChecklist"),
  saveAdminGradesBtn: document.getElementById("saveAdminGradesBtn"),
  clearAdminGradesBtn: document.getElementById("clearAdminGradesBtn"),
  adminAssignmentsList: document.getElementById("adminAssignmentsList"),

  // NEW: Grade list editor
  gradeListInput: document.getElementById("gradeListInput"),
  saveGradeListBtn: document.getElementById("saveGradeListBtn"),
  resetGradeListBtn: document.getElementById("resetGradeListBtn"),
  gradeListStatus: document.getElementById("gradeListStatus"),
};

const AnalyticsFilters = {
  grades: new Set(), // empty = all grades
};

const TrendDateRange = {
  from: null, // Date or null
  to: null, // Date or null
};

const GRADE_ANALYTICS_VIEWS = {
  jobsPerGrade: {
    render: renderJobsPerGrade,
    isTrend: false,
  },
  timePerGrade: {
    render: renderEstimatedTimePerGrade,
    isTrend: false,
  },
  volumePerGrade: {
    render: renderVolumePerGrade,
    isTrend: false,
  },
  onTimeVsLate: {
    render: renderOnTimeVsLateByGrade,
    isTrend: false,
  },
  turnaround: {
    render: renderMedianTurnaroundByGrade,
    isTrend: false,
  },

  // ✅ TREND VIEWS
  jobsTrend: {
    render: renderJobsCompletedPerGradeTrend,
    isTrend: true,
  },
  onTimeTrend: {
    render: renderOnTimePercentageTrend,
    isTrend: true,
  },
  heatmap: {
    render: renderDayHourCompletionHeatmap,
    isTrend: true,
  },
};

function populateAnalyticsGradeSelector() {
  const select = document.getElementById("analyticsGradeSelector");
  if (!select) return;

  const grades = new Set();

  getCompletedJobs().forEach((job) => {
    normalizeGrades(job.grades).forEach((g) => grades.add(g));
  });

  select.innerHTML = Array.from(grades)
    .sort()
    .map((g) => `<option value="${g}">${g}</option>`)
    .join("");
}

function jobPassesAnalyticsGradeFilter(job) {
  if (AnalyticsFilters.grades.size === 0) return true;

  return normalizeGrades(job.grades).some((g) =>
    AnalyticsFilters.grades.has(g),
  );
}

function setPresetDateRange(preset) {
  const now = new Date();
  let from = null;

  switch (preset) {
    case "week":
      from = new Date(now);
      from.setDate(now.getDate() - now.getDay());
      break;

    case "month":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;

    case "term":
      // simple school-friendly default: last 90 days
      from = new Date(now);
      from.setDate(now.getDate() - 90);
      break;

    case "all":
      from = null;
      break;
  }

  TrendDateRange.from = from;
  TrendDateRange.to = null;

  document.getElementById("trendDateFrom").value =
    from ? from.toISOString().slice(0, 10) : "";

  document.getElementById("trendDateTo").value = "";

  if (window.currentTrendAnalyticsView) {
    activateGradeAnalyticsView(window.currentTrendAnalyticsView);
  }
}

function setupAnalyticsFilters() {

  // Preset buttons
  document.querySelectorAll("[data-range]").forEach(btn => {
    btn.addEventListener("click", () => {
      setPresetDateRange(btn.dataset.range);
    });
  });

  // Grade selector
  const gradeSelect = document.getElementById("analyticsGradeSelector");

  gradeSelect.addEventListener("change", () => {
    AnalyticsFilters.grades.clear();

    Array.from(gradeSelect.selectedOptions)
      .forEach(opt => AnalyticsFilters.grades.add(opt.value));

    if (window.currentTrendAnalyticsView) {
      activateGradeAnalyticsView(window.currentTrendAnalyticsView);
    }
  });

  // Populate grades on modal open
  $("#gradeAnalyticsModal").on("shown.bs.modal", () => {
    populateAnalyticsGradeSelector();
  });
}

function setupTrendDateFilter() {
  const fromInput = document.getElementById("trendDateFrom");
  const toInput = document.getElementById("trendDateTo");
  const applyBtn = document.getElementById("applyTrendDateFilter");

  applyBtn.addEventListener("click", () => {
    TrendDateRange.from = fromInput.value ? new Date(fromInput.value) : null;

    TrendDateRange.to = toInput.value ? new Date(toInput.value) : null;

    if (window.currentTrendAnalyticsView) {
      activateGradeAnalyticsView(window.currentTrendAnalyticsView);
    }
  });
}

function getCompletedJobsWithinTrendRange() {
  return getCompletedJobs().filter((job) => {
    if (!job.completedAt) return false;
    if (!jobPassesAnalyticsGradeFilter(job)) return false;

    const completedDate = new Date(job.completedAt);

    if (TrendDateRange.from && completedDate < TrendDateRange.from) {
      return false;
    }

    if (TrendDateRange.to) {
      const end = new Date(TrendDateRange.to);
      end.setHours(23, 59, 59, 999);
      if (completedDate > end) return false;
    }

    return true;
  });
}

function activateGradeAnalyticsView(key) {
  const config = GRADE_ANALYTICS_VIEWS[key];
  if (!config) return;

  const container = document.getElementById("analyticsModalBody");
  config.render(container);

  // Update active menu item
  document.querySelectorAll("#gradeAnalyticsMenu button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.analytics === key);
  });

  window.currentTrendAnalyticsView = config.isTrend ? key : null;
}

function setupGradeAnalyticsModal() {
  const menu = document.getElementById("gradeAnalyticsMenu");

  menu.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-analytics]");
    if (!btn) return;

    activateGradeAnalyticsView(btn.dataset.analytics);
  });

  // Load default view when modal opens
  $("#gradeAnalyticsModal").on("shown.bs.modal", () => {
    activateGradeAnalyticsView("jobsPerGrade");
  });

  // Cleanup when closing modal
  $("#gradeAnalyticsModal").on("hidden.bs.modal", () => {
    if (window.analyticsChartInstance) {
      window.analyticsChartInstance.destroy();
      window.analyticsChartInstance = null;
    }
    document.getElementById("analyticsModalBody").innerHTML = "";
  });
}

/* ================= CUSTOM GRADE LABELS ================= */
function getGradeList() {
  const stored = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.GRADE_LIST) || "null",
    null,
  );
  return Array.isArray(stored) && stored.length ? stored : DEFAULT_GRADES;
}

function setGradeList(list) {
  localStorage.setItem(STORAGE_KEYS.GRADE_LIST, JSON.stringify(list));
}

function parseGradeListText(text) {
  const raw = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Unique while preserving order
  const seen = new Set();
  const out = [];
  for (const g of raw) {
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

function refreshGradeChecklistsAfterGradeListChange() {
  const grades = getGradeList();

  // Preserve teacher selection where possible
  const teacherSelected = elements.gradeChecklist
    ? getSelectedGradesFromChecklist(elements.gradeChecklist)
    : [];
  renderGradeChecklist(
    elements.gradeChecklist,
    grades,
    teacherSelected.filter((g) => grades.includes(g)),
  );

  // Preserve admin selection based on selected admin user
  const email = elements.adminUserSelect ? elements.adminUserSelect.value : "";
  const map = getAdminGradeMap();
  const assigned = email ? map[email] || [] : [];
  renderGradeChecklist(
    elements.adminGradeChecklist,
    grades,
    normalizeGrades(assigned).filter((g) => g !== "Unassigned"),
  );
}

function setGradeListStatus(msg) {
  if (!elements.gradeListStatus) return;
  elements.gradeListStatus.textContent = msg;
}

/* ================= GRADES & NORMALISATION ================= */
function normalizeGrades(grades) {
  if (!grades) return ["Unassigned"];
  if (Array.isArray(grades)) {
    const cleaned = grades
      .map(String)
      .map((g) => g.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned : ["Unassigned"];
  }
  const cleaned = String(grades)
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  return cleaned.length ? cleaned : ["Unassigned"];
}

function normalizeJob(j) {
  const job = { ...j };
  job.id = Number(job.id) || 0;
  job.reference = job.reference || "";
  job.teacher = job.teacher || "Unknown";
  job.authoriser = job.authoriser || "";
  job.pages = Number(job.pages) || 1;
  job.copies = Number(job.copies) || 1;
  job.printType = job.printType || "normal";
  job.sides = job.sides || "single";
  job.additionalTask = job.additionalTask || "none";
  job.scheduledFor = job.scheduledFor || "";
  job.status = job.status || "Queued";
  job.requestedAt = Number(job.requestedAt) || Date.now();
  job.completedAt =
    job.completedAt === null || job.completedAt === undefined
      ? null
      : Number(job.completedAt);

  job.grades = normalizeGrades(job.grades);

  if (typeof job.estimate !== "number")
    job.estimate = calculateJobEstimate(job);
  if (job.status === "Completed" && !job.completedAt)
    job.completedAt = Date.now();

  return job;
}

/* ================= ADMIN GRADE ASSIGNMENTS ================= */
function getAdminGradeMap() {
  return safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.ADMIN_GRADE_MAP) || "{}",
    {},
  );
}

function setAdminGradeMap(map) {
  localStorage.setItem(STORAGE_KEYS.ADMIN_GRADE_MAP, JSON.stringify(map));
}

function loadAssignedGradesForAdmin(email) {
  const map = getAdminGradeMap();
  const grades = map[email];
  if (!grades) return []; // empty => see all
  return normalizeGrades(grades).filter((g) => g !== "Unassigned");
}

function canUserSeeJob(job) {
  if (!currentUser.authenticated) return true;
  if (currentUser.role === "super-admin") return true;
  if (currentUser.role !== "admin") return true;

  const jobGrades = normalizeGrades(job.grades);
  // Backward compatibility: legacy/unknown jobs stay visible to all admins
  if (jobGrades.includes("Unassigned")) return true;

  const assigned = currentUser.assignedGrades || [];
  // Empty assignment means "see all" (default)
  if (!assigned.length) return true;

  return intersects(jobGrades, assigned);
}

function canUserModifyJob(job) {
  return canUserSeeJob(job);
}

/* ================= NOTES ================= */
function saveJobNotes(reference, text) {
  const notes = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.NOTES) || "{}",
    {},
  );
  notes[reference] = text;
  localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(notes));
}

function getJobNotes(reference) {
  const notes = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.NOTES) || "{}",
    {},
  );
  return notes[reference] || "";
}

function jobHasNotes(reference) {
  return getJobNotes(reference).trim().length > 0;
}

window.downloadNotes = (reference) => {
  const notes = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.NOTES) || "{}",
    {},
  );
  if (!notes[reference]) return alert("No notes for this job.");
  const blob = new Blob([notes[reference]], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${reference}-notes.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ================= EMAIL NOTIFICATIONS ================= */
function isEmailNotificationEnabled() {
  return localStorage.getItem(STORAGE_KEYS.EMAIL_ENABLED) === "true";
}

function setEmailNotificationEnabled(val) {
  localStorage.setItem(STORAGE_KEYS.EMAIL_ENABLED, val ? "true" : "false");
}

function sendCompletionEmailViaMailto(job) {
  if (!isEmailNotificationEnabled()) return false;
  const emailMap = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS) || "{}",
    {},
  );
  const teacherEmail = emailMap[job.teacher];
  if (!teacherEmail) return false;

  const subject = encodeURIComponent("Your print job has been completed");
  const body = encodeURIComponent(
    [
      `Dear ${job.teacher},`,
      "",
      "Your print / photocopy job has now been completed.",
      "",
      `Job Ref: ${job.reference || job.id}`,
      `Pages: ${job.pages}`,
      `Copies: ${job.copies}`,
      `Grades: ${(job.grades || []).join(", ")}`,
      job.scheduledFor
        ? `Due: ${new Date(job.scheduledFor).toLocaleString()}`
        : "Due: ASAP",
      "",
      "Regards,",
      "Print Room",
    ].join("\n"),
  );

  window.location.href = `mailto:${teacherEmail}?subject=${subject}&body=${body}`;
  return true;
}

/* ================= TIME / URGENCY ================= */
function isUrgent(job) {
  if (job.status === "Completed") return false;
  if (!job.scheduledFor) return false;
  const hoursLeft =
    (new Date(job.scheduledFor).getTime() - Date.now()) / 3600000;
  return hoursLeft <= 3 && hoursLeft > 0;
}

function isOverdue(job) {
  if (job.status === "Completed") return false;
  if (!job.scheduledFor) return false;
  const hoursLeft =
    (new Date(job.scheduledFor).getTime() - Date.now()) / 3600000;
  return hoursLeft < 0;
}

function wasOverdue(job) {
  if (job.status !== "Completed") return false;
  if (!job.scheduledFor || !job.completedAt) return false;
  return new Date(job.completedAt) > new Date(job.scheduledFor);
}

/* ================= ESTIMATES ================= */
function calculateJobEstimate(job) {
  let effective = Number(job.pages) || 0;
  if (job.printType === "2-in-1") effective = Math.ceil(effective / 2);
  if (job.sides === "double") effective = Math.ceil(effective / 2);
  effective *= Number(job.copies) || 1;

  let taskTime = 0;
  const task = job.additionalTask || "none";
  if (task.includes("trimming")) taskTime += AppState.settings.trimmingTime;
  if (task.includes("stapling")) taskTime += AppState.settings.staplingTime;

  return Math.round(
    AppState.settings.loadTime +
      AppState.settings.checkTime +
      effective * AppState.settings.timePerPage +
      taskTime,
  );
}

function updateEstimate() {
  const p = parseInt(elements.pages.value || "0", 10) || 0;
  const c = parseInt(elements.copies.value || "0", 10) || 0;
  let effective = p;
  if (elements.printType.value === "2-in-1")
    effective = Math.ceil(effective / 2);
  if (elements.sides.value === "double") effective = Math.ceil(effective / 2);
  effective *= c;

  elements.effectivePages.textContent = String(effective);
  elements.estimate.textContent = String(
    calculateJobEstimate({
      pages: p,
      copies: c,
      printType: elements.printType.value,
      sides: elements.sides.value,
      additionalTask: elements.additionalTask.value,
    }),
  );
}

/* ================= CONTROLLED MUTATIONS ================= */
function generateJobReference() {
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = getAllJobs().filter((j) =>
    (j.reference || "").startsWith(today),
  ).length;
  return `${today}-${todayCount + 1}`;
}

function addJob(job, notesText) {
  idCounter += 1;
  const newJob = {
    ...job,
    id: idCounter,
    reference: generateJobReference(),
    requestedAt: Date.now(),
    status: "Queued",
    completedAt: null,
  };
  newJob.grades = normalizeGrades(newJob.grades);
  newJob.estimate = calculateJobEstimate(newJob);
  jobs.set(newJob.id, newJob);
  if (notesText && notesText.trim())
    saveJobNotes(newJob.reference, notesText.trim());
  AppState.save();
  return newJob;
}

function updateJobStatus(id, status) {
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
    completedJobsLimit = 10;
  }

  AppState.save();
}

function deleteJob(id) {
  jobs.delete(id);
  AppState.save();
}

/* ================= IMPORT / EXPORT ================= */
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
  const content = jobsArray.map((j) => JSON.stringify(j)).join("\n");

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

function handleTodoUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = String(e.target.result || "")
      .split(/\r?\n/)
      .filter(Boolean);
    lines.forEach((line) => {
      const data = safeJsonParse(line, null);
      if (!data) return;

      const job = normalizeJob({
        ...data,
        status: data.status || "Queued",
        requestedAt: data.requestedAt || Date.now(),
        completedAt: data.completedAt || null,
      });

      idCounter += 1;
      job.id = idCounter;
      job.reference = job.reference || generateJobReference();
      jobs.set(job.id, job);
    });
    AppState.save();
    elements.todoFile.value = "";
    rerenderAll();
  };
  reader.readAsText(file);
}

function handleCompletedUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = String(e.target.result || "")
      .split(/\r?\n/)
      .filter(Boolean);
    lines.forEach((line) => {
      const data = safeJsonParse(line, null);
      if (!data) return;

      const job = normalizeJob({
        ...data,
        status: "Completed",
        requestedAt: data.requestedAt || Date.now(),
        completedAt: data.completedAt || Date.now(),
      });

      idCounter += 1;
      job.id = idCounter;
      job.reference = job.reference || generateJobReference();
      jobs.set(job.id, job);
    });
    AppState.save();
    elements.completedFile.value = "";
    rerenderAll();
  };
  reader.readAsText(file);
}

function handleUnifiedTeacherImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = String(e.target.result || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const teacherList = [];
    const emailMap = safeJsonParse(
      localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS) || "{}",
      {},
    );

    lines.forEach((line) => {
      const parts = line.split(";").map((x) => x.trim());
      const name = parts[0];
      const email = parts[1];
      if (!name) return;
      teacherList.push(name);
      if (email) emailMap[name] = email;
    });

    localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(teacherList));
    localStorage.setItem(STORAGE_KEYS.TEACHER_EMAILS, JSON.stringify(emailMap));
    loadTeacherDropdowns();
    alert(`Imported ${teacherList.length} teachers.`);
  };
  reader.readAsText(file);
}

function loadTeacherDropdowns() {
  const list = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.TEACHERS) || "[]",
    [],
  );
  if (list.length > 0) {
    const options = list
      .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join("");
    elements.teacherSelect.innerHTML = options;
    elements.authTeacherSelect.innerHTML =
      `<option value="">— Select —</option>` + options;
    elements.teacherSelect.disabled = false;
    elements.authTeacherSelect.disabled = false;
  }
}

/* ================= GRADE CHECKLIST UI ================= */
function renderGradeChecklist(containerEl, grades, selected) {
  if (!containerEl) return;
  const sel = new Set(selected || []);

  // Include any selected grades not currently in the grade list
  const extras = (selected || []).filter((g) => !grades.includes(g));
  const all = extras.length ? extras.concat(grades) : grades;

  containerEl.innerHTML = all
    .map((g, idx) => {
      const id = `${containerEl.id}_g_${idx}`;
      const checked = sel.has(g) ? "checked" : "";
      const extraTag = extras.includes(g)
        ? " <span class='text-muted'>(legacy)</span>"
        : "";
      return `
      <div class="custom-control custom-checkbox">
        <input type="checkbox" class="custom-control-input" id="${id}" data-grade="${escapeHtml(g)}" ${checked}>
        <label class="custom-control-label" for="${id}">${escapeHtml(g)}${extraTag}</label>
      </div>`;
    })
    .join("");
}

function getSelectedGradesFromChecklist(containerEl) {
  if (!containerEl) return [];
  const boxes = containerEl.querySelectorAll(
    "input[type='checkbox'][data-grade]",
  );
  const selected = [];
  boxes.forEach((b) => {
    if (b.checked) selected.push(b.dataset.grade);
  });
  return selected;
}

function populateAdminUserSelect() {
  if (!elements.adminUserSelect) return;
  const admins = ADMIN_CREDENTIALS.filter((c) => c.role === "admin");
  elements.adminUserSelect.innerHTML =
    `<option value="">— Select Admin —</option>` +
    admins
      .map(
        (a) =>
          `<option value="${escapeHtml(a.email)}">${escapeHtml(a.email)}</option>`,
      )
      .join("");
}

function renderAdminAssignmentsList() {
  if (!elements.adminAssignmentsList) return;
  const map = getAdminGradeMap();
  const entries = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    elements.adminAssignmentsList.innerHTML = `<div class="text-muted">No assignments saved yet.</div>`;
    return;
  }
  elements.adminAssignmentsList.innerHTML = entries
    .map(([email, grades]) => {
      const list = normalizeGrades(grades).filter((g) => g !== "Unassigned");
      return `<div><strong>${escapeHtml(email)}</strong>: <span class="text-muted">${escapeHtml(list.join(", ") || "(all grades)")}</span></div>`;
    })
    .join("");
}

/* ================= INFINITE SCROLL ================= */
function setupInfiniteScroll() {
  if (observer) observer.disconnect();
  const sentinel = document.getElementById("summary-sentinel");
  if (!sentinel) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        completedJobsLimit += COMPLETED_INCREMENT;
        rerenderAll();
      }
    },
    { threshold: 1.0 },
  );
  observer.observe(sentinel);
}

/* ================= CARD RENDER ================= */
function formatGradesBadges(grades) {
  return normalizeGrades(grades)
    .map(
      (g) =>
        `<span class="badge badge-light border grade-badge">${escapeHtml(g)}</span>`,
    )
    .join("");
}

function generateJobCardHtml(j, isCompleted = false) {
  const statusBadgeClass = isCompleted
    ? "badge-success"
    : j.status === "In process"
      ? "badge-primary"
      : "badge-secondary";
  const statusText = isCompleted ? "Finished" : j.status;

  const estTime =
    typeof j.estimate === "number" ? j.estimate : calculateJobEstimate(j);
  const dueTime = j.scheduledFor
    ? new Date(j.scheduledFor).toLocaleString()
    : "ASAP";
  const reqTime = new Date(j.requestedAt).toLocaleString();
  const doneTime = j.completedAt
    ? new Date(j.completedAt).toLocaleString()
    : "";

  const gradesBadges = formatGradesBadges(j.grades);

  let notificationBadge = "";
  if (isCompleted) {
    if (j.notificationStatus === "sent")
      notificationBadge = `<span class="badge badge-info ml-2">Email Sent</span>`;
    else if (j.notificationStatus === "skipped")
      notificationBadge = `<span class="badge badge-secondary ml-2">No Email</span>`;
    else if (j.notificationStatus === "disabled")
      notificationBadge = `<span class="badge badge-warning ml-2">Email Disabled</span>`;
  }

  const lateBadge =
    isCompleted && wasOverdue(j)
      ? `<span class="badge badge-warning ml-2">Late</span>`
      : "";

  const notesText = getJobNotes(j.reference);
  const notesHtml = notesText
    ? `<div class="mt-2 small bg-light border rounded p-2"><strong>Notes:</strong><br>${escapeHtml(notesText).replace(/\n/g, "<br>")}</div>`
    : "";

  const notesBtnClass = jobHasNotes(j.reference)
    ? "btn-outline-primary"
    : "btn-outline-secondary";

  let actions = "";
  if (
    currentUser.authenticated &&
    !isCompleted &&
    (currentUser.role === "admin" || currentUser.role === "super-admin")
  ) {
    const allowed = canUserModifyJob(j);
    const disabled = allowed ? "" : "disabled";

    if (j.status === "Queued") {
      actions += `<button class="btn btn-outline-primary" data-action="updateStatus" data-id="${j.id}" data-status="In process" ${disabled}>Start</button>`;
    } else if (j.status === "In process") {
      actions += `<button class="btn btn-success" data-action="updateStatus" data-id="${j.id}" data-status="Completed" ${disabled}>Finish</button>`;
    }
    actions += ` <button class="btn btn-danger ml-2" data-action="deleteJob" data-id="${j.id}" ${disabled}>Delete</button>`;
    if (!allowed)
      actions += ` <span class="badge badge-warning ml-2">Not assigned</span>`;
  }

  return `
    <div class="card-body p-3">
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div>
          <div class="small text-muted">Ref: <strong>${escapeHtml(j.reference || String(j.id))}</strong></div>
          <div class="font-weight-bold">${escapeHtml(j.teacher)}</div>
          <div class="mt-1">${gradesBadges}</div>
        </div>
        <div class="text-right">
          <span class="badge ${statusBadgeClass}">${escapeHtml(statusText)}</span>
          ${notificationBadge}
          ${lateBadge}
        </div>
      </div>

      <div class="small mb-2">
        Requested: ${escapeHtml(reqTime)}<br>
        ${isCompleted ? `Completed: ${escapeHtml(doneTime)}<br>` : ""}
        Due: ${escapeHtml(dueTime)}<br>
        Estimate: <strong>${estTime}s</strong> &nbsp; | &nbsp; Volume: <strong>${escapeHtml(String(j.pages))}p × ${escapeHtml(String(j.copies))}c</strong><br>
        Type: ${escapeHtml(j.printType)} &nbsp; | &nbsp; Sides: ${escapeHtml(j.sides)} &nbsp; | &nbsp; Tasks: ${escapeHtml(j.additionalTask)}
      </div>

      <div class="d-flex align-items-center">
        ${actions}
        <button class="btn btn-sm ${notesBtnClass} ml-auto" data-action="downloadNotes" data-ref="${escapeHtml(j.reference || "")}">Notes</button>
      </div>

      ${notesHtml}
    </div>
  `;
}

/* ================= RENDER PIPELINE ================= */
function rerenderAll() {
  const all = getAllJobs().map(normalizeJob);

  // 1) Grade filtering
  let active = all
    .filter((j) => j.status !== "Completed")
    .filter(canUserSeeJob);
  let completed = all
    .filter((j) => j.status === "Completed")
    .filter(canUserSeeJob);

  // 2) Due-date filters (active)
  const now = new Date();
  active = active.filter((j) => {
    if (!j.scheduledFor) return dueDateFilter === "all";
    const due = new Date(j.scheduledFor);
    if (dueDateFilter === "today")
      return due.toDateString() === now.toDateString();
    if (dueDateFilter === "tomorrow") {
      const t = new Date(now);
      t.setDate(now.getDate() + 1);
      return due.toDateString() === t.toDateString();
    }
    if (dueDateFilter === "week") {
      const end = new Date(now);
      end.setDate(now.getDate() + 7);
      return due >= now && due <= end;
    }
    if (dueDateFilter === "overdue") return isOverdue(j);
    return true;
  });

  // 3) Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    active = active.filter((j) => (j.teacher || "").toLowerCase().includes(q));
    completed = completed.filter((j) =>
      (j.teacher || "").toLowerCase().includes(q),
    );
  }

  // 4) Sorting (active)
  const mode = AppState.settings.priorityMode;
  if (mode === "overdue") {
    active.sort((a, b) => {
      const ao = isOverdue(a) ? 0 : 1;
      const bo = isOverdue(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.requestedAt - b.requestedAt;
    });
  } else if (mode === "estimate") {
    active.sort(
      (a, b) => a.estimate - b.estimate || a.requestedAt - b.requestedAt,
    );
  } else if (mode === "quick") {
    const threshold = 300;
    active.sort((a, b) => {
      const aq = a.estimate <= threshold ? 0 : 1;
      const bq = b.estimate <= threshold ? 0 : 1;
      if (aq !== bq) return aq - bq;
      return a.requestedAt - b.requestedAt;
    });
  } else if (mode === "due") {
    active.sort((a, b) =>
      String(a.scheduledFor || "Z") > String(b.scheduledFor || "Z") ? 1 : -1,
    );
  } else if (mode === "size") {
    active.sort((a, b) => a.pages * a.copies - b.pages * b.copies);
  } else {
    active.sort((a, b) => a.requestedAt - b.requestedAt);
  }

  completed.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  // 5) Pagination
  const totalPages = Math.max(1, Math.ceil(active.length / ITEMS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const pageItems = active.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  // UI
  elements.jobCount.textContent = String(active.length);
  elements.pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

  // Active queue
  if (!pageItems.length) {
    elements.queue.innerHTML = `<p class="text-muted small">Queue is empty.</p>`;
  } else {
    elements.queue.innerHTML = "";
    const frag = document.createDocumentFragment();
    pageItems.forEach((j) => {
      const card = document.createElement("div");
      card.className = "card mb-2 job";
      if (isOverdue(j)) card.classList.add("job-overdue");
      else if (isUrgent(j)) card.classList.add("job-urgent");
      card.innerHTML = generateJobCardHtml(j, false);
      frag.appendChild(card);
    });
    elements.queue.appendChild(frag);
  }

  // Completed list
  if (elements.weeklySummary) {
    const limited = completed.slice(0, completedJobsLimit);
    elements.weeklySummary.innerHTML = "";
    const frag = document.createDocumentFragment();
    limited.forEach((j) => {
      const card = document.createElement("div");
      card.className = "card mb-2 job";
      card.innerHTML = generateJobCardHtml(j, true);
      frag.appendChild(card);
    });
    elements.weeklySummary.appendChild(frag);
  }

  updateCharts(completed);
}

/* ================= CHARTS (ADMIN) ================= */
function updateCharts(completedJobs) {
  if (!currentUser.authenticated) return;
  if (!(currentUser.role === "admin" || currentUser.role === "super-admin"))
    return;

  const teacherCanvas = document.getElementById("teacherChart");
  const timeCanvas = document.getElementById("timeChart");
  if (!teacherCanvas || !timeCanvas || typeof Chart === "undefined") return;

  const pagesByTeacher = {};
  completedJobs.forEach((j) => {
    const t = j.teacher || "Unknown";
    const total = (j.pages || 0) * (j.copies || 0);
    pagesByTeacher[t] = (pagesByTeacher[t] || 0) + total;
  });

  const labels = Object.keys(pagesByTeacher)
    .sort((a, b) => pagesByTeacher[b] - pagesByTeacher[a])
    .slice(0, 10);
  const values = labels.map((l) => pagesByTeacher[l]);

  if (window.teacherChartInstance) window.teacherChartInstance.destroy();
  window.teacherChartInstance = new Chart(teacherCanvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Total Pages (Top 10)", data: values }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { yAxes: [{ ticks: { beginAtZero: true, precision: 0 } }] },
    },
  });

  const onTime = new Array(24).fill(0);
  const late = new Array(24).fill(0);
  completedJobs.forEach((j) => {
    if (!j.completedAt) return;
    const h = new Date(j.completedAt).getHours();
    if (wasOverdue(j)) late[h] += 1;
    else onTime[h] += 1;
  });

  if (window.timeChartInstance) window.timeChartInstance.destroy();
  window.timeChartInstance = new Chart(timeCanvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: Array.from({ length: 24 }, (_, i) => String(i)),
      datasets: [
        { label: "Completed on time", data: onTime },
        { label: "Completed late", data: late },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { yAxes: [{ ticks: { beginAtZero: true, precision: 0 } }] },
    },
  });
}

/* ================= MODAL VIEWS (WEEKLY CALENDAR / GANTT) ================= */
function renderWeeklyCalendar(completedJobs) {
  const container = elements.weeklyCalendarContainer;
  if (!container) return;

  if (!completedJobs.length) {
    container.innerHTML =
      "<div class='text-muted'>No completed jobs found.</div>";
    return;
  }

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
  days.forEach((d) => (grouped[d] = []));

  completedJobs.forEach((job) => {
    if (!job.completedAt) return;
    const day = days[new Date(job.completedAt).getDay()];
    grouped[day].push(job);
  });

  const rows = days
    .map((day) => {
      const jobsForDay = grouped[day];
      const totalSec = jobsForDay.reduce((s, j) => s + (j.estimate || 0), 0);
      const sample = jobsForDay
        .slice(0, 5)
        .map((j) => escapeHtml(j.teacher))
        .join(", ");
      return `
      <tr>
        <td><strong>${day}</strong></td>
        <td>${jobsForDay.length}</td>
        <td>${sample}${jobsForDay.length > 5 ? "..." : ""}</td>
        <td>${Math.round(totalSec / 60)} min</td>
      </tr>`;
    })
    .join("");

  container.innerHTML = `
    <table class="table table-sm table-bordered">
      <thead class="thead-light">
        <tr><th>Day</th><th>Jobs</th><th>Details</th><th>Total Time</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderGanttTimeline(completedJobs) {
  const container = elements.weeklyCalendarContainer;
  if (!container) return;

  if (!completedJobs.length) {
    container.innerHTML =
      "<div class='text-muted'>No completed jobs found.</div>";
    return;
  }

  const jobsSorted = completedJobs
    .filter((j) => j.requestedAt && j.completedAt)
    .slice()
    .sort((a, b) => a.requestedAt - b.requestedAt);

  const minT = Math.min(...jobsSorted.map((j) => j.requestedAt));
  const maxT = Math.max(...jobsSorted.map((j) => j.completedAt));
  const span = Math.max(1, maxT - minT);

  const bars = jobsSorted
    .slice(0, 50)
    .map((j) => {
      const left = ((j.requestedAt - minT) / span) * 100;
      const width = ((j.completedAt - j.requestedAt) / span) * 100;
      const color = wasOverdue(j) ? "#ffc107" : "#28a745";
      return `
      <div class="mb-2">
        <div class="small">${escapeHtml(j.teacher)} <span class="text-muted">(${escapeHtml(j.reference || String(j.id))})</span></div>
        <div style="position: relative; height: 10px; background: #eee;">
          <div style="position:absolute; left:${left}%; width:${Math.max(0.5, width)}%; height: 10px; background:${color};"></div>
        </div>
      </div>`;
    })
    .join("");

  container.innerHTML = `<div>${bars}</div>`;
}

/* ================= AUTH ================= */
fetch("./admin.env")
  .then((r) => r.text())
  .then((text) => {
    ADMIN_CREDENTIALS = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(";").map((x) => x.trim());
        const email = (parts[0] || "").toLowerCase();
        const password = parts[1] || "";
        const role = (parts[2] || "admin").toLowerCase();
        return {
          email,
          password,
          role: role === "super-admin" ? "super-admin" : "admin",
        };
      });
    populateAdminUserSelect();
  })
  .catch(() => console.warn("admin.env not found"));

function handleLogin() {
  const email = (elements.emailInput.value || "").trim().toLowerCase();
  const password = elements.passwordInput.value || "";
  const match = ADMIN_CREDENTIALS.find(
    (c) => c.email === email && c.password === password,
  );
  if (!match) return alert("Invalid admin credentials");

  currentUser = {
    email,
    role: match.role,
    authenticated: true,
    assignedGrades: loadAssignedGradesForAdmin(email),
  };

  elements.loginCard.classList.add("hidden");
  elements.logoutBtn.classList.remove("hidden");
  elements.adminSettings.classList.remove("hidden");
  elements.weeklyReportControls.classList.remove("hidden");

  if (currentUser.role === "super-admin") {
    elements.superAdminPanel.classList.remove("hidden");
    renderAdminAssignmentsList();
    // Populate grade editor textarea
    if (elements.gradeListInput) {
      elements.gradeListInput.value = getGradeList().join("\n");
    }
    setGradeListStatus("");
  } else {
    elements.superAdminPanel.classList.add("hidden");
  }

  setupInfiniteScroll();
  rerenderAll();
}

function handleLogout() {
  currentUser = {
    email: null,
    role: null,
    authenticated: false,
    assignedGrades: [],
  };

  elements.loginCard.classList.remove("hidden");
  elements.logoutBtn.classList.add("hidden");
  elements.adminSettings.classList.add("hidden");
  elements.weeklyReportControls.classList.add("hidden");
  elements.superAdminPanel.classList.add("hidden");

  if (window.teacherChartInstance) window.teacherChartInstance.destroy();
  if (window.timeChartInstance) window.timeChartInstance.destroy();

  rerenderAll();
}

function clearAndPrepareAnalyticsContainer(container) {
  container.innerHTML = `
    <div style="height:420px;">
      <canvas id="analyticsChart"></canvas>
    </div>
  `;

  if (window.analyticsChartInstance) {
    window.analyticsChartInstance.destroy();
    window.analyticsChartInstance = null;
  }

  return container.querySelector("canvas").getContext("2d");
}

function renderJobsPerGrade(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const counts = {};

  getCompletedJobs().forEach((job) => {
    normalizeGrades(job.grades).forEach((g) => {
      counts[g] = (counts[g] || 0) + 1;
    });
  });

  const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const data = labels.map((l) => counts[l]);

  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Completed Jobs",
          data,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "Completed Jobs per Grade" },
      },
      scales: {
        y: { beginAtZero: true, precision: 0 },
      },
    },
  });
}

function renderEstimatedTimePerGrade(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const totals = {};

  getCompletedJobs().forEach((job) => {
    const time = job.estimate || calculateJobEstimate(job);
    normalizeGrades(job.grades).forEach((g) => {
      totals[g] = (totals[g] || 0) + time;
    });
  });

  const labels = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const data = labels.map((l) => Math.round(totals[l] / 60)); // minutes

  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Estimated Time (minutes)",
          data,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "Estimated Print Time per Grade" },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}

function renderVolumePerGrade(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const totals = {};

  getCompletedJobs().forEach((job) => {
    const volume = (job.pages || 0) * (job.copies || 0);
    normalizeGrades(job.grades).forEach((g) => {
      totals[g] = (totals[g] || 0) + volume;
    });
  });

  const labels = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const data = labels.map((l) => totals[l]);

  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Printed Sheets",
          data,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "Print Volume per Grade" },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}

function renderOnTimeVsLateByGrade(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const onTime = {};
  const late = {};

  getCompletedJobs().forEach((job) => {
    normalizeGrades(job.grades).forEach((g) => {
      if (wasOverdue(job)) {
        late[g] = (late[g] || 0) + 1;
      } else {
        onTime[g] = (onTime[g] || 0) + 1;
      }
    });
  });

  const grades = Array.from(
    new Set([...Object.keys(onTime), ...Object.keys(late)]),
  ).sort();

  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: grades,
      datasets: [
        {
          label: "On Time",
          data: grades.map((g) => onTime[g] || 0),
          backgroundColor: "#28a745",
        },
        {
          label: "Late",
          data: grades.map((g) => late[g] || 0),
          backgroundColor: "#dc3545",
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "On‑Time vs Late Jobs per Grade" },
      },
      responsive: true,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true },
      },
    },
  });
}

function renderMedianTurnaroundByGrade(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const times = {};

  getCompletedJobs().forEach((job) => {
    if (!job.completedAt || !job.requestedAt) return;
    const duration = job.completedAt - job.requestedAt;

    normalizeGrades(job.grades).forEach((g) => {
      if (!times[g]) times[g] = [];
      times[g].push(duration);
    });
  });

  const grades = Object.keys(times);
  const medians = grades.map((g) => {
    const arr = times[g].sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const median = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    return Math.round(median / 60000); // minutes
  });

  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: grades,
      datasets: [
        {
          label: "Median Turnaround (minutes)",
          data: medians,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: "Median Turnaround Time per Grade" },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}

function renderJobsCompletedPerGradeTrend(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const dataMap = {};
  const weekSet = new Set();

  const completed = getCompletedJobsWithinTrendRange();

  completed.forEach((job) => {
    const d = new Date(job.completedAt);
    const weekKey = `${d.getFullYear()}‑W${String(
      Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7),
    ).padStart(2, "0")}`;

    weekSet.add(weekKey);

    normalizeGrades(job.grades).forEach((g) => {
      if (!dataMap[g]) dataMap[g] = {};
      dataMap[g][weekKey] = (dataMap[g][weekKey] || 0) + 1;
    });
  });

  const weeks = Array.from(weekSet).sort();
  const colors = [
    "#007bff",
    "#28a745",
    "#dc3545",
    "#ffc107",
    "#17a2b8",
    "#6610f2",
    "#6c757d",
  ];

  const datasets = Object.keys(dataMap).map((grade, i) => ({
    label: grade,
    data: weeks.map((w) => dataMap[grade][w] || 0),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length],
    fill: false,
    tension: 0.1,
  }));

  window.analyticsChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels: weeks, datasets },
    options: {
      plugins: {
        title: {
          display: true,
          text: "Jobs Completed per Grade – Trend Over Time",
        },
      },
      responsive: true,
      scales: {
        y: { beginAtZero: true, precision: 0 },
      },
    },
  });
}

function renderOnTimePercentageTrend(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const bucket = {};
  const completed = getCompletedJobsWithinTrendRange();

  completed.forEach((job) => {
    const d = new Date(job.completedAt);
    const weekKey = `${d.getFullYear()}‑W${String(
      Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7),
    ).padStart(2, "0")}`;

    if (!bucket[weekKey]) bucket[weekKey] = { total: 0, onTime: 0 };

    bucket[weekKey].total++;
    if (!wasOverdue(job)) bucket[weekKey].onTime++;
  });

  const weeks = Object.keys(bucket).sort();
  const percentages = weeks.map((w) =>
    Math.round((bucket[w].onTime / bucket[w].total) * 100),
  );

  window.analyticsChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: weeks,
      datasets: [
        {
          label: "On‑Time %",
          data: percentages,
          borderColor: "#28a745",
          backgroundColor: "#28a745",
          tension: 0.1,
          fill: false,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: "On‑Time Completion Percentage – Trend",
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => `${v}%` },
        },
      },
    },
  });
}

function renderDayHourCompletionHeatmap(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const matrix = {};

  days.forEach((d) => {
    matrix[d] = Array(24).fill(0);
  });

  getCompletedJobs().forEach((job) => {
    const d = new Date(job.completedAt);
    matrix[days[d.getDay()]][d.getHours()] += 1;
  });

  const colors = [
    "#007bff",
    "#28a745",
    "#dc3545",
    "#ffc107",
    "#17a2b8",
    "#6f42c1",
    "#343a40",
  ];

  const datasets = days.map((day, idx) => ({
    label: day,
    data: matrix[day],
    backgroundColor: colors[idx],
  }));

  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
      datasets,
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: "Completed Jobs – Day × Hour Pattern",
        },
      },
      responsive: true,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true },
      },
    },
  });
}

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {
  AppState.load();

  // Default due datetime
  if (elements.scheduledFor && !elements.scheduledFor.value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    elements.scheduledFor.value = tomorrow.toISOString().slice(0, 16);
  }

  // Grade checklist from stored custom labels
  const grades = getGradeList();
  renderGradeChecklist(elements.gradeChecklist, grades, []);

  // Sync settings modal
  const settingsMap = {
    timePerPage: elements.setting_timePerPage,
    loadTime: elements.setting_loadTime,
    checkTime: elements.setting_checkTime,
    trimmingTime: elements.setting_trimmingTime,
    staplingTime: elements.setting_staplingTime,
  };
  Object.entries(settingsMap).forEach(([key, el]) => {
    if (!el) return;
    el.value = AppState.settings[key];
    el.addEventListener("input", () => {
      AppState.settings[key] = parseInt(el.value || "0", 10) || 0;
      AppState.save();
      updateEstimate();
    });
  });

  // Priority help
  const priorityHelpText = {
    fifo: "Jobs are processed in the order they were submitted (fair and predictable).",
    due: "Jobs with the earliest required-by date are prioritised.",
    overdue: "Overdue jobs are prioritised to prevent missed deadlines.",
    estimate:
      "Jobs with the shortest estimated print time are processed first.",
    quick: "Very small jobs are prioritised to clear the queue quickly.",
    size: "Jobs are sorted by total size (pages × copies).",
  };

  elements.priorityMode.value = AppState.settings.priorityMode;
  if (elements.priorityHelp)
    elements.priorityHelp.textContent =
      priorityHelpText[AppState.settings.priorityMode] || "";

  elements.priorityMode.addEventListener("change", () => {
    AppState.settings.priorityMode = elements.priorityMode.value;
    AppState.save();
    if (elements.priorityHelp)
      elements.priorityHelp.textContent =
        priorityHelpText[AppState.settings.priorityMode] || "";
    rerenderAll();
  });

  // Teachers
  loadTeacherDropdowns();

  // Email toggle
  elements.emailNotificationsEnabled.checked = isEmailNotificationEnabled();
  elements.emailNotificationsEnabled.addEventListener("change", () => {
    setEmailNotificationEnabled(elements.emailNotificationsEnabled.checked);
  });

  // Auth
  elements.loginBtn.onclick = handleLogin;
  elements.logoutBtn.onclick = handleLogout;

  // Super-admin checklists (initial)
  renderGradeChecklist(elements.adminGradeChecklist, grades, []);

  // Admin user selection
  elements.adminUserSelect.addEventListener("change", () => {
    const email = elements.adminUserSelect.value;
    const map = getAdminGradeMap();
    const assigned = email ? map[email] || [] : [];
    renderGradeChecklist(
      elements.adminGradeChecklist,
      getGradeList(),
      normalizeGrades(assigned).filter((g) => g !== "Unassigned"),
    );
  });

  // Save admin grades
  elements.saveAdminGradesBtn.addEventListener("click", () => {
    if (currentUser.role !== "super-admin") return;
    const email = elements.adminUserSelect.value;
    if (!email) return alert("Select an admin user first.");
    const selected = getSelectedGradesFromChecklist(
      elements.adminGradeChecklist,
    );
    const map = getAdminGradeMap();
    if (selected.length) map[email] = selected;
    else delete map[email];
    setAdminGradeMap(map);
    renderAdminAssignmentsList();
    alert("Admin grade access saved.");
  });

  elements.clearAdminGradesBtn.addEventListener("click", () => {
    if (currentUser.role !== "super-admin") return;
    const email = elements.adminUserSelect.value;
    if (!email) return;
    const map = getAdminGradeMap();
    delete map[email];
    setAdminGradeMap(map);
    renderGradeChecklist(elements.adminGradeChecklist, getGradeList(), []);
    renderAdminAssignmentsList();
  });

  // NEW: Grade list editor handlers
  elements.saveGradeListBtn.addEventListener("click", () => {
    if (currentUser.role !== "super-admin") return;
    const list = parseGradeListText(elements.gradeListInput.value);
    if (!list.length) {
      alert("Please enter at least one grade label.");
      return;
    }
    setGradeList(list);
    refreshGradeChecklistsAfterGradeListChange();
    setGradeListStatus(`Saved ${list.length} grade label(s).`);
    rerenderAll();
  });

  elements.resetGradeListBtn.addEventListener("click", () => {
    if (currentUser.role !== "super-admin") return;
    setGradeList(DEFAULT_GRADES);
    if (elements.gradeListInput)
      elements.gradeListInput.value = DEFAULT_GRADES.join("\n");
    refreshGradeChecklistsAfterGradeListChange();
    setGradeListStatus("Reset to default grade labels.");
    rerenderAll();
  });

  // Imports
  elements.teacherFile.onchange = (e) =>
    handleUnifiedTeacherImport(e.target.files[0]);
  elements.todoFile.onchange = (e) => handleTodoUpload(e.target.files[0]);
  elements.completedFile.onchange = (e) =>
    handleCompletedUpload(e.target.files[0]);

  // Exports
  elements.saveTodoBtn.onclick = () =>
    exportJobsToFile(getActiveJobs(), "todo.txt");
  elements.saveCompletedBtn.onclick = () =>
    exportJobsToFile(getCompletedJobs(), "completed.txt");

  elements.clearQueueBtn.onclick = () => {
    completedJobsLimit = 10;
    if (
      !confirm(
        "This will permanently delete ALL jobs (queued and completed). Continue?",
      )
    )
      return;
    jobs.clear();
    idCounter = 0;
    AppState.save();
    rerenderAll();
  };

  // Due date filters
  elements.dueDateFiltersContainer.addEventListener("click", (e) => {
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

  // Search
  elements.searchInput.oninput = debounce((e) => {
    searchQuery = (e.target.value || "").toLowerCase();
    currentPage = 1;
    completedJobsLimit = 10;
    rerenderAll();
  }, 250);

  // Pagination
  elements.prevPageBtn.onclick = () => {
    currentPage -= 1;
    rerenderAll();
  };
  elements.nextPageBtn.onclick = () => {
    currentPage += 1;
    rerenderAll();
  };

  // Estimate updates
  [
    elements.pages,
    elements.copies,
    elements.printType,
    elements.sides,
    elements.additionalTask,
  ].forEach((el) => el.addEventListener("input", updateEstimate));
  updateEstimate();

  // Submit job
  elements.submitBtn.onclick = () => {
    elements.submitBtn.disabled = true;

    const teacher = elements.teacherSelect.value;
    if (!teacher) {
      alert("Please select a teacher.");
      elements.submitBtn.disabled = false;
      return;
    }

    const scheduledValue = elements.scheduledFor.value;
    if (scheduledValue && new Date(scheduledValue).getTime() < Date.now()) {
      alert("You cannot schedule a print job in the past.");
      elements.submitBtn.disabled = false;
      return;
    }

    const selectedGrades = getSelectedGradesFromChecklist(
      elements.gradeChecklist,
    );
    if (!selectedGrades.length) {
      alert("Please select at least one grade label.");
      elements.submitBtn.disabled = false;
      return;
    }

    addJob(
      {
        teacher,
        authoriser: elements.authTeacherSelect.value || "",
        pages: parseInt(elements.pages.value || "1", 10) || 1,
        copies: parseInt(elements.copies.value || "1", 10) || 1,
        printType: elements.printType.value,
        sides: elements.sides.value,
        additionalTask: elements.additionalTask.value,
        scheduledFor: scheduledValue || "",
        grades: selectedGrades,
      },
      elements.jobNotes.value || "",
    );

    elements.jobNotes.value = "";
    elements.submitBtn.disabled = false;
    rerenderAll();
  };

  // Event delegation (queue)
  elements.queue.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "downloadNotes") {
      const ref = btn.dataset.ref;
      if (ref) window.downloadNotes(ref);
      return;
    }

    const id = parseInt(btn.dataset.id || "0", 10);
    const job = jobs.get(id);
    if (!job) return;

    if (!canUserModifyJob(job)) {
      alert("You are not assigned to this job's grade label(s).");
      return;
    }

    if (action === "updateStatus") {
      updateJobStatus(id, btn.dataset.status);
      rerenderAll();
    } else if (action === "deleteJob") {
      if (!confirm("Delete job?")) return;
      deleteJob(id);
      rerenderAll();
    }
  });

  // Completed list delegation
  elements.weeklySummary.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "downloadNotes") {
      const ref = btn.dataset.ref;
      if (ref) window.downloadNotes(ref);
    }
  });

  // Weekly Calendar / Gantt modal
  elements.openWeeklyCalendarBtn?.addEventListener("click", () => {
    const completed = getCompletedJobs().filter(canUserSeeJob);
    renderWeeklyCalendar(completed);
    $("#weeklyCalendarModal").modal("show");
  });

  elements.openGanttViewBtn?.addEventListener("click", () => {
    const completed = getCompletedJobs().filter(canUserSeeJob);
    renderGanttTimeline(completed);
    $("#weeklyCalendarModal").modal("show");
  });

  $("#weeklyCalendarModal").on("hidden.bs.modal", function () {
    if (elements.weeklyCalendarContainer)
      elements.weeklyCalendarContainer.innerHTML = "";
  });

  setupGradeAnalyticsModal();
  setupTrendDateFilter();
  setupAnalyticsFilters();

  // Infinite scroll
  setupInfiniteScroll();

  rerenderAll();
});
