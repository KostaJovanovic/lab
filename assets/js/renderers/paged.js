/* Analyser - shared "page preview" presentation for documents
   ============================================================================
   Mirrors the PDF viewer's page experience for documents that have no real
   page geometry of their own (Word/ODF text, spreadsheets, presentations).

   Two halves:
     1. paginateFlow(contentEl, opts) - takes a container of flowing block
        children (paragraphs, headings, tables, images, as docx/odf produce)
        and lays them out onto A4-proportioned page sheets, breaking to a new
        sheet whenever the current one fills up. Returns an array of .anr-page
        nodes. Blocks taller than a whole page are left to overflow their sheet
        rather than being split mid-block (good enough, and never loses text).
     2. pagedPreviewCard(pages, opts) - builds the "Page previews" card: the
        sheets shown at a readable size, revealed in batches (like the PDF
        thumbnails), each clickable to open a dark lightbox that steps through
        the pages full-size with prev/next and pinch/scroll zoom.

   Callers that already have natural pages (one slide / one sheet each) build
   the .anr-page nodes themselves and skip straight to pagedPreviewCard.
   ============================================================================ */

import { el, row, openOverlayBack } from '../core/util.js';

// A4 at ~96dpi is 794x1123; we trim to a slightly narrower sheet that reads
// well inside a card and still keeps the 1:1.414 proportion.
export const PAGE_W = 760;
export const PAGE_H = 1075;
export const PAGE_PAD = 56;

// Build an empty A4 page sheet. `variant` tweaks the look ('slide' = landscape
// presentation page, 'sheet' = spreadsheet page that may grow tall).
export function makePage(variant) {
  const p = el('div', { class: 'anr-page' + (variant ? ' anr-page--' + variant : '') });
  return p;
}

// Lay flowing block content onto page sheets. Mutates contentEl (moves its
// children into the returned pages), so callers must read any whole-document
// text BEFORE calling this.
export function paginateFlow(contentEl, opts = {}) {
  const pageH = opts.pageHeight || PAGE_H;
  const maxPages = opts.maxPages || 600;

  // Offscreen host so each page can be measured with real layout while hidden.
  const host = el('div', {
    style: 'position:absolute;left:-99999px;top:0;visibility:hidden;width:' + PAGE_W + 'px;'
  });
  document.body.appendChild(host);

  const pages = [];
  let page = makePage();
  host.appendChild(page);

  const blocks = Array.from(contentEl.children);
  try {
    for (const block of blocks) {
      page.appendChild(block);
      // scrollHeight includes padding; a sheet with min-height pageH only grows
      // past pageH once its content area overflows.
      if (page.scrollHeight > pageH + 2 && page.childElementCount > 1) {
        page.removeChild(block);
        pages.push(page);
        if (pages.length >= maxPages) { page = null; break; }
        page = makePage();
        host.appendChild(page);
        page.appendChild(block);
      }
    }
  } catch (_) { /* fall through with whatever we paginated */ }

  if (page) pages.push(page);
  // Detach the sheets from the measuring host without losing them.
  for (const p of pages) p.remove();
  host.remove();
  return pages;
}

// Lay plain text onto page sheets. `mono` keeps source formatting (one block
// per line, monospace, whitespace preserved); otherwise each line becomes a
// prose paragraph. Returns page nodes ready for pagedPreviewCard.
export function paginateText(text, opts = {}) {
  const container = document.createElement('div');
  const lines = String(text == null ? '' : text).split('\n');
  if (opts.mono) {
    container.style.cssText = 'font-family:var(--font-mono, monospace);font-size:12.5px;line-height:1.5;';
    for (const ln of lines) {
      const d = document.createElement('div');
      d.style.cssText = 'white-space:pre-wrap;min-height:1.2em;';
      d.textContent = ln;
      container.appendChild(d);
    }
  } else {
    let blanks = 0;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line) { if (++blanks > 1) continue; } else blanks = 0;
      const p = document.createElement('p');
      p.style.margin = line ? '0 0 10px' : '0 0 4px';
      p.textContent = line || ' ';
      container.appendChild(p);
    }
  }
  return paginateFlow(container, opts);
}

// Open (or reuse) the document page lightbox and show `pages[startIndex]`.
// The amount a double-click / double-tap zooms the page in.
const DOC_ZOOM = 2;

function openDocLightbox(pages, startIndex, label) {
  let overlay = document.getElementById('anr-doc-viewer');
  if (!overlay) {
    overlay = el('div', { id: 'anr-doc-viewer', class: 'lightbox anr-doc-lightbox' });
    const closeBtn = el('button', { type: 'button', class: 'lightbox-close' }, 'Close');
    const center = el('div', { class: 'lightbox-center' });
    const stage = el('div', { class: 'anr-doc-stage' });
    const toolbar = el('div', { class: 'lightbox-toolbar' });
    const meta = el('p', { class: 'lightbox-meta' });
    center.appendChild(stage);
    center.appendChild(toolbar);
    center.appendChild(meta);
    overlay.appendChild(closeBtn);
    overlay.appendChild(center);
    overlay._hide = function () { overlay.hidden = true; document.body.style.overflow = ''; overlay._backClose = null; };
    function close() { if (overlay._backClose) overlay._backClose(); else overlay._hide(); }
    overlay._close = close;
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

    // --- Zoom (double-click / double-tap), leaving single tap+drag for text
    // selection. Uses the CSS `zoom` property so layout (and the scroll area)
    // scales while text stays selectable; the stage scrolls to pan. ---
    let zoomed = false;
    overlay._resetZoom = () => { zoomed = false; const s = stage.firstElementChild; if (s) s.style.zoom = ''; };
    function toggleZoom(clientX, clientY) {
      const sheet = stage.firstElementChild;
      if (!sheet) return;
      zoomed = !zoomed;
      if (!zoomed) { sheet.style.zoom = ''; return; }
      // Content point under the cursor (pre-zoom), so we can re-centre on it.
      const rect = sheet.getBoundingClientRect();
      const cx = (stage.scrollLeft + (clientX - rect.left));
      const cy = (stage.scrollTop + (clientY - rect.top));
      sheet.style.zoom = String(DOC_ZOOM);
      stage.scrollLeft = cx * DOC_ZOOM - stage.clientWidth / 2;
      stage.scrollTop = cy * DOC_ZOOM - stage.clientHeight / 2;
      overlay._zoomBtn && (overlay._zoomBtn.textContent = 'Reset zoom');
    }
    overlay._toggleZoom = toggleZoom;
    stage.addEventListener('dblclick', (e) => { e.preventDefault(); toggleZoom(e.clientX, e.clientY); });
    // Touch double-tap (mobile dblclick is unreliable).
    let lastTap = 0, lastX = 0, lastY = 0;
    stage.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      const now = e.timeStamp;
      if (now - lastTap < 320 && Math.abs(e.clientX - lastX) < 30 && Math.abs(e.clientY - lastY) < 30) {
        const sel = window.getSelection && window.getSelection();
        if (!(sel && String(sel).length)) toggleZoom(e.clientX, e.clientY);
        lastTap = 0;
      } else { lastTap = now; lastX = e.clientX; lastY = e.clientY; }
    });

    document.body.appendChild(overlay);
  }

  const stage = overlay.querySelector('.anr-doc-stage');
  const toolbar = overlay.querySelector('.lightbox-toolbar');
  const meta = overlay.querySelector('.lightbox-meta');
  toolbar.innerHTML = '';

  let current = startIndex;
  function show(idx) {
    current = Math.max(0, Math.min(pages.length - 1, idx));
    overlay._resetZoom();
    stage.innerHTML = '';
    stage.scrollTop = 0; stage.scrollLeft = 0;
    // Clone so the inline thumbnail keeps its node; lightbox content is static.
    const sheet = pages[current].cloneNode(true);
    sheet.classList.add('anr-page--lightbox');
    stage.appendChild(sheet);
    meta.textContent = (label || 'Page') + ' ' + (current + 1) + ' / ' + pages.length +
      '  -  double-click to zoom';
    prevBtn.style.visibility = current > 0 ? 'visible' : 'hidden';
    nextBtn.style.visibility = current < pages.length - 1 ? 'visible' : 'hidden';
    if (overlay._zoomBtn) overlay._zoomBtn.textContent = 'Zoom';
  }

  const prevBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, '← Prev');
  const nextBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Next →');
  const zoomBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Zoom');
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); show(current - 1); });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); show(current + 1); });
  zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); overlay._toggleZoom(window.innerWidth / 2, window.innerHeight / 2); });
  overlay._zoomBtn = zoomBtn;
  overlay._prev = () => show(current - 1);
  overlay._next = () => show(current + 1);
  toolbar.appendChild(prevBtn);
  toolbar.appendChild(nextBtn);
  toolbar.appendChild(zoomBtn);

  const wasHidden = overlay.hidden;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  if (wasHidden) overlay._backClose = openOverlayBack(overlay._hide);
  show(startIndex);
}

// Build the "Page previews" card from an array of .anr-page nodes. Pages are
// revealed in batches so a long document doesn't lay out every sheet up front.
// opts: { title, label, initial, batch }
export function pagedPreviewCard(pages, opts = {}) {
  const title = opts.title || 'Page previews';
  const label = opts.label || 'Page';
  const batch = opts.batch || 12;
  const initial = opts.initial || Math.min(pages.length, 12);
  const THUMB_W = 200;

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, title));

  if (!pages.length) {
    card.appendChild(el('p', { class: 'anr-hint' }, 'No content to preview.'));
    return card;
  }

  const grid = el('div', { class: 'anr-page-grid' });
  card.appendChild(grid);

  const btnRow = el('div', { class: 'anr-btn-row' });
  const moreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show next ' + batch + ' pages');
  const allBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show all');
  btnRow.appendChild(moreBtn);
  btnRow.appendChild(allBtn);
  card.appendChild(btnRow);

  let shown = 0;
  function addPage(i) {
    const inner = el('div', { class: 'anr-page-thumb-inner' });
    inner.appendChild(pages[i]);
    const box = el('div', { class: 'anr-page-thumb', title: 'Click to view full size' });
    box.appendChild(inner);
    box.addEventListener('click', () => openDocLightbox(pages, i, label));
    const fig = el('figure', { class: 'anr-page-fig' });
    fig.appendChild(box);
    fig.appendChild(el('figcaption', { class: 'anr-page-cap' }, label + ' ' + (i + 1)));
    grid.appendChild(fig);
    // Scale the full-width sheet down to a thumbnail (like the PDF page grid),
    // sizing the clip box from the laid-out page height - capped so a tall
    // spreadsheet stays a compact tile.
    const scale = THUMB_W / PAGE_W;
    inner.style.transform = 'scale(' + scale + ')';
    const h = pages[i].offsetHeight || PAGE_H;
    box.style.height = Math.min(Math.round(THUMB_W * 1.6), Math.round(h * scale)) + 'px';
  }
  function reveal(upTo) {
    for (; shown < upTo && shown < pages.length; shown++) addPage(shown);
    if (shown >= pages.length) {
      btnRow.hidden = true;
    } else {
      btnRow.hidden = false;
      moreBtn.textContent = 'Show next ' + batch + ' pages (' + shown + '/' + pages.length + ')';
    }
  }

  moreBtn.addEventListener('click', () => reveal(shown + batch));
  allBtn.addEventListener('click', () => reveal(pages.length));
  reveal(initial);

  return card;
}

// Build a "Text content" card of per-page, selectable + copyable text blocks
// (the same shape the PDF viewer uses), revealed in batches. `pageTexts` is one
// string per page. opts: { title, label, initial, batch }
export function pagedTextCard(pageTexts, opts = {}) {
  const label = opts.label || 'Page';
  const batch = opts.batch || 5;
  const total = pageTexts.length;
  const lower = label.toLowerCase();

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, opts.title || 'Text content'));

  const all = pageTexts.join('\n\n');
  const words = all.trim() ? all.trim().split(/\s+/).filter(Boolean).length : 0;
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Words', words.toLocaleString()));
  tbl.appendChild(row('Characters', all.length.toLocaleString()));
  card.appendChild(tbl);

  const copyAll = el('button', { type: 'button', class: 'anr-btn', style: 'margin:8px 0;' }, 'Copy all text');
  copyAll.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(all); copyAll.textContent = 'Copied ✓'; }
    catch (_) { copyAll.textContent = 'Copy failed'; }
    setTimeout(() => { copyAll.textContent = 'Copy all text'; }, 2000);
  });
  card.appendChild(copyAll);

  const wrap = el('div', { class: 'anr-pagetext-wrap' });
  card.appendChild(wrap);

  const btnRow = el('div', { class: 'anr-btn-row' });
  const moreBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show next ' + batch);
  const allBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Show all');
  btnRow.appendChild(moreBtn);
  btnRow.appendChild(allBtn);
  card.appendChild(btnRow);

  if (!total) {
    wrap.appendChild(el('p', { class: 'anr-hint' }, 'No text content found.'));
    btnRow.hidden = true;
    return card;
  }

  let shown = 0;
  function block(i) {
    const b = el('div', { class: 'anr-pagetext-block' });
    const head = el('div', { class: 'anr-pagetext-head' });
    head.appendChild(el('span', { class: 'anr-pagetext-label' }, label + ' ' + (i + 1)));
    const t = (pageTexts[i] || '').trim();
    if (t) {
      const cp = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Copy');
      cp.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(t); cp.textContent = 'Copied'; }
        catch (_) { cp.textContent = 'Failed'; }
        setTimeout(() => { cp.textContent = 'Copy'; }, 1500);
      });
      head.appendChild(cp);
    }
    b.appendChild(head);
    const pre = el('pre', { class: 'anr-pagetext' });
    pre.textContent = t || '(no text on this ' + lower + ')';
    b.appendChild(pre);
    wrap.appendChild(b);
  }
  function reveal(upTo) {
    for (; shown < upTo && shown < total; shown++) block(shown);
    if (shown >= total) { btnRow.hidden = true; }
    else { btnRow.hidden = false; moreBtn.textContent = 'Show next ' + batch + ' (' + shown + '/' + total + ')'; }
  }
  moreBtn.addEventListener('click', () => reveal(shown + batch));
  allBtn.addEventListener('click', () => reveal(total));
  reveal(Math.min(total, opts.initial || 5));

  return card;
}
