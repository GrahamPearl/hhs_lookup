/* =====================
   CONFIG & STATE
===================== */

const DATA_URL = "./students.json";
const PHOTO_PATH = "../photos/";
const PLACEHOLDER_IMG = "https://via.placeholder.com/120x150?text=No+Photo";

let students = [];

// Indexes (memory‑efficient, fast lookups)
let adminIndex = new Map(); // adminNo → student
let classIndex = new Map(); // class → [students]

/* =====================
   INIT
===================== */

document.addEventListener("DOMContentLoaded", init);


function normalizeAgeGroup(val) {
  if (!val) return val;
  return val.includes('%') ? decodeURIComponent(val) : val;
}


function getStudentPhoto(student) {
  if (student.photo) {
    return PHOTO_PATH + student.photo;
  }
  return PLACEHOLDER_IMG;
}


function escape(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}


function init() {
  fetch(DATA_URL)
    .then((res) => res.json())
    .then((data) => {
      if (!Array.isArray(data)) {
        showMessage("danger", "Invalid student dataset.");
        return;
      }

      // ✅ NORMALIZE DATA ONCE
      students = data.map((s) => ({
        ...s,
        agegroup: normalizeAgeGroup(s.agegroup)
      }));

      buildIndexes(students);
      populateDropdowns(students);
    });

  document
    .getElementById("searchForm")
    .addEventListener("submit", handleSearch);

  // Auto‑apply filters
  ["filterGrade", "filterClass", "filterGender", "filterAgeGroup"].forEach(
    (id) => document.getElementById(id).addEventListener("change", runSearch),
  );

  document
    .getElementById("clearFilters")
    .addEventListener("click", resetFilters);
}

/* =====================
   INDEXING
===================== */

function buildIndexes(data) {
  data.forEach((s) => {
    adminIndex.set(s.adminNo.toLowerCase(), s);

    const klass = s.class.toLowerCase();
    if (!classIndex.has(klass)) classIndex.set(klass, []);
    classIndex.get(klass).push(s);
  });
}

/* =====================
   SEARCH FLOW
===================== */

function handleSearch(e) {
  e.preventDefault();
  runSearch();
}

function runSearch() {
  clearUI(false);

  const queryEl = document.getElementById("query");
  const raw = queryEl.value.trim().toLowerCase();

  if (!raw) {
    queryEl.classList.add("is-invalid");
    return;
  }
  queryEl.classList.remove("is-invalid");

  const field = window.getSelectedField ? window.getSelectedField() : "auto";

  let results = searchStudents(raw, field);
  results = applyFilters(results);

  displayResults(results);
}

/* =====================
   SEARCH LOGIC
===================== */

function searchStudents(query, field) {
  // Admin number (exact)
  if (field === "admin" || field === "auto") {
    const hit = adminIndex.get(query);
    if (hit) return [hit];
  }

  // Class
  if (field === "class") {
    return classIndex.get(query) || [];
  }

  // Name / fallback
  return students.filter((s) => {
    const fullName = `${s.firstName} ${s.lastName}`.toLowerCase();

    if (field === "name") {
      return fullName.includes(query);
    }

    // auto
    return fullName.includes(query) || s.class.toLowerCase().includes(query);
  });
}

/* =====================
   FILTER LOGIC
===================== */

function applyFilters(list) {
  const grade = getVal("filterGrade");
  const klass = getVal("filterClass");
  const gender = getVal("filterGender");
  const ageGroup = getVal("filterAgeGroup");

  return list.filter((s) => {
    if (grade && s.grade !== grade) return false;
    if (klass && s.class !== klass) return false;
    if (gender && s.gender !== gender) return false;
    if (ageGroup && s.agegroup !== ageGroup) return false;
    return true;
  });
}

function getVal(id) {
  return document.getElementById(id)?.value || "";
}

/* =====================
   UI HELPERS
===================== */

function displayResults(list) {
  const area = document.getElementById("resultArea");
  area.innerHTML = "";

  if (list.length === 0) {
    area.innerHTML = `<div class="alert alert-warning">No students found.</div>`;
    return;
  }

  area.innerHTML = `<p class="text-muted">${list.length} student(s) found</p>`;

  list.forEach((s) => {
    console.log("RAW agegroup:", s.agegroup);

    const photoSrc = getStudentPhoto(s);

    area.innerHTML += `
      <div class="card mb-2">
        <div class="card-body d-flex align-items-start gap-3">
          
          <img
            src="${photoSrc}"
            alt="Photo of ${escape(s.firstName)} ${escape(s.lastName)}"
            class="rounded border"
            style="width:90px; height:120px; object-fit:cover;"
            onerror="this.src='${PLACEHOLDER_IMG}'"
          >

          <div>
          
            <strong>${escape(s.firstName)} ${escape(s.lastName)}</strong><br>
            <p class="mb-1">
                <strong>Gender:</strong>
                ${escape(s.gender ?? "—")}
              </p>
            Admin: ${escape(s.adminNo)}<br>
            Class: ${escape(s.class)} · Grade: ${escape(s.grade)}
          </div>

           <div class="col-sm-6">
           <p class="mb-1">
                <strong>Date of Birth:</strong>
                ${escape(s.birthdate ?? "—")}
              </p>
           <p class="mb-1">
                <strong>Age Group:</strong>
                ${s.agegroup ?? '-'}
              </p>
            
              
            </div>   
        </div>
      </div>
    `;
  });
}

function displaySingleStudent(student) {
  const area = document.getElementById("resultArea");
  const photoSrc = getStudentPhoto(student);

  area.innerHTML = `
    <div class="card shadow-sm">
      <div class="card-body row g-3 align-items-center">

        <!-- Photo -->
        <div class="col-md-3 text-center">
          <img
            src="${photoSrc}"
            alt="Photo of ${escape(student.firstName)} ${escape(student.lastName)}"
            class="img-fluid rounded border"
            style="max-width:160px; object-fit:cover;"
            onerror="this.src='${PLACEHOLDER_IMG}'"
          >
        </div>

        <!-- Profile Info -->
        <div class="col-md-9">
          <h4 class="mb-2">
            ${escape(student.firstName)} ${escape(student.lastName)}
          </h4>

          <div class="row">
            <div class="col-sm-6">
              <p class="mb-1"><strong>Admin No:</strong> ${escape(student.adminNo)}</p>
              <p class="mb-1"><strong>Grade:</strong> ${escape(student.grade)}</p>
              <p class="mb-1"><strong>Class:</strong> ${escape(student.class)}</p>
            </div>

            <div class="col-sm-6">
              <p class="mb-1">
                <strong>Gender:</strong>
                ${escape(student.gender ?? "—")}
              </p>
              <p class="mb-1">
                <strong>Age Group:</strong>
                ${escape(decodeURIComponent(student.agegroup ?? '—'))}
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;
}

function showMessage(type, msg) {
  document.getElementById("messageArea").innerHTML =
    `<div class="alert alert-${type}">${msg}</div>`;
}

function clearUI(clearInput) {
  document.getElementById("messageArea").innerHTML = "";
  document.getElementById("resultArea").innerHTML = "";
  if (clearInput) document.getElementById("query").value = "";
}

function resetFilters() {
  ["filterGrade", "filterClass", "filterGender", "filterAgeGroup"].forEach(
    (id) => (document.getElementById(id).value = ""),
  );

  runSearch();
}

/* =====================
   DROPDOWNS
===================== */
function populateSelect(id, values) {
  const select = document.getElementById(id);
  if (!select) return;

  // Keep first option ("All")
  const first = select.options[0];
  select.innerHTML = '';
  select.appendChild(first);

  [...values]
    .sort()
    .forEach(value => {
      const opt = document.createElement('option');

      // ✅ DO NOT encode
      opt.value = value;
      opt.textContent = value;

      select.appendChild(opt);
    });
}


function populateDropdowns(students) {
  const classSet = new Set();
  const ageGroupSet = new Set();

  students.forEach((s) => {
    if (s.class) {
      classSet.add(s.class.trim());
    }
    if (s.agegroup) {
      ageGroupSet.add(s.agegroup.trim());
    }
  });

  populateSelect("filterClass", classSet);
  populateSelect("filterAgeGroup", ageGroupSet);
}

function fillSelect(id, values) {
  const el = document.getElementById(id);
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

/* =====================
   SECURITY
===================== */

function __setStudentsForTest(data) {
  students = data;
  adminIndex.clear();
  classIndex.clear();
  buildIndexes(students);
}



module.exports = {
  normalizeAgeGroup,
  getStudentPhoto,
  buildIndexes,
  searchStudents,
  applyFilters,
  __setStudentsForTest
};

