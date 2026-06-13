/* Analyser - archive module
   Lazy-loads fflate from CDN to inspect ZIP archives without full extraction.
   Uses the shared folder/archive modules for treemap, breakdown, and tree. */

import { el, row, rowHelp, fmtBytes, buildFileTree, isUnreadableError, cloudFileWarning, errorCard, integrityCard, loadScript } from '../core/util.js';
import { normalizeArchive, renderBreakdownCards, renderViewToggle, categorizeExt } from './folder-archive-shared.js';
import { ARCHIVE_EXTS } from '../core/formats.js';
import { extractArchive } from '../lib/libarchive-loader.js';
import { gunzip } from '../core/binutil.js';
import { xzDecompress } from '../lib/xz-loader.js';
import { unlz4, unlzw } from '../lib/legacy-decompress.js';
import { lzmaDecompress } from '../lib/lzma-loader.js';

const FFLATE_URL = new URL('../../vendor/fflate.js', import.meta.url).href;

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

    const versionMadeBy = view.getUint16(pos + 4, true);
    const flags         = view.getUint16(pos + 8, true);
    const compMethod    = view.getUint16(pos + 10, true);
    const modTime       = view.getUint16(pos + 12, true);
    const modDate       = view.getUint16(pos + 14, true);
    const crc           = view.getUint32(pos + 16, true);
    const compSize      = view.getUint32(pos + 20, true);
    const uncompSize    = view.getUint32(pos + 24, true);
    const nameLen       = view.getUint16(pos + 28, true);
    const extraLen      = view.getUint16(pos + 30, true);
    const commentLen    = view.getUint16(pos + 32, true);
    const name          = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    const isDir         = name.endsWith('/');

    // Scan the extra field for a Zip64 extended-information record (id 0x0001).
    let zip64 = false;
    {
      let ep = pos + 46 + nameLen;
      const extraEnd = ep + extraLen;
      while (ep + 4 <= extraEnd) {
        const id = view.getUint16(ep, true);
        const sz = view.getUint16(ep + 2, true);
        if (id === 0x0001) { zip64 = true; break; }
        ep += 4 + sz;
      }
    }

    entries.push({ name, compSize, uncompSize, compMethod, crc, isDir, flags, versionMadeBy, modTime, modDate, zip64 });
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

// ---------- safety / metadata helpers ----------

// Decode a DOS date+time pair (as stored in the ZIP central directory) into a
// readable local timestamp. Returns '' when the fields are zero/invalid.
function dosDateTime(modDate, modTime) {
  try {
    if (!modDate) return '';
    const day    = modDate & 0x1f;
    const month  = (modDate >> 5) & 0x0f;
    const year   = ((modDate >> 9) & 0x7f) + 1980;
    const sec    = (modTime & 0x1f) * 2;
    const min    = (modTime >> 5) & 0x3f;
    const hour   = (modTime >> 11) & 0x1f;
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    const d = new Date(year, month - 1, day, hour, min, sec);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(min)}:${pad(sec)}`;
  } catch { return ''; }
}

// The high byte of "version made by" identifies the host OS that created the entry.
const HOST_OS = {
  0: 'MS-DOS / FAT', 1: 'Amiga', 2: 'OpenVMS', 3: 'Unix', 4: 'VM/CMS', 5: 'Atari ST',
  6: 'OS/2 HPFS', 7: 'Macintosh', 8: 'Z-System', 9: 'CP/M', 10: 'Windows NTFS',
  11: 'MVS', 12: 'VSE', 13: 'Acorn Risc', 14: 'VFAT', 15: 'alternate MVS',
  16: 'BeOS', 17: 'Tandem', 18: 'OS/400', 19: 'OS X (Darwin)',
};

// An entry is encrypted when general-purpose bit 0 of its flags is set.
function isEncrypted(e) {
  return ((e.flags || 0) & 0x0001) !== 0;
}

// A name is "unsafe" if it would escape the extraction directory: a parent
// traversal segment, an absolute POSIX path, or a Windows drive/UNC path.
function isUnsafePath(name) {
  if (!name) return false;
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/')) return true;                 // absolute POSIX
  if (/^[a-zA-Z]:/.test(n)) return true;              // C:\  drive letter
  if (name.startsWith('\\\\') || name.startsWith('//')) return true; // UNC
  const parts = n.split('/');
  return parts.indexOf('..') !== -1;                  // parent traversal
}

// Per-entry compression ratio (uncompressed ÷ compressed). 0 when not measurable.
function entryRatio(e) {
  if (!e || e.isDir || !e.compSize || !e.uncompSize) return 0;
  return e.uncompSize / e.compSize;
}

// ---------- main render ----------
// opts.embedded: true when this view is appended UNDER another analysis (the
// "browse as archive" feature). In that mode the whole-file SHA-256 card is
// skipped, since the primary analysis above already shows the file's hash.
export async function renderArchive(file, resultsEl, opts = {}) {
  const embedded = !!opts.embedded;
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
  tbl.appendChild(rowHelp('Total uncompressed', fmtBytes(totalUncomp), 'The combined size of all files once they are extracted from the archive.'));
  tbl.appendChild(rowHelp('Total compressed', fmtBytes(totalComp), 'The combined size of all files as they are stored inside the archive, after compression.'));
  tbl.appendChild(rowHelp('Compression ratio', ratio + '%', 'How much space the archive saves versus the uncompressed total, computed as 1 − compressed ÷ uncompressed. Higher percentages mean a smaller archive; 0% means no compression.'));
  // Compression methods used across the entries (8 = Deflate, 0 = Stored, etc.).
  const METHODS = { 0: 'Stored', 8: 'Deflate', 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 99: 'AES' };
  const methodCounts = {};
  for (const e of fileEntries) { const n = METHODS[e.compMethod] || ('Method ' + e.compMethod); methodCounts[n] = (methodCounts[n] || 0) + 1; }
  const methodStr = Object.entries(methodCounts).map(([k, v]) => k + ' ×' + v).join(', ');
  if (methodStr) tbl.appendChild(rowHelp('Compression', methodStr, 'The compression method(s) used for the entries. Deflate is the standard ZIP method; Stored means no compression.'));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);
  // SHA-256 of the whole archive (was previously missing for ZIP). Skipped when
  // embedded under another analysis that already shows the file hash.
  if (!embedded) resultsEl.appendChild(integrityCard(file));

  // --- Safety / integrity inspection (additive; only shown when noteworthy) ---
  try {
    const encrypted = fileEntries.filter(isEncrypted);
    const unsafe    = entries.filter((e) => isUnsafePath(e.name));
    const overallRatio = totalComp > 0 ? totalUncomp / totalComp : 0;
    const worstEntry = fileEntries.reduce((w, e) => {
      const r = entryRatio(e);
      return r > (w ? entryRatio(w) : 0) ? e : w;
    }, null);
    const worstRatio = worstEntry ? entryRatio(worstEntry) : 0;
    const zip64 = entries.some((e) => e.zip64);

    const ratioSuspicious = overallRatio > 100 || worstRatio > 1000;
    const hasFindings = encrypted.length > 0 || unsafe.length > 0 || ratioSuspicious || zip64;

    if (hasFindings) {
      const safeCard = el('div', { class: 'anr-card' });
      safeCard.appendChild(el('h3', {}, 'Safety'));
      const stbl = el('table', { class: 'anr-readout' });

      if (encrypted.length > 0) {
        const allEnc = encrypted.length === fileEntries.length;
        const note = allEnc
          ? ' - every file is encrypted, so contents cannot be previewed or extracted here.'
          : '';
        stbl.appendChild(rowHelp(
          'Encrypted entries',
          `${encrypted.length} of ${fileEntries.length}${note}`,
          'Files protected with a password (general-purpose flag bit 0). Analyser can list these entries but cannot decompress or preview their contents without the password.'
        ));
      }

      if (unsafe.length > 0) {
        const sample = unsafe.slice(0, 5).map((e) => e.name).join(', ');
        const more = unsafe.length > 5 ? `, …(+${unsafe.length - 5} more)` : '';
        stbl.appendChild(rowHelp(
          '⚠ Unsafe paths',
          `${unsafe.length} (path traversal) - ${sample}${more}`,
          'Entry names that contain "../", start with "/", or use a drive letter/UNC path. A naïve extractor could be tricked into writing these files outside the intended folder (a "Zip Slip" attack). Analyser never writes them to disk.'
        ));
      }

      if (ratioSuspicious) {
        const detail = worstRatio > 1000 && worstEntry
          ? `overall ${overallRatio.toFixed(0)}:1; one entry "${worstEntry.name}" expands ${worstRatio.toFixed(0)}:1`
          : `overall ${overallRatio.toFixed(0)}:1`;
        stbl.appendChild(rowHelp(
          '⚠ Suspicious compression ratio',
          detail,
          'A very high uncompressed-to-compressed ratio can indicate a "zip bomb" - a small archive that expands to an enormous size to exhaust memory or disk. Treat unfamiliar archives like this with caution.'
        ));
      }

      if (zip64) {
        stbl.appendChild(rowHelp(
          'ZIP64',
          'Yes (large-archive extensions present)',
          'This archive uses the ZIP64 format, which lifts the 4 GB / 65,535-entry limits of classic ZIP. It is normal for large archives.'
        ));
      }

      // Host OS / creating tool, from the first non-trivial "version made by".
      const vmb = (fileEntries[0] || entries[0] || {}).versionMadeBy;
      if (vmb != null) {
        const hostName = HOST_OS[(vmb >> 8) & 0xff] || ('host ' + ((vmb >> 8) & 0xff));
        const ver = (vmb & 0xff) / 10;
        stbl.appendChild(rowHelp(
          'Created on',
          `${hostName} (ZIP spec ${ver.toFixed(1)})`,
          'The host operating system and ZIP specification version recorded by the tool that produced this archive ("version made by" in the central directory).'
        ));
      }

      safeCard.appendChild(stbl);
      resultsEl.appendChild(safeCard);
    }
  } catch (e) {
    // Safety inspection is best-effort; never break ZIP browsing over it.
    if (window.console) console.warn('ZIP safety inspection failed:', e);
  }

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

  // Register a Back-bar restore that re-renders THIS archive before opening a
  // child, so the breadcrumb can step back to it one level at a time. Skipped in
  // embedded mode (the browse-as-archive view under a primary analysis), whose
  // sub-container is wiped by clearResultsUI - there's no standalone view to
  // restore there.
  const containerLabel = (file && file.name) || 'archive';
  function pushBack() {
    if ((opts && opts.embedded) || !window._anrPushNav) return;
    window._anrPushNav(containerLabel, () => { resultsEl.hidden = false; renderArchive(file, resultsEl); });
  }

  // --- Click-to-analyse handler (treemap) ---
  function onFileClick(item) {
    if (!item || !item.entry) return;
    const ext = extOf(item.entry.name);
    extractFile(item.entry.name).then(f => {
      if (!f) return;
      pushBack();
      if (ARCHIVE_EXTS.has(ext)) renderArchive(f, resultsEl);
      else if (window._anrHandleFile) window._anrHandleFile(f, { nested: true });
    });
  }

  // --- Click handler for tree view (receives key, value from buildFileTree) ---
  // We need an entry lookup by name
  const entryByName = {};
  for (const e of entries) entryByName[e.name] = e;

  function onTreeFileClick(key, val) {
    const entry = val && val.name ? val : null;
    if (!entry) return;
    const ext = extOf(entry.name);
    extractFile(entry.name).then(f => {
      if (!f) return;
      pushBack();
      if (ARCHIVE_EXTS.has(ext)) renderArchive(f, resultsEl);
      else if (window._anrHandleFile) window._anrHandleFile(f, { nested: true });
    });
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
    // Collapsed by default (.is-collapsed): the previews are a secondary detail
    // behind the file tree, so they start closed; the shared card-toggle in
    // app.js opens them when the "Text file previews" title is clicked.
    const prevCard = el('div', { class: 'anr-card is-collapsed' });
    prevCard.appendChild(el('h3', {}, 'Text file previews'));
    prevCard.appendChild(el('p', {
      class: 'anr-hint',
      style: 'margin: 0 0 8px; font-size: 12px;'
    }, `${previewable.length} small text file(s) can be previewed. Click to expand.`));

    let ffl = null;

    for (const entry of previewable.slice(0, 20)) {
      const details = el('details', {});
      let summaryMeta = '';
      try {
        const r = entryRatio(entry);
        const mt = dosDateTime(entry.modDate, entry.modTime);
        if (r > 1) summaryMeta += ' · ' + r.toFixed(1) + ':1';
        if (mt) summaryMeta += ' · ' + mt;
      } catch { /* metadata is optional */ }
      const summary = el('summary', {
        // overflow-wrap/word-break so long entry paths and the metadata tail wrap
        // instead of overflowing the card on narrow (mobile) viewports.
        style: 'cursor: pointer; font-weight: bold; margin: 4px 0; font-size: 13px;' +
               ' overflow-wrap: anywhere; word-break: break-word;'
      }, entry.name + '  (' + fmtBytes(entry.uncompSize) + ' · CRC ' + (entry.crc >>> 0).toString(16).padStart(8, '0') + summaryMeta + ')');
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

// ---------- libarchive-backed browse (RAR / 7z / etc.) ----------
// renderArchive handles ZIP in pure JS; non-ZIP containers are listed and
// extracted lazily through the vendored libarchive WASM worker. Same tree +
// treemap + click-to-analyse UX as the ZIP path, fed from the entry list.

function extLower(name) {
  const m = name.match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}

async function renderLibarchive(file, resultsEl, opts) {
  const label = (opts && opts.label) || 'Archive';
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading ${label} archive "${file.name}"…`));

  let handle;
  try {
    handle = await extractArchive(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    if (isUnreadableError(e)) resultsEl.appendChild(cloudFileWarning(file));
    else resultsEl.appendChild(errorCard('Could not read this archive in the browser - it may be encrypted, solid, or use an unsupported codec.'));
    return;
  }

  const fileEntries = (handle.entries || []).filter((e) => e && e.name && !e.name.endsWith('/'));
  resultsEl.innerHTML = '';
  if (!fileEntries.length) {
    resultsEl.appendChild(errorCard('No files found inside this archive.'));
    return;
  }

  renderHandleTree(handle, fileEntries, file, resultsEl, opts);
}

// Render an already-opened libarchive handle as the tree + treemap + breakdown,
// with click-to-analyse. Shared by renderLibarchive and the compressed-tarball
// path so neither has to re-open the archive.
function renderHandleTree(handle, fileEntries, file, resultsEl, opts) {
  const label = (opts && opts.label) || 'Archive';
  const items = fileEntries.map((e) => {
    const ext = extLower(e.name);
    return { path: e.name, size: e.size || 0, file: null, entry: e, category: categorizeExt(ext), ext };
  });

  const summaryRows = [
    row('Application', label + ' Archive'),
    row('Name', file.name),
    row('Archive size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`),
  ];
  renderBreakdownCards(items, resultsEl, summaryRows);

  // Build the nested tree object (leaf = the libarchive entry, branch = plain {}).
  const tree = {};
  for (const e of fileEntries) {
    const parts = e.name.split('/').filter((p) => p);
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        node[part] = e;
      } else {
        if (!node[part] || typeof node[part] !== 'object' || node[part].name) node[part] = {};
        node = node[part];
      }
    }
  }

  async function openEntry(entry) {
    try {
      const bytes = await entry.getBytes();
      const f = new File([bytes], entry.name.split('/').pop() || entry.name, { type: 'application/octet-stream' });
      // Register a Back-bar restore that re-renders this archive (one level up).
      if (window._anrPushNav) {
        window._anrPushNav(file.name || 'archive', () => { resultsEl.hidden = false; resultsEl.innerHTML = ''; renderHandleTree(handle, fileEntries, file, resultsEl, opts); });
      }
      if (window._anrHandleFile) window._anrHandleFile(f, { nested: true });
    } catch (_) { /* extraction failed - ignore */ }
  }
  const onFileClick = (item) => { if (item && item.entry) openEntry(item.entry); };
  const onTreeFileClick = (_key, val) => { if (val && val.name) openEntry(val); };

  renderViewToggle(resultsEl, items, tree, {
    isDir: (v) => v && typeof v === 'object' && !v.name,
    fileSize: (v) => (v && v.size) || 0,
    copyPath: (_key, entry) => entry && entry.name,
    onFileClick: onTreeFileClick,
  }, onFileClick);
}

// Decompress a single-stream compressor (gzip / xz / zstd) by magic. Returns
// { data, codec, drop } where `drop` strips the compression extension from the
// inner filename, or null if the codec has no in-browser decoder (bzip2) or the
// magic is unknown. The tar/tarball case never reaches here - libarchive handles
// it directly (it bundles the gzip/xz/zstd/bzip2 read filters).
async function decompressStream(file) {
  const head = new Uint8Array(await file.slice(0, 13).arrayBuffer());
  const is = (sig) => sig.every((v, i) => head[i] === v);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (is([0x1F, 0x8B])) return { data: await gunzip(bytes), codec: 'gzip', drop: /\.(gz|tgz)$/i };
  if (is([0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00])) return { data: await xzDecompress(bytes), codec: 'xz', drop: /\.(xz|txz)$/i };
  if (is([0x28, 0xB5, 0x2F, 0xFD])) {
    if (!(window.fzstd && window.fzstd.decompress)) await loadScript('assets/vendor/fzstd.js');
    if (!(window.fzstd && window.fzstd.decompress)) return null;
    return { data: window.fzstd.decompress(bytes), codec: 'zstd', drop: /\.(zst|tzst)$/i };
  }
  if (is([0x04, 0x22, 0x4D, 0x18])) { const d = unlz4(bytes); return d ? { data: d, codec: 'LZ4', drop: /\.(lz4|tlz4)$/i } : null; }
  if (is([0x1F, 0x9D])) { const d = unlzw(bytes); return d ? { data: d, codec: 'LZW', drop: /\.(z|tz)$/i } : null; }
  // Legacy .lzma has no fixed magic; the default properties byte 0x5D plus the
  // 13-byte header is the reliable tell (matches the sniff in app.js).
  if (head[0] === 0x5D && bytes.length >= 13) { const d = await lzmaDecompress(bytes); if (d) return { data: d, codec: 'LZMA', drop: /\.(lzma|tlz)$/i }; }
  return null;   // bzip2 (no in-browser decoder) or unknown
}

// Browse/open a TAR or compressed stream: libarchive reads tar + tarballs
// (.tar.gz/.tgz/.tar.xz/.tar.zst/.tar.bz2) directly; a bare single compressed
// file is decompressed so the file inside can be analysed.
async function renderCompressedEmbedded(file, container, label) {
  const wrap = el('div', {});
  container.appendChild(wrap);
  wrap.appendChild(el('div', { class: 'anr-info' }, `Reading ${label} contents…`));

  let handle = null;
  try { handle = await extractArchive(file); } catch (_) { /* not a libarchive-readable archive */ }
  const fileEntries = handle ? (handle.entries || []).filter((e) => e && e.name && !e.name.endsWith('/')) : [];
  if (fileEntries.length) { wrap.remove(); renderHandleTree(handle, fileEntries, file, container, { label }); return; }

  // Single compressed stream: decompress and offer the file inside.
  let res = null;
  try { res = await decompressStream(file); } catch (_) { /* decompression failed */ }
  wrap.remove();
  if (!res || !res.data) {
    container.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;font-size:12px;' },
      /bzip2|bz2/i.test(label)
        ? 'This is a single bzip2-compressed file. In-browser bzip2 decompression is not available, so only the identification above is shown.'
        : 'This compressed file could not be decompressed in the browser.'));
    return;
  }
  const innerName = (file.name || 'file').replace(res.drop, '') || 'decompressed';
  const inner = new File([res.data], innerName, { type: 'application/octet-stream' });
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Decompressed file'));
  card.appendChild(el('p', { class: 'anr-hint', style: 'margin:0 0 8px;font-size:12px;' },
    `A single ${res.codec}-compressed file (${fmtBytes(res.data.length)} decompressed). Open the file inside to analyse it.`));
  const btn = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse ' + innerName);
  btn.addEventListener('click', () => {
    if (window._anrPushNav) window._anrPushNav(file.name || 'archive', () => { if (window._anrHandleFile) window._anrHandleFile(file, {}); });
    if (window._anrHandleFile) window._anrHandleFile(inner, { nested: true });
  });
  card.appendChild(btn);
  container.appendChild(card);
}

// ---------- embeddable "browse as archive" view ----------
// Appended UNDER a file's primary analysis when that file is physically a
// container we can open. `opts.mode` is 'zip' (pure-JS path), 'libarchive'
// (RAR/7z/etc.), or 'compressed' (TAR + gz/xz/zst/bz2 tarballs and single
// streams); `opts.label` names the format.
export async function renderArchiveEmbedded(file, container, opts = {}) {
  const compressed = opts.mode === 'compressed';
  const label = opts.label || (opts.mode === 'zip' ? 'ZIP' : 'archive');
  const head = el('div', { class: 'anr-card' });
  head.appendChild(el('h3', {}, compressed ? 'Open contents' : 'Browse as archive'));
  head.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;font-size:12px;' },
    compressed
      ? `This ${label} file is decompressed in your browser so you can open what is inside it.`
      : `This file is also a ${label} archive. Browse the files inside, and click any one to analyse it.`));
  container.appendChild(head);

  const wrap = el('div', {});
  container.appendChild(wrap);
  try {
    if (opts.mode === 'zip') await renderArchive(file, wrap, { embedded: true });
    else if (compressed) { wrap.remove(); await renderCompressedEmbedded(file, container, label); }
    else await renderLibarchive(file, wrap, { label });
  } catch (e) {
    wrap.appendChild(errorCard('Could not browse this archive: ' + (e && e.message)));
  }
}
