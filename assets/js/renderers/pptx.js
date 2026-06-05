/* Analyser - PPTX slide viewer
   Reads .pptx (Office Open XML presentation) and renders each slide as a card
   with its text (title + body) and any embedded images, in presentation order. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { openZip } from './zip.js';

const EMU_PER_PX = 9525; // 914400 EMU/inch ÷ 96 px/inch

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function resolveRel(basePath, target) {
  const dir = basePath.slice(0, basePath.lastIndexOf('/') + 1);
  const combined = (dir + target).split('/');
  const out = [];
  for (const p of combined) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
  return out.join('/');
}

export async function renderPptx(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading presentation "${file.name}"…`));

  let zip;
  try {
    zip = await openZip(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read PPTX: ' + (e && e.message)));
    return;
  }
  resultsEl.innerHTML = '';

  // ---- Presentation: slide size + slide order ----
  let slideW = 960, slideH = 540;
  const slideOrder = [];
  const hiddenSlides = new Set();
  if (zip.has('ppt/presentation.xml')) {
    const pres = parseXml(await zip.text('ppt/presentation.xml'));
    const sz = pres.getElementsByTagName('p:sldSz')[0] || pres.getElementsByTagName('sldSz')[0];
    if (sz) {
      slideW = (parseInt(sz.getAttribute('cx'), 10) || 9144000) / EMU_PER_PX;
      slideH = (parseInt(sz.getAttribute('cy'), 10) || 5143500) / EMU_PER_PX;
    }
    // Order comes from sldIdLst → r:id → rels
    const rels = {};
    if (zip.has('ppt/_rels/presentation.xml.rels')) {
      const rd = parseXml(await zip.text('ppt/_rels/presentation.xml.rels'));
      for (const r of rd.getElementsByTagName('Relationship'))
        rels[r.getAttribute('Id')] = r.getAttribute('Target');
    }
    for (const sid of pres.getElementsByTagName('p:sldId')) {
      const rid = sid.getAttribute('r:id') || sid.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      if (rels[rid]) {
        const path = resolveRel('ppt/presentation.xml', rels[rid]);
        slideOrder.push(path);
        // sld @show='0' marks the slide as hidden during a slideshow.
        if (sid.getAttribute('show') === '0') hiddenSlides.add(path);
      }
    }
  }
  if (!slideOrder.length) {
    // Fallback: every slideN.xml in numeric order.
    zip.match(/^ppt\/slides\/slide\d+\.xml$/)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .forEach((e) => slideOrder.push(e.name));
  }

  // ---- Metadata ----
  const metaCard = el('div', { class: 'anr-card' });
  metaCard.appendChild(el('h3', {}, 'Presentation'));
  const metaTbl = el('table', { class: 'anr-readout' });
  metaTbl.appendChild(row('File', file.name));
  metaTbl.appendChild(row('Size', fmtBytes(file.size)));
  metaTbl.appendChild(row('Slides', slideOrder.length || '-'));
  metaTbl.appendChild(rowHelp('Slide size', Math.round(slideW) + ' × ' + Math.round(slideH) + ' px',
    'The slide canvas dimensions in pixels. The presentation\'s aspect ratio (e.g. 16:9 or 4:3) is derived from this.'));
  if (zip.has('docProps/core.xml')) {
    const core = parseXml(await zip.text('docProps/core.xml'));
    const get = (t) => { const e = core.getElementsByTagName(t)[0]; return e ? e.textContent : ''; };
    const creator = get('dc:creator'); if (creator) metaTbl.appendChild(row('Author', creator));
    const title = get('dc:title'); if (title) metaTbl.appendChild(row('Title', title));
  }
  if (zip.has('docProps/app.xml')) {
    const app = parseXml(await zip.text('docProps/app.xml'));
    const a = app.getElementsByTagName('Application')[0];
    if (a) metaTbl.appendChild(row('Application', a.textContent));
    // HiddenSlides count from extended properties (additive).
    try {
      const hs = app.getElementsByTagName('HiddenSlides')[0];
      if (hs && hs.textContent && hs.textContent !== '0') metaTbl.appendChild(row('Hidden slides (declared)', hs.textContent));
    } catch (_) { /* ignore */ }
  }
  metaCard.appendChild(metaTbl);
  resultsEl.appendChild(metaCard);

  // ---- Structure card (outline / tables / hyperlinks) — populated after the
  //      slide loop below, inserted here so it appears above the slides. ----
  const structCard = el('div', { class: 'anr-card' });
  resultsEl.appendChild(structCard);
  const outline = [];       // { num, title, hidden }
  let totalHyperlinks = 0;
  const tableReports = [];  // { num, rows, cols }

  // ---- Slides ----
  const slidesCard = el('div', { class: 'anr-card' });
  slidesCard.appendChild(el('h3', {}, 'Slides'));
  resultsEl.appendChild(slidesCard);

  const aspect = slideH / slideW;

  for (let i = 0; i < slideOrder.length; i++) {
    const slidePath = slideOrder[i];
    const xml = await zip.text(slidePath).catch(() => null);
    const slideBox = el('div', { class: 'anr-pptx-slide', style: 'aspect-ratio:' + (slideW / slideH).toFixed(3) + ';' });
    const num = el('div', { class: 'anr-pptx-num' }, String(i + 1));
    slideBox.appendChild(num);

    if (xml) {
      const doc = parseXml(xml);

      // Shape text, separating title placeholders from body text.
      let slideTitle = '';
      let firstText = '';
      for (const sp of doc.getElementsByTagName('p:sp')) {
        const ph = sp.getElementsByTagName('p:ph')[0];
        const phType = ph ? (ph.getAttribute('type') || '') : '';
        const isTitle = /title/i.test(phType);
        const paras = [];
        for (const p of sp.getElementsByTagName('a:p')) {
          let line = '';
          for (const t of p.getElementsByTagName('a:t')) line += t.textContent;
          if (line.trim()) paras.push(line);
        }
        if (!paras.length) continue;
        if (isTitle && !slideTitle) slideTitle = paras.join(' ');
        if (!firstText) firstText = paras[0];
        const block = el('div', { class: isTitle ? 'anr-pptx-title' : 'anr-pptx-body' });
        for (const line of paras) block.appendChild(el('p', {}, line));
        slideBox.appendChild(block);
      }

      // Outline entry (title, else first text on slide), plus hidden flag.
      try {
        outline.push({ num: i + 1, title: slideTitle || firstText || '(no text)', hidden: hiddenSlides.has(slidePath) });
      } catch (_) { /* ignore */ }

      // On-slide tables (a:tbl): report row/col counts.
      try {
        for (const tbl of doc.getElementsByTagName('a:tbl')) {
          const rows = tbl.getElementsByTagName('a:tr');
          let cols = 0;
          const grid = tbl.getElementsByTagName('a:gridCol');
          if (grid.length) cols = grid.length;
          else if (rows.length) cols = rows[0].getElementsByTagName('a:tc').length;
          tableReports.push({ num: i + 1, rows: rows.length, cols });
        }
      } catch (_) { /* ignore */ }

      // Hyperlinks (a:hlinkClick with a relationship id).
      try {
        for (const hl of doc.getElementsByTagName('a:hlinkClick')) {
          const rid = hl.getAttribute('r:id') || hl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
          if (rid) totalHyperlinks++;
        }
      } catch (_) { /* ignore */ }

      // Mark hidden slides visually.
      if (hiddenSlides.has(slidePath)) {
        slideBox.appendChild(el('div', { class: 'anr-pptx-num', style: 'left:auto;right:6px;background:var(--accent);' }, 'Hidden'));
      }

      // Embedded images via slide rels.
      const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/, 'slides/_rels/$1.xml.rels');
      if (zip.has(relsPath)) {
        const rels = parseXml(await zip.text(relsPath));
        const relMap = {};
        for (const r of rels.getElementsByTagName('Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
        for (const blip of doc.getElementsByTagName('a:blip')) {
          const embed = blip.getAttribute('r:embed') || blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
          if (embed && relMap[embed]) {
            const imgPath = resolveRel(slidePath, relMap[embed]);
            const bytes = await zip.bytes(imgPath).catch(() => null);
            if (bytes) {
              const ext = (imgPath.match(/\.(\w+)$/) || [, 'png'])[1];
              const mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
              const blob = new Blob([bytes], { type: mime });
              const img = el('img', { src: URL.createObjectURL(blob), class: 'anr-pptx-img', title: 'Click to analyse as photo', style: 'cursor: pointer;' });
              img.addEventListener('click', () => { if (window._anrHandleFile) window._anrHandleFile(new File([bytes], 'slide-image.' + ext, { type: mime })); });
              slideBox.appendChild(img);
            }
          }
        }
      }
    }

    // Speaker notes
    const notesPath = slidePath.replace(/slides\/(slide\d+)\.xml$/, 'notesSlides/notesSlide' + (i + 1) + '.xml');
    if (zip.has(notesPath)) {
      const notes = parseXml(await zip.text(notesPath));
      let noteText = '';
      for (const t of notes.getElementsByTagName('a:t')) noteText += t.textContent + ' ';
      noteText = noteText.trim();
      // Drop the slide-number-only auto note.
      if (noteText && !/^\d+$/.test(noteText)) {
        const det = el('details', { class: 'anr-pptx-notes' });
        det.appendChild(el('summary', {}, 'Speaker notes'));
        det.appendChild(el('p', {}, noteText));
        slideBox.appendChild(det);
      }
    }

    slidesCard.appendChild(slideBox);
  }

  if (!slideOrder.length) slidesCard.appendChild(el('p', { class: 'anr-hint' }, 'No slides found.'));

  // ---- Populate structure card (additive) ----
  try {
    const hiddenCount = outline.filter((o) => o.hidden).length;
    const hasContent = outline.length || tableReports.length || totalHyperlinks || hiddenCount;
    if (hasContent) {
      structCard.appendChild(el('h3', {}, 'Outline & structure'));
      const t = el('table', { class: 'anr-readout' });
      if (hiddenCount) t.appendChild(row('Hidden slides', hiddenCount));
      if (tableReports.length) {
        t.appendChild(row('Tables', tableReports.length + ' (' + tableReports.map((r) => 'slide ' + r.num + ': ' + r.rows + '×' + r.cols).join(', ') + ')'));
      }
      if (totalHyperlinks) t.appendChild(row('Hyperlinks', totalHyperlinks));
      structCard.appendChild(t);
      if (outline.length) {
        const det = el('details', { style: 'margin-top:8px;' });
        det.appendChild(el('summary', {}, 'Slide outline (' + outline.length + ')'));
        const ol = el('ol', { style: 'margin:6px 0;padding-left:24px;' });
        for (const o of outline) {
          const li = el('li', { style: 'margin:2px 0;' });
          li.appendChild(document.createTextNode(o.title.length > 120 ? o.title.slice(0, 120) + '…' : o.title));
          if (o.hidden) li.appendChild(el('span', { class: 'anr-hint', style: 'margin-left:6px;' }, '(hidden)'));
          ol.appendChild(li);
        }
        det.appendChild(ol);
        structCard.appendChild(det);
      }
    } else {
      structCard.remove();
    }
  } catch (_) { try { structCard.remove(); } catch (__) { /* ignore */ } }

  resultsEl.appendChild(integrityCard(file));
}
