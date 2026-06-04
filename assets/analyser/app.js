/* Analyser - entry point
   - Boots photo + audio + video modules
   - Acts as the page-wide drop target (until the first file lands)
   - Classifies dropped files into photo / audio / video / unknown
   - Renders a basic dump for unknown formats */

const COMMIT_COUNT = 49;
// Versioning: every commit is its own version. Pre-1.0 commits read 0.01, 0.02,
// 0.03 … (the part after the dot is the commit's 1-based position, zero-padded to
// two digits - 0.09, 0.10, 0.11). A commit listed in RELEASE_COMMITS bumps the
// major version and resets the counter, so it shows as "1.0" and the commit right
// after it is "1.01". To crown a future 2.0, append its commit number here (keep
// the list sorted ascending, and mirror the RELEASE constant in save.bat).
const RELEASE_COMMITS = [29];

function analyserVersion(n, releases) {
  let major = 0, base = 0;
  for (const r of releases) {
    if (n >= r) { major += 1; base = r; } else break;
  }
  if (major === 0) return '0.' + String(n).padStart(2, '0');
  const minor = n - base;
  return major + '.' + (minor === 0 ? '0' : String(minor).padStart(2, '0'));
}

import { initPhoto, renderPhoto } from './photo.js';
import { initAudio, renderAudio } from './audio.js';
import { initVideo, renderVideo } from './video.js';
import { renderPdf } from './pdf.js';
import { renderArchive } from './archive.js';
import { renderSvg } from './svg.js';
import { renderCsv } from './csv.js';
import { renderUnknown } from './unknown.js';
import { renderProprietary, isProprietaryExt } from './proprietary.js';
import { renderDocx } from './docx.js';
import { renderXlsx } from './xlsx.js';
import { renderEpub } from './epub.js';
import { renderPptx } from './pptx.js';
import { renderStl } from './stl.js';
import { renderLrc } from './lrc.js';
import { renderMidi } from './midi.js';
import { renderSubtitles } from './subtitles.js';
import { renderGeo } from './geo.js';
import { renderMarkdown } from './markdown.js';
import { initSearch } from './search.js';
import { fileExt, el, probeReadable, isUnreadableError, cloudFileWarning } from './util.js';
import { walkItems, renderFolder } from './folder.js';
import {
  PHOTO_EXTS, AUDIO_EXTS, VIDEO_EXTS, CSV_EXTS, SVG_EXTS,
  renderFmtOverlay, renderAboutFormats
} from './formats.js';

function $(id) { return document.getElementById(id); }

// Swiss-style confirmation modal. Resolves true on confirm, false on
// cancel/backdrop-dismiss. Used as the mobile "did you mean to upload?" guard
// so a stray tap on a dropzone doesn't immediately pop the native file picker.
function anrConfirm(title, okLabel) {
  return new Promise((resolve) => {
    const cancelBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-cancel' }, 'Cancel');
    const okBtn = el('button', { type: 'button', class: 'anr-modal-btn anr-modal-ok' }, okLabel || 'Choose file');
    const card = el('div', { class: 'anr-modal-card' }, [
      el('p', { class: 'anr-modal-kicker' }, 'Upload'),
      el('p', { class: 'anr-modal-title' }, title),
      el('div', { class: 'anr-modal-actions' }, [cancelBtn, okBtn])
    ]);
    const overlay = el('div', { class: 'anr-modal' }, card);
    document.body.appendChild(overlay);

    let settled = false;
    const close = (val) => {
      if (settled) return;
      settled = true;
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
      resolve(val);
    };
    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    // Defer the open class one frame so the CSS fade/slide transition runs.
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  });
}

// ---------- drop loading bar (bottom-of-window popup) ----------
// Big files take a moment to read/decode before their analysis renders. This
// shows a small popup at the bottom of the window with an indeterminate bar
// (same sliding style as the SHA-256 row) while that happens, then hides it
// when the renderer settles. A short delay before showing keeps quick files
// from flashing it.
let _dropLoaderEl = null;
let _dropLoaderTimer = null;
let _dropLoaderOnCancel = null;

function showDropLoader(file, onCancel) {
  clearTimeout(_dropLoaderTimer);
  _dropLoaderOnCancel = onCancel || null;
  const name = (file && file.name) ? file.name : 'file';
  _dropLoaderTimer = setTimeout(() => {
    if (!_dropLoaderEl || !_dropLoaderEl.isConnected) {
      // A window of accent slashes ('////') bouncing left↔right inside brackets
      // ([   ////   ]), stepped in discrete jumps via a CSS steps() timing so it
      // reads choppy like the original ASCII bar. The motion is a CSS transform,
      // NOT a requestAnimationFrame loop - rAF runs on the main thread, so it
      // froze under the file's heavy synchronous work (FFTs, BPM, pixel stats),
      // exactly when the loader is showing. A CSS animation keeps stepping.
      const win = el('div', { class: 'anr-css-bar-win' }, '/'.repeat(40));
      const track = el('div', { class: 'anr-css-bar-track' }, [win]);
      const bar = el('div', { class: 'anr-css-bar' }, ['[', track, ']']);
      const label = el('div', { class: 'anr-drop-loader-label' }, '');
      // Cancel sits on the same line as the label, pushed to the right; it
      // hides the popup and aborts the in-flight load (see cancelLoad below).
      const cancelBtn = el('button', { type: 'button', class: 'anr-drop-loader-cancel' }, 'Cancel');
      cancelBtn.addEventListener('click', () => {
        const cb = _dropLoaderOnCancel;
        hideDropLoader();
        if (cb) cb();
      });
      const head = el('div', { class: 'anr-drop-loader-head' }, [label, cancelBtn]);
      _dropLoaderEl = el('div', { class: 'anr-drop-loader', role: 'status', 'aria-live': 'polite' }, [head, bar]);
      _dropLoaderEl._label = label;
      document.body.appendChild(_dropLoaderEl);
    }
    _dropLoaderEl._label.textContent = 'Reading ' + name + '…';
    requestAnimationFrame(() => _dropLoaderEl.classList.add('is-open'));
  }, 160);
}

function hideDropLoader() {
  clearTimeout(_dropLoaderTimer);
  _dropLoaderOnCancel = null;
  if (_dropLoaderEl) {
    // The bar's CSS animation pauses itself via `:not(.is-open)` (see CSS), so
    // there's nothing to tear down here.
    _dropLoaderEl.classList.remove('is-open');
  }
}

// Cursor-style confirm popup (reuses the treemap .anr-treemap-menu look) shown
// when the "Links" button is clicked, so leaving the site is deliberate.
function showLinkConfirm(anchor, opts) {
  opts = opts || {};
  document.querySelectorAll('.anr-link-confirm').forEach((n) => n.remove());
  const url = anchor.getAttribute('href');
  const message = opts.message || 'This link leads to link.valjdakosta.com, proceed?';
  const onProceed = opts.onProceed || function () { window.open(url, '_blank', 'noopener'); };
  const cancelBtn = el('button', { class: 'anr-tm-btn' }, 'Cancel');
  const okBtn = el('button', { class: 'anr-tm-btn anr-tm-btn-ok' }, 'Proceed');
  const menu = el('div', { class: 'anr-treemap-menu anr-link-confirm' }, [
    el('div', { class: 'anr-tm-q' }, message),
    el('div', { class: 'anr-tm-actions' }, [cancelBtn, okBtn]),
  ]);
  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let px = r.left, py = r.bottom + 8;
  if (px + mw > window.innerWidth - 4) px = window.innerWidth - mw - 4;
  if (py + mh > window.innerHeight - 4) py = r.top - mh - 8;
  menu.style.left = Math.max(4, px) + 'px';
  menu.style.top = Math.max(4, py) + 'px';

  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onOut, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
  }
  function onOut(e) { if (!menu.contains(e.target) && e.target !== anchor) close(); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', () => { close(); onProceed(); });
  setTimeout(() => {
    document.addEventListener('mousedown', onOut, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
  }, 0);
}

// ---------- file classification ----------
// Extension sets live in formats.js (the central catalog). See that file to
// add a new type - the overlay, about page, and search update automatically.

function classifyFile(file) {
  const t = (file.type || '').toLowerCase();
  const ext = fileExt(file.name);
  // SVG before generic image/ MIME so it gets its own handler
  if (t === 'image/svg+xml' || SVG_EXTS.has(ext)) return 'svg';
  if (t.startsWith('image/')) return 'photo';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (CSV_EXTS.has(ext) || t === 'text/csv' || t === 'text/tab-separated-values') return 'csv';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'epub') return 'epub';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'stl') return 'stl';
  if (ext === 'lrc') return 'lrc';
  // MIDI is a score, not decodable audio - route it before the AUDIO_EXTS check.
  if (ext === 'mid' || ext === 'midi') return 'midi';
  // Subtitles + geo files are otherwise identification-only (proprietary.js).
  if (ext === 'srt' || ext === 'vtt' || ext === 'ass' || ext === 'ssa') return 'subtitles';
  if (ext === 'gpx' || ext === 'kml' || ext === 'geojson') return 'geo';
  // Markdown gets a real rendered view - route it before the proprietary `md`
  // (plain-text) entry would otherwise catch it.
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (PHOTO_EXTS.has(ext)) return 'photo';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (isProprietaryExt(ext)) return 'proprietary';
  return 'unknown';
}

// kind → how to route it. `results` names the container (the three media kinds
// get their own section + nav flash + scroll; everything else funnels into
// unknownResults). `nav`/`analysed` list the nav links and sections to mark.
// Adding a file type means adding one row here plus a classifyFile() case.
const ROUTES = {
  photo:       { render: renderPhoto,       results: 'photo',   scroll: '#photo',           nav: ['#photo'],                     analysed: ['photo'] },
  audio:       { render: renderAudio,       results: 'audio',   scroll: '#audio',           nav: ['#audio'],                     analysed: ['audio'] },
  video:       { render: renderVideo,       results: 'video',   scroll: '#video',           nav: ['#video', '#audio', '#photo'], analysed: ['video', 'photo'] },
  docx:        { render: renderDocx,        results: 'unknown', scroll: '#unknownResults' },
  xlsx:        { render: renderXlsx,        results: 'unknown', scroll: '#unknownResults' },
  epub:        { render: renderEpub,        results: 'unknown', scroll: '#unknownResults' },
  pptx:        { render: renderPptx,        results: 'unknown', scroll: '#unknownResults' },
  stl:         { render: renderStl,         results: 'unknown', scroll: '#unknownResults' },
  lrc:         { render: renderLrc,         results: 'unknown', scroll: '#unknownResults' },
  midi:        { render: renderMidi,        results: 'unknown', scroll: '#unknownResults' },
  subtitles:   { render: renderSubtitles,   results: 'unknown', scroll: '#unknownResults' },
  geo:         { render: renderGeo,         results: 'unknown', scroll: '#unknownResults' },
  markdown:    { render: renderMarkdown,    results: 'unknown', scroll: '#unknownResults' },
  pdf:         { render: renderPdf,         results: 'unknown', scroll: '#unknownResults' },
  zip:         { render: renderArchive,     results: 'unknown', scroll: '#unknownResults' },
  svg:         { render: renderSvg,         results: 'unknown', scroll: '#unknownResults' },
  csv:         { render: renderCsv,         results: 'unknown', scroll: '#unknownResults' },
  proprietary: { render: renderProprietary, results: 'unknown', scroll: '#unknownResults' },
  unknown:     { render: renderUnknown,     results: 'unknown', scroll: '#unknownResults' },
};

// ---------- page-wide drag-drop ----------
function hasFiles(e) {
  const t = e.dataTransfer && e.dataTransfer.types;
  if (!t) return false;
  for (let i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
  return false;
}

let _handleFile = null;
let _scrollHandler = null;

// Header letter-proximity / sweep effect. Re-runs per navigation because
// navigate.js swaps .site-mark (so the title text changes between pages); the
// guard on the element keeps it from binding twice to the same header.
function setupHeaderFx() {
  const mark = document.querySelector('.site-mark');
  const title = document.querySelector('.site-title');
  const byline = document.querySelector('.site-byline');
  if (!mark || !title || !byline || mark._anrFx) return;
  mark._anrFx = true;
  if (setupHeaderFx._iv) clearInterval(setupHeaderFx._iv);


    function splitText(container, baseWeight) {
      // Bake letter-spacing as an em ratio of the font size, not the computed px.
      // The title font-size is vw-based, so browser zoom rescales it; a fixed px
      // spacing would not follow, leaving the gaps between the inline-block letters
      // drifting on zoom. em tracks each span's font-size, so the spacing scales
      // together with the letters.
      const cs = getComputedStyle(container);
      const lsPx = parseFloat(cs.letterSpacing);
      const fsPx = parseFloat(cs.fontSize);
      const spacing = (isNaN(lsPx) || !fsPx) ? 'normal' : (lsPx / fsPx) + 'em';
      const spans = [];
      function makeSpan(ch, parent) {
        const s = document.createElement('span');
        s.textContent = ch;
        s.style.display = 'inline-block';
        s.style.fontWeight = baseWeight;
        s.style.letterSpacing = spacing;
        if (ch === ' ') s.style.width = '0.25em';
        parent.appendChild(s);
        // A space gets a <wbr> so multi-word titles ("Patch Notes") can still
        // wrap on narrow screens - the letter spans are inline-block with no
        // whitespace between them, which would otherwise be one unbreakable run.
        if (ch === ' ') parent.appendChild(document.createElement('wbr'));
        spans.push({ el: s, base: baseWeight });
      }
      const nodes = [...container.childNodes];
      container.textContent = '';
      for (const node of nodes) {
        if (node.nodeType === 3) {
          for (const ch of node.textContent) makeSpan(ch, container);
        } else {
          const text = node.textContent;
          node.textContent = '';
          container.appendChild(node);
          for (const ch of text) makeSpan(ch, node);
        }
      }
      return spans;
    }

    function initLetters() {
      title.style.width = title.offsetWidth + 'px';
      title.style.height = title.offsetHeight + 'px';
      byline.style.width = byline.offsetWidth + 'px';
      byline.style.height = byline.offsetHeight + 'px';
      const letters = [
        ...splitText(title, 600),
        ...splitText(byline, 700)
      ];
      title.style.width = '';
      title.style.height = '';
      byline.style.width = '';
      byline.style.height = '';
      return letters;
    }

    // Unified proximity controller. A single RAF loop drives both the intro
    // "sweep" (a virtual cursor gliding across the header) and the real mouse
    // hover. They run together: per letter we take whichever pulls it lighter
    // (the smaller t), so hovering during the sweep no longer cancels it.
    const RADIUS_HOVER = 120, RADIUS_TOUCH = 80;
    const letters = initLetters();
    let mx = -9999, my = -9999, inside = false;
    let sweep = null;                 // { t0, duration, sx, ex, cy, vx, radius } | null
    let raf = 0, running = false;

    function letterWeight(l) {
      const r = l.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let t = 1;
      if (inside) t = Math.min(t, Math.hypot(mx - cx, my - cy) / RADIUS_HOVER);
      if (sweep)  t = Math.min(t, Math.hypot(sweep.vx - cx, sweep.cy - cy) / sweep.radius);
      t = Math.min(1, t);
      return Math.round(l.base * t + 300 * (1 - t));
    }
    function frame(ts) {
      if (sweep) {
        if (sweep.t0 == null) sweep.t0 = ts;
        const p = Math.min(1, (ts - sweep.t0) / sweep.duration);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        sweep.vx = sweep.sx + e * (sweep.ex - sweep.sx);
        if (p >= 1) sweep = null;
      }
      for (const l of letters) l.el.style.fontWeight = letterWeight(l);
      if (inside || sweep) raf = requestAnimationFrame(frame);
      else { running = false; settle(); }
    }
    function ensureRunning() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function settle() {
      for (const l of letters) { l.el.style.transition = 'font-weight 0.4s ease'; l.el.style.fontWeight = l.base; }
      setTimeout(() => { for (const l of letters) l.el.style.transition = ''; }, 500);
    }
    function startSweep(radius) {
      const rect = mark.getBoundingClientRect();
      sweep = { t0: null, duration: 3500, sx: rect.left - radius, ex: rect.right + radius,
                cy: rect.top + rect.height / 2, vx: rect.left - radius, radius };
      ensureRunning();
    }

    if (window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
      mark.addEventListener('mouseenter', () => {
        inside = true;
        for (const l of letters) l.el.style.transition = '';
        ensureRunning();
      });
      mark.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
      mark.addEventListener('mouseleave', () => { inside = false; });  // settles once the sweep also ends
      setTimeout(() => startSweep(RADIUS_HOVER), 800);
    } else if (window.matchMedia('(pointer: coarse)').matches) {
      setTimeout(() => startSweep(RADIUS_TOUCH), 800);
      setupHeaderFx._iv = setInterval(() => startSweep(RADIUS_TOUCH), 8000);
    }
}
function boot() {
  if (!window.exifr) {
    console.warn('exifr not loaded yet; photo metadata will be missing until it loads.');
  }

  const photoResults   = $('photoResults');
  const audioResults   = $('audioResults');
  const videoResults   = $('videoResults');
  const unknownResults = $('unknownResults');
  const pageDropEl     = $('pageDrop');

  let firstFileLoaded = false;
  let dragCounter = 0;
  // Token for the load currently in flight. Cancelling marks it so the
  // (uncancellable) renderer's output is suppressed and the loader stays hidden.
  let _currentToken = null;

  // Reset the result containers, preview slots, and nav/section state back to
  // the pre-load layout. Shared by a fresh load and by cancelLoad().
  function clearResultsUI() {
    photoResults.innerHTML = ''; photoResults.hidden = true;
    audioResults.innerHTML = ''; audioResults.hidden = true;
    videoResults.innerHTML = ''; videoResults.hidden = true;
    unknownResults.innerHTML = ''; unknownResults.hidden = true;

    // Clear preview slots
    for (const id of ['photoPreview', 'photoOcrSlot', 'photoHistSlot', 'videoPreview']) {
      const slot = $(id);
      if (slot) slot.innerHTML = '';
    }

    // Reset the mobile post-analysis layout (heading moved into the meta card,
    // lede hidden) so a fresh file starts from the default section layout.
    ['photo', 'audio', 'video'].forEach((id) => {
      const sec = $(id);
      if (sec) sec.classList.remove('is-analysed');
    });

    // Clear nav indicators
    document.querySelectorAll('.nav-link.has-data').forEach(link => link.classList.remove('has-data'));
  }

  // Stop the in-flight load: drop its results and restore the empty page state
  // (the three analysis sections are explainer sections - visible by default).
  function cancelLoad(token) {
    if (!token || token.cancelled) return;
    token.cancelled = true;
    if (_currentToken === token) _currentToken = null;
    clearResultsUI();
    ['photo', 'audio', 'video'].forEach((id) => { const sec = $(id); if (sec) sec.hidden = false; });
  }

  async function handleFile(file) {
    if (!file) return;
    // If the "Supported formats" overlay is open, drop/paste/pick dismisses it.
    const fmtOv = $('fmtOverlay');
    if (fmtOv && !fmtOv.hidden) { fmtOv.hidden = true; document.body.style.overflow = ''; }
    const token = { cancelled: false };
    _currentToken = token;
    showDropLoader(file, () => cancelLoad(token));

    clearResultsUI();

    firstFileLoaded = true;
    if (pageDropEl) pageDropEl.hidden = true;

    // Probe that the bytes are actually readable before any renderer tries. A
    // cloud-only file (OneDrive/iCloud/etc.) whose sync app can't hydrate it has
    // a valid name+size but throws on read - show a clear warning instead of a
    // generic "could not read" from deep inside a renderer.
    const readErr = await probeReadable(file);
    if (token.cancelled) return;   // cancelled while probing - don't render
    if (readErr && isUnreadableError(readErr)) {
      hideDropLoader();
      unknownResults.hidden = false;
      unknownResults.innerHTML = '';
      const card = el('div', { class: 'anr-card' });
      card.appendChild(el('h3', {}, 'File unavailable'));
      card.appendChild(cloudFileWarning(file));
      unknownResults.appendChild(card);
      unknownResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    let kind = classifyFile(file);

    // For files classified as 'unknown', check magic bytes for PDF / ZIP / SVG / CSV
    if (kind === 'unknown') {
      try {
        const head = new Uint8Array(await file.slice(0, 128).arrayBuffer());
        const a = (s, l) => Array.from(head.slice(s, s + l)).map((c) => String.fromCharCode(c)).join('');
        if (a(0, 4) === '%PDF') kind = 'pdf';
        else if (head[0] === 0x50 && head[1] === 0x4B) kind = 'zip';
        else {
          // Check for SVG: may start with <svg or <?xml ... <svg
          const headStr = a(0, Math.min(head.length, 128));
          if (headStr.trimStart().startsWith('<svg') || (headStr.includes('<svg') && headStr.includes('xmlns'))) {
            kind = 'svg';
          }
        }
        // CSV heuristic: check if lines have consistent comma/tab counts
        if (kind === 'unknown') {
          const peekText = await file.slice(0, 2048).text().catch(() => '');
          const lines = peekText.split('\n').filter((l) => l.trim()).slice(0, 10);
          if (lines.length >= 2) {
            const commas = lines.map((l) => (l.match(/,/g) || []).length);
            const tabs = lines.map((l) => (l.match(/\t/g) || []).length);
            const avgCommas = commas.reduce((s, n) => s + n, 0) / commas.length;
            const avgTabs = tabs.reduce((s, n) => s + n, 0) / tabs.length;
            const commaConsistent = avgCommas >= 1 && commas.every((c) => Math.abs(c - avgCommas) <= 1);
            const tabConsistent = avgTabs >= 1 && tabs.every((c) => Math.abs(c - avgTabs) <= 1);
            if (commaConsistent || tabConsistent) kind = 'csv';
          }
        }
      } catch (_) {}
    }

    const navMap = { photo: '#photo', audio: '#audio', video: '#video' };
    const href = navMap[kind];
    if (href) {
      const link = document.querySelector('.site-nav a[href="' + href + '"]');
      if (link) {
        link.classList.remove('is-flash');
        void link.offsetWidth;
        link.classList.add('is-flash');
      }
    }

    function markNav(selector) {
      const el = document.querySelector('.site-nav a[href="' + selector + '"]');
      if (el) el.classList.add('has-data');
    }

    // Mobile only (gated by CSS): flag a section as having analysed a file, which
    // moves its heading up into the numbered card and hides the lede.
    function markAnalysed(id) { const sec = $(id); if (sec) sec.classList.add('is-analysed'); }

    function scrollTo(hash) {
      const el = document.querySelector(hash);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 60;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    }

    const sectionPhoto = $('photo');
    const sectionAudio = $('audio');
    const sectionVideo = $('video');
    const mediaSections = [sectionPhoto, sectionAudio, sectionVideo];
    const isMedia = kind === 'photo' || kind === 'audio' || kind === 'video';
    if (isMedia) {
      mediaSections.forEach(s => { if (s) s.hidden = false; });
    } else {
      const ext = fileExt(file.name);
      const keepPhoto = ext === 'exe' || ext === 'dll';
      if (sectionPhoto) sectionPhoto.hidden = !keepPhoto;
      if (sectionAudio) sectionAudio.hidden = true;
      if (sectionVideo) sectionVideo.hidden = true;
    }

    const route = ROUTES[kind] || ROUTES.unknown;
    const resultsByName = {
      photo: photoResults, audio: audioResults, video: videoResults, unknown: unknownResults,
    };
    (route.nav || []).forEach(markNav);
    (route.analysed || []).forEach(markAnalysed);
    scrollTo(route.scroll);
    const renderPromise = route.render(file, resultsByName[route.results]);
    // Hide the bottom loader once the renderer settles (or immediately if it
    // wasn't async). Errors still dismiss it so it can't get stuck on screen.
    // If this load was cancelled (or superseded by a newer one) leave the loader
    // alone - cancelLoad already cleared the UI, and a newer load owns the popup.
    Promise.resolve(renderPromise).catch(() => {}).finally(() => {
      if (token.cancelled) {
        // A cancelled renderer may have appended output after cancelLoad cleared
        // the UI. Scrub it - but only if no newer load has since taken over
        // (cancelLoad nulls _currentToken; a fresh load sets it non-null).
        if (_currentToken === null) clearResultsUI();
        return;
      }
      if (_currentToken !== token) return;   // superseded by a newer load
      hideDropLoader();
    });
  }
  _handleFile = handleFile;
  window._anrHandleFile = handleFile;

  if ($('photoDrop')) initPhoto({
    dropEl:    $('photoDrop'),
    inputEl:   $('photoInput'),
    resultsEl: photoResults,
    onFile:    handleFile
  });

  if ($('audioDrop')) initAudio({
    dropEl:    $('audioDrop'),
    inputEl:   $('audioInput'),
    recordBtn: $('audioRecord'),
    liveBtn:   $('audioLive'),
    resultsEl: audioResults,
    onFile:    handleFile
  });

  if ($('videoDrop')) initVideo({
    dropEl:    $('videoDrop'),
    inputEl:   $('videoInput'),
    resultsEl: videoResults,
    onFile:    handleFile
  });

  // ----- Mobile: tap a section card to upload (with confirm) -----
  // On touch devices, tapping a section's description card (its number +
  // heading + lede, or the heading once it's been moved up after analysis)
  // offers to open a file picker for that section's type. A Swiss-style modal
  // confirms first so a stray tap while scrolling doesn't pop the picker. The
  // top dropzones are deliberately left alone (instant on tap).
  // The photo dropzone handles both photos and videos, so the photo and video
  // sections share photoInput (image/* + video/*).
  if (window.matchMedia('(pointer: coarse)').matches) {
    const sectionUploads = [
      { id: 'photo', input: 'photoInput', prompt: 'Open a photo or video to analyse?' },
      { id: 'audio', input: 'audioInput', prompt: 'Open a sound file to analyse?' },
      { id: 'video', input: 'photoInput', prompt: 'Open a photo or video to analyse?' }
    ];
    for (const s of sectionUploads) {
      const section = $(s.id);
      const input = $(s.input);
      if (!section || !input) continue;

      // Mirror the heading into the numbered meta card. It stays hidden until
      // the section has analysed a file (see the .section-meta-head CSS), then
      // takes the place of the original head + lede on mobile. Created once.
      const meta = section.querySelector('.section-meta');
      const head = section.querySelector('.section-head');
      if (meta && head && !meta.querySelector('.section-meta-head')) {
        const clone = el('p', { class: 'section-meta-head' }, head.textContent);
        const kicker = meta.querySelector('.section-kicker');
        if (kicker) kicker.after(clone); else meta.appendChild(clone);
      }

      // Only the description text opens the picker - never the results/controls
      // below it, which stay interactive.
      section.addEventListener('click', (e) => {
        if (!e.target.closest('.section-head, .section-lede, .section-meta-head, .section-num, .section-kicker')) return;
        anrConfirm(s.prompt).then((ok) => { if (ok) input.click(); });
      });
      section.classList.add('is-tappable');
    }
  }

  // ----- Page-level drag/drop (window listeners added once) -----
  if (!boot._once) {
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      dragCounter++;
      const drop = $('pageDrop');
      if (drop) drop.hidden = false;
    });
    window.addEventListener('dragleave', () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) { const drop = $('pageDrop'); if (drop) drop.hidden = true; }
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    });
    window.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter = 0;
      const drop = $('pageDrop');
      if (drop) drop.hidden = true;

      // Synchronous folder peek so the bottom loading bar can show while the
      // (potentially slow) recursive folder walk reads thousands of File objects.
      let droppedFolderName = null;
      const dtItems = e.dataTransfer.items;
      if (dtItems) {
        for (let i = 0; i < dtItems.length; i++) {
          const en = dtItems[i].webkitGetAsEntry && dtItems[i].webkitGetAsEntry();
          if (en && en.isDirectory) { droppedFolderName = en.name; break; }
        }
      }
      const folderToken = { cancelled: false };
      if (droppedFolderName) showDropLoader({ name: droppedFolderName }, () => { folderToken.cancelled = true; });

      const folderFiles = await walkItems(e.dataTransfer);
      if (folderToken.cancelled) return;   // cancelled during the folder walk
      if (folderFiles) {
        if (!$('photoResults')) {
          window._anrPendingFolder = folderFiles;
          const home = new URL('index.html', location.href).href;
          if (location.href !== home) {
            const link = document.createElement('a');
            link.href = 'index.html';
            document.body.appendChild(link);
            link.click();
            link.remove();
          }
          return;
        }
        const ur = $('unknownResults');
        if (ur) renderFolder(folderFiles, ur);
        hideDropLoader();
        return;
      }
      if (droppedFolderName) hideDropLoader();

      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;

      if (!$('photoResults')) {
        window._anrPendingFile = files[0];
        const home = new URL('index.html', location.href).href;
        if (location.href !== home) {
          const link = document.createElement('a');
          link.href = 'index.html';
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
        return;
      }
      if (_handleFile) for (const file of files) _handleFile(file);
    });

  // ----- Version number -----
  const verEl = $('versionNum');
  if (verEl) {
    verEl.textContent = analyserVersion(COMMIT_COUNT, RELEASE_COMMITS);
  }

  // ----- Contact email -----
  // Display-only: the footer shows the address obfuscated ("[at]"/"[dot]")
  // with no clickable mailto: so bots can't scrape a live link.
  document.querySelectorAll('.footer-contact').forEach((a) => {
    a.removeAttribute('href');
    a.style.cursor = 'default';
  });

  // ----- Storage with 7-day expiry -----
  const ANR_TTL = 7 * 24 * 60 * 60 * 1000;
  const ANR_REFRESH = 24 * 60 * 60 * 1000;

  function anrSet(key, value) {
    try {
      localStorage.setItem(key, value);
      localStorage.setItem(key + ':ts', Date.now().toString());
    } catch (e) { /* quota or private mode */ }
  }

  function anrGet(key) {
    try {
      var ts = parseInt(localStorage.getItem(key + ':ts'), 10);
      if (!ts || Date.now() - ts > ANR_TTL) {
        localStorage.removeItem(key);
        localStorage.removeItem(key + ':ts');
        return null;
      }
      return localStorage.getItem(key);
    } catch (e) { return null; }
  }

  function anrSweep() {
    try {
      var now = Date.now();
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (!k || !k.startsWith('anr-') || k.endsWith(':ts')) continue;
        var ts = parseInt(localStorage.getItem(k + ':ts'), 10);
        if (!ts || now - ts > ANR_TTL) {
          localStorage.removeItem(k);
          localStorage.removeItem(k + ':ts');
        } else if (now - ts > ANR_REFRESH) {
          localStorage.setItem(k + ':ts', now.toString());
        }
      }
    } catch (e) { /* ignore */ }
  }

  anrSweep();

  // ----- Dark mode toggle -----
  const saved = anrGet('anr-theme');
  const effective = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : null);
  if (effective) document.documentElement.setAttribute('data-theme', effective);
  const darkBtn = $('darkToggle');
  if (darkBtn) {
    // Label shows the CURRENT mode: NIGHT while dark, DAY while light.
    darkBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☾︎ NIGHT' : '☀︎ DAY';
    darkBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      anrSet('anr-theme', next);
      darkBtn.textContent = next === 'dark' ? '☾︎ NIGHT' : '☀︎ DAY';
    });
  }

  // ----- "Links" external link: confirm before leaving -----
  const otherLink = $('otherStuffLink');
  if (otherLink) {
    otherLink.onclick = (e) => { e.preventDefault(); showLinkConfirm(otherLink); };
  }

  // ----- Clipboard paste (window listener, added once) -----
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && _handleFile) _handleFile(file);
        }
      }
    });

    // Header letter FX is initialised per-navigation by setupHeaderFx() (defined above).

    setInterval(anrSweep, ANR_REFRESH);

    // Deep-links in the patch notes (and anywhere else) jump to an #anchor, then
    // quietly clean the hash out of the address bar a few seconds later so the URL
    // stays tidy and shareable. replaceState doesn't re-scroll, so the user stays
    // put. We only strip if the hash hasn't changed in the meantime (no new jump).
    const HASH_CLEAN_DELAY = 3000;
    let hashCleanTimer = null;
    const scheduleHashClean = () => {
      if (hashCleanTimer) clearTimeout(hashCleanTimer);
      if (!location.hash) return;
      const target = location.hash;
      hashCleanTimer = setTimeout(() => {
        if (location.hash === target) {
          history.replaceState(null, '', location.pathname + location.search);
        }
      }, HASH_CLEAN_DELAY);
    };
    window.addEventListener('hashchange', scheduleHashClean);
    scheduleHashClean(); // handle a hash present on initial load

    // Console easter egg, printed once per session for anyone who opens devtools.
    try {
      console.log(
        "%cyou are probably looking for a test page. there is one but i'm not telling you how to find it.",
        'font-family:monospace;font-size:13px;'
      );
    } catch (_) {}

    boot._once = true;
  } // end one-time guard

  // A file dropped on the About / Changelog page stashes itself here and
  // navigates home; pick it up once this (home) boot has the result containers.
  // Runs every boot - NOT inside the one-time guard - so it fires on the
  // anr:navigate boot that the drop triggers, not only on a cold first load.
  if (window._anrPendingFile && photoResults) {
    handleFile(window._anrPendingFile);
    delete window._anrPendingFile;
  }
  if (window._anrPendingFolder && unknownResults) {
    renderFolder(window._anrPendingFolder, unknownResults);
    delete window._anrPendingFolder;
  }

  // Re-bind the header letter effect to the (possibly swapped) title.
  setupHeaderFx();

  // link.valjdakosta.com links open in this tab - except the "Other stuff" one,
  // which keeps its confirm popup -> new tab (bound below). Runs every navigation
  // because navigate.js swaps the header, recreating the byline anchor.
  document.querySelectorAll('a[href*="link.valjdakosta.com"]').forEach((a) => {
    if (a.id === 'otherStuffLink') return;
    a.removeAttribute('target');
    a.removeAttribute('rel');
  });

  // Tapping a hyperlink inside the patch notes asks for confirmation first
  // (same cursor-style popup as the external "Links" button) before following
  // it, then navigates on Proceed.
  document.querySelectorAll('.patch-list a[href]').forEach((a) => {
    if (a._confirmBound) return;
    a._confirmBound = true;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute('href') || '';
      let dest = 'another page';
      if (href.indexOf('about.html') === 0) dest = 'the About page';
      else if (href === '/' || href.indexOf('index') === 0) dest = 'the analyser';
      showLinkConfirm(a, {
        message: 'This link leads to ' + dest + ', proceed?',
        onProceed: function () { window.location.href = href; }
      });
    });
  });

  // ----- Scroll-spy for the sticky nav (re-binds per page) -----
  const links = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
  const sections = links
    .map((a) => ({ a, el: document.querySelector(a.getAttribute('href')) }))
    .filter((s) => s.el);
  if (_scrollHandler) window.removeEventListener('scroll', _scrollHandler);
  _scrollHandler = () => {
    let active = null;
    const y = window.scrollY + 140;
    for (const s of sections) {
      if (s.el.offsetTop <= y) active = s;
    }
    for (const s of sections) s.a.classList.toggle('is-active', s === active);
  };
  window.addEventListener('scroll', _scrollHandler, { passive: true });
  _scrollHandler();

  // ----- Smooth in-page anchors -----
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 60;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  }

  // ----- Home button -----
  const homeBtn = $('navHomeBtn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  // ----- Desktop only: match the Sound nav button to the sound dropzone width -----
  const soundLink = document.querySelector('.site-nav a[href="#audio"]');
  const soundDrop = $('audioDrop');
  if (soundLink && soundDrop) {
    const alignSoundNav = () => {
      if (window.innerWidth > 700) {
        const w = soundDrop.getBoundingClientRect().width - 2;
        if (w > 0) soundLink.style.flex = '0 0 ' + w + 'px';
      } else {
        soundLink.style.flex = '';
      }
    };
    alignSoundNav();
  }

  // ----- Offline download buttons -----
  const TESS_DATA = 'assets/vendor/tesseract';
  const TESS_WORKER = 'assets/vendor/tesseract/worker.min.js';

  const TIERS = {
    essentials: [
      './', './index.html', './about.html', './patch.html', './manifest.json', './assets/analyser.css', './assets/fonts.css',
      './assets/analyser/app.js', './assets/analyser/formats.js', './assets/analyser/util.js', './assets/analyser/search.js',
      './assets/analyser/photo.js', './assets/analyser/audio.js', './assets/analyser/audio-analysis.js',
      './assets/analyser/audio-codec.js', './assets/analyser/video.js', './assets/analyser/spectrogram.js',
      './assets/analyser/pdf.js', './assets/analyser/archive.js', './assets/analyser/svg.js',
      './assets/analyser/csv.js', './assets/analyser/unknown.js', './assets/analyser/proprietary.js',
      './assets/analyser/folder.js', './assets/analyser/folder-archive-shared.js',
      './assets/analyser/treemap.js', './assets/analyser/navigate.js',
      './assets/analyser/photo-convert.js', './assets/analyser/audio-player.js', './assets/analyser/video-avi.js',
      './assets/analyser/docx.js', './assets/analyser/xlsx.js', './assets/analyser/epub.js',
      './assets/analyser/pptx.js', './assets/analyser/stl.js', './assets/analyser/zip.js',
      './assets/analyser/lrc.js', './assets/analyser/midi.js', './assets/analyser/subtitles.js',
      './assets/analyser/geo.js', './assets/analyser/markdown.js',
      './assets/favicon.svg', './assets/icon.png', './assets/icon-192.png', './assets/icon-512.png',
      './assets/vendor/exifr.umd.js',
      './assets/fonts/geist-latin.woff2', './assets/fonts/geist-latin-ext.woff2',
      './assets/fonts/geist-cyrillic.woff2', './assets/fonts/geist-cyrillic-ext.woff2',
      './assets/fonts/geist-vietnamese.woff2',
      './assets/fonts/geist-mono-latin.woff2', './assets/fonts/geist-mono-latin-ext.woff2',
      './assets/fonts/geist-mono-cyrillic.woff2', './assets/fonts/geist-mono-cyrillic-ext.woff2',
      './assets/fonts/geist-mono-symbols.woff2', './assets/fonts/geist-mono-vietnamese.woff2',
      './assets/vendor/imagemagick/index.mjs',
      './assets/vendor/imagemagick/magick.wasm',
      './assets/vendor/ffmpeg/ffmpeg.js',
      './assets/vendor/ffmpeg/index.js',
      './assets/vendor/ffmpeg/classes.js',
      './assets/vendor/ffmpeg/const.js',
      './assets/vendor/ffmpeg/errors.js',
      './assets/vendor/ffmpeg/types.js',
      './assets/vendor/ffmpeg/utils.js',
      './assets/vendor/ffmpeg/worker.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
      './assets/vendor/ffmpeg/ffmpeg-util.js'
    ],
    everything: [
      './assets/vendor/jsQR.js',
      './assets/vendor/tesseract/tesseract.min.js',
      TESS_WORKER,
      TESS_DATA + '/eng.traineddata.gz',
      TESS_DATA + '/tesseract-core-simd-lstm.wasm.js',
      TESS_DATA + '/tesseract-core-simd-lstm.wasm',
      TESS_DATA + '/tesseract-core-lstm.wasm.js',
      TESS_DATA + '/tesseract-core-lstm.wasm',
      './assets/vendor/leaflet/leaflet.css',
      './assets/vendor/leaflet/leaflet.js',
      './assets/vendor/heic2any.min.js',
      './assets/vendor/pdfjs/pdf.min.mjs',
      './assets/vendor/pdfjs/pdf.worker.min.mjs',
      './assets/vendor/fflate.js'
    ],
    // Only English is bundled (in the "everything" tier); every other OCR
    // language is pulled from the CDN (not hosted in the repo). They all land
    // in the offline cache, so "Complete" still gives every language offline.
    complete: [
      'spa', 'fra', 'deu', 'ita', 'por', 'rus', 'chi_sim', 'jpn',
      'srp', 'srp_latn', 'hrv', 'ell', 'ara', 'chi_tra', 'kor', 'heb', 'tur',
      'ukr', 'pol', 'ron', 'hun', 'ces', 'slk', 'slv', 'bul', 'mkd', 'nld',
      'swe', 'nor', 'fin', 'dan'
    ].map(c => 'https://tessdata.projectnaptha.com/4.0.0/' + c + '.traineddata.gz')
  };

  document.querySelectorAll('.offline-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-active') || btn.classList.contains('is-done')) return;
      const tier = btn.dataset.tier;
      let urls = [...TIERS.essentials];
      if (tier === 'everything' || tier === 'complete') urls.push(...TIERS.everything);
      if (tier === 'complete') urls.push(...TIERS.complete);

      btn.classList.add('is-active');
      const bar = btn.querySelector('.offline-bar');
      const fill = btn.querySelector('.offline-bar-fill');
      const sizeEl = btn.querySelector('.offline-size');
      bar.hidden = false;

      function setBar(frac) {
        const ch = parseFloat(getComputedStyle(bar).fontSize) * 0.6 || 8;
        // Fit to the bar's own content width - it already excludes the button's
        // padding, so this adapts to the resized (narrower) mobile buttons
        // instead of assuming desktop padding. Reserve 2 chars for the [ ].
        const barW = bar.clientWidth || btn.clientWidth;
        const total = Math.max(4, Math.floor(barW / ch) - 2);
        const filled = Math.round(Math.max(0, Math.min(1, frac)) * total);
        bar.innerHTML = '[<span class="offline-bar-fill">' +
          '/'.repeat(filled) + '</span>' +
          ' '.repeat(total - filled) + ']';
      }
      setBar(0);

      const cache = await caches.open('analyser-offline');
      let done = 0;
      for (const url of urls) {
        try {
          const exists = await cache.match(new Request(url));
          if (!exists) {
            const resp = await fetch(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' })
              .catch(() => fetch(url, { mode: 'no-cors' }));
            if (resp) await cache.put(url, resp);
          }
        } catch (_) {}
        done++;
        setBar(done / urls.length);
        sizeEl.textContent = done + ' / ' + urls.length;
      }

      btn.classList.remove('is-active');
      btn.classList.add('is-done');
      sizeEl.textContent = 'Cached';
      setBar(1);
      setTimeout(() => btn.classList.add('is-fading'), 5000);
    });
  });

  // ----- PWA install prompt -----
  const installBtn = document.getElementById('offlineInstall');
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result.outcome === 'accepted') installBtn.textContent = 'Installed ✓';
        deferredPrompt = null;
        return;
      }
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const msg = isIos
        ? 'Tap the Share button, then "Add to Home Screen".'
        : 'Open browser menu (⋮), then "Install app" or "Add to Home Screen".';
      installBtn.textContent = msg;
      // Expand full width (mobile only, via CSS) so the long message fits, like
      // an opened Dependencies. Clear + Dependencies split the row below it.
      installBtn.classList.add('is-expanded');
      setTimeout(() => {
        installBtn.textContent = 'Install as app';
        installBtn.classList.remove('is-expanded');
      }, 5000);
    });
  }
  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.textContent = 'Installed ✓';
    deferredPrompt = null;
  });

  // ----- Clear all site data (keeps only the dark-mode preference) -----
  const clearBtn = document.getElementById('offlineClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      clearBtn.textContent = 'Clearing…';
      // 1. Preserve the dark-mode state, then wipe localStorage + sessionStorage.
      const theme = localStorage.getItem('anr-theme');
      const themeTs = localStorage.getItem('anr-theme:ts');
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
      if (theme !== null) {
        try {
          localStorage.setItem('anr-theme', theme);
          if (themeTs !== null) localStorage.setItem('anr-theme:ts', themeTs);
        } catch (_) {}
      }
      // 2. Delete every Cache Storage bucket (offline tiers + the SW app shell).
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      } catch (_) {}
      // 3. Drop any IndexedDB databases.
      try {
        if (indexedDB.databases) {
          const dbs = await indexedDB.databases();
          await Promise.all(dbs.map(d => d.name && new Promise(res => {
            const req = indexedDB.deleteDatabase(d.name);
            req.onsuccess = req.onerror = req.onblocked = () => res();
          })));
        }
      } catch (_) {}
      // 4. Unregister the service worker (it re-registers on the next load).
      try {
        if (navigator.serviceWorker) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch (_) {}
      // Reset the offline-tier buttons to their default state.
      document.querySelectorAll('.offline-btn').forEach(b => {
        b.classList.remove('is-done', 'is-active');
        const bar = b.querySelector('.offline-bar');
        if (bar) bar.hidden = true;
        const tier = b.dataset.tier;
        const sizes = { essentials: '~46 MB', everything: '~72 MB', complete: '~290 MB' };
        b.querySelector('.offline-size').textContent = sizes[tier];
      });
      clearBtn.textContent = 'All data cleared ✓';
      setTimeout(() => { clearBtn.textContent = 'Clear storage'; }, 3000);
    });
  }

  // ----- Supported-formats catalog (generated from formats.js) -----
  // index.html has #fmtBody (the overlay); about.html has #aboutFormats.
  renderFmtOverlay($('fmtBody'));
  renderAboutFormats($('aboutFormats'));

  // Deep-links into the (collapsed) supported-formats list: landing on
  // /about.html#ext-sldprt or #fmt-cad from a search result should expand the
  // dropdown and scroll to the target.
  function revealHashTarget() {
    const id = decodeURIComponent((location.hash || '').slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const details = target.closest('details');
    if (details) details.open = true;
    requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
  }
  revealHashTarget();
  if (!boot._hashWired) {
    boot._hashWired = true;
    window.addEventListener('hashchange', revealHashTarget);
  }

  // ----- Format help overlay -----
  const fmtBtn = $('fmtHelpBtn');
  const fmtOverlay = $('fmtOverlay');
  const fmtClose = $('fmtOverlayClose');
  const fmtSearch = $('fmtSearch');
  if (fmtBtn && fmtOverlay) {
    fmtBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fmtOverlay.hidden = false;
      document.body.style.overflow = 'hidden';
      if (fmtSearch) { fmtSearch.value = ''; if (matchMedia('(pointer:fine)').matches) fmtSearch.focus(); }
      fmtOverlay.querySelectorAll('tr[data-fmt]').forEach(r => r.classList.remove('is-hidden'));
      fmtOverlay.querySelectorAll('.fmt-section-label').forEach(l => l.style.display = '');
    });
    function closeFmt() { fmtOverlay.hidden = true; document.body.style.overflow = ''; }
    if (fmtClose) fmtClose.addEventListener('click', closeFmt);
    fmtOverlay.addEventListener('click', (e) => { if (e.target === fmtOverlay) closeFmt(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !fmtOverlay.hidden) closeFmt(); });
    if (fmtSearch) {
      const rows = fmtOverlay.querySelectorAll('tr[data-fmt]');
      const labels = fmtOverlay.querySelectorAll('.fmt-section-label');
      fmtSearch.addEventListener('input', () => {
        const q = fmtSearch.value.trim().toLowerCase();
        rows.forEach(r => {
          const text = (r.querySelector('th').textContent + ' ' + r.querySelector('td').textContent + ' ' + (r.dataset.tags || '')).toLowerCase();
          r.classList.toggle('is-hidden', q && !text.includes(q));
        });
        labels.forEach(label => {
          const table = label.nextElementSibling;
          if (!table) return;
          const visible = table.querySelectorAll('tr[data-fmt]:not(.is-hidden)').length;
          label.style.display = visible ? '' : 'none';
        });
      });
    }
  }

  // ----- Search -----
  initSearch();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

window.addEventListener('anr:navigate', boot);
