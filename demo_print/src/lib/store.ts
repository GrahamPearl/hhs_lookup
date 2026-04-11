// Persistent localStorage-backed store for the print queue system

export interface PrintJob {
  id: number;
  teacher: string;
  pages: number;
  copies: number;
  printType: "normal" | "twoinone";
  sides: "single" | "double";
  scheduledFor: number | null;
  estimatedSeconds: number;
  status: "Queued" | "In process" | "Completed";
  requestedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  actualSeconds: number | null;
}

export interface AdminSettings {
  teachers: string[];
  priorityMode: "fifo" | "due" | "size";
  timePerPage: number;
  loadTime: number;
  checkTime: number;
}

const JOBS_KEY = "printqueue_jobs";
const SETTINGS_KEY = "printqueue_settings";
const ID_KEY = "printqueue_idcounter";

function getIdCounter(): number {
  return Number(localStorage.getItem(ID_KEY) || "0");
}

function setIdCounter(val: number) {
  localStorage.setItem(ID_KEY, String(val));
}

export function loadJobs(): PrintJob[] {
  try {
    const raw = localStorage.getItem(JOBS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveJobs(jobs: PrintJob[]) {
  localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
}

export function loadSettings(): AdminSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw
      ? JSON.parse(raw)
      : { teachers: [], priorityMode: "fifo", timePerPage: 5, loadTime: 60, checkTime: 120 };
  } catch {
    return { teachers: [], priorityMode: "fifo", timePerPage: 5, loadTime: 60, checkTime: 120 };
  }
}

export function saveSettings(settings: AdminSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function createJob(
  data: Omit<PrintJob, "id" | "status" | "requestedAt" | "startedAt" | "completedAt" | "actualSeconds"> & {
    status?: PrintJob["status"];
    requestedAt?: number;
    startedAt?: number | null;
    completedAt?: number | null;
    actualSeconds?: number | null;
  }
): PrintJob {
  const id = getIdCounter() + 1;
  setIdCounter(id);

  const job: PrintJob = {
    id,
    teacher: data.teacher,
    pages: data.pages,
    copies: data.copies,
    printType: data.printType,
    sides: data.sides,
    scheduledFor: data.scheduledFor,
    estimatedSeconds: data.estimatedSeconds,
    status: data.status || "Queued",
    requestedAt: data.requestedAt || Date.now(),
    startedAt: data.startedAt ?? null,
    completedAt: data.completedAt ?? null,
    actualSeconds: data.actualSeconds ?? null,
  };

  const jobs = loadJobs();
  jobs.push(job);
  saveJobs(jobs);
  return job;
}

export function updateJob(id: number, updates: Partial<PrintJob>) {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx !== -1) {
    jobs[idx] = { ...jobs[idx], ...updates };
    saveJobs(jobs);
  }
  return jobs;
}

export function clearAllJobs() {
  saveJobs([]);
  setIdCounter(0);
}

export function sortJobs(jobs: PrintJob[], mode: string): PrintJob[] {
  const arr = [...jobs];
  switch (mode) {
    case "due":
      arr.sort((a, b) => (a.scheduledFor || Infinity) - (b.scheduledFor || Infinity));
      break;
    case "size":
      arr.sort((a, b) => a.pages * a.copies - b.pages * b.copies);
      break;
    default:
      arr.sort((a, b) => a.requestedAt - b.requestedAt);
  }
  return arr;
}

export function isThisWeek(ts: number | null): boolean {
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

export function downloadFile(content: string, filename: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
