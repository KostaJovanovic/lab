/* Analyser - PDF module
   Lazy-loads pdf.js from CDN, extracts metadata, text, and page thumbnails. */

import { el, row, fmtBytes } from './util.js';

const PDFJS_URL      = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs';
const WORKER_URL     = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
const TESSERACT_URL  = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';

let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS_URL);
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  return pdfjsLib;
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
  tbl.appendChild(row('Application', 'PDF Document'));
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
  const openBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
    const url = URL.createObjectURL(file);
    window.open(url, '_blank');
  }}, 'Open PDF in browser');
  infoCard.appendChild(tbl);
  infoCard.appendChild(el('div', { class: 'anr-btn-row' }, [openBtn]));
  resultsEl.appendChild(infoCard);

  // --- Text extraction (all pages, revealed in batches of 3) ---
  const textCard = el('div', { class: 'anr-card' });
  textCard.appendChild(el('h3', {}, 'Text content'));
  const textPre = el('pre', { class: 'anr-ocr-text' }, 'Extracting…');
  textPre.style.maxHeight = '400px';
  textPre.style.overflow = 'auto';
  textCard.appendChild(textPre);

  const btnRow = el('div', { class: 'anr-btn-row' });
  const moreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show next 3 pages');
  const allBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show all');
  btnRow.appendChild(moreBtn);
  btnRow.appendChild(allBtn);
  textCard.appendChild(btnRow);
  resultsEl.appendChild(textCard);

  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(' ');
      pageTexts.push(`--- Page ${i} ---\n${pageText}`);
    } catch (_) {
      pageTexts.push(`--- Page ${i} ---\n(could not extract text)`);
    }
  }

  let visibleCount = Math.min(3, pageTexts.length);

  function renderVisible() {
    textPre.textContent = pageTexts.slice(0, visibleCount).join('\n\n') || '(no text content found)';
    if (visibleCount >= pageTexts.length) {
      btnRow.hidden = true;
    } else {
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
        style: 'border: 1px solid var(--hairline); border-radius: 4px;'
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

  // --- OCR scan (render pages as images → Tesseract) ---
  const ocrCard = el('div', { class: 'anr-card' });
  const ocrDet = el('details');
  ocrDet.appendChild(el('summary', {}, 'OCR — Scan pages as images'));
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
        const worker = await T.createWorker('eng');
        const result = await worker.recognize(cv);
        await worker.terminate();
        const text = (result.data.text || '').trim();
        ocrPageTexts.push('--- Page ' + i + ' ---\n' + (text || '(no text detected)'));
      } catch (_) {
        ocrPageTexts.push('--- Page ' + i + ' ---\n(scan failed)');
      }
    }

    setOcrBar(1);
    ocrLabelEl.textContent = 'Done — ' + total + ' pages scanned';
    ocrVisible = Math.min(3, ocrPageTexts.length);
    renderOcrVisible();
    ocrRunBtn.textContent = 'Scan complete';
    ocrBusy = false;
  });
}
