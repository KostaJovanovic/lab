/* Analyser - archive module
   Lazy-loads fflate from CDN to inspect ZIP archives without full extraction.
   Uses the shared folder/archive modules for treemap, breakdown, and tree. */

import { el, row, fmtBytes, buildFileTree, isUnreadableError, cloudFileWarning, errorCard } from './util.js';
import { normalizeArchive, renderBreakdownCards, renderViewToggle, categorizeExt } from './folder-archive-shared.js';
import { ARCHIVE_EXTS } from './formats.js';

const FFLATE_URL = new URL('../vendor/fflate.js', import.meta.url).href;

let fflateLib = null;

async function loadFflate() {
  if (fflateLib) return fflateLib;
  fflateLib = await import(FFLATE_URL);
  return fflateLib;
}

// ---------- ZIP parsing via central directory ----------

function parseZipEntries(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const entries = [];

  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) return entries;

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize   = view.getUint32(eocdOffset + 12, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);

  let pos = cdOffset;
  const decoder = new TextDecoder();

  for (let i = 0; i < entryCount && pos < cdOffset + cdSize; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const compMethod    = view.getUint16(pos + 10, true);
    const compSize      = view.getUint32(pos + 20, true);
    const uncompSize    = view.getUint32(pos + 24, true);
    const nameLen       = view.getUint16(pos + 28, true);
    const extraLen      = view.getUint16(pos + 30, true);
    const commentLen    = view.getUint16(pos + 32, true);
    const name          = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    const isDir         = name.endsWith('/');

    entries.push({ name, compSize, uncompSize, compMethod, isDir });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// ---------- MIME guess for extracted files ----------

const MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
  ogg: 'audio/ogg', opus: 'audio/opus', aac: 'audio/aac',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  webm: 'video/webm', pdf: 'application/pdf', json: 'application/json',
  xml: 'application/xml', html: 'text/html', css: 'text/css', js: 'text/javascript',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', zip: 'application/zip',
};

function guessMime(ext) {
  return MIME_MAP[ext] || 'application/octet-stream';
}

function extOf(name) {
  const m = name.match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

// ---------- main render ----------
export async function renderArchive(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading ZIP archive "${file.name}"…`));

  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    resultsEl.innerHTML = '';
    if (isUnreadableError(e)) {
      resultsEl.appendChild(cloudFileWarning(file));
    } else {
      resultsEl.appendChild(errorCard('Could not read file: ' + (e && e.message)));
    }
    return;
  }

  const entries = parseZipEntries(buf);
  if (entries.length === 0) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('No entries found in this ZIP file, or the archive is corrupt.'));
    return;
  }

  resultsEl.innerHTML = '';

  // --- ZIP summary card ---
  const fileEntries = entries.filter((e) => !e.isDir);
  const dirEntries  = entries.filter((e) => e.isDir);
  const totalUncomp = fileEntries.reduce((s, e) => s + e.uncompSize, 0);
  const totalComp   = fileEntries.reduce((s, e) => s + e.compSize, 0);
  const ratio       = totalUncomp > 0 ? ((1 - totalComp / totalUncomp) * 100).toFixed(1) : '0';

  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'ZIP archive'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'ZIP Archive'));
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Archive size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('Files', String(fileEntries.length)));
  tbl.appendChild(row('Directories', String(dirEntries.length)));
  tbl.appendChild(row('Total uncompressed', fmtBytes(totalUncomp)));
  tbl.appendChild(row('Total compressed', fmtBytes(totalComp)));
  tbl.appendChild(row('Compression ratio', ratio + '%'));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // --- Category breakdown ---
  const items = normalizeArchive(entries);
  renderBreakdownCards(items, resultsEl);

  // --- Extract a file from the archive (for click-to-analyse) ---
  async function extractFile(entryName) {
    const ffl = await loadFflate();
    const data = new Uint8Array(buf);
    const unzipped = ffl.unzipSync(data, { filter: (f) => f.name === entryName });
    const content = unzipped[entryName];
    if (!content) return null;
    const ext = extOf(entryName);
    const fileName = entryName.split('/').pop() || entryName;
    return new File([content], fileName, { type: guessMime(ext) });
  }

  // --- Click-to-analyse handler (treemap) ---
  function onFileClick(item) {
    if (!item || !item.entry) return;
    const ext = extOf(item.entry.name);
    if (ARCHIVE_EXTS.has(ext)) {
      extractFile(item.entry.name).then(f => {
        if (f) renderArchive(f, resultsEl);
      });
    } else {
      extractFile(item.entry.name).then(f => {
        if (f && window._anrHandleFile) window._anrHandleFile(f);
      });
    }
  }

  // --- Click handler for tree view (receives key, value from buildFileTree) ---
  // We need an entry lookup by name
  const entryByName = {};
  for (const e of entries) entryByName[e.name] = e;

  function onTreeFileClick(key, val) {
    const entry = val && val.name ? val : null;
    if (!entry) return;
    const ext = extOf(entry.name);
    if (ARCHIVE_EXTS.has(ext)) {
      extractFile(entry.name).then(f => {
        if (f) renderArchive(f, resultsEl);
      });
    } else {
      extractFile(entry.name).then(f => {
        if (f && window._anrHandleFile) window._anrHandleFile(f);
      });
    }
  }

  // --- Build tree object ---
  const tree = {};
  for (const entry of entries) {
    const parts = entry.name.split('/').filter((p) => p);
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1 && !entry.isDir) {
        node[part] = entry;
      } else {
        if (!node[part] || typeof node[part] !== 'object' || node[part].name) {
          node[part] = {};
        }
        node = node[part];
      }
    }
  }

  renderViewToggle(resultsEl, items, tree, {
    isDir: (v) => v && typeof v === 'object' && !v.name,
    fileSize: (v) => (v && v.uncompSize) || 0,
    copyPath: (_key, entry) => entry && entry.name,
    onFileClick: onTreeFileClick
  }, onFileClick);

  // --- Text file previews ---
  const textExts = new Set(['txt', 'md', 'json', 'xml', 'csv', 'tsv', 'html', 'htm',
    'css', 'js', 'ts', 'py', 'rb', 'java', 'c', 'h', 'cpp', 'rs', 'go',
    'yaml', 'yml', 'toml', 'ini', 'cfg', 'log', 'sh', 'bat', 'sql', 'svg']);

  const previewable = fileEntries.filter((e) => {
    if (e.uncompSize > 10240) return false;
    const ext = (e.name.match(/\.([^.]+)$/) || [])[1];
    return ext && textExts.has(ext.toLowerCase());
  });

  if (previewable.length > 0) {
    const prevCard = el('div', { class: 'anr-card' });
    prevCard.appendChild(el('h3', {}, 'Text file previews'));
    prevCard.appendChild(el('p', {
      class: 'anr-hint',
      style: 'margin: 0 0 8px; font-size: 12px;'
    }, `${previewable.length} small text file(s) can be previewed. Click to expand.`));

    let ffl = null;

    for (const entry of previewable.slice(0, 20)) {
      const details = el('details', {});
      const summary = el('summary', {
        style: 'cursor: pointer; font-weight: bold; margin: 4px 0; font-size: 13px;'
      }, entry.name + '  (' + fmtBytes(entry.uncompSize) + ')');
      details.appendChild(summary);

      const pre = el('pre', { class: 'anr-ocr-text' }, '');
      pre.style.maxHeight = '300px';
      pre.style.overflow = 'auto';
      details.appendChild(pre);

      let loaded = false;
      details.addEventListener('toggle', async () => {
        if (!details.open || loaded) return;
        loaded = true;
        pre.textContent = 'Decompressing…';
        try {
          if (!ffl) ffl = await loadFflate();
          const data = new Uint8Array(buf);
          const unzipped = ffl.unzipSync(data, {
            filter: (f) => f.name === entry.name
          });
          const content = unzipped[entry.name];
          if (content) {
            pre.textContent = new TextDecoder().decode(content);
          } else {
            pre.textContent = '(could not extract)';
          }
        } catch (e) {
          pre.textContent = 'Extraction error: ' + (e && e.message);
        }
      });

      prevCard.appendChild(details);
    }
    resultsEl.appendChild(prevCard);
  }
}
