/* Analyser - PDF module
   Lazy-loads pdf.js from CDN, extracts metadata, text, and page thumbnails. */

const PDFJS_URL   = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs';
const WORKER_URL  = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS_URL);
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  return pdfjsLib;
}

// ---------- helpers (same as other modules) ----------
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function row(label, value) {
  return el('tr', {}, [
    el('th', {}, label),
    el('td', {}, value == null || value === '' ? '-' : String(value))
  ]);
}

function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
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

// ---------- main render ----------
export async function renderPdf(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  window.scrollTo({ top: resultsEl.getBoundingClientRect().top + window.scrollY - 56, behavior: 'smooth' });
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Loading PDF library…`));

  let lib;
  try {
    lib = await loadPdfJs();
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Failed to load PDF.js: ' + (e && e.message)));
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
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Could not parse PDF: ' + (e && e.message)));
    return;
  }

  resultsEl.innerHTML = '';

  // --- Info card ---
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'PDF document'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('Pages', String(pdf.numPages)));

  // Metadata
  let meta = {};
  try {
    const info = await pdf.getMetadata();
    meta = (info && info.info) || {};
  } catch (_) {}
  tbl.appendChild(row('Title', meta.Title));
  tbl.appendChild(row('Author', meta.Author));
  tbl.appendChild(row('Creator', meta.Creator));
  tbl.appendChild(row('Producer', meta.Producer));
  tbl.appendChild(row('Creation date', fmtDate(meta.CreationDate)));
  tbl.appendChild(row('Modification date', fmtDate(meta.ModDate)));
  tbl.appendChild(row('PDF version', meta.PDFFormatVersion || '-'));

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
    tbl.appendChild(row('Page 1 size', `${wPt.toFixed(0)} x ${hPt.toFixed(0)} pt  (${wIn} x ${hIn} in / ${wMm} x ${hMm} mm)`));
  } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // --- Text extraction (first 3 pages) ---
  const textCard = el('div', { class: 'anr-card' });
  textCard.appendChild(el('h3', {}, 'Text content (first 3 pages)'));
  const textPre = el('pre', { class: 'anr-ocr-text' }, 'Extracting…');
  textPre.style.maxHeight = '400px';
  textPre.style.overflow = 'auto';
  textCard.appendChild(textPre);
  resultsEl.appendChild(textCard);

  const pagesToExtract = Math.min(pdf.numPages, 3);
  let allText = '';
  for (let i = 1; i <= pagesToExtract; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(' ');
      allText += `--- Page ${i} ---\n${pageText}\n\n`;
    } catch (_) {
      allText += `--- Page ${i} ---\n(could not extract text)\n\n`;
    }
  }
  textPre.textContent = allText.trim() || '(no text content found)';

  // --- Thumbnail previews (first 4 pages) ---
  const thumbCard = el('div', { class: 'anr-card' });
  thumbCard.appendChild(el('h3', {}, 'Page previews'));
  const thumbContainer = el('div', {
    style: 'display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-start;'
  });

  const pagesToRender = Math.min(pdf.numPages, 4);
  for (let i = 1; i <= pagesToRender; i++) {
    try {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      // Scale so the thumbnail is ~200px wide
      const scale = 200 / vp.width;
      const scaled = page.getViewport({ scale });
      const canvas = el('canvas', {
        width: String(Math.floor(scaled.width)),
        height: String(Math.floor(scaled.height)),
        style: 'border: 1px solid var(--c-border, #ccc); border-radius: 4px;'
      });
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;

      const wrapper = el('div', { style: 'text-align: center;' }, [
        canvas,
        el('div', { style: 'font-size: 11px; margin-top: 4px; opacity: 0.7;' }, `Page ${i}`)
      ]);
      thumbContainer.appendChild(wrapper);
    } catch (_) {}
  }

  thumbCard.appendChild(thumbContainer);
  resultsEl.appendChild(thumbCard);
}
