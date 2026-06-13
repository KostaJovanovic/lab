/* Analyser - minimal animated-GIF encoder
   The reverse feature plays an animated GIF / WebP backwards using the frames we
   already decoded (full-canvas composited RGBA), and lets you download the result.
   Re-encoding those frames needs a GIF writer, which the app didn't have - this is
   a compact one: per-frame median-cut quantisation to a 256-colour local palette
   (1-bit transparency where the frame has alpha) and a standard GIF-variant LZW
   coder whose output the decoder in gif-frames.js reads back. Pure logic, no DOM. */

// Pick the channel (0=r,1=g,2=b) with the widest spread in a box of {r,g,b,count}.
function widestChannel(box) {
  let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
  for (const c of box) {
    if (c.r < rmin) rmin = c.r; if (c.r > rmax) rmax = c.r;
    if (c.g < gmin) gmin = c.g; if (c.g > gmax) gmax = c.g;
    if (c.b < bmin) bmin = c.b; if (c.b > bmax) bmax = c.b;
  }
  const dr = rmax - rmin, dg = gmax - gmin, db = bmax - bmin;
  const m = Math.max(dr, dg, db);
  return { channel: m === dr ? 'r' : m === dg ? 'g' : 'b', range: m };
}

// Median-cut a list of unique colours (with counts) down to `target` buckets,
// returning their count-weighted average colours as [[r,g,b],...].
function medianCut(colors, target) {
  let boxes = [colors];
  while (boxes.length < target) {
    let bi = -1, best = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const r = widestChannel(boxes[i]).range;
      if (r > best) { best = r; bi = i; }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    const ch = widestChannel(box).channel;
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0, t = 0;
    for (const c of box) { r += c.r * c.count; g += c.g * c.count; b += c.b * c.count; t += c.count; }
    return t ? [Math.round(r / t), Math.round(g / t), Math.round(b / t)] : [0, 0, 0];
  });
}

// Quantise one RGBA frame to palette indices. Pixels with alpha < 128 map to a
// reserved transparent index. Returns { indices, palette, minCodeSize,
// transparentIndex } where palette is padded to the 2^minCodeSize colour table.
function quantizeFrame(data) {
  const n = data.length / 4;
  const hist = new Map();
  let hasAlpha = false;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) { hasAlpha = true; continue; }
    const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const uniq = [];
  for (const [key, count] of hist) uniq.push({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, count });
  const maxPal = hasAlpha ? 255 : 256;
  let palette = uniq.length <= maxPal ? uniq.map((c) => [c.r, c.g, c.b]) : medianCut(uniq, maxPal);
  if (!palette.length) palette = [[0, 0, 0]];

  const transparentIndex = hasAlpha ? palette.length : -1;
  const usedColors = palette.length + (hasAlpha ? 1 : 0);
  let minCodeSize = 2;
  while ((1 << minCodeSize) < usedColors) minCodeSize++;
  const tableSize = 1 << minCodeSize;

  // Map every opaque pixel to its nearest palette colour, cached by packed RGB.
  const cache = new Map();
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128 && hasAlpha) { indices[i] = transparentIndex; continue; }
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      let bestD = Infinity, bestI = 0;
      for (let p = 0; p < palette.length; p++) {
        const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; bestI = p; if (d === 0) break; }
      }
      idx = bestI; cache.set(key, idx);
    }
    indices[i] = idx;
  }

  // Pad the colour table to the full 2^minCodeSize entries.
  const table = [];
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] || [0, 0, 0];
    table.push(c[0], c[1], c[2]);
  }
  return { indices, table, minCodeSize, transparentIndex };
}

// GIF-variant LZW: encode palette indices into packed byte codes. Mirrors the
// decoder in gif-frames.js (code size grows when the dictionary reaches a power of
// two; a clear code resets it at 4096). Returns an array of bytes.
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = new Map();
  let next = clearCode + 2;
  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 0xff); cur >>>= 8; curBits -= 8; }
  };
  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      dict = new Map(); next = clearCode + 2; codeSize = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (curBits > 0) out.push(cur & 0xff);
  return out;
}

// Encode an animated GIF from composited RGBA frames. `frames` is an array of
// Uint8ClampedArray (width*height*4); `delaysCs` the per-frame delay in
// centiseconds; `loop` the loop count (0 = infinite). Returns an image/gif Blob.
export function encodeAnimatedGif(width, height, frames, delaysCs, loop) {
  const bytes = [];
  const u16 = (v) => { bytes.push(v & 0xff, (v >> 8) & 0xff); };
  const str = (s) => { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); };

  str('GIF89a');
  u16(width); u16(height);
  bytes.push(0x70, 0x00, 0x00);                 // packed (no global table), bg, aspect

  // NETSCAPE2.0 looping extension.
  bytes.push(0x21, 0xFF, 0x0B);
  str('NETSCAPE2.0');
  bytes.push(0x03, 0x01); u16(loop || 0); bytes.push(0x00);

  for (let f = 0; f < frames.length; f++) {
    const { indices, table, minCodeSize, transparentIndex } = quantizeFrame(frames[f]);
    const hasTrans = transparentIndex >= 0;

    // Graphic control extension (delay + transparency + disposal).
    bytes.push(0x21, 0xF9, 0x04);
    bytes.push((hasTrans ? 2 << 2 : 1 << 2) | (hasTrans ? 0x01 : 0x00));   // disposal + transparent flag
    u16(Math.max(0, delaysCs[f] | 0));
    bytes.push(hasTrans ? transparentIndex : 0, 0x00);

    // Image descriptor + local colour table.
    bytes.push(0x2C); u16(0); u16(0); u16(width); u16(height);
    bytes.push(0x80 | (minCodeSize - 1));        // local table flag + size
    for (let i = 0; i < table.length; i++) bytes.push(table[i]);

    // LZW image data, split into <=255-byte sub-blocks.
    bytes.push(minCodeSize);
    const lzw = lzwEncode(indices, minCodeSize);
    for (let p = 0; p < lzw.length; p += 255) {
      const chunk = lzw.slice(p, p + 255);
      bytes.push(chunk.length);
      for (let q = 0; q < chunk.length; q++) bytes.push(chunk[q]);
    }
    bytes.push(0x00);                            // block terminator
  }

  bytes.push(0x3B);                              // trailer
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}
