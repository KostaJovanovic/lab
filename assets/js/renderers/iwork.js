/* Analyser - Apple iWork viewer (Pages / Numbers / Keynote)
   ============================================================================
   Modern iWork files (2013+) are ZIP packages whose document content lives in
   Index/*.iwa - Snappy-compressed streams of Apple's private, undocumented
   Protocol Buffer schemas. There is no practical way to re-render that in the
   browser. What we CAN do, faithfully and cheaply, is show the QuickLook
   preview Apple bakes into the package: a Preview.pdf (rendered page-by-page by
   the PDF viewer) or, failing that, the largest preview/thumbnail image. Files
   saved without a preview fall back to a metadata-only readout. */

import { el, row, rowHelp, fmtBytes, integrityCard, errorCard } from '../core/util.js';
import { openZip } from './zip.js';
import { renderPdf } from './pdf.js';
import { parsePlist } from '../lib/plist.js';

const KINDS = {
  pages:   { app: 'Apple Pages',   kind: 'Word-processing / page-layout document' },
  numbers: { app: 'Apple Numbers', kind: 'Spreadsheet' },
  key:     { app: 'Apple Keynote', kind: 'Presentation' },
  keynote: { app: 'Apple Keynote', kind: 'Presentation' },
};

// Largest entry whose name matches the predicate (by uncompressed size), or null.
function largestMatch(zip, re) {
  let best = null;
  for (const e of zip.entries) {
    if (re.test(e.name) && (!best || e.uncompSize > best.uncompSize)) best = e;
  }
  return best;
}

// Best-effort "created with" string from Metadata/BuildVersionHistory.plist - a
// plist array of build strings; the last is the most recent app that wrote it.
async function buildVersion(zip) {
  try {
    const entry = zip.entries.find((e) => /BuildVersionHistory\.plist$/i.test(e.name));
    if (!entry) return '';
    const bytes = await zip.bytes(entry.name);
    if (!bytes) return '';
    const parsed = await parsePlist(bytes);
    const v = parsed && parsed.value;
    const arr = Array.isArray(v) ? v : null;
    const last = arr && arr.length ? arr[arr.length - 1] : (typeof v === 'string' ? v : '');
    return typeof last === 'string' ? last.trim() : '';
  } catch (_) { return ''; }
}

export async function renderIwork(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Reading "${file.name}"…`));

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const info = KINDS[ext] || { app: 'Apple iWork', kind: 'iWork document' };

  let zip;
  try {
    zip = await openZip(file);
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Could not read iWork file: ' + (e && e.message)));
    return;
  }

  // The .key extension is shared with PEM cryptographic keys, which aren't ZIPs.
  // If this isn't a ZIP package at all, it isn't an iWork file - hand it to the
  // proprietary identifier so a private key (or anything else) is still read.
  if (!zip.entries.length) {
    const { renderProprietary } = await import('./proprietary.js');
    return renderProprietary(file, resultsEl);
  }
  resultsEl.innerHTML = '';

  // ---- Metadata card ----
  const isModern = largestMatch(zip, /^Index\/.*\.iwa$/i) || zip.has('Index.zip');
  const isLegacy = !isModern && (zip.has('index.xml') || zip.has('index.apxl') || largestMatch(zip, /\.apxl$/i));
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'iWork document'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', info.app));
  tbl.appendChild(row('Type', info.kind));
  tbl.appendChild(rowHelp('Format',
    isModern ? 'iWork 2013+ (IWA)' : (isLegacy ? "iWork '09 (XML)" : 'iWork package'),
    'Modern iWork stores its content as Snappy-compressed Protocol Buffer streams (the undocumented .iwa format), so Analyser shows the QuickLook preview embedded in the file rather than re-rendering the document itself.'));
  const ver = await buildVersion(zip);
  if (ver) tbl.appendChild(row('Created with', ver));
  tbl.appendChild(row('Size', fmtBytes(file.size)));
  card.appendChild(tbl);
  resultsEl.appendChild(card);

  // ---- Preview: prefer an embedded Preview.pdf, then the largest preview image ----
  const pdfEntry = largestMatch(zip, /preview\.pdf$/i) || largestMatch(zip, /\.pdf$/i);
  if (pdfEntry) {
    resultsEl.appendChild(el('p', { class: 'anr-subhead' }, 'Document preview'));
    const host = el('div', {});
    resultsEl.appendChild(host);
    try {
      const bytes = await zip.bytes(pdfEntry.name);
      if (!bytes) throw new Error('preview unreadable');
      const previewFile = new File([bytes], file.name.replace(/\.[^.]+$/, '') + ' (preview).pdf', { type: 'application/pdf' });
      await renderPdf(previewFile, host);
      return;
    } catch (_) { host.remove(); /* fall through to image / no-preview */ }
  }

  const imgEntry = largestMatch(zip, /(preview|thumbnail)[^/]*\.(jpe?g|png|tiff?)$/i);
  if (imgEntry) {
    const bytes = await zip.bytes(imgEntry.name).catch(() => null);
    if (bytes) {
      const e = (imgEntry.name.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase();
      const mime = 'image/' + (e === 'jpg' ? 'jpeg' : e);
      const blob = new Blob([bytes], { type: mime });
      const pcard = el('div', { class: 'anr-card' });
      pcard.appendChild(el('h3', {}, 'Preview'));
      pcard.appendChild(el('img', { src: URL.createObjectURL(blob), alt: 'Document preview', class: 'anr-iwork-preview' }));
      const analyse = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse this image');
      analyse.addEventListener('click', () => {
        if (window._anrHandleFile) window._anrHandleFile(new File([bytes], 'iwork-preview.' + e, { type: mime }), { nested: true });
      });
      pcard.appendChild(analyse);
      resultsEl.appendChild(pcard);
      return;
    }
  }

  // No embedded preview - metadata only.
  resultsEl.appendChild(el('div', { class: 'anr-info' },
    'This iWork file was saved without an embedded preview, so only its metadata can be shown. The document body is stored in Apple’s undocumented .iwa format, which cannot be rendered in the browser.'));
  resultsEl.appendChild(integrityCard(file));
}
