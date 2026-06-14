/* Analyser - shared "Embedded images" card.
   Several still-image formats pack more than one picture into a single file (an
   icon's size ladder, an MPO stereo pair, a multi-page TIFF), but the browser only
   ever paints one. The per-format extractors (ico.js, the MPF/TIFF helpers) each
   produce a list of items and hand them here to be laid out identically: every
   image on a transparency checkerboard, largest/first in order, with its size,
   format and byte count, and a per-image download. Pure DOM; no decoding here. */

import { el, fmtBytes } from '../core/util.js';

// items: [{
//   width?, height?,        // shown if known; otherwise filled from the loaded <img>
//   label,                  // format/tech label, e.g. 'PNG', '32-bit BMP', 'JPEG'
//   bytes?,                 // source byte size for the hint line
//   viewBlob,               // a Blob the browser CAN render (img src)
//   downloadBlob?,          // ready-to-save Blob; if absent the rendered <img> is
//                           // rasterised to PNG on demand
//   downloadName,           // file name for the download
// }]
export function buildEmbeddedImagesCard({ title, hint, items, signal }) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, title || 'Embedded images'));
  if (hint) card.appendChild(el('p', { class: 'anr-hint' }, hint));

  const grid = el('div', {
    style: 'display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:14px; margin-top:6px;',
  });

  for (const it of items) {
    const url = URL.createObjectURL(it.viewBlob);
    if (signal) signal.addEventListener('abort', () => { try { URL.revokeObjectURL(url); } catch (_) {} });

    const imgEl = el('img', {
      src: url, alt: (it.width && it.height) ? it.width + '×' + it.height : (it.label || 'image'), loading: 'lazy',
      style: 'image-rendering:pixelated; max-width:100%; max-height:160px; display:block; margin:0 auto;',
    });
    const stage = el('div', {
      style: 'display:flex; align-items:center; justify-content:center; min-height:110px; padding:8px; border:1px solid var(--hairline); ' +
        'background:repeating-conic-gradient(#7a7a7a 0% 25%, #9a9a9a 0% 50%) 50% / 16px 16px;',
    }, [imgEl]);

    const dimEl = el('div', { style: 'font-weight:600;' },
      (it.width && it.height) ? it.width + ' × ' + it.height + ' px' : 'image');
    // Fill the dimension line from the decoded image when the extractor didn't
    // know it up front (e.g. MPO entries we didn't parse a SOF from).
    if (!(it.width && it.height)) {
      imgEl.addEventListener('load', () => {
        if (imgEl.naturalWidth) dimEl.textContent = imgEl.naturalWidth + ' × ' + imgEl.naturalHeight + ' px';
      }, { once: true });
    }

    const dl = el('a', {
      class: 'anr-btn', download: it.downloadName || 'image.png',
      style: 'display:inline-block; text-decoration:none; margin-top:8px; font-size:12px; padding:4px 8px;',
    }, 'Download');
    if (it.downloadBlob) {
      dl.href = URL.createObjectURL(it.downloadBlob);
      if (signal) signal.addEventListener('abort', () => { try { URL.revokeObjectURL(dl.href); } catch (_) {} });
    } else {
      // Rasterise the rendered image to PNG on first click (covers entries whose
      // native bytes aren't directly saveable, e.g. BMP-in-ICO).
      dl.href = '#';
      dl.addEventListener('click', (ev) => {
        if (dl.dataset.ready) return;
        ev.preventDefault();
        try {
          const cv = document.createElement('canvas');
          cv.width = imgEl.naturalWidth || it.width || 0;
          cv.height = imgEl.naturalHeight || it.height || 0;
          if (!cv.width || !cv.height) return;
          cv.getContext('2d').drawImage(imgEl, 0, 0, cv.width, cv.height);
          cv.toBlob((b) => {
            if (!b) return;
            dl.href = URL.createObjectURL(b);
            dl.dataset.ready = '1';
            if (signal) signal.addEventListener('abort', () => { try { URL.revokeObjectURL(dl.href); } catch (_) {} });
            dl.click();
          }, 'image/png');
        } catch (_) { /* tainted/failed - leave the link inert */ }
      });
    }

    const meta = el('div', { style: 'font-size:12px; line-height:1.5; margin-top:6px; text-align:center;' }, [
      dimEl,
      el('div', { class: 'anr-hint' }, (it.label || '') + (it.bytes ? (it.label ? ' · ' : '') + fmtBytes(it.bytes) : '')),
    ]);

    grid.appendChild(el('div', {}, [stage, meta, el('div', { style: 'text-align:center;' }, [dl])]));
  }

  card.appendChild(grid);
  return card;
}
