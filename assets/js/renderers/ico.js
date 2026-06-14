/* Analyser - ICO / CUR container: extract every embedded image.
   An .ico (or .cur) packs several pictures at different sizes and colour depths,
   but the browser only ever paints ONE of them in an <img>. This reads the icon
   directory and, for each entry, rebuilds a minimal single-image icon blob so the
   browser decodes that exact entry - PNG-compressed and classic BMP/DIB entries
   alike, transparency included - then hands them to the shared embedded-images
   card. Pure parsing + DOM; no WASM, instant and offline. */

import { buildEmbeddedImagesCard } from './embedded-images.js';

// Parse the icon directory into per-image entries. Returns
// { type /* 1 icon, 2 cursor */, entries:[{ w, h, bitCount, colorCount, planes,
// bytesInRes, imageOffset, isPng, blob /* 1-entry .ico */, png /* Blob|null */ }] }
// or null if the bytes aren't a valid ICO/CUR.
export function parseIcoEntries(buf) {
  if (!buf || buf.byteLength < 6) return null;
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const reserved = dv.getUint16(0, true);
  const type = dv.getUint16(2, true);          // 1 = icon, 2 = cursor
  const count = dv.getUint16(4, true);
  if (reserved !== 0 || (type !== 1 && type !== 2) || count === 0 || count > 2000) return null;
  if (buf.byteLength < 6 + count * 16) return null;

  const entries = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    let w = bytes[o], h = bytes[o + 1];
    if (w === 0) w = 256;                        // 0 in the directory means 256
    if (h === 0) h = 256;
    const colorCount = bytes[o + 2];
    const planes = dv.getUint16(o + 4, true);
    const bitCount = dv.getUint16(o + 6, true);
    const bytesInRes = dv.getUint32(o + 8, true);
    const imageOffset = dv.getUint32(o + 12, true);
    if (!bytesInRes || imageOffset + bytesInRes > buf.byteLength) continue;

    const data = bytes.subarray(imageOffset, imageOffset + bytesInRes);
    const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47;

    // Rebuild a standalone single-image ICON file (type 1) wrapping just this
    // entry's payload, so the browser's native icon decoder paints exactly it.
    const out = new Uint8Array(6 + 16 + data.length);
    const odv = new DataView(out.buffer);
    odv.setUint16(0, 0, true);
    odv.setUint16(2, 1, true);                   // always type 1 (icon) for display
    odv.setUint16(4, 1, true);                   // one entry
    out[6] = w >= 256 ? 0 : w;
    out[7] = h >= 256 ? 0 : h;
    out[8] = colorCount;
    out[9] = 0;
    odv.setUint16(10, planes || 1, true);
    odv.setUint16(12, isPng ? (bitCount || 32) : bitCount, true);
    odv.setUint32(14, data.length, true);
    odv.setUint32(18, 22, true);                 // payload right after the 22-byte head
    out.set(data, 22);

    entries.push({
      w, h, colorCount, planes, bitCount, bytesInRes, imageOffset, isPng,
      blob: new Blob([out], { type: 'image/x-icon' }),
      png: isPng ? new Blob([data.slice()], { type: 'image/png' }) : null,
    });
  }
  return entries.length ? { type, entries } : null;
}

// Build the "Embedded images" card for an ICO/CUR, or null if not one.
export async function buildIcoImagesCard(file, signal) {
  let parsed = null;
  try { parsed = parseIcoEntries(await file.arrayBuffer()); } catch (_) { parsed = null; }
  if (!parsed) return null;
  const { type, entries } = parsed;
  const baseName = (file.name || 'icon').replace(/\.[^/.]+$/, '');

  // Largest first - the order people usually want to see.
  const sorted = entries.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const items = sorted.map((e) => ({
    width: e.w, height: e.h,
    label: e.isPng ? 'PNG' : (e.bitCount ? e.bitCount + '-bit BMP' : 'BMP'),
    bytes: e.bytesInRes,
    viewBlob: e.blob,                            // 1-entry icon - renders PNG or BMP entries
    downloadBlob: e.png || null,                 // PNG entries save as-is; BMP -> canvas PNG
    downloadName: baseName + '_' + e.w + 'x' + e.h + '.png',
  }));

  return buildEmbeddedImagesCard({
    title: 'Embedded images',
    hint: entries.length + ' image' + (entries.length === 1 ? '' : 's') + ' packed in this ' +
      (type === 2 ? 'cursor' : 'icon') + ' - each at its own size and colour depth. The browser only displays one; here is every one.',
    items, signal,
  });
}
