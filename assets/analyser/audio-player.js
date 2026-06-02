/* Analyser - audio transport/player
   A small custom <audio> transport: play/pause button, a draggable seek track
   with a fill, and a current/total time readout. Built around any media element
   (the audio module's hidden <audio>, or a video's extracted-audio element).
   Drag listeners are attached on press and removed on release so they don't pile
   up as new files are analysed. Used by audio.js and (via re-export) video.js. */

import { el } from './util.js';

export function makePlayer(mediaEl) {
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
  let seeking = false;
  let pendingFrac = null;
  function scrub(clientX) {
    const rect = trackEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    fillEl.style.width = (frac * 100) + '%';
    if (seeking) {
      pendingFrac = frac;
    } else {
      seeking = true;
      mediaEl.currentTime = frac * (mediaEl.duration || 0);
    }
  }
  mediaEl.addEventListener('seeked', () => {
    if (pendingFrac !== null) {
      const f = pendingFrac;
      pendingFrac = null;
      mediaEl.currentTime = f * (mediaEl.duration || 0);
    } else {
      seeking = false;
    }
  });
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
    const d = mediaEl.duration || 0;
    const pct = d > 0 ? (mediaEl.currentTime / d) * 100 : 0;
    fillEl.style.width = pct + '%';
    timeEl.textContent = fmt(mediaEl.currentTime) + ' / ' + fmt(d);
    if (!mediaEl.paused) requestAnimationFrame(tick);
  }
  mediaEl.addEventListener('seeked', tick);
  mediaEl.addEventListener('loadedmetadata', tick);
  tick();

  return container;
}
