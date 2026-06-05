/* Analyser - lazy parser chunk: additional still-image formats.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'image'` is opened. Each entry in PARSERS is
   `({head, file, ext}) => rows` where `rows` is a plain object of label->value
   pairs (rendered as a readout), optionally carrying
   `_sections: [{title, node, open?}]` for collapsible blocks and `_previewNode`
   (a DOM Node, e.g. a decoded <canvas>) for a preview. Return null to fall back
   to the generic identification card.

   Dependency-free. Formats with a simple pixel layout (TGA, QOI, Netpbm, PCX,
   farbfeld, WBMP, XBM, XPM, Sun raster, SGI) are fully decoded to a <canvas> in
   pure JS. Formats needing a heavy codec (DDS/BCn, EXR, JPEG 2000, JPEG XR) are
   read header-only and noted as decoder-gated. Anything rated rare AND hard
   (PICT, FLIF, JBIG/JBIG2, CGM, CDR) is identification-only. No top-level side
   effects. */

import { el, row, fmtBytes, loadScript } from '../core/util.js';
import { Reader, ascii, findBytes, matchMagic, startsWithAscii, latin1, utf8 } from '../core/binutil.js';

// ---------- shared helpers ----------

const MAX_EDGE = 1024;   // cap decoded preview's longest edge

function preBlock(text, cls) {
  return el('pre', {
    class: cls || 'anr-code',
    style: 'max-height:360px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0;',
  }, text);
}

async function readAll(file, cap = 32 * 1024 * 1024) {
  return new Uint8Array(await file.slice(0, Math.min(file.size, cap)).arrayBuffer());
}

// Build a <canvas> from an RGBA Uint8ClampedArray, scaling down so the longest
// edge is <= MAX_EDGE (nearest-neighbour, cheap). Returns the canvas node or null.
function canvasFromRGBA(rgba, w, h) {
  if (!w || !h || w < 1 || h < 1) return null;
  if (rgba.length < w * h * 4) return null;
  let dw = w, dh = h;
  const longest = Math.max(w, h);
  if (longest > MAX_EDGE) {
    const s = MAX_EDGE / longest;
    dw = Math.max(1, Math.round(w * s));
    dh = Math.max(1, Math.round(h * s));
  }
  try {
    if (dw === w && dh === h) {
      const c = el('canvas');
      c.width = w; c.height = h;
      c.style.maxWidth = '100%'; c.style.height = 'auto'; c.style.imageRendering = 'auto';
      const ctx = c.getContext('2d');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
      return wrapPreview(c, w, h);
    }
    // Render full-res to an offscreen canvas, then draw scaled into the visible one.
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
    const c = el('canvas');
    c.width = dw; c.height = dh;
    c.style.maxWidth = '100%'; c.style.height = 'auto';
    c.getContext('2d').drawImage(off, 0, 0, dw, dh);
    return wrapPreview(c, w, h);
  } catch (_) {
    return null;
  }
}

// Wrap a canvas with a checkerboard background (so transparency reads) + caption.
function wrapPreview(canvas, w, h) {
  const wrap = el('div', { class: 'anr-img-preview', style: 'margin-top:12px;' });
  const board = el('div', {
    style: 'display:inline-block;background-image:linear-gradient(45deg,#bbb 25%,transparent 25%),linear-gradient(-45deg,#bbb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#bbb 75%),linear-gradient(-45deg,transparent 75%,#bbb 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;border:1px solid var(--anr-border,#3a3a3a);max-width:100%;',
  }, canvas);
  wrap.appendChild(board);
  wrap.appendChild(el('div', { style: 'font-size:11px;opacity:.6;margin-top:4px;' },
    'Decoded preview · ' + w + ' × ' + h + (Math.max(w, h) > MAX_EDGE ? ' (scaled)' : '')));
  return wrap;
}

// =====================================================================
//                   TGA (Truevision Targa)
// =====================================================================
async function parseTga(file) {
  const b = await readAll(file);
  if (b.length < 18) return null;
  const idLen = b[0];
  const colorMapType = b[1];
  const imageType = b[2];
  // image types: 0 none,1 cmap,2 truecolor,3 gray,9 RLE cmap,10 RLE truecolor,11 RLE gray
  if (![1, 2, 3, 9, 10, 11].includes(imageType)) return null;
  const r = new Reader(b, true);
  r.seek(3);
  const cmapFirst = r.u16();
  const cmapLen = r.u16();
  const cmapDepth = r.u8();
  const xOrigin = r.u16();
  const yOrigin = r.u16();
  const width = r.u16();
  const height = r.u16();
  const pixelDepth = r.u8();
  const descriptor = r.u8();
  if (!width || !height || width > 30000 || height > 30000) return null;
  const alphaBits = descriptor & 0x0f;
  const topToBottom = !!(descriptor & 0x20);
  const rightToLeft = !!(descriptor & 0x10);
  const rle = imageType >= 9;
  const grayscale = imageType === 3 || imageType === 11;
  const indexed = imageType === 1 || imageType === 9;

  const TYPE_NAMES = { 1: 'color-mapped', 2: 'true-color', 3: 'grayscale', 9: 'RLE color-mapped', 10: 'RLE true-color', 11: 'RLE grayscale' };

  const out = {
    'Format': 'Truevision TGA',
    'Image type': TYPE_NAMES[imageType] || ('type ' + imageType),
    'Dimensions': width + ' × ' + height,
    'Bit depth': pixelDepth + '-bit' + (grayscale ? ' grayscale' : indexed ? ' indexed' : ''),
    'Alpha bits': alphaBits,
    'Compression': rle ? 'RLE' : 'uncompressed',
    'Origin': (topToBottom ? 'top' : 'bottom') + '-' + (rightToLeft ? 'right' : 'left'),
  };
  if (xOrigin || yOrigin) out['Origin offset'] = xOrigin + ', ' + yOrigin;
  if (colorMapType) out['Palette'] = cmapLen + ' entries, ' + cmapDepth + '-bit';

  // v2 footer: last 26 bytes "TRUEVISION-XFILE.\0"
  try {
    if (b.length >= 26 && ascii(b, b.length - 18, 17) === 'TRUEVISION-XFILE.') {
      out['Version'] = 'TGA 2.0 (footer present)';
      const fr = new Reader(b, true); fr.seek(b.length - 26);
      const extOff = fr.u32();
      if (extOff && extOff + 495 <= b.length) {
        const author = ascii(b, extOff + 41, 41).replace(/\0.*$/, '').trim();
        const comment = ascii(b, extOff + 82, 80).replace(/\0.*$/, '').trim();
        const software = ascii(b, extOff + 426, 41).replace(/\0.*$/, '').trim();
        if (author) out['Author'] = author;
        if (software) out['Software'] = software;
        if (comment) out['Comment'] = comment;
      }
    } else {
      out['Version'] = 'TGA 1.0';
    }
  } catch (_) {}

  // ---- decode ----
  try {
    const preview = decodeTga(b, { idLen, colorMapType, cmapFirst, cmapLen, cmapDepth, width, height, pixelDepth, rle, grayscale, indexed, topToBottom, rightToLeft });
    if (preview) out._previewNode = preview;
  } catch (_) {}
  return out;
}

function decodeTga(b, h) {
  const { width, height, pixelDepth } = h;
  const bpp = pixelDepth >> 3;          // bytes per stored pixel/index
  let off = 18 + h.idLen;
  // colour map
  let cmap = null;
  if (h.colorMapType === 1 && h.cmapLen) {
    const cBpp = h.cmapDepth >> 3;
    cmap = b.subarray(off, off + h.cmapLen * cBpp);
    off += h.cmapLen * cBpp;
  }
  const px = width * height;
  if (px <= 0 || px > 64_000_000) return null;
  // Gather raw pixel/index bytes (decompress RLE if needed).
  let raw;
  if (h.rle) {
    raw = new Uint8Array(px * bpp);
    let di = 0, si = off;
    while (di < raw.length && si < b.length) {
      const packet = b[si++];
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {                // RLE packet
        const start = si;
        for (let n = 0; n < count && di < raw.length; n++) {
          for (let k = 0; k < bpp; k++) raw[di++] = b[start + k];
        }
        si += bpp;
      } else {                            // raw packet
        for (let n = 0; n < count && di < raw.length; n++) {
          for (let k = 0; k < bpp; k++) raw[di++] = b[si++];
        }
      }
    }
  } else {
    raw = b.subarray(off, off + px * bpp);
  }
  if (raw.length < px * bpp) return null;

  const rgba = new Uint8ClampedArray(px * 4);
  const putPixel = (dst, r, g, bl, a) => { rgba[dst] = r; rgba[dst + 1] = g; rgba[dst + 2] = bl; rgba[dst + 3] = a; };
  const cBpp = h.cmapDepth >> 3;

  for (let i = 0; i < px; i++) {
    let r, g, bl, a = 255;
    const s = i * bpp;
    if (h.indexed) {
      const idx = (bpp === 2 ? (raw[s] | (raw[s + 1] << 8)) : raw[s]) - h.cmapFirst;
      const cs = idx * cBpp;
      if (cmap && cs >= 0 && cs < cmap.length) {
        if (cBpp === 2) { const v = cmap[cs] | (cmap[cs + 1] << 8); r = ((v >> 10) & 31) * 8; g = ((v >> 5) & 31) * 8; bl = (v & 31) * 8; }
        else { bl = cmap[cs]; g = cmap[cs + 1]; r = cmap[cs + 2]; if (cBpp === 4) a = cmap[cs + 3]; }
      } else { r = g = bl = 0; }
    } else if (h.grayscale) {
      r = g = bl = raw[s];
      if (bpp === 2) a = raw[s + 1];
    } else if (bpp === 2) {               // 15/16-bit ARRRRRGGGGGBBBBB
      const v = raw[s] | (raw[s + 1] << 8);
      r = ((v >> 10) & 31) * 8; g = ((v >> 5) & 31) * 8; bl = (v & 31) * 8;
      if (pixelDepth === 16 && (h.descriptor & 0x0f)) a = (v & 0x8000) ? 255 : 0;
    } else {                              // BGR(A)
      bl = raw[s]; g = raw[s + 1]; r = raw[s + 2];
      if (bpp === 4) a = raw[s + 3];
    }
    // place respecting origin
    const sx = i % width, sy = (i / width) | 0;
    const dy = h.topToBottom ? sy : (height - 1 - sy);
    const dx = h.rightToLeft ? (width - 1 - sx) : sx;
    putPixel((dy * width + dx) * 4, r, g, bl, a);
  }
  return canvasFromRGBA(rgba, width, height);
}

// =====================================================================
//                   QOI
// =====================================================================
async function parseQoi(file) {
  const b = await readAll(file);
  if (b.length < 14 || ascii(b, 0, 4) !== 'qoif') return null;
  const r = new Reader(b); // big-endian
  r.seek(4);
  const width = r.u32();
  const height = r.u32();
  const channels = r.u8();
  const colorspace = r.u8();
  if (!width || !height || width > 60000 || height > 60000) return null;
  const out = {
    'Format': 'QOI (Quite OK Image)',
    'Dimensions': width + ' × ' + height,
    'Channels': channels === 4 ? '4 (RGBA)' : channels === 3 ? '3 (RGB)' : channels,
    'Colorspace': colorspace === 0 ? 'sRGB with linear alpha' : colorspace === 1 ? 'all linear' : colorspace,
  };
  try {
    const preview = decodeQoi(b, width, height);
    if (preview) out._previewNode = preview;
  } catch (_) {}
  return out;
}

function decodeQoi(b, width, height) {
  const px = width * height;
  if (px <= 0 || px > 64_000_000) return null;
  const rgba = new Uint8ClampedArray(px * 4);
  const index = new Uint8Array(64 * 4);
  let r = 0, g = 0, bl = 0, a = 255;
  let p = 14;
  const end = b.length - 8;             // last 8 bytes are the stream end marker
  let run = 0;
  for (let i = 0; i < px; i++) {
    if (run > 0) {
      run--;
    } else if (p < end) {
      const byte = b[p++];
      if (byte === 0xfe) {              // QOI_OP_RGB
        r = b[p++]; g = b[p++]; bl = b[p++];
      } else if (byte === 0xff) {       // QOI_OP_RGBA
        r = b[p++]; g = b[p++]; bl = b[p++]; a = b[p++];
      } else {
        const tag = byte & 0xc0;
        if (tag === 0x00) {            // INDEX
          const j = (byte & 0x3f) * 4;
          r = index[j]; g = index[j + 1]; bl = index[j + 2]; a = index[j + 3];
        } else if (tag === 0x40) {     // DIFF
          r = (r + ((byte >> 4) & 3) - 2) & 0xff;
          g = (g + ((byte >> 2) & 3) - 2) & 0xff;
          bl = (bl + (byte & 3) - 2) & 0xff;
        } else if (tag === 0x80) {     // LUMA
          const b2 = b[p++];
          const vg = (byte & 0x3f) - 32;
          r = (r + vg - 8 + ((b2 >> 4) & 0x0f)) & 0xff;
          g = (g + vg) & 0xff;
          bl = (bl + vg - 8 + (b2 & 0x0f)) & 0xff;
        } else {                       // RUN
          run = byte & 0x3f;           // bias of 1 handled by consuming this pixel
        }
      }
    }
    const ih = ((r * 3 + g * 5 + bl * 7 + a * 11) % 64) * 4;
    index[ih] = r; index[ih + 1] = g; index[ih + 2] = bl; index[ih + 3] = a;
    const d = i * 4;
    rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = bl; rgba[d + 3] = a;
  }
  return canvasFromRGBA(rgba, width, height);
}

// =====================================================================
//                   Netpbm (P1-P6) + PAM (P7)
// =====================================================================
async function parseNetpbm(file) {
  const b = await readAll(file, 48 * 1024 * 1024);
  if (b.length < 3 || b[0] !== 0x50) return null;   // 'P'
  const t = b[1];
  if (t === 0x37) return parsePam(b);               // P7 = PAM
  if (t < 0x31 || t > 0x36) return null;            // P1..P6
  const type = t - 0x30;
  const ascii_ = type <= 3;
  const isBitmap = type === 1 || type === 4;
  const isGray = type === 2 || type === 5;

  // Parse whitespace/comment-separated header tokens.
  let pos = 2;
  const readToken = () => {
    let s = '';
    while (pos < b.length) {
      const c = b[pos];
      if (c === 0x23) { while (pos < b.length && b[pos] !== 0x0a) pos++; continue; } // comment to EOL
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) { if (s) break; pos++; continue; }
      s += String.fromCharCode(c); pos++;
    }
    return s;
  };
  const width = parseInt(readToken(), 10);
  const height = parseInt(readToken(), 10);
  let maxval = 255;
  if (!isBitmap) maxval = parseInt(readToken(), 10);
  if (!width || !height || width > 60000 || height > 60000) return null;
  pos++; // single whitespace after last header token (for binary variants)

  const NAMES = { 1: 'P1 (PBM, ASCII bitmap)', 2: 'P2 (PGM, ASCII grayscale)', 3: 'P3 (PPM, ASCII color)', 4: 'P4 (PBM, binary bitmap)', 5: 'P5 (PGM, binary grayscale)', 6: 'P6 (PPM, binary color)' };
  const out = {
    'Format': 'Netpbm ' + NAMES[type],
    'Dimensions': width + ' × ' + height,
    'Channels': isBitmap ? '1 (bilevel)' : isGray ? '1 (gray)' : '3 (RGB)',
    'Encoding': ascii_ ? 'ASCII (plain)' : 'binary (raw)',
  };
  if (!isBitmap) out['Max value'] = maxval;

  try {
    const preview = decodeNetpbm(b, pos, { type, width, height, maxval, ascii_, isBitmap, isGray });
    if (preview) out._previewNode = preview;
  } catch (_) {}
  return out;
}

function decodeNetpbm(b, pos, h) {
  const { width, height, maxval, ascii_, isBitmap, isGray } = h;
  const px = width * height;
  if (px <= 0 || px > 48_000_000) return null;
  const rgba = new Uint8ClampedArray(px * 4);
  const scale = maxval > 0 ? 255 / maxval : 1;

  if (ascii_) {
    // Stream ASCII integers.
    let p = pos;
    const nextInt = () => {
      while (p < b.length && (b[p] === 0x20 || b[p] === 0x09 || b[p] === 0x0a || b[p] === 0x0d)) p++;
      if (b[p] === 0x23) { while (p < b.length && b[p] !== 0x0a) p++; return nextInt(); }
      let v = 0, got = false;
      while (p < b.length && b[p] >= 0x30 && b[p] <= 0x39) { v = v * 10 + (b[p] - 0x30); p++; got = true; }
      return got ? v : null;
    };
    for (let i = 0; i < px; i++) {
      const d = i * 4;
      if (isBitmap) {
        const v = nextInt();              // 1 = black
        const g = v === 1 ? 0 : 255;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255;
      } else if (isGray) {
        const g = Math.round((nextInt() || 0) * scale);
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255;
      } else {
        rgba[d] = Math.round((nextInt() || 0) * scale);
        rgba[d + 1] = Math.round((nextInt() || 0) * scale);
        rgba[d + 2] = Math.round((nextInt() || 0) * scale);
        rgba[d + 3] = 255;
      }
    }
  } else if (isBitmap) {                   // P4: rows are byte-padded, MSB first, 1=black
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = b[pos + y * rowBytes + (x >> 3)] || 0;
        const bit = (byte >> (7 - (x & 7))) & 1;
        const g = bit ? 0 : 255;
        const d = (y * width + x) * 4;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255;
      }
    }
  } else {                                 // P5/P6 binary; samples are 1 or 2 bytes
    const wide = maxval > 255;
    const sampleBytes = wide ? 2 : 1;
    const nch = isGray ? 1 : 3;
    let p = pos;
    const sample = () => {
      let v;
      if (wide) { v = (b[p] << 8) | b[p + 1]; p += 2; } else { v = b[p]; p += 1; }
      return Math.round(v * scale);
    };
    for (let i = 0; i < px; i++) {
      const d = i * 4;
      if (isGray) { const g = sample(); rgba[d] = rgba[d + 1] = rgba[d + 2] = g; }
      else { rgba[d] = sample(); rgba[d + 1] = sample(); rgba[d + 2] = sample(); }
      rgba[d + 3] = 255;
    }
  }
  return canvasFromRGBA(rgba, width, height);
}

function parsePam(b) {
  // P7 header is line-based key/value, ending with "ENDHDR\n".
  const headEnd = findBytes(b, [0x45, 0x4e, 0x44, 0x48, 0x44, 0x52], 0, Math.min(b.length, 4096)); // "ENDHDR"
  if (headEnd < 0) return null;
  let nl = headEnd + 6;
  while (nl < b.length && b[nl] !== 0x0a) nl++;
  const headerTxt = latin1(b.subarray(0, headEnd));
  const get = (k) => { const m = headerTxt.match(new RegExp('^' + k + '\\s+(.+)$', 'im')); return m ? m[1].trim() : null; };
  const width = parseInt(get('WIDTH'), 10);
  const height = parseInt(get('HEIGHT'), 10);
  const depth = parseInt(get('DEPTH'), 10) || 1;
  const maxval = parseInt(get('MAXVAL'), 10) || 255;
  const tupltype = get('TUPLTYPE') || '';
  if (!width || !height) return null;
  const out = {
    'Format': 'Netpbm P7 (PAM)',
    'Dimensions': width + ' × ' + height,
    'Depth (channels)': depth,
    'Max value': maxval,
    'Tuple type': tupltype || '(unspecified)',
  };
  try {
    const pos = nl + 1;
    const px = width * height;
    if (px > 0 && px <= 48_000_000 && maxval <= 255) {
      const rgba = new Uint8ClampedArray(px * 4);
      const scale = 255 / maxval;
      let p = pos;
      for (let i = 0; i < px; i++) {
        const d = i * 4;
        if (depth === 1) { const g = Math.round((b[p++] || 0) * scale); rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255; }
        else if (depth === 2) { const g = Math.round((b[p++] || 0) * scale); rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = Math.round((b[p++] || 0) * scale); }
        else if (depth === 3) { rgba[d] = Math.round((b[p++] || 0) * scale); rgba[d + 1] = Math.round((b[p++] || 0) * scale); rgba[d + 2] = Math.round((b[p++] || 0) * scale); rgba[d + 3] = 255; }
        else { rgba[d] = Math.round((b[p++] || 0) * scale); rgba[d + 1] = Math.round((b[p++] || 0) * scale); rgba[d + 2] = Math.round((b[p++] || 0) * scale); rgba[d + 3] = Math.round((b[p++] || 0) * scale); for (let k = 4; k < depth; k++) p++; }
      }
      const preview = canvasFromRGBA(rgba, width, height);
      if (preview) out._previewNode = preview;
    }
  } catch (_) {}
  return out;
}

// =====================================================================
//                   PCX (ZSoft PC Paintbrush)
// =====================================================================
async function parsePcx(file) {
  const b = await readAll(file);
  if (b.length < 128 || b[0] !== 0x0a) return null;
  const ver = b[1];
  const encoding = b[2];   // 1 = RLE
  const bpp = b[3];        // bits per pixel per plane
  const r = new Reader(b, true);
  r.seek(4);
  const xmin = r.u16(), ymin = r.u16(), xmax = r.u16(), ymax = r.u16();
  const hdpi = r.u16(), vdpi = r.u16();
  r.seek(65);
  const planes = b[65];
  const bytesPerLine = b[66] | (b[67] << 8);
  const width = xmax - xmin + 1;
  const height = ymax - ymin + 1;
  if (width <= 0 || height <= 0 || width > 30000 || height > 30000) return null;
  const VERS = { 0: 'v2.5', 2: 'v2.8 w/palette', 3: 'v2.8 no palette', 4: 'Paintbrush for Windows', 5: 'v3.0+' };
  const out = {
    'Format': 'PCX (ZSoft PC Paintbrush)',
    'Version': VERS[ver] || ('byte ' + ver),
    'Dimensions': width + ' × ' + height,
    'Bit depth': bpp + ' bpp × ' + planes + ' plane' + (planes > 1 ? 's' : '') + ' = ' + (bpp * planes) + '-bit',
    'Encoding': encoding === 1 ? 'RLE' : 'uncompressed',
    'Resolution': hdpi + ' × ' + vdpi + ' DPI',
  };
  try {
    const preview = decodePcx(b, { bpp, planes, bytesPerLine, width, height });
    if (preview) out._previewNode = preview;
  } catch (_) {}
  return out;
}

function decodePcx(b, h) {
  const { bpp, planes, bytesPerLine, width, height } = h;
  // Decode RLE scanlines: total bytes per row = bytesPerLine * planes.
  const totalPerRow = bytesPerLine * planes;
  const rows = new Uint8Array(totalPerRow * height);
  let si = 128, di = 0;
  const end = di + rows.length;
  while (di < end && si < b.length) {
    let byte = b[si++];
    if ((byte & 0xc0) === 0xc0) {
      const count = byte & 0x3f;
      const val = b[si++];
      for (let n = 0; n < count && di < end; n++) rows[di++] = val;
    } else {
      rows[di++] = byte;
    }
  }
  const px = width * height;
  if (px <= 0 || px > 64_000_000) return null;
  const rgba = new Uint8ClampedArray(px * 4);

  if (planes === 3 && bpp === 8) {           // 24-bit RGB
    for (let y = 0; y < height; y++) {
      const base = y * totalPerRow;
      for (let x = 0; x < width; x++) {
        const d = (y * width + x) * 4;
        rgba[d] = rows[base + x];
        rgba[d + 1] = rows[base + bytesPerLine + x];
        rgba[d + 2] = rows[base + 2 * bytesPerLine + x];
        rgba[d + 3] = 255;
      }
    }
  } else if (planes === 1 && bpp === 8) {     // 8-bit palette (256-colour palette in last 769 bytes, marker 0x0C)
    let pal = null;
    if (b.length >= 769 && b[b.length - 769] === 0x0c) pal = b.subarray(b.length - 768);
    for (let y = 0; y < height; y++) {
      const base = y * totalPerRow;
      for (let x = 0; x < width; x++) {
        const idx = rows[base + x];
        const d = (y * width + x) * 4;
        if (pal) { rgba[d] = pal[idx * 3]; rgba[d + 1] = pal[idx * 3 + 1]; rgba[d + 2] = pal[idx * 3 + 2]; }
        else { rgba[d] = rgba[d + 1] = rgba[d + 2] = idx; }
        rgba[d + 3] = 255;
      }
    }
  } else if (bpp === 1) {                     // 1-bit, up to 4 planes (EGA/16-colour) — handle 1 plane mono + header palette
    const hdrPal = b.subarray(16, 64);        // 16-colour EGA palette
    for (let y = 0; y < height; y++) {
      const base = y * totalPerRow;
      for (let x = 0; x < width; x++) {
        let idx = 0;
        for (let pl = 0; pl < planes; pl++) {
          const byte = rows[base + pl * bytesPerLine + (x >> 3)];
          const bit = (byte >> (7 - (x & 7))) & 1;
          idx |= bit << pl;
        }
        const d = (y * width + x) * 4;
        if (planes === 1) { const g = idx ? 255 : 0; rgba[d] = rgba[d + 1] = rgba[d + 2] = g; }
        else { rgba[d] = hdrPal[idx * 3]; rgba[d + 1] = hdrPal[idx * 3 + 1]; rgba[d + 2] = hdrPal[idx * 3 + 2]; }
        rgba[d + 3] = 255;
      }
    }
  } else {
    return null;   // unusual bit layout — metadata only
  }
  return canvasFromRGBA(rgba, width, height);
}

// =====================================================================
//                   farbfeld (.ff)
// =====================================================================
async function parseFarbfeld(file) {
  const b = await readAll(file);
  if (b.length < 16 || ascii(b, 0, 8) !== 'farbfeld') return null;
  const r = new Reader(b); // big-endian
  r.seek(8);
  const width = r.u32();
  const height = r.u32();
  if (!width || !height || width > 30000 || height > 30000) return null;
  const out = {
    'Format': 'farbfeld (suckless)',
    'Dimensions': width + ' × ' + height,
    'Channels': '4 (RGBA, 16-bit)',
  };
  try {
    const px = width * height;
    if (px <= 16_000_000 && 16 + px * 8 <= b.length + 8) {
      const rgba = new Uint8ClampedArray(px * 4);
      let p = 16;
      for (let i = 0; i < px; i++) {
        const d = i * 4;
        rgba[d] = b[p]; rgba[d + 1] = b[p + 2]; rgba[d + 2] = b[p + 4]; rgba[d + 3] = b[p + 6]; // high byte of each 16-bit BE sample
        p += 8;
      }
      const preview = canvasFromRGBA(rgba, width, height);
      if (preview) out._previewNode = preview;
    }
  } catch (_) {}
  return out;
}

// =====================================================================
//                   WBMP (Wireless Bitmap)
// =====================================================================
async function parseWbmp(file) {
  const b = await readAll(file, 8 * 1024 * 1024);
  if (b.length < 4) return null;
  if (b[0] !== 0x00) return null;             // type 0 = B/W, no compression
  // fixed header field (b[1]) should be 0
  let p = 1;
  const fixed = b[p++];
  if (fixed !== 0x00) return null;
  // multi-byte (7-bit) integers for width/height
  const mb = () => { let v = 0; let c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
  const width = mb();
  const height = mb();
  if (!width || !height || width > 30000 || height > 30000) return null;
  const out = {
    'Format': 'WBMP (Wireless Bitmap, WAP)',
    'Type': '0 (monochrome, uncompressed)',
    'Dimensions': width + ' × ' + height,
    'Bit depth': '1 bpp',
  };
  try {
    const rowBytes = Math.ceil(width / 8);
    const px = width * height;
    if (px <= 64_000_000 && p + rowBytes * height <= b.length) {
      const rgba = new Uint8ClampedArray(px * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byte = b[p + y * rowBytes + (x >> 3)];
          const bit = (byte >> (7 - (x & 7))) & 1;   // 1 = white
          const g = bit ? 255 : 0;
          const d = (y * width + x) * 4;
          rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255;
        }
      }
      const preview = canvasFromRGBA(rgba, width, height);
      if (preview) out._previewNode = preview;
    }
  } catch (_) {}
  return out;
}

// =====================================================================
//                   XBM (X BitMap, C source)
// =====================================================================
async function parseXbm(file) {
  const text = await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).text();
  const wm = text.match(/#define\s+\w*_?width\s+(\d+)/i);
  const hm = text.match(/#define\s+\w*_?height\s+(\d+)/i);
  if (!wm || !hm || !/\{[\s\S]*0x[0-9a-f]/i.test(text)) return null;
  const width = parseInt(wm[1], 10);
  const height = parseInt(hm[1], 10);
  if (!width || !height || width > 30000 || height > 30000) return null;
  const hotXm = text.match(/_x_hot\s+(\d+)/i);
  const hotYm = text.match(/_y_hot\s+(\d+)/i);
  const out = {
    'Format': 'XBM (X BitMap)',
    'Dimensions': width + ' × ' + height,
    'Bit depth': '1 bpp (C source array)',
  };
  if (hotXm && hotYm) out['Hotspot'] = hotXm[1] + ', ' + hotYm[1];
  try {
    const arr = text.slice(text.indexOf('{') + 1);
    const bytes = [];
    const re = /0x([0-9a-fA-F]{1,2})/g;
    let m;
    const need = Math.ceil(width / 8) * height;
    while ((m = re.exec(arr)) && bytes.length < need) bytes.push(parseInt(m[1], 16));
    const rowBytes = Math.ceil(width / 8);
    const px = width * height;
    const rgba = new Uint8ClampedArray(px * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = bytes[y * rowBytes + (x >> 3)] || 0;
        const bit = (byte >> (x & 7)) & 1;   // XBM is LSB-first; 1 = set (black)
        const g = bit ? 0 : 255;
        const d = (y * width + x) * 4;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255;
      }
    }
    const preview = canvasFromRGBA(rgba, width, height);
    if (preview) out._previewNode = preview;
  } catch (_) {}
  return out;
}

// =====================================================================
//                   XPM (X PixMap, C source)
// =====================================================================
async function parseXpm(file) {
  const text = await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).text();
  if (!/XPM/.test(text) && !/static\s+char/.test(text)) return null;
  // Collect the quoted strings forming the data array.
  const strings = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text)) && strings.length < 200000) strings.push(m[1]);
  if (!strings.length) return null;
  const vals = strings[0].trim().split(/\s+/).map(Number);
  const [width, height, ncolors, cpp] = vals;
  if (!width || !height || !ncolors || !cpp || width > 30000 || height > 30000) return null;
  const out = {
    'Format': 'XPM (X PixMap)',
    'Dimensions': width + ' × ' + height,
    'Colors': ncolors,
    'Chars per pixel': cpp,
  };
  try {
    // Color table: lines 1..ncolors map cpp-char key -> color (look for 'c' context).
    const colorMap = {};
    const parseColor = (name) => {
      if (!name) return null;
      name = name.trim();
      if (/^none$/i.test(name)) return [0, 0, 0, 0];
      let mm;
      if ((mm = name.match(/^#([0-9a-fA-F]{6})$/))) { const v = parseInt(mm[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255]; }
      if ((mm = name.match(/^#([0-9a-fA-F]{12})$/))) return [parseInt(mm[1].slice(0, 2), 16), parseInt(mm[1].slice(4, 6), 16), parseInt(mm[1].slice(8, 10), 16), 255];
      const NAMED = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], yellow: [255, 255, 0], cyan: [0, 255, 255], magenta: [255, 0, 255] };
      const n = NAMED[name.toLowerCase()];
      return n ? [n[0], n[1], n[2], 255] : [128, 128, 128, 255];
    };
    for (let i = 1; i <= ncolors && i < strings.length; i++) {
      const line = strings[i];
      const key = line.slice(0, cpp);
      // find the 'c' (color) visual; fall back to whatever follows a context char
      let color = null;
      const cm = line.slice(cpp).match(/\bc\s+(#[0-9a-fA-F]+|[A-Za-z]+|None)/);
      const gm = line.slice(cpp).match(/\b[gms]\s+(#[0-9a-fA-F]+|[A-Za-z]+|None)/);
      color = parseColor(cm ? cm[1] : gm ? gm[1] : null);
      colorMap[key] = color || [128, 128, 128, 255];
    }
    const px = width * height;
    if (px <= 16_000_000) {
      const rgba = new Uint8ClampedArray(px * 4);
      for (let y = 0; y < height; y++) {
        const line = strings[1 + ncolors + y] || '';
        for (let x = 0; x < width; x++) {
          const key = line.slice(x * cpp, x * cpp + cpp);
          const c = colorMap[key] || [0, 0, 0, 0];
          const d = (y * width + x) * 4;
          rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2]; rgba[d + 3] = c[3];
        }
      }
      const preview = canvasFromRGBA(rgba, width, height);
      if (preview) out._previewNode = preview;
    }
  } catch (_) {}
  return out;
}

// =====================================================================
//                   Sun raster (.ras / .sun)
// =====================================================================
async function parseSunRaster(file) {
  const b = await readAll(file);
  if (b.length < 32) return null;
  const r = new Reader(b); // big-endian
  const magic = r.u32();
  if (magic !== 0x59a66a95) return null;
  const width = r.u32();
  const height = r.u32();
  const depth = r.u32();
  const length = r.u32();
  const type = r.u32();
  const maptype = r.u32();
  const maplength = r.u32();
  if (!width || !height || width > 30000 || height > 30000) return null;
  const TYPES = { 0: 'old', 1: 'standard', 2: 'byte-encoded (RLE)', 3: 'RGB', 4: 'TIFF', 5: 'IFF' };
  const out = {
    'Format': 'Sun Raster',
    'Dimensions': width + ' × ' + height,
    'Depth': depth + '-bit',
    'Type': TYPES[type] || ('type ' + type),
    'Color map': maptype === 0 ? 'none' : maptype === 1 ? 'RGB' : maptype === 2 ? 'raw' : ('type ' + maptype),
  };
  if (type === 2) out['Note'] = 'Byte-RLE encoded; preview decoder not bundled.';
  try {
    if ((type === 1 || type === 0) && maptype === 0) {
      const dataOff = 32 + maplength;
      const rowBytes = Math.ceil(width * depth / 16) * 2; // padded to 16-bit boundary
      const px = width * height;
      if (px <= 32_000_000 && depth >= 8 && dataOff + rowBytes * height <= b.length) {
        const rgba = new Uint8ClampedArray(px * 4);
        const bpp = depth >> 3;
        for (let y = 0; y < height; y++) {
          const base = dataOff + y * rowBytes;
          for (let x = 0; x < width; x++) {
            const d = (y * width + x) * 4;
            if (depth === 8) { const g = b[base + x]; rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255; }
            else { const s = base + x * bpp; rgba[d] = b[s + 2]; rgba[d + 1] = b[s + 1]; rgba[d + 2] = b[s]; rgba[d + 3] = depth === 32 ? 255 : 255; } // BGR
          }
        }
        const preview = canvasFromRGBA(rgba, width, height);
        if (preview) out._previewNode = preview;
      }
    }
  } catch (_) {}
  return out;
}

// =====================================================================
//                   SGI / IRIS RGB (.sgi / .bw)
// =====================================================================
async function parseSgi(file) {
  const b = await readAll(file);
  if (b.length < 512) return null;
  const r = new Reader(b); // big-endian
  const magic = r.u16();
  if (magic !== 474) return null;            // 0x01DA
  const storage = r.u8();                    // 0 = verbatim, 1 = RLE
  const bpc = r.u8();                         // bytes per channel
  const dimension = r.u16();
  const xsize = r.u16();
  const ysize = r.u16();
  const zsize = r.u16();                      // channels
  r.seek(24);
  const name = ascii(b, 24, 80).replace(/\0.*$/, '').trim();
  if (!xsize || !ysize || xsize > 30000 || ysize > 30000) return null;
  const out = {
    'Format': 'SGI / IRIS RGB Image',
    'Dimensions': xsize + ' × ' + ysize,
    'Channels': zsize + (zsize === 1 ? ' (grayscale)' : zsize === 3 ? ' (RGB)' : zsize === 4 ? ' (RGBA)' : ''),
    'Bytes per channel': bpc,
    'Storage': storage === 1 ? 'RLE' : 'verbatim',
  };
  if (name) out['Image name'] = name;
  if (storage === 1) out['Note'] = 'RLE-encoded; preview decoder not bundled.';
  try {
    if (storage === 0 && bpc === 1) {
      const px = xsize * ysize;
      if (px <= 32_000_000) {
        const rgba = new Uint8ClampedArray(px * 4);
        const dataOff = 512;
        const chanSize = xsize * ysize;
        for (let ch = 0; ch < Math.min(zsize, 4); ch++) {
          const cbase = dataOff + ch * chanSize;
          for (let y = 0; y < ysize; y++) {
            for (let x = 0; x < xsize; x++) {
              const v = b[cbase + y * xsize + x] || 0;
              const d = ((ysize - 1 - y) * xsize + x) * 4;   // SGI is bottom-up
              if (zsize === 1) { rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255; }
              else { rgba[d + ch] = v; if (zsize < 4) rgba[d + 3] = 255; }
            }
          }
        }
        const preview = canvasFromRGBA(rgba, xsize, ysize);
        if (preview) out._previewNode = preview;
      }
    }
  } catch (_) {}
  return out;
}

// =====================================================================
//                   Radiance HDR / .pic (metadata only)
// =====================================================================
async function parseHdr(file) {
  const b = await readAll(file, 64 * 1024);
  const txt = latin1(b);
  if (!/^#\?(RADIANCE|RGBE)/.test(txt)) return null;
  const out = { 'Format': 'Radiance HDR (RGBE)' };
  const get = (k) => { const m = txt.match(new RegExp('^' + k + '=\\s*(.+)$', 'im')); return m ? m[1].trim() : null; };
  const fmt = get('FORMAT'); if (fmt) out['Pixel format'] = fmt;
  const exp = get('EXPOSURE'); if (exp) out['Exposure'] = exp;
  const gamma = get('GAMMA'); if (gamma) out['Gamma'] = gamma;
  const sw = get('SOFTWARE'); if (sw) out['Software'] = sw;
  const view = get('VIEW'); if (view) out['View'] = view;
  const prim = get('PRIMARIES'); if (prim) out['Primaries'] = prim;
  // resolution line: e.g. "-Y 768 +X 1024"
  const res = txt.match(/([-+][XY])\s+(\d+)\s+([-+][XY])\s+(\d+)/);
  if (res) {
    const dims = {}; dims[res[1][1]] = parseInt(res[2], 10); dims[res[3][1]] = parseInt(res[4], 10);
    if (dims.X && dims.Y) out['Dimensions'] = dims.X + ' × ' + dims.Y;
  }
  out['Note'] = 'High dynamic range RGBE; tonemapping to a preview needs a float decoder (not bundled).';
  return out;
}

// =====================================================================
//                   DDS (DirectDraw Surface)
//   Header is parsed for metadata; the first mip level of the common
//   block-compression families (BC1/2/3/4/5 = DXT1/3/5 + ATI1/2) and
//   plain uncompressed RGBA/BGRA surfaces are decoded to a <canvas> in
//   pure JS. BC6H/BC7 and other unsupported layouts stay metadata-only.
// =====================================================================
async function parseDds(file) {
  // Read enough to cover the header plus the first mip level of a large
  // texture (4 bpp BC across a 4K surface is ~8 MB); cap generously.
  const b = await readAll(file, 64 * 1024 * 1024);
  if (ascii(b, 0, 4) !== 'DDS ') return null;
  const r = new Reader(b, true);
  r.seek(8);
  const flags = r.u32();
  const height = r.u32();
  const width = r.u32();
  r.u32(); // pitch/linear size
  const depth = r.u32();
  const mipmaps = r.u32();
  // pixel format @ offset 76: size, flags, fourCC...
  r.seek(76);
  const pfSize = r.u32();
  const pfFlags = r.u32();
  const fourCC = ascii(b, 84, 4);
  const rgbBitCount = (() => { const rr = new Reader(b, true); rr.seek(88); return rr.u32(); })();
  const rMask = (() => { const rr = new Reader(b, true); rr.seek(92); return rr.u32(); })();
  const gMask = (() => { const rr = new Reader(b, true); rr.seek(96); return rr.u32(); })();
  const bMask = (() => { const rr = new Reader(b, true); rr.seek(100); return rr.u32(); })();
  const aMask = (() => { const rr = new Reader(b, true); rr.seek(104); return rr.u32(); })();
  // caps @ 108..
  const caps2 = (() => { const rr = new Reader(b, true); rr.seek(112); return rr.u32(); })();
  const out = {
    'Format': 'DDS (DirectDraw Surface)',
    'Dimensions': width + ' × ' + height,
    'Mipmaps': (flags & 0x20000) ? mipmaps : 1,
  };
  if (depth > 1 && (caps2 & 0x200000)) out['Volume depth'] = depth;

  // Resolve the surface kind into a small descriptor the decoder understands.
  // kind: 'bc1' | 'bc2' | 'bc3' | 'bc4' | 'bc5' | 'rgba' | null (undecodable)
  let kind = null;
  let dxgi = 0;
  let dataOff = 128;             // standard DDS header is 128 bytes
  let compression;
  if (pfFlags & 0x4) {           // DDPF_FOURCC
    if (fourCC === 'DX10') {
      dxgi = (() => { const rr = new Reader(b, true); rr.seek(128); return rr.u32(); })();
      dataOff = 148;            // 128 header + 20 DX10 extension
      out['Container'] = 'DX10 extended header';
      out['DXGI format'] = 'dxgiFormat ' + dxgi + dxgiName(dxgi);
      compression = 'DX10';
      kind = dxgiKind(dxgi);
    } else {
      compression = fourCC.replace(/\0/g, '') || 'FourCC';
      kind = fourCCKind(fourCC);
    }
  } else {
    compression = 'uncompressed (' + rgbBitCount + '-bit)';
    // Only 32-bit RGBA/BGRA (8 bits/channel) are decoded here.
    if ((pfFlags & 0x40) && rgbBitCount === 32) kind = 'rgba';
  }
  out['Pixel format'] = compression;
  if (caps2 & 0x200) out['Type'] = 'cubemap';
  else if (caps2 & 0x200000) out['Type'] = 'volume texture';

  // ---- decode the first mip level ----
  let decoded = false;
  try {
    if (kind && width > 0 && height > 0 && width <= 16384 && height <= 16384) {
      let rgba = null;
      if (kind === 'rgba') {
        rgba = decodeDdsUncompressed(b, dataOff, width, height, rMask, gMask, bMask, aMask);
      } else {
        rgba = decodeBcn(b, dataOff, width, height, kind);
      }
      if (rgba) {
        const preview = canvasFromRGBA(rgba, width, height);
        if (preview) { out._previewNode = preview; decoded = true; }
      }
    }
  } catch (_) { /* fall back to metadata-only */ }

  if (!decoded) {
    // Name the reason so the readout is informative rather than silent.
    let why;
    if (kind === null) {
      if (compression === 'DX10') why = 'Preview: ' + (dxgiName(dxgi).replace(/^[\s(]+|[)\s]+$/g, '') || ('DXGI ' + dxgi)) + ' not decoded';
      else if (pfFlags & 0x4) why = 'Preview: ' + (fourCC.replace(/\0/g, '') || 'FourCC') + ' not decoded';
      else why = 'Preview: uncompressed ' + rgbBitCount + '-bit layout not decoded';
    } else {
      why = 'Preview: decode unavailable (data truncated or invalid)';
    }
    out['Preview'] = why.replace(/^Preview:\s*/, '');
    out['Note'] = 'Block-compressed / GPU texture. ' + why + '.';
  }
  return out;
}

// Map a non-DX10 FourCC to an internal decoder kind.
function fourCCKind(fourCC) {
  const f = fourCC.replace(/\0/g, '');
  if (f === 'DXT1') return 'bc1';
  if (f === 'DXT2' || f === 'DXT3') return 'bc2';
  if (f === 'DXT4' || f === 'DXT5') return 'bc3';
  if (f === 'ATI1' || f === 'BC4U' || f === 'BC4S') return 'bc4';
  if (f === 'ATI2' || f === 'BC5U' || f === 'BC5S') return 'bc5';
  return null;
}
// Map a DXGI format id to an internal decoder kind.
function dxgiKind(n) {
  if (n === 70 || n === 71 || n === 72) return 'bc1';     // BC1 typeless/UNORM/sRGB
  if (n === 73 || n === 74 || n === 75) return 'bc2';     // BC2
  if (n === 76 || n === 77 || n === 78) return 'bc3';     // BC3
  if (n === 79 || n === 80 || n === 81) return 'bc4';     // BC4 (UNORM/SNORM)
  if (n === 82 || n === 83 || n === 84) return 'bc5';     // BC5
  if (n === 28 || n === 29 || n === 87 || n === 88) return 'rgba'; // R8G8B8A8 / B8G8R8A8 family
  return null;
}
function dxgiName(n) {
  const M = { 71: ' (BC1/DXT1)', 72: ' (BC1 sRGB)', 74: ' (BC2/DXT3)', 75: ' (BC2 sRGB)', 77: ' (BC3/DXT5)', 78: ' (BC3 sRGB)', 80: ' (BC4)', 81: ' (BC4 SNORM)', 83: ' (BC5)', 84: ' (BC5 SNORM)', 95: ' (BC6H)', 96: ' (BC6H)', 98: ' (BC7)', 99: ' (BC7)', 28: ' (R8G8B8A8)', 87: ' (B8G8R8A8)' };
  return M[n] || '';
}

// ---------- BCn block decoders ----------

// Decode the two RGB565 endpoints of a BC1 colour block into a 4-entry RGB
// palette and write the 16 texels into `dst` (RGBA) at the block origin.
// `writeAlpha` controls whether BC1's 1-bit punch-through alpha is honoured
// (true for standalone BC1; false when BC2/BC3 supply their own alpha).
function decodeColorBlock(b, off, dst, dstW, dstH, bx, by, writeAlpha, alphaOut) {
  const c0 = b[off] | (b[off + 1] << 8);
  const c1 = b[off + 2] | (b[off + 3] << 8);
  const bits = b[off + 4] | (b[off + 5] << 8) | (b[off + 6] << 16) | (b[off + 7] << 24);
  // Expand RGB565 -> RGB888.
  const r0 = ((c0 >> 11) & 31), g0 = ((c0 >> 5) & 63), b0 = (c0 & 31);
  const r1 = ((c1 >> 11) & 31), g1 = ((c1 >> 5) & 63), b1 = (c1 & 31);
  const R0 = (r0 << 3) | (r0 >> 2), G0 = (g0 << 2) | (g0 >> 4), B0 = (b0 << 3) | (b0 >> 2);
  const R1 = (r1 << 3) | (r1 >> 2), G1 = (g1 << 2) | (g1 >> 4), B1 = (b1 << 3) | (b1 >> 2);
  const pal = new Int32Array(4 * 4); // r,g,b,a per entry
  pal[0] = R0; pal[1] = G0; pal[2] = B0; pal[3] = 255;
  pal[4] = R1; pal[5] = G1; pal[6] = B1; pal[7] = 255;
  if (c0 > c1 || !writeAlpha) {     // 4-colour block (opaque)
    pal[8] = (2 * R0 + R1 + 1) / 3 | 0; pal[9] = (2 * G0 + G1 + 1) / 3 | 0; pal[10] = (2 * B0 + B1 + 1) / 3 | 0; pal[11] = 255;
    pal[12] = (R0 + 2 * R1 + 1) / 3 | 0; pal[13] = (G0 + 2 * G1 + 1) / 3 | 0; pal[14] = (B0 + 2 * B1 + 1) / 3 | 0; pal[15] = 255;
  } else {                          // 3-colour + transparent black
    pal[8] = (R0 + R1) >> 1; pal[9] = (G0 + G1) >> 1; pal[10] = (B0 + B1) >> 1; pal[11] = 255;
    pal[12] = 0; pal[13] = 0; pal[14] = 0; pal[15] = 0;
  }
  for (let py = 0; py < 4; py++) {
    const y = by + py; if (y >= dstH) continue;
    for (let px = 0; px < 4; px++) {
      const x = bx + px; if (x >= dstW) continue;
      const idx = (bits >> (2 * (py * 4 + px))) & 3;
      const d = (y * dstW + x) * 4;
      dst[d] = pal[idx * 4]; dst[d + 1] = pal[idx * 4 + 1]; dst[d + 2] = pal[idx * 4 + 2];
      if (writeAlpha) dst[d + 3] = pal[idx * 4 + 3];
      else if (alphaOut == null) dst[d + 3] = 255;
    }
  }
}

// Decode a single BC4-style alpha/grayscale block (8 bytes): two 8-bit
// endpoints + 16 × 3-bit indices. Calls `write(x,y,value)` for each texel.
function decodeAlphaBlock(b, off, bx, by, dstW, dstH, write) {
  const a0 = b[off], a1 = b[off + 1];
  const a = new Int32Array(8);
  a[0] = a0; a[1] = a1;
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) a[i + 1] = (((7 - i) * a0 + i * a1) / 7) | 0;
  } else {
    for (let i = 1; i < 5; i++) a[i + 1] = (((5 - i) * a0 + i * a1) / 5) | 0;
    a[6] = 0; a[7] = 255;
  }
  // 48 bits of 3-bit indices, little-endian starting at byte off+2.
  let lo = b[off + 2] | (b[off + 3] << 8) | (b[off + 4] << 16);
  let hi = b[off + 5] | (b[off + 6] << 8) | (b[off + 7] << 16);
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const t = py * 4 + px;
      let idx;
      if (t < 8) { idx = (lo >> (3 * t)) & 7; }
      else { idx = (hi >> (3 * (t - 8))) & 7; }
      const x = bx + px, y = by + py;
      if (x < dstW && y < dstH) write(x, y, a[idx]);
    }
  }
}

// Decode a BCn-compressed surface (kind: bc1/bc2/bc3/bc4/bc5) into RGBA.
function decodeBcn(b, off, width, height, kind) {
  const px = width * height;
  if (px <= 0 || px > 64_000_000) return null;
  const dst = new Uint8ClampedArray(px * 4);
  const blocksX = (width + 3) >> 2;
  const blocksY = (height + 3) >> 2;
  const blockBytes = (kind === 'bc1' || kind === 'bc4') ? 8 : 16;
  const need = blocksX * blocksY * blockBytes;
  if (off + need > b.length) return null;

  let p = off;
  for (let byb = 0; byb < blocksY; byb++) {
    for (let bxb = 0; bxb < blocksX; bxb++) {
      const bx = bxb * 4, by = byb * 4;
      if (kind === 'bc1') {
        decodeColorBlock(b, p, dst, width, height, bx, by, true, null);
        p += 8;
      } else if (kind === 'bc2') {
        // 8 bytes explicit 4-bit alpha, then a BC1 colour block.
        for (let py = 0; py < 4; py++) {
          const aRow = b[p + py * 2] | (b[p + py * 2 + 1] << 8);
          for (let pxi = 0; pxi < 4; pxi++) {
            const x = bx + pxi, y = by + py;
            if (x < width && y < height) {
              const a4 = (aRow >> (4 * pxi)) & 0x0f;
              dst[(y * width + x) * 4 + 3] = (a4 << 4) | a4;
            }
          }
        }
        decodeColorBlock(b, p + 8, dst, width, height, bx, by, false, true);
        p += 16;
      } else if (kind === 'bc3') {
        // BC4-style interpolated alpha, then a BC1 colour block.
        decodeAlphaBlock(b, p, bx, by, width, height, (x, y, v) => { dst[(y * width + x) * 4 + 3] = v; });
        decodeColorBlock(b, p + 8, dst, width, height, bx, by, false, true);
        p += 16;
      } else if (kind === 'bc4') {
        // Single channel -> grayscale, opaque.
        decodeAlphaBlock(b, p, bx, by, width, height, (x, y, v) => {
          const d = (y * width + x) * 4; dst[d] = dst[d + 1] = dst[d + 2] = v; dst[d + 3] = 255;
        });
        p += 8;
      } else if (kind === 'bc5') {
        // Two channels (R then G); reconstruct B as a normal-map Z, opaque.
        decodeAlphaBlock(b, p, bx, by, width, height, (x, y, v) => { dst[(y * width + x) * 4] = v; });
        decodeAlphaBlock(b, p + 8, bx, by, width, height, (x, y, v) => {
          const d = (y * width + x) * 4;
          dst[d + 1] = v;
          // Reconstruct Z assuming a unit normal: nz = sqrt(1 - nx^2 - ny^2).
          const nx = dst[d] / 127.5 - 1, ny = v / 127.5 - 1;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          dst[d + 2] = Math.round((nz * 0.5 + 0.5) * 255);
          dst[d + 3] = 255;
        });
        p += 16;
      }
    }
  }
  return dst;
}

// Decode an uncompressed 32-bit RGBA/BGRA surface using the pixel-format masks.
function decodeDdsUncompressed(b, off, width, height, rMask, gMask, bMask, aMask) {
  const px = width * height;
  if (px <= 0 || px > 64_000_000) return null;
  if (off + px * 4 > b.length) return null;
  const dst = new Uint8ClampedArray(px * 4);
  // Build a shift/scale for each channel mask (handles RGBA vs BGRA, etc.).
  const chan = (mask) => {
    if (!mask) return null;
    let shift = 0; let m = mask;
    while (!(m & 1)) { m >>= 1; shift++; }
    let bitsCount = 0; let mm = m;
    while (mm & 1) { mm >>= 1; bitsCount++; }
    return { shift, max: (1 << bitsCount) - 1 };
  };
  const rc = chan(rMask), gc = chan(gMask), bc = chan(bMask), ac = chan(aMask);
  const get = (v, c) => c ? Math.round(((v >>> c.shift) & c.max) / c.max * 255) : 0;
  for (let i = 0; i < px; i++) {
    const s = off + i * 4;
    const v = (b[s] | (b[s + 1] << 8) | (b[s + 2] << 16) | (b[s + 3] << 24)) >>> 0;
    const d = i * 4;
    dst[d] = get(v, rc); dst[d + 1] = get(v, gc); dst[d + 2] = get(v, bc);
    dst[d + 3] = ac ? get(v, ac) : 255;
  }
  return dst;
}

// =====================================================================
//                   OpenEXR (metadata only)
// =====================================================================
async function parseExr(file) {
  const b = await readAll(file, 64 * 1024);
  if (!(b[0] === 0x76 && b[1] === 0x2f && b[2] === 0x31 && b[3] === 0x01)) return null;
  const r = new Reader(b, true);
  r.seek(4);
  const version = r.u8();
  const flags = b[5] | (b[6] << 8) | (b[7] << 16);
  const out = {
    'Format': 'OpenEXR',
    'Version': version,
    'Type': (flags & 0x200) ? 'tiled' : 'scanline',
  };
  if (flags & 0x400) out['Long names'] = 'yes';
  if (flags & 0x1000) out['Multi-part'] = 'yes';
  if (flags & 0x800) out['Deep data'] = 'yes';
  // Walk attribute headers: name\0 type\0 size(i32) value...
  try {
    let p = 8;
    const COMP = ['none', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB'];
    while (p < b.length - 1) {
      if (b[p] === 0) break;                 // end of header
      let name = ''; while (p < b.length && b[p]) name += String.fromCharCode(b[p++]); p++;
      let type = ''; while (p < b.length && b[p]) type += String.fromCharCode(b[p++]); p++;
      const dv = new DataView(b.buffer, b.byteOffset);
      const size = dv.getInt32(p, true); p += 4;
      const valStart = p;
      if (name === 'channels') {
        const chans = [];
        let q = valStart;
        while (q < valStart + size && b[q]) {
          let cn = ''; while (q < b.length && b[q]) cn += String.fromCharCode(b[q++]); q++;
          q += 16; // pixelType(i32)+pLinear(u8)+reserved(3)+xSampling(i32)+ySampling(i32)
          chans.push(cn);
          if (chans.length > 64) break;
        }
        out['Channels'] = chans.join(', ');
      } else if (name === 'compression' && size >= 1) {
        out['Compression'] = COMP[b[valStart]] || ('id ' + b[valStart]);
      } else if (name === 'dataWindow' && size >= 16) {
        const x0 = dv.getInt32(valStart, true), y0 = dv.getInt32(valStart + 4, true), x1 = dv.getInt32(valStart + 8, true), y1 = dv.getInt32(valStart + 12, true);
        out['Data window'] = (x1 - x0 + 1) + ' × ' + (y1 - y0 + 1);
      } else if (name === 'displayWindow' && size >= 16) {
        const x0 = dv.getInt32(valStart, true), y0 = dv.getInt32(valStart + 4, true), x1 = dv.getInt32(valStart + 8, true), y1 = dv.getInt32(valStart + 12, true);
        out['Display window'] = (x1 - x0 + 1) + ' × ' + (y1 - y0 + 1);
      }
      p = valStart + size;
      if (p <= valStart) break;
    }
  } catch (_) {}
  out['Note'] = 'HALF/FLOAT scanline data; tonemapped decode needs an EXR codec (not bundled).';
  return out;
}

// =====================================================================
//                   JPEG 2000 family (metadata only)
// =====================================================================
async function parseJp2(file, ext) {
  const b = await readAll(file, 64 * 1024);
  const out = { 'Format': 'JPEG 2000' };
  // Raw codestream (.j2k/.j2c/.jpc) starts FF 4F FF 51 (SOC + SIZ)
  const isCodestream = (b[0] === 0xff && b[1] === 0x4f) || ext === 'j2k' || ext === 'j2c' || ext === 'jpc';
  if (b[0] === 0xff && b[1] === 0x4f) {
    out['Container'] = 'raw codestream (J2K)';
    const siz = findBytes(b, [0xff, 0x51], 0, 64);
    if (siz >= 0) readSiz(b, siz + 4, out);
    await decodeJp2Preview(file, out);
    return out;
  }
  // JP2 box structure: [u32 length][4cc type]...
  if (!(ascii(b, 4, 4) === 'jP  ' || ascii(b, 4, 4) === 'jP2 ')) {
    if (!isCodestream) return null;
  }
  out['Container'] = ext === 'jpx' ? 'JPX (extended)' : ext === 'jpf' ? 'JPF (JPX)' : 'JP2';
  try {
    let p = 0;
    const dv = new DataView(b.buffer, b.byteOffset);
    while (p + 8 <= b.length) {
      let len = dv.getUint32(p, false);
      const type = ascii(b, p + 4, 4);
      let hdr = 8;
      if (len === 1) { len = Number(dv.getBigUint64(p + 8, false)); hdr = 16; }
      if (len === 0) len = b.length - p;
      if (type === 'jp2h' || type === 'ftyp') {
        // descend into jp2h for ihdr/colr
        if (type === 'jp2h') {
          let q = p + hdr;
          while (q + 8 <= p + len && q + 8 <= b.length) {
            const blen = dv.getUint32(q, false);
            const btype = ascii(b, q + 4, 4);
            if (btype === 'ihdr') {
              const h = dv.getUint32(q + 8, false);
              const w = dv.getUint32(q + 12, false);
              const nc = dv.getUint16(q + 16, false);
              const bpc = b[q + 18];
              out['Dimensions'] = w + ' × ' + h;
              out['Components'] = nc;
              out['Bit depth'] = ((bpc & 0x7f) + 1) + '-bit' + (bpc & 0x80 ? ' signed' : '');
            } else if (btype === 'colr') {
              const meth = b[q + 8];
              if (meth === 1) { const cs = dv.getUint32(q + 11, false); out['Color space'] = cs === 16 ? 'sRGB' : cs === 17 ? 'grayscale' : cs === 18 ? 'sYCC' : ('enum ' + cs); }
              else out['Color space'] = 'ICC profile';
            }
            if (blen <= 0) break;
            q += blen;
          }
        }
      }
      if (len <= 0) break;
      p += len;
      if (p > 60000) break;
    }
  } catch (_) {}
  await decodeJp2Preview(file, out);
  return out;
}

// Lazily decode a JPEG 2000 file to a scaled <canvas> preview via the vendored
// OpenJPEG WASM codec. Additive + fully guarded: on any failure the metadata
// readout is left untouched (with a note), and existing image handling is never
// affected. The ~360 KB decoder only loads when a JPEG 2000 file is opened.
async function decodeJp2Preview(file, out) {
  try {
    const { decodeJ2K } = await import('../lib/openjpeg-loader.js');
    const bytes = await readAll(file, 96 * 1024 * 1024);
    const res = await decodeJ2K(bytes);
    if (res && res.rgba) {
      const preview = canvasFromRGBA(res.rgba, res.width, res.height);
      if (preview) {
        out._previewNode = preview;
        if (!out['Dimensions']) out['Dimensions'] = res.width + ' × ' + res.height;
        return;
      }
    }
  } catch (_) { /* keep metadata-only */ }
  out['Note'] = 'JPEG 2000 wavelet image; pixel preview unavailable.';
}

function readSiz(b, off, out) {
  try {
    const dv = new DataView(b.buffer, b.byteOffset);
    const xsiz = dv.getUint32(off + 2, false);
    const ysiz = dv.getUint32(off + 6, false);
    const xosiz = dv.getUint32(off + 10, false);
    const yosiz = dv.getUint32(off + 14, false);
    const comps = dv.getUint16(off + 34, false);
    out['Dimensions'] = (xsiz - xosiz) + ' × ' + (ysiz - yosiz);
    out['Components'] = comps;
  } catch (_) {}
}

// =====================================================================
//                   JPEG XR (.jxr/.wdp/.hdp, metadata only)
// =====================================================================
async function parseJxr(file) {
  const b = await readAll(file, 64 * 1024);
  // II + 0xBC + version
  if (!(b[0] === 0x49 && b[1] === 0x49 && b[2] === 0xbc)) return null;
  const r = new Reader(b, true);
  r.seek(4);
  const ifdOff = r.u32();
  const out = { 'Format': 'JPEG XR (HD Photo)' };
  try {
    if (ifdOff && ifdOff + 2 <= b.length) {
      const rr = new Reader(b, true); rr.seek(ifdOff);
      const count = rr.u16();
      let width, height, pfGuid;
      for (let i = 0; i < count && rr.tell() + 12 <= b.length; i++) {
        const tag = rr.u16();
        const type = rr.u16();
        const cnt = rr.u32();
        const valOff = rr.tell();
        const readVal = () => {
          const v = new Reader(b, true); v.seek(valOff);
          return type === 3 ? v.u16() : v.u32();
        };
        if (tag === 0xbc80) width = readVal();
        else if (tag === 0xbc81) height = readVal();
        else if (tag === 0xbc01) {       // pixel format GUID (16 bytes, often inline via offset)
          const po = (type === 1 && cnt === 16) ? (new Reader(b, true).seek(valOff).u32()) : valOff;
          if (po + 16 <= b.length) pfGuid = guidStr(b, po);
        }
        rr.seek(valOff + 4);
      }
      if (width && height) out['Dimensions'] = width + ' × ' + height;
      if (pfGuid) { out['Pixel format GUID'] = pfGuid; const pn = JXR_PF[pfGuid]; if (pn) out['Pixel format'] = pn; }
    }
  } catch (_) {}
  out['Note'] = 'Microsoft JPEG XR / HD Photo; pixel decode needs a JXR codec (not bundled).';
  return out;
}
function guidStr(b, o) {
  const h = (i) => b[o + i].toString(16).padStart(2, '0');
  return (h(3) + h(2) + h(1) + h(0) + '-' + h(5) + h(4) + '-' + h(7) + h(6) + '-' + h(8) + h(9) + '-' + h(10) + h(11) + h(12) + h(13) + h(14) + h(15)).toUpperCase();
}
const JXR_PF = {
  '24C3DD6F-034E-4E4C-BD3C-C7B524B6B12C': '24bpp BGR',
  '57A37CAA-737C-4FE4-9B7A-3B71C7DBAFC5': '24bpp RGB',
  '6FDDC324-4E03-4BFE-B185-3D77768DC908': '128bpp RGBA Float (HDR)',
};

// =====================================================================
//                   EPS / PostScript (metadata only)
// =====================================================================
async function parseEps(file, ext) {
  const head = await readAll(file, 32 * 1024);
  let txt;
  // EPS may have a binary DOS header (C5 D0 D3 C6); the PS stream offset is at byte 4.
  if (head[0] === 0xc5 && head[1] === 0xd0 && head[2] === 0xd3 && head[3] === 0xc6) {
    const psStart = head[4] | (head[5] << 8) | (head[6] << 16) | (head[7] << 24);
    txt = latin1(head.subarray(Math.min(psStart, head.length)));
    if (!/^%!/.test(txt)) txt = latin1(head);
  } else {
    txt = latin1(head);
  }
  if (!/%!PS/.test(txt) && !/%!/.test(txt)) return null;
  const isEps = ext === 'eps' || ext === 'epsf' || ext === 'epsi' || /EPSF-/.test(txt);
  const out = { 'Format': isEps ? 'Encapsulated PostScript (EPS)' : 'PostScript' };
  const m1 = txt.match(/%!PS-Adobe-([\d.]+)(?:\s+EPSF-([\d.]+))?/);
  if (m1) { out['PostScript level'] = 'Adobe ' + m1[1]; if (m1[2]) out['EPSF version'] = m1[2]; }
  const dsc = (k) => { const m = txt.match(new RegExp('^%%' + k + ':\\s*(.+)$', 'im')); return m ? m[1].trim() : null; };
  const bbox = dsc('BoundingBox');
  if (bbox && !/atend/i.test(bbox)) {
    out['Bounding box'] = bbox;
    const n = bbox.split(/\s+/).map(Number);
    if (n.length === 4) out['Dimensions'] = (n[2] - n[0]) + ' × ' + (n[3] - n[1]) + ' pt';
  }
  const creator = dsc('Creator'); if (creator) out['Creator'] = creator;
  const title = dsc('Title'); if (title) out['Title'] = title;
  const cdate = dsc('CreationDate'); if (cdate) out['Creation date'] = cdate;
  const forr = dsc('For'); if (forr) out['Author'] = forr;
  const pages = dsc('Pages'); if (pages) out['Pages'] = pages;
  const llm = txt.match(/%%LanguageLevel:\s*(\d+)/i); if (llm) out['Language level'] = llm[1];
  if (/%%BeginPreview/i.test(txt)) out['Embedded preview'] = 'EPSI (ASCII)';
  else if (txt.includes('TIFF') && isEps) out['Embedded preview'] = 'TIFF/WMF (DOS EPS)';
  out['Note'] = 'PostScript vector graphics; the first page is rasterized with a bundled Ghostscript (WASM) interpreter.';

  // Rendered preview: build a placeholder synchronously (renderProprietary
  // appends _previewNode before this async work continues), then lazy-load the
  // ~15 MB Ghostscript WASM and rasterize the first page to a PNG. Any failure
  // (load, render, no output) leaves the metadata rows untouched.
  try {
    const stage = el('div', {
      class: 'anr-eps-stage',
      style: 'min-height:48px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#0000 0% 25%, rgba(127,127,127,.12) 0% 50%) 0 0/16px 16px;border-radius:8px;overflow:hidden;',
    }, el('div', { style: 'font-size:11px;opacity:.6;padding:12px;' }, 'Rendering with Ghostscript…'));
    const preview = el('div', { class: 'anr-img-preview' }, [stage]);
    out._previewNode = preview;
    // Fire-and-forget; the placeholder is already in the DOM by the time this resolves.
    (async () => {
      let url = null;
      try {
        const bytes = await readAll(file);
        const { renderPostScript } = await import('../lib/ghostscript-loader.js');
        const blob = await renderPostScript(bytes, ext);
        if (!blob) { stage.remove(); return; }
        url = URL.createObjectURL(blob);
        const img = el('img', {
          src: url,
          alt: 'EPS/PostScript preview',
          style: 'display:block;max-width:100%;max-height:520px;width:auto;height:auto;background:#fff;',
        });
        img.addEventListener('load', () => { if (url) { URL.revokeObjectURL(url); url = null; } }, { once: true });
        img.addEventListener('error', () => { if (url) { URL.revokeObjectURL(url); url = null; } stage.remove(); }, { once: true });
        stage.replaceChildren(img);
        stage.style.background = '';
      } catch (_) {
        if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
        try { stage.remove(); } catch (e) {}
      }
    })();
  } catch (_) { /* no preview; metadata rows still returned */ }

  return out;
}

// =====================================================================
//                   WMF / EMF / EMZ (metadata only)
// =====================================================================
async function parseMetafile(file, ext) {
  let b = await readAll(file, 256 * 1024);
  if (ext === 'emz') {
    // gzip-wrapped EMF
    if (b[0] === 0x1f && b[1] === 0x8b) {
      return { 'Format': 'Compressed EMF (.emz)', 'Note': 'Gzip-compressed Enhanced Metafile; inflate to read EMR_HEADER bounds (decoder not bundled here).' };
    }
  }
  const r = new Reader(b, true);
  // Placeable WMF: D7 CD C6 9A
  if (b[0] === 0xd7 && b[1] === 0xcd && b[2] === 0xc6 && b[3] === 0x9a) {
    r.seek(6);
    const left = r.i16(), top = r.i16(), right = r.i16(), bottom = r.i16();
    const inch = r.u16();
    return {
      'Format': 'Windows Metafile (placeable WMF)',
      'Bounds': left + ',' + top + ' – ' + right + ',' + bottom,
      'Dimensions': Math.abs(right - left) + ' × ' + Math.abs(bottom - top) + ' units',
      'Units/inch': inch,
    };
  }
  // Standard WMF header: type 1/2, headerSize 9 words (0x0009)
  if ((b[0] === 0x01 || b[0] === 0x02) && b[1] === 0x00 && b[2] === 0x09 && b[3] === 0x00) {
    r.seek(0);
    const type = r.u16();
    return {
      'Format': 'Windows Metafile (WMF)',
      'Type': type === 1 ? 'memory' : 'disk',
      'Note': 'No placeable header (no bounds); record-level parse not bundled.',
    };
  }
  // EMF: first record type = 1 (EMR_HEADER), signature " EMF" (0x464D4520) at offset 40
  if (ascii(b, 40, 4) === ' EMF') {
    r.seek(8);
    const boundsL = r.i32(), boundsT = r.i32(), boundsR = r.i32(), boundsB = r.i32();
    const frameL = r.i32(), frameT = r.i32(), frameR = r.i32(), frameB = r.i32();
    r.seek(48);
    const nBytes = r.u32();
    const nRecords = r.u32();
    const nHandles = r.u16();
    r.seek(72);
    const descLen = r.u32();
    const descOff = r.u32();
    const out = {
      'Format': 'Enhanced Metafile (EMF)',
      'Device bounds': boundsL + ',' + boundsT + ' – ' + boundsR + ',' + boundsB,
      'Dimensions': (boundsR - boundsL) + ' × ' + (boundsB - boundsT) + ' px',
      'Frame (0.01mm)': (frameR - frameL) + ' × ' + (frameB - frameT),
      'Records': nRecords,
      'Handles': nHandles,
      'File size (header)': fmtBytes(nBytes),
    };
    if (descLen && descOff && descOff + descLen * 2 <= b.length) {
      let s = ''; for (let i = 0; i < descLen; i++) { const c = b[descOff + i * 2] | (b[descOff + i * 2 + 1] << 8); if (c) s += String.fromCharCode(c); else s += ' '; }
      const desc = s.replace(/\s+/g, ' ').trim();
      if (desc) out['Description'] = desc;
    }
    return out;
  }
  return null;
}

// =====================================================================
//                   ICNS (Apple Icon Image)
// =====================================================================
const ICNS_TYPES = {
  'ICON': '32×32 1-bit', 'ICN#': '32×32 1-bit+mask', 'icm#': '16×12', 'icm4': '16×12 4-bit', 'icm8': '16×12 8-bit',
  'ics#': '16×16 1-bit', 'ics4': '16×16 4-bit', 'ics8': '16×16 8-bit', 'is32': '16×16 RGB', 's8mk': '16×16 mask',
  'icl4': '32×32 4-bit', 'icl8': '32×32 8-bit', 'il32': '32×32 RGB', 'l8mk': '32×32 mask',
  'ich#': '48×48', 'ich4': '48×48 4-bit', 'ich8': '48×48 8-bit', 'ih32': '48×48 RGB', 'h8mk': '48×48 mask',
  'it32': '128×128 RGB', 't8mk': '128×128 mask',
  'icp4': '16×16', 'icp5': '32×32', 'icp6': '64×64',
  'ic07': '128×128', 'ic08': '256×256', 'ic09': '512×512', 'ic10': '1024×1024 (512@2x)',
  'ic11': '32×32@2x', 'ic12': '64×64@2x', 'ic13': '256×256@2x', 'ic14': '512×512@2x',
  'TOC ': 'table of contents', 'icnV': 'icon composer version', 'info': 'info plist',
};
async function parseIcns(file) {
  const b = await readAll(file, 4 * 1024 * 1024);
  if (ascii(b, 0, 4) !== 'icns') return null;
  const r = new Reader(b); // big-endian
  r.seek(4);
  const total = r.u32();
  const out = { 'Format': 'Apple Icon Image (ICNS)', 'File size (header)': fmtBytes(total) };
  const entries = [];
  let pngEntry = null;
  try {
    let p = 8;
    while (p + 8 <= b.length && p < total) {
      const type = ascii(b, p, 4);
      const dv = new DataView(b.buffer, b.byteOffset);
      const len = dv.getUint32(p, false) === 0 ? 0 : (function () { const rr = new Reader(b); rr.seek(p + 4); return rr.u32(); })();
      if (len < 8 || p + len > b.length) break;
      if (type !== 'TOC ' && type !== 'icnV' && type !== 'info') {
        entries.push(type + (ICNS_TYPES[type] ? '  (' + ICNS_TYPES[type] + ')' : ''));
        // capture an embedded PNG sub-icon for preview
        if (!pngEntry && b[p + 8] === 0x89 && b[p + 9] === 0x50 && b[p + 10] === 0x4e && b[p + 11] === 0x47) {
          pngEntry = { off: p + 8, len: len - 8 };
        }
      }
      p += len;
      if (entries.length > 64) break;
    }
  } catch (_) {}
  out['Icon variants'] = entries.length;
  if (entries.length) out._sections = [{ title: 'Embedded icons (' + entries.length + ')', node: preBlock(entries.join('\n')) }];
  // Preview the largest embedded PNG via a blob URL.
  if (pngEntry) {
    try {
      const blob = new Blob([b.subarray(pngEntry.off, pngEntry.off + pngEntry.len)], { type: 'image/png' });
      const img = el('img', { style: 'max-width:256px;max-height:256px;image-rendering:auto;margin-top:12px;border:1px solid var(--anr-border,#3a3a3a);' });
      img.src = URL.createObjectURL(blob);
      img.onload = () => URL.revokeObjectURL(img.src);
      out._previewNode = el('div', { class: 'anr-img-preview' }, [img, el('div', { style: 'font-size:11px;opacity:.6;margin-top:4px;' }, 'Embedded PNG sub-icon')]);
    } catch (_) {}
  }
  return out;
}

// =====================================================================
//                   CUR / ANI (Windows cursors)
// =====================================================================
async function parseCur(file) {
  const b = await readAll(file, 256 * 1024);
  // ICO/CUR header: reserved(0) type(2=CUR) count
  if (!(b[0] === 0 && b[1] === 0 && b[2] === 0x02 && b[3] === 0)) return null;
  const r = new Reader(b, true);
  r.seek(4);
  const count = r.u16();
  const out = { 'Format': 'Windows Cursor (.cur)', 'Images': count };
  const list = [];
  for (let i = 0; i < count && i < 64; i++) {
    const off = 6 + i * 16;
    if (off + 16 > b.length) break;
    const w = b[off] || 256, h = b[off + 1] || 256;
    const hotX = b[off + 4] | (b[off + 5] << 8);
    const hotY = b[off + 6] | (b[off + 7] << 8);
    list.push(w + '×' + h + '  hotspot ' + hotX + ',' + hotY);
  }
  if (list.length) out._sections = [{ title: 'Cursor images', node: preBlock(list.join('\n')) }];
  return out;
}

async function parseAni(file) {
  const b = await readAll(file, 1024 * 1024);
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'ACON') return null;
  const out = { 'Format': 'Windows Animated Cursor (.ani)' };
  try {
    let p = 12;
    let frames = 0, steps = 0, rate = null, jifRate = null;
    while (p + 8 <= b.length) {
      const id = ascii(b, p, 4);
      const dv = new DataView(b.buffer, b.byteOffset);
      const sz = dv.getUint32(p + 4, true);
      if (id === 'anih' && sz >= 36) {
        const nFrames = dv.getUint32(p + 8 + 4, true);
        const nSteps = dv.getUint32(p + 8 + 8, true);
        jifRate = dv.getUint32(p + 8 + 28, true);
        frames = nFrames; steps = nSteps;
      } else if (id === 'rate') {
        rate = sz / 4 + ' entries';
      } else if (id === 'INAM' || id === 'IART') {
        const s = ascii(b, p + 8, Math.min(sz, 128)).replace(/\0+$/, '');
        if (s) out[id === 'INAM' ? 'Title' : 'Artist'] = s;
      }
      p += 8 + sz + (sz & 1);
      if (p > 1_000_000) break;
    }
    out['Frames'] = frames;
    if (steps) out['Animation steps'] = steps;
    if (jifRate) out['Default rate'] = jifRate + ' jiffies (' + (jifRate / 60).toFixed(2) + ' s/frame)';
  } catch (_) {}
  return out;
}

// =====================================================================
//                   MNG (Multiple-image Network Graphics)
// =====================================================================
async function parseMng(file) {
  const b = await readAll(file, 64 * 1024);
  if (!(b[0] === 0x8a && b[1] === 0x4d && b[2] === 0x4e && b[3] === 0x47)) return null;  // \212 MNG
  // MHDR chunk follows the 8-byte signature.
  const r = new Reader(b); // big-endian
  r.seek(8);
  const len = r.u32();
  const type = ascii(b, 12, 4);
  if (type !== 'MHDR') return { 'Format': 'MNG (Multiple-image Network Graphics)' };
  r.seek(16);
  const width = r.u32();
  const height = r.u32();
  const ticks = r.u32();
  const layerCount = r.u32();
  const frameCount = r.u32();
  const playTime = r.u32();
  const out = {
    'Format': 'MNG (Multiple-image Network Graphics)',
    'Dimensions': width + ' × ' + height,
    'Ticks per second': ticks || 'unspecified',
    'Frame count': frameCount === 0x7fffffff ? 'unspecified' : frameCount,
    'Layer count': layerCount === 0x7fffffff ? 'unspecified' : layerCount,
  };
  if (playTime && playTime !== 0x7fffffff && ticks) out['Play time'] = (playTime / ticks).toFixed(2) + ' s';
  out['Note'] = 'PNG-based animation container; frame decode (embedded PNG/JNG datastreams) not bundled.';
  return out;
}

// =====================================================================
//                   Lottie (.lottie / Bodymovin JSON)
// =====================================================================
async function parseLottie(file) {
  // dotLottie = ZIP container (PK magic) -> identify only.
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) {
    return { 'Format': 'dotLottie (.lottie)', 'Container': 'ZIP', 'Note': 'Packaged Lottie (animation JSON + assets inside a ZIP). Identification only; open the archive to inspect.' };
  }
  let j;
  try { j = JSON.parse(await file.slice(0, Math.min(file.size, 16 * 1024 * 1024)).text()); } catch (_) { return null; }
  if (!j || (j.v == null && !Array.isArray(j.layers))) return null;   // not a Bodymovin doc
  const out = { 'Format': 'Lottie (Bodymovin JSON)' };
  if (j.v) out['Bodymovin version'] = j.v;
  if (j.nm) out['Name'] = j.nm;
  if (j.w && j.h) out['Composition size'] = j.w + ' × ' + j.h;
  const fr = j.fr || 0;
  if (fr) out['Frame rate'] = fr + ' fps';
  if (j.ip != null && j.op != null) {
    out['In / out point'] = j.ip + ' → ' + j.op;
    if (fr) out['Duration'] = ((j.op - j.ip) / fr).toFixed(2) + ' s';
    out['Frames'] = (j.op - j.ip);
  }
  const layers = Array.isArray(j.layers) ? j.layers : [];
  out['Layers'] = layers.length;
  if (Array.isArray(j.assets)) out['Assets'] = j.assets.length;
  if (Array.isArray(j.markers) && j.markers.length) out['Markers'] = j.markers.length;
  // Layer type breakdown
  const LTYPE = { 0: 'precomp', 1: 'solid', 2: 'image', 3: 'null', 4: 'shape', 5: 'text', 6: 'audio' };
  const byType = {};
  for (const ly of layers) { const t = LTYPE[ly.ty] || ('type ' + ly.ty); byType[t] = (byType[t] || 0) + 1; }
  const sects = [];
  if (Object.keys(byType).length) out['Layer types'] = Object.entries(byType).map(([k, v]) => k + ' (' + v + ')').join(', ');
  if (Array.isArray(j.markers) && j.markers.length) {
    sects.push({ title: 'Markers (' + j.markers.length + ')', node: preBlock(j.markers.slice(0, 50).map((m) => (m.cm || '?') + ' @ ' + (m.tm != null ? m.tm : '?')).join('\n')) });
  }
  if (sects.length) out._sections = sects;

  // Live playback: build the container synchronously (renderProprietary appends
  // _previewNode before this function's async work continues), then lazy-load
  // lottie-web and play. Any failure leaves the metadata rows untouched.
  try {
    const aspect = (j.w && j.h) ? (j.h / j.w) : (9 / 16);
    const stage = el('div', {
      class: 'anr-lottie-stage',
      style: 'width:100%;max-width:360px;aspect-ratio:' + (j.w || 16) + ' / ' + (j.h || 9) + ';margin:0 auto;background:repeating-conic-gradient(#0000 0% 25%, rgba(127,127,127,.12) 0% 50%) 0 0/16px 16px;border-radius:8px;overflow:hidden;',
    });
    // aspect-ratio fallback for older engines.
    if (!('aspectRatio' in stage.style) || stage.style.aspectRatio === '') {
      stage.style.height = Math.round(360 * aspect) + 'px';
    }
    const preview = el('div', { class: 'anr-img-preview' }, [
      stage,
      el('div', { style: 'font-size:11px;opacity:.6;margin-top:4px;text-align:center;' }, 'Live Lottie playback'),
    ]);
    out._previewNode = preview;
    // Fire-and-forget; the div is already in the DOM by the time this resolves.
    (async () => {
      try {
        if (!(window.lottie && window.lottie.loadAnimation)) await loadScript('assets/vendor/lottie/lottie.min.js');
        if (window.lottie && window.lottie.loadAnimation) {
          window.lottie.loadAnimation({ container: stage, renderer: 'svg', loop: true, autoplay: true, animationData: j });
        }
      } catch (_) { /* leave the placeholder stage; metadata stays intact */ }
    })();
  } catch (_) { /* no preview; metadata rows still returned */ }

  return out;
}

// =====================================================================
//                   identification-only (rare AND hard)
// =====================================================================
function ident(name, note) { return () => ({ 'Format': name, 'Note': note }); }

// =====================================================================
//                   dispatch
// =====================================================================
export const PARSERS = {
  // --- fully decoded (pure-JS) ---
  tga: (c) => parseTga(c.file),
  icb: (c) => parseTga(c.file),
  vda: (c) => parseTga(c.file),
  vst: (c) => parseTga(c.file),
  qoi: (c) => parseQoi(c.file),
  ppm: (c) => parseNetpbm(c.file),
  pgm: (c) => parseNetpbm(c.file),
  pbm: (c) => parseNetpbm(c.file),
  pnm: (c) => parseNetpbm(c.file),
  pam: (c) => parseNetpbm(c.file),
  pcx: (c) => parsePcx(c.file),
  ff: (c) => parseFarbfeld(c.file),
  farbfeld: (c) => parseFarbfeld(c.file),
  wbmp: (c) => parseWbmp(c.file),
  xbm: (c) => parseXbm(c.file),
  xpm: (c) => parseXpm(c.file),
  ras: (c) => parseSunRaster(c.file),
  sun: (c) => parseSunRaster(c.file),
  sgi: (c) => parseSgi(c.file),
  bw: (c) => parseSgi(c.file),
  // --- metadata only (heavy codec gated) ---
  hdr: (c) => parseHdr(c.file),
  dds: (c) => parseDds(c.file),
  exr: (c) => parseExr(c.file),
  jp2: (c) => parseJp2(c.file, c.ext),
  j2k: (c) => parseJp2(c.file, c.ext),
  jpf: (c) => parseJp2(c.file, c.ext),
  jpx: (c) => parseJp2(c.file, c.ext),
  jpc: (c) => parseJp2(c.file, c.ext),
  j2c: (c) => parseJp2(c.file, c.ext),
  jxr: (c) => parseJxr(c.file),
  wdp: (c) => parseJxr(c.file),
  hdp: (c) => parseJxr(c.file),
  eps: (c) => parseEps(c.file, c.ext),
  epsf: (c) => parseEps(c.file, c.ext),
  epsi: (c) => parseEps(c.file, c.ext),
  ps: (c) => parseEps(c.file, c.ext),
  wmf: (c) => parseMetafile(c.file, c.ext),
  emf: (c) => parseMetafile(c.file, c.ext),
  emz: (c) => parseMetafile(c.file, c.ext),
  icns: (c) => parseIcns(c.file),
  cur: (c) => parseCur(c.file),
  ani: (c) => parseAni(c.file),
  mng: (c) => parseMng(c.file),
  lottie: (c) => parseLottie(c.file),
  // --- identification only (rare AND hard) ---
  pict: ident('Apple PICT (QuickDraw)', 'Classic Mac PICT after a 512-byte preamble; QuickDraw opcode stream. Identification only (no decoder).'),
  pct: ident('Apple PICT (QuickDraw)', 'Classic Mac PICT; QuickDraw opcode stream. Identification only.'),
  flif: ident('FLIF (Free Lossless Image Format)', 'MANIAC-entropy-coded lossless image. Identification only (no decoder).'),
  jbig2: ident('JBIG2', 'Bi-level segment-coded image (PDF scans). Identification only (no decoder).'),
  jb2: ident('JBIG2', 'JBIG2 bi-level image. Identification only.'),
  jbig: ident('JBIG (JBIG1)', 'Bi-level progressive image (fax). Identification only (no decoder).'),
  bie: ident('JBIG (BIE codestream)', 'JBIG1 bi-level entropy-coded image. Identification only.'),
  cgm: ident('Computer Graphics Metafile (CGM)', 'ISO vector metafile (aviation/S1000D). Identification only (no renderer).'),
  cdr: ident('CorelDRAW Drawing (CDR)', 'RIFF/ZIP Corel vector drawing. Identification only (no renderer).'),
};
