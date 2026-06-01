/* Analyser - archive module
   Lazy-loads fflate from CDN to inspect ZIP archives without full extraction. */

const FFLATE_URL = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

let fflateLib = null;

async function loadFflate() {
  if (fflateLib) return fflateLib;
  fflateLib = await import(FFLATE_URL);
  return fflateLib;
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
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ---------- ZIP parsing via central directory ----------
// We parse the ZIP central directory directly instead of decompressing,
// so we can list contents without extracting the full archive.

function parseZipEntries(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const entries = [];

  // Find the End of Central Directory record (scan from the end)
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) return entries; // not a valid ZIP

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize   = view.getUint32(eocdOffset + 12, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);

  let pos = cdOffset;
  const decoder = new TextDecoder();

  for (let i = 0; i < entryCount && pos < cdOffset + cdSize; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break; // central dir signature

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

// ---------- main render ----------
export async function renderArchive(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  window.scrollTo({ top: resultsEl.getBoundingClientRect().top + window.scrollY - 56, behavior: 'smooth' });
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading ZIP archive "${file.name}"…`));

  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Could not read file: ' + (e && e.message)));
    return;
  }

  const entries = parseZipEntries(buf);
  if (entries.length === 0) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'No entries found in this ZIP file, or the archive is corrupt.'));
    return;
  }

  resultsEl.innerHTML = '';

  // --- Summary card ---
  const fileEntries = entries.filter((e) => !e.isDir);
  const dirEntries  = entries.filter((e) => e.isDir);
  const totalUncomp = fileEntries.reduce((s, e) => s + e.uncompSize, 0);
  const totalComp   = fileEntries.reduce((s, e) => s + e.compSize, 0);
  const ratio       = totalUncomp > 0 ? ((1 - totalComp / totalUncomp) * 100).toFixed(1) : '0';

  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'ZIP archive'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Archive size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('Files', String(fileEntries.length)));
  tbl.appendChild(row('Directories', String(dirEntries.length)));
  tbl.appendChild(row('Total uncompressed', fmtBytes(totalUncomp)));
  tbl.appendChild(row('Total compressed', fmtBytes(totalComp)));
  tbl.appendChild(row('Compression ratio', ratio + '%'));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // --- File tree card ---
  const treeCard = el('div', { class: 'anr-card' });
  treeCard.appendChild(el('h3', {}, 'Contents'));

  // Build a tree structure
  const tree = {};
  for (const entry of entries) {
    const parts = entry.name.split('/').filter((p) => p);
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1 && !entry.isDir) {
        // leaf file
        node[part] = entry;
      } else {
        if (!node[part] || typeof node[part] !== 'object' || node[part].name) {
          node[part] = {};
        }
        node = node[part];
      }
    }
  }

  function renderTree(obj, indent) {
    const lines = [];
    const keys = Object.keys(obj).sort((a, b) => {
      // Directories first
      const aIsDir = obj[a] && typeof obj[a] === 'object' && !obj[a].name;
      const bIsDir = obj[b] && typeof obj[b] === 'object' && !obj[b].name;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });
    for (const key of keys) {
      const val = obj[key];
      const prefix = '  '.repeat(indent);
      if (val && typeof val === 'object' && !val.name) {
        // directory
        lines.push(prefix + key + '/');
        lines.push(...renderTree(val, indent + 1));
      } else if (val && val.name) {
        // file entry
        lines.push(prefix + key + '  (' + fmtBytes(val.uncompSize) + ')');
      } else {
        lines.push(prefix + key);
      }
    }
    return lines;
  }

  const treeText = renderTree(tree, 0).join('\n');
  const treePre = el('pre', { class: 'anr-ocr-text' }, treeText || '(empty)');
  treePre.style.maxHeight = '500px';
  treePre.style.overflow = 'auto';
  treeCard.appendChild(treePre);
  resultsEl.appendChild(treeCard);

  // --- Preview small text files ---
  // Use fflate for decompressing individual entries when the user clicks
  const textExts = new Set(['txt', 'md', 'json', 'xml', 'csv', 'tsv', 'html', 'htm',
    'css', 'js', 'ts', 'py', 'rb', 'java', 'c', 'h', 'cpp', 'rs', 'go',
    'yaml', 'yml', 'toml', 'ini', 'cfg', 'log', 'sh', 'bat', 'sql', 'svg']);

  const previewable = fileEntries.filter((e) => {
    if (e.uncompSize > 10240) return false; // > 10 KB
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

    let ffl = null; // lazy-loaded

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
