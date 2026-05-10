// viewer-export.js — CSV, Excel, and Report export utilities

const ViewerExport = (() => {
  const HEADERS = [
    "Date",
    "Week",
    "Absent Teacher",
    "Reason",
    "Cover Teacher",
    "Period",
    "Subject",
    "Class",
    "Venue",
  ];

  // Convert record to row
  function recordToRow(r) {
    return [
      r.date || "",
      r.week || "",
      r.coveredTeacher || "",
      r.absentReason || "",
      r.coverTeacher || "",
      r.period || "",
      r.subject || "",
      r.className || "",
      r.venue || "",
    ];
  }

  // CSV export
  function exportCSV(records, schoolId) {
    if (!records || records.length === 0) {
      alert("No data to export.");
      return;
    }
    const rows = records.map((r) =>
      recordToRow(r)
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [HEADERS.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cover_data_${schoolId}_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // Excel export with summary sheet
  function exportExcel(records, schoolId, allRecords) {
    if (!records || records.length === 0) {
      alert("No data to export.");
      return;
    }
    if (!window.XLSX) {
      alert("Excel library not loaded.");
      return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Filtered data
    const dataRows = records.map((r) => recordToRow(r));
    const dataSheet = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows]);
    dataSheet["!cols"] = HEADERS.map((_) => ({ wch: 14 }));
    XLSX.utils.book_append_sheet(wb, dataSheet, "Data");

    // Sheet 2: Summary stats
    const summaryData = buildSummarySheet(allRecords || records);
    XLSX.utils.book_append_sheet(
      wb,
      summaryData.sheet,
      "Summary",
    );

    XLSX.writeFile(
      wb,
      `cover_data_${schoolId}_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  }

  // Build summary stats sheet
  function buildSummarySheet(records) {
    const byAbsent = {};
    const byCover = {};
    const byReason = {};

    for (const r of records) {
      const a = r.coveredTeacher || "Unknown";
      const c = r.coverTeacher || "Unknown";
      const reason = r.absentReason || "Unknown";

      byAbsent[a] = (byAbsent[a] || 0) + 1;
      byCover[c] = (byCover[c] || 0) + 1;
      byReason[reason] = (byReason[reason] || 0) + 1;
    }

    const summaryRows = [
      ["Cover Data Summary"],
      [],
      ["Metric", "Value"],
      ["Total Records", records.length],
      ["Unique Absent Teachers", Object.keys(byAbsent).length],
      ["Unique Cover Teachers", Object.keys(byCover).length],
      ["Absence Reasons", Object.keys(byReason).length],
      [],
      ["Top Absent Teachers"],
      ["Teacher", "Count"],
      ...Object.entries(byAbsent)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      [],
      ["Top Cover Teachers"],
      ["Teacher", "Count"],
      ...Object.entries(byCover)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      [],
      ["Absence Reasons Breakdown"],
      ["Reason", "Count"],
      ...Object.entries(byReason).sort((a, b) => b[1] - a[1]),
    ];

    const sheet = XLSX.utils.aoa_to_sheet(summaryRows);
    sheet["!cols"] = [{ wch: 25 }, { wch: 12 }];
    return { sheet, data: summaryRows };
  }

  // Export report to Excel
  function exportReportToExcel(reportData, schoolId, report) {
    if (!reportData) {
      alert("No report data to export.");
      return;
    }
    if (!window.XLSX) {
      alert("Excel library not loaded.");
      return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Report metadata
    const metadataRows = [
      [report.title],
      [],
      ["Report Generated", reportData.timestamp],
      ["Record Count", reportData.recordCount],
      ["School ID", schoolId],
    ];
    const metaSheet = XLSX.utils.aoa_to_sheet(metadataRows);
    metaSheet["!cols"] = [{ wch: 25 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, metaSheet, "Metadata");

    // Sheet 2: Report data/table
    let reportRows = [];
    if (report.id === "a1-teacher-absence-profile") {
      reportRows = [
        ["Teacher", "Total Absences", "Top Reason", "Reason Count", "Most Frequent Day", "Last Absence"],
        ...reportData.data.map((t) => [
          t.teacher,
          t.totalAbsences,
          t.topReason,
          t.topReasonCount,
          t.mostFrequentDay,
          t.lastAbsenceDate || "—",
        ]),
      ];
    } else if (report.id === "a2-cover-teacher-workload") {
      reportRows = [
        ["Cover Teacher", "Periods Covered", "Unique Subjects", "Subjects", "Avg Periods/Subject"],
        ...reportData.data.map((ct) => [
          ct.coverTeacher,
          ct.periodsCovered,
          ct.uniqueSubjects,
          ct.subjects.join("; "),
          ct.avgPeriodsPerSubject,
        ]),
      ];
    } else if (report.id === "b3-absence-trend") {
      reportRows = [
        ["Date", "Day", "Absences", "Unique Teachers"],
        ...reportData.dailyTrend.map((d) => [
          d.date,
          d.dow,
          d.absenceCount,
          d.uniqueTeachers,
        ]),
      ];
    } else if (report.id === "b4-absence-reason-analysis") {
      reportRows = [
        ["Reason", "Count", "%", "Unique Teachers", "Most Cited By", "Date Range"],
        ...reportData.data.map((r) => [
          r.reason,
          r.count,
          r.percentage,
          r.uniqueTeachers,
          `${r.topTeacher} (${r.topTeacherCount}x)`,
          `${r.dateRange.first} to ${r.dateRange.last}`,
        ]),
      ];
    } else if (report.id === "c5-coverage-gap") {
      const { summary, uncoveredRecords, multiAbsenceDays } = reportData;
      reportRows = [
        ["Coverage Gap Report"],
        [],
        ["Metric", "Value"],
        ["Total Absences", summary.totalAbsences],
        ["Covered", summary.covered],
        ["Uncovered", summary.uncovered],
        ["Coverage Rate", summary.coverageRate],
        [],
        ["Uncovered Records"],
        ["Date", "Absent Teacher", "Subject", "Class", "Period", "Reason"],
        ...uncoveredRecords.slice(0, 100).map((r) => [
          r.date,
          r.coveredTeacher,
          r.subject || "—",
          r.className || "—",
          r.period || "—",
          r.absentReason || "—",
        ]),
      ];
    } else if (report.id === "c6-subject-impact") {
      reportRows = [
        ["Subject", "Absences", "Affected Classes", "Unique Teachers", "Most Affected Class"],
        ...reportData.subjects.map((s) => [
          s.subject,
          s.absenceCount,
          s.affectedClasses,
          s.uniqueTeachers,
          s.mostAffectedClass,
        ]),
      ];
    }

    const dataSheet = XLSX.utils.aoa_to_sheet(reportRows);
    dataSheet["!cols"] = Array(reportRows[0]?.length || 5).fill({ wch: 20 });
    XLSX.utils.book_append_sheet(wb, dataSheet, "Report Data");

    XLSX.writeFile(
      wb,
      `report_${report.id}_${schoolId}_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  }

  // Print-friendly view
  function printData(records, schoolId) {
    if (!records || records.length === 0) {
      alert("No data to print.");
      return;
    }
    let html = `<html><head><title>Cover Data - ${schoolId}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 1cm; }
        table { border-collapse: collapse; width: 100%; margin-top: 1cm; }
        th, td { border: 1px solid #333; padding: 0.5cm; text-align: left; font-size: 0.9em; }
        th { background: #f4f4f4; font-weight: bold; }
        tr:nth-child(even) { background: #f9f9f9; }
        h1 { margin-bottom: 0.5cm; }
        .timestamp { color: #666; font-size: 0.85em; margin-bottom: 1cm; }
        @media print {
          body { margin: 0; }
          .no-print { display: none; }
        }
      </style>
    </head><body>
      <h1>Cover Data Report</h1>
      <div class="timestamp">School: ${schoolId} | Generated: ${new Date().toLocaleString()}</div>
      <table>
        <thead><tr>
          ${HEADERS.map((h) => `<th>${h}</th>`).join("")}
        </tr></thead>
        <tbody>
          ${records
            .map(
              (r) => `<tr>
            ${recordToRow(r)
              .map((v) => `<td>${v}</td>`)
              .join("")}
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </body></html>`;
    const win = window.open("", "_blank", "width=1200,height=800");
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  return {
    exportCSV,
    exportExcel,
    exportReportToExcel,
    printData,
  };
})();
