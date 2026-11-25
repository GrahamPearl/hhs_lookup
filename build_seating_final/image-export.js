/* image-export.js
   Renders the seating grid to PNG images via html2canvas (paginated 5-columns-
   per-image, or a single full-width image), previews them inline, and
   supports downloading or printing. Also owns hidePreview(), called by
   seating-grid.js and plan-storage.js whenever the underlying plan changes. */
(function (S) {
  'use strict';

  const dom = S.dom;
  const state = S.state;
  const config = S.config;
  const utils = S.utils;
  const candidates = S.candidates;

  let lastImageChunks = []; // [{ label, canvas }]

  function hidePreview() {
    dom.$imagePreviewWrap.addClass('d-none');
    dom.$imagePreviewPages.empty();
    dom.$downloadImgBtn.prop('disabled', true);
    dom.$printImgBtn.prop('disabled', true);
    lastImageChunks = [];
  }

  function getSubjectLabel() {
    return dom.$subject.val() || 'All subjects';
  }

  // Splits the current grid's columns (seat.col, i.e. the "desks per row" axis)
  // into consecutive groups of COLUMNS_PER_IMAGE, so each picture is at most 5 columns wide.
  function getColumnChunks() {
    const totalCols = state.rows; // "rows" = desks per row = number of visual columns
    const chunks = [];
    for (let start = 0; start < totalCols; start += config.COLUMNS_PER_IMAGE) {
      const end = Math.min(start + config.COLUMNS_PER_IMAGE, totalCols) - 1;
      const colIndices = [];
      for (let c = start; c <= end; c++) colIndices.push(c);
      chunks.push({ start, end, colIndices });
    }
    return chunks;
  }

  // Builds a standalone, off-screen copy of the seats for one column chunk so
  // it can be captured on its own — independent of the live, interactive grid.
  function buildChunkStage(chunk, pageNum, totalPages, examTitle, subj, totalCols) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.left = '-10000px';
    wrapper.style.top = '0';
    wrapper.style.background = '#ffffff';
    wrapper.style.padding = '20px';
    wrapper.style.fontFamily = 'Arial, Helvetica, sans-serif';

    const header = document.createElement('div');
    header.style.marginBottom = '14px';
    const rangeText = totalPages > 1
      ? `Columns ${chunk.start + 1}\u2013${chunk.end + 1} of ${totalCols} (Page ${pageNum} of ${totalPages})`
      : `${totalCols} column${totalCols === 1 ? '' : 's'}`;
    header.innerHTML = `
      <div style="font-size:16px;font-weight:700;">${utils.esc(examTitle)}</div>
      <div style="font-size:13px;color:#495057;">${utils.esc(subj)} — Seating plan — ${utils.esc(rangeText)}</div>
    `;
    wrapper.appendChild(header);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gap = '10px';
    grid.style.gridTemplateColumns = `repeat(${chunk.colIndices.length}, 128px)`;

    for (let r = 0; r < state.cols; r++) {
      chunk.colIndices.forEach(c => {
        const seat = S.seatingGrid.seatAt(r, c);
        const ext = seat && seat.student && seat.student.external;
        const div = document.createElement('div');
        div.className = 'seat ' + (seat && seat.student ? (ext ? 'filled external' : 'filled') : 'empty');
        if (seat && seat.student) {
          div.innerHTML = `
            ${ext ? '<div class="seat-ext-badge">EXT</div>' : ''}
            <div class="seat-admin">${utils.esc(candidates.candNumberLine(seat.student))}</div>
            <div class="seat-name">${utils.esc(candidates.candNameLine(seat.student))}</div>
          `;
        } else {
          div.innerHTML = `<div class="seat-hint">Empty seat</div>`;
        }
        grid.appendChild(div);
      });
    }
    wrapper.appendChild(grid);
    document.body.appendChild(wrapper);
    return wrapper;
  }

  async function generateSeatingImages() {
    const chunks = getColumnChunks();
    const examTitle = dom.$examTitle.val() || 'Seating Plan';
    const subj = getSubjectLabel();
    const totalCols = state.rows;
    const images = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const wrapper = buildChunkStage(chunk, i + 1, chunks.length, examTitle, subj, totalCols);
      try {
        const canvas = await html2canvas(wrapper, { backgroundColor: '#ffffff', scale: 2 });
        images.push({
          label: chunks.length > 1
            ? `Page ${i + 1} of ${chunks.length} — columns ${chunk.start + 1}\u2013${chunk.end + 1} of ${totalCols}`
            : `Full seating plan (${totalCols} column${totalCols === 1 ? '' : 's'})`,
          canvas
        });
      } finally {
        wrapper.remove();
      }
    }
    return images;
  }

  // Renders every column of the current grid into ONE canvas — no 5-column
  // split — for people who'd rather have a single (potentially wide) picture.
  async function generateFullSeatingImage() {
    const examTitle = dom.$examTitle.val() || 'Seating Plan';
    const subj = getSubjectLabel();
    const totalCols = state.rows;
    const fullChunk = {
      start: 0,
      end: totalCols - 1,
      colIndices: Array.from({ length: totalCols }, (_, i) => i)
    };
    const wrapper = buildChunkStage(fullChunk, 1, 1, examTitle, subj, totalCols);
    try {
      return await html2canvas(wrapper, { backgroundColor: '#ffffff', scale: 2 });
    } finally {
      wrapper.remove();
    }
  }

  function renderImagePreview() {
    dom.$imagePreviewPages.empty();
    lastImageChunks.forEach(img => {
      dom.$imagePreviewPages.append(`
        <div class="mb-3">
          <div class="small text-muted mb-1">${utils.esc(img.label)}</div>
          <img src="${img.canvas.toDataURL('image/png')}" class="img-fluid border rounded" alt="${utils.esc(img.label)}">
        </div>
      `);
    });
  }

  async function previewImage() {
    if (!S.filters.hasValidSelection()) { utils.setExportMessage('No candidate data is loaded yet.', 'status-err'); return; }
    if (!state.seats.some(s => s.student)) { utils.setExportMessage('Generate a seating plan first.', 'status-err'); return; }
    utils.setExportMessage('Rendering preview…', 'status-warn');
    try {
      lastImageChunks = await generateSeatingImages();
      renderImagePreview();
      dom.$imagePreviewWrap.removeClass('d-none');
      dom.$downloadImgBtn.prop('disabled', false);
      dom.$printImgBtn.prop('disabled', false);
      const n = lastImageChunks.length;
      utils.setExportMessage(
        `Preview ready — ${n} image${n === 1 ? '' : 's'} generated (5 columns per image). Review below, then download or print.`,
        'status-ok'
      );
    } catch (e) {
      utils.setExportMessage('Could not render preview: ' + utils.esc(e.message), 'status-err');
    }
  }

  function downloadImage() {
    if (!lastImageChunks.length) return;
    const subj = (getSubjectLabel() || 'Subject').replace(/[^\w\-]+/g, '_');
    const title = (dom.$examTitle.val() || 'SeatingPlan').replace(/[^\w\-]+/g, '_');
    const multi = lastImageChunks.length > 1;
    lastImageChunks.forEach((img, i) => {
      const suffix = multi ? `-Page${i + 1}of${lastImageChunks.length}` : '';
      const a = document.createElement('a');
      a.href = img.canvas.toDataURL('image/png');
      a.download = `${title}-${subj}${suffix}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    });
    utils.setExportMessage(
      multi
        ? `Downloading ${lastImageChunks.length} images — your browser may ask permission to download multiple files.`
        : 'Image downloaded.',
      'status-ok'
    );
  }

  // Single, unsplit image of the whole grid — independent of Preview/lastImageChunks,
  // so it can be used on its own without generating the paginated set first.
  async function downloadSingleImage() {
    if (!S.filters.hasValidSelection()) { utils.setExportMessage('No candidate data is loaded yet.', 'status-err'); return; }
    if (!state.seats.some(s => s.student)) { utils.setExportMessage('Generate a seating plan first.', 'status-err'); return; }
    utils.setExportMessage('Rendering single image…', 'status-warn');
    try {
      const canvas = await generateFullSeatingImage();
      const subj = (getSubjectLabel() || 'Subject').replace(/[^\w\-]+/g, '_');
      const title = (dom.$examTitle.val() || 'SeatingPlan').replace(/[^\w\-]+/g, '_');
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${title}-${subj}-Full.png`;
      document.body.appendChild(a); a.click(); a.remove();
      utils.setExportMessage('Single image downloaded — all columns, no split.', 'status-ok');
    } catch (e) {
      utils.setExportMessage('Could not render single image: ' + utils.esc(e.message), 'status-err');
    }
  }

  function printImages() {
    if (!lastImageChunks.length) { utils.setExportMessage('Preview the seating plan first.', 'status-err'); return; }
    const w = window.open('', '_blank');
    if (!w) {
      utils.setExportMessage('Pop-up blocked — please allow pop-ups for this page, or use "Download image(s)" instead.', 'status-err');
      return;
    }
    const pagesHtml = lastImageChunks.map(img => `
      <div class="print-page">
        <img src="${img.canvas.toDataURL('image/png')}">
      </div>
    `).join('');
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Seating Plan</title>
      <style>
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
        .print-page { page-break-after: always; padding: 16px; text-align: center; }
        .print-page:last-child { page-break-after: auto; }
        .print-page img { max-width: 100%; }
        @media print { @page { margin: 10mm; } }
      </style>
    </head><body>${pagesHtml}</body></html>`;
    w.document.open();
    w.document.write(doc);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  }

  S.imageExport = {
    hidePreview, getSubjectLabel, getColumnChunks, buildChunkStage,
    generateSeatingImages, generateFullSeatingImage, renderImagePreview,
    previewImage, downloadImage, downloadSingleImage, printImages
  };
})(window.Seating);
