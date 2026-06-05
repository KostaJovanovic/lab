/* Analyser - audio transport/player
   A small custom <audio> transport: play/pause button, a draggable seek track
   with a fill, and a current/total time readout. Built around any media element
   (the audio module's hidden <audio>, or a video's extracted-audio element).
   Drag listeners are attached on press and removed on release so they don't pile
   up as new files are analysed. Used by audio.js and (via re-export) video.js. */

import { el } from '../core/util.js';

export function makePlayer(mediaEl, knownDuration) {
  // MediaRecorder blobs (recorded audio) are written without a duration header, so
  // mediaEl.duration is Infinity until the clip is played/seeked to the end. When the
  // caller knows the real length (e.g. from decodeAudioData), use it as a fallback so
  // the total shows immediately instead of 0:00. durationchange (below) picks up the
  // browser's real value once it learns it.
  function dur() {
    const d = mediaEl.duration;
    if (isFinite(d) && d > 0) return d;
    return (typeof knownDuration === 'number' && isFinite(knownDuration)) ? knownDuration : 0;
  }
  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  const playBtn = el('button', { type: 'button', class: 'anr-player-play' }, '▶');
  const fillEl = el('div', { class: 'anr-player-fill' });
  const trackEl = el('div', { class: 'anr-player-track' }, [fillEl]);
  const timeEl = el('span', { class: 'anr-player-time' }, '0:00 / 0:00');
  const container = el('div', { class: 'anr-player' }, [playBtn, trackEl, timeEl]);

  playBtn.addEventListener('click', () => {
    if (mediaEl.paused) mediaEl.play(); else mediaEl.pause();
  });
  mediaEl.addEventListener('play', () => { playBtn.textContent = '❚❚'; tick(); });
  mediaEl.addEventListener('pause', () => { playBtn.textContent = '▶'; });
  mediaEl.addEventListener('ended', () => { playBtn.textContent = '▶'; });

  let dragging = false;
  function scrub(clientX) {
    const rect = trackEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    fillEl.style.width = (frac * 100) + '%';
    const d = dur();
    // Set currentTime directly. The browser coalesces rapid seeks during a drag;
    // an explicit seeking-gate could get stuck (a no-op seek never fires 'seeked',
    // especially with two players sharing one element) and then block all scrubs.
    if (d > 0) mediaEl.currentTime = frac * d;
  }
  // Window listeners are added on press and removed on release so they don't
  // pile up across files.
  function onMouseMove(e) { if (dragging) { scrub(e.clientX); tick(); } }
  function onMouseUp() {
    dragging = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }
  trackEl.addEventListener('mousedown', (e) => {
    dragging = true; scrub(e.clientX); e.preventDefault();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
  function onTouchMove(e) { if (dragging && e.touches[0]) { scrub(e.touches[0].clientX); tick(); } }
  function onTouchEnd() {
    dragging = false;
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  }
  trackEl.addEventListener('touchstart', (e) => {
    dragging = true; scrub(e.touches[0].clientX); e.preventDefault();
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }, { passive: false });

  function tick() {
    const d = dur();
    const pct = d > 0 ? (mediaEl.currentTime / d) * 100 : 0;
    fillEl.style.width = pct + '%';
    timeEl.textContent = fmt(mediaEl.currentTime) + ' / ' + fmt(d);
    if (!mediaEl.paused) requestAnimationFrame(tick);
  }
  mediaEl.addEventListener('seeked', tick);
  mediaEl.addEventListener('loadedmetadata', tick);
  mediaEl.addEventListener('durationchange', tick);
  tick();

  return container;
}
