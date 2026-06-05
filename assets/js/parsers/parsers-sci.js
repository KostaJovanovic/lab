/* Analyser - lazy parser chunk: science / medical / engineering / simulation.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'sci'` is opened. Each entry in PARSERS is `({head, file, ext}) =>
   rows` where `rows` is a plain object of label->value pairs, optionally
   carrying `_sections: [{title, node, open?}]` for collapsible blocks and
   `_previewNode` for a decoded preview. Return null to fall back to the generic
   identification card. Dependency-free: only the shared toolkit. */

import { el, row, fmtBytes, preBlock, readSlice } from '../core/util.js';
import { Reader, ascii, findBytes, matchMagic, startsWithAscii, latin1, utf8, gunzip } from '../core/binutil.js';

// ---------- small helpers ----------

// Read up to maxBytes of a File as text (UTF-8, lossy).
async function readText(file, maxBytes = 2_000_000) {
  const slice = file.size > maxBytes ? file.slice(0, maxBytes) : file;
  try { return await slice.text(); } catch (_) { return null; }
}

// ---------- pixel preview helpers (dependency-free <canvas>) ----------
const PREVIEW_MAX_EDGE = 768;   // cap longest edge of a decoded science preview

// Build a <canvas> from an RGBA Uint8ClampedArray, scaling down (nearest) so the
// longest edge is <= PREVIEW_MAX_EDGE. Returns a wrapped node (with caption) or null.
function canvasFromRGBA(rgba, w, h, caption) {
  if (!w || !h || w < 1 || h < 1) return null;
  if (rgba.length < w * h * 4) return null;
  let dw = w, dh = h;
  const longest = Math.max(w, h);
  if (longest > PREVIEW_MAX_EDGE) {
    const s = PREVIEW_MAX_EDGE / longest;
    dw = Math.max(1, Math.round(w * s));
    dh = Math.max(1, Math.round(h * s));
  }
  try {
    const img = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h);
    let c;
    if (dw === w && dh === h) {
      c = el('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').putImageData(img, 0, 0);
    } else {
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      off.getContext('2d').putImageData(img, 0, 0);
      c = el('canvas');
      c.width = dw; c.height = dh;
      c.getContext('2d').drawImage(off, 0, 0, dw, dh);
    }
    c.style.maxWidth = '100%';
    c.style.height = 'auto';
    c.style.imageRendering = 'auto';
    c.style.background = '#000';
    const children = [c];
    if (caption) children.push(el('div', { style: 'font-size:11px;opacity:.6;margin-top:4px;' }, caption));
    return el('div', { class: 'anr-img-preview', style: 'margin-top:12px;' }, children);
  } catch (_) {
    return null;
  }
}

// Pack a grayscale Float64/typed array (length w*h) into RGBA using a window/level.
// `lo`/`hi` map to 0/255; values are clamped. `invert` flips (MONOCHROME1).
function grayToRGBA(samples, w, h, lo, hi, invert) {
  const px = w * h;
  const rgba = new Uint8ClampedArray(px * 4);
  const span = (hi - lo) || 1;
  for (let i = 0; i < px; i++) {
    let v = ((samples[i] - lo) / span) * 255;
    if (v < 0) v = 0; else if (v > 255) v = 255;
    if (invert) v = 255 - v;
    const d = i * 4;
    rgba[d] = rgba[d + 1] = rgba[d + 2] = v;
    rgba[d + 3] = 255;
  }
  return rgba;
}

// Robust low/high bounds via a 0.5 / 99.5 percentile stretch over a sample.
function percentileBounds(samples, count, loP = 0.005, hiP = 0.995) {
  const n = Math.min(count, samples.length);
  if (n <= 0) return [0, 1];
  // Sample up to ~50k values to keep the sort cheap on big volumes.
  const step = Math.max(1, Math.floor(n / 50000));
  const vals = [];
  for (let i = 0; i < n; i += step) {
    const v = samples[i];
    if (Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return [0, 1];
  vals.sort((a, b) => a - b);
  let lo = vals[Math.floor(vals.length * loP)];
  let hi = vals[Math.floor(vals.length * hiP)];
  if (!(hi > lo)) { lo = vals[0]; hi = vals[vals.length - 1]; }
  if (!(hi > lo)) hi = lo + 1;
  return [lo, hi];
}

// ============================================================================
// DICOM (.dcm / .dicom)
// ============================================================================
// Minimal VR dictionary for the few elements we surface. (group,element) hex.
const DICOM_TAGS = {
  '00080020': 'StudyDate',
  '00080060': 'Modality',
  '00080070': 'Manufacturer',
  '00080090': 'ReferringPhysician',  // patient-adjacent, redactable
  '00081030': 'StudyDescription',
  '00100010': 'PatientName',          // redactable
  '00100020': 'PatientID',            // redactable (presence only)
  '00100030': 'PatientBirthDate',     // redactable
  '00100040': 'PatientSex',           // redactable
  '00020010': 'TransferSyntaxUID',
  '00280002': 'SamplesPerPixel',
  '00280004': 'PhotometricInterpretation',
  '00280010': 'Rows',
  '00280011': 'Columns',
  '00280100': 'BitsAllocated',
  '00280101': 'BitsStored',
  '00280103': 'PixelRepresentation',  // 0 = unsigned, 1 = signed (two's complement)
  '00281050': 'WindowCenter',
  '00281051': 'WindowWidth',
  '00281052': 'RescaleIntercept',
  '00281053': 'RescaleSlope',
  '00280006': 'PlanarConfiguration',
};
// VRs that store length as a 4-byte field (explicit VR, with a 2-byte reserved).
const DICOM_VR_LONG = new Set(['OB', 'OW', 'OF', 'OD', 'OL', 'SQ', 'UT', 'UN', 'UC', 'UR']);
const TRANSFER_SYNTAX = {
  '1.2.840.10008.1.2': 'Implicit VR Little Endian',
  '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
  '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian',
  '1.2.840.10008.1.2.2': 'Explicit VR Big Endian',
  '1.2.840.10008.1.2.4.50': 'JPEG Baseline (lossy)',
  '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
  '1.2.840.10008.1.2.4.70': 'JPEG Lossless (SV1)',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.5': 'RLE Lossless',
};

async function parseDicom(file) {
  const buf = await readSlice(file, 0, Math.min(file.size, 1_000_000));
  if (buf.length < 132) return null;
  if (!(buf[128] === 0x44 && buf[129] === 0x49 && buf[130] === 0x43 && buf[131] === 0x4d)) return null; // "DICM"
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const found = {};
  // Meta header (group 0002) is always Explicit VR Little Endian. After it we
  // honour the negotiated transfer syntax for endianness/VR style.
  let pos = 132;
  let explicit = true;       // explicit VR
  let little = true;
  let metaEnd = Infinity;    // switch after group 0002
  let pixelDataOffset = -1;  // file offset of (7FE0,0010) value
  let pixelDataLen = 0;
  let datasetLittle = true;  // endianness of the dataset (post-meta)

  try {
    while (pos + 8 <= buf.length) {
      if (pos >= metaEnd) {
        // Determine dataset encoding from the transfer syntax we captured.
        const ts = (found.TransferSyntaxUID || '').replace(/\0+$/, '').trim();
        if (ts === '1.2.840.10008.1.2') { explicit = false; little = true; }
        else if (ts === '1.2.840.10008.1.2.2') { explicit = true; little = false; }
        else { explicit = true; little = true; }
        datasetLittle = little;
        metaEnd = Infinity; // only switch once
      }
      const group = dv.getUint16(pos, little);
      const elem = dv.getUint16(pos + 2, little);
      pos += 4;
      const inMeta = group === 0x0002;
      const useExplicit = inMeta ? true : explicit;
      const useLittle = inMeta ? true : little;
      let vr = '', len = 0;
      if (useExplicit) {
        vr = String.fromCharCode(buf[pos], buf[pos + 1]);
        pos += 2;
        if (DICOM_VR_LONG.has(vr)) {
          pos += 2; // reserved
          len = dv.getUint32(pos, useLittle); pos += 4;
        } else {
          len = dv.getUint16(pos, useLittle); pos += 2;
        }
      } else {
        len = dv.getUint32(pos, useLittle); pos += 4;
      }
      // When group 0002 length tag (0002,0000) is read, find where meta ends.
      const tag = group.toString(16).padStart(4, '0') + elem.toString(16).padStart(4, '0');
      if (tag === '00020000' && len === 4 && pos + 4 <= buf.length) {
        const groupLen = dv.getUint32(pos, useLittle);
        metaEnd = pos + 4 + groupLen;
      }
      if (len === 0xffffffff) break; // undefined-length SQ/pixel: stop walking
      if (len < 0 || pos + len > buf.length + 4) break;
      const want = DICOM_TAGS[tag];
      if (want) {
        if (want === 'Rows' || want === 'Columns' || want === 'BitsAllocated' ||
            want === 'BitsStored' || want === 'SamplesPerPixel' ||
            want === 'PixelRepresentation' || want === 'PlanarConfiguration') {
          if (len >= 2) found[want] = dv.getUint16(pos, useLittle);
        } else {
          const raw = ascii(buf, pos, Math.min(len, 96)).trim();
          found[want] = raw;
        }
      }
      // Stop once we hit pixel data (7FE0,0010) — record where it lives and stop.
      if (group === 0x7fe0 && elem === 0x0010) {
        // `pos` is the byte offset of the pixel data value within the file
        // (buf starts at file offset 0). len may be the full frame size, or
        // 0xffffffff (handled above) for encapsulated/compressed data.
        pixelDataOffset = pos;
        pixelDataLen = len;
        break;
      }
      pos += len;
      if (pos <= 0) break;
    }
  } catch (_) { /* partial parse is fine */ }

  const out = { 'Format': 'DICOM medical image' };
  if (found.Modality) out['Modality'] = found.Modality;
  if (found.StudyDescription) out['Study description'] = found.StudyDescription;
  if (found.StudyDate) out['Study date'] = found.StudyDate;
  if (found.Manufacturer) out['Manufacturer'] = found.Manufacturer;
  if (found.Rows != null && found.Columns != null) out['Image size'] = found.Columns + ' × ' + found.Rows;
  else { if (found.Rows != null) out['Rows'] = found.Rows; if (found.Columns != null) out['Columns'] = found.Columns; }
  if (found.BitsAllocated != null) out['Bits allocated'] = found.BitsAllocated + (found.BitsStored != null ? ' (' + found.BitsStored + ' stored)' : '');
  if (found.SamplesPerPixel != null) out['Samples per pixel'] = found.SamplesPerPixel;
  if (found.PhotometricInterpretation) out['Photometric'] = found.PhotometricInterpretation;
  if (found.TransferSyntaxUID) {
    const ts = found.TransferSyntaxUID.replace(/\0+$/, '').trim();
    out['Transfer syntax'] = (TRANSFER_SYNTAX[ts] || 'unknown') + ' (' + ts + ')';
  }
  // Patient fields: redacted, presence only.
  const pii = [];
  if (found.PatientName) pii.push('name');
  if (found.PatientID != null && found.PatientID !== '') pii.push('ID');
  if (found.PatientBirthDate) pii.push('birth date');
  if (found.PatientSex) pii.push('sex');
  if (pii.length) out['⚠ Patient data present'] = pii.join(', ') + ' (redacted)';

  // ---- pixel preview (uncompressed transfer syntaxes only) ----
  const tsClean = (found.TransferSyntaxUID || '').replace(/\0+$/, '').trim();
  const uncompressed = tsClean === '' || tsClean === '1.2.840.10008.1.2' ||
    tsClean === '1.2.840.10008.1.2.1' || tsClean === '1.2.840.10008.1.2.2';
  if (!uncompressed) {
    out['Pixel data'] = 'compressed (' + (TRANSFER_SYNTAX[tsClean] || tsClean) + ') — not rendered';
  } else {
    out['Pixel data'] = 'uncompressed';
    try {
      const node = await renderDicomPreview(file, found, {
        offset: pixelDataOffset, len: pixelDataLen, little: datasetLittle,
      });
      if (node) out._previewNode = node;
    } catch (_) { /* fall back to metadata only */ }
  }
  return out;
}

// Decode the first frame of an uncompressed DICOM image to a <canvas>.
async function renderDicomPreview(file, found, px) {
  const cols = found.Columns | 0, rows = found.Rows | 0;
  if (!cols || !rows || cols > 20000 || rows > 20000) return null;
  if (px.offset < 0 || px.offset > file.size) return null;
  const bits = found.BitsAllocated || 8;
  if (bits !== 8 && bits !== 16) return null;
  const spp = found.SamplesPerPixel || 1;
  const photo = (found.PhotometricInterpretation || '').toUpperCase();
  const rgb = spp === 3 || photo.startsWith('RGB') || photo.startsWith('YBR');
  const signed = found.PixelRepresentation === 1;
  const invert = photo === 'MONOCHROME1';
  const bytesPerSample = bits >> 3;
  const frameSamples = cols * rows * (rgb ? 3 : 1);
  const frameBytes = frameSamples * bytesPerSample;
  // Cap memory: only ever read/decode one frame, and bail on absurd sizes.
  if (frameBytes <= 0 || frameBytes > 96 * 1024 * 1024) return null;

  const buf = await readSlice(file, px.offset, frameBytes);
  if (buf.length < frameBytes) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const little = px.little;

  if (rgb) {
    // 8-bit RGB (planar config 0 = interleaved). Most uncompressed RGB is 8-bit.
    const planar = found.PlanarConfiguration === 1;
    const rgba = new Uint8ClampedArray(cols * rows * 4);
    const plane = cols * rows;
    for (let i = 0; i < plane; i++) {
      let r, g, b;
      if (bytesPerSample === 1) {
        if (planar) { r = buf[i]; g = buf[plane + i]; b = buf[2 * plane + i]; }
        else { r = buf[i * 3]; g = buf[i * 3 + 1]; b = buf[i * 3 + 2]; }
      } else {
        if (planar) { r = dv.getUint16(i * 2, little) >> 8; g = dv.getUint16((plane + i) * 2, little) >> 8; b = dv.getUint16((2 * plane + i) * 2, little) >> 8; }
        else { r = dv.getUint16(i * 6, little) >> 8; g = dv.getUint16(i * 6 + 2, little) >> 8; b = dv.getUint16(i * 6 + 4, little) >> 8; }
      }
      const d = i * 4;
      rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = 255;
    }
    return canvasFromRGBA(rgba, cols, rows, cols + ' × ' + rows + ' RGB, first frame');
  }

  // Grayscale: read samples into a typed array, apply rescale slope/intercept.
  const n = cols * rows;
  const samples = new Float64Array(n);
  const slope = parseFloat(found.RescaleSlope) || 1;
  const intercept = parseFloat(found.RescaleIntercept) || 0;
  for (let i = 0; i < n; i++) {
    let v;
    if (bytesPerSample === 1) v = signed ? (buf[i] << 24 >> 24) : buf[i];
    else v = signed ? dv.getInt16(i * 2, little) : dv.getUint16(i * 2, little);
    samples[i] = v * slope + intercept;
  }
  // Window/level: prefer the stored WindowCenter/WindowWidth, else min/max.
  let lo, hi, src;
  const wc = parseFloat((found.WindowCenter || '').split('\\')[0]);
  const ww = parseFloat((found.WindowWidth || '').split('\\')[0]);
  if (Number.isFinite(wc) && Number.isFinite(ww) && ww > 0) {
    lo = wc - ww / 2; hi = wc + ww / 2; src = 'W/L ' + wc + '/' + ww;
  } else {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { const v = samples[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    lo = mn; hi = mx > mn ? mx : mn + 1; src = 'auto min/max';
  }
  const rgba = grayToRGBA(samples, cols, rows, lo, hi, invert);
  const cap = cols + ' × ' + rows + ' grayscale, first frame (' + src + (invert ? ', inverted' : '') + ')';
  return canvasFromRGBA(rgba, cols, rows, cap);
}

// ============================================================================
// FIT (.fit) — Garmin / ANT. Disambiguated from FITS via SIMPLE sniff.
// ============================================================================
function parseFit(head, file) {
  // FITS astronomy files reuse .fit; their header begins "SIMPLE  =".
  if (startsWithAscii(head, 'SIMPLE') && /^SIMPLE\s*=/.test(ascii(head, 0, 16))) {
    return parseFits(head, file);
  }
  if (head.length < 12) return null;
  const r = new Reader(head, true);
  const headerSize = r.u8();
  if (headerSize < 12 || headerSize > 14) return null;
  const protocol = r.u8();
  const profile = r.u16();
  const dataSize = r.u32();
  const magic = ascii(head, 8, 4);
  if (magic !== '.FIT') return null;
  let headerCrc = null;
  if (headerSize >= 14) headerCrc = r.u16At(12);
  const out = {
    'Format': 'FIT activity file (Garmin/ANT)',
    'Header size': headerSize + ' bytes',
    'Protocol version': (protocol >> 4) + '.' + (protocol & 0x0f),
    'Profile version': (profile / 100).toFixed(2),
    'Data records size': fmtBytes(dataSize),
  };
  if (headerCrc != null) out['Header CRC'] = '0x' + headerCrc.toString(16).padStart(4, '0');
  out['Note'] = 'GPS track / HR / power decode is a future map render dep';
  return out;
}

// ============================================================================
// FITS (.fits / .fts / .fit-as-FITS) — 2880-byte header cards.
// ============================================================================
function fitsCards(buf) {
  // Cards are 80-byte fixed records of "KEYWORD = value / comment".
  const cards = {};
  const order = [];
  const limit = Math.min(buf.length, 2880 * 4);
  for (let off = 0; off + 80 <= limit; off += 80) {
    const card = ascii(buf, off, 80);
    const key = card.slice(0, 8).trim();
    if (key === 'END') break;
    if (!key) continue;
    if (card[8] === '=') {
      let val = card.slice(10).split('/')[0].trim();
      val = val.replace(/^'(.*)'$/, '$1').trim();
      if (!(key in cards)) { cards[key] = val; order.push(key); }
    }
  }
  return cards;
}
// Byte length of the primary header (padded to the next 2880 block), or -1.
function fitsHeaderBytes(head) {
  const limit = Math.min(head.length, 2880 * 36);
  for (let off = 0; off + 80 <= limit; off += 80) {
    if (ascii(head, off, 8).trim() === 'END') {
      return Math.ceil((off + 80) / 2880) * 2880;
    }
  }
  return -1;
}

async function parseFits(head, file) {
  if (!startsWithAscii(head, 'SIMPLE')) return null;
  const c = fitsCards(head);
  if (!('SIMPLE' in c)) return null;
  const out = { 'Format': 'FITS (Flexible Image Transport System)' };
  out['SIMPLE'] = c.SIMPLE;
  if (c.BITPIX) {
    const bp = parseInt(c.BITPIX, 10);
    const map = { 8: 'uint8', 16: 'int16', 32: 'int32', 64: 'int64', '-32': 'float32', '-64': 'float64' };
    out['BITPIX'] = c.BITPIX + (map[c.BITPIX] ? ' (' + map[c.BITPIX] + ')' : '');
  }
  const naxis = parseInt(c.NAXIS || '0', 10);
  if (c.NAXIS) {
    const dims = [];
    for (let i = 1; i <= naxis; i++) if (c['NAXIS' + i]) dims.push(c['NAXIS' + i]);
    out['Axes'] = naxis + (dims.length ? ' (' + dims.join(' × ') + ')' : '');
  }
  if (c.OBJECT) out['Object'] = c.OBJECT;
  if (c.TELESCOP) out['Telescope'] = c.TELESCOP;
  if (c.INSTRUME) out['Instrument'] = c.INSTRUME;
  if (c['DATE-OBS']) out['Date observed'] = c['DATE-OBS'];
  if (c.EXPTIME) out['Exposure time'] = c.EXPTIME + ' s';

  // ---- primary-HDU 2-D image preview (big-endian per FITS spec) ----
  const bitpix = parseInt(c.BITPIX || '0', 10);
  const nx = parseInt(c.NAXIS1 || '0', 10);
  const ny = parseInt(c.NAXIS2 || '0', 10);
  const bzero = c.BZERO != null ? parseFloat(c.BZERO) : 0;
  const bscale = c.BSCALE != null ? parseFloat(c.BSCALE) : 1;
  const FITS_BPV = { 8: 1, 16: 2, 32: 4, '-32': 4, 64: 8, '-64': 8 };
  const bpv = FITS_BPV[bitpix];
  const hdrBytes = file ? fitsHeaderBytes(head) : -1;
  if (file && bpv && naxis >= 2 && nx > 0 && ny > 0 && nx <= 16384 && ny <= 16384 && hdrBytes > 0) {
    out['Pixel data'] = 'uncompressed primary image';
    try {
      const node = await renderFitsImage(file, {
        nx, ny, bitpix, bpv, bzero: Number.isFinite(bzero) ? bzero : 0,
        bscale: Number.isFinite(bscale) && bscale !== 0 ? bscale : 1, dataOffset: hdrBytes,
      });
      if (node) out._previewNode = node;
    } catch (_) { /* metadata only */ }
  } else {
    out['Pixel data'] = 'not rendered (no 2-D primary image or unsupported BITPIX)';
  }
  return out;
}

async function renderFitsImage(file, h) {
  const px = h.nx * h.ny;
  const dataBytes = px * h.bpv;
  if (dataBytes <= 0 || dataBytes > 96 * 1024 * 1024) return null;
  if (h.dataOffset + dataBytes > file.size) return null;
  const buf = await readSlice(file, h.dataOffset, dataBytes);
  if (buf.length < dataBytes) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const samples = new Float64Array(px);
  const read = (() => {
    switch (h.bitpix) {
      case 8:   return (o) => dv.getUint8(o);
      case 16:  return (o) => dv.getInt16(o, false);
      case 32:  return (o) => dv.getInt32(o, false);
      case 64:  return (o) => Number(dv.getBigInt64(o, false));
      case -32: return (o) => dv.getFloat32(o, false);
      case -64: return (o) => dv.getFloat64(o, false);
      default:  return null;
    }
  })();
  if (!read) return null;
  for (let i = 0; i < px; i++) samples[i] = read(i * h.bpv) * h.bscale + h.bzero;
  const [lo, hi] = percentileBounds(samples, px);
  // FITS images are stored bottom-up (first row = bottom); flip vertically.
  const rgba = grayToRGBA(samples, h.nx, h.ny, lo, hi, false);
  const flipped = new Uint8ClampedArray(rgba.length);
  const rowBytes = h.nx * 4;
  for (let y = 0; y < h.ny; y++) {
    const src = y * rowBytes;
    const dst = (h.ny - 1 - y) * rowBytes;
    flipped.set(rgba.subarray(src, src + rowBytes), dst);
  }
  return canvasFromRGBA(flipped, h.nx, h.ny, h.nx + ' × ' + h.ny + ' primary HDU (percentile stretch)');
}

// ============================================================================
// TCX (.tcx) — Training Center XML
// ============================================================================
async function parseTcx(file) {
  const text = await readText(file, 8_000_000);
  if (!text || !/<TrainingCenterDatabase|<Activities|<Activity\b/.test(text)) return null;
  const sport = (text.match(/<Activity[^>]*\bSport="([^"]+)"/i) || [])[1];
  const laps = (text.match(/<Lap\b/gi) || []).length;
  const trackpoints = (text.match(/<Trackpoint\b/gi) || []).length;
  const sum = (re) => {
    let total = 0, any = false;
    for (const m of text.matchAll(re)) { const v = parseFloat(m[1]); if (!isNaN(v)) { total += v; any = true; } }
    return any ? total : null;
  };
  const dist = sum(/<DistanceMeters>([\d.]+)<\/DistanceMeters>/gi);
  const time = sum(/<TotalTimeSeconds>([\d.]+)<\/TotalTimeSeconds>/gi);
  const cals = sum(/<Calories>(\d+)<\/Calories>/gi);
  const range = (re) => {
    let lo = Infinity, hi = -Infinity, any = false;
    for (const m of text.matchAll(re)) { const v = parseFloat(m[1]); if (!isNaN(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); any = true; } }
    return any ? [lo, hi] : null;
  };
  const hr = range(/<HeartRateBpm>(?:[^<]*<Value>)?\s*(\d+)\s*</gi);
  const cad = range(/<Cadence>(\d+)<\/Cadence>/gi);
  const out = { 'Format': 'Training Center XML (TCX)' };
  if (sport) out['Sport'] = sport;
  out['Laps'] = laps;
  out['Trackpoints'] = trackpoints.toLocaleString();
  if (dist != null) out['Total distance'] = (dist / 1000).toFixed(2) + ' km';
  if (time != null) {
    const s = Math.round(time);
    out['Total time'] = Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ' + (s % 60) + 's';
  }
  if (cals != null) out['Calories'] = cals.toLocaleString();
  if (hr) out['Heart rate'] = hr[0] + '–' + hr[1] + ' bpm';
  if (cad) out['Cadence'] = cad[0] + '–' + cad[1];
  out['Note'] = 'GPS track plot is a future map render dep';
  return out;
}

// ============================================================================
// FASTA / FASTQ
// ============================================================================
function guessSeqType(seq) {
  if (!seq) return 'unknown';
  const sample = seq.slice(0, 2000).toUpperCase().replace(/[^A-Z]/g, '');
  if (!sample) return 'unknown';
  let acgtun = 0, prot = 0;
  for (const ch of sample) {
    if ('ACGTUN'.includes(ch)) acgtun++;
    else if ('EFILPQZ'.includes(ch)) prot++;
  }
  if (acgtun / sample.length > 0.9) return /U/.test(sample) && !/T/.test(sample) ? 'RNA' : 'DNA / nucleotide';
  if (prot > 0) return 'protein';
  return 'unknown';
}

async function parseFasta(file) {
  const text = await readText(file, 4_000_000);
  if (!text) return null;
  const trimmed = text.replace(/^\s+/, '');
  if (trimmed[0] !== '>' && trimmed[0] !== ';') return null;
  const lines = text.split(/\r?\n/);
  let records = 0, totalLen = 0, gc = 0, atgc = 0;
  let curSeq = '';
  const flush = () => {
    if (curSeq) {
      totalLen += curSeq.length;
      for (const ch of curSeq) {
        const c = ch.toUpperCase();
        if (c === 'G' || c === 'C') { gc++; atgc++; }
        else if (c === 'A' || c === 'T' || c === 'U') atgc++;
      }
    }
    curSeq = '';
  };
  for (const l of lines) {
    if (l[0] === '>') { flush(); records++; }
    else if (l[0] === ';') { /* comment */ }
    else curSeq += l.trim();
  }
  flush();
  if (!records) return null;
  const out = {
    'Format': 'FASTA sequence',
    'Records': records.toLocaleString(),
    'Total length': totalLen.toLocaleString() + ' residues',
    'Mean length': records ? Math.round(totalLen / records).toLocaleString() : '-',
  };
  out['Sequence type'] = guessSeqType(curSeq || text.replace(/^>.*$/gm, ''));
  if (atgc > 0) out['GC content'] = (100 * gc / atgc).toFixed(1) + '%';
  return out;
}

async function parseFastq(file) {
  const text = await readText(file, 4_000_000);
  if (!text) return null;
  if (text.replace(/^\s+/, '')[0] !== '@') return null;
  const lines = text.split(/\r?\n/);
  let records = 0, totalLen = 0, gc = 0, atgc = 0;
  let minLen = Infinity, maxLen = -Infinity;
  let qMin = 999, qMax = -1;
  let i = 0;
  // Read complete 4-line records only.
  while (i + 3 < lines.length) {
    if (lines[i][0] !== '@') { i++; continue; }
    const seq = lines[i + 1] || '';
    const plus = lines[i + 2] || '';
    const qual = lines[i + 3] || '';
    if (plus[0] !== '+') { i++; continue; }
    records++;
    const L = seq.trim().length;
    totalLen += L; minLen = Math.min(minLen, L); maxLen = Math.max(maxLen, L);
    for (const ch of seq) {
      const c = ch.toUpperCase();
      if (c === 'G' || c === 'C') { gc++; atgc++; }
      else if (c === 'A' || c === 'T' || c === 'N' || c === 'U') atgc++;
    }
    for (const ch of qual.trim()) { const v = ch.charCodeAt(0); if (v < qMin) qMin = v; if (v > qMax) qMax = v; }
    i += 4;
  }
  if (!records) return null;
  // Phred encoding guess from observed quality ASCII range.
  let encoding = 'unknown';
  if (qMax >= 0) {
    if (qMin >= 33 && qMax <= 74 && qMin < 59) encoding = 'Phred+33 (Sanger / Illumina 1.8+)';
    else if (qMin >= 64) encoding = 'Phred+64 (Illumina 1.3–1.7)';
    else if (qMin >= 59 && qMin < 64) encoding = 'Phred+64 (Solexa)';
    else encoding = 'Phred+33';
  }
  const out = {
    'Format': 'FASTQ sequencing reads',
    'Reads': records.toLocaleString(),
    'Total bases': totalLen.toLocaleString(),
    'Read length': (minLen === maxLen ? String(minLen) : minLen + '–' + maxLen) + ' bp',
  };
  if (atgc > 0) out['GC content'] = (100 * gc / atgc).toFixed(1) + '%';
  out['Quality encoding'] = encoding + (qMax >= 0 ? ' (ASCII ' + qMin + '–' + qMax + ')' : '');
  return out;
}

// ============================================================================
// Chemistry: MOL / SDF / MOL2
// ============================================================================
async function parseMol(file, ext) {
  const text = await readText(file, 4_000_000);
  if (!text) return null;
  if (ext === 'mol2') return parseMol2(text);
  // MDL Molfile: line1=name, line2=program, line3=comment, line4=counts.
  const lines = text.split(/\r?\n/);
  if (lines.length < 4) return null;
  const counts = lines[3];
  // V2000 counts line: aaabbb...; V3000 uses "V30 COUNTS".
  const v2 = counts.match(/^\s*(\d+)\s*(\d+).*(V2000|V3000)?\s*$/);
  const out = { 'Format': ext === 'sdf' ? 'SDF chemical structure (MDL)' : 'MOL chemical structure (MDL)' };
  const name = lines[0].trim();
  if (name) out['Molecule name'] = name.slice(0, 80);
  const prog = lines[1].trim();
  if (prog) out['Program/header'] = prog.slice(0, 80);
  if (/V3000/.test(counts)) {
    const cm = text.match(/M\s+V30\s+COUNTS\s+(\d+)\s+(\d+)/);
    if (cm) { out['Atoms'] = parseInt(cm[1], 10); out['Bonds'] = parseInt(cm[2], 10); }
    out['CTAB version'] = 'V3000';
  } else if (v2) {
    out['Atoms'] = parseInt(v2[1], 10);
    out['Bonds'] = parseInt(v2[2], 10);
    out['CTAB version'] = 'V2000';
  }
  if (ext === 'sdf') {
    const mols = (text.match(/^\$\$\$\$\s*$/gm) || []).length;
    out['Molecules (SDF)'] = mols || 1;
    const tags = Array.from(text.matchAll(/^>\s*<([^>]+)>/gm)).map((m) => m[1]);
    if (tags.length) {
      const uniq = Array.from(new Set(tags));
      out['Property tags'] = uniq.length;
      out._sections = [{ title: 'Property tags', node: preBlock(uniq.slice(0, 100).join('\n')) }];
    }
  }
  return out;
}

function parseMol2(text) {
  const out = { 'Format': 'MOL2 chemical structure (Tripos)' };
  const nameM = text.match(/@<TRIPOS>MOLECULE\s*\r?\n([^\r\n]*)/);
  if (nameM && nameM[1].trim()) out['Molecule name'] = nameM[1].trim().slice(0, 80);
  // The line after the name holds: num_atoms num_bonds ...
  const block = text.match(/@<TRIPOS>MOLECULE\s*\r?\n[^\r\n]*\r?\n\s*(\d+)\s+(\d+)/);
  if (block) { out['Atoms'] = parseInt(block[1], 10); out['Bonds'] = parseInt(block[2], 10); }
  const mols = (text.match(/@<TRIPOS>MOLECULE/g) || []).length;
  out['Molecules'] = mols || 1;
  return out;
}

// ============================================================================
// Chemistry: CIF / mmCIF
// ============================================================================
async function parseCif(file) {
  const text = await readText(file, 4_000_000);
  if (!text || !/^\s*data_/m.test(text)) return null;
  const out = { 'Format': 'Crystallographic Information File (CIF)' };
  const dataBlock = (text.match(/^\s*data_(\S+)/m) || [])[1];
  if (dataBlock) out['Data block'] = dataBlock;
  const grab = (key) => {
    const m = text.match(new RegExp('^\\s*' + key.replace(/[.[\]]/g, '\\$&') + "\\s+(?:'([^']*)'|\"([^\"]*)\"|(\\S+))", 'm'));
    return m ? (m[1] || m[2] || m[3]) : null;
  };
  const formula = grab('_chemical_formula_sum') || grab('_chemical_formula_structural');
  if (formula) out['Chemical formula'] = formula;
  const a = grab('_cell_length_a'), b = grab('_cell_length_b'), c = grab('_cell_length_c');
  if (a || b || c) out['Cell lengths'] = [a, b, c].filter(Boolean).join(', ') + ' Å';
  const sg = grab('_space_group_name_H-M_alt') || grab('_symmetry_space_group_name_H-M') || grab('_space_group_IT_number');
  if (sg) out['Space group'] = sg;
  // atom_site count: data rows under the _atom_site loop.
  let atoms = 0;
  const aIdx = text.indexOf('_atom_site');
  if (aIdx >= 0) {
    // Count data lines after the atom_site loop header that start with a label.
    const after = text.slice(aIdx).split(/\r?\n/);
    let inData = false;
    for (const l of after) {
      const t = l.trim();
      if (/^_atom_site/.test(t)) { continue; }
      if (/^loop_|^data_|^_/.test(t)) { if (inData) break; continue; }
      if (!t || t.startsWith('#')) { if (inData) break; continue; }
      inData = true; atoms++;
    }
  }
  if (atoms) out['Atom sites'] = atoms.toLocaleString();
  return out;
}

// ============================================================================
// Chemistry: XYZ (sniff + null fallback for the ambiguous .xyz extension)
// ============================================================================
async function parseXyz(file) {
  const text = await readText(file, 1_000_000);
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  if (lines.length < 3) return null;
  const n = parseInt(lines[0].trim(), 10);
  // Molecular XYZ: first line is the atom count, second is a comment, then N
  // lines of "Element x y z". Anything else (LiDAR XYZ, point clouds) -> null.
  if (!Number.isInteger(n) || n <= 0 || n > 1_000_000) return null;
  const atomLine = /^\s*([A-Za-z]{1,3})\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+[-+]?\d*\.?\d+/;
  // Validate the first few coordinate lines look molecular.
  let checked = 0, ok = 0;
  for (let i = 2; i < lines.length && checked < Math.min(n, 8); i++) {
    if (!lines[i].trim()) continue;
    checked++;
    if (atomLine.test(lines[i])) ok++;
  }
  if (checked === 0 || ok < checked) return null; // not molecular form
  // Tally element composition.
  const comp = {};
  let total = 0;
  for (let i = 2; i < lines.length && total < n; i++) {
    const m = lines[i].match(/^\s*([A-Za-z]{1,3})\s/);
    if (!m) continue;
    const el2 = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    comp[el2] = (comp[el2] || 0) + 1; total++;
  }
  const formula = Object.keys(comp).sort().map((k) => k + (comp[k] > 1 ? comp[k] : '')).join('');
  const out = {
    'Format': 'XYZ molecular coordinates',
    'Atoms': n,
    'Comment': (lines[1] || '').trim().slice(0, 120) || '-',
    'Formula': formula || '-',
    'Elements': Object.keys(comp).length,
  };
  return out;
}

// ============================================================================
// EDA: Gerber (.gbr / .gbl / .gtl)
// ============================================================================
async function parseGerber(file) {
  const text = await readText(file, 2_000_000);
  if (!text) return null;
  if (!/%FS|%MO|G04|^\s*X[\d-]/m.test(text) && !/\*%/.test(text)) {
    // weak check; require at least a Gerber-ish token
    if (!/%ADD|%FS|%MO|%TF/.test(text)) return null;
  }
  const out = { 'Format': 'Gerber RS-274X (PCB)' };
  const fs = text.match(/%FS([LT]?)([AI]?)X(\d)(\d)Y(\d)(\d)\*/);
  if (fs) out['Format spec'] = 'X' + fs[3] + '.' + fs[4] + ' Y' + fs[5] + '.' + fs[6] + (fs[1] === 'L' ? ' (leading-zero suppr.)' : fs[1] === 'T' ? ' (trailing-zero suppr.)' : '');
  const mo = text.match(/%MO(MM|IN)\*/);
  if (mo) out['Units'] = mo[1] === 'MM' ? 'millimeters' : 'inches';
  const ff = text.match(/%TF\.FileFunction,([^*]+)\*/);
  if (ff) out['File function'] = ff[1].trim();
  const gen = text.match(/%TF\.GenerationSoftware,([^*]+)\*/);
  if (gen) out['Generator'] = gen[1].replace(/,/g, ' ').trim();
  const apertures = (text.match(/%ADD\d+/g) || []).length;
  out['Aperture definitions'] = apertures;
  const flashes = (text.match(/D0?3\*/g) || []).length;
  if (flashes) out['Flash ops (D03)'] = flashes;
  return out;
}

// ============================================================================
// EDA: Excellon drill (.drl / .xln)
// ============================================================================
async function parseExcellon(file) {
  const text = await readText(file, 2_000_000);
  if (!text) return null;
  if (!/M48|^T\d+C[\d.]/m.test(text) && !/INCH|METRIC/.test(text)) return null;
  const out = { 'Format': 'Excellon drill (PCB)' };
  const units = text.match(/\b(INCH|METRIC)\b/);
  if (units) out['Units'] = units[1] === 'METRIC' ? 'metric (mm)' : 'inch';
  // Tool table: T<n>C<diameter>
  const tools = {};
  for (const m of text.matchAll(/^T(\d+)C([\d.]+)/gm)) tools[m[1]] = parseFloat(m[2]);
  const toolList = Object.keys(tools);
  out['Tools'] = toolList.length;
  // Hole counts: each tool selection line "T<n>" (no C) precedes coordinate rows.
  const holesByTool = {};
  let curTool = null, totalHoles = 0;
  for (const line of text.split(/\r?\n/)) {
    const ts = line.match(/^T(\d+)\s*$/);
    if (ts) { curTool = ts[1]; continue; }
    if (/^[XY][-\d.]/.test(line) && curTool != null) { holesByTool[curTool] = (holesByTool[curTool] || 0) + 1; totalHoles++; }
  }
  out['Total holes'] = totalHoles;
  if (toolList.length) {
    const rows = toolList.map((t) => 'T' + t + '  ⌀' + tools[t] + (holesByTool[t] ? '  ×' + holesByTool[t] : ''));
    out._sections = [{ title: 'Tool table (' + toolList.length + ')', node: preBlock(rows.join('\n')) }];
  }
  return out;
}

// ============================================================================
// SPICE netlist (.cir / .sp / .spi / .spice)
// ============================================================================
async function parseSpice(file) {
  const text = await readText(file, 2_000_000);
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  if (!lines.length) return null;
  // First non-blank line is conventionally the title.
  const title = (lines.find((l) => l.trim()) || '').trim();
  const compTypes = { R: 'Resistors', C: 'Capacitors', L: 'Inductors', D: 'Diodes', Q: 'BJTs', M: 'MOSFETs', V: 'Voltage sources', I: 'Current sources', X: 'Subckt instances', E: 'VCVS', G: 'VCCS', J: 'JFETs', K: 'Coupled inductors' };
  const counts = {};
  let any = false;
  for (const l of lines) {
    const c = l.trim()[0];
    if (!c) continue;
    const u = c.toUpperCase();
    if (compTypes[u]) { counts[u] = (counts[u] || 0) + 1; any = true; }
  }
  if (!any && !/\.(model|subckt|tran|ac|dc|op|end)\b/i.test(text)) return null;
  const out = { 'Format': 'SPICE netlist' };
  out['Title'] = title.slice(0, 100) || '-';
  let dialect = 'Generic SPICE';
  if (/\.(asc|tran|meas)\b/i.test(text) && /Version 4|LTspice|XVII/i.test(text)) dialect = 'LTspice';
  else if (/ngspice|\.control/i.test(text)) dialect = 'ngspice';
  else if (/PSpice|\.PROBE|\.STEP/i.test(text)) dialect = 'PSpice';
  out['Dialect'] = dialect;
  const comps = Object.entries(counts).map(([k, v]) => compTypes[k] + ': ' + v);
  if (comps.length) out['Components'] = comps.join(', ');
  out['.model defs'] = (text.match(/^\s*\.model\b/gim) || []).length;
  out['.subckt defs'] = (text.match(/^\s*\.subckt\b/gim) || []).length;
  const analyses = Array.from(text.matchAll(/^\s*\.(tran|ac|dc|op|noise|tf|disto|pz|sens|four)\b/gim)).map((m) => '.' + m[1].toLowerCase());
  if (analyses.length) out['Analyses'] = Array.from(new Set(analyses)).join(', ');
  return out;
}

// ============================================================================
// Biosignals: EDF / BDF (ASCII header)
// ============================================================================
async function parseEdf(file, ext) {
  const buf = await readSlice(file, 0, 256);
  if (buf.length < 256) return null;
  // EDF version field: "0       "; BDF: byte0=0xFF then "BIOSEMI".
  const isBdf = buf[0] === 0xff;
  const ver = ascii(buf, 0, 8).trim();
  if (!isBdf && ver !== '0' && !/^0+$/.test(ver)) {
    // Could still be EDF+; accept if header looks ASCII-ish
    if (!/EDF|BIOSEMI/.test(ascii(buf, 0, 200))) return null;
  }
  const patient = ascii(buf, 8, 80).trim();
  const recording = ascii(buf, 88, 80).trim();
  const startDate = ascii(buf, 168, 8).trim();
  const startTime = ascii(buf, 176, 8).trim();
  const headerBytes = parseInt(ascii(buf, 184, 8).trim(), 10);
  const reserved = ascii(buf, 192, 44).trim();
  const numRecords = parseInt(ascii(buf, 236, 8).trim(), 10);
  const recDur = parseFloat(ascii(buf, 244, 8).trim());
  const numSignals = parseInt(ascii(buf, 252, 4).trim(), 10);
  const out = { 'Format': isBdf ? 'BDF biosignal (BioSemi)' : 'EDF biosignal (European Data Format)' };
  if (reserved) out['Subtype'] = reserved;
  out['Patient ID'] = patient || '-';
  out['Recording ID'] = recording || '-';
  out['Start'] = (startDate + ' ' + startTime).trim() || '-';
  if (Number.isFinite(numRecords)) out['Data records'] = numRecords + (Number.isFinite(recDur) ? ' × ' + recDur + 's' : '');
  if (Number.isFinite(numSignals)) out['Signals'] = numSignals;
  // Signal labels live at offset 256, 16 bytes each.
  if (Number.isFinite(numSignals) && numSignals > 0 && numSignals < 4096) {
    const labelsBuf = await readSlice(file, 256, numSignals * 16);
    const labels = [];
    for (let i = 0; i < numSignals && (i + 1) * 16 <= labelsBuf.length; i++) {
      labels.push(ascii(labelsBuf, i * 16, 16).trim());
    }
    if (labels.length) out._sections = [{ title: 'Signal labels (' + labels.length + ')', node: preBlock(labels.join('\n')) }];
  }
  out['Note'] = 'Channel waveform plot is a future render dep';
  return out;
}

// ============================================================================
// Spectroscopy: JCAMP-DX (.jdx / .dx)
// ============================================================================
async function parseJcamp(file) {
  const text = await readText(file, 2_000_000);
  if (!text || !/##TITLE\s*=/i.test(text)) return null;
  const grab = (key) => {
    const m = text.match(new RegExp('##' + key.replace(/[.$]/g, '\\$&') + '\\s*=\\s*([^\\r\\n]*)', 'i'));
    return m ? m[1].trim() : null;
  };
  const out = { 'Format': 'JCAMP-DX spectrum' };
  const title = grab('TITLE'); if (title) out['Title'] = title;
  const dt = grab('DATA TYPE') || grab('DATATYPE'); if (dt) out['Data type'] = dt;
  const xu = grab('XUNITS'); if (xu) out['X units'] = xu;
  const yu = grab('YUNITS'); if (yu) out['Y units'] = yu;
  const np = grab('NPOINTS'); if (np) out['Points'] = np;
  const fx = grab('FIRSTX'), lx = grab('LASTX');
  if (fx || lx) out['X range'] = [fx, lx].filter((v) => v != null).join(' → ');
  const inst = grab('SPECTROMETER/DATA SYSTEM') || grab('INSTRUMENT') || grab('ORIGIN');
  if (inst) out['Instrument/origin'] = inst;
  const blocks = (text.match(/##TITLE\s*=/gi) || []).length;
  if (blocks > 1) out['Spectra (blocks)'] = blocks;
  out['Note'] = 'Spectrum plot is a future render dep';
  return out;
}

// ============================================================================
// Stats datasets: SPSS .sav
// ============================================================================
async function parseSav(file) {
  const buf = await readSlice(file, 0, 200_000);
  if (ascii(buf, 0, 4) !== '$FL2' && ascii(buf, 0, 4) !== '$FL3') return null;
  const r = new Reader(buf, true);
  r.seek(4);
  const productName = ascii(buf, 4, 60).trim();
  // SPSS header layout (after 60-char product): layout_code(i32), nominal_case_size(i32),
  // compression(i32), weight_index(i32), ncases(i32), bias(f64), creation date(9), time(8), label(64)
  r.seek(64);
  const layoutCode = r.i32();
  const caseSize = r.i32();        // nominal number of variables (incl. continuation)
  const compression = r.i32();
  r.i32();                          // weight index
  const ncases = r.i32();
  r.f64();                          // bias
  const creationDate = ascii(buf, r.tell(), 9).trim(); r.skip(9);
  const creationTime = ascii(buf, r.tell(), 8).trim(); r.skip(8);
  const fileLabel = ascii(buf, r.tell(), 64).trim();
  const out = { 'Format': 'SPSS data file (.sav)' };
  if (productName) out['Created by'] = productName;
  out['Variables (nominal)'] = caseSize >= 0 ? caseSize : '-';
  out['Cases'] = ncases >= 0 ? ncases.toLocaleString() : 'unknown (streamed)';
  out['Compression'] = compression === 1 ? 'bytecode' : compression === 2 ? 'ZSAV' : 'none';
  if (creationDate) out['Creation date'] = (creationDate + ' ' + creationTime).trim();
  if (fileLabel) out['File label'] = fileLabel;
  // Variable names: records of type 2 begin with int32 rec_type == 2.
  const names = [];
  let pos = r.tell();
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let guard = 0;
  while (pos + 4 <= buf.length && guard++ < 5000) {
    const rt = dv.getInt32(pos, true);
    if (rt === 2) {
      // rec_type(4) type(4) has_var_label(4) n_missing(4) print(4) write(4) name(8)
      if (pos + 32 > buf.length) break;
      const varType = dv.getInt32(pos + 4, true);
      const hasLabel = dv.getInt32(pos + 8, true);
      let nMissing = dv.getInt32(pos + 12, true);
      if (varType !== -1) names.push(ascii(buf, pos + 24, 8).trim()); // -1 = string continuation
      pos += 32;
      if (hasLabel === 1 && pos + 4 <= buf.length) { const ll = dv.getInt32(pos, true) >>> 0; pos += 4 + (Math.ceil(ll / 4) * 4); }
      if (nMissing > 3 || nMissing < -3) nMissing = 0;
      pos += Math.abs(nMissing) * 8;
    } else if (rt === 3 || rt === 6 || rt === 7) {
      break; // value labels / docs / extension — stop name harvest
    } else { break; }
  }
  if (names.length) {
    out['Variable names found'] = names.length;
    out._sections = [{ title: 'Variables', node: preBlock(names.filter(Boolean).slice(0, 200).join('\n')) }];
  }
  return out;
}

// ============================================================================
// Stats datasets: Stata .dta
// ============================================================================
async function parseDta(file) {
  const buf = await readSlice(file, 0, 4096);
  if (buf.length < 8) return null;
  // New format (>=117) is XML-ish: "<stata_dta><header><release>117".
  if (ascii(buf, 0, 11) === '<stata_dta>') {
    const text = latin1(buf);
    const release = (text.match(/<release>(\d+)<\/release>/) || [])[1];
    const byteorder = (text.match(/<byteorder>(\w+)<\/byteorder>/) || [])[1];
    const out = { 'Format': 'Stata dataset (.dta)' };
    out['Release'] = release || '-';
    out['Byte order'] = byteorder === 'MSF' ? 'big-endian' : byteorder === 'LSF' ? 'little-endian' : (byteorder || '-');
    // nvar/nobs are binary inside the tags; decode from the raw bytes.
    const little = byteorder !== 'MSF';
    const kIdx = findBytes(buf, [0x3c, 0x4b, 0x3e]); // "<K>"
    if (kIdx >= 0 && kIdx + 5 <= buf.length) out['Variables'] = new DataView(buf.buffer, buf.byteOffset).getUint16(kIdx + 3, little);
    const nIdx = findBytes(buf, [0x3c, 0x4e, 0x3e]); // "<N>"
    if (nIdx >= 0 && nIdx + 7 <= buf.length) {
      const dv = new DataView(buf.buffer, buf.byteOffset);
      const nobs = release && parseInt(release, 10) >= 118 ? Number(dv.getBigUint64(nIdx + 3, little)) : dv.getUint32(nIdx + 3, little);
      out['Observations'] = nobs.toLocaleString();
    }
    const labelM = text.match(/<label>(?:[\s\S]{1,3})?([ -~]{2,80})<\/label>/);
    if (labelM) out['Dataset label'] = labelM[1].trim();
    const tsM = text.match(/<timestamp>(?:[\s\S]{1,2})?([ -~]{5,40})<\/timestamp>/);
    if (tsM) out['Timestamp'] = tsM[1].trim();
    return out;
  }
  // Old format: first byte = release code (113,114,115), byteorder, filetype.
  const release = buf[0];
  if (![0x69, 0x6e, 0x71, 0x72, 0x73].includes(release)) return null; // 105,110,113,114,115
  const relMap = { 0x69: '105', 0x6e: '110', 0x71: '113', 0x72: '114', 0x73: '115' };
  const little = buf[1] === 0x02;
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const nvar = dv.getUint16(2, little);
  const nobs = dv.getUint32(4, little);
  const out = {
    'Format': 'Stata dataset (.dta, legacy)',
    'Release': relMap[release] || release,
    'Byte order': little ? 'little-endian' : 'big-endian',
    'Variables': nvar,
    'Observations': nobs.toLocaleString(),
  };
  const label = ascii(buf, 8, 81).trim();
  if (label) out['Dataset label'] = label;
  return out;
}

// ============================================================================
// Stats datasets: SAS .sas7bdat
// ============================================================================
const SAS7BDAT_MAGIC = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xc2, 0xea, 0x81, 0x60, 0xb3, 0x14, 0x11, 0xcf, 0xbd, 0x92, 0x08, 0, 0x09, 0xc7, 0x31, 0x8c, 0x18, 0x1f, 0x10, 0x11];
async function parseSas(file) {
  const buf = await readSlice(file, 0, 1024);
  if (!matchMagic(buf, SAS7BDAT_MAGIC, 0)) return null;
  // alignment + endianness flags
  const a1 = buf[32] === 0x33 ? 4 : 0;   // u64 alignment
  const a2 = buf[35] === 0x33 ? 4 : 0;
  const little = buf[37] === 0x01;
  const out = { 'Format': 'SAS dataset (.sas7bdat)' };
  // Dataset name at offset 92 (32 bytes), filetype at 124.
  const dsName = ascii(buf, 92, 32).trim();
  if (dsName) out['Dataset name'] = dsName;
  const fileType = ascii(buf, 124, 8).trim();
  if (fileType) out['File type'] = fileType;
  // OS info and SAS release live near the header tail (offsets vary with align).
  const release = ascii(buf, 216 + a1, 8).trim();
  if (release) out['SAS release'] = release;
  const host = ascii(buf, 224 + a1, 16).trim();
  if (host) out['Host/OS'] = host;
  out['Note'] = 'Column/row counts need full page-table parse (future)';
  return out;
}

// ============================================================================
// VTK (.vtk legacy + .vtu/.vtp/.vti/.vts/.vtr XML)
// ============================================================================
async function parseVtk(file, ext) {
  const text = await readText(file, 1_000_000);
  if (!text) return null;
  if (ext === 'vtk') {
    if (!/^#\s*vtk DataFile Version/i.test(text)) return null;
    const lines = text.split(/\r?\n/);
    const out = { 'Format': 'VTK legacy' };
    const ver = (lines[0].match(/Version\s+([\d.]+)/i) || [])[1];
    if (ver) out['Version'] = ver;
    if (lines[1]) out['Title'] = lines[1].trim().slice(0, 100);
    if (lines[2]) out['Encoding'] = lines[2].trim();
    const dsType = (text.match(/DATASET\s+(\w+)/i) || [])[1];
    if (dsType) out['Dataset type'] = dsType;
    const pts = (text.match(/POINTS\s+(\d+)/i) || [])[1];
    if (pts) out['Points'] = parseInt(pts, 10).toLocaleString();
    const cells = (text.match(/(?:CELLS|POLYGONS|TRIANGLE_STRIPS|LINES|VERTICES)\s+(\d+)/i) || [])[1];
    if (cells) out['Cells'] = parseInt(cells, 10).toLocaleString();
    return out;
  }
  // XML-based VTK.
  if (!/<VTKFile/i.test(text)) return null;
  const typeM = text.match(/<VTKFile[^>]*\btype="([^"]+)"/i);
  const verM = text.match(/<VTKFile[^>]*\bversion="([^"]+)"/i);
  const out = { 'Format': 'VTK XML (' + (typeM ? typeM[1] : ext.toUpperCase()) + ')' };
  if (verM) out['Version'] = verM[1];
  out['Pieces'] = (text.match(/<Piece\b/gi) || []).length;
  const np = Array.from(text.matchAll(/NumberOfPoints="(\d+)"/gi)).reduce((a, m) => a + parseInt(m[1], 10), 0);
  const nc = Array.from(text.matchAll(/NumberOfCells="(\d+)"/gi)).reduce((a, m) => a + parseInt(m[1], 10), 0);
  if (np) out['Points'] = np.toLocaleString();
  if (nc) out['Cells'] = nc.toLocaleString();
  const compress = text.match(/compressor="([^"]+)"/i);
  if (compress) out['Compressor'] = compress[1];
  return out;
}

// ============================================================================
// NIfTI (.nii / .nii.gz)
// ============================================================================
const NIFTI_DTYPES = { 2: 'uint8', 4: 'int16', 8: 'int32', 16: 'float32', 32: 'complex64', 64: 'float64', 256: 'int8', 512: 'uint16', 768: 'uint32', 1024: 'int64', 1280: 'uint64' };
async function parseNifti(file) {
  let buf = await readSlice(file, 0, 1024);
  if (buf.length < 4) return null;
  // gzip-wrapped (.nii.gz) -> inflate at least the header.
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const slice = await readSlice(file, 0, Math.min(file.size, 65536));
    const inflated = await gunzip(slice);
    if (!inflated || inflated.length < 348) return null;
    buf = inflated.subarray(0, 1024);
  }
  if (buf.length < 348) return null;
  // sizeof_hdr at 0 is 348 (NIfTI-1) in either endianness; detect order.
  const dvLE = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let little = true;
  const sizeofHdr = dvLE.getInt32(0, true);
  if (sizeofHdr !== 348) {
    if (dvLE.getInt32(0, false) === 348) little = false;
    else return null;
  }
  const magic = ascii(buf, 344, 4);
  if (!/^n[i+]1/.test(magic) && magic !== 'ni1' && magic !== 'n+1') {
    // NIfTI-1 magic is "ni1\0" or "n+1\0".
    if (!(magic[0] === 'n' && (magic[1] === 'i' || magic[1] === '+'))) return null;
  }
  const r = new Reader(buf, little);
  const dim = [];
  r.seek(40);
  const ndim = r.i16();
  for (let i = 0; i < 7; i++) dim.push(r.i16());
  r.seek(70);
  const datatype = r.i16();
  const bitpix = r.i16();
  r.seek(76);
  const pixdim = [];
  for (let i = 0; i < 8; i++) pixdim.push(r.f32());
  r.seek(108);
  const voxOffset = r.f32();
  const sclSlope = r.f32();   // 112
  const sclInter = r.f32();   // 116
  const shape = dim.slice(0, Math.max(0, Math.min(ndim, 7)));
  const out = {
    'Format': 'NIfTI neuroimaging (' + (magic[1] === '+' ? 'single-file' : 'paired') + ')',
    'Magic': magic.replace(/\0+$/, ''),
    'Dimensions': ndim + 'D (' + shape.join(' × ') + ')',
    'Datatype': (NIFTI_DTYPES[datatype] || 'code ' + datatype) + ' / ' + bitpix + ' bpp',
    'Voxel size': pixdim.slice(1, 1 + Math.min(ndim, 3)).map((v) => +v.toFixed(4)).join(' × '),
  };

  // ---- middle axial slice preview (single-file .n+1 only; paired .ni1 keeps
  // its voxels in a separate .img we don't have) ----
  const nx = dim[0] | 0, ny = dim[1] | 0, nz = (ndim >= 3 ? dim[2] : 1) | 0;
  const render = NIFTI_RENDER_DTYPES[datatype];
  if (magic[1] === '+' && render && nx > 0 && ny > 0 && nz > 0 && nx <= 8192 && ny <= 8192) {
    try {
      const node = await renderNiftiSlice(file, {
        nx, ny, nz, datatype, voxOffset: voxOffset > 0 ? voxOffset : 352,
        little, sclSlope, sclInter,
      });
      if (node) { out._previewNode = node; out['Preview'] = 'middle axial slice (z = ' + (nz >> 1) + ')'; }
      else out['Note'] = 'Orthogonal slice preview not rendered for this datatype';
    } catch (_) { out['Note'] = 'Orthogonal slice preview not rendered'; }
  } else {
    out['Note'] = render ? 'Slice preview needs the paired .img data file' : 'Orthogonal slice preview not rendered for this datatype';
  }
  return out;
}

// Datatypes we can render: bytes-per-voxel + reader.
const NIFTI_RENDER_DTYPES = {
  2:   { bpv: 1, read: (dv, o, le) => dv.getUint8(o) },         // uint8
  256: { bpv: 1, read: (dv, o, le) => dv.getInt8(o) },          // int8
  4:   { bpv: 2, read: (dv, o, le) => dv.getInt16(o, le) },     // int16
  512: { bpv: 2, read: (dv, o, le) => dv.getUint16(o, le) },    // uint16
  8:   { bpv: 4, read: (dv, o, le) => dv.getInt32(o, le) },     // int32
  768: { bpv: 4, read: (dv, o, le) => dv.getUint32(o, le) },    // uint32
  16:  { bpv: 4, read: (dv, o, le) => dv.getFloat32(o, le) },   // float32
  64:  { bpv: 8, read: (dv, o, le) => dv.getFloat64(o, le) },   // float64
};

async function renderNiftiSlice(file, h) {
  const dt = NIFTI_RENDER_DTYPES[h.datatype];
  if (!dt) return null;
  const sliceVox = h.nx * h.ny;
  const z = h.nz >> 1;                       // middle axial slice
  const sliceBytes = sliceVox * dt.bpv;
  if (sliceBytes <= 0 || sliceBytes > 64 * 1024 * 1024) return null;
  const sliceStart = h.voxOffset + z * sliceBytes;

  let dv;
  const sig = await readSlice(file, 0, 2);
  if (sig.length >= 2 && sig[0] === 0x1f && sig[1] === 0x8b) {
    // .nii.gz — gunzip up to where the slice ends (cap to keep memory sane).
    const need = Math.ceil(sliceStart + sliceBytes);
    const cap = Math.min(file.size, 256 * 1024 * 1024);
    const inflated = await gunzip(await readSlice(file, 0, cap));
    if (!inflated || inflated.length < sliceStart + sliceBytes) return null;
    const sub = inflated.subarray(sliceStart, sliceStart + sliceBytes);
    dv = new DataView(sub.buffer, sub.byteOffset, sub.byteLength);
  } else {
    const buf = await readSlice(file, sliceStart, sliceBytes);
    if (buf.length < sliceBytes) return null;
    dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  const slope = (h.sclSlope && Number.isFinite(h.sclSlope) && h.sclSlope !== 0) ? h.sclSlope : 1;
  const inter = (Number.isFinite(h.sclInter)) ? h.sclInter : 0;
  const samples = new Float64Array(sliceVox);
  for (let i = 0; i < sliceVox; i++) samples[i] = dt.read(dv, i * dt.bpv, h.little) * slope + inter;
  const [lo, hi] = percentileBounds(samples, sliceVox);
  const rgba = grayToRGBA(samples, h.nx, h.ny, lo, hi, false);
  return canvasFromRGBA(rgba, h.nx, h.ny, h.nx + ' × ' + h.ny + ' axial slice z=' + z);
}

// ============================================================================
// Identification-only (rare AND hard) — {Format, Note}
// ============================================================================
function idOnly(format, note) { return () => ({ 'Format': format, 'Note': note }); }

async function parseSegy(file) {
  // EBCDIC 3200-byte textual header + 400-byte binary header. Just identify.
  const buf = await readSlice(file, 3200, 60);
  const dv = buf.length >= 26 ? new DataView(buf.buffer, buf.byteOffset) : null;
  const out = { 'Format': 'SEG-Y seismic data' };
  if (dv) {
    const sampleInterval = dv.getUint16(16, false); // bytes 3217-3218 (BE)
    const samples = dv.getUint16(20, false);
    const fmtCode = dv.getUint16(24, false);
    if (sampleInterval) out['Sample interval'] = sampleInterval + ' µs';
    if (samples) out['Samples/trace'] = samples;
    const fmts = { 1: 'IBM float', 2: 'int32', 3: 'int16', 5: 'IEEE float', 8: 'int8' };
    if (fmtCode && fmts[fmtCode]) out['Data format'] = fmts[fmtCode];
  }
  out['Note'] = 'EBCDIC header + trace decode not implemented (seismic render dep)';
  return out;
}

async function parseSamVcf(file, ext) {
  if (ext === 'bam' || ext === 'bcf') {
    const buf = await readSlice(file, 0, 8);
    // BAM = gzip(BGZF) then "BAM\1"; BCF = "BCF\2". Just identify.
    return { 'Format': ext === 'bam' ? 'BAM genomics alignment' : 'BCF genomics variants', 'Note': 'BGZF-compressed; record decode not implemented (genomics dep)' };
  }
  const text = await readText(file, 500_000);
  if (!text) return null;
  if (ext === 'vcf') {
    if (!/^##fileformat=VCF/m.test(text)) return null;
    const out = { 'Format': 'VCF genomics variants' };
    const ver = (text.match(/^##fileformat=(VCFv[\d.]+)/m) || [])[1];
    if (ver) out['Version'] = ver;
    out['Contigs'] = (text.match(/^##contig=/gm) || []).length;
    out['INFO fields'] = (text.match(/^##INFO=/gm) || []).length;
    out['FORMAT fields'] = (text.match(/^##FORMAT=/gm) || []).length;
    const headerLine = (text.match(/^#CHROM.*$/m) || [''])[0];
    const cols = headerLine.split('\t');
    if (cols.length > 9) out['Samples'] = cols.length - 9;
    out['Note'] = 'Variant records not fully parsed (genomics dep)';
    return out;
  }
  // SAM is TSV text with @HD/@SQ header lines.
  if (!/^@HD\t|^@SQ\t/m.test(text)) return null;
  const out = { 'Format': 'SAM genomics alignment' };
  out['Reference sequences'] = (text.match(/^@SQ\t/gm) || []).length;
  out['Read groups'] = (text.match(/^@RG\t/gm) || []).length;
  out['Programs'] = (text.match(/^@PG\t/gm) || []).length;
  out['Note'] = 'Alignment records not fully parsed (genomics dep)';
  return out;
}

async function parseHea(file) {
  // WFDB .hea: "record nsig fs nsamp" on line 1.
  const text = await readText(file, 100_000);
  if (!text) return null;
  const first = (text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '').trim();
  const m = first.match(/^(\S+)\s+(\d+)(?:\s+([\d./]+))?(?:\s+(\d+))?/);
  if (!m) return null;
  const out = { 'Format': 'WFDB header (PhysioNet)' };
  out['Record'] = m[1];
  out['Signals'] = parseInt(m[2], 10);
  if (m[3]) out['Sampling frequency'] = m[3] + ' Hz';
  if (m[4]) out['Samples per signal'] = parseInt(m[4], 10).toLocaleString();
  out['Note'] = 'Waveform plot needs companion .dat (biosignal dep)';
  return out;
}

// ---------- dispatch ----------
export const PARSERS = {
  // Medical imaging
  dcm: (c) => parseDicom(c.file),
  dicom: (c) => parseDicom(c.file),
  nii: (c) => parseNifti(c.file),
  // Activity / fitness
  fit: (c) => parseFit(c.head, c.file),
  tcx: (c) => parseTcx(c.file),
  // Astronomy
  fits: (c) => parseFits(c.head, c.file),
  fts: (c) => parseFits(c.head, c.file),
  // Bio sequences
  fasta: (c) => parseFasta(c.file),
  fa: (c) => parseFasta(c.file),
  fna: (c) => parseFasta(c.file),
  faa: (c) => parseFasta(c.file),
  fastq: (c) => parseFastq(c.file),
  fq: (c) => parseFastq(c.file),
  // Chemistry
  mol: (c) => parseMol(c.file, c.ext),
  sdf: (c) => parseMol(c.file, c.ext),
  mol2: (c) => parseMol(c.file, c.ext),
  cif: (c) => parseCif(c.file),
  mmcif: (c) => parseCif(c.file),
  xyz: (c) => parseXyz(c.file),
  // EDA / PCB
  gbr: (c) => parseGerber(c.file),
  gbl: (c) => parseGerber(c.file),
  gtl: (c) => parseGerber(c.file),
  drl: (c) => parseExcellon(c.file),
  xln: (c) => parseExcellon(c.file),
  // SPICE
  cir: (c) => parseSpice(c.file),
  sp: (c) => parseSpice(c.file),
  spi: (c) => parseSpice(c.file),
  spice: (c) => parseSpice(c.file),
  // Biosignals
  edf: (c) => parseEdf(c.file, c.ext),
  bdf: (c) => parseEdf(c.file, c.ext),
  // Spectroscopy
  jdx: (c) => parseJcamp(c.file),
  dx: (c) => parseJcamp(c.file),
  // Stats datasets
  sav: (c) => parseSav(c.file),
  dta: (c) => parseDta(c.file),
  sas7bdat: (c) => parseSas(c.file),
  // Simulation mesh
  vtk: (c) => parseVtk(c.file, c.ext),
  vtu: (c) => parseVtk(c.file, c.ext),
  vtp: (c) => parseVtk(c.file, c.ext),
  vti: (c) => parseVtk(c.file, c.ext),
  // Identification-only (rare AND hard)
  segy: (c) => parseSegy(c.file),
  sgy: (c) => parseSegy(c.file),
  bam: (c) => parseSamVcf(c.file, c.ext),
  sam: (c) => parseSamVcf(c.file, c.ext),
  vcf: (c) => parseSamVcf(c.file, c.ext),
  bcf: (c) => parseSamVcf(c.file, c.ext),
  hea: (c) => parseHea(c.file),
};
