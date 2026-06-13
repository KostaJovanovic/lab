/* Analyser - PDF module
   Lazy-loads pdf.js from CDN, extracts metadata, text, and page thumbnails. */

import { el, row, rowHelp, fmtBytes, errorCard, integrityCard, openOverlayBack } from '../core/util.js';
import { renderPhoto, revealPhotoSection, pickOcrLanguage, ocrLangPath } from './photo.js';

// Resolved against this module's URL so the dynamic import() gets a valid
// absolute specifier (a bare "assets/..." path is not a resolvable module id).
const PDFJS_URL      = new URL('../../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const WORKER_URL     = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const TESSERACT_URL  = 'assets/vendor/tesseract/tesseract.min.js';

let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS_URL);
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  return pdfjsLib;
}

// Resolve a PDF image XObject by name from a page's object store. pdf.js stores
// these asynchronously; race against a timeout so a never-resolving name can't
// hang the whole extraction.
function getPdfImage(page, name) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      if (page.objs.has && page.objs.has(name)) { finish(page.objs.get(name)); return; }
      page.objs.get(name, finish);
    } catch (_) { finish(null); }
    setTimeout(() => finish(null), 4000);
  });
}

// Convert a pdf.js image object (bitmap, or raw data with an ImageKind) to a
// canvas. Handles RGBA/RGB/1-bpp-grayscale; returns null for anything exotic.
function pdfImageToCanvas(img) {
  if (!img) return null;
  const cv = document.createElement('canvas');
  const bitmap = (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) ? img
    : (img.bitmap instanceof ImageBitmap ? img.bitmap : null);
  if (bitmap) {
    cv.width = bitmap.width; cv.height = bitmap.height;
    cv.getContext('2d').drawImage(bitmap, 0, 0);
    return cv;
  }
  const w = img.width, h = img.height, data = img.data;
  if (!w || !h || !data) return null;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const out = ctx.createImageData(w, h);
  const px = w * h;
  if (img.kind === 3 || data.length >= px * 4) {
    out.data.set(data.subarray(0, px * 4));
  } else if (img.kind === 2 || data.length >= px * 3) {
    for (let i = 0, j = 0; i < px; i++) {
      out.data[j++] = data[i * 3]; out.data[j++] = data[i * 3 + 1];
      out.data[j++] = data[i * 3 + 2]; out.data[j++] = 255;
    }
  } else if (img.kind === 1) {
    const rowBytes = Math.ceil(w / 8);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = bit ? 255 : 0, o = (y * w + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = 255;
    }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return cv;
}

function fmtDate(d) {
  if (!d) return '-';
  // PDF dates are often in the format D:YYYYMMDDHHmmSS
  if (typeof d === 'string' && d.startsWith('D:')) {
    const s = d.slice(2);
    const year = s.slice(0, 4);
    const month = s.slice(4, 6) || '01';
    const day = s.slice(6, 8) || '01';
    const hour = s.slice(8, 10) || '00';
    const min = s.slice(10, 12) || '00';
    const sec = s.slice(12, 14) || '00';
    return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
  }
  if (d instanceof Date) return d.toISOString().replace('T', ' ').replace(/\..*$/, '');
  return String(d);
}

// Scan the raw PDF bytes for forensic signals pdf.js does not surface: how many
// times the file was saved (each save appends an %%EOF marker), whether it is
// linearised for "fast web view", and whether anything non-whitespace trails the
// final %%EOF (appended / polyglot data, a classic tamper/smuggling tell).
function scanRawPdf(bytes) {
  const text = new TextDecoder('latin1').decode(bytes);
  let eof = 0, idx = 0;
  while ((idx = text.indexOf('%%EOF', idx)) !== -1) { eof++; idx += 5; }
  const lastEof = text.lastIndexOf('%%EOF');
  // Count printable (code > 32) characters after the final %%EOF: any non-blank
  // trailing content is appended/polyglot data. A char-code loop avoids putting a
  // raw NUL or escape in the source.
  let appended = 0;
  if (lastEof !== -1) {
    const tail = text.slice(lastEof + 5);
    for (let i = 0; i < tail.length; i++) if (tail.charCodeAt(i) > 32) appended++;
  }
  const linearized = /\/Linearized\b/.test(text.slice(0, 2048));
  return { eof, appended, linearized };
}

// ---------- main render ----------
export async function renderPdf(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Loading PDF library…`));

  let lib;
  try {
    lib = await loadPdfJs();
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Failed to load PDF.js: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  let pdf;
  try {
    const buf = await file.arrayBuffer();
    pdf = await lib.getDocument({ data: buf }).promise;
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not parse PDF: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';

  // --- Info card ---
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'PDF document'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'PDF Document'));
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('Pages', String(pdf.numPages)));

  // Metadata
  let meta = {};
  let metaXmp = null;
  try {
    const info = await pdf.getMetadata();
    meta = (info && info.info) || {};
    metaXmp = (info && info.metadata) || null;
  } catch (_) {}
  tbl.appendChild(row('Title', meta.Title));
  tbl.appendChild(row('Author', meta.Author));
  tbl.appendChild(rowHelp('Creator', meta.Creator, 'The application that originally authored the document content (for example a word processor or design tool).'));
  tbl.appendChild(rowHelp('Producer', meta.Producer, 'The software that generated the actual PDF file (often a "Print to PDF" driver or a PDF library). It can differ from the Creator, which is the app that authored the content.'));
  tbl.appendChild(row('Creation date', fmtDate(meta.CreationDate)));
  tbl.appendChild(row('Modification date', fmtDate(meta.ModDate)));
  tbl.appendChild(rowHelp('PDF version', meta.PDFFormatVersion || '-', 'The version of the PDF specification that this file conforms to.'));

  // Page dimensions from page 1
  try {
    const page1 = await pdf.getPage(1);
    const vp = page1.getViewport({ scale: 1 });
    const wPt = vp.width;
    const hPt = vp.height;
    const wIn = (wPt / 72).toFixed(2);
    const hIn = (hPt / 72).toFixed(2);
    const wMm = (wPt / 72 * 25.4).toFixed(1);
    const hMm = (hPt / 72 * 25.4).toFixed(1);
    tbl.appendChild(rowHelp('Page 1 size', `${wPt.toFixed(0)} x ${hPt.toFixed(0)} pt  (${wIn} x ${hIn} in / ${wMm} x ${hMm} mm)`, 'The physical dimensions of the first page, shown in points with inch and millimetre equivalents. 1 point equals 1/72 of an inch.'));
  } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);
  resultsEl.appendChild(integrityCard(file));

  // --- Document structure (outline, forms, links, attachments, security) ---
  // Everything here is additive and best-effort: each pdf.js call may reject or
  // be absent, so every step is guarded and only rows with real data are shown.
  // A failure here must never break text extraction / thumbnails / OCR below.
  try {
    const structCard = el('div', { class: 'anr-card' });
    structCard.appendChild(el('h3', {}, 'Document structure & security'));
    const stbl = el('table', { class: 'anr-readout' });
    let structRows = 0;       // count of plain readout rows added
    const extras = [];        // collapsible <details> blocks to append after the table
    const addRow = (node) => { stbl.appendChild(node); structRows++; };

    // -- Raw-byte forensics: revisions, linearisation, appended data --
    // getDocument() detaches the buffer we passed it, so re-read the file here.
    try {
      const fx = scanRawPdf(new Uint8Array(await file.arrayBuffer()));
      if (fx.eof > 1) {
        const updates = fx.eof - 1;
        addRow(rowHelp('Revisions', String(fx.eof) + ' (incrementally updated ' + updates + ' time' + (updates === 1 ? '' : 's') + ')',
          'Each save appends a new %%EOF marker. More than one means the file was edited and re-saved incrementally, keeping earlier versions inside the file - a strong provenance and tamper signal.'));
      }
      if (fx.linearized) {
        addRow(rowHelp('Linearised', 'yes',
          'The PDF is linearised ("fast web view"): reorganised so a viewer can display the first page before the whole file downloads. Usually set by web-optimised exporters.'));
      }
      if (fx.appended > 0) {
        addRow(rowHelp('Trailing data', '⚠ ' + fx.appended + ' byte' + (fx.appended === 1 ? '' : 's') + ' after final %%EOF',
          'Non-blank content follows the final end-of-file marker. Often a harmless re-save artefact, but also how data is smuggled into a PDF (polyglot files, appended payloads) - worth a closer look.'));
      }
    } catch (_) {}

    // -- Outline / table of contents --
    try {
      const outline = await pdf.getOutline().catch(() => null);
      if (Array.isArray(outline) && outline.length) {
        addRow(rowHelp('Outline entries', String(outline.length),
          'Top-level bookmarks in the document outline (table of contents). Nested sub-bookmarks are shown indented in the expandable list below.'));
        const det = el('details');
        det.appendChild(el('summary', {}, 'Outline / table of contents'));
        const list = el('ul', { style: 'margin:8px 0 0;padding-left:18px;font-size:13px;' });
        for (const item of outline) {
          const title = (item && item.title) ? String(item.title).trim() : '(untitled)';
          const li = el('li', { style: 'margin:2px 0;' }, title);
          // Recurse one level into children.
          if (item && Array.isArray(item.items) && item.items.length) {
            const sub = el('ul', { style: 'margin:2px 0;padding-left:16px;opacity:0.8;' });
            for (const child of item.items) {
              const ct = (child && child.title) ? String(child.title).trim() : '(untitled)';
              sub.appendChild(el('li', { style: 'margin:2px 0;' }, ct));
            }
            li.appendChild(sub);
          }
          list.appendChild(li);
        }
        det.appendChild(list);
        extras.push(det);
      }
    } catch (_) {}

    // -- Attachments / embedded files --
    try {
      const att = await pdf.getAttachments().catch(() => null);
      const names = att ? Object.keys(att) : [];
      if (names.length) {
        addRow(rowHelp('Embedded files', String(names.length),
          'Files attached inside the PDF (the PDF acts as a container). Listed below.'));
        const det = el('details');
        det.appendChild(el('summary', {}, 'Embedded files'));
        const list = el('ul', { style: 'margin:8px 0 0;padding-left:18px;font-size:13px;' });
        for (const n of names) {
          const entry = att[n];
          const fname = (entry && entry.filename) ? String(entry.filename) : String(n);
          const len = entry && entry.content && entry.content.length;
          const label = len ? `${fname}  (${fmtBytes(len)})` : fname;
          list.appendChild(el('li', { style: 'margin:2px 0;' }, label));
        }
        det.appendChild(list);
        extras.push(det);
      }
    } catch (_) {}

    // -- Embedded JavaScript (security flag + source) --
    try {
      const jsSources = [];
      try {
        const jsActions = await pdf.getJSActions().catch(() => null);
        if (jsActions) {
          for (const k of Object.keys(jsActions)) {
            const v = jsActions[k];
            const arr = Array.isArray(v) ? v : [v];
            for (const s of arr) { if (s) jsSources.push('// ' + k + '\n' + String(s)); }
          }
        }
      } catch (_) {}
      let hasJs = jsSources.length > 0;
      // OpenAction-level JavaScript (auto-run on open) is a separate, older path.
      if (typeof pdf.getOpenAction === 'function') {
        try {
          const oa = await pdf.getOpenAction().catch(() => null);
          if (oa && oa.action === 'JavaScript') hasJs = true;
        } catch (_) {}
      }
      if (hasJs) {
        addRow(rowHelp('Embedded JavaScript', '⚠ yes',
          'The PDF contains document-level JavaScript that a viewer may execute. Embedded scripts can be benign (form logic) but are also a common malware vector, so treat unexpected scripts with caution.'));
        // Surface the actual source so it can be reviewed in place.
        if (jsSources.length) {
          const det = el('details');
          det.appendChild(el('summary', {}, 'JavaScript source (' + jsSources.length + ')'));
          const pre = el('pre', { class: 'anr-ocr-text', style: 'max-height:300px;overflow:auto;white-space:pre-wrap;font-size:12px;margin:8px 0 0;' });
          pre.textContent = jsSources.join('\n\n');
          det.appendChild(pre);
          extras.push(det);
        }
      }
    } catch (_) {}

    // -- Permissions / encryption --
    try {
      const encrypted = !!(meta && (meta.IsEncrypted || meta.Encrypted));
      let perms = null;
      try { perms = await pdf.getPermissions().catch(() => null); } catch (_) {}
      // getPermissions() returns a non-null array only when usage is restricted.
      if (encrypted || Array.isArray(perms)) {
        addRow(rowHelp('Encrypted', encrypted ? 'yes' : 'no',
          'Whether the PDF is encrypted. Encrypted PDFs may still open without a password but can restrict actions such as printing, copying text, or editing.'));
      }
      if (Array.isArray(perms) && lib.PermissionFlag) {
        const PF = lib.PermissionFlag;
        const has = (flag) => flag != null && perms.indexOf(flag) !== -1;
        const allowed = [];
        if (has(PF.PRINT) || has(PF.PRINT_HIGH_QUALITY)) allowed.push('print');
        if (has(PF.COPY)) allowed.push('copy');
        if (has(PF.MODIFY_CONTENTS) || has(PF.MODIFY_ANNOTATIONS)) allowed.push('modify');
        const allActions = ['print', 'copy', 'modify'];
        const denied = allActions.filter((a) => allowed.indexOf(a) === -1);
        addRow(rowHelp('Allowed actions', allowed.length ? allowed.join(', ') : 'none',
          'Actions the document permissions allow. Restricted actions (e.g. printing, copying text, modifying) are enforced by the encryption handler.'));
        if (denied.length) addRow(row('Restricted actions', denied.join(', ')));
      }
    } catch (_) {}

    // -- Annotations / form fields / links (first ~20 pages, capped) --
    try {
      const cap = Math.min(pdf.numPages, 20);
      let widgets = 0, links = 0, others = 0;
      for (let i = 1; i <= cap; i++) {
        try {
          const page = await pdf.getPage(i);
          const anns = await page.getAnnotations().catch(() => null);
          if (!Array.isArray(anns)) continue;
          for (const a of anns) {
            const t = a && a.subtype;
            if (t === 'Widget') widgets++;
            else if (t === 'Link') links++;
            else others++;
          }
        } catch (_) {}
      }
      const scope = pdf.numPages > cap ? ` (first ${cap} pages)` : '';
      if (widgets) addRow(rowHelp('Form fields', String(widgets) + scope,
        'Interactive form fields (text boxes, checkboxes, buttons) counted across the scanned pages. Indicates a fillable AcroForm.'));
      if (links) addRow(row('Links', String(links) + scope));
      if (others) addRow(row('Annotations', String(others) + scope));
    } catch (_) {}

    // -- XMP metadata (Keywords / Subject / PDF/A) --
    try {
      const getXmp = (key) => {
        if (!metaXmp || typeof metaXmp.get !== 'function') return null;
        try { const v = metaXmp.get(key); return v ? String(v).trim() : null; } catch (_) { return null; }
      };
      const subject = (meta && meta.Subject) || getXmp('dc:description');
      const keywords = (meta && meta.Keywords) || getXmp('pdf:Keywords');
      if (keywords) addRow(row('Keywords', keywords));
      if (subject) addRow(row('Subject', subject));
      const part = getXmp('pdfaid:part');
      if (part) {
        const conf = getXmp('pdfaid:conformance');
        addRow(rowHelp('PDF/A', 'PDF/A-' + part + (conf ? conf.toUpperCase() : ''),
          'The document declares conformance to PDF/A, an ISO archival profile that requires self-contained, long-term-preservable files.'));
      }
    } catch (_) {}

    // -- Fonts (distinct fonts used across the first pages) --
    // pdf.js loads each font into page.commonObjs keyed by the id seen in the
    // setFont operator; resolve those (with a timeout, like image XObjects).
    try {
      const cap = Math.min(pdf.numPages, 15);
      const fonts = new Map();   // id -> { name, embedded, type }
      const resolveFont = (page, id) => new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        try {
          if (page.commonObjs.has && page.commonObjs.has(id)) { finish(page.commonObjs.get(id)); return; }
          page.commonObjs.get(id, finish);
        } catch (_) { finish(null); }
        setTimeout(() => finish(null), 3000);
      });
      for (let i = 1; i <= cap; i++) {
        try {
          const page = await pdf.getPage(i);
          const ops = await page.getOperatorList();
          const ids = new Set();
          for (let k = 0; k < ops.fnArray.length; k++) {
            if (ops.fnArray[k] === lib.OPS.setFont) {
              const id = ops.argsArray[k][0];
              if (typeof id === 'string') ids.add(id);
            }
          }
          for (const id of ids) {
            if (fonts.has(id)) continue;
            const fo = await resolveFont(page, id);
            if (!fo) continue;
            // Strip the 6-letter subset prefix (e.g. "ABCDEF+Arial").
            const name = String(fo.name || fo.loadedName || id).replace(/^[A-Z]{6}\+/, '');
            fonts.set(id, { name, embedded: !!fo.data, type: fo.type || '' });
          }
        } catch (_) {}
      }
      if (fonts.size) {
        const list = [...fonts.values()];
        const notEmbedded = list.filter((f) => !f.embedded).length;
        const scope = pdf.numPages > cap ? ' (first ' + cap + ' pages)' : '';
        addRow(rowHelp('Fonts', list.length + (notEmbedded ? ', ' + notEmbedded + ' not embedded' : ', all embedded') + scope,
          'Distinct fonts used in the document. Non-embedded fonts rely on the viewer having a matching font installed, so the file may render differently elsewhere - a portability and authenticity tell.'));
        const det = el('details');
        det.appendChild(el('summary', {}, 'Fonts (' + list.length + ')'));
        const ul = el('ul', { style: 'margin:8px 0 0;padding-left:18px;font-size:13px;' });
        for (const f of list) {
          const bits = [];
          if (f.type) bits.push(f.type);
          bits.push(f.embedded ? 'embedded' : 'not embedded');
          ul.appendChild(el('li', { style: 'margin:2px 0;' }, f.name + '  (' + bits.join(', ') + ')'));
        }
        det.appendChild(ul);
        extras.push(det);
      }
    } catch (_) {}

    // Only show the card if we actually surfaced something.
    if (structRows || extras.length) {
      structCard.appendChild(stbl);
      for (const d of extras) structCard.appendChild(d);
      resultsEl.appendChild(structCard);
    }
  } catch (_) { /* never break the rest of the render */ }

  // --- Text extraction (all pages, revealed in batches of 3) ---
  const textCard = el('div', { class: 'anr-card' });
  textCard.appendChild(el('h3', {}, 'Text content'));
  const textNote = el('p', { class: 'anr-hint', style: 'font-size:12px;margin:0 0 10px;display:none;' });
  textCard.appendChild(textNote);
  const textWrap = el('div', { style: 'max-height:420px;overflow:auto;' });
  textWrap.appendChild(el('div', { class: 'anr-info' }, 'Extracting…'));
  textCard.appendChild(textWrap);

  const btnRow = el('div', { class: 'anr-btn-row' });
  const moreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show next 3 pages');
  const allBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show all');
  btnRow.appendChild(moreBtn);
  btnRow.appendChild(allBtn);
  textCard.appendChild(btnRow);
  resultsEl.appendChild(textCard);

  // Reconstruct line breaks: pdf.js flags the last item of a visual line with
  // hasEOL, so honouring it reads far closer to the page than a space-joined blob.
  const pageTexts = [];     // { n, text }
  const emptyPages = [];    // pages with no extractable text (likely scanned images)
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let out = '';
      for (const item of content.items) {
        out += item.str;
        if (item.hasEOL) out += '\n';
        else if (item.str && !item.str.endsWith(' ')) out += ' ';
      }
      const text = out.replace(/[ \t]+\n/g, '\n').trim();
      pageTexts.push({ n: i, text });
      if (!text) emptyPages.push(i);
    } catch (_) {
      pageTexts.push({ n: i, text: '(could not extract text)' });
    }
  }

  if (emptyPages.length) {
    textNote.style.display = '';
    if (emptyPages.length === pdf.numPages) {
      textNote.textContent = 'No embedded text on any page - this looks like a scanned / image-only PDF. Use OCR below to read it.';
    } else {
      const list = emptyPages.length > 12 ? emptyPages.slice(0, 12).join(', ') + '…' : emptyPages.join(', ');
      textNote.textContent = emptyPages.length + ' page' + (emptyPages.length === 1 ? '' : 's') +
        ' have no embedded text (likely scanned): ' + list + '. Use OCR for those.';
    }
  }

  let visibleCount = Math.min(3, pageTexts.length);

  function renderVisible() {
    textWrap.innerHTML = '';
    if (!pageTexts.length) {
      textWrap.appendChild(el('div', { class: 'anr-info' }, '(no text content found)'));
    }
    for (const pt of pageTexts.slice(0, visibleCount)) {
      const block = el('div', { style: 'margin:0 0 14px;' });
      const head = el('div', { style: 'display:flex;align-items:center;gap:10px;margin:0 0 4px;' });
      head.appendChild(el('span', { style: 'font-size:11px;opacity:0.7;font-family:var(--font-mono);' }, 'Page ' + pt.n));
      if (pt.text && pt.text !== '(could not extract text)') {
        const copyBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Copy');
        copyBtn.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(pt.text); copyBtn.textContent = 'Copied'; }
          catch (_) { copyBtn.textContent = 'Failed'; }
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
        head.appendChild(copyBtn);
      }
      block.appendChild(head);
      const pre = el('pre', { class: 'anr-ocr-text', style: 'white-space:pre-wrap;margin:0;' });
      pre.textContent = pt.text || '(no text on this page)';
      block.appendChild(pre);
      textWrap.appendChild(block);
    }
    if (visibleCount >= pageTexts.length) {
      btnRow.hidden = true;
    } else {
      btnRow.hidden = false;
      moreBtn.textContent = 'Show next 3 pages (' + visibleCount + '/' + pageTexts.length + ')';
    }
  }

  renderVisible();

  moreBtn.addEventListener('click', () => {
    visibleCount = Math.min(visibleCount + 3, pageTexts.length);
    renderVisible();
  });
  allBtn.addEventListener('click', () => {
    visibleCount = pageTexts.length;
    renderVisible();
  });

  // --- Thumbnail previews (first 4 pages, click to view full page) ---
  const thumbCard = el('div', { class: 'anr-card' });
  thumbCard.appendChild(el('h3', {}, 'Page previews'));

  // Touch devices have no hover, so the per-page action buttons (Analyse / OCR /
  // PNG) that normally appear on hover are shown permanently there instead.
  const isTouch = !!(window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches);
  const thumbContainer = el('div', {
    style: 'display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-start;'
  });

  const PDF_ZOOM = 2;   // double-click / double-tap zoom factor in the viewer
  function openPageViewer(startPage) {
    let overlay = document.getElementById('anr-pdf-viewer');
    if (!overlay) {
      overlay = el('div', { id: 'anr-pdf-viewer', class: 'lightbox anr-doc-lightbox' });
      const closeBtn = el('button', { type: 'button', class: 'lightbox-close' }, 'Close');
      const center = el('div', { class: 'lightbox-center' });
      const stage = el('div', { class: 'anr-doc-stage anr-pdf-stage' });
      const pagebox = el('div', { class: 'anr-pdf-pagebox' });
      const cv = el('canvas', {});
      const textLayer = el('div', { class: 'textLayer' });
      pagebox.appendChild(cv);
      pagebox.appendChild(textLayer);
      stage.appendChild(pagebox);
      const toolbar = el('div', { class: 'lightbox-toolbar' });
      const meta = el('p', { class: 'lightbox-meta' });
      center.appendChild(stage);
      center.appendChild(toolbar);
      center.appendChild(meta);
      overlay.appendChild(closeBtn);
      overlay.appendChild(center);
      // Raw hide vs. user-close: close() also unwinds the Back-button history entry.
      overlay._hide = function () { overlay.hidden = true; document.body.style.overflow = ''; overlay._backClose = null; };
      function close() { if (overlay._backClose) overlay._backClose(); else overlay._hide(); }
      closeBtn.addEventListener('click', close);
      // Backdrop click closes - but not when finishing a text selection on it.
      overlay.addEventListener('click', (e) => {
        if (e.target !== overlay) return;
        const sel = window.getSelection && window.getSelection();
        if (sel && String(sel).length) return;
        close();
      });
      document.addEventListener('keydown', (e) => {
        if (overlay.hidden) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') overlay._prev && overlay._prev();
        else if (e.key === 'ArrowRight') overlay._next && overlay._next();
      });

      // Zoom on double-click / double-tap (single tap+drag stays free for
      // selecting text on the layer). CSS `zoom` scales canvas + text layer
      // together while keeping selection live; the stage scrolls to pan.
      let zoomed = false;
      overlay._resetZoom = () => { zoomed = false; pagebox.style.zoom = ''; };
      overlay._toggleZoom = (clientX, clientY) => {
        zoomed = !zoomed;
        if (!zoomed) { pagebox.style.zoom = ''; return; }
        const rect = pagebox.getBoundingClientRect();
        const cx = stage.scrollLeft + (clientX - rect.left);
        const cy = stage.scrollTop + (clientY - rect.top);
        pagebox.style.zoom = String(PDF_ZOOM);
        stage.scrollLeft = cx * PDF_ZOOM - stage.clientWidth / 2;
        stage.scrollTop = cy * PDF_ZOOM - stage.clientHeight / 2;
      };
      stage.addEventListener('dblclick', (e) => { e.preventDefault(); overlay._toggleZoom(e.clientX, e.clientY); });
      let lastTap = 0, lastX = 0, lastY = 0;
      stage.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'touch') return;
        const now = e.timeStamp;
        if (now - lastTap < 320 && Math.abs(e.clientX - lastX) < 30 && Math.abs(e.clientY - lastY) < 30) {
          const sel = window.getSelection && window.getSelection();
          if (!(sel && String(sel).length)) overlay._toggleZoom(e.clientX, e.clientY);
          lastTap = 0;
        } else { lastTap = now; lastX = e.clientX; lastY = e.clientY; }
      });

      document.body.appendChild(overlay);
    }
    const stage = overlay.querySelector('.anr-pdf-stage');
    const pagebox = overlay.querySelector('.anr-pdf-pagebox');
    const cv = pagebox.querySelector('canvas');
    const textLayer = pagebox.querySelector('.textLayer');
    const toolbar = overlay.querySelector('.lightbox-toolbar');
    const meta = overlay.querySelector('.lightbox-meta');
    toolbar.innerHTML = '';

    let current = startPage;
    let hiRes = false;            // toggled by the High-res button below

    // Overlay a selectable, position-aligned text layer on top of the canvas.
    async function buildTextLayer(pg, cssScale, cssW, cssH) {
      textLayer.innerHTML = '';
      textLayer.style.width = cssW + 'px';
      textLayer.style.height = cssH + 'px';
      textLayer.style.setProperty('--scale-factor', String(cssScale));
      try {
        const tc = await pg.getTextContent();
        const vp = pg.getViewport({ scale: cssScale });
        const task = lib.renderTextLayer({ textContentSource: tc, container: textLayer, viewport: vp });
        await (task && task.promise ? task.promise : task);
      } catch (_) { /* page just won't be selectable */ }
    }

    async function showPage(num, keepZoom) {
      current = num;
      if (!keepZoom) { overlay._resetZoom(); stage.scrollTop = 0; stage.scrollLeft = 0; }
      meta.textContent = 'Page ' + num + ' / ' + pdf.numPages + (hiRes ? '  (hi-res)' : '') +
        '  -  double-click to zoom';
      prevBtn.style.visibility = num > 1 ? 'visible' : 'hidden';
      nextBtn.style.visibility = num < pdf.numPages ? 'visible' : 'hidden';
      try {
        const pg = await pdf.getPage(num);
        const vp = pg.getViewport({ scale: 1 });
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.82;
        // The page is laid out (CSS) at fit-to-screen size; the canvas backing
        // store is rendered larger (device density, or High-res oversampling)
        // so it stays crisp when the viewer is zoomed. Clamp the longest side to
        // MAX_SIDE to stay within browser canvas/memory limits (lower on touch).
        const cssScale = Math.min(maxW / vp.width, maxH / vp.height, 3);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const OVERSAMPLE = hiRes ? 3 : 1;
        const MAX_SIDE = isTouch ? 4096 : 8192;
        let renderScale = cssScale * dpr * OVERSAMPLE;
        const longest = Math.max(vp.width, vp.height) * renderScale;
        if (longest > MAX_SIDE) renderScale = MAX_SIDE / Math.max(vp.width, vp.height);
        const sv = pg.getViewport({ scale: renderScale });
        cv.width = Math.floor(sv.width);
        cv.height = Math.floor(sv.height);
        const cssW = Math.floor(vp.width * cssScale);
        const cssH = Math.floor(vp.height * cssScale);
        cv.style.width = cssW + 'px';
        cv.style.height = cssH + 'px';
        pagebox.style.width = cssW + 'px';
        pagebox.style.height = cssH + 'px';
        await pg.render({ canvasContext: cv.getContext('2d'), viewport: sv }).promise;
        await buildTextLayer(pg, cssScale, cssW, cssH);
      } catch (_) {
        meta.textContent = 'Page ' + num + ' - could not render';
      }
    }

    const prevBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, '← Prev');
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (current > 1) showPage(current - 1); });
    const nextBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Next →');
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (current < pdf.numPages) showPage(current + 1); });
    const zoomBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Zoom');
    zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); overlay._toggleZoom(window.innerWidth / 2, window.innerHeight / 2); });
    const hiResBtn = el('button', { type: 'button', class: 'lightbox-tool-btn', title: 'Render this page at much higher resolution for sharper zooming (slower, more memory)' }, 'High-res');
    hiResBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      hiRes = !hiRes;
      hiResBtn.classList.toggle('is-active', hiRes);
      hiResBtn.disabled = true;
      hiResBtn.textContent = hiRes ? 'Rendering…' : 'High-res';
      await showPage(current, true);   // re-render in place, keep the current zoom
      hiResBtn.disabled = false;
      hiResBtn.textContent = 'High-res';
    });
    overlay._prev = () => { if (current > 1) showPage(current - 1); };
    overlay._next = () => { if (current < pdf.numPages) showPage(current + 1); };
    toolbar.appendChild(prevBtn);
    toolbar.appendChild(nextBtn);
    toolbar.appendChild(zoomBtn);
    toolbar.appendChild(hiResBtn);

    const wasHidden = overlay.hidden;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    if (wasHidden) overlay._backClose = openOverlayBack(overlay._hide);
    showPage(startPage);
  }

  // Render a page to a high-resolution canvas (for photo analysis / OCR).
  async function renderPageHiRes(pageNum) {
    const pg = await pdf.getPage(pageNum);
    const vp = pg.getViewport({ scale: 1 });
    const scale = Math.min(3, 2000 / Math.max(vp.width, vp.height));
    const sv = pg.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(sv.width);
    cv.height = Math.floor(sv.height);
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: sv }).promise;
    return cv;
  }

  // Lightweight overlay used to show a single page's OCR result.
  function showOcrOverlay(pageNum, text) {
    const overlay = el('div', {
      style: 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;'
    });
    const inner = el('div', {
      style: 'background:var(--bg);max-width:90vw;max-height:90vh;overflow:auto;padding:24px;border:1px solid var(--hairline);position:relative;width:760px;'
    });
    const closeBtn = el('button', {
      type: 'button',
      style: 'position:absolute;top:8px;right:12px;background:transparent;border:none;font-size:22px;cursor:pointer;color:var(--fg);'
    }, '×');
    inner.appendChild(closeBtn);
    inner.appendChild(el('h3', { style: 'margin-bottom:12px;' }, 'OCR - Page ' + pageNum));
    const pre = el('pre', { class: 'anr-ocr-text', style: 'white-space:pre-wrap;font-size:13px;margin:0;' });
    pre.textContent = text || '(no text detected)';
    inner.appendChild(pre);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    function hide() { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); }
    const backClose = openOverlayBack(hide);   // device Back closes it
    closeBtn.addEventListener('click', backClose);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) backClose(); });
    const onKey = (e) => { if (e.key === 'Escape') backClose(); };
    document.addEventListener('keydown', onKey);
  }

  let thumbsRendered = 0;
  async function renderThumb(pageNum) {
    try {
      const page = await pdf.getPage(pageNum);
      const vp = page.getViewport({ scale: 1 });
      const scale = 200 / vp.width;
      const scaled = page.getViewport({ scale });
      const canvas = el('canvas', {
        width: String(Math.floor(scaled.width)),
        height: String(Math.floor(scaled.height)),
        style: 'border: 1px solid var(--hairline); cursor: pointer; display:block;'
      });
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      canvas.addEventListener('click', () => openPageViewer(pageNum));

      // Hover actions: analyse the page as a photo, or OCR just this page.
      const actions = el('div', {
        style: 'position:absolute;top:6px;left:6px;right:6px;display:flex;gap:6px;justify-content:center;' +
               (isTouch ? 'opacity:1;pointer-events:auto;' : 'opacity:0;transition:opacity 0.15s;pointer-events:none;')
      });
      const btnStyle = 'font-size:10px;padding:2px 6px;background:var(--bg);border:1px solid var(--hairline);' +
                       'color:var(--fg);cursor:pointer;font-family:var(--font-mono);';
      const analyseBtn = el('button', { type: 'button', style: btnStyle }, 'Analyse');
      const ocrBtn = el('button', { type: 'button', style: btnStyle }, 'OCR');
      const pngBtn = el('button', { type: 'button', style: btnStyle }, 'PNG');
      actions.appendChild(analyseBtn);
      actions.appendChild(ocrBtn);
      actions.appendChild(pngBtn);

      pngBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        pngBtn.textContent = '…';
        try {
          const cv = await renderPageHiRes(pageNum);
          cv.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: file.name.replace(/\.pdf$/i, '') + '-page-' + pageNum + '.png' });
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            pngBtn.textContent = 'PNG';
          }, 'image/png');
        } catch (_) { pngBtn.textContent = 'PNG'; }
      });

      analyseBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        analyseBtn.textContent = '…';
        try {
          const cv = await renderPageHiRes(pageNum);
          cv.toBlob((blob) => {
            const photoFile = new File([blob], 'page-' + pageNum + '.png', { type: 'image/png' });
            const photoResults = revealPhotoSection();
            if (photoResults) {
              renderPhoto(photoFile, photoResults,
                { sourceNote: 'Page ' + pageNum + ' of ' + (file.name || 'this PDF') + ', rendered and analysed as an image.' });
            }
            analyseBtn.textContent = 'Analyse';
          }, 'image/png');
        } catch (_) { analyseBtn.textContent = 'Analyse'; }
      });

      ocrBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const lang = await pickOcrLanguage({ title: 'OCR language - page ' + pageNum });
        if (!lang) return;
        ocrBtn.textContent = '…';
        try {
          if (!window.Tesseract) {
            const s = document.createElement('script');
            s.src = TESSERACT_URL;
            await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
          }
          const cv = await renderPageHiRes(pageNum);
          const worker = await window.Tesseract.createWorker(lang, undefined, {
            workerPath: 'assets/vendor/tesseract/worker.min.js',
            langPath: ocrLangPath(lang),
            corePath: 'assets/vendor/tesseract'
          });
          const result = await worker.recognize(cv);
          await worker.terminate();
          showOcrOverlay(pageNum, (result.data.text || '').trim());
        } catch (_) {
          showOcrOverlay(pageNum, '(OCR failed)');
        }
        ocrBtn.textContent = 'OCR';
      });

      const wrapper = el('div', { style: 'text-align: center; position: relative;' }, [
        canvas,
        actions,
        el('div', { style: 'font-size: 11px; margin-top: 4px; opacity: 0.7;' }, `Page ${pageNum}`)
      ]);
      if (!isTouch) {
        wrapper.addEventListener('mouseenter', () => { actions.style.opacity = '1'; actions.style.pointerEvents = 'auto'; });
        wrapper.addEventListener('mouseleave', () => { actions.style.opacity = '0'; actions.style.pointerEvents = 'none'; });
      }
      thumbContainer.appendChild(wrapper);
    } catch (_) {}
  }

  const initialPages = Math.min(pdf.numPages, 4);
  for (let i = 1; i <= initialPages; i++) await renderThumb(i);
  thumbsRendered = initialPages;

  const thumbBtnRow = el('div', { class: 'anr-btn-row' });
  const thumbMoreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show next 3 pages');
  const thumbAllBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show all');

  function updateThumbBtns() {
    if (thumbsRendered >= pdf.numPages) {
      thumbBtnRow.hidden = true;
    } else {
      thumbBtnRow.hidden = false;
      thumbMoreBtn.textContent = `Show next 3 pages (${thumbsRendered}/${pdf.numPages})`;
    }
  }

  thumbMoreBtn.addEventListener('click', async () => {
    const end = Math.min(thumbsRendered + 3, pdf.numPages);
    for (let i = thumbsRendered + 1; i <= end; i++) await renderThumb(i);
    thumbsRendered = end;
    updateThumbBtns();
  });
  thumbAllBtn.addEventListener('click', async () => {
    thumbAllBtn.disabled = true;
    thumbMoreBtn.disabled = true;
    for (let i = thumbsRendered + 1; i <= pdf.numPages; i++) await renderThumb(i);
    thumbsRendered = pdf.numPages;
    updateThumbBtns();
  });

  thumbBtnRow.appendChild(thumbMoreBtn);
  thumbBtnRow.appendChild(thumbAllBtn);
  updateThumbBtns();

  thumbCard.appendChild(thumbContainer);
  thumbCard.appendChild(thumbBtnRow);
  // Page previews sit above the "PDF document" info card so the pages are the
  // first thing you see.
  resultsEl.insertBefore(thumbCard, infoCard);

  // --- Embedded image extraction ---
  const imgCard = el('div', { class: 'anr-card' });
  imgCard.appendChild(el('h3', {}, 'Embedded images'));
  imgCard.appendChild(el('p', { class: 'anr-hint', style: 'font-size:12px;margin:0 0 10px;' },
    'Pull the original raster images embedded in the PDF (logos, photos, scans) - separate from the rendered page previews above.'));
  const imgExtractBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Extract embedded images');
  const imgStatus = el('span', { class: 'anr-hint', style: 'font-size:12px;margin-left:10px;' }, '');
  const imgGrid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;' });
  imgCard.appendChild(el('div', { class: 'anr-btn-row' }, [imgExtractBtn, imgStatus]));
  imgCard.appendChild(imgGrid);
  resultsEl.appendChild(imgCard);

  imgExtractBtn.addEventListener('click', async () => {
    imgExtractBtn.disabled = true;
    imgGrid.innerHTML = '';
    imgStatus.textContent = 'Scanning…';
    let found = 0;
    const seen = new Set();
    try {
      const OPS = lib.OPS;
      for (let p = 1; p <= pdf.numPages; p++) {
        imgStatus.textContent = 'Scanning page ' + p + ' / ' + pdf.numPages + '…';
        const page = await pdf.getPage(p);
        const ops = await page.getOperatorList();
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          if (fn !== OPS.paintImageXObject && fn !== OPS.paintImageXObjectRepeat) continue;
          const name = ops.argsArray[i][0];
          if (typeof name !== 'string' || seen.has(name)) continue;
          seen.add(name);
          const imgObj = await getPdfImage(page, name);
          const cv = imgObj && pdfImageToCanvas(imgObj);
          if (!cv) continue;
          found++;
          const link = el('a', {
            href: '#', title: 'Download', download: file.name.replace(/\.pdf$/i, '') + '-img-' + found + '.png',
            style: 'display:block;text-align:center;text-decoration:none;color:var(--muted);font-size:11px;'
          });
          cv.style.cssText = 'max-width:120px;max-height:120px;border:1px solid var(--hairline);display:block;background:#fff;';
          link.appendChild(cv);
          link.appendChild(el('div', { style: 'margin-top:4px;' }, cv.width + '×' + cv.height));
          link.addEventListener('click', (e) => {
            e.preventDefault();
            cv.toBlob((b) => {
              const url = URL.createObjectURL(b);
              const a = el('a', { href: url, download: link.getAttribute('download') });
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, 'image/png');
          });
          const wrap = el('div', { style: 'text-align:center;' }, [link]);
          const aBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm', style: 'margin-top:4px;' }, 'Analyse');
          aBtn.addEventListener('click', () => cv.toBlob((b) => { if (b && window._anrHandleFile) window._anrHandleFile(new File([b], 'pdf-image.png', { type: 'image/png' }), { nested: true }); }, 'image/png'));
          wrap.appendChild(aBtn);
          imgGrid.appendChild(wrap);
          if (found >= 300) break;
        }
        if (found >= 300) break;
      }
      imgStatus.textContent = found ? found + ' image' + (found === 1 ? '' : 's') + ' found - click to download' : 'No embedded raster images found.';
    } catch (e) {
      imgStatus.textContent = 'Extraction failed: ' + (e && e.message);
    }
    imgExtractBtn.disabled = false;
  });

  // --- OCR scan (render pages as images → Tesseract) ---
  const ocrCard = el('div', { class: 'anr-card' });
  const ocrDet = el('details');
  ocrDet.appendChild(el('summary', {}, 'OCR - Scan pages as images'));
  const ocrContent = el('div');

  const ocrBarEl = el('div', { class: 'anr-progress-bar' });
  const ocrLabelEl = el('div', { class: 'anr-progress-label' }, 'Ready');
  const ocrProgress = el('div', { class: 'anr-progress', style: 'display:none;' }, [ocrBarEl, ocrLabelEl]);
  ocrContent.appendChild(ocrProgress);

  const ocrOutput = el('pre', { class: 'anr-ocr-text', style: 'max-height:400px; overflow:auto;' });
  ocrOutput.hidden = true;
  ocrContent.appendChild(ocrOutput);

  const ocrBtnRow = el('div', { class: 'anr-btn-row' });
  const ocrRunBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Scan all pages');
  const ocrMoreBtn = el('button', { type: 'button', class: 'anr-btn', style: 'display:none;' }, 'Show more');
  const ocrAllBtn = el('button', { type: 'button', class: 'anr-btn', style: 'display:none;' }, 'Show all');
  ocrBtnRow.appendChild(ocrRunBtn);
  ocrBtnRow.appendChild(ocrMoreBtn);
  ocrBtnRow.appendChild(ocrAllBtn);
  ocrContent.appendChild(ocrBtnRow);
  ocrDet.appendChild(ocrContent);
  ocrCard.appendChild(ocrDet);
  resultsEl.appendChild(ocrCard);

  function setOcrBar(frac) {
    const ch = parseFloat(getComputedStyle(ocrBarEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((ocrBarEl.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    ocrBarEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }

  let ocrPageTexts = [];
  let ocrVisible = 0;
  let ocrBusy = false;

  function renderOcrVisible() {
    ocrOutput.textContent = ocrPageTexts.slice(0, ocrVisible).join('\n\n') || '(no text found)';
    if (ocrVisible >= ocrPageTexts.length) {
      ocrMoreBtn.style.display = 'none';
      ocrAllBtn.style.display = 'none';
    } else {
      ocrMoreBtn.style.display = '';
      ocrMoreBtn.textContent = 'Show next 3 pages (' + ocrVisible + '/' + ocrPageTexts.length + ')';
      ocrAllBtn.style.display = '';
    }
  }

  ocrMoreBtn.addEventListener('click', () => {
    ocrVisible = Math.min(ocrVisible + 3, ocrPageTexts.length);
    renderOcrVisible();
  });
  ocrAllBtn.addEventListener('click', () => {
    ocrVisible = ocrPageTexts.length;
    renderOcrVisible();
  });

  ocrRunBtn.addEventListener('click', async () => {
    if (ocrBusy) return;
    const ocrLang = await pickOcrLanguage({ title: 'OCR language - all pages' });
    if (!ocrLang) return;
    ocrBusy = true;
    ocrRunBtn.textContent = 'Scanning…';
    ocrRunBtn.disabled = true;
    ocrProgress.style.display = '';
    ocrOutput.hidden = false;
    ocrOutput.textContent = '';

    // Load Tesseract
    ocrLabelEl.textContent = 'Loading Tesseract.js…';
    setOcrBar(0);
    if (!window.Tesseract) {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    }
    const T = window.Tesseract;

    ocrPageTexts = [];
    const total = pdf.numPages;
    for (let i = 1; i <= total; i++) {
      ocrLabelEl.textContent = 'Scanning page ' + i + ' / ' + total + '…';
      setOcrBar((i - 1) / total);
      try {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const scale = Math.min(3, 2000 / Math.max(vp.width, vp.height));
        const scaled = page.getViewport({ scale });
        const cv = document.createElement('canvas');
        cv.width = Math.floor(scaled.width);
        cv.height = Math.floor(scaled.height);
        await page.render({ canvasContext: cv.getContext('2d'), viewport: scaled }).promise;
        const worker = await T.createWorker(ocrLang, undefined, {
          workerPath: 'assets/vendor/tesseract/worker.min.js',
          langPath: ocrLangPath(ocrLang),
          corePath: 'assets/vendor/tesseract'
        });
        const result = await worker.recognize(cv);
        await worker.terminate();
        const text = (result.data.text || '').trim();
        ocrPageTexts.push('--- Page ' + i + ' ---\n' + (text || '(no text detected)'));
      } catch (_) {
        ocrPageTexts.push('--- Page ' + i + ' ---\n(scan failed)');
      }
    }

    setOcrBar(1);
    ocrLabelEl.textContent = 'Done - ' + total + ' pages scanned';
    ocrVisible = Math.min(3, ocrPageTexts.length);
    renderOcrVisible();
    ocrRunBtn.textContent = 'Scan complete';
    ocrBusy = false;
  });
}
