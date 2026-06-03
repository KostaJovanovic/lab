/* Analyser - shared folder/archive helpers
   Category classification, breakdown cards, and view toggle (treemap / tree)
   used by both folder.js and archive.js. */

import { el, row, fmtBytes, buildFileTree } from './util.js';
import { PHOTO_EXTS, AUDIO_EXTS, VIDEO_EXTS, DOC_EXTS, ARCHIVE_EXTS } from './formats.js';
import { renderTreemap, attachTreemapEvents } from './treemap.js';

// ---------- category classification ----------

export const CATEGORIES = ['photo', 'audio', 'video', 'document', 'archive', 'other'];

export const CATEGORY_COLORS = {
  photo:    { light: '#3b82f6', dark: '#60a5fa' },
  audio:    { light: '#f59e0b', dark: '#fbbf24' },
  video:    { light: '#8b5cf6', dark: '#a78bfa' },
  document: { light: '#10b981', dark: '#34d399' },
  archive:  { light: '#ef4444', dark: '#f87171' },
  other:    { light: '#6b7280', dark: '#9ca3af' },
};

export const CATEGORY_LABELS = {
  photo: 'Photo', audio: 'Audio', video: 'Video',
  document: 'Document', archive: 'Archive', other: 'Other',
};

export function categorizeExt(ext) {
  if (!ext) return 'other';
  ext = ext.toLowerCase();
  if (PHOTO_EXTS.has(ext) || ext === 'psd' || ext === 'svg') return 'photo';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (DOC_EXTS.has(ext)) return 'document';
  return 'other';
}

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

export function categoryColor(cat) {
  const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.other;
  return isDark() ? c.dark : c.light;
}

// ---------- normalize items ----------

function extOf(name) {
  const m = name.match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export function normalizeFolder(files) {
  return files.map(f => {
    const ext = extOf(f.path);
    return { path: f.path, size: f.size, file: f.file || null, entry: null, category: categorizeExt(ext), ext };
  });
}

export function normalizeArchive(entries) {
  return entries.filter(e => !e.isDir).map(e => {
    const ext = extOf(e.name);
    return { path: e.name, size: e.uncompSize, file: null, entry: e, category: categorizeExt(ext), ext };
  });
}

// ---------- breakdown ----------

export function buildCategoryBreakdown(items) {
  const byCategory = {};
  const byExt = {};
  for (const cat of CATEGORIES) byCategory[cat] = { count: 0, size: 0 };
  for (const item of items) {
    byCategory[item.category].count += 1;
    byCategory[item.category].size += item.size;
    const ext = item.ext || '(no ext)';
    if (!byExt[ext]) byExt[ext] = { count: 0, size: 0 };
    byExt[ext].count += 1;
    byExt[ext].size += item.size;
  }
  const sorted = Object.entries(byExt).sort((a, b) => b[1].count - a[1].count);
  return { byCategory, byExt, sorted };
}

const VISIBLE_EXT_COUNT = 5;

function fmtExtRow(ext, data) {
  const dot = ext === '(no ext)' ? ext : '.' + ext;
  return row(dot, data.count + (data.count === 1 ? ' file' : ' files') + '  (' + fmtBytes(data.size) + ')');
}

export function renderBreakdownCards(items, resultsEl, extraSummaryRows) {
  const breakdown = buildCategoryBreakdown(items);
  const totalSize = items.reduce((s, i) => s + i.size, 0);

  // Summary card
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Overview'));
  const tbl = el('table', { class: 'anr-readout' });
  if (extraSummaryRows) {
    for (const r of extraSummaryRows) tbl.appendChild(r);
  }
  tbl.appendChild(row('Files', items.length.toLocaleString()));
  tbl.appendChild(row('Total size', fmtBytes(totalSize) + '  (' + totalSize.toLocaleString() + ' bytes)'));

  const catParts = [];
  for (const cat of CATEGORIES) {
    const d = breakdown.byCategory[cat];
    if (d.count) catParts.push(d.count + ' ' + CATEGORY_LABELS[cat].toLowerCase());
  }
  tbl.appendChild(row('Categories', catParts.join(', ') || '-'));
  tbl.appendChild(row('Unique extensions', String(breakdown.sorted.length)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // File types card — first 5 visible, rest behind "show more"
  if (breakdown.sorted.length) {
    const extCard = el('div', { class: 'anr-card' });
    extCard.appendChild(el('h3', {}, 'File types'));

    const visible = breakdown.sorted.slice(0, VISIBLE_EXT_COUNT);
    const hidden = breakdown.sorted.slice(VISIBLE_EXT_COUNT);

    const extTbl = el('table', { class: 'anr-readout' });
    for (const [ext, data] of visible) extTbl.appendChild(fmtExtRow(ext, data));
    extCard.appendChild(extTbl);

    if (hidden.length) {
      const details = el('details', { class: 'anr-ext-more' });
      details.appendChild(el('summary', {}, hidden.length + ' more'));
      const hiddenTbl = el('table', { class: 'anr-readout' });
      for (const [ext, data] of hidden) hiddenTbl.appendChild(fmtExtRow(ext, data));
      details.appendChild(hiddenTbl);
      extCard.appendChild(details);
    }

    resultsEl.appendChild(extCard);
  }

  return breakdown;
}

// ---------- view toggle (treemap / tree) ----------

export function renderViewToggle(container, items, treeObj, treeOpts, onFileClick) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Contents'));

  // Controls bar — toggle + legend in one row
  const controls = el('div', { class: 'anr-view-controls' });
  const toggle = el('div', { class: 'anr-toggle' });
  const btnTreemap = el('button', { class: 'is-active' }, 'Treemap');
  const btnTree = el('button', {}, 'Tree');
  toggle.appendChild(btnTreemap);
  toggle.appendChild(btnTree);
  controls.appendChild(toggle);

  const legend = el('div', { class: 'anr-treemap-legend' });
  const bk = buildCategoryBreakdown(items);
  for (const cat of CATEGORIES) {
    const d = bk.byCategory[cat];
    if (!d.count) continue;
    const swatch = el('span', { class: 'anr-legend-swatch', style: 'background:' + categoryColor(cat) });
    legend.appendChild(el('span', { class: 'anr-legend-item' }, [swatch, ' ' + CATEGORY_LABELS[cat]]));
  }
  controls.appendChild(legend);
  card.appendChild(controls);

  const contentArea = el('div', { class: 'anr-treemap-content' });
  card.appendChild(contentArea);

  function showTreemap() {
    btnTreemap.classList.add('is-active');
    btnTree.classList.remove('is-active');
    contentArea.innerHTML = '';
    const wrap = el('div', { class: 'anr-treemap-wrap' });
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    contentArea.appendChild(wrap);

    function draw() {
      const rect = wrap.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.max(380, Math.min(560, Math.round(w * 0.6)));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      renderTreemap(canvas, items, { categoryColor, onFileClick });
    }

    draw();
    attachTreemapEvents(canvas, wrap, items, { categoryColor, onFileClick });

    const ro = new ResizeObserver(() => {
      clearTimeout(canvas._roTimer);
      canvas._roTimer = setTimeout(draw, 150);
    });
    ro.observe(wrap);
    canvas._ro = ro;
  }

  function showTree() {
    btnTree.classList.add('is-active');
    btnTreemap.classList.remove('is-active');
    contentArea.innerHTML = '';
    const fullOpts = {
      ...treeOpts,
      fileAccent: (key) => categoryColor(categorizeExt(extOf(key))),
    };
    const tree = buildFileTree(treeObj, fullOpts);
    contentArea.appendChild(tree);
  }

  btnTreemap.addEventListener('click', showTreemap);
  btnTree.addEventListener('click', showTree);

  showTreemap();
  container.appendChild(card);
}
