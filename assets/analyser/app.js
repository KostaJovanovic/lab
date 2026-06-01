/* Analyser - entry point
   - Boots photo + audio + video modules
   - Acts as the page-wide drop target (until the first file lands)
   - Classifies dropped files into photo / audio / video / unknown
   - Renders a basic dump for unknown formats */

import { initPhoto, renderPhoto } from './photo.js';
import { initAudio, renderAudio } from './audio.js';
import { initVideo, renderVideo } from './video.js';

function $(id) { return document.getElementById(id); }

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
async function sha256Hex(file) {
  if (!crypto.subtle) return null;
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- file classification ----------
const PHOTO_EXTS = new Set([
  'jpg','jpeg','jpe','jif','jfif','png','gif','webp','heic','heif','heics','heifs',
  'bmp','tif','tiff','svg','avif','jxl','ico',
  'raw','arw','cr2','cr3','nef','dng','raf','rw2','orf','pef','sr2','srw','x3f'
]);
const AUDIO_EXTS = new Set([
  'mp3','wav','wave','m4a','m4b','aac','flac','ogg','oga','opus',
  'aiff','aif','aifc','wma','weba','amr','ac3','dts','mka','mid','midi'
]);
const VIDEO_EXTS = new Set([
  'mp4','m4v','mov','avi','mkv','webm','wmv','flv',
  '3gp','3g2','mpg','mpeg','mts','m2ts','ts','vob','ogv'
]);

function fileExt(name) {
  const m = (name || '').match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function classifyFile(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'photo';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  const ext = fileExt(file.name);
  if (PHOTO_EXTS.has(ext)) return 'photo';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'unknown';
}

// ---------- magic-byte guess (for unknown files) ----------
/**
 * Best-effort format identification from the first ~128 bytes of a file.
 *
 * File formats start with distinctive byte sequences ("magic numbers") that
 * the OS and tools use to tell them apart even when the extension lies. This
 * function checks against the most common ones (PDF, PNG, JPEG, ZIP, MP3,
 * MP4, ELF, etc.). When nothing matches, it falls back to a printable-ASCII
 * heuristic to detect plain-text files.
 *
 * Returns a short human-readable label like "PNG image" or "ZIP container".
 */
function guessFormat(b) {
  if (!b || b.length < 4) return 'unknown';
  const a = (s, l) => Array.from(b.slice(s, s + l)).map((c) => String.fromCharCode(c)).join('');

  if (a(0, 4) === '%PDF')                                return 'PDF document';
  if (b[0] === 0x89 && a(1, 3) === 'PNG')                return 'PNG image';
  if (b[0] === 0xFF && b[1] === 0xD8)                    return 'JPEG image';
  if (a(0, 4) === 'GIF8')                                return 'GIF image';
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'WAVE')          return 'WAV audio';
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'WEBP')          return 'WebP image';
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'AVI ')          return 'AVI video';
  if (a(0, 4) === 'OggS')                                return 'Ogg container';
  if (a(0, 4) === 'fLaC')                                return 'FLAC audio';
  if (a(0, 3) === 'ID3')                                 return 'MP3 (ID3-tagged)';
  if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)           return 'MPEG audio';
  if (a(4, 4) === 'ftyp')                                return 'MP4 / MOV / M4A (' + a(8, 4).replace(/[^\w]/g, '') + ')';
  if (b[0] === 0x50 && b[1] === 0x4B)                    return 'ZIP container (docx / xlsx / epub / apk / jar / ...)';
  if (a(0, 6) === '7z\xBC\xAF\x27\x1C')                  return '7-Zip archive';
  if (b[0] === 0x1F && b[1] === 0x8B)                    return 'gzip archive';
  if (a(0, 4) === 'Rar!')                                return 'RAR archive';
  if (b[0] === 0x7F && a(1, 3) === 'ELF')                return 'ELF binary';
  if (a(0, 2) === 'MZ')                                  return 'Windows EXE / DLL (MZ)';
  if (a(0, 5) === '<?xml')                               return 'XML document';
  if (a(0, 6) === 'SQLite')                              return 'SQLite database';
  if (a(0, 2) === 'BM')                                  return 'BMP image';
  if (a(0, 4) === '\x00\x00\x01\x00')                    return 'ICO icon';
  if ((a(0, 2) === 'II' && b[2] === 0x2A) || (a(0, 2) === 'MM' && b[3] === 0x2A)) return 'TIFF image';
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'Matroska / WebM';
  if (b[0] === 0xCA && b[1] === 0xFE && b[2] === 0xBA && b[3] === 0xBE) return 'Java class / Mach-O fat binary';

  let printable = 0;
  for (const c of b) if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7E)) printable++;
  if (printable / b.length > 0.85) return 'plain text';
  return 'unrecognised (binary)';
}

// ---------- unknown-file render ----------
async function renderUnknown(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Inspecting "${file.name}"…`));

  let headBytes;
  try {
    headBytes = new Uint8Array(await file.slice(0, 128).arrayBuffer());
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Could not read this file: ' + (e && e.message)));
    return;
  }

  const hex   = Array.from(headBytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(headBytes).map((b) => (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.').join('');
  const guess = guessFormat(headBytes);

  resultsEl.innerHTML = '';

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Unknown file — best-effort inspection'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name',     file.name));
  tbl.appendChild(row('Size',     `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('MIME',     file.type || '-'));
  tbl.appendChild(row('Modified', file.lastModified ? new Date(file.lastModified).toISOString().replace('T', ' ').replace(/\..*$/, '') : '-'));
  tbl.appendChild(row('Extension', fileExt(file.name) || '-'));
  tbl.appendChild(row('Magic guess', guess));
  card.appendChild(tbl);

  card.appendChild(el('div', { class: 'anr-readout-section' }, 'First 128 bytes'));
  card.appendChild(el('pre', { class: 'anr-unknown-dump' }, 'HEX:\n' + hex + '\n\nASCII:\n' + ascii));

  card.appendChild(el('div', { class: 'anr-readout-section' }, 'SHA-256'));
  const hashOut = el('p', { class: 'anr-hint', style: 'word-break: break-all; font-size: 12px; margin: 4px 0 0;' }, 'computing…');
  card.appendChild(hashOut);

  // If it looks like text, JSON, or XML, show enhanced previews
  const ext = fileExt(file.name);
  const isJsonExt = ext === 'json';
  const isXmlExt = ext === 'xml' || ext === 'svg' || ext === 'html' || ext === 'htm';
  const isMarkdown = ext === 'md' || ext === 'markdown';

  // Detect JSON by peeking at first non-whitespace character
  let isJsonContent = false;
  if (guess === 'plain text' && !isJsonExt) {
    const peekText = await file.slice(0, 256).text().catch(() => '');
    const trimmed = peekText.trimStart();
    if (trimmed.length > 0 && (trimmed[0] === '{' || trimmed[0] === '[')) {
      isJsonContent = true;
    }
  }

  const showJson = isJsonExt || isJsonContent;
  const showXml = guess === 'XML document' || (isXmlExt && guess === 'plain text');
  const showPlainText = (guess === 'plain text' && !showJson && !showXml) || guess === 'XML document';

  if (showPlainText && !showXml) {
    // --- Plain text preview + stats ---
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Text preview (first 2 kB)'));
    const previewOut = el('pre', { class: 'anr-ocr-text' }, '');
    card.appendChild(previewOut);
    file.slice(0, 2048).text().then((txt) => { previewOut.textContent = txt; }).catch(() => {});

    // Text statistics
    try {
      const fullText = await file.slice(0, 1024 * 1024).text();
      const charCount = fullText.length;
      const words = fullText.trim().length === 0 ? [] : fullText.trim().split(/\s+/);
      const wordCount = words.length;
      const lines = fullText.split(/\n/);
      const lineCount = lines.length;
      const paragraphs = fullText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      const paragraphCount = paragraphs.length;
      const readingTime = Math.ceil(wordCount / 200);
      const detectedFormat = isMarkdown ? 'Markdown' : 'Plain text';

      card.appendChild(el('div', { class: 'anr-readout-section' }, 'Text statistics'));
      const statsTbl = el('table', { class: 'anr-readout' });
      statsTbl.appendChild(row('Format', detectedFormat));
      statsTbl.appendChild(row('Characters', charCount.toLocaleString()));
      statsTbl.appendChild(row('Words', wordCount.toLocaleString()));
      statsTbl.appendChild(row('Lines', lineCount.toLocaleString()));
      statsTbl.appendChild(row('Paragraphs', paragraphCount.toLocaleString()));
      statsTbl.appendChild(row('Est. reading time', readingTime + ' min'));
      card.appendChild(statsTbl);
    } catch (_) {}
  }

  if (showJson) {
    // --- JSON pretty printer ---
    try {
      const jsonText = await file.slice(0, 500 * 1024).text();
      let parsed;
      let parseError = null;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        parseError = e;
      }

      if (parseError) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'JSON (parse error)'));
        card.appendChild(el('p', { class: 'anr-hint', style: 'color: #e55; margin: 4px 0;' },
          'JSON parse error: ' + parseError.message));
        const rawPre = el('pre', { class: 'anr-ocr-text' }, '');
        rawPre.textContent = jsonText.slice(0, 4096);
        card.appendChild(rawPre);
      } else {
        // Compute JSON stats
        function jsonStats(val, depth) {
          let keys = 0, maxD = depth, arrays = [];
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            const ks = Object.keys(val);
            keys += ks.length;
            for (const k of ks) {
              const s = jsonStats(val[k], depth + 1);
              keys += s.keys; maxD = Math.max(maxD, s.maxDepth);
              arrays = arrays.concat(s.arrays);
            }
          } else if (Array.isArray(val)) {
            arrays.push(val.length);
            for (const item of val) {
              const s = jsonStats(item, depth + 1);
              keys += s.keys; maxD = Math.max(maxD, s.maxDepth);
              arrays = arrays.concat(s.arrays);
            }
          }
          return { keys, maxDepth: maxD, arrays };
        }
        const stats = jsonStats(parsed, 0);

        // Syntax-highlight JSON
        function highlightJson(val, indent) {
          const sp = '  '.repeat(indent);
          if (val === null) return '<span style="color:#e89a2e;font-weight:bold">null</span>';
          if (typeof val === 'boolean') return '<span style="color:#e89a2e;font-weight:bold">' + val + '</span>';
          if (typeof val === 'number') return '<span style="color:#5b9fd6">' + val + '</span>';
          if (typeof val === 'string') {
            const escaped = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            return '<span style="color:#5a9e5a">"' + escaped + '"</span>';
          }
          if (Array.isArray(val)) {
            if (val.length === 0) return '[]';
            let out = '[\n';
            for (let i = 0; i < val.length; i++) {
              out += sp + '  ' + highlightJson(val[i], indent + 1);
              if (i < val.length - 1) out += ',';
              out += '\n';
            }
            out += sp + ']';
            return out;
          }
          if (typeof val === 'object') {
            const ks = Object.keys(val);
            if (ks.length === 0) return '{}';
            let out = '{\n';
            for (let i = 0; i < ks.length; i++) {
              const keyEscaped = ks[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
              out += sp + '  <span style="font-weight:bold">"' + keyEscaped + '"</span>: ';
              out += highlightJson(val[ks[i]], indent + 1);
              if (i < ks.length - 1) out += ',';
              out += '\n';
            }
            out += sp + '}';
            return out;
          }
          return String(val);
        }

        const details = el('details', { open: '' });
        const summary = el('summary', { style: 'cursor:pointer;font-weight:bold;margin:8px 0;' }, 'JSON — formatted view');
        details.appendChild(summary);

        card.appendChild(el('div', { class: 'anr-readout-section' }, 'JSON statistics'));
        const jsTbl = el('table', { class: 'anr-readout' });
        jsTbl.appendChild(row('Total keys', stats.keys.toLocaleString()));
        jsTbl.appendChild(row('Max depth', stats.maxDepth));
        if (stats.arrays.length > 0) {
          jsTbl.appendChild(row('Arrays', stats.arrays.length + ' (lengths: ' + stats.arrays.join(', ') + ')'));
        }
        card.appendChild(jsTbl);

        const jsonPre = el('pre', { class: 'anr-ocr-text', html: highlightJson(parsed, 0) });
        jsonPre.style.maxHeight = '500px';
        jsonPre.style.overflow = 'auto';
        details.appendChild(jsonPre);
        card.appendChild(details);
      }
    } catch (_) {}
  }

  if (showXml || (guess === 'XML document' && !showJson)) {
    // --- XML pretty printer ---
    try {
      const xmlText = await file.slice(0, 500 * 1024).text();

      card.appendChild(el('div', { class: 'anr-readout-section' }, 'Text preview (first 2 kB)'));
      const previewOut = el('pre', { class: 'anr-ocr-text' }, '');
      previewOut.textContent = xmlText.slice(0, 2048);
      card.appendChild(previewOut);

      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      const parseErr = doc.querySelector('parsererror');

      if (parseErr) {
        card.appendChild(el('div', { class: 'anr-readout-section' }, 'XML (parse error)'));
        card.appendChild(el('p', { class: 'anr-hint', style: 'color: #e55; margin: 4px 0;' },
          'XML parse error — showing raw text above'));
      } else {
        // Count elements and max depth
        function xmlStats(node, depth) {
          let count = 0, maxD = depth;
          if (node.nodeType === Node.ELEMENT_NODE) {
            count = 1;
            for (const child of node.childNodes) {
              const s = xmlStats(child, depth + 1);
              count += s.count;
              maxD = Math.max(maxD, s.maxDepth);
            }
          }
          return { count, maxDepth: maxD };
        }
        const xstats = xmlStats(doc.documentElement, 0);

        card.appendChild(el('div', { class: 'anr-readout-section' }, 'XML statistics'));
        const xmlTbl = el('table', { class: 'anr-readout' });
        xmlTbl.appendChild(row('Elements', xstats.count.toLocaleString()));
        xmlTbl.appendChild(row('Max depth', xstats.maxDepth));
        card.appendChild(xmlTbl);

        // Format and syntax-highlight XML
        function formatXml(node, indent) {
          const sp = '  '.repeat(indent);
          if (node.nodeType === Node.TEXT_NODE) {
            const t = node.textContent.trim();
            if (!t) return '';
            const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return sp + esc + '\n';
          }
          if (node.nodeType === Node.COMMENT_NODE) {
            const esc = node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return sp + '<span style="color:#888">&lt;!-- ' + esc + ' --&gt;</span>\n';
          }
          if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
            const esc = node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return sp + '<span style="color:#888">&lt;?' + node.nodeName + ' ' + esc + '?&gt;</span>\n';
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return '';
          const tagName = node.nodeName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          let attrs = '';
          for (const a of node.attributes) {
            const aName = a.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const aVal = a.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            attrs += ' <span style="color:#e89a2e">' + aName + '</span>=<span style="color:#5a9e5a">"' + aVal + '"</span>';
          }
          const children = Array.from(node.childNodes);
          const meaningful = children.filter(c =>
            c.nodeType === Node.ELEMENT_NODE ||
            (c.nodeType === Node.TEXT_NODE && c.textContent.trim()) ||
            c.nodeType === Node.COMMENT_NODE
          );
          if (meaningful.length === 0) {
            return sp + '&lt;<span style="color:#5b9fd6;font-weight:bold">' + tagName + '</span>' + attrs + ' /&gt;\n';
          }
          // Single text child: inline
          if (meaningful.length === 1 && meaningful[0].nodeType === Node.TEXT_NODE) {
            const txt = meaningful[0].textContent.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return sp + '&lt;<span style="color:#5b9fd6;font-weight:bold">' + tagName + '</span>' + attrs + '&gt;' +
              txt + '&lt;/<span style="color:#5b9fd6;font-weight:bold">' + tagName + '</span>&gt;\n';
          }
          let out = sp + '&lt;<span style="color:#5b9fd6;font-weight:bold">' + tagName + '</span>' + attrs + '&gt;\n';
          for (const child of children) {
            out += formatXml(child, indent + 1);
          }
          out += sp + '&lt;/<span style="color:#5b9fd6;font-weight:bold">' + tagName + '</span>&gt;\n';
          return out;
        }

        let formattedXml = '';
        // Include XML declaration if present
        for (const child of doc.childNodes) {
          if (child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
            formattedXml += formatXml(child, 0);
          }
        }
        formattedXml += formatXml(doc.documentElement, 0);

        const xmlDetails = el('details', { open: '' });
        xmlDetails.appendChild(el('summary', { style: 'cursor:pointer;font-weight:bold;margin:8px 0;' }, 'XML — formatted view'));
        const xmlPre = el('pre', { class: 'anr-ocr-text', html: formattedXml });
        xmlPre.style.maxHeight = '500px';
        xmlPre.style.overflow = 'auto';
        xmlDetails.appendChild(xmlPre);
        card.appendChild(xmlDetails);
      }
    } catch (_) {}
  }

  resultsEl.appendChild(card);

  sha256Hex(file).then((h) => {
    hashOut.textContent = h || 'SHA-256 unavailable in this browser';
  });
}

// ---------- page-wide drag-drop ----------
function hasFiles(e) {
  const t = e.dataTransfer && e.dataTransfer.types;
  if (!t) return false;
  for (let i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
  return false;
}

function boot() {
  if (!window.exifr) {
    console.warn('exifr not loaded yet; photo metadata will be missing until it loads.');
  }

  const photoResults   = $('photoResults');
  const audioResults   = $('audioResults');
  const videoResults   = $('videoResults');
  const unknownResults = $('unknownResults');
  const pageDropEl     = $('pageDrop');

  let firstFileLoaded = false;
  let dragCounter = 0;

  function handleFile(file) {
    if (!file) return;
    firstFileLoaded = true;
    if (pageDropEl) pageDropEl.hidden = true;
    const kind = classifyFile(file);

    const navMap = { photo: '#photo', audio: '#audio', video: '#video' };
    const href = navMap[kind];
    if (href) {
      const link = document.querySelector('.site-nav a[href="' + href + '"]');
      if (link) {
        link.classList.remove('is-flash');
        void link.offsetWidth;
        link.classList.add('is-flash');
      }
    }

    if (kind === 'photo')       renderPhoto(file, photoResults);
    else if (kind === 'audio')  renderAudio(file, audioResults);
    else if (kind === 'video')  renderVideo(file, videoResults);
    else                        renderUnknown(file, unknownResults);
  }

  initPhoto({
    dropEl:    $('photoDrop'),
    inputEl:   $('photoInput'),
    resultsEl: photoResults,
    onFile:    handleFile
  });

  initAudio({
    dropEl:    $('audioDrop'),
    inputEl:   $('audioInput'),
    recordBtn: $('audioRecord'),
    liveBtn:   $('audioLive'),
    resultsEl: audioResults,
    onFile:    handleFile
  });

  initVideo({
    dropEl:    $('videoDrop'),
    inputEl:   $('videoInput'),
    resultsEl: videoResults,
    onFile:    handleFile
  });

  // ----- Page-level drag/drop -----
  // Before the first file lands the whole page is a drop target and an overlay
  // appears while a file is being dragged. After the first file, drops anywhere
  // still route through handleFile but the overlay no longer flashes.
  //
  // Why a `dragCounter`? `dragenter` / `dragleave` fire for every child element
  // the cursor crosses, not just the page boundary. Counting +1/-1 instead of
  // toggling on a single boolean prevents flicker while dragging across the
  // header, nav, dropzones, etc.
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragCounter++;
    if (!firstFileLoaded && pageDropEl) pageDropEl.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0 && pageDropEl) pageDropEl.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();   // required to allow drop
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter = 0;
    if (pageDropEl) pageDropEl.hidden = true;
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files) for (const file of files) handleFile(file);
  });

  // ----- Dark mode toggle -----
  const saved = localStorage.getItem('anr-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  const darkBtn = $('darkToggle');
  if (darkBtn) {
    darkBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Disable' : 'Enable';
    darkBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('anr-theme', next);
      darkBtn.textContent = next === 'dark' ? 'Disable' : 'Enable';
    });
  }

  // ----- Clipboard paste (Ctrl+V) -----
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) handleFile(file);
      }
    }
  });

  // ----- Scroll-spy for the sticky nav -----
  const links = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
  const sections = links
    .map((a) => ({ a, el: document.querySelector(a.getAttribute('href')) }))
    .filter((s) => s.el);
  function onScroll() {
    let active = sections[0];
    const y = window.scrollY + 140;
    for (const s of sections) {
      if (s.el.offsetTop <= y) active = s;
    }
    for (const s of sections) s.a.classList.toggle('is-active', s === active);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ----- Smooth in-page anchors -----
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 60;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
