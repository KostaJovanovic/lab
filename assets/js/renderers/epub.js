/* Analyser - EPUB reader
   Reads .epub (zipped XHTML eBook): metadata, cover, and chapter-by-chapter
   reading with navigation. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard } from '../core/util.js';
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
  if (pkg && pkg.getAttribute('version')) metaTbl.appendChild(rowHelp('EPUB version', pkg.getAttribute('version'),
    'The EPUB specification version the book conforms to (e.g. 2.0 vs 3.0), which determines the layout and interactivity features it can use.'));

  // --- Extra metadata (additive): description, series, reading direction ---
  try {
    const description = metaGet('dc:description');
    if (description) {
      const clean = description.replace(/<[^>]+>/g, '').trim();
      if (clean) metaTbl.appendChild(row('Description', clean.length > 400 ? clean.slice(0, 400) + '…' : clean));
    }
  } catch (_) { /* ignore */ }
  try {
    // Calibre series info is stored as <meta name="calibre:series"> /
    // calibre:series_index (EPUB2) or refines (EPUB3); cover the common case.
    let series = '', seriesIdx = '';
    for (const m of opf.getElementsByTagName('meta')) {
      const nm = m.getAttribute('name') || '';
      if (nm === 'calibre:series') series = m.getAttribute('content') || '';
      else if (nm === 'calibre:series_index') seriesIdx = m.getAttribute('content') || '';
    }
    if (series) metaTbl.appendChild(row('Series', series + (seriesIdx ? ' #' + seriesIdx : '')));
  } catch (_) { /* ignore */ }
  try {
    const dir = pkg ? (pkg.getAttribute('page-progression-direction') || '') : '';
    if (dir) metaTbl.appendChild(row('Reading direction', dir === 'rtl' ? 'Right to left' : (dir === 'ltr' ? 'Left to right' : dir)));
  } catch (_) { /* ignore */ }

  // --- DRM / encryption detection (additive) ---
  try {
    if (zip.has('META-INF/encryption.xml') || zip.has('META-INF/rights.xml')) {
      metaTbl.appendChild(row('DRM', '⚠ Encryption present (META-INF/' + (zip.has('META-INF/encryption.xml') ? 'encryption.xml' : 'rights.xml') + ')'));
    }
  } catch (_) { /* ignore */ }

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
      const mime = manifest[coverId].type || 'image/jpeg';
      const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      // A slim label, then the cover auto-analysed as a photo inline below it.
      const labelCard = el('div', { class: 'anr-card' });
      labelCard.appendChild(el('h3', {}, 'Cover'));
      labelCard.appendChild(el('p', { class: 'anr-hint', style: 'margin:0;' },
        'The book’s cover image, analysed as a photo below.'));
      resultsEl.appendChild(labelCard);
      const photoBox = el('div');
      resultsEl.appendChild(photoBox);
      import('./photo.js')
        .then(({ renderPhoto }) => renderPhoto(new File([bytes], 'cover.' + ext, { type: mime }), photoBox))
        .catch(() => {});
    }
  }

  // ---- Spine (reading order) ----
  const spine = [];
  for (const ref of opf.getElementsByTagName('itemref')) {
    const id = ref.getAttribute('idref');
    if (manifest[id]) spine.push(resolvePath(opfPath, manifest[id].href));
  }

  // ---- Real table of contents (additive) ----
  // Map a resolved spine path (without #fragment) -> chapter label, plus an
  // ordered toc list for display. Tries EPUB3 nav.xhtml then EPUB2 toc.ncx.
  const tocByPath = {};   // path -> label (first match wins)
  const tocList = [];     // { label, path } in document order
  try {
    // EPUB3: manifest item with properties="nav".
    let navHref = null;
    for (const id in manifest) if (/\bnav\b/.test(manifest[id].props)) navHref = manifest[id].href;
    if (navHref) {
      const navPath = resolvePath(opfPath, navHref);
      const navXml = await zip.text(navPath).catch(() => null);
      if (navXml) {
        const nd = new DOMParser().parseFromString(navXml, 'application/xhtml+xml');
        const ndoc = nd.querySelector('parsererror') ? new DOMParser().parseFromString(navXml, 'text/html') : nd;
        // Find the <nav epub:type="toc"> (fall back to first <nav>).
        let navEl = null;
        for (const n of ndoc.getElementsByTagName('nav')) {
          const t = n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || n.getAttribute('type') || '';
          if (/toc/i.test(t)) { navEl = n; break; }
        }
        if (!navEl) navEl = ndoc.getElementsByTagName('nav')[0] || null;
        if (navEl) {
          for (const a of navEl.getElementsByTagName('a')) {
            const label = (a.textContent || '').trim();
            const href = a.getAttribute('href') || '';
            if (!label || !href) continue;
            const p = resolvePath(navPath, href.split('#')[0]);
            tocList.push({ label, path: p });
            if (!(p in tocByPath)) tocByPath[p] = label;
          }
        }
      }
    }
    // EPUB2 fallback: toc.ncx (referenced by spine @toc, or any *.ncx).
    if (!tocList.length) {
      let ncxPath = null;
      const spineEl = opf.getElementsByTagName('spine')[0];
      const tocId = spineEl ? spineEl.getAttribute('toc') : null;
      if (tocId && manifest[tocId]) ncxPath = resolvePath(opfPath, manifest[tocId].href);
      if (!ncxPath) { const m = zip.match(/\.ncx$/)[0]; if (m) ncxPath = m.name; }
      if (ncxPath) {
        const ncxXml = await zip.text(ncxPath).catch(() => null);
        if (ncxXml) {
          const ncx = parseXml(ncxXml);
          for (const np of ncx.getElementsByTagName('navPoint')) {
            const labelEl = np.getElementsByTagName('navLabel')[0];
            const textEl = labelEl ? labelEl.getElementsByTagName('text')[0] : null;
            const label = textEl ? (textEl.textContent || '').trim() : '';
            const contentEl = np.getElementsByTagName('content')[0];
            const src = contentEl ? (contentEl.getAttribute('src') || '') : '';
            if (!label || !src) continue;
            const p = resolvePath(ncxPath, src.split('#')[0]);
            tocList.push({ label, path: p });
            if (!(p in tocByPath)) tocByPath[p] = label;
          }
        }
      }
    }
  } catch (_) { /* ignore - chapter labels fall back to "Chapter N" */ }

  // ---- Book-wide word count + reading time (additive) ----
  // Sum visible text across spine documents, capping total bytes read so a
  // huge book doesn't stall the page.
  let totalWords = 0;
  let wordCountCapped = false;
  try {
    const BYTE_CAP = 6 * 1024 * 1024; // stop summing after ~6 MB of XHTML
    let bytesRead = 0;
    for (const p of spine) {
      if (bytesRead >= BYTE_CAP) { wordCountCapped = true; break; }
      const xhtml = await zip.text(p).catch(() => null);
      if (!xhtml) continue;
      bytesRead += xhtml.length;
      const text = xhtml.replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ');
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      totalWords += words;
    }
  } catch (_) { /* ignore */ }

  // ---- Contents & stats card (additive) ----
  try {
    if (tocList.length || totalWords) {
      const c = el('div', { class: 'anr-card' });
      c.appendChild(el('h3', {}, 'Contents & stats'));
      const t = el('table', { class: 'anr-readout' });
      if (totalWords) {
        t.appendChild(row('Word count', totalWords.toLocaleString() + (wordCountCapped ? '+ (sampled)' : '')));
        const mins = Math.max(1, Math.round(totalWords / 220)); // ~220 wpm
        const rt = mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min';
        t.appendChild(rowHelp('Reading time', '~' + rt,
          'Estimated at about 220 words per minute, a typical adult reading speed for prose.'));
      }
      if (tocList.length) t.appendChild(row('TOC entries', tocList.length));
      c.appendChild(t);
      if (tocList.length) {
        const det = el('details', { style: 'margin-top:8px;' });
        det.appendChild(el('summary', {}, 'Table of contents (' + tocList.length + ')'));
        const ol = el('ol', { style: 'margin:6px 0;padding-left:24px;' });
        for (const e of tocList.slice(0, 500)) ol.appendChild(el('li', { style: 'margin:2px 0;' }, e.label));
        det.appendChild(ol);
        c.appendChild(det);
      }
      resultsEl.appendChild(c);
    }
  } catch (_) { /* ignore */ }

  // ---- Reader ----
  const readerCard = el('div', { class: 'anr-card' });
  readerCard.appendChild(el('h3', {}, 'Read'));
  const nav = el('div', { class: 'anr-epub-nav' });
  const prevBtn = el('button', { type: 'button', class: 'anr-btn' }, '← Prev');
  const nextBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Next →');
  const chapSel = el('select', { class: 'anr-dropdown' });
  spine.forEach((p, i) => {
    const label = tocByPath[p] || ('Chapter ' + (i + 1));
    chapSel.appendChild(el('option', { value: String(i) }, label.length > 80 ? label.slice(0, 80) + '…' : label));
  });
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
