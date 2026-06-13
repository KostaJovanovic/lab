/* Analyser - GIF frame decoder
   A browser plays an animated GIF in an <img>, but won't let you step through it
   frame by frame. So - exactly like the AVI viewer does for MJPEG - we decode the
   GIF ourselves: parse the blocks, LZW-decompress each image, and composite it
   onto a persistent canvas honouring the per-frame disposal method, transparency
   and interlacing. Returns one fully-composited RGBA snapshot per frame, plus its
   own delay, so photo.js can build a real transport (play / scrub / Prev / Next).
   Pure logic - no DOM, no cross-module dependencies. */

// GIF LZW decompressor (the standard prefix/suffix/stack variant). Decodes the
// concatenated image sub-blocks `data` into `output` (palette indices), filling
// exactly `npix` pixels. Adapted from the well-known omggif algorithm.
function lzwDecode(minCodeSize, data, output, npix) {
  const MAX = 4096;
  const nullCode = -1;
  const prefix = new Int16Array(MAX);
  const suffix = new Int16Array(MAX);
  const pixelStack = new Uint8Array(MAX + 1);

  const dataSize = minCodeSize;
  const clear = 1 << dataSize;
  const eoi = clear + 1;
  let available = clear + 2;
  let oldCode = nullCode;
  let codeSize = dataSize + 1;
  let codeMask = (1 << codeSize) - 1;
  for (let code = 0; code < clear; code++) { prefix[code] = 0; suffix[code] = code; }

  let datum = 0, bits = 0, first = 0, top = 0, bi = 0, pi = 0, i = 0;
  for (i = 0; i < npix;) {
    if (top === 0) {
      if (bits < codeSize) {
        if (bi >= data.length) break;
        datum += data[bi] << bits;
        bits += 8;
        bi++;
        continue;
      }
      let code = datum & codeMask;
      datum >>= codeSize;
      bits -= codeSize;
      if (code > available || code === eoi) break;
      if (code === clear) {
        codeSize = dataSize + 1;
        codeMask = (1 << codeSize) - 1;
        available = clear + 2;
        oldCode = nullCode;
        continue;
      }
      if (oldCode === nullCode) {
        pixelStack[top++] = suffix[code];
        oldCode = code;
        first = code;
        continue;
      }
      const inCode = code;
      if (code === available) { pixelStack[top++] = first; code = oldCode; }
      while (code > clear) { pixelStack[top++] = suffix[code]; code = prefix[code]; }
      first = suffix[code] & 0xff;
      pixelStack[top++] = first;
      if (available < MAX) {
        prefix[available] = oldCode;
        suffix[available] = first;
        available++;
        if ((available & codeMask) === 0 && available < MAX) {
          codeSize++;
          codeMask += available;
        }
      }
      oldCode = inCode;
    }
    top--;
    output[pi++] = pixelStack[top];
    i++;
  }
  for (; pi < npix; pi++) output[pi] = 0;
}

function readPalette(bytes, off, count) {
  const pal = new Array(count);
  for (let i = 0; i < count; i++) { const o = off + i * 3; pal[i] = [bytes[o], bytes[o + 1], bytes[o + 2]]; }
  return pal;
}

// Storage-order -> actual-row map for the four GIF interlace passes.
function interlaceRows(ih) {
  const rows = new Int32Array(ih);
  let n = 0;
  for (let y = 0; y < ih; y += 8) rows[n++] = y;
  for (let y = 4; y < ih; y += 8) rows[n++] = y;
  for (let y = 2; y < ih; y += 4) rows[n++] = y;
  for (let y = 1; y < ih; y += 2) rows[n++] = y;
  return rows;
}

// Composite one decoded sub-image (palette indices) onto the persistent RGBA
// canvas at (ix,iy), skipping the transparent index and clipping to bounds.
function drawFrame(canvas, W, H, indices, palette, ix, iy, iw, ih, interlace, transIdx) {
  const rows = interlace ? interlaceRows(ih) : null;
  for (let r = 0; r < ih; r++) {
    const y = iy + (interlace ? rows[r] : r);
    if (y < 0 || y >= H) continue;
    const rowBase = r * iw;
    for (let c = 0; c < iw; c++) {
      const x = ix + c;
      if (x < 0 || x >= W) continue;
      const idx = indices[rowBase + c];
      if (idx === transIdx) continue;
      const p = palette[idx];
      if (!p) continue;
      const o = (y * W + x) * 4;
      canvas[o] = p[0]; canvas[o + 1] = p[1]; canvas[o + 2] = p[2]; canvas[o + 3] = 255;
    }
  }
}

// Clear a rectangle back to fully-transparent (disposal method 2).
function clearRect(canvas, W, H, ix, iy, iw, ih) {
  for (let y = iy; y < iy + ih; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = ix; x < ix + iw; x++) {
      if (x < 0 || x >= W) continue;
      const o = (y * W + x) * 4;
      canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0;
    }
  }
}

// Decode every frame of an animated GIF into composited RGBA snapshots.
// Returns { width, height, frames:[{data:Uint8ClampedArray, delay /*cs*/}],
// loop, anyTransparency, truncated } or null if the bytes aren't a GIF.
// `maxPixels` caps total decoded pixels (width*height*frames) so a pathological
// GIF can't exhaust memory; frames past the cap are dropped (truncated=true).
export function decodeGifFrames(buffer, maxPixels = 120e6) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
  const dv = new DataView(buffer);
  const width = dv.getUint16(6, true);
  const height = dv.getUint16(8, true);
  if (!width || !height) return null;

  const packed = bytes[10];
  const gctSize = (packed & 0x80) ? (2 << (packed & 0x07)) : 0;
  let pos = 13;
  let gct = null;
  if (gctSize) { gct = readPalette(bytes, pos, gctSize); pos += gctSize * 3; }

  const frames = [];
  let canvas = new Uint8ClampedArray(width * height * 4);   // starts fully transparent
  let gce = { delay: 0, transparentIndex: -1, disposal: 0 };
  let loop = null;
  let anyTransparency = false;
  let truncated = false;
  const maxFrames = Math.max(1, Math.floor(maxPixels / (width * height)));

  while (pos < bytes.length) {
    const b = bytes[pos];
    if (b === 0x3B) break;                                  // trailer
    if (b === 0x21) {                                       // extension
      const label = bytes[pos + 1];
      if (label === 0xF9) {                                 // graphic control
        const p = bytes[pos + 3];
        gce.disposal = (p >> 2) & 0x07;
        gce.delay = dv.getUint16(pos + 4, true);            // centiseconds
        gce.transparentIndex = (p & 0x01) ? bytes[pos + 6] : -1;
        pos += 8;
      } else {
        if (label === 0xFF && pos + 16 <= bytes.length
            && String.fromCharCode(bytes[pos + 3], bytes[pos + 4], bytes[pos + 5], bytes[pos + 6],
              bytes[pos + 7], bytes[pos + 8], bytes[pos + 9], bytes[pos + 10]) === 'NETSCAPE') {
          loop = dv.getUint16(pos + 16, true);
        }
        pos += 2;
        while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
        pos++;
      }
      continue;
    }
    if (b === 0x2C) {                                       // image descriptor
      const ix = dv.getUint16(pos + 1, true);
      const iy = dv.getUint16(pos + 3, true);
      const iw = dv.getUint16(pos + 5, true);
      const ih = dv.getUint16(pos + 7, true);
      const ip = bytes[pos + 9];
      const interlace = (ip & 0x40) !== 0;
      const lctSize = (ip & 0x80) ? (2 << (ip & 0x07)) : 0;
      pos += 10;
      let palette = gct;
      if (lctSize) { palette = readPalette(bytes, pos, lctSize); pos += lctSize * 3; }
      if (!palette) palette = [];

      const minCodeSize = bytes[pos]; pos++;
      // Concatenate the LZW data sub-blocks.
      let dataLen = 0, scan = pos;
      while (scan < bytes.length && bytes[scan] !== 0) { dataLen += bytes[scan]; scan += bytes[scan] + 1; }
      const lzwData = new Uint8Array(dataLen);
      let dpos = 0; scan = pos;
      while (scan < bytes.length && bytes[scan] !== 0) {
        const n = bytes[scan]; scan++;
        lzwData.set(bytes.subarray(scan, scan + n), dpos);
        dpos += n; scan += n;
      }
      pos = scan + 1;                                       // skip block terminator

      if (frames.length >= maxFrames) { truncated = true; break; }

      const indices = new Uint8Array(iw * ih);
      lzwDecode(minCodeSize, lzwData, indices, iw * ih);

      // disposal 3 ("restore to previous") needs the canvas as it was before this
      // frame was painted, to roll back to once the frame has been shown.
      const before = gce.disposal === 3 ? canvas.slice() : null;

      drawFrame(canvas, width, height, indices, palette, ix, iy, iw, ih, interlace, gce.transparentIndex);
      frames.push({ data: new Uint8ClampedArray(canvas), delay: gce.delay });
      if (gce.transparentIndex >= 0) anyTransparency = true;

      // Apply this frame's disposal so the NEXT frame starts from the right canvas.
      if (gce.disposal === 2) clearRect(canvas, width, height, ix, iy, iw, ih);
      else if (gce.disposal === 3 && before) canvas = before;

      gce = { delay: 0, transparentIndex: -1, disposal: 0 };
      continue;
    }
    pos++;                                                  // unknown byte - skip
  }

  if (!frames.length) return null;
  return { width, height, frames, loop, anyTransparency, truncated };
}
