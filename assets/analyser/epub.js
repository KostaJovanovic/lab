/* Analyser - EPUB reader
   Reads .epub (zipped XHTML eBook): metadata, cover, and chapter-by-chapter
   reading with navigation. */

import { el, row, fmtBytes, integrityCard, errorCard } from './util.js';
import { openZip } from './zip.js';

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

// Resolve an href relative to the OPF directory.
function resolvePath(opfPath, href) {
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const combined = (dir + href).split('/');
  const out = [];
  for (const part of combined) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

// Strip scripts/handlers from a chapter's body so it can be shown inline.
function sanitizeBody(doc) {
  const body = doc.body || doc.querySelector('body');
  if (!body) return document.createElement('div');
  const clone = body.cloneNode(true);
  clone.querySelectorAll('script, style, link, iframe, object, embed').forEach((n) => n.remove());
  clone.querySelectorAll('*').forEach((n) => {
    for (const attr of [...n.attributes]) {
      if (/^on/i.test(attr.name)) n.removeAttribute(attr.name);
      if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) n.removeAttribute(attr.name);
    }
  });
  const div = document.createElement('div');
  div.className = 'anr-epub-content';
  while (clone.firstChild) div.appendChild(clone.firstChild);
  return div;
}

export async function renderEpub(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading eBook "${file.name}"…`));

  let zip;
  try {
    zip = await openZip(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read EPUB: ' + (e && e.message)));
    return;
  }
  resultsEl.innerHTML = '';

  // ---- Locate the OPF package document ----
  let opfPath = null;
  if (zip.has('META-INF/container.xml')) {
    const container = parseXml(await zip.text('META-INF/container.xml'));
    const rootfile = container.getElementsByTagName('rootfile')[0];
    if (rootfile) opfPath = rootfile.getAttribute('full-path');
  }
  if (!opfPath) {
    const opf = zip.match(/\.opf$/)[0];
    if (opf) opfPath = opf.name;
  }
  if (!opfPath || !zip.has(opfPath)) {
    resultsEl.appendChild(errorCard('Could not find the EPUB package document.'));
    return;
  }

  const opf = parseXml(await zip.text(opfPath));

  // ---- Metadata ----
  const metaGet = (tag) => { const e = opf.getElementsByTagName(tag)[0]; return e ? e.textContent : ''; };
  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, 'eBook'));
  const metaTbl = el('table', { class: 'anr-readout' });
  const title = metaGet('dc:title');
  metaTbl.appendChild(row('Title', title || file.name));
  const creator = metaGet('dc:creator'); if (creator) metaTbl.appendChild(row('Author', creator));
  const publisher = metaGet('dc:publisher'); if (publisher) metaTbl.appendChild(row('Publisher', publisher));
  const language = metaGet('dc:language'); if (language) metaTbl.appendChild(row('Language', language));
  const date = metaGet('dc:date'); if (date) metaTbl.appendChild(row('Date', date));
  const pkg = opf.getElementsByTagName('package')[0];
  if (pkg && pkg.getAttribute('version')) metaTbl.appendChild(row('EPUB version', pkg.getAttribute('version')));
  metaTbl.appendChild(row('File', file.name));
  metaTbl.appendChild(row('Size', fmtBytes(file.size)));
  metaCard.appendChild(metaTbl);
  resultsEl.appendChild(metaCard);

  // ---- Manifest (id -> { href, type, props }) ----
  const manifest = {};
  for (const item of opf.getElementsByTagName('item')) {
    manifest[item.getAttribute('id')] = {
      href: item.getAttribute('href'),
      type: item.getAttribute('media-type'),
      props: item.getAttribute('properties') || ''
    };
  }

  // ---- Cover image ----
  let coverId = null;
  for (const m of opf.getElementsByTagName('meta')) {
    if (m.getAttribute('name') === 'cover') coverId = m.getAttribute('content');
  }
  for (const id in manifest) if (manifest[id].props.includes('cover-image')) coverId = id;
  if (coverId && manifest[coverId]) {
    const coverPath = resolvePath(opfPath, manifest[coverId].href);
    const bytes = await zip.bytes(coverPath).catch(() => null);
    if (bytes) {
      const blob = new Blob([bytes], { type: manifest[coverId].type || 'image/jpeg' });
      const coverCard = el('div', { class: 'anr-card' });
      coverCard.appendChild(el('h3', {}, 'Cover'));
      coverCard.appendChild(el('img', {
        src: URL.createObjectURL(blob),
        style: 'max-width:240px;max-height:360px;border:1px solid var(--hairline);display:block;'
      }));
      resultsEl.appendChild(coverCard);
    }
  }

  // ---- Spine (reading order) ----
  const spine = [];
  for (const ref of opf.getElementsByTagName('itemref')) {
    const id = ref.getAttribute('idref');
    if (manifest[id]) spine.push(resolvePath(opfPath, manifest[id].href));
  }

  // ---- Reader ----
  const readerCard = el('div', { class: 'anr-card' });
  readerCard.appendChild(el('h3', {}, 'Read'));
  const nav = el('div', { class: 'anr-epub-nav' });
  const prevBtn = el('button', { type: 'button', class: 'anr-btn' }, '← Prev');
  const nextBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Next →');
  const chapSel = el('select', { class: 'anr-dropdown' });
  spine.forEach((p, i) => chapSel.appendChild(el('option', { value: String(i) }, 'Chapter ' + (i + 1))));
  nav.appendChild(prevBtn);
  nav.appendChild(chapSel);
  nav.appendChild(nextBtn);
  readerCard.appendChild(nav);
  const content = el('div', { class: 'anr-epub-viewport' });
  readerCard.appendChild(content);
  resultsEl.appendChild(readerCard);

  let current = 0;
  async function showChapter(i) {
    if (i < 0 || i >= spine.length) return;
    current = i;
    chapSel.value = String(i);
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === spine.length - 1;
    content.innerHTML = '';
    const xhtml = await zip.text(spine[i]).catch(() => null);
    if (!xhtml) { content.appendChild(el('p', { class: 'anr-hint' }, '(could not load chapter)')); return; }
    const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
    const fallback = doc.querySelector('parsererror') ? new DOMParser().parseFromString(xhtml, 'text/html') : doc;
    content.appendChild(sanitizeBody(fallback));
    content.scrollTop = 0;
  }
  prevBtn.addEventListener('click', () => showChapter(current - 1));
  nextBtn.addEventListener('click', () => showChapter(current + 1));
  chapSel.addEventListener('change', () => showChapter(parseInt(chapSel.value, 10)));
  if (spine.length) showChapter(0);
  else readerCard.appendChild(el('p', { class: 'anr-hint' }, 'No readable chapters found.'));

  resultsEl.appendChild(integrityCard(file));
}
