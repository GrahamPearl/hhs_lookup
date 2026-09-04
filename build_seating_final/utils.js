/* utils.js
   Small, generic helpers with no seating-domain knowledge: HTML escaping,
   status-message rendering, fetch wrappers, file download, and subject-name
   normalization. Used by almost every other module. */
(function (S) {
  'use strict';

  const dom = S.dom;

  function esc(s) {
    if (s == null) return '';
    return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  function setPlanMessage(html, cls) {
    dom.$planMessage.removeClass('status-ok status-warn status-err').addClass(cls || '').html(html || '');
  }

  function setExportMessage(html, cls) {
    dom.$exportMessage.removeClass('status-ok status-warn status-err').addClass(cls || '').html(html || '');
  }

  async function fetchJson(url) {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`${url} (${resp.status})`);
    return resp.json();
  }

  async function fetchText(url) {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`${url} (${resp.status})`);
    return resp.text();
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // Subject names in list_of_subjects.txt and Subjects-Grade12.json don't always
  // agree on plural/singular ("Physical Science" vs "Physical Sciences"), so
  // matching is done on a normalized key (trimmed, lowercased, trailing "s"
  // dropped) rather than an exact string match.
  function normalizeSubjectKey(s) {
    return String(s || '').trim().toLowerCase().replace(/s$/, '');
  }

  S.utils = { esc, setPlanMessage, setExportMessage, fetchJson, fetchText, download, normalizeSubjectKey };
})(window.Seating);
