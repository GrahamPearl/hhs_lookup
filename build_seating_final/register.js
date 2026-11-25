/* register.js
   Builds the signable class register (seated candidates, sorted by surname),
   and drives its preview modal, print window, and HTML download. Owns the
   hand-off between the "build" modal and the "preview" modal so they don't
   stack on top of each other. */
(function (S) {
  'use strict';

  const dom = S.dom;
  const state = S.state;
  const utils = S.utils;
  const candidates = S.candidates;
  const imageExport = S.imageExport;

  function setRegisterMessage(html, cls) {
    $('#registerMessage').removeClass('status-ok status-warn status-err').addClass(cls || '').html(html || '');
  }

  // The register reflects candidates who are actually SEATED in the current plan.
  function getRegisterCandidates() {
    return candidates.sortByName(state.seats.filter(s => s.student).map(s => s.student));
  }

  function buildRegisterRowsHtml(list) {
    return list.map((c, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${utils.esc(candidates.candNumberLine(c))}</td>
        <td>${utils.esc(candidates.candNameLine(c))}</td>
        <td>${c.external ? 'External' : 'Internal'}</td>
        <td class="reg-sign-cell">&nbsp;</td>
      </tr>`).join('');
  }

  function buildRegisterDocument() {
    const list = getRegisterCandidates();
    const subj = imageExport.getSubjectLabel();
    const title = dom.$examTitle.val() || 'Class Register';
    const dateStr = new Date().toLocaleDateString();
    return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Class Register - ${utils.esc(subj)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #212529; }
  h1 { font-size: 1.25rem; margin: 0 0 .1rem 0; }
  h2 { font-size: 1rem; font-weight: 400; margin: 0 0 .75rem 0; color: #495057; }
  .meta { margin-bottom: 1rem; font-size: .85rem; color: #495057; }
  table.register-table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  table.register-table th, table.register-table td { border: 1px solid #495057; padding: 8px 10px; }
  table.register-table th { background: #f1f3f5; text-align: left; }
  table.register-table td:first-child, table.register-table th:first-child { width: 40px; text-align: center; }
  table.register-table td:nth-child(2), table.register-table th:nth-child(2) { width: 130px; }
  table.register-table td:nth-child(4), table.register-table th:nth-child(4) { width: 90px; }
  td.reg-sign-cell { width: 200px; }
  @media print {
    @page { margin: 14mm; }
  }
</style>
</head>
<body>
  <h1>${utils.esc(title)}</h1>
  <h2>${utils.esc(subj)}</h2>
  <div class="meta">Date: ${utils.esc(dateStr)} &bull; Total seated candidates: ${list.length}</div>
  <table class="register-table">
    <thead><tr><th>#</th><th>Exam&nbsp;No.</th><th>Surname, Name</th><th>Type</th><th>Signature</th></tr></thead>
    <tbody>${buildRegisterRowsHtml(list)}</tbody>
  </table>
</body></html>`;
  }

  let pendingShowRegisterPreview = false;
  $('#registerBuildModal').on('show.bs.modal', function () {
    setRegisterMessage('');
  });
  $('#registerBuildModal').on('hidden.bs.modal', function () {
    if (pendingShowRegisterPreview) {
      pendingShowRegisterPreview = false;
      bootstrap.Modal.getOrCreateInstance(document.getElementById('registerModal')).show();
    }
  });

  function previewRegister() {
    const list = getRegisterCandidates();
    if (!list.length) {
      setRegisterMessage('No candidates are currently seated — generate a seating plan first.', 'status-warn');
    } else {
      setRegisterMessage('');
    }
    $('#registerPreviewBody').html(`
      <table class="table table-sm table-bordered align-middle mb-0">
        <thead>
          <tr><th style="width:40px;">#</th><th style="width:130px;">Exam&nbsp;No.</th><th>Surname, Name</th><th style="width:90px;">Type</th><th style="width:180px;">Signature</th></tr>
        </thead>
        <tbody>${buildRegisterRowsHtml(list)}</tbody>
      </table>
    `);
    // Hand off from the build modal to the preview modal rather than stacking them.
    const buildModalEl = document.getElementById('registerBuildModal');
    const buildModalInstance = bootstrap.Modal.getInstance(buildModalEl);
    if (buildModalInstance && buildModalEl.classList.contains('show')) {
      pendingShowRegisterPreview = true;
      buildModalInstance.hide();
    } else {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('registerModal')).show();
    }
  }

  function printRegister() {
    const doc = buildRegisterDocument();
    const w = window.open('', '_blank');
    if (!w) {
      setRegisterMessage('Pop-up blocked — please allow pop-ups for this page, or use "Download register" instead.', 'status-err');
      return;
    }
    w.document.open();
    w.document.write(doc);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 300);
  }

  function downloadRegisterHtml() {
    const subj = imageExport.getSubjectLabel();
    const doc = buildRegisterDocument();
    const title = (dom.$examTitle.val() || 'ClassRegister').replace(/[^\w\-]+/g, '_');
    const subjSafe = subj.replace(/[^\w\-]+/g, '_');
    utils.download(`${title}-${subjSafe}-Register.html`, doc, 'text/html;charset=utf-8');
    setRegisterMessage('Class register downloaded as HTML — open it in a browser and use Print (or Print to PDF) to produce a paper copy.', 'status-ok');
  }

  S.register = {
    getRegisterCandidates, buildRegisterRowsHtml, buildRegisterDocument,
    previewRegister, printRegister, downloadRegisterHtml
  };
})(window.Seating);
