/* Analyser - export the on-page analysis.
   The "Export data" button (left of "Analyse next file?") opens a small chooser:
     - Complete report (HTML): a single self-contained .html file with every
       metadata table inline AND the visuals (spectrogram, histogram, previews,
       maps) embedded as base64 images. Opens in any browser, works offline.
     - Plain text (CSV): a flat Section/Group/Field/Value sheet of all the
       textual data. Text blobs (hex dumps, extracted text) are capped; images
       can't live in a CSV, so each is noted as a placeholder row.

   Everything is scraped from the rendered DOM (the renderers build .anr-card /
   .anr-readout tables), so this stays a pure read-side feature - it never needs
   to know about any individual format. All generation is local; nothing leaves
   the browser. */

import { el, sha256Hex } from './util.js';

// Per-cell cap for long text payloads (hex dumps, extracted strings, OCR), so a
// huge <pre> can't bloat the export to tens of MB. Matches the "capped" choice.
const TEXT_CAP = 5000;

// The result containers the renderers populate, plus the section-meta asides that
// hold a section's visuals (photo preview / histogram / OCR, video preview). Each
// becomes one titled section in the export, in this order, when it has content.
function exportRoots() {
  const byId = (id) => document.getElementById(id);
  return [
    { title: 'File',  main: byId('unknownResults'), extras: [] },
    { title: 'Photo', main: byId('photoResults'),
      extras: [byId('photoPreview'), byId('photoHistSlot'), byId('photoOcrSlot')] },
    { title: 'Sound', main: byId('audioResults'), extras: [] },
    { title: 'Video', main: byId('videoResults'), extras: [byId('videoPreview')] },
  ];
}

const isVisible = (node) => !!node && !node.hidden && node.childElementCount > 0
  && node.getClientRects().length > 0;

// Read a single readout cell as plain text: drop the [?] help button + tooltip and
// any copy buttons, then collapse whitespace so values stay on one line.
function cellText(cell) {
  if (!cell) return '';
  const clone = cell.cloneNode(true);
  clone.querySelectorAll('button, .anr-tip, script, style').forEach((n) => n.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function capText(text) {
  const t = String(text == null ? '' : text);
  return t.length > TEXT_CAP ? t.slice(0, TEXT_CAP) + '\n…(truncated, ' + (t.length - TEXT_CAP) + ' more characters)' : t;
}

// Linear-walk a root, emitting blocks in document order and tagging each with the
// nearest preceding heading. Readout tables are taken whole (not recursed into, so
// their inner th/td aren't double-counted); other tables, <pre> text and
// canvas/img visuals are captured too. Everything else is recursed.
function collectBlocks(root, fallbackHeading) {
  const blocks = [];
  const ctx = { heading: fallbackHeading };
  const pushImage = (heading, dataUrl, imgEl) => blocks.push({ type: 'image', heading, dataUrl, imgEl });

  function walk(node) {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) { ctx.heading = cellText(child) || ctx.heading; continue; }
      if (tag === 'TABLE') {
        if (child.matches('.anr-readout')) {
          const rows = [];
          child.querySelectorAll('tr').forEach((tr) => {
            const th = tr.querySelector('th');
            const tds = tr.querySelectorAll('td');
            if (th && tds.length) rows.push([cellText(th), Array.from(tds).map(cellText).join(' | ')]);
            else if (tds.length >= 2) rows.push([cellText(tds[0]), Array.from(tds).slice(1).map(cellText).join(' | ')]);
          });
          if (rows.length) blocks.push({ type: 'kv', heading: ctx.heading, rows });
        } else {
          const rows = [];
          child.querySelectorAll('tr').forEach((tr) => {
            const cells = tr.querySelectorAll('th, td');
            if (cells.length) rows.push(Array.from(cells).map(cellText));
          });
          if (rows.length) blocks.push({ type: 'table', heading: ctx.heading, rows });
        }
        continue;
      }
      if (tag === 'PRE') {
        const text = (child.textContent || '').replace(/\u00a0/g, ' ');
        if (text.trim()) blocks.push({ type: 'text', heading: ctx.heading, text: capText(text) });
        continue;
      }
      if (tag === 'CANVAS') {
        if (child.width && child.height) {
          let url = null;
          try {
            // A 3D viewer canvas exposes _anrSnapshot(), which renders a framed
            // isometric still; everything else just reads its current pixels.
            url = (typeof child._anrSnapshot === 'function')
              ? child._anrSnapshot()
              : child.toDataURL('image/png');
          } catch (_) { url = null; }
          if (url) pushImage(ctx.heading, url, null);
        }
        continue;
      }
      if (tag === 'IMG') {
        if (child.getClientRects().length) pushImage(ctx.heading, null, child);
        continue;
      }
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BUTTON') continue;
      walk(child);
    }
  }
  walk(root);
  return blocks;
}

// Gather every visible section into a structured model the writers consume.
function collectSections() {
  const out = [];
  for (const root of exportRoots()) {
    if (!isVisible(root.main)) continue;
    let blocks = collectBlocks(root.main, root.title);
    for (const extra of root.extras) {
      if (isVisible(extra)) blocks = blocks.concat(collectBlocks(extra, root.title));
    }
    if (blocks.length) out.push({ title: root.title, blocks });
  }
  return out;
}

// Ready the page so the scrape captures everything, then enrich it. Run BEFORE
// collectSections(). Three steps:
//   1. Expand every collapsed card and open every <details>, so content that was
//      hidden (its visuals would otherwise read back blank / be skipped) is live.
//   2. For video, force the contact sheet to generate if it hasn't been already
//      (it is otherwise behind a button), so the export always includes it.
async function prepForExport() {
  // 1. Open all closed sections.
  document.querySelectorAll('.anr-card.is-collapsed').forEach((c) => c.classList.remove('is-collapsed'));
  for (const root of exportRoots()) {
    if (root.main) root.main.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });
  }

  // 2. Video contact sheet, if the video section is present.
  const vr = document.getElementById('videoResults');
  if (isVisible(vr)) {
    const sheetCard = vr.querySelector('.anr-contact-sheet-card');
    if (sheetCard && typeof sheetCard._anrEnsure === 'function') {
      try { await sheetCard._anrEnsure(); } catch (_) {}
    }
  }
}

// True when a section already carries a real SHA-256 (so we don't compute twice).
function hasSha(section) {
  return section.blocks.some((b) => b.type === 'kv'
    && b.rows.some(([label, value]) => /sha-?256/i.test(label) && /^[0-9a-f]{64}$/i.test(String(value || '').trim())));
}

// Ensure the video section carries a SHA-256 of the file. The video renderer only
// shows one for smaller files (and behind an async/button path), so the export
// computes it from the stored File when it is missing.
async function augmentVideoSha(sections) {
  const file = window._anrLastFile;
  const a = window._anrLastAnalysis;
  if (!file || !a || a.category !== 'video') return;
  const vsec = sections.find((s) => s.title === 'Video');
  if (!vsec || hasSha(vsec)) return;
  let hex = null;
  try { hex = await sha256Hex(file); } catch (_) { hex = null; }
  if (!hex) return;
  // Lead the section with an Integrity block so the hash is easy to find.
  vsec.blocks.unshift({ type: 'kv', heading: 'Integrity', rows: [['SHA-256', hex]] });
}

// ---------- filename ----------
function baseName() {
  const a = window._anrLastAnalysis;
  const raw = (a && a.name) ? a.name : 'analysis';
  const stem = raw.replace(/\.[^.]+$/, '') || 'analysis';
  return stem.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'analysis';
}

function nowStamp() {
  try { return new Date().toLocaleString(); } catch (_) { return ''; }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- CSV ----------
function csvField(v) {
  return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
}

function buildCsv(sections) {
  const lines = [['Section', 'Group', 'Field', 'Value'].map(csvField).join(',')];
  const a = window._anrLastAnalysis;
  if (a && a.name) lines.push(['File', 'Source', 'Name', a.name].map(csvField).join(','));
  if (a && a.ext) lines.push(['File', 'Source', 'Extension', '.' + a.ext].map(csvField).join(','));
  lines.push(['File', 'Source', 'Exported', nowStamp()].map(csvField).join(','));

  for (const sec of sections) {
    for (const b of sec.blocks) {
      if (b.type === 'kv') {
        for (const [label, value] of b.rows) lines.push([sec.title, b.heading, label, value].map(csvField).join(','));
      } else if (b.type === 'table') {
        for (const row of b.rows) lines.push([sec.title, b.heading, '', row.join(' | ')].map(csvField).join(','));
      } else if (b.type === 'text') {
        lines.push([sec.title, b.heading, '(text)', b.text].map(csvField).join(','));
      } else if (b.type === 'image') {
        lines.push([sec.title, b.heading, '(image)', 'Not exportable to CSV - use the Complete (HTML) export to include it.'].map(csvField).join(','));
      }
    }
  }
  // Excel/Numbers honour a UTF-8 BOM; without it accented metadata can mangle.
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

// ---------- JSON ----------
// A structured, machine-readable view: one object per section, each carrying an
// ordered list of typed blocks. kv readouts become a `fields` map; other tables
// keep their `rows`; <pre> payloads become `text` (already capped); visuals are
// noted by label only (the base64 lives in the Complete HTML export instead).
function buildJson(sections) {
  const a = window._anrLastAnalysis;
  const doc = {
    tool: 'Analyser',
    url: 'https://lab.valjdakosta.com/',
    exported: nowStamp(),
    file: {
      name: (a && a.name) || null,
      extension: (a && a.ext) ? ('.' + a.ext) : null,
      category: (a && a.category) || null,
    },
    sections: sections.map((sec) => ({
      title: sec.title,
      blocks: sec.blocks.map((b) => {
        if (b.type === 'kv') {
          const fields = {};
          for (const [label, value] of b.rows) {
            // Preserve every row even when two share a label: collapse duplicates
            // into an array rather than silently overwriting.
            if (label in fields) fields[label] = [].concat(fields[label], value);
            else fields[label] = value;
          }
          return { heading: b.heading || null, type: 'fields', fields };
        }
        if (b.type === 'table') return { heading: b.heading || null, type: 'table', rows: b.rows };
        if (b.type === 'text') return { heading: b.heading || null, type: 'text', text: b.text };
        return { heading: b.heading || null, type: 'image', label: b.heading || 'image', note: 'binary image - included in the Complete (HTML) export' };
      }),
    })),
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

// ---------- HTML ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Resolve an <img> to a base64 data URI so the report stays self-contained. Most
// previews are blob:/object URLs (same-origin, fetchable); a fetch failure falls
// back to repainting the image onto a canvas.
function imgToDataUrl(img) {
  const src = img.currentSrc || img.src || '';
  if (!src) return Promise.resolve(null);
  if (src.startsWith('data:')) return Promise.resolve(src);
  return fetch(src).then((r) => r.blob()).then((blob) => new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => res(null);
    fr.readAsDataURL(blob);
  })).catch(() => {
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      if (!c.width || !c.height) return null;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    } catch (_) { return null; }
  });
}

const REPORT_CSS = [
  ':root{--fg:#0a0a0a;--muted:#6b6b6b;--rule:#e6e6e6;--accent:#e60023}',
  '*{box-sizing:border-box}',
  'body{margin:0;color:var(--fg);background:#fff;font:15px/1.5 -apple-system,"Helvetica Neue",Helvetica,system-ui,sans-serif;-webkit-font-smoothing:antialiased}',
  '.wrap{max-width:900px;margin:0 auto;padding:48px 24px 80px}',
  'header{border-bottom:2px solid var(--fg);padding-bottom:20px;margin-bottom:32px}',
  'h1{font-size:34px;margin:0;letter-spacing:-.01em}',
  'header p{margin:6px 0 0;color:var(--muted);font-size:13px}',
  'header .file{color:var(--fg);font-size:16px}',
  'section{margin:0 0 40px}',
  'h2{font-size:12px;text-transform:uppercase;letter-spacing:.15em;color:var(--accent);border-bottom:1px solid var(--rule);padding-bottom:8px;margin:0 0 18px}',
  'h3{font-size:15px;margin:24px 0 10px}',
  'table{border-collapse:collapse;width:100%;margin:0 0 8px;font-size:13.5px}',
  'th,td{text-align:left;vertical-align:top;padding:6px 12px 6px 0;border-bottom:1px solid var(--rule)}',
  'th{width:34%;font-weight:600;color:#333;white-space:nowrap}',
  'td{color:#111;word-break:break-word}',
  'table.generic th,table.generic td{width:auto;white-space:normal}',
  'pre{background:#f4f4f4;border:1px solid var(--rule);padding:12px;overflow:auto;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:0 0 8px}',
  'img{max-width:100%;height:auto;border:1px solid var(--rule);background:#0a0a0a;display:block;margin:0 0 8px}',
  'footer{border-top:1px solid var(--rule);margin-top:48px;padding-top:16px;color:var(--muted);font-size:12px}',
  'a{color:var(--accent)}',
].join('');

async function buildHtml(sections) {
  const a = window._anrLastAnalysis;
  const fileName = (a && a.name) ? a.name : 'this file';
  const parts = [];
  for (const sec of sections) {
    parts.push('<section><h2>' + esc(sec.title) + '</h2>');
    let lastHeading = null;
    for (const b of sec.blocks) {
      if (b.heading && b.heading !== lastHeading) {
        parts.push('<h3>' + esc(b.heading) + '</h3>');
        lastHeading = b.heading;
      }
      if (b.type === 'kv') {
        parts.push('<table>' + b.rows.map(([l, v]) =>
          '<tr><th>' + esc(l) + '</th><td>' + esc(v) + '</td></tr>').join('') + '</table>');
      } else if (b.type === 'table') {
        parts.push('<table class="generic">' + b.rows.map((row) =>
          '<tr>' + row.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</table>');
      } else if (b.type === 'text') {
        parts.push('<pre>' + esc(b.text) + '</pre>');
      } else if (b.type === 'image') {
        let url = b.dataUrl;
        if (!url && b.imgEl) url = await imgToDataUrl(b.imgEl);
        if (url) parts.push('<img alt="' + esc(b.heading || 'image') + '" src="' + url + '">');
      }
    }
    parts.push('</section>');
  }

  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>Analyser export - ' + esc(fileName) + '</title>\n'
    + '<style>' + REPORT_CSS + '</style>\n</head>\n<body>\n<div class="wrap">\n'
    + '<header><h1>Analyser</h1>'
    + '<p class="file">Analysis of <strong>' + esc(fileName) + '</strong></p>'
    + '<p>Generated ' + esc(nowStamp()) + ' - everything was processed locally in your browser; nothing was uploaded.</p></header>\n'
    + '<main>\n' + parts.join('\n') + '\n</main>\n'
    + '<footer>Generated by Analyser - <a href="https://lab.valjdakosta.com/">lab.valjdakosta.com</a></footer>\n'
    + '</div>\n</body>\n</html>\n';
}

// ---------- chooser modal ----------
let _open = false;
function showChooser() {
  if (_open) return;
  _open = true;

  // Filled once preparation + collection finish; the format buttons close over it.
  let sections = [];

  const closeBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-cancel' }, 'Cancel');
  // Holds the "preparing" status, then the format choices.
  const slot = el('div', { class: 'anr-export-slot' },
    el('p', { class: 'anr-share-lead' }, 'Preparing the analysis for export…'));

  const card = el('div', { class: 'anr-modal-card anr-export-card' }, [
    el('p', { class: 'anr-modal-kicker' }, 'Export'),
    el('p', { class: 'anr-modal-title' }, 'Export the analysis'),
    el('p', { class: 'anr-share-lead' }, 'Choose a format. It is built right here in your browser - nothing is uploaded.'),
    slot,
    el('div', { class: 'anr-modal-actions' }, [closeBtn]),
  ]);
  const overlay = el('div', { class: 'anr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export the analysis' }, card);
  document.body.appendChild(overlay);

  let settled = false;
  const close = () => {
    if (settled) return;
    settled = true;
    _open = false;
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  function renderChoices() {
    const htmlBtn = el('button', { type: 'button', class: 'anr-export-opt anr-export-opt--featured' }, [
      el('strong', {}, 'Complete report'),
      el('span', {}, 'Self-contained HTML - every table plus the spectrogram, histogram and previews embedded. Opens in any browser.'),
    ]);
    const jsonBtn = el('button', { type: 'button', class: 'anr-export-opt' }, [
      el('strong', {}, 'Machine-readable'),
      el('span', {}, 'A structured JSON file - every field, table and text block, typed and grouped by section. Ideal for scripts and tooling.'),
    ]);
    const csvBtn = el('button', { type: 'button', class: 'anr-export-opt' }, [
      el('strong', {}, 'Plain text only'),
      el('span', {}, 'A CSV of all metadata and text. Long text is capped; images are listed but not included.'),
    ]);

    htmlBtn.addEventListener('click', async () => {
      if (htmlBtn._busy) return;
      htmlBtn._busy = true;
      htmlBtn.querySelector('strong').textContent = 'Building…';
      try {
        const html = await buildHtml(sections);
        download(new Blob([html], { type: 'text/html;charset=utf-8' }), baseName() + '-analysis.html');
      } catch (_) {}
      close();
    });
    jsonBtn.addEventListener('click', () => {
      try {
        const json = buildJson(sections);
        download(new Blob([json], { type: 'application/json;charset=utf-8' }), baseName() + '-analysis.json');
      } catch (_) {}
      close();
    });
    csvBtn.addEventListener('click', () => {
      try {
        const csv = buildCsv(sections);
        download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), baseName() + '-analysis.csv');
      } catch (_) {}
      close();
    });

    slot.innerHTML = '';
    slot.appendChild(el('div', { class: 'anr-export-choices' }, [htmlBtn, jsonBtn, csvBtn]));
  }

  // Prepare the page (open closed sections, generate the video contact sheet),
  // collect, then enrich (video SHA-256). Only then offer the formats.
  (async () => {
    try {
      await prepForExport();
      sections = collectSections();
      await augmentVideoSha(sections);
    } catch (_) {}
    if (settled) return;   // cancelled while preparing
    if (!sections.length) {
      slot.innerHTML = '';
      slot.appendChild(el('p', { class: 'anr-share-lead' }, 'No analysed data on the page yet to export.'));
      return;
    }
    renderChoices();
  })();
}

// Wire the "Export data" button. Re-runnable; the per-element flag guards against
// double-binding across SPA navigations.
export function wireExportButton() {
  const btn = document.getElementById('exportData');
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener('click', showChooser);
}
