/* Analyser - DOCX viewer
   Reads .docx (Office Open XML) and renders a simplified document view
   with metadata, formatted text, tables, and text extraction. */

import { el, row, rowHelp, fmtBytes, integrityCard } from './util.js';
import { openZip } from './zip.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function wFirst(parent, name) {
  return parent.getElementsByTagNameNS(W, name)[0] || null;
}

function wChildren(parent, name) {
  const out = [];
  for (const c of parent.children)
    if (c.localName === name && c.namespaceURI === W) out.push(c);
  return out;
}

function wAttr(elem, name) {
  return elem.getAttributeNS(W, name) || elem.getAttribute('w:' + name) || '';
}

// ---------- Document XML → DOM ----------

// Pull an embedded image out of a run's <w:drawing>/<a:blip> (or legacy
// <v:imagedata>) and return an <img> sized from the drawing extent, or null.
function runImage(run, imageMap) {
  if (!imageMap) return null;
  let rid = null;
  const blip = run.getElementsByTagNameNS(A, 'blip')[0];
  if (blip) rid = blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed') || blip.getAttributeNS(R, 'link');
  if (!rid) {
    // legacy VML image (<v:imagedata r:id="...">)
    for (const n of run.getElementsByTagName('*')) {
      if (n.localName === 'imagedata') { rid = n.getAttributeNS(R, 'id') || n.getAttribute('r:id'); break; }
    }
  }
  const url = rid && imageMap[rid];
  if (!url) return null;
  const im = document.createElement('img');
  im.src = url;
  im.loading = 'lazy';
  im.title = 'Click to analyse as photo';
  im.style.cssText = 'max-width:100%;height:auto;display:block;margin:10px 0;cursor:pointer;';
  // Re-fetch the blob URL into a File and run the full photo pipeline on click.
  im.addEventListener('click', async () => {
    try {
      const blob = await (await fetch(url)).blob();
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      if (window._anrHandleFile) window._anrHandleFile(new File([blob], 'docx-image.' + ext, { type: blob.type }));
    } catch (_) {}
  });
  // Size from the drawing extent (EMU → px at 96dpi) when present.
  let extent = null;
  for (const n of run.getElementsByTagName('*')) { if (n.localName === 'extent') { extent = n; break; } }
  if (extent) {
    const cx = parseInt(extent.getAttribute('cx'), 10);
    if (cx) im.style.width = Math.round(cx / 9525) + 'px';
  }
  return im;
}

function parseRuns(paragraph, imageMap) {
  const frag = document.createDocumentFragment();
  for (const child of paragraph.children) {
    if (child.namespaceURI !== W) continue;
    if (child.localName === 'r') {
      const img = runImage(child, imageMap);
      if (img) frag.appendChild(img);
      if (wFirst(child, 'br')) frag.appendChild(document.createElement('br'));
      if (wFirst(child, 'tab')) frag.appendChild(document.createTextNode('\t'));
      let text = '';
      for (const t of child.getElementsByTagNameNS(W, 't')) text += t.textContent;
      if (!text) continue;
      const rPr = wFirst(child, 'rPr');
      if (rPr) {
        const b = wFirst(rPr, 'b');
        const i = wFirst(rPr, 'i');
        const u = wFirst(rPr, 'u');
        const strike = wFirst(rPr, 'strike');
        const sz = wFirst(rPr, 'sz');
        if (b || i || u || strike || sz) {
          const span = document.createElement('span');
          if (b && wAttr(b, 'val') !== '0') span.style.fontWeight = 'bold';
          if (i && wAttr(i, 'val') !== '0') span.style.fontStyle = 'italic';
          if (u) span.style.textDecoration = 'underline';
          if (strike) span.style.textDecoration = 'line-through';
          if (sz) {
            const pts = parseInt(wAttr(sz, 'val'), 10);
            if (pts) span.style.fontSize = (pts / 2) + 'pt';
          }
          span.textContent = text;
          frag.appendChild(span);
          continue;
        }
      }
      frag.appendChild(document.createTextNode(text));
    } else if (child.localName === 'hyperlink') {
      let text = '';
      for (const t of child.getElementsByTagNameNS(W, 't')) text += t.textContent;
      if (text) {
        const span = document.createElement('span');
        span.style.cssText = 'color:var(--accent);text-decoration:underline;';
        span.textContent = text;
        frag.appendChild(span);
      }
    }
  }
  return frag;
}

function renderParagraph(p, imageMap) {
  const pPr = wFirst(p, 'pPr');
  let tag = 'p';
  let isList = false;
  let listLevel = 0;
  let align = '';

  if (pPr) {
    const pStyle = wFirst(pPr, 'pStyle');
    if (pStyle) {
      const val = wAttr(pStyle, 'val');
      if (/^heading\s*1$/i.test(val)) tag = 'h2';
      else if (/^heading\s*2$/i.test(val)) tag = 'h3';
      else if (/^heading\s*3$/i.test(val)) tag = 'h4';
      else if (/^heading\s*[4-6]$/i.test(val)) tag = 'h5';
      else if (/^title$/i.test(val)) tag = 'h1';
      else if (/^subtitle$/i.test(val)) tag = 'h3';
      if (/listparagraph/i.test(val)) isList = true;
    }
    const outLvl = wFirst(pPr, 'outlineLvl');
    if (outLvl && tag === 'p') {
      const lvl = parseInt(wAttr(outLvl, 'val'), 10);
      if (lvl >= 0 && lvl <= 5) tag = 'h' + Math.min(6, lvl + 2);
    }
    const numPr = wFirst(pPr, 'numPr');
    if (numPr) {
      isList = true;
      const ilvl = wFirst(numPr, 'ilvl');
      if (ilvl) listLevel = parseInt(wAttr(ilvl, 'val'), 10) || 0;
    }
    const jc = wFirst(pPr, 'jc');
    if (jc) {
      const v = wAttr(jc, 'val');
      if (v === 'center') align = 'center';
      else if (v === 'right' || v === 'end') align = 'right';
      else if (v === 'both') align = 'justify';
    }
  }

  const elem = document.createElement(tag);
  if (isList) {
    elem.style.paddingLeft = (20 + listLevel * 20) + 'px';
    elem.style.display = 'list-item';
    elem.style.listStyleType = listLevel % 2 === 0 ? 'disc' : 'circle';
  }
  if (align) elem.style.textAlign = align;
  elem.appendChild(parseRuns(p, imageMap));
  if (!elem.textContent.trim() && !elem.querySelector('br') && !elem.querySelector('img')) elem.style.minHeight = '1em';
  return elem;
}

function renderTable(tbl, imageMap) {
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;width:100%;margin:12px 0;';
  for (const tr of wChildren(tbl, 'tr')) {
    const rowEl = document.createElement('tr');
    for (const tc of wChildren(tr, 'tc')) {
      const td = document.createElement('td');
      td.style.cssText = 'border:1px solid var(--rule);padding:6px 8px;vertical-align:top;';
      for (const child of tc.children) {
        if (child.namespaceURI !== W) continue;
        if (child.localName === 'p') td.appendChild(renderParagraph(child, imageMap));
        else if (child.localName === 'tbl') td.appendChild(renderTable(child, imageMap));
      }
      rowEl.appendChild(td);
    }
    table.appendChild(rowEl);
  }
  return table;
}

function renderDocumentXml(xmlStr, imageMap) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, 'application/xml');
  if (doc.querySelector('parsererror'))
    return el('p', { class: 'anr-hint' }, 'Could not parse document XML.');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) return el('p', { class: 'anr-hint' }, 'Empty document.');
  const container = document.createElement('div');
  for (const child of body.children) {
    if (child.namespaceURI !== W) continue;
    if (child.localName === 'p') container.appendChild(renderParagraph(child, imageMap));
    else if (child.localName === 'tbl') container.appendChild(renderTable(child, imageMap));
  }
  return container;
}

// Build a map of relationship-id → blob URL for every embedded raster image
// referenced by the document. Relationship targets in word/_rels/document.xml.rels
// are relative to word/.
async function buildImageMap(zip) {
  const map = {};
  if (!zip.has('word/_rels/document.xml.rels')) return map;
  const relsXml = await zip.text('word/_rels/document.xml.rels');
  if (!relsXml) return map;
  const doc = new DOMParser().parseFromString(relsXml, 'application/xml');
  for (const r of doc.getElementsByTagName('Relationship')) {
    const id = r.getAttribute('Id');
    const target = r.getAttribute('Target') || '';
    if (!id || !target) continue;
    if ((r.getAttribute('TargetMode') || '') === 'External' || /^https?:/i.test(target)) continue;
    if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(target)) continue; // browser-renderable only
    // Resolve relative to word/
    const parts = ('word/' + target.replace(/^\.\//, '')).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
    const path = out.join('/');
    try {
      const bytes = await zip.bytes(path);
      if (bytes) {
        const ext = (path.match(/\.(\w+)$/) || [, 'png'])[1].toLowerCase();
        map[id] = URL.createObjectURL(new Blob([bytes], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }));
      }
    } catch (_) { /* skip unreadable entry */ }
  }
  return map;
}

// ---------- Metadata ----------

async function extractMeta(zip) {
  const fields = {};
  if (zip.has('docProps/core.xml')) {
    const xml = await zip.text('docProps/core.xml');
    if (xml) {
      const grab = (tag) => {
        const m = xml.match(new RegExp('<(?:dc:|cp:)?' + tag + '[^>]*>([^<]+)<'));
        return m ? m[1].trim() : null;
      };
      const creator = grab('creator');
      const title = grab('title');
      const lastBy = grab('lastModifiedBy');
      const created = grab('created');
      const modified = grab('modified');
      const revision = grab('revision');
      if (creator) fields['Author'] = creator;
      if (title) fields['Title'] = title;
      if (lastBy) fields['Last modified by'] = lastBy;
      if (created) fields['Created'] = created;
      if (modified) fields['Modified'] = modified;
      if (revision) fields['Revision'] = revision;
    }
  }
  if (zip.has('docProps/app.xml')) {
    const xml = await zip.text('docProps/app.xml');
    if (xml) {
      const grab = (tag) => {
        const m = xml.match(new RegExp('<' + tag + '[^>]*>([^<]+)<'));
        return m ? m[1].trim() : null;
      };
      const app = grab('Application');
      const appVer = grab('AppVersion');
      if (app) fields['Application'] = app + (appVer ? ' ' + appVer : '');
      if (grab('Pages')) fields['Pages'] = grab('Pages');
      if (grab('Words')) fields['Words'] = grab('Words');
      if (grab('Characters')) fields['Characters'] = grab('Characters');
      if (grab('Paragraphs')) fields['Paragraphs'] = grab('Paragraphs');
    }
  }
  return fields;
}

// ---------- Main render ----------

export async function renderDocx(file, container) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading document…'));

  try {
    // Read generously: embedded images (word/media/*) usually sit after
    // document.xml in the archive, so a small cap would miss them.
    const zip = await openZip(file, 128 * 1024 * 1024);
    const meta = await extractMeta(zip);

    if (!zip.has('word/document.xml')) {
      container.innerHTML = '';
      container.appendChild(el('div', { class: 'anr-error' },
        'Could not find document content in this DOCX file.'));
      return;
    }
    const docXml = await zip.text('word/document.xml');
    if (!docXml) {
      container.innerHTML = '';
      container.appendChild(el('div', { class: 'anr-error' },
        'Could not decompress document content. DecompressionStream may not be supported.'));
      return;
    }

    container.innerHTML = '';

    const infoCard = el('div', { class: 'anr-card' });
    infoCard.appendChild(el('h3', {}, 'Document info'));
    const tbl = el('table', { class: 'anr-readout' });
    tbl.appendChild(row('File', file.name));
    tbl.appendChild(row('Size', fmtBytes(file.size)));
    if (file.type) tbl.appendChild(rowHelp('MIME', file.type, "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));
    for (const [k, v] of Object.entries(meta)) tbl.appendChild(row(k, v));
    if (file.lastModified)
      tbl.appendChild(row('Last modified', new Date(file.lastModified).toLocaleString()));
    infoCard.appendChild(tbl);
    container.appendChild(infoCard);

    const imageMap = await buildImageMap(zip);

    const docCard = el('div', { class: 'anr-card' });
    docCard.appendChild(el('h3', {}, 'Document'));
    const rendered = renderDocumentXml(docXml, imageMap);
    rendered.style.cssText =
      'max-height:700px;overflow:auto;padding:24px 28px;background:var(--bg);color:var(--fg);' +
      'border:1px solid var(--rule);font-family:Georgia,"Times New Roman",serif;' +
      'font-size:15px;line-height:1.7;';
    docCard.appendChild(rendered);
    container.appendChild(docCard);

    const fullText = rendered.textContent;
    if (fullText.trim()) {
      const textCard = el('div', { class: 'anr-card' });
      textCard.appendChild(el('h3', {}, 'Text'));
      const wordCount = fullText.trim().split(/\s+/).filter(Boolean).length;
      const textTbl = el('table', { class: 'anr-readout' });
      textTbl.appendChild(row('Words', wordCount.toLocaleString()));
      textTbl.appendChild(row('Characters', fullText.length.toLocaleString()));
      textCard.appendChild(textTbl);
      const copyBtn = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:8px;' },
        'Copy all text');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(fullText);
          copyBtn.textContent = 'Copied ✓';
        } catch (_) { copyBtn.textContent = 'Copy failed'; }
        setTimeout(() => { copyBtn.textContent = 'Copy all text'; }, 2000);
      });
      textCard.appendChild(copyBtn);
      container.appendChild(textCard);
    }

    if (file.size <= 500 * 1024 * 1024) {
      container.appendChild(integrityCard(file));
    }
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'anr-error' },
      'Could not read document: ' + (e.message || 'unknown error')));
  }
}
