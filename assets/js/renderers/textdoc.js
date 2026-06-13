/* Analyser - text & lightweight-markup document viewer
   ============================================================================
   A family of formats whose content is really just text or simple XML/HTML:
     - markup source (DITA, TEI, JATS, reStructuredText, AsciiDoc, Org, Textile,
       TeX/LaTeX, BibTeX) - shown as selectable source on page sheets;
     - RTF                - control words stripped to readable prose;
     - AbiWord (.abw)     - XML word processor, paragraph text;
     - FictionBook (.fb2) - XML ebook, titles + paragraphs;
     - HWPX               - Hangul Office (zip of XML), paragraph text;
     - MHTML (.mht)       - MIME web archive, the HTML part rendered (sanitised).

   Everything funnels into the shared page-preview + per-page selectable text
   cards in paged.js, so these read like the other document viewers. Every
   extractor is guarded so a malformed file degrades to a message.
   ============================================================================ */

import { el, buildReadout, fmtBytes, rowHelp, integrityCard, errorCard } from '../core/util.js';
import { openZip } from './zip.js';
import { paginateText, paginateFlow, pagedPreviewCard, pagedTextCard } from './paged.js';

const LABELS = {
  rtf: 'Rich Text Format', abw: 'AbiWord document', fb2: 'FictionBook ebook',
  hwpx: 'Hangul (HWPX) document', mht: 'MHTML web archive', mhtml: 'MHTML web archive',
  dita: 'DITA topic', ditamap: 'DITA map', tei: 'TEI document', jats: 'JATS article',
  nxml: 'JATS / NLM article', rst: 'reStructuredText', adoc: 'AsciiDoc', asciidoc: 'AsciiDoc',
  org: 'Org-mode document', textile: 'Textile markup', tex: 'TeX / LaTeX source',
  latex: 'LaTeX source', ltx: 'LaTeX source', sty: 'LaTeX style', cls: 'LaTeX class',
  bib: 'BibTeX bibliography',
};

const MONO_KINDS = new Set(['dita', 'ditamap', 'tei', 'jats', 'nxml', 'rst', 'adoc', 'asciidoc', 'org', 'textile', 'tex', 'latex', 'ltx', 'sty', 'cls', 'bib']);

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.querySelector('parsererror') ? null : doc;
}

// ---------- RTF ----------
// Strip RTF control words / ignorable destinations down to readable text.
function stripRtf(rtf) {
  let out = '';
  let i = 0;
  const n = rtf.length;
  const stack = [];
  let ignore = false;
  // Destinations whose contents are not body text.
  const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object',
    'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'footnote', 'field',
    'generator', 'datastore', 'themedata', 'colorschememapping', 'latentstyles',
    'rsidtbl', 'listtable', 'listoverridetable', 'xmlnstbl', 'mmath', 'fldinst', 'filetbl']);
  let guard = 0;
  while (i < n && guard++ < 50_000_000) {
    const c = rtf[i];
    if (c === '{') { stack.push(ignore); i++; continue; }
    if (c === '}') { ignore = stack.length ? stack.pop() : false; i++; continue; }
    if (c === '\\') {
      const next = rtf[i + 1];
      if (next === '*') { ignore = true; i += 2; continue; }       // ignorable destination
      if (next === "'") {                                          // \'xx hex byte (cp1252-ish)
        const code = parseInt(rtf.substr(i + 2, 2), 16);
        if (!ignore && !isNaN(code)) out += String.fromCharCode(code);
        i += 4; continue;
      }
      if (next === '\\' || next === '{' || next === '}') { if (!ignore) out += next; i += 2; continue; }
      if (next === '\n' || next === '\r' || next === '~') { if (!ignore) out += (next === '~' ? ' ' : '\n'); i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i));
      if (m) {
        const word = m[1], arg = m[2];
        i += m[0].length;
        if (ignore) continue;
        if (word === 'par' || word === 'line' || word === 'sect' || word === 'pard') out += '\n';
        else if (word === 'tab') out += '\t';
        else if (word === 'u' && arg != null) {
          let code = parseInt(arg, 10); if (code < 0) code += 65536;
          out += String.fromCharCode(code);
          if (rtf[i] && rtf[i] !== '\\' && rtf[i] !== '{' && rtf[i] !== '}') i++;  // skip 1 fallback char
        } else if (SKIP.has(word)) ignore = true;
        continue;
      }
      i++; continue;
    }
    if (c === '\n' || c === '\r') { i++; continue; }
    if (!ignore) out += c;
    i++;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- AbiWord / HWPX (paragraph text from XML) ----------
function paragraphsFromXml(doc) {
  const paras = [];
  for (const p of doc.getElementsByTagName('*')) {
    if (p.localName === 'p') {
      const t = p.textContent.replace(/\s+/g, ' ').trim();
      paras.push(t);
    }
  }
  return paras.join('\n');
}

async function extractHwpx(file) {
  const zip = await openZip(file, 64 * 1024 * 1024);
  const sections = zip.match(/Contents\/section\d+\.xml$/i).sort((a, b) => a.name.localeCompare(b.name));
  let text = '';
  for (const s of sections) {
    const xml = await zip.text(s.name);
    const doc = xml && parseXml(xml);
    if (doc) text += (text ? '\n' : '') + paragraphsFromXml(doc);
  }
  return text;
}

// ---------- FictionBook (.fb2) ----------
function renderFb2Content(doc) {
  const container = document.createElement('div');
  const FB = doc.documentElement && doc.documentElement.namespaceURI;
  const bodies = doc.getElementsByTagNameNS(FB || '*', 'body');
  const emit = (node, depth) => {
    for (const c of node.children) {
      const ln = c.localName;
      if (ln === 'title') {
        const h = document.createElement('h' + Math.min(6, depth + 2));
        h.textContent = c.textContent.replace(/\s+/g, ' ').trim();
        if (h.textContent) container.appendChild(h);
      } else if (ln === 'subtitle') {
        const p = document.createElement('p'); p.style.fontWeight = 'bold';
        p.textContent = c.textContent.replace(/\s+/g, ' ').trim();
        container.appendChild(p);
      } else if (ln === 'p') {
        const p = document.createElement('p'); p.style.margin = '0 0 10px';
        p.textContent = c.textContent.replace(/\s+/g, ' ').trim() || ' ';
        container.appendChild(p);
      } else if (ln === 'empty-line') {
        container.appendChild(document.createElement('br'));
      } else if (ln === 'section') {
        emit(c, depth + 1);
      }
    }
  };
  for (const b of bodies) emit(b, 0);
  return container;
}

// ---------- MHTML ----------
// Pull the text/html part out of a MIME multipart archive and decode it.
function extractMhtmlHtml(text) {
  const mb = /boundary="?([^"\r\n;]+)"?/i.exec(text);
  let html = null;
  const decodePart = (raw) => {
    const sep = raw.indexOf('\r\n\r\n') >= 0 ? '\r\n\r\n' : '\n\n';
    const split = raw.indexOf(sep);
    if (split < 0) return null;
    const headers = raw.slice(0, split).toLowerCase();
    if (!/content-type:\s*text\/html/.test(headers)) return null;
    let body = raw.slice(split + sep.length);
    if (/content-transfer-encoding:\s*quoted-printable/.test(headers)) {
      body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    } else if (/content-transfer-encoding:\s*base64/.test(headers)) {
      try { body = atob(body.replace(/\s+/g, '')); } catch (_) {}
    }
    return body;
  };
  if (mb) {
    const parts = text.split('--' + mb[1]);
    for (const part of parts) { const h = decodePart(part); if (h) { html = h; break; } }
  }
  if (!html && /content-type:\s*text\/html/i.test(text)) html = decodePart(text);
  return html;
}

// Build a sanitised content element from an HTML string (no scripts, styles,
// event handlers or network-loading resources).
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, link, meta, iframe, object, embed, noscript, base, title').forEach((n) => n.remove());
  for (const node of doc.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const val = attr.value;
      if (name.startsWith('on')) node.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(val)) node.removeAttribute(attr.name);
      else if (name === 'src' || name === 'srcset' || name === 'background') node.removeAttribute(attr.name); // no network fetches
      else if (name === 'style' && /url\s*\(/i.test(val)) node.removeAttribute(attr.name);
    }
  }
  const container = document.createElement('div');
  const body = doc.body || doc.documentElement;
  for (const child of [...body.childNodes]) container.appendChild(child);
  return container;
}

// ---------- main ----------
export async function renderTextDoc(file, container, kind, ext) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading document...'));

  try {
    ext = (ext || (file.name.split('.').pop() || '')).toLowerCase();
    let pages, pageLabel = 'Page';
    const label = LABELS[ext] || LABELS[kind] || 'Document';

    if (kind === 'hwpx') {
      const text = await extractHwpx(file);
      pages = paginateText(text);
    } else if (kind === 'mhtml') {
      const raw = await file.text();
      const html = extractMhtmlHtml(raw);
      if (html == null) { container.innerHTML = ''; container.appendChild(errorCard('Could not find an HTML part in this MHTML archive.')); return; }
      pages = paginateFlow(sanitizeHtml(html));
    } else if (kind === 'fb2') {
      const doc = parseXml(await file.text());
      if (!doc) { container.innerHTML = ''; container.appendChild(errorCard('Could not parse this FictionBook file.')); return; }
      pages = paginateFlow(renderFb2Content(doc));
    } else if (kind === 'abw') {
      const doc = parseXml(await file.text());
      pages = paginateText(doc ? paragraphsFromXml(doc) : await file.text());
    } else if (kind === 'rtf') {
      pages = paginateText(stripRtf(await file.text()));
    } else {
      // markup / source: show the raw text as selectable source on page sheets.
      pages = paginateText(await file.text(), { mono: true });
    }

    const pageTexts = pages.map((p) => p.textContent);

    container.innerHTML = '';
    const info = el('div', { class: 'anr-card' });
    info.appendChild(el('h3', {}, label));
    info.appendChild(buildReadout([
      ['File', file.name],
      ['Size', fmtBytes(file.size)],
      file.type && rowHelp('MIME', file.type, "The MIME type is the standard label for the file's format. The browser reads it from the extension or operating system, so it is a hint rather than proof of the real format."),
      file.lastModified && ['Last modified', new Date(file.lastModified).toLocaleString()],
    ]));
    container.appendChild(info);

    if (pages.length && pageTexts.some((t) => t.trim())) {
      container.appendChild(pagedPreviewCard(pages, { title: 'Page previews', label: pageLabel }));
      container.appendChild(pagedTextCard(pageTexts, { label: pageLabel }));
    } else {
      container.appendChild(el('div', { class: 'anr-card' }, [
        el('h3', {}, 'Page previews'),
        el('p', { class: 'anr-hint' }, 'No readable text content could be extracted from this file.'),
      ]));
    }

    if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Could not read document: ' + (e && e.message || 'unknown error')));
  }
}

export const renderRtf = (f, c, ext) => renderTextDoc(f, c, 'rtf', ext || 'rtf');
export const renderAbw = (f, c, ext) => renderTextDoc(f, c, 'abw', ext || 'abw');
export const renderFb2 = (f, c, ext) => renderTextDoc(f, c, 'fb2', ext || 'fb2');
export const renderHwpx = (f, c, ext) => renderTextDoc(f, c, 'hwpx', ext || 'hwpx');
export const renderMhtml = (f, c, ext) => renderTextDoc(f, c, 'mhtml', ext || 'mht');
export const renderMarkup = (f, c, ext) => renderTextDoc(f, c, 'markup', ext);
