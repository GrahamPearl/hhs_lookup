// viewer-charts.js — Chart generation utilities (SVG)

const ViewerCharts = (() => {
  const COLORS = {
    primary: "#667eea",
    secondary: "#764ba2",
    success: "#28a745",
    danger: "#dc3545",
    warning: "#ffc107",
    info: "#17a2b8",
    chart: ["#667eea", "#764ba2", "#5a67d8", "#6f42c1", "#20c997", "#fd7e14"],
  };

  // ── HORIZONTAL BAR CHART ──────────────────────────────────
  function barChartHorizontal(data, title) {
    if (!data || data.length === 0) {
      return '<svg viewBox="0 0 600 300" xmlns="http://www.w3.org/2000/svg"><text x="300" y="150" text-anchor="middle" fill="#999">No data to display</text></svg>';
    }

    const width = 600;
    const height = 40 * data.length + 60;
    const padding = { top: 40, right: 20, bottom: 20, left: 150 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxValue = Math.max(...data.map((d) => d.value));
    const scale = chartWidth / maxValue;

    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="barGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:${COLORS.primary};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${COLORS.secondary};stop-opacity:1" />
        </linearGradient>
      </defs>
      <text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${title}</text>
      <g transform="translate(${padding.left}, ${padding.top})">`;

    data.forEach((item, idx) => {
      const y = idx * 40;
      const barWidth = item.value * scale;
      const color = COLORS.chart[idx % COLORS.chart.length];

      svg += `
        <rect x="0" y="${y}" width="${barWidth}" height="32" fill="${color}" rx="4"/>
        <text x="-10" y="${y + 21}" text-anchor="end" font-size="12" fill="#333">${item.label}</text>
        <text x="${barWidth + 5}" y="${y + 21}" font-size="11" fill="#666">${item.value}</text>
      `;
    });

    svg += `</g></svg>`;
    return svg;
  }

  // ── LINE CHART ──────────────────────────────────────────
  function lineChart(data, title) {
    if (!data || data.length === 0) {
      return '<svg viewBox="0 0 800 300" xmlns="http://www.w3.org/2000/svg"><text x="400" y="150" text-anchor="middle" fill="#999">No data to display</text></svg>';
    }

    const width = 800;
    const height = 400;
    const padding = { top: 40, right: 30, bottom: 60, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxValue = Math.max(...data.map((d) => d.value), 1);
    const yScale = chartHeight / maxValue;
    const xScale = chartWidth / Math.max(data.length - 1, 1);

    // Calculate points
    const points = data.map((d, i) => ({
      x: padding.left + i * xScale,
      y: padding.top + chartHeight - d.value * yScale,
      label: d.label,
      value: d.value,
    }));

    // Build path
    const pathData = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${COLORS.primary};stop-opacity:0.3" />
          <stop offset="100%" style="stop-color:${COLORS.primary};stop-opacity:0" />
        </linearGradient>
      </defs>
      
      <text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${title}</text>
      
      <g>
        <!-- Y-axis -->
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#ddd" stroke-width="2"/>
        <!-- X-axis -->
        <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#ddd" stroke-width="2"/>
      </g>
      
      <!-- Grid lines -->
      ${Array.from({ length: 5 }).map((_, i) => {
        const y = padding.top + (i * chartHeight) / 4;
        const val = Math.round(maxValue - (i * maxValue) / 4);
        return `
          <line x1="${padding.left - 5}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#f0f0f0" stroke-width="1"/>
          <text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" font-size="10" fill="#999">${val}</text>
        `;
      }).join("")}
      
      <!-- Fill under line -->
      <path d="${pathData} L ${points[points.length - 1].x} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom}" 
            fill="url(#lineGradient)" opacity="0.5"/>
      
      <!-- Line -->
      <path d="${pathData}" stroke="${COLORS.primary}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      
      <!-- Points -->
      ${points
        .map(
          (p, i) => `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="${COLORS.primary}" opacity="0.8"/>
        ${i % Math.ceil(data.length / 10) === 0 ? `<text x="${p.x}" y="${height - padding.bottom + 20}" text-anchor="middle" font-size="9" fill="#666" transform="rotate(45 ${p.x} ${height - padding.bottom + 20})">${p.label.substring(0, 10)}</text>` : ""}
      `
        )
        .join("")}
    </svg>`;

    return svg;
  }

  // ── PIE CHART ──────────────────────────────────────────
  function pieChart(data, title) {
    if (!data || data.length === 0) {
      return '<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg"><text x="300" y="200" text-anchor="middle" fill="#999">No data to display</text></svg>';
    }

    const width = 600;
    const height = 400;
    const centerX = 180;
    const centerY = 180;
    const radius = 120;

    const total = data.reduce((sum, d) => sum + d.value, 0);
    let currentAngle = -Math.PI / 2;

    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${title}</text>
      <g transform="translate(${centerX}, ${centerY})">`;

    data.forEach((item, idx) => {
      const sliceAngle = (item.value / total) * 2 * Math.PI;
      const endAngle = currentAngle + sliceAngle;

      const x1 = radius * Math.cos(currentAngle);
      const y1 = radius * Math.sin(currentAngle);
      const x2 = radius * Math.cos(endAngle);
      const y2 = radius * Math.sin(endAngle);

      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      const pathData = `M 0 0 L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

      const color = COLORS.chart[idx % COLORS.chart.length];
      const percentage = ((item.value / total) * 100).toFixed(1);

      // Label position
      const labelAngle = currentAngle + sliceAngle / 2;
      const labelX = (radius * 0.65) * Math.cos(labelAngle);
      const labelY = (radius * 0.65) * Math.sin(labelAngle);

      svg += `<path d="${pathData}" fill="${color}" opacity="0.8" stroke="white" stroke-width="2"/>
              <text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="bold" fill="white">${percentage}%</text>`;

      currentAngle = endAngle;
    });

    svg += `</g>`;

    // Legend
    svg += `<g transform="translate(330, 60)">`;
    data.forEach((item, idx) => {
      const y = idx * 25;
      const color = COLORS.chart[idx % COLORS.chart.length];
      svg += `
        <rect x="0" y="${y}" width="12" height="12" fill="${color}" opacity="0.8"/>
        <text x="18" y="${y + 10}" font-size="11" fill="#333">${item.label} (${item.value})</text>
      `;
    });
    svg += `</g></svg>`;

    return svg;
  }

  // ── PUBLIC API ──────────────────────────────────────────
  return {
    barChartHorizontal,
    lineChart,
    pieChart,
  };
})();
