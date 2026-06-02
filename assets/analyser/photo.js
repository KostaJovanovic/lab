/* Analyser - photo module
   - File preview + basic info (size, MIME, dimensions, aspect ratio, megapixels)
   - Full EXIF / IPTC / XMP / ICC / GPS via exifr (global)
   - RGB color histogram (canvas)
   - Dominant colors (color quantization)
   - GPS map via lazy-loaded Leaflet + OSM
   - On-device OCR via lazy-loaded Tesseract.js with language picker
   - SHA-256 file hash */

import { el, row, rowHelp, fmtBytes, h3help, fileExt, sha256Hex, loadScript, loadCss } from './util.js';
import { HEIC_EXTS, RAW_EXTS } from './formats.js';
import { convertHeic, extractRawPreview, convertWithImageMagick } from './photo-convert.js';

const JSQR_URL      = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
const LEAFLET_CSS   = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS    = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

const TESSERACT_LANGS = [
  ['eng', 'English', '4 MB'],
  ['srp', 'Serbian (Cyrillic)', '2 MB'],
  ['srp_latn', 'Serbian (Latin)', '2 MB'],
  ['hrv', 'Croatian', '2 MB'],
  ['deu', 'German', '4 MB'],
  ['fra', 'French', '4 MB'],
  ['ita', 'Italian', '4 MB'],
  ['spa', 'Spanish', '5 MB'],
  ['rus', 'Russian', '4 MB'],
  ['ell', 'Greek', '2 MB'],
  ['ara', 'Arabic', '2 MB'],
  ['jpn', 'Japanese', '14 MB'],
  ['chi_sim', 'Chinese (Simplified)', '18 MB'],
  ['chi_tra', 'Chinese (Traditional)', '25 MB'],
  ['kor', 'Korean', '5 MB'],
  ['heb', 'Hebrew', '2 MB'],
  ['tur', 'Turkish', '4 MB'],
  ['ukr', 'Ukrainian', '3 MB'],
  ['pol', 'Polish', '4 MB'],
  ['ron', 'Romanian', '2 MB'],
  ['hun', 'Hungarian', '4 MB'],
  ['ces', 'Czech', '3 MB'],
  ['slk', 'Slovak', '3 MB'],
  ['slv', 'Slovenian', '2 MB'],
  ['bul', 'Bulgarian', '2 MB'],
  ['mkd', 'Macedonian', '1 MB'],
  ['nld', 'Dutch', '5 MB'],
  ['por', 'Portuguese', '4 MB'],
  ['swe', 'Swedish', '3 MB'],
  ['nor', 'Norwegian', '4 MB'],
  ['fin', 'Finnish', '4 MB'],
  ['dan', 'Danish', '4 MB']
];

// ---------- helpers ----------
function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function aspectRatio(w, h) {
  if (!w || !h) return '-';
  const d = gcd(w, h);
  return `${w / d}:${h / d}  (${(w / h).toFixed(4)})`;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

// ---------- exif formatting ----------
const ORIENTATIONS = {
  1: 'Normal',
  2: 'Mirrored',
  3: 'Rotated 180°',
  4: 'Mirrored + rotated 180°',
  5: 'Mirrored + rotated 90° CW',
  6: 'Rotated 90° CW',
  7: 'Mirrored + rotated 90° CCW',
  8: 'Rotated 90° CCW'
};
const EXP_PROG = { 0:'Not defined',1:'Manual',2:'Program AE',3:'Aperture priority',4:'Shutter priority',5:'Creative',6:'Action',7:'Portrait',8:'Landscape' };
const METERING = { 0:'Unknown',1:'Average',2:'Centre-weighted',3:'Spot',4:'Multi-spot',5:'Pattern',6:'Partial',255:'Other' };
const WHITE_BAL = { 0:'Auto',1:'Manual' };

function fmtShutter(s) {
  if (s == null) return null;
  if (s >= 1) return s + ' s';
  return '1/' + Math.round(1 / s) + ' s';
}
function fmtFNumber(n)    { return n != null ? 'f/' + (+n).toFixed(1) : null; }
function fmtFocal(mm)     { return mm != null ? (+mm).toFixed(1) + ' mm' : null; }
function fmtExpComp(ev)   { return ev != null ? (ev > 0 ? '+' : '') + (+ev).toFixed(1) + ' EV' : null; }
function fmtDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().replace('T', ' ').replace(/\..*$/, '');
  return String(d);
}

function buildExifSections(exif) {
  if (!exif) return [];
  const sections = [];

  const camera = [];
  if (exif.Make)             camera.push(['Make', exif.Make]);
  if (exif.Model)            camera.push(['Model', exif.Model]);
  if (exif.LensMake)         camera.push(['Lens make', exif.LensMake]);
  if (exif.LensModel)        camera.push(['Lens', exif.LensModel]);
  if (exif.Software)         camera.push(['Software', exif.Software]);
  if (exif.SerialNumber)     camera.push(['Body s/n', exif.SerialNumber]);
  if (exif.LensSerialNumber) camera.push(['Lens s/n', exif.LensSerialNumber]);
  if (camera.length) sections.push({ title: 'Camera & lens', rows: camera });

  const exposure = [];
  if (exif.ISO != null)               exposure.push(['ISO', exif.ISO]);
  if (exif.FNumber != null)           exposure.push(['Aperture', fmtFNumber(exif.FNumber)]);
  if (exif.ExposureTime != null)      exposure.push(['Shutter', fmtShutter(exif.ExposureTime)]);
  if (exif.FocalLength != null)       exposure.push(['Focal length', fmtFocal(exif.FocalLength)]);
  if (exif.FocalLengthIn35mmFormat != null) exposure.push(['Focal (35mm eq.)', fmtFocal(exif.FocalLengthIn35mmFormat)]);
  if (exif.ExposureCompensation != null) exposure.push(['Exposure comp.', fmtExpComp(exif.ExposureCompensation)]);
  if (exif.ExposureProgram != null)   exposure.push(['Exposure program', EXP_PROG[exif.ExposureProgram] || exif.ExposureProgram]);
  if (exif.MeteringMode != null)      exposure.push(['Metering', METERING[exif.MeteringMode] || exif.MeteringMode]);
  if (exif.WhiteBalance != null)      exposure.push(['White balance', WHITE_BAL[exif.WhiteBalance] || exif.WhiteBalance]);
  if (exif.Flash != null)             exposure.push(['Flash', typeof exif.Flash === 'object' ? JSON.stringify(exif.Flash) : exif.Flash]);
  if (exposure.length) sections.push({ title: 'Exposure', rows: exposure });

  const time = [];
  if (exif.DateTimeOriginal) time.push(['Taken',     fmtDate(exif.DateTimeOriginal)]);
  if (exif.CreateDate)       time.push(['Created',   fmtDate(exif.CreateDate)]);
  if (exif.ModifyDate)       time.push(['Modified',  fmtDate(exif.ModifyDate)]);
  if (exif.OffsetTime)       time.push(['UTC offset', exif.OffsetTime]);
  if (time.length) sections.push({ title: 'Date / time', rows: time });

  const image = [];
  if (exif.Orientation != null) image.push(['Orientation', (ORIENTATIONS[exif.Orientation] || exif.Orientation) + '  (' + exif.Orientation + ')']);
  if (exif.ColorSpace)          image.push(['Colour space', exif.ColorSpace === 1 ? 'sRGB' : (exif.ColorSpace === 2 ? 'Adobe RGB' : exif.ColorSpace)]);
  if (exif.XResolution)         image.push(['X resolution', exif.XResolution + ' ' + (exif.ResolutionUnit === 3 ? 'dpcm' : 'dpi')]);
  if (exif.YResolution)         image.push(['Y resolution', exif.YResolution + ' ' + (exif.ResolutionUnit === 3 ? 'dpcm' : 'dpi')]);
  if (image.length) sections.push({ title: 'Image', rows: image });

  // IPTC / XMP
  const desc = [];
  if (exif.title || exif.ObjectName)   desc.push(['Title',       exif.title || exif.ObjectName]);
  if (exif.description || exif.Caption) desc.push(['Description', exif.description || exif.Caption]);
  if (exif.creator || exif.Artist)     desc.push(['Creator',     Array.isArray(exif.creator) ? exif.creator.join(', ') : (exif.creator || exif.Artist)]);
  if (exif.rights || exif.Copyright)   desc.push(['Copyright',   exif.rights || exif.Copyright]);
  if (exif.keywords || exif.subject)   desc.push(['Keywords',    [].concat(exif.keywords || [], exif.subject || []).join(', ')]);
  if (desc.length) sections.push({ title: 'Description (IPTC/XMP)', rows: desc });

  // ICC
  const icc = [];
  if (exif.ProfileDescription) icc.push(['ICC profile', exif.ProfileDescription]);
  if (exif.DeviceManufacturer) icc.push(['Device mfr', exif.DeviceManufacturer]);
  if (exif.DeviceModel)        icc.push(['Device model', exif.DeviceModel]);
  if (exif.ColorSpaceData)     icc.push(['Colour space', exif.ColorSpaceData]);
  if (icc.length) sections.push({ title: 'ICC profile', rows: icc });

  return sections;
}

// ---------- AI detection ----------
const AI_KEYWORDS = [
  'stable diffusion', 'stablediffusion', 'automatic1111', 'comfyui', 'invokeai',
  'dall-e', 'dall·e', 'dalle', 'openai',
  'midjourney',
  'adobe firefly', 'firefly',
  'bing image creator',
  'leonardo ai', 'leonardo.ai',
  'dreamstudio', 'stability ai',
  'playground ai',
  'nightcafe', 'starryai', 'artbreeder', 'deepai',
  'runway ml', 'runwayml',
  'imagen', 'parti',
  'craiyon', 'deep dream',
  'novelai', 'nai diffusion',
  'canva ai', 'canva text to image',
  'copilot designer',
  'ideogram',
  'flux',
  'ai generated', 'ai-generated', 'text2img', 'txt2img', 'img2img',
];

function detectAI(exif) {
  if (!exif) return null;
  const hints = [];
  const check = (field, label) => {
    if (!field) return;
    const lower = String(field).toLowerCase();
    for (const kw of AI_KEYWORDS) {
      if (lower.includes(kw)) {
        hints.push({ field: label, value: String(field), match: kw });
        return;
      }
    }
  };
  check(exif.Software, 'Software');
  check(exif.Make, 'Make');
  check(exif.Model, 'Model');
  check(exif.ImageDescription, 'Description');
  check(exif.description, 'Description');
  check(exif.UserComment, 'UserComment');
  check(exif.title, 'Title');
  check(exif.creator, 'Creator');
  check(exif.Artist, 'Artist');
  check(exif.Copyright, 'Copyright');
  check(exif.rights, 'Rights');
  const comment = exif.Comment || exif.comment;
  check(comment, 'Comment');
  const xmpCreator = exif.CreatorTool || exif.creator_tool;
  check(xmpCreator, 'CreatorTool');
  const history = exif.History || exif.history;
  if (typeof history === 'string') check(history, 'History');
  // Check for C2PA / Content Credentials marker
  if (exif['c2pa:actions'] || exif['c2pa:ingredient'] || exif['dcterms:provenance'])
    hints.push({ field: 'C2PA', value: 'Content Credentials detected', match: 'c2pa' });
  // Check all remaining keys for AI keywords
  for (const key of Object.keys(exif)) {
    if (typeof exif[key] !== 'string') continue;
    const lower = exif[key].toLowerCase();
    if (lower.includes('generated by ai') || lower.includes('ai-generated') ||
        lower.includes('synthetic media') || lower.includes('artificially generated'))
      hints.push({ field: key, value: exif[key], match: 'ai marker' });
  }
  return hints.length ? hints : null;
}

function buildRawDump(exif) {
  if (!exif) return null;
  const keys = Object.keys(exif).sort();
  const rows = [];
  for (const k of keys) {
    let v = exif[k];
    if (v instanceof Date)        v = v.toISOString();
    else if (v instanceof Uint8Array) v = `Uint8Array(${v.length})`;
    else if (typeof v === 'object') v = JSON.stringify(v);
    rows.push([k, v]);
  }
  return rows;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return Math.round(h * 360) + '°,' + Math.round(s * 100) + '%,' + Math.round(l * 100) + '%';
}

// ---------- sharpness (Laplacian variance) ----------
function computeSharpness(imgData) {
  const w = imgData.width, h = imgData.height, d = imgData.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  let sum = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const lap = -4 * gray[y * w + x]
        + gray[(y - 1) * w + x] + gray[(y + 1) * w + x]
        + gray[y * w + x - 1]   + gray[y * w + x + 1];
      sum += lap * lap;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function sharpnessLabel(v) {
  if (v > 800) return 'very sharp';
  if (v > 300) return 'sharp';
  if (v > 100) return 'normal';
  if (v > 30)  return 'soft';
  return 'blurry';
}

function detectFocusRegion(imgData, gridSize) {
  const w = imgData.width, h = imgData.height, d = imgData.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2];
  const cols = Math.ceil(w / gridSize), rows = Math.ceil(h / gridSize);
  const grid = new Float32Array(cols * rows);
  let maxVar = 0, maxIdx = 0;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let sum = 0, n = 0;
      const x0 = gx * gridSize, y0 = gy * gridSize;
      const x1 = Math.min(x0 + gridSize, w - 1), y1 = Math.min(y0 + gridSize, h - 1);
      for (let y = Math.max(1, y0); y < y1; y++) {
        for (let x = Math.max(1, x0); x < x1; x++) {
          const lap = -4*gray[y*w+x] + gray[(y-1)*w+x] + gray[(y+1)*w+x] + gray[y*w+x-1] + gray[y*w+x+1];
          sum += lap * lap; n++;
        }
      }
      const v = n > 0 ? sum / n : 0;
      grid[gy * cols + gx] = v;
      if (v > maxVar) { maxVar = v; maxIdx = gy * cols + gx; }
    }
  }
  return { grid, cols, rows, gridSize, maxIdx, maxVar,
    focusX: (maxIdx % cols) * gridSize + gridSize / 2,
    focusY: Math.floor(maxIdx / cols) * gridSize + gridSize / 2 };
}

// ---------- color statistics ----------
function computeColorStats(imgData) {
  const d = imgData.data, total = imgData.width * imgData.height;
  let rSum = 0, gSum = 0, bSum = 0, shadows = 0, midtones = 0, highlights = 0;
  for (let i = 0; i < d.length; i += 4) {
    rSum += d[i]; gSum += d[i + 1]; bSum += d[i + 2];
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum < 64) shadows++;
    else if (lum < 192) midtones++;
    else highlights++;
  }
  return {
    avgR: Math.round(rSum / total), avgG: Math.round(gSum / total), avgB: Math.round(bSum / total),
    shadows: ((shadows / total) * 100).toFixed(1),
    midtones: ((midtones / total) * 100).toFixed(1),
    highlights: ((highlights / total) * 100).toFixed(1)
  };
}

// ---------- perceptual hash (pHash) ----------
function computePHash(img) {
  const S = 32;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  cv.getContext('2d').drawImage(img, 0, 0, S, S);
  const d = cv.getContext('2d').getImageData(0, 0, S, S).data;
  const gray = new Float64Array(S * S);
  for (let i = 0; i < S * S; i++) gray[i] = 0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2];
  const dct = new Float64Array(S * S);
  for (let y = 0; y < S; y++)
    for (let u = 0; u < S; u++) {
      let s = 0;
      for (let x = 0; x < S; x++) s += gray[y*S+x] * Math.cos(Math.PI * u * (2*x+1) / (2*S));
      dct[y*S+u] = s;
    }
  const dct2 = new Float64Array(S * S);
  for (let u = 0; u < S; u++)
    for (let v = 0; v < S; v++) {
      let s = 0;
      for (let y = 0; y < S; y++) s += dct[y*S+u] * Math.cos(Math.PI * v * (2*y+1) / (2*S));
      dct2[v*S+u] = s;
    }
  const vals = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vals.push(dct2[y*S+x]);
  const sorted = [...vals].sort((a, b) => a - b);
  const med = sorted[32];
  let hex = '';
  for (let i = 0; i < 64; i += 4)
    hex += ((vals[i]>med?8:0)|(vals[i+1]>med?4:0)|(vals[i+2]>med?2:0)|(vals[i+3]>med?1:0)).toString(16);
  return hex;
}

// ---------- QR code detection ----------
async function detectQrCode(img) {
  await loadScript(JSQR_URL);
  if (!window.jsQR) return null;
  const MAX = 800;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return window.jsQR(cv.getContext('2d').getImageData(0, 0, w, h).data, w, h);
}

// ---------- histogram + palette ----------
function getPixelData(img) {
  const MAX = 240;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(img, 0, 0, w, h);
  return c.getImageData(0, 0, w, h);
}

function computeHistogram(imgData) {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
    const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    l[y]++;
  }
  return { r, g, b, l };
}

function renderHistogram(canvas, hist) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (i / 4) * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // luminance backdrop (light)
  const lmax = Math.max(...hist.l);
  ctx.fillStyle = 'rgba(200, 220, 232, 0.35)';
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * w;
    const bh = (hist.l[i] / lmax) * h;
    ctx.fillRect(x, h - bh, w / 256 + 1, bh);
  }

  // RGB lines, additively blended for the classic look
  const max = Math.max(
    Math.max.apply(null, hist.r),
    Math.max.apply(null, hist.g),
    Math.max.apply(null, hist.b)
  );
  const channels = [
    { data: hist.r, color: 'rgba(255,80,80,0.75)' },
    { data: hist.g, color: 'rgba(120,220,120,0.75)' },
    { data: hist.b, color: 'rgba(80,140,255,0.75)' }
  ];
  ctx.lineWidth = 1;
  for (const ch of channels) {
    ctx.strokeStyle = ch.color;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - (ch.data[i] / max) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Tiny color quantizer: bin into 32-color cube buckets, sort by population, merge near duplicates.
function dominantColors(imgData, n = 8) {
  const d = imgData.data;
  const STEP = 32;
  const map = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const r = (d[i]     >> 5) << 5;
    const g = (d[i + 1] >> 5) << 5;
    const b = (d[i + 2] >> 5) << 5;
    const k = (r << 16) | (g << 8) | b;
    map.set(k, (map.get(k) || 0) + 1);
  }
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [k, count] of entries) {
    const r = (k >> 16) & 255;
    const g = (k >> 8)  & 255;
    const b = k & 255;
    // Skip near-duplicates already in `out`
    if (out.some((c) => Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b) < 60)) continue;
    out.push({ r, g, b, count });
    if (out.length >= n) break;
  }
  return out;
}

function toHex(c) {
  const h = (v) => v.toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
}

// ---------- GPS / Leaflet (lazy) ----------
async function makeMap(container, lat, lon, label) {
  try {
    await loadCss(LEAFLET_CSS);
    await loadScript(LEAFLET_JS);
  } catch (e) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'anr-error' }, 'Map library failed to load. Offline?'));
    return;
  }
  container.innerHTML = '';
  const map = L.map(container).setView([lat, lon], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  L.marker([lat, lon]).addTo(map).bindPopup(label || (lat.toFixed(5) + ', ' + lon.toFixed(5))).openPopup();
  // Force resize after attach (Leaflet quirk inside flex layouts)
  setTimeout(() => map.invalidateSize(), 50);
}

// ---------- OCR (lazy) ----------
function prepareOcrCanvas(img) {
  const MIN_DIM = 2000;
  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.max(1, MIN_DIM / Math.min(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return cv;
}

async function ensureTesseract() {
  if (window.Tesseract) return window.Tesseract;
  await loadScript(TESSERACT_URL);
  return window.Tesseract;
}

function makeOcrCard(file, img) {
  const card = el('div', { class: 'anr-card' });
  const det = el('details');
  const ocrHelpText = '<strong>Optical Character Recognition</strong> scans the image for text using <a href="https://github.com/naptha/tesseract.js" target="_blank" rel="noopener">Tesseract.js</a>, an open-source OCR engine running entirely in your browser.<br><br><strong>How it works:</strong> the image is upscaled if needed, then Tesseract looks for letter-shaped patterns, groups them into words and lines, and assigns a confidence score to each word. Words below 60% confidence are filtered out to reduce noise.<br><br><strong>Limitations:</strong> Tesseract was designed for scanned documents — clean text on plain backgrounds. On photos it will often hallucinate text from textures, foliage, buildings, or noise. Handwriting, stylised fonts, low contrast, small text, and rotated or curved text all reduce accuracy significantly. Results are best on screenshots, signs, printed labels, and document photos.';
  const ocrInfoBtn = el('button', { type: 'button', class: 'anr-info-btn', title: 'Info' }, '[?]');
  const summary = el('summary', {}, ['OCR — Extract text', ocrInfoBtn]);
  det.appendChild(summary);
  const detContent = el('div');
  const ocrPanel = el('div', { class: 'anr-info-panel', style: 'display:none;', html: ocrHelpText });
  ocrInfoBtn.addEventListener('click', (e) => { e.preventDefault(); ocrPanel.style.display = ocrPanel.style.display === 'none' ? 'block' : 'none'; });
  detContent.appendChild(ocrPanel);

  const ocrCanvas = img ? prepareOcrCanvas(img) : null;
  const ocrInput = ocrCanvas || file;

  const langState = { value: 'eng', disabled: false };
  const dropdown = el('div', { class: 'anr-dropdown' });
  const trigger = el('div', { class: 'anr-dropdown-trigger' }, 'English');
  const list = el('ul', { class: 'anr-dropdown-list' });

  for (const [code, name, size] of TESSERACT_LANGS) {
    const item = el('li', { class: 'anr-dropdown-item' + (code === 'eng' ? ' is-selected' : '') }, [
      el('span', {}, name),
      el('span', { class: 'anr-dropdown-item-size' }, '[' + size + ']')
    ]);
    item.dataset.value = code;
    item.addEventListener('click', () => {
      if (langState.disabled) return;
      langState.value = code;
      trigger.childNodes[0].textContent = name;
      list.querySelectorAll('.anr-dropdown-item').forEach(li => li.classList.remove('is-selected'));
      item.classList.add('is-selected');
      dropdown.classList.remove('is-open');
    });
    list.appendChild(item);
  }

  trigger.addEventListener('click', () => {
    if (langState.disabled) return;
    dropdown.classList.toggle('is-open');
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove('is-open');
  });

  dropdown.appendChild(trigger);
  dropdown.appendChild(list);

  const runBtn  = el('button', { type: 'button', class: 'anr-btn' }, 'Run');

  const controlsRow = el('div', { class: 'anr-controls' }, [
    el('div', { class: 'anr-control' }, [el('label', {}, 'Lang'), dropdown]),
    el('div', { class: 'anr-control' }, [runBtn])
  ]);
  detContent.appendChild(controlsRow);

  const progressWrap  = el('div', { class: 'anr-progress', style: 'display:none' });
  const progressBar   = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const progressLabel = el('div', { class: 'anr-progress-label' }, '');
  progressWrap.appendChild(progressBar);
  progressWrap.appendChild(progressLabel);
  detContent.appendChild(progressWrap);

  function setBar(frac) {
    const ch = parseFloat(getComputedStyle(progressBar).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((progressBar.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    progressBar.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }

  const out = el('pre', { class: 'anr-ocr-text' });
  detContent.appendChild(out);

  let busy = false;
  let activeWorker = null;

  async function run() {
    if (busy) return;
    busy = true;
    runBtn.textContent = 'Stop';
    langState.disabled = true;
    trigger.classList.add('is-disabled');
    dropdown.classList.remove('is-open');
    out.textContent = '';
    progressWrap.style.display = '';
    setBar(0);
    progressLabel.textContent = 'starting…';

    const setProgress = (m) => {
      if (m && m.progress != null) {
        const status = m.status || 'working';
        const isRecognising = status === 'recognizing text';
        setBar(isRecognising ? m.progress : 0);
        progressLabel.textContent = status + '  ' + (m.progress * 100).toFixed(0) + '%';
      }
    };

    try {
      const T = await ensureTesseract();
      activeWorker = await T.createWorker(langState.value, undefined, { logger: setProgress });
      progressLabel.textContent = 'Recognising…';
      const r = await activeWorker.recognize(ocrInput);
      await activeWorker.terminate();
      activeWorker = null;
      const MIN_CONF = 60;
      const MIN_WORD_LEN = 2;
      const words = (r.data && r.data.words) || [];
      const good = words.filter(w => w.confidence >= MIN_CONF && w.text.trim().length >= MIN_WORD_LEN);
      if (good.length === 0) {
        out.textContent = '(no text detected)';
      } else {
        const lines = {};
        for (const w of good) {
          const key = w.line ? w.line.text : '_';
          if (!lines[key]) lines[key] = [];
          lines[key].push(w.text);
        }
        out.textContent = Object.values(lines).map(ws => ws.join(' ')).join('\n');
      }
      setBar(1);
      progressLabel.textContent = good.length ? 'done' : 'no text found';
    } catch (e) {
      if (!busy) {
        out.textContent = '';
        progressLabel.textContent = 'stopped';
      } else {
        out.textContent = '[OCR failed: ' + (e && e.message ? e.message : e) + ']';
        progressLabel.textContent = 'failed';
      }
    } finally {
      busy = false;
      activeWorker = null;
      runBtn.textContent = 'Run';
      langState.disabled = false;
      trigger.classList.remove('is-disabled');
    }
  }

  function stop() {
    busy = false;
    if (activeWorker) {
      try { activeWorker.terminate(); } catch (_) {}
      activeWorker = null;
    }
  }

  runBtn.addEventListener('click', () => {
    if (busy) stop(); else run();
  });

  det.appendChild(detContent);
  card.appendChild(det);
  return card;
}

// ---------- LSB steganography planes ----------
function makeLsbPlane(srcData, w, h, offset) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const out = ctx.createImageData(w, h);
  const od = out.data;
  for (let i = 0; i < w * h; i++) {
    const v = (srcData[i * 4 + offset] & 1) * 255;
    od[i * 4] = v; od[i * 4 + 1] = v; od[i * 4 + 2] = v; od[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return cv;
}

function renderLsbPlanes(img, container) {
  const MAX_W = 400;
  const scale = Math.min(1, MAX_W / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const srcCv = document.createElement('canvas');
  srcCv.width = w; srcCv.height = h;
  const srcCtx = srcCv.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(img, 0, 0, w, h);
  const srcData = srcCtx.getImageData(0, 0, w, h).data;

  const channels = [
    { label: 'R', offset: 0 },
    { label: 'G', offset: 1 },
    { label: 'B', offset: 2 }
  ];

  const wrap = el('div', { style: 'display:flex; gap:12px; flex-wrap:wrap;' });

  let fullSrcs = null;
  function ensureFullRes() {
    if (fullSrcs) return fullSrcs;
    const fullCv = document.createElement('canvas');
    fullCv.width = img.naturalWidth; fullCv.height = img.naturalHeight;
    const fCtx = fullCv.getContext('2d', { willReadFrequently: true });
    fCtx.drawImage(img, 0, 0);
    const fullData = fCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
    fullSrcs = channels.map(ch => {
      const plane = makeLsbPlane(fullData, img.naturalWidth, img.naturalHeight, ch.offset);
      return plane.toDataURL('image/png');
    });
    return fullSrcs;
  }

  function openLsbLightbox(startIdx) {
    const lb = ensureLightbox();
    const lbWrap = lb.querySelector('.lightbox-img-wrap');
    const lbImg = lbWrap.querySelector('img:first-child');
    const toolbar = lb.querySelector('.lightbox-toolbar');
    const meta = lb.querySelector('.lightbox-meta');
    toolbar.innerHTML = '';
    lbWrap.classList.remove('anr-checkerboard');
    const overlays = lbWrap.querySelectorAll('.lightbox-peaking');
    overlays.forEach(o => { o.hidden = true; });
    lbWrap.querySelector('.lightbox-focus-map').hidden = true;
    lbWrap.querySelector('.lightbox-focus-dot').hidden = true;

    let idx = startIdx;
    function show(i) {
      idx = i;
      const ch = channels[idx];
      const srcs = ensureFullRes();
      lbImg.src = srcs[idx];
      lbImg.onload = () => sizeWrap(lbWrap, img.naturalWidth, img.naturalHeight);
      meta.textContent = 'LSB bit plane: ' + ch.label + '  (' + img.naturalWidth + ' × ' + img.naturalHeight + ')';
      prevBtn.style.visibility = idx > 0 ? 'visible' : 'hidden';
      nextBtn.style.visibility = idx < channels.length - 1 ? 'visible' : 'hidden';
      label.textContent = ch.label + ' (' + (idx + 1) + '/' + channels.length + ')';
    }

    const prevBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, '← Prev');
    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx > 0) show(idx - 1); });
    const nextBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Next →');
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx < channels.length - 1) show(idx + 1); });
    const label = el('span', { style: 'color:#fff;font-family:var(--font-mono);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;align-self:center' });
    const saveBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Save PNG');
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = el('a', { href: ensureFullRes()[idx], download: 'lsb_' + channels[idx].label.toLowerCase() + '.png' });
      document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
    });

    toolbar.appendChild(prevBtn);
    toolbar.appendChild(label);
    toolbar.appendChild(nextBtn);
    toolbar.appendChild(saveBtn);

    // Preview src first, full-res loaded in show()
    const previewSrc = makeLsbPlane(srcData, w, h, channels[idx].offset).toDataURL('image/png');
    lbImg.src = previewSrc;
    meta.textContent = 'LSB bit plane: ' + channels[idx].label + '  (loading full resolution…)';
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    sizeWrap(lbWrap, w, h);
    show(idx);
  }

  for (let ci = 0; ci < channels.length; ci++) {
    const ch = channels[ci];
    const cv = makeLsbPlane(srcData, w, h, ch.offset);
    cv.style.maxWidth = '100%';
    cv.style.imageRendering = 'pixelated';
    cv.style.cursor = 'zoom-in';
    const chIdx = ci;
    cv.addEventListener('click', () => openLsbLightbox(chIdx));
    const col = el('div', { style: 'flex:1; min-width:100px; text-align:center;' }, [
      el('div', { style: 'font-weight:600; margin-bottom:4px; font-size:13px;' }, ch.label),
      cv
    ]);
    wrap.appendChild(col);
  }

  container.appendChild(wrap);
}

// ---------- lightbox (singleton, lazy) ----------
let lightboxEl = null;
function ensureLightbox() {
  if (lightboxEl) return lightboxEl;
  lightboxEl = document.createElement('div');
  lightboxEl.className = 'lightbox';
  lightboxEl.hidden = true;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = 'Close';
  const wrap = document.createElement('div');
  wrap.className = 'lightbox-img-wrap';
  const img = document.createElement('img');
  img.alt = '';
  const mapOverlay = document.createElement('img');
  mapOverlay.className = 'lightbox-focus-map';
  mapOverlay.hidden = true;
  const dot = document.createElement('div');
  dot.className = 'lightbox-focus-dot';
  dot.hidden = true;
  const peakingCanvas = document.createElement('canvas');
  peakingCanvas.className = 'lightbox-peaking';
  peakingCanvas.hidden = true;
  const highlightsCanvas = document.createElement('canvas');
  highlightsCanvas.className = 'lightbox-peaking';
  highlightsCanvas.hidden = true;
  const shadowsCanvas = document.createElement('canvas');
  shadowsCanvas.className = 'lightbox-peaking';
  shadowsCanvas.hidden = true;
  wrap.appendChild(img);
  wrap.appendChild(peakingCanvas);
  wrap.appendChild(highlightsCanvas);
  wrap.appendChild(shadowsCanvas);
  wrap.appendChild(mapOverlay);
  wrap.appendChild(dot);
  const toolbar = document.createElement('div');
  toolbar.className = 'lightbox-toolbar';
  const meta = document.createElement('p');
  meta.className = 'lightbox-meta';
  const center = document.createElement('div');
  center.className = 'lightbox-center';
  center.appendChild(wrap);
  center.appendChild(toolbar);
  center.appendChild(meta);
  lightboxEl.appendChild(closeBtn);
  lightboxEl.appendChild(center);
  lightboxEl.addEventListener('click', (e) => {
    if (e.target === lightboxEl || e.target === closeBtn) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightboxEl.hidden) closeLightbox();
  });
  document.body.appendChild(lightboxEl);
  return lightboxEl;
}
function sizeWrap(wrap, w, h) {
  const maxW = window.innerWidth * 0.9;
  const maxH = window.innerHeight * 0.85;
  const scale = Math.min(maxW / w, maxH / h, 1);
  wrap.style.width = Math.round(w * scale) + 'px';
  wrap.style.height = Math.round(h * scale) + 'px';
}
function computePeaking(imgEl, canvas) {
  const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
  const scale = Math.min(1, 2000 / Math.max(w, h));
  const sw = Math.round(w * scale), sh = Math.round(h * scale);
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(imgEl, 0, 0, sw, sh);
  const id = tctx.getImageData(0, 0, sw, sh);
  const d = id.data;

  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(sw, sh);
  const od = out.data;
  const threshold = 220;

  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = (y * sw + x) * 4;
      const tl = ((y-1)*sw+(x-1))*4, tc = ((y-1)*sw+x)*4, tr = ((y-1)*sw+(x+1))*4;
      const ml = (y*sw+(x-1))*4,                            mr = (y*sw+(x+1))*4;
      const bl = ((y+1)*sw+(x-1))*4, bc = ((y+1)*sw+x)*4, br = ((y+1)*sw+(x+1))*4;

      let maxEdge = 0;
      for (let c = 0; c < 3; c++) {
        const gx = -d[tl+c] - 2*d[ml+c] - d[bl+c] + d[tr+c] + 2*d[mr+c] + d[br+c];
        const gy = -d[tl+c] - 2*d[tc+c] - d[tr+c] + d[bl+c] + 2*d[bc+c] + d[br+c];
        const mag = Math.sqrt(gx*gx + gy*gy);
        if (mag > maxEdge) maxEdge = mag;
      }

      if (maxEdge > threshold) {
        const a = Math.min(230, Math.round((maxEdge - threshold) * 1.0));
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= sw || ny < 0 || ny >= sh) continue;
            const ni = (ny * sw + nx) * 4;
            if (a > od[ni + 3]) {
              od[ni]     = 230;
              od[ni + 1] = 20;
              od[ni + 2] = 20;
              od[ni + 3] = a;
            }
          }
        }
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

function computeExposureOverlay(imgEl, canvas, mode) {
  const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
  const scale = Math.min(1, 2000 / Math.max(w, h));
  const sw = Math.round(w * scale), sh = Math.round(h * scale);
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(imgEl, 0, 0, sw, sh);
  const id = tctx.getImageData(0, 0, sw, sh);
  const d = id.data;

  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(sw, sh);
  const od = out.data;

  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    if (mode === 'highlights' && lum > 245) {
      od[i] = 230; od[i+1] = 20; od[i+2] = 20;
      od[i+3] = Math.min(255, Math.round((lum - 245) * 25));
    } else if (mode === 'shadows' && lum < 10) {
      od[i] = 40; od[i+1] = 100; od[i+2] = 230;
      od[i+3] = Math.min(255, Math.round((10 - lum) * 25));
    }
  }
  ctx.putImageData(out, 0, 0);
}

function openLightbox(src, alt, metaText, focusOpts, showAlpha) {
  const lb = ensureLightbox();
  const wrap = lb.querySelector('.lightbox-img-wrap');
  const lbImg = wrap.querySelector('img:first-child');
  const mapOverlay = wrap.querySelector('.lightbox-focus-map');
  const dot = wrap.querySelector('.lightbox-focus-dot');
  const toolbar = lb.querySelector('.lightbox-toolbar');
  toolbar.innerHTML = '';
  wrap.classList.remove('anr-checkerboard');
  lbImg.src = src;
  lbImg.alt = alt || '';
  lbImg.onload = () => { sizeWrap(wrap, lbImg.naturalWidth, lbImg.naturalHeight); };
  if (lbImg.complete && lbImg.naturalWidth) sizeWrap(wrap, lbImg.naturalWidth, lbImg.naturalHeight);
  const overlays = wrap.querySelectorAll('.lightbox-peaking');
  const peakingCv = overlays[0], highlightsCv = overlays[1], shadowsCv = overlays[2];
  peakingCv.hidden = true;
  highlightsCv.hidden = true;
  shadowsCv.hidden = true;
  mapOverlay.hidden = true;
  mapOverlay.src = '';
  dot.hidden = true;
  lb.querySelector('.lightbox-meta').textContent = metaText || '';

  let peakingReady = false, highlightsReady = false, shadowsReady = false;

  const peakBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Focus peaking');
  peakBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!peakingReady) { computePeaking(lbImg, peakingCv); peakingReady = true; }
    peakingCv.hidden = !peakingCv.hidden;
    peakBtn.classList.toggle('is-active', !peakingCv.hidden);
  });

  const hlBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Highlights');
  hlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!highlightsReady) { computeExposureOverlay(lbImg, highlightsCv, 'highlights'); highlightsReady = true; }
    highlightsCv.hidden = !highlightsCv.hidden;
    hlBtn.classList.toggle('is-active', !highlightsCv.hidden);
  });

  const shBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Shadows');
  shBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!shadowsReady) { computeExposureOverlay(lbImg, shadowsCv, 'shadows'); shadowsReady = true; }
    shadowsCv.hidden = !shadowsCv.hidden;
    shBtn.classList.toggle('is-active', !shadowsCv.hidden);
  });

  toolbar.appendChild(peakBtn);
  toolbar.appendChild(hlBtn);

  toolbar.appendChild(shBtn);

  if (showAlpha) {
    const alphaBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Transparency');
    alphaBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap.classList.toggle('anr-checkerboard');
      alphaBtn.classList.toggle('is-active', wrap.classList.contains('anr-checkerboard'));
    });
    toolbar.appendChild(alphaBtn);
  }

  if (focusOpts) {
    const mapSrc = focusOpts.focusCv.toDataURL();
    mapOverlay.src = mapSrc;
    dot.style.left = focusOpts.fpX + '%';
    dot.style.top = focusOpts.fpY + '%';
    const mapBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Focus map');
    mapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mapOverlay.hidden = !mapOverlay.hidden;
      mapBtn.classList.toggle('is-active', !mapOverlay.hidden);
    });
    const ptBtn = el('button', { type: 'button', class: 'lightbox-tool-btn' }, 'Probable focus point');
    ptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dot.hidden = !dot.hidden;
      ptBtn.classList.toggle('is-active', !dot.hidden);
    });
    toolbar.appendChild(mapBtn);
    toolbar.appendChild(ptBtn);
  }
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  if (!lightboxEl) return;
  lightboxEl.hidden = true;
  document.body.style.overflow = '';
}

// ---------- main render ----------
export async function renderPhoto(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Loading "${file.name}"...`));

  let imgInfo;
  let convertedFile = null;
  try {
    imgInfo = await loadImageFromFile(file);
  } catch (e) {
    const ext = fileExt(file.name);
    if (HEIC_EXTS.has(ext)) {
      resultsEl.innerHTML = '';
      resultsEl.appendChild(el('div', { class: 'anr-info' }, 'Converting HEIC/HEIF to JPEG…'));
      try {
        convertedFile = await convertHeic(file);
        imgInfo = await loadImageFromFile(convertedFile);
      } catch (e2) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(el('div', { class: 'anr-error' }, 'HEIC conversion failed: ' + (e2 && e2.message ? e2.message : e2)));
        return;
      }
    } else if (RAW_EXTS.has(ext)) {
      resultsEl.innerHTML = '';
      try {
        convertedFile = await convertWithImageMagick(file, resultsEl);
        imgInfo = await loadImageFromFile(convertedFile);
      } catch (_) {
        resultsEl.innerHTML = '';
        resultsEl.appendChild(el('div', { class: 'anr-info' }, 'Full decode failed — using embedded preview…'));
        try {
          convertedFile = await extractRawPreview(file);
          imgInfo = await loadImageFromFile(convertedFile);
        } catch (e3) {
          resultsEl.innerHTML = '';
          resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Could not decode RAW file: ' + (e3 && e3.message ? e3.message : e3)));
          return;
        }
      }
    } else {
      resultsEl.innerHTML = '';
      resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Could not load this image. The format may not be supported by your browser.'));
      return;
    }
  }
  const { img, url } = imgInfo;

  // EXIF
  let exif = null;
  try {
    exif = await exifr.parse(file, {
      tiff: true, exif: true, gps: true, iptc: true, xmp: true, icc: true, ihdr: true,
      mergeOutput: true, translateValues: true, translateKeys: true, reviveValues: true,
      sanitize: true, silentErrors: true
    });
  } catch (e) {
    console.warn('exifr error:', e);
  }

  const pixData = getPixelData(img);
  const hist = computeHistogram(pixData);
  const palette = dominantColors(pixData, 8);
  const sharpness = computeSharpness(pixData);
  const colorStats = computeColorStats(pixData);
  const blockSize = Math.max(4, Math.round(Math.min(pixData.width, pixData.height) / 48));
  const focus = detectFocusRegion(pixData, blockSize);

  let hasAlpha = false;
  for (let i = 3; i < pixData.data.length; i += 16) {
    if (pixData.data[i] < 250) { hasAlpha = true; break; }
  }

  resultsEl.innerHTML = '';

  // ---- Preview thumb in section-meta column ----
  const previewSlot = document.getElementById('photoPreview');
  if (previewSlot) {
    previewSlot.innerHTML = '';
    const thumb = el('div', { class: 'section-meta-preview' });
    const thumbImg = el('img', { src: url, alt: file.name, title: 'Click to enlarge' });
    const lightboxCaption = `${img.naturalWidth} × ${img.naturalHeight}  ·  ${fmtBytes(file.size)}  ·  ${file.name}`;
    thumbImg.addEventListener('click', () => {
      const fpPctX = (focus.focusX / pixData.width * 100).toFixed(2);
      const fpPctY = (focus.focusY / pixData.height * 100).toFixed(2);
      openLightbox(url, file.name, lightboxCaption, { focusCv, fpX: parseFloat(fpPctX), fpY: parseFloat(fpPctY) }, hasAlpha);
    });
    const imgWrap = el('div', { class: 'anr-preview-img-wrap' });
    if (hasAlpha) imgWrap.classList.add('anr-checkerboard');
    imgWrap.appendChild(thumbImg);
    thumb.appendChild(imgWrap);
    thumb.appendChild(el('p', { class: 'section-meta-preview-caption' },
      `${img.naturalWidth} × ${img.naturalHeight} · ${fmtBytes(file.size)}`));


    const focusCv = document.createElement('canvas');
    focusCv.width = focus.cols; focusCv.height = focus.rows;
    const fCtx = focusCv.getContext('2d');
    const fImg = fCtx.createImageData(focus.cols, focus.rows);
    for (let i = 0; i < focus.grid.length; i++) {
      const t = Math.min(1, focus.grid[i] / (focus.maxVar * 0.8));
      fImg.data[i*4] = Math.round(t * 255);
      fImg.data[i*4+1] = Math.round(t * 80);
      fImg.data[i*4+2] = Math.round((1 - t) * 40);
      fImg.data[i*4+3] = Math.round(t * 200);
    }
    fCtx.putImageData(fImg, 0, 0);

    if (convertedFile && RAW_EXTS.has(fileExt(file.name))) {
      thumb.appendChild(el('p', { class: 'anr-raw-warning' },
        'Full sensor resolution may not be available for all camera models.'));
    }
    previewSlot.appendChild(thumb);
  }

  // ---- Basic info ----
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File & image'));
  const w = img.naturalWidth, h = img.naturalHeight;
  const mp = ((w * h) / 1_000_000).toFixed(2);

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name',          file.name));
  tbl.appendChild(row('Size',          fmtBytes(file.size)));
  tbl.appendChild(row('Type',          file.type || '-'));
  tbl.appendChild(row('Modified',      file.lastModified ? new Date(file.lastModified).toISOString().replace('T', ' ').replace(/\..*$/, '') : '-'));
  tbl.appendChild(row('Dimensions',    `${w} × ${h} px`));
  tbl.appendChild(row('Aspect ratio',  aspectRatio(w, h)));
  tbl.appendChild(row('Megapixels',    mp + ' MP'));
  tbl.appendChild(rowHelp('Sharpness', sharpness.toFixed(1) + '  (' + sharpnessLabel(sharpness) + ')',
    'Laplacian variance of the luminance channel. Higher = sharper detail. Below 50 is typically blurry, above 200 is very sharp.'));
  const fpx = Math.round(focus.focusX / pixData.width * w);
  const fpy = Math.round(focus.focusY / pixData.height * h);
  tbl.appendChild(rowHelp('Focus point', fpx + ', ' + fpy + '  (estimated)',
    'Estimated by finding the region with highest local sharpness (Laplacian variance in a sliding window across the image).'));
  const avgHex = '#' + [colorStats.avgR, colorStats.avgG, colorStats.avgB].map((v) => v.toString(16).padStart(2, '0')).join('');
  tbl.appendChild(row('Average colour', avgHex + '  (R' + colorStats.avgR + ' G' + colorStats.avgG + ' B' + colorStats.avgB + ')'));
  tbl.appendChild(rowHelp('Tonal split', colorStats.shadows + '% shadows · ' + colorStats.midtones + '% midtones · ' + colorStats.highlights + '% highlights',
    'Pixel luminance distribution. Shadows = darkest 25%, midtones = middle 50%, highlights = brightest 25%.'));
  if (exif && exif.Orientation != null) {
    tbl.appendChild(row('Orientation', (ORIENTATIONS[exif.Orientation] || exif.Orientation)));
  }
  if (convertedFile) {
    const ext = fileExt(file.name).toUpperCase();
    const isPreview = convertedFile.name.includes('_preview');
    const convLabel = isPreview ? 'embedded preview' : 'full resolution';
    tbl.appendChild(row('Converted', ext + ' → JPEG (' + convLabel + ')'));
  }
  infoCard.appendChild(tbl);

  if (convertedFile) {
    const dlBtn = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:12px;' }, 'Download as JPEG');
    dlBtn.addEventListener('click', () => {
      const a = el('a', { href: URL.createObjectURL(convertedFile), download: convertedFile.name });
      document.body.appendChild(a); a.click();
      setTimeout(() => a.remove(), 500);
    });
    infoCard.appendChild(dlBtn);
  }

  resultsEl.appendChild(infoCard);

  // ---- EXIF sections ----
  const sections = buildExifSections(exif);
  if (sections.length) {
    const exifCard = el('div', { class: 'anr-card' });
    exifCard.appendChild(el('h3', {}, 'Metadata'));
    for (const sec of sections) {
      exifCard.appendChild(el('div', { class: 'anr-readout-section' }, sec.title));
      const t = el('table', { class: 'anr-readout' });
      for (const [k, v] of sec.rows) t.appendChild(row(k, v));
      exifCard.appendChild(t);
    }
    resultsEl.appendChild(exifCard);
  } else {
    resultsEl.appendChild(el('div', { class: 'anr-info' }, 'No EXIF / IPTC / XMP / ICC metadata found.'));
  }

  // ---- AI detection ----
  const aiHints = detectAI(exif);
  if (aiHints) {
    const aiCard = el('div', { class: 'anr-card' });
    aiCard.appendChild(el('h3', {}, 'AI detection'));
    aiCard.appendChild(el('p', { style: 'color:var(--accent);font-weight:600;margin-bottom:8px;' },
      'AI-generated content markers found'));
    const at = el('table', { class: 'anr-readout' });
    for (const h of aiHints) at.appendChild(row(h.field, h.value));
    aiCard.appendChild(at);
    aiCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:8px;' },
      'Based on metadata fields. Not all AI-generated images contain markers, and some markers can be spoofed.'));
    resultsEl.appendChild(aiCard);
  } else if (exif) {
    const aiCard = el('div', { class: 'anr-card' });
    aiCard.appendChild(el('h3', {}, 'AI detection'));
    aiCard.appendChild(el('p', { class: 'anr-hint' }, 'No AI-generation markers found in metadata.'));
    resultsEl.appendChild(aiCard);
  }

  // ---- GPS ----
  // Number.isFinite (not `!= null`) so NaN/undefined coordinates are rejected —
  // mobile camera photos without a GPS fix were slipping through as NaN and
  // rendering a 0,0 / NaN map. Also skip the 0,0 null-island placeholder.
  if (exif && Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude) && !(exif.latitude === 0 && exif.longitude === 0)) {
    const gpsCard = el('div', { class: 'anr-card' });
    gpsCard.appendChild(el('h3', {}, 'GPS'));
    const lat = exif.latitude, lon = exif.longitude;
    const gt = el('table', { class: 'anr-readout' });
    gt.appendChild(row('Latitude',  lat.toFixed(6) + '°'));
    gt.appendChild(row('Longitude', lon.toFixed(6) + '°'));
    if (exif.GPSAltitude != null) gt.appendChild(row('Altitude', (+exif.GPSAltitude).toFixed(1) + ' m'));
    if (exif.GPSImgDirection != null) gt.appendChild(row('Image direction', (+exif.GPSImgDirection).toFixed(1) + '°'));
    if (exif.GPSSpeed != null) gt.appendChild(row('Speed', exif.GPSSpeed + ' ' + (exif.GPSSpeedRef || '')));
    gpsCard.appendChild(gt);

    const linkRow = el('p', {}, [
      '> open in ',
      el('a', { href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`, target: '_blank' }, 'OpenStreetMap'),
      ' / ',
      el('a', { href: `https://www.google.com/maps?q=${lat},${lon}`, target: '_blank' }, 'Google Maps')
    ]);
    gpsCard.appendChild(linkRow);

    const mapDiv = el('div', { class: 'anr-map' });
    mapDiv.appendChild(el('p', { style: 'padding:8px; margin:0;' }, 'loading map...'));
    gpsCard.appendChild(mapDiv);
    resultsEl.appendChild(gpsCard);
    makeMap(mapDiv, lat, lon, file.name);
  }

  // ---- Histogram in section-meta column ----
  const histSlot = document.getElementById('photoHistSlot');
  if (histSlot) {
    histSlot.innerHTML = '';
    const histCard = el('div', { class: 'anr-card' });
    const [histH, histHelp] = h3help('Histogram', 'RGB colour histogram. Shows the distribution of red, green, and blue intensity values across all pixels. Peaks on the left mean dark tones dominate; peaks on the right mean bright tones. Click to open in lightbox.');
    histCard.appendChild(histH); histCard.appendChild(histHelp);
    const histCanvas = el('canvas', { class: 'anr-histogram' });
    histCanvas.width = 1024; histCanvas.height = 200;
    histCanvas.style.cursor = 'zoom-in';
    histCanvas.addEventListener('click', () => {
      openLightbox(histCanvas.toDataURL('image/png'), 'RGB Histogram', 'RGB Histogram');
    });
    histCard.appendChild(histCanvas);
    renderHistogram(histCanvas, hist);
    histSlot.appendChild(histCard);
  }

  // ---- Palette ----
  const palCard = el('div', { class: 'anr-card' });
  const [palH, palHelp] = h3help('Dominant colours', 'Extracted via median-cut colour quantization. The image is repeatedly split along the colour channel with the widest range until 8 representative colours remain. Click a swatch to copy its hex value.');
  palCard.appendChild(palH); palCard.appendChild(palHelp);
  const palDiv = el('div', { class: 'anr-palette' });
  const totalPx = pixData.width * pixData.height;
  for (const c of palette) {
    const hex = toHex(c);
    const sw = el('div', {
      class: 'anr-swatch',
      title: hex + '  ' + ((c.count / totalPx) * 100).toFixed(1) + '% — click to copy',
      style: 'cursor:pointer;',
      onclick: () => {
        navigator.clipboard.writeText(hex).then(() => {
          const label = sw.querySelector('span');
          if (label) { label.textContent = 'copied'; setTimeout(() => { label.textContent = hex; }, 800); }
        });
      }
    });
    sw.style.background = hex;
    sw.appendChild(el('span', {}, hex));
    palDiv.appendChild(sw);
  }
  palCard.appendChild(palDiv);
  resultsEl.appendChild(palCard);

  // ---- QR code detection (async) ----
  const qrPlaceholder = el('div');
  resultsEl.appendChild(qrPlaceholder);
  detectQrCode(img).then((qr) => {
    if (!qr || !qr.data) { qrPlaceholder.remove(); return; }
    const qrCard = el('div', { class: 'anr-card' });
    qrCard.appendChild(el('h3', {}, 'QR code detected'));
    const qt = el('table', { class: 'anr-readout' });
    qt.appendChild(row('Data', qr.data));
    if (qr.data.startsWith('http'))
      qt.appendChild(row('Link', el('a', { href: qr.data, target: '_blank', rel: 'noopener' }, qr.data)));
    qrCard.appendChild(qt);
    qrPlaceholder.replaceWith(qrCard);
  }).catch(() => { qrPlaceholder.remove(); });

  // ---- OCR in section-meta column ----
  const ocrSlot = document.getElementById('photoOcrSlot');
  if (ocrSlot) {
    ocrSlot.innerHTML = '';
    ocrSlot.appendChild(makeOcrCard(file, img));
  }

  // ---- Hash + raw EXIF dump (collapsible) ----
  const hashCard = el('div', { class: 'anr-card' });
  const [hashH, hashHelp] = h3help('Integrity', '<strong>pHash</strong> (perceptual hash) is a fingerprint of the image content. Similar-looking images produce similar hashes, even after resizing or recompression. Useful for finding duplicates.<br><strong>SHA-256</strong> is a cryptographic hash of the raw file bytes. Any change to the file, even one bit, produces a completely different hash. Useful for verifying a file has not been tampered with.');
  hashCard.appendChild(hashH); hashCard.appendChild(hashHelp);
  const phash = computePHash(img);
  const hashTbl = el('table', { class: 'anr-readout' });
  hashTbl.appendChild(rowHelp('pHash', phash,
    'Perceptual hash — a fingerprint of image content. Similar images produce similar hashes, even after resizing or compression.'));
  const shaRow = row('SHA-256', 'computing…');
  hashTbl.appendChild(shaRow);
  hashCard.appendChild(hashTbl);
  resultsEl.appendChild(hashCard);
  sha256Hex(file).then((h) => {
    shaRow.querySelector('td').textContent = h || 'unavailable';
  });

  // ---- LSB steganography analysis ----
  const lsbCard = el('div', { class: 'anr-card' });
  const lsbDet = el('details');
  const [lsbH, lsbHelp] = h3help('LSB Analysis', 'LSB (Least Significant Bit) analysis isolates the lowest bit of each colour channel (R, G, B) and renders it as a black-and-white image. In a normal photograph these planes look like random noise. Visible patterns, text, or structure in the LSB plane can indicate steganographic data (hidden messages embedded in the image) or heavy editing. Click a preview to open it at full resolution.');
  lsbDet.appendChild(el('summary', {}, 'LSB Analysis'));
  const lsbContent = el('div');
  lsbContent.appendChild(lsbHelp);
  renderLsbPlanes(img, lsbContent);
  lsbDet.appendChild(lsbContent);
  lsbCard.appendChild(lsbDet);
  resultsEl.appendChild(lsbCard);

  const raw = buildRawDump(exif);
  if (raw && raw.length) {
    const dumpCard = el('div', { class: 'anr-card' });
    const det = el('details');
    det.appendChild(el('summary', {}, 'Raw metadata dump  (' + raw.length + ' tags)'));
    const t = el('table', { class: 'anr-readout' });
    for (const [k, v] of raw) t.appendChild(row(k, v));
    det.appendChild(t);
    dumpCard.appendChild(det);
    resultsEl.appendChild(dumpCard);
  }
}

// ---------- setup ----------
export function initPhoto({ dropEl, inputEl, resultsEl, onFile }) {
  const handle = onFile || ((file) => renderPhoto(file, resultsEl));
  inputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handle(file);
    inputEl.value = '';
  });
  // Visual highlight only; the actual drop is handled at the window level
  // so it can dispatch the file to the right module based on its type.
  ['dragenter', 'dragover'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.add('is-dragover'))
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.remove('is-dragover'))
  );
}
