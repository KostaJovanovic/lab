/* Analyser - photo module
   - File preview + basic info (size, MIME, dimensions, aspect ratio, megapixels)
   - Full EXIF / IPTC / XMP / ICC / GPS via exifr (global)
   - RGB color histogram (canvas)
   - Dominant colors (color quantization)
   - GPS map via lazy-loaded Leaflet + OSM
   - On-device OCR via lazy-loaded Tesseract.js with language picker
   - SHA-256 file hash */

const JSQR_URL      = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
const LEAFLET_CSS   = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS    = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const HEIC2ANY_URL  = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';

const TESSERACT_LANGS = [
  ['eng', 'English'],
  ['srp', 'Serbian (Cyrillic)'],
  ['srp_latn', 'Serbian (Latin)'],
  ['hrv', 'Croatian'],
  ['deu', 'German'],
  ['fra', 'French'],
  ['ita', 'Italian'],
  ['spa', 'Spanish'],
  ['rus', 'Russian'],
  ['ell', 'Greek'],
  ['ara', 'Arabic'],
  ['jpn', 'Japanese'],
  ['chi_sim', 'Chinese (Simplified)'],
  ['chi_tra', 'Chinese (Traditional)'],
  ['kor', 'Korean'],
  ['heb', 'Hebrew'],
  ['tur', 'Turkish'],
  ['ukr', 'Ukrainian'],
  ['pol', 'Polish'],
  ['ron', 'Romanian'],
  ['hun', 'Hungarian'],
  ['ces', 'Czech'],
  ['slk', 'Slovak'],
  ['slv', 'Slovenian'],
  ['bul', 'Bulgarian'],
  ['mkd', 'Macedonian'],
  ['nld', 'Dutch'],
  ['por', 'Portuguese'],
  ['swe', 'Swedish'],
  ['nor', 'Norwegian'],
  ['fin', 'Finnish'],
  ['dan', 'Danish']
];

// ---------- helpers ----------
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function row(label, value) {
  return el('tr', {}, [
    el('th', {}, label),
    el('td', {}, value == null || value === '' ? '-' : String(value))
  ]);
}

function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

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

async function sha256Hex(file) {
  if (!crypto.subtle) return null;
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
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
function loadCss(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) return resolve();
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = resolve; l.onerror = resolve;
    document.head.appendChild(l);
  });
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

const HEIC_EXTS = new Set(['heic', 'heif', 'heics', 'heifs']);

function fileExt(name) {
  const m = (name || '').match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

async function convertHeic(file) {
  await loadScript(HEIC2ANY_URL);
  const blob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const out = Array.isArray(blob) ? blob[0] : blob;
  return new File([out], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
}

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
async function ensureTesseract() {
  if (window.Tesseract) return window.Tesseract;
  await loadScript(TESSERACT_URL);
  return window.Tesseract;
}

/**
 * Two-pass OCR pipeline used by the default "Auto" language option.
 *
 *   1. Start the English worker download.
 *   2. Start the Serbian (Latin + Cyrillic) worker download IN PARALLEL — so
 *      while we're recognising English text, Serbian models keep streaming
 *      from the CDN in the background.
 *   3. Once the English worker is ready, run recognition with it and append
 *      the text. (Unless the user pressed "Skip English" — see below.)
 *   4. Await the Serbian worker (likely already loaded by now), recognise,
 *      append the text.
 *
 * The `getSkipEng()` flag and `registerEngWorker` callback let the caller
 * (the OCR card) abort the English half mid-flight when the user clicks
 * "Skip English": the English worker is terminated and we jump straight to
 * the Serbian phase. Useful when you already know the text isn't English.
 */
async function runOcrAuto(file, ui) {
  const { setPhase, setProgress, appendResult, getSkipEng, registerEngWorker } = ui;
  const T = await ensureTesseract();

  setPhase('Downloading English…');

  // Kick off BOTH downloads in parallel. Serbian continues in the background
  // while English is analysing.
  let engWorker = null, srpWorker = null;
  const engPromise = T.createWorker('eng', undefined, {
    logger: (m) => setProgress(m, 'eng')
  }).then((w) => { engWorker = w; registerEngWorker(w); return w; });

  const srpPromise = T.createWorker('srp+srp_latn', undefined, {
    logger: (m) => setProgress(m, 'srp')
  });

  // English phase
  try {
    await engPromise;
  } catch (e) {
    appendResult('[English download failed: ' + (e && e.message ? e.message : e) + ']');
  }

  if (!getSkipEng() && engWorker) {
    setPhase('Running English…');
    try {
      const r = await engWorker.recognize(file);
      if (!getSkipEng()) appendResult('── English ──\n' + ((r.data && r.data.text) || '(no text)'));
    } catch (e) {
      if (!getSkipEng()) appendResult('[English OCR aborted]');
    }
    try { await engWorker.terminate(); } catch (_) {}
  } else if (engWorker) {
    setPhase('Skipped English.');
    try { await engWorker.terminate(); } catch (_) {}
  }

  // Serbian phase (download may or may not still be in flight)
  setPhase('Waiting for Serbian model…');
  try {
    srpWorker = await srpPromise;
  } catch (e) {
    appendResult('[Serbian download failed: ' + (e && e.message ? e.message : e) + ']');
    return;
  }

  setPhase('Running Serbian (Latin + Cyrillic)…');
  try {
    const r = await srpWorker.recognize(file);
    appendResult('── Serbian (Latin + Cyrillic) ──\n' + ((r.data && r.data.text) || '(no text)'));
  } catch (e) {
    appendResult('[Serbian OCR failed: ' + (e && e.message ? e.message : e) + ']');
  }
  try { await srpWorker.terminate(); } catch (_) {}

  setPhase('Done.');
}

function makeOcrCard(file) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'OCR'));

  const langSel = el('select', {});
  langSel.appendChild(el('option', { value: 'auto' },        'Auto: English then Serbian'));
  langSel.appendChild(el('option', { value: 'srp+srp_latn' }, 'Serbian only (Latin + Cyrillic)'));
  langSel.appendChild(el('option', { value: 'eng' },          'English only'));
  for (const [code, name] of TESSERACT_LANGS) {
    if (code === 'eng' || code === 'srp' || code === 'srp_latn') continue;
    langSel.appendChild(el('option', { value: code }, name + '  [' + code + ']'));
  }
  langSel.value = 'auto';

  const runBtn  = el('button', { type: 'button', class: 'anr-btn' }, 'Re-run');
  const skipBtn = el('button', { type: 'button', class: 'anr-btn', style: 'display:none;' }, 'Skip English');

  const controlsRow = el('div', { class: 'anr-controls' }, [
    el('div', { class: 'anr-control' }, [el('label', {}, 'Lang'), langSel]),
    el('div', { class: 'anr-control' }, [runBtn]),
    el('div', { class: 'anr-control' }, [skipBtn])
  ]);
  card.appendChild(controlsRow);

  const progressWrap  = el('div', { class: 'anr-progress', style: 'display:none' });
  const progressFill  = el('div', { class: 'anr-progress-fill' });
  const progressLabel = el('div', { class: 'anr-progress-label' }, '');
  progressWrap.appendChild(progressFill);
  progressWrap.appendChild(progressLabel);
  card.appendChild(progressWrap);

  const out = el('pre', { class: 'anr-ocr-text' });
  card.appendChild(out);

  let busy = false;
  let skipEng = false;
  let engWorkerRef = null;

  function syncSkipBtn() {
    skipBtn.style.display = (langSel.value === 'auto' && busy) ? '' : 'none';
  }

  async function run() {
    if (busy) return;
    busy = true;
    skipEng = false;
    engWorkerRef = null;
    runBtn.disabled = true;
    langSel.disabled = true;
    out.textContent = '';
    progressWrap.style.display = '';
    progressFill.style.width = '0%';
    progressLabel.textContent = 'starting…';
    syncSkipBtn();

    const setProgress = (m, which) => {
      if (m && m.progress != null) {
        progressFill.style.width = (m.progress * 100).toFixed(0) + '%';
        progressLabel.textContent =
          (which ? which + ' ' : '') + (m.status || 'working') + '  ' + (m.progress * 100).toFixed(0) + '%';
      }
    };
    const setPhase = (s) => { progressLabel.textContent = s; };
    const appendResult = (text) => {
      out.textContent = out.textContent ? (out.textContent + '\n\n' + text) : text;
    };

    try {
      if (langSel.value === 'auto') {
        await runOcrAuto(file, {
          setPhase, setProgress, appendResult,
          getSkipEng: () => skipEng,
          registerEngWorker: (w) => { engWorkerRef = w; }
        });
      } else {
        const T = await ensureTesseract();
        const worker = await T.createWorker(langSel.value, undefined, { logger: setProgress });
        setPhase('Recognising…');
        const r = await worker.recognize(file);
        out.textContent = (r.data && r.data.text) || '(no text)';
        await worker.terminate();
      }
      progressFill.style.width = '100%';
      if (!progressLabel.textContent || /\d/.test(progressLabel.textContent)) progressLabel.textContent = 'done';
    } catch (e) {
      out.textContent = '[OCR failed: ' + (e && e.message ? e.message : e) + ']';
      progressLabel.textContent = 'failed';
    } finally {
      busy = false;
      runBtn.disabled = false;
      langSel.disabled = false;
      syncSkipBtn();
    }
  }

  runBtn.addEventListener('click', run);
  skipBtn.addEventListener('click', () => {
    skipEng = true;
    progressLabel.textContent = 'Skipping English…';
    if (engWorkerRef) { try { engWorkerRef.terminate(); } catch (_) {} }
    skipBtn.style.display = 'none';
  });
  langSel.addEventListener('change', syncSkipBtn);

  // Auto-run on creation
  setTimeout(run, 600);

  return card;
}

// ---------- LSB steganography planes ----------
function renderLsbPlanes(img, container) {
  const MAX_W = 400;
  const scale = Math.min(1, MAX_W / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  // Draw source image scaled down
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

  for (const ch of channels) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.style.maxWidth = '100%';
    cv.style.imageRendering = 'pixelated';
    const ctx = cv.getContext('2d');
    const out = ctx.createImageData(w, h);
    const od = out.data;

    for (let i = 0; i < w * h; i++) {
      const v = (srcData[i * 4 + ch.offset] & 1) * 255;
      od[i * 4]     = v;
      od[i * 4 + 1] = v;
      od[i * 4 + 2] = v;
      od[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);

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
  const img = document.createElement('img');
  img.alt = '';
  const meta = document.createElement('p');
  meta.className = 'lightbox-meta';
  lightboxEl.appendChild(closeBtn);
  lightboxEl.appendChild(img);
  lightboxEl.appendChild(meta);
  lightboxEl.addEventListener('click', (e) => {
    if (e.target === lightboxEl || e.target === closeBtn) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightboxEl.hidden) closeLightbox();
  });
  document.body.appendChild(lightboxEl);
  return lightboxEl;
}
function openLightbox(src, alt, metaText) {
  const lb = ensureLightbox();
  lb.querySelector('img').src = src;
  lb.querySelector('img').alt = alt || '';
  lb.querySelector('.lightbox-meta').textContent = metaText || '';
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
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let imgInfo;
  let convertedFile = null;
  try {
    imgInfo = await loadImageFromFile(file);
  } catch (e) {
    if (HEIC_EXTS.has(fileExt(file.name))) {
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
  const blockSize = Math.max(4, Math.round(Math.min(pixData.width, pixData.height) / 12));
  const focus = detectFocusRegion(pixData, blockSize);

  resultsEl.innerHTML = '';

  // ---- Preview thumb in section-meta column (click to open lightbox + color picker) ----
  const previewSlot = document.getElementById('photoPreview');
  if (previewSlot) {
    previewSlot.innerHTML = '';
    const thumb = el('div', { class: 'section-meta-preview' });
    const thumbImg = el('img', { src: url, alt: file.name, title: 'Click to enlarge' });
    const lightboxCaption = `${img.naturalWidth} × ${img.naturalHeight}  ·  ${fmtBytes(file.size)}  ·  ${file.name}`;
    thumbImg.addEventListener('click', () => openLightbox(url, file.name, lightboxCaption));
    thumb.appendChild(thumbImg);
    thumb.appendChild(el('p', { class: 'section-meta-preview-caption' },
      `${img.naturalWidth} × ${img.naturalHeight} · ${fmtBytes(file.size)}`));

    const pickerCanvas = document.createElement('canvas');
    pickerCanvas.width = img.naturalWidth;
    pickerCanvas.height = img.naturalHeight;
    pickerCanvas.getContext('2d').drawImage(img, 0, 0);

    const tooltip = el('div', { class: 'anr-picker-tooltip' });
    tooltip.hidden = true;
    thumb.appendChild(tooltip);
    thumb.style.position = 'relative';

    thumbImg.style.cursor = 'crosshair';
    thumbImg.addEventListener('mousemove', (e) => {
      const rect = thumbImg.getBoundingClientRect();
      const sx = (e.clientX - rect.left) / rect.width;
      const sy = (e.clientY - rect.top)  / rect.height;
      const px = Math.min(pickerCanvas.width - 1, Math.max(0, Math.floor(sx * pickerCanvas.width)));
      const py = Math.min(pickerCanvas.height - 1, Math.max(0, Math.floor(sy * pickerCanvas.height)));
      const [r, g, b] = pickerCanvas.getContext('2d').getImageData(px, py, 1, 1).data;
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      const hsl = rgbToHsl(r, g, b);
      tooltip.innerHTML = '';
      tooltip.appendChild(el('span', { class: 'anr-picker-swatch', style: 'background:' + hex }));
      tooltip.appendChild(document.createTextNode(hex + '  rgb(' + r + ',' + g + ',' + b + ')  hsl(' + hsl + ')'));
      tooltip.hidden = false;
      tooltip.style.left = (sx * 100) + '%';
      tooltip.style.top = Math.max(0, e.clientY - rect.top - 32) + 'px';
    });
    thumbImg.addEventListener('mouseleave', () => { tooltip.hidden = true; });
    thumbImg.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = thumbImg.getBoundingClientRect();
      const sx = (e.clientX - rect.left) / rect.width;
      const sy = (e.clientY - rect.top)  / rect.height;
      const px = Math.min(pickerCanvas.width - 1, Math.max(0, Math.floor(sx * pickerCanvas.width)));
      const py = Math.min(pickerCanvas.height - 1, Math.max(0, Math.floor(sy * pickerCanvas.height)));
      const [r, g, b] = pickerCanvas.getContext('2d').getImageData(px, py, 1, 1).data;
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      navigator.clipboard.writeText(hex).catch(() => {});
      tooltip.classList.add('is-copied');
      setTimeout(() => tooltip.classList.remove('is-copied'), 800);
    });

    const focusCv = document.createElement('canvas');
    focusCv.width = focus.cols; focusCv.height = focus.rows;
    const fCtx = focusCv.getContext('2d');
    const fImg = fCtx.createImageData(focus.cols, focus.rows);
    for (let i = 0; i < focus.grid.length; i++) {
      const t = Math.min(1, focus.grid[i] / (focus.maxVar * 0.8));
      fImg.data[i*4] = Math.round(t * 255);
      fImg.data[i*4+1] = Math.round(t * 80);
      fImg.data[i*4+2] = Math.round((1 - t) * 40);
      fImg.data[i*4+3] = Math.round(t * 120);
    }
    fCtx.putImageData(fImg, 0, 0);
    const focusOverlay = el('img', { class: 'anr-focus-overlay', src: focusCv.toDataURL(), alt: 'Focus heatmap' });
    focusOverlay.hidden = true;
    thumb.appendChild(focusOverlay);

    const focusToggle = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:6px; width:100%; font-size:11px;' }, 'Show focus map');
    focusToggle.addEventListener('click', () => {
      focusOverlay.hidden = !focusOverlay.hidden;
      focusToggle.textContent = focusOverlay.hidden ? 'Show focus map' : 'Hide focus map';
    });
    thumb.appendChild(focusToggle);

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
  tbl.appendChild(row('Sharpness',    sharpness.toFixed(1) + '  (' + sharpnessLabel(sharpness) + ')'));
  const fpx = Math.round(focus.focusX / pixData.width * w);
  const fpy = Math.round(focus.focusY / pixData.height * h);
  tbl.appendChild(row('Focus point',  fpx + ', ' + fpy + '  (estimated)'));
  const avgHex = '#' + [colorStats.avgR, colorStats.avgG, colorStats.avgB].map((v) => v.toString(16).padStart(2, '0')).join('');
  tbl.appendChild(row('Average colour', avgHex + '  (R' + colorStats.avgR + ' G' + colorStats.avgG + ' B' + colorStats.avgB + ')'));
  tbl.appendChild(row('Tonal split',   colorStats.shadows + '% shadows · ' + colorStats.midtones + '% midtones · ' + colorStats.highlights + '% highlights'));
  if (exif && exif.Orientation != null) {
    tbl.appendChild(row('Orientation', (ORIENTATIONS[exif.Orientation] || exif.Orientation)));
  }
  if (convertedFile) {
    tbl.appendChild(row('Converted', 'HEIC → JPEG'));
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

  // ---- GPS ----
  if (exif && exif.latitude != null && exif.longitude != null) {
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
    histCard.appendChild(el('h3', {}, 'Histogram'));
    const histCanvas = el('canvas', { class: 'anr-histogram' });
    histCanvas.width = 1024; histCanvas.height = 200;
    histCard.appendChild(histCanvas);
    renderHistogram(histCanvas, hist);
    histSlot.appendChild(histCard);
  }

  // ---- Palette ----
  const palCard = el('div', { class: 'anr-card' });
  palCard.appendChild(el('h3', {}, 'Dominant colours'));
  const palDiv = el('div', { class: 'anr-palette' });
  const totalPx = pixData.width * pixData.height;
  for (const c of palette) {
    const sw = el('div', { class: 'anr-swatch', title: toHex(c) + '  ' + ((c.count / totalPx) * 100).toFixed(1) + '%' });
    sw.style.background = toHex(c);
    sw.appendChild(el('span', {}, toHex(c)));
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
    ocrSlot.appendChild(makeOcrCard(file));
  }

  // ---- Hash + raw EXIF dump (collapsible) ----
  const hashCard = el('div', { class: 'anr-card' });
  hashCard.appendChild(el('h3', {}, 'Integrity'));
  const phash = computePHash(img);
  const hashTbl = el('table', { class: 'anr-readout' });
  hashTbl.appendChild(row('pHash', phash));
  const shaRow = row('SHA-256', 'computing…');
  hashTbl.appendChild(shaRow);
  hashCard.appendChild(hashTbl);
  resultsEl.appendChild(hashCard);
  sha256Hex(file).then((h) => {
    shaRow.querySelector('td').textContent = h || 'unavailable';
  });

  // ---- LSB steganography analysis ----
  const lsbCard = el('div', { class: 'anr-card' });
  lsbCard.appendChild(el('h3', {}, 'LSB Analysis'));
  renderLsbPlanes(img, lsbCard);
  lsbCard.appendChild(el('p', { style: 'margin:8px 0 0; font-size:12px; opacity:0.7;' },
    'Least significant bit plane — patterns may indicate hidden data'));
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
