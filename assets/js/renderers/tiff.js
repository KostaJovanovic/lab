/* Analyser - multi-page TIFF extractor.
   A TIFF is a directory of images (IFDs): scanners, faxes and document tools often
   pack many pages into one .tif. Browsers can't decode TIFF at all, so we first
   walk the IFD chain in pure JS (cheap, no decode) just to learn the page count and
   each page's size; only when there really are 2+ pages do we spin up ImageMagick
   to render them all to PNG for the shared embedded-images card. */

import { buildEmbeddedImagesCard } from './embedded-images.js';
import { readImagesAsPngs } from './photo-convert.js';

// Walk the TIFF IFD chain. Returns [{ w, h }, ...] (one per page) or null if the
// bytes aren't a classic TIFF. Dimensions are best-effort (0 if not inline).
export function tiffPages(buf) {
  if (!buf || buf.byteLength < 8) return null;
  const dv = new DataView(buf);
  const bo = dv.getUint16(0, false);
  let le;
  if (bo === 0x4949) le = true; else if (bo === 0x4D4D) le = false; else return null;
  const magic = dv.getUint16(2, le);
  if (magic !== 0x002A) return null;             // 0x002B = BigTIFF, not walked here
  const n = buf.byteLength;

  const sizeOf = (type) => (type === 3 ? 2 : type === 4 || type === 13 ? 4 : type === 1 || type === 2 || type === 6 || type === 7 ? 1 : 0);
  const readVal = (pos, type) => (type === 3 ? dv.getUint16(pos, le) : dv.getUint32(pos, le));

  const pages = [];
  let ifd = dv.getUint32(4, le);
  const seen = new Set();
  while (ifd && ifd + 2 <= n && !seen.has(ifd) && pages.length < 4096) {
    seen.add(ifd);
    const count = dv.getUint16(ifd, le);
    const base = ifd + 2;
    if (base + count * 12 + 4 > n) break;
    let w = 0, h = 0;
    for (let i = 0; i < count; i++) {
      const e = base + i * 12;
      const tag = dv.getUint16(e, le);
      if (tag !== 256 && tag !== 257) continue;  // ImageWidth / ImageLength
      const type = dv.getUint16(e + 2, le);
      if (!sizeOf(type)) continue;
      const v = readVal(e + 8, type);
      if (tag === 256) w = v; else h = v;
    }
    pages.push({ w, h });
    ifd = dv.getUint32(base + count * 12, le);
  }
  return pages.length ? pages : null;
}

// Build the "Embedded images" card for a multi-page TIFF, or null if it's a single
// page (or not a walkable TIFF). Decodes via ImageMagick only when worthwhile.
export async function buildTiffPagesCard(file, signal, container) {
  let pages = null;
  try { pages = tiffPages(await file.arrayBuffer()); } catch (_) { pages = null; }
  if (!pages || pages.length < 2) return null;   // single-page TIFF: nothing extra to show

  const baseName = (file.name || 'document').replace(/\.[^/.]+$/, '');
  const rendered = await readImagesAsPngs(file, container);
  if (signal && signal.aborted) return null;
  if (!rendered.length) return null;

  const items = rendered.map((r, i) => ({
    width: r.width || (pages[i] && pages[i].w) || 0,
    height: r.height || (pages[i] && pages[i].h) || 0,
    label: 'Page ' + (i + 1),
    bytes: r.blob.size,
    viewBlob: r.blob,
    downloadBlob: r.blob,
    downloadName: baseName + '_page' + (i + 1) + '.png',
  }));

  return buildEmbeddedImagesCard({
    title: 'Pages',
    hint: rendered.length + ' pages in this TIFF, decoded to PNG. Browsers can’t display TIFF, so each page is rendered here.',
    items, signal,
  });
}
