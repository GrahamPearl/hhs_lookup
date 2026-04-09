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

const totalPagesSpan = document.getElementById("totalPages");
const estimateSpan = document.getElementById("estimate");

const submitBtn = document.getElementById("submitBtn");
const saveTodoBtn = document.getElementById("saveTodoBtn");
const saveCompletedBtn = document.getElementById("saveCompletedBtn");
const saveMonthlyJsonBtn = document.getElementById("saveMonthlyJsonBtn");
const saveTenWeekJsonBtn = document.getElementById("saveTenWeekJsonBtn");
const saveWeeklyReportBtn = document.getElementById("saveWeeklyReportBtn");

const priorityModeSelect = document.getElementById("priorityMode");
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
  const reader = new FileReader();
  reader.onload = () => {
    teacherSelect.innerHTML = "<option value=''>Select teacher</option>";
    teacherSelect.disabled = false;

    reader.result
      .split(/\r?\n/)
      .map(n => n.trim())
      .filter(Boolean)
      .forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        teacherSelect.appendChild(opt);
      });
  };
  reader.readAsText(teacherFile.files[0]);
});

/*************************************************
 * ESTIMATION (PREVIEW ONLY)
 *************************************************/
function calculateTotalPrintedPages(pages, copies) {
  return pages * copies;
}

function calculateEstimatedSeconds(totalPrintedPages) {
  return (
    Number(loadTimeInput.value || 0) +
    Number(checkTimeInput.value || 0) +
    (totalPrintedPages * Number(timePerPageInput.value || 0))
  );
}

function updateEstimatePreview() {
  const pages = Number(pagesInput.value || 0);
  const copies = Number(copiesInput.value || 0);

  const totalPrintedPages = calculateTotalPrintedPages(pages, copies);
  totalPagesSpan.textContent = totalPrintedPages;

  estimateSpan.textContent =
    calculateEstimatedSeconds(totalPrintedPages);
}

[
  pagesInput,
  copiesInput,
  timePerPageInput,
  loadTimeInput,
  checkTimeInput
].forEach(el => el.addEventListener("input", updateEstimatePreview));

/*************************************************
 * ADD PRINT JOB (ESTIMATE LOCKED)
 *************************************************/
submitBtn.addEventListener("click", () => {
  if (!teacherSelect.value) {
    alert("Please select a requesting teacher.");
    return;
  }

  const pages = Number(pagesInput.value || 0);
  const copies = Number(copiesInput.value || 1);
  const totalPrintedPages =
    calculateTotalPrintedPages(pages, copies);

  jobs.push({
    teacher: teacherSelect.value,

    // Workload
    originalPages: pages,
    copies: copies,
    totalPrintedPages: totalPrintedPages,

    // Scheduling
    scheduledFor: scheduledForInput.value,

    // Timing
    estimatedSeconds:
      calculateEstimatedSeconds(totalPrintedPages),
    startedAt: "",
    completedAt: "",
    actualSeconds: null,

    // Metadata
    requestedAt: new Date().toISOString(),
    printType: printTypeSelect.value,
    sides: sidesSelect.value,
    status: "Queued"
  });

  renderQueue();
});

/*************************************************
 * ADMIN: START / COMPLETE TASK
 *************************************************/
function handleAdminTaskAction(index) {
  const job = jobs[index];

  if (job.status === "Queued") {
    job.status = "In process";
    job.startedAt = new Date().toISOString();
    renderQueue();
    return;
  }

  if (job.status === "In process") {
    if (!confirm("Confirm that this task has been completed?")) return;

    job.completedAt = new Date().toISOString();
    job.actualSeconds = Math.round(
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
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function exportAllJobsAsJSON(filename) {
  downloadFile(
    JSON.stringify(jobs, null, 2),
    filename,
    "application/json"
  );
}

/*************************************************
 * DAILY EXPORTS
 *************************************************/
saveTodoBtn.onclick = () =>
  downloadFile(
    jobs.filter(j => j.status !== "Completed")
        .map(j => JSON.stringify(j))
        .join("\n"),
    `todo_${today()}.txt`
  );

saveCompletedBtn.onclick = () =>
  downloadFile(
    jobs.filter(j => j.status === "Completed")
        .map(j => JSON.stringify(j))
        .join("\n"),
    `completed_${today()}.txt`
  );

/*************************************************
 * LONG‑TERM JSON EXPORTS
 *************************************************/
saveMonthlyJsonBtn.onclick = () =>
  exportAllJobsAsJSON(`jobs_monthly_${today()}.json`);

saveTenWeekJsonBtn.onclick = () =>
  exportAllJobsAsJSON(`jobs_10week_${today()}.json`);

/*************************************************
 * WEEKLY REPORT (READ‑ONLY ROLE)
 *************************************************/
saveWeeklyReportBtn.onclick = () => {
  const weeklyJobs = jobs.filter(
    j => j.status === "Completed" && isThisWeek(j.completedAt)
  );

  const perTeacherTotals = {};
  weeklyJobs.forEach(j => {
    perTeacherTotals[j.teacher] =
      (perTeacherTotals[j.teacher] || 0) + j.totalPrintedPages;
  });

  let output = "WEEKLY PRINT REPORT (MON–FRI)\n\n";
  output += `Completed jobs: ${weeklyJobs.length}\n\n`;

  output += "Printed pages per teacher:\n";
  for (const t in perTeacherTotals) {
    output += ` - ${t}: ${perTeacherTotals[t]} pages\n`;
  }

  output += "\nCompleted jobs:\n";
  weeklyJobs.forEach(j => {
    output +=
      `${j.teacher} | Pages: ${j.totalPrintedPages} | ` +
      `Estimated: ${j.estimatedSeconds}s | ` +
      `Actual: ${j.actualSeconds}s | ` +
      `Completed: ${j.completedAt}\n`;
  });

  downloadFile(output, `weekly_report_${today()}.txt`);
};

/*************************************************
 * IMPORT TODO FILE
 *************************************************/
todoFile.addEventListener("change", () => {
  const reader = new FileReader();
  reader.onload = () => {
    reader.result.split(/\r?\n/).filter(Boolean).forEach(line => {
      jobs.push(JSON.parse(line));
    });
    renderQueue();
  };
  reader.readAsText(todoFile.files[0]);
});

/*************************************************
 * RENDER QUEUE
 *************************************************/
function renderQueue() {
  queueDiv.innerHTML = "";

  // ✅ Get sorted *view* of all jobs
  const sortedJobs = getSortedJobs();

  sortedJobs.forEach((job) => {
    // ✅ Weekly report role filter stays unchanged
    if (
      roleSelect.value === "weekly-report" &&
      job.status !== "Completed"
    ) return;

    
const originalIndex = jobs.indexOf(job);

    const jobDiv = document.createElement("div");
    jobDiv.className = "queue-item";
    jobDiv.innerHTML = `
  <table class="queue-table">
    <tbody>
      <tr>
        <th>Teacher</th>
        <td><strong>${job.teacher}</strong></td>
      </tr>
      <tr>
        <th>Status</th>
        <td>${job.status}</td>
      </tr>
      <tr>
        <th>Scheduled for</th>
        <td>${job.scheduledFor || "—"}</td>
      </tr>
      <tr>
        <th>Printed pages</th>
        <td>${job.totalPrintedPages}</td>
      </tr>
      <tr>
        <th>Estimated time</th>
        <td>${job.estimatedSeconds}s</td>
      </tr>
      <tr>
        <th>Actual time</th>
        <td>${job.actualSeconds ?? "—"}</td>
      </tr>
      <tr>
        <th>Started</th>
        <td>${job.startedAt || "—"}</td>
      </tr>
      <tr>
        <th>Completed</th>
        <td>${job.completedAt || "—"}</td>
      </tr>
    </tbody>
  </table>
`;

    jobDiv.className = "job";

    const actionBtn = document.createElement("button");

    if (job.status === "Queued") {
      actionBtn.textContent = "Start";
      actionBtn.onclick = () => handleAdminTaskAction(originalIndex);
    } else if (job.status === "In process") {
      actionBtn.textContent = "Complete";
      actionBtn.onclick = () => handleAdminTaskAction(originalIndex);
    } else {
      actionBtn.textContent = "Completed";
      actionBtn.disabled = true;
    }

    jobDiv.appendChild(actionBtn);
    queueDiv.appendChild(jobDiv);
  });


/*
    const div = document.createElement("div");
    div.className = "queue-item";

    div.innerHTML = `
      <strong>${job.teacher}</strong><br>
      Status: ${job.status}<br>
      Scheduled for: ${job.scheduledFor || "—"}<br>
      Printed pages: ${job.totalPrintedPages}<br>
      Estimated time: ${job.estimatedSeconds}s<br>
      Actual time: ${job.actualSeconds ?? "—"}<br>
      Started: ${job.startedAt || "—"}<br>
      Completed: ${job.completedAt || "—"}
    `;

    if (roleSelect.value === "admin" && job.status !== "Completed") {
      const btn = document.createElement("button");
      btn.textContent =
        job.status === "Queued"
          ? "Start task"
          : "Task in process – Click to complete";
      btn.onclick = () => handleAdminTaskAction(index);
      div.appendChild(btn);
    }

    queueDiv.appendChild(div);
    actionBtn.onclick = () => handleAdminTaskAction(index);
  }
);
*/
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


/*************************************************
 * QUEUE PRIORITISATION
 *************************************************/
function getSortedJobs() {
  const mode = priorityModeSelect?.value || "fifo";

  const sortable = [...jobs];

  switch (mode) {
    case "due":
      sortable.sort((a, b) => {
        if (!a.scheduledFor) return 1;
        if (!b.scheduledFor) return -1;
        return new Date(a.scheduledFor) - new Date(b.scheduledFor);
      });
      break;

    case "size":
      sortable.sort(
        (a, b) => a.totalPrintedPages - b.totalPrintedPages
      );
      break;

    case "fifo":
    default:
      sortable.sort(
        (a, b) => new Date(a.requestedAt) - new Date(b.requestedAt)
      );
  }

  return sortable;
}


priorityModeSelect.addEventListener("change", renderQueue);
