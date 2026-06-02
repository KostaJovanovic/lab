/* Analyser - DOCX viewer
   Reads .docx (Office Open XML) and renders a simplified document view
   with metadata, formatted text, tables, and text extraction. */

import { el, row, fmtBytes, sha256Row } from './util.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

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

// ---------- ZIP reader ----------

async function readZipEntries(file) {
  const maxRead = Math.min(file.size, 4 * 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, maxRead).arrayBuffer());
  const view = new DataView(buf.buffer);
  const entries = [];
  let pos = 0;
  while (pos + 30 < buf.length) {
    if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4B ||
        buf[pos + 2] !== 0x03 || buf[pos + 3] !== 0x04) break;
    const method = view.getUint16(pos + 8, true);
    const compSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    let name = '';
    for (let i = 0; i < nameLen; i++) name += String.fromCharCode(buf[pos + 30 + i]);
    const dataStart = pos + 30 + nameLen + extraLen;
    entries.push({ name, method, compSize, dataStart });
    pos = dataStart + compSize;
  }
  return { entries, buf };
}

async function inflateEntry(buf, entry) {
  const raw = buf.slice(entry.dataStart, entry.dataStart + entry.compSize);
  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method === 8 && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(raw);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return new TextDecoder().decode(out);
  }
  return null;
}

// ---------- Document XML → DOM ----------

function parseRuns(paragraph) {
  const frag = document.createDocumentFragment();
  for (const child of paragraph.children) {
    if (child.namespaceURI !== W) continue;
    if (child.localName === 'r') {
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
        span.style.cssText = 'color:#2563eb;text-decoration:underline;';
        span.textContent = text;
        frag.appendChild(span);
      }
    }
  }
  return frag;
}

function renderParagraph(p) {
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
  elem.appendChild(parseRuns(p));
  if (!elem.textContent.trim() && !elem.querySelector('br')) elem.style.minHeight = '1em';
  return elem;
}

function renderTable(tbl) {
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;width:100%;margin:12px 0;';
  for (const tr of wChildren(tbl, 'tr')) {
    const rowEl = document.createElement('tr');
    for (const tc of wChildren(tr, 'tc')) {
      const td = document.createElement('td');
      td.style.cssText = 'border:1px solid #ccc;padding:6px 8px;vertical-align:top;';
      for (const child of tc.children) {
        if (child.namespaceURI !== W) continue;
        if (child.localName === 'p') td.appendChild(renderParagraph(child));
        else if (child.localName === 'tbl') td.appendChild(renderTable(child));
      }
      rowEl.appendChild(td);
    }
    table.appendChild(rowEl);
  }
  return table;
}

function renderDocumentXml(xmlStr) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, 'application/xml');
  if (doc.querySelector('parsererror'))
    return el('p', { class: 'anr-hint' }, 'Could not parse document XML.');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) return el('p', { class: 'anr-hint' }, 'Empty document.');
  const container = document.createElement('div');
  for (const child of body.children) {
    if (child.namespaceURI !== W) continue;
    if (child.localName === 'p') container.appendChild(renderParagraph(child));
    else if (child.localName === 'tbl') container.appendChild(renderTable(child));
  }
  return container;
}

// ---------- Metadata ----------

async function extractMeta(entries, buf) {
  const fields = {};
  const coreEntry = entries.find(e => e.name === 'docProps/core.xml');
  if (coreEntry) {
    const xml = await inflateEntry(buf, coreEntry);
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
  const appEntry = entries.find(e => e.name === 'docProps/app.xml');
  if (appEntry) {
    const xml = await inflateEntry(buf, appEntry);
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
    const { entries, buf } = await readZipEntries(file);
    const meta = await extractMeta(entries, buf);

    const docEntry = entries.find(e => e.name === 'word/document.xml');
    if (!docEntry) {
      container.innerHTML = '';
      container.appendChild(el('div', { class: 'anr-error' },
        'Could not find document content in this DOCX file.'));
      return;
    }
    const docXml = await inflateEntry(buf, docEntry);
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
    if (file.type) tbl.appendChild(row('MIME', file.type));
    for (const [k, v] of Object.entries(meta)) tbl.appendChild(row(k, v));
    if (file.lastModified)
      tbl.appendChild(row('Last modified', new Date(file.lastModified).toLocaleString()));
    infoCard.appendChild(tbl);
    container.appendChild(infoCard);

    const docCard = el('div', { class: 'anr-card' });
    docCard.appendChild(el('h3', {}, 'Document'));
    const rendered = renderDocumentXml(docXml);
    rendered.style.cssText =
      'max-height:700px;overflow:auto;padding:24px 28px;background:#fff;color:#1a1a1a;' +
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
      const hashCard = el('div', { class: 'anr-card' });
      hashCard.appendChild(el('h3', {}, 'Integrity'));
      const hashTbl = el('table', { class: 'anr-readout' });
      hashTbl.appendChild(sha256Row(file));
      hashCard.appendChild(hashTbl);
      container.appendChild(hashCard);
    }
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'anr-error' },
      'Could not read document: ' + (e.message || 'unknown error')));
  }
}
