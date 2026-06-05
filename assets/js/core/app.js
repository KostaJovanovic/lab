/* Analyser - entry point
   - Boots photo + audio + video modules
   - Acts as the page-wide drop target (until the first file lands)
   - Classifies dropped files into photo / audio / video / unknown
   - Renders a basic dump for unknown formats */

const COMMIT_COUNT = 55;
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

import { initPhoto, renderPhoto } from '../renderers/photo.js';
import { initAudio, renderAudio } from '../renderers/audio.js';
import { initVideo, renderVideo } from '../renderers/video.js';
import { renderPdf } from '../renderers/pdf.js';
import { renderArchive } from '../renderers/archive.js';
import { renderSvg } from '../renderers/svg.js';
import { renderCsv } from '../renderers/csv.js';
import { renderUnknown } from '../renderers/unknown.js';
import { renderProprietary, isProprietaryExt } from '../renderers/proprietary.js';
import { renderDocx } from '../renderers/docx.js';
import { renderXlsx } from '../renderers/xlsx.js';
import { renderEpub } from '../renderers/epub.js';
import { renderPptx } from '../renderers/pptx.js';
import { renderStl } from '../renderers/stl.js';
import { renderLrc } from '../renderers/lrc.js';
import { renderMidi } from '../renderers/midi.js';
import { renderSubtitles } from '../renderers/subtitles.js';
import { renderGeo } from '../renderers/geo.js';
import { renderMarkdown } from '../renderers/markdown.js';
import { renderComic } from '../renderers/comic.js';
import { initSearch } from './search.js';
import { fileExt, el, probeReadable, isUnreadableError, cloudFileWarning } from './util.js';
import { walkItems, renderFolder } from '../renderers/folder.js';
import {
  PHOTO_EXTS, AUDIO_EXTS, VIDEO_EXTS, CSV_EXTS, SVG_EXTS,
  renderFmtOverlay, renderAboutFormats, formatCount
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

// ---------- true file-type sniffing ----------
// Detect what a file ACTUALLY is from its leading bytes, independent of its name,
// so a file with no extension (or an extension that lies) can still be analysed
// correctly. Returns { kind, ext, label } where kind is a ROUTES key and ext
// drives the proprietary/comic renderers, or null if nothing is recognised.
async function sniffFileType(file) {
  let b;
  try { b = new Uint8Array(await file.slice(0, 264).arrayBuffer()); } catch (_) { return null; }
  if (!b.length) return null;
  const a = (s, n) => { let r = ''; for (let i = s; i < s + n && i < b.length; i++) r += String.fromCharCode(b[i]); return r; };
  const m = (sig, off = 0) => { for (let i = 0; i < sig.length; i++) if (b[off + i] !== sig[i]) return false; return true; };

  if (a(0, 5) === '%PDF-') return { kind: 'pdf', ext: 'pdf', label: 'PDF document' };
  if (m([0x89, 0x50, 0x4E, 0x47])) return { kind: 'photo', ext: 'png', label: 'PNG image' };
  if (m([0xFF, 0xD8, 0xFF])) return { kind: 'photo', ext: 'jpg', label: 'JPEG image' };
  if (a(0, 3) === 'GIF') return { kind: 'photo', ext: 'gif', label: 'GIF image' };
  if (m([0x42, 0x4D]) && b.length > 14) return { kind: 'photo', ext: 'bmp', label: 'BMP image' };
  if (m([0x49, 0x49, 0x2A, 0x00]) || m([0x4D, 0x4D, 0x00, 0x2A])) return { kind: 'photo', ext: 'tiff', label: 'TIFF image' };
  if (m([0x38, 0x42, 0x50, 0x53])) return { kind: 'proprietary', ext: 'psd', label: 'Photoshop PSD' };
  if (a(0, 4) === 'RIFF') {
    const f = a(8, 4);
    if (f === 'WEBP') return { kind: 'photo', ext: 'webp', label: 'WebP image' };
    if (f === 'WAVE') return { kind: 'audio', ext: 'wav', label: 'WAV audio' };
    if (f === 'AVI ') return { kind: 'video', ext: 'avi', label: 'AVI video' };
  }
  if (a(4, 4) === 'ftyp') {
    const brand = a(8, 4);
    if (/heic|heix|hevc|mif1|heif/i.test(brand)) return { kind: 'photo', ext: 'heic', label: 'HEIC image' };
    if (/avif/i.test(brand)) return { kind: 'photo', ext: 'avif', label: 'AVIF image' };
    if (/m4a|m4b/i.test(brand)) return { kind: 'audio', ext: 'm4a', label: 'M4A audio' };
    if (/3gp|3g2/i.test(brand)) return { kind: 'video', ext: '3gp', label: '3GP video' };
    return { kind: 'video', ext: 'mp4', label: 'MP4 video' };
  }
  if (m([0x1A, 0x45, 0xDF, 0xA3])) return { kind: 'video', ext: 'mkv', label: 'Matroska / WebM video' };
  if (a(0, 4) === 'OggS') return { kind: 'audio', ext: 'ogg', label: 'Ogg audio' };
  if (a(0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return { kind: 'audio', ext: 'mp3', label: 'MP3 audio' };
  if (a(0, 4) === 'fLaC') return { kind: 'audio', ext: 'flac', label: 'FLAC audio' };
  if (m([0x50, 0x4B, 0x03, 0x04]) || m([0x50, 0x4B, 0x05, 0x06])) return { kind: 'zip', ext: 'zip', label: 'ZIP archive' };
  if (a(0, 4) === 'Rar!') return { kind: 'proprietary', ext: 'rar', label: 'RAR archive' };
  if (m([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])) return { kind: 'proprietary', ext: '7z', label: '7-Zip archive' };
  if (a(0, 6) === 'SQLite') return { kind: 'proprietary', ext: 'sqlite', label: 'SQLite database' };
  if (m([0x1F, 0x8B])) return { kind: 'proprietary', ext: 'gz', label: 'GZip archive' };
  if (m([0x7F, 0x45, 0x4C, 0x46])) return { kind: 'proprietary', ext: 'elf', label: 'ELF executable' };
  if (m([0x4D, 0x5A])) return { kind: 'proprietary', ext: 'exe', label: 'Windows executable' };
  if (m([0xC5, 0xD0, 0xD3, 0xC7]) || a(0, 4) === '%!PS') return { kind: 'proprietary', ext: 'eps', label: 'PostScript / EPS' };
  if (b.length >= 132 && a(128, 4) === 'DICM') return { kind: 'proprietary', ext: 'dcm', label: 'DICOM medical image' };
  const start = a(0, Math.min(b.length, 220)).trimStart();
  if (start.startsWith('<svg') || (start.includes('<svg') && start.includes('xmlns'))) return { kind: 'svg', ext: 'svg', label: 'SVG image' };
  return null;
}

// Bottom-of-window suggestion popup (same look as the drop loader) offering to
// re-analyse a file as its sniffed true type.
let _typeSuggestEl = null;
function hideTypeSuggestion() {
  if (!_typeSuggestEl) return;
  const e = _typeSuggestEl; _typeSuggestEl = null;
  e.classList.remove('is-open');
  setTimeout(() => e.remove(), 200);
}
function showTypeSuggestion(sniff, onAccept) {
  hideTypeSuggestion();
  const label = el('div', { class: 'anr-drop-loader-label' }, 'This looks like a ' + sniff.label + '.');
  const dismiss = el('button', { type: 'button', class: 'anr-drop-loader-cancel' }, 'Dismiss');
  dismiss.addEventListener('click', hideTypeSuggestion);
  const head = el('div', { class: 'anr-drop-loader-head' }, [label, dismiss]);
  const yes = el('button', { type: 'button', class: 'anr-btn', style: 'font-size:11px;padding:4px 12px;' }, 'Analyse as ' + sniff.label);
  yes.addEventListener('click', () => { hideTypeSuggestion(); onAccept(); });
  _typeSuggestEl = el('div', { class: 'anr-drop-loader', role: 'status' }, [head, el('div', { style: 'margin-top:8px;' }, [yes])]);
  document.body.appendChild(_typeSuggestEl);
  requestAnimationFrame(() => _typeSuggestEl.classList.add('is-open'));
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
  if (ext === 'cbz' || ext === 'cbr' || ext === 'cbt' || ext === 'cb7') return 'comic';
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
  comic:       { render: renderComic,       results: 'unknown', scroll: '#unknownResults' },
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

// Splits an element's text into per-letter inline-block <span>s, each carrying a
// base font-weight, so a proximity effect can vary letters independently. Bakes
// letter-spacing as an em ratio (survives browser zoom on vw-sized type). Each
// word's letters are grouped in a nowrap wrapper so the inline-block letters can
// only break at the spaces between words, never mid-word; the spaces themselves
// are real break opportunities. Returns an array of { el, base } for every letter
// span. Shared by the header sweep/hover effect and the per-section hover effect.
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
  let word = null;  // current per-word wrapper; null between words
  function makeSpan(ch, parent) {
    if (ch === ' ') {
      // Space ends the word and becomes the sole wrap point: a fixed-width
      // inline-block (so the header sweep glides smoothly across the gap) plus a
      // <wbr> so the line can break here. Without grouping, adjacent inline-block
      // letters break between themselves and a word can split mid-letter.
      word = null;
      const sp = document.createElement('span');
      sp.style.display = 'inline-block';
      sp.style.width = '0.25em';
      parent.appendChild(sp);
      parent.appendChild(document.createElement('wbr'));
      return;
    }
    if (!word) {
      word = document.createElement('span');
      word.style.display = 'inline-block';
      word.style.whiteSpace = 'nowrap';
      parent.appendChild(word);
    }
    const s = document.createElement('span');
    s.textContent = ch;
    s.style.display = 'inline-block';
    s.style.fontWeight = baseWeight;
    s.style.letterSpacing = spacing;
    word.appendChild(s);
    spans.push({ el: s, base: baseWeight });
  }
  const nodes = [...container.childNodes];
  container.textContent = '';
  for (const node of nodes) {
    word = null;  // never carry a word across a child-element boundary (e.g. the byline <a>)
    if (node.nodeType === 3) {
      for (const ch of node.textContent) makeSpan(ch, container);
    } else {
      const text = node.textContent;
      node.textContent = '';
      container.appendChild(node);
      for (const ch of text) makeSpan(ch, node);
    }
    word = null;
  }
  return spans;
}

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

    // letters are split via the shared module-level splitText() defined above.
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
    let raf = 0, running = false, fxT = 0;

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
      if (inside || sweep) {
        for (const l of letters) l.el.style.fontWeight = letterWeight(l);
        raf = requestAnimationFrame(frame);
      } else {
        // Don't overwrite to base here - leave the letters at their last hover
        // weight so settle() can ease them back over 0.4s instead of snapping.
        running = false;
        settle();
      }
    }
    function ensureRunning() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function settle() {
      clearTimeout(fxT);
      for (const l of letters) { l.el.style.transition = 'font-weight 0.4s ease'; l.el.style.fontWeight = l.base; }
      fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; }, 500);
    }
    function startSweep(radius) {
      const rect = mark.getBoundingClientRect();
      sweep = { t0: null, duration: 3500, sx: rect.left - radius, ex: rect.right + radius,
                cy: rect.top + rect.height / 2, vx: rect.left - radius, radius };
      ensureRunning();
    }

    if (window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
      const activateHover = () => {
        if (!inside) {
          inside = true;
          // Ease the letters into their hover weight on entry, then drop the
          // transition so subsequent cursor tracking stays instant (no lag).
          clearTimeout(fxT);
          for (const l of letters) l.el.style.transition = 'font-weight 0.4s ease';
          fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; }, 420);
        }
        ensureRunning();
      };
      mark.addEventListener('mouseenter', activateHover);
      // Also activate on mousemove: mousemove only fires while the pointer is over
      // the header, so this catches the case where the cursor was already inside
      // when the page loaded (or during the intro sweep), when mouseenter never
      // fires and hover would otherwise stay dead until you leave and re-enter.
      mark.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; activateHover(); });
      mark.addEventListener('mouseleave', () => { inside = false; });  // settles once the sweep also ends
      setTimeout(() => startSweep(RADIUS_HOVER), 800);
    } else if (window.matchMedia('(pointer: coarse)').matches) {
      setTimeout(() => startSweep(RADIUS_TOUCH), 800);
      setupHeaderFx._iv = setInterval(() => startSweep(RADIUS_TOUCH), 8000);
    }
}

// Section-heading hover effect. Reuses the header's "letters thin toward the
// cursor" feel on each section's number / kicker / heading - but hover-only,
// with NO intro sweep (no "wave"). Desktop fine-pointer only. Re-runs per
// navigation; the per-section guard keeps it from binding twice. Each section is
// independent, so hovering section 01 never disturbs section 02.
function setupSectionFx() {
  if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  const RADIUS = 120;
  document.querySelectorAll('.section').forEach(section => {
    if (section._anrSectionFx) return;
    const heads = section.querySelectorAll('.section-num, .section-kicker, .section-head');
    if (!heads.length) return;
    section._anrSectionFx = true;

    const letters = [];
    heads.forEach(el => {
      const base = parseInt(getComputedStyle(el).fontWeight, 10) || 400;
      letters.push(...splitText(el, base));
    });

    // Freeze text wrapping during hover. The per-letter weight change alters word
    // widths, which would otherwise reflow the heading onto different lines as the
    // cursor moves. Lock each word's box to its base-weight width (measured once on
    // first hover - the widest state, since the effect only lightens letters) and
    // release it on settle so the heading stays freely responsive when idle.
    const words = [...new Set(letters.map((l) => l.el.parentElement).filter(Boolean))];
    let baseWidths = null;
    const lockWidths = () => {
      if (!baseWidths) baseWidths = words.map((w) => w.offsetWidth);
      words.forEach((w, i) => { w.style.width = baseWidths[i] + 'px'; });
    };
    const unlockWidths = () => { for (const w of words) w.style.width = ''; };

    let mx = -9999, my = -9999, inside = false, raf = 0, running = false, fxT = 0;
    const weight = (l) => {
      const r = l.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const t = inside ? Math.min(1, Math.hypot(mx - cx, my - cy) / RADIUS) : 1;
      return Math.round(l.base * t + 300 * (1 - t));
    };
    const settle = () => {
      clearTimeout(fxT);
      for (const l of letters) { l.el.style.transition = 'font-weight 0.4s ease'; l.el.style.fontWeight = l.base; }
      // Release the width locks only after letters have eased back to base weight,
      // so removing them can't itself cause a reflow.
      fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; unlockWidths(); }, 500);
    };
    const frame = () => {
      if (inside) {
        for (const l of letters) l.el.style.fontWeight = weight(l);
        raf = requestAnimationFrame(frame);
      } else {
        // Leave letters at their last hover weight so settle() can ease them
        // back over 0.4s rather than snapping straight to base.
        running = false;
        settle();
      }
    };
    section.addEventListener('mouseenter', () => {
      lockWidths();                 // measure/apply base widths before any weight change
      inside = true;
      // Ease the letters in on entry, then drop the transition so tracking is instant.
      clearTimeout(fxT);
      for (const l of letters) l.el.style.transition = 'font-weight 0.4s ease';
      fxT = setTimeout(() => { for (const l of letters) l.el.style.transition = ''; }, 420);
      if (!running) { running = true; raf = requestAnimationFrame(frame); }
    });
    section.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
    section.addEventListener('mouseleave', () => { inside = false; });
  });
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

    // Clear nav indicators and re-enable the media nav links (a fresh load
    // re-disables them if the new file isn't photo/audio/video - see handleFile).
    document.querySelectorAll('.nav-link.has-data').forEach(link => link.classList.remove('has-data'));
    document.querySelectorAll('.nav-link.is-disabled').forEach(link => link.classList.remove('is-disabled'));
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

  async function handleFile(file, opts) {
    if (!file) return;
    // opts carries either a forced type ({kind, ext}, from the sniff popup) or a
    // paired RAW develop-settings sidecar ({sidecarXmp}, from a RAW+XMP drop).
    const force = (opts && opts.kind) ? opts : null;
    const sidecarXmp = (opts && opts.sidecarXmp) || null;
    hideTypeSuggestion();
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

    let kind = force ? force.kind : classifyFile(file);

    // For files classified as 'unknown', check magic bytes for PDF / ZIP / SVG / CSV
    if (!force && kind === 'unknown') {
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

    // Offer to re-analyse as the sniffed true type when the file has no extension
    // or its extension disagrees with its actual content. Shown as a popup once
    // the normal (extension-based) analysis has rendered.
    let suggestion = null;
    if (!force) {
      try {
        const sniff = await sniffFileType(file);
        if (token.cancelled) return;
        const noExt = !fileExt(file.name);
        const zipFamily = new Set(['docx', 'xlsx', 'pptx', 'epub', 'zip', 'comic']);
        const offerable = noExt || kind === 'unknown' || kind === 'proprietary'
          || kind === 'photo' || kind === 'audio' || kind === 'video';
        if (sniff && sniff.kind !== kind && !(sniff.kind === 'zip' && zipFamily.has(kind)) && offerable) {
          suggestion = sniff;
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

    // The Photo/Sound/Video nav links only make sense when their section is on the
    // page. Grey out + disable any whose section is now hidden (a non-media file
    // hides them); Home and Search are separate controls and always stay live.
    [['#photo', sectionPhoto], ['#audio', sectionAudio], ['#video', sectionVideo]].forEach(([href, sec]) => {
      const link = document.querySelector('.site-nav a[href="' + href + '"]');
      if (link) link.classList.toggle('is-disabled', !sec || sec.hidden);
    });

    const route = ROUTES[kind] || ROUTES.unknown;
    const resultsByName = {
      photo: photoResults, audio: audioResults, video: videoResults, unknown: unknownResults,
    };
    (route.nav || []).forEach(markNav);
    (route.analysed || []).forEach(markAnalysed);
    scrollTo(route.scroll);
    const extOverride = force && force.ext;
    let renderPromise;
    if ((kind === 'proprietary' || kind === 'comic') && extOverride) {
      renderPromise = route.render(file, resultsByName[route.results], extOverride);
    } else if (kind === 'photo' && sidecarXmp) {
      renderPromise = route.render(file, resultsByName[route.results], { sidecarXmp });
    } else {
      renderPromise = route.render(file, resultsByName[route.results]);
    }
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
      if (suggestion) {
        showTypeSuggestion(suggestion, () => handleFile(file, { kind: suggestion.kind, ext: suggestion.ext }));
      }
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
      if (_handleFile) {
        const list = Array.from(files);
        // Pair a RAW/photo with its same-named .xmp develop-settings sidecar (as
        // written by Photoshop / Lightroom / Camera Raw) so the develop settings
        // show alongside the photo. A matched .xmp is consumed; everything else
        // analyses on its own.
        const baseOf = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();
        const extOf = (n) => (n.split('.').pop() || '').toLowerCase();
        const xmpByBase = new Map();
        for (const f of list) if (extOf(f.name) === 'xmp') xmpByBase.set(baseOf(f.name), f);
        const consumed = new Set();
        for (const f of list) {
          if (extOf(f.name) === 'xmp') continue;
          const xmp = PHOTO_EXTS.has(extOf(f.name)) ? xmpByBase.get(baseOf(f.name)) : null;
          if (xmp) { consumed.add(xmp); _handleFile(f, { sidecarXmp: xmp }); }
          else _handleFile(f);
        }
        for (const f of list) if (extOf(f.name) === 'xmp' && !consumed.has(f)) _handleFile(f);
      }
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
  // Hover effect on each section's number / kicker / heading (no sweep).
  setupSectionFx();

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
    // A greyed-out (disabled) nav link is never highlighted - its section isn't
    // really on the page for a non-media file.
    for (const s of sections) s.a.classList.toggle('is-active', s === active && !s.a.classList.contains('is-disabled'));
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
      './', './index.html', './about.html', './patch.html', './manifest.json', './assets/css/analyser.css', './assets/css/fonts.css',
      './assets/js/core/app.js', './assets/js/core/formats.js', './assets/js/core/util.js', './assets/js/core/search.js',
      './assets/js/renderers/photo.js', './assets/js/renderers/audio.js', './assets/js/renderers/audio-analysis.js',
      './assets/js/renderers/audio-codec.js', './assets/js/renderers/video.js', './assets/js/renderers/spectrogram.js',
      './assets/js/renderers/pdf.js', './assets/js/renderers/archive.js', './assets/js/renderers/svg.js',
      './assets/js/renderers/csv.js', './assets/js/renderers/unknown.js', './assets/js/renderers/proprietary.js',
      './assets/js/renderers/folder.js', './assets/js/renderers/folder-archive-shared.js',
      './assets/js/renderers/treemap.js', './assets/js/core/navigate.js',
      './assets/js/renderers/photo-convert.js', './assets/js/renderers/audio-player.js', './assets/js/renderers/video-avi.js',
      './assets/js/renderers/docx.js', './assets/js/renderers/xlsx.js', './assets/js/renderers/epub.js',
      './assets/js/renderers/pptx.js', './assets/js/renderers/stl.js', './assets/js/renderers/zip.js',
      './assets/js/renderers/lrc.js', './assets/js/renderers/midi.js', './assets/js/renderers/subtitles.js',
      './assets/js/renderers/geo.js', './assets/js/renderers/markdown.js', './assets/js/renderers/comic.js',
      './assets/js/core/binutil.js', './assets/js/lib/plist.js', './assets/js/lib/cfbf.js', './assets/js/lib/sqlite.js', './assets/js/lib/libarchive-loader.js', './assets/js/lib/openjpeg-loader.js', './assets/js/lib/xz-loader.js', './assets/js/lib/ghostscript-loader.js', './assets/js/parsers/parsers-dev.js',
      './assets/js/parsers/parsers-archive.js', './assets/js/parsers/parsers-email.js',
      './assets/js/parsers/parsers-security.js', './assets/js/parsers/parsers-gaming.js',
      './assets/js/parsers/parsers-disk.js', './assets/js/parsers/parsers-sci.js', './assets/js/parsers/parsers-osmisc.js',
      './assets/js/parsers/parsers-image.js', './assets/js/parsers/parsers-threed.js', './assets/js/parsers/parsers-geodata.js',
      './assets/js/parsers/parsers-audio.js', './assets/js/parsers/parsers-video.js', './assets/js/parsers/parsers-docs.js',
      './assets/js/parsers/parsers-raw.js',
      './assets/img/favicon.svg', './assets/img/icon.png', './assets/img/icon-192.png', './assets/img/icon-512.png',
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
      './assets/vendor/fflate.js',
      './assets/vendor/lottie/lottie.min.js',
      './assets/vendor/sqljs/sql-wasm.js',
      './assets/vendor/sqljs/sql-wasm.wasm',
      './assets/vendor/fzstd.js',
      './assets/vendor/libarchive/la-archive.js',
      './assets/vendor/libarchive/worker-bundle.js',
      './assets/vendor/libarchive/wasm-gen/libarchive.wasm',
      './assets/vendor/openjpeg/openjpegwasm.js',
      './assets/vendor/openjpeg/openjpegwasm.wasm',
      './assets/vendor/xzwasm/xzwasm.min.js'
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
      // Ghostscript (~16 MB) for EPS/PostScript rendering - heaviest tier only.
      .concat([
        './assets/vendor/ghostscript/gs.mjs',
        './assets/vendor/ghostscript/browser.js',
        './assets/vendor/ghostscript/gs.js',
        './assets/vendor/ghostscript/gs.wasm'
      ])
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
  // index.html has #fmtBody (the overlay); about.html has #aboutFormats and its
  // own copy of #fmtBody (the same overlay markup).
  renderFmtOverlay($('fmtBody'));
  renderAboutFormats($('aboutFormats'));

  // Drop the live format count into every element that asks for it (popup
  // header, feature bullets, and the clickable "N supported formats"
  // affordances). data-fmt-count="bare" gets just the number; otherwise the
  // element keeps its template text with {n} substituted, or falls back to
  // "N supported formats".
  const fmtN = formatCount();
  document.querySelectorAll('[data-fmt-count]').forEach(elm => {
    const mode = elm.getAttribute('data-fmt-count');
    if (mode === 'bare') elm.textContent = String(fmtN);
    else if (elm.dataset.fmtCountTpl) elm.textContent = elm.dataset.fmtCountTpl.replace('{n}', fmtN);
    else elm.textContent = fmtN + ' supported formats';
  });

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
  // Any element with the [data-fmt-open] attribute (the dropzone Info button,
  // the feature bullets, the "N supported formats" affordance, the about-page
  // summary) opens the popup. The overlay markup lives on both index.html and
  // about.html, so this runs per-navigation.
  const fmtOverlay = $('fmtOverlay');
  const fmtClose = $('fmtOverlayClose');
  const fmtSearch = $('fmtSearch');
  if (fmtOverlay) {
    const items = fmtOverlay.querySelectorAll('.fmt-item');
    const labels = fmtOverlay.querySelectorAll('.fmt-section-label');

    function applyFilter() {
      const q = fmtSearch ? fmtSearch.value.trim().toLowerCase() : '';
      items.forEach(it => {
        const text = (
          it.querySelector('.fmt-item-label').textContent + ' ' +
          it.querySelector('.fmt-item-exts').textContent + ' ' +
          (it.dataset.tags || '') + ' ' +
          it.querySelector('.fmt-item-desc').textContent
        ).toLowerCase();
        const match = !q || text.includes(q);
        it.classList.toggle('is-hidden', !match);
        // Auto-open matches so the matched text shows; collapse when cleared.
        it.open = q ? match : false;
      });
      labels.forEach(label => {
        const list = label.nextElementSibling;
        if (!list) return;
        const visible = list.querySelectorAll('.fmt-item:not(.is-hidden)').length;
        label.style.display = visible ? '' : 'none';
      });
    }

    function openFmt() {
      fmtOverlay.hidden = false;
      document.body.style.overflow = 'hidden';
      if (fmtSearch) {
        fmtSearch.value = '';
        if (matchMedia('(pointer:fine)').matches) fmtSearch.focus();
      }
      applyFilter();
    }
    function closeFmt() { fmtOverlay.hidden = true; document.body.style.overflow = ''; }

    document.querySelectorAll('[data-fmt-open]').forEach(trigger => {
      if (trigger._fmtWired) return;
      trigger._fmtWired = true;
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFmt();
      });
    });

    if (fmtClose) fmtClose.addEventListener('click', closeFmt);
    fmtOverlay.addEventListener('click', (e) => { if (e.target === fmtOverlay) closeFmt(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !fmtOverlay.hidden) closeFmt(); });
    if (fmtSearch) fmtSearch.addEventListener('input', applyFilter);
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
