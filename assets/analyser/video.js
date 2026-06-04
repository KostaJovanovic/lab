/* Analyser - video module
   Handles video files: playback, container/codec detection, frame rate,
   frame capture (routed to photo analysis), audio track extraction
   (waveform + spectrogram via audio module). */

import { makeSpectrogramPanel, makePlayer, buildHistogramCard } from './audio.js';
import { renderPhoto } from './photo.js';
import { el, row, rowHelp, fmtBytes, h3help, sha256Row, integrityCard, roundFps, asciiBar } from './util.js';
import { parseAviHeader, extractAviData, encodeWav } from './video-avi.js';

// iOS (iPhone/iPad) detection. On iOS the custom scrubber's touch handling is
// unreliable, so we show the native <video> controls there; everywhere else the
// styled makePlayer transport handles playback and native controls stay hidden.
function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Apply the right playback affordance to a visible <video>: native controls on
// iOS, click-to-toggle play/pause elsewhere (the makePlayer scrubber does the rest).
function applyVideoControls(playerEl) {
  if (isIOS()) {
    playerEl.setAttribute('controls', '');
  } else {
    playerEl.style.cursor = 'pointer';
    playerEl.addEventListener('click', () => { if (playerEl.paused) playerEl.play(); else playerEl.pause(); });
  }
}

// "Download audio (WAV)" link for the extracted-audio cards. Reuses the blob URL
// already created for the player so no re-encoding is needed.
function audioDownloadRow(wavUrl, file) {
  const name = (file.name || 'video').replace(/\.[^/.]+$/, '') + '.wav';
  const link = el('a', {
    href: wavUrl, download: name, class: 'anr-btn',
    style: 'text-decoration:none;display:inline-block;'
  }, 'Download audio (WAV)');
  return el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [link]);
}

// ---------- progress-tracked fetch ----------
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
    if (onProgress) onProgress(Math.min(1, loaded / total));
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function makeBlobURL(data, type) {
  return URL.createObjectURL(new Blob([data], { type }));
}

// ---------- FFmpeg WASM fallback (lazy, single-threaded) ----------
// The 31 MB core is too large for Cloudflare's 25 MiB asset cap, so it loads
// from a CDN on first use. The service worker caches it afterwards, so offline
// use survives once it's been fetched once. A bottom-of-window loader (same
// style as the drop loader) shows real download progress while it pulls.
const FFMPEG_CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
let ffmpegInstance = null;
let _ffLoaderEl = null;

function showFfmpegLoader() {
  if (!_ffLoaderEl || !_ffLoaderEl.isConnected) {
    const bar = asciiBar({ fit: true });
    const label = el('div', { class: 'anr-drop-loader-label' }, 'Loading FFmpeg… (≈31 MB, first time only)');
    _ffLoaderEl = el('div', { class: 'anr-drop-loader', role: 'status', 'aria-live': 'polite' }, [label, bar]);
    _ffLoaderEl._bar = bar;
    document.body.appendChild(_ffLoaderEl);
  }
  _ffLoaderEl._bar.set(0);
  requestAnimationFrame(() => _ffLoaderEl.classList.add('is-open'));
}
function setFfmpegLoaderProgress(frac) {
  if (_ffLoaderEl && _ffLoaderEl._bar) _ffLoaderEl._bar.set(frac);
}
function hideFfmpegLoader() {
  if (_ffLoaderEl) _ffLoaderEl.classList.remove('is-open');
}

async function loadFFmpeg(onProgress) {
  if (ffmpegInstance) return ffmpegInstance;
  showFfmpegLoader();
  try {
    const { FFmpeg } = await import(new URL('../vendor/ffmpeg/ffmpeg.js', import.meta.url).href);
    const report = (p) => { setFfmpegLoaderProgress(p); if (onProgress) onProgress(p); };
    const coreJS = makeBlobURL(await fetchWithProgress(FFMPEG_CORE_BASE + '/ffmpeg-core.js', (p) => report(p * 0.3)), 'text/javascript');
    const wasmData = await fetchWithProgress(FFMPEG_CORE_BASE + '/ffmpeg-core.wasm', (p) => report(0.3 + p * 0.7));
    const wasmURL = makeBlobURL(wasmData, 'application/wasm');
    const ff = new FFmpeg();
    await ff.load({ coreURL: coreJS, wasmURL });
    ffmpegInstance = ff;
    return ff;
  } finally {
    hideFfmpegLoader();
  }
}

async function ffmpegExtractAudio(file, container) {
  const barEl = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const labelEl = el('div', { class: 'anr-progress-label' }, 'loading ffmpeg (~30 mb)');
  const wrap = el('div', { class: 'anr-progress' }, [barEl, labelEl]);
  container.appendChild(wrap);

  function setBar(frac) {
    const ch = parseFloat(getComputedStyle(barEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((barEl.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    barEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  }

  const ff = await loadFFmpeg((p) => { setBar(p); });
  labelEl.textContent = 'extracting audio';
  setBar(1);
  const { fetchFile } = await import(new URL('../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
  await ff.writeFile('input', await fetchFile(file));
  await ff.exec(['-i', 'input', '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', 'output.wav']);
  const data = await ff.readFile('output.wav');
  await ff.deleteFile('input');
  await ff.deleteFile('output.wav');
  wrap.remove();
  const wavBlob = new Blob([data.buffer || data], { type: 'audio/wav' });
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await wavBlob.arrayBuffer();
  return await ac.decodeAudioData(buf);
}

// ---------- helpers ----------

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

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// ---------- MP4 PCM audio extraction ----------

function parseBoxes(view, start, end) {
  const boxes = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    const type = String.fromCharCode(view.getUint8(pos+4), view.getUint8(pos+5), view.getUint8(pos+6), view.getUint8(pos+7));
    if (size === 0) break;
    if (size === 1 && pos + 16 <= end) {
      size = Number(view.getBigUint64(pos + 8));
      boxes.push({ type, offset: pos, size, headerSize: 16 });
    } else {
      boxes.push({ type, offset: pos, size, headerSize: 8 });
    }
    pos += size;
  }
  return boxes;
}

function findAllBoxes(view, start, end, type) {
  const result = [];
  const stack = [{ s: start, e: end }];
  const containers = new Set(['moov','trak','mdia','minf','stbl','udta','edts','dinf','meta','ilst']);
  while (stack.length) {
    const { s, e } = stack.pop();
    for (const b of parseBoxes(view, s, e)) {
      if (b.type === type) result.push(b);
      if (containers.has(b.type)) stack.push({ s: b.offset + b.headerSize, e: b.offset + b.size });
    }
  }
  return result;
}

function extractPcmFromMp4(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const fileEnd = arrayBuffer.byteLength;

  const traks = findAllBoxes(view, 0, fileEnd, 'trak');
  for (const trak of traks) {
    const trakEnd = trak.offset + trak.size;
    const trakStart = trak.offset + trak.headerSize;

    const stsdBoxes = findAllBoxes(view, trakStart, trakEnd, 'stsd');
    if (!stsdBoxes.length) continue;
    const stsd = stsdBoxes[0];
    const stsdData = stsd.offset + stsd.headerSize + 8;
    if (stsdData + 8 > fileEnd) continue;
    const codecFcc = String.fromCharCode(
      view.getUint8(stsdData + 4), view.getUint8(stsdData + 5),
      view.getUint8(stsdData + 6), view.getUint8(stsdData + 7));
    const pcmCodecs = new Set(['twos','sowt','lpcm','in16','in24','in32','raw ','NONE','ulaw','alaw']);
    if (!pcmCodecs.has(codecFcc)) continue;

    const base = stsdData + 8;
    const channels = view.getUint16(base + 16);
    const bitsPerSample = view.getUint16(base + 18);
    const sampleRate = view.getUint16(base + 24);

    const stszBoxes = findAllBoxes(view, trakStart, trakEnd, 'stsz');
    const stcoBoxes = findAllBoxes(view, trakStart, trakEnd, 'stco');
    const co64Boxes = findAllBoxes(view, trakStart, trakEnd, 'co64');
    const stscBoxes = findAllBoxes(view, trakStart, trakEnd, 'stsc');
    if (!stcoBoxes.length && !co64Boxes.length) continue;

    const chunkOffsets = [];
    if (stcoBoxes.length) {
      const box = stcoBoxes[0];
      const d = box.offset + box.headerSize;
      const count = view.getUint32(d + 4);
      for (let i = 0; i < count; i++) chunkOffsets.push(view.getUint32(d + 8 + i * 4));
    } else {
      const box = co64Boxes[0];
      const d = box.offset + box.headerSize;
      const count = view.getUint32(d + 4);
      for (let i = 0; i < count; i++) chunkOffsets.push(Number(view.getBigUint64(d + 8 + i * 8)));
    }

    let samplesPerChunk = 1;
    let chunkSampleSize = 0;
    if (stscBoxes.length) {
      const box = stscBoxes[0];
      const d = box.offset + box.headerSize;
      const count = view.getUint32(d + 4);
      if (count > 0) samplesPerChunk = view.getUint32(d + 8 + 4);
    }
    if (stszBoxes.length) {
      const box = stszBoxes[0];
      const d = box.offset + box.headerSize;
      chunkSampleSize = view.getUint32(d + 4);
    }

    const bytesPerSample = bitsPerSample / 8;
    const frameSize = bytesPerSample * channels;
    const bigEndian = codecFcc === 'twos' || codecFcc === 'in16' || codecFcc === 'in24' || codecFcc === 'in32';

    const allSamples = [];
    for (const offset of chunkOffsets) {
      const chunkBytes = samplesPerChunk * (chunkSampleSize || frameSize);
      if (offset + chunkBytes > fileEnd) break;
      for (let i = 0; i < chunkBytes; i += bytesPerSample) {
        const pos = offset + i;
        if (pos + bytesPerSample > fileEnd) break;
        let val;
        if (bytesPerSample === 2) {
          val = bigEndian ? view.getInt16(pos) : view.getInt16(pos, true);
          allSamples.push(val / 0x8000);
        } else if (bytesPerSample === 3) {
          const b0 = view.getUint8(pos), b1 = view.getUint8(pos+1), b2 = view.getUint8(pos+2);
          val = bigEndian ? ((b0 << 24 | b1 << 16 | b2 << 8) >> 8) : ((b2 << 24 | b1 << 16 | b0 << 8) >> 8);
          allSamples.push(val / 0x800000);
        } else if (bytesPerSample === 4) {
          val = bigEndian ? view.getInt32(pos) : view.getInt32(pos, true);
          allSamples.push(val / 0x80000000);
        }
      }
    }

    if (allSamples.length === 0) continue;

    const totalFrames = Math.floor(allSamples.length / channels);
    const ac = new OfflineAudioContext(channels, totalFrames, sampleRate);
    const audioBuf = ac.createBuffer(channels, totalFrames, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const chData = audioBuf.getChannelData(ch);
      for (let i = 0; i < totalFrames; i++) {
        chData[i] = allSamples[i * channels + ch];
      }
    }
    return audioBuf;
  }
  return null;
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

// ---------- frame rate detection ----------

async function detectFpsFromContainer(file) {
  if (file.size < 12) return null;
  const headBuf = await file.slice(0, Math.min(file.size, 64)).arrayBuffer();
  const hv = new DataView(headBuf);
  const ftyp = String.fromCharCode(hv.getUint8(4), hv.getUint8(5), hv.getUint8(6), hv.getUint8(7));
  if (ftyp !== 'ftyp') return null;

  // Walk top-level boxes to find moov (handles 64-bit extended sizes)
  let moovOffset = -1, moovSize = 0, pos = 0;
  while (pos < file.size) {
    const headerBuf = await file.slice(pos, pos + 16).arrayBuffer();
    const dv = new DataView(headerBuf);
    if (headerBuf.byteLength < 8) break;
    let boxSize = dv.getUint32(0);
    const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
    if (boxSize === 1 && headerBuf.byteLength >= 16) {
      const hi = dv.getUint32(8), lo = dv.getUint32(12);
      boxSize = hi * 0x100000000 + lo;
    }
    if (boxSize < 8) break;
    if (type === 'moov') { moovOffset = pos; moovSize = boxSize; break; }
    pos += boxSize;
  }

  if (moovOffset < 0 || moovSize > 20 * 1024 * 1024) return null;
  const moovBuf = await file.slice(moovOffset, moovOffset + moovSize).arrayBuffer();
  const view = new DataView(moovBuf);
  const traks = findAllBoxes(view, 8, moovSize, 'trak');
  for (const trak of traks) {
    const trakStart = trak.offset + trak.headerSize;
    const trakEnd = Math.min(trak.offset + trak.size, moovSize);
    if (!findAllBoxes(view, trakStart, trakEnd, 'vmhd').length) continue;
    const mdhdBoxes = findAllBoxes(view, trakStart, trakEnd, 'mdhd');
    if (!mdhdBoxes.length) continue;
    const mdhd = mdhdBoxes[0];
    const mdhdData = mdhd.offset + mdhd.headerSize;
    if (mdhdData + 24 > moovSize) continue;
    const mdhdVersion = view.getUint8(mdhdData);
    const timescale = mdhdVersion === 1
      ? view.getUint32(mdhdData + 20)
      : view.getUint32(mdhdData + 12);
    const sttsBoxes = findAllBoxes(view, trakStart, trakEnd, 'stts');
    if (!sttsBoxes.length) continue;
    const stts = sttsBoxes[0];
    const sttsData = stts.offset + stts.headerSize;
    if (sttsData + 16 > moovSize) continue;
    if (view.getUint32(sttsData + 4) < 1) continue;
    const sampleDuration = view.getUint32(sttsData + 12);
    if (sampleDuration <= 0 || timescale <= 0) continue;
    const fps = timescale / sampleDuration;
    if (fps > 1 && fps < 1000) return roundFps(fps);
  }
  return null;
}

async function detectFpsWithFfmpeg(file, onProgress) {
  const ff = await loadFFmpeg(onProgress);
  const { fetchFile } = await import(new URL('../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
  await ff.writeFile('probe', await fetchFile(file));
  let log = '';
  ff.on('log', ({ message }) => { log += message + '\n'; });
  await ff.exec(['-i', 'probe', '-f', 'null', '-t', '2', '-']);
  await ff.deleteFile('probe');
  const m = log.match(/(\d+(?:\.\d+)?) fps/);
  if (m) return roundFps(parseFloat(m[1]));
  const tbr = log.match(/(\d+(?:\.\d+)?) tbr/);
  if (tbr) return roundFps(parseFloat(tbr[1]));
  return null;
}

async function detectFps(file, fpsCell) {
  const containerFps = await detectFpsFromContainer(file);
  if (containerFps) return containerFps;
  if (fpsCell) fpsCell.textContent = 'loading ffmpeg…';
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000));
    const detect = detectFpsWithFfmpeg(file, (p) => {
      const pct = Math.round(p * 100);
      if (fpsCell) fpsCell.textContent = pct >= 100 ? 'initialising ffmpeg…' : 'loading ffmpeg… ' + pct + '%';
    });
    return await Promise.race([detect, timeout]);
  } catch (_) {
    return null;
  }
}

// ---------- scene change detection ----------

// Walk the video at a fixed interval, comparing each sampled frame to the
// previous one by mean per-channel pixel difference. When the difference crosses
// `threshold` it's marked as a scene change, with a thumbnail and a confidence
// score (how decisively it cleared the threshold). `signal` lets an in-progress
// run bail when a new file is loaded.
async function detectSceneChanges(video, threshold, signal) {
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
    if (signal && signal.aborted) return changes;
    const t = Math.min(i * interval, dur - 0.05);
    await seekAndPaint(video, t);

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
          // How decisively the difference cleared the threshold, as a 0-99%
          // confidence (at the threshold ≈ 50%, twice the threshold ≈ 99%).
          confidence: Math.min(99, Math.round((meanDiff / threshold) * 50)),
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

// ---------- iOS-safe frame capture ----------
// On iOS Safari, `loadeddata`/`seeked` can fire before a frame is actually
// composited, so drawImage() returns a black canvas. requestVideoFrameCallback
// fires only on a real painted frame; we gate every capture on it (with a
// rAF + timeout fallback for browsers/situations where it's unavailable).
function whenFramePainted(video) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => finish());
    else requestAnimationFrame(finish);
    setTimeout(finish, 2000);
  });
}

function seekAndPaint(video, t) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => finish());
    else video.addEventListener('seeked', () => requestAnimationFrame(finish), { once: true });
    video.currentTime = t;
    setTimeout(finish, 2500);
  });
}

// ---------- visible-player fallback (iOS Safari) ----------
// The hidden probe above is parked 1px/near-invisible/z-index:-1 so it stays
// out of the layout, but iOS Safari refuses to allocate a decode surface for a
// video that small/hidden, so `loadeddata` never fires and even ordinary H.264
// files time out into the "could not load" error. A real, *visible* <video>
// element plays those same files. When the probe fails (and it isn't an AVI we
// can decode ourselves), we render this player instead: native controls,
// container/resolution/duration read straight off the loaded element, an
// on-demand frame grab into the photo section, and a SHA-256. Returns true if
// the player loaded (so the caller skips the error), false otherwise.
async function renderVisibleVideoFallback(file, url, header, resultsEl, signal) {
  const playerCard = el('div', { class: 'anr-card', style: 'position:relative;' });
  playerCard.appendChild(el('h3', {}, 'Player'));
  const playerEl = el('video', { src: url, playsinline: '' });
  playerEl.setAttribute('webkit-playsinline', '');
  playerEl.style.cssText = 'width:100%; max-height:480px; background:#0a0a0a; display:block; border:1px solid var(--hairline);';
  applyVideoControls(playerEl);
  playerCard.appendChild(playerEl);
  playerCard.appendChild(makePlayer(playerEl));
  // This path has no off-screen probe (it's the iOS / decode-failed fallback), so
  // scene detection must seek the visible player. The badge flags that the brief
  // auto-scrub is analysis, not playback.
  const sceneBadge = el('div', { class: 'anr-video-analysing' }, 'Analysing…');
  playerCard.appendChild(sceneBadge);
  resultsEl.appendChild(playerCard);

  const loaded = await new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    playerEl.onloadedmetadata = () => finish(true);
    playerEl.onerror = () => finish(false);
    if (signal) signal.addEventListener('abort', () => finish(false));
    setTimeout(() => finish(false), 12000);
  });
  if (!loaded) { playerCard.remove(); return false; }

  const vw = playerEl.videoWidth, vh = playerEl.videoHeight, dur = playerEl.duration;

  // File info
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(rowHelp('MIME', file.type || '-', "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));
  if (header && header.container) tbl.appendChild(row('Container', header.container + (header.brand ? '  (' + header.brand + ')' : '')));
  if (vw && vh) {
    tbl.appendChild(row('Resolution', `${vw} × ${vh} px`));
    tbl.appendChild(row('Aspect ratio', aspectRatio(vw, vh)));
  }
  if (isFinite(dur) && dur > 0) tbl.appendChild(row('Duration', formatDuration(dur)));
  const bitrate = isFinite(dur) && dur > 0
    ? (file.size * 8 / dur / 1000).toFixed(0) + ' kbps  (' + (file.size * 8 / dur / 1_000_000).toFixed(2) + ' Mbps)' : '-';
  tbl.appendChild(rowHelp('Bitrate (total)', bitrate, 'Average data rate across the whole file - video, audio, and container overhead combined. Computed as file size ÷ duration, so it is an overall average, not the encoder’s target bitrate.'));
  const fpsRow = row('Frame rate', 'detecting…');
  tbl.appendChild(fpsRow);
  if (vw && vh) tbl.appendChild(rowHelp('Frame size', ((vw * vh) / 1_000_000).toFixed(2) + ' MP', 'Pixels per frame in megapixels (width × height ÷ 1,000,000). A rough indicator of how much raw image data each frame holds before compression.'));
  infoCard.appendChild(tbl);
  resultsEl.insertBefore(infoCard, playerCard);

  // Detect FPS
  let detectedFps = 30;
  const fpsCell = fpsRow.querySelector('td');
  detectFps(file, fpsCell).then((fps) => {
    fpsCell.textContent = fps != null ? fps + ' fps' : 'N/A';
    if (fps != null) { detectedFps = fps; updateTc(); }
  });

  // Frame-by-frame navigation + timecode
  function fmtTc(t) {
    const f = Math.floor(t * detectedFps) % Math.round(detectedFps);
    const ts = Math.floor(t);
    return String(Math.floor(ts / 3600)).padStart(2, '0') + ':' +
      String(Math.floor((ts % 3600) / 60)).padStart(2, '0') + ':' +
      String(ts % 60).padStart(2, '0') + ':' + String(f).padStart(2, '0');
  }
  const tcDisplay = el('span', { class: 'anr-timecode-value' }, '00:00:00:00');
  const tcLabel = el('span', { class: 'anr-timecode-label' }, 'TIMECODE');
  const frameTimeLabel = el('div', { class: 'anr-timecode' }, [tcLabel, tcDisplay]);
  function updateTc() { tcDisplay.textContent = fmtTc(playerEl.currentTime); }
  let tcRaf = 0;
  function tickTc() { updateTc(); if (!playerEl.paused) tcRaf = requestAnimationFrame(tickTc); }
  playerEl.addEventListener('play', () => { tcRaf = requestAnimationFrame(tickTc); });
  playerEl.addEventListener('pause', () => { cancelAnimationFrame(tcRaf); updateTc(); });
  playerEl.addEventListener('seeked', updateTc);

  if (vw && vh) {
    const prevFrameBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
      playerEl.pause(); playerEl.currentTime = Math.max(0, playerEl.currentTime - 1 / detectedFps);
    }}, '← Prev frame');
    const nextFrameBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        playerEl.requestVideoFrameCallback(() => { playerEl.pause(); updateTc(); });
        playerEl.play();
      } else {
        playerEl.currentTime = Math.min(playerEl.duration, playerEl.currentTime + 1 / detectedFps);
      }
    }}, 'Next frame →');
    const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: async () => {
      analyseBtn.disabled = true; analyseBtn.textContent = 'Capturing…';
      try {
        const cv = document.createElement('canvas'); cv.width = vw; cv.height = vh;
        cv.getContext('2d').drawImage(playerEl, 0, 0, vw, vh);
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        const frameFile = new File([blob], `frame_${playerEl.currentTime.toFixed(3)}s.png`, { type: 'image/png' });
        const pr = document.getElementById('photoResults');
        if (pr) { renderPhoto(frameFile, pr); const ps = document.getElementById('photo');
          if (ps) window.scrollTo({ top: ps.getBoundingClientRect().top + window.scrollY - 56, behavior: 'smooth' }); }
      } catch (_) {}
      analyseBtn.disabled = false; analyseBtn.textContent = 'Analyse frame';
    }}, 'Analyse frame');
    const frameGrid = el('div', { class: 'anr-frame-grid' }, [frameTimeLabel, analyseBtn, prevFrameBtn, nextFrameBtn]);
    playerCard.appendChild(el('div', { class: 'anr-frame-wrap' }, [frameGrid]));
  }

  // EXIF metadata
  let exif = null;
  try { if (window.exifr) exif = await window.exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, mergeOutput: true, translateValues: true, translateKeys: true, reviveValues: true, sanitize: true, silentErrors: true }); } catch (_) {}
  if (exif) {
    const metaRows = [];
    if (exif.Make) metaRows.push(['Make', exif.Make]);
    if (exif.Model) metaRows.push(['Model', exif.Model]);
    if (exif.Software) metaRows.push(['Software', exif.Software]);
    if (exif.DateTimeOriginal) metaRows.push(['Taken', new Date(exif.DateTimeOriginal).toISOString().replace('T', ' ').slice(0, 19)]);
    if (exif.CreateDate) metaRows.push(['Created', new Date(exif.CreateDate).toISOString().replace('T', ' ').slice(0, 19)]);
    if (metaRows.length) {
      const mc = el('div', { class: 'anr-card' });
      mc.appendChild(el('h3', {}, 'Metadata'));
      const mt = el('table', { class: 'anr-readout' });
      for (const [k, v] of metaRows) mt.appendChild(row(k, v));
      mc.appendChild(mt);
      resultsEl.appendChild(mc);
    }
  }

  // Contact sheet
  if (vw && vh && isFinite(dur) && dur > 0) {
    const sheetCard = el('div', { class: 'anr-card' });
    sheetCard.appendChild(el('h3', {}, 'Contact sheet'));
    const sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
    const sheetOut = el('div');
    sheetBtn.addEventListener('click', async () => {
      sheetBtn.disabled = true; sheetBtn.textContent = 'Generating…';
      const cols = 4, rows = 2, total = cols * rows;
      const tw = Math.round(vw * (320 / Math.max(vw, vh)));
      const th = Math.round(vh * (320 / Math.max(vw, vh)));
      const pad = 4;
      const gc = document.createElement('canvas');
      gc.width = cols * tw + (cols + 1) * pad;
      gc.height = rows * th + (rows + 1) * pad;
      const ctx = gc.getContext('2d');
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, gc.width, gc.height);
      for (let i = 0; i < total; i++) {
        const t = total > 1 ? (Math.max(0, dur - 0.1) * i) / (total - 1) : 0;
        await seekAndPaint(playerEl, t);
        const c = i % cols, r = Math.floor(i / cols);
        ctx.drawImage(playerEl, pad + c * (tw + pad), pad + r * (th + pad), tw, th);
      }
      sheetOut.innerHTML = '';
      sheetOut.appendChild(el('img', { src: gc.toDataURL('image/png'), alt: 'Contact sheet',
        style: 'max-width:100%;margin-top:10px;border:1px solid var(--hairline);display:block;' }));
      sheetBtn.disabled = false; sheetBtn.textContent = 'Generate contact sheet';
    });
    sheetCard.appendChild(el('div', { class: 'anr-btn-row' }, [sheetBtn]));
    sheetCard.appendChild(sheetOut);
    resultsEl.appendChild(sheetCard);

    // Scene detection
    const sceneCard = el('div', { class: 'anr-card' });
    sceneCard.appendChild(el('h3', {}, 'Scene changes'));
    const sceneOut = el('div');
    sceneOut.appendChild(el('p', { class: 'anr-hint' }, 'Detecting scene changes…'));
    sceneCard.appendChild(sceneOut);
    resultsEl.appendChild(sceneCard);
    const runScenes = async () => {
      if (!isFinite(playerEl.duration) || playerEl.duration <= 0) {
        await new Promise(r => { playerEl.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 6000); });
      }
      if (signal && signal.aborted) return;
      let changes = [];
      try { changes = await detectSceneChanges(playerEl, 55, signal); } catch (_) {}
      try { playerEl.currentTime = 0; playerEl.pause(); } catch (_) {}
      sceneBadge.remove();
      if (signal && signal.aborted) return;
      sceneOut.innerHTML = '';
      sceneOut.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:10px;' },
        changes.length ? changes.length + ' scene change' + (changes.length > 1 ? 's' : '') + ' detected' : 'No scene changes detected'));
      if (changes.length && isFinite(dur) && dur > 0) {
        const timeline = el('div', { class: 'anr-scene-timeline' });
        for (const sc of changes) {
          const marker = el('div', { class: 'anr-scene-marker',
            style: 'left:' + (sc.time / dur) * 100 + '%;',
            title: formatDuration(sc.time) + '  ·  ' + sc.confidence + '% confidence' });
          marker.addEventListener('click', () => { playerEl.currentTime = sc.time; playerEl.pause(); });
          timeline.appendChild(marker);
        }
        sceneOut.appendChild(timeline);
        const details = el('details', { class: 'anr-scene-details' });
        details.appendChild(el('summary', {}, 'Thumbnails (' + changes.length + ')'));
        const grid = el('div', { class: 'anr-scene-grid' });
        for (const sc of changes) {
          const wrap = el('div', { class: 'anr-scene-thumb',
            onclick: () => { playerEl.currentTime = sc.time; playerEl.pause(); } });
          wrap.appendChild(el('img', { src: sc.thumbnail, alt: 'Scene at ' + formatDuration(sc.time) }));
          wrap.appendChild(el('span', { class: 'anr-scene-meta' }, formatDuration(sc.time) + ' · ' + sc.confidence + '%'));
          grid.appendChild(wrap);
        }
        details.appendChild(grid);
        sceneOut.appendChild(details);
      }
    };
    // Large videos don't auto-run scene detection (it scrubs the player and can be
    // slow); offer a manual trigger instead.
    const bigVideo = file.size > 150 * 1024 * 1024 || (isFinite(dur) && dur > 600);
    if (bigVideo) {
      sceneBadge.remove();
      sceneOut.innerHTML = '';
      sceneOut.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:8px;' },
        'Skipped automatically for large videos (' + (file.size / 1048576).toFixed(0) + ' MB). Run it when you want:'));
      const runBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Detect scene changes');
      runBtn.addEventListener('click', () => {
        runBtn.remove();
        sceneOut.insertBefore(el('p', { class: 'anr-hint' }, 'Detecting scene changes…'), sceneOut.firstChild);
        runScenes();
      });
      sceneOut.appendChild(runBtn);
    } else {
      runScenes();
    }
  }

  // Audio extraction (into Sound section)
  const audioResultsEl = document.getElementById('audioResults');
  if (audioResultsEl) {
    audioResultsEl.hidden = false;
    const audioCard = el('div', { class: 'anr-card' });
    audioCard.appendChild(el('h3', {}, 'Audio track'));
    const audioStatus = el('p', { class: 'anr-info' }, 'Decoding audio from video…');
    audioCard.appendChild(audioStatus);
    audioResultsEl.appendChild(audioCard);
    try {
      const ac = getAudioCtx();
      const buf = await file.arrayBuffer();
      let audioBuf;
      try { audioBuf = await ac.decodeAudioData(buf.slice(0)); } catch (_) {
        audioStatus.textContent = 'Trying PCM extraction…';
        audioBuf = extractPcmFromMp4(buf);
      }
      if (!audioBuf) {
        audioStatus.textContent = 'Web Audio failed, using FFmpeg…';
        audioBuf = await ffmpegExtractAudio(file, audioCard);
      }
      audioStatus.remove();
      const mono = getMono(audioBuf);
      const stats = computeStats(mono);
      const wavBlob = encodeWav(audioBuf);
      const wavUrl = URL.createObjectURL(wavBlob);
      const audioPlayer = el('audio', { src: wavUrl }); audioPlayer.style.display = 'none';
      const apCard = el('div', { class: 'anr-card' });
      apCard.appendChild(el('h3', {}, 'Extracted audio'));
      apCard.appendChild(audioPlayer); apCard.appendChild(makePlayer(audioPlayer));
      apCard.appendChild(audioDownloadRow(wavUrl, file));
      audioResultsEl.appendChild(apCard);
      const at = el('table', { class: 'anr-readout' });
      at.appendChild(row('Duration', formatDuration(audioBuf.duration)));
      at.appendChild(rowHelp('Sample rate', audioBuf.sampleRate.toLocaleString() + ' Hz', 'Audio samples captured per second, in hertz - e.g. 48000 Hz means 48,000 amplitude readings per second of sound.'));
      at.appendChild(rowHelp('Channels', audioBuf.numberOfChannels, 'Number of separate audio channels: 1 = mono, 2 = stereo (left + right), more for surround.'));
      at.appendChild(rowHelp('Peak', stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)', 'Highest sample amplitude.'));
      at.appendChild(rowHelp('RMS', stats.rms.toFixed(3) + '  (' + stats.rmsDb.toFixed(1) + ' dBFS)', 'Root Mean Square - average signal power.'));
      at.appendChild(rowHelp('Samples', mono.length.toLocaleString(), 'Total number of individual amplitude values in the (channel-merged mono) signal - roughly sample rate × duration.'));
      audioCard.appendChild(at);
      const waveWrap = el('div', { style: 'position:relative; width:100%;' });
      const waveCanvas = el('canvas', { class: 'anr-waveform' }); waveCanvas.width = 1024; waveCanvas.height = 80;
      renderWaveform(waveCanvas, mono);
      const waveLine = el('div', { class: 'anr-playhead is-grabbable' });
      waveWrap.appendChild(waveCanvas); waveWrap.appendChild(waveLine);
      audioCard.appendChild(waveWrap);
      audioResultsEl.appendChild(buildHistogramCard(mono));
      const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
      audioResultsEl.appendChild(makeSpectrogramPanel(mono, audioBuf.sampleRate, { basename, audioEl: audioPlayer, signal }));
      const audioDuration = audioBuf.duration;
      function tickPh() {
        waveLine.style.left = (audioDuration > 0 ? (audioPlayer.currentTime / audioDuration) * 100 : 0) + '%';
        if (!audioPlayer.paused) requestAnimationFrame(tickPh);
      }
      audioPlayer.addEventListener('play', () => requestAnimationFrame(tickPh));
      audioPlayer.addEventListener('pause', tickPh);
      audioPlayer.addEventListener('seeked', tickPh);
      waveCanvas.style.cursor = 'pointer';
      waveCanvas.addEventListener('click', (e) => {
        const rect = waveCanvas.getBoundingClientRect();
        audioPlayer.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audioDuration;
        tickPh();
      });
    } catch (e) {
      audioStatus.remove();
      audioCard.appendChild(el('p', { class: 'anr-hint' }, 'Audio decode failed: ' + (e && e.message || 'unknown error')));
    }
  }

  // SHA-256
  if (file.size <= 500 * 1024 * 1024) {
    resultsEl.appendChild(integrityCard(file));
  }

  return true;
}

// ---------- main render ----------

// Tears down the previous video's persistent listeners/observers when a new
// file is analysed.
let videoRenderAbort = null;

export async function renderVideo(file, resultsEl) {
  if (videoRenderAbort) videoRenderAbort.abort();
  videoRenderAbort = new AbortController();
  const renderSignal = videoRenderAbort.signal;

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Loading "${file.name}"…`));


  let header = {};
  try { header = await peekVideoContainer(file); } catch (_) {}

  const url = URL.createObjectURL(file);

  // The probe is kept IN THE DOM (not display:none) so the browser gives it a
  // decode surface for off-screen frame capture - otherwise frames never paint
  // and captures come out black. It's parked 1px/near-transparent in the corner
  // via .anr-video-probe. iOS Safari often refuses to decode something this
  // small/hidden anyway; when the probe never loads, the catch block below falls
  // back to a real visible player (renderVisibleVideoFallback).
  const probe = el('video', { class: 'anr-video-probe' });
  probe.muted = true;
  probe.defaultMuted = true;
  probe.setAttribute('muted', '');
  probe.setAttribute('playsinline', '');
  probe.setAttribute('webkit-playsinline', '');
  probe.setAttribute('preload', 'auto');
  document.body.appendChild(probe);
  renderSignal.addEventListener('abort', () => probe.remove());

  try {
    await new Promise((resolve, reject) => {
      probe.onloadeddata = resolve;
      probe.onerror = () => reject(new Error('format not supported'));
      setTimeout(() => reject(new Error('timeout')), 8000); // iOS can hang here; fall back to a visible player below
      probe.src = url;
    });
    // iOS/Safari renders a black frame for a video that has never played, so it
    // needs a brief muted play to get frame 0 on screen before we capture it.
    // Every other platform can draw frame 0 straight from `loadeddata`, so we
    // skip the playback there - no need to spin the video up just to grab a frame
    // (this is why videos used to briefly "play" while being analysed on desktop).
    if (isIOS()) {
      try { await probe.play(); } catch (_) {}
      await whenFramePainted(probe);
      probe.pause();
    } else {
      // Frame 0 is already decoded at `loadeddata`; one rAF lets it settle before
      // we drawImage() it. (whenFramePainted would wait on the *next* presented
      // frame, which never comes for a paused video - a needless 2s timeout.)
      await new Promise((r) => requestAnimationFrame(r));
    }
  } catch (_) {
    probe.remove();
    resultsEl.innerHTML = '';

    let avi = null;
    try { avi = await parseAviHeader(file); } catch (_) {}

    if (avi) {
      resultsEl.appendChild(el('div', { class: 'anr-info' },
        'Your browser cannot play this codec. Analysis extracted from file data.'));

      const infoCard = el('div', { class: 'anr-card' });
      infoCard.appendChild(el('h3', {}, 'File info'));
      const tbl = el('table', { class: 'anr-readout' });
      tbl.appendChild(row('Name', file.name));
      tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
      tbl.appendChild(rowHelp('MIME', file.type || '-', "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));
      tbl.appendChild(row('Container', header.container || 'AVI'));
      if (avi.codec) tbl.appendChild(row('Video codec', avi.codec.toUpperCase()));
      if (avi.audioCodec) tbl.appendChild(row('Audio codec', avi.audioCodec.toUpperCase()));
      tbl.appendChild(row('Resolution', `${avi.width} × ${avi.height} px`));
      tbl.appendChild(row('Aspect ratio', aspectRatio(avi.width, avi.height)));
      if (avi.duration) tbl.appendChild(row('Duration', formatDuration(avi.duration)));
      if (avi.fps) tbl.appendChild(row('Frame rate', avi.fps + ' fps'));
      if (avi.totalFrames) tbl.appendChild(row('Total frames', avi.totalFrames.toLocaleString()));
      const bitrate = avi.duration && avi.duration > 0
        ? (file.size * 8 / avi.duration / 1000).toFixed(0) + ' kbps  (' + (file.size * 8 / avi.duration / 1_000_000).toFixed(2) + ' Mbps)'
        : '-';
      tbl.appendChild(rowHelp('Bitrate (total)', bitrate, 'Average data rate across the whole file - video, audio, and container overhead combined. Computed as file size ÷ duration, so it is an overall average, not the encoder’s target bitrate.'));
      if (avi.width && avi.height)
        tbl.appendChild(rowHelp('Frame size', ((avi.width * avi.height) / 1_000_000).toFixed(2) + ' MP', 'Pixels per frame in megapixels (width × height ÷ 1,000,000). A rough indicator of how much raw image data each frame holds before compression.'));
      if (avi.audioFormat)
        tbl.appendChild(row('Audio', `${avi.audioFormat.sampleRate} Hz, ${avi.audioFormat.bitsPerSample}-bit, ${avi.audioFormat.channels}ch`));
      infoCard.appendChild(tbl);
      resultsEl.appendChild(infoCard);

      let aviData = null;
      try { aviData = await extractAviData(file, avi); } catch (_) {}

      // MJPEG frame viewer
      if (aviData && aviData.videoFrames.length) {
        const frames = aviData.videoFrames;
        const frameCard = el('div', { class: 'anr-card' });
        frameCard.appendChild(el('h3', {}, 'Frames'));
        frameCard.appendChild(el('p', { class: 'anr-hint' },
          frames.length + ' MJPEG frame' + (frames.length > 1 ? 's' : '') + ' extracted'));

        const frameImg = el('img', {
          style: 'max-width:100%; max-height:480px; display:block; border:1px solid var(--hairline); background:#0a0a0a;',
          alt: 'Frame 1'
        });
        frameImg.src = URL.createObjectURL(new Blob([frames[0]], { type: 'image/jpeg' }));
        frameCard.appendChild(frameImg);

        let currentFrame = 0;
        const frameLabel = el('span', { class: 'anr-hint' }, `Frame 1 / ${frames.length}`);
        function showFrame(idx) {
          currentFrame = idx;
          URL.revokeObjectURL(frameImg.src);
          frameImg.src = URL.createObjectURL(new Blob([frames[idx]], { type: 'image/jpeg' }));
          frameImg.alt = `Frame ${idx + 1}`;
          frameLabel.textContent = `Frame ${idx + 1} / ${frames.length}`;
        }

        const prevBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
          if (currentFrame > 0) showFrame(currentFrame - 1);
        }}, '← Prev');
        const nextBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
          if (currentFrame < frames.length - 1) showFrame(currentFrame + 1);
        }}, 'Next →');
        const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
          const blob = new Blob([frames[currentFrame]], { type: 'image/jpeg' });
          const frameFile = new File([blob], `frame_${currentFrame}.jpg`, { type: 'image/jpeg' });
          const photoResults = document.getElementById('photoResults');
          if (photoResults) {
            renderPhoto(frameFile, photoResults);
            const photoSection = document.getElementById('photo');
            if (photoSection) window.scrollTo({ top: photoSection.getBoundingClientRect().top + window.scrollY - 56, behavior: 'smooth' });
          }
        }}, 'Analyse frame');

        if (frames.length > 1)
          frameCard.appendChild(el('div', { class: 'anr-frame-grid', style: 'margin-top:10px;' },
            [frameLabel, analyseBtn, prevBtn, nextBtn]));
        else
          frameCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:10px;' }, [analyseBtn]));

        if (frames.length >= 8) {
          const sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
          const sheetOut = el('div');
          sheetBtn.addEventListener('click', async () => {
            sheetBtn.disabled = true;
            sheetBtn.textContent = 'Generating…';
            const cols = 4, rows = 2, total = cols * rows;
            const tw = Math.round(avi.width * (320 / Math.max(avi.width, avi.height)));
            const th = Math.round(avi.height * (320 / Math.max(avi.width, avi.height)));
            const pad = 4;
            const gridCanvas = document.createElement('canvas');
            gridCanvas.width = cols * tw + (cols + 1) * pad;
            gridCanvas.height = rows * th + (rows + 1) * pad;
            const ctx = gridCanvas.getContext('2d');
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);
            for (let i = 0; i < total; i++) {
              const fi = Math.floor(i * (frames.length - 1) / (total - 1));
              const img = new Image();
              img.src = URL.createObjectURL(new Blob([frames[fi]], { type: 'image/jpeg' }));
              await new Promise(r => { img.onload = r; img.onerror = r; });
              const c = i % cols, r = Math.floor(i / cols);
              ctx.drawImage(img, pad + c * (tw + pad), pad + r * (th + pad), tw, th);
              URL.revokeObjectURL(img.src);
            }
            sheetOut.innerHTML = '';
            sheetOut.appendChild(el('img', {
              src: gridCanvas.toDataURL('image/png'), alt: 'Contact sheet',
              style: 'max-width:100%; margin-top:10px; border:1px solid var(--hairline); display:block;'
            }));
            sheetBtn.disabled = false;
            sheetBtn.textContent = 'Generate contact sheet';
          });
          frameCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [sheetBtn]));
          frameCard.appendChild(sheetOut);
        }
        resultsEl.appendChild(frameCard);

        // Auto-analyse first frame
        const photoResultsEl = document.getElementById('photoResults');
        if (photoResultsEl) {
          const blob = new Blob([frames[0]], { type: 'image/jpeg' });
          const frameFile = new File([blob], 'frame_0.000s.jpg', { type: 'image/jpeg' });
          renderPhoto(frameFile, photoResultsEl);
        }
      }

      // Audio from direct PCM extraction
      const audioResultsEl = document.getElementById('audioResults');
      if (audioResultsEl && aviData && aviData.audioBuffer) {
        audioResultsEl.hidden = false;
        const audioBuf = aviData.audioBuffer;
        const mono = getMono(audioBuf);
        const stats = computeStats(mono);
        const wavBlob = encodeWav(audioBuf);
        const wavUrl = URL.createObjectURL(wavBlob);

        const audioPlayer = el('audio', { src: wavUrl });
        audioPlayer.style.display = 'none';
        const apCard = el('div', { class: 'anr-card' });
        apCard.appendChild(el('h3', {}, 'Extracted audio'));
        apCard.appendChild(audioPlayer);
        apCard.appendChild(makePlayer(audioPlayer));
        apCard.appendChild(audioDownloadRow(wavUrl, file));
        audioResultsEl.appendChild(apCard);

        const audioCard = el('div', { class: 'anr-card' });
        audioCard.appendChild(el('h3', {}, 'Audio track'));
        const at = el('table', { class: 'anr-readout' });
        at.appendChild(row('Duration', formatDuration(audioBuf.duration)));
        at.appendChild(rowHelp('Sample rate', audioBuf.sampleRate.toLocaleString() + ' Hz',
          'Audio samples captured per second, in hertz - e.g. 48000 Hz means 48,000 amplitude readings per second of sound.'));
        at.appendChild(rowHelp('Channels', audioBuf.numberOfChannels,
          'Number of separate audio channels: 1 = mono, 2 = stereo (left + right), more for surround.'));
        at.appendChild(rowHelp('Peak', stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)',
          'Highest sample amplitude. dBFS = decibels relative to full scale (0 dBFS = digital maximum).'));
        at.appendChild(rowHelp('RMS', stats.rms.toFixed(3) + '  (' + stats.rmsDb.toFixed(1) + ' dBFS)',
          'Root Mean Square - average signal power, closer to perceived loudness than peak.'));
        at.appendChild(rowHelp('Samples', mono.length.toLocaleString(),
          'Total number of individual amplitude values in the (channel-merged mono) signal - roughly sample rate × duration.'));
        audioCard.appendChild(at);

        const waveWrap = el('div', { style: 'position:relative; width:100%;' });
        const waveCanvas = el('canvas', { class: 'anr-waveform' });
        waveCanvas.width = 1024; waveCanvas.height = 80;
        renderWaveform(waveCanvas, mono);
        const waveLine = el('div', { class: 'anr-playhead is-grabbable' });
        waveWrap.appendChild(waveCanvas);
        waveWrap.appendChild(waveLine);
        audioCard.appendChild(waveWrap);
        audioResultsEl.appendChild(audioCard);

        audioResultsEl.appendChild(buildHistogramCard(mono));
        const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
        audioResultsEl.appendChild(makeSpectrogramPanel(mono, audioBuf.sampleRate, { basename, audioEl: audioPlayer, signal: renderSignal }));

        const audioDuration = audioBuf.duration;
        function tickPlayhead() {
          const pct = audioDuration > 0 ? (audioPlayer.currentTime / audioDuration) * 100 : 0;
          waveLine.style.left = pct + '%';
          if (!audioPlayer.paused) requestAnimationFrame(tickPlayhead);
        }
        audioPlayer.addEventListener('play', () => requestAnimationFrame(tickPlayhead));
        audioPlayer.addEventListener('pause', tickPlayhead);
        audioPlayer.addEventListener('seeked', tickPlayhead);
        waveCanvas.style.cursor = 'pointer';
        waveCanvas.addEventListener('click', (e) => {
          const rect = waveCanvas.getBoundingClientRect();
          const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          audioPlayer.currentTime = frac * audioDuration;
          tickPlayhead();
        });
      }

      // SHA-256
      if (file.size <= 500 * 1024 * 1024) {
        resultsEl.appendChild(integrityCard(file));
      }

      return;
    }

    // Not an AVI we can decode - but the probe may simply have failed on iOS.
    // Try a real visible player before declaring the file unplayable.
    const shownFallback = await renderVisibleVideoFallback(file, url, header, resultsEl, renderSignal);
    if (shownFallback) return;

    resultsEl.appendChild(el('div', { class: 'anr-error' },
      'Could not load this video. Format may not be supported by your browser.'));
    return;
  }

  const vw = probe.videoWidth;
  const vh = probe.videoHeight;
  const dur = probe.duration;

  resultsEl.innerHTML = '';

  // Capture the first frame once, here - reused for the section-meta thumbnail
  // AND the player poster so the first frame shows immediately on load (the
  // <video> can otherwise render black until played, especially on iOS).
  let posterUrl = '';
  if (vw && vh) {
    const pcv = document.createElement('canvas');
    const pscale = Math.min(1, 1280 / Math.max(vw, vh));
    pcv.width = Math.round(vw * pscale);
    pcv.height = Math.round(vh * pscale);
    pcv.getContext('2d').drawImage(probe, 0, 0, pcv.width, pcv.height);
    posterUrl = pcv.toDataURL('image/jpeg', 0.85);
  }

  // ---- Thumbnail in section-meta (desktop only, hidden by CSS on mobile) ----
  const previewSlot = document.getElementById('videoPreview');
  if (previewSlot && posterUrl) {
    previewSlot.innerHTML = '';
    const thumb = el('div', { class: 'section-meta-preview' });
    thumb.appendChild(el('img', { src: posterUrl, alt: file.name }));
    thumb.appendChild(el('p', { class: 'section-meta-preview-caption' },
      `${vw} × ${vh} · ${formatDuration(dur)} · ${fmtBytes(file.size)}`));
    previewSlot.appendChild(thumb);
  }

  // Auto-analyse first frame in the photo section
  const photoResultsEl = document.getElementById('photoResults');
  if (photoResultsEl) {
    let lastPhotoHeight = photoResultsEl.offsetHeight;
    const photoScrollComp = new ResizeObserver(() => {
      const newHeight = photoResultsEl.offsetHeight;
      const delta = newHeight - lastPhotoHeight;
      if (delta > 0) window.scrollBy(0, delta);
      lastPhotoHeight = newHeight;
    });
    photoScrollComp.observe(photoResultsEl);
    renderSignal.addEventListener('abort', () => photoScrollComp.disconnect());
  }
  if (vw && vh) {
    const fcv = document.createElement('canvas');
    fcv.width = vw; fcv.height = vh;
    fcv.getContext('2d').drawImage(probe, 0, 0, vw, vh);
    fcv.toBlob(blob => {
      if (!blob) return;
      const frameFile = new File([blob], `frame_0.000s.png`, { type: 'image/png' });
      if (photoResultsEl) renderPhoto(frameFile, photoResultsEl);
    }, 'image/png');
  }

  // NOTE: the probe is intentionally kept alive here. It already decodes this
  // file off-screen, so scene detection seeks IT instead of the visible player -
  // letting the user scrub/play freely while analysis runs. It's torn down once
  // detection finishes (or on abort, via the handler registered above).

  // ---- Player ----
  const playerCard = el('div', { class: 'anr-card', style: 'position:relative;' });
  playerCard.appendChild(el('h3', {}, 'Player'));
  // playsinline keeps playback inline on iPhone instead of forcing fullscreen;
  // the poster shows the captured first frame right away.
  const playerEl = el('video', { src: url, playsinline: '', poster: posterUrl });
  playerEl.setAttribute('webkit-playsinline', '');
  playerEl.style.cssText = 'width:100%; max-height:480px; background:#0a0a0a; display:block; border:1px solid var(--hairline);';
  applyVideoControls(playerEl);
  playerCard.appendChild(playerEl);
  playerCard.appendChild(makePlayer(playerEl));
  // Non-blocking status badge shown while background scene detection runs on the
  // off-screen probe. It doesn't capture pointer events, so the player stays
  // fully interactive (scrub/play) underneath it.
  const sceneBadge = el('div', { class: 'anr-video-analysing' }, 'Analysing…');
  playerCard.appendChild(sceneBadge);

  // ---- Frame-by-frame navigation ----
  let detectedFps = 30;

  function fmtTimecode(t) {
    const fps = detectedFps;
    const totalFrames = Math.floor(t * fps);
    const f = totalFrames % Math.round(fps);
    const totalSec = Math.floor(t);
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    return String(h).padStart(2, '0') + ':' +
      String(m).padStart(2, '0') + ':' +
      String(s).padStart(2, '0') + ':' +
      String(f).padStart(2, '0');
  }

  function parseTimecode(str) {
    const parts = str.split(':').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return null;
    const [h, m, s, f] = parts;
    return h * 3600 + m * 60 + s + f / detectedFps;
  }

  const tcDisplay = el('span', { class: 'anr-timecode-value' }, '00:00:00:00');
  const tcInput = el('input', {
    type: 'text',
    class: 'anr-timecode-input',
    maxlength: '11',
    spellcheck: 'false',
    autocomplete: 'off'
  });
  tcInput.style.display = 'none';

  const tcLabel = el('span', { class: 'anr-timecode-label' }, 'TIMECODE');
  const tcHint = el('span', { class: 'anr-timecode-hint' }, 'hour : min : sec : frame');
  tcHint.style.display = 'none';
  const frameTimeLabel = el('div', { class: 'anr-timecode' }, [tcLabel, tcDisplay, tcInput]);

  function updateFrameTimeLabel() {
    tcDisplay.textContent = fmtTimecode(playerEl.currentTime);
  }

  tcDisplay.addEventListener('click', () => {
    playerEl.pause();
    tcInput.value = tcDisplay.textContent;
    tcDisplay.style.display = 'none';
    tcInput.style.display = '';
    tcHint.style.display = '';
    tcInput.focus();
    tcInput.select();
  });

  function commitTimecode() {
    const t = parseTimecode(tcInput.value);
    if (t !== null && isFinite(playerEl.duration)) {
      playerEl.currentTime = Math.max(0, Math.min(playerEl.duration, t));
    }
    tcInput.style.display = 'none';
    tcHint.style.display = 'none';
    tcDisplay.style.display = '';
    updateFrameTimeLabel();
  }

  tcInput.addEventListener('blur', commitTimecode);
  tcInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); tcInput.blur(); }
    if (e.key === 'Escape') {
      tcInput.style.display = 'none';
      tcHint.style.display = 'none';
      tcDisplay.style.display = '';
    }
  });

  let tcRaf = 0;
  function tickTimecode() {
    updateFrameTimeLabel();
    if (!playerEl.paused) tcRaf = requestAnimationFrame(tickTimecode);
  }
  playerEl.addEventListener('play', () => { tcRaf = requestAnimationFrame(tickTimecode); });
  playerEl.addEventListener('pause', () => { cancelAnimationFrame(tcRaf); updateFrameTimeLabel(); });
  playerEl.addEventListener('seeked', updateFrameTimeLabel);

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

  const analyseFrameBtn = el('button', { type: 'button', class: 'anr-btn', onclick: async () => {
    if (!vw || !vh) return;
    analyseFrameBtn.disabled = true;
    analyseFrameBtn.textContent = 'Capturing…';
    const cv = document.createElement('canvas');
    cv.width = vw; cv.height = vh;
    cv.getContext('2d').drawImage(playerEl, 0, 0, vw, vh);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const ts = playerEl.currentTime;
    const frameFile = new File([blob], `frame_${ts.toFixed(3)}s.png`, { type: 'image/png' });
    const photoResults = document.getElementById('photoResults');
    if (photoResults) {
      renderPhoto(frameFile, photoResults);
      const photoSection = document.getElementById('photo');
      if (photoSection) window.scrollTo({ top: photoSection.getBoundingClientRect().top + window.scrollY - 56, behavior: 'smooth' });
    }
    analyseFrameBtn.disabled = false;
    analyseFrameBtn.textContent = 'Analyse frame';
  }}, 'Analyse frame');

  const frameGrid = el('div', { class: 'anr-frame-grid' }, [frameTimeLabel, analyseFrameBtn, prevFrameBtn, nextFrameBtn]);
  const frameWrap = el('div', { class: 'anr-frame-wrap' }, [tcHint, frameGrid]);
  playerCard.appendChild(frameWrap);

  resultsEl.appendChild(playerCard);

  // ---- File info ----
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(rowHelp('MIME', file.type || '-', "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));
  if (header.container)
    tbl.appendChild(row('Container', header.container + (header.brand ? '  (' + header.brand + ')' : '')));
  tbl.appendChild(row('Resolution', vw && vh ? `${vw} × ${vh} px` : '-'));
  tbl.appendChild(row('Aspect ratio', aspectRatio(vw, vh)));
  tbl.appendChild(row('Duration', isFinite(dur) ? formatDuration(dur) : '-'));
  const bitrate = isFinite(dur) && dur > 0
    ? (file.size * 8 / dur / 1000).toFixed(0) + ' kbps  (' + (file.size * 8 / dur / 1_000_000).toFixed(2) + ' Mbps)'
    : '-';
  tbl.appendChild(rowHelp('Bitrate (total)', bitrate, 'Average data rate across the whole file - video, audio, and container overhead combined. Computed as file size ÷ duration, so it is an overall average, not the encoder’s target bitrate.'));
  const fpsRow = row('Frame rate', 'detecting…');
  tbl.appendChild(fpsRow);
  if (vw && vh) {
    const mp = ((vw * vh) / 1_000_000).toFixed(2);
    tbl.appendChild(rowHelp('Frame size', mp + ' MP', 'Pixels per frame in megapixels (width × height ÷ 1,000,000). A rough indicator of how much raw image data each frame holds before compression.'));
  }
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  const fpsCell = fpsRow.querySelector('td');
  detectFps(file, fpsCell).then((fps) => {
    fpsCell.textContent = fps != null ? fps + ' fps' : 'N/A';
    if (fps != null) { detectedFps = fps; updateFrameTimeLabel(); }
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

  // ---- Contact sheet / thumbnail grid ----
  if (vw && vh) {
    const sheetCard = el('div', { class: 'anr-card' });
    const [shH, shHelp] = h3help('Contact sheet', 'A 4×2 grid of 8 evenly-spaced thumbnails from across the video. Gives you a visual overview of the entire video at a glance, similar to film contact sheets.');
    sheetCard.appendChild(shH); sheetCard.appendChild(shHelp);
    sheetCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:12px !important;' },
      '4×2 grid of 8 evenly-spaced thumbnails from the video'));
    const sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
    const sheetOut = el('div');

    sheetBtn.addEventListener('click', async () => {
      sheetBtn.disabled = true;
      sheetBtn.textContent = 'Generating…';

      const cols = 4, rows = 2, total = cols * rows;
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
        await seekAndPaint(playerEl, t);

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

    // ---- Scene change detection (runs automatically) ----
    const sceneCard = el('div', { class: 'anr-card' });
    const [scH, scHelp] = h3help('Scene changes',
      'Samples the video at a fixed interval and compares consecutive frames by mean pixel difference. When the difference crosses the threshold a scene change is marked, with a confidence score for how decisively it cleared it. Runs automatically; click any thumbnail or timeline marker to jump there.');
    sceneCard.appendChild(scH); sceneCard.appendChild(scHelp);
    const sceneOut = el('div');
    sceneOut.appendChild(el('p', { class: 'anr-hint' }, 'Detecting scene changes…'));
    sceneCard.appendChild(sceneOut);
    resultsEl.appendChild(sceneCard);

    // Detection seeks a video element around, so it runs on an off-screen element
    // (never the visible player - the user can scrub/play while it runs). Large
    // videos can be slow to walk, so they don't auto-run: a button triggers them.
    function renderSceneResults(changes) {
      sceneOut.innerHTML = '';
      sceneOut.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:10px;' },
        changes.length
          ? changes.length + ' scene change' + (changes.length > 1 ? 's' : '') + ' detected'
          : 'No scene changes detected'));
      if (changes.length && isFinite(dur) && dur > 0) {
        const timeline = el('div', { class: 'anr-scene-timeline' });
        for (const sc of changes) {
          const marker = el('div', {
            class: 'anr-scene-marker',
            style: 'left:' + (sc.time / dur) * 100 + '%;',
            title: formatDuration(sc.time) + '  ·  ' + sc.confidence + '% confidence'
          });
          marker.addEventListener('click', () => { playerEl.currentTime = sc.time; playerEl.pause(); });
          timeline.appendChild(marker);
        }
        sceneOut.appendChild(timeline);
        const details = el('details', { class: 'anr-scene-details' });
        details.appendChild(el('summary', {}, 'Thumbnails (' + changes.length + ')'));
        const grid = el('div', { class: 'anr-scene-grid' });
        for (const sc of changes) {
          const wrap = el('div', {
            class: 'anr-scene-thumb',
            onclick: () => { playerEl.currentTime = sc.time; playerEl.pause(); }
          });
          wrap.appendChild(el('img', { src: sc.thumbnail, alt: 'Scene change at ' + formatDuration(sc.time) }));
          wrap.appendChild(el('span', { class: 'anr-scene-meta' },
            formatDuration(sc.time) + ' · ' + sc.confidence + '%'));
          grid.appendChild(wrap);
        }
        details.appendChild(grid);
        sceneOut.appendChild(details);
      }
    }

    async function detectAndRender(videoEl, removeAfter) {
      let changes = [];
      try { changes = await detectSceneChanges(videoEl, 55, renderSignal); } catch (_) {}
      if (removeAfter) { try { videoEl.removeAttribute('src'); videoEl.load(); } catch (_) {} videoEl.remove(); }
      sceneBadge.remove();
      if (renderSignal.aborted) return;
      renderSceneResults(changes);
    }

    // Spin up a fresh off-screen video (same trick as the probe) for on-demand runs.
    function makeAnalysisVideo() {
      const v = el('video', { class: 'anr-video-probe' });
      v.muted = true; v.defaultMuted = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', ''); v.setAttribute('preload', 'auto');
      v.src = url;
      document.body.appendChild(v);
      renderSignal.addEventListener('abort', () => v.remove());
      return v;
    }

    const BIG_VIDEO_BYTES = 150 * 1024 * 1024;
    const bigVideo = file.size > BIG_VIDEO_BYTES || (isFinite(dur) && dur > 600);
    if (bigVideo) {
      // Don't auto-run on big videos: free the probe and offer a manual trigger.
      try { probe.removeAttribute('src'); probe.load(); } catch (_) {}
      probe.remove();
      sceneBadge.remove();
      sceneOut.innerHTML = '';
      sceneOut.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:8px;' },
        'Skipped automatically for large videos (' + (file.size / 1048576).toFixed(0) + ' MB). Run it when you want:'));
      const runBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Detect scene changes');
      runBtn.addEventListener('click', () => {
        runBtn.remove();
        sceneOut.insertBefore(el('p', { class: 'anr-hint' }, 'Detecting scene changes…'), sceneOut.firstChild);
        const v = makeAnalysisVideo();
        const go = () => detectAndRender(v, true);
        if (isFinite(v.duration) && v.duration > 0) go();
        else { v.addEventListener('loadeddata', go, { once: true }); setTimeout(go, 6000); }
      });
      sceneOut.appendChild(runBtn);
    } else {
      (async () => {
        if (renderSignal.aborted) { probe.remove(); return; }
        await detectAndRender(probe, true);
      })();
    }
  }

  // ---- Audio track extraction (renders into the Sound section) ----
  const audioResultsEl = document.getElementById('audioResults');
  if (audioResultsEl) {
    audioResultsEl.hidden = false;

    // Scroll compensation: when audio section expands above the video section,
    // adjust scroll so the video section stays in place
    let lastAudioHeight = audioResultsEl.offsetHeight;
    const scrollCompensator = new ResizeObserver(() => {
      const newHeight = audioResultsEl.offsetHeight;
      const delta = newHeight - lastAudioHeight;
      if (delta > 0) window.scrollBy(0, delta);
      lastAudioHeight = newHeight;
    });
    scrollCompensator.observe(audioResultsEl);
    renderSignal.addEventListener('abort', () => scrollCompensator.disconnect());

    const audioCard = el('div', { class: 'anr-card' });
    audioCard.appendChild(el('h3', {}, 'Audio track'));
    const audioStatus = el('p', { class: 'anr-info' }, 'Decoding audio from video…');
    audioCard.appendChild(audioStatus);
    audioResultsEl.appendChild(audioCard);

    try {
      const ac = getAudioCtx();
      const buf = await file.arrayBuffer();
      let audioBuf;
      try {
        audioBuf = await ac.decodeAudioData(buf.slice(0));
      } catch (_) {
        audioStatus.textContent = 'Trying PCM extraction…';
        audioBuf = extractPcmFromMp4(buf);
      }
      if (!audioBuf) {
        audioStatus.textContent = 'Web Audio failed, using FFmpeg…';
        audioBuf = await ffmpegExtractAudio(file, audioCard);
      }

      audioStatus.remove();

      const mono = getMono(audioBuf);
      const stats = computeStats(mono);
      const audioDuration = audioBuf.duration;

      // Encode WAV for playback
      const wavChannels = audioBuf.numberOfChannels;
      const wavSr = audioBuf.sampleRate;
      const wavSamples = audioBuf.length;
      const wavBps = 16;
      const wavBlock = wavChannels * (wavBps / 8);
      const wavDataSize = wavSamples * wavBlock;
      const wavBuf = new ArrayBuffer(44 + wavDataSize);
      const wavView = new DataView(wavBuf);
      let wo = 0;
      const ws = (s) => { for (let i = 0; i < s.length; i++) wavView.setUint8(wo++, s.charCodeAt(i)); };
      ws('RIFF'); wavView.setUint32(wo, 36 + wavDataSize, true); wo += 4; ws('WAVEfmt ');
      wavView.setUint32(wo, 16, true); wo += 4;
      wavView.setUint16(wo, 1, true); wo += 2;
      wavView.setUint16(wo, wavChannels, true); wo += 2;
      wavView.setUint32(wo, wavSr, true); wo += 4;
      wavView.setUint32(wo, wavSr * wavBlock, true); wo += 4;
      wavView.setUint16(wo, wavBlock, true); wo += 2;
      wavView.setUint16(wo, wavBps, true); wo += 2;
      ws('data'); wavView.setUint32(wo, wavDataSize, true); wo += 4;
      const chData = [];
      for (let c = 0; c < wavChannels; c++) chData.push(audioBuf.getChannelData(c));
      for (let i = 0; i < wavSamples; i++) {
        for (let c = 0; c < wavChannels; c++) {
          let s = chData[c][i];
          s = Math.max(-1, Math.min(1, s));
          wavView.setInt16(wo, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          wo += 2;
        }
      }
      const wavUrl = URL.createObjectURL(new Blob([wavBuf], { type: 'audio/wav' }));

      // Custom player (hidden audio element + styled controls)
      const audioPlayer = el('audio', { src: wavUrl });
      audioPlayer.style.display = 'none';
      const playerCard = el('div', { class: 'anr-card' });
      playerCard.appendChild(el('h3', {}, 'Extracted audio'));
      playerCard.appendChild(audioPlayer);
      playerCard.appendChild(makePlayer(audioPlayer));
      playerCard.appendChild(audioDownloadRow(wavUrl, file));
      audioResultsEl.appendChild(playerCard);

      // Info table
      const at = el('table', { class: 'anr-readout' });
      at.appendChild(row('Duration', formatDuration(audioDuration)));
      at.appendChild(rowHelp('Sample rate', wavSr.toLocaleString() + ' Hz',
        'Audio samples captured per second, in hertz - e.g. 48000 Hz means 48,000 amplitude readings per second of sound.'));
      at.appendChild(rowHelp('Channels', wavChannels,
        'Number of separate audio channels: 1 = mono, 2 = stereo (left + right), more for surround.'));
      at.appendChild(rowHelp('Peak', stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)',
        'Highest sample amplitude. dBFS = decibels relative to full scale (0 dBFS = digital maximum).'));
      at.appendChild(rowHelp('RMS', stats.rms.toFixed(3) + '  (' + stats.rmsDb.toFixed(1) + ' dBFS)',
        'Root Mean Square - average signal power, closer to perceived loudness than peak.'));
      at.appendChild(rowHelp('Samples', mono.length.toLocaleString(),
        'Total number of individual amplitude values in the (channel-merged mono) signal - roughly sample rate × duration.'));
      audioCard.appendChild(at);

      // Waveform with draggable playhead
      const waveWrap = el('div', { style: 'position:relative; width:100%;' });
      const waveCanvas = el('canvas', { class: 'anr-waveform' });
      waveCanvas.width = 1024; waveCanvas.height = 80;
      renderWaveform(waveCanvas, mono);
      const waveLine = el('div', { class: 'anr-playhead is-grabbable' });
      waveWrap.appendChild(waveCanvas);
      waveWrap.appendChild(waveLine);
      audioCard.appendChild(waveWrap);

      // Amplitude histogram (same labeled card the audio module uses)
      audioResultsEl.appendChild(buildHistogramCard(mono));

      // Spectrogram (with playhead + click-to-seek)
      const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
      audioResultsEl.appendChild(makeSpectrogramPanel(mono, audioBuf.sampleRate, { basename, audioEl: audioPlayer, signal: renderSignal }));

      // Sync waveform playhead at 60fps
      function tickPlayhead() {
        const pct = audioDuration > 0 ? (audioPlayer.currentTime / audioDuration) * 100 : 0;
        waveLine.style.left = pct + '%';
        if (!audioPlayer.paused) requestAnimationFrame(tickPlayhead);
      }
      audioPlayer.addEventListener('play', () => requestAnimationFrame(tickPlayhead));
      audioPlayer.addEventListener('pause', tickPlayhead);
      audioPlayer.addEventListener('seeked', tickPlayhead);

      // Click waveform to seek
      waveCanvas.style.cursor = 'pointer';
      function seekFromX(clientX) {
        const rect = waveCanvas.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        audioPlayer.currentTime = frac * audioDuration;
        tickPlayhead();
      }
      waveCanvas.addEventListener('click', (e) => seekFromX(e.clientX));

      // Drag playhead on waveform - window listeners live only during a drag.
      let waveDragging = false;
      function onWaveMouseMove(e) { if (waveDragging) seekFromX(e.clientX); }
      function onWaveMouseUp() {
        waveDragging = false;
        window.removeEventListener('mousemove', onWaveMouseMove);
        window.removeEventListener('mouseup', onWaveMouseUp);
      }
      waveLine.addEventListener('mousedown', (e) => {
        waveDragging = true; e.preventDefault();
        window.addEventListener('mousemove', onWaveMouseMove);
        window.addEventListener('mouseup', onWaveMouseUp);
      });
      function onWaveTouchMove(e) { if (waveDragging && e.touches[0]) seekFromX(e.touches[0].clientX); }
      function onWaveTouchEnd() {
        waveDragging = false;
        window.removeEventListener('touchmove', onWaveTouchMove);
        window.removeEventListener('touchend', onWaveTouchEnd);
      }
      waveLine.addEventListener('touchstart', (e) => {
        waveDragging = true; e.preventDefault();
        window.addEventListener('touchmove', onWaveTouchMove, { passive: false });
        window.addEventListener('touchend', onWaveTouchEnd);
      }, { passive: false });
    } catch (e) {
      console.warn('Audio extraction failed:', e);
      audioStatus.remove();
      audioCard.appendChild(el('p', { class: 'anr-hint' },
        'Audio decode failed: ' + (e && e.message || 'unknown error') + '. Try converting to MP4 (H.264 + AAC).'));
    }
  }

  // ---- SHA-256 ----
  if (file.size <= 500 * 1024 * 1024) {
    const hashCard = el('div', { class: 'anr-card' });
    const [vhH, vhHelp] = h3help('Integrity', '<strong>SHA-256</strong> is a cryptographic hash of the raw file bytes. Any change to the file, even one bit, produces a completely different hash. Useful for verifying a file has not been tampered with.');
    hashCard.appendChild(vhH); hashCard.appendChild(vhHelp);
    const hashTbl = el('table', { class: 'anr-readout' });
    hashTbl.appendChild(sha256Row(file));
    hashCard.appendChild(hashTbl);
    resultsEl.appendChild(hashCard);
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
