/* Analyser - nested squarified treemap (WizTree-style)
   Renders every file in every subfolder at once: files are leaf rectangles
   sized by byte size and coloured by category, nested inside folder frames.
   Canvas-based, with hover tooltips and click-to-analyse. */

import { el, fmtBytes } from './util.js';

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

// ---------- squarified layout (one level) ----------

function aspectRatio(row, sideLen, totalArea) {
  if (!row.length || !sideLen || !totalArea) return Infinity;
  const rowArea = row.reduce((s, r) => s + r.size, 0);
  const thickness = (rowArea / totalArea) * (totalArea / sideLen);
  let worst = 0;
  for (const item of row) {
    const span = (item.size / rowArea) * sideLen;
    if (span <= 0 || thickness <= 0) continue;
    const r = span > thickness ? span / thickness : thickness / span;
    if (r > worst) worst = r;
  }
  return worst;
}

function layoutRow(row, rect, totalSize, vertical) {
  const rowSize = row.reduce((s, r) => s + r.size, 0);
  const fraction = totalSize > 0 ? rowSize / totalSize : 0;
  const rects = [];
  let offset = 0;

  if (vertical) {
    const rowW = rect.w * fraction;
    for (const item of row) {
      const itemH = rowSize > 0 ? rect.h * (item.size / rowSize) : 0;
      rects.push({ x: rect.x, y: rect.y + offset, w: rowW, h: itemH, item });
      offset += itemH;
    }
    return { rects, remaining: { x: rect.x + rowW, y: rect.y, w: rect.w - rowW, h: rect.h } };
  } else {
    const rowH = rect.h * fraction;
    for (const item of row) {
      const itemW = rowSize > 0 ? rect.w * (item.size / rowSize) : 0;
      rects.push({ x: rect.x + offset, y: rect.y, w: itemW, h: rowH, item });
      offset += itemW;
    }
    return { rects, remaining: { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH } };
  }
}

function squarify(children, rect) {
  if (!children.length) return [];
  const sorted = [...children].sort((a, b) => b.size - a.size);
  if (sorted.reduce((s, c) => s + c.size, 0) <= 0) return [];

  const n = sorted.length;
  // Suffix sums so the remaining-total is O(1) per row.
  const suffix = new Array(n + 1);
  suffix[n] = 0;
  for (let k = n - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + sorted[k].size;

  const results = [];
  let i = 0;
  let curRect = { ...rect };

  while (i < n) {
    const vertical = curRect.w >= curRect.h;
    const sideLen = vertical ? curRect.h : curRect.w;

    // Total of all not-yet-placed items (this row + everything after).
    const remTotal = suffix[i];

    const row = [sorted[i]];
    i++;
    while (i < n) {
      const candidate = [...row, sorted[i]];
      if (aspectRatio(candidate, sideLen, remTotal) <= aspectRatio(row, sideLen, remTotal)) {
        row.push(sorted[i]);
        i++;
      } else {
        break;
      }
    }

    const { rects, remaining: nextRect } = layoutRow(row, curRect, remTotal, vertical);
    results.push(...rects);
    curRect = nextRect;
  }

  return results;
}

// ---------- hierarchy ----------

function buildHierarchy(items) {
  const root = { name: '', children: {}, files: [], totalSize: 0, fileCount: 0 };
  for (const item of items) {
    const parts = item.path.replace(/\\/g, '/').split('/').filter(Boolean);
    let node = root;
    const chain = [root];
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.children[parts[i]]) {
        node.children[parts[i]] = { name: parts[i], children: {}, files: [], totalSize: 0, fileCount: 0 };
      }
      node = node.children[parts[i]];
      chain.push(node);
    }
    node.files.push(item);
    for (const n of chain) { n.totalSize += item.size; n.fileCount += 1; }
  }
  return root;
}

// ---------- nested layout ----------

const PAD = 1;
const HEADER_MIN_W = 46;
const HEADER_MIN_H = 24;
const HEADER_H = 13;
const MAX_DEPTH = 14;

function layoutNode(node, rect, depth, out) {
  if (depth > MAX_DEPTH || rect.w < 2 || rect.h < 2) return;

  const entries = [];
  for (const child of Object.values(node.children)) {
    if (child.totalSize > 0) entries.push({ size: child.totalSize, dir: child });
  }
  for (const f of node.files) {
    if (f.size > 0) entries.push({ size: f.size, file: f });
  }
  if (!entries.length) return;

  const placed = squarify(entries, rect);
  for (const p of placed) {
    if (p.w <= 0 || p.h <= 0) continue;
    if (p.item.file) {
      out.files.push({ x: p.x, y: p.y, w: p.w, h: p.h, item: p.item.file });
    } else {
      const child = p.item.dir;
      const headerH = (p.w > HEADER_MIN_W && p.h > HEADER_MIN_H && depth < 3) ? HEADER_H : 0;
      out.dirs.push({ x: p.x, y: p.y, w: p.w, h: p.h, node: child, depth, headerH });
      const inner = {
        x: p.x + PAD,
        y: p.y + PAD + headerH,
        w: p.w - 2 * PAD,
        h: p.h - 2 * PAD - headerH,
      };
      if (inner.w > 3 && inner.h > 3) layoutNode(child, inner, depth + 1, out);
    }
  }
}

// ---------- rendering ----------

const LABEL_MIN_W = 50;
const LABEL_MIN_H = 16;

function contrastText(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#000000' : '#ffffff';
}

export function renderTreemap(canvas, items, opts) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!canvas._hierarchy) canvas._hierarchy = buildHierarchy(items);
  const view = canvas._viewNode || canvas._hierarchy;

  const out = { dirs: [], files: [] };
  layoutNode(view, { x: 0, y: 0, w, h }, 0, out);

  if (!out.files.length) {
    ctx.fillStyle = isDark() ? '#888' : '#888';
    ctx.font = '12px "Geist Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No files to display', w / 2, h / 2);
    ctx.textAlign = 'start';
    canvas._fileRects = [];
    return;
  }

  const dark = isDark();
  const frameColor = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.30)';
  const headerText = dark ? '#d8d8d8' : '#2a2a2a';

  // 1) Folder backdrops + frames (shallow first so children paint over)
  const dirs = out.dirs.slice().sort((a, b) => a.depth - b.depth);
  for (const d of dirs) {
    ctx.fillStyle = dark
      ? `rgba(255,255,255,${0.03 + d.depth * 0.02})`
      : `rgba(0,0,0,${0.03 + d.depth * 0.02})`;
    ctx.fillRect(d.x, d.y, d.w, d.h);
  }

  // 2) Files (leaf tiles) with bevel cushion
  ctx.font = '11px "Geist Mono", ui-monospace, monospace';
  ctx.textBaseline = 'top';
  for (const f of out.files) {
    const x = f.x + PAD / 2, y = f.y + PAD / 2;
    const fw = Math.max(f.w - PAD, 0.5), fh = Math.max(f.h - PAD, 0.5);
    const color = opts.categoryColor(f.item.category);

    ctx.fillStyle = color;
    ctx.fillRect(x, y, fw, fh);

    // Bevel cushion: light top/left, dark bottom/right
    if (fw > 3 && fh > 3) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x, y, fw, 1);
      ctx.fillRect(x, y, 1, fh);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + fh - 1, fw, 1);
      ctx.fillRect(x + fw - 1, y, 1, fh);
    }

    // Label
    if (fw >= LABEL_MIN_W && fh >= LABEL_MIN_H) {
      const name = f.item.path.split('/').pop() || f.item.path;
      ctx.fillStyle = contrastText(color);
      const maxW = fw - 7;
      let label = name;
      if (ctx.measureText(label).width > maxW) {
        while (label.length > 2 && ctx.measureText(label + '…').width > maxW) label = label.slice(0, -1);
        label += '…';
      }
      ctx.font = '11px "Geist Mono", ui-monospace, monospace';
      ctx.fillText(label, x + 4, y + 3);
      if (fh >= LABEL_MIN_H + 13) {
        ctx.globalAlpha = 0.75;
        ctx.font = '10px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(fmtBytes(f.item.size), x + 4, y + 16);
        ctx.globalAlpha = 1;
      }
    }
  }

  // 3) Folder frames + headers on top
  for (const d of dirs) {
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1);
    if (d.headerH > 0) {
      ctx.fillStyle = headerText;
      ctx.font = '700 10px "Geist Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      const maxW = d.w - 8;
      let name = d.node.name || 'root';
      if (ctx.measureText(name).width > maxW) {
        while (name.length > 2 && ctx.measureText(name + '…').width > maxW) name = name.slice(0, -1);
        name += '…';
      }
      ctx.fillText(name, d.x + 4, d.y + d.headerH / 2 + PAD);
      ctx.textBaseline = 'top';
    }
  }

  canvas._fileRects = out.files;
  canvas._headerRects = out.dirs
    .filter((d) => d.headerH > 0)
    .map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.headerH, node: d.node }));
}

// ---------- interaction ----------

function canvasXY(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function hitRects(rects, x, y) {
  if (!rects) return null;
  for (const r of rects) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
  }
  return null;
}

// ---------- cursor confirm popup ----------

let _tmMenu = null;
function closeFileMenu() {
  if (!_tmMenu) return;
  _tmMenu.remove();
  _tmMenu = null;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onEsc, true);
  window.removeEventListener('scroll', closeFileMenu, true);
}
function onOutside(e) { if (_tmMenu && !_tmMenu.contains(e.target)) closeFileMenu(); }
function onEsc(e) { if (e.key === 'Escape') closeFileMenu(); }

function showFileMenu(clientX, clientY, item, onConfirm) {
  closeFileMenu();
  const name = item.path.split('/').pop() || item.path;
  const cancelBtn = el('button', { class: 'anr-tm-btn' }, 'Cancel');
  const copyBtn = el('button', { class: 'anr-tm-btn anr-tm-copy', title: 'Copy path' }, 'Copy');
  const okBtn = el('button', { class: 'anr-tm-btn anr-tm-btn-ok' }, 'Analyse');
  const menu = el('div', { class: 'anr-treemap-menu' }, [
    el('div', { class: 'anr-tm-header' }, [
      el('div', { class: 'anr-tm-name' }, name),
      copyBtn,
    ]),
    el('div', { class: 'anr-tm-meta' }, fmtBytes(item.size) + ' · ' + item.category),
    el('div', { class: 'anr-tm-q' }, 'Process this file?'),
    el('div', { class: 'anr-tm-actions' }, [cancelBtn, okBtn]),
  ]);
  document.body.appendChild(menu);
  _tmMenu = menu;

  copyBtn.addEventListener('click', () => {
    const path = (item.path || name).replace(/\\/g, '/');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(path).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = path; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
    copyBtn.textContent = 'Copied ✓';
    setTimeout(closeFileMenu, 600);
  });

  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let px = clientX + 8, py = clientY + 8;
  if (px + mw > window.innerWidth) px = clientX - mw - 8;
  if (py + mh > window.innerHeight) py = clientY - mh - 8;
  menu.style.left = Math.max(4, px) + 'px';
  menu.style.top = Math.max(4, py) + 'px';

  cancelBtn.addEventListener('click', closeFileMenu);
  okBtn.addEventListener('click', () => { closeFileMenu(); onConfirm(); });
  // Defer so the click that opened the menu doesn't immediately dismiss it.
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
    window.addEventListener('scroll', closeFileMenu, true);
  }, 0);
}

export function attachTreemapEvents(canvas, wrap, items, opts) {
  const tooltip = el('div', { class: 'anr-treemap-tooltip' });
  wrap.appendChild(tooltip);

  // Breadcrumb (zoom navigation) — sits above the canvas.
  const breadcrumb = el('div', { class: 'anr-treemap-breadcrumb' });
  breadcrumb.hidden = true;
  wrap.insertBefore(breadcrumb, canvas);

  // Status line (selected file name) — sits below the canvas.
  const status = el('div', { class: 'anr-treemap-status' }, 'Click a folder to zoom in · click a file to analyse it');
  wrap.appendChild(status);

  const zoomStack = []; // array of folder nodes

  function viewNode() {
    return zoomStack.length ? zoomStack[zoomStack.length - 1] : canvas._hierarchy;
  }

  function redraw() {
    canvas._viewNode = viewNode();
    renderTreemap(canvas, items, opts);
    updateBreadcrumb();
  }

  function zoomTo(node) {
    zoomStack.push(node);
    status.textContent = '';
    redraw();
  }

  function updateBreadcrumb() {
    breadcrumb.innerHTML = '';
    if (!zoomStack.length) { breadcrumb.hidden = true; return; }
    breadcrumb.hidden = false;

    const allBtn = el('button', {}, 'All files');
    allBtn.addEventListener('click', () => { zoomStack.length = 0; redraw(); });
    breadcrumb.appendChild(allBtn);

    for (let i = 0; i < zoomStack.length; i++) {
      breadcrumb.appendChild(el('span', { class: 'anr-crumb-sep' }, '/'));
      const node = zoomStack[i];
      const depth = i;
      if (i === zoomStack.length - 1) {
        breadcrumb.appendChild(el('span', { class: 'anr-crumb-current' }, node.name || 'root'));
      } else {
        const btn = el('button', {}, node.name || 'root');
        btn.addEventListener('click', () => { zoomStack.length = depth + 1; redraw(); });
        breadcrumb.appendChild(btn);
      }
    }
  }

  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = canvasXY(canvas, e.clientX, e.clientY);
    const header = hitRects(canvas._headerRects, x, y);
    const file = header ? null : hitRects(canvas._fileRects, x, y);

    if (header) {
      tooltip.classList.add('is-visible');
      tooltip.innerHTML = '';
      tooltip.appendChild(el('div', { class: 'anr-tt-name' }, (header.node.name || 'root') + '/'));
      tooltip.appendChild(el('div', { class: 'anr-tt-meta' },
        header.node.fileCount + (header.node.fileCount === 1 ? ' file · ' : ' files · ') + fmtBytes(header.node.totalSize) + '  ·  zoom in'));
      positionTooltip(e);
      canvas.style.cursor = 'zoom-in';
    } else if (file) {
      tooltip.classList.add('is-visible');
      const it = file.item;
      tooltip.innerHTML = '';
      tooltip.appendChild(el('div', { class: 'anr-tt-name' }, it.path.replace(/\\/g, '/')));
      tooltip.appendChild(el('div', { class: 'anr-tt-meta' }, fmtBytes(it.size) + '  ·  ' + it.category));
      positionTooltip(e);
      canvas.style.cursor = 'default';
    } else {
      tooltip.classList.remove('is-visible');
      canvas.style.cursor = 'default';
    }
  });

  function positionTooltip(e) {
    const wrapRect = wrap.getBoundingClientRect();
    let tx = e.clientX - wrapRect.left + 12;
    let ty = e.clientY - wrapRect.top + 12;
    if (tx + tooltip.offsetWidth > wrapRect.width) tx = e.clientX - wrapRect.left - tooltip.offsetWidth - 8;
    if (ty + tooltip.offsetHeight > wrapRect.height) ty = e.clientY - wrapRect.top - tooltip.offsetHeight - 8;
    tooltip.style.left = Math.max(0, tx) + 'px';
    tooltip.style.top = Math.max(0, ty) + 'px';
  }

  canvas.addEventListener('mouseleave', () => tooltip.classList.remove('is-visible'));

  canvas.addEventListener('click', (e) => {
    const { x, y } = canvasXY(canvas, e.clientX, e.clientY);
    const header = hitRects(canvas._headerRects, x, y);
    if (header) { zoomTo(header.node); return; }
    const file = hitRects(canvas._fileRects, x, y);
    if (file) {
      showFileMenu(e.clientX, e.clientY, file.item, () => {
        if (opts.onFileClick) opts.onFileClick(file.item);
      });
    }
  });
}
