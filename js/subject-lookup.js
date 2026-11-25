const gradeFiles = {
  10: ["Subjects-Grade10.json"],
  11: ["Subjects-Grade11.json"],
  12: ["Subjects-Grade12.json"],
};
const BASE_PATHS = [".", "..", "./data", "../data", ""];

const SUBJECT_ALIASES = new Map(
  Object.entries({
    IT: "Information Technology",
    EGD: "Engineering Graphics and Design",
    MATH: "Mathematics",
    MATHS: "Mathematics",
    MATHEMATICS: "Mathematics",
    "MATH LIT": "Mathematical Literacy",
    "MATHEMATICAL LITERACY": "Mathematical Literacy",
    ENGHL: "English Home Language",
    "LIFE SCIENCE": "Life Sciences",
    "LIFE SCIENCES": "Life Sciences",
  }),
);

// ===== State =====
let lastResults = [];
let cachedRecords = []; // loaded set (per grade selection)

// ===== DOM =====
const $form = $("#searchForm");
const $field = $("#field");
const $grade = $("#gradeSelect");
const $subject = $("#subjectSelect");
const $line = $("#lineSelect");
const $query = $("#query");
const $result = $("#resultArea");
const $msg = $("#messageArea");
const $status = $("#status"); // optional badge
const $export = $("#exportBtn");

// ===== Utilities =====
function setMessage(html, cls = "alert-light border") {
  $msg.html(html ? `<div class="alert ${cls}">${html}</div>` : "");
}
function setStatus(text, tone = "secondary") {
  if ($status && $status.length)
    $status.attr("class", `badge bg-${tone}`).text(text);
}
function esc(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function stringifyCell(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}
// === Old working layout helpers (adapted) ===
function deriveColumns(rows) {
  const set = new Set();
  rows.forEach((s) => {
    if (s && typeof s === "object") Object.keys(s).forEach((k) => set.add(k));
  });
  const preferred = [
    "photo",
    "student_number",
    "studentId",
    "id",
    "studentNumber",
    "admissionNo",
    "firstName",
    "lastName",
    "name",
    "gender",
    "class",
    "group",
    "subject",
    "line",
    "teacher",
    "grade",
  ];
  const present = new Set(set);
  const cols = [];
  preferred.forEach((k) => {
    if (present.has(k)) {
      cols.push(k);
      present.delete(k);
    }
  });
  cols.push(...Array.from(present).sort((a, b) => a.localeCompare(b)));
  return cols.length ? cols : ["name"];
}


function renderCellValue(val, colName) {
   if (val == null) return '';
   // Flatten objects to string if needed (your stringifyCell does this too)
   const raw = (typeof val === 'object') ? (function tryJSON(x){ try { return JSON.stringify(x); } catch { return String(x); } })(val) : String(val);
   const s = raw.trim();
   // Basic check for .webp anywhere in the string
   if (s.toLowerCase().includes('.webp')) {
     // If the cell might contain multiple space/comma-separated URLs, pick the first
     const match = s.match(/[^,\s]+\.webp/gi);
     const src = match ? match[0] : s;
     // IMPORTANT: do not escape the HTML for the <img> itself; escape attributes you control
     const safeAlt = esc(colName || 'image');
     // Constrain size so the table stays neat; tweak to your UI
     return `<div class="card card-fixed shadow-sm result-card" data-index="${src}"> <img class="student-photo" src="${src}" alt="${safeAlt}" object-fit:contain;"> </div>`;
   }
   // Default text path (escaped)
   return esc(stringifyCell(val));
 }


function renderTable(rows) {
  if (!rows.length) {
    $result.html(
      '<div class="alert alert-light border">No students to display.</div>',
    );
    $export.prop("disabled", true);
    return;
  }
  const cols = deriveColumns(rows);
  const thead =
    "<thead><tr>" +
    cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("") +
    "</tr></thead>";
  
const tbody = '<tbody>' + rows.map(r =>
   '<tr>' + cols.map(c => `<td>${renderCellValue(r?.[c], c)}</td>`).join('') + '</tr>').join('') + '</tbody>';

  $result.html(
    '<div class="table-responsive">' +
      '<table class="table table-sm table-hover align-middle sticky-head">' +
      thead +
      tbody +
      "</table>" +
      "</div>",
  );
  $export.prop("disabled", false);
}

async function fetchJson(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`${url} (${resp.status})`);
  return resp.json();
}
async function fetchWithBasePaths(names) {
  const attempts = [];
  for (const base of BASE_PATHS)
    for (const name of names) attempts.push(base ? `${base}/${name}` : name);
  for (const url of attempts) {
    try {
      const data = await fetchJson(url);
      setStatus(`Loaded ${url}`, "info");
      return { url, data };
    } catch {
      /* try next */
    }
  }
  throw new Error("Tried: " + attempts.join(", "));
}
function toArray(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
}
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToRecords(data) {
  const out = [];
  if (!data) return out;
  if (Array.isArray(data)) {
    data.forEach((s) => out.push(mapFields(s)));
    return out;
  }
  if (Array.isArray(data.subjects)) {
    for (const entry of data.subjects) {
      const subj =
        entry?.name ||
        entry?.subject ||
        entry?.title ||
        entry?.code ||
        "Unknown Subject";
      const students = toArray(entry?.students)
        .concat(toArray(entry?.learners))
        .concat(toArray(entry?.pupils));
      for (const s of students) out.push(mapFields({ subject: subj, ...s }));
    }
    return out;
  }
  if (data && typeof data === "object") {
    for (const [key, val] of Object.entries(data)) {
      if (Array.isArray(val)) {
        for (const s of val) out.push(mapFields({ subject: key, ...s }));
      } else if (val && typeof val === "object") {
        const subj = val.name || val.subject || key;
        const students = toArray(val.students);
        for (const s of students) out.push(mapFields({ subject: subj, ...s }));
      }
    }
    return out;
  }
  return out;
}

function mapFields(s) {
  const student_photo = s.student_number ?? "";
  const student_number = s.student_number ?? s.studentNumber ?? s.studentId ?? s.id ?? s.admissionNo ?? s.ADMNR ?? "";
  const name = s.name ?? [s.firstName, s.lastName].filter(Boolean).join(" ") ?? "";
  const subject = s.subject ?? s.Subject ?? "";
  const line = String(s.line ?? s.Line ?? "").trim();
  const teacher = s.teacher ?? s.teacher_raw ?? s.teacherName ?? "";
  const gender = s.gender ?? s.Gender ?? "";
  const klass = s.class ?? s.Class ?? s.group ?? "";

  return {
    student_photo : '../photos/'+String(student_photo)+'.webp',
    student_number: String(student_number),
    name: String(name),
    subject: String(subject),
    line,
    teacher: String(teacher),
    gender: String(gender),
    class: String(klass),
  };
}

async function loadRecordsForGrades(grades) {
  const gs = grades && grades.length ? grades : ["10", "11", "12"];
  const all = [];
  for (const g of gs) {
    const files = gradeFiles[g];
    if (!files) continue;
    try {
      const { url, data } = await fetchWithBasePaths(files);
      const recs = normalizeToRecords(data).map((r) => ({ grade: g, ...r }));
      setStatus(`Grade ${g}: ${recs.length} records from ${url}`, "success");
      all.push(...recs);
    } catch {
      setStatus(`Grade ${g}: file not found`, "warning");
    }
  }
  return all;
}

function aliasSubject(q) {
  const key = q.toUpperCase();
  return SUBJECT_ALIASES.get(key) || q;
}
function parseSubjectLineQuery(q) {
  const m = q.match(/^(.*?)(?:\bline\b)?\s*(\d+)\s*$/i);
  if (!m) return null;
  const subj = m[1].trim();
  const line = m[2].trim();
  if (!subj || !line) return null;
  return { subject: subj, line };
}
function prefilterByDropdowns(records) {
  const g = $grade.val();
  const subj = $subject.val();
  const lineV = $line.val();
  return records.filter(
    (r) =>
      (!g || r.grade === g) &&
      (!subj || r.subject === subj) &&
      (!lineV || String(r.line) === String(lineV)),
  );
}
function search(records, field, query) {
  const pool = prefilterByDropdowns(records);
  const qRaw = (query || "").trim();
  if (!qRaw && field !== "subject_line") return pool;
  const q = norm(qRaw);
  const isNum = /^\d+$/.test(qRaw);
  const subjectLine = parseSubjectLineQuery(qRaw);
  const normEq = (a, b) => norm(a) === norm(b);
  const qSubjectOfficial = aliasSubject(qRaw);
  const by = {
    student_number: (r) => norm(String(r.student_number)).includes(q),
    name: (r) => norm(r.name).includes(q),
    subject: (r) =>
      normEq(r.subject, qSubjectOfficial) || norm(r.subject).includes(q),
    line: (r) => norm(String(r.line)).includes(q),
    teacher: (r) => norm(r.teacher).includes(q),
    subject_line: (r) =>
      subjectLine
        ? norm(r.subject).includes(norm(subjectLine.subject)) &&
          norm(String(r.line)) === norm(String(subjectLine.line))
        : false,
    auto: (r) =>
      (isNum && norm(String(r.student_number)).includes(q)) ||
      norm(r.name).includes(q) ||
      norm(r.subject).includes(q) ||
      norm(String(r.line)).includes(q) ||
      norm(r.teacher).includes(q) ||
      (subjectLine
        ? norm(r.subject).includes(norm(subjectLine.subject)) &&
          norm(String(r.line)) === norm(String(subjectLine.line))
        : false),
  };
  const fn = by[field] || by.auto;
  return pool.filter(fn);
}

function toCSV(rows) {
  if (!rows.length) return "";
  const cols = deriveColumns(rows);
  const escCSV = (s) => {
    const t = String(s ?? "");
    return /[",\n]/.test(t) ? '"' + t.replaceAll('"', '""') + '"' : t;
  };
  const header = cols.map(escCSV).join(",");
  const lines = rows.map((r) =>
    cols.map((c) => escCSV(stringifyCell(r?.[c]))).join(","),
  );
  return [header, ...lines].join("\n");
}
function download(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function refreshSubjectsAndLines() {
  const g = $grade.val();
  setStatus("Loading data…", "secondary");
  const records = await loadRecordsForGrades(g ? [g] : []);
  cachedRecords = records;
  // Subject list
  const subjects = Array.from(new Set(records.map((r) => r.subject))).sort(
    (a, b) => a.localeCompare(b),
  );
  $subject
    .prop("disabled", false)
    .empty()
    .append(`<option value="" selected>All subjects</option>`);
  subjects.forEach((s) =>
    $subject.append(`<option value="${esc(s)}">${esc(s)}</option>`),
  );
  // Line list (from current grade selection). Use raw numbers/strings from JSON, not "Line X".
  const lines = Array.from(
    new Set(records.map((r) => String(r.line).trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  $line
    .prop("disabled", false)
    .empty()
    .append(`<option value="" selected>All lines</option>`);
  lines.forEach((l) =>
    $line.append(`<option value="${esc(l)}">${esc(l)}</option>`),
  );
  setStatus(
    `Loaded ${records.length} records${g ? " for Grade " + g : " (all grades)"}.`,
    "success",
  );
}
function repopulateLinesForSubject() {
  const g = $grade.val();
  const subj = $subject.val();
  const pool = cachedRecords.filter(
    (r) => (!g || r.grade === g) && (!subj || r.subject === subj),
  );
  const lines = Array.from(
    new Set(pool.map((r) => String(r.line).trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const current = $line.val();
  $line.empty().append(`<option value="" selected>All lines</option>`);
  lines.forEach((l) =>
    $line.append(`<option value="${esc(l)}">${esc(l)}</option>`),
  );
  if (current && lines.includes(current)) $line.val(current);
}

// ===== Event wiring =====
$(async function init() {
  await refreshSubjectsAndLines();
});
$grade.on("change", async function () {
  await refreshSubjectsAndLines();
});
$subject.on("change", function () {
  repopulateLinesForSubject();
});

$form.on("submit", async function (e) {
  e.preventDefault();
  $form.addClass("was-validated");
  const field = $field.val() || "auto";
  const grade = $grade.val();
  const term = ($query.val() || "").trim();
  if (field === "subject_line" && !grade) {
    setMessage(
      "Please select a grade for <strong>Subject + Line</strong> searches.",
      "alert-warning",
    );
    return;
  }
  setMessage("");
  try {
    const filtered = search(cachedRecords, field, term);
    lastResults = filtered;
    const suffix = grade ? ` (Grade ${grade})` : "";
    setMessage(
      `<strong>${filtered.length}</strong> result${filtered.length === 1 ? "" : "s"} found${suffix}.`,
      filtered.length ? "alert-success" : "alert-secondary",
    );
    renderTable(filtered);
  } catch (err) {
    setMessage(`Error: ${esc(err.message)}`, "alert-danger");
    renderTable([]);
  }
});

$("#resetBtn").on("click", async function () {
  $form[0].reset();
  setMessage("");
  setStatus("Ready", "secondary");
  $result.empty();
  lastResults = [];
  await refreshSubjectsAndLines();
});

$export.on("click", function () {
  if (!lastResults.length) return;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  download(
    `StudentSearch-${y}${m}${d}.csv`,
    toCSV(lastResults),
    "text/csv;charset=utf-8",
  );
});
