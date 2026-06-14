/* Analyser - MPO / Multi-Picture Format extractor.
   A single JPEG can carry several full-size images via the CIPA Multi-Picture
   Format (MPF): stereo 3D pairs (.mpo from 3D cameras, the Nintendo 3DS, Fujifilm
   W-series), multi-angle shots, and depth/disparity companions. They all live in
   one file, and the browser only paints the first. This reads the MPF index in the
   APP2 segment, slices out each embedded JPEG (which is a standalone image), and
   hands them to the shared embedded-images card. Pure parsing; no decode. */

import { buildEmbeddedImagesCard } from './embedded-images.js';

// Read width/height from a JPEG's SOF marker within [start,end). Returns
// { w, h } or null.
function jpegDims(bytes, start, end) {
  let p = start + 2;                              // skip SOI
  while (p + 4 < end) {
    if (bytes[p] !== 0xFF) { p++; continue; }
    let marker = bytes[p + 1];
    while (marker === 0xFF && p + 1 < end) { p++; marker = bytes[p + 1]; }   // skip fill
    p += 2;
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    if (p + 2 > end) break;
    const len = (bytes[p] << 8) | bytes[p + 1];
    // SOF0-3,5-7,9-11,13-15 carry the frame dimensions (skip DHT C4, JPG C8, DAC CC).
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (p + 7 > end) break;
      const h = (bytes[p + 3] << 8) | bytes[p + 4];
      const w = (bytes[p + 5] << 8) | bytes[p + 6];
      if (w && h) return { w, h };
      break;
    }
    p += len;                                      // advance past this segment
  }
  return null;
}

// Parse the MPF index. Returns an array of { offset, size } (file-absolute byte
// ranges of each embedded JPEG) with two or more entries, or null.
export function parseMpfEntries(buf) {
  const bytes = new Uint8Array(buf);
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;

  // Find the APP2 segment whose payload starts with "MPF\0".
  let p = 2, mpStart = -1;
  while (p + 4 <= n) {
    if (bytes[p] !== 0xFF) { p++; continue; }
    const marker = bytes[p + 1];
    if (marker === 0xD9 || marker === 0xDA) break; // EOI / start of scan - no MPF
    if (marker >= 0xD0 && marker <= 0xD7) { p += 2; continue; }
    if (p + 4 > n) break;
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    const segData = p + 4;
    if (marker === 0xE2 && segData + 4 <= n &&
        bytes[segData] === 0x4D && bytes[segData + 1] === 0x50 && bytes[segData + 2] === 0x46 && bytes[segData + 3] === 0x00) {
      mpStart = segData + 4;                        // first byte of the MP (TIFF) header
      break;
    }
    p += 2 + len;
  }
  if (mpStart < 0 || mpStart + 8 > n) return null;

  // MP header is a TIFF header: byte order, 0x002A, IFD0 offset (relative to it).
  const dv = new DataView(buf);
  const bo = dv.getUint16(mpStart, false);
  let le;
  if (bo === 0x4949) le = true; else if (bo === 0x4D4D) le = false; else return null;
  if (dv.getUint16(mpStart + 2, le) !== 0x002A) return null;
  const ifd0 = dv.getUint32(mpStart + 4, le);
  const ifdPos = mpStart + ifd0;
  if (ifdPos + 2 > n) return null;

  const count = dv.getUint16(ifdPos, le);
  let entryOffset = -1, numImages = 0;
  for (let i = 0; i < count; i++) {
    const e = ifdPos + 2 + i * 12;
    if (e + 12 > n) return null;
    const tag = dv.getUint16(e, le);
    const valCount = dv.getUint32(e + 4, le);
    if (tag === 0xB001) numImages = dv.getUint32(e + 8, le);          // NumberOfImages
    else if (tag === 0xB002) entryOffset = mpStart + dv.getUint32(e + 8, le); // MP Entry -> offset
    void valCount;
  }
  if (entryOffset < 0) return null;
  if (!numImages || numImages > 64) numImages = 0;                    // sanity / unknown

  const ranges = [];
  // Each MP Entry is 16 bytes. Stop at numImages if known, else read until the
  // value runs out of plausible space.
  const maxEntries = numImages || 64;
  for (let i = 0; i < maxEntries; i++) {
    const e = entryOffset + i * 16;
    if (e + 16 > n) break;
    const size = dv.getUint32(e + 4, le);
    const dataOff = dv.getUint32(e + 8, le);
    if (!size) { if (numImages) continue; else break; }
    // The first image's offset is 0 (start of file); others are relative to the
    // MP header. Bound-check and require a JPEG SOI at the target.
    const fileOff = dataOff === 0 ? 0 : mpStart + dataOff;
    if (fileOff < 0 || fileOff + size > n) { if (numImages) continue; else break; }
    if (!(bytes[fileOff] === 0xFF && bytes[fileOff + 1] === 0xD8)) { if (numImages) continue; else break; }
    ranges.push({ offset: fileOff, size });
  }
  return ranges.length >= 2 ? ranges : null;
}

// Build the "Embedded images" card for an MPO / multi-picture JPEG, or null.
export async function buildMpoImagesCard(file, signal) {
  let ranges = null, buf = null;
  try { buf = await file.arrayBuffer(); ranges = parseMpfEntries(buf); } catch (_) { ranges = null; }
  if (!ranges) return null;
  const bytes = new Uint8Array(buf);
  const baseName = (file.name || 'image').replace(/\.[^/.]+$/, '');

  const items = ranges.map((r, i) => {
    const slice = bytes.slice(r.offset, r.offset + r.size);
    const blob = new Blob([slice], { type: 'image/jpeg' });
    const dims = jpegDims(bytes, r.offset, r.offset + r.size);
    return {
      width: dims && dims.w, height: dims && dims.h,
      label: i === 0 ? 'JPEG (primary)' : 'JPEG',
      bytes: r.size,
      viewBlob: blob,
      downloadBlob: blob,
      downloadName: baseName + '_' + (i + 1) + '.jpg',
    };
  });

  return buildEmbeddedImagesCard({
    title: 'Embedded images',
    hint: ranges.length + ' images packed in this Multi-Picture (MPO) file - for example a stereo 3D pair or multi-angle set. The browser only displays the first; here is every one.',
    items, signal,
  });
}
