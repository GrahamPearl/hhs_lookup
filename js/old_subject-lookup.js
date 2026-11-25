const PLACEHOLDER_IMG = "https://via.placeholder.com/400x240?text=No+Photo";

// subject-lookup.js — Grade dropdown + Subject+Line search with photos and profile links
(function () {
  const SUBJECT_FILES = {
    10: "Subjects-Grade10.json",
    11: "Subjects-Grade11.json",
    12: "Subjects-Grade12.json",
  };
  const cacheLoaded = new Map();
  const cacheIndex = new Map(); // grade -> Map<subject, Map<line, rows[]>>

  const SUBJECT_SYNONYMS = new Map([
    ["egd", "engineering graphics and design"],
    ["enghl", "english home language"],
    ["english hl", "english home language"],
    ["it", "information technology"],
    ["ls", "life sciences"],
    ["life sci", "life sciences"],
    ["ma", "mathematics"],
    ["math", "mathematics"],
    ["math lit", "mathematical literacy"],
    ["maths lit", "mathematical literacy"],
    ["mlit", "mathematical literacy"],
    ["va", "visual arts"],
  ]);

  function normalizeSubjectBase(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\(gr\s*\d+\)\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function ensureLoaded(grade) {
    if (cacheLoaded.get(grade)) return;
    const url = SUBJECT_FILES[grade];
    if (!url) throw new Error("No data file configured for grade " + grade);
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load ${url} (${resp.status})`);
    const data = await resp.json();

    const bySubject = new Map();
    for (const row of Array.isArray(data) ? data : []) {
      const base = normalizeSubjectBase(row.teacher || row.subject);
      const subjKey = SUBJECT_SYNONYMS.get(base) || base;
      const lineKey = String(row.line ?? "").trim();
      if (!bySubject.has(subjKey)) bySubject.set(subjKey, new Map());
      const byLine = bySubject.get(subjKey);
      if (!byLine.has(lineKey)) byLine.set(lineKey, []);
      byLine.get(lineKey).push(row);
    }
    cacheIndex.set(grade, bySubject);
    cacheLoaded.set(grade, true);
  }

  function parseSubjectLineQuery(raw) {
    let low = String(raw || "")
      .trim()
      .toLowerCase();
    if (!low) return null;
    let lineMatch = low.match(/(?:^|\s)line\s*[:=]?\s*(\d{1,2})/);
    let line = lineMatch ? lineMatch[1] : null;
    if (!line) {
      const tail = low.match(/(\d{1,2})\s*$/);
      if (tail) line = tail[1];
    }
    let subjPart = low.replace(/(?:^|\s)line\s*[:=]?\s*\d{1,2}\s*$/, "").trim();
    subjPart = subjPart.replace(/^(subject|sub)\s*[:=]\s*/, "").trim();
    const normalized = SUBJECT_SYNONYMS.get(subjPart) || subjPart;
    return { subj: normalized, line: line || null };
  }

  function resolveSubjectKeys(grade, subjQuery) {
    const idx = cacheIndex.get(grade) || new Map();
    const names = Array.from(idx.keys());
    const q = normalizeSubjectBase(subjQuery);
    if (idx.has(q)) return [q];
    const starts = names.filter((k) => k.startsWith(q));
    if (starts.length) return starts;
    return names.filter((k) => k.includes(q));
  }

  function findRows(grade, subjQuery, line) {
    const idx = cacheIndex.get(grade) || new Map();
    const keys = resolveSubjectKeys(grade, subjQuery);
    const out = [];
    for (const key of keys) {
      const byLine = idx.get(key);
      if (!byLine) continue;
      if (line) out.push(...(byLine.get(String(line)) || []));
      else for (const [ln, rows] of byLine.entries()) if (ln) out.push(...rows);
    }
    const seen = new Set();
    return out.filter((r) => {
      const id = String(r.student_number || "") + "|" + String(r.teacher || "");
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderTable(subjectLabel, lineLabel, rows) {
    const $area = $("#resultArea");
    if (!rows.length) {
      $area.html(
        `<div class="alert alert-warning mt-3">No students found for <strong>${esc(subjectLabel)}</strong>${lineLabel ? " (Line " + esc(lineLabel) + ")" : ""}.</div>`,
      );
      return;
    }
    const title = `<h5 class="card-title mb-0">Subject: ${esc(subjectLabel)}${lineLabel ? " · Line " + esc(lineLabel) : ""} <span class="badge bg-secondary ms-2">${rows.length} student${rows.length === 1 ? "" : "s"}</span></h5>`;
    const header = `
      <thead>
        <tr>
          <th scope="col">Photo</th>
          <th scope="col">Student No</th>
          <th scope="col">Name</th>
          <th scope="col">Class</th>
          <th scope="col">Line</th>
          <th scope="col">Teacher</th>
          <th scope="col">Group</th>
        </tr>
      </thead>`;

    const body = rows
      .map((r) => {
        const sid = esc(r.student_number);
        const photo = `../photos/${sid}.webp`;
        const href = `../find_students/index.html?field=admin&query=${encodeURIComponent(String(r.student_number || ""))}`;
        return `
        <tr>
          <td class="align-middle">
          <div class="card card-fixed shadow-sm result-card" data-index="${sid}">
        <img
          class="student-photo"
          src="${photo}"
          alt="Profile photo of ${esc(r.name)}"
          onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}';"
        />
        </div>
            
          </td>
          <td class="align-middle"><a class="link-primary" href="${href}">${sid}</a></td>
          <td class="align-middle"><a class="link-primary" href="${href}">${esc(r.name)}</a></td>
          <td class="align-middle">${esc(r.class)}</td>
          <td class="align-middle">${esc(r.line)}</td>
          <td class="align-middle">${esc(r.teacher)}</td>
          <td class="align-middle">${esc(r.subject)}</td>
        </tr>`;
      })
      .join("");

    $area.html(`
      <div class="card shadow-sm">
        <div class="card-body">
          ${title}
          <div class="table-responsive mt-3">
            <table class="table table-sm table-hover align-middle">
              ${header}
              <tbody>${body}</tbody>
            </table>
          </div>
        </div>
      </div>`);
  }

  $(function () {
    const $form = $("#searchForm");
    const $query = $("#query");

    $form.on("submit", async function (e) {
      const field =
        typeof window.getSelectedField === "function"
          ? window.getSelectedField()
          : "auto";
      const raw = String($query.val() ?? "").trim();
      const parsed = parseSubjectLineQuery(raw);
      const grade = String($("#gradeSelect").val() || "");
      const isSubjectMode = field === "subject" || (parsed && parsed.subj);
      if (!isSubjectMode) return; // let existing lookup.js handle normal searches

      e.preventDefault();
      e.stopImmediatePropagation();

      if (!grade) {
        if (typeof showMessage === "function")
          showMessage(
            "warning",
            "Please select a <strong>Grade</strong> to search by Subject + Line.",
          );
        else
          $("#messageArea").html(
            '<div class="alert alert-warning">Please select a <strong>Grade</strong>.</div>',
          );
        return;
      }
      try {
        if (typeof clearUI === "function") clearUI();
        await ensureLoaded(grade);
        const list = findRows(grade, parsed.subj, parsed.line);
        const subjLabel = (parsed.subj || "Subject").replace(/\w/g, (c) =>
          c.toUpperCase(),
        );
        renderTable(subjLabel, parsed.line, list);
        if (typeof showMessage === "function") {
          if (!list.length)
            showMessage(
              "warning",
              `No results for: <strong>${esc(raw)}</strong>.`,
            );
          else
            showMessage(
              "info",
              `${list.length} result${list.length === 1 ? "" : "s"} found.`,
            );
        }
      } catch (err) {
        const msg = "Could not load subject data. " + esc(err.message);
        if (typeof showMessage === "function") showMessage("danger", msg);
        else
          $("#messageArea").html(
            '<div class="alert alert-danger">' + msg + "</div>",
          );
      }
    });
  });
})();
