/*************************************************
 * GLOBAL STATE
 *************************************************/
const jobs = [];

/*************************************************
 * DOM ELEMENTS
 *************************************************/
const roleSelect = document.getElementById("roleSelect");
const adminSettings = document.getElementById("adminSettings");
const weeklyReportControls = document.getElementById("weeklyReportControls");

const teacherFile = document.getElementById("teacherFile");
const todoFile = document.getElementById("todoFile");

const teacherSelect = document.getElementById("teacherSelect");

const pagesInput = document.getElementById("pages");
const copiesInput = document.getElementById("copies");
const printTypeSelect = document.getElementById("printType");
const sidesSelect = document.getElementById("sides");
const scheduledForInput = document.getElementById("scheduledFor");

const timePerPageInput = document.getElementById("timePerPage");
const loadTimeInput = document.getElementById("loadTime");
const checkTimeInput = document.getElementById("checkTime");

const effectivePagesSpan = document.getElementById("effectivePages");
const estimateSpan = document.getElementById("estimate");

const submitBtn = document.getElementById("submitBtn");
const saveTodoBtn = document.getElementById("saveTodoBtn");
const saveCompletedBtn = document.getElementById("saveCompletedBtn");
const saveMonthlyJsonBtn = document.getElementById("saveMonthlyJsonBtn");
const saveTenWeekJsonBtn = document.getElementById("saveTenWeekJsonBtn");
const saveWeeklyReportBtn = document.getElementById("saveWeeklyReportBtn");

const queueDiv = document.getElementById("queue");

/*************************************************
 * ROLE HANDLING
 *************************************************/
roleSelect.addEventListener("change", () => {
  const role = roleSelect.value;
  adminSettings.classList.toggle("hidden", role !== "admin");
  weeklyReportControls.classList.toggle("hidden", role !== "weekly-report");
  renderQueue();
});

/*************************************************
 * TEACHER LIST (.txt upload)
 *************************************************/
teacherFile.addEventListener("change", () => {
  const file = teacherFile.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const names = reader.result
      .split(/\r?\n/)
      .map(n => n.trim())
      .filter(Boolean);

    teacherSelect.innerHTML = "<option value=''>Select teacher</option>";
    teacherSelect.disabled = false;

    names.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      teacherSelect.appendChild(opt);
    });
  };
  reader.readAsText(file);
});

/*************************************************
 * ESTIMATION LOGIC
 *************************************************/
function calculateEffectivePages(pages) {
  return printTypeSelect.value === "twoinone"
    ? Math.ceil(pages / 2)
    : pages;
}

function updateEstimate() {
  const pages = Number(pagesInput.value || 0);
  const copies = Number(copiesInput.value || 0);

  const effectivePages = calculateEffectivePages(pages);
  effectivePagesSpan.textContent = effectivePages;

  const timePerPage = Number(timePerPageInput.value || 0);
  const loadTime = Number(loadTimeInput.value || 0);
  const checkTime = Number(checkTimeInput.value || 0);

  const estimate =
    loadTime +
    checkTime +
    (effectivePages * copies * timePerPage);

  estimateSpan.textContent = estimate;
  return estimate;
}

/*************************************************
 * ADD PRINT JOB
 *************************************************/
submitBtn.addEventListener("click", () => {
  if (!teacherSelect.value) {
    alert("Please select a requesting teacher.");
    return;
  }

  const pages = Number(pagesInput.value || 0);

  jobs.push({
    teacher: teacherSelect.value,
    originalPages: pages,
    effectivePages: calculateEffectivePages(pages),
    copies: Number(copiesInput.value || 1),
    printType: printTypeSelect.value,
    sides: sidesSelect.value,
    scheduledFor: scheduledForInput.value,
    requestedAt: new Date().toISOString(),
    estimatedSeconds: updateEstimate(),

    status: "Queued",

    startedAt: "",
    completedAt: "",
    totalDurationSeconds: null
  });

  renderQueue();
});

/*************************************************
 * START / COMPLETE JOB (ADMIN)
 *************************************************/
function handleAdminAction(index) {
  const job = jobs[index];

  // Start job
  if (job.status === "Queued") {
    job.status = "In process";
    job.startedAt = new Date().toISOString();
    renderQueue();
    return;
  }

  // Complete job
  if (job.status === "In process") {
    const confirmDone = confirm(
      "Confirm that this task has been completed?"
    );

    if (!confirmDone) return;

    job.completedAt = new Date().toISOString();
    job.totalDurationSeconds =
      Math.round(
        (new Date(job.completedAt) - new Date(job.startedAt)) / 1000
      );

    job.status = "Completed";
    renderQueue();
  }
}

/*************************************************
 * EXPORT HELPERS
 *************************************************/
function downloadFile(content, filename, type = "text/plain") {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function exportJSON(filename) {
  downloadFile(
    JSON.stringify(jobs, null, 2),
    filename,
    "application/json"
  );
}

/*************************************************
 * SAVE TODO & COMPLETED
 *************************************************/
saveTodoBtn.onclick = () => {
  downloadFile(
    jobs.filter(j => j.status !== "Completed")
        .map(j => JSON.stringify(j))
        .join("\n"),
    `todo_${today()}.txt`
  );
};

saveCompletedBtn.onclick = () => {
  downloadFile(
    jobs.filter(j => j.status === "Completed")
        .map(j => JSON.stringify(j))
        .join("\n"),
    `completed_${today()}.txt`
  );
};

/*************************************************
 * LONG‑TERM JSON EXPORTS
 *************************************************/
saveMonthlyJsonBtn.onclick = () =>
  exportJSON(`jobs_monthly_${today()}.json`);

saveTenWeekJsonBtn.onclick = () =>
  exportJSON(`jobs_10week_${today()}.json`);

/*************************************************
 * WEEKLY REPORT (MON–FRI, COMPLETED ONLY)
 *************************************************/
saveWeeklyReportBtn.onclick = () => {
  const completedThisWeek = jobs.filter(
    j => j.status === "Completed" && isThisWeek(j.completedAt)
  );

  const perTeacher = {};
  completedThisWeek.forEach(j => {
    if (!perTeacher[j.teacher]) {
      perTeacher[j.teacher] = 0;
    }
    perTeacher[j.teacher] += j.effectivePages * j.copies;
  });

  let output = "WEEKLY PRINT REPORT (MON–FRI)\n\n";
  output += `Jobs completed: ${completedThisWeek.length}\n\n`;

  output += "Pages per teacher:\n";
  for (const t in perTeacher) {
    output += ` - ${t}: ${perTeacher[t]} pages\n`;
  }

  output += "\nCompleted jobs:\n";
  completedThisWeek.forEach(j => {
    output += `${j.teacher} | Started: ${j.startedAt} | Completed: ${j.completedAt} | Duration: ${j.totalDurationSeconds}s\n`;
  });

  downloadFile(output, `weekly_report_${today()}.txt`);
};

/*************************************************
 * IMPORT TODO FILE
 *************************************************/
todoFile.addEventListener("change", () => {
  const reader = new FileReader();
  reader.onload = () => {
    reader.result
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach(line => jobs.push(JSON.parse(line)));
    renderQueue();
  };
  reader.readAsText(todoFile.files[0]);
});

/*************************************************
 * RENDER QUEUE
 *************************************************/
function renderQueue() {
  queueDiv.innerHTML = "";

  jobs.forEach((job, index) => {
    if (
      roleSelect.value === "weekly-report" &&
      job.status !== "Completed"
    ) return;

    const div = document.createElement("div");
    div.className = "queue-item";

    div.innerHTML = `
      <strong>${job.teacher}</strong><br>
      Status: ${job.status}<br>
      Requested: ${job.requestedAt}<br>
      Started: ${job.startedAt || "-"}<br>
      Completed: ${job.completedAt || "-"}<br>
      Duration: ${
        job.totalDurationSeconds !== null
          ? job.totalDurationSeconds + "s"
          : "-"
      }<br>
      Pages: ${job.originalPages} → ${job.effectivePages}
    `;

    if (
      roleSelect.value === "admin" &&
      job.status !== "Completed"
    ) {
      const btn = document.createElement("button");
      btn.textContent =
        job.status === "Queued"
          ? "Start task"
          : "Task in process – Click to complete";

      btn.onclick = () => handleAdminAction(index);
      div.appendChild(btn);
    }

    queueDiv.appendChild(div);
  });
}

/*************************************************
 * DATE HELPERS
 *************************************************/
function today() {
  return new Date().toISOString().slice(0, 10);
}

function isThisWeek(dateStr) {
  if (!dateStr) return false;

  const d = new Date(dateStr);
  const now = new Date();

  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return d >= monday && d <= friday;
}