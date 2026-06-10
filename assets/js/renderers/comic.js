/* Analyser - Comic book archive viewer (CBZ / CBR / CBT / CB7).

   Mirrors the PDF viewer's UX: a metadata card, a page-thumbnail grid, and a
   click-to-open lightbox reader with prev/next (and arrow-key) navigation. Pages
   are image files inside the archive; they're extracted on demand so a 200-page
   comic doesn't build hundreds of object URLs up front. CBZ is a ZIP, CBT a TAR,
   and CBR/CB7 go through the lazy libarchive (unrar/7z) WASM loader. */

import { el, row, rowHelp, fmtBytes, errorCard, integrityCard, attachZoomPan, openOverlayBack } from '../core/util.js';
import { openZip } from './zip.js';

const IMG_RE = /\.(jpe?g|png|gif|webp|avif|bmp|jxl)$/i;
const NATIVE_RE = /\.(jpe?g|png|gif|webp|avif)$/i;   // formats <img> can display directly
const natCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

// Minimal TAR walker for .cbt: returns image page entries + ComicInfo.xml text.
function tarPages(buf) {
  const pages = [];
  let comicInfo = null;
  const dec = new TextDecoder('latin1');
  const oct = (s) => parseInt(s.replace(/\0.*$/s, '').trim(), 8) || 0;
  let p = 0;
  while (p + 512 <= buf.length) {
    const name = dec.decode(buf.subarray(p, p + 100)).replace(/\0.*$/s, '');
    if (!name) break;                                  // run of zero blocks = end
    const size = oct(dec.decode(buf.subarray(p + 124, p + 136)));
    const type = buf[p + 156];
    const start = p + 512;
    if ((type === 48 || type === 0) && size > 0) {
      if (IMG_RE.test(name)) pages.push({ name, getBytes: async () => buf.subarray(start, start + size) });
      else if (/comicinfo\.xml$/i.test(name)) { try { comicInfo = new TextDecoder('utf-8').decode(buf.subarray(start, start + size)); } catch (_) {} }
    }
    p = start + Math.ceil(size / 512) * 512;
  }
  return { pages, comicInfo };
}

// Returns { pages: [{name, getBytes}], comicInfo } for the archive.
async function extractPages(file, ext) {
  if (ext === 'cbz') {
    const zip = await openZip(file, Math.min(file.size, 800 * 1024 * 1024));
    const names = zip.names();
    const imgs = names.filter((n) => IMG_RE.test(n) && !/^__MACOSX\//.test(n)).sort(natCmp);
    const ciName = names.find((n) => /comicinfo\.xml$/i.test(n));
    const comicInfo = ciName ? await zip.text(ciName).catch(() => null) : null;
    return { pages: imgs.map((n) => ({ name: n, getBytes: () => zip.bytes(n) })), comicInfo };
  }
  if (ext === 'cbt') {
    const buf = new Uint8Array(await file.arrayBuffer());
    const r = tarPages(buf);
    r.pages.sort((a, b) => natCmp(a.name, b.name));
    return r;
  }
  // cbr / cb7 -> libarchive (lazy WASM)
  const { extractArchive } = await import('../lib/libarchive-loader.js');
  const arc = await extractArchive(file);
  const imgs = (arc.entries || []).filter((e) => IMG_RE.test(e.name)).sort((a, b) => natCmp(a.name, b.name));
  let comicInfo = null;
  const ci = (arc.entries || []).find((e) => /comicinfo\.xml$/i.test(e.name));
  if (ci) { try { comicInfo = new TextDecoder('utf-8').decode(await ci.getBytes()); } catch (_) {} }
  return { pages: imgs.map((e) => ({ name: e.name, getBytes: () => e.getBytes() })), comicInfo };
}

// Pull common fields out of a ComicInfo.xml string.
function parseComicInfo(xml) {
  const out = {};
  if (!xml) return out;
  const grab = (tag) => { const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i')); return m ? m[1].trim() : null; };
  for (const [tag, label] of [
    ['Series', 'Series'], ['Title', 'Title'], ['Number', 'Issue'], ['Count', 'Issue count'],
    ['Volume', 'Volume'], ['Writer', 'Writer'], ['Penciller', 'Penciller'], ['Inker', 'Inker'],
    ['Colorist', 'Colorist'], ['Publisher', 'Publisher'], ['Year', 'Year'], ['Month', 'Month'],
    ['Genre', 'Genre'], ['LanguageISO', 'Language'], ['AgeRating', 'Age rating'], ['Summary', 'Summary'],
  ]) { const v = grab(tag); if (v) out[label] = v.replace(/\s+/g, ' '); }
  return out;
}

export async function renderComic(file, resultsEl, extOverride) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Opening "${file.name}"…`));
  const ext = extOverride || (file.name.split('.').pop() || '').toLowerCase();

  let data;
  try {
    data = await extractPages(file, ext);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not open comic archive: ' + (e && e.message ? e.message : e)));
    resultsEl.appendChild(integrityCard(file));
    return;
  }

  const pages = data.pages || [];
  resultsEl.innerHTML = '';
  if (!pages.length) {
    resultsEl.appendChild(errorCard('No image pages were found inside this comic archive.'));
    resultsEl.appendChild(integrityCard(file));
    return;
  }
  const ci = parseComicInfo(data.comicInfo);

  // Per-page object-URL cache (created on demand; kept for the session).
  const urlCache = new Map();
  async function pageUrl(i) {
    if (urlCache.has(i)) return urlCache.get(i);
    const bytes = await pages[i].getBytes();
    const url = URL.createObjectURL(new Blob([bytes]));
    urlCache.set(i, url);
    return url;
  }

  // --- Metadata card ---
  const APP = { cbz: 'Comic Book ZIP', cbr: 'Comic Book RAR', cbt: 'Comic Book TAR', cb7: 'Comic Book 7-Zip' };
  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, ci.Series ? (ci.Series + (ci.Issue ? ' #' + ci.Issue : '')) : 'Comic book'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', APP[ext] || 'Comic Book Archive'));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  tbl.appendChild(rowHelp('Pages', String(pages.length), 'The number of image pages found inside the comic archive.'));
  // Format breakdown of the pages.
  const fmtCount = {};
  for (const p of pages) { const e = (p.name.split('.').pop() || '').toLowerCase(); fmtCount[e] = (fmtCount[e] || 0) + 1; }
  tbl.appendChild(row('Page formats', Object.entries(fmtCount).map(([k, v]) => k.toUpperCase() + ' ×' + v).join(', ')));
  for (const [k, v] of Object.entries(ci)) tbl.appendChild(row(k, v));
  metaCard.appendChild(tbl);
  resultsEl.appendChild(metaCard);

  // --- Lightbox reader (built lazily, reused) ---
  function openReader(start) {
    let overlay = document.getElementById('anr-comic-viewer');
    if (!overlay) {
      overlay = el('div', { id: 'anr-comic-viewer', class: 'lightbox' });
      const closeBtn = el('button', { type: 'button', class: 'lightbox-close' }, 'Close');
      const center = el('div', { class: 'lightbox-center' });
      const imgWrap = el('div', { class: 'lightbox-img-wrap' });
      const img = el('img', { alt: '', style: 'max-width:90vw;max-height:82vh;display:block;' });
      imgWrap.appendChild(img);
      const toolbar = el('div', { class: 'lightbox-toolbar' });
      const meta = el('p', { class: 'lightbox-meta' });
      center.appendChild(imgWrap); center.appendChild(toolbar); center.appendChild(meta);
      overlay.appendChild(closeBtn); overlay.appendChild(center);
      overlay._zoom = attachZoomPan(imgWrap);
      overlay._hide = () => { overlay.hidden = true; document.body.style.overflow = ''; overlay._backClose = null; };
      const close = () => { if (overlay._backClose) overlay._backClose(); else overlay._hide(); };
      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', (e) => {
        if (overlay.hidden) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft' && overlay._prev) overlay._prev();
        else if (e.key === 'ArrowRight' && overlay._next) overlay._next();
      });
      document.body.appendChild(overlay);
    }
    const img = overlay.querySelector('.lightbox-img-wrap img');
    const toolbar = overlay.querySelector('.lightbox-toolbar');
    const meta = overlay.querySelector('.lightbox-meta');
    toolbar.innerHTML = '';
    let current = start;
    async function show(i) {
      current = i;
      if (overlay._zoom) overlay._zoom.reset();
      meta.textContent = 'Page ' + (i + 1) + ' / ' + pages.length;
      prevBtn.style.visibility = i > 0 ? 'visible' : 'hidden';
      nextBtn.style.visibility = i < pages.length - 1 ? 'visible' : 'hidden';
      try { img.src = await pageUrl(i); }
      catch (_) { meta.textContent = 'Page ' + (i + 1) + ' - could not render'; }
    }
    const prevBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, '← Prev');
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (current > 0) show(current - 1); });
    const nextBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Next →');
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (current < pages.length - 1) show(current + 1); });
    overlay._prev = () => { if (current > 0) show(current - 1); };
    overlay._next = () => { if (current < pages.length - 1) show(current + 1); };
    toolbar.appendChild(prevBtn); toolbar.appendChild(nextBtn);
    const wasHidden = overlay.hidden;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    if (wasHidden) overlay._backClose = openOverlayBack(overlay._hide);
    show(start);
  }

  // --- Page previews (thumbnail grid) ---
  const thumbCard = el('div', { class: 'anr-card' });
  const headRow = el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;' });
  headRow.appendChild(el('h3', {}, 'Page previews'));
  const readBtn = el('button', { type: 'button', class: 'anr-btn', style: 'font-size:11px;padding:3px 10px;' }, 'Read (' + pages.length + ' pages)');
  readBtn.addEventListener('click', () => openReader(0));
  headRow.appendChild(readBtn);
  thumbCard.appendChild(headRow);
  const thumbContainer = el('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;justify-content:flex-start;margin-top:12px;' });
  thumbCard.appendChild(thumbContainer);
  resultsEl.appendChild(thumbCard);

  const THUMB_LIMIT = 12;
  const shown = Math.min(THUMB_LIMIT, pages.length);
  for (let i = 0; i < shown; i++) {
    const native = NATIVE_RE.test(pages[i].name);
    const cap = el('div', { style: 'font-family:var(--font-mono);font-size:10px;color:var(--muted);text-align:center;margin-top:4px;' }, 'Page ' + (i + 1));
    const thumb = el('div', { style: 'width:120px;cursor:pointer;', title: 'Page ' + (i + 1) + ' - click to read' });
    const img = el('img', { loading: 'lazy', alt: '', style: 'width:120px;height:170px;object-fit:cover;display:block;border:1px solid var(--hairline);background:var(--surface);' });
    thumb.appendChild(img);
    thumb.appendChild(cap);
    thumb.addEventListener('click', () => openReader(i));
    thumbContainer.appendChild(thumb);
    // Decode the page (libarchive/zip may yield bmp/jxl which <img> can't show -
    // those still open in the reader, just without a thumbnail image).
    if (native) pageUrl(i).then((u) => { img.src = u; }).catch(() => {});
  }
  if (pages.length > shown) {
    thumbCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:12px;' },
      '+ ' + (pages.length - shown) + ' more pages - open the reader to view them all.'));
  }

  resultsEl.appendChild(integrityCard(file));
}
