/* Analyser - video module
   Handles video files: playback, container/codec detection, frame rate,
   frame capture (routed to photo analysis), audio track extraction
   (waveform + spectrogram via audio module). */

import { makeSpectrogramPanel, makePlayer, buildHistogramCard, buildWaveformCard } from './audio.js';
import { renderPhoto, revealPhotoSection, openLightbox } from './photo.js';
import { el, row, rowHelp, fmtBytes, h3help, sha256Row, integrityCard, roundFps, asciiBar } from '../core/util.js';
import { parseAviHeader, extractAviData, encodeWav } from './video-avi.js';
import { buildReverseAudioCard } from './media-reverse.js';

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

// A generated contact-sheet image. Click opens it full-size in the shared
// lightbox (no photo tools - it's a thumbnail grid, not a single photo).
function sheetImg(dataUrl) {
  return el('img', {
    src: dataUrl,
    alt: 'Contact sheet',
    style: 'max-width:100%; margin-top:10px; border:1px solid var(--hairline); display:block; cursor:zoom-in;',
    onclick: () => openLightbox(dataUrl, 'Contact sheet', 'Contact sheet', null, false, false)
  });
}

// Smooth-scroll to the photo section. Called after the user explicitly clicks an
// "Analyse frame" button (not on the silent auto-analysis of the first frame).
function scrollToPhoto() {
  const sec = document.getElementById('photo');
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// The frame controls shown under a video player: an editable, button-styled
// timecode (click to set hours/minutes/seconds/frame individually and seek
// there) on top, then a 2×2 grid of Prev/Next frame and Analyse/Frame-grab.
// "Analyse frame" sends the current frame to the photo section; "Frame grab"
// downloads it as a PNG. `getFps` returns the current detected frame rate (it may
// update asynchronously). Returns { wrap, refresh }; call refresh() when fps
// becomes known so the frame field of the timecode is accurate.
function buildFrameControls(playerEl, getFps, file) {
  const fps = () => { const f = getFps(); return (f && isFinite(f) && f > 0) ? f : 30; };
  const pad = (n) => String(n).padStart(2, '0');
  function parts(t) {
    const rf = Math.round(fps());
    const ts = Math.floor(t);
    let f = Math.floor((t - ts) * fps() + 1e-6);
    if (f >= rf) f = rf - 1;
    return { h: Math.floor(ts / 3600), m: Math.floor((ts % 3600) / 60), s: ts % 60, f };
  }

  const label = el('span', { class: 'anr-timecode-label' }, 'TIMECODE');
  const display = el('span', { class: 'anr-timecode-value' }, '00:00:00:00');
  const mkSeg = () => el('input', { class: 'anr-tc-seg', type: 'text', inputmode: 'numeric', maxlength: '2', spellcheck: 'false', autocomplete: 'off' });
  const sH = mkSeg(), sM = mkSeg(), sS = mkSeg(), sF = mkSeg();
  const sep = () => el('span', { class: 'anr-tc-sep' }, ':');
  const editWrap = el('span', { class: 'anr-timecode-edit', style: 'display:none;' }, [sH, sep(), sM, sep(), sS, sep(), sF]);
  const hint = el('span', { class: 'anr-timecode-hint', style: 'display:none;' }, 'hour : min : sec : frame');
  const tc = el('div', { class: 'anr-timecode', role: 'button', tabindex: '0', title: 'Click to edit - set hours, minutes, seconds and frame' }, [label, display, editWrap, hint]);

  let editing = false;
  function refresh() { if (editing) return; const p = parts(playerEl.currentTime); display.textContent = `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}:${pad(p.f)}`; }
  function enterEdit() {
    editing = true; playerEl.pause();
    const p = parts(playerEl.currentTime);
    sH.value = pad(p.h); sM.value = pad(p.m); sS.value = pad(p.s); sF.value = pad(p.f);
    display.style.display = 'none'; editWrap.style.display = ''; hint.style.display = '';
    sH.focus(); sH.select();
  }
  function exitEdit() { editing = false; editWrap.style.display = 'none'; hint.style.display = 'none'; display.style.display = ''; }
  function commit() {
    if (!editing) return;
    const rf = Math.round(fps());
    const clamp = (v, max) => { v = parseInt(v, 10) || 0; return Math.max(0, max != null ? Math.min(v, max) : v); };
    const h = clamp(sH.value), m = clamp(sM.value, 59), s = clamp(sS.value, 59), f = clamp(sF.value, Math.max(0, rf - 1));
    let t = h * 3600 + m * 60 + s + f / fps();
    if (isFinite(playerEl.duration)) t = Math.min(t, playerEl.duration);
    exitEdit();
    playerEl.currentTime = Math.max(0, t);
    refresh();
  }
  tc.addEventListener('click', (e) => { if (!editing && !editWrap.contains(e.target)) enterEdit(); });
  tc.addEventListener('keydown', (e) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); enterEdit(); } });
  editWrap.addEventListener('focusout', (e) => { if (!editWrap.contains(e.relatedTarget)) commit(); });
  const order = [sH, sM, sS, sF];
  for (const seg of order) {
    seg.addEventListener('input', () => {
      seg.value = seg.value.replace(/\D/g, '').slice(0, 2);
      if (seg.value.length === 2) { const i = order.indexOf(seg); if (i < 3) { order[i + 1].focus(); order[i + 1].select(); } }
    });
    seg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); exitEdit(); refresh(); }
    });
  }

  // Live timecode while playing.
  let raf = 0;
  function tick() { refresh(); if (!playerEl.paused) raf = requestAnimationFrame(tick); }
  playerEl.addEventListener('play', () => { raf = requestAnimationFrame(tick); });
  playerEl.addEventListener('pause', () => { cancelAnimationFrame(raf); refresh(); });
  playerEl.addEventListener('seeked', refresh);

  function grabCanvas() {
    const vw = playerEl.videoWidth, vh = playerEl.videoHeight;
    if (!vw || !vh) return null;
    const cv = document.createElement('canvas'); cv.width = vw; cv.height = vh;
    cv.getContext('2d').drawImage(playerEl, 0, 0, vw, vh);
    return cv;
  }
  const prevBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => { playerEl.pause(); playerEl.currentTime = Math.max(0, playerEl.currentTime - 1 / fps()); } }, '← Prev frame');
  const nextBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) { playerEl.requestVideoFrameCallback(() => { playerEl.pause(); refresh(); }); playerEl.play(); }
    else { playerEl.currentTime = Math.min(playerEl.duration || Infinity, playerEl.currentTime + 1 / fps()); }
  } }, 'Next frame →');
  const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: async () => {
    const cv = grabCanvas(); if (!cv) return;
    analyseBtn.disabled = true; analyseBtn.textContent = 'Capturing…';
    try {
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const frameFile = new File([blob], `frame_${playerEl.currentTime.toFixed(3)}s.png`, { type: 'image/png' });
      const pr = document.getElementById('photoResults');
      if (pr) { renderPhoto(frameFile, pr); scrollToPhoto(); }
    } catch (_) {}
    analyseBtn.disabled = false; analyseBtn.textContent = 'Analyse frame';
  } }, 'Analyse frame');
  const grabBtn = el('button', { type: 'button', class: 'anr-btn', onclick: async () => {
    const cv = grabCanvas(); if (!cv) return;
    grabBtn.disabled = true;
    try {
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      // Name the grab after the timecode (HH-MM-SS-FF; ':' is illegal in filenames).
      const p = parts(playerEl.currentTime);
      const tc = `${pad(p.h)}-${pad(p.m)}-${pad(p.s)}-${pad(p.f)}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (file.name || 'video').replace(/\.[^.]+$/, '') + `_${tc}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (_) {}
    grabBtn.disabled = false;
  } }, 'Frame grab');

  const grid = el('div', { class: 'anr-frame-grid' }, [prevBtn, nextBtn, analyseBtn, grabBtn]);
  const wrap = el('div', { class: 'anr-frame-wrap' }, [tc, grid]);
  refresh();
  return { wrap, refresh };
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

// Extracting and analysing a video's audio track (full decode + waveform +
// spectrogram) is heavy, so it no longer runs automatically. Instead this drops
// an "Analyse audio" prompt card into the Sound section; the supplied routine
// only fires when the user clicks it. Returns nothing - purely a UI mount.
function mountAudioAnalyseButton(audioResultsEl, run) {
  audioResultsEl.hidden = false;
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Audio track'));
  card.appendChild(el('p', { class: 'anr-info' },
    'This video carries an embedded sound track. Extract it for a player, waveform, spectrogram and level stats.'));
  const btn = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse audio');
  card.appendChild(btn);
  audioResultsEl.appendChild(card);
  btn.addEventListener('click', () => {
    card.remove();
    // Scroll to the top of the whole Sound section (heading + lede), not the
    // results container, which sits below them - landing on the container alone
    // scrolls past the heading and looks like it jumped to the section's middle.
    (audioResultsEl.closest('.section') || audioResultsEl)
      .scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Show the bottom loading popup while the (heavy) decode + spectrogram runs.
    const loader = window._anrLoader;
    if (loader) loader.show('Analysing audio…');
    Promise.resolve(run()).catch(() => {}).finally(() => { if (loader) loader.hide(); });
  });
}

// Photo counterpart of mountAudioAnalyseButton: a video's first frame is no
// longer pushed into the Photo section automatically. This drops an "Analyse
// photo" prompt card there; the frame is only analysed when the user clicks.
function mountPhotoAnalyseButton(photoResultsEl, run) {
  photoResultsEl.hidden = false;
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Frame analysis'));
  card.appendChild(el('p', { class: 'anr-info' },
    'Pull this video’s first frame into the photo tools for colours, dimensions, EXIF and the rest.'));
  const btn = el('button', { type: 'button', class: 'anr-btn' }, 'Analyse photo');
  card.appendChild(btn);
  photoResultsEl.appendChild(card);
  btn.addEventListener('click', () => {
    card.remove();
    scrollToPhoto();
    Promise.resolve(run()).catch(() => {});
  });
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
// ESM build (not UMD): @ffmpeg/ffmpeg spawns its worker as `type:"module"`, where
// importScripts() doesn't exist, so the worker loads the core via `import(coreURL)`
// and reads its `default` export. The UMD build has no default export (it only
// assigns module.exports/AMD), so a module worker gets `undefined` and throws
// "failed to import ffmpeg-core.js". The ESM build has `export default`, so it works.
const FFMPEG_CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
let ffmpegInstance = null;
let _ffLoaderEl = null;

// The bottom-of-window loader. Default label/determinate bar for the FFmpeg core
// download; pass a custom label + indeterminate:true to reuse it for any other
// FFmpeg-backed wait (e.g. preparing a segment of a large raw stream).
function showFfmpegLoader(label, indeterminate) {
  if (!_ffLoaderEl || !_ffLoaderEl.isConnected) {
    const bar = asciiBar({ fit: true });
    const labelEl = el('div', { class: 'anr-drop-loader-label' }, '');
    _ffLoaderEl = el('div', { class: 'anr-drop-loader', role: 'status', 'aria-live': 'polite' }, [labelEl, bar]);
    _ffLoaderEl._bar = bar;
    _ffLoaderEl._label = labelEl;
    document.body.appendChild(_ffLoaderEl);
  }
  _ffLoaderEl._label.textContent = label || 'Loading FFmpeg… (≈31 MB, first time only)';
  if (indeterminate) _ffLoaderEl._bar.indeterminate();
  else _ffLoaderEl._bar.set(0);
  requestAnimationFrame(() => _ffLoaderEl.classList.add('is-open'));
}
function setFfmpegLoaderProgress(frac) {
  if (_ffLoaderEl && _ffLoaderEl._bar) _ffLoaderEl._bar.set(frac);
}
function hideFfmpegLoader() {
  if (_ffLoaderEl) {
    _ffLoaderEl.classList.remove('is-open');
    if (_ffLoaderEl._bar && _ffLoaderEl._bar.stop) _ffLoaderEl._bar.stop();
  }
}

async function loadFFmpeg(onProgress) {
  if (ffmpegInstance) return ffmpegInstance;
  showFfmpegLoader();
  try {
    const { FFmpeg } = await import(new URL('../../vendor/ffmpeg/ffmpeg.js', import.meta.url).href);
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
  const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
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

// Re-encode a video playing backwards (picture + sound) with FFmpeg WASM. The
// `reverse`/`areverse` filters buffer every frame/sample in memory, so this is an
// on-demand action and can fail (out of memory) on long clips. Output is H.264 +
// AAC in MP4 (yuv420p) so the result plays in any browser. `onLoad` reports 0..1
// core-download progress; `onEnc` reports 0..1 encode progress. Returns a
// video/mp4 Blob, or null if nothing could be produced.
async function ffmpegReverseVideo(file, onLoad, onEnc, signal) {
  const ff = await loadFFmpeg(onLoad);
  if (signal && signal.aborted) return null;
  const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
  const inName = 'rev_in', outName = 'rev_out.mp4';
  await ff.writeFile(inName, await fetchFile(file));
  const onProg = ({ progress }) => { if (onEnc && isFinite(progress)) onEnc(Math.max(0, Math.min(1, progress))); };
  ff.on('progress', onProg);
  const run = async (args) => {
    try { await ff.exec(args); } catch (_) {}
    try { return await ff.readFile(outName); } catch (_) { return null; }
  };
  // First reverse video + audio; if there's no audio track areverse yields no
  // output, so retry video-only.
  let data = await run(['-i', inName, '-vf', 'reverse', '-af', 'areverse',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', outName]);
  if (!data || !data.length) {
    try { await ff.deleteFile(outName); } catch (_) {}
    data = await run(['-i', inName, '-vf', 'reverse', '-an',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', outName]);
  }
  ff.off('progress', onProg);
  try { await ff.deleteFile(inName); } catch (_) {}
  try { await ff.deleteFile(outName); } catch (_) {}
  if (!data || !data.length) return null;
  return new Blob([data.buffer || data], { type: 'video/mp4' });
}

// Card with a button that reverses the playable video on demand, then shows a
// reversed player + MP4 download. `file` is the browser-playable file (original or
// the remuxed MP4). `signal` revokes the result URL on teardown.
function buildReverseVideoCard(file, signal) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Reverse'));
  card.appendChild(el('p', { class: 'anr-hint' },
    'Re-encode this video playing backwards - picture and sound - in your browser with FFmpeg (~30 MB, downloaded once then cached). The reverse filter holds every frame in memory, so a long clip can be slow or run out of memory.'));
  const btn = el('button', { type: 'button', class: 'anr-btn' }, '↺ Reverse video');
  const out = el('div');
  const barEl = el('div', { class: 'anr-progress-bar' }, '[                    ]');
  const labelEl = el('div', { class: 'anr-progress-label' }, 'loading ffmpeg (~30 mb)');
  const wrap = el('div', { class: 'anr-progress', style: 'display:none;' }, [barEl, labelEl]);
  const setBar = (frac) => {
    const ch = parseFloat(getComputedStyle(barEl).fontSize) * 0.6 || 8;
    const total = Math.max(10, Math.floor((barEl.parentElement.clientWidth - ch * 2) / ch));
    const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
    barEl.innerHTML = '[<span class="anr-bar-fill">' + '/'.repeat(filled) + '</span>' + ' '.repeat(total - filled) + ']';
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Reversing…';
    wrap.style.display = '';
    let blob = null;
    try {
      blob = await ffmpegReverseVideo(file,
        (p) => { labelEl.textContent = 'loading ffmpeg (~30 mb)'; setBar(p); },
        (p) => { labelEl.textContent = 'reversing'; setBar(p); },
        signal);
    } catch (_) { blob = null; }
    wrap.style.display = 'none';
    if (signal && signal.aborted) return;
    if (!blob) {
      btn.disabled = false; btn.textContent = '↺ Reverse video';
      out.appendChild(el('p', { class: 'anr-hint', style: 'color:var(--accent);' },
        'Could not reverse this video - it may be too long to hold in memory, or the codec could not be re-encoded.'));
      return;
    }
    const url = URL.createObjectURL(blob);
    if (signal) signal.addEventListener('abort', () => { try { URL.revokeObjectURL(url); } catch (_) {} });
    const v = el('video', { src: url, playsinline: '' });
    v.setAttribute('webkit-playsinline', '');
    v.style.cssText = 'width:100%; max-height:480px; background:#0a0a0a; display:block; border:1px solid var(--hairline);';
    applyVideoControls(v);
    out.appendChild(v);
    out.appendChild(makePlayer(v));
    const base = (file.name || 'video').replace(/\.[^.]+$/, '');
    out.appendChild(el('div', { style: 'margin-top:10px;' }, [
      el('a', { href: url, download: base + '_reversed.mp4', class: 'anr-btn',
        style: 'display:inline-block;text-decoration:none;' }, 'Download reversed (MP4)')
    ]));
    btn.remove();
  });
  card.appendChild(btn);
  card.appendChild(wrap);
  card.appendChild(out);
  return card;
}

// Remux a raw H.264/H.265 elementary stream (Annex B, no container) into an MP4
// using FFmpeg WASM. Stream copy only (-c copy) - the bitstream is unchanged, so
// it's fast and lossless; it just gains an MP4 container the browser can play.
// faststart moves the moov atom to the front so it plays without a full read.
// A raw stream carries no timing, so FFmpeg's h264/h265 demuxer assumes 25 fps.
//
// rawKind ('h264' | 'h265') forces the input demuxer with -f. A bare elementary
// stream has no container and no useful extension for FFmpeg to probe, so without
// an explicit -f the demuxer is often never selected, -c copy finds no input,
// and we'd silently produce nothing - which is exactly the "doesn't open at all"
// case. We know the kind from detection, so we always pass it.
//
// Returns { blob, log }: blob is a video/mp4 Blob (or null on failure) and log is
// the captured FFmpeg output so the caller can show WHY a remux didn't produce a
// file instead of silently dropping to the unplayable card. Large inputs are
// mounted via WORKERFS (read by seeking) rather than copied whole into WASM heap.
async function ffmpegRemuxToMp4(file, signal, rawKind) {
  const ff = await loadFFmpeg();
  if (signal && signal.aborted) return { blob: null, log: '' };
  const demuxer = rawKind === 'h265' ? 'hevc' : 'h264';
  const outName = 'out.mp4';

  let log = '';
  const onLog = ({ message }) => { log += message + '\n'; };
  ff.on('log', onLog);

  const MOUNT = '/anrrx';
  let inName = null;
  let cleanup = async () => {};
  try {
    // Prefer a WORKERFS mount so a multi-GB stream is read by seeking, not copied
    // into WASM memory (fetchFile of a huge file blows the heap). Fall back to an
    // in-memory copy for smaller files / browsers without WORKERFS.
    let mounted = false;
    try { await ff.createDir(MOUNT); mounted = await ff.mount('WORKERFS', { files: [file] }, MOUNT); } catch (_) { mounted = false; }
    if (mounted) {
      inName = MOUNT + '/' + file.name;
      cleanup = async () => { try { await ff.unmount(MOUNT); } catch (_) {} try { await ff.deleteDir(MOUNT); } catch (_) {} };
    } else {
      try { await ff.deleteDir(MOUNT); } catch (_) {}
      const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
      inName = 'in.' + (demuxer === 'hevc' ? 'h265' : 'h264');
      await ff.writeFile(inName, await fetchFile(file));
      cleanup = async () => { try { await ff.deleteFile(inName); } catch (_) {} };
    }

    try {
      await ff.exec(['-fflags', '+genpts', '-f', demuxer, '-i', inName, '-c', 'copy', '-movflags', '+faststart', outName]);
    } catch (_) { /* exec may resolve with a non-zero code instead of throwing */ }
    let data = null;
    try { data = await ff.readFile(outName); } catch (_) { data = null; }
    if (!data || !data.length) {
      // Stream-copy can fail on streams whose in-band SPS/PPS FFmpeg won't lift into
      // an MP4 sample-description as-is. Re-encode as a last resort so the clip still
      // opens; lossy, but better than a stream that won't play at all.
      try { await ff.deleteFile(outName); } catch (_) {}
      try {
        await ff.exec(['-fflags', '+genpts', '-f', demuxer, '-i', inName,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart', outName]);
      } catch (_) {}
      try { data = await ff.readFile(outName); } catch (_) { data = null; }
    }
    try { await ff.deleteFile(outName); } catch (_) {}
    if (!data || !data.length) return { blob: null, log };
    return { blob: new Blob([data.buffer || data], { type: 'video/mp4' }), log };
  } finally {
    try { if (ff.off) ff.off('log', onLog); } catch (_) {}
    await cleanup();
  }
}

// ---------- segmented playback for very large raw H.264/H.265 streams ----------
// A multi-GB elementary stream can't be remuxed in one piece (FFmpeg keeps the
// whole input AND output MP4 in WASM memory). Instead we split it at keyframes
// into part-sized chunks, remux each to MP4 on demand, and play them back-to-back.
// The split MUST land on an IDR and each chunk MUST carry the SPS/PPS (and VPS for
// HEVC), or the piece won't decode - so we capture the parameter sets from the
// head and only cut at IDR start codes.

// NAL type for a header byte. H.264 = low 5 bits; H.265 = bits 1..6.
function nalTypeOf(headerByte, h265) {
  return h265 ? ((headerByte >> 1) & 0x3f) : (headerByte & 0x1f);
}
// IDR / random-access NAL: H.264 type 5; HEVC IDR_W_RADL 19, IDR_N_LP 20, CRA 21.
function isIdrNal(t, h265) { return h265 ? (t === 19 || t === 20 || t === 21) : (t === 5); }
// Parameter-set NAL: H.264 SPS 7 / PPS 8; HEVC VPS 32 / SPS 33 / PPS 34.
function isParamNal(t, h265) { return h265 ? (t === 32 || t === 33 || t === 34) : (t === 7 || t === 8); }

// Pull the parameter sets (SPS/PPS, plus HEVC VPS) out of the stream head and
// return them as one Annex B blob with 4-byte start codes, ready to prepend to a
// chunk. Returns null if the essential sets aren't found.
async function extractRawParamSets(file, h265, signal) {
  const HEAD = Math.min(file.size, 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, HEAD).arrayBuffer());
  if (signal && signal.aborted) return null;
  const sets = [];
  const seen = new Set();
  let i = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      const nalStart = i + 3;
      let j = nalStart;
      while (j + 3 <= buf.length && !(buf[j] === 0 && buf[j + 1] === 0 && buf[j + 2] === 1)) j++;
      const nalEnd = (j + 3 <= buf.length) ? j : buf.length;
      let end = nalEnd;
      while (end > nalStart && buf[end - 1] === 0) end--;   // drop the next SC's leading zeros
      const t = nalTypeOf(buf[nalStart], h265);
      if (isParamNal(t, h265) && !seen.has(t)) { seen.add(t); sets.push({ t, payload: buf.slice(nalStart, end) }); }
      i = nalEnd;
    } else i++;
  }
  const needed = h265 ? [33, 34] : [7, 8];   // VPS is optional; SPS+PPS are not
  if (!needed.every((t) => seen.has(t))) return null;
  const order = h265 ? [32, 33, 34] : [7, 8];
  sets.sort((a, b) => order.indexOf(a.t) - order.indexOf(b.t));
  let total = 0;
  for (const s of sets) total += 4 + s.payload.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const s of sets) { out[p + 3] = 1; p += 4; out.set(s.payload, p); p += s.payload.length; }
  return out;
}

// Human-readable codec / profile from the captured parameter sets. An H.264 SPS
// carries profile_idc and level_idc right after the NAL header byte; HEVC profile
// parsing is far more involved, so it's reported generically.
function describeRawCodec(paramSets, h265) {
  let i = 0;
  while (i + 5 <= paramSets.length) {
    if (paramSets[i] === 0 && paramSets[i + 1] === 0 && paramSets[i + 2] === 1) {
      const s = i + 3;
      const t = nalTypeOf(paramSets[s], h265);
      if (!h265 && t === 7) {
        const profile = paramSets[s + 1], level = paramSets[s + 3];
        const names = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' };
        return 'H.264 / AVC (' + (names[profile] || ('profile ' + profile)) + ', level ' + (level / 10).toFixed(1) + ')';
      }
      if (h265 && t === 33) return 'H.265 / HEVC';
      i = s;
    } else i++;
  }
  return h265 ? 'H.265 / HEVC' : 'H.264 / AVC';
}

// Byte offset of the next IDR start code at or after `from`, scanning the file in
// windows (so a multi-GB file is read by seeking, never copied whole). Windows
// overlap by 4 bytes so a start code straddling a boundary isn't missed. Returns
// null if none within maxSpan.
async function findNextIdrOffset(file, from, h265, signal, maxSpan = 128 * 1024 * 1024) {
  const WIN = 8 * 1024 * 1024;
  const limit = Math.min(file.size, from + maxSpan);
  let pos = Math.max(0, from);
  while (pos < limit) {
    if (signal && signal.aborted) return null;
    const end = Math.min(file.size, pos + WIN);
    const buf = new Uint8Array(await file.slice(pos, end).arrayBuffer());
    for (let i = 0; i + 4 <= buf.length; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1 && isIdrNal(nalTypeOf(buf[i + 3], h265), h265)) {
        return pos + i;
      }
    }
    if (end >= file.size) break;
    pos = end - 4;
  }
  return null;
}

// Work out where to cut a large stream: parameter sets + a list of byte
// boundaries, each on an IDR, sized ~TARGET so every produced MP4 fits in memory.
// Returns null if the stream can't be split (no param sets, or no keyframes found).
async function planRawSegments(file, h265, signal) {
  const paramSets = await extractRawParamSets(file, h265, signal);
  if (!paramSets) return null;
  const TARGET = 256 * 1024 * 1024;
  const boundaries = [0];
  const count = Math.ceil(file.size / TARGET);
  for (let k = 1; k < count; k++) {
    const approx = k * TARGET;
    if (approx >= file.size) break;
    const idr = await findNextIdrOffset(file, approx, h265, signal);
    if (signal && signal.aborted) return null;
    if (idr != null && idr > boundaries[boundaries.length - 1] + 4096) boundaries.push(idr);
  }
  boundaries.push(file.size);
  if (boundaries.length < 3) return null;   // couldn't actually split it
  return { paramSets, boundaries };
}

// Remux one [start,end) byte range into a self-contained MP4: parameter sets
// prepended (so the chunk decodes even though it starts mid-file), stream-copied.
// loaderLabel (optional): when set, the bottom loader bar shows that text while
// this part is being read + remuxed (foreground parts only - not prefetches).
async function remuxRawSegment(file, start, end, paramSets, h265, signal, loaderLabel) {
  const ff = await loadFFmpeg();
  if (signal && signal.aborted) return null;
  if (loaderLabel) showFfmpegLoader(loaderLabel, true);
  const demuxer = h265 ? 'hevc' : 'h264';
  const inName = 'seg.' + (h265 ? 'h265' : 'h264'), outName = 'seg.mp4';
  let blob = null;
  try {
    const body = new Uint8Array(await file.slice(start, end).arrayBuffer());
    if (signal && signal.aborted) return null;
    const chunk = new Uint8Array(paramSets.length + body.length);
    chunk.set(paramSets, 0);
    chunk.set(body, paramSets.length);
    await ff.writeFile(inName, chunk);
    try { await ff.exec(['-fflags', '+genpts', '-f', demuxer, '-i', inName, '-c', 'copy', '-movflags', '+faststart', outName]); } catch (_) {}
    let data = null;
    try { data = await ff.readFile(outName); } catch (_) { data = null; }
    if (data && data.length) blob = new Blob([data.buffer || data], { type: 'video/mp4' });
  } finally {
    try { await ff.deleteFile(inName); } catch (_) {}
    try { await ff.deleteFile(outName); } catch (_) {}
    if (loaderLabel) hideFfmpegLoader();
  }
  return blob;
}

// Opt-in scene-change detection scoped to the part currently loaded in the player
// (it scrubs the <video>, so it can only see the segment that's loaded). Mirrors
// the main player's scene card. Rebuildable so it can be run on each part.
function buildRawSceneCard(playerEl, signal) {
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Scene changes'));
  const out = el('div');
  out.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:8px;' }, 'Scans the part currently loaded in the player.'));
  const runBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Detect scene changes');
  out.appendChild(runBtn);
  card.appendChild(out);

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.textContent = 'Detecting…';
    const dur = playerEl.duration;
    let changes = [];
    try { changes = await detectSceneChanges(playerEl, 55, signal); } catch (_) {}
    try { playerEl.currentTime = 0; playerEl.pause(); } catch (_) {}
    if (signal && signal.aborted) return;
    out.innerHTML = '';
    out.appendChild(el('p', { class: 'anr-hint', style: 'margin-bottom:10px;' },
      changes.length ? changes.length + ' scene change' + (changes.length > 1 ? 's' : '') + ' detected in this part' : 'No scene changes detected in this part'));
    if (changes.length && isFinite(dur) && dur > 0) {
      const timeline = el('div', { class: 'anr-scene-timeline' });
      for (const sc of changes) {
        const marker = el('div', { class: 'anr-scene-marker', style: 'left:' + (sc.time / dur) * 100 + '%;', title: formatDuration(sc.time) + '  ·  ' + sc.confidence + '%' });
        marker.addEventListener('click', () => { playerEl.currentTime = sc.time; playerEl.pause(); });
        timeline.appendChild(marker);
      }
      out.appendChild(timeline);
      const details = el('details', { class: 'anr-scene-details' });
      details.appendChild(el('summary', {}, 'Thumbnails (' + changes.length + ')'));
      const grid = el('div', { class: 'anr-scene-grid' });
      for (const sc of changes) {
        const w = el('div', { class: 'anr-scene-thumb', onclick: () => { playerEl.currentTime = sc.time; playerEl.pause(); } });
        w.appendChild(el('img', { src: sc.thumbnail, alt: 'Scene at ' + formatDuration(sc.time) }));
        w.appendChild(el('span', { class: 'anr-scene-meta' }, formatDuration(sc.time) + ' · ' + sc.confidence + '%'));
        grid.appendChild(w);
      }
      details.appendChild(grid);
      out.appendChild(details);
    }
    const again = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:10px;' }, 'Run again (current part)');
    again.addEventListener('click', () => card.replaceWith(buildRawSceneCard(playerEl, signal)));
    out.appendChild(again);
  });
  return card;
}

// Player for an over-size raw stream: scan -> split at keyframes -> lazily remux
// each part and play them back-to-back. Throws if FFmpeg/scan fails so the caller
// can fall back to the "open in VLC" note.
async function renderSegmentedRawVideo(file, header, resultsEl, kind, signal) {
  const h265 = kind === 'H.265';
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' },
    'Large raw ' + kind + ' stream (' + fmtBytes(file.size) + ') - scanning for keyframes to split it into playable parts…'));

  const plan = await planRawSegments(file, h265, signal);
  if (signal.aborted) return;
  if (!plan) {
    resultsEl.innerHTML = '';
    await renderUnplayableVideoInfo(file, header, resultsEl, signal);
    if (!signal.aborted) {
      resultsEl.appendChild(el('div', { class: 'anr-card' }, [
        el('p', {}, 'This raw ' + kind + ' stream is ' + fmtBytes(file.size) + ' - too large to remux in one piece, and it '
          + 'couldn’t be split (no keyframe index found). Open it in VLC, or wrap it with desktop ffmpeg: '
          + 'ffmpeg -i "' + (file.name || 'input.h264') + '" -c copy out.mp4.')
      ]));
    }
    return;
  }

  const { paramSets, boundaries } = plan;
  const N = boundaries.length - 1;
  resultsEl.innerHTML = '';

  const playerCard = el('div', { class: 'anr-card', style: 'position:relative;' });
  playerCard.appendChild(el('h3', {}, 'Player'));
  const playerEl = el('video', { playsinline: '' });
  playerEl.setAttribute('webkit-playsinline', '');
  playerEl.style.cssText = 'width:100%; max-height:480px; background:#0a0a0a; display:block; border:1px solid var(--hairline);';
  applyVideoControls(playerEl);
  playerCard.appendChild(playerEl);
  playerCard.appendChild(makePlayer(playerEl));

  // Frame-by-frame nav, editable timecode, capture-to-photo and frame-grab - the
  // same tools the normal player gets. Raw streams carry no timing, so 25 fps.
  const frameTools = buildFrameControls(playerEl, () => 25, file);
  playerCard.appendChild(frameTools.wrap);

  const status = el('span', { class: 'anr-hint', style: 'align-self:center;' }, '');
  const prevBtn = el('button', { type: 'button', class: 'anr-btn' }, '‹ Prev');
  const nextBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Next ›');
  playerCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px; gap:8px; flex-wrap:wrap; align-items:center;' }, [prevBtn, nextBtn, status]));

  const strip = el('div', { class: 'anr-seg-strip' });
  const segBtns = [];
  for (let i = 0; i < N; i++) {
    const b = el('button', { type: 'button', class: 'anr-seg-btn' }, String(i + 1));
    b.addEventListener('click', () => goTo(i, true));
    segBtns.push(b);
    strip.appendChild(b);
  }
  playerCard.appendChild(strip);
  resultsEl.appendChild(playerCard);

  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size) + '   (' + file.size.toLocaleString() + ' bytes)'));
  if (header && header.container) tbl.appendChild(row('Container', header.container));
  tbl.appendChild(row('Codec', describeRawCodec(paramSets, h265)));
  const resRow = row('Resolution', '-');
  tbl.appendChild(resRow);
  const arRow = row('Aspect ratio', '-');
  tbl.appendChild(arRow);
  tbl.appendChild(row('Frame rate', '25 fps (assumed - a raw stream carries no timing)'));
  tbl.appendChild(row('Parts', N + ' × ~' + fmtBytes(Math.round(file.size / N)) + ', split at keyframes'));
  infoCard.appendChild(tbl);
  infoCard.appendChild(el('p', { class: 'anr-hint' },
    'Too big to convert in one piece, so it’s split at keyframes into ' + N + ' parts, each remuxed to MP4 on demand and '
    + 'played back-to-back. A raw stream carries no timing, so playback speed assumes 25 fps and there’s no audio track.'));
  resultsEl.appendChild(infoCard);

  // Integrity: hashing a multi-GB file reads the whole thing, so keep it on-demand.
  const hashCard = el('div', { class: 'anr-card' });
  hashCard.appendChild(el('h3', {}, 'Integrity'));
  hashCard.appendChild(el('p', { class: 'anr-hint' }, 'SHA-256 reads the whole file (' + fmtBytes(file.size) + '), so it isn’t computed automatically.'));
  const hashBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Compute SHA-256');
  hashBtn.addEventListener('click', () => { hashCard.replaceWith(integrityCard(file)); });
  hashCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [hashBtn]));
  resultsEl.appendChild(hashCard);

  resultsEl.appendChild(buildRawSceneCard(playerEl, signal));

  const cache = new Map();   // i -> { url }
  let cur = -1;
  let gen = 0;

  async function ensureSegment(i, loaderLabel) {
    if (i < 0 || i >= N) return null;
    if (cache.has(i)) return cache.get(i);
    const blob = await remuxRawSegment(file, boundaries[i], boundaries[i + 1], paramSets, h265, signal, loaderLabel);
    if (!blob) return null;
    const entry = { url: URL.createObjectURL(blob) };
    cache.set(i, entry);
    // Keep only the neighbours of the current part so memory stays bounded.
    for (const key of [...cache.keys()]) {
      if (Math.abs(key - i) > 1) { try { URL.revokeObjectURL(cache.get(key).url); } catch (_) {} cache.delete(key); }
    }
    return entry;
  }

  async function goTo(i, autoplay) {
    if (i < 0 || i >= N || signal.aborted) return;
    const myGen = ++gen;
    cur = i;
    segBtns.forEach((b, j) => b.classList.toggle('is-active', j === i));
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === N - 1;
    status.textContent = 'Preparing part ' + (i + 1) + ' / ' + N + '…';
    let entry = null;
    try { entry = await ensureSegment(i, 'Preparing part ' + (i + 1) + ' / ' + N + '…'); } catch (_) { entry = null; }
    if (myGen !== gen || signal.aborted) return;
    if (!entry) { status.textContent = 'Part ' + (i + 1) + ' couldn’t be prepared.'; return; }
    playerEl.onloadedmetadata = () => {
      if (playerEl.videoWidth) {
        resRow.lastChild.textContent = playerEl.videoWidth + ' × ' + playerEl.videoHeight + ' px';
        arRow.lastChild.textContent = aspectRatio(playerEl.videoWidth, playerEl.videoHeight);
      }
      frameTools.refresh();
    };
    playerEl.src = entry.url;
    status.textContent = 'Part ' + (i + 1) + ' / ' + N;
    if (autoplay) playerEl.play().catch(() => {});
    if (i + 1 < N) ensureSegment(i + 1).catch(() => {});   // prefetch the next part
  }

  playerEl.addEventListener('ended', () => { if (cur + 1 < N) goTo(cur + 1, true); });
  signal.addEventListener('abort', () => {
    for (const v of cache.values()) { try { URL.revokeObjectURL(v.url); } catch (_) {} }
    cache.clear();
  });

  await goTo(0, false);
}

// Mean luma (0-255) of a JPEG blob, sampled on a small canvas. Used to tell a
// black/blank frame from a frame with real picture in it. Returns null on failure.
async function meanLuma(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const w = Math.min(160, bmp.width || 160);
    const h = Math.max(1, Math.round((bmp.height || 90) * (w / (bmp.width || 160))));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  } catch (_) {
    return null;
  }
}

// Grab the very first frame of a video the browser itself can't decode (ProRes,
// DNxHD, HEVC-in-MKV, ...) using the FFmpeg WASM fallback, as { blob, time }.
// Decodes a SINGLE frame only - it no longer scans a ladder of timestamps for a
// non-black frame - so even a large or slow-to-decode master pays for just one
// decode. Prefers a WORKERFS mount so multi-GB files are read by seeking rather
// than copied whole into WASM memory; falls back to an in-memory copy for
// smaller files. Returns null if nothing usable could be extracted. Fully guarded.
async function ffmpegFirstFrame(file, signal) {
  const ff = await loadFFmpeg();
  if (signal && signal.aborted) return null;

  const MOUNT = '/anrmnt';
  let input = null;
  let cleanup = async () => {};
  try {
    // Preferred path: mount the File via WORKERFS (no full in-memory copy).
    let mounted = false;
    try {
      await ff.createDir(MOUNT);
      mounted = await ff.mount('WORKERFS', { files: [file] }, MOUNT);
    } catch (_) { mounted = false; }
    if (mounted) {
      input = MOUNT + '/' + file.name;
      cleanup = async () => {
        try { await ff.unmount(MOUNT); } catch (_) {}
        try { await ff.deleteDir(MOUNT); } catch (_) {}
      };
    } else {
      // Fallback: copy into MEMFS, but only when small enough to fit WASM memory.
      try { await ff.deleteDir(MOUNT); } catch (_) {}
      if (file.size > 1_200 * 1024 * 1024) return null;
      const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
      await ff.writeFile('anr_input', await fetchFile(file));
      input = 'anr_input';
      cleanup = async () => { try { await ff.deleteFile('anr_input'); } catch (_) {} };
    }

    if (signal && signal.aborted) return null;
    // Decode exactly one frame - the first - and stop. No -ss ladder, so a large
    // or hard-to-decode video isn't paying for repeated seeks and decodes.
    try {
      await ff.exec(['-i', input, '-frames:v', '1', '-q:v', '3', '-y', 'anr_frame.jpg'], 45000);
    } catch (_) { return null; }
    let data = null;
    try { data = await ff.readFile('anr_frame.jpg'); } catch (_) {}
    try { await ff.deleteFile('anr_frame.jpg'); } catch (_) {}
    if (!data || !data.length) return null;
    const blob = new Blob([data.buffer || data], { type: 'image/jpeg' });
    return { blob, time: 0 };
  } catch (_) {
    return null;
  } finally {
    await cleanup();
  }
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

  // Raw H.264 / H.265 elementary stream (Annex B): no container, just NAL units
  // separated by start codes (00 00 01 or 00 00 00 01). The first NAL header byte
  // identifies the stream: for H.264 the type is the low 5 bits (7=SPS, 8=PPS,
  // 5=IDR, 1=non-IDR); for HEVC it's bits 1..6 (32=VPS, 33=SPS, 34=PPS). The
  // forbidden_zero_bit (high bit) is always 0, which also rules out MPEG-PS
  // (00 00 01 BA, high bit set), handled above.
  if (head[0] === 0x00 && head[1] === 0x00 &&
      (head[2] === 0x01 || (head[2] === 0x00 && head[3] === 0x01))) {
    const nal = head[head[2] === 0x01 ? 3 : 4];
    if ((nal & 0x80) === 0) {
      const t264 = nal & 0x1f;
      if (t264 === 7 || t264 === 8 || t264 === 5 || t264 === 1)
        return { container: 'Raw H.264 (Annex B)', raw: 'h264' };
      const t265 = (nal >> 1) & 0x3f;
      if (t265 === 32 || t265 === 33 || t265 === 34)
        return { container: 'Raw H.265 (Annex B)', raw: 'h265' };
    }
  }
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

// ---------- codec / rotation / HDR detection (ISOBMFF) ----------
// Walks the SAME moov/trak boxes as the fps detector to surface, per track:
// video codec (from stsd FourCC + avcC/hvcC profile/level), display rotation
// (from the tkhd 3x3 matrix), HDR/colour (from a 'colr' nclx box, plus mdcv/clli
// presence), and audio codec + channel count. Purely additive and best-effort:
// any failure is swallowed so the existing fps/preview/frame-stepping path is
// never affected.

const VIDEO_CODEC_NAMES = {
  avc1: 'H.264 / AVC', avc3: 'H.264 / AVC',
  hvc1: 'H.265 / HEVC', hev1: 'H.265 / HEVC',
  av01: 'AV1', vp09: 'VP9', vp08: 'VP8',
  mp4v: 'MPEG-4 Visual', 'dvh1': 'Dolby Vision (HEVC)', 'dvhe': 'Dolby Vision (HEVC)',
  s263: 'H.263', 'mjpg': 'Motion JPEG', jpeg: 'Motion JPEG',
  // Professional / intermediate codecs. Browsers ship no decoder for these, so
  // they never play in <video>; we still name them for identification and to
  // explain why playback fails (see PRO_VIDEO_CODECS / renderUnplayableVideoInfo).
  apco: 'Apple ProRes 422 Proxy', apcs: 'Apple ProRes 422 LT',
  apcn: 'Apple ProRes 422', apch: 'Apple ProRes 422 HQ',
  ap4h: 'Apple ProRes 4444', ap4x: 'Apple ProRes 4444 XQ',
  AVdn: 'Avid DNxHD / DNxHR', AVdh: 'Avid DNxHR',
  cfhd: 'GoPro CineForm', CFHD: 'GoPro CineForm',
  dvc: 'DV', dvcp: 'DV (PAL)', dvpp: 'DVCPRO', dv5p: 'DVCPRO50', dvh5: 'DVCPRO HD',
  icod: 'Apple Intermediate Codec', 'rle ': 'QuickTime Animation (RLE)',
  png: 'PNG (video track)', 'v210': 'Uncompressed 10-bit 4:2:2', '2vuy': 'Uncompressed 8-bit 4:2:2'
};
// Codecs that are professional/intermediate/uncompressed - identifiable but never
// playable in a browser. Used to tailor the "can't play this codec" explanation.
const PRO_VIDEO_CODECS = new Set([
  'apco', 'apcs', 'apcn', 'apch', 'ap4h', 'ap4x', 'AVdn', 'AVdh',
  'cfhd', 'CFHD', 'dvc', 'dvcp', 'dvpp', 'dv5p', 'dvh5', 'icod',
  'rle ', 'v210', '2vuy'
]);
const AUDIO_CODEC_NAMES = {
  mp4a: 'AAC', alac: 'Apple Lossless (ALAC)', 'ac-3': 'Dolby Digital (AC-3)',
  'ec-3': 'Dolby Digital Plus (E-AC-3)', 'Opus': 'Opus', sowt: 'PCM', twos: 'PCM',
  lpcm: 'PCM', 'in24': 'PCM (24-bit)', 'in32': 'PCM (32-bit)', samr: 'AMR'
};
// H.264 profile_idc -> friendly name (subset that matters for consumer video).
const H264_PROFILES = {
  66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High',
  110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4'
};
// chroma_format_idc (HEVC hvcC / H.264 avcC extension): 0 mono, 1 4:2:0, 2 4:2:2, 3 4:4:4.
const CHROMA_FORMATS = { 0: 'monochrome', 1: '4:2:0', 2: '4:2:2', 3: '4:4:4' };
// ISO/IEC 23001-8 colour primaries / transfer characteristics codes we care about.
const COLOUR_PRIMARIES = { 1: 'BT.709', 5: 'BT.601 (PAL)', 6: 'BT.601 (NTSC)', 9: 'BT.2020' };
const TRANSFER_CHARS = { 1: 'BT.709', 6: 'BT.601', 16: 'PQ', 18: 'HLG' };

function fcc(view, p) {
  return String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
}

// Derive a 0/90/180/270 display rotation from the tkhd 3x3 transform matrix.
// The matrix stores a,b,c,d as 16.16 fixed-point; rotation maps to the sign/
// magnitude pattern of (a,b,c,d). Returns 0 for identity / unknown.
function rotationFromMatrix(a, b, c, d) {
  const r = (x) => Math.round(x);
  a = r(a); b = r(b); c = r(c); d = r(d);
  if (a === 1 && b === 0 && c === 0 && d === 1) return 0;
  if (a === 0 && b === 1 && c === -1 && d === 0) return 90;
  if (a === -1 && b === 0 && c === 0 && d === -1) return 180;
  if (a === 0 && b === -1 && c === 1 && d === 0) return 270;
  // Fall back to atan2 of the first row for non-canonical matrices.
  const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI);
  return ((deg % 360) + 360) % 360;
}

async function detectIsobmffTracks(file) {
  if (file.size < 12) return null;
  const headBuf = await file.slice(0, Math.min(file.size, 64)).arrayBuffer();
  const hv = new DataView(headBuf);
  if (fcc(hv, 4) !== 'ftyp') return null;

  // Find the moov box (same top-level walk as detectFpsFromContainer).
  let moovOffset = -1, moovSize = 0, pos = 0;
  while (pos < file.size) {
    const headerBuf = await file.slice(pos, pos + 16).arrayBuffer();
    const dv = new DataView(headerBuf);
    if (headerBuf.byteLength < 8) break;
    let boxSize = dv.getUint32(0);
    const type = fcc(dv, 4);
    if (boxSize === 1 && headerBuf.byteLength >= 16) {
      boxSize = dv.getUint32(8) * 0x100000000 + dv.getUint32(12);
    }
    if (boxSize < 8) break;
    if (type === 'moov') { moovOffset = pos; moovSize = boxSize; break; }
    pos += boxSize;
  }
  if (moovOffset < 0 || moovSize > 20 * 1024 * 1024) return null;

  const moovBuf = await file.slice(moovOffset, moovOffset + moovSize).arrayBuffer();
  const view = new DataView(moovBuf);
  const result = { video: null, audio: null };

  const traks = findAllBoxes(view, 8, moovSize, 'trak');
  for (const trak of traks) {
    const trakStart = trak.offset + trak.headerSize;
    const trakEnd = Math.min(trak.offset + trak.size, moovSize);
    const isVideo = findAllBoxes(view, trakStart, trakEnd, 'vmhd').length > 0;
    const isAudio = findAllBoxes(view, trakStart, trakEnd, 'smhd').length > 0;

    const stsdBoxes = findAllBoxes(view, trakStart, trakEnd, 'stsd');
    if (!stsdBoxes.length) continue;
    const stsd = stsdBoxes[0];
    // stsd: 8-byte box header + 4 version/flags + 4 entry-count, then the first
    // sample-entry box (4 size + 4 FourCC).
    const entryStart = stsd.offset + stsd.headerSize + 8;
    if (entryStart + 8 > moovSize) continue;
    const sampleEntryBox = view.getUint32(entryStart);
    const codecFcc = fcc(view, entryStart + 4);

    if (isVideo && !result.video) {
      const v = { codec: codecFcc, codecName: VIDEO_CODEC_NAMES[codecFcc] || codecFcc };

      // Stored pixel dimensions from the VisualSampleEntry: box hdr(8) +
      // SampleEntry(8) + 16 pre-defined/reserved, then width(2) height(2).
      try {
        const dim = entryStart + 8 + 8 + 16;
        if (dim + 4 <= moovSize) {
          const w = view.getUint16(dim), h = view.getUint16(dim + 2);
          if (w > 0 && h > 0) { v.width = w; v.height = h; }
        }
      } catch (_) {}

      // Rotation from tkhd matrix. tkhd: version(1) flags(3) then times; matrix
      // sits at a fixed offset from the box data start (version-dependent).
      try {
        const tkhd = findAllBoxes(view, trakStart, trakEnd, 'tkhd')[0];
        if (tkhd) {
          const d = tkhd.offset + tkhd.headerSize;
          const ver = view.getUint8(d);
          // matrix starts after: ver/flags(4) + create+modify+trackID+reserved+duration
          // + reserved(8) + layer(2)+altGroup(2)+volume(2)+reserved(2)
          const matrixOff = d + (ver === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 8) + 8;
          if (matrixOff + 36 <= moovSize) {
            const fx = (o) => view.getInt32(matrixOff + o) / 65536; // 16.16 fixed
            const a = fx(0), b = fx(4), c = fx(12), dd = fx(16);
            const rot = rotationFromMatrix(a, b, c, dd);
            if (rot) v.rotation = rot;
          }
        }
      } catch (_) {}

      // Profile/level from avcC (H.264) or hvcC (HEVC), searched within stbl.
      try {
        if (codecFcc === 'avc1' || codecFcc === 'avc3') {
          const avcc = findAllBoxes(view, trakStart, trakEnd, 'avcC')[0];
          if (avcc) {
            const d = avcc.offset + avcc.headerSize; // configVer(1) profile(1) compat(1) level(1)
            const avccEnd = Math.min(avcc.offset + avcc.size, moovSize);
            const profileIdc = view.getUint8(d + 1);
            const levelIdc = view.getUint8(d + 3);
            if (H264_PROFILES[profileIdc]) v.profile = H264_PROFILES[profileIdc];
            if (levelIdc) v.level = (levelIdc / 10).toFixed(1).replace(/\.0$/, '');
            // Bit depth / chroma live in the avcC extension that High-10, High
            // 4:2:2 and High 4:4:4 profiles append after the SPS/PPS NAL arrays.
            // Walk past those arrays (bounded by the box) to reach it.
            if ([100, 110, 122, 144, 244].includes(profileIdc)) {
              let p = d + 5;
              const numSps = view.getUint8(p) & 0x1f; p += 1;
              for (let i = 0; i < numSps && p + 2 <= avccEnd; i++) p += 2 + view.getUint16(p);
              if (p < avccEnd) { const numPps = view.getUint8(p); p += 1;
                for (let i = 0; i < numPps && p + 2 <= avccEnd; i++) p += 2 + view.getUint16(p);
              }
              if (p + 3 <= avccEnd) {
                const b0 = view.getUint8(p), b1 = view.getUint8(p + 1), b2 = view.getUint8(p + 2);
                // The avcC chroma/bit-depth extension is OPTIONAL even on High
                // profile (100); many ordinary 8-bit 4:2:0 files omit it. Its
                // reserved bits are all 1s (chroma byte: top 6; depth bytes: top
                // 5), so validate them before trusting the values - otherwise
                // trailing/padding bytes get misread as 4:2:2/4:4:4 or 12-bit+,
                // wrongly routing a perfectly playable file to the "can't play"
                // banner.
                if ((b0 & 0xFC) === 0xFC && (b1 & 0xF8) === 0xF8 && (b2 & 0xF8) === 0xF8) {
                  const chromaIdc = b0 & 0x03;
                  const depthLuma = (b1 & 0x07) + 8;
                  const depthChroma = (b2 & 0x07) + 8;
                  if (CHROMA_FORMATS[chromaIdc] !== undefined) v.chroma = CHROMA_FORMATS[chromaIdc];
                  if (depthLuma >= 8 && depthLuma <= 16) v.bitDepth = Math.max(depthLuma, depthChroma);
                }
              }
            }
          }
        } else if (codecFcc === 'hvc1' || codecFcc === 'hev1' || codecFcc === 'dvh1' || codecFcc === 'dvhe') {
          const hvcc = findAllBoxes(view, trakStart, trakEnd, 'hvcC')[0];
          if (hvcc) {
            const d = hvcc.offset + hvcc.headerSize; // configVer(1) then profile space/tier/idc byte
            const hvccEnd = Math.min(hvcc.offset + hvcc.size, moovSize);
            const b1 = view.getUint8(d + 1);
            const tier = (b1 & 0x20) ? 'High' : 'Main';
            const profileIdc = b1 & 0x1f;
            const HEVC_PROFILES = { 1: 'Main', 2: 'Main 10', 3: 'Main Still Picture', 4: 'Range Ext' };
            if (HEVC_PROFILES[profileIdc]) v.profile = HEVC_PROFILES[profileIdc] + ' (' + tier + ')';
            // general_level_idc is at offset d+12 in hvcC.
            const levelIdc = view.getUint8(d + 12);
            if (levelIdc) v.level = (levelIdc / 30).toFixed(1);
            // chroma_format_idc (d+16, low 2 bits) and bit_depth_luma/chroma_minus8
            // (d+17 / d+18, low 3 bits each) are at fixed offsets in the hvcC record.
            if (d + 19 <= hvccEnd) {
              const b0 = view.getUint8(d + 16), b1 = view.getUint8(d + 17), b2 = view.getUint8(d + 18);
              // Reserved bits are all 1s in a real hvcC record; validating them
              // guards against misreading a truncated/odd box as exotic chroma or
              // high bit depth and wrongly flagging a playable file unplayable.
              if ((b0 & 0xFC) === 0xFC && (b1 & 0xF8) === 0xF8 && (b2 & 0xF8) === 0xF8) {
                const chromaIdc = b0 & 0x03;
                const depthLuma = (b1 & 0x07) + 8;
                const depthChroma = (b2 & 0x07) + 8;
                if (CHROMA_FORMATS[chromaIdc] !== undefined) v.chroma = CHROMA_FORMATS[chromaIdc];
                if (depthLuma >= 8 && depthLuma <= 16) v.bitDepth = Math.max(depthLuma, depthChroma);
              }
            }
          }
        }
      } catch (_) {}

      // Colour / HDR from a 'colr' box (nclx variant) within the sample entry,
      // plus presence of mastering-display (mdcv) / content-light (clli) boxes.
      try {
        // The sample-entry box spans [entryStart, entryStart+sampleEntryBox); colr/
        // mdcv/clli live inside it. Search the whole trak (cheap, harmless).
        const colr = findAllBoxes(view, entryStart, Math.min(entryStart + sampleEntryBox, moovSize), 'colr')[0]
                  || findAllBoxes(view, trakStart, trakEnd, 'colr')[0];
        if (colr) {
          const d = colr.offset + colr.headerSize;
          const colourType = fcc(view, d);
          if (colourType === 'nclx' && d + 10 <= moovSize) {
            const primaries = view.getUint16(d + 4);
            const transfer = view.getUint16(d + 6);
            const matrix = view.getUint16(d + 8);
            v.primaries = COLOUR_PRIMARIES[primaries] || ('code ' + primaries);
            v.transfer = TRANSFER_CHARS[transfer] || ('code ' + transfer);
            v.matrixCoef = matrix;
            // HDR detection: PQ (16) or HLG (18) transfer, typically with BT.2020.
            if (transfer === 16) v.hdr = 'PQ (' + (v.primaries) + ')';
            else if (transfer === 18) v.hdr = 'HLG (' + (v.primaries) + ')';
          }
        }
        if (findAllBoxes(view, trakStart, trakEnd, 'mdcv').length) v.mdcv = true;
        if (findAllBoxes(view, trakStart, trakEnd, 'clli').length) v.clli = true;
      } catch (_) {}

      result.video = v;
    } else if (isAudio && !result.audio) {
      const a = { codec: codecFcc, codecName: AUDIO_CODEC_NAMES[codecFcc] || codecFcc };
      try {
        // Audio sample entry: after the 8-byte box hdr + 8 reserved, channelcount
        // is a uint16, then samplesize, predefined, reserved, then sample rate.
        const base = entryStart + 8 + 8;
        if (base + 4 <= moovSize) {
          const channels = view.getUint16(base);
          if (channels > 0 && channels <= 24) a.channels = channels;
        }
      } catch (_) {}
      result.audio = a;
    }
  }

  // Movie duration (seconds) from mvhd, for the bitrate/duration readout when the
  // file can't be decoded by the browser.
  try {
    const mvhd = findAllBoxes(view, 8, moovSize, 'mvhd')[0];
    if (mvhd) {
      const d = mvhd.offset + mvhd.headerSize;
      const ver = view.getUint8(d);
      let timescale, duration;
      if (ver === 1) {
        timescale = view.getUint32(d + 20);
        duration = view.getUint32(d + 24) * 0x100000000 + view.getUint32(d + 28);
      } else {
        timescale = view.getUint32(d + 12);
        duration = view.getUint32(d + 16);
      }
      if (timescale > 0 && duration > 0) result.durationSec = duration / timescale;
    }
  } catch (_) {}

  if (!result.video && !result.audio) return null;
  return result;
}

// Append codec/rotation/HDR/audio-codec rows to an existing readout <table>,
// next to the resolution/fps rows. Only adds rows that were actually found.
// Wrapped by the caller in try/catch; itself defends against partial data.
function appendTrackRows(tbl, tracks) {
  if (!tracks) return;
  const v = tracks.video, a = tracks.audio;
  if (v) {
    if (v.codecName) {
      let label = v.codecName;
      const extra = [];
      if (v.profile) extra.push(v.profile);
      if (v.level) extra.push('L' + v.level);
      if (extra.length) label += '  (' + extra.join(', ') + ')';
      tbl.appendChild(rowHelp('Video codec', label,
        'The video compression format and (where available) its profile/level, read from the MP4/MOV sample-description and codec-config boxes. The profile/level indicate which encoding features and bitrate ceiling were used.'));
    }
    if (v.bitDepth) {
      let depthText = v.bitDepth + '-bit';
      if (v.chroma) depthText += '  ·  ' + v.chroma + ' chroma';
      tbl.appendChild(rowHelp('Bit depth', depthText,
        'Bits per colour sample and the chroma subsampling, read from the codec configuration. 8-bit is standard; 10-bit (e.g. Sony XAVC HS, HLG/HDR) stores finer gradients. 4:2:0 is normal delivery, 4:2:2 keeps more colour detail for grading. Browsers ship no decoder for 10-bit 4:2:2, so those files can be identified here but not played.'));
    }
    if (v.rotation) {
      const orient = (v.rotation === 90 || v.rotation === 270) ? 'portrait' : 'landscape';
      tbl.appendChild(rowHelp('Rotation', v.rotation + '°  (' + orient + ')',
        'A display rotation stored in the track header transform matrix. Phones record sensor-native orientation and add this flag so players rotate the picture upright on playback.'));
    }
    if (v.hdr) {
      let hdrText = v.hdr;
      if (v.mdcv || v.clli) hdrText += '  · ' + [v.mdcv ? 'mastering display' : '', v.clli ? 'content-light' : ''].filter(Boolean).join(' + ') + ' metadata';
      tbl.appendChild(rowHelp('HDR', hdrText,
        'High Dynamic Range signalling from the colour box: PQ (HDR10/Dolby Vision) or HLG transfer, usually with the wide BT.2020 colour gamut. Mastering-display / content-light metadata further describe the HDR grade.'));
    } else if (v.primaries && v.transfer && (v.primaries !== '-' || v.transfer !== '-')) {
      tbl.appendChild(rowHelp('Colour', v.primaries + ' · ' + v.transfer,
        'Colour primaries and transfer function (gamma) signalled in the MP4 colour box - they tell a player how to map the stored values to displayed colour. BT.709 is standard HD; BT.2020 is wide-gamut/UHD.'));
    }
  }
  if (a && a.codecName) {
    let label = a.codecName;
    if (a.channels) label += '  (' + (a.channels === 1 ? 'mono' : a.channels === 2 ? 'stereo' : a.channels + 'ch') + ')';
    tbl.appendChild(rowHelp('Audio codec', label,
      'The audio compression format and channel layout of the embedded sound track, read from the MP4/MOV sample-description box.'));
  }
}

// Shown when neither the off-screen probe nor a visible <video> can decode the
// file: the browser has no decoder for this codec (ProRes, DNxHD, uncompressed,
// etc.). Instead of a bare "couldn't load" error, surface the container/codec
// metadata read straight from the file, with a plain explanation of why it won't
// play and how to make it playable. Degrades gracefully for non-ISOBMFF files
// (shows name / size / container only).
async function renderUnplayableVideoInfo(file, header, resultsEl, signal) {
  let tracks = null;
  try { tracks = await detectIsobmffTracks(file); } catch (_) {}
  const v = tracks && tracks.video;
  const isPro = !!(v && PRO_VIDEO_CODECS.has(v.codec));
  const named = !!(v && v.codecName && v.codecName !== v.codec);

  const hiDepth = !!(v && v.bitDepth && v.bitDepth >= 10);
  let msg;
  if (isPro) {
    msg = (v.codecName || 'This codec') + ' is a professional editing / master format that no web browser can decode, so it can’t be played here. The file is fine - convert it to H.264 (MP4) to view it in a browser.';
  } else if (hiDepth) {
    const cf = (v.chroma && v.chroma !== '4:2:0') ? ' ' + v.chroma : '';
    msg = 'This is a ' + v.bitDepth + '-bit' + cf + ' ' + (v.codecName || 'video') + ' file - the kind Sony XAVC HS / FX-series, Canon and other cameras record. No web browser ships a decoder for high-bit-depth' + (cf ? ' 4:2:2' : '') + ' video, so it can’t be played here. The file is fine - convert it to 8-bit H.264 (MP4) to view it in a browser, or use the first-frame preview below.';
  } else if (named) {
    msg = 'Your browser has no decoder for this video’s codec (' + v.codecName + '), so it can’t be played here. The file itself is fine - converting it to H.264 (MP4) will make it playable.';
  } else {
    msg = 'Your browser can’t decode this video’s codec, so it can’t be played here. The file itself may be fine - converting it to H.264 (MP4) usually makes it playable.';
  }
  // Every codec that lands here is unplayable in any browser, but desktop players
  // are not so limited - point the user at VLC, which decodes virtually anything.
  msg += ' To play it now without converting, open it in a free desktop player like VLC (videolan.org), which handles virtually every codec.';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, msg));

  // File info first - it's available instantly from the header walk, with no
  // decode needed, so the page is useful immediately even for a huge file.
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', file.name));
  tbl.appendChild(row('Size', `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(rowHelp('MIME', file.type || '-', "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));
  if (header && header.container) tbl.appendChild(row('Container', header.container + (header.brand ? '  (' + header.brand + ')' : '')));
  if (v && v.width && v.height) {
    tbl.appendChild(row('Resolution', `${v.width} × ${v.height} px`));
    tbl.appendChild(row('Aspect ratio', aspectRatio(v.width, v.height)));
  }
  const dur = tracks && tracks.durationSec;
  if (dur && dur > 0) {
    tbl.appendChild(row('Duration', formatDuration(dur)));
    const bitrate = (file.size * 8 / dur / 1000).toFixed(0) + ' kbps  (' + (file.size * 8 / dur / 1_000_000).toFixed(2) + ' Mbps)';
    tbl.appendChild(rowHelp('Bitrate (total)', bitrate, 'Average data rate across the whole file - video, audio, and container overhead combined. Computed as file size ÷ duration, so it is an overall average, not the encoder’s target bitrate.'));
  }
  if (v && v.width && v.height) {
    tbl.appendChild(rowHelp('Frame size', ((v.width * v.height) / 1_000_000).toFixed(2) + ' MP', 'Pixels per frame in megapixels (width × height ÷ 1,000,000). A rough indicator of how much raw image data each frame holds before compression.'));
  }
  // Codec / rotation / HDR / audio-codec rows from the moov walk (best-effort).
  try { appendTrackRows(tbl, tracks); } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // Preview on demand. Decoding even a single frame from a codec the browser
  // can't play needs the ~31 MB FFmpeg WASM core and a single-threaded decode -
  // slow for big masters - so put it behind a button instead of auto-running.
  const prevCard = el('div', { class: 'anr-card' });
  prevCard.appendChild(el('h3', {}, 'Preview'));
  const prevHint = el('p', { class: 'anr-hint' }, 'No preview by default - the browser can’t decode this video. Extracting the first frame uses FFmpeg (~31 MB, downloaded once then cached).');
  prevCard.appendChild(prevHint);
  const grabBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Extract first frame');
  const grabRow = el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [grabBtn]);
  prevCard.appendChild(grabRow);
  grabBtn.addEventListener('click', async () => {
    grabBtn.disabled = true;
    const status = el('p', { class: 'anr-hint' }, 'Extracting the first frame with FFmpeg…');
    grabRow.replaceWith(status);
    try {
      const frame = await ffmpegFirstFrame(file, signal);
      if (signal && signal.aborted) return;
      if (!frame) { status.textContent = 'Could not extract a frame from this file.'; return; }
      status.remove();
      prevHint.remove();
      prevCard.appendChild(el('img', {
        src: URL.createObjectURL(frame.blob),
        alt: 'First frame of ' + file.name,
        style: 'max-width:100%; max-height:480px; display:block; border:1px solid var(--hairline); background:#0a0a0a;',
      }));
      prevCard.appendChild(el('p', { class: 'anr-hint' }, 'First frame of the video, decoded with FFmpeg since the browser can’t play this codec.'));
      const basename = (file.name || 'video').replace(/\.[^/.]+$/, '');
      const frameFile = new File([frame.blob], basename + '_frame.jpg', { type: 'image/jpeg' });
      const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
        const pr = revealPhotoSection();
        renderPhoto(frameFile, pr, { sourceNote: 'First frame extracted from ' + file.name + ' (the video itself can’t be decoded in the browser).' });
        scrollToPhoto();
      } }, 'Analyse in Photo section');
      prevCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [analyseBtn]));
    } catch (_) {
      status.textContent = 'Could not extract a frame from this file.';
    }
  });
  resultsEl.appendChild(prevCard);

  // SHA-256 reads the whole file, so compute it automatically only for small
  // videos; for big ones put it behind a button so the page isn't held up.
  const SHA_AUTO_MAX = 200 * 1024 * 1024;
  if (file.size <= SHA_AUTO_MAX) {
    resultsEl.appendChild(integrityCard(file));
  } else if (file.size <= 2 * 1024 * 1024 * 1024) {
    const hashCard = el('div', { class: 'anr-card' });
    hashCard.appendChild(el('h3', {}, 'Integrity'));
    hashCard.appendChild(el('p', { class: 'anr-hint' }, 'SHA-256 reads the whole file (' + fmtBytes(file.size) + '), so it isn’t computed automatically for large videos.'));
    const hashBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Compute SHA-256');
    hashBtn.addEventListener('click', () => { hashCard.replaceWith(integrityCard(file)); });
    hashCard.appendChild(el('div', { class: 'anr-btn-row', style: 'margin-top:8px;' }, [hashBtn]));
    resultsEl.appendChild(hashCard);
  }
}

async function detectFpsWithFfmpeg(file, onProgress) {
  const ff = await loadFFmpeg(onProgress);
  const { fetchFile } = await import(new URL('../../vendor/ffmpeg/ffmpeg-util.js', import.meta.url).href);
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

  // ---- Reverse playback (re-encode the video backwards, on demand) ----
  resultsEl.appendChild(buildReverseVideoCard(file, signal));

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
  // Codec / rotation / HDR / audio-codec from the ISOBMFF moov walk (best-effort).
  try {
    if (header && (/^(MP4|M4V|QuickTime MOV|3GP|3G2)/.test(header.container || '') || /MP4 \//.test(header.container || ''))) {
      const tracks = await detectIsobmffTracks(file);
      appendTrackRows(tbl, tracks);
    }
  } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.insertBefore(infoCard, playerCard);

  // Detect FPS
  let detectedFps = 30;
  const fpsCell = fpsRow.querySelector('td');
  let frameControls = null;
  detectFps(file, fpsCell).then((fps) => {
    fpsCell.textContent = fps != null ? fps + ' fps' : 'N/A';
    if (fps != null) { detectedFps = fps; if (frameControls) frameControls.refresh(); }
  });

  // Frame-by-frame navigation, editable timecode, and frame grab (shared helper).
  if (vw && vh) {
    frameControls = buildFrameControls(playerEl, () => detectedFps, file);
    playerCard.appendChild(frameControls.wrap);
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
      sheetOut.appendChild(sheetImg(gc.toDataURL('image/png')));
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

  // Audio extraction (into Sound section) - gated behind an "Analyse audio" button.
  const audioResultsEl = document.getElementById('audioResults');
  if (audioResultsEl) mountAudioAnalyseButton(audioResultsEl, async () => {
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
      audioResultsEl.appendChild(buildReverseAudioCard(audioBuf, (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio', signal));
      const at = el('table', { class: 'anr-readout' });
      at.appendChild(row('Duration', formatDuration(audioBuf.duration)));
      at.appendChild(rowHelp('Sample rate', audioBuf.sampleRate.toLocaleString() + ' Hz', 'Audio samples captured per second, in hertz - e.g. 48000 Hz means 48,000 amplitude readings per second of sound.'));
      at.appendChild(rowHelp('Channels', audioBuf.numberOfChannels, 'Number of separate audio channels: 1 = mono, 2 = stereo (left + right), more for surround.'));
      at.appendChild(rowHelp('Peak', stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)', 'Highest sample amplitude.'));
      at.appendChild(rowHelp('RMS', stats.rms.toFixed(3) + '  (' + stats.rmsDb.toFixed(1) + ' dBFS)', 'Root Mean Square - average signal power.'));
      at.appendChild(rowHelp('Samples', mono.length.toLocaleString(), 'Total number of individual amplitude values in the (channel-merged mono) signal - roughly sample rate × duration.'));
      audioCard.appendChild(at);
      audioResultsEl.appendChild(buildWaveformCard(file, mono, audioBuf, audioPlayer));
      audioResultsEl.appendChild(buildHistogramCard(mono));
      const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
      audioResultsEl.appendChild(makeSpectrogramPanel(mono, audioBuf.sampleRate, { basename, audioEl: audioPlayer, signal }));
    } catch (e) {
      audioStatus.remove();
      audioCard.appendChild(el('p', { class: 'anr-hint' }, 'Audio decode failed: ' + (e && e.message || 'unknown error')));
    }
  });

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

export async function renderVideo(file, resultsEl, opts = {}) {
  if (videoRenderAbort) videoRenderAbort.abort();
  videoRenderAbort = new AbortController();
  const renderSignal = videoRenderAbort.signal;

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Loading "${file.name}"…`));


  let header = {};
  try { header = await peekVideoContainer(file); } catch (_) {}

  // Raw H.264 / H.265 elementary stream: no container, so the browser can't open
  // it. FFmpeg stream-copies it into an MP4 (no re-encode, a second or two), and
  // we then render THAT through the normal playable path - real player, frame
  // tools, codec/profile readout and all. The original .h264 is still shown for
  // name / size / hash via opts.sourceFile. On failure (FFmpeg offline, or a
  // stream it won't copy) we fall back to the unplayable-info path.
  const looksRaw = header.raw === 'h264' || header.raw === 'h265' ||
    /\.(h?264|avc|h?265|hevc)$/i.test(file.name || '');
  if (!opts.remuxed && looksRaw) {
    const kind = header.raw === 'h265' || /\.(h?265|hevc)$/i.test(file.name || '') ? 'H.265' : 'H.264';
    // The remux holds the whole input AND the whole output MP4 in WASM memory, so
    // very large streams can't fit (the 32-bit core caps out near ~2 GB). Above the
    // limit, split the stream at keyframes and play it part-by-part instead.
    const REMUX_MAX = 1_400 * 1024 * 1024;
    if (file.size > REMUX_MAX) {
      try {
        await renderSegmentedRawVideo(file, header, resultsEl, kind, renderSignal);
      } catch (e) {
        if (renderSignal.aborted) return;
        resultsEl.innerHTML = '';
        await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
        resultsEl.appendChild(el('div', { class: 'anr-card' }, [
          el('p', {}, 'This raw ' + kind + ' stream is ' + fmtBytes(file.size) + ' - too large to remux in one piece, and '
            + 'splitting it into parts failed (' + ((e && e.message) || e) + '). Open it in VLC, or wrap it with desktop ffmpeg: '
            + 'ffmpeg -i "' + (file.name || 'input.h264') + '" -c copy out.mp4.')
        ]));
      }
      return;
    }
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-info' },
      'Raw ' + kind + ' elementary stream - remuxing to MP4 with FFmpeg so it plays in the browser…'));
    let mp4Blob = null, remuxLog = '';
    const rawKind = kind === 'H.265' ? 'h265' : 'h264';
    try {
      const r = await ffmpegRemuxToMp4(file, renderSignal, rawKind);
      mp4Blob = r && r.blob;
      remuxLog = (r && r.log) || '';
    } catch (e) {
      remuxLog = (e && e.message) ? ('FFmpeg could not load: ' + e.message) : String(e);
    }
    if (renderSignal.aborted) return;
    if (mp4Blob) {
      const base = (file.name || 'video').replace(/\.[^/.]+$/, '');
      const mp4File = new File([mp4Blob], base + '.mp4', { type: 'video/mp4' });
      return renderVideo(mp4File, resultsEl, { remuxed: true, sourceFile: file, sourceKind: kind, noAudio: true });
    }
    resultsEl.innerHTML = '';
    await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
    // Surface WHY the remux produced nothing instead of failing silently - the
    // FFmpeg log (or load error) makes a genuine failure diagnosable.
    if (!renderSignal.aborted) {
      const tail = remuxLog.split('\n').map((s) => s.trim()).filter(Boolean).slice(-14).join('\n');
      const diag = el('details', { class: 'anr-card' });
      diag.appendChild(el('summary', { style: 'cursor:pointer;' }, 'In-browser remux to MP4 didn’t produce a file - details'));
      diag.appendChild(el('pre', { style: 'white-space:pre-wrap; word-break:break-word; font-size:12px; margin:8px 0 0; overflow:auto;' },
        tail || 'FFmpeg produced no output and emitted no log (it may be offline or blocked).'));
      resultsEl.appendChild(diag);
    }
    return;
  }

  // Up-front gate for codecs that load their metadata cleanly but can never
  // actually decode in a browser: 4:2:2 / 4:4:4 chroma (e.g. Sony XAVC HS /
  // FX-series 10-bit 4:2:2) and 12-bit+ video. For these the <video> element
  // fires loadeddata / loadedmetadata - so the probe and the visible fallback
  // both "succeed" - yet only ever paint a black, empty player with no error
  // event, so the code would otherwise never reach the unplayable path that
  // explains the limitation and recommends VLC. Route them there directly.
  // (10-bit 4:2:0 and pro/intermediate codecs still go through the probe, since
  // some browsers/devices can decode them.)
  try {
    if (/MP4|MOV|M4V|3GP|3G2|QuickTime/i.test(header.container || '')) {
      const earlyTracks = await detectIsobmffTracks(file);
      const ev = earlyTracks && earlyTracks.video;
      if (ev && (ev.chroma === '4:2:2' || ev.chroma === '4:4:4' || (ev.bitDepth && ev.bitDepth >= 12))) {
        resultsEl.innerHTML = '';
        await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
        return;
      }
    }
  } catch (_) {}

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
    // AVI never plays reliably through <video> - it's typically Motion-JPEG or DV,
    // for which browsers ship no decoder. Depending on the browser the probe either
    // errors, times out, or "loads" and paints a black frame (so the player looks
    // broken / wrongly trips the unplayable banner). Skip it entirely and let our
    // own AVI parser render the frames + extracted audio (the catch block below).
    if (header.container === 'AVI') throw new Error('avi-use-parser');
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
        'Your browser cannot play this codec. Analysis extracted from file data. ' +
        'To play it now, open it in a free desktop player like VLC (videolan.org), which handles virtually every codec.'));

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
      // infoCard is appended AFTER the Frames card below, so frames lead.

      let aviData = null;
      try { aviData = await extractAviData(file, avi); } catch (_) {}

      // MJPEG frame viewer. Only show it when the extracted chunks are genuine
      // JPEGs (SOI marker FF D8) - a non-MJPEG AVI (DV, etc.) yields raw chunks
      // that aren't displayable images, so skip the viewer and just show metadata.
      const framesAreJpeg = aviData && aviData.videoFrames.length &&
        new Uint8Array(aviData.videoFrames[0].slice(0, 2))[0] === 0xFF &&
        new Uint8Array(aviData.videoFrames[0].slice(0, 2))[1] === 0xD8;
      if (framesAreJpeg) {
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
        let onFrameShown = null;   // set by the playback controls to sync the scrubber
        const frameLabel = el('span', { class: 'anr-hint' }, `Frame 1 / ${frames.length}`);
        function showFrame(idx) {
          currentFrame = idx;
          URL.revokeObjectURL(frameImg.src);
          frameImg.src = URL.createObjectURL(new Blob([frames[idx]], { type: 'image/jpeg' }));
          frameImg.alt = `Frame ${idx + 1}`;
          frameLabel.textContent = `Frame ${idx + 1} / ${frames.length}`;
          if (onFrameShown) onFrameShown(idx);
        }

        const lastIdx = frames.length - 1;
        const fps = (avi.fps && avi.fps > 0 && avi.fps <= 120) ? avi.fps : 15;
        const frameMs = 1000 / fps;
        const fmtTc = (sec) => formatDuration(sec);

        // The AVI's own PCM audio (when present) plays in sync with the frames -
        // it becomes the master clock and the frames follow it. Same decoded PCM
        // the Sound section offers; encoded to a WAV the <audio> element can play.
        const hasAudio = !!(aviData && aviData.audioBuffer);
        let frameAudioEl = null, audioDur = 0;
        if (hasAudio) {
          const wavUrl = URL.createObjectURL(encodeWav(aviData.audioBuffer));
          frameAudioEl = el('audio', { src: wavUrl });
          frameAudioEl.style.display = 'none';
          frameAudioEl.loop = true;
          audioDur = aviData.audioBuffer.duration;
          frameCard.appendChild(frameAudioEl);
          renderSignal.addEventListener('abort', () => { try { frameAudioEl.pause(); } catch (_) {} URL.revokeObjectURL(wavUrl); });
        }
        const totalTime = hasAudio ? audioDur : frames.length / fps;
        // Timestamp of a frame. With sound we spread the frames evenly across the
        // audio's real duration (so they stay synced even if the header frame rate
        // is missing or wrong); silent clips use the nominal fps.
        const frameTimeOf = (idx) => hasAudio
          ? (lastIdx > 0 ? (idx / lastIdx) * audioDur : 0)
          : idx / fps;
        const frameAtTime = (t) => hasAudio
          ? Math.round((audioDur > 0 ? t / audioDur : 0) * lastIdx)
          : Math.round(t * fps);

        // Seek to a frame, keeping the audio clock aligned to it.
        const seekToFrame = (idx) => {
          idx = Math.max(0, Math.min(lastIdx, idx));
          if (hasAudio) { try { frameAudioEl.currentTime = Math.min(audioDur, frameTimeOf(idx)); } catch (_) {} }
          showFrame(idx);
        };

        const prevBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => seekToFrame(currentFrame - 1) }, '← Prev');
        const nextBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => seekToFrame(currentFrame + 1) }, 'Next →');
        const analyseBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
          const blob = new Blob([frames[currentFrame]], { type: 'image/jpeg' });
          const frameFile = new File([blob], `frame_${currentFrame}.jpg`, { type: 'image/jpeg' });
          const photoResults = document.getElementById('photoResults');
          if (photoResults) {
            renderPhoto(frameFile, photoResults);
            scrollToPhoto();
          }
        }}, 'Analyse frame');
        // Frame grab: download the current JPEG frame as-is.
        const grabBtn = el('button', { type: 'button', class: 'anr-btn', onclick: () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([frames[currentFrame]], { type: 'image/jpeg' }));
          a.download = (file.name || 'video').replace(/\.[^.]+$/, '') + `_frame_${currentFrame}.jpg`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        }}, 'Frame grab');

        // Contact sheet (>= 8 frames) - built here so it shares the action row.
        let sheetBtn = null;
        const sheetOut = el('div');
        if (frames.length >= 8) {
          sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
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
            sheetOut.appendChild(sheetImg(gridCanvas.toDataURL('image/png')));
            sheetBtn.disabled = false;
            sheetBtn.textContent = 'Generate contact sheet';
          });
        }

        // Analyse frame · Frame grab · Generate contact sheet - all one row.
        const actionBtns = [analyseBtn, grabBtn];
        if (sheetBtn) actionBtns.push(sheetBtn);
        const actionRow = el('div', { class: 'anr-btn-row', style: 'margin-top:10px;' }, actionBtns);

        // A single still has nothing to play or scrub - just the action row.
        // Multiple frames get a real transport (play / scrub / time) plus frame
        // stepping, built below.
        if (frames.length === 1) {
          frameCard.appendChild(actionRow);
        } else {
          // Frame playback: the browser can't decode MJPEG-in-AVI, so step through
          // the already-extracted JPEG frames. With sound, the AVI's audio is the
          // master clock and the frames follow it; silent clips step on an fps
          // timer and loop. Either way every tick decodes a full JPEG, so a big,
          // fast, long clip can hit the CPU hard; warn when that's likely.
          const mpPerSec = ((avi.width * avi.height) / 1_000_000) * fps;
          const heavy = mpPerSec > 120 || frames.length > 600;

          // Reuse the site's stylised transport (.anr-player) - the same play
          // button, draggable fill track and time readout the audio/video players
          // use - driven by the frame index (and the audio clock when present).
          const playBtn = el('button', { type: 'button', class: 'anr-player-play', 'aria-label': 'Play' }, '▶');
          const fillEl = el('div', { class: 'anr-player-fill' });
          const trackEl = el('div', { class: 'anr-player-track' }, [fillEl]);
          const timeEl = el('span', { class: 'anr-player-time' }, `${fmtTc(0)} / ${fmtTc(totalTime)}`);
          const playerBar = el('div', { class: 'anr-player', style: 'margin-top:10px;' }, [playBtn, trackEl, timeEl]);

          let playing = false;
          let rafId = 0;
          let lastTs = 0;
          // Runtime frame drops: when decoding/painting a JPEG can't keep up with the
          // target rate, playback has to skip ahead to stay in sync. We count those
          // skipped frames and surface them on the counter line (hidden at zero).
          let droppedFrames = 0;
          const dropOut = el('span', { class: 'anr-frame-drops', hidden: 'hidden' }, '');
          const bumpDrops = (n) => {
            if (!playing || n <= 0) return;
            if (n > fps * 2) return;   // a multi-second leap is a tab-switch/seek, not a decode hiccup
            droppedFrames += n;
            dropOut.hidden = false;
            dropOut.textContent = ` · ${droppedFrames} dropped`;
          };
          const setFrameFromTime = (t) => {
            const idx = Math.max(0, Math.min(lastIdx, frameAtTime(t)));
            if (idx !== currentFrame) {
              bumpDrops(idx - currentFrame - 1);   // a forward jump past +1 means frames were skipped
              showFrame(idx);
            }
          };
          const stop = () => {
            playing = false;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            if (hasAudio) { try { frameAudioEl.pause(); } catch (_) {} }
            playBtn.textContent = '▶';
            playBtn.setAttribute('aria-label', 'Play');
          };
          const loop = (ts) => {
            if (!playing) return;
            if (hasAudio) {
              setFrameFromTime(frameAudioEl.currentTime);   // audio drives the frame
            } else if (ts - lastTs >= frameMs) {
              // Catch up to wall-clock: advance as many frames as actually elapsed
              // (carrying the sub-frame remainder) so a slow tick skips ahead and
              // stays in real time rather than drifting. Each extra step is a drop.
              const steps = Math.floor((ts - lastTs) / frameMs);
              lastTs += steps * frameMs;
              bumpDrops(steps - 1);
              const next = currentFrame + steps;
              showFrame(next > lastIdx ? next % (lastIdx + 1) : next);
            }
            rafId = requestAnimationFrame(loop);
          };
          playBtn.addEventListener('click', () => {
            if (playing) { stop(); return; }
            playing = true;
            lastTs = 0;
            droppedFrames = 0; dropOut.hidden = true; dropOut.textContent = '';
            playBtn.textContent = '❚❚';
            playBtn.setAttribute('aria-label', 'Pause');
            if (hasAudio) {
              if (frameAudioEl.currentTime >= audioDur - 0.05) { try { frameAudioEl.currentTime = 0; } catch (_) {} }
              frameAudioEl.play().catch(() => {});
            }
            rafId = requestAnimationFrame((ts) => { lastTs = ts; loop(ts); });
          });

          // Click or drag the track to seek frames (and audio) together - the same
          // gesture as the audio/video scrubber (makePlayer). Window listeners live
          // only during a drag so they don't pile up across files.
          const seekFromX = (clientX) => {
            const rect = trackEl.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            seekToFrame(Math.round(frac * lastIdx));
          };
          let dragging = false;
          const onMove = (e) => { if (dragging) seekFromX(e.clientX); };
          const onUp = () => { dragging = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          trackEl.addEventListener('mousedown', (e) => {
            dragging = true; stop(); seekFromX(e.clientX); e.preventDefault();
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
          });
          const onTMove = (e) => { if (dragging && e.touches[0]) { e.preventDefault(); seekFromX(e.touches[0].clientX); } };
          const onTEnd = () => { dragging = false; window.removeEventListener('touchmove', onTMove); window.removeEventListener('touchend', onTEnd); };
          trackEl.addEventListener('touchstart', (e) => {
            dragging = true; stop(); seekFromX(e.touches[0].clientX); e.preventDefault();
            window.addEventListener('touchmove', onTMove, { passive: false }); window.addEventListener('touchend', onTEnd);
          }, { passive: false });

          // Keep the fill, counter and timecode in step with every frame change
          // (play, Prev/Next, or a direct seek). Time is the frame's own timestamp.
          onFrameShown = (idx) => {
            const t = frameTimeOf(idx);
            fillEl.style.width = (totalTime > 0 ? Math.min(1, t / totalTime) * 100 : 0) + '%';
            timeEl.textContent = `${fmtTc(t)} / ${fmtTc(totalTime)}`;
          };
          // Tearing down the render (new file / navigation) must kill the loop.
          renderSignal.addEventListener('abort', stop);

          frameCard.appendChild(playerBar);

          // Sound toggle: when the AVI carries PCM audio it stays the master clock
          // either way (so the frames keep their sync); this only mutes/unmutes what
          // you hear. Same segmented control the rest of the site uses.
          if (hasAudio) {
            const soundToggle = el('div', { class: 'anr-toggle' });
            const soundOnBtn = el('button', { type: 'button', class: 'is-active' }, 'SOUND');
            const soundOffBtn = el('button', { type: 'button' }, 'MUTED');
            soundToggle.appendChild(soundOnBtn); soundToggle.appendChild(soundOffBtn);
            const setSound = (on) => {
              frameAudioEl.muted = !on;
              soundOnBtn.classList.toggle('is-active', on);
              soundOffBtn.classList.toggle('is-active', !on);
            };
            soundOnBtn.addEventListener('click', () => setSound(true));
            soundOffBtn.addEventListener('click', () => setSound(false));
            frameCard.appendChild(el('div', { style: 'margin-top:8px; text-align:center;' }, [soundToggle]));
          }

          // Frame counter + rate (and whether sound is along for the ride), centered.
          frameCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:4px; text-align:center;' },
            [frameLabel, document.createTextNode(` · ${fps} fps${hasAudio ? '' : ' · loop'}`), dropOut]));
          // Symmetric frame stepping: Prev | Next.
          frameCard.appendChild(el('div', { class: 'anr-frame-grid', style: 'margin-top:10px;' }, [prevBtn, nextBtn]));
          if (heavy) {
            frameCard.appendChild(el('p', { class: 'anr-hint', style: 'margin-top:8px; color: var(--accent);' },
              '⚠ Heavy playback: this clip is large enough (' +
              (avi.width + '×' + avi.height) + ' at ' + fps + ' fps) that looping every frame ' +
              'decodes a full JPEG each tick and may stutter or spike CPU. Step through with Prev / Next if it struggles.'));
          }
          frameCard.appendChild(actionRow);
        }
        // Contact-sheet output (if any) lands under the action row.
        frameCard.appendChild(sheetOut);
        resultsEl.appendChild(frameCard);

        // ---- Reverse playback (re-encode the AVI backwards, on demand) ----
        // The MJPEG frames + PCM are in memory, but a downloadable reversed video
        // needs a real file, so re-encode the original AVI to a reversed H.264 MP4
        // (picture + sound) with FFmpeg - same path as the normal player.
        if (frames.length > 1) resultsEl.appendChild(buildReverseVideoCard(file, renderSignal));

        // First frame - gated behind an "Analyse photo" button.
        const photoResultsEl = document.getElementById('photoResults');
        if (photoResultsEl) {
          const blob = new Blob([frames[0]], { type: 'image/jpeg' });
          const frameFile = new File([blob], 'frame_0.000s.jpg', { type: 'image/jpeg' });
          mountPhotoAnalyseButton(photoResultsEl, () => renderPhoto(frameFile, photoResultsEl));
        }
      }

      // File info comes AFTER the Frames section (frames lead).
      resultsEl.appendChild(infoCard);

      // Audio from direct PCM extraction - gated behind an "Analyse audio" button.
      const audioResultsEl = document.getElementById('audioResults');
      if (audioResultsEl && aviData && aviData.audioBuffer) mountAudioAnalyseButton(audioResultsEl, () => {
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
        audioResultsEl.appendChild(buildReverseAudioCard(audioBuf, (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio', renderSignal));

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
        audioResultsEl.appendChild(audioCard);

        audioResultsEl.appendChild(buildWaveformCard(file, mono, audioBuf, audioPlayer));
        audioResultsEl.appendChild(buildHistogramCard(mono));
        const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
        audioResultsEl.appendChild(makeSpectrogramPanel(mono, audioBuf.sampleRate, { basename, audioEl: audioPlayer, signal: renderSignal }));
      });

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

    // The browser genuinely can't decode this codec (ProRes, DNxHD, etc.). Show
    // the container/codec metadata and a clear explanation instead of a bare error,
    // and try to pull the first visible frame out with FFmpeg.
    await renderUnplayableVideoInfo(file, header, resultsEl, renderSignal);
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

  // First frame into the photo section - gated behind an "Analyse photo" button.
  // The frame is grabbed from the probe now (it sits at frame 0 at this point;
  // later scene detection may seek it away), but only rendered on click.
  const photoResultsEl = document.getElementById('photoResults');
  if (photoResultsEl && vw && vh) {
    const fcv = document.createElement('canvas');
    fcv.width = vw; fcv.height = vh;
    fcv.getContext('2d').drawImage(probe, 0, 0, vw, vh);
    fcv.toBlob(blob => {
      if (!blob) return;
      const frameFile = new File([blob], `frame_0.000s.png`, { type: 'image/png' });
      mountPhotoAnalyseButton(photoResultsEl, () => {
        let lastPhotoHeight = photoResultsEl.offsetHeight;
        const photoScrollComp = new ResizeObserver(() => {
          const newHeight = photoResultsEl.offsetHeight;
          const delta = newHeight - lastPhotoHeight;
          if (delta > 0) window.scrollBy(0, delta);
          lastPhotoHeight = newHeight;
        });
        photoScrollComp.observe(photoResultsEl);
        renderSignal.addEventListener('abort', () => photoScrollComp.disconnect());
        renderPhoto(frameFile, photoResultsEl);
      });
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

  // ---- Frame-by-frame navigation, editable timecode, and frame grab ----
  let detectedFps = 30;
  const frameControls = buildFrameControls(playerEl, () => detectedFps, file);
  playerCard.appendChild(frameControls.wrap);

  resultsEl.appendChild(playerCard);

  // ---- Reverse playback (re-encode the video backwards, on demand) ----
  resultsEl.appendChild(buildReverseVideoCard(file, renderSignal));

  // ---- File info ----
  // For a remuxed raw stream, show the ORIGINAL file's name/size/MIME (and base
  // the bitrate on it) - the .mp4 we built is just a playback wrapper.
  const infoFile = opts.sourceFile || file;
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name', infoFile.name));
  tbl.appendChild(row('Size', `${fmtBytes(infoFile.size)}   (${infoFile.size.toLocaleString()} bytes)`));
  tbl.appendChild(rowHelp('MIME', infoFile.type || '-', "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));
  if (opts.sourceFile)
    tbl.appendChild(rowHelp('Source', 'Raw ' + (opts.sourceKind || 'H.264') + ' (Annex B)',
      'A raw ' + (opts.sourceKind || 'H.264') + ' elementary stream has no container, so Analyser stream-copied it into an MP4 in-browser (no re-encode) to play it. The stream carries no timing, so the frame rate and duration are assumed at 25 fps.'));
  if (header.container)
    tbl.appendChild(row('Container', (opts.sourceFile ? 'Raw ' + (opts.sourceKind || 'H.264') + ' → MP4 (remuxed)' : header.container + (header.brand ? '  (' + header.brand + ')' : ''))));
  tbl.appendChild(row('Resolution', vw && vh ? `${vw} × ${vh} px` : '-'));
  tbl.appendChild(row('Aspect ratio', aspectRatio(vw, vh)));
  tbl.appendChild(row('Duration', isFinite(dur) ? formatDuration(dur) + (opts.sourceFile ? ' (assumed 25 fps)' : '') : '-'));
  const bitrate = isFinite(dur) && dur > 0
    ? (infoFile.size * 8 / dur / 1000).toFixed(0) + ' kbps  (' + (infoFile.size * 8 / dur / 1_000_000).toFixed(2) + ' Mbps)'
    : '-';
  tbl.appendChild(rowHelp('Bitrate (total)', bitrate, 'Average data rate across the whole file - video, audio, and container overhead combined. Computed as file size ÷ duration, so it is an overall average, not the encoder’s target bitrate.'));
  const fpsRow = row('Frame rate', 'detecting…');
  tbl.appendChild(fpsRow);
  if (vw && vh) {
    const mp = ((vw * vh) / 1_000_000).toFixed(2);
    tbl.appendChild(rowHelp('Frame size', mp + ' MP', 'Pixels per frame in megapixels (width × height ÷ 1,000,000). A rough indicator of how much raw image data each frame holds before compression.'));
  }
  // Codec / rotation / HDR / audio-codec from the ISOBMFF moov walk (mp4/mov/
  // m4v/3gp). Best-effort and fully guarded so it never affects fps/preview.
  try {
    if (/^(MP4|M4V|QuickTime MOV|3GP|3G2)/.test(header.container || '') || /MP4 \//.test(header.container || '')) {
      const tracks = await detectIsobmffTracks(file);
      appendTrackRows(tbl, tracks);
    }
  } catch (_) {}
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  const fpsCell = fpsRow.querySelector('td');
  detectFps(file, fpsCell).then((fps) => {
    fpsCell.textContent = fps != null ? fps + ' fps' : 'N/A';
    if (fps != null) { detectedFps = fps; frameControls.refresh(); }
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
    // Marked so the data export can find this card and force the sheet to be
    // generated (via _anrEnsure below) before it scrapes the page.
    sheetCard.classList.add('anr-contact-sheet-card');
    const sheetBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Generate contact sheet');
    const sheetOut = el('div');

    async function buildSheet() {
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

      const url = gridCanvas.toDataURL('image/png');
      sheetOut.innerHTML = '';
      sheetOut.appendChild(sheetImg(url));

      const saveBtn = el('button', { type: 'button', class: 'anr-btn', style: 'margin-top:8px;', onclick: () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_contact_sheet.png';
        a.click();
      }}, 'Save as PNG');
      sheetOut.appendChild(saveBtn);
    }

    // Generate at most once; reuse the in-flight or finished promise. The button
    // and the data export both go through this.
    let sheetDone = false, sheetPromise = null;
    function ensureSheet() {
      if (sheetDone) return Promise.resolve();
      if (sheetPromise) return sheetPromise;
      sheetBtn.disabled = true;
      sheetBtn.textContent = 'Generating…';
      sheetPromise = buildSheet()
        .then(() => { sheetDone = true; })
        .catch(() => { sheetPromise = null; })
        .finally(() => { sheetBtn.disabled = false; sheetBtn.textContent = 'Generate contact sheet'; });
      return sheetPromise;
    }
    sheetBtn.addEventListener('click', ensureSheet);
    sheetCard._anrEnsure = ensureSheet;

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
  // Gated behind an "Analyse audio" button so a full decode + spectrogram only
  // runs when the user asks for it, not automatically on every video.
  // (Skipped for raw H.264/H.265, which is a video-only elementary stream.)
  const audioResultsEl = document.getElementById('audioResults');
  if (audioResultsEl && !opts.noAudio) mountAudioAnalyseButton(audioResultsEl, async () => {
    audioResultsEl.hidden = false;

    // (No scroll compensation here: clicking "Analyse audio" deliberately scrolls
    // to the top of the Sound section, so keeping the video section pinned in view
    // - the old behaviour - would fight that and leave the view drifting down past
    // the audio heading as the heavy spectrogram content loads in.)

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
      audioResultsEl.appendChild(buildReverseAudioCard(audioBuf, (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio', renderSignal));

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

      // Waveform - its own card with region selection, zoom, WAV export and the
      // smooth grabbable playhead, shared with the standalone audio renderer
      // (buildWaveformCard in audio.js) rather than a stripped-down local copy.
      audioResultsEl.appendChild(buildWaveformCard(file, mono, audioBuf, audioPlayer));

      // Amplitude histogram (same labeled card the audio module uses)
      audioResultsEl.appendChild(buildHistogramCard(mono));

      // Spectrogram (with playhead + click-to-seek)
      const basename = (file.name || 'video').replace(/\.[^/.]+$/, '') + '_audio';
      audioResultsEl.appendChild(makeSpectrogramPanel(mono, audioBuf.sampleRate, { basename, audioEl: audioPlayer, signal: renderSignal }));
    } catch (e) {
      console.warn('Audio extraction failed:', e);
      audioStatus.remove();
      audioCard.appendChild(el('p', { class: 'anr-hint' },
        'Audio decode failed: ' + (e && e.message || 'unknown error') + '. Try converting to MP4 (H.264 + AAC).'));
    }
  });

  // ---- SHA-256 ----
  // Hash the ORIGINAL bytes (the raw .h264), not the remuxed MP4 wrapper.
  const hashFile = opts.sourceFile || file;
  if (hashFile.size <= 500 * 1024 * 1024) {
    const hashCard = el('div', { class: 'anr-card' });
    const [vhH, vhHelp] = h3help('Integrity', '<strong>SHA-256</strong> is a cryptographic hash of the raw file bytes. Any change to the file, even one bit, produces a completely different hash. Useful for verifying a file has not been tampered with.');
    hashCard.appendChild(vhH); hashCard.appendChild(vhHelp);
    const hashTbl = el('table', { class: 'anr-readout' });
    hashTbl.appendChild(sha256Row(hashFile));
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
