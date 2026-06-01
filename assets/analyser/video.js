/* Analyser - video module
   Handles video files: playback, container/codec detection, frame rate,
   frame capture (routed to photo analysis), audio track extraction
   (waveform + spectrogram via audio module). */

import { makeSpectrogramPanel } from './audio.js';
import { renderPhoto } from './photo.js';

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
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function aspectRatio(w, h) {
  if (!w || !h) return '-';
  const d = gcd(w, h);
  return `${w / d}:${h / d}  (${(w / h).toFixed(4)})`;
}

function formatDuration(sec) {
  if (!isFinite(sec)) return '-';
  if (sec < 60) return sec.toFixed(2) + 's';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + s.toFixed(0).padStart(2, '0');
  return m + ':' + s.toFixed(1).padStart(4, '0');
}

function fmtDate(d) {
  if (!d) return '-';
  if (d instanceof Date) return d.toISOString().replace('T', ' ').replace(/\..*$/, '');
  return String(d);
}

async function sha256Hex(file) {
  if (!crypto.subtle) return null;
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// ---------- container detection from magic bytes ----------

async function peekVideoContainer(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = (s, l) => String.fromCharCode(...head.slice(s, s + l));

  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4).trim();
    const names = {
      'isom': 'MP4', 'iso2': 'MP4', 'mp41': 'MP4', 'mp42': 'MP4',
      'M4V': 'M4V', 'qt': 'QuickTime MOV',
      'avc1': 'MP4 (H.264)', 'hvc1': 'MP4 (H.265)',
      '3gp4': '3GP', '3gp5': '3GP', '3g2a': '3G2'
    };
    return { container: names[brand] || 'MP4 / MOV', brand };
  }
  if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3)
    return { container: 'Matroska / WebM' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'AVI ')
    return { container: 'AVI' };
  if (ascii(0, 3) === 'FLV')
    return { container: 'FLV' };
  if (head[0] === 0x47)
    return { container: 'MPEG-TS' };
  if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0xBA)
    return { container: 'MPEG-PS' };
  if (ascii(0, 4) === 'OggS')
    return { container: 'OGG (Theora)' };
  if (head[0] === 0x30 && head[1] === 0x26 && head[2] === 0xB2 && head[3] === 0x75)
    return { container: 'WMV / ASF' };
  return { container: 'unknown' };
}

// ---------- frame rate detection via requestVideoFrameCallback ----------

function roundFps(raw) {
  const standard = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120, 240];
  let closest = raw, minDiff = Infinity;
  for (const s of standard) {
    const d = Math.abs(raw - s);
    if (d < minDiff) { minDiff = d; closest = s; }
  }
  return minDiff < 0.5 ? closest : Math.round(raw * 100) / 100;
}

async function detectFps(url) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return null;

  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;

  try {
    await new Promise((resolve, reject) => {
      v.oncanplay = resolve;
      v.onerror = reject;
      setTimeout(reject, 8000);
    });
  } catch (_) {
    v.removeAttribute('src');
    v.load();
    return null;
  }

  return new Promise((resolve) => {
    const times = [];
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      v.pause();
      v.removeAttribute('src');
      v.load();
      if (times.length < 2) { resolve(null); return; }
      let total = 0;
      for (let i = 1; i < times.length; i++) total += times[i] - times[i - 1];
      const avg = total / (times.length - 1);
      resolve(avg > 0 ? roundFps(1 / avg) : null);
    }

    function onFrame(_now, meta) {
      times.push(meta.mediaTime);
      if (times.length >= 20 || (times.length > 2 && meta.mediaTime > 1)) { finish(); return; }
      v.requestVideoFrameCallback(onFrame);
    }

    v.requestVideoFrameCallback(onFrame);
    v.play().catch(() => finish());
    setTimeout(finish, 5000);
  });
}

// ---------- scene change detection ----------

async function detectSceneChanges(video, threshold) {
  if (!isFinite(video.duration) || video.duration <= 0) return [];

  const dur = video.duration;
  const tw = 160, th = 90;

  // Decide sample interval: aim for ~2 samples/sec for short clips, cap at
  // reasonable totals for long videos (max ~600 samples = 5 min at 0.5s).
  const interval = dur < 120 ? 0.5 : Math.max(0.5, dur / 600);
  const sampleCount = Math.floor(dur / interval);
  if (sampleCount < 2) return [];

  const cmpCanvas = document.createElement('canvas');
  cmpCanvas.width = tw;
  cmpCanvas.height = th;
  const cmpCtx = cmpCanvas.getContext('2d', { willReadFrequently: true });

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = tw;
  thumbCanvas.height = th;
  const thumbCtx = thumbCanvas.getContext('2d');

  let prevData = null;
  const changes = [];

  for (let i = 0; i <= sampleCount; i++) {
    const t = Math.min(i * interval, dur - 0.05);
    video.currentTime = t;
    await new Promise(r => { video.onseeked = r; });

    cmpCtx.drawImage(video, 0, 0, tw, th);
    const frame = cmpCtx.getImageData(0, 0, tw, th);

    if (prevData) {
      let sum = 0;
      const px = tw * th;
      const d = frame.data;
      const p = prevData.data;
      for (let j = 0; j < px; j++) {
        const off = j * 4;
        sum += Math.abs(d[off]     - p[off]);
        sum += Math.abs(d[off + 1] - p[off + 1]);
        sum += Math.abs(d[off + 2] - p[off + 2]);
      }
      const meanDiff = sum / (px * 3);

      if (meanDiff > threshold) {
        thumbCtx.drawImage(video, 0, 0, tw, th);
        changes.push({
          time: t,
          diff: meanDiff,
          thumbnail: thumbCanvas.toDataURL('image/jpeg', 0.8)
        });
      }
    }

    prevData = frame;
  }

  return changes;
}

// ---------- audio helpers ----------

function getMono(audioBuffer) {
  const n = audioBuffer.length;
  const out = new Float32Array(n);
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const k = 1 / audioBuffer.numberOfChannels;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

function computeStats(samples) {
  let peak = 0, sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return {
    peak, rms,
    peakDb: 20 * Math.log10(peak + 1e-12),
    rmsDb: 20 * Math.log10(rms + 1e-12)
  };
}

function renderWaveform(canvas, samples) {
  const c = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  c.fillStyle = '#1a1a1a';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#445f74';
  c.lineWidth = 1;
  c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
  if (!samples.length) return;
  const spp = samples.length / w;
  c.fillStyle = '#80a4ba';
  for (let x = 0; x < w; x++) {
    const s = Math.floor(x * spp), e = Math.floor((x + 1) * spp);
    let mn = 1, mx = -1;
    for (let i = s; i < e && i < samples.length; i++) {
      if (samples[i] < mn) mn = samples[i];
      if (samples[i] > mx) mx = samples[i];
    }
    const y1 = ((1 - mx) / 2) * h, y2 = ((1 - mn) / 2) * h;
    c.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  c.strokeStyle = '#C8DCE8';
  c.strokeRect(0, 0, w, h);
}

// ---------- main render ----------

export async function renderVideo(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Loading "${file.name}"…`));
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let header = {};
  try { header = await peekVideoContainer(file); } catch (_) {}

  const url = URL.createObjectURL(file);

  const probe = document.createElement('video');
  probe.preload = 'auto';
  probe.muted = true;
  probe.playsInline = true;

  try {
    await new Promise((resolve, reject) => {
      probe.onloadeddata = resolve;
      probe.onerror = () => reject(new Error('format not supported'));
      probe.src = url;
    });
  } catch (_) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' },
      'Could not load this video. Format may not be supported by your browser.'));
    return;
  }

  const vw = probe.videoWidth;
  const vh = probe.videoHeight;
  const dur = probe.duration;

  resultsEl.innerHTML = '';

  // ---- Thumbnail in section-meta ----
  const previewSlot = document.getElementById('videoPreview');
  if (previewSlot && vw && vh) {
    previewSlot.innerHTML = '';
    const cv = document.createElement('canvas');
    const scale = Math.min(1, 400 / Math.max(vw, vh));
    cv.width = Math.round(vw * scale);
    cv.height = Math.round(vh * scale);
    cv.getContext('2d').drawImage(probe, 0, 0, cv.width, cv.height);
    const thumb = el('div', { class: 'section-meta-preview' });
    thumb.appendChild(el('img', { src: cv.toDataURL('image/jpeg', 0.85), alt: file.name }));
    thumb.appendChild(el('p', { class: 'section-meta-preview-caption' },
      `${vw} × ${vh} · ${formatDuration(dur)} · ${fmtBytes(file.size)}`));
    previewSlot.appendChild(thumb);
  }

  probe.pause();
  probe.removeAttribute('src');
  probe.load();

  // ---- Player ----
  const playerCard = el('div', { class: 'anr-card' });
  playerCard.appendChild(el('h3', {}, 'Player'));
  const playerEl = el('video', { controls: '', src: url });
  playerEl.style.cssText = 'width:100%; max-height:480px; background:#0a0a0a; display:block; border:1px solid var(--hairline);';
  playerCard.appendChild(playerEl);

  // ---- Frame-by-frame navigation ----
  const frameTimeLabel = el('span', { class: 'anr-hint', style: 'min-width:90px; text-align:center; font-variant-numeric:tabular-nums;' }, '0:00.000');

  function updateFrameTimeLabel() {
    const t = playerEl.currentTime;
    const m = Math.floor(t / 60);
    const s = t % 60;
    frameTimeLabel.textContent = m + ':' + s.toFixed(3).padStart(6, '0');
  }

  playerEl.addEventListener('timeupdate', updateFrameTimeLabel);

  const prevFrameBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
    playerEl.pause();
    playerEl.currentTime = Math.max(0, playerEl.currentTime - 1 / 30);
  }}, '← Prev frame');

  const nextFrameBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      playerEl.requestVideoFrameCallback(() => {
        playerEl.pause();
        updateFrameTimeLabel();
      });
      playerEl.play();
    } else {
      playerEl.currentTime = Math.min(playerEl.duration, playerEl.currentTime + 1 / 30);
    }
  }}, 'Next frame →');

  playerCard.appendChild(el('div', { class: 'anr-btn-row' }, [prevFrameBtn, frameTimeLabel, nextFrameBtn]));

  resultsEl.appendChild(playerCard);

  // ---- File info ----
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('MIME', file.type || '-'));
  if (header.container)
    tbl.appendChild(row('Container', header.container + (header.brand ? '  (' + header.brand + ')' : '')));
  tbl.appendChild(row('Resolution', vw && vh ? `${vw} × ${vh} px` : '-'));
  tbl.appendChild(row('Aspect ratio', aspectRatio(vw, vh)));
  tbl.appendChild(row('Duration', isFinite(dur) ? formatDuration(dur) : '-'));
  const bitrate = isFinite(dur) && dur > 0
    ? (file.size * 8 / dur / 1000).toFixed(0) + ' kbps  (' + (file.size * 8 / dur / 1_000_000).toFixed(2) + ' Mbps)'
    : '-';
  tbl.appendChild(row('Bitrate (total)', bitrate));
  const fpsRow = row('Frame rate', 'detecting…');
  tbl.appendChild(fpsRow);
  if (vw && vh) {
    const mp = ((vw * vh) / 1_000_000).toFixed(2);
    tbl.appendChild(row('Frame size', mp + ' MP'));
  }
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  detectFps(url).then((fps) => {
    fpsRow.querySelector('td').textContent = fps != null ? fps + ' fps' : 'N/A';
  });

  // ---- Metadata via exifr ----
  let exif = null;
  try {
    if (window.exifr) {
      exif = await window.exifr.parse(file, {
        tiff: true, exif: true, gps: true, xmp: true,
        mergeOutput: true, translateValues: true, translateKeys: true,
        reviveValues: true, sanitize: true, silentErrors: true
      });
    }
  } catch (_) {}

  if (exif) {
    const metaRows = [];
    if (exif.Make)             metaRows.push(['Make', exif.Make]);
    if (exif.Model)            metaRows.push(['Model', exif.Model]);
    if (exif.Software)         metaRows.push(['Software', exif.Software]);
    if (exif.DateTimeOriginal) metaRows.push(['Taken', fmtDate(exif.DateTimeOriginal)]);
    if (exif.CreateDate)       metaRows.push(['Created', fmtDate(exif.CreateDate)]);
    if (exif.ModifyDate)       metaRows.push(['Modified', fmtDate(exif.ModifyDate)]);
    if (exif.ImageDescription || exif.description)
      metaRows.push(['Description', exif.ImageDescription || exif.description]);
    if (exif.Copyright || exif.rights)
      metaRows.push(['Copyright', exif.Copyright || exif.rights]);

    if (metaRows.length) {
      const metaCard = el('div', { class: 'anr-card' });
      metaCard.appendChild(el('h3', {}, 'Metadata'));
      const mt = el('table', { class: 'anr-readout' });
      for (const [k, v] of metaRows) mt.appendChild(row(k, v));
      metaCard.appendChild(mt);
      resultsEl.appendChild(metaCard);
    }

    if (exif.latitude != null && exif.longitude != null) {
      const gpsCard = el('div', { class: 'anr-card' });
      gpsCard.appendChild(el('h3', {}, 'GPS'));
      const gt = el('table', { class: 'anr-readout' });
      gt.appendChild(row('Latitude', exif.latitude.toFixed(6) + '°'));
      gt.appendChild(row('Longitude', exif.longitude.toFixed(6) + '°'));
      if (exif.GPSAltitude != null)
        gt.appendChild(row('Altitude', (+exif.GPSAltitude).toFixed(1) + ' m'));
      gpsCard.appendChild(gt);
      gpsCard.appendChild(el('p', {}, [
        '> open in ',
        el('a', {
          href: `https://www.openstreetmap.org/?mlat=${exif.latitude}&mlon=${exif.longitude}#map=15/${exif.latitude}/${exif.longitude}`,
          target: '_blank'
        }, 'OpenStreetMap'),
        ' / ',
        el('a', {
          href: `https://www.google.com/maps?q=${exif.latitude},${exif.longitude}`,
          target: '_blank'
        }, 'Google Maps')
      ]));
      resultsEl.appendChild(gpsCard);
    }
  }

  // ---- Frame capture ----
  if (vw && vh) {
    const captureCard = el('div', { class: 'anr-card' });
    captureCard.appendChild(el('h3', {}, 'Frame capture'));
    captureCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:12px !important;' },
      'Seek the video to any point, then capture for full photo analysis'));
    const captureBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Capture current frame');
    captureCard.appendChild(el('div', { class: 'anr-btn-row' }, [captureBtn]));
    const captureOut = el('div');
    captureCard.appendChild(captureOut);
    resultsEl.appendChild(captureCard);

    captureBtn.addEventListener('click', async () => {
      captureBtn.disabled = true;
      captureBtn.textContent = 'Capturing…';
      const cv = document.createElement('canvas');
      cv.width = vw; cv.height = vh;
      cv.getContext('2d').drawImage(playerEl, 0, 0, vw, vh);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const ts = playerEl.currentTime;
      const frameFile = new File([blob], `frame_${ts.toFixed(3)}s.png`, { type: 'image/png' });

      captureOut.innerHTML = '';
      captureOut.appendChild(el('img', {
        src: URL.createObjectURL(blob),
        alt: 'Captured frame',
        style: 'max-width:100%; max-height:180px; margin-top:10px; border:1px solid var(--hairline); display:block;'
      }));
      captureOut.appendChild(el('p', { class: 'anr-hint' },
        `Captured at ${formatDuration(ts)} — photo analysis in section 01`));
      captureBtn.disabled = false;
      captureBtn.textContent = 'Capture current frame';
      const photoResults = document.getElementById('photoResults');
      if (photoResults) renderPhoto(frameFile, photoResults);
    });

    // ---- Contact sheet / thumbnail grid ----
    const sheetCard = el('div', { class: 'anr-card' });
    sheetCard.appendChild(el('h3', {}, 'Contact sheet'));
    sheetCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:12px !important;' },
      '4×4 grid of 16 evenly-spaced thumbnails from the video'));
    const sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
    const sheetOut = el('div');

    sheetBtn.addEventListener('click', async () => {
      sheetBtn.disabled = true;
      sheetBtn.textContent = 'Generating…';

      const cols = 4, rows = 4, total = cols * rows;
      const thumbW = Math.round(vw * (320 / Math.max(vw, vh)));
      const thumbH = Math.round(vh * (320 / Math.max(vw, vh)));
      const pad = 4;
      const gridW = cols * thumbW + (cols + 1) * pad;
      const gridH = rows * thumbH + (rows + 1) * pad;

      const gridCanvas = document.createElement('canvas');
      gridCanvas.width = gridW;
      gridCanvas.height = gridH;
      const ctx = gridCanvas.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, gridW, gridH);

      const safeDur = Math.max(0, dur - 0.1);

      for (let i = 0; i < total; i++) {
        const t = total > 1 ? (safeDur * i) / (total - 1) : 0;
        playerEl.currentTime = t;
        await new Promise(r => { playerEl.onseeked = r; });

        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = pad + c * (thumbW + pad);
        const y = pad + r * (thumbH + pad);
        ctx.drawImage(playerEl, x, y, thumbW, thumbH);
      }

      sheetOut.innerHTML = '';
      const img = el('img', {
        src: gridCanvas.toDataURL('image/png'),
        alt: 'Contact sheet',
        style: 'max-width:100%; margin-top:10px; border:1px solid var(--hairline); display:block;'
      });
      sheetOut.appendChild(img);

      const saveBtn = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:8px;', onclick: () => {
        const a = document.createElement('a');
        a.href = gridCanvas.toDataURL('image/png');
        a.download = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_contact_sheet.png';
        a.click();
      }}, 'Save as PNG');
      sheetOut.appendChild(saveBtn);

      sheetBtn.disabled = false;
      sheetBtn.textContent = 'Generate contact sheet';
    });

    sheetCard.appendChild(el('div', { class: 'anr-btn-row' }, [sheetBtn]));
    sheetCard.appendChild(sheetOut);
    resultsEl.appendChild(sheetCard);

    // ---- Scene change detection ----
    const sceneCard = el('div', { class: 'anr-card' });
    sceneCard.appendChild(el('h3', {}, 'Scene changes'));
    sceneCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:12px !important;' },
      'Detect scene changes by comparing consecutive frames (pixel difference)'));
    const sceneBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Detect scene changes');
    const sceneOut = el('div');

    sceneBtn.addEventListener('click', async () => {
      sceneBtn.disabled = true;
      sceneBtn.textContent = 'Analysing…';

      const changes = await detectSceneChanges(playerEl, 35);

      sceneOut.innerHTML = '';

      const countLabel = el('p', { class: 'anr-hint', style: 'margin-bottom:10px;' },
        changes.length
          ? changes.length + ' scene change' + (changes.length > 1 ? 's' : '') + ' detected'
          : 'No scene changes detected');
      sceneOut.appendChild(countLabel);

      if (changes.length && isFinite(dur) && dur > 0) {
        // Timeline bar with markers
        const timeline = el('div', {
          style: 'position:relative; height:24px; background:#1a1a1a; border:1px solid var(--hairline); border-radius:3px; margin-bottom:14px;'
        });
        for (const sc of changes) {
          const pct = (sc.time / dur) * 100;
          const marker = el('div', {
            style: 'position:absolute; top:2px; bottom:2px; width:2px; background:#e60023; border-radius:1px; left:' + pct + '%;',
            title: formatDuration(sc.time)
          });
          marker.addEventListener('click', () => {
            playerEl.currentTime = sc.time;
            playerEl.pause();
          });
          marker.style.cursor = 'pointer';
          timeline.appendChild(marker);
        }
        sceneOut.appendChild(timeline);

        // Thumbnail grid
        const grid = el('div', {
          style: 'display:flex; flex-wrap:wrap; gap:8px;'
        });
        for (const sc of changes) {
          const wrap = el('div', {
            style: 'cursor:pointer; text-align:center;',
            onclick: () => { playerEl.currentTime = sc.time; playerEl.pause(); }
          });
          wrap.appendChild(el('img', {
            src: sc.thumbnail,
            alt: 'Scene change at ' + formatDuration(sc.time),
            style: 'width:160px; height:90px; object-fit:cover; display:block; border:1px solid var(--hairline); border-radius:2px;'
          }));
          wrap.appendChild(el('span', {
            class: 'anr-hint',
            style: 'font-size:11px; font-variant-numeric:tabular-nums;'
          }, formatDuration(sc.time)));
          grid.appendChild(wrap);
        }
        sceneOut.appendChild(grid);
      }

      sceneBtn.disabled = false;
      sceneBtn.textContent = 'Detect scene changes';
    });

    sceneCard.appendChild(el('div', { class: 'anr-btn-row' }, [sceneBtn]));
    sceneCard.appendChild(sceneOut);
    resultsEl.appendChild(sceneCard);
  }

  // ---- Audio track extraction ----
  const audioCard = el('div', { class: 'anr-card' });
  audioCard.appendChild(el('h3', {}, 'Audio track'));
  const audioStatus = el('p', { class: 'anr-info' }, 'Decoding audio track…');
  audioCard.appendChild(audioStatus);
  resultsEl.appendChild(audioCard);

  try {
    const ac = getAudioCtx();
    const buf = await file.arrayBuffer();
    const audioBuf = await ac.decodeAudioData(buf.slice(0));

    audioStatus.remove();

    const mono = getMono(audioBuf);
    const stats = computeStats(mono);

    const at = el('table', { class: 'anr-readout' });
    at.appendChild(row('Duration', formatDuration(audioBuf.duration)));
    at.appendChild(row('Sample rate', audioBuf.sampleRate.toLocaleString() + ' Hz'));
    at.appendChild(row('Channels', audioBuf.numberOfChannels));
    at.appendChild(row('Peak', stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)'));
    at.appendChild(row('RMS', stats.rms.toFixed(3) + '  (' + stats.rmsDb.toFixed(1) + ' dBFS)'));
    at.appendChild(row('Samples', mono.length.toLocaleString()));
    audioCard.appendChild(at);

    const waveCanvas = el('canvas', { class: 'anr-waveform' });
    waveCanvas.width = 1024; waveCanvas.height = 80;
    audioCard.appendChild(waveCanvas);
    renderWaveform(waveCanvas, mono);

    const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
    resultsEl.appendChild(makeSpectrogramPanel(mono, audioBuf.sampleRate, { basename }));
  } catch (_) {
    audioStatus.remove();
    audioCard.appendChild(el('p', { class: 'anr-hint' },
      'No audio track found, or format not supported by this browser.'));
  }

  // ---- SHA-256 ----
  if (file.size <= 500 * 1024 * 1024) {
    const hashCard = el('div', { class: 'anr-card' });
    hashCard.appendChild(el('h3', {}, 'Integrity'));
    const hashOut = el('p', { class: 'anr-hint', style: 'word-break:break-all;' }, 'computing SHA-256…');
    hashCard.appendChild(hashOut);
    resultsEl.appendChild(hashCard);
    sha256Hex(file).then((h) => {
      hashOut.textContent = h ? 'SHA-256: ' + h : 'SHA-256 unavailable';
    });
  }
}

// ---------- setup ----------
export function initVideo({ dropEl, inputEl, resultsEl, onFile }) {
  const handle = onFile || ((file) => renderVideo(file, resultsEl));
  inputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handle(file);
    inputEl.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.add('is-dragover'))
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.remove('is-dragover'))
  );
}
