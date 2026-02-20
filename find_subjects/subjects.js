// subjects.js — Grade → Subject → Line lookup + CSV export

// ===== Configuration: update filenames if needed =====
const gradeFiles = {
  "10": "Subjects-Grade10.json",
  "11": "Subjects-Grade11.json",
  "12": "Subjects-Grade12.json",
};

// ===== State =====
let subjectsMap = new Map();     // subjectName -> students[]
let currentSubject = "";
let currentStudents = [];
let filteredStudents = [];

// ===== DOM =====
const $grade   = $('#gradeSelect');
const $subject = $('#subjectSelect');
const $line    = $('#lineSelect');
const $result  = $('#resultArea');
const $msg     = $('#messageArea');
const $count   = $('#countBadge');
const $status  = $('#statusText');
const $export  = $('#exportBtn');

// ===== Utilities =====
function setStatus(text, cls = '') {
  $status.removeClass('status-ok status-warn status-err')
         .addClass(cls ? `subjects-status ${cls}` : 'subjects-status')
         .text(text || '');
}
function setMessage(html) { $msg.html(html || ''); }

function updateCount(arr) {
  const n = Array.isArray(arr) ? arr.length : 0;
  $count.text(`${n} student${n === 1 ? '' : 's'}`);
  $count.toggleClass('bg-secondary', n === 0)
        .toggleClass('bg-success', n > 0);
}

function clearSelect($sel, placeholder, { disabled = false } = {}) {
  $sel.empty().append(
    $('<option>', { value: '', text: placeholder, disabled: true, selected: true })
  ).prop('disabled', disabled);
  return $sel;
}

function addOptions($sel, opts) {
  for (const { value, label } of opts) {
    $sel.append($('<option>', { value, text: label ?? value }));
  }
}

async function fetchJson(url) {
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`${url} (${resp.status})`);
  return resp.json();
}

/**
 * Normalize to Map<subjectName, students[]>
 * Accepts:
 *  A) { "subjects": [ { "name": "...", "students": [ ... ] }, ... ] }
 *  B) { "IT": [ ... ], "Mathematics": [ ... ] }
 */
function normalizeSubjects(data) {
  const map = new Map();

  // A) subjects: []
  if (data && Array.isArray(data.subjects)) {
    for (const entry of data.subjects) {
      if (!entry) continue;
      const name = entry.name || entry.subject || entry.title || entry.code || 'Unknown Subject';
      const students = Array.isArray(entry.students) ? entry.students
                     : Array.isArray(entry.learners) ? entry.learners
                     : Array.isArray(entry.pupils)   ? entry.pupils
                     : [];
      map.set(String(name), students);
    }
    return map;
  }

  // B) subjectName: []
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, val] of Object.entries(data)) {
      if (Array.isArray(val)) {
        map.set(String(key), val);
      } else if (val && typeof val === 'object') {
        const name = val.name || val.subject || key;
        const students = Array.isArray(val.students) ? val.students : [];
        map.set(String(name), students);
      }
    }
  }

  return map;
}

function uniqValues(arr, key) {
  return Array.from(
    new Set(
      arr.map(o => (o && o[key] != null ? String(o[key]) : ''))
         .filter(Boolean)
    )
  );
}

function deriveColumns(students) {
  const set = new Set();
  students.forEach(s => {
    if (s && typeof s === 'object') Object.keys(s).forEach(k => set.add(k));
  });
  const preferred = [
    'studentId','id','studentNumber','admissionNo',
    'firstName','lastName','name',
    'line',
    'class','group'
  ];
  const present = new Set(set);
  const cols = [];

  preferred.forEach(k => { if (present.has(k)) { cols.push(k); present.delete(k); } });
  cols.push(...Array.from(present).sort((a,b)=>a.localeCompare(b)));
  return cols.length ? cols : ['name'];
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}

function stringifyCell(v) {
  if (v == null) return '';
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
}

function renderTable(rows) {
  if (!rows.length) {
    $result.html('<div class="alert alert-light border">No students to display.</div>');
    return;
  }
  const cols = deriveColumns(rows);
  const thead = '<thead><tr>' + cols.map(c=>`<th scope="col">${esc(c)}</th>`).join('') + '</tr></thead>';
  const tbody = '<tbody>' + rows.map(r =>
    '<tr>' + cols.map(c => `<td>${esc(stringifyCell(r?.[c]))}</td>`).join('') + '</tr>'
  ).join('') + '</tbody>';

  $result.html(
    '<div class="table-responsive">' +
      '<table class="table table-sm table-hover align-middle sticky-head">' +
        thead + tbody +
      '</table>' +
    '</div>'
  );
}

function toCSV(rows) {
  if (!rows.length) return '';
  const cols = deriveColumns(rows);
  const escCSV = s => {
    const t = String(s ?? '');
    const need = /[",\n]/.test(t);
    return need ? '"' + t.replaceAll('"','""') + '"' : t;
  };
  const header = cols.map(escCSV).join(',');
  const lines = rows.map(r => cols.map(c => escCSV(stringifyCell(r?.[c]))).join(','));
  return [header, ...lines].join('\n');
}

function download(filename, content, mime='text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ===== Event wiring =====
$grade.on('change', async function() {
  const g = $(this).val();
  setMessage(''); setStatus('Loading subjects…', 'status-warn');

  subjectsMap = new Map(); currentSubject = ''; currentStudents = []; filteredStudents = [];
  updateCount([]); $export.prop('disabled', true);
  clearSelect($subject, 'Select subject…', { disabled: true });
  clearSelect($line, 'All lines', { disabled: true }).append($('<option>', { value:'__ALL__', text:'All lines' }));

  const file = gradeFiles[g];
  if (!file) { setStatus('No data file configured for this grade.', 'status-err'); renderTable([]); return; }

  try {
    const data = await fetchJson(file);
    subjectsMap = normalizeSubjects(data);

    if (subjectsMap.size === 0) {
      setStatus('Loaded, but no subjects found in the file.', 'status-warn');
      setMessage(`Check the structure of <code>${file}</code>.`);
      renderTable([]); return;
    }

    const subjects = Array.from(subjectsMap.keys()).sort((a,b)=>a.localeCompare(b));
    addOptions($subject, subjects.map(s => ({ value: s, label: s })));
    $subject.prop('disabled', false);
    setStatus(`Loaded ${subjects.length} subject${subjects.length===1?'':'s'} for Grade ${g}.`, 'status-ok');
  } catch (e) {
    setStatus('Failed to load grade file.', 'status-err');
    setMessage(`<span class="text-danger">Error:</span> ${e.message}. Ensure the file exists and you’re not opening this page via <code>file://</code>.`);
    renderTable([]);
  }
});

$subject.on('change', function() {
  currentSubject = $(this).val();
  currentStudents = subjectsMap.get(currentSubject) || [];

  // Populate line filter
  clearSelect($line, 'All lines', { disabled: false });
  $line.append($('<option>', { value:'__ALL__', text:'All lines', selected:true }));
  uniqValues(currentStudents, 'line').sort((a,b)=>a.localeCompare(b))
    .forEach(l => $line.append($('<option>', { value: l, text: l })));

  filteredStudents = [...currentStudents];
  renderTable(filteredStudents);
  updateCount(filteredStudents);
  $export.prop('disabled', filteredStudents.length === 0);
  setStatus(`Showing “${currentSubject}” (${filteredStudents.length} record${filteredStudents.length===1?'':'s'}).`, 'status-ok');
});

$line.on('change', function() {
  const v = $(this).val();
  filteredStudents = (v === '__ALL__')
    ? [...currentStudents]
    : currentStudents.filter(s => String(s?.line ?? '').trim() === v);

  renderTable(filteredStudents);
  updateCount(filteredStudents);
  $export.prop('disabled', filteredStudents.length === 0);
  setStatus(`Filter: ${v==='__ALL__' ? 'All lines' : 'Line = '+v}. ${filteredStudents.length} record${filteredStudents.length===1?'':'s'}.`, 'status-ok');
});

$('#exportBtn').on('click', function() {
  if (!filteredStudents.length) return;
  const g = $grade.val() || 'NA';
  const subjSafe = (currentSubject || 'Subject').replace(/[^\w\-]+/g, '_');
  const line = ($line.val() && $line.val() !== '__ALL__') ? $line.val() : 'All';
  const csv = toCSV(filteredStudents);
  download(`Grade${g}-${subjSafe}-Line_${line}.csv`, csv, 'text/csv;charset=utf-8');
});

// HTML5 validation hinting (non-blocking)
(function() {
  const form = document.getElementById('subjectsForm');
  form.addEventListener('submit', function(e) {
    if (!form.checkValidity()) { e.preventDefault(); e.stopPropagation(); }
    form.classList.add('was-validated');
  });
})();