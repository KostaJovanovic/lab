/* Analyser - audio module
   Handles uploaded files, mic recording, and live spectrogram.
   Renders waveform, file info, and an interactive spectrogram. */

import {
  computeSpectrogram, renderSpectrogram, colormaps,
  frequencyTicks, timeTicks, formatHz, formatTime
} from './spectrogram.js';
import { el, row, rowHelp, fmtBytes, h3help, errorCard } from './util.js';
import {
  computeStats, computeCentroid, computeLufs,
  detectPitch, detectBPM, computeStereoStats
} from './audio-analysis.js';
import { peekContainer, adtsToM4a, readTagBPM, extractCoverArt } from './audio-codec.js';
import { makePlayer } from './audio-player.js';

// Re-exported so existing importers (e.g. video.js) can keep importing the
// transport from this module.
export { makePlayer };

let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// --- Decode helpers ---
async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  // decodeAudioData mutates buffer in some browsers, so pass a copy
  const copy = buf.slice(0);
  return await ctx().decodeAudioData(copy);
}

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

// Human-readable speaker layout for a given channel count.
function describeChannels(n) {
  const map = {
    1: '  (Mono)', 2: '  (Stereo)', 3: '  (2.1)', 4: '  (Quad / 4.0)',
    6: '  (5.1 surround)', 7: '  (6.1 surround)', 8: '  (7.1 surround)',
    10: '  (7.1.2 Atmos)', 12: '  (7.1.4 Atmos)', 16: '  (9.1.6 Atmos)'
  };
  return map[n] || (n > 2 ? '  (' + n + '-channel surround)' : '');
}

// Make a playhead line grabbable, so you can drag it to scrub. `seekFromClientX`
// maps a pointer x to a seek (and repositions the line). Works for mouse + touch.
// Window listeners are attached only for the duration of a drag and removed on
// release, so they don't accumulate as new files are analysed.
function attachScrub(lineEl, seekFromClientX) {
  lineEl.classList.add('is-grabbable');

  function onMouseMove(e) { seekFromClientX(e.clientX); }
  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }
  lineEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    seekFromClientX(e.clientX);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  function onTouchMove(e) {
    if (e.touches[0]) { e.preventDefault(); seekFromClientX(e.touches[0].clientX); }
  }
  function onTouchEnd() {
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  }
  lineEl.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches[0]) seekFromClientX(e.touches[0].clientX);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }, { passive: false });
}

function renderVectorscope(canvas, left, right) {
  const size = canvas.width;
  const ctxC = canvas.getContext('2d');
  ctxC.fillStyle = '#1a1a1a';
  ctxC.fillRect(0, 0, size, size);

  // Draw guides: centre cross + diagonal axes
  const cx = size / 2, cy = size / 2;
  ctxC.strokeStyle = '#333';
  ctxC.lineWidth = 1;
  // Horizontal and vertical (mono = vertical, hard-pan = horizontal after rotation)
  ctxC.beginPath();
  ctxC.moveTo(cx, 0); ctxC.lineTo(cx, size);
  ctxC.moveTo(0, cy); ctxC.lineTo(size, cy);
  ctxC.stroke();

  // Labels
  ctxC.fillStyle = '#666';
  ctxC.font = '10px monospace';
  ctxC.textAlign = 'center';
  ctxC.fillText('M', cx, 10);
  ctxC.fillText('S', size - 8, cy + 4);
  ctxC.fillText('L', cx - 6, 10);
  ctxC.textAlign = 'left';
  ctxC.fillText('R', cx + 3, 10);

  const n = Math.min(left.length, right.length);
  if (n === 0) return;

  // Downsample to max ~40k dots for performance
  const maxDots = 40000;
  const step = Math.max(1, Math.floor(n / maxDots));
  const scale = size * 0.42; // leave a small margin

  // Use ImageData for efficient semi-transparent dot rendering
  const imgData = ctxC.getImageData(0, 0, size, size);
  const data = imgData.data;

  for (let i = 0; i < n; i += step) {
    const l = left[i], r = right[i];
    // 45-degree rotation: mid on Y (vertical), side on X (horizontal)
    const mid  = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    const px = Math.round(cx + side * scale);
    const py = Math.round(cy - mid * scale);
    if (px < 0 || px >= size || py < 0 || py >= size) continue;
    const idx = (py * size + px) * 4;
    // Additive blending for density visualisation
    data[idx]     = Math.min(255, data[idx]     + 12);  // R
    data[idx + 1] = Math.min(255, data[idx + 1] + 28);  // G
    data[idx + 2] = Math.min(255, data[idx + 2] + 18);  // B
    data[idx + 3] = 255;
  }

  ctxC.putImageData(imgData, 0, 0);
  ctxC.strokeStyle = '#C8DCE8';
  ctxC.strokeRect(0, 0, size, size);
}

// --- Waveform render (downsampled min/max per pixel) ---
function renderWaveform(canvas, samples) {
  const ctxC = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctxC.fillStyle = '#1a1a1a';
  ctxC.fillRect(0, 0, w, h);
  ctxC.strokeStyle = '#445f74';
  ctxC.lineWidth = 1;
  ctxC.beginPath();
  ctxC.moveTo(0, h / 2);
  ctxC.lineTo(w, h / 2);
  ctxC.stroke();

  if (!samples.length) return;
  const samplesPerPx = samples.length / w;
  const clipRegions = [];
  for (let x = 0; x < w; x++) {
    const start = Math.floor(x * samplesPerPx);
    const end   = Math.floor((x + 1) * samplesPerPx);
    let mn = 1, mx = -1, clip = false;
    for (let i = start; i < end && i < samples.length; i++) {
      const v = samples[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      if (Math.abs(v) >= 0.999) clip = true;
    }
    const y1 = ((1 - mx) / 2) * h;
    const y2 = ((1 - mn) / 2) * h;
    const bh = Math.max(1, y2 - y1);
    if (clip) {
      clipRegions.push({ x, y: y1, h: bh });
      ctxC.fillStyle = '#444';
      ctxC.fillRect(x, y1, 1, bh);
    } else {
      ctxC.fillStyle = '#80a4ba';
      ctxC.fillRect(x, y1, 1, bh);
    }
  }
  if (clipRegions.length) {
    ctxC.save();
    ctxC.beginPath();
    for (const r of clipRegions) ctxC.rect(r.x, r.y, 1, r.h);
    ctxC.clip();
    const stripe = 6;
    ctxC.lineWidth = 2;
    for (let d = -h; d < w + h; d += stripe * 2) {
      ctxC.strokeStyle = '#fff';
      ctxC.beginPath(); ctxC.moveTo(d, 0); ctxC.lineTo(d + h, h); ctxC.stroke();
      ctxC.strokeStyle = '#222';
      ctxC.beginPath(); ctxC.moveTo(d + stripe, 0); ctxC.lineTo(d + stripe + h, h); ctxC.stroke();
    }
    ctxC.restore();
  }
  ctxC.strokeStyle = '#C8DCE8';
  ctxC.strokeRect(0, 0, w, h);
}

function buildFreqAxis(axisEl, sampleRate, scale) {
  axisEl.innerHTML = '';
  const minHz = scale === 'log' ? 20 : 0;
  const maxHz = sampleRate / 2;
  const ticks = frequencyTicks(minHz, maxHz, scale);

  for (const hz of ticks) {
    let frac;
    if (scale === 'log') {
      const lo = Math.log10(minHz);
      const hi = Math.log10(maxHz);
      frac = (Math.log10(hz) - lo) / (hi - lo);
    } else {
      frac = (hz - minHz) / (maxHz - minHz);
    }
    const span = el('span', {}, formatHz(hz));
    span.style.top = ((1 - frac) * 100) + '%';
    axisEl.appendChild(span);
  }
}

function buildTimeAxis(axisEl, durationSec) {
  axisEl.innerHTML = '';
  const ticks = timeTicks(durationSec);
  for (const t of ticks) {
    const span = el('span', {}, formatTime(t));
    span.style.left = ((t / durationSec) * 100) + '%';
    axisEl.appendChild(span);
  }
}

// --- Custom player (replaces native <audio>/<video> controls) ---
// --- Spectrogram UI panel (shared for file + recording) ---
export function makeSpectrogramPanel(samples, sampleRate, opts = {}) {
  const card = el('div', { class: 'anr-card anr-spec-card' });

  const [specH, specHelp] = h3help('Spectrogram',
    '<strong>Axis</strong> Log maps frequencies logarithmically (closer to human hearing). Linear spaces them evenly.<br>' +
    '<strong>FFT</strong> Fast Fourier Transform window size. Larger = better frequency resolution but lower time resolution.<br>' +
    '<strong>Window</strong> Windowing function applied before the FFT. Hann is a good default; Blackman reduces spectral leakage; Rect (rectangular) applies no smoothing.<br>' +
    '<strong>Colour</strong> Colour mapping for intensity values. Magma, viridis, and inferno are perceptually uniform.<br>' +
    '<strong>Zoom</strong> Horizontal zoom. Stretches the time axis so you can see finer detail.<br>' +
    '<strong>Height</strong> Vertical size of the spectrogram canvas in pixels.');
  card.appendChild(specH);
  card.appendChild(specHelp);

  // --- controls ---
  const controls = el('div', { class: 'anr-controls' });
  const toggle = el('div', { class: 'anr-toggle' });
  const btnLog = el('button', { type: 'button' }, 'LOG');
  const btnLin = el('button', { type: 'button', class: 'is-active' }, 'LINEAR');
  toggle.appendChild(btnLog); toggle.appendChild(btnLin);

  const fftSel  = el('select', {}, ['256','512','1024','2048','4096','8192'].map((v) => el('option', { value: v }, v)));
  fftSel.value = '2048';
  const winSel  = el('select', {}, ['hann','hamming','blackman','rect'].map((v) => el('option', { value: v }, v)));
  const cmapSel = el('select', {}, Object.keys(colormaps).map((v) => el('option', { value: v }, v)));
  cmapSel.value = 'magma';
  const zoomSel = el('select', {}, ['1','1.5','2','3','4','6','8','12','16'].map((v) => el('option', { value: v }, v + 'x')));
  zoomSel.value = '1';
  const heightSel = el('select', {}, ['240','320','420','560','720','900'].map((v) => el('option', { value: v }, v + 'px')));
  heightSel.value = '320';

  const sIco = (svg) => { const s = el('span', { html: svg, style: 'display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px;' }); return s; };
  const saveBtn = el('button', { type: 'button', class: 'anr-btn' }, [sIco('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1v8M3 6l4 4 4-4"/><path d="M1 11v2h12v-2"/></svg>'), 'Save PNG']);
  const fsBtn   = el('button', { type: 'button', class: 'anr-btn' }, [sIco('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>'), 'Fullscreen']);

  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Axis'),   toggle]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'FFT'),    fftSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Window'), winSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Colour'), cmapSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Zoom'),   zoomSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Height'), heightSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [saveBtn]));
  controls.appendChild(el('div', { class: 'anr-control' }, [fsBtn]));
  card.appendChild(controls);

  // --- spectrogram body ---
  const wrap     = el('div', { class: 'anr-spec-wrap' });
  const yWrap    = el('div', { class: 'anr-spec-yaxis-wrap' });
  const axisY    = el('div', { class: 'anr-spec-yaxis' });
  const corner   = el('div', { class: 'anr-spec-corner' });
  yWrap.appendChild(axisY); yWrap.appendChild(corner);

  const scrollEl = el('div', { class: 'anr-spec-scroll' });
  const canvasWrap = el('div', { class: 'anr-spec-canvas-wrap' });
  const canvas   = el('canvas', { class: 'anr-spec-canvas' });
  const axisX    = el('div', { class: 'anr-spec-xaxis' });
  canvasWrap.appendChild(canvas);

  if (opts.audioEl) {
    const specLine = el('div', { class: 'anr-playhead' });
    canvasWrap.appendChild(specLine);
    const audioDur = () => opts.audioEl.duration || (samples.length / sampleRate);
    function scrollToLine() {
      if (canvas.clientWidth <= scrollEl.clientWidth) return;
      const linePos = canvas.clientWidth * parseFloat(specLine.style.left || '0') / 100;
      const viewLeft = scrollEl.scrollLeft;
      const viewRight = viewLeft + scrollEl.clientWidth;
      if (linePos < viewLeft + 20 || linePos > viewRight - 20)
        scrollEl.scrollLeft = linePos - scrollEl.clientWidth / 3;
    }
    function tickSpec() {
      const d = audioDur();
      const pct = d > 0 ? (opts.audioEl.currentTime / d) * 100 : 0;
      specLine.style.left = pct + '%';
      scrollToLine();
      if (!opts.audioEl.paused) requestAnimationFrame(tickSpec);
    }
    opts.audioEl.addEventListener('play', () => requestAnimationFrame(tickSpec));
    opts.audioEl.addEventListener('pause', tickSpec);
    opts.audioEl.addEventListener('seeked', tickSpec);
    canvas.style.cursor = 'pointer';
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      opts.audioEl.currentTime = frac * audioDur();
    });
    // Grab the playhead line and drag to scrub.
    attachScrub(specLine, (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      opts.audioEl.currentTime = frac * audioDur();
      specLine.style.left = (frac * 100) + '%';
    });
  }

  scrollEl.appendChild(canvasWrap); scrollEl.appendChild(axisX);

  wrap.appendChild(yWrap); wrap.appendChild(scrollEl);
  card.appendChild(wrap);

  if (opts.audioEl) {
    card.appendChild(el('div', { class: 'anr-spec-transport' }, [makePlayer(opts.audioEl)]));
  }

  const status = el('p', { class: 'anr-hint anr-spec-hint', style: 'margin: 6px 0 0; text-align: right;' }, 'computing...');
  card.appendChild(status);

  let state = {
    scale: 'linear', cmap: 'magma', fftSize: 2048, winName: 'hann',
    zoom: 1, height: 320
  };
  let cached = null;

  function isFs() { return document.fullscreenElement === card; }
  function availableWidth() {
    const total = wrap.clientWidth || 600;
    return Math.max(200, total - 44 - 4);
  }
  function availableHeight() {
    return Math.max(160, (wrap.clientHeight || state.height + 22) - 22);
  }
  function sizeCanvas() {
    const baseW = availableWidth();
    const w = Math.max(200, Math.round(baseW * state.zoom));
    const h = isFs() ? availableHeight() : state.height;
    canvas.width  = w;
    canvas.height = h;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    axisX.style.width   = w + 'px';
  }

  function recompute() {
    const t0 = performance.now();
    if (!cached || cached.fftSize !== state.fftSize || cached.winName !== state.winName) {
      const spec = computeSpectrogram(samples, sampleRate, {
        fftSize: state.fftSize,
        hopSize: Math.floor(state.fftSize / 4),
        window:  state.winName
      });
      cached = { fftSize: state.fftSize, winName: state.winName, spec };
    }
    sizeCanvas();
    renderSpectrogram(canvas, cached.spec, { scale: state.scale, colormap: state.cmap });
    const duration = samples.length / sampleRate;
    buildFreqAxis(axisY, sampleRate, state.scale);
    buildTimeAxis(axisX, duration);
    const ms = (performance.now() - t0).toFixed(0);
    status.textContent = `${cached.spec.frames} frames × ${cached.spec.bins} bins | ${canvas.width}×${canvas.height} px | ${ms} ms`;
  }

  btnLog.addEventListener('click', () => {
    state.scale = 'log';
    btnLog.classList.add('is-active'); btnLin.classList.remove('is-active');
    recompute();
  });
  btnLin.addEventListener('click', () => {
    state.scale = 'linear';
    btnLin.classList.add('is-active'); btnLog.classList.remove('is-active');
    recompute();
  });
  fftSel.addEventListener('change',    () => { state.fftSize = parseInt(fftSel.value, 10); recompute(); });
  winSel.addEventListener('change',    () => { state.winName = winSel.value; recompute(); });
  cmapSel.addEventListener('change',   () => { state.cmap    = cmapSel.value; recompute(); });
  zoomSel.addEventListener('change',   () => { state.zoom    = parseFloat(zoomSel.value); recompute(); });
  heightSel.addEventListener('change', () => { state.height  = parseInt(heightSel.value, 10); recompute(); });

  saveBtn.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: (opts.basename || 'spectrogram') + '.png' });
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    }, 'image/png');
  });

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (card.requestFullscreen || card.webkitRequestFullscreen).call(card);
    }
  });
  function onFsChange() {
    fsBtn.textContent = isFs() ? 'Exit fullscreen' : 'Fullscreen';
    requestAnimationFrame(recompute);
  }
  // opts.signal (an AbortSignal) lets the caller tear these document/window
  // listeners down when a new file is analysed, instead of leaking the cached
  // spectrogram data they close over.
  const sig = opts.signal;
  document.addEventListener('fullscreenchange', onFsChange, { signal: sig });
  document.addEventListener('webkitfullscreenchange', onFsChange, { signal: sig });

  let resizeRaf;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const newW = Math.max(200, Math.round(availableWidth() * state.zoom));
      if (Math.abs(newW - canvas.width) > 2 || isFs()) recompute();
    });
  }, { signal: sig });

  // Defer until in DOM so clientWidth is real
  setTimeout(recompute, 0);
  setTimeout(recompute, 80);

  return card;
}

function buildCoverArtCard(art, file) {
  const blob = new Blob([art.bytes], { type: art.mime });
  const url = URL.createObjectURL(blob);
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Embedded cover art'));

  const img = el('img', { src: url, class: 'anr-coverart', alt: 'Embedded cover art' });
  card.appendChild(img);

  const tbl = el('table', { class: 'anr-readout' });
  const dimRow = row('Dimensions', '…');
  tbl.appendChild(dimRow);
  tbl.appendChild(row('Type', art.mime));
  tbl.appendChild(row('Size', fmtBytes(art.bytes.length)));
  card.appendChild(tbl);
  img.addEventListener('load', () => {
    if (img.naturalWidth) dimRow.querySelector('td').textContent = img.naturalWidth + ' × ' + img.naturalHeight;
  });

  const ext = art.mime === 'image/png' ? 'png' : art.mime === 'image/bmp' ? 'bmp' : 'jpg';
  const base = (file.name || 'cover').replace(/\.[^.]+$/, '') || 'cover';
  const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
    const artFile = new File([art.bytes], base + '-cover.' + ext, { type: art.mime });
    if (window._anrHandleFile) window._anrHandleFile(artFile);
  } }, 'Analyse as photo');
  card.appendChild(analyseBtn);

  return card;
}

function buildWaveformCard(file, mono, audioBuffer, audioEl) {
  const waveCard = el('div', { class: 'anr-card' });
  const [waveH, waveHelp] = h3help('Waveform', 'Amplitude over time. Click and drag to select a region, then zoom in or export the selection as a WAV file. The white playhead line shows the current playback position.');
  waveCard.appendChild(waveH); waveCard.appendChild(waveHelp);
  const waveCanvas = el('canvas', { class: 'anr-waveform' });
  waveCanvas.width = 1024; waveCanvas.height = 80;
  waveCard.appendChild(waveCanvas);
  renderWaveform(waveCanvas, mono);

  // --- Interactive waveform: region selection, zoom, WAV export ---
  let selStart = null, selEnd = null;
  let isSelecting = false;
  let zoomStart = 0, zoomEnd = mono.length;

  // Overlay canvas for selection highlight
  const overlayCanvas = el('canvas', { class: 'anr-waveform anr-wave-overlay' });
  overlayCanvas.width = waveCanvas.width;
  overlayCanvas.height = waveCanvas.height;

  const waveWrap = el('div', { class: 'anr-wave-wrap' });
  waveCard.replaceChild(waveWrap, waveCanvas);
  waveWrap.appendChild(waveCanvas);
  waveWrap.appendChild(overlayCanvas);

  // Waveform playhead synced with audio
  const waveLine = el('div', { class: 'anr-playhead' });
  waveWrap.appendChild(waveLine);
  function tickWaveLine() {
    const d = audioBuffer.duration;
    const currentSample = (audioEl.currentTime / d) * mono.length;
    const visLen = zoomEnd - zoomStart;
    const pct = ((currentSample - zoomStart) / visLen) * 100;
    if (pct >= 0 && pct <= 100) {
      waveLine.style.left = pct + '%';
      waveLine.hidden = false;
    } else {
      waveLine.hidden = true;
    }
    if (!audioEl.paused) requestAnimationFrame(tickWaveLine);
  }
  audioEl.addEventListener('play', () => requestAnimationFrame(tickWaveLine));
  audioEl.addEventListener('pause', tickWaveLine);
  audioEl.addEventListener('seeked', tickWaveLine);

  // Grab the playhead line and drag to scrub (respects the current zoom window).
  attachScrub(waveLine, (clientX) => {
    const rect = waveCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const sample = zoomStart + frac * (zoomEnd - zoomStart);
    audioEl.currentTime = (sample / mono.length) * audioBuffer.duration;
    tickWaveLine();
  });

  // Selection info + buttons container (shown when selection exists)
  const selInfo = el('div', { class: 'anr-controls anr-sel-controls is-hidden' });
  const selLabel = el('span', { class: 'anr-sel-label' }, '');
  const zoomBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Zoom');
  const resetZoomBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm is-hidden' }, 'Reset zoom');
  const exportBtn = el('button', { type: 'button', class: 'anr-btn anr-btn-sm' }, 'Export WAV');
  selInfo.appendChild(selLabel);
  selInfo.appendChild(zoomBtn);
  selInfo.appendChild(resetZoomBtn);
  selInfo.appendChild(exportBtn);
  waveCard.appendChild(selInfo);

  function drawOverlay() {
    const octx = overlayCanvas.getContext('2d');
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (selStart == null || selEnd == null) return;
    const visLen = zoomEnd - zoomStart;
    const x1 = ((Math.min(selStart, selEnd) - zoomStart) / visLen) * overlayCanvas.width;
    const x2 = ((Math.max(selStart, selEnd) - zoomStart) / visLen) * overlayCanvas.width;
    octx.fillStyle = 'rgba(100, 180, 255, 0.3)';
    octx.fillRect(x1, 0, x2 - x1, overlayCanvas.height);
    octx.strokeStyle = 'rgba(100, 180, 255, 0.7)';
    octx.lineWidth = 1;
    octx.strokeRect(x1, 0, x2 - x1, overlayCanvas.height);
  }

  function updateSelInfo() {
    if (selStart == null || selEnd == null || selStart === selEnd) {
      selInfo.classList.add('is-hidden');
      return;
    }
    selInfo.classList.remove('is-hidden');
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    const selSamples = mono.subarray(s, e);
    const dur = (e - s) / audioBuffer.sampleRate;
    const selStats = computeStats(selSamples);
    selLabel.textContent = 'Selection: ' + dur.toFixed(3) + ' s, '
      + (e - s).toLocaleString() + ' samples | Peak: '
      + selStats.peak.toFixed(3) + ' (' + selStats.peakDb.toFixed(1) + ' dBFS) | RMS: '
      + selStats.rms.toFixed(3) + ' (' + selStats.rmsDb.toFixed(1) + ' dBFS)';
  }

  function xToSample(x) {
    const rect = waveCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    const visLen = zoomEnd - zoomStart;
    return Math.round(zoomStart + frac * visLen);
  }

  // Finish a selection on release; the window listener is added on mousedown
  // and removed here so it doesn't persist across files.
  function onSelectMouseUp() {
    window.removeEventListener('mouseup', onSelectMouseUp);
    if (!isSelecting) return;
    isSelecting = false;
    if (selStart != null && selEnd != null && selStart !== selEnd) {
      // Normalize order
      if (selStart > selEnd) { const tmp = selStart; selStart = selEnd; selEnd = tmp; }
      updateSelInfo();
    }
    drawOverlay();
  }

  waveCanvas.style.cursor = 'crosshair';
  waveCanvas.addEventListener('mousedown', (e) => {
    isSelecting = true;
    selStart = xToSample(e.clientX);
    selEnd = selStart;
    drawOverlay();
    updateSelInfo();
    e.preventDefault();
    window.addEventListener('mouseup', onSelectMouseUp);
  });

  waveCanvas.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    selEnd = xToSample(e.clientX);
    drawOverlay();
  });

  function redrawWaveform() {
    const visibleSamples = mono.subarray(zoomStart, zoomEnd);
    renderWaveform(waveCanvas, visibleSamples);
    overlayCanvas.width = waveCanvas.width;
    overlayCanvas.height = waveCanvas.height;
    drawOverlay();
  }

  zoomBtn.addEventListener('click', () => {
    if (selStart == null || selEnd == null || selStart === selEnd) return;
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    zoomStart = s;
    zoomEnd = e;
    selStart = null;
    selEnd = null;
    redrawWaveform();
    updateSelInfo();
    resetZoomBtn.classList.remove('is-hidden');
  });

  resetZoomBtn.addEventListener('click', () => {
    zoomStart = 0;
    zoomEnd = mono.length;
    selStart = null;
    selEnd = null;
    redrawWaveform();
    updateSelInfo();
    resetZoomBtn.classList.add('is-hidden');
  });

  exportBtn.addEventListener('click', () => {
    if (selStart == null || selEnd == null || selStart === selEnd) return;
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    const selSamples = mono.subarray(s, e);
    const numSamples = selSamples.length;
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = audioBuffer.sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const bufferSize = 44 + dataSize;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // RIFF header
    let offset = 0;
    const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)); };
    writeStr('RIFF');
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeStr('WAVE');

    // fmt chunk
    writeStr('fmt ');
    view.setUint32(offset, 16, true); offset += 4;          // chunk size
    view.setUint16(offset, 1, true); offset += 2;           // PCM format
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, audioBuffer.sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitsPerSample, true); offset += 2;

    // data chunk
    writeStr('data');
    view.setUint32(offset, dataSize, true); offset += 4;

    // Convert Float32 to Int16
    for (let i = 0; i < numSamples; i++) {
      let sample = selSamples[i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: (file.name || 'selection').replace(/\.[^.]+$/, '') + '_selection.wav' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  });
  return waveCard;
}

// --- Amplitude histogram card (shared by the audio + video modules) ---
export function buildHistogramCard(samples) {
  const histCard = el('div', { class: 'anr-card' });
  const [ahH, ahHelp] = h3help('Histogram',
    'Amplitude distribution - how often each sample value occurs across the whole clip. ' +
    'The horizontal axis is amplitude from −1 to +1 (0 = silence, marked by the red line; ' +
    '±1 = full scale). The vertical axis is the relative number of samples at each amplitude. ' +
    'A tall spike at the centre means lots of quiet; energy spread toward the edges means a loud, dynamic signal.');
  histCard.appendChild(ahH); histCard.appendChild(ahHelp);
  const histCanvas = el('canvas', { class: 'anr-histogram' });
  histCanvas.width = 1024; histCanvas.height = 100;
  histCard.appendChild(histCanvas);

  const bins = 256;
  const counts = new Uint32Array(bins);
  for (let i = 0; i < samples.length; i++) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((samples[i] + 1) * 0.5 * bins)));
    counts[idx]++;
  }
  let maxCount = 0;
  for (let i = 0; i < bins; i++) if (counts[i] > maxCount) maxCount = counts[i];
  const hctx = histCanvas.getContext('2d');
  const cw = histCanvas.width, ch = histCanvas.height;
  hctx.fillStyle = '#0a0a0a';
  hctx.fillRect(0, 0, cw, ch);
  const barW = cw / bins;
  for (let i = 0; i < bins; i++) {
    const h = maxCount > 0 ? (counts[i] / maxCount) * ch : 0;
    const t = i / bins;
    const g = Math.round(180 + t * 75);
    hctx.fillStyle = `rgb(${g},${g},${g})`;
    hctx.fillRect(i * barW, ch - h, barW, h);
  }
  hctx.strokeStyle = '#e60023';
  hctx.lineWidth = 1;
  const center = Math.floor(bins / 2) * barW;
  hctx.beginPath();
  hctx.moveTo(center, 0);
  hctx.lineTo(center, ch);
  hctx.stroke();

  // Axis markings: amplitude ticks under the canvas + a units caption.
  histCard.appendChild(el('div', { class: 'anr-hist-axis' }, [
    el('span', {}, '−1.0'), el('span', {}, '−0.5'), el('span', {}, '0'),
    el('span', {}, '+0.5'), el('span', {}, '+1.0')
  ]));
  histCard.appendChild(el('p', { class: 'anr-hist-caption' },
    'Amplitude (0 = silence)  ·  height = relative sample count'));
  return histCard;
}

// Tears down the previous render's persistent spectrogram listeners when a new
// audio file is analysed.
let audioRenderAbort = null;

// --- Render uploaded / recorded audio results ---
export async function renderAudio(file, resultsEl, opts = {}) {
  if (audioRenderAbort) audioRenderAbort.abort();
  audioRenderAbort = new AbortController();
  const renderSignal = audioRenderAbort.signal;

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Decoding "${file.name}"...`));


  let header = {};
  try { header = await peekContainer(file); } catch (e) { /* ignore */ }

  let playbackFile = file;
  let audioBuffer;

  if (header.container === 'AAC') {
    try {
      const wrapped = adtsToM4a(await file.arrayBuffer());
      if (wrapped) {
        playbackFile = new File([wrapped], file.name.replace(/\.[^.]+$/, '.m4a'), { type: 'audio/mp4' });
        audioBuffer = await ctx().decodeAudioData(wrapped.slice(0));
      }
    } catch (_) {}
  }

  if (!audioBuffer) {
    try {
      audioBuffer = await decodeFile(file);
    } catch (e) {
      resultsEl.innerHTML = '';
      resultsEl.appendChild(errorCard('Could not decode this file. Format may not be supported by your browser.'));
      return;
    }
  }

  resultsEl.innerHTML = '';

  const mono = getMono(audioBuffer);
  const stats = computeStats(mono);

  // ---- File info card ----
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const audioUrl = URL.createObjectURL(playbackFile);
  const audioEl = el('audio', { src: audioUrl, class: 'is-hidden' });
  infoCard.appendChild(audioEl);
  infoCard.appendChild(makePlayer(audioEl));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name',           file.name));
  tbl.appendChild(row('Size',           fmtBytes(file.size)));
  tbl.appendChild(row('MIME',           file.type || header.container || '-'));
  if (header.container) tbl.appendChild(row('Container',     header.container));
  if (header.codec)     tbl.appendChild(row('Codec',         header.codec));
  tbl.appendChild(row('Duration',       formatTime(audioBuffer.duration)));
  tbl.appendChild(rowHelp('Sample rate',    audioBuffer.sampleRate.toLocaleString() + ' Hz',
    'Audio samples per second, in hertz. Higher rates capture higher frequencies - CD audio is 44,100 Hz, video audio is often 48,000 Hz.'));
  tbl.appendChild(row('Channels',       audioBuffer.numberOfChannels + describeChannels(audioBuffer.numberOfChannels)));
  if (header.bitDepth)  tbl.appendChild(rowHelp('Bit depth',     header.bitDepth + ' bit',
    'Bits used to store each audio sample. More bits give greater dynamic range and lower quantization noise - CD audio is 16-bit.'));
  if (header.bitrate)   tbl.appendChild(rowHelp('Bitrate',       (header.bitrate / 1000).toFixed(0) + ' kbps',
    'Compressed data rate in kilobits per second for lossy formats. Higher generally means better quality and a larger file.'));
  tbl.appendChild(rowHelp('Peak', stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)',
    'Highest sample amplitude in the file. dBFS = decibels relative to full scale, where 0 dBFS is the digital maximum.'));
  tbl.appendChild(rowHelp('RMS', stats.rms.toFixed(3)  + '  (' + stats.rmsDb.toFixed(1)  + ' dBFS)',
    'Root Mean Square - average signal power, closer to perceived loudness than peak. Typical mastered music sits around −10 dBFS.'));
  const lufsValue = computeLufs(mono, audioBuffer.sampleRate);
  tbl.appendChild(rowHelp('Loudness', (isFinite(lufsValue) ? lufsValue.toFixed(1) + ' LUFS' : '-'),
    'Perceived loudness per ITU-R BS.1770. Accounts for human hearing sensitivity. Streaming targets: Spotify −14, YouTube −14, Apple −16 LUFS.'));
  if (stats.clipped > 0) {
    const pct = ((stats.clipped / mono.length) * 100).toFixed(3);
    tbl.appendChild(rowHelp('Clipping', stats.clipped.toLocaleString() + ' samples  (' + pct + '%)',
      'Samples at or beyond the digital ceiling (0 dBFS). Causes audible distortion. More clipped samples = harsher artifacts.'));
  } else {
    tbl.appendChild(rowHelp('Clipping', 'None',
      'Samples at or beyond the digital ceiling (0 dBFS). None detected in this file.'));
  }
  const centroid = computeCentroid(mono, audioBuffer.sampleRate);
  if (centroid != null) {
    const label = centroid < 1500 ? 'warm' : centroid < 4000 ? 'neutral' : 'bright';
    tbl.appendChild(rowHelp('Spectral centroid', Math.round(centroid).toLocaleString() + ' Hz  (' + label + ')',
      'Frequency "center of mass" of the spectrum. Below 1500 Hz sounds warm/dark, above 4000 Hz sounds bright/sharp. Useful for comparing tonal character.'));
  }
  const pitchResult = detectPitch(mono, audioBuffer.sampleRate);
  if (pitchResult) {
    const centsStr = pitchResult.cents >= 0 ? '+' + pitchResult.cents : String(pitchResult.cents);
    tbl.appendChild(rowHelp('Pitch', pitchResult.note + '  (' + pitchResult.frequency.toFixed(1) + ' Hz, ' + centsStr + ' cents)',
      'Fundamental frequency via autocorrelation. Cents = deviation from the nearest note (±50 cents = half a semitone).'));
  } else {
    tbl.appendChild(rowHelp('Pitch', 'N/A',
      'Fundamental frequency via autocorrelation. Could not detect a clear pitch in this audio.'));
  }
  const tagBpm = await readTagBPM(file).catch(() => null);
  const estBpm = detectBPM(mono, audioBuffer.sampleRate);
  const bpmVal = tagBpm || estBpm;
  const bpmIsTag = tagBpm != null;
  const bpmRow = rowHelp('BPM', bpmVal != null ? bpmVal + ' BPM' : 'N/A',
    bpmIsTag ? 'Beats per minute read from file metadata.'
             : 'Beats per minute via onset envelope analysis. Most reliable on rhythmic material with a clear beat.');
  if (bpmVal != null && !bpmIsTag) {
    const td = bpmRow.querySelector('td');
    td.appendChild(el('span', { style: 'font-size:0.8em;color:var(--muted);margin-left:4px' }, '(est)'));
  }
  tbl.appendChild(bpmRow);
  tbl.appendChild(rowHelp('Total samples',  mono.length.toLocaleString(),
    'Total number of individual amplitude values in the (channel-merged mono) signal - roughly sample rate × duration.'));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // ---- Embedded cover art (filled in asynchronously so it doesn't block) ----
  const coverSlot = el('div');
  resultsEl.appendChild(coverSlot);
  extractCoverArt(file).then((art) => {
    if (art && art.bytes && art.bytes.length) coverSlot.appendChild(buildCoverArtCard(art, file));
  }).catch(() => {});

  // ---- Waveform card ----
  resultsEl.appendChild(buildWaveformCard(file, mono, audioBuffer, audioEl));

  // ---- Amplitude histogram ----
  resultsEl.appendChild(buildHistogramCard(mono));

  // ---- Spectrogram ----
  const basename = (file.name || 'spectrogram').replace(/\.[^/.]+$/, '');
  resultsEl.appendChild(makeSpectrogramPanel(mono, audioBuffer.sampleRate, { basename, audioEl, signal: renderSignal }));

  // ---- Stereo Width / Vectorscope card (stereo files only) ----
  if (audioBuffer.numberOfChannels >= 2) {
    const left  = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const stereo = computeStereoStats(left, right);

    const stereoCard = el('div', { class: 'anr-card' });
    const [stH, stHelp] = h3help('Stereo analysis', '<strong>Phase correlation</strong> measures how similar the left and right channels are. +1 = identical (mono), 0 = unrelated, negative = out of phase (can cause cancellation on mono speakers).<br><strong>Stereo width</strong> is derived from correlation. Higher = wider stereo image.<br><strong>Mid/Side</strong> splits the signal into centre (mid) and difference (side) components.<br>The <strong>vectorscope</strong> plots left vs right samples. A vertical line = mono; a circle = wide stereo; a horizontal line = out of phase.');
    stereoCard.appendChild(stH); stereoCard.appendChild(stHelp);

    const stereoTbl = el('table', { class: 'anr-readout' });
    const corrPct  = (stereo.correlation * 100).toFixed(1);
    const corrHint = stereo.correlation > 0.8 ? 'mono-like'
                   : stereo.correlation < -0.2 ? 'out of phase'
                   : stereo.correlation < 0.3 ? 'wide' : 'normal';
    stereoTbl.appendChild(rowHelp('Phase correlation', stereo.correlation.toFixed(3) + '  (' + corrPct + '%, ' + corrHint + ')',
      'Left/right channel similarity. +1 = identical (mono), 0 = unrelated, negative = out of phase (problematic on mono speakers).'));
    stereoTbl.appendChild(rowHelp('Stereo width', stereo.width.toFixed(3),
      'Spatial separation between channels. 0 = mono, 1 = maximum stereo spread.'));
    stereoTbl.appendChild(rowHelp('Mid level', stereo.midLevel.toFixed(4),
      'Center (mono) component: (L+R)/2. Carries vocals, bass, and center-panned elements.'));
    stereoTbl.appendChild(rowHelp('Side level', stereo.sideLevel.toFixed(4),
      'Difference (stereo) component: (L−R)/2. Carries reverb, panned instruments, and spatial content.'));
    const msRatio = stereo.midLevel > 1e-12
      ? (stereo.sideLevel / stereo.midLevel).toFixed(3)
      : '-';
    stereoTbl.appendChild(rowHelp('Side / Mid ratio', msRatio,
      'Ratio of side to mid energy. Below 0.5 = center-heavy mix, above 1.0 = very wide/spatial mix.'));
    stereoCard.appendChild(stereoTbl);

    // Vectorscope canvas
    const vsCanvas = el('canvas', { width: '200', height: '200', style: 'display:block; margin:8px auto 0;' });
    stereoCard.appendChild(vsCanvas);
    renderVectorscope(vsCanvas, left, right);

    resultsEl.appendChild(stereoCard);
  }
}

// --- Recording UI ---
async function startRecording(resultsEl, recordBtn) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Microphone access denied or unavailable.'));
    return;
  }

  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  const liveCard = el('div', { class: 'anr-card' });
  liveCard.appendChild(el('h3', {}, 'Recording...'));
  const timer = el('p', { class: 'anr-hint' }, '0.0 s');
  const stopBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Stop');
  liveCard.appendChild(timer);
  liveCard.appendChild(stopBtn);
  resultsEl.appendChild(liveCard);

  const startMs = performance.now();
  const tick = setInterval(() => {
    timer.textContent = ((performance.now() - startMs) / 1000).toFixed(1) + ' s';
  }, 100);

  rec.start();
  recordBtn.classList.add('is-recording');

  return new Promise((resolve) => {
    function finish() {
      clearInterval(tick);
      recordBtn.classList.remove('is-recording');
      stream.getTracks().forEach((t) => t.stop());
    }
    rec.onstop = async () => {
      finish();
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      const ext = (mime.match(/audio\/(\w+)/) || [, 'webm'])[1];
      const file = new File([blob], 'recording.' + ext, { type: blob.type });
      await renderAudio(file, resultsEl);
      resolve(file);
    };
    stopBtn.addEventListener('click', () => rec.stop());
  });
}

// --- Live spectrogram (no recording, just visualise the mic) ---
async function startLive(resultsEl, liveBtn) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(errorCard('Microphone access denied or unavailable.'));
    return;
  }

  const ac = ctx();
  await ac.resume();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';


  // --- card / controls ---
  const card = el('div', { class: 'anr-card anr-spec-card' });
  card.appendChild(el('h3', {}, 'Live spectrogram'));

  const controls = el('div', { class: 'anr-controls' });
  const toggle = el('div', { class: 'anr-toggle' });
  const btnLog = el('button', { type: 'button' }, 'LOG');
  const btnLin = el('button', { type: 'button', class: 'is-active' }, 'LINEAR');
  toggle.appendChild(btnLog); toggle.appendChild(btnLin);

  const fftSel    = el('select', {}, ['512','1024','2048','4096','8192'].map((v) => el('option', { value: v }, v)));
  fftSel.value = '2048';
  const cmapSel   = el('select', {}, Object.keys(colormaps).map((v) => el('option', { value: v }, v)));
  cmapSel.value = 'magma';
  const heightSel = el('select', {}, ['240','320','420','560','720','900'].map((v) => el('option', { value: v }, v + 'px')));
  heightSel.value = '320';
  const speedSel  = el('select', {}, [['0.5','Slowest'],['1','Slow'],['2','Normal'],['3','Fast'],['4','Faster'],['6','Fastest']].map(([v,l]) => el('option', { value: v }, l)));
  speedSel.value = '1';
  const ico = (svg) => { const s = el('span', { html: svg, style: 'display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px;' }); return s; };
  const saveBtn   = el('button', { type: 'button', class: 'anr-btn' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1v8M3 6l4 4 4-4"/><path d="M1 11v2h12v-2"/></svg>'), 'Save PNG']);
  const fsBtn     = el('button', { type: 'button', class: 'anr-btn' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/></svg>'), 'Fullscreen']);
  const recBtn    = el('button', { type: 'button', class: 'anr-btn' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg>'), 'Record']);
  const pauseBtn  = el('button', { type: 'button', class: 'anr-btn' }, [ico('<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12"/><rect x="8.5" y="1" width="3.5" height="12"/></svg>'), 'Pause']);

  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Axis'),   toggle]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'FFT'),    fftSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Colour'), cmapSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Height'), heightSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Speed'),  speedSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [saveBtn]));
  controls.appendChild(el('div', { class: 'anr-control' }, [fsBtn]));
  controls.appendChild(el('div', { class: 'anr-control' }, [recBtn]));
  controls.appendChild(el('div', { class: 'anr-control' }, [pauseBtn]));
  card.appendChild(controls);

  // --- body (yaxis + scroll/canvas), no x-axis (no fixed time in live mode) ---
  const wrap     = el('div', { class: 'anr-spec-wrap' });
  const yWrap    = el('div', { class: 'anr-spec-yaxis-wrap' });
  const axisY    = el('div', { class: 'anr-spec-yaxis' });
  yWrap.appendChild(axisY);
  const scrollEl = el('div', { class: 'anr-spec-scroll' });
  const canvas   = el('canvas', { class: 'anr-spec-canvas' });
  scrollEl.appendChild(canvas);
  wrap.appendChild(yWrap); wrap.appendChild(scrollEl);
  card.appendChild(wrap);
  resultsEl.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let state = { scale: 'linear', cmap: 'magma', height: 320 };

  function isFs() { return document.fullscreenElement === card; }
  function availableWidth()  { return Math.max(200, (wrap.clientWidth || 600) - 48); }
  function availableHeight() { return Math.max(160, (wrap.clientHeight || state.height) - 2); }

  const ctxC = canvas.getContext('2d');

  // Resizing the canvas wipes its bitmap, which would lose the streaming
  // history in live mode. `preserve` snapshots the old contents into a temp
  // canvas, then redraws the rightmost slice (most recent audio) anchored
  // to the right edge of the new size - so the stream visually continues
  // instead of restarting from black.
  function sizeCanvas(preserve = true) {
    const newW = availableWidth();
    const newH = isFs() ? availableHeight() : state.height;
    if (newW === canvas.width && newH === canvas.height) return;

    if (preserve && canvas.width && canvas.height) {
      // Copy old content into a temp canvas, then redraw scaled-or-cropped
      const tmp = document.createElement('canvas');
      tmp.width  = canvas.width;
      tmp.height = canvas.height;
      tmp.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width  = newW;
      canvas.height = newH;
      canvas.style.width  = newW + 'px';
      canvas.style.height = newH + 'px';
      ctxC.fillStyle = '#0a0a0a';
      ctxC.fillRect(0, 0, newW, newH);
      // Keep the rightmost portion at the right edge (visual continuity)
      const drawW = Math.min(tmp.width, newW);
      const drawH = Math.min(tmp.height, newH);
      ctxC.drawImage(tmp,
        tmp.width - drawW, tmp.height - drawH, drawW, drawH,
        newW - drawW,      newH - drawH,      drawW, drawH);
    } else {
      canvas.width  = newW;
      canvas.height = newH;
      canvas.style.width  = newW + 'px';
      canvas.style.height = newH + 'px';
      ctxC.fillStyle = '#0a0a0a';
      ctxC.fillRect(0, 0, newW, newH);
    }
  }

  function rebuildAxis() { buildFreqAxis(axisY, ac.sampleRate, state.scale); }

  sizeCanvas(false);
  rebuildAxis();

  btnLog.addEventListener('click', () => { state.scale = 'log';    btnLog.classList.add('is-active'); btnLin.classList.remove('is-active'); rebuildAxis(); });
  btnLin.addEventListener('click', () => { state.scale = 'linear'; btnLin.classList.add('is-active'); btnLog.classList.remove('is-active'); rebuildAxis(); });
  fftSel.addEventListener('change',    () => { analyser.fftSize = parseInt(fftSel.value, 10); });
  cmapSel.addEventListener('change',   () => { state.cmap = cmapSel.value; });
  heightSel.addEventListener('change', () => { state.height = parseInt(heightSel.value, 10); sizeCanvas(); });

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (card.requestFullscreen || card.webkitRequestFullscreen).call(card);
    }
  });
  function onFsChange() {
    fsBtn.textContent = isFs() ? 'Exit fullscreen' : 'Fullscreen';
    requestAnimationFrame(() => sizeCanvas());
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  let liveRaf;
  function onWinResize() {
    cancelAnimationFrame(liveRaf);
    liveRaf = requestAnimationFrame(() => sizeCanvas());
  }
  window.addEventListener('resize', onWinResize);

  let dbData = new Float32Array(analyser.frequencyBinCount);
  let colW = 1;
  let colAccum = 0;
  let stopped = false;
  let paused = false;
  liveBtn.classList.add('is-active');
  speedSel.addEventListener('change', () => { colW = parseFloat(speedSel.value); });

  function tick() {
    if (stopped) return;
    if (paused) return requestAnimationFrame(tick);
    const bins = analyser.frequencyBinCount;
    if (dbData.length !== bins) dbData = new Float32Array(bins);
    analyser.getFloatFrequencyData(dbData);

    colAccum += colW;
    const drawW = Math.floor(colAccum);
    if (drawW < 1) return requestAnimationFrame(tick);
    colAccum -= drawW;

    const w = canvas.width, h = canvas.height;
    if (w <= drawW || h <= 0) return requestAnimationFrame(tick);

    const img = ctxC.getImageData(drawW, 0, w - drawW, h);
    ctxC.putImageData(img, 0, 0);
    ctxC.fillStyle = '#0a0a0a';
    ctxC.fillRect(w - drawW, 0, drawW, h);

    const cmap = colormaps[state.cmap] || colormaps.viridis;
    const nyq = ac.sampleRate / 2;
    const dbFloor = -100, dbCeil = -10;
    const range = dbCeil - dbFloor;
    const colImg = ctxC.createImageData(drawW, h);

    for (let y = 0; y < h; y++) {
      let binF;
      if (state.scale === 'log') {
        const logMin = Math.log10(20);
        const logMax = Math.log10(nyq);
        const frac = 1 - y / (h - 1);
        const hz = Math.pow(10, logMin + frac * (logMax - logMin));
        binF = (hz / nyq) * bins;
      } else {
        const frac = 1 - y / (h - 1);
        binF = frac * bins;
      }
      const b0 = Math.max(0, Math.min(bins - 1, Math.floor(binF)));
      const b1 = Math.max(0, Math.min(bins - 1, b0 + 1));
      const k  = binF - b0;
      const db = dbData[b0] + (dbData[b1] - dbData[b0]) * k;
      let t = (db - dbFloor) / range;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const [r, g, bl] = cmap(t);
      for (let x = 0; x < drawW; x++) {
        const o = (y * drawW + x) * 4;
        colImg.data[o]     = r;
        colImg.data[o + 1] = g;
        colImg.data[o + 2] = bl;
        colImg.data[o + 3] = 255;
      }
    }
    ctxC.putImageData(colImg, w - drawW, 0);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  saveBtn.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'live-spectrogram.png' });
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    }, 'image/png');
  });

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    const pauseIco = paused
      ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><polygon points="2,1 13,7 2,13"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12"/><rect x="8.5" y="1" width="3.5" height="12"/></svg>';
    pauseBtn.innerHTML = '<span style="display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px;">' + pauseIco + '</span>' + (paused ? 'Resume' : 'Pause');
  });

  let liveRec = null;
  recBtn.addEventListener('click', () => {
    if (liveRec) {
      liveRec.stop();
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
      .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    liveRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    liveRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    liveRec.onstop = async () => {
      recBtn.classList.remove('is-recording');
      recBtn.innerHTML = '<span style="display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" fill="currentColor"/></svg></span>Record';
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      const ext = (mime.match(/audio\/(\w+)/) || [, 'webm'])[1];
      const file = new File([blob], 'recording.' + ext, { type: blob.type });
      liveRec = null;
      stopped = true;
      liveBtn.classList.remove('is-active');
      stream.getTracks().forEach((t) => t.stop());
      try { src.disconnect(); } catch (_) {}
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      window.removeEventListener('resize', onWinResize);
      await renderAudio(file, resultsEl);
    };
    liveRec.start();
    recBtn.classList.add('is-recording');
    recBtn.innerHTML = '<span style="display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px;"><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="10" height="10"/></svg></span>Stop rec';
  });

  function closeLive() {
    if (stopped) return;
    stopped = true;
    liveBtn.classList.remove('is-active');
    stream.getTracks().forEach((t) => t.stop());
    try { src.disconnect(); } catch (_) {}
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    window.removeEventListener('resize', onWinResize);
    liveBtn.removeEventListener('click', closeLive);
    if (document.fullscreenElement === card) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
    card.remove();
    if (!resultsEl.children.length) resultsEl.hidden = true;
  }
  liveBtn.addEventListener('click', closeLive);
}

// --- Setup ---
export function initAudio({ dropEl, inputEl, recordBtn, liveBtn, resultsEl, onFile }) {
  const handle = onFile || ((file) => renderAudio(file, resultsEl));

  inputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handle(file);
    inputEl.value = '';
  });

  // Visual highlight only; the actual drop is handled at the window level
  ['dragenter', 'dragover'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.add('is-dragover'))
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.remove('is-dragover'))
  );

  recordBtn.addEventListener('click', () => {
    if (recordBtn.classList.contains('is-recording')) return;
    startRecording(resultsEl, recordBtn);
  });

  liveBtn.addEventListener('click', () => {
    if (liveBtn.classList.contains('is-active')) return;
    startLive(resultsEl, liveBtn);
  });
}
