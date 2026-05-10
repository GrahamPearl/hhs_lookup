// viewer-reports.js — Report framework and report definitions

const ViewerReports = (() => {
  // ── REPORT FRAMEWORK ──────────────────────────────────────
  const FRAMEWORK = {
    // Report lifecycle: generateData → renderTable → renderChart → export
    createReport(spec) {
      return {
        id: spec.id,
        title: spec.title,
        description: spec.description,
        category: spec.category || "Custom",
        hasChart: spec.hasChart !== false,
        chartType: spec.chartType || "bar", // bar|line|pie
        hasPagination: spec.hasPagination !== false,
        defaultPageSize: spec.defaultPageSize || 50,
        generateData: spec.generateData,
        renderTable: spec.renderTable,
        renderChart: spec.renderChart || null,
        exportToExcel: spec.exportToExcel || null,
        exportToCSV: spec.exportToCSV || null,
      };
    },
  };

  // ── UTILITY FUNCTIONS ────────────────────────────────────────
  function groupBy(arr, key) {
    return arr.reduce((acc, obj) => {
      const groupKey = obj[key] || "Unknown";
      if (!acc[groupKey]) acc[groupKey] = [];
      acc[groupKey].push(obj);
      return acc;
    }, {});
  }

  function countBy(arr, key) {
    const counts = {};
    arr.forEach((obj) => {
      const val = obj[key] || "Unknown";
      counts[val] = (counts[val] || 0) + 1;
    });
    return counts;
  }

  function getDateRange(startDate, endDate, data) {
    // Identify holidays (days with no absences in the range)
    if (!startDate || !endDate) return { holidays: [] };
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    const existingDates = new Set(data.map((r) => r.date));
    const holidays = [];
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      if (!existingDates.has(dateStr)) {
        holidays.push(dateStr);
      }
    }
    
    return { holidays };
  }

  function getDayOfWeek(dateStr) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[new Date(dateStr).getDay()];
  }

  // ── REPORT DEFINITIONS ────────────────────────────────────────

  // A1: Individual Teacher Absence Profile
  const reportA1 = FRAMEWORK.createReport({
    id: "a1-teacher-absence-profile",
    title: "A1: Individual Teacher Absence Profile",
    description: "Absence frequency, patterns, and reasons for each teacher",
    category: "A",
    chartType: "bar",
    hasPagination: true,
    defaultPageSize: 50,

    generateData(filteredData) {
      const byTeacher = groupBy(filteredData, "coveredTeacher");
      const results = [];

      for (const [teacher, records] of Object.entries(byTeacher)) {
        const dayOfWeekCounts = {};
        const reasonCounts = countBy(records, "absentReason");
        let lastAbsenceDate = null;

        records.forEach((r) => {
          const dow = getDayOfWeek(r.date);
          dayOfWeekCounts[dow] = (dayOfWeekCounts[dow] || 0) + 1;
          if (!lastAbsenceDate || new Date(r.date) > new Date(lastAbsenceDate)) {
            lastAbsenceDate = r.date;
          }
        });

        const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];
        const mostFrequentDay = Object.entries(dayOfWeekCounts).sort(
          (a, b) => b[1] - a[1]
        )[0];

        results.push({
          teacher,
          totalAbsences: records.length,
          lastAbsenceDate,
          topReason: topReason ? topReason[0] : "—",
          topReasonCount: topReason ? topReason[1] : 0,
          mostFrequentDay: mostFrequentDay ? mostFrequentDay[0] : "—",
          dayOfWeekPattern: dayOfWeekCounts,
          allReasons: reasonCounts,
        });
      }

      return {
        title: "Individual Teacher Absence Profile",
        timestamp: new Date().toLocaleString(),
        recordCount: filteredData.length,
        uniqueTeachers: results.length,
        data: results.sort((a, b) => b.totalAbsences - a.totalAbsences),
      };
    },

    renderTable(reportData, page = 1) {
      const pageSize = 50;
      const startIdx = (page - 1) * pageSize;
      const pageData = reportData.data.slice(startIdx, startIdx + pageSize);
      const totalPages = Math.ceil(reportData.data.length / pageSize);

      let html = `
        <table class="table table-sm table-striped">
          <thead class="table-light">
            <tr>
              <th>Teacher</th>
              <th class="text-center">Total Absences</th>
              <th>Most Common Reason</th>
              <th class="text-center">Reason Count</th>
              <th>Most Frequent Day</th>
              <th>Last Absence</th>
            </tr>
          </thead>
          <tbody>
            ${pageData
              .map(
                (t) => `
              <tr>
                <td><strong>${t.teacher}</strong></td>
                <td class="text-center"><badge class="badge bg-primary">${t.totalAbsences}</badge></td>
                <td><small>${t.topReason}</small></td>
                <td class="text-center"><small>${t.topReasonCount}</small></td>
                <td><small>${t.mostFrequentDay}</small></td>
                <td><small>${t.lastAbsenceDate || "—"}</small></td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
        <nav class="mt-3">
          <small class="text-muted">Page ${page} of ${totalPages} (Showing ${pageData.length} of ${reportData.data.length} teachers)</small>
        </nav>
      `;
      return html;
    },

    renderChart(reportData) {
      // Top 10 absent teachers (horizontal bar chart)
      const topTeachers = reportData.data.slice(0, 10);
      return ViewerCharts.barChartHorizontal(
        topTeachers.map((t) => ({
          label: t.teacher.substring(0, 30),
          value: t.totalAbsences,
        })),
        "Top 10 Absent Teachers"
      );
    },
  });

  // A2: Cover Teacher Workload Analysis
  const reportA2 = FRAMEWORK.createReport({
    id: "a2-cover-teacher-workload",
    title: "A2: Cover Teacher Workload Analysis",
    description: "Coverage load, subject diversity, and department distribution",
    category: "A",
    chartType: "bar",
    hasPagination: true,
    defaultPageSize: 50,

    generateData(filteredData) {
      const byCoverTeacher = groupBy(filteredData, "coverTeacher");
      const results = [];

      for (const [teacher, records] of Object.entries(byCoverTeacher)) {
        const subjectSet = new Set(records.map((r) => r.subject).filter(Boolean));
        const departmentCounts = countBy(records, "subject");
        const periodCounts = countBy(records, "period");

        results.push({
          coverTeacher: teacher,
          periodsCovered: records.length,
          uniqueSubjects: subjectSet.size,
          subjects: Array.from(subjectSet),
          departmentDistribution: departmentCounts,
          periodDistribution: periodCounts,
          avgPeriodsPerSubject: (records.length / subjectSet.size).toFixed(1),
        });
      }

      return {
        title: "Cover Teacher Workload Analysis",
        timestamp: new Date().toLocaleString(),
        recordCount: filteredData.length,
        totalCoverTeachers: results.length,
        avgPeriodsCovered: (filteredData.length / results.length).toFixed(1),
        data: results.sort((a, b) => b.periodsCovered - a.periodsCovered),
      };
    },

    renderTable(reportData, page = 1) {
      const pageSize = 50;
      const startIdx = (page - 1) * pageSize;
      const pageData = reportData.data.slice(startIdx, startIdx + pageSize);
      const totalPages = Math.ceil(reportData.data.length / pageSize);

      let html = `
        <table class="table table-sm table-striped">
          <thead class="table-light">
            <tr>
              <th>Cover Teacher</th>
              <th class="text-center">Periods Covered</th>
              <th class="text-center">Unique Subjects</th>
              <th>Subjects Taught</th>
              <th class="text-center">Avg Periods/Subject</th>
            </tr>
          </thead>
          <tbody>
            ${pageData
              .map(
                (ct) => `
              <tr>
                <td><strong>${ct.coverTeacher}</strong></td>
                <td class="text-center"><badge class="badge bg-success">${ct.periodsCovered}</badge></td>
                <td class="text-center">${ct.uniqueSubjects}</td>
                <td><small>${ct.subjects.join(", ") || "—"}</small></td>
                <td class="text-center"><small>${ct.avgPeriodsPerSubject}</small></td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
        <nav class="mt-3">
          <small class="text-muted">Page ${page} of ${totalPages} (Showing ${pageData.length} of ${reportData.data.length} cover teachers)</small>
        </nav>
      `;
      return html;
    },

    renderChart(reportData) {
      // Top 10 cover teachers by workload
      const topCover = reportData.data.slice(0, 10);
      return ViewerCharts.barChartHorizontal(
        topCover.map((ct) => ({
          label: ct.coverTeacher.substring(0, 30),
          value: ct.periodsCovered,
        })),
        "Top 10 Cover Teachers by Workload"
      );
    },
  });

  // B3: Absence Trend Report (with holiday detection)
  const reportB3 = FRAMEWORK.createReport({
    id: "b3-absence-trend",
    title: "B3: Absence Trend Report",
    description: "Daily/weekly absence trends with holiday detection",
    category: "B",
    chartType: "line",
    hasPagination: false,

    generateData(filteredData) {
      if (filteredData.length === 0) {
        return {
          title: "Absence Trend Report",
          timestamp: new Date().toLocaleString(),
          recordCount: 0,
          data: [],
          dailyTrend: [],
          holidays: [],
          reasonBreakdown: {},
        };
      }

      // Group by date
      const byDate = groupBy(filteredData, "date");
      const sortedDates = Object.keys(byDate).sort();
      
      // Identify holidays (gaps in absence data)
      const startDate = sortedDates[0];
      const endDate = sortedDates[sortedDates.length - 1];
      const dateRange = getDateRange(startDate, endDate, filteredData);
      
      // Build daily trend
      const dailyTrend = sortedDates.map((date) => {
        const records = byDate[date];
        return {
          date,
          absenceCount: records.length,
          dow: getDayOfWeek(date),
          uniqueTeachers: new Set(records.map((r) => r.coveredTeacher)).size,
        };
      });

      // Weekly aggregation
      const weeklyData = {};
      dailyTrend.forEach((d) => {
        const dateObj = new Date(d.date);
        const weekStart = new Date(dateObj.setDate(dateObj.getDate() - dateObj.getDay()));
        const weekKey = weekStart.toISOString().split("T")[0];
        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = { absenceCount: 0, recordCount: 0 };
        }
        weeklyData[weekKey].absenceCount += d.absenceCount;
        weeklyData[weekKey].recordCount += 1;
      });

      // Reason breakdown
      const reasonCounts = countBy(filteredData, "absentReason");

      return {
        title: "Absence Trend Report",
        timestamp: new Date().toLocaleString(),
        recordCount: filteredData.length,
        dateRange: { start: startDate, end: endDate },
        data: filteredData,
        dailyTrend,
        weeklyData: Object.entries(weeklyData).map(([week, data]) => ({
          week,
          ...data,
        })),
        holidays: dateRange.holidays,
        reasonBreakdown: reasonCounts,
      };
    },

    renderTable(reportData) {
      const holidays = reportData.holidays;
      let html = `
        <div class="mb-3">
          <h6>📅 Daily Absence Trend</h6>
          <table class="table table-sm table-striped">
            <thead class="table-light">
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th class="text-center">Absences</th>
                <th class="text-center">Unique Teachers</th>
              </tr>
            </thead>
            <tbody>
              ${reportData.dailyTrend
                .map(
                  (d) => `
                <tr>
                  <td>${d.date}</td>
                  <td>${d.dow}</td>
                  <td class="text-center">${d.absenceCount}</td>
                  <td class="text-center">${d.uniqueTeachers}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>

        <div class="mb-3">
          <h6>🏖️ Identified Holidays (Days with no absences)</h6>
          <small class="text-muted">${
            holidays.length > 0
              ? holidays.join(", ")
              : "No holiday gaps detected in selected range."
          }</small>
        </div>

        <div>
          <h6>📊 Reason Breakdown (in trend period)</h6>
          <table class="table table-sm table-striped">
            <thead class="table-light">
              <tr>
                <th>Reason</th>
                <th class="text-center">Count</th>
                <th class="text-center">%</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(reportData.reasonBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(
                  ([reason, count]) => `
                <tr>
                  <td>${reason}</td>
                  <td class="text-center">${count}</td>
                  <td class="text-center">${((count / reportData.recordCount) * 100).toFixed(1)}%</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
      return html;
    },

    renderChart(reportData) {
      return ViewerCharts.lineChart(
        reportData.dailyTrend.map((d) => ({
          label: d.date,
          value: d.absenceCount,
        })),
        "Absence Trend Over Time"
      );
    },
  });

  // B4: Absence Reason Analysis
  const reportB4 = FRAMEWORK.createReport({
    id: "b4-absence-reason-analysis",
    title: "B4: Absence Reason Analysis",
    description: "Detailed breakdown of all absence reasons",
    category: "B",
    chartType: "bar",
    hasPagination: true,
    defaultPageSize: 50,

    generateData(filteredData) {
      const byReason = groupBy(filteredData, "absentReason");
      const results = [];

      for (const [reason, records] of Object.entries(byReason)) {
        const teacherSet = new Set(records.map((r) => r.coveredTeacher));
        const teacherCounts = countBy(records, "coveredTeacher");
        const topTeacher = Object.entries(teacherCounts).sort((a, b) => b[1] - a[1])[0];

        results.push({
          reason,
          count: records.length,
          percentage: ((records.length / filteredData.length) * 100).toFixed(1),
          uniqueTeachers: teacherSet.size,
          topTeacher: topTeacher ? topTeacher[0] : "—",
          topTeacherCount: topTeacher ? topTeacher[1] : 0,
          dateRange: {
            first: records.reduce((min, r) => (r.date < min ? r.date : min), "9999-12-31"),
            last: records.reduce((max, r) => (r.date > max ? r.date : max), "0000-01-01"),
          },
        });
      }

      return {
        title: "Absence Reason Analysis",
        timestamp: new Date().toLocaleString(),
        recordCount: filteredData.length,
        uniqueReasons: results.length,
        data: results.sort((a, b) => b.count - a.count),
      };
    },

    renderTable(reportData, page = 1) {
      const pageSize = 50;
      const startIdx = (page - 1) * pageSize;
      const pageData = reportData.data.slice(startIdx, startIdx + pageSize);
      const totalPages = Math.ceil(reportData.data.length / pageSize);

      let html = `
        <table class="table table-sm table-striped">
          <thead class="table-light">
            <tr>
              <th>Reason</th>
              <th class="text-center">Count</th>
              <th class="text-center">%</th>
              <th class="text-center">Unique Teachers</th>
              <th>Most Cited By</th>
              <th>Date Range</th>
            </tr>
          </thead>
          <tbody>
            ${pageData
              .map(
                (r) => `
              <tr>
                <td>${r.reason}</td>
                <td class="text-center"><badge class="badge bg-warning text-dark">${r.count}</badge></td>
                <td class="text-center">${r.percentage}%</td>
                <td class="text-center">${r.uniqueTeachers}</td>
                <td><small>${r.topTeacher} (${r.topTeacherCount}x)</small></td>
                <td><small>${r.dateRange.first} to ${r.dateRange.last}</small></td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
        <nav class="mt-3">
          <small class="text-muted">Page ${page} of ${totalPages} (Showing ${pageData.length} of ${reportData.data.length} reasons)</small>
        </nav>
      `;
      return html;
    },

    renderChart(reportData) {
      // Top 10 reasons
      const topReasons = reportData.data.slice(0, 10);
      return ViewerCharts.barChartHorizontal(
        topReasons.map((r) => ({
          label: r.reason.substring(0, 30),
          value: r.count,
        })),
        "Top Absence Reasons"
      );
    },
  });

  // C5: Coverage Gap Report
  const reportC5 = FRAMEWORK.createReport({
    id: "c5-coverage-gap",
    title: "C5: Coverage Gap Report",
    description: "Identify absences without adequate cover",
    category: "C",
    chartType: null, // Summary metrics, no chart
    hasPagination: false,

    generateData(filteredData) {
      // Absences without cover teacher
      const gapsNoTeacher = filteredData.filter((r) => !r.coverTeacher || r.coverTeacher.trim() === "");
      
      // Count multi-absence days
      const byDate = groupBy(filteredData, "date");
      const multiAbsenceDays = Object.entries(byDate)
        .filter(([_, records]) => records.length > 2)
        .map(([date, records]) => ({
          date,
          absenceCount: records.length,
          uniqueTeachers: new Set(records.map((r) => r.coveredTeacher)).size,
        }))
        .sort((a, b) => b.absenceCount - a.absenceCount);

      const coveredCount = filteredData.filter((r) => r.coverTeacher && r.coverTeacher.trim()).length;
      const uncoveredCount = gapsNoTeacher.length;
      const coverageRate = filteredData.length > 0 
        ? ((coveredCount / filteredData.length) * 100).toFixed(1)
        : 0;

      return {
        title: "Coverage Gap Report",
        timestamp: new Date().toLocaleString(),
        recordCount: filteredData.length,
        summary: {
          totalAbsences: filteredData.length,
          covered: coveredCount,
          uncovered: uncoveredCount,
          coverageRate: `${coverageRate}%`,
          multiAbsenceDays: multiAbsenceDays.length,
        },
        uncoveredRecords: gapsNoTeacher,
        multiAbsenceDays: multiAbsenceDays.slice(0, 20),
      };
    },

    renderTable(reportData) {
      const { summary, uncoveredRecords, multiAbsenceDays } = reportData;

      let html = `
        <div class="alert alert-info mb-3">
          <h6 class="mb-2">📊 Coverage Summary</h6>
          <table class="table table-sm table-borderless mb-0">
            <tr>
              <td><strong>Total Absences:</strong></td>
              <td>${summary.totalAbsences}</td>
            </tr>
            <tr>
              <td><strong>Covered:</strong></td>
              <td class="text-success">${summary.covered}</td>
            </tr>
            <tr>
              <td><strong>Uncovered (Gap):</strong></td>
              <td class="text-danger"><strong>${summary.uncovered}</strong></td>
            </tr>
            <tr>
              <td><strong>Coverage Rate:</strong></td>
              <td><strong>${summary.coverageRate}</strong></td>
            </tr>
          </table>
        </div>

        <div class="mb-3">
          <h6>⚠️ Uncovered Absences (${uncoveredRecords.length})</h6>
          ${
            uncoveredRecords.length > 0
              ? `
            <table class="table table-sm table-striped">
              <thead class="table-light">
                <tr>
                  <th>Date</th>
                  <th>Absent Teacher</th>
                  <th>Subject</th>
                  <th>Class</th>
                  <th>Period</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                ${uncoveredRecords
                  .slice(0, 20)
                  .map(
                    (r) => `
                  <tr class="table-danger">
                    <td><small>${r.date}</small></td>
                    <td>${r.coveredTeacher}</td>
                    <td><small>${r.subject || "—"}</small></td>
                    <td><small>${r.className || "—"}</small></td>
                    <td><small>${r.period || "—"}</small></td>
                    <td><small>${r.absentReason || "—"}</small></td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
            ${uncoveredRecords.length > 20 ? `<small class="text-muted">Showing 20 of ${uncoveredRecords.length} uncovered absences</small>` : ""}
          `
              : `<p class="text-muted">✅ All absences are covered!</p>`
          }
        </div>

        <div>
          <h6>📅 High-Absence Days (Multi-Absence Incidents)</h6>
          ${
            multiAbsenceDays.length > 0
              ? `
            <table class="table table-sm table-striped">
              <thead class="table-light">
                <tr>
                  <th>Date</th>
                  <th class="text-center">Absences</th>
                  <th class="text-center">Unique Teachers</th>
                </tr>
              </thead>
              <tbody>
                ${multiAbsenceDays
                  .map(
                    (d) => `
                  <tr>
                    <td>${d.date}</td>
                    <td class="text-center"><badge class="badge bg-danger">${d.absenceCount}</badge></td>
                    <td class="text-center">${d.uniqueTeachers}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          `
              : `<p class="text-muted">No multi-absence days detected.</p>`
          }
        </div>
      `;
      return html;
    },

    renderChart() {
      return null; // Summary-only report
    },
  });

  // C6: Subject & Curriculum Impact Report
  const reportC6 = FRAMEWORK.createReport({
    id: "c6-subject-impact",
    title: "C6: Subject & Curriculum Impact Report",
    description: "Impact of absences on subjects, classes, and departments",
    category: "C",
    chartType: "pie",
    hasPagination: true,
    defaultPageSize: 30,

    generateData(filteredData) {
      const bySubject = groupBy(filteredData, "subject");
      const byClass = groupBy(filteredData, "className");
      const subjectResults = [];

      for (const [subject, records] of Object.entries(bySubject)) {
        const classSet = new Set(records.map((r) => r.className));
        const teacherSet = new Set(records.map((r) => r.coveredTeacher));
        const deptEstimate = subject.split(" ")[0]; // Simplified dept estimation

        subjectResults.push({
          subject,
          absenceCount: records.length,
          affectedClasses: classSet.size,
          uniqueTeachers: teacherSet.size,
          mostAffectedClass: [...classSet][0] || "—",
          deptEstimate,
        });
      }

      const classResults = [];
      for (const [className, records] of Object.entries(byClass)) {
        const subjectSet = new Set(records.map((r) => r.subject));
        classResults.push({
          className,
          absenceCount: records.length,
          affectedSubjects: subjectSet.size,
          subjects: Array.from(subjectSet),
        });
      }

      // Department breakdown (simple: first word of subject)
      const deptCounts = {};
      filteredData.forEach((r) => {
        const dept = (r.subject && r.subject.split(" ")[0]) || "Other";
        deptCounts[dept] = (deptCounts[dept] || 0) + 1;
      });

      return {
        title: "Subject & Curriculum Impact Report",
        timestamp: new Date().toLocaleString(),
        recordCount: filteredData.length,
        subjectCount: Object.keys(bySubject).length,
        classCount: Object.keys(byClass).length,
        deptData: deptCounts,
        subjects: subjectResults.sort((a, b) => b.absenceCount - a.absenceCount),
        classes: classResults.sort((a, b) => b.absenceCount - a.absenceCount),
      };
    },

    renderTable(reportData, page = 1) {
      const pageSize = 30;
      const startIdx = (page - 1) * pageSize;
      const pageData = reportData.subjects.slice(startIdx, startIdx + pageSize);
      const totalPages = Math.ceil(reportData.subjects.length / pageSize);

      let html = `
        <div class="mb-4">
          <h6>📚 Subject Impact</h6>
          <table class="table table-sm table-striped">
            <thead class="table-light">
              <tr>
                <th>Subject</th>
                <th class="text-center">Absences</th>
                <th class="text-center">Affected Classes</th>
                <th class="text-center">Unique Teachers</th>
                <th>Most Affected Class</th>
              </tr>
            </thead>
            <tbody>
              ${pageData
                .map(
                  (s) => `
                <tr>
                  <td><strong>${s.subject}</strong></td>
                  <td class="text-center"><badge class="badge bg-secondary">${s.absenceCount}</badge></td>
                  <td class="text-center">${s.affectedClasses}</td>
                  <td class="text-center">${s.uniqueTeachers}</td>
                  <td><small>${s.mostAffectedClass}</small></td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
          <small class="text-muted">Page ${page} of ${totalPages}</small>
        </div>

        <div>
          <h6>🏫 Department Breakdown</h6>
          <table class="table table-sm table-striped">
            <thead class="table-light">
              <tr>
                <th>Department</th>
                <th class="text-center">Absences</th>
                <th class="text-center">%</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(reportData.deptData)
                .sort((a, b) => b[1] - a[1])
                .map(
                  ([dept, count]) => `
                <tr>
                  <td><strong>${dept}</strong></td>
                  <td class="text-center">${count}</td>
                  <td class="text-center">${((count / reportData.recordCount) * 100).toFixed(1)}%</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
      return html;
    },

    renderChart(reportData) {
      return ViewerCharts.pieChart(
        Object.entries(reportData.deptData).map(([dept, count]) => ({
          label: dept,
          value: count,
        })),
        "Absences by Department"
      );
    },
  });

  // ── REPORT REGISTRY ──────────────────────────────────────
  const REPORTS = [
    reportA1,
    reportA2,
    reportB3,
    reportB4,
    reportC5,
    reportC6,
  ];

  // ── PUBLIC API ──────────────────────────────────────────
  return {
    REPORTS,
    getReportById(id) {
      return REPORTS.find((r) => r.id === id);
    },
    getAllReports() {
      return REPORTS;
    },
    FRAMEWORK,
  };
})();
