/* Analyser - photo format conversion
   Browsers can't decode HEIC/HEIF or camera RAW directly, so before the photo
   module analyses them we convert to JPEG: heic2any for HEIC, an embedded-JPEG
   scan for RAW (fast, no decode), and ImageMagick-WASM as the heavyweight RAW
   fallback. Each loads its library lazily so a normal JPEG/PNG never pays for
   them. Used by photo.js (renderPhoto). */

import { el, loadScript } from '../core/util.js';

const HEIC2ANY_URL    = 'assets/vendor/heic2any.min.js';
const MAGICK_WASM_URL = new URL('../../vendor/imagemagick/index.mjs', import.meta.url).href;
const MAGICK_WASM_DIR = 'assets/vendor/imagemagick/';
const LIBRAW_URL      = new URL('../../vendor/libraw/index.js', import.meta.url).href;

// Fetch with a 0..1 progress callback driven by Content-Length. Falls back to a
// plain arrayBuffer read when the length/stream isn't available.
async function fetchWithProgress(url, onProgress) {
  const resp = await fetch(url);
  const total = parseInt(resp.headers.get('content-length') || '0', 10);
  if (!total || !resp.body) return new Uint8Array(await resp.arrayBuffer());
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) onProgress(loaded / total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// HEIC/HEIF -> JPEG via heic2any.
export async function convertHeic(file) {
  await loadScript(HEIC2ANY_URL);
  const blob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const out = Array.isArray(blob) ? blob[0] : blob;
  return new File([out], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
}

// Sigma/Polaroid Foveon X3F preview extractor. X3F isn't TIFF (so the IFD walk
// finds nothing) and its raw sensor block is riddled with stray FFD8/FFD9 pairs
// that defeat the byte-scan preview - yet the container embeds a real, full-size
// JPEG preview. We read it straight from the X3F directory instead of decoding
// the Foveon sensor (which needs the GPL2 demosaic pack this build omits): parse
// the SECd directory at EOF, find the image (IMA2) sections whose format is 18
// (JPEG), and return the highest-resolution one. The preview carries EXIF too, so
// exifr still works. Throws if the file isn't X3F or has no JPEG preview.
export async function extractX3fPreview(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const len = buf.length;
  const tag = (o) => (o + 4 <= len ? String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]) : '');
  if (tag(0) !== 'FOVb') throw new Error('Not an X3F file');
  if (len < 12) throw new Error('X3F too small');
  const dirOff = dv.getUint32(len - 4, true);   // last 4 bytes point at the SECd directory
  if (dirOff + 12 > len || tag(dirOff) !== 'SECd') throw new Error('X3F directory not found');
  const count = dv.getUint32(dirOff + 8, true);
  const cands = [];
  let p = dirOff + 12;
  for (let i = 0; i < count && p + 12 <= len; i++, p += 12) {
    const off = dv.getUint32(p, true);
    const elen = dv.getUint32(p + 4, true);
    const etype = tag(p + 8);
    if ((etype !== 'IMA2' && etype !== 'IMAG') || off + 28 > len || tag(off) !== 'SECi') continue;
    const fmt = dv.getUint32(off + 12, true);
    if (fmt !== 18) continue;                    // 18 = embedded JPEG (3/11 = non-JPEG, skipped)
    const cols = dv.getUint32(off + 16, true), rows = dv.getUint32(off + 20, true);
    const start = off + 28, end = Math.min(off + elen, len);
    if (start >= end || buf[start] !== 0xFF || buf[start + 1] !== 0xD8) continue;   // must be a real SOI
    cands.push({ start, end, px: cols * rows });
  }
  if (!cands.length) throw new Error('No embedded JPEG preview in X3F');
  cands.sort((a, b) => b.px - a.px);             // largest resolution wins
  const best = cands[0];
  return new File([buf.slice(best.start, best.end)], file.name.replace(/\.[^.]+$/, '_preview.jpg'), { type: 'image/jpeg' });
}

// Pull the largest embedded JPEG preview out of a RAW file by scanning for
// SOI/EOI (FFD8..FFD9) markers - most RAWs ship a full-size JPEG preview, so
// this avoids a full RAW decode. Throws if none is found.
//
// Raw Bayer sensor data contains stray FFD8/FFD9 byte pairs, so a blind
// "largest FFD8..FFD9 span wins" scan can pick a multi-megabyte chunk of noise
// over the genuine preview (seen on Sony FX30 ARWs). Guard against that by
// requiring a real SOI: a genuine JPEG always follows FFD8 with another marker
// (FF Cx/Dx/Ex...), i.e. byte[i+2] === 0xFF. Stray matches in sensor data
// almost never satisfy that, so they're skipped.
export async function extractRawPreview(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const jpegs = [];
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xFF && buf[i + 1] === 0xD8 && buf[i + 2] === 0xFF) {
      for (let j = i + 2; j < buf.length - 1; j++) {
        if (buf[j] === 0xFF && buf[j + 1] === 0xD9) {
          jpegs.push({ offset: i, length: j + 2 - i });
          i = j + 1;
          break;
        }
      }
    }
  }
  if (jpegs.length === 0) throw new Error('No embedded JPEG found');
  jpegs.sort((a, b) => b.length - a.length);
  const best = jpegs[0];
  const jpegData = buf.slice(best.offset, best.offset + best.length);
  return new File([jpegData], file.name.replace(/\.[^.]+$/, '_preview.jpg'), { type: 'image/jpeg' });
}

// Pull every JPEG a RAW file embeds - the small thumbnail the camera shows on its
// screen plus one or more larger previews. We read the TIFF IFD chain the way a
// real RAW tool does, not by scanning bytes for FFD8/FFD9: stray SOI markers in
// raw sensor data make a blind scan merge or mislocate images. Each IFD that
// carries a JPEGInterchangeFormat (0x0201) + length (0x0202) pair points at one
// embedded JPEG; we follow the IFD0->IFD1 chain (thumbnail) and recurse into
// SubIFDs (0x014A, where DNG and others keep previews). Returns
// [{ offset, length, blob }], largest first. RAW/TIFF only (CR3 etc. aren't TIFF).
export async function extractRawJpegs(file, { max = 12 } = {}) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  const buf = u8.buffer, dv = new DataView(buf), len = u8.length;
  if (len < 8) return [];
  // TIFF base: 0 for RAW (II/MM), or just past "Exif\0\0" if handed a JPEG.
  let base = -1;
  const b0 = dv.getUint16(0, false);
  if (b0 === 0x4949 || b0 === 0x4D4D) base = 0;
  else if (b0 === 0xFFD8) {
    let p = 2;
    while (p + 4 <= len) {
      if (dv.getUint8(p) !== 0xFF) break;
      const m = dv.getUint8(p + 1);
      if (m === 0xDA || m === 0xD9) break;
      const sl = dv.getUint16(p + 2, false);
      if (sl < 2) break;
      if (m === 0xE1 && p + 10 <= len && dv.getUint32(p + 4, false) === 0x45786966 && dv.getUint16(p + 8, false) === 0) { base = p + 10; break; }
      p += 2 + sl;
    }
  }
  if (base < 0 || base + 8 > len) return [];
  const le = dv.getUint16(base, false) === 0x4949;
  const u16 = (o) => (o >= 0 && o + 2 <= len ? dv.getUint16(o, le) : -1);
  const u32 = (o) => (o >= 0 && o + 4 <= len ? dv.getUint32(o, le) : -1);
  if (u16(base + 2) !== 42) return [];
  const TS = { 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8 };
  const visited = new Set(), queue = [base + u32(base + 4)], res = [];
  while (queue.length && res.length < 64) {
    const ifd = queue.shift();
    if (ifd <= 0 || ifd + 2 > len || visited.has(ifd)) continue;
    visited.add(ifd);
    const n = u16(ifd);
    if (n < 0 || n > 4096) continue;
    const tags = {};
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > len) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = (TS[type] || 1) * count;
      tags[tag] = { count, size, valOff: size <= 4 ? e + 8 : base + u32(e + 8) };
    }
    if (tags[0x0201] && tags[0x0202]) {
      const s = base + u32(tags[0x0201].valOff), l = u32(tags[0x0202].valOff);
      if (s > 0 && l > 0 && s + l <= len && dv.getUint8(s) === 0xFF && dv.getUint8(s + 1) === 0xD8) res.push({ offset: s, length: l });
    }
    const sub = tags[0x014A];
    if (sub) for (let i = 0; i < sub.count; i++) { const o = u32(sub.size <= 4 ? sub.valOff : sub.valOff + i * 4); if (o) queue.push(base + o); }
    const nx = u32(ifd + 2 + n * 12);
    if (nx) queue.push(base + nx);
  }
  const seen = new Set();
  return res
    .filter((r) => !seen.has(r.offset) && seen.add(r.offset))
    .sort((a, c) => c.length - a.length)
    .slice(0, max)
    .map((r) => ({ offset: r.offset, length: r.length, blob: new Blob([u8.slice(r.offset, r.offset + r.length)], { type: 'image/jpeg' }) }));
}

let magickReady = null;

// Full RAW -> JPEG decode via ImageMagick-WASM (~15 MB, loaded once). Renders an
// ASCII progress bar into `container` while the wasm downloads/initialises.
export async function convertWithImageMagick(file, container) {
  const barEl = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const labelEl = el('div', { class: 'anr-progress-label' }, 'loading imagemagick (~15 mb)');
  const wrap = el('div', { class: 'anr-progress' }, [barEl, labelEl]);
  if (container) container.appendChild(wrap);

  function setBar(frac) {
    const ch = parseFloat(getComputedStyle(barEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((barEl.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    barEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }

  if (!magickReady) {
    setBar(0);
    const mod = await import(MAGICK_WASM_URL);
    const wasmBytes = await fetchWithProgress(MAGICK_WASM_DIR + 'magick.wasm', (p) => setBar(p * 0.9));
    setBar(0.95);
    labelEl.textContent = 'initialising';
    await mod.initializeImageMagick(wasmBytes);
    magickReady = mod;
  }
  setBar(1);
  labelEl.textContent = 'converting raw';

  const { ImageMagick, MagickFormat } = magickReady;
  const data = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    try {
      ImageMagick.read(data, (image) => {
        image.quality = 92;
        image.write(MagickFormat.Jpeg, (jpegData) => {
          wrap.remove();
          const blob = new Blob([jpegData], { type: 'image/jpeg' });
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        });
      });
    } catch (e) {
      wrap.remove();
      reject(e);
    }
  });
}

// Decode EVERY frame/page of a multi-image file (multi-page TIFF, etc.) to PNG via
// ImageMagick-WASM. Returns [{ width, height, blob /* image/png */ }, ...] in file
// order, or [] on failure. Renders the same ASCII load bar into `container`.
export async function readImagesAsPngs(file, container) {
  const barEl = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const labelEl = el('div', { class: 'anr-progress-label' }, 'loading imagemagick');
  const wrap = el('div', { class: 'anr-progress' }, [barEl, labelEl]);
  if (container) container.appendChild(wrap);
  function setBar(frac) {
    const ch = parseFloat(getComputedStyle(barEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((barEl.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    barEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }
  try {
    if (!magickReady) {
      setBar(0);
      const mod = await import(MAGICK_WASM_URL);
      const wasmBytes = await fetchWithProgress(MAGICK_WASM_DIR + 'magick.wasm', (p) => setBar(p * 0.9));
      setBar(0.95); labelEl.textContent = 'initialising';
      await mod.initializeImageMagick(wasmBytes);
      magickReady = mod;
    }
    setBar(1); labelEl.textContent = 'decoding pages';
    const { ImageMagick, MagickFormat } = magickReady;
    const data = new Uint8Array(await file.arrayBuffer());
    const out = [];
    // The collection and its images are only valid inside this callback, so encode
    // every page to PNG (copying the bytes out) before it returns.
    ImageMagick.readCollection(data, (images) => {
      for (const image of images) {
        const width = image.width, height = image.height;
        image.write(MagickFormat.Png, (png) => {
          out.push({ width, height, blob: new Blob([png.slice()], { type: 'image/png' }) });
        });
      }
    });
    return out;
  } catch (_) {
    return [];
  } finally {
    wrap.remove();
  }
}

let librawMod = null;

// True RAW demosaic via libraw WASM (lazy-loaded, ~MBs). Unlike the embedded-JPEG
// extractor and the ImageMagick path - both of which can only surface a preview
// baked into the file - this reconstructs the image from the Bayer sensor data:
// libraw demosaics, white-balances and gamma-corrects it to an 8-bit (or 16-bit)
// RGB buffer, which we paint to a canvas and hand back as a full-resolution JPEG.
// Renders an ASCII progress bar into `container` while the decoder loads.
export async function demosaicRaw(file, container) {
  const barEl = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const labelEl = el('div', { class: 'anr-progress-label' }, 'loading raw decoder');
  const wrap = el('div', { class: 'anr-progress' }, [barEl, labelEl]);
  if (container) container.appendChild(wrap);

  function setBar(frac) {
    const ch = parseFloat(getComputedStyle(barEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((barEl.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    barEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }

  try {
    setBar(0.1);
    if (!librawMod) librawMod = await import(LIBRAW_URL);
    setBar(0.4);
    labelEl.textContent = 'decoding sensor data';

    const LibRaw = librawMod.default || librawMod.LibRaw || librawMod;
    const raw = new LibRaw();
    const bytes = new Uint8Array(await file.arrayBuffer());
    await raw.open(bytes, {});
    const img = await raw.imageData();           // { width, height, colors, bits, data }
    if (!img || !img.data || !img.width || !img.height) throw new Error('decoder returned no image');

    setBar(0.85);
    labelEl.textContent = 'building image';
    const { width, height, data } = img;
    const colors = img.colors || 3;
    const shift = (img.bits || 8) > 8 ? (img.bits - 8) : 0;   // 16-bit -> 8-bit

    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const ctx = cv.getContext('2d');
    const out = ctx.createImageData(width, height);
    const o = out.data;
    const px = width * height;
    for (let p = 0, q = 0, s = 0; p < px; p++, q += 4, s += colors) {
      const r = shift ? (data[s] >> shift) : data[s];
      const g = colors > 1 ? (shift ? (data[s + 1] >> shift) : data[s + 1]) : r;
      const b = colors > 2 ? (shift ? (data[s + 2] >> shift) : data[s + 2]) : r;
      o[q] = r; o[q + 1] = g; o[q + 2] = b; o[q + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    try { if (raw.close) await raw.close(); } catch (_) {}

    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.95));
    setBar(1);
    wrap.remove();
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
  } catch (e) {
    wrap.remove();
    throw e;
  }
}
