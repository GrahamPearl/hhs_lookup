// --- Configuration ---
const DATA_URL = 'students.json'; // same folder as index.html
const PLACEHOLDER_IMG = 'https://via.placeholder.com/400x240?text=No+Photo';

// --- State ---
let students = [];

// --- Cached elements ---
const $form = $('#searchForm');
const $query = $('#query');
const $messageArea = $('#messageArea');
const $resultArea = $('#resultArea');
const $resetBtn = $('#resetBtn');
const $folderPicture = '../photos/';

// --- NEW: Indexes & cache ---
/**
 * adminIndex: Map<adminNoLower, student>
 * classIndex: Map<classLower, student[]>
 */
let adminIndex = new Map(); // NEW
let classIndex = new Map(); // NEW

// Simple LRU cache using Map insertion order. NEW
const resultCache = new Map();
const MAX_CACHE_SIZE = 50;
function cacheGet(key) {
  if (!resultCache.has(key)) return undefined;
  // refresh order (LRU behavior)
  const val = resultCache.get(key);
  resultCache.delete(key);
  resultCache.set(key, val);
  return val;
}
function cacheSet(key, val) {
  resultCache.set(key, val);
  if (resultCache.size > MAX_CACHE_SIZE) {
    const oldestKey = resultCache.keys().next().value;
    resultCache.delete(oldestKey);
  }
}

// --- Initial load: AJAX (jQuery) ---
$(document).ready(function () {
  $.ajax({
    url: DATA_URL,
    method: 'GET',
    dataType: 'json',
    cache: false
  })
    .done(function (data, textStatus, jqXHR) {
      // Basic validation
      if (!Array.isArray(data)) {
        showMessage('danger', 'Student dataset format is invalid (expected an array).');
        console.error('Invalid data:', data);
        return;
      }

      // Normalize & index for faster lookups. NEW
      students = data.map(s => {
        const s2 = { ...s };
        s2._admin = String(s.adminNo ?? '').toLowerCase();
        s2._first = String(s.firstName ?? '').toLowerCase();
        s2._last  = String(s.lastName ?? '').toLowerCase();
        s2._full  = `${s2._first} ${s2._last}`.trim();
        s2._class = String(s.registrationClass ?? '').toLowerCase();

        if (s2._admin) {
          adminIndex.set(s2._admin, s2);
        }
        if (s2._class) {
          if (!classIndex.has(s2._class)) classIndex.set(s2._class, []);
          classIndex.get(s2._class).push(s2);
        }
        return s2;
      });

      $query.trigger('focus');
    })
    .fail(function (jqXHR, textStatus, errorThrown) {
      let hint = '';
      if (location.protocol === 'file:') {
        hint = ' You appear to be opening this file directly. Please run from a local server (e.g., VS Code Live Server).';
      }
      showMessage('danger', 'Could not load student dataset.' + hint);
      console.error('AJAX error:', { status: jqXHR.status, textStatus, errorThrown });
    });
});

// --- Subject datasets ---
const SUBJECT_FILES = {
  10: 'Grade10_Master_Subjects.json',
  11: 'Grade11_Master_Subjects.json',
  12: 'Grade12_Master_Subjects.json'
};

let subjectIndex = new Map(); 
// Map<adminNoLower, subject[]>

function loadSubjects(grade) {
  return $.ajax({
    url: SUBJECT_FILES[grade],
    method: 'GET',
    dataType: 'json',
    cache: false
  }).done(function (data) {
    data.forEach(s => {
      const admin = String(s.student_number).toLowerCase();
      if (!subjectIndex.has(admin)) subjectIndex.set(admin, []);
      subjectIndex.get(admin).push(s);
    });
  });
}


$form.on('submit', function (e) {
  e.preventDefault();
  clearUI();

  const raw = ($query.val() ?? '').trim();
  if (!raw) { $query.addClass('is-invalid'); return; }
  $query.removeClass('is-invalid');

  // NEW: read selected field from the dropdown
  const field = (typeof window.getSelectedField === 'function' ? window.getSelectedField() : 'auto');

  let effective = raw;
  if (field === 'class') {
    effective = `class:${raw}`;      // forces class search (your function already supports this)
  } else if (field === 'name') {
    effective = `name:${raw}`;       // optional: add support below in searchStudents
  } else if (field === 'admin') {
    // nothing special; admin exact match wins in your function
  }
  
  const matches = searchStudents(effective);

  if (matches.length === 0) {
    showMessage('warning', `No results for: <strong>${escapeHtml(raw)}</strong>.`);
    return;
  }
  if (matches.length === 1) {
    renderSingleStudent(matches[0]);
    showMessage('info', '1 result found.');
  } else {
    renderMultipleStudents(matches, raw);
  }
});


// --- Reset button ---
$resetBtn.on('click', function () {
  clearUI(true);
  $query.trigger('focus');
});

// --- NEW: Core search with indexes + cache ---
/**
 * Supports:
 *  - Exact Admin No (fast via adminIndex)
 *  - Exact Class (fast via classIndex)
 *  - Partial search across first/last/full name and registrationClass
 *  - Optional prefix: "class:<text>" to force class search (partial)
 */
function searchStudents(inputRaw) {
  const key = inputRaw.toLowerCase().trim();
  const cached = cacheGet(key);
  if (cached) return cached;

  let q = key;
  let forceClass = false;

  // Prefix handling: "class:" or "cls:" → force class search
  if (q.startsWith('class:')) {
    forceClass = true;
    q = q.slice('class:'.length).trim();
  } else if (q.startsWith('cls:')) {
    forceClass = true;
    q = q.slice('cls:'.length).trim();
  }

  let results = [];

  // 1) If forced class search
  if (forceClass) {
    if (!q) {
      results = []; // nothing after prefix
    } else {
      // exact key hit first
      if (classIndex.has(q)) {
        results = classIndex.get(q).slice();
      } else {
        // partial: include any class key that contains q
        const buckets = [];
        for (const [klass, arr] of classIndex.entries()) {
          if (klass.includes(q)) buckets.push(...arr);
        }
        results = buckets;
      }
    }
    cacheSet(key, results);
    return results;
  }

  // 2) Exact Admin No (fast)
  if (adminIndex.has(q)) {
    results = [adminIndex.get(q)];
    cacheSet(key, results);
    return results;
  }

  // 3) Exact Class (fast)
  if (classIndex.has(q)) {
    results = classIndex.get(q).slice();
    cacheSet(key, results);
    return results;
  }

  // 4) Partial fallback: name OR class (case-insensitive)
  results = students.filter(s =>
    s._first.includes(q) ||
    s._last.includes(q) ||
    s._full.includes(q) ||
    s._class.includes(q) ||
    s._admin === q // retain exact admin equality in fallback
  );

  cacheSet(key, results);
  return results;
}

// --- Rendering ---
function renderSubjects(subjects) {
  if (subjects.length === 0) {
    $resultArea.append(`
      <div class="alert alert-warning mt-3">
        No subjects found for this student.
      </div>
    `);
    return;
  }

  let html = `
    <div class="card mt-3 shadow-sm">
      <div class="card-body">
        <h5 class="card-title">Subjects</h5>
        <ul class="list-group list-group-flush">
  `;

  subjects.forEach(s => {
    html += `
      <li class="list-group-item">
        <strong>${escapeHtml(s.subject)}</strong><br>
        <small class="text-muted">
          Line ${escapeHtml(s.line)} · ${escapeHtml(s.teacher)}
        </small>
      </li>
    `;
  });

  html += `
        </ul>
      </div>
    </div>
  `;

  $resultArea.append(html);
}


function renderSingleStudent(student) {
  const photoSrc = student.photo ? String(student.photo) : PLACEHOLDER_IMG;

  const html = `
    <div class="card card-fixed shadow-sm result-card">
      <img
        class="student-photo"
        src="${$folderPicture + escapeAttr(photoSrc)}"
        alt="Profile photo of ${escapeAttr(student.firstName)} ${escapeAttr(student.lastName)}"
        onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}';"
      />

      <div class="card-body">
        <h5 class="card-title mb-2">
          ${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}
        </h5>

        <p class="card-text mb-1">
          <strong>ADMIN NO:</strong> ${escapeHtml(student.adminNo)}
        </p>

        <p class="card-text mb-3">
          <strong>Registration Class:</strong> ${escapeHtml(student.registrationClass)}
        </p>

        <p class="card-text">
          <small class="text-muted">
            Result generated on ${new Date().toLocaleString()}
          </small>
        </p>
      </div>
    </div>
  `;

  $resultArea.html(html);

  const gradeMatch = student.registrationClass.match(/GRADE\s+(\d+)/i);
if (!gradeMatch) return;

const grade = Number(gradeMatch[1]);
const admin = student.adminNo.toLowerCase();

// Load subject data (once per grade)
loadSubjects(grade).done(function () {
  const subjects = subjectIndex.get(admin) || [];
  renderSubjects(subjects);
});

}


function renderMultipleStudents(list, raw) {
  let grid = `
    <div class="mb-3">
      <div class="alert alert-info mb-0">
        <strong>${list.length}</strong> results for <strong>${escapeHtml(raw)}</strong>. Click a card for details.
      </div>
    </div>
    <div class="results-grid">
  `;

  list.forEach((s, idx) => {
    const photoSrc = s.photo ? String(s.photo) : PLACEHOLDER_IMG;

    grid += `
      <div class="card shadow-sm result-card" data-index="${idx}">
        <img
          class="student-photo"
          src="${$folderPicture + escapeAttr(photoSrc)}"
          alt="Profile photo of ${escapeAttr(s.firstName)} ${escapeAttr(s.lastName)}"
          onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}';"
        />
        <div class="card-body">
          <h5 class="card-title">${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</h5>
          <p class="card-text mb-1"><strong>ADMIN NO:</strong> ${escapeHtml(s.adminNo)}</p>
          <p class="card-text"><strong>Reg Class:</strong> ${escapeHtml(s.registrationClass)}</p>
        </div>
      </div>
    `;
  });

  grid += `</div>`;
  $resultArea.html(grid);

  $resultArea.find('.result-card').on('click', function () {
    const idx = Number($(this).attr('data-index'));
    renderSingleStudent(list[idx]);
    $('html, body').animate({ scrollTop: $resultArea.offset().top - 16 }, 200);
  });
}


// --- UI helpers ---
function showMessage(type, html) {
  $messageArea.html(`
    <div class="alert alert-${type} d-flex align-items-center" role="alert">
      <div>${html}</div>
    </div>
  `);
}

function clearUI(clearInput = false) {
  $messageArea.empty();
  $resultArea.empty();
  if (clearInput) $query.val('');
  $query.removeClass('is-invalid');
}

// --- Escaping helpers ---
function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('`', '&#96;');
}