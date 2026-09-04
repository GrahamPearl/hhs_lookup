/* seating-grid.js
   The S-snake seat ordering algorithm, the internal-then-external placement
   rule, grid rendering, manual click-to-remove / click-to-place editing, and
   the unassigned-candidates pool. This is the heart of the seating logic. */
(function (S) {
  'use strict';

  const dom = S.dom;
  const state = S.state;
  const utils = S.utils;
  const candidates = S.candidates;

  // ===== S-snake seat order =====
  // Fills down each column first (top-to-bottom, then bottom-to-top on the
  // next column, and so on). "nRows" here = desks per row (i.e. number of
  // visual columns); "nCols" = number of rows of desks (seats per column).
  // The order array is built one whole column at a time, so every
  // contiguous block of `nCols` entries corresponds to exactly one column —
  // this is what lets us cleanly start external candidates on a new column.
  function computeSnakeOrder(nRows, nCols) {
    const order = [];
    for (let c = 0; c < nRows; c++) {
      if (c % 2 === 0) {
        for (let r = 0; r < nCols; r++) order.push({ row: r, col: c }); // top to bottom
      } else {
        for (let r = nCols - 1; r >= 0; r--) order.push({ row: r, col: c }); // bottom to top
      }
    }
    return order;
  }

  function buildEmptySeats() {
    const s = [];
    for (let r = 0; r < state.cols; r++) {
      for (let c = 0; c < state.rows; c++) {
        s.push({ row: r, col: c, student: null });
      }
    }
    return s;
  }

  function resetGrid() {
    state.rows = parseInt(dom.$rowsInput.val(), 10) || 1;
    state.cols = parseInt(dom.$colsInput.val(), 10) || 1;
    state.seats = buildEmptySeats();
    state.unassigned = [];
    state.selectedPoolId = null;
    renderGrid();
    renderPool();
    utils.setPlanMessage('');
    S.imageExport.hidePreview();
  }

  function seatAt(r, c) {
    return state.seats.find(s => s.row === r && s.col === c);
  }

  // ===== Generate seating plan =====
  // Internal candidates are placed first, filling whole S-snake columns.
  // External candidates always begin at the top of the NEXT column, even if
  // that leaves empty seats at the bottom of the internal group's last
  // column — external candidates are never mixed into a partially-used
  // internal column.
  function generatePlan() {
    if (!S.filters.hasValidSelection()) { utils.setPlanMessage('No candidate data is loaded yet.', 'status-err'); return; }
    state.rows = Math.max(1, parseInt(dom.$rowsInput.val(), 10) || 1);
    state.cols = Math.max(1, parseInt(dom.$colsInput.val(), 10) || 1);

    const { internalSel, externalSel } = S.filters.getSelectedCandidates();
    const order = computeSnakeOrder(state.rows, state.cols);
    state.seats = buildEmptySeats();

    let placedInternal = 0;
    for (; placedInternal < order.length && placedInternal < internalSel.length; placedInternal++) {
      const pos = order[placedInternal];
      seatAt(pos.row, pos.col).student = internalSel[placedInternal];
    }

    // Round up to the next full column boundary so external candidates
    // never land in a column that already has internal candidates in it.
    const columnsUsedByInternal = Math.ceil(internalSel.length / state.cols);
    const externalStartIdx = columnsUsedByInternal * state.cols;

    let placedExternal = 0;
    for (let i = externalStartIdx; i < order.length && placedExternal < externalSel.length; i++, placedExternal++) {
      const pos = order[i];
      seatAt(pos.row, pos.col).student = externalSel[placedExternal];
    }

    state.unassigned = [];
    if (placedInternal < internalSel.length) state.unassigned = state.unassigned.concat(internalSel.slice(placedInternal));
    if (placedExternal < externalSel.length) state.unassigned = state.unassigned.concat(externalSel.slice(placedExternal));
    state.unassigned = candidates.sortByName(state.unassigned);
    state.selectedPoolId = null;

    renderGrid();
    renderPool();

    const totalSelected = internalSel.length + externalSel.length;
    const totalPlaced = placedInternal + placedExternal;
    if (totalSelected === 0) {
      utils.setPlanMessage('No candidates are ticked for this selection — nothing to seat.', 'status-warn');
    } else if (state.unassigned.length > 0) {
      utils.setPlanMessage(
        `Generated plan with ${order.length} seats. Placed ${totalPlaced} of ${totalSelected} candidate(s) ` +
        `(${placedInternal} internal, ${placedExternal} external). ${state.unassigned.length} candidate(s) remain ` +
        `unassigned — increase rows/columns or add another venue.`,
        'status-warn'
      );
    } else {
      utils.setPlanMessage(
        `Seating plan generated: ${placedInternal} internal + ${placedExternal} external candidate(s) placed ` +
        `in S-snake order across ${order.length} seats.`,
        'status-ok'
      );
    }
    S.imageExport.hidePreview();
  }

  function renderGrid() {
    dom.$seatGrid.css('grid-template-columns', `repeat(${state.rows}, 128px)`);
    dom.$seatGrid.empty();
    state.seats.forEach(seat => {
      const filled = !!seat.student;
      const ext = filled && seat.student.external;
      const cls = 'seat ' + (filled ? (ext ? 'filled external' : 'filled') : 'empty');
      const div = $(`<div class="${cls}" data-row="${seat.row}" data-col="${seat.col}"></div>`);
      if (filled) {
        div.html(`
          ${ext ? '<div class="seat-ext-badge">EXT</div>' : ''}
          <div class="seat-admin">${utils.esc(candidates.candNumberLine(seat.student))}</div>
          <div class="seat-name">${utils.esc(candidates.candNameLine(seat.student))}</div>
          <div class="seat-hint text-muted capture-hide">click to remove</div>
        `);
      } else {
        div.html(`<div class="seat-hint">Empty seat</div>`);
      }
      dom.$seatGrid.append(div);
    });
  }

  dom.$seatGrid.on('click', '.seat', function () {
    const r = parseInt($(this).data('row'), 10);
    const c = parseInt($(this).data('col'), 10);
    const seat = seatAt(r, c);
    if (!seat) return;

    if (seat.student) {
      // remove placement -> back to unassigned pool (manual edit; no column-boundary rule enforced here)
      state.unassigned.push(seat.student);
      state.unassigned = candidates.sortByName(state.unassigned);
      seat.student = null;
      renderGrid();
      renderPool();
      S.imageExport.hidePreview();
    } else if (state.selectedPoolId) {
      const idx = state.unassigned.findIndex(s => String(s.adminNo) === String(state.selectedPoolId));
      if (idx > -1) {
        seat.student = state.unassigned[idx];
        state.unassigned.splice(idx, 1);
        state.selectedPoolId = null;
        renderGrid();
        renderPool();
        S.imageExport.hidePreview();
      }
    } else {
      utils.setPlanMessage('Select a candidate from the "Unassigned candidates" panel first, then click an empty seat to place them.', 'status-warn');
    }
  });

  function renderPool() {
    $('#unassignedBadge').text(state.unassigned.length);
    dom.$unassignedPool.empty();
    if (!state.unassigned.length) {
      dom.$unassignedPool.html('<span class="text-muted small">No unassigned candidates.</span>');
      return;
    }
    state.unassigned.forEach(s => {
      const chip = $(`
        <span class="pool-chip ${String(s.adminNo) === String(state.selectedPoolId) ? 'selected' : ''}" data-id="${utils.esc(s.adminNo)}">
          ${s.external ? '<span class="ext-tag">EXT</span>' : ''}
          ${utils.esc(candidates.candNameLine(s))} <small>(${utils.esc(candidates.candNumberLine(s))})</small>
        </span>
      `);
      dom.$unassignedPool.append(chip);
    });
  }

  dom.$unassignedPool.on('click', '.pool-chip', function () {
    const id = $(this).data('id');
    state.selectedPoolId = (String(state.selectedPoolId) === String(id)) ? null : String(id);
    renderPool();
  });

  S.seatingGrid = {
    computeSnakeOrder, buildEmptySeats, resetGrid, seatAt, generatePlan,
    renderGrid, renderPool
  };
})(window.Seating);
