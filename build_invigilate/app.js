class ExamSchedulerApp {
  constructor() {
    this.scheduleData = [];
    this.teachersData = [];
    this.allocationMap = new Map();
    this.currentFilteredData = [];
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadFromStorage();
    this.setupConnectionMonitor();
    this.showSection("dashboard");
    this.updateDashboard();
  }

  setupEventListeners() {
    // Navigation
    document.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        this.showSection(section);
      });
    });

    // File uploads with drag-drop
    ["upload-area-1", "upload-area-2"].forEach((id) => {
      const area = document.getElementById(id);
      const input = area.querySelector('input[type="file"]');

      area.addEventListener("click", () => input.click());

      ["dragenter", "dragover", "dragleave", "drop"].forEach((event) => {
        area.addEventListener(event, (e) => e.preventDefault());
      });

      area.addEventListener("dragover", () => area.classList.add("drag-over"));
      area.addEventListener("dragleave", () =>
        area.classList.remove("drag-over"),
      );
      area.addEventListener("drop", (e) => {
        area.classList.remove("drag-over");
        input.files = e.dataTransfer.files;
      });
    });

    // Modal close on background click
    const modal = document.getElementById("edit-modal");
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });
  }

  showSection(sectionId) {
    document
      .querySelectorAll(".section")
      .forEach((s) => s.classList.add("hidden"));
    document.getElementById(sectionId).classList.remove("hidden");

    document
      .querySelectorAll(".nav-link")
      .forEach((l) => l.classList.remove("active"));
    document
      .querySelector(`[data-section="${sectionId}"]`)
      .classList.add("active");

    const titles = {
      dashboard: "Dashboard",
      upload: "Upload Data",
      schedule: "Exam Schedule",
      allocation: "Teacher Allocation",
      reports: "Reports",
    };
    document.getElementById("section-title").textContent =
      titles[sectionId] || "Dashboard";

    if (sectionId === "schedule") {
      setTimeout(() => {
        this.populateDateFilter();
        this.populateScheduleTable();
      }, 100);
    } else if (sectionId === "dashboard") {
      this.updateDashboard();
    }
  }

  setupConnectionMonitor() {
    const updateStatus = () => {
      const indicator = document.getElementById("connection-status");
      if (navigator.onLine) {
        indicator.className = "connection-indicator online";
        indicator.innerHTML = "<span>Online</span>";
      } else {
        indicator.className = "connection-indicator offline";
        indicator.innerHTML = "<span>Offline</span>";
      }
    };

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    updateStatus();
  }

  /**
   * Process uploaded Excel files
   */
  processUpload() {
    const fileAssignments =
      document.getElementById("file-assignments").files[0];
    const fileTeachers = document.getElementById("file-teachers").files[0];
    const statusDiv = document.getElementById("upload-status");
    const messagesDiv = document.getElementById("upload-messages");

    if (!fileAssignments || !fileTeachers) {
      alert("Please select both files");
      return;
    }

    let messages =
      '<div style="padding: 1rem; background: var(--light-bg); border-radius: 0.375rem;">';
    let filesProcessed = 0;

    // Helper to check if both files are processed
    const checkComplete = () => {
      filesProcessed++;
      if (filesProcessed === 2) {
        messages += "</div>";
        messagesDiv.innerHTML = messages;
        statusDiv.style.display = "block";
        this.saveToStorage();
        this.updateDashboard();
      }
    };

    // Process assignments file
    const readerAssign = new FileReader();
    readerAssign.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        //const data = XLSX.utils.sheet_to_json(sheet);
        const data = DataMappingUtility.parseAssignments();

        // Normalize field names
        this.scheduleData = data.map((row) => ({
          date: row.Date || row.date || "",
          session: row.Session || row.session || 1,
          grade: row.Grade || row.grade || "",
          exam: row.Exam || row.exam || "",
          venue: row["Venue Number"] || row["Venue"] || row.venue || "",
          timeshift: parseFloat(
            row.TimeShift || row["Time Shift"] || row.timeshift || 0,
          ),
          educator: row.Educator || row.educator || null,
          is_zulu:
            (row["Is Zulu"] || row.is_zulu || "false")
              .toString()
              .toLowerCase() === "true",
        }));

        messages += `<p class="success"><i class="fas fa-check"></i> Loaded ${data.length} schedule entries</p>`;
        checkComplete();
      } catch (error) {
        messages += `<p class="danger"><i class="fas fa-times"></i> Error reading assignments: ${error.message}</p>`;
        checkComplete();
      }
    };
    readerAssign.onerror = () => {
      messages += `<p class="danger"><i class="fas fa-times"></i> Error reading assignments file</p>`;
      checkComplete();
    };
    readerAssign.readAsArrayBuffer(fileAssignments);

    // Process teachers file
    const readerTeach = new FileReader();
    readerTeach.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        //const data = XLSX.utils.sheet_to_json(sheet);
        const data = DataMappingUtility.parseTeachers();

        // Normalize field names
        this.teachersData = data
          .map((row) => ({
            name: row.Educator || row.Name || row.name || "",
            registerClass:
              row["Register class"] ||
              row["Register Class"] ||
              row.registerClass ||
              "",
            learners: parseInt(row.Learners || row.learners || 0),
            is_zulu:
              (row.Zulu || row["Is Zulu"] || row.is_zulu || "false")
                .toString()
                .toLowerCase() === "true",
          }))
          .filter((t) => t.name);

        messages += `<p class="success"><i class="fas fa-check"></i> Loaded ${data.length} teachers</p>`;
        checkComplete();
      } catch (error) {
        messages += `<p class="danger"><i class="fas fa-times"></i> Error reading teachers: ${error.message}</p>`;
        checkComplete();
      }
    };
    readerTeach.onerror = () => {
      messages += `<p class="danger"><i class="fas fa-times"></i> Error reading teachers file</p>`;
      checkComplete();
    };
    readerTeach.readAsArrayBuffer(fileTeachers);
  }

  /**
   * Filter and re-display schedule
   */
  filterSchedule() {
    this.populateScheduleTable();
  }

  /**
   * Populate date filter dropdown
   */
  populateDateFilter() {
    const select = document.getElementById("filter-date");
    // Clear existing options except the first
    while (select.options.length > 1) {
      select.remove(1);
    }

    const dates = [
      ...new Set(this.scheduleData.map((d) => d.date).filter(Boolean)),
    ].sort();

    dates.forEach((date) => {
      const opt = document.createElement("option");
      opt.value = date;
      opt.textContent = new Date(date + "T00:00").toLocaleDateString();
      select.appendChild(opt);
    });
  }

  /**
   * Populate schedule table with optional filters
   */
  populateScheduleTable() {
    const dateVal = document.getElementById("filter-date")?.value || "";
    const gradeVal = document.getElementById("filter-grade")?.value || "";

    let filtered = this.scheduleData;
    if (dateVal) {
      filtered = filtered.filter((d) => d.date === dateVal);
    }
    if (gradeVal) {
      filtered = filtered.filter((d) => String(d.grade) === String(gradeVal));
    }

    this.currentFilteredData = filtered;

    const tbody = document.getElementById("schedule-body");
    if (!filtered || filtered.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="text-center text-muted">No schedule data loaded</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map((row, dispIdx) => {
        const actualIdx = this.scheduleData.indexOf(row);
        const assigned = row.educator || this.allocationMap.get(actualIdx);
        const status = assigned
          ? '<span class="badge badge-assigned">✓ Assigned</span>'
          : '<span class="badge badge-unassigned">✗ Unassigned</span>';

        const dateObj = new Date(row.date + "T00:00");
        const dateStr = isNaN(dateObj.getTime())
          ? row.date
          : dateObj.toLocaleDateString();

        return `
                        <tr>
                            <td>${dateStr}</td>
                            <td>${row.session || "-"}</td>
                            <td>${row.grade || "-"}</td>
                            <td>${row.exam || "-"}</td>
                            <td>${row.venue || "-"}</td>
                            <td>${row.timeshift || "-"}</td>
                            <td><strong>${assigned || '<em class="text-muted">Unassigned</em>'}</strong></td>
                            <td>${status}</td>
                            <td><button class="btn btn-primary btn-small" onclick="app.openAllocationModal(${actualIdx})" title="Assign teacher"><i class="fas fa-edit"></i></button></td>
                        </tr>
                    `;
      })
      .join("");
  }

  /**
   * Open modal for assigning teacher to slot
   */
  openAllocationModal(idx) {
    if (!this.scheduleData[idx]) {
      alert("Invalid assignment index");
      return;
    }

    const row = this.scheduleData[idx];
    const currentAssigned = row.educator || this.allocationMap.get(idx) || "";
    const availableTeachers = [
      ...new Set(this.teachersData.map((t) => t.name).filter(Boolean)),
    ];

    const dateObj = new Date(row.date + "T00:00");
    const dateStr = isNaN(dateObj.getTime())
      ? row.date
      : dateObj.toLocaleDateString();

    const html = `
                    <div class="form-group">
                        <label class="form-label"><strong>Exam Details</strong></label>
                        <p style="margin: 0.5rem 0;"><strong>Date:</strong> ${dateStr}</p>
                        <p style="margin: 0.5rem 0;"><strong>Session:</strong> ${row.session}</p>
                        <p style="margin: 0.5rem 0;"><strong>Grade:</strong> ${row.grade}</p>
                        <p style="margin: 0.5rem 0;"><strong>Exam:</strong> ${row.exam}</p>
                        <p style="margin: 0.5rem 0;"><strong>Venue:</strong> ${row.venue}</p>
                        <p style="margin: 0.5rem 0;"><strong>Duration:</strong> ${row.timeshift} hours</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="teacher-select">Assign Teacher</label>
                        <select id="teacher-select" class="form-input">
                            <option value="">-- Unassigned --</option>
                            ${availableTeachers
                              .map((t) => {
                                const selected =
                                  currentAssigned === t ? "selected" : "";
                                return `<option value="${t}" ${selected}>${t}</option>`;
                              })
                              .join("")}
                        </select>
                    </div>
                    <div style="display: flex; gap: 1rem;">
                        <button class="btn btn-primary" onclick="app.saveAllocation(${idx}, document.getElementById('teacher-select').value)">
                            <i class="fas fa-save"></i> Save
                        </button>
                        <button class="btn btn-outline" onclick="app.closeModal()">Cancel</button>
                    </div>
                `;

    document.getElementById("modal-body").innerHTML = html;
    document.getElementById("edit-modal").classList.add("show");

    // Focus on dropdown
    setTimeout(() => {
      document.getElementById("teacher-select").focus();
    }, 100);
  }

  /**
   * Save allocation for a slot
   */
  saveAllocation(idx, teacher) {
    if (teacher) {
      this.allocationMap.set(idx, teacher);
      this.scheduleData[idx].educator = teacher;
    }
    this.saveToStorage();
    this.updateDashboard();
    this.populateScheduleTable();
    this.closeModal();
  }

  /**
   * Close allocation modal
   */
  closeModal() {
    document.getElementById("edit-modal").classList.remove("show");
  }

  /**
   * Auto-allocate teachers to unassigned slots using advanced or basic algorithm
   */
  autoAllocate() {
    if (this.scheduleData.length === 0) {
      notifications.error("No schedule data loaded");
      return;
    }

    if (this.teachersData.length === 0) {
      notifications.error("No teachers available");
      return;
    }

    const unassignedCount = this.scheduleData.filter(
      (row, idx) => !row.educator && !this.allocationMap.get(idx),
    ).length;

    if (unassignedCount === 0) {
      notifications.warning("All slots are already assigned");
      return;
    }

    const resultsDiv = document.getElementById("allocation-results");
    resultsDiv.innerHTML = `
                    <div style="padding: 1rem; background: rgba(13,148,136,0.1); border-radius: 0.375rem; border-left: 4px solid var(--accent); color: var(--primary);">
                        <p><i class="fas fa-spinner fa-spin"></i> Running allocation algorithm...</p>
                        <p style="font-size: 0.9rem; color: var(--text-light); margin-top: 0.5rem;">Processing ${unassignedCount} unassigned slots...</p>
                    </div>
                `;

    // Try advanced scheduling if available
    setTimeout(() => {
      const useAdvanced = typeof window.scheduleAssignments === "function";

      if (useAdvanced) {
        this.autoAllocateAdvanced();
      } else {
        this.autoAllocateBasic();
      }
    }, 100);
  }

  /**
   * Advanced allocation using scheduling engine
   */
  autoAllocateAdvanced() {
    try {
      // Prepare data for scheduling engine
      const assignmentsCopy = utilities.deepClone(this.scheduleData);
      const teachersCopy = utilities.deepClone(this.teachersData);

      // Ensure proper field naming for engine
      assignmentsCopy.forEach((a, idx) => {
        a.date = a.date || "";
        a.session = parseInt(a.session || 1);
        a.grade = a.grade || "";
        a.exam = a.exam || "";
        a.venue = a.venue || "";
        a.timeshift = parseFloat(a.timeshift || 0);
        a.educator = a.educator || null;
        a.is_zulu = a.is_zulu || false;
      });

      teachersCopy.forEach((t) => {
        t.registerClass = t.registerClass || "";
        t.is_zulu = t.is_zulu || false;
      });

      // Run scheduling algorithm
      const result = window.scheduleAssignments(assignmentsCopy, teachersCopy, {
        enableLoadBalancing: true,
        maxConflictIterations: 5,
      });

      if (result && result.status !== "failed") {
        // Apply results
        let allocated = 0;
        result.assignments.forEach((assignment, idx) => {
          if (assignment.educator && !this.scheduleData[idx].educator) {
            this.allocationMap.set(idx, assignment.educator);
            this.scheduleData[idx].educator = assignment.educator;
            allocated++;
          }
        });

        const resultsDiv = document.getElementById("allocation-results");
        const stats = result.statistics || {};
        const successRate = stats.assignmentPercentage || 0;

        resultsDiv.innerHTML = `
                            <div style="padding: 1rem; background: rgba(5,150,105,0.1); border-radius: 0.375rem; border-left: 4px solid var(--success);">
                                <p class="success"><i class="fas fa-check-circle"></i> <strong>Advanced Allocation Completed!</strong></p>
                                <p><strong>${allocated}</strong> teachers allocated to unassigned slots</p>
                                <p style="font-size: 0.9rem; color: var(--text-light); margin-top: 0.5rem;">
                                    Success Rate: <strong>${successRate}%</strong> | 
                                    Total Assigned: <strong>${stats.assignedSlots || 0}/${stats.totalSlots || 0}</strong>
                                </p>
                                ${
                                  result.warnings && result.warnings.length > 0
                                    ? `
                                <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(5,150,105,0.2);">
                                    <p style="font-size: 0.85rem; color: #d97706;"><i class="fas fa-exclamation-triangle"></i> ${result.warnings.length} warning(s)</p>
                                </div>
                                `
                                    : ""
                                }
                            </div>
                        `;

        notifications.success(
          `Allocated ${allocated} slots using advanced algorithm`,
        );
      } else {
        throw new Error(result?.report || "Scheduling algorithm failed");
      }
    } catch (error) {
      console.error("Advanced allocation failed:", error);
      notifications.warning(
        "Advanced algorithm failed, using basic allocation...",
      );
      this.autoAllocateBasic();
      return;
    }

    this.saveToStorage();
    this.updateDashboard();
  }

  /**
   * Basic allocation using workload balancing
   */
  autoAllocateBasic() {
    const unassignedIndices = [];
    this.scheduleData.forEach((row, idx) => {
      if (!row.educator && !this.allocationMap.get(idx)) {
        unassignedIndices.push(idx);
      }
    });

    const availableTeachers = [
      ...new Set(this.teachersData.map((t) => t.name).filter(Boolean)),
    ];

    if (availableTeachers.length === 0) {
      notifications.error("No teachers available");
      return;
    }

    let allocated = 0;
    const workloadMap = {};

    // Initialize workload map
    availableTeachers.forEach((t) => {
      workloadMap[t] = 0;
    });

    // Count existing assignments
    this.scheduleData.forEach((row, idx) => {
      const assigned = row.educator || this.allocationMap.get(idx);
      if (assigned && workloadMap.hasOwnProperty(assigned)) {
        workloadMap[assigned] += row.timeshift || 0;
      }
    });

    // Assign unassigned slots to least loaded teachers
    unassignedIndices.forEach((idx) => {
      const row = this.scheduleData[idx];

      // Find least loaded teacher with matching grade if possible
      const matchingTeachers = this.teachersData
        .filter(
          (t) =>
            t.registerClass === "ROTATE" ||
            t.registerClass === row.grade ||
            availableTeachers.includes(t.name),
        )
        .map((t) => t.name);

      let bestTeacher = null;
      let minLoad = Infinity;

      (matchingTeachers.length > 0
        ? matchingTeachers
        : availableTeachers
      ).forEach((teacher) => {
        const load = workloadMap[teacher] || 0;
        if (load < minLoad) {
          minLoad = load;
          bestTeacher = teacher;
        }
      });

      if (bestTeacher) {
        this.allocationMap.set(idx, bestTeacher);
        this.scheduleData[idx].educator = bestTeacher;
        workloadMap[bestTeacher] =
          (workloadMap[bestTeacher] || 0) + (row.timeshift || 0);
        allocated++;
      }
    });

    const resultsDiv = document.getElementById("allocation-results");
    resultsDiv.innerHTML = `
                    <div style="padding: 1rem; background: rgba(5,150,105,0.1); border-radius: 0.375rem; border-left: 4px solid var(--success);">
                        <p class="success"><i class="fas fa-check-circle"></i> <strong>Auto-allocation completed!</strong></p>
                        <p>Allocated <strong>${allocated}</strong> teachers to unassigned slots</p>
                        <p style="font-size: 0.9rem; color: var(--text-light); margin-top: 0.5rem;">Allocation is based on workload balancing (least-loaded first).</p>
                    </div>
                `;

    notifications.success(`Allocated ${allocated} slots`);
    this.saveToStorage();
    this.updateDashboard();
  }

  /**
   * Update dashboard statistics
   */
  updateDashboard() {
    const total = this.scheduleData.length;
    const assigned = this.scheduleData.filter(
      (d, idx) => d.educator || this.allocationMap.get(idx),
    ).length;
    const teachers = new Set(
      this.teachersData.map((t) => t.name).filter(Boolean),
    ).size;

    document.getElementById("stat-total-slots").textContent = total;
    document.getElementById("stat-assigned").textContent = assigned;
    document.getElementById("stat-unassigned").textContent = total - assigned;
    document.getElementById("stat-teachers").textContent = teachers;

    this.populateRecentAssignments();
  }

  /**
   * Populate recent assignments in dashboard
   */
  populateRecentAssignments() {
    const tbody = document.getElementById("recent-assignments");
    const recent = this.scheduleData.slice(0, 5);

    if (recent.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted">No data loaded</td></tr>';
      return;
    }

    tbody.innerHTML = recent
      .map((row, idx) => {
        const assigned = row.educator || this.allocationMap.get(idx);
        const status = assigned
          ? '<span class="badge badge-assigned">✓ Assigned</span>'
          : '<span class="badge badge-unassigned">✗ Unassigned</span>';

        const dateObj = new Date(row.date + "T00:00");
        const dateStr = isNaN(dateObj.getTime())
          ? row.date
          : dateObj.toLocaleDateString();

        return `
                        <tr>
                            <td>${dateStr}</td>
                            <td>${row.exam || "-"}</td>
                            <td>${row.venue || "-"}</td>
                            <td><strong>${assigned || "-"}</strong></td>
                            <td>${status}</td>
                        </tr>
                    `;
      })
      .join("");
  }

  /**
   * Export schedule to Excel
   */
  exportSchedule() {
    if (this.scheduleData.length === 0) {
      alert("No data to export");
      return;
    }

    const data = this.scheduleData.map((row, idx) => ({
      Date: row.date,
      Session: row.session,
      Grade: row.grade,
      Exam: row.exam,
      Venue: row.venue,
      "Duration (hrs)": row.timeshift,
      Educator: row.educator || this.allocationMap.get(idx) || "Unassigned",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Schedule");
    XLSX.writeFile(
      wb,
      `exam-schedule-${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  }

  /**
   * Export allocations with teacher details
   */
  exportAllocation() {
    if (this.scheduleData.length === 0) {
      alert("No data to export");
      return;
    }

    const data = this.scheduleData.map((row, idx) => {
      const educator =
        row.educator || this.allocationMap.get(idx) || "Unassigned";
      const teacher = this.teachersData.find((t) => t.name === educator);

      return {
        Date: row.date,
        Session: row.session,
        Grade: row.grade,
        Exam: row.exam,
        Venue: row.venue,
        "Duration (hrs)": row.timeshift,
        Teacher: educator,
        "Teacher Grade": teacher?.registerClass || "-",
        Status: educator !== "Unassigned" ? "Assigned" : "Unassigned",
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Allocations");
    XLSX.writeFile(
      wb,
      `allocations-${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  }

  /**
   * Export teacher list with assignments
   */
  exportTeacherList() {
    if (this.teachersData.length === 0) {
      alert("No teachers to export");
      return;
    }

    const data = this.teachersData.map((teacher) => {
      const assignments = this.scheduleData.filter((row, idx) => {
        const assigned = row.educator || this.allocationMap.get(idx);
        return assigned === teacher.name;
      });

      const totalHours = assignments.reduce(
        (sum, a) => sum + (a.timeshift || 0),
        0,
      );

      return {
        "Teacher Name": teacher.name,
        "Register Class": teacher.registerClass,
        Assignments: assignments.length,
        "Total Hours": totalHours,
        "Is Zulu": teacher.is_zulu ? "Yes" : "No",
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Teachers");
    XLSX.writeFile(
      wb,
      `teachers-${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  }

  /**
   * Print schedule to PDF
   */
  printSchedule() {
    if (this.scheduleData.length === 0) {
      alert("No data to print");
      return;
    }

    const win = window.open("", "", "width=1200,height=800");
    const style = `
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        h1 { text-align: center; color: #1e3a5f; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th { background: #1e3a5f; color: white; padding: 10px; text-align: left; }
                        td { border: 1px solid #ddd; padding: 8px; }
                        tr:nth-child(even) { background: #f8f9fa; }
                    </style>
                `;

    let html = `<h1>Exam Schedule</h1><p>Generated: ${new Date().toLocaleString()}</p>`;
    html +=
      "<table><thead><tr><th>Date</th><th>Session</th><th>Grade</th><th>Exam</th><th>Venue</th><th>Duration</th><th>Teacher</th></tr></thead><tbody>";

    this.scheduleData.forEach((row, idx) => {
      const teacher =
        row.educator || this.allocationMap.get(idx) || "Unassigned";
      html += `<tr><td>${row.date}</td><td>${row.session}</td><td>${row.grade}</td><td>${row.exam}</td><td>${row.venue}</td><td>${row.timeshift}h</td><td>${teacher}</td></tr>`;
    });

    html += "</tbody></table>";
    win.document.write(style + html);
    win.document.close();
    win.print();
  }

  /**
   * Refresh data from storage
   */
  refreshData() {
    this.loadFromStorage();
    this.updateDashboard();
  }

  /**
   * Save data to localStorage
   */
  saveToStorage() {
    try {
      localStorage.setItem("scheduleData", JSON.stringify(this.scheduleData));
      localStorage.setItem("teachersData", JSON.stringify(this.teachersData));
      localStorage.setItem(
        "allocationMap",
        JSON.stringify(Array.from(this.allocationMap.entries())),
      );
    } catch (error) {
      console.error("Error saving to storage:", error);
    }
  }

  /**
   * Load data from localStorage
   */
  loadFromStorage() {
    try {
      const schedule = localStorage.getItem("scheduleData");
      const teachers = localStorage.getItem("teachersData");
      const allocations = localStorage.getItem("allocationMap");

      if (schedule) this.scheduleData = JSON.parse(schedule);
      if (teachers) this.teachersData = JSON.parse(teachers);
      if (allocations) this.allocationMap = new Map(JSON.parse(allocations));
    } catch (error) {
      console.error("Error loading from storage:", error);
    }
  }
}

const app = new ExamSchedulerApp();
window.app = app;
