/* Analyser - unknown-file inspector
   Magic-byte format guess, hex/ASCII dump, SHA-256, and enhanced
   previews for plain text, JSON, and XML. */

import { el, row, fmtBytes, fileExt, sha256Row, errorCard } from './util.js';

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

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
export function guessFormat(b) {
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

function highlightJson(val, indent) {
  const sp = '  '.repeat(indent);
  if (val === null) return '<span class="anr-syn-kw">null</span>';
  if (typeof val === 'boolean') return '<span class="anr-syn-kw">' + val + '</span>';
  if (typeof val === 'number') return '<span class="anr-syn-num">' + val + '</span>';
  if (typeof val === 'string') {
    return '<span class="anr-syn-str">"' + escAttr(val) + '"</span>';
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
      out += sp + '  <span class="anr-syn-key">"' + escAttr(ks[i]) + '"</span>: ';
      out += highlightJson(val[ks[i]], indent + 1);
      if (i < ks.length - 1) out += ',';
      out += '\n';
    }
    out += sp + '}';
    return out;
  }
  return String(val);
}

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

function formatXml(node, indent) {
  const sp = '  '.repeat(indent);
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent.trim();
    if (!t) return '';
    return sp + esc(t) + '\n';
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    return sp + '<span class="anr-syn-comment">&lt;!-- ' + esc(node.textContent) + ' --&gt;</span>\n';
  }
  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
    return sp + '<span class="anr-syn-comment">&lt;?' + node.nodeName + ' ' + esc(node.textContent) + '?&gt;</span>\n';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tagName = esc(node.nodeName);
  let attrs = '';
  for (const aNode of node.attributes) {
    attrs += ' <span class="anr-syn-attr">' + esc(aNode.name) + '</span>=<span class="anr-syn-str">"' + escAttr(aNode.value) + '"</span>';
  }
  const children = Array.from(node.childNodes);
  const meaningful = children.filter(c =>
    c.nodeType === Node.ELEMENT_NODE ||
    (c.nodeType === Node.TEXT_NODE && c.textContent.trim()) ||
    c.nodeType === Node.COMMENT_NODE
  );
  if (meaningful.length === 0) {
    return sp + '&lt;<span class="anr-syn-tag">' + tagName + '</span>' + attrs + ' /&gt;\n';
  }
  // Single text child: inline
  if (meaningful.length === 1 && meaningful[0].nodeType === Node.TEXT_NODE) {
    const txt = esc(meaningful[0].textContent.trim());
    return sp + '&lt;<span class="anr-syn-tag">' + tagName + '</span>' + attrs + '&gt;' +
      txt + '&lt;/<span class="anr-syn-tag">' + tagName + '</span>&gt;\n';
  }
  let out = sp + '&lt;<span class="anr-syn-tag">' + tagName + '</span>' + attrs + '&gt;\n';
  for (const child of children) {
    out += formatXml(child, indent + 1);
  }
  out += sp + '&lt;/<span class="anr-syn-tag">' + tagName + '</span>&gt;\n';
  return out;
}

export async function renderUnknown(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Inspecting "${file.name}"…`));

  let headBytes;
  try {
    headBytes = new Uint8Array(await file.slice(0, 128).arrayBuffer());
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read this file: ' + (e && e.message)));
    return;
  }

  const hex   = Array.from(headBytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(headBytes).map((b) => (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.').join('');
  const guess = guessFormat(headBytes);

  resultsEl.innerHTML = '';

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Unknown file - best-effort inspection'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', 'Unknown'));
  tbl.appendChild(row('Name',     file.name));
  tbl.appendChild(row('Size',     `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('MIME',     file.type || '-'));
  tbl.appendChild(row('Modified', file.lastModified ? new Date(file.lastModified).toISOString().replace('T', ' ').replace(/\..*$/, '') : '-'));
  tbl.appendChild(row('Extension', fileExt(file.name) || '-'));
  tbl.appendChild(row('Magic guess', guess));
  card.appendChild(tbl);

  card.appendChild(el('div', { class: 'anr-readout-section' }, 'First 128 bytes'));
  card.appendChild(el('pre', { class: 'anr-unknown-dump' }, 'HEX:\n' + hex + '\n\nASCII:\n' + ascii));

  const hashTbl = el('table', { class: 'anr-readout' });
  hashTbl.appendChild(sha256Row(file));
  card.appendChild(hashTbl);

  // If it looks like text, JSON, or XML, show enhanced previews
  const ext = fileExt(file.name);
  const isJsonExt = ext === 'json';
  const isXmlExt = ext === 'xml' || ext === 'html' || ext === 'htm';
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
        card.appendChild(el('p', { class: 'anr-hint anr-syn-error' },
          'JSON parse error: ' + parseError.message));
        const rawPre = el('pre', { class: 'anr-ocr-text' }, '');
        rawPre.textContent = jsonText.slice(0, 4096);
        card.appendChild(rawPre);
      } else {
        const stats = jsonStats(parsed, 0);

        const details = el('details', { open: '' });
        const summary = el('summary', { class: 'anr-fmt-summary' }, 'JSON - formatted view');
        details.appendChild(summary);

        card.appendChild(el('div', { class: 'anr-readout-section' }, 'JSON statistics'));
        const jsTbl = el('table', { class: 'anr-readout' });
        jsTbl.appendChild(row('Total keys', stats.keys.toLocaleString()));
        jsTbl.appendChild(row('Max depth', stats.maxDepth));
        if (stats.arrays.length > 0) {
          jsTbl.appendChild(row('Arrays', stats.arrays.length + ' (lengths: ' + stats.arrays.join(', ') + ')'));
        }
        card.appendChild(jsTbl);

        const jsonPre = el('pre', { class: 'anr-ocr-text anr-pre-scroll', html: highlightJson(parsed, 0) });
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
        card.appendChild(el('p', { class: 'anr-hint anr-syn-error' },
          'XML parse error - showing raw text above'));
      } else {
        const xstats = xmlStats(doc.documentElement, 0);

        card.appendChild(el('div', { class: 'anr-readout-section' }, 'XML statistics'));
        const xmlTbl = el('table', { class: 'anr-readout' });
        xmlTbl.appendChild(row('Elements', xstats.count.toLocaleString()));
        xmlTbl.appendChild(row('Max depth', xstats.maxDepth));
        card.appendChild(xmlTbl);

        let formattedXml = '';
        // Include XML declaration if present
        for (const child of doc.childNodes) {
          if (child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
            formattedXml += formatXml(child, 0);
          }
        }
        formattedXml += formatXml(doc.documentElement, 0);

        const xmlDetails = el('details', { open: '' });
        xmlDetails.appendChild(el('summary', { class: 'anr-fmt-summary' }, 'XML - formatted view'));
        const xmlPre = el('pre', { class: 'anr-ocr-text anr-pre-scroll', html: formattedXml });
        xmlDetails.appendChild(xmlPre);
        card.appendChild(xmlDetails);
      }
    } catch (_) {}
  }

  resultsEl.appendChild(card);

}
