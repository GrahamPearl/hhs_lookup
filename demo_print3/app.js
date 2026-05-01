/**
 * Teacher Print Queue System — v3
 * P1 USABILITY: confirmation modal, duplicate detection, short-notice flag,
 *   stall warning, elapsed progress bar, re-queue, bulk actions, capacity
 *   warning, authoriser email, deletion reason modal, teacher daily page cap.
 * P2 BOTTLENECK: queue depth over time, avg wait by hour, grade×day heatmap,
 *   weekly load vs capacity, concurrent in-process chart.
 */

/* ================= UTILITIES ================= */
const MSAL_SETTINGS_STORAGE_KEY = "printqueue_msal_settings";

const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
const safeJsonParse = (s, fb) => {
  try {
    return JSON.parse(s);
  } catch {
    return fb;
  }
};
const intersects = (a, b) => {
  const s = new Set(b);
  return a.some((x) => s.has(x));
};
const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
const fmtSec = (s) => {
  const m = Math.floor(s / 60),
    r = s % 60;
  return m ? (r ? `${m}m ${r}s` : `${m}m`) : `${s}s`;
};
const fmtMin = (m) => {
  const h = Math.floor(m / 60),
    r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${m} min`;
};

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
  AUDIT_LOG: "printqueue_audit_log",
  DELETION_LOG: "printqueue_deletion_log",
};

// Email template storage
STORAGE_KEYS.EMAIL_TEMPLATE = "printqueue_email_template";
STORAGE_KEYS.EMAIL_SEND_MODE = "printqueue_email_send_mode"; // "mailto" | "graph"


const DEFAULT_COMPLETED_EMAIL_TEMPLATE = {
  subject: "Print job completed: {{reference}}",

  // Used for MailTo
  textBody:
`Hi {{teacher}},

Your print / photocopy job is now completed.

Ref: {{reference}}
Pages: {{pages}}   Copies: {{copies}}
Grades: {{grades}}
Due: {{due}}
Completed: {{completed}}

{{notesBlock}}Regards,
{{sender}}`,

  // Used for Graph/API
  htmlBody:
`<p>Hi {{teacher}},</p>
<p>Your print / photocopy job is now <b>completed</b>.</p>
<ul>
  <li><b>Ref:</b> {{reference}}</li>
  <li><b>Pages:</b> {{pages}} &nbsp; <b>Copies:</b> {{copies}}</li>
  <li><b>Grades:</b> {{grades}}</li>
  <li><b>Due:</b> {{due}}</li>
  <li><b>Completed:</b> {{completed}}</li>
</ul>
{{notesBlockHtml}}
<p>Regards,<br>{{sender}}</p>`
};

const DEFAULT_GRADES = [
  "Grade 8",
  "Grade 9",
  "Grade 10",
  "Grade 11",
  "Grade 12",
];

let ADMIN_CREDENTIALS = [];
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
let bulkSelected = new Set();

/* ================= NOTES CACHE ================= */
let _nd = true,
  _nc = null;
const getNotesCached = () => {
  if (_nd || !_nc) {
    _nc = safeJsonParse(localStorage.getItem(STORAGE_KEYS.NOTES) || "{}", {});
    _nd = false;
  }
  return _nc;
};
const invalidateNotesCache = () => {
  _nd = true;
};

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
    /* v3 usability */
    minLeadTimeHours: 2,
    maxConcurrentJobs: 2,
    stallMultiplier: 1.5,
    dailyPageCap: 0,
    requireAuthoriser: false,
    openHours: {
      Mon: { open: "07:30", close: "16:00", enabled: true },
      Tue: { open: "07:30", close: "16:00", enabled: true },
      Wed: { open: "07:30", close: "16:00", enabled: true },
      Thu: { open: "07:30", close: "16:00", enabled: true },
      Fri: { open: "07:30", close: "16:00", enabled: true },
      Sat: { open: "08:00", close: "12:00", enabled: false },
      Sun: { open: "08:00", close: "12:00", enabled: false },
    },
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

  gradeListInput: document.getElementById("gradeListInput"),
  saveGradeListBtn: document.getElementById("saveGradeListBtn"),
  resetGradeListBtn: document.getElementById("resetGradeListBtn"),
  gradeListStatus: document.getElementById("gradeListStatus"),
  capacityWarning: document.getElementById("capacityWarning"),
  authRequired: document.getElementById("authRequired"),
  urgentFlag: document.getElementById("urgentFlag"),
};

const AnalyticsFilters = {
  grades: new Set(), // empty = all grades
};

const TrendDateRange = {
  from: null, // Date or null
  to: null, // Date or null
};

const GRADE_ANALYTICS_VIEWS = {
  jobsPerGrade: { render: renderJobsPerGrade, isTrend: false },
  timePerGrade: { render: renderEstimatedTimePerGrade, isTrend: false },
  volumePerGrade: { render: renderVolumePerGrade, isTrend: false },
  onTimeVsLate: { render: renderOnTimeVsLateByGrade, isTrend: false },
  turnaround: { render: renderMedianTurnaroundByGrade, isTrend: false },
  jobsTrend: { render: renderJobsCompletedPerGradeTrend, isTrend: true },
  onTimeTrend: { render: renderOnTimePercentageTrend, isTrend: true },
  heatmap: { render: renderDayHourCompletionHeatmap, isTrend: true },
  /* P2 Bottleneck */
  queueDepth: { render: renderQueueDepthOverTime, isTrend: true },
  avgWaitByHour: { render: renderAvgWaitByHour, isTrend: false },
  submissionHeatmap: {
    render: renderGradeDaySubmissionHeatmap,
    isTrend: false,
  },
  capacityWeekly: { render: renderCapacityVsSubmittedWeekly, isTrend: true },
  concurrentInProcess: { render: renderConcurrentInProcess, isTrend: true },
  /* P3 Estimation */
  estimateAccuracy: { render: renderEstimateAccuracyDist, isTrend: false },
  estimateBySize: { render: renderEstimateErrorBySize, isTrend: false },
  estimateByTask: { render: renderEstimateErrorByTask, isTrend: false },
  lifecycle: { render: renderLifecycleFunnel, isTrend: false },
  onTimeTrendMA: { render: renderOnTimeTrendWithMA, isTrend: true },
  slipAnalysis: { render: renderDueDateSlipAnalysis, isTrend: false },
  calibrationPanel: { render: renderCalibrationPanel, isTrend: false },
};

function getEmailSendMode() {
  const m = localStorage.getItem(STORAGE_KEYS.EMAIL_SEND_MODE);
  return (m === "graph" || m === "mailto") ? m : "mailto";
}

function setEmailSendMode(mode) {
  localStorage.setItem(STORAGE_KEYS.EMAIL_SEND_MODE, mode);
}

function getCompletedEmailTemplate() {
  const stored = safeJsonParse(localStorage.getItem(STORAGE_KEYS.EMAIL_TEMPLATE) || "null", null);
  if (!stored || typeof stored !== "object") return { ...DEFAULT_COMPLETED_EMAIL_TEMPLATE };
  return {
    subject: String(stored.subject || DEFAULT_COMPLETED_EMAIL_TEMPLATE.subject),
    textBody: String(stored.textBody || DEFAULT_COMPLETED_EMAIL_TEMPLATE.textBody),
    htmlBody: String(stored.htmlBody || DEFAULT_COMPLETED_EMAIL_TEMPLATE.htmlBody),
  };
}

function setCompletedEmailTemplate(tpl) {
  localStorage.setItem(STORAGE_KEYS.EMAIL_TEMPLATE, JSON.stringify(tpl));
}

function formatDateTime(tsOrIso) {
  if (!tsOrIso) return "—";
  const d = new Date(tsOrIso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function buildTemplateVars(job) {
  const grades = (job.grades || []).join(", ");
  const notes = (typeof getJobNotes === "function") ? (getJobNotes(job.reference) || "").trim() : "";

  return {
    teacher: job.teacher || "Teacher",
    reference: job.reference || String(job.id || ""),
    pages: String(job.pages ?? ""),
    copies: String(job.copies ?? ""),
    grades: grades || "Unassigned",
    due: job.scheduledFor ? formatDateTime(job.scheduledFor) : "ASAP",
    completed: job.completedAt ? formatDateTime(job.completedAt) : formatDateTime(Date.now()),
    notes,
    notesBlock: notes ? `Notes:\n${notes}\n\n` : "",
    notesBlockHtml: notes ? `<p><b>Notes:</b><br>${escapeHtml(notes).replace(/\n/g,"<br>")}</p>` : "",
    sender: "Print Room",
  };
}

// Replace {{key}} with vars[key]
function renderTemplate(str, vars) {
  return String(str || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    return (vars[k] !== undefined && vars[k] !== null) ? String(vars[k]) : "";
  });
}

function getPreviewJobForEmailTemplate() {
  const completed = (typeof getCompletedJobs === "function") ? getCompletedJobs() : [];
  const latest = completed
    .filter(j => j && j.completedAt)
    .slice()
    .sort((a,b) => (b.completedAt || 0) - (a.completedAt || 0))[0];

  return latest || {
    id: 0,
    reference: "2026-Unknown",
    teacher: "Unknown Teacher",
    pages: 2,
    copies: 30,
    grades: ["Unassigned"],
    scheduledFor: new Date().toISOString(),
    completedAt: Date.now()
  };
}

function initMsal() {
  // Ensure msal lib exists
  if (!window.msal || !window.msal.PublicClientApplication) {
    console.warn("MSAL library not loaded yet.");
    return null;
  }

  // Ensure config exists and is valid
  if (!MSAL_CONFIG || !MSAL_CONFIG.auth || !MSAL_CONFIG.auth.clientId) {
    console.warn("MSAL_CONFIG is missing/invalid. Open MSAL settings and save them first.");
    return null; // <-- CRITICAL: do not construct MSAL
  }

  if (msalClient) return msalClient;

  msalClient = new window.msal.PublicClientApplication(MSAL_CONFIG);
  return msalClient;
}
function getDefaultMsalSettings() {
  return {
    tenantId: "",
    clientId: "",
    redirectUri: "http://localhost/printqueue/",
    scopes: ["Mail.Send"],
    senderMailbox: "no-reply@forestview.co.za",
    saveToSentItems: false
  };
}

function buildMsalConfigFromSettings(s) {
  const defaults = getDefaultMsalSettings();
  const settings = (s && typeof s === "object") ? s : defaults;

  return {
    auth: {
      clientId: settings.clientId || "",
      authority: `https://login.microsoftonline.com/${settings.tenantId || "common"}`,
      redirectUri: settings.redirectUri || defaults.redirectUri
    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false
    }
  };
}


let MSAL_SETTINGS = getDefaultMsalSettings();
let MSAL_CONFIG = buildMsalConfigFromSettings(MSAL_SETTINGS);
let GRAPH_SCOPES = MSAL_SETTINGS.scopes || ["Mail.Send"];
let msalClient = null;

let jobPendingGradeAssignment = null;
let jobBeingEdited = null;

const STORAGE_KEYS_EXT = {
  MSAL_SETTINGS: "printqueue_msal_settings",
};

function getDefaultMsalSettings() {
  return {
    tenantId: "",
    clientId: "",
    redirectUri: "http://localhost/printqueue/",
    scopes: ["Mail.Send"],
    senderMailbox: "no-reply@forestview.co.za",
    saveToSentItems: false
  };
}

function buildMsalConfigFromSettings(s) {
  const defaults = getDefaultMsalSettings();
  const settings = (s && typeof s === "object") ? s : defaults;

  return {
    auth: {
      clientId: settings.clientId || "",
      authority: `https://login.microsoftonline.com/${settings.tenantId || "common"}`,
      redirectUri: settings.redirectUri || defaults.redirectUri
    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false
    }
  };
}

// Replace your existing MSAL_CONFIG usage with this dynamic version:

document.addEventListener("DOMContentLoaded", () => {

  function updateEmailTemplatePreview() {
  const subjEl = document.getElementById("completedEmailSubjectTpl");
  const textEl = document.getElementById("completedEmailBodyTextTpl");
  const htmlEl = document.getElementById("completedEmailBodyHtmlTpl");

  const prevSubj = document.getElementById("completedEmailPreviewSubject");
  const prevText = document.getElementById("completedEmailPreviewBodyText");
  const prevHtml = document.getElementById("completedEmailPreviewBodyHtml");

  if (!subjEl || !textEl || !htmlEl || !prevSubj || !prevText || !prevHtml) return;

  const job = getPreviewJobForEmailTemplate();
  const vars = buildTemplateVars(job);

  prevSubj.textContent = renderTemplate(subjEl.value, vars);
  prevText.textContent = renderTemplate(textEl.value, vars);

  // Safe preview using iframe srcdoc
  const html = renderTemplate(htmlEl.value, vars);
  prevHtml.srcdoc = html;
}

function setEmailTemplateStatus(msg) {
  const s = document.getElementById("emailTemplateStatus");
  if (s) s.textContent = msg || "";
}

document.getElementById("emailTemplateBtn")?.addEventListener("click", () => {
  const tpl = getCompletedEmailTemplate();
  document.getElementById("completedEmailSubjectTpl").value = tpl.subject;
  document.getElementById("completedEmailBodyTextTpl").value = tpl.textBody;
  document.getElementById("completedEmailBodyHtmlTpl").value = tpl.htmlBody;
  setEmailTemplateStatus("");
  updateEmailTemplatePreview();
  $("#emailTemplateModal").modal("show");
});

document.getElementById("saveEmailTemplateBtn")?.addEventListener("click", () => {
  const subject = (document.getElementById("completedEmailSubjectTpl").value || "").trim();
  const textBody = (document.getElementById("completedEmailBodyTextTpl").value || "").trim();
  const htmlBody = (document.getElementById("completedEmailBodyHtmlTpl").value || "").trim();

  if (!subject) return setEmailTemplateStatus("Subject cannot be blank.");
  if (!textBody) return setEmailTemplateStatus("Text body cannot be blank.");
  if (!htmlBody) return setEmailTemplateStatus("HTML body cannot be blank.");

  setCompletedEmailTemplate({ subject, textBody, htmlBody });
  setEmailTemplateStatus("Saved.");
  updateEmailTemplatePreview();
});

document.getElementById("resetEmailTemplateBtn")?.addEventListener("click", () => {
  setCompletedEmailTemplate({ ...DEFAULT_COMPLETED_EMAIL_TEMPLATE });
  setEmailTemplateStatus("Reset to default.");
  updateEmailTemplatePreview();
});

// live preview
["completedEmailSubjectTpl","completedEmailBodyTextTpl","completedEmailBodyHtmlTpl"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", updateEmailTemplatePreview);
});

  MSAL_SETTINGS = readMsalSettingsFromStorage();
  GRAPH_SCOPES = Array.isArray(MSAL_SETTINGS.scopes) ? MSAL_SETTINGS.scopes : ["Mail.Send"];
  MSAL_CONFIG = buildMsalConfigFromSettings(MSAL_SETTINGS);

  // Optional: init MSAL and update UI
  initMsal();
  setMicrosoftAuthUiState();

});

//let MSAL_CONFIG = buildMsalConfigFromSettings(MSAL_SETTINGS);

//let MSAL_SETTINGS = readMsalSettingsFromStorage(); // always an object now
//let GRAPH_SCOPES = Array.isArray(MSAL_SETTINGS.scopes) ? MSAL_SETTINGS.scopes : ["Mail.Send"];


function applyMsalSettingsToRuntime(settings) {
  MSAL_SETTINGS = settings;
  MSAL_CONFIG = buildMsalConfigFromSettings(settings);
  GRAPH_SCOPES = settings.scopes;

  // Force re-init next time (because MSAL client was created with old config)
  msalClient = null;

  // Update the header badge if present
  try {
    initMsal();
    setMicrosoftAuthUiState();
  } catch (e) {}
}


function readMsalSettingsFromStorage() {
  const defaults = getDefaultMsalSettings();
  const raw = localStorage.getItem(MSAL_SETTINGS_STORAGE_KEY);
  const obj = safeJsonParse(raw || "null", null);

  if (!obj || typeof obj !== "object") return defaults;

  return {
    ...defaults,
    ...obj,
    scopes: Array.isArray(obj.scopes) ? obj.scopes : defaults.scopes
  };
}

function writeMsalSettingsToStorage(settings) {
  localStorage.setItem(
    STORAGE_KEYS_EXT.MSAL_SETTINGS,
    JSON.stringify(settings),
  );
}

function normalizeScopes(strOrArray) {
  if (Array.isArray(strOrArray))
    return strOrArray.map((s) => String(s).trim()).filter(Boolean);
  return String(strOrArray || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function validateMsalSettings(s) {
  const errors = [];
  if (!s.clientId) errors.push("Client ID is required.");
  if (!s.tenantId) errors.push("Tenant ID is required.");
  if (!s.redirectUri) errors.push("Redirect URI is required.");
  if (!Array.isArray(s.scopes) || !s.scopes.length)
    errors.push("At least one scope is required.");
  return errors;
}

//const GRAPH_SCOPES = ["Mail.Send"]; // delegated permission required for sendMail [3](https://postmarkapp.com/)[4](https://supabase.com/docs/guides/auth/auth-smtp)

/** Initialize MSAL (safe to call multiple times) */
function initMsal() {
  if (msalClient) return msalClient;

  if (!window.msal || !window.msal.PublicClientApplication) {
    console.warn("MSAL library not loaded. Check vendor/msal-browser.min.js.");
    return null;
  }

  msalClient = new window.msal.PublicClientApplication(MSAL_CONFIG);
  return msalClient;
}

/** Returns the active MSAL account (if any) */
function getMsalAccount() {
  if (!msalClient) return null;

  const accounts = msalClient.getAllAccounts();
  if (!accounts || !accounts.length) return null;

  // If multiple, pick the first; you can improve this with account selection later.
  return accounts[0];
}

/** Updates the small status badge in the header */
function setMicrosoftAuthUiState() {
  const btn = document.getElementById("msSignInBtn");
  const badge = document.getElementById("msAuthStatus");

  if (!btn || !badge) return;

  const account = msalClient ? getMsalAccount() : null;

  if (account) {
    badge.textContent = `Microsoft: ${account.username}`;
    badge.classList.remove("hidden");
    btn.textContent = "✅ Microsoft Signed In";
    btn.classList.remove("btn-outline-primary");
    btn.classList.add("btn-outline-success");
  } else {
    badge.textContent = "Microsoft: Not signed in";
    badge.classList.remove("hidden");
    btn.textContent = "🔐 Microsoft Sign-In";
    btn.classList.add("btn-outline-primary");
    btn.classList.remove("btn-outline-success");
  }
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function sendCompletionNotification(job) {
  const mode = getEmailSendMode();
  if (mode === "graph") {
    const ok = await sendCompletionEmailViaGraph(job);
    return ok ? "sent" : "skipped";
  } else {
    const ok = sendCompletionEmailViaMailto(job);
    return ok ? "sent" : "skipped";
  }
}
async function importMsalSettingsFromFile(file) {
  const text = await file.text();
  const obj = safeJsonParse(text, null);
  if (!obj) throw new Error("Invalid JSON file.");

  const settings = {
    ...DEFAULT_MSAL_SETTINGS,
    ...obj,
    scopes: normalizeScopes(
      obj.scopes || obj.scope || DEFAULT_MSAL_SETTINGS.scopes,
    ),
    saveToSentItems:
      String(obj.saveToSentItems) === "true" || obj.saveToSentItems === true,
  };

  const errors = validateMsalSettings(settings);
  if (errors.length) throw new Error(errors.join(" "));

  writeMsalSettingsToStorage(settings);
  applyMsalSettingsToRuntime(settings);
  fillMsalSettingsModal(settings);
  return settings;
}

async function loadMsalSettingsFromServer() {
  // Served by Laragon at http://localhost/printqueue/msal-config.json
  const res = await fetch("./msal-config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`msal-config.json not found (${res.status}).`);
  const obj = await res.json();

  const settings = {
    ...DEFAULT_MSAL_SETTINGS,
    ...obj,
    scopes: normalizeScopes(
      obj.scopes || obj.scope || DEFAULT_MSAL_SETTINGS.scopes,
    ),
    saveToSentItems:
      String(obj.saveToSentItems) === "true" || obj.saveToSentItems === true,
  };

  const errors = validateMsalSettings(settings);
  if (errors.length) throw new Error(errors.join(" "));

  writeMsalSettingsToStorage(settings);
  applyMsalSettingsToRuntime(settings);
  fillMsalSettingsModal(settings);
  return settings;
}

/** Interactive sign-in (popup) for the print-room operator */
async function microsoftSignInPopup() {
  const client = initMsal();
  if (!client) {
    alert("Microsoft sign-in is not available (MSAL not loaded).");
    return;
  }

  try {
    // Handle redirect responses if any (even though we use popup, safe to include)
    await client.handleRedirectPromise?.();

    const result = await client.loginPopup({
      scopes: GRAPH_SCOPES,
      prompt: "select_account",
    });

    // Set active account
    if (result && result.account) {
      // MSAL v2/v3 stores account in cache; we use getAllAccounts() later
      // Optionally: client.setActiveAccount(result.account);
    }

    setMicrosoftAuthUiState();
    alert("Microsoft sign-in successful.");
  } catch (err) {
    console.error("Microsoft sign-in failed:", err);
    alert("Microsoft sign-in failed. See console for details.");
  }
}

/** Sends an email via Microsoft Graph API */
async function sendEmailViaGraph(to, subject, lines) {
  const token = await acquireGraphToken();
  const emailBody = {
    message: {
      subject: subject,
      body: {
        contentType: "Text",
        content: lines.join("\n"),
      },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: "true",
  };

  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emailBody),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Failed to send email via Graph");
  }
}

/** Acquire Graph access token (silent first, popup fallback) */
async function acquireGraphToken() {
  const client = initMsal();
  if (!client) throw new Error("MSAL not initialized");

  // Ensure redirect responses processed (safe)
  await client.handleRedirectPromise?.();

  const account = getMsalAccount();
  if (!account) {
    throw new Error("No Microsoft account signed in");
  }

  try {
    const tokenResult = await client.acquireTokenSilent({
      scopes: GRAPH_SCOPES,
      account,
    });
    return tokenResult.accessToken;
  } catch (silentErr) {
    console.warn("Silent token acquisition failed, trying popup:", silentErr);

    const tokenResult = await client.acquireTokenPopup({
      scopes: GRAPH_SCOPES,
      account,
    });
    return tokenResult.accessToken;
  }
}

function fillMsalSettingsModal(s) {
  document.getElementById("msalTenantId").value = s.tenantId || "";
  document.getElementById("msalClientId").value = s.clientId || "";
  document.getElementById("msalRedirectUri").value = s.redirectUri || "";
  document.getElementById("msalScopes").value = (s.scopes || []).join(", ");
  document.getElementById("msalSenderMailbox").value = s.senderMailbox || "";
  document.getElementById("msalSaveToSentItems").value = String(
    !!s.saveToSentItems,
  );
}

function readMsalSettingsFromModal() {
  const settings = {
    tenantId: document.getElementById("msalTenantId").value.trim(),
    clientId: document.getElementById("msalClientId").value.trim(),
    redirectUri: document.getElementById("msalRedirectUri").value.trim(),
    scopes: normalizeScopes(document.getElementById("msalScopes").value),
    senderMailbox: document.getElementById("msalSenderMailbox").value.trim(),
    saveToSentItems:
      document.getElementById("msalSaveToSentItems").value === "true",
  };
  return settings;
}

function setMsalSettingsStatus(msg) {
  const el = document.getElementById("msalSettingsStatus");
  if (el) el.textContent = msg || "";
}

document.addEventListener("DOMContentLoaded", () => {
  // Populate modal from storage
  try {
    fillMsalSettingsModal(readMsalSettingsFromStorage());
  } catch (e) {}

  // Open modal (admin/operator only - you can enforce by only showing the button after admin login)
  document.getElementById("msalSettingsBtn")?.addEventListener("click", () => {
    fillMsalSettingsModal(readMsalSettingsFromStorage());
    setMsalSettingsStatus("");
    $("#msalSettingsModal").modal("show");
  });

  // Save settings
  document.getElementById("msalSaveBtn")?.addEventListener("click", () => {
    const settings = readMsalSettingsFromModal();
    const errors = validateMsalSettings(settings);
    if (errors.length) {
      setMsalSettingsStatus(errors.join(" "));
      return;
    }
    writeMsalSettingsToStorage(settings);
    applyMsalSettingsToRuntime(settings);
    setMsalSettingsStatus("Saved.");
  });

  // Export JSON file
  document.getElementById("msalExportBtn")?.addEventListener("click", () => {
    const settings = readMsalSettingsFromStorage();
    downloadJson("msal-config.json", settings);
    setMsalSettingsStatus("Exported msal-config.json");
  });

  // Import JSON file
  const fileInput = document.getElementById("msalFileInput");
  document
    .getElementById("msalLoadFileBtn")
    ?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await importMsalSettingsFromFile(f);
      setMsalSettingsStatus("Imported and applied.");
    } catch (err) {
      console.error(err);
      setMsalSettingsStatus("Import failed: " + (err.message || err));
    } finally {
      e.target.value = "";
    }
  });

  // Reload from server file
  document
    .getElementById("msalLoadServerBtn")
    ?.addEventListener("click", async () => {
      try {
        await loadMsalSettingsFromServer();
        setMsalSettingsStatus("Loaded from msal-config.json");
      } catch (err) {
        console.error(err);
        setMsalSettingsStatus("Load failed: " + (err.message || err));
      }
    });
});

/* ================= AUDIT LOG ================= */
function appendAudit(entry) {
  const log = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.AUDIT_LOG) || "[]",
    [],
  );
  log.push({ ...entry, ts: Date.now(), actor: currentUser.email || "teacher" });
  if (log.length > 2000) log.splice(0, log.length - 2000);
  localStorage.setItem(STORAGE_KEYS.AUDIT_LOG, JSON.stringify(log));
}
const getAuditLog = () =>
  safeJsonParse(localStorage.getItem(STORAGE_KEYS.AUDIT_LOG) || "[]", []);
function appendDeletion(job, reason) {
  const log = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.DELETION_LOG) || "[]",
    [],
  );
  log.push({
    ts: Date.now(),
    actor: currentUser.email || "unknown",
    ref: job.reference,
    teacher: job.teacher,
    pages: job.pages,
    copies: job.copies,
    grades: job.grades,
    reason,
  });
  if (log.length > 500) log.splice(0, log.length - 500);
  localStorage.setItem(STORAGE_KEYS.DELETION_LOG, JSON.stringify(log));
}

function openEditCompletedJobModal(job) {
  if (currentUser.role !== "super-admin") return;

  jobBeingEdited = job;

  editPages.value = job.pages;
  editCopies.value = job.copies;
  editSides.value = job.sides;
  editPrintType.value = job.printType;
  editAdditionalTask.value = job.additionalTask;

  renderGradeChecklist(
    document.getElementById("editGradeChecklist"),
    getGradeList(),
    normalizeGrades(job.grades),
  );

  document.getElementById("editJobNotes").value = getJobNotes(job.reference);

  $("#editCompletedJobModal").modal("show");
}

function openAssignGradeModal(job) {
  jobPendingGradeAssignment = job;

  document.getElementById("assignGradeJobInfo").textContent =
    `Job Ref: ${job.reference} • Teacher: ${job.teacher}`;

  renderGradeChecklist(
    document.getElementById("assignGradeChecklist"),
    getGradeList(),
    [], // force user to choose
  );

  $("#assignGradeModal").modal("show");
}

function jobMatchesGradeQuery(job, query) {
  const q = query.toLowerCase();

  // special case: "unassigned"
  if (q === "unassigned") {
    return normalizeGrades(job.grades).includes("Unassigned");
  }

  return normalizeGrades(job.grades).some((g) => g.toLowerCase().includes(q));
}

function populateAnalyticsGradeSelector() {
  const select = document.getElementById("analyticsGradeSelector");
  if (!select) return;

  const grades = new Set();
  getCompletedJobs().forEach((job) => {
    normalizeGrades(job.grades).forEach((g) => grades.add(g));
  });

  select.innerHTML = `
    <option value="__ALL__" selected>All Grades</option>
    ${Array.from(grades)
      .sort()
      .map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`)
      .join("")}
  `;

  AnalyticsFilters.grades.clear();
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

  document.getElementById("trendDateFrom").value = from
    ? from.toISOString().slice(0, 10)
    : "";

  document.getElementById("trendDateTo").value = "";

  if (window.currentTrendAnalyticsView) {
    activateGradeAnalyticsView(window.currentTrendAnalyticsView);
  }
}

function buildReferenceIndex() {
  const refs = new Set();
  jobs.forEach((job) => {
    if (job.reference) refs.add(job.reference);
  });
  return refs;
}

function setupAnalyticsFilters() {
  // Preset buttons
  document.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setPresetDateRange(btn.dataset.range);
    });
  });

  // Grade selector

  const gradeSelect = document.getElementById("analyticsGradeSelector");

  gradeSelect.addEventListener("change", () => {
    const selectedValues = Array.from(gradeSelect.selectedOptions).map(
      (opt) => opt.value,
    );

    AnalyticsFilters.grades.clear();

    if (selectedValues.includes("__ALL__") || selectedValues.length === 0) {
      // Treat as "no filter"
      gradeSelect.value = "__ALL__";
    } else {
      selectedValues.forEach((v) => AnalyticsFilters.grades.add(v));
    }

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
  const trendFilter = document.getElementById("trendDateFilter");

  trendFilter.classList.toggle("d-none", !config.isTrend);

  config.render(container);

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

  $("#gradeAnalyticsModal").on("shown.bs.modal", () => {
    activateGradeAnalyticsView("jobsPerGrade");
  });

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
  job.startedAt = job.startedAt ? Number(job.startedAt) : null;
  job.completedAt =
    job.completedAt === null || job.completedAt === undefined
      ? null
      : Number(job.completedAt);
  job.grades = normalizeGrades(job.grades);
  job.urgent = Boolean(job.urgent);
  job.shortNotice = Boolean(job.shortNotice);
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
  const notes = getNotesCached();
  notes[reference] = text;
  localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(notes));
}

function getJobNotes(reference) {
  if (!Array.from(jobs.values()).some((j) => j.reference === reference))
    return "";
  return getNotesCached()[reference] || "";
}

function jobHasNotes(reference) {
  return getJobNotes(reference).trim().length > 0;
}

window.downloadNotes = (reference) => {
  const notes = getNotesCached();
  if (!notes[reference]) return alert("No notes for this job.");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([notes[reference]], { type: "text/plain" }),
  );
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

function _buildMailto(to, subject, lines) {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

async function sendCompletionEmail(job) {
  if (!isEmailNotificationEnabled()) return false;
  const emailMap = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS) || "{}",
    {},
  );
  const teacherEmail = emailMap[job.teacher];
  if (!teacherEmail) return false;

  const subject = "Your print job has been completed";
  const body = [
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
  ];

  if (getMsalAccount()) {
    try {
      await sendEmailViaGraph(teacherEmail, subject, body);
      return true;
    } catch (err) {
      console.error("Graph email failed, falling back to mailto:", err);
    }
  }

  window.location.href = _buildMailto(teacherEmail, subject, body);
  return true;
}

async function sendCompletionEmailViaGraph(job) {
  // Must have MSAL sign-in and token
  if (typeof acquireGraphToken !== "function") {
    console.warn("Graph mode selected but acquireGraphToken() is not available.");
    alert("Graph mode is enabled but Microsoft sign-in is not configured.");
    return false;
  }

  const emailMap = safeJsonParse(localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS) || "{}", {});
  const teacherEmail = emailMap[job.teacher];
  if (!teacherEmail) return false;

  const tpl = getCompletedEmailTemplate();
  const vars = buildTemplateVars(job);

  const subject = renderTemplate(tpl.subject, vars);
  const htmlBody = renderTemplate(tpl.htmlBody, vars);

  const token = await acquireGraphToken();

  // Sender mailbox can be fixed or read from your MSAL settings modal later
  const senderMailbox = "no-reply@forestview.co.za";
  const saveToSentItems = false;

  const payload = {
    message: {
      subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: [{ emailAddress: { address: teacherEmail } }]
    },
    saveToSentItems
  };

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderMailbox)}/sendMail`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (res.status === 202) return true; // accepted [1](https://www.npmjs.com/package/@sendgrid/mail)

  const text = await res.text().catch(() => "");
  console.error("Graph sendMail failed:", res.status, text);
  return false;
}

async function sendAuthoriserNotifyEmail(job) {
  if (!isEmailNotificationEnabled() || !job.authoriser) return;
  const emailMap = safeJsonParse(
    localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS) || "{}",
    {},
  );
  const authEmail = emailMap[job.authoriser];
  if (!authEmail) return;

  const subject = `Print job lodged: ${job.reference}`;
  const body = [
    `Dear ${job.authoriser},`,
    "",
    "A print job has been submitted under your authorisation.",
    "",
    `Ref: ${job.reference}`,
    `Teacher: ${job.teacher}`,
    `Volume: ${job.pages}p × ${job.copies}c`,
    `Grades: ${(job.grades || []).join(", ")}`,
    job.scheduledFor
      ? `Due: ${new Date(job.scheduledFor).toLocaleString()}`
      : "Due: ASAP",
    "",
    "Regards,",
    "Print Room",
  ];

  if (getMsalAccount()) {
    try {
      await sendEmailViaGraph(authEmail, subject, body);
      return;
    } catch (err) {
      console.error("Graph email failed, falling back to mailto:", err);
    }
  }

  window.location.href = _buildMailto(authEmail, subject, body);
}

/* ================= OPEN HOURS ENGINE ================= */
const _DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_OPEN_HOURS = {
  Mon: { open: "07:30", close: "16:00", enabled: true },
  Tue: { open: "07:30", close: "16:00", enabled: true },
  Wed: { open: "07:30", close: "16:00", enabled: true },
  Thu: { open: "07:30", close: "16:00", enabled: true },
  Fri: { open: "07:30", close: "16:00", enabled: true },
  Sat: { open: "08:00", close: "12:00", enabled: false },
  Sun: { open: "08:00", close: "12:00", enabled: false },
};

function getOpenHours() {
  return Object.assign(
    {},
    DEFAULT_OPEN_HOURS,
    AppState.settings.openHours || {},
  );
}

function openMinutesBetween(fromTs, toTs) {
  if (toTs <= fromTs) return 0;
  const oh = getOpenHours();
  let total = 0;
  const cursor = new Date(fromTs);
  cursor.setSeconds(0, 0);
  while (cursor.getTime() < toTs) {
    const dayKey = _DAY_KEYS[cursor.getDay()];
    const rule = oh[dayKey];
    if (rule && rule.enabled) {
      const base = new Date(cursor);
      base.setHours(0, 0, 0, 0);
      const [oh1, om1] = rule.open.split(":").map(Number);
      const [ch1, cm1] = rule.close.split(":").map(Number);
      const dayOpen = base.getTime() + (oh1 * 60 + om1) * 60000;
      const dayClose = base.getTime() + (ch1 * 60 + cm1) * 60000;
      const start = Math.max(fromTs, dayOpen);
      const end = Math.min(toTs, dayClose);
      if (end > start) total += (end - start) / 60000;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return Math.max(0, total);
}

function isOutsideOpenHours(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  const dayKey = _DAY_KEYS[d.getDay()];
  const oh = getOpenHours();
  const rule = oh[dayKey];
  if (!rule || !rule.enabled) return true;
  const hhmm = d.getHours() * 60 + d.getMinutes();
  const [oh1, om1] = rule.open.split(":").map(Number);
  const [ch1, cm1] = rule.close.split(":").map(Number);
  return hhmm < oh1 * 60 + om1 || hhmm >= ch1 * 60 + cm1;
}

function nextOpenMinute(ts) {
  const oh = getOpenHours();
  const d = new Date(ts);
  for (let i = 0; i < 14; i++) {
    const dayKey = _DAY_KEYS[d.getDay()];
    const rule = oh[dayKey];
    if (rule && rule.enabled) {
      const base = new Date(d);
      base.setHours(0, 0, 0, 0);
      const [oh1, om1] = rule.open.split(":").map(Number);
      const [ch1, cm1] = rule.close.split(":").map(Number);
      const dayOpen = base.getTime() + (oh1 * 60 + om1) * 60000;
      const dayClose = base.getTime() + (ch1 * 60 + cm1) * 60000;
      if (d.getTime() < dayClose) return Math.max(d.getTime(), dayOpen);
    }
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
  }
  return ts;
}

/* ================= TIME / URGENCY ================= */
function isUrgent(job) {
  if (job.status === "Completed" || !job.scheduledFor) return false;
  if (new Date(job.scheduledFor).getTime() <= Date.now()) return false;
  const openMins = openMinutesBetween(
    Date.now(),
    new Date(job.scheduledFor).getTime(),
  );
  return openMins <= 180 && openMins > 0; // 3 open hours
}

function isOverdue(job) {
  if (job.status === "Completed" || !job.scheduledFor) return false;
  return new Date(job.scheduledFor).getTime() < Date.now();
}

function wasOverdue(job) {
  if (job.status !== "Completed" || !job.scheduledFor || !job.completedAt)
    return false;
  return new Date(job.completedAt) > new Date(job.scheduledFor);
}

function isShortNotice(job) {
  if (!job.scheduledFor) return false;
  const openMins = openMinutesBetween(
    job.requestedAt,
    new Date(job.scheduledFor).getTime(),
  );
  return openMins < (AppState.settings.minLeadTimeHours || 2) * 60;
}

function isStalled(job) {
  if (job.status !== "In process" || !job.startedAt) return false;
  return (
    (Date.now() - job.startedAt) / 1000 >
    (job.estimate || 0) * (AppState.settings.stallMultiplier || 1.5)
  );
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
  return `${today}-${getAllJobs().filter((j) => (j.reference || "").startsWith(today)).length + 1}`;
}

function addJob(job, notesText) {
  idCounter += 1;
  const sn = isShortNotice({
    scheduledFor: job.scheduledFor,
    requestedAt: Date.now(),
  });
  const newJob = {
    ...job,
    id: idCounter,
    reference: generateJobReference(),
    requestedAt: Date.now(),
    status: "Queued",
    completedAt: null,
    startedAt: null,
    shortNotice: sn,
  };
  newJob.grades = normalizeGrades(newJob.grades);
  newJob.estimate = calculateJobEstimate(newJob);
  jobs.set(newJob.id, newJob);
  if (notesText && notesText.trim())
    saveJobNotes(newJob.reference, notesText.trim());
  appendAudit({
    action: "created",
    ref: newJob.reference,
    teacher: newJob.teacher,
  });
  if (newJob.authoriser) sendAuthoriserNotifyEmail(newJob);
  AppState.save();
  return newJob;
}

function getCompletedEmailTemplate() {
  const stored = safeJsonParse(localStorage.getItem(STORAGE_KEYS.EMAIL_TEMPLATE) || "null", null);
  if (!stored || typeof stored !== "object") return { ...DEFAULT_COMPLETED_EMAIL_TEMPLATE };
  return {
    subject: String(stored.subject || DEFAULT_COMPLETED_EMAIL_TEMPLATE.subject),
    body: String(stored.body || DEFAULT_COMPLETED_EMAIL_TEMPLATE.body),
  };
}

function setCompletedEmailTemplate(tpl) {
  localStorage.setItem(STORAGE_KEYS.EMAIL_TEMPLATE, JSON.stringify(tpl));
}

function formatDateTime(tsOrIso) {
  if (!tsOrIso) return "—";
  const d = new Date(tsOrIso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function buildTemplateVars(job) {
  const grades = (job.grades || []).join(", ");
  const notes = (typeof getJobNotes === "function") ? (getJobNotes(job.reference) || "").trim() : "";
  const notesBlock = notes ? `Notes:\n${notes}\n` : "";
  return {
    teacher: job.teacher || "Teacher",
    reference: job.reference || String(job.id || ""),
    pages: String(job.pages ?? ""),
    copies: String(job.copies ?? ""),
    grades: grades || "Unassigned",
    due: job.scheduledFor ? formatDateTime(job.scheduledFor) : "ASAP",
    completed: job.completedAt ? formatDateTime(job.completedAt) : formatDateTime(Date.now()),
    notes: notes,
    notesBlock: notesBlock,
    sender: "Print Room",
  };
}

// Very small template engine: replaces {{key}} tokens.
function renderTemplate(str, vars) {
  return String(str || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    return (vars[k] !== undefined && vars[k] !== null) ? String(vars[k]) : "";
  });
}

function getPreviewJobForEmailTemplate() {
  // Use most recent completed job if possible
  const completed = (typeof getCompletedJobs === "function") ? getCompletedJobs() : [];
  const sorted = completed
    .filter(j => j && j.completedAt)
    .slice()
    .sort((a,b) => (b.completedAt || 0) - (a.completedAt || 0));
  if (sorted.length) return sorted[0];

  // Fallback sample
  return {
    id: 0,
    reference: "2026-UNKNOWN",
    teacher: "Unknown Teacher",
    pages: 2,
    copies: 30,
    grades: ["Unassigned"],
    scheduledFor: new Date().toISOString(),
    completedAt: Date.now()
  };
}

function sendCompletionEmailViaMailto(job) {
  if (!isEmailNotificationEnabled()) return false;

  const emailMap = safeJsonParse(localStorage.getItem(STORAGE_KEYS.TEACHER_EMAILS) || "{}", {});
  const teacherEmail = emailMap[job.teacher];
  if (!teacherEmail) return false;

  const tpl = getCompletedEmailTemplate();
  const vars = buildTemplateVars(job);

  const subject = renderTemplate(tpl.subject, vars);
  const bodyText = renderTemplate(tpl.textBody, vars);

  window.location.href = _buildMailto(teacherEmail, subject, bodyText.split("\n"));
  return true;
}

function updateJobStatus(id, status) {
  const job = jobs.get(id);
  if (!job) return;
  const prev = job.status;
  job.status = status;
  if (status === "In process") job.startedAt = Date.now();
  if (status === "Completed") {
    job.completedAt = Date.now();
    
if (!isEmailNotificationEnabled()) {
  job.notificationStatus = "disabled";
} else {
  // default; updated asynchronously if graph mode
  job.notificationStatus = "pending";

  Promise.resolve(sendCompletionNotification(job))
    .then(status => {
      job.notificationStatus = status;
      AppState.save();
      rerenderAll();
    })
    .catch(err => {
      console.error("Completion email failed:", err);
      job.notificationStatus = "skipped";
      AppState.save();
      rerenderAll();
    });
}

    completedJobsLimit = 10;
  }
  appendAudit({
    action: "status_change",
    ref: job.reference,
    from: prev,
    to: status,
  });
  AppState.save();
}

function deleteJob(id, reason) {
  const job = jobs.get(id);
  if (!job) return;
  appendAudit({
    action: "deleted",
    ref: job.reference,
    teacher: job.teacher,
    reason,
  });
  appendDeletion(job, reason);
  jobs.delete(id);
  AppState.save();
}

function reQueueJob(id) {
  const src = jobs.get(id);
  if (!src) return;
  addJob(
    {
      teacher: src.teacher,
      authoriser: src.authoriser,
      pages: src.pages,
      copies: src.copies,
      printType: src.printType,
      sides: src.sides,
      additionalTask: src.additionalTask,
      scheduledFor: src.scheduledFor,
      grades: src.grades,
      urgent: src.urgent,
    },
    getJobNotes(src.reference),
  );
}

/* ================= USABILITY — DUPLICATE DETECTION ================= */
function findDuplicates(teacher, grades, scheduledFor) {
  return getAllJobs().filter(
    (j) =>
      j.status !== "Completed" &&
      j.teacher === teacher &&
      j.scheduledFor === (scheduledFor || "") &&
      intersects(normalizeGrades(j.grades), normalizeGrades(grades)),
  );
}

/* ================= USABILITY — CAPACITY WARNING ================= */
function updateCapacityWarning() {
  const c = elements.capacityWarning;
  if (!c) return;
  const count = getAllJobs().filter((j) => j.status === "In process").length;
  const max = AppState.settings.maxConcurrentJobs || 2;
  if (count >= max) {
    c.textContent = `⚠️ ${count} job(s) currently In Process — at capacity limit (${max}).`;
    c.classList.remove("hidden");
  } else {
    c.classList.add("hidden");
  }
}

/* ================= USABILITY — TEACHER PAGE CAP ================= */
function getTeacherDailyPages(teacher) {
  const today = new Date().toISOString().slice(0, 10);
  return getAllJobs()
    .filter(
      (j) =>
        j.teacher === teacher &&
        new Date(j.requestedAt).toISOString().slice(0, 10) === today,
    )
    .reduce((s, j) => s + (j.pages || 0) * (j.copies || 0), 0);
}

/* ================= USABILITY — BULK ACTIONS ================= */
function toggleBulkSelect(id) {
  bulkSelected.has(id) ? bulkSelected.delete(id) : bulkSelected.add(id);
  rerenderAll();
}

async function applyBulkAction(action) {
  if (!bulkSelected.size) {
    alert("No jobs selected.");
    return;
  }
  for (const id of bulkSelected) {
    const j = jobs.get(id);
    if (!j || !canUserModifyJob(j)) continue;
    if (action === "start" && j.status === "Queued")
      await updateJobStatus(id, "In process");
    if (action === "finish" && j.status === "In process")
      await updateJobStatus(id, "Completed");
  }
  bulkSelected.clear();
  rerenderAll();
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
    const lines = String(e.target.result).split(/\r?\n/).filter(Boolean);

    const existingRefs = buildReferenceIndex();

    let added = 0;
    let skipped = 0;
    const duplicates = [];

    lines.forEach((line) => {
      const data = safeJsonParse(line, null);
      if (!data || !data.reference) return;

      if (existingRefs.has(data.reference)) {
        skipped++;
        duplicates.push(data.reference);

        appendAudit({
          action: "import_skip_duplicate",
          ref: data.reference,
        });

        return; // 🚫 do NOT add
      }

      const job = normalizeJob({
        ...data,
        status: "Completed",
        id: ++idCounter,
      });

      jobs.set(job.id, job);
      existingRefs.add(job.reference);
      added++;
    });

    AppState.save();
    rerenderAll();

    // UI feedback
    const report = document.getElementById("duplicateReport");
    if (report) {
      report.innerHTML = `
        ✅ Added: <strong>${added}</strong><br>
        ⚠️ Skipped duplicates: <strong>${skipped}</strong>
      `;
    }

    if (duplicates.length) {
      console.warn("Duplicate references skipped:", duplicates);
    }
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

function renderGradeChecklist(containerEl, grades, selected = []) {
  if (!containerEl) return;

  const selectedSet = new Set(selected);

  containerEl.innerHTML = grades
    .map((grade, idx) => {
      const id = `${containerEl.id}_grade_${idx}`;
      return `
      <div class="custom-control custom-checkbox">
        <input
          type="checkbox"
          class="custom-control-input"
          id="${id}"
          data-grade="${escapeHtml(grade)}"
          ${selectedSet.has(grade) ? "checked" : ""}
        >
        <label class="custom-control-label" for="${id}">
          ${escapeHtml(grade)}
        </label>
      </div>
    `;
    })
    .join("");
}

function getSelectedGradesFromChecklist(containerEl) {
  if (!containerEl) return [];

  const boxes = containerEl.querySelectorAll(
    "input[type='checkbox'][data-grade]",
  );

  const selected = [];
  boxes.forEach((box) => {
    if (box.checked) selected.push(box.dataset.grade);
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
  if (observer) {
    observer.disconnect();
    observer = null;
  }
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
  const estTime =
    typeof j.estimate === "number" ? j.estimate : calculateJobEstimate(j);
  const gradesBadges = formatGradesBadges(j.grades);

  /* ── Badges ── */
  const notifBadge = isCompleted
    ? {
        sent: '<span class="badge badge-info ml-1">Email Sent</span>',
        skipped: '<span class="badge badge-secondary ml-1">No Email</span>',
        disabled: '<span class="badge badge-warning ml-1">Email Off</span>',
      }[j.notificationStatus] || ""
    : "";
  const lateBadge =
    isCompleted && wasOverdue(j)
      ? '<span class="badge badge-danger ml-1">Late</span>'
      : "";
  const urgBadge = j.urgent
    ? '<span class="badge badge-danger ml-1">🔥 Urgent</span>'
    : "";
  const snBadge =
    j.shortNotice && !isCompleted
      ? '<span class="badge badge-warning ml-1">⏱ Short Notice</span>'
      : "";
  const stallBadge = isStalled(j)
    ? '<span class="badge badge-warning ml-1">⚠️ Stalled</span>'
    : "";
  const ohBadge =
    !isCompleted &&
    j.scheduledFor &&
    isOutsideOpenHours(new Date(j.scheduledFor).getTime())
      ? '<span class="badge badge-warning ml-1">🕐 Outside Hours</span>'
      : "";

  /* ── Elapsed progress bar (In process only) ── */
  let elapsedHtml = "";
  if (j.status === "In process" && j.startedAt) {
    const elapsed = Math.round((Date.now() - j.startedAt) / 1000);
    const pct = Math.min(100, Math.round((elapsed / estTime) * 100));
    const bc = pct >= 100 ? "#dc3545" : pct >= 75 ? "#ffc107" : "#28a745";
    elapsedHtml = `<div class="mt-1">
      <div class="d-flex justify-content-between" style="font-size:.78rem">
        <span>⏱ ${fmtSec(elapsed)} elapsed</span><span>${fmtSec(estTime)} est.</span>
      </div>
      <div class="progress" style="height:5px;">
        <div class="progress-bar" style="width:${pct}%;background:${bc};transition:width .5s;"></div>
      </div></div>`;
  }

  /* ── Notes ── */
  const notesText = getJobNotes(j.reference);
  const notesHtml = notesText
    ? `<div class="mt-2 small bg-light border rounded p-2"><strong>Notes:</strong><br>${escapeHtml(notesText).replace(/\n/g, "<br>")}</div>`
    : "";
  const notesBtnClass = jobHasNotes(j.reference)
    ? "btn-outline-primary"
    : "btn-outline-secondary";

  /* ── Bulk checkbox + admin actions ── */
  const isAdmin =
    currentUser.authenticated &&
    (currentUser.role === "admin" || currentUser.role === "super-admin");
  const allowed = canUserModifyJob(j);
  const bulkCbx =
    isAdmin && !isCompleted
      ? `<input type="checkbox" class="mr-2 mt-1" style="cursor:pointer;" data-action="bulkSelect" data-id="${j.id}" ${bulkSelected.has(j.id) ? "checked" : ""}>`
      : "";

  let actions = "";
  if (isAdmin && !isCompleted) {
    const dis = allowed ? "" : "disabled";
    if (j.status === "Queued")
      actions += `<button class="btn btn-outline-primary btn-sm" data-action="updateStatus" data-id="${j.id}" data-status="In process" ${dis}>Start</button> `;
    else if (j.status === "In process")
      actions += `<button class="btn btn-success btn-sm" data-action="updateStatus" data-id="${j.id}" data-status="Completed" ${dis}>Finish</button> `;
    actions += `<button class="btn btn-danger btn-sm" data-action="deleteJob" data-id="${j.id}" ${dis}>Delete</button>`;
    if (!allowed)
      actions += ` <span class="badge badge-warning ml-1">Not assigned</span>`;
  }
  const reQBtn = isCompleted
    ? `<button class="btn btn-sm btn-outline-secondary ml-1" data-action="reQueue" data-id="${j.id}">↩ Re-queue</button>`
    : "";
  const editBtn =
    isCompleted && currentUser.role === "super-admin"
      ? `<button class="btn btn-sm btn-outline-primary ml-1" data-action="editCompletedJob" data-id="${j.id}">Edit</button>`
      : "";

  return `
    <div class="card-body p-3">
      <div class="d-flex justify-content-between align-items-start mb-1">
        <div class="d-flex align-items-start">${bulkCbx}
          <div>
            <div class="small text-muted">Ref: <strong>${escapeHtml(j.reference || String(j.id))}</strong></div>
            <div class="font-weight-bold">${escapeHtml(j.teacher)}${
              j.authoriser
                ? ` <span class="text-muted small font-weight-normal">auth: ${escapeHtml(j.authoriser)}</span>`
                : ""
            }</div>
            <div class="mt-1">${gradesBadges}</div>
          </div>
        </div>
        <div class="text-right">
          <span class="badge ${statusBadgeClass}">${escapeHtml(isCompleted ? "Finished" : j.status)}</span>
          ${urgBadge}${snBadge}${stallBadge}${ohBadge}${notifBadge}${lateBadge}
        </div>
      </div>
      <div class="small mb-1">
        Req: ${escapeHtml(new Date(j.requestedAt).toLocaleString())}<br>
        ${isCompleted && j.completedAt ? `Done: ${escapeHtml(new Date(j.completedAt).toLocaleString())}<br>` : ""}
        Due: ${escapeHtml(j.scheduledFor ? new Date(j.scheduledFor).toLocaleString() : "ASAP")}<br>
        Est: <strong>${fmtSec(estTime)}</strong> &nbsp;|&nbsp; <strong>${escapeHtml(String(j.pages))}p × ${escapeHtml(String(j.copies))}c</strong> &nbsp;|&nbsp; ${escapeHtml(j.printType)}/${escapeHtml(j.sides)}/${escapeHtml(j.additionalTask)}
      </div>
      ${elapsedHtml}
      <div class="d-flex flex-wrap align-items-center mt-2" style="gap:4px;">
        ${actions}
        <button class="btn btn-sm ${notesBtnClass} ml-auto" data-action="downloadNotes" data-ref="${escapeHtml(j.reference || "")}">Notes</button>
        ${reQBtn}${editBtn}
      </div>
      ${notesHtml}
    </div>`;
}

/* ================= RENDER PIPELINE ================= */
function rerenderAll() {
  const all = getAllJobs(); // already normalised — no re-normalise needed

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

    const matcher = (j) =>
      (j.teacher || "").toLowerCase().includes(q) || jobMatchesGradeQuery(j, q);

    active = active.filter(matcher);
    completed = completed.filter(matcher);
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

  elements.jobCount.textContent = String(active.length);
  elements.pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  updateCapacityWarning();

  // Bulk toolbar
  const bulkToolbar = document.getElementById("bulkActionToolbar");
  if (bulkToolbar)
    bulkToolbar.classList.toggle(
      "hidden",
      !bulkSelected.size || !currentUser.authenticated,
    );
  const bulkCount = document.getElementById("bulkSelectedCount");
  if (bulkCount) bulkCount.textContent = String(bulkSelected.size);

  // Active queue
  if (!pageItems.length) {
    elements.queue.innerHTML = `<p class="text-muted small">Queue is empty.</p>`;
  } else {
    elements.queue.innerHTML = "";
    const frag = document.createDocumentFragment();
    pageItems.forEach((j) => {
      const card = document.createElement("div");
      card.className = "card mb-2 job";
      if (isStalled(j)) card.classList.add("job-stalled");
      else if (isOverdue(j)) card.classList.add("job-overdue");
      else if (isUrgent(j)) card.classList.add("job-urgent");
      if (j.urgent) card.classList.add("job-teacher-urgent");
      card.dataset.jobId = j.id;
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
      card.dataset.jobId = j.id;
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

  if (!completedJobs || completedJobs.length === 0) {
    if (window.teacherChartInstance) {
      window.teacherChartInstance.destroy();
      window.teacherChartInstance = null;
    }
    if (window.timeChartInstance) {
      window.timeChartInstance.destroy();
      window.timeChartInstance = null;
    }
    return;
  }
  if (!teacherCanvas || !timeCanvas || typeof Chart === "undefined") return;

  // Single pass — local accumulators only
  const pbt = {},
    on = new Array(24).fill(0),
    lt = new Array(24).fill(0);
  completedJobs.forEach((j) => {
    const t = j.teacher || "Unknown";
    pbt[t] = (pbt[t] || 0) + (j.pages || 0) * (j.copies || 0);
    if (j.completedAt) {
      const h = new Date(j.completedAt).getHours();
      wasOverdue(j) ? lt[h]++ : on[h]++;
    }
  });

  const labels = Object.keys(pbt)
    .sort((a, b) => pbt[b] - pbt[a])
    .slice(0, 10);
  if (window.teacherChartInstance) window.teacherChartInstance.destroy();
  window.teacherChartInstance = new Chart(teacherCanvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Total Pages (Top 10)", data: labels.map((l) => pbt[l]) },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { yAxes: [{ ticks: { beginAtZero: true, precision: 0 } }] },
    },
  });

  if (window.timeChartInstance) window.timeChartInstance.destroy();
  window.timeChartInstance = new Chart(timeCanvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: Array.from({ length: 24 }, (_, i) => String(i)),
      datasets: [
        { label: "Completed on time", data: on, backgroundColor: "#28a745" },
        { label: "Completed late", data: lt, backgroundColor: "#dc3545" },
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
    grouped[days[new Date(job.completedAt).getDay()]].push(job);
  });

  const rows = days
    .map((day) => {
      const jfd = grouped[day];
      const totalSec = jfd.reduce((s, j) => s + (j.estimate || 0), 0);
      const sample = jfd
        .slice(0, 5)
        .map((j) => escapeHtml(j.teacher))
        .join(", ");
      return `<tr>
      <td><strong>${day}</strong></td><td>${jfd.length}</td>
      <td>${sample}${jfd.length > 5 ? "..." : ""}</td>
      <td>${Math.round(totalSec / 60)} min</td>
    </tr>`;
    })
    .join("");

  container.innerHTML = `<table class="table table-sm table-bordered">
    <thead class="thead-light"><tr><th>Day</th><th>Jobs</th><th>Details</th><th>Total Time</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
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

  // Show Microsoft sign-in controls to admins/operators only
  const msBtn = document.getElementById("msSignInBtn");
  const msBadge = document.getElementById("msAuthStatus");
  if (msBtn) msBtn.classList.remove("hidden");
  if (msBadge) msBadge.classList.remove("hidden");

  // Initialize MSAL and update badge if operator already signed in previously
  initMsal();
  setMicrosoftAuthUiState();
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

  if (window.teacherChartInstance) {
    window.teacherChartInstance.destroy();
    window.teacherChartInstance = null;
  }
  if (window.timeChartInstance) {
    window.timeChartInstance.destroy();
    window.timeChartInstance = null;
  }

  bulkSelected.clear();
  rerenderAll();

  // Hide Microsoft sign-in controls when admin logs out
  const msBtn = document.getElementById("msSignInBtn");
  const msBadge = document.getElementById("msAuthStatus");
  if (msBtn) msBtn.classList.add("hidden");
  if (msBadge) msBadge.classList.add("hidden");
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
    if (!job.completedAt) return;
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
        title: { display: true, text: "Completed Jobs – Day × Hour Pattern" },
      },
      responsive: true,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
    },
  });
}

/* ================= USABILITY — SUBMISSION CONFIRMATION MODAL ================= */
function openConfirmSubmitModal(jobData, notesText) {
  let eff = jobData.pages;
  if (jobData.printType === "2-in-1") eff = Math.ceil(eff / 2);
  if (jobData.sides === "double") eff = Math.ceil(eff / 2);
  eff *= jobData.copies;

  document.getElementById("confirmTeacher").textContent = jobData.teacher;
  document.getElementById("confirmAuthoriser").textContent =
    jobData.authoriser || "—";
  document.getElementById("confirmGrades").textContent =
    jobData.grades.join(", ");
  document.getElementById("confirmVolume").textContent =
    `${jobData.pages}p × ${jobData.copies}c = ${eff} sheets`;
  document.getElementById("confirmType").textContent =
    `${jobData.printType} / ${jobData.sides}-sided`;
  document.getElementById("confirmTasks").textContent = jobData.additionalTask;
  document.getElementById("confirmDue").textContent = jobData.scheduledFor
    ? new Date(jobData.scheduledFor).toLocaleString()
    : "ASAP";
  document.getElementById("confirmEstimate").textContent = fmtSec(
    calculateJobEstimate(jobData),
  );
  document.getElementById("confirmNotes").textContent = notesText || "—";

  const warn = document.getElementById("confirmShortNoticeWarn");
  warn?.classList.toggle(
    "d-none",
    !isShortNotice({
      scheduledFor: jobData.scheduledFor,
      requestedAt: Date.now(),
    }),
  );

  const old = document.getElementById("confirmSubmitFinalBtn");
  const fresh = old.cloneNode(true);
  old.parentNode.replaceChild(fresh, old);
  fresh.addEventListener("click", () => {
    addJob(jobData, notesText);
    $("#confirmSubmitModal").modal("hide");
    elements.jobNotes.value = "";
    elements.submitBtn.disabled = false;
    rerenderAll();
  });
  $("#confirmSubmitModal").modal("show");
}

/* ================= USABILITY — DELETION REASON MODAL ================= */
function openDeleteConfirmModal(id) {
  const job = jobs.get(id);
  if (!job) return;
  document.getElementById("deleteJobRef").textContent =
    job.reference || String(id);
  const old = document.getElementById("confirmDeleteFinalBtn");
  const fresh = old.cloneNode(true);
  old.parentNode.replaceChild(fresh, old);
  fresh.addEventListener("click", () => {
    const sel = document.getElementById("deleteReasonSelect").value;
    const other = document.getElementById("deleteReasonOther").value.trim();
    deleteJob(id, sel === "other" ? other || "Other" : sel);
    $("#deleteConfirmModal").modal("hide");
    rerenderAll();
  });
  $("#deleteConfirmModal").modal("show");
}

/* ================= AUDIT LOG VIEWER ================= */
function renderAuditLogModal() {
  const c = document.getElementById("auditLogContent");
  if (!c) return;
  const log = getAuditLog().slice().reverse().slice(0, 200);
  if (!log.length) {
    c.innerHTML =
      '<div class="text-muted small p-2">No audit entries yet.</div>';
    return;
  }
  c.innerHTML = `<table class="table table-sm table-striped small mb-0">
    <thead class="thead-light"><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
    <tbody>${log
      .map(
        (e) => `<tr>
      <td class="text-nowrap">${new Date(e.ts).toLocaleString()}</td>
      <td>${escapeHtml(e.actor || "—")}</td>
      <td><span class="badge ${e.action === "deleted" ? "badge-danger" : e.action === "created" ? "badge-success" : "badge-secondary"}">${escapeHtml(e.action)}</span></td>
      <td>${escapeHtml(e.ref || "")} ${e.from ? `${e.from}→${e.to}` : ""} ${e.reason ? `(${e.reason})` : ""} ${e.teacher ? `• ${e.teacher}` : ""}</td>
    </tr>`,
      )
      .join("")}</tbody></table>`;
}

/* ================= BOTTLENECK — SHARED HOURLY DEPTH BUILDER ================= */
function buildHourlyDepth(events, maxHours = 168) {
  events.sort((a, b) => a.ts - b.ts);
  if (!events.length) return null;
  const mn = events[0].ts,
    hr = 3600000;
  const n = Math.min(
    maxHours,
    Math.ceil((events[events.length - 1].ts - mn) / hr) + 1,
  );
  let depth = 0,
    ei = 0;
  const labels = [],
    data = [];
  for (let i = 0; i < n; i++) {
    const end = mn + (i + 1) * hr;
    while (ei < events.length && events[ei].ts <= end) {
      depth += events[ei].delta;
      ei++;
    }
    depth = Math.max(0, depth);
    labels.push(
      new Date(mn + i * hr).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
      }),
    );
    data.push(depth);
  }
  return { labels, data };
}

function getCompletedInRange() {
  return getCompletedJobs().filter((j) => {
    if (!j.completedAt) return false;
    const d = new Date(j.completedAt);
    if (TrendDateRange.from && d < TrendDateRange.from) return false;
    if (TrendDateRange.to) {
      const e = new Date(TrendDateRange.to);
      e.setHours(23, 59, 59, 999);
      if (d > e) return false;
    }
    return true;
  });
}

function passesGradeFilter(job) {
  if (!AnalyticsFilters.grades.size) return true;
  return normalizeGrades(job.grades).some((g) =>
    AnalyticsFilters.grades.has(g),
  );
}

/* ================= BOTTLENECK — QUEUE DEPTH OVER TIME ================= */
function renderQueueDepthOverTime(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const all = [
    ...getActiveJobs().filter(passesGradeFilter),
    ...getCompletedInRange().filter(passesGradeFilter),
  ];
  if (!all.length) {
    container.innerHTML =
      '<div class="p-3 text-muted">No data available.</div>';
    return;
  }
  const evs = [];
  all.forEach((j) => {
    evs.push({ ts: j.requestedAt, delta: +1 });
    if (j.completedAt) evs.push({ ts: j.completedAt, delta: -1 });
  });
  const h = buildHourlyDepth(evs);
  if (!h) {
    container.innerHTML =
      '<div class="p-3 text-muted">Insufficient data.</div>';
    return;
  }
  window.analyticsChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: h.labels,
      datasets: [
        {
          label: "Queue Depth",
          data: h.data,
          borderColor: "#007bff",
          backgroundColor: "rgba(0,123,255,.1)",
          fill: true,
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "Queue Depth Over Time (hourly)" },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 } },
      },
    },
  });
}

/* ================= BOTTLENECK — AVG WAIT BY SUBMISSION HOUR ================= */
function renderAvgWaitByHour(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const b = Array.from({ length: 24 }, () => ({ s: 0, n: 0 }));
  getCompletedJobs()
    .filter(passesGradeFilter)
    .forEach((j) => {
      if (!j.startedAt || !j.requestedAt) return;
      const h = new Date(j.requestedAt).getHours();
      b[h].s += (j.startedAt - j.requestedAt) / 60000;
      b[h].n++;
    });
  const avgs = b.map((x) => (x.n ? Math.round(x.s / x.n) : 0));
  const mx = Math.max(...avgs);
  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
      datasets: [
        {
          label: "Avg Wait (min)",
          data: avgs,
          backgroundColor: avgs.map((v) =>
            v === mx && v > 0 ? "#dc3545" : "#007bff",
          ),
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Avg Wait Before Start by Submission Hour",
        },
      },
      scales: { y: { beginAtZero: true } },
    },
  });
}

/* ================= BOTTLENECK — GRADE × DAY SUBMISSION HEATMAP ================= */
function renderGradeDaySubmissionHeatmap(container) {
  container.innerHTML = "";
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const grades = getGradeList();
  const mx = {};
  grades.forEach((g) => {
    mx[g] = {};
    days.forEach((d) => {
      mx[g][d] = 0;
    });
  });
  getAllJobs()
    .filter(passesGradeFilter)
    .forEach((j) => {
      const di = new Date(j.requestedAt).getDay();
      if (di === 0 || di === 6) return;
      const dn = days[di - 1];
      normalizeGrades(j.grades).forEach((g) => {
        if (mx[g]) mx[g][dn] = (mx[g][dn] || 0) + 1;
      });
    });
  const maxV = Math.max(1, ...grades.flatMap((g) => days.map((d) => mx[g][d])));
  const col = (v) => `rgba(0,123,255,${((v / maxV) * 0.82 + 0.05).toFixed(2)})`;
  const div = document.createElement("div");
  div.innerHTML = `<p class="font-weight-bold mb-2">Grade × Day Submission Heatmap</p>
    <table class="table table-sm table-bordered text-center">
      <thead class="thead-light"><tr><th>Grade</th>${days.map((d) => `<th>${d}</th>`).join("")}</tr></thead>
      <tbody>${grades
        .map(
          (
            g,
          ) => `<tr><td class="font-weight-bold text-left">${escapeHtml(g)}</td>
        ${days
          .map((d) => {
            const v = mx[g][d];
            return `<td style="background:${col(v)};color:${v > maxV * 0.55 ? "#fff" : "#212529"}">${v || ""}</td>`;
          })
          .join("")}</tr>`,
        )
        .join("")}
      </tbody></table>
    <small class="text-muted">Darker = more submissions on that weekday.</small>`;
  container.appendChild(div);
}

/* ================= BOTTLENECK — WEEKLY LOAD VS CAPACITY ================= */
function renderCapacityVsSubmittedWeekly(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const capSec = (AppState.settings.maxConcurrentJobs || 1) * 6 * 3600;
  const b = {};
  function _wk(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}\u2011W${String(Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, "0")}`;
  }
  getCompletedInRange()
    .filter(passesGradeFilter)
    .forEach((j) => {
      const wk = _wk(j.requestedAt);
      b[wk] = (b[wk] || 0) + (j.estimate || 0);
    });
  const weeks = Object.keys(b).sort();
  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: weeks,
      datasets: [
        {
          label: "Submitted Load (s)",
          data: weeks.map((w) => b[w]),
          backgroundColor: "#007bff",
        },
        {
          label: "Daily Capacity (s)",
          data: weeks.map(() => capSec),
          type: "line",
          borderColor: "#dc3545",
          fill: false,
          borderDash: [6, 3],
          pointRadius: 0,
          borderWidth: 2,
          backgroundColor: "transparent",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "Weekly Submitted Load vs Capacity" },
      },
      scales: { y: { beginAtZero: true } },
    },
  });
}

/* ================= BOTTLENECK — CONCURRENT IN-PROCESS OVER TIME ================= */
function renderConcurrentInProcess(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const log = getAuditLog().filter(
    (e) =>
      e.action === "status_change" &&
      (e.to === "In process" || e.from === "In process"),
  );
  if (!log.length) {
    container.innerHTML =
      '<div class="p-3 text-muted">No start/stop audit data yet. Populates as jobs are processed through the queue.</div>';
    return;
  }
  const evs = log.map((e) => ({
    ts: e.ts,
    delta: e.to === "In process" ? 1 : -1,
  }));
  const h = buildHourlyDepth(evs);
  if (!h) {
    container.innerHTML =
      '<div class="p-3 text-muted">Insufficient data.</div>';
    return;
  }
  const max = AppState.settings.maxConcurrentJobs || 2;
  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: h.labels,
      datasets: [
        {
          label: "Concurrent In-Process",
          data: h.data,
          backgroundColor: h.data.map((v) =>
            v >= max ? "#dc3545" : "#28a745",
          ),
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "Concurrent In-Process Jobs Over Time" },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 } },
      },
    },
  });
}

/* ================= ESTIMATION ANALYTICS (P3) ================= */

function _noStartData(container) {
  container.innerHTML =
    '<div class="p-3 text-muted">Requires <code>startedAt</code> data — available once jobs are started and finished via the queue.</div>';
}

function renderEstimateAccuracyDist(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const js = getCompletedJobs().filter(
    (j) => j.startedAt && j.completedAt && j.estimate > 0,
  );
  if (!js.length) {
    _noStartData(container);
    return;
  }
  const bk = {
    "<0.5": 0,
    "0.5–0.8": 0,
    "0.8–1.0": 0,
    "1.0–1.2": 0,
    "1.2–1.5": 0,
    "1.5–2.0": 0,
    ">2.0": 0,
  };
  js.forEach((j) => {
    const r = (j.completedAt - j.startedAt) / 1000 / j.estimate;
    if (r < 0.5) bk["<0.5"]++;
    else if (r < 0.8) bk["0.5–0.8"]++;
    else if (r < 1.0) bk["0.8–1.0"]++;
    else if (r < 1.2) bk["1.0–1.2"]++;
    else if (r < 1.5) bk["1.2–1.5"]++;
    else if (r < 2.0) bk["1.5–2.0"]++;
    else bk[">2.0"]++;
  });
  const labels = Object.keys(bk),
    data = Object.values(bk);
  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "# Jobs",
          data,
          backgroundColor: labels.map((l) =>
            l === "0.8–1.0" || l === "1.0–1.2" ? "#28a745" : "#fd7e14",
          ),
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Estimate Accuracy  (Actual ÷ Estimate ratio)",
        },
      },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderEstimateErrorBySize(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const js = getCompletedJobs().filter(
    (j) => j.startedAt && j.completedAt && j.estimate > 0,
  );
  if (!js.length) {
    _noStartData(container);
    return;
  }
  const b = {};
  js.forEach((j) => {
    let e = j.pages;
    if (j.printType === "2-in-1") e = Math.ceil(e / 2);
    if (j.sides === "double") e = Math.ceil(e / 2);
    e *= j.copies;
    const bk =
      e <= 10
        ? "1–10"
        : e <= 30
          ? "11–30"
          : e <= 60
            ? "31–60"
            : e <= 120
              ? "61–120"
              : ">120";
    if (!b[bk]) b[bk] = { s: 0, n: 0 };
    b[bk].s += (j.completedAt - j.startedAt) / 1000 - j.estimate;
    b[bk].n++;
  });
  const ord = ["1–10", "11–30", "31–60", "61–120", ">120"],
    ls = ord.filter((k) => b[k]);
  const dt = ls.map((k) => Math.round(b[k].s / b[k].n));
  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ls,
      datasets: [
        {
          label: "Mean Error (s)",
          data: dt,
          backgroundColor: dt.map((v) => (v > 0 ? "#dc3545" : "#28a745")),
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "Estimate Error by Job Size (sheets)" },
      },
      scales: { y: { ticks: { callback: (v) => `${v}s` } } },
    },
  });
}

function renderEstimateErrorByTask(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const js = getCompletedJobs().filter(
    (j) => j.startedAt && j.completedAt && j.estimate > 0,
  );
  if (!js.length) {
    _noStartData(container);
    return;
  }
  const b = {
    none: { s: 0, n: 0 },
    stapling: { s: 0, n: 0 },
    trimming: { s: 0, n: 0 },
    "stapling,trimming": { s: 0, n: 0 },
  };
  js.forEach((j) => {
    const tk = j.additionalTask || "none";
    if (!b[tk]) b[tk] = { s: 0, n: 0 };
    b[tk].s += (j.completedAt - j.startedAt) / 1000 - j.estimate;
    b[tk].n++;
  });
  const ls = Object.keys(b).filter((k) => b[k].n);
  const dt = ls.map((k) => Math.round(b[k].s / b[k].n));
  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ls,
      datasets: [
        {
          label: "Mean Error (s)",
          data: dt,
          backgroundColor: dt.map((v) => (v > 0 ? "#dc3545" : "#28a745")),
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "Estimate Error by Finishing Task" },
      },
      scales: { y: { ticks: { callback: (v) => `${v}s` } } },
    },
  });
}

function renderLifecycleFunnel(container) {
  container.innerHTML = "";
  const cj = getCompletedJobs().filter((j) => j.requestedAt && j.completedAt);
  if (!cj.length) {
    container.innerHTML =
      '<div class="p-3 text-muted">No completed jobs.</div>';
    return;
  }
  const ws = cj.filter((j) => j.startedAt);
  const aw = ws.length
    ? ws.reduce((s, j) => s + (j.startedAt - j.requestedAt), 0) /
      ws.length /
      60000
    : null;
  const ap = ws.length
    ? ws.reduce((s, j) => s + (j.completedAt - j.startedAt), 0) /
      ws.length /
      60000
    : null;
  const at =
    cj.reduce((s, j) => s + (j.completedAt - j.requestedAt), 0) /
    cj.length /
    60000;
  const ontp = Math.round(
    (cj.filter((j) => !wasOverdue(j)).length / cj.length) * 100,
  );
  const stages = [
    {
      label: "⏳ Avg Wait  (Queued → Started)",
      val: aw,
      col: "#ffc107",
      note: "Time in Queued status",
    },
    {
      label: "🖨️ Avg Print  (Started → Done)",
      val: ap,
      col: "#007bff",
      note: "Time In Process",
    },
    {
      label: "📋 Avg Total Turnaround",
      val: at,
      col: "#6610f2",
      note: "Request → Completion",
    },
  ];
  const d = document.createElement("div");
  d.className = "p-3";
  d.innerHTML = `<h6 class="font-weight-bold mb-3">Job Lifecycle — Average Durations</h6>
    ${stages
      .map(
        (s) => `<div class="mb-3">
      <div class="d-flex justify-content-between small mb-1">
        <span>${s.label}</span>
        <strong>${s.val != null ? fmtMin(Math.round(s.val)) : "N/A"}</strong>
      </div>
      ${
        s.val != null
          ? `<div class="progress" style="height:18px;"><div class="progress-bar" style="width:100%;background:${s.col}">${fmtMin(Math.round(s.val))}</div></div>`
          : `<div class="alert alert-light py-1 small mb-0">Start tracking improves once jobs are processed through the queue.</div>`
      }
      <small class="text-muted">${s.note}</small>
    </div>`,
      )
      .join("")}
    <div class="alert alert-info mt-3 mb-0">
      <strong>${ontp}%</strong> of ${cj.length} completed jobs were on time.
      ${ws.length === 0 ? "<br><small>Note: start times not recorded for historical jobs.</small>" : ""}
    </div>`;
  container.appendChild(d);
}

function renderOnTimeTrendWithMA(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const b = {};
  getCompletedInRange().forEach((j) => {
    const wk = weekKey(j.completedAt);
    if (!b[wk]) b[wk] = { t: 0, o: 0 };
    b[wk].t++;
    if (!wasOverdue(j)) b[wk].o++;
  });
  const weeks = Object.keys(b).sort();
  if (!weeks.length) {
    container.innerHTML =
      '<div class="p-3 text-muted">No data in selected range.</div>';
    return;
  }
  const pcts = weeks.map((w) => Math.round((b[w].o / b[w].t) * 100));
  const ma = pcts.map((_, i) => {
    const sl = pcts.slice(Math.max(0, i - 3), i + 1);
    return Math.round(sl.reduce((s, v) => s + v, 0) / sl.length);
  });
  window.analyticsChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: weeks,
      datasets: [
        {
          label: "Weekly On‑Time %",
          data: pcts,
          borderColor: "#28a745",
          backgroundColor: "rgba(40,167,69,.12)",
          fill: true,
          tension: 0.1,
          pointRadius: 3,
        },
        {
          label: "4-Week Moving Avg",
          data: ma,
          borderColor: "#007bff",
          borderDash: [6, 3],
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "On‑Time % with 4-Week Moving Average" },
      },
      scales: { y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } } },
    },
  });
}

function renderDueDateSlipAnalysis(container) {
  const ctx = clearAndPrepareAnalyticsContainer(container);
  const late = getCompletedJobs().filter(wasOverdue);
  if (!late.length) {
    container.innerHTML =
      '<div class="p-3 alert alert-success">🎉 No late jobs to analyse.</div>';
    return;
  }
  const bk = {
    "0–15 min": 0,
    "15–30 min": 0,
    "30–60 min": 0,
    "1–2 hrs": 0,
    "2–4 hrs": 0,
    ">4 hrs": 0,
  };
  late.forEach((j) => {
    const m = (new Date(j.completedAt) - new Date(j.scheduledFor)) / 60000;
    if (m <= 15) bk["0–15 min"]++;
    else if (m <= 30) bk["15–30 min"]++;
    else if (m <= 60) bk["30–60 min"]++;
    else if (m <= 120) bk["1–2 hrs"]++;
    else if (m <= 240) bk["2–4 hrs"]++;
    else bk[">4 hrs"]++;
  });
  const ls = Object.keys(bk),
    dt = Object.values(bk);
  window.analyticsChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ls,
      datasets: [{ label: "Late Jobs", data: dt, backgroundColor: "#dc3545" }],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: `Due Date Slip Analysis (${late.length} late jobs)`,
        },
      },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderCalibrationPanel(container) {
  container.innerHTML = "";
  const js = getCompletedJobs().filter(
    (j) => j.startedAt && j.completedAt && j.estimate > 0,
  );
  const d = document.createElement("div");
  d.className = "p-3";
  if (!js.length) {
    d.innerHTML =
      '<div class="alert alert-info">Calibration requires jobs with recorded start times. Will populate after jobs are processed through the queue.</div>';
    container.appendChild(d);
    return;
  }
  const err = js.map((j) => (j.completedAt - j.startedAt) / 1000 - j.estimate);
  const mean = Math.round(err.reduce((s, v) => s + v, 0) / err.length);
  const srt = [...err].sort((a, b) => a - b);
  const mi = Math.floor(srt.length / 2);
  const med = Math.round(
    srt.length % 2 ? srt[mi] : (srt[mi - 1] + srt[mi]) / 2,
  );
  const w20 = Math.round(
    (js.filter((j) => {
      const r = (j.completedAt - j.startedAt) / 1000 / j.estimate;
      return r >= 0.8 && r <= 1.2;
    }).length /
      js.length) *
      100,
  );
  const totEff = js.reduce((s, j) => {
    let e = j.pages;
    if (j.printType === "2-in-1") e = Math.ceil(e / 2);
    if (j.sides === "double") e = Math.ceil(e / 2);
    return s + e * j.copies;
  }, 0);
  const totAct = js.reduce(
    (s, j) => s + (j.completedAt - j.startedAt) / 1000,
    0,
  );
  const totOh =
    js.length * (AppState.settings.loadTime + AppState.settings.checkTime);
  const sug =
    totEff > 0 ? Math.round(((totAct - totOh) / totEff) * 10) / 10 : null;
  const col = w20 >= 70 ? "success" : w20 >= 50 ? "warning" : "danger";
  d.innerHTML = `<h6 class="font-weight-bold mb-3">📐 Estimation Calibration Panel</h6>
    <p class="text-muted small">Based on ${js.length} jobs with recorded start times.</p>
    <div class="row mb-3">
      <div class="col-4 text-center">
        <div class="h4 font-weight-bold ${mean > 0 ? "text-danger" : mean < 0 ? "text-success" : "text-primary"}">
          ${mean > 0 ? "+" : ""}${fmtSec(Math.abs(mean))}</div>
        <div class="small text-muted">Mean Error</div>
      </div>
      <div class="col-4 text-center">
        <div class="h4 font-weight-bold ${med > 0 ? "text-danger" : med < 0 ? "text-success" : "text-primary"}">
          ${med > 0 ? "+" : ""}${fmtSec(Math.abs(med))}</div>
        <div class="small text-muted">Median Error</div>
      </div>
      <div class="col-4 text-center">
        <div class="h4 font-weight-bold text-${col}">${w20}%</div>
        <div class="small text-muted">Within ±20%</div>
      </div>
    </div>
    <div class="alert alert-${col} mb-3">
      ${
        w20 >= 70
          ? "✅ Estimates are well-calibrated."
          : w20 >= 50
            ? "⚠️ Moderate accuracy — consider adjusting time-per-page."
            : "❌ Low accuracy — recalibration recommended."
      }
    </div>
    ${
      sug != null
        ? `<div class="card card-body bg-light small">
      <strong>Suggested time-per-page:</strong> ${sug}s &nbsp;(current: ${AppState.settings.timePerPage}s)<br>
      <span class="text-muted">Adjust via ⚙️ Time &amp; Queue Calibration settings.</span>
    </div>`
        : ""
    }`;
  container.appendChild(d);
}

/* ================= OPEN HOURS MODAL (SUPER-ADMIN) ================= */
function renderOpenHoursModal() {
  const oh = getOpenHours();
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const labels = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
    Sat: "Saturday",
    Sun: "Sunday",
  };
  const tbody = days
    .map((key) => {
      const r = oh[key];
      return `<tr>
      <td class="font-weight-bold">${labels[key]}</td>
      <td class="text-center">
        <input type="checkbox" id="oh_en_${key}" ${r.enabled ? "checked" : ""}>
      </td>
      <td><input type="time" id="oh_open_${key}"  class="form-control form-control-sm" value="${r.open}"  ${r.enabled ? "" : "disabled"}></td>
      <td><input type="time" id="oh_close_${key}" class="form-control form-control-sm" value="${r.close}" ${r.enabled ? "" : "disabled"}></td>
    </tr>`;
    })
    .join("");

  document.getElementById("openHoursTableBody").innerHTML = tbody;

  // Toggle time inputs when checkbox changes
  days.forEach((key) => {
    document
      .getElementById(`oh_en_${key}`)
      .addEventListener("change", function () {
        document.getElementById(`oh_open_${key}`).disabled = !this.checked;
        document.getElementById(`oh_close_${key}`).disabled = !this.checked;
      });
  });
}

function saveOpenHours() {
  if (currentUser.role !== "super-admin") return;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const oh = {};
  days.forEach((key) => {
    const en = document.getElementById(`oh_en_${key}`).checked;
    const opn = document.getElementById(`oh_open_${key}`).value || "07:30";
    const cls = document.getElementById(`oh_close_${key}`).value || "16:00";
    oh[key] = { open: opn, close: cls, enabled: en };
  });
  AppState.settings.openHours = oh;
  AppState.save();
  $("#openHoursModal").modal("hide");
  rerenderAll();
}

function resetOpenHoursDefaults() {
  if (currentUser.role !== "super-admin") return;
  AppState.settings.openHours = JSON.parse(JSON.stringify(DEFAULT_OPEN_HOURS));
  AppState.save();
  renderOpenHoursModal(); // refresh inputs
  rerenderAll();
}

/* ═══════════════════════════════════════════════════════════════
   TEACHER JOB TRACKING VIEW
   ═══════════════════════════════════════════════════════════════ */

/* ── STATE ── */
let teacherViewMode = false;
let teacherNameFilter = "";
let teacherNameFilterTimeout = null;
let teacherDateFilter = "all";
let recentTeachers = [];
const collapsedSections = { queued: false, inProcess: false, completed: true };

/* ── CONSTANTS ── */
const TEACHER_DEBOUNCE_MS = 150;
const MAX_RECENT_TEACHERS = 5;
const TEACHER_RECENT_KEY = "printqueue_recent_teachers";

/* ── DOM HELPERS ── */
const tvEl = (id) => document.getElementById(id);

/* ═══════════════════════════════════════════════════════════════
   RECENT TEACHERS
   ═══════════════════════════════════════════════════════════════ */
function loadRecentTeachers() {
  try {
    recentTeachers = JSON.parse(
      localStorage.getItem(TEACHER_RECENT_KEY) || "[]",
    );
  } catch {
    recentTeachers = [];
  }
}

function saveRecentTeacher(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  recentTeachers = recentTeachers.filter(
    (t) => t.toLowerCase() !== trimmed.toLowerCase(),
  );
  recentTeachers.unshift(trimmed);
  recentTeachers = recentTeachers.slice(0, MAX_RECENT_TEACHERS);
  try {
    localStorage.setItem(TEACHER_RECENT_KEY, JSON.stringify(recentTeachers));
  } catch {}
}

function renderRecentTeachers() {
  const el = tvEl("recentTeachersContainer");
  if (!el) return;
  if (!recentTeachers.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    '<small class="text-muted mr-1">Recent:</small>' +
    recentTeachers
      .map(
        (t) =>
          `<button type="button" class="btn btn-xs btn-sm btn-outline-secondary mr-1 mb-1"
            data-action="pickRecentTeacher" data-teacher="${escapeHtml(t)}"
            style="font-size:.78rem;padding:1px 7px;">${escapeHtml(t)}</button>`,
      )
      .join("");
}

/* ═══════════════════════════════════════════════════════════════
   AUTOCOMPLETE
   ═══════════════════════════════════════════════════════════════ */
function getAllTeacherNames() {
  const set = new Set();
  getAllJobs().forEach((j) => {
    if (j.teacher) set.add(j.teacher);
  });
  return Array.from(set).sort();
}

function getSuggestions(input) {
  const q = input.trim().toLowerCase();
  if (!q || q.length < 2) return [...recentTeachers].slice(0, 5);
  const all = getAllTeacherNames();
  const prefix = all.filter((t) => t.toLowerCase().startsWith(q));
  if (prefix.length) return prefix.slice(0, 5);
  return all.filter((t) => t.toLowerCase().includes(q)).slice(0, 5);
}

function renderSuggestions(input) {
  const box = tvEl("teacherSuggestionsBox");
  if (!box) return;
  const suggestions = getSuggestions(input);
  if (!suggestions.length) {
    box.innerHTML = "";
    box.classList.add("hidden");
    return;
  }
  box.innerHTML = suggestions
    .map(
      (t) =>
        `<button type="button"
          class="dropdown-item teacher-suggestion"
          data-action="pickSuggestion"
          data-teacher="${escapeHtml(t)}"
          style="text-align:left;width:100%;background:none;border:none;padding:6px 12px;cursor:pointer;"
        >${escapeHtml(t)}</button>`,
    )
    .join("");
  box.classList.remove("hidden");
}

function hideSuggestions() {
  const box = tvEl("teacherSuggestionsBox");
  if (box) {
    box.innerHTML = "";
    box.classList.add("hidden");
  }
}

/* ═══════════════════════════════════════════════════════════════
   FILTER & DATA
   ═══════════════════════════════════════════════════════════════ */
function getTeacherJobs(name) {
  const q = name.trim().toLowerCase();
  if (!q) return { queued: [], inProcess: [], completed: [] };

  const matched = getAllJobs().filter(
    (j) => (j.teacher || "").toLowerCase() === q,
  );

  const applyDateFilter = (arr) => {
    if (teacherDateFilter === "all") return arr;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return arr.filter((j) => {
      const ts =
        j.completedAt ||
        (j.scheduledFor ? new Date(j.scheduledFor).getTime() : null);
      if (!ts) return teacherDateFilter === "all";
      const d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      if (teacherDateFilter === "today") return d.getTime() === now.getTime();
      if (teacherDateFilter === "week") {
        const end = new Date(now);
        end.setDate(now.getDate() + 7);
        return d >= now && d <= end;
      }
      if (teacherDateFilter === "month") {
        return (
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      }
      return true;
    });
  };

  return {
    queued: applyDateFilter(
      matched
        .filter((j) => j.status === "Queued")
        .sort((a, b) => b.requestedAt - a.requestedAt),
    ),
    inProcess: applyDateFilter(
      matched
        .filter((j) => j.status === "In process")
        .sort((a, b) => b.requestedAt - a.requestedAt),
    ),
    completed: applyDateFilter(
      matched
        .filter((j) => j.status === "Completed")
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
    ),
  };
}

/* ─ Live match count (no debounce) ─ */
function updateMatchBadge(name) {
  const badge = tvEl("teacherMatchCount");
  if (!badge) return;
  const q = name.trim().toLowerCase();
  if (!q) {
    badge.classList.add("hidden");
    return;
  }
  const n = getAllJobs().filter(
    (j) => (j.teacher || "").toLowerCase() === q,
  ).length;
  if (n > 0) {
    badge.textContent = `${n} job${n !== 1 ? "s" : ""}`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

/* ═══════════════════════════════════════════════════════════════
   COPY TO CLIPBOARD (with BS4-safe fallback)
   ═══════════════════════════════════════════════════════════════ */
function copyText(text, btn) {
  const finish = () => {
    const orig = btn.textContent;
    btn.textContent = "✓";
    setTimeout(() => {
      btn.textContent = orig;
    }, 1800);
  };
  if (navigator.clipboard && location.protocol === "https:") {
    navigator.clipboard
      .writeText(text)
      .then(finish)
      .catch(() => fallbackCopy(text, btn, finish));
  } else {
    fallbackCopy(text, btn, finish);
  }
}

function fallbackCopy(text, btn, cb) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
    cb();
  } catch {}
  document.body.removeChild(ta);
}

/* ═══════════════════════════════════════════════════════════════
   CARD RENDERING (read-only)
   ═══════════════════════════════════════════════════════════════ */
function generateTeacherJobCardHtml(job, isCompleted) {
  const estTime = job.estimate || 0;

  /* grades */
  const grades = normalizeGrades(job.grades);
  const gradesBadges = grades.length
    ? grades
        .map(
          (g) =>
            `<span class="badge badge-light grade-badge">${escapeHtml(g)}</span>`,
        )
        .join("")
    : '<span class="badge badge-light grade-badge">Unassigned</span>';

  /* status badge */
  const statusClass = isCompleted
    ? "badge-success"
    : job.status === "In process"
      ? "badge-primary"
      : "badge-warning";

  /* indicator badges */
  const badges = [];
  if (job.urgent)
    badges.push('<span class="badge badge-danger ml-1">🔥 Urgent</span>');
  if (job.shortNotice && !isCompleted)
    badges.push('<span class="badge badge-warning ml-1">⏱ Short Notice</span>');
  if (isStalled(job))
    badges.push('<span class="badge badge-warning ml-1">⚠️ Stalled</span>');
  if (
    !isCompleted &&
    job.scheduledFor &&
    isOutsideOpenHours(new Date(job.scheduledFor).getTime())
  )
    badges.push(
      '<span class="badge badge-warning ml-1">🕐 Outside Hours</span>',
    );
  if (isCompleted && wasOverdue(job))
    badges.push('<span class="badge badge-danger ml-1">Late</span>');

  /* elapsed bar */
  let elapsedHtml = "";
  if (job.status === "In process" && job.startedAt) {
    const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
    const pct = Math.min(100, Math.round((elapsed / (estTime || 1)) * 100));
    const bc = pct >= 100 ? "#dc3545" : pct >= 75 ? "#ffc107" : "#28a745";
    elapsedHtml = `<div class="mt-1">
      <div class="d-flex justify-content-between" style="font-size:.78rem">
        <span>⏱ ${fmtSec(elapsed)} elapsed</span><span>${fmtSec(estTime)} est.</span>
      </div>
      <div class="progress" style="height:5px;">
        <div class="progress-bar" style="width:${pct}%;background:${bc};transition:width .5s;"></div>
      </div></div>`;
  }

  /* notes */
  const notesText = getJobNotes(job.reference);
  const notesInline = notesText
    ? `<div class="mt-2 small bg-light border rounded p-2"><strong>Notes:</strong><br>${escapeHtml(notesText).replace(/\n/g, "<br>")}</div>`
    : "";
  const notesBtnClass = jobHasNotes(job.reference)
    ? "btn-outline-primary"
    : "btn-outline-secondary";

  /* dates */
  const ref = escapeHtml(job.reference || String(job.id));
  const dueStr = job.scheduledFor
    ? new Date(job.scheduledFor).toLocaleString()
    : "ASAP";
  const completedLine =
    isCompleted && job.completedAt
      ? `Done: ${escapeHtml(new Date(job.completedAt).toLocaleString())}<br>`
      : "";

  return `
    <div class="card-body p-3">
      <div class="d-flex justify-content-between align-items-start mb-1">
        <div>
          <div class="small text-muted">
            Ref: <strong>${ref}</strong>
            <button type="button" class="btn btn-link btn-sm p-0 ml-1"
              data-action="copyRef" data-ref="${ref}"
              title="Copy reference" style="font-size:.8rem;vertical-align:baseline;">📋</button>
          </div>
          <div class="font-weight-bold">${escapeHtml(job.teacher)}</div>
          <div class="mt-1">${gradesBadges}</div>
        </div>
        <div class="text-right">
          <span class="badge ${statusClass}">${escapeHtml(isCompleted ? "Finished" : job.status)}</span>
          ${badges.join("")}
        </div>
      </div>
      <div class="small mb-1">
        Req: ${escapeHtml(new Date(job.requestedAt).toLocaleString())}<br>
        ${completedLine}
        Due: ${escapeHtml(dueStr)}<br>
        Est: <strong>${fmtSec(estTime)}</strong> &nbsp;|&nbsp;
        <strong>${escapeHtml(String(job.pages))}p × ${escapeHtml(String(job.copies))}c</strong> &nbsp;|&nbsp;
        ${escapeHtml(job.printType)}/${escapeHtml(job.sides)}/${escapeHtml(job.additionalTask)}
      </div>
      ${elapsedHtml}
      <div class="d-flex align-items-center mt-2">
        <button class="btn btn-sm ${notesBtnClass} ml-auto"
          data-action="downloadNotes" data-ref="${ref}">Notes</button>
      </div>
      ${notesInline}
    </div>`;
}

function renderTeacherSection(
  containerId,
  bodyId,
  jobs,
  sectionKey,
  isCompleted,
) {
  const container = tvEl(containerId);
  const body = tvEl(bodyId);
  if (!container || !body) return;

  /* Toggle body visibility */
  if (collapsedSections[sectionKey]) {
    body.classList.add("hidden");
    return;
  }
  body.classList.remove("hidden");

  if (!jobs.length) {
    const noName = !teacherNameFilter.trim();
    container.innerHTML =
      noName && sectionKey === "queued"
        ? '<p class="text-muted small mb-0">Enter your name above to see your jobs.</p>'
        : `<p class="text-muted small mb-0">No ${sectionKey} jobs found.</p>`;
    return;
  }

  container.innerHTML = "";
  const frag = document.createDocumentFragment();
  jobs.forEach((job) => {
    const card = document.createElement("div");
    card.className = "card mb-2 job";
    card.dataset.jobId = job.id;
    if (!isCompleted) {
      if (isStalled(job)) card.classList.add("job-stalled");
      else if (isOverdue(job)) card.classList.add("job-overdue");
      else if (isUrgent(job)) card.classList.add("job-urgent");
      if (job.urgent) card.classList.add("job-teacher-urgent");
    }
    card.innerHTML = generateTeacherJobCardHtml(job, isCompleted);
    frag.appendChild(card);
  });
  container.appendChild(frag);
}

/* ─ Update toggle button icons ─ */
function syncToggleIcons() {
  ["queued", "inProcess", "completed"].forEach((k) => {
    const btn = tvEl(`${k}ToggleBtn`);
    if (btn) btn.textContent = collapsedSections[k] ? "▶" : "▼";
  });
}

/* ─ Main render ─ */
function renderTeacherView() {
  const data = getTeacherJobs(teacherNameFilter);
  const total =
    data.queued.length + data.inProcess.length + data.completed.length;

  tvEl("queuedCount").textContent = String(data.queued.length);
  tvEl("inProcessCount").textContent = String(data.inProcess.length);
  tvEl("completedCount").textContent = String(data.completed.length);

  const toolbar = tvEl("teacherDownloadToolbar");
  if (toolbar)
    toolbar.classList.toggle(
      "hidden",
      !(total > 0 && teacherNameFilter.trim()),
    );

  renderTeacherSection(
    "queuedJobsContainer",
    "queuedSectionBody",
    data.queued,
    "queued",
    false,
  );
  renderTeacherSection(
    "inProcessJobsContainer",
    "inProcessSectionBody",
    data.inProcess,
    "inProcess",
    false,
  );
  renderTeacherSection(
    "completedJobsContainer",
    "completedSectionBody",
    data.completed,
    "completed",
    true,
  );
  syncToggleIcons();
}

/* ═══════════════════════════════════════════════════════════════
   DOWNLOADS
   ═══════════════════════════════════════════════════════════════ */
function triggerDownload(content, filename, mime) {
  try {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Download failed: " + err.message);
  }
}

function downloadTeacherCSV() {
  const { queued, inProcess, completed } = getTeacherJobs(teacherNameFilter);
  const all = [...queued, ...inProcess, ...completed];
  if (!all.length) {
    alert("No jobs to download.");
    return;
  }

  const headers = [
    "Reference",
    "Status",
    "Grades",
    "Requested",
    "Due",
    "Completed",
    "Pages",
    "Copies",
    "Type",
    "Sides",
    "Finishing",
    "Urgent",
    "Est(s)",
  ];
  const esc = (v) => {
    const s = String(v);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = all.map((j) =>
    [
      j.reference || j.id,
      j.status === "Completed" ? "Finished" : j.status,
      normalizeGrades(j.grades).join("; "),
      new Date(j.requestedAt).toLocaleString(),
      j.scheduledFor ? new Date(j.scheduledFor).toLocaleString() : "ASAP",
      j.completedAt ? new Date(j.completedAt).toLocaleString() : "",
      j.pages,
      j.copies,
      j.printType,
      j.sides,
      j.additionalTask,
      j.urgent ? "Yes" : "No",
      j.estimate || 0,
    ]
      .map(esc)
      .join(","),
  );

  const today = new Date().toISOString().slice(0, 10);
  triggerDownload(
    [headers.join(","), ...rows].join("\n"),
    `${teacherNameFilter.trim()}-jobs-${today}.csv`,
    "text/csv",
  );
}

function downloadTeacherNotes() {
  const { queued, inProcess, completed } = getTeacherJobs(teacherNameFilter);
  const all = [...queued, ...inProcess, ...completed];
  if (!all.length) {
    alert("No jobs to download.");
    return;
  }

  const cache = getNotesCached();
  const sections = all
    .filter((j) => cache[j.reference] && cache[j.reference].trim())
    .map(
      (j) =>
        `────────────────────────────────────\n` +
        `Ref: ${j.reference || j.id}  |  ${j.status === "Completed" ? "Finished" : j.status}\n` +
        `────────────────────────────────────\n` +
        `${cache[j.reference]}\n`,
    );

  const today = new Date().toISOString().slice(0, 10);
  triggerDownload(
    sections.length ? sections.join("\n") : "No notes found for your jobs.",
    `${teacherNameFilter.trim()}-notes-${today}.txt`,
    "text/plain",
  );
}

/* ═══════════════════════════════════════════════════════════════
   TOGGLE VIEW
   ═══════════════════════════════════════════════════════════════ */
function toggleTeacherView() {
  teacherViewMode = !teacherViewMode;
  const btn = tvEl("toggleViewBtn");
  const teacherPanel = tvEl("teacherViewPanel");
  const adminPanel = tvEl("adminViewPanel");
  const input = tvEl("teacherNameInput");

  if (teacherViewMode) {
    btn.textContent = "← Admin";
    btn.classList.replace("btn-outline-secondary", "btn-secondary");
    teacherPanel.classList.remove("hidden");
    adminPanel.classList.add("hidden");
    teacherNameFilter = "";
    if (teacherNameFilterTimeout) {
      clearTimeout(teacherNameFilterTimeout);
      teacherNameFilterTimeout = null;
    }
    input.value = "";
    renderRecentTeachers();
    renderTeacherView();
    input.focus();
  } else {
    btn.textContent = "👤 My Jobs";
    btn.classList.replace("btn-secondary", "btn-outline-secondary");
    teacherPanel.classList.add("hidden");
    adminPanel.classList.remove("hidden");
    teacherNameFilter = "";
    if (teacherNameFilterTimeout) {
      clearTimeout(teacherNameFilterTimeout);
      teacherNameFilterTimeout = null;
    }
    input.value = "";
    hideSuggestions();
    rerenderAll();
  }
}

/* ═══════════════════════════════════════════════════════════════
   EVENT WIRING
   ═══════════════════════════════════════════════════════════════ */
async function saveMsalSettingsToServerFile() {
  const settings = readMsalSettingsFromStorage();
  const res = await fetch("./save-msal-config.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Server save failed (${res.status})`);
  return true;
}

document
  .getElementById("msalSaveServerBtn")
  ?.addEventListener("click", async () => {
    try {
      await saveMsalSettingsToServerFile();
      setMsalSettingsStatus("Saved to server msal-config.json");
    } catch (err) {
      console.error(err);
      setMsalSettingsStatus("Server save failed: " + (err.message || err));
    }
  });

function initTeacherView() {
  loadRecentTeachers();

  const toggleBtn = tvEl("toggleViewBtn");
  const input = tvEl("teacherNameInput");
  if (!toggleBtn || !input) {
    console.warn("[TeacherView] DOM elements missing");
    return;
  }

  /* Toggle button */
  toggleBtn.addEventListener("click", toggleTeacherView);

  /* Name input — live badge + debounced render */
  input.addEventListener("input", (e) => {
    const val = e.target.value;
    updateMatchBadge(val);
    renderSuggestions(val);
    if (teacherNameFilterTimeout) clearTimeout(teacherNameFilterTimeout);
    teacherNameFilterTimeout = setTimeout(() => {
      teacherNameFilter = val;
      if (teacherNameFilter.trim()) saveRecentTeacher(teacherNameFilter);
      renderTeacherView();
      teacherNameFilterTimeout = null;
    }, TEACHER_DEBOUNCE_MS);
  });

  /* Enter = immediate, Escape = close suggestions */
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (teacherNameFilterTimeout) {
        clearTimeout(teacherNameFilterTimeout);
        teacherNameFilterTimeout = null;
      }
      teacherNameFilter = input.value;
      if (teacherNameFilter.trim()) saveRecentTeacher(teacherNameFilter);
      hideSuggestions();
      renderTeacherView();
    }
    if (e.key === "Escape") hideSuggestions();
  });

  /* Download buttons */
  tvEl("downloadTeacherJobsCSV")?.addEventListener("click", downloadTeacherCSV);
  tvEl("downloadTeacherNotesFile")?.addEventListener(
    "click",
    downloadTeacherNotes,
  );

  /* Date filter button group */
  tvEl("teacherDateFilterGroup")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-teacher-date-filter]");
    if (!btn) return;
    teacherDateFilter = btn.dataset.teacherDateFilter;
    tvEl("teacherDateFilterGroup")
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderTeacherView();
  });

  /* Delegated clicks — whole doc, teacher-mode gated */
  document.addEventListener("click", (e) => {
    if (!teacherViewMode) return;

    /* Suggestions */
    if (e.target.dataset.action === "pickSuggestion") {
      const t = e.target.dataset.teacher;
      input.value = t;
      teacherNameFilter = t;
      saveRecentTeacher(t);
      hideSuggestions();
      updateMatchBadge(t);
      renderTeacherView();
      return;
    }

    /* Recent teacher chips */
    if (e.target.dataset.action === "pickRecentTeacher") {
      const t = e.target.dataset.teacher;
      input.value = t;
      teacherNameFilter = t;
      updateMatchBadge(t);
      renderTeacherView();
      return;
    }

    /* Section header collapse toggle */
    const toggleTarget = e.target.closest("[data-action='toggleSection']");
    if (toggleTarget) {
      const sec = toggleTarget.dataset.section;
      if (sec) {
        collapsedSections[sec] = !collapsedSections[sec];
        renderTeacherView();
      }
      return;
    }

    /* Copy reference */
    if (e.target.dataset.action === "copyRef") {
      copyText(e.target.dataset.ref, e.target);
      return;
    }

    /* Notes download (reuse existing handler) */
    if (e.target.dataset.action === "downloadNotes") {
      const ref = e.target.dataset.ref;
      if (ref && window.downloadNotes) window.downloadNotes(ref);
      return;
    }
  });

  /* Close suggestions when clicking outside */
  document.addEventListener("click", (e) => {
    if (
      !e.target.closest("#teacherNameInput") &&
      !e.target.closest("#teacherSuggestionsBox")
    ) {
      hideSuggestions();
    }
  });
}

/* ── END TEACHER VIEW ── */

/* ═══════════════════════════════════════════════════════════════
   API SYNC LAYER
   ───────────────────────────────────────────────────────────────
   Strategy:
   • localStorage is ALWAYS written first (instant, offline-safe).
   • Every write is mirrored to the PHP API (fire-and-forget).
   • On startup, API is checked first; if reachable its data wins
     and is written back to localStorage so offline still works.
   • All existing code continues unchanged — nothing below here
     needs to know about the API.
   ═══════════════════════════════════════════════════════════════ */
const ApiSync = (() => {

  const BASE    = './api/';
  const POLL_MS = 8000;
  let _online   = false;
  let _pollTimer = null;

  /* ── Status pill ── */
  function setApiPill(state) {
    const pill = document.getElementById('syncStatusPill');
    if (!pill) return;
    const cfg = {
      live:    { cls: 'badge-success',   label: '● Live'        },
      syncing: { cls: 'badge-warning',   label: '↻ Syncing…'   },
      offline: { cls: 'badge-secondary', label: '○ Local only'  },
      error:   { cls: 'badge-danger',    label: '⚠ Sync error'  },
    };
    const { cls, label } = cfg[state] || cfg.offline;
    pill.className = `badge ${cls} ml-2`;
    pill.style.fontSize = '.7rem';
    pill.textContent = label;
  }

  /* ── Fetch helpers ── */
  async function apiGet(resource) {
    const r = await fetch(`${BASE}?resource=${resource}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!r.ok) throw new Error(`GET ${resource} ${r.status}`);
    return (await r.json()).data;
  }

  async function apiPost(resource, body) {
    const r = await fetch(`${BASE}?resource=${resource}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${resource} ${r.status}`);
    return r.json();
  }

  /* ── Resource map: storageKey → api resource name ── */
  const RESOURCE_MAP = {
    [STORAGE_KEYS.SETTINGS]:       'settings',
    [STORAGE_KEYS.NOTES]:          'notes',
    [STORAGE_KEYS.TEACHERS]:       'teachers',
    [STORAGE_KEYS.TEACHER_EMAILS]: 'teacher_emails',
    [STORAGE_KEYS.GRADE_LIST]:     'grade_list',
    [STORAGE_KEYS.AUDIT_LOG]:      'audit_log',
    [STORAGE_KEYS.DELETION_LOG]:   'deletion_log',
  };

  /* ── Push jobs (special: includes idcounter) ── */
  async function pushJobs() {
    await apiPost('jobs', { jobs: getAllJobs(), idcounter: idCounter });
  }

  /* ── Push any other resource ── */
  async function pushResource(storageKey, rawValue) {
    const resource = RESOURCE_MAP[storageKey];
    if (!resource) return;
    if (resource === 'audit_log' || resource === 'deletion_log') {
      const arr = safeJsonParse(rawValue, []);
      if (!Array.isArray(arr) || !arr.length) return;
      await apiPost(resource, { entry: arr[arr.length - 1] });
    } else {
      await apiPost(resource, { data: safeJsonParse(rawValue, null) });
    }
  }

  /* ── Pull all shared data from API into localStorage ── */
  async function pullAll() {
    const pulls = [
      { lsKey: STORAGE_KEYS.JOBS,           api: 'jobs',           isJobs: true  },
      { lsKey: STORAGE_KEYS.SETTINGS,       api: 'settings',       isJobs: false },
      { lsKey: STORAGE_KEYS.NOTES,          api: 'notes',          isJobs: false },
      { lsKey: STORAGE_KEYS.TEACHERS,       api: 'teachers',       isJobs: false },
      { lsKey: STORAGE_KEYS.TEACHER_EMAILS, api: 'teacher_emails', isJobs: false },
      { lsKey: STORAGE_KEYS.GRADE_LIST,     api: 'grade_list',     isJobs: false },
    ];
    for (const { lsKey, api, isJobs } of pulls) {
      try {
        const data = await apiGet(api);
        if (data === null || data === undefined) continue;
        if (isJobs) {
          const jobsArr = Array.isArray(data) ? data : (data.jobs || []);
          const counter = typeof data === 'object' && !Array.isArray(data)
            ? (data.idcounter ?? null) : null;
          localStorage.setItem(lsKey, JSON.stringify(jobsArr));
          if (counter !== null) {
            localStorage.setItem(STORAGE_KEYS.ID_COUNTER, String(counter));
          }
        } else {
          localStorage.setItem(lsKey, JSON.stringify(data));
        }
      } catch (e) {
        console.warn(`[ApiSync] pull failed (${api}):`, e.message);
      }
    }
  }

  /* ── Startup: ping → pull → signal ready ── */
  async function startup() {
    setApiPill('syncing');
    try {
      const r = await fetch(`${BASE}?resource=ping`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!r.ok) throw new Error('ping failed');
      _online = true;
      console.log('[ApiSync] API reachable — pulling server data');
      await pullAll();
      setApiPill('live');
    } catch (e) {
      _online = false;
      console.warn('[ApiSync] API not reachable — localStorage only:', e.message);
      setApiPill('offline');
    }
  }

  /* ── Background poll every POLL_MS ── */
  function startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(async () => {
      if (!_online) return;
      try {
        const data      = await apiGet('jobs');
        if (!data) return;
        const jobsArr   = Array.isArray(data) ? data : (data.jobs || []);
        const serverJson = JSON.stringify(jobsArr);
        const localJson  = localStorage.getItem(STORAGE_KEYS.JOBS) || '[]';
        if (serverJson !== localJson) {
          // Write to localStorage so offline-tab storage event fires too
          localStorage.setItem(STORAGE_KEYS.JOBS, serverJson);
          if (typeof data === 'object' && !Array.isArray(data) && data.idcounter) {
            localStorage.setItem(STORAGE_KEYS.ID_COUNTER, String(data.idcounter));
          }
          // Rebuild in-memory map
          jobs.clear();
          safeJsonParse(serverJson, []).forEach((j) => {
            const nj = normalizeJob(j);
            jobs.set(nj.id, nj);
          });
          idCounter = Math.max(idCounter, ...Array.from(jobs.keys()), 0);
          // Re-render active view
          if (typeof teacherViewMode !== 'undefined' && teacherViewMode) {
            renderTeacherView();
          } else {
            rerenderAll();
          }
          console.log('[ApiSync] Poll: jobs refreshed from server');
        }
      } catch (e) {
        console.warn('[ApiSync] Poll failed:', e.message);
        _online = false;
        setApiPill('offline');
      }
    }, POLL_MS);
  }

  /* ── Patch AppState.save() ── */
  function patchAppStateSave() {
    const _orig = AppState.save.bind(AppState);
    AppState.save = function () {
      _orig();                    // localStorage first
      if (_online) {
        setApiPill('syncing');
        pushJobs()
          .then(() => setApiPill('live'))
          .catch((e) => {
            console.warn('[ApiSync] pushJobs:', e.message);
            _online = false;
            setApiPill('error');
          });
      }
    };
  }

  /* ── Patch localStorage.setItem for non-jobs resources ── */
  function patchLocalStorage() {
    const _origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      _origSet(key, value);                        // always local first
      if (_online && key in RESOURCE_MAP) {
        pushResource(key, value).catch((e) => {
          console.warn(`[ApiSync] mirror (${key}):`, e.message);
        });
      }
    };
  }

  /* ── Public init ── */
  async function init() {
    patchAppStateSave();
    patchLocalStorage();
    await startup();
    startPolling();
  }

  return { init, isOnline: () => _online };
})();

/* ── Boot: API pull → AppState.load (reads localStorage) → render ──
   ApiSync.init() fills localStorage from server BEFORE AppState.load()
   reads it, so in-memory state is always current.                     */
ApiSync.init().then(() => {
  AppState.load();
}).catch(() => {
  AppState.load();
});

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

// V3 usability settings wiring
[
  ["minLeadTimeHours", "setting_minLeadTimeHours", false],
  ["maxConcurrentJobs", "setting_maxConcurrentJobs", false],
  ["stallMultiplier", "setting_stallMultiplier", false],
  ["dailyPageCap", "setting_dailyPageCap", false],
  ["requireAuthoriser", "setting_requireAuthoriser", true],
].forEach(([key, id, isCheckbox]) => {
  const inp = document.getElementById(id);
  if (!inp) return;
  if (isCheckbox) {
    inp.checked = !!AppState.settings[key];
    inp.addEventListener("change", () => {
      AppState.settings[key] = inp.checked;
      AppState.save();
      if (elements.authRequired)
        elements.authRequired.classList.toggle(
          "hidden",
          !AppState.settings.requireAuthoriser,
        );
    });
  } else {
    inp.value = AppState.settings[key];
    inp.addEventListener("input", () => {
      AppState.settings[key] = parseFloat(inp.value) || 0;
      AppState.save();
    });
  }
});
// Set initial authRequired visibility
if (elements.authRequired)
  elements.authRequired.classList.toggle(
    "hidden",
    !AppState.settings.requireAuthoriser,
  );

// Priority help
const priorityHelpText = {
  fifo: "Jobs are processed in the order they were submitted (fair and predictable).",
  due: "Jobs with the earliest required-by date are prioritised.",
  overdue: "Overdue jobs are prioritised to prevent missed deadlines.",
  estimate: "Jobs with the shortest estimated print time are processed first.",
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

// Microsoft Auth
initMsal();
setMicrosoftAuthUiState();
document
  .getElementById("msSignInBtn")
  ?.addEventListener("click", microsoftSignInPopup);

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
  const selected = getSelectedGradesFromChecklist(elements.adminGradeChecklist);
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
  const confirmed = confirm(
    "This will permanently delete ALL jobs, completed history, notes, and admin grade assignments.\n\nContinue?",
  );
  if (!confirmed) return;
  jobs.clear();
  idCounter = 0;
  localStorage.removeItem(STORAGE_KEYS.JOBS);
  localStorage.removeItem(STORAGE_KEYS.ID_COUNTER);
  localStorage.removeItem(STORAGE_KEYS.NOTES);
  localStorage.removeItem(STORAGE_KEYS.ADMIN_GRADE_MAP);
  invalidateNotesCache();
  completedJobsLimit = 10;
  bulkSelected.clear();
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

// Bulk toolbar handlers
document
  .getElementById("bulkStartBtn")
  ?.addEventListener("click", () => applyBulkAction("start"));
document
  .getElementById("bulkFinishBtn")
  ?.addEventListener("click", () => applyBulkAction("finish"));
document.getElementById("bulkClearBtn")?.addEventListener("click", () => {
  bulkSelected.clear();
  rerenderAll();
});

document
  .getElementById("saveCompletedJobEdits")
  .addEventListener("click", () => {
    if (!jobBeingEdited) return;

    jobBeingEdited.pages = parseInt(editPages.value, 10) || 1;
    jobBeingEdited.copies = parseInt(editCopies.value, 10) || 1;
    jobBeingEdited.sides = editSides.value;
    jobBeingEdited.printType = editPrintType.value;
    jobBeingEdited.additionalTask = editAdditionalTask.value;

    jobBeingEdited.grades = getSelectedGradesFromChecklist(
      document.getElementById("editGradeChecklist"),
    );

    // ✅ Recompute estimates
    jobBeingEdited.estimate = calculateJobEstimate(jobBeingEdited);

    // ✅ Save notes
    saveJobNotes(
      jobBeingEdited.reference,
      document.getElementById("editJobNotes").value,
    );

    AppState.save();
    rerenderAll();

    jobBeingEdited = null;
    $("#editCompletedJobModal").modal("hide");
  });

// Estimate updates
[
  elements.pages,
  elements.copies,
  elements.printType,
  elements.sides,
  elements.additionalTask,
].forEach((el) => el.addEventListener("input", updateEstimate));
updateEstimate();

// Submit job — v3: validation then confirmation modal
elements.submitBtn.onclick = () => {
  elements.submitBtn.disabled = true;

  const teacher = elements.teacherSelect.value;
  if (!teacher) {
    alert("Please select a teacher.");
    elements.submitBtn.disabled = false;
    return;
  }

  if (
    AppState.settings.requireAuthoriser &&
    !elements.authTeacherSelect.value
  ) {
    alert("An authoriser is required for this submission.");
    elements.submitBtn.disabled = false;
    return;
  }

  const scheduledValue = elements.scheduledFor.value;
  if (scheduledValue && new Date(scheduledValue).getTime() < Date.now()) {
    alert("You cannot schedule a print job in the past.");
    elements.submitBtn.disabled = false;
    return;
  }

  // Open-hours warning (non-blocking)
  if (
    scheduledValue &&
    isOutsideOpenHours(new Date(scheduledValue).getTime())
  ) {
    const nextOpen = new Date(
      nextOpenMinute(new Date(scheduledValue).getTime()),
    ).toLocaleString();
    if (
      !confirm(
        `⚠️ The due time falls outside school open hours.\nNearest open time: ${nextOpen}\nSubmit anyway?`,
      )
    ) {
      elements.submitBtn.disabled = false;
      return;
    }
  }

  const selectedGrades = getSelectedGradesFromChecklist(
    elements.gradeChecklist,
  );
  if (!selectedGrades.length) {
    alert("Please select at least one grade label.");
    elements.submitBtn.disabled = false;
    return;
  }

  const pages = parseInt(elements.pages.value || "1", 10) || 1;
  const copies = parseInt(elements.copies.value || "1", 10) || 1;

  // Daily page cap check
  const cap = AppState.settings.dailyPageCap || 0;
  if (cap > 0) {
    const used = getTeacherDailyPages(teacher);
    if (used + pages * copies > cap) {
      if (
        !confirm(
          `⚠️ ${teacher} has used ${used} of ${cap} daily pages. This job would exceed the cap. Submit anyway?`,
        )
      ) {
        elements.submitBtn.disabled = false;
        return;
      }
    }
  }

  // Duplicate detection
  const dupes = findDuplicates(teacher, selectedGrades, scheduledValue);
  if (dupes.length > 0) {
    if (
      !confirm(
        `⚠️ A similar job already exists for ${teacher} (Ref: ${dupes[0].reference}). Submit as a new job anyway?`,
      )
    ) {
      elements.submitBtn.disabled = false;
      return;
    }
  }

  const jobData = {
    teacher,
    authoriser: elements.authTeacherSelect.value || "",
    pages,
    copies,
    printType: elements.printType.value,
    sides: elements.sides.value,
    additionalTask: elements.additionalTask.value,
    scheduledFor: scheduledValue || "",
    grades: selectedGrades,
    urgent: elements.urgentFlag ? elements.urgentFlag.checked : false,
  };

  openConfirmSubmitModal(jobData, elements.jobNotes.value || "");
  // submitBtn re-enabled inside confirmSubmitFinalBtn handler
};

document
  .getElementById("saveAssignedGradeBtn")
  .addEventListener("click", () => {
    if (!jobPendingGradeAssignment) return;

    const selectedGrades = getSelectedGradesFromChecklist(
      document.getElementById("assignGradeChecklist"),
    );

    if (!selectedGrades.length) {
      alert("Please select at least one grade.");
      return;
    }

    // ✅ Replace grades (remove "Unassigned")
    jobPendingGradeAssignment.grades = selectedGrades;

    AppState.save();
    rerenderAll();

    jobPendingGradeAssignment = null;
    $("#assignGradeModal").modal("hide");
  });

// Event delegation — active queue
elements.queue.addEventListener("click", (e) => {
  // Bulk checkbox
  const cbx = e.target.closest("input[data-action='bulkSelect']");
  if (cbx) {
    toggleBulkSelect(parseInt(cbx.dataset.id, 10));
    return;
  }

  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "downloadNotes") {
    const ref = btn.dataset.ref;
    if (ref) window.downloadNotes(ref);
    return;
  }
  if (action === "editCompletedJob") {
    const job = jobs.get(parseInt(btn.dataset.id, 10));
    if (job) openEditCompletedJobModal(job);
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
    openDeleteConfirmModal(id);
  } else if (action === "reQueue") {
    reQueueJob(id);
    rerenderAll();
  }
});

// Event delegation — completed list
elements.weeklySummary.addEventListener("click", (e) => {
  const jobCard = e.target.closest(".job");
  if (!jobCard) return;

  const job = jobs.get(parseInt(jobCard.dataset.jobId, 10));
  if (!job) return;

  if (
    job.status === "Completed" &&
    normalizeGrades(job.grades).includes("Unassigned")
  ) {
    openAssignGradeModal(job);
  }

  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const btnId = parseInt(btn.dataset.id || "0", 10);

  if (action === "downloadNotes") {
    window.downloadNotes(btn.dataset.ref);
    return;
  }

  if (action === "editCompletedJob") {
    const j = jobs.get(btnId);
    if (!j || currentUser.role !== "super-admin") return;
    openEditCompletedJobModal(j);
  } else if (action === "reQueue") {
    reQueueJob(btnId);
    rerenderAll();
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

document.getElementById("checkDuplicatesBtn")?.addEventListener("click", () => {
  const file = elements.completedFile.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = String(e.target.result).split(/\r?\n/).filter(Boolean);
    const existingRefs = buildReferenceIndex();

    const dupes = lines
      .map((l) => safeJsonParse(l, null))
      .filter((j) => j && existingRefs.has(j.reference))
      .map((j) => j.reference);

    const report = document.getElementById("duplicateReport");
    report.innerHTML = dupes.length
      ? `⚠️ Found ${dupes.length} duplicate reference(s)`
      : `✅ No duplicates found`;
  };

  reader.readAsText(file);
});

// Audit log modal
document.getElementById("openAuditLogBtn")?.addEventListener("click", () => {
  renderAuditLogModal();
  $("#auditLogModal").modal("show");
});

elements.completedFile.addEventListener("change", (e) => {
  const btn = document.getElementById("checkDuplicatesBtn");
  if (btn) btn.disabled = !e.target.files.length;
});

// Open hours modal (super-admin only)
document.getElementById("openHoursBtn")?.addEventListener("click", () => {
  if (currentUser.role !== "super-admin") return;
  renderOpenHoursModal();
  $("#openHoursModal").modal("show");
});
document
  .getElementById("saveOpenHoursBtn")
  ?.addEventListener("click", saveOpenHours);
document
  .getElementById("resetOpenHoursBtn")
  ?.addEventListener("click", resetOpenHoursDefaults);

setupGradeAnalyticsModal();
setupTrendDateFilter();
setupAnalyticsFilters();

// Infinite scroll
setupInfiniteScroll();

initTeacherView();

rerenderAll();

initMsal();
setMicrosoftAuthUiState();


/* =====================================================================================
   PATCH: Email template + delivery mode UI wiring (MailTo vs Graph/API)
   - Fixes missing handlers for #emailSendModeGroup and #emailTemplateBtn
   - Fixes duplicate/broken getCompletedEmailTemplate() returning {body} instead of {textBody, htmlBody}
   - Safe, idempotent event binding (won't attach handlers multiple times)
   ===================================================================================== */

// Ensure storage keys exist (STORAGE_KEYS is const but mutable)
try {
  if (typeof STORAGE_KEYS === 'object' && STORAGE_KEYS) {
    if (!STORAGE_KEYS.EMAIL_TEMPLATE) STORAGE_KEYS.EMAIL_TEMPLATE = 'printqueue_email_template';
    if (!STORAGE_KEYS.EMAIL_SEND_MODE) STORAGE_KEYS.EMAIL_SEND_MODE = 'printqueue_email_send_mode';
  }
} catch(e) {}

// Canonical defaults (keep consistent with UI)
function __defaultCompletedEmailTemplate() {
  return {
    subject: "Print job completed: {{reference}}",
    textBody:
`Hi {{teacher}},

Your print / photocopy job is now completed.

Ref: {{reference}}
Pages: {{pages}}   Copies: {{copies}}
Grades: {{grades}}
Due: {{due}}
Completed: {{completed}}

{{notesBlock}}Regards,
{{sender}}`,
    htmlBody:
`<p>Hi {{teacher}},</p>
<p>Your print / photocopy job is now <b>completed</b>.</p>
<ul>
  <li><b>Ref:</b> {{reference}}</li>
  <li><b>Pages:</b> {{pages}} &nbsp; <b>Copies:</b> {{copies}}</li>
  <li><b>Grades:</b> {{grades}}</li>
  <li><b>Due:</b> {{due}}</li>
  <li><b>Completed:</b> {{completed}}</li>
</ul>
{{notesBlockHtml}}
<p>Regards,<br>{{sender}}</p>`
  };
}

// Override broken versions (function declarations later in file win)
function getEmailSendMode() {
  try {
    const k = (STORAGE_KEYS && STORAGE_KEYS.EMAIL_SEND_MODE) ? STORAGE_KEYS.EMAIL_SEND_MODE : 'printqueue_email_send_mode';
    const m = localStorage.getItem(k);
    return (m === 'graph' || m === 'mailto') ? m : 'mailto';
  } catch(e) {
    return 'mailto';
  }
}

function setEmailSendMode(mode) {
  try {
    const k = (STORAGE_KEYS && STORAGE_KEYS.EMAIL_SEND_MODE) ? STORAGE_KEYS.EMAIL_SEND_MODE : 'printqueue_email_send_mode';
    localStorage.setItem(k, (mode === 'graph') ? 'graph' : 'mailto');
  } catch(e) {}
}

function getCompletedEmailTemplate() {
  const def = __defaultCompletedEmailTemplate();
  try {
    const k = (STORAGE_KEYS && STORAGE_KEYS.EMAIL_TEMPLATE) ? STORAGE_KEYS.EMAIL_TEMPLATE : 'printqueue_email_template';
    const stored = safeJsonParse(localStorage.getItem(k) || 'null', null);
    if (!stored || typeof stored !== 'object') return { ...def };
    return {
      subject: String(stored.subject || def.subject),
      textBody: String(stored.textBody || stored.body || def.textBody),
      htmlBody: String(stored.htmlBody || def.htmlBody)
    };
  } catch(e) {
    return { ...def };
  }
}

function setCompletedEmailTemplate(tpl) {
  try {
    const k = (STORAGE_KEYS && STORAGE_KEYS.EMAIL_TEMPLATE) ? STORAGE_KEYS.EMAIL_TEMPLATE : 'printqueue_email_template';
    const safe = {
      subject: String(tpl.subject || __defaultCompletedEmailTemplate().subject),
      textBody: String(tpl.textBody || __defaultCompletedEmailTemplate().textBody),
      htmlBody: String(tpl.htmlBody || __defaultCompletedEmailTemplate().htmlBody)
    };
    localStorage.setItem(k, JSON.stringify(safe));
  } catch(e) {}
}

// Helpers used by preview/UI (kept small)
function __emailModeHelpText(mode) {
  return mode === 'graph'
    ? 'Graph/API sends directly (requires Microsoft sign-in). HTML template will be used.'
    : 'MailTo opens the operator’s email client. Text template will be used.';
}

function renderEmailModeUi() {
  const mode = getEmailSendMode();
  const group = document.getElementById('emailSendModeGroup');
  const help = document.getElementById('emailSendModeHelp');
  if (!group) return;

  group.querySelectorAll('button[data-mode]').forEach(btn => {
    const active = btn.dataset.mode === mode;
    // reset classes conservatively
    btn.classList.toggle('btn-primary', active);
    btn.classList.toggle('btn-outline-primary', !active && btn.dataset.mode === 'graph');
    btn.classList.toggle('btn-outline-secondary', !active && btn.dataset.mode === 'mailto');
  });

  if (help) help.textContent = __emailModeHelpText(mode);
}

function __updateEmailTemplatePreview() {
  const subjEl = document.getElementById('completedEmailSubjectTpl');
  const textEl = document.getElementById('completedEmailBodyTextTpl');
  const htmlEl = document.getElementById('completedEmailBodyHtmlTpl');

  const prevSubj = document.getElementById('completedEmailPreviewSubject');
  const prevText = document.getElementById('completedEmailPreviewBodyText');
  const prevHtml = document.getElementById('completedEmailPreviewBodyHtml');

  if (!subjEl || !textEl || !htmlEl || !prevSubj || !prevText || !prevHtml) return;

  const job = (typeof getPreviewJobForEmailTemplate === 'function') ? getPreviewJobForEmailTemplate() : null;
  const sample = job || { teacher:'Example Teacher', reference:'2026-04-24-99', pages:2, copies:30, grades:['Unassigned'], scheduledFor:new Date().toISOString(), completedAt:Date.now() };
  const vars = (typeof buildTemplateVars === 'function') ? buildTemplateVars(sample) : {
    teacher: sample.teacher,
    reference: sample.reference,
    pages: String(sample.pages),
    copies: String(sample.copies),
    grades: (sample.grades || []).join(', '),
    due: sample.scheduledFor ? new Date(sample.scheduledFor).toLocaleString() : 'ASAP',
    completed: new Date(sample.completedAt || Date.now()).toLocaleString(),
    notesBlock: '',
    notesBlockHtml: '',
    sender: 'Print Room'
  };

  const render = (typeof renderTemplate === 'function') ? renderTemplate : (s,v) => String(s||'').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_,k) => (v[k] ?? ''));

  prevSubj.textContent = render(subjEl.value, vars);
  prevText.textContent = render(textEl.value, vars);
  const html = render(htmlEl.value, vars) || "<p style='color:#666'>No HTML preview content.</p>";

// Prefer srcdoc when supported
if ('srcdoc' in prevHtml) {
  prevHtml.removeAttribute('src');
  prevHtml.srcdoc = html;

  // Some browsers still fail to paint srcdoc inside hidden modals → force refresh:
  setTimeout(() => {
    // If still blank, fallback to data URL
    if (!prevHtml.contentDocument || !prevHtml.contentDocument.body || !prevHtml.contentDocument.body.innerHTML.trim()) {
      prevHtml.src = "data:text/html;charset=utf-8," + encodeURIComponent(html);
    }
  }, 50);
} else {
  // Fallback for older engines
  prevHtml.src = "data:text/html;charset=utf-8," + encodeURIComponent(html);
}
}

function __setEmailTemplateStatus(msg) {
  const s = document.getElementById('emailTemplateStatus');
  if (s) s.textContent = msg || '';
}

function wireEmailTemplateAndModeUi() {
  // Idempotency guards
  const group = document.getElementById('emailSendModeGroup');
  if (group && group.dataset.bound !== '1') {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      setEmailSendMode(btn.dataset.mode);
      renderEmailModeUi();
    });
    group.dataset.bound = '1';
  }

  // Render initial mode state
  renderEmailModeUi();

  const openBtn = document.getElementById('emailTemplateBtn');
  if (openBtn && openBtn.dataset.bound !== '1') {
    openBtn.addEventListener('click', () => {
      const tpl = getCompletedEmailTemplate();

      const subjEl = document.getElementById('completedEmailSubjectTpl');
      const textEl = document.getElementById('completedEmailBodyTextTpl');
      const htmlEl = document.getElementById('completedEmailBodyHtmlTpl');

      if (subjEl) subjEl.value = tpl.subject;
      if (textEl) textEl.value = tpl.textBody;
      if (htmlEl) htmlEl.value = tpl.htmlBody;

      __setEmailTemplateStatus('');
      __updateEmailTemplatePreview();

      if (window.$ && $('#emailTemplateModal').length) {
        $('#emailTemplateModal').modal('show');

        
// Ensure iframe renders after modal becomes visible (Bootstrap)
if (window.$ && $('#emailTemplateModal').length && !$('#emailTemplateModal').data('previewBound')) {
  $('#emailTemplateModal').on('shown.bs.modal', () => {
    __updateEmailTemplatePreview();
  });
  $('#emailTemplateModal').data('previewBound', true);
}

      } else {
        // Minimal fallback if Bootstrap JS isn't available
        const m = document.getElementById('emailTemplateModal');
        if (m) m.classList.add('show');
      }
    });
    openBtn.dataset.bound = '1';
  }

  const saveBtn = document.getElementById('saveEmailTemplateBtn');
  if (saveBtn && saveBtn.dataset.bound !== '1') {
    saveBtn.addEventListener('click', () => {
      const subject = (document.getElementById('completedEmailSubjectTpl')?.value || '').trim();
      const textBody = (document.getElementById('completedEmailBodyTextTpl')?.value || '').trim();
      const htmlBody = (document.getElementById('completedEmailBodyHtmlTpl')?.value || '').trim();

      if (!subject) return __setEmailTemplateStatus('Subject cannot be blank.');
      if (!textBody) return __setEmailTemplateStatus('Text body cannot be blank.');
      if (!htmlBody) return __setEmailTemplateStatus('HTML body cannot be blank.');

      setCompletedEmailTemplate({ subject, textBody, htmlBody });
      __setEmailTemplateStatus('Saved.');
      __updateEmailTemplatePreview();
    });
    saveBtn.dataset.bound = '1';
  }

  const resetBtn = document.getElementById('resetEmailTemplateBtn');
  if (resetBtn && resetBtn.dataset.bound !== '1') {
    resetBtn.addEventListener('click', () => {
      const def = __defaultCompletedEmailTemplate();
      setCompletedEmailTemplate(def);

      const subjEl = document.getElementById('completedEmailSubjectTpl');
      const textEl = document.getElementById('completedEmailBodyTextTpl');
      const htmlEl = document.getElementById('completedEmailBodyHtmlTpl');
      if (subjEl) subjEl.value = def.subject;
      if (textEl) textEl.value = def.textBody;
      if (htmlEl) htmlEl.value = def.htmlBody;

      __setEmailTemplateStatus('Reset to default.');
      __updateEmailTemplatePreview();
    });
    resetBtn.dataset.bound = '1';
  }

  // Live preview listeners
  ['completedEmailSubjectTpl','completedEmailBodyTextTpl','completedEmailBodyHtmlTpl'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.dataset.previewBound !== '1') {
      el.addEventListener('input', __updateEmailTemplatePreview);
      el.dataset.previewBound = '1';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Wire mode toggle + template editor once the DOM exists.
  wireEmailTemplateAndModeUi();
});
