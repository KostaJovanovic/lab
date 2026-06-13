/* Analyser - OpenDocument viewer (ODT / ODS / ODP)
   ============================================================================
   OpenDocument files are ZIP packages whose payload is content.xml (plus
   meta.xml for properties and a Pictures/ folder for embedded images). This
   module converts that XML into the shared "page preview" presentation in
   paged.js, so ODT reads like the DOCX viewer, ODS like the XLSX viewer, and
   ODP like the PPTX viewer - all shown as paper page sheets.
   ============================================================================ */

import { el, rowHelp, buildReadout, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { openZip } from './zip.js';
import { paginateFlow, pagedPreviewCard, pagedTextCard, makePage } from './paged.js';

// Each key maps to the candidate namespace URIs: the OASIS ODF 1.x URI first,
// then the older OpenOffice.org 1.x URI so StarOffice .sxw/.sxc/.sxd parse too.
const NS = {
  office: ['urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'http://openoffice.org/2000/office'],
  text: ['urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'http://openoffice.org/2000/text'],
  table: ['urn:oasis:names:tc:opendocument:xmlns:table:1.0', 'http://openoffice.org/2000/table'],
  draw: ['urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'http://openoffice.org/2000/drawing'],
  style: ['urn:oasis:names:tc:opendocument:xmlns:style:1.0', 'http://openoffice.org/2000/style'],
  fo: ['urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0', 'http://www.w3.org/1999/XSL/Format'],
  svg: ['urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', 'http://openoffice.org/2000/svg'],
  xlink: ['http://www.w3.org/1999/xlink'],
  meta: ['urn:oasis:names:tc:opendocument:xmlns:meta:1.0', 'http://openoffice.org/2000/meta'],
  dc: ['http://purl.org/dc/elements/1.1/'],
  presentation: ['urn:oasis:names:tc:opendocument:xmlns:presentation:1.0', 'http://openoffice.org/2000/presentation'],
};

// ---------- tiny DOM helpers (namespace-aware, tolerant of OASIS + OO1) ----------

function attrNS(elem, nsKey, name) {
  if (!elem || !elem.getAttributeNS) return '';
  for (const uri of NS[nsKey]) { const v = elem.getAttributeNS(uri, name); if (v) return v; }
  return '';
}

function isEl(node, nsKey, local) {
  return node && node.nodeType === 1 && node.localName === local && NS[nsKey].indexOf(node.namespaceURI) !== -1;
}

function childEls(parent, nsKey, local) {
  const out = [];
  if (!parent) return out;
  for (const c of parent.children) if (isEl(c, nsKey, local)) out.push(c);
  return out;
}

// All descendants matching key:local across every candidate namespace.
function elsNS(parent, nsKey, local) {
  const out = [];
  if (!parent || !parent.getElementsByTagNameNS) return out;
  for (const uri of NS[nsKey]) for (const e of parent.getElementsByTagNameNS(uri, local)) out.push(e);
  return out;
}

function firstNS(parent, nsKey, local) {
  return elsNS(parent, nsKey, local)[0] || null;
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.querySelector('parsererror') ? null : doc;
}

// ---------- style table ----------
// Walk every <style:style> in a document's automatic-styles/styles blocks and
// record the handful of text/paragraph properties we actually render.

function collectStyles(doc, into) {
  if (!doc) return into;
  for (const s of elsNS(doc, 'style', 'style')) {
    const name = attrNS(s, 'style', 'name');
    if (!name) continue;
    const entry = into[name] || {};
    const tp = firstNS(s, 'style', 'text-properties');
    if (tp) {
      const w = attrNS(tp, 'fo', 'font-weight');
      if (w === 'bold' || parseInt(w, 10) >= 600) entry.bold = true;
      if (attrNS(tp, 'fo', 'font-style') === 'italic') entry.italic = true;
      if (attrNS(tp, 'style', 'text-underline-style') && attrNS(tp, 'style', 'text-underline-style') !== 'none') entry.underline = true;
      if (attrNS(tp, 'style', 'text-line-through-style') && attrNS(tp, 'style', 'text-line-through-style') !== 'none') entry.strike = true;
      const sz = attrNS(tp, 'fo', 'font-size');
      const m = /^([\d.]+)pt$/.exec(sz);
      if (m) entry.sizePt = parseFloat(m[1]);
    }
    const pp = firstNS(s, 'style', 'paragraph-properties');
    if (pp) {
      const al = attrNS(pp, 'fo', 'text-align');
      if (al === 'center') entry.align = 'center';
      else if (al === 'end' || al === 'right') entry.align = 'right';
      else if (al === 'justify') entry.align = 'justify';
    }
    into[name] = entry;
  }
  return into;
}

// ---------- images ----------

async function buildImageMap(zip) {
  const map = {};
  for (const e of zip.entries) {
    if (!/^Pictures\//i.test(e.name)) continue;
    if (!/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(e.name)) continue;
    try {
      const bytes = await zip.bytes(e.name);
      if (!bytes) continue;
      const ext = (e.name.match(/\.(\w+)$/) || [, 'png'])[1].toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : (ext === 'svg' ? 'image/svg+xml' : 'image/' + ext);
      map[e.name] = URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch (_) { /* skip */ }
  }
  return map;
}

function imageFor(frame, imageMap) {
  const image = firstNS(frame, 'draw', 'image');
  if (!image) return null;
  let href = attrNS(image, 'xlink', 'href');
  if (!href) return null;
  href = href.replace(/^\.\//, '');
  const url = imageMap[href] || imageMap['Pictures/' + href.replace(/^Pictures\//, '')];
  if (!url) return null;
  const im = document.createElement('img');
  im.src = url;
  im.loading = 'lazy';
  // Size from the frame's svg:width when it is given in cm/in.
  const w = attrNS(frame, 'svg', 'width');
  const cm = /^([\d.]+)cm$/.exec(w);
  const inch = /^([\d.]+)in$/.exec(w);
  if (cm) im.style.width = Math.round(parseFloat(cm[1]) / 2.54 * 96) + 'px';
  else if (inch) im.style.width = Math.round(parseFloat(inch[1]) * 96) + 'px';
  return im;
}

// ---------- inline run rendering (ODT text) ----------

function renderInline(node, frag, styles, imageMap) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) { // text
      frag.appendChild(document.createTextNode(child.nodeValue));
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (isEl(child, 'text', 'span')) {
      const styleName = attrNS(child, 'text', 'style-name');
      const st = styles[styleName];
      const span = document.createElement('span');
      if (st) {
        if (st.bold) span.style.fontWeight = 'bold';
        if (st.italic) span.style.fontStyle = 'italic';
        if (st.underline) span.style.textDecoration = 'underline';
        if (st.strike) span.style.textDecoration = (span.style.textDecoration ? span.style.textDecoration + ' ' : '') + 'line-through';
        if (st.sizePt) span.style.fontSize = st.sizePt + 'pt';
      }
      renderInline(child, span, styles, imageMap);
      frag.appendChild(span);
    } else if (isEl(child, 'text', 'a')) {
      const a = document.createElement('span');
      a.style.cssText = 'color:#0645ad;text-decoration:underline;';
      renderInline(child, a, styles, imageMap);
      frag.appendChild(a);
    } else if (isEl(child, 'text', 's')) {
      const c = parseInt(attrNS(child, 'text', 'c'), 10) || 1;
      frag.appendChild(document.createTextNode(' '.repeat(c)));
    } else if (isEl(child, 'text', 'tab')) {
      frag.appendChild(document.createTextNode('\t'));
    } else if (isEl(child, 'text', 'line-break')) {
      frag.appendChild(document.createElement('br'));
    } else if (isEl(child, 'draw', 'frame')) {
      const im = imageFor(child, imageMap);
      if (im) { im.style.display = 'inline-block'; im.style.verticalAlign = 'middle'; frag.appendChild(im); }
    } else {
      // Unknown inline wrapper - recurse so its text still shows.
      renderInline(child, frag, styles, imageMap);
    }
  }
}

function renderParagraph(p, styles, imageMap, tag) {
  const elem = document.createElement(tag || 'p');
  const styleName = attrNS(p, 'text', 'style-name');
  const st = styles[styleName];
  if (st && st.align) elem.style.textAlign = st.align;
  renderInline(p, elem, styles, imageMap);
  if (!elem.textContent.trim() && !elem.querySelector('br,img')) elem.style.minHeight = '1em';
  return elem;
}

function renderList(list, styles, imageMap, level) {
  const ul = document.createElement('ul');
  ul.style.cssText = 'margin:4px 0;padding-left:' + (22 + (level || 0) * 6) + 'px;';
  for (const item of childEls(list, 'text', 'list-item')) {
    const li = document.createElement('li');
    for (const c of item.children) {
      if (isEl(c, 'text', 'p') || isEl(c, 'text', 'h')) li.appendChild(renderParagraph(c, styles, imageMap, 'span'));
      else if (isEl(c, 'text', 'list')) li.appendChild(renderList(c, styles, imageMap, (level || 0) + 1));
    }
    ul.appendChild(li);
  }
  return ul;
}

function renderTable(tbl, styles, imageMap) {
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;width:100%;margin:12px 0;';
  for (const tr of childEls(tbl, 'table', 'table-row')) {
    const rowEl = document.createElement('tr');
    for (const tc of childEls(tr, 'table', 'table-cell')) {
      const td = document.createElement('td');
      td.style.cssText = 'border:1px solid #c9c9c9;padding:6px 8px;vertical-align:top;';
      const span = parseInt(attrNS(tc, 'table', 'number-columns-spanned'), 10);
      if (span > 1) td.colSpan = span;
      for (const c of tc.children) {
        if (isEl(c, 'text', 'p') || isEl(c, 'text', 'h')) td.appendChild(renderParagraph(c, styles, imageMap));
        else if (isEl(c, 'text', 'list')) td.appendChild(renderList(c, styles, imageMap, 0));
        else if (isEl(c, 'table', 'table')) td.appendChild(renderTable(c, styles, imageMap));
      }
      rowEl.appendChild(td);
      const rep = parseInt(attrNS(tc, 'table', 'number-columns-repeated'), 10);
      if (rep > 1 && rep < 100) for (let i = 1; i < rep; i++) rowEl.appendChild(td.cloneNode(true));
    }
    table.appendChild(rowEl);
  }
  return table;
}

function renderTextBody(textBody, styles, imageMap) {
  const container = document.createElement('div');
  const walk = (parent) => {
    for (const c of parent.children) {
      if (isEl(c, 'text', 'h')) {
        const lvl = Math.min(6, Math.max(1, parseInt(attrNS(c, 'text', 'outline-level'), 10) || 1));
        container.appendChild(renderParagraph(c, styles, imageMap, 'h' + lvl));
      } else if (isEl(c, 'text', 'p')) {
        container.appendChild(renderParagraph(c, styles, imageMap));
      } else if (isEl(c, 'text', 'list')) {
        container.appendChild(renderList(c, styles, imageMap, 0));
      } else if (isEl(c, 'table', 'table')) {
        container.appendChild(renderTable(c, styles, imageMap));
      } else if (isEl(c, 'text', 'section') || isEl(c, 'office', 'text')) {
        walk(c); // descend into sections/text wrappers
      } else if (isEl(c, 'draw', 'frame')) {
        const im = imageFor(c, imageMap);
        if (im) { im.style.display = 'block'; im.style.margin = '10px 0'; container.appendChild(im); }
      }
    }
  };
  walk(textBody);
  return container;
}

// ---------- metadata ----------

// Pull document properties from a parsed meta source - meta.xml (zip ODF) or
// the inline office:meta of a flat ODF document.
function extractMeta(doc) {
  const fields = {};
  if (!doc) return fields;
  const dc = (t) => { const n = elsNS(doc, 'dc', t)[0]; return n ? n.textContent.trim() : null; };
  const mt = (t) => { const n = elsNS(doc, 'meta', t)[0]; return n ? n.textContent.trim() : null; };
  const title = dc('title'); if (title) fields['Title'] = title;
  const creator = dc('creator'); if (creator) fields['Author'] = creator;
  const subject = dc('subject'); if (subject) fields['Subject'] = subject;
  const desc = dc('description'); if (desc) fields['Description'] = desc;
  const created = mt('creation-date'); if (created) fields['Created'] = created.replace('T', ' ').replace(/\..*$/, '');
  const dcDate = dc('date'); if (dcDate) fields['Modified'] = dcDate.replace('T', ' ').replace(/\..*$/, '');
  const gen = mt('generator'); if (gen) fields['Generator'] = gen;
  const stat = elsNS(doc, 'meta', 'document-statistic')[0];
  if (stat) {
    const pc = attrNS(stat, 'meta', 'page-count'); if (pc) fields['Pages'] = pc;
    const wc = attrNS(stat, 'meta', 'word-count'); if (wc) fields['Words'] = wc;
  }
  return fields;
}

// Common info card + text card builders shared by the three ODF kinds.
function infoCard(file, kindLabel, meta) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, kindLabel));
  card.appendChild(buildReadout([
    ['File', file.name],
    ['Size', fmtBytes(file.size)],
    file.type && rowHelp('MIME', file.type, "The MIME type is the standard label for the file's format. The browser reads it from the extension or operating system, so it is a hint rather than proof of the real format."),
    ...Object.entries(meta),
    file.lastModified && ['Last modified', new Date(file.lastModified).toLocaleString()],
  ]));
  return card;
}

// ---------- ODS: spreadsheet ----------

function cellText(tc) {
  let out = '';
  for (const p of elsNS(tc, 'text', 'p')) {
    if (out) out += '\n';
    out += p.textContent;
  }
  return out;
}

function renderSheetPage(tableEl) {
  const page = makePage('sheet');
  page.appendChild(el('div', { class: 'anr-sheet-name' }, attrNS(tableEl, 'table', 'name') || 'Sheet'));

  // Materialise rows/cols, honouring repeats but capping the expansion so a
  // sheet that declares thousands of empty trailing columns stays sane.
  const MAX_COLS = 60, MAX_ROWS = 300;
  const grid = [];
  for (const tr of childEls(tableEl, 'table', 'table-row')) {
    const rowRep = Math.min(parseInt(attrNS(tr, 'table', 'number-rows-repeated'), 10) || 1, MAX_ROWS);
    const cells = [];
    for (const tc of childEls(tr, 'table', 'table-cell')) {
      const rep = Math.min(parseInt(attrNS(tc, 'table', 'number-columns-repeated'), 10) || 1, MAX_COLS);
      const txt = cellText(tc);
      for (let i = 0; i < rep && cells.length < MAX_COLS; i++) cells.push(txt);
    }
    // Trim trailing empties on the row.
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    for (let r = 0; r < rowRep && grid.length < MAX_ROWS; r++) grid.push(cells.slice());
  }
  // Trim trailing all-empty rows.
  while (grid.length && grid[grid.length - 1].every((c) => !c)) grid.pop();
  if (!grid.length) { page.appendChild(el('p', { style: 'color:#888;' }, '(empty sheet)')); return page; }

  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const table = document.createElement('table');
  grid.forEach((cells, ri) => {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement(ri === 0 ? 'th' : 'td');
      cell.textContent = cells[c] || '';
      tr.appendChild(cell);
    }
    table.appendChild(tr);
  });
  page.appendChild(table);
  return page;
}

// ---------- ODP: presentation ----------

function renderSlidePage(drawPage, styles, imageMap, index) {
  const page = makePage('slide');
  const frames = childEls(drawPage, 'draw', 'frame');
  let titleDone = false;
  for (const frame of frames) {
    const box = firstNS(frame, 'draw', 'text-box');
    if (box) {
      const cls = attrNS(frame, 'presentation', 'class');
      const isTitle = !titleDone && (cls === 'title' || cls === 'subtitle' || (!cls && !titleDone));
      const holder = el('div', { class: isTitle ? 'anr-slide-title' : 'anr-slide-body' });
      for (const c of box.children) {
        if (isEl(c, 'text', 'p') || isEl(c, 'text', 'h')) holder.appendChild(renderParagraph(c, styles, imageMap));
        else if (isEl(c, 'text', 'list')) holder.appendChild(renderList(c, styles, imageMap, 0));
      }
      if (holder.textContent.trim()) { page.appendChild(holder); if (isTitle) titleDone = true; }
      continue;
    }
    const im = imageFor(frame, imageMap);
    if (im) page.appendChild(im);
  }
  if (!page.childElementCount) page.appendChild(el('div', { class: 'anr-slide-body', style: 'color:#888;' }, 'Slide ' + (index + 1) + ' (no text)'));
  return page;
}

// ---------- main render ----------

export async function renderOdf(file, container, kind) {
  container.hidden = false;
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'anr-info' }, 'Reading document…'));

  try {
    // Flat ODF (.fodt/.fods/.fodp/.fodg) is a single XML file, not a zip - so
    // sniff the first bytes and take whichever path fits.
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4B;

    let contentDoc, styles = {}, imageMap = {}, meta = {};
    if (isZip) {
      const zip = await openZip(file, 128 * 1024 * 1024);
      if (!zip.has('content.xml')) {
        container.innerHTML = '';
        container.appendChild(errorCard('Could not find content.xml in this OpenDocument file.'));
        return;
      }
      meta = extractMeta(zip.has('meta.xml') ? parseXml(await zip.text('meta.xml')) : null);
      contentDoc = parseXml(await zip.text('content.xml'));
      if (contentDoc) {
        collectStyles(contentDoc, styles);
        if (zip.has('styles.xml')) collectStyles(parseXml(await zip.text('styles.xml')), styles);
        imageMap = await buildImageMap(zip);
      }
    } else {
      // Flat ODF: content, styles and metadata all live in one document.
      contentDoc = parseXml(await file.text());
      if (contentDoc) { collectStyles(contentDoc, styles); meta = extractMeta(contentDoc); }
    }

    if (!contentDoc) {
      container.innerHTML = '';
      container.appendChild(errorCard('Could not parse the document content.'));
      return;
    }

    const body = firstNS(contentDoc, 'office', 'body');

    container.innerHTML = '';

    let pages = [];
    let kindLabel = 'OpenDocument';
    let pageLabel = 'Page';

    // OpenOffice 1.x puts content directly under office:body (no inner wrapper),
    // so fall back to the body itself when the wrapper is absent.
    if (kind === 'ods') {
      kindLabel = 'OpenDocument Spreadsheet';
      pageLabel = 'Sheet';
      const sheet = firstNS(body, 'office', 'spreadsheet') || body;
      const tables = sheet ? childEls(sheet, 'table', 'table') : [];
      pages = tables.map(renderSheetPage);
    } else if (kind === 'odp') {
      kindLabel = 'OpenDocument Presentation';
      pageLabel = 'Slide';
      const pres = firstNS(body, 'office', 'presentation') || body;
      const slides = pres ? childEls(pres, 'draw', 'page') : [];
      pages = slides.map((s, i) => renderSlidePage(s, styles, imageMap, i));
    } else if (kind === 'odg') {
      kindLabel = 'OpenDocument Graphics';
      const drawing = firstNS(body, 'office', 'drawing') || body;
      const dpages = drawing ? childEls(drawing, 'draw', 'page') : [];
      pages = dpages.map((s, i) => renderSlidePage(s, styles, imageMap, i));
    } else {
      kindLabel = 'OpenDocument Text';
      const textBody = firstNS(body, 'office', 'text') || body;
      const content = textBody ? renderTextBody(textBody, styles, imageMap) : document.createElement('div');
      pages = paginateFlow(content);
    }

    const pageTexts = pages.map((p) => p.textContent);

    container.appendChild(infoCard(file, kindLabel, meta));
    container.appendChild(pagedPreviewCard(pages, {
      title: 'Page previews',
      label: pageLabel,
    }));
    if (pageTexts.some((t) => t.trim())) {
      container.appendChild(pagedTextCard(pageTexts, { label: pageLabel }));
    }

    if (file.size <= 500 * 1024 * 1024) container.appendChild(integrityCard(file));
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(errorCard('Could not read document: ' + (e && e.message || 'unknown error')));
  }
}

export const renderOdt = (file, container) => renderOdf(file, container, 'odt');
export const renderOds = (file, container) => renderOdf(file, container, 'ods');
export const renderOdp = (file, container) => renderOdf(file, container, 'odp');
export const renderOdg = (file, container) => renderOdf(file, container, 'odg');
