/* Analyser - entry point
   - Boots photo + audio + video modules
   - Acts as the page-wide drop target (until the first file lands)
   - Classifies dropped files into photo / audio / video / unknown
   - Renders a basic dump for unknown formats */

const COMMIT_COUNT = ;
// Versioning: every commit is its own version. Pre-1.0 commits read 0.01, 0.02,
// 0.03 … (the part after the dot is the commit's 1-based position, zero-padded to
// two digits - 0.09, 0.10, 0.11). Each commit listed in RELEASE_COMMITS bumps the
// major version and resets the counter within its era: commit 29 reads "1.0" (and
// 30 → "1.01"), commit 60 reads "2.0" (and 61 → "2.01"). To crown a future 3.0,
// append its commit number here (keep the list sorted ascending, and mirror the
// RELEASES constant in save.bat).
const RELEASE_COMMITS = [29, 60, 100];

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
import { renderArchive, renderArchiveEmbedded } from '../renderers/archive.js';
import { renderSvg } from '../renderers/svg.js';
import { renderCsv } from '../renderers/csv.js';
import { renderUnknown } from '../renderers/unknown.js';
import { renderProprietary, isProprietaryExt, extractPeIcon } from '../renderers/proprietary.js';
import { renderDocx } from '../renderers/docx.js';
import { renderXlsx } from '../renderers/xlsx.js';
import { renderEpub } from '../renderers/epub.js';
import { renderPptx } from '../renderers/pptx.js';
import { renderStl } from '../renderers/stl.js';
import { renderModel3d } from '../renderers/model3d.js';
import { renderTimeline } from '../renderers/timeline.js';
import { renderLrc } from '../renderers/lrc.js';
import { renderMidi } from '../renderers/midi.js';
import { renderSubtitles } from '../renderers/subtitles.js';
import { renderGeo } from '../renderers/geo.js';
import { renderMarkdown } from '../renderers/markdown.js';
import { renderComic } from '../renderers/comic.js';
import { renderGitObject, sniffGitObject } from '../renderers/gitobject.js';
import { initSearch } from './search.js';
import { fileExt, el, probeReadable, cloudFileWarning, openOverlayBack } from './util.js';
import { walkItems, renderFolder } from '../renderers/folder.js';
import { setupHeaderFx, setupSectionFx, setupFooterFx, setupFmtHeaderFx } from './effects.js';
import { showSuggestPopup, hideSuggestPopup, scheduleShareNudge, hideShareNudge, wireShareButtons, wireFooterContact, updateNetStatus } from './popups.js';
import { wireExportButton } from './export-data.js';
import {
  PHOTO_EXTS, AUDIO_EXTS, VIDEO_EXTS, CSV_EXTS, SVG_EXTS,
  renderFmtOverlay, renderAboutFormats, formatCount,
  CATEGORIES, categoryCounts, catalogGrouped,
  formatPageHref, hasFormatPage
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
let _dropLoaderHideTimer = null;
let _dropLoaderOnCancel = null;
let _dropLoaderShownAt = 0;
// Intent flag: true once reveal() commits to showing the bar - set BEFORE the
// rAF that actually applies the is-open class, so hideDropLoader() can tell
// "about to show" apart from "never shown" and never lose the race.
let _dropLoaderOpen = false;
// Once the bar is actually on screen, keep it up at least this long so a near-
// instant render (e.g. a small file opened straight from a folder/zip view,
// already in memory) doesn't make it flash-and-vanish.
const DROP_LOADER_MIN_MS = 420;

// `immediate` skips the 160ms anti-flash debounce. Use it when the source bytes
// are already in memory (a nested file from a folder/zip/document), where the
// render finishes before the debounce fires - so without this the bar would
// never show. Disk-backed drops keep the debounce (they cross 160ms on their own).
function showDropLoader(file, onCancel, labelText, immediate) {
  clearTimeout(_dropLoaderTimer);
  clearTimeout(_dropLoaderHideTimer);
  _dropLoaderOnCancel = onCancel || null;
  const name = (file && file.name) ? file.name : 'file';
  const reveal = () => {
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
    _dropLoaderEl._label.textContent = labelText || ('Reading ' + name + '…');
    _dropLoaderShownAt = performance.now();
    _dropLoaderOpen = true;
    // Guard the class-add on the intent flag: if hideDropLoader() runs in the
    // sub-frame gap before this fires (a render that settled in ~1 frame), it
    // clears _dropLoaderOpen, so the bar is never shown - otherwise it would
    // latch on here with nothing left to remove it (the stuck-loader bug).
    requestAnimationFrame(() => { if (_dropLoaderOpen && _dropLoaderEl) _dropLoaderEl.classList.add('is-open'); });
  };
  if (immediate) reveal();
  else _dropLoaderTimer = setTimeout(reveal, 160);
}

function hideDropLoader() {
  clearTimeout(_dropLoaderTimer);
  clearTimeout(_dropLoaderHideTimer);
  _dropLoaderOnCancel = null;
  if (!_dropLoaderEl) return;
  // Never committed to showing (cancelled within the 160ms debounce). Check the
  // intent flag, NOT the is-open class - the class lags a frame behind reveal(),
  // so a class check here would bail during that gap and let the pending rAF
  // latch the bar on permanently.
  if (!_dropLoaderOpen) return;
  // doHide drops the intent first (so a still-pending reveal rAF won't re-add
  // is-open) then removes the class. The bar's CSS animation pauses itself via
  // `:not(.is-open)` (see CSS), so there's nothing else to tear down.
  const doHide = () => { _dropLoaderOpen = false; if (_dropLoaderEl) _dropLoaderEl.classList.remove('is-open'); };
  // Already visible: honour the minimum on-screen time so it doesn't flash.
  const shownFor = performance.now() - _dropLoaderShownAt;
  if (shownFor >= DROP_LOADER_MIN_MS) doHide();
  else _dropLoaderHideTimer = setTimeout(doHide, DROP_LOADER_MIN_MS - shownFor);
}

// Let renderers outside the main drop flow (e.g. the video module's "Analyse
// audio" button) drive the same bottom loading popup while they do heavy work.
// The bar is a CSS animation, so it keeps stepping even under the heavy
// synchronous decode/FFT work these actions trigger.
window._anrLoader = {
  show: (label) => showDropLoader(null, null, label || 'Working…'),
  hide: hideDropLoader,
};

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
  // 3D models with an interactive WebGL viewer. Native meshes: STL (above), OBJ,
  // PLY, OFF, 3MF, AMF. B-rep CAD via OpenCASCADE: STEP, IGES, BREP.
  if (ext === '3mf' || ext === 'amf' || ext === 'obj' || ext === 'ply' || ext === 'off') return 'model3d';
  if (ext === 'step' || ext === 'stp' || ext === 'iges' || ext === 'igs' || ext === 'brep') return 'model3d';
  // Editing timelines (interchange formats): visual track/clip timeline view.
  if (ext === 'edl' || ext === 'fcpxml' || ext === 'otio') return 'timeline';
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
  model3d:     { render: renderModel3d,     results: 'unknown', scroll: '#unknownResults' },
  timeline:    { render: renderTimeline,    results: 'unknown', scroll: '#unknownResults' },
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
  'git-object':{ render: renderGitObject,   results: 'unknown', scroll: '#unknownResults' },
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

// ---------- anonymous usage counters ----------
// The only network calls this otherwise fully-local tool ever makes. They send
// NOTHING about your file's contents or name - just the lowercase extension
// string ("jpg") and an increment - to the stats Worker (worker/index.js). Every
// call is fire-and-forget and swallowed, so a failure (offline, blocked, or local
// `server.bat` with no real API) never touches analysis. Details on /privacy.
function recordAnalysed(ext, supported) {
  try {
    fetch('/api/analysed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ext: ext || '', supported: !!supported }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}
}

// Count one visit and return the live totals for the homepage badge. Cached in a
// module variable so it pings the network at most once per page load - SPA
// navigations reuse the cached totals (the server also dedupes to one counted
// visit per IP / 3 days, so a stray repeat ping is harmless either way).
let _visitTotals = null;
async function recordVisit() {
  if (_visitTotals) return _visitTotals;
  try {
    const resp = await fetch('/api/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const data = await resp.json();
    if (data && typeof data.visitors === 'number') _visitTotals = data;
    return _visitTotals;
  } catch (_) {
    return null;
  }
}

// ---------- /stats page ----------
// Populates the stats page from GET /api/stats: the two totals, plus a
// per-extension table that opens at the top 10 and expands to the full list. A
// no-op anywhere #statsRoot is absent (every page but /stats), and it degrades
// to a friendly message offline or against the mock-less local dev server.
async function setupStatsPage() {
  if (!$('statsRoot')) return;
  const statusEl = $('statsStatus');
  const body = $('statsExtBody');
  const toggle = $('statsExtToggle');
  const TOP = 10;

  let data = null;
  try {
    const resp = await fetch('/api/stats', { headers: { accept: 'application/json' } });
    if (!resp.ok) throw new Error('bad status');
    data = await resp.json();
  } catch (_) { data = null; }

  if (!data || typeof data.files !== 'number') {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = 'Live stats are not available right now - you may be offline, or previewing locally. Try again later.';
    }
    if (body) {
      body.innerHTML = '';
      body.appendChild(el('tr', {}, el('td', { class: 'stats-empty', colspan: '4' }, 'Unavailable')));
    }
    if (toggle) toggle.hidden = true;
    return;
  }
  if (statusEl) statusEl.hidden = true;

  const fEl = $('statsFiles'); if (fEl) fEl.textContent = data.files.toLocaleString();
  const vEl = $('statsVisitors'); if (vEl) vEl.textContent = data.visitors.toLocaleString();
  // The totals are now real numbers (not the "-" placeholder), so let them join
  // the section's per-letter hover effect, like the header.
  setupSectionFx();

  // Asteroids easter-egg leaderboard card (top 5). Shown only when there are
  // scores; rendered before the ext early-returns so it appears even with no exts.
  const scoreCard = $('statsScores');
  const scoreList = $('statsScoresList');
  const scoreToggle = $('statsScoresToggle');
  if (scoreCard && scoreList) {
    const scores = Array.isArray(data.scores) ? data.scores : [];
    // The card stays hidden entirely until at least one score exists.
    if (!scores.length) {
      scoreCard.hidden = true;
    } else {
      scoreCard.hidden = false;
      // Same toggle behaviour as the extensions table: open at the top 5, reveal
      // ten more per click, "Show last N" at the tail, then the button hides.
      const SCORES_TOP = 5;
      const SCORES_STEP = 10;
      const scoreRow = (s) => el('li', { class: 'stats-score-row' }, [
        el('span', { class: 'stats-score-name' }, String(s.name)),
        el('span', { class: 'stats-score-num' }, Number(s.score).toLocaleString()),
      ]);
      let scoresShown = SCORES_TOP;
      const renderScores = () => {
        scoreList.innerHTML = '';
        scores.slice(0, scoresShown).forEach((s) => scoreList.appendChild(scoreRow(s)));
        if (!scoreToggle) return;
        const remaining = scores.length - scoresShown;
        if (remaining <= 0) { scoreToggle.hidden = true; return; }
        scoreToggle.hidden = false;
        scoreToggle.textContent = remaining >= SCORES_STEP ? 'Show next ten' : ('Show last ' + remaining);
      };
      renderScores();
      if (scoreToggle && !scoreToggle._wired) {
        scoreToggle._wired = true;
        scoreToggle.addEventListener('click', () => {
          scoresShown = Math.min(scoresShown + SCORES_STEP, scores.length);
          renderScores();
        });
      }
    }
  }

  const rawExts = Array.isArray(data.extensions) ? data.extensions : [];
  if (!body) return;
  if (!rawExts.length) {
    body.innerHTML = '';
    body.appendChild(el('tr', {}, el('td', { class: 'stats-empty', colspan: '4' }, 'No files analysed yet.')));
    if (toggle) toggle.hidden = true;
    return;
  }
  // Fold every unsupported entry into one "(unsupported)" bucket on the client too,
  // not only in the Worker. A worker old enough to still send individual unsupported
  // rows would otherwise render as several identical "Unsupported types" rows; this
  // guarantees exactly one, whichever Worker version is live.
  const exts = [];
  let unsupportedTotal = 0;
  for (const e of rawExts) {
    if (e.supported) exts.push(e);
    else unsupportedTotal += e.count;
  }
  if (unsupportedTotal > 0) exts.push({ ext: '(unsupported)', supported: false, count: unsupportedTotal });
  exts.sort((a, b) => (b.count - a.count) || (a.ext < b.ext ? -1 : 1));
  // Percentages are each extension's share of all analysed files (the real total,
  // not just the rows shown), so they read as a true share even when the list is
  // truncated to the top entries.
  const total = data.files || rawExts.reduce((s, e) => s + e.count, 0) || 1;

  const row = (e, i) => {
    // Supported extensions link to their own /formats/<ext> guide page (the same
    // full-wins routing the generator used, so the link can't 404); ones not in the
    // catalog stay plain text. The server pools every unsupported extension into one
    // "(unsupported)" bucket and never sends their raw (user-supplied, possibly
    // abusive) names, so it's shown as a single quiet "Unsupported types" category.
    let extCell;
    if (!e.supported) {
      extCell = [el('span', { class: 'stats-ext-name stats-ext-name--group' }, 'Unsupported types')];
    } else if (hasFormatPage(e.ext)) {
      extCell = [el('a', { class: 'stats-ext-name stats-ext-link', href: formatPageHref(e.ext) }, '.' + e.ext)];
    } else {
      extCell = [el('span', { class: 'stats-ext-name' }, '.' + e.ext)];
    }
    const pct = (e.count / total) * 100;
    const pctStr = pct >= 0.1 ? pct.toFixed(1) + '%' : '<0.1%';
    return el('tr', {}, [
      el('td', { class: 'stats-rank' }, String(i + 1)),
      el('td', { class: 'stats-ext' }, extCell),
      el('td', { class: 'stats-count' }, el('span', { class: 'stats-count-num' }, e.count.toLocaleString())),
      el('td', { class: 'stats-share' }, pctStr),
    ]);
  };

  // The toggle reveals ten more rows per click (not all at once): "Show next ten"
  // while at least ten remain, "Show last N" when fewer than ten are left, then it
  // hides once everything is shown.
  let shown = TOP;
  const render = () => {
    body.innerHTML = '';
    exts.slice(0, shown).forEach((e, i) => body.appendChild(row(e, i)));
    if (!toggle) return;
    const remaining = exts.length - shown;
    if (remaining <= 0) { toggle.hidden = true; return; }
    toggle.hidden = false;
    toggle.textContent = remaining >= TOP ? 'Show next ten' : ('Show last ' + remaining);
  };
  render();
  if (toggle && !toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener('click', () => { shown = Math.min(shown + TOP, exts.length); render(); });
  }
}


// Changelog "tl;dr" digest - the whole history condensed into release groups of
// five (the 1.0 and 2.0 milestones kept on their own), each with a few short notes
// on what was new, no specifics unless they really matter. The tl;dr button
// (setupPatchTldr) hides the full entry list and shows this instead. Newest first.
// When you add a patch: extend the newest group's notes, or - once that group holds
// five versions - start a new group above it (and never fold 1.0 or 2.0 into a range).
const PATCH_DIGEST = [
  { range: '3.01 - 3.05', notes: [
    'Export any analysis as a self-contained report, a JSON data file, or a CSV.',
    'SQLite write-ahead logs, git repository internals and Sigma Foveon RAW now open.',
    'A folder scan flags every file that will not open - unrecognised types included - and checks HEIC photos far faster.',
    'The Stats page is one tap from every page, and exported reports now capture the whole analysis.',
  ] },
  { range: '3.0', milestone: true, notes: [
    'Third milestone: camera RAW files get a full darkroom.',
    'See every JPEG baked inside a RAW, decode the real sensor data, read the true resolution, and pull the shutter count out of Sony and Nikon files.',
  ] },
  { range: '2.35 - 2.39', notes: [
    'Anonymous visitor and file-analysis counters, with new Stats and Privacy pages.',
    'PowerPoint slides now open full-size in a lightbox.',
    'A tidier drop zone, plus internal tidy-ups.',
  ] },
  { range: '2.30 - 2.34', notes: [
    'Mostly internal refactoring and housekeeping.',
    'A fix for a loading bar that could stick on screen.',
  ] },
  { range: '2.25 - 2.29', notes: [
    'Photo, PDF and comic viewers gained zoom and pan, and Back now closes them.',
    'Android APK files are read in depth.',
    'Every format guide page gained researched facts and Previous/Next navigation.',
    'The 3D viewer splits multi-body models into separate parts.',
  ] },
  { range: '2.20 - 2.24', notes: [
    'A new Formats page listing every supported type, grouped and searchable.',
    'Every format gained its own plain-language guide page, findable by web search.',
    'Lighter loads for pages that do not open a file.',
  ] },
  { range: '2.15 - 2.19', notes: [
    'A Share button and popup for passing Analyser on.',
    'Smarter folder and ZIP treemaps, with filter chips and collapsing of huge folders.',
    'The video sound track regained its full waveform tools.',
  ] },
  { range: '2.09 - 2.14', notes: [
    'Raw H.264 and H.265 camera and dash-cam clips open reliably, split into parts when large.',
    'Clean web addresses and a sitemap so links and search engines resolve.',
    'Live online/offline status and a spam-safe suggest-a-format prompt.',
  ] },
  { range: '2.0', milestone: true, notes: [
    'Second milestone: over 120 new file types identified across many domains.',
    'Richer video-editing project and 10-bit video readouts, with clearer banners for files the browser cannot show.',
  ] },
  { range: '1.25 - 1.29', notes: [
    'The supported-formats popup was rebuilt - grouped, searchable, with badges.',
    'Images pulled from other files open with the full photo readout.',
    'Professional video the browser cannot play is named and previewed.',
  ] },
  { range: '1.20 - 1.24', notes: [
    'Hundreds more formats recognised, with new comic book, SQLite and JPEG 2000 viewers.',
    'Many more camera RAW formats open with full analysis.',
    'A site-wide visual tidy-up.',
  ] },
  { range: '1.15 - 1.19', notes: [
    'New viewers for subtitles, MIDI, Markdown and map data.',
    'Pictures inside Office, EPUB and PDF files can be analysed in place.',
    'Shortcut files and raw disk images are decoded.',
  ] },
  { range: '1.10 - 1.14', notes: [
    'Music files surface their tags, lyrics and timed .lrc lyrics.',
    'Plain-language help notes appear beside most readouts.',
    'A Cancel button for slow loads, and a richer spectrogram.',
  ] },
  { range: '1.05 - 1.09', notes: [
    'Drop a folder or ZIP for an interactive treemap sized by disk use.',
    'The app updates itself automatically.',
    'Heavy tools stream on first use, then cache for offline use.',
  ] },
  { range: '1.01 - 1.04', notes: [
    'OCR reads 32 languages and the app runs fully offline.',
    'A loading bar for large files, with deep-linkable format descriptions.',
  ] },
  { range: '1.0', milestone: true, notes: [
    'The big release - Analyser becomes a document and 3D workstation.',
    'Excel, EPUB, PowerPoint and STL viewers, folder and ZIP trees, and PDF image extraction.',
  ] },
  { range: '0.24 - 0.28', notes: [
    'A new Word (DOCX) viewer and AI-image detection.',
    'Real metadata from many proprietary files.',
    'Dark mode follows your system setting.',
  ] },
  { range: '0.19 - 0.23', notes: [
    'Automatic video scene detection.',
    'A central format catalog drives the supported-types list and search.',
    'Inline help for audio and photo statistics.',
  ] },
  { range: '0.14 - 0.18', notes: [
    'First public build, with an About page and over 100 formats identified.',
    'Metadata search, plus CSV, SVG and unknown-file viewers.',
    'Drop a folder for an overview, and analyse AVI directly.',
  ] },
  { range: '0.09 - 0.13', notes: [
    'Custom audio and video players synced to the spectrogram.',
    'Run full photo analysis on any video frame, and decode RAW photos in-browser.',
    'A nav search box that jumps to matching results.',
  ] },
  { range: '0.04 - 0.08', notes: [
    'Video support and a dark mode.',
    'New PDF, ZIP, SVG and CSV viewers, and camera RAW support.',
    'Waveform region export and video frame-stepping.',
  ] },
  { range: '0.01 - 0.03', notes: [
    'Analyser launches - on-device file analysis with nothing uploaded.',
    'Magic-byte identification, hex dump, SHA-256, photo EXIF with a GPS map and OCR, and a live audio spectrogram.',
  ] },
];

// Wire the changelog "tl;dr" button: build the condensed digest once (release
// groups, each with a few short notes), then toggle a class that hides the full
// entry list and the "Older updates" fold and shows the digest in their place.
// Re-runs per navigation; guarded on the button element so it binds only once.
function setupPatchTldr() {
  const section = document.getElementById('when');
  const btn = document.getElementById('tldrToggle');
  if (!section || !btn || btn._tldrBound) return;
  btn._tldrBound = true;

  if (!section.querySelector('.patch-digest')) {
    const digest = el('div', { class: 'patch-digest' });
    PATCH_DIGEST.forEach((g) => {
      const group = el('div', { class: 'patch-digest-group' + (g.milestone ? ' is-milestone' : '') });
      group.appendChild(el('p', { class: 'patch-digest-range' }, g.range));
      const ul = el('ul', { class: 'patch-digest-list' });
      g.notes.forEach((n) => ul.appendChild(el('li', {}, n)));
      group.appendChild(ul);
      digest.appendChild(group);
    });
    // Insert just before the first patch entry, within the entry's own parent
    // (the entries are nested inside .section-content, not direct children of #when).
    const firstEntry = section.querySelector('.patch-entry');
    if (firstEntry) firstEntry.parentNode.insertBefore(digest, firstEntry);
    else section.appendChild(digest);
  }

  btn.addEventListener('click', () => {
    const on = section.classList.toggle('tldr-mode');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-active', on);
  });
}


// exifr (74 KB) is only needed when a photo or video is actually analysed, which
// only ever happens on the home page. Rather than ship a static <script> tag on
// every page (about/patch/formats and the 100+ per-format landing pages never
// touch it), inject it on demand the first time the analysis pipeline needs it.
// Idempotent and cached; resolves instantly once loaded. The script is precached
// by the service worker, so the first lazy load is offline-safe and near-instant.
let _exifrPromise = null;
function ensureExifr() {
  if (window.exifr) return Promise.resolve(window.exifr);
  if (_exifrPromise) return _exifrPromise;
  _exifrPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '/assets/vendor/exifr.umd.js';
    s.onload = () => resolve(window.exifr);
    s.onerror = () => {
      _exifrPromise = null;
      console.warn('exifr failed to load; photo/video metadata will be missing.');
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return _exifrPromise;
}

function boot() {

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

    // Hide the "About .EXT files" footer link until the next analysis fills it.
    const guideCta = $('formatGuideCta');
    if (guideCta) guideCta.hidden = true;
  }

  // --- Drill-down breadcrumb (folder / zip / archive -> nested file) ---------
  // Opening a file from a container view replaces the results, so we keep a stack
  // of restore closures - one per level - and show a Back bar that re-renders the
  // parent container one level at a time. Container renderers (folder.js,
  // archive.js) call window._anrPushNav right before they open a child; a fresh
  // top-level load calls resetNav so the breadcrumb never leaks across drops.
  const navStack = [];
  function refreshBackBar() {
    const bar = $('anrBackBar');
    if (!bar) return;
    const top = navStack[navStack.length - 1];
    if (top) {
      const lbl = bar.querySelector('.anr-back-label');
      if (lbl) lbl.textContent = top.label;
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }
  function resetNav() { navStack.length = 0; refreshBackBar(); }
  function popNav() {
    const frame = navStack.pop();
    refreshBackBar();
    if (!frame) return;
    clearResultsUI();
    try { frame.restore(); } catch (_) {}
    const sec = unknownResults.closest('.section') || unknownResults;
    requestAnimationFrame(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  // Exposed for the container renderers, which run in their own modules.
  window._anrPushNav = (label, restore) => { navStack.push({ label, restore }); refreshBackBar(); };
  window._anrResetNav = resetNav;
  const backBarEl = $('anrBackBar');
  if (backBarEl && !backBarEl._wired) { backBarEl._wired = true; backBarEl.addEventListener('click', popNav); }

  // Once a file is loaded the three pick-a-file dropzones are redundant, so swap
  // them for a single "Analyse next file?" button that reloads to a fresh page.
  function showAnalyseNext() {
    const grid = document.querySelector('.quickdrop');
    const btn = $('analyseNext');
    const jump = $('scrollToData');
    const exp = $('exportData');
    if (grid) grid.hidden = true;
    if (btn) btn.hidden = false;
    if (jump) jump.hidden = false;
    if (exp) exp.hidden = false;
  }
  function restoreQuickdrop() {
    const grid = document.querySelector('.quickdrop');
    const btn = $('analyseNext');
    const jump = $('scrollToData');
    const exp = $('exportData');
    if (grid) grid.hidden = false;
    if (btn) btn.hidden = true;
    if (jump) jump.hidden = true;
    if (exp) exp.hidden = true;
    document.body.classList.remove('anr-has-file');   // un-invert the nav back to normal
  }

  // Folder/zip overviews are rendered directly (not via handleFile), so they must
  // run the same "a file is loaded" UI transition handleFile does: hide the three
  // dropzones (swap in "Analyse next file?"), invert the nav, and drop the
  // full-page drop overlay. Without this the dropzones stay on screen behind the
  // overview.
  function enterLoadedUI() {
    firstFileLoaded = true;
    document.body.classList.add('anr-has-file');
    if (pageDropEl) pageDropEl.hidden = true;
    showAnalyseNext();
    // A folder/ZIP overview is not itself photo/audio/video, so collapse the three
    // numbered media explainer sections (01/02/03) and grey out their nav links -
    // exactly what handleFile does for any non-media file. They reappear when a
    // file picked FROM the overview is analysed and turns out to be media.
    ['photo', 'audio', 'video'].forEach((id) => { const sec = $(id); if (sec) sec.hidden = true; });
    ['#photo', '#audio', '#video'].forEach((href) => {
      const link = document.querySelector('.site-nav a[href="' + href + '"]');
      if (link) link.classList.add('is-disabled');
    });
    document.body.classList.remove('anr-nav-live');
  }

  // Jump to the first analysed section. Results elements are hidden+emptied until
  // a renderer populates them, so the first visible .anr-results with children is
  // the first section with data (document order: unknown, photo, audio, video).
  function scrollToFirstData() {
    for (const res of document.querySelectorAll('.anr-results')) {
      if (!res.hidden && res.childElementCount > 0) {
        (res.closest('.section') || res).scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }

  // Stop the in-flight load: drop its results and restore the empty page state
  // (the three analysis sections are explainer sections - visible by default).
  function cancelLoad(token) {
    if (!token || token.cancelled) return;
    token.cancelled = true;
    if (_currentToken === token) _currentToken = null;
    clearResultsUI();
    resetNav();
    restoreQuickdrop();
    ['photo', 'audio', 'video'].forEach((id) => { const sec = $(id); if (sec) sec.hidden = false; });
  }

  async function handleFile(file, opts) {
    if (!file) return;
    // opts carries either a forced type ({kind, ext}, from the sniff popup) or a
    // paired RAW develop-settings sidecar ({sidecarXmp}, from a RAW+XMP drop).
    const force = (opts && opts.kind) ? opts : null;
    const sidecarXmp = (opts && opts.sidecarXmp) || null;
    // Opened from a folder/zip/document view: bytes are already in memory and the
    // render beats the loader's 160ms debounce, so show the bar immediately.
    const nested = !!(opts && opts.nested);
    if (!nested) resetNav();   // a fresh top-level drop ends any drill-down breadcrumb
    hideTypeSuggestion();
    hideSuggestPopup();   // clear any "suggest this format" nudge from a prior file
    hideShareNudge();     // and any pending/visible "share this" nudge
    // If the "Supported formats" overlay is open, drop/paste/pick dismisses it.
    const fmtOv = $('fmtOverlay');
    if (fmtOv && !fmtOv.hidden) {
      if (fmtOv._backClose) fmtOv._backClose();
      else { fmtOv.hidden = true; document.body.style.overflow = ''; }
    }
    const token = { cancelled: false };
    _currentToken = token;
    showDropLoader(file, () => cancelLoad(token), undefined, nested);

    clearResultsUI();

    firstFileLoaded = true;
    document.body.classList.add('anr-has-file');   // flips the primary nav to its inverted colours
    if (pageDropEl) pageDropEl.hidden = true;
    showAnalyseNext();

    // Probe that the bytes are actually readable before any renderer tries. A
    // cloud-only file (OneDrive/iCloud/etc.) whose sync app can't hydrate it has
    // a valid name+size but throws on read - show a clear warning instead of a
    // generic "could not read" from deep inside a renderer. Any throw from the
    // probe means the bytes aren't available (sync app off, online-only, or
    // permission lost), whatever the exact DOMException name/message - a renderer
    // would only fail the same way, so treat every probe error as unavailable.
    const readErr = await probeReadable(file);
    if (token.cancelled) return;   // cancelled while probing - don't render
    if (readErr) {
      hideDropLoader();
      unknownResults.hidden = false;
      unknownResults.innerHTML = '';
      const card = el('div', { class: 'anr-card' });
      card.appendChild(el('h3', {}, 'File unavailable'));
      card.appendChild(cloudFileWarning(file));
      unknownResults.appendChild(card);
      showSuggestPopup(fileExt(file.name));   // couldn't load - nudge to suggest the format
      return;
    }

    let kind = force ? force.kind : classifyFile(file);
    // An extension sniffed from the file's bytes (not its name) when it has none -
    // e.g. a git blob holding an HTML page. Threaded into extOverride below so the
    // proprietary renderer knows the real type.
    let sniffedExt = null;

    // For files classified as 'unknown', check magic bytes for PDF / ZIP / SVG / HTML / CSV
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
          } else if (/^\s*(<!doctype html|<html[\s>])/i.test(headStr)) {
            // Extensionless HTML (e.g. a git blob holding a web page): open it in the
            // HTML view rather than dropping to a raw hex dump.
            kind = 'proprietary';
            sniffedExt = 'html';
          }
        }
        // Git objects: loose objects (zlib "<type> <size>\0…"), packfiles (PACK)
        // and pack indexes (\377tOc). Loose objects are extensionless, so this
        // content sniff is the only way to route them.
        if (kind === 'unknown') {
          const git = await sniffGitObject(file);
          if (git) kind = 'git-object';
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
    // When the file is physically a zip/rar/7z container, browse-as-archive is
    // appended under its primary analysis (set here, rendered after it settles).
    let archiveEmbed = null;
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
        // Browse-as-archive: any non-media file that really is a zip/rar/7z (and
        // isn't already the dedicated ZIP tree view) gets the archive browser
        // appended below its normal results.
        const mediaKind = kind === 'photo' || kind === 'audio' || kind === 'video';
        if (sniff && !mediaKind && kind !== 'zip') {
          if (sniff.ext === 'zip') archiveEmbed = { mode: 'zip', label: 'ZIP' };
          else if (sniff.ext === 'rar') archiveEmbed = { mode: 'libarchive', label: 'RAR' };
          else if (sniff.ext === '7z') archiveEmbed = { mode: 'libarchive', label: '7-Zip' };
        }
        // Don't also pop the "analyse as ZIP/RAR/7z" suggestion - it's embedded now.
        if (archiveEmbed && suggestion && (suggestion.ext === 'zip' || suggestion.ext === 'rar' || suggestion.ext === '7z')) {
          suggestion = null;
        }
      } catch (_) {}
    }

    // Count this analysis (anonymous, extension-only). `kind` is final here and
    // the read probe already passed, so cloud-unavailable files - which return
    // early above - are correctly never counted. 'unknown' = a type Analyser
    // doesn't recognise, recorded as unsupported.
    recordAnalysed(fileExt(file.name), kind !== 'unknown');

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

    // Only flip the nav to its inverted palette when at least one section link is
    // still live. If every link is greyed out (a non-media file with no section on
    // the page) the inverted bar would just be a wall of dimmed text, so leave it
    // in its normal colours - the invert is gated on body.anr-nav-live in CSS.
    const anyNavLive = ['#photo', '#audio', '#video'].some((href) => {
      const link = document.querySelector('.site-nav a[href="' + href + '"]');
      return link && !link.classList.contains('is-disabled');
    });
    document.body.classList.toggle('anr-nav-live', anyNavLive);

    const route = ROUTES[kind] || ROUTES.unknown;
    const resultsByName = {
      photo: photoResults, audio: audioResults, video: videoResults, unknown: unknownResults,
    };
    (route.nav || []).forEach(markNav);
    (route.analysed || []).forEach(markAnalysed);
    const extOverride = (force && force.ext) || sniffedExt;
    // Photo and video metadata both come from exifr; pull it in (once) before the
    // renderer runs so the global is ready by the time photo.js/video.js read it.
    if (kind === 'photo' || kind === 'video') await ensureExifr();
    let renderPromise;
    if ((kind === 'proprietary' || kind === 'comic') && extOverride) {
      renderPromise = route.render(file, resultsByName[route.results], extOverride);
    } else if (kind === 'photo' && sidecarXmp) {
      renderPromise = route.render(file, resultsByName[route.results], { sidecarXmp });
    } else {
      renderPromise = route.render(file, resultsByName[route.results]);
    }

    // Autoscroll straight to the media section so the player/analysis is in view
    // the moment a video or audio file is dropped. The catch: content that lands
    // ABOVE it - the Photo/Sound "Analyse" cards - and the section's own player
    // are appended asynchronously, so a single early scroll lands too high (it
    // "misses" by whatever appears above afterwards). So we scroll now for
    // responsiveness and re-assert once the renderer settles (below) - unless the
    // user has grabbed the scroll themselves in the meantime.
    // Audio/video always autoscroll (their sections sit low on the page). When a
    // file is opened FROM a folder/zip view (nested), the user is scrolled down at
    // the treemap, so scroll to wherever the result lands - its section, or the
    // generic results block - regardless of kind, so the analysis comes into view.
    const resultEl = resultsByName[route.results];
    const autoScrollSec = kind === 'video' ? sectionVideo
      : kind === 'audio' ? sectionAudio
      : nested && resultEl ? (resultEl.closest('.section') || resultEl)
      : null;
    let userTookScroll = false;
    let stopScrollWatch = () => {};
    if (autoScrollSec) {
      const onUserScroll = () => { userTookScroll = true; };
      // A programmatic smooth scroll fires 'scroll' but NOT these, so they cleanly
      // detect the user taking over (wheel / touch-drag / arrow & page keys).
      window.addEventListener('wheel', onUserScroll, { passive: true });
      window.addEventListener('touchmove', onUserScroll, { passive: true });
      window.addEventListener('keydown', onUserScroll);
      stopScrollWatch = () => {
        window.removeEventListener('wheel', onUserScroll);
        window.removeEventListener('touchmove', onUserScroll);
        window.removeEventListener('keydown', onUserScroll);
      };
      requestAnimationFrame(() => {
        if (!userTookScroll) autoScrollSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Windows executables/DLLs carry their app icon in the PE resource section.
    // Pull it out and analyse it as a photo (the Photo section is kept visible
    // above for exe/dll). Best-effort and fully async - never blocks the render.
    if (kind === 'proprietary' && /\.(exe|dll)$/i.test(file.name) && photoResults) {
      extractPeIcon(file).then(async (iconFile) => {
        if (!iconFile || token.cancelled || _currentToken !== token) return;
        await ensureExifr();
        if (token.cancelled || _currentToken !== token) return;
        photoResults.hidden = false;
        markAnalysed('photo');
        renderPhoto(iconFile, photoResults,
          { sourceNote: 'Application icon extracted from ' + (file.name || 'the executable') + '.' });
      }).catch(() => {});
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
        stopScrollWatch();
        if (_currentToken === null) clearResultsUI();
        return;
      }
      if (_currentToken !== token) { stopScrollWatch(); return; }   // superseded
      hideDropLoader();
      // Everything above the media section (the Photo/Sound "Analyse" cards) and
      // its player are in place now, so re-assert the scroll - the early one
      // landed too high before they pushed it down. Two rAFs let the final layout
      // settle first; keep watching for a user takeover until that last scroll.
      if (autoScrollSec && !userTookScroll) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!userTookScroll) autoScrollSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          stopScrollWatch();
        }));
      } else {
        stopScrollWatch();
      }
      if (suggestion) {
        showTypeSuggestion(suggestion, () => handleFile(file, { kind: suggestion.kind, ext: suggestion.ext }));
      }
      // Append the browse-as-archive view under the primary analysis for files
      // that are physically a zip/rar/7z container (APK, DOCX, JAR, RAR, …).
      if (archiveEmbed && resultEl) {
        renderArchiveEmbedded(file, resultEl, archiveEmbed).catch(() => {});
      }
      // Record what was just analysed and, unless a format-suggestion popup is
      // taking the spotlight, line up the post-analysis "share this" nudge. Skip
      // the nudge when the file couldn't actually be read (a OneDrive/iCloud
      // cloud-only placeholder that failed inside the renderer, showing the
      // cloud-file warning) - there's nothing worth sharing.
      const analysed = { ext: fileExt(file.name), category: kind, name: file.name };
      window._anrLastAnalysis = analysed;
      // Keep a handle on the analysed File so the data export can compute a hash
      // (e.g. the video SHA-256) on demand without re-reading from disk.
      window._anrLastFile = file;
      // Reveal the "About .EXT files" link above the footer, deep-linking to the
      // analysed extension's own /formats guide page. A forced re-analyse (sniff
      // popup) passes the true extension; otherwise use the file's own. Stays
      // hidden when the extension has no catalog page (or there's no extension).
      const guideCta = $('formatGuideCta');
      if (guideCta) {
        const guideExt = ((extOverride || analysed.ext) || '').toLowerCase();
        if (guideExt && hasFormatPage(guideExt)) {
          guideCta.href = formatPageHref(guideExt);
          guideCta.textContent = 'About .' + guideExt.toUpperCase() + ' files';
          guideCta.hidden = false;
        } else {
          guideCta.hidden = true;
        }
      }
      const unreadable = document.querySelector('.anr-results:not([hidden]) .anr-cloud-warning');
      if (!suggestion && !unreadable) scheduleShareNudge(analysed);
    });
  }
  _handleFile = handleFile;
  window._anrHandleFile = handleFile;

  // "Analyse next file?" (shown once a file is loaded) reloads to a clean page.
  const analyseNextBtn = $('analyseNext');
  if (analyseNextBtn && !analyseNextBtn._wired) {
    analyseNextBtn._wired = true;
    analyseNextBtn.addEventListener('click', () => location.reload());
  }
  const scrollToDataBtn = $('scrollToData');
  if (scrollToDataBtn && !scrollToDataBtn._wired) {
    scrollToDataBtn._wired = true;
    scrollToDataBtn.addEventListener('click', scrollToFirstData);
  }
  wireExportButton();

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
          const home = new URL('/', location.href).href;
          if (location.href !== home) {
            const link = document.createElement('a');
            link.href = '/';
            document.body.appendChild(link);
            link.click();
            link.remove();
          }
          return;
        }
        const ur = $('unknownResults');
        if (ur) { resetNav(); renderFolder(folderFiles, ur); enterLoadedUI(); }
        hideDropLoader();
        return;
      }
      if (droppedFolderName) hideDropLoader();

      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;

      if (!$('photoResults')) {
        window._anrPendingFile = files[0];
        // Navigate to the site root with an ABSOLUTE path. A relative 'index.html'
        // resolves against the current directory, which breaks on the nested
        // /formats/<ext> landing pages (it would aim at /formats/index.html). The
        // folder branch above already uses '/'; keep them consistent.
        const home = new URL('/', location.href).href;
        if (location.href !== home) {
          const link = document.createElement('a');
          link.href = '/';
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
        // anr-asteroids-hi is a permanent high score with no :ts companion - skip it,
        // or the sweep's "no timestamp" branch would delete it on every page load.
        if (!k || !k.startsWith('anr-') || k.endsWith(':ts') || k === 'anr-asteroids-hi') continue;
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
    // Label shows the CURRENT mode: NIGHT while dark, DAY while light. The sun/moon
    // glyphs are built from code points (sun U+2600, moon U+263E, each + the U+FE0E
    // text-presentation variation selector) so the source stays pure ASCII - a raw
    // glyph here was previously mojibaked by an encoding round-trip and rendered as
    // garbage.
    const SUN = String.fromCodePoint(0x2600, 0xFE0E);
    const MOON = String.fromCodePoint(0x263E, 0xFE0E);
    const themeLabel = () => document.documentElement.getAttribute('data-theme') === 'dark'
      ? MOON + ' NIGHT' : SUN + ' DAY';
    darkBtn.textContent = themeLabel();
    darkBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      anrSet('anr-theme', next);
      darkBtn.textContent = themeLabel();
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

    // Header letter FX is initialised per-navigation by setupHeaderFx() (imported from effects.js).

    setInterval(anrSweep, ANR_REFRESH);

    // Live connectivity → header "Status" line (Online / Offline). The OS events
    // are unreliable (navigator.onLine ignores real internet reach), so we also
    // re-probe when the tab regains focus and on a modest interval while visible -
    // that catches the internet dropping while the page just sits open.
    window.addEventListener('online', updateNetStatus);
    window.addEventListener('offline', updateNetStatus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') updateNetStatus();
    });
    window.addEventListener('focus', updateNetStatus);
    setInterval(() => {
      if (document.visibilityState === 'visible') updateNetStatus();
    }, 20000);

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

    // Konami code (↑↑↓↓←→←→ B A) anywhere on the site launches the Asteroids
    // easter egg - a vector Asteroids clone played in a circular scope where the
    // asteroids are supported file types. Lazy-imported so it costs nothing until
    // the sequence is entered.
    const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
    let konamiPos = 0;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = (e.key || '').toLowerCase();
      konamiPos = (k === KONAMI[konamiPos]) ? konamiPos + 1 : (k === KONAMI[0] ? 1 : 0);
      if (konamiPos === KONAMI.length) {
        konamiPos = 0;
        import('../games/asteroids.js').then((m) => m.launchAsteroids()).catch(() => {});
      }
    });

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
    resetNav();
    renderFolder(window._anrPendingFolder, unknownResults);
    enterLoadedUI();
    delete window._anrPendingFolder;
  }

  // Re-bind the header letter effect to the (possibly swapped) title.
  setupHeaderFx();
  // Hover effect on each section's number / kicker / heading (no sweep).
  setupSectionFx();
  // Same per-letter hover effect on the footer "Everything runs in your browser." mark.
  setupFooterFx();
  // Footer "Email me!" Turnstile gate (footer is swapped on every navigation).
  wireFooterContact();
  // Nav "Share" button (header is swapped on every navigation).
  wireShareButtons();
  // Mobile access to the Asteroids easter egg: the Konami code needs a keyboard, so
  // on touch you reach the game by quickly tapping the header description 5 times.
  // Bound to whichever .site-sub is on the current page (the header is swapped on
  // navigation), guarded so it only binds once per element.
  (function wireTapEgg() {
    const sub = document.querySelector('.site-sub');
    if (!sub || sub.dataset.eggBound) return;
    sub.dataset.eggBound = '1';
    let taps = 0, tapTimer = 0;
    sub.addEventListener('click', () => {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { taps = 0; }, 600);
      if (taps >= 5) {
        taps = 0;
        import('../games/asteroids.js').then((m) => m.launchAsteroids()).catch(() => {});
      }
    });
  })();
  // Header "Status" line reflects live connectivity (header is swapped too).
  updateNetStatus();

  // Anonymous visitor count, shown above Status in the header of every main page.
  // The markup ships a "..." placeholder so the badge is visible before JS runs;
  // recordVisit() pings the stats Worker once per page load (cached across SPA
  // navigations, one visit per IP / 3 days) and swaps in the live total once it
  // arrives. Offline or on the mock-less dev server it simply stays "...".
  if ($('visitCount')) {
    recordVisit().then((t) => {
      if (!t || typeof t.visitors !== 'number') return;
      const n = $('visitCount');
      if (n) n.textContent = t.visitors.toLocaleString();
    });
  }

  // /stats page: fetch + render the public counters (no-op on every other page).
  setupStatsPage();

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
      if (href.indexOf('/about') === 0 || href.indexOf('about.html') === 0) dest = 'the About page';
      else if (href.indexOf('/patch') === 0 || href.indexOf('patch.html') === 0) dest = 'the Changelog';
      else if (href === '/' || href.indexOf('index') === 0) dest = 'the analyser';
      showLinkConfirm(a, {
        message: 'This link leads to ' + dest + ', proceed?',
        onProceed: function () { window.location.href = href; }
      });
    });
  });

  // Changelog "tl;dr" button (patch.html only; no-ops elsewhere).
  setupPatchTldr();

  // ----- Scroll-spy for the sticky nav (re-binds per page) -----
  const links = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
  const sections = links
    .map((a) => ({ a, el: document.querySelector(a.getAttribute('href')) }))
    .filter((s) => s.el);
  // The bar is position:sticky/top:0, so its bounding top reaches 0 exactly when
  // it pins to the viewport top. That drives the inverted palette (together with
  // the anr-has-file / anr-nav-live body gates handled in handleFile + CSS). A
  // direct geometry read on every scroll is 100% reliable; the previous
  // zero-height IntersectionObserver sentinel had a zero-area target, whose
  // intersection readings were flaky - so the bar (and its dividers) sometimes
  // failed to flip or un-flip. Folded into the scroll-spy handler so it's one
  // passive listener.
  const stickyNav = document.querySelector('.site-nav');
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
    if (stickyNav) {
      document.body.classList.toggle('anr-nav-stuck', stickyNav.getBoundingClientRect().top <= 0);
    }
  };
  window.addEventListener('scroll', _scrollHandler, { passive: true });
  _scrollHandler();
  // Re-evaluate the stuck state on resize too (the header above the bar can change
  // height, moving where it pins). Bound once; calls whatever the latest handler is.
  if (!boot._stuckResizeWired) {
    boot._stuckResizeWired = true;
    window.addEventListener('resize', () => { if (_scrollHandler) _scrollHandler(); }, { passive: true });
  }

  // ----- Collapsible analysis cards -----
  // One delegated listener (added once) toggles a card open/closed when its title
  // (a direct-child <h3>) is clicked. Cards render open; .is-collapsed hides the
  // body via CSS. Clicks on interactive controls in a title don't toggle.
  if (!boot._cardToggleWired) {
    boot._cardToggleWired = true;
    document.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input, select, textarea, label')) return;
      const h3 = e.target.closest('h3');
      if (!h3) return;
      const card = h3.parentElement;
      if (card && card.classList.contains('anr-card')) card.classList.toggle('is-collapsed');
    });
  }

  // ----- In-page anchors -----
  // Native anchor jumps handle navigation (offset via CSS scroll-margin-top); no
  // programmatic/animated autoscroll.

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

  // Canonical per-tier download sizes - the SINGLE source of truth. Tiers are
  // cumulative (each includes every lower tier's files), so TIER_MB are totals in MB.
  // TIER_SIZES (the labels stamped onto the buttons + help-panel legend on every page,
  // and used by the post-clear reset) derive from it, and the "+N MB more" upgrade
  // deltas in refreshTierButtons() use the numbers directly. One place to edit.
  const TIER_ORDER = ['essentials', 'everything', 'complete'];
  const TIER_MB = { essentials: 50, everything: 74, complete: 312 };
  const TIER_SIZES = {};
  TIER_ORDER.forEach((t) => { TIER_SIZES[t] = '~' + TIER_MB[t] + ' MB'; });

  const TIERS = {
    essentials: [
      './', './about', './patch', './manifest.json', './assets/css/analyser.css', './assets/css/fonts.css',
      './assets/js/core/app.js', './assets/js/core/formats.js', './assets/js/core/util.js', './assets/js/core/search.js',
      './assets/js/renderers/photo.js', './assets/js/renderers/audio.js', './assets/js/renderers/audio-analysis.js',
      './assets/js/renderers/audio-codec.js', './assets/js/renderers/video.js', './assets/js/renderers/spectrogram.js',
      './assets/js/renderers/pdf.js', './assets/js/renderers/archive.js', './assets/js/renderers/svg.js',
      './assets/js/renderers/csv.js', './assets/js/renderers/unknown.js', './assets/js/renderers/proprietary.js',
      './assets/js/renderers/folder.js', './assets/js/renderers/folder-archive-shared.js',
      './assets/js/renderers/treemap.js', './assets/js/core/navigate.js',
      './assets/js/renderers/photo-convert.js', './assets/js/renderers/gif-frames.js', './assets/js/renderers/audio-player.js', './assets/js/renderers/video-avi.js',
      './assets/js/games/asteroids.js',
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
      './assets/vendor/libraw/index.js',
      './assets/vendor/libraw/worker.js',
      './assets/vendor/libraw/libraw.js',
      './assets/vendor/libraw/libraw.wasm',
      './assets/vendor/ffmpeg/ffmpeg.js',
      './assets/vendor/ffmpeg/index.js',
      './assets/vendor/ffmpeg/classes.js',
      './assets/vendor/ffmpeg/const.js',
      './assets/vendor/ffmpeg/errors.js',
      './assets/vendor/ffmpeg/types.js',
      './assets/vendor/ffmpeg/utils.js',
      './assets/vendor/ffmpeg/worker.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
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
      './assets/vendor/leaflet/images/marker-icon.png',
      './assets/vendor/leaflet/images/marker-icon-2x.png',
      './assets/vendor/leaflet/images/marker-shadow.png',
      './assets/vendor/leaflet/images/layers.png',
      './assets/vendor/leaflet/images/layers-2x.png',
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

  // Shared note under the download buttons (created on first use), used to report
  // any files that failed to download. Pass '' to clear it.
  function setOfflineStatus(msg) {
    const options = document.querySelector('.offline-options');
    if (!options) return;
    let status = document.getElementById('offlineStatus');
    if (!msg) { if (status) { status.hidden = true; status.textContent = ''; } return; }
    if (!status) {
      status = document.createElement('p');
      status.id = 'offlineStatus';
      status.className = 'offline-status';
      status.setAttribute('role', 'status');
      options.insertAdjacentElement('afterend', status);
    }
    status.textContent = msg;
    status.hidden = false;
  }

  // Persisted record of which tiers are fully cached and at what app version, so
  // the "Cached" tag can be restored on load and a tier refreshed when the app
  // updates. localStorage 'anr-offline' = { <tier>: <COMMIT_COUNT cached at>, ... }.
  function readOfflineState() {
    try { return JSON.parse(localStorage.getItem('anr-offline') || '{}') || {}; }
    catch (_) { return {}; }
  }
  function writeOfflineState(state) {
    try { localStorage.setItem('anr-offline', JSON.stringify(state)); } catch (_) {}
  }

  // Probe the offline cache for the highest tier actually present, by checking a
  // sentinel file each tier adds last (downloads run in order, so the last file
  // being cached means the tier finished). Lets the "Cached" tag self-heal when
  // a tier was cached before this record existed, or localStorage was wiped.
  async function detectCachedTier() {
    try {
      const cache = await caches.open('analyser-offline');
      const has = async (url) => !!(url && await cache.match(new Request(url)));
      if (await has(TIERS.complete[TIERS.complete.length - 1])) return 'complete';
      if (await has(TIERS.everything[TIERS.everything.length - 1])) return 'everything';
      if (await has(TIERS.essentials[TIERS.essentials.length - 1])) return 'essentials';
    } catch (_) {}
    return null;
  }

  // The "✓ Cached" badge pinned to the bottom of a button (created lazily so the
  // HTML stays untouched across all three pages that share this markup).
  function cachedBadge(btn) {
    let badge = btn.querySelector('.offline-cached');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'offline-cached';
      badge.hidden = true;
      btn.appendChild(badge);
    }
    return badge;
  }
  function markCached(btn, version) {
    const badge = cachedBadge(btn);
    // Parts are separate spans so the responsive trimming is pure CSS: on mobile
    // the checkmark and the · separator are hidden (a - is shown instead), so the
    // badge reads just "Cached - v2.0". Desktop keeps "✓ Cached · v2.0".
    const ver = 'v' + analyserVersion(version, RELEASE_COMMITS);
    badge.textContent = '';
    badge.appendChild(el('span', { class: 'offline-cached-check' }, '✓'));
    badge.appendChild(el('span', {}, 'Cached'));
    badge.appendChild(el('span', { class: 'offline-cached-dot' }, '·'));
    badge.appendChild(el('span', { class: 'offline-cached-dash' }, '-'));
    badge.appendChild(el('span', {}, ver));
    badge.hidden = false;
    btn.classList.add('is-done', 'is-fading');
  }

  function tierUrls(tier) {
    const urls = [...TIERS.essentials];
    if (tier === 'everything' || tier === 'complete') urls.push(...TIERS.everything);
    if (tier === 'complete') urls.push(...TIERS.complete);
    return urls;
  }

  // Reflect the current offline state across all three tier buttons at once:
  //  - the highest cached tier keeps its "Cached" badge,
  //  - every LOWER tier it already covers is greyed out and marked "Included"
  //    (downloading a tier caches all lower tiers' files too, so you already have them),
  //  - every HIGHER tier shows how much MORE storage upgrading to it costs ("+~N MB"),
  //    relative to what's cached, instead of its full size.
  // Buttons mid-download (is-active) are left to their own live progress UI.
  function refreshTierButtons() {
    const state = readOfflineState();
    let cachedIdx = -1;
    TIER_ORDER.forEach((t, i) => { if (state[t] != null) cachedIdx = Math.max(cachedIdx, i); });
    const cachedMb = cachedIdx >= 0 ? TIER_MB[TIER_ORDER[cachedIdx]] : 0;

    document.querySelectorAll('.offline-btn').forEach((btn) => {
      if (btn.classList.contains('is-active')) return;
      const tier = btn.dataset.tier;
      const idx = TIER_ORDER.indexOf(tier);
      const sizeEl = btn.querySelector('.offline-size');
      if (idx < 0) return;

      if (idx === cachedIdx) {
        // The highest cached tier: full "Cached" badge, shown normally (not greyed).
        btn.classList.remove('is-included');
        if (sizeEl) sizeEl.textContent = 'Cached';
        markCached(btn, state[tier] != null ? state[tier] : COMMIT_COUNT);
      } else if (idx < cachedIdx) {
        // Already covered by a higher cached tier: grey it out, not clickable.
        cachedBadge(btn).hidden = true;
        btn.classList.add('is-done', 'is-included');
        btn.classList.remove('is-fading');
        if (sizeEl) sizeEl.textContent = 'Included';
      } else {
        // Not cached yet: clickable, and show the incremental upgrade cost only.
        cachedBadge(btn).hidden = true;
        btn.classList.remove('is-done', 'is-fading', 'is-included');
        if (sizeEl) sizeEl.textContent = cachedIdx >= 0 ? '+~' + (TIER_MB[tier] - cachedMb) + ' MB' : TIER_SIZES[tier];
      }
    });
  }

  // Download (or, with force, re-download) every file in a tier into the
  // 'analyser-offline' cache, driving the button's progress bar. Records the
  // current app version on full success; clears the record on partial failure.
  async function downloadTier(btn, { force = false } = {}) {
    if (btn.classList.contains('is-active')) return false;
    const tier = btn.dataset.tier;
    const urls = tierUrls(tier);

    btn.classList.add('is-active');
    btn.classList.remove('is-done', 'is-fading');
    const bar = btn.querySelector('.offline-bar');
    const sizeEl = btn.querySelector('.offline-size');
    cachedBadge(btn).hidden = true;
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
    setOfflineStatus('');   // a fresh attempt clears any previous failure note
    let done = 0, failed = 0;
    const failedUrls = [];
    for (const url of urls) {
      let ok = false;
      try {
        // force re-fetches even cached entries (used by the daily version
        // refresh); unchanged files come cheaply from the HTTP cache / 304.
        const exists = force ? null : await cache.match(new Request(url));
        if (exists) {
          ok = true;
        } else {
          const resp = await fetch(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' })
            .catch(() => fetch(url, { mode: 'no-cors' }));
          // Opaque (cross-origin no-cors) responses report ok=false but are
          // still cacheable; only a same-origin non-ok counts as a real failure.
          if (resp && (resp.type === 'opaque' || resp.ok)) {
            await cache.put(url, resp);
            ok = true;
          }
        }
      } catch (_) {}
      if (!ok) { failed++; failedUrls.push(url); }
      done++;
      setBar(done / urls.length);
      sizeEl.textContent = done + ' / ' + urls.length;
    }

    btn.classList.remove('is-active');
    setBar(1);
    const state = readOfflineState();
    if (failed > 0) {
      // Leave the button enabled (no is-done) so the user can retry the rest,
      // and drop any stale "cached" record for this tier.
      sizeEl.textContent = 'Try again';
      // Name the files that failed so a single bad URL (offline asset, blocked CDN)
      // is identifiable rather than just a count. Show basenames, capped so a mass
      // failure doesn't flood the status line.
      const shortName = (u) => { try { return decodeURIComponent(u.split('?')[0].split('/').pop()) || u; } catch (_) { return u; } };
      const names = failedUrls.map(shortName);
      const shown = names.slice(0, 8).join(', ') + (names.length > 8 ? ', +' + (names.length - 8) + ' more' : '');
      setOfflineStatus(failed + ' of ' + urls.length + ' file' + (urls.length === 1 ? '' : 's') +
        ' failed to download (' + shown + '). You may be offline or a server was unreachable - try again to finish.');
      delete state[tier];
      writeOfflineState(state);
      return false;
    }
    sizeEl.textContent = 'Cached';
    state[tier] = COMMIT_COUNT;
    writeOfflineState(state);
    // Refresh ALL buttons: this one gets its badge, lower tiers grey out as "Included",
    // higher tiers switch to the "+N MB more" upgrade delta.
    refreshTierButtons();
    return true;
  }

  // The help-panel legend always shows the absolute per-tier totals (it describes the
  // tiers, not the live upgrade state). Stamped from the canonical map so every page
  // agrees and any stale figure baked into the markup is overridden.
  document.querySelectorAll('.offline-help-panel > div').forEach(d => {
    const tier = (d.querySelector('strong')?.textContent || '').trim().toLowerCase();
    const s = d.querySelector('span');
    if (s && TIER_SIZES[tier]) s.textContent = TIER_SIZES[tier];
  });
  // Button labels are dynamic (greyed "Included" for covered tiers, "+N MB more" deltas
  // for upgrades), so let refreshTierButtons own them - it reads the saved state.
  refreshTierButtons();

  document.querySelectorAll('.offline-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-active') || btn.classList.contains('is-done')) return;
      downloadTier(btn, { force: false });
    });
  });

  // On every load: restore the persisted "Cached" badges, then re-check the app
  // version - refreshing in place any cached tier whose files were stored under
  // an older version (i.e. the app updated since they were downloaded). Files
  // that did not change come cheaply from the HTTP cache, so the refresh is light.
  (async () => {
    let state = readOfflineState();
    const buttons = {};
    document.querySelectorAll('.offline-btn').forEach(b => { buttons[b.dataset.tier] = b; });

    // Self-heal: if nothing is recorded (a tier cached before this record
    // existed, or localStorage was wiped) but files are actually in the offline
    // cache, backfill the record for the highest tier present so the tag shows.
    if (!Object.keys(state).length) {
      const detected = await detectCachedTier();
      if (detected) { state[detected] = COMMIT_COUNT; writeOfflineState(state); }
    }

    // Paint the restored / self-healed state (badges, greying, upgrade deltas).
    refreshTierButtons();
    for (const tier of Object.keys(state)) {
      if (state[tier] !== COMMIT_COUNT && buttons[tier]) {
        await downloadTier(buttons[tier], { force: true });
      }
    }
    refreshTierButtons();
  })();

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
      // 1. Preserve the dark-mode state and the Asteroids high score, then wipe
      //    localStorage + sessionStorage and restore the kept keys.
      const KEEP = ['anr-theme', 'anr-theme:ts', 'anr-asteroids-hi'];
      const kept = {};
      for (const k of KEEP) { const v = localStorage.getItem(k); if (v !== null) kept[k] = v; }
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
      for (const k in kept) { try { localStorage.setItem(k, kept[k]); } catch (_) {} }
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
      // Reset the offline-tier buttons to their default state (localStorage.clear
      // above already dropped the 'anr-offline' record).
      document.querySelectorAll('.offline-btn').forEach(b => {
        b.classList.remove('is-done', 'is-active', 'is-fading', 'is-included');
        const bar = b.querySelector('.offline-bar');
        if (bar) bar.hidden = true;
        const badge = b.querySelector('.offline-cached');
        if (badge) badge.hidden = true;
      });
      // With the record gone, this repaints every button to its un-cached state:
      // no greying, full per-tier sizes.
      refreshTierButtons();
      clearBtn.textContent = 'All data cleared ✓';
      setTimeout(() => { clearBtn.textContent = 'Clear storage'; }, 3000);
    });
  }

  // ----- Supported-formats catalog (generated from formats.js) -----
  // index.html has #fmtBody (the overlay); about.html has #aboutFormats and its
  // own copy of #fmtBody (the same overlay markup).
  renderFmtOverlay($('fmtBody'));
  renderAboutFormats($('aboutFormats'));
  // Per-letter cursor-hover effect on the group headers in the popup, the about
  // list and the /formats hub (same feel as the site header / footer mark).
  setupFmtHeaderFx(document);

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
  // /about#ext-sldprt or #fmt-cad from a search result should expand the
  // dropdown and scroll to the target.
  function revealHashTarget() {
    const id = decodeURIComponent((location.hash || '').slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const details = target.closest('details');
    // Only reveal+scroll when the deep-link target is inside a collapsed <details>
    // (the supported-formats list), which a native hash jump can't reach. Plain
    // section anchors are left to the browser's native jump - no extra autoscroll.
    if (details) {
      details.open = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
    }
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
    const fmtChips = $('fmtChips');
    const fmtResultCount = $('fmtResultCount');
    const fmtToggleAll = $('fmtToggleAll');
    const fmtBody = $('fmtBody');
    let activeCat = 'all';

    // Empty-state node lives inside the scroll body but is created here (rather
    // than in the HTML) so renderFmtOverlay's innerHTML reset doesn't wipe it.
    let fmtEmpty = $('fmtEmpty');
    if (fmtBody && !fmtEmpty) {
      fmtEmpty = el('p', { class: 'fmt-empty', id: 'fmtEmpty', hidden: 'hidden' });
      fmtBody.appendChild(fmtEmpty);
    }

    const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    // Wrap every case-insensitive occurrence of `q` in <mark>; restore the plain
    // text when `q` is empty. The original text is cached on the element so the
    // highlight is non-destructive and idempotent across keystrokes.
    function highlightEl(elm, q) {
      if (elm._orig == null) elm._orig = elm.textContent;
      const text = elm._orig;
      if (!q) { if (elm.innerHTML !== text) elm.textContent = text; return; }
      const lower = text.toLowerCase();
      let i = lower.indexOf(q), last = 0, html = '';
      if (i === -1) { elm.textContent = text; return; }
      while (i !== -1) {
        html += escapeHtml(text.slice(last, i)) +
          '<mark class="fmt-mark">' + escapeHtml(text.slice(i, i + q.length)) + '</mark>';
        last = i + q.length;
        i = lower.indexOf(q, last);
      }
      html += escapeHtml(text.slice(last));
      elm.innerHTML = html;
    }

    function buildChips() {
      if (!fmtChips) return;
      const chipDefs = [{ key: 'all', label: 'All' }, ...CATEGORIES];
      fmtChips.innerHTML = '';
      for (const c of chipDefs) {
        const on = c.key === activeCat;
        const btn = el('button', {
          type: 'button', class: 'fmt-chip' + (on ? ' is-active' : ''),
          'data-cat': c.key, role: 'tab', 'aria-selected': on ? 'true' : 'false',
        }, c.label);
        btn.addEventListener('click', () => {
          activeCat = c.key;
          fmtChips.querySelectorAll('.fmt-chip').forEach((b) => {
            const sel = b.dataset.cat === activeCat;
            b.classList.toggle('is-active', sel);
            b.setAttribute('aria-selected', sel ? 'true' : 'false');
          });
          applyFilter();
        });
        fmtChips.appendChild(btn);
      }
    }

    const visibleItems = () => [...items].filter((it) => !it.classList.contains('is-hidden'));
    function syncToggleAll() {
      if (!fmtToggleAll) return;
      const vis = visibleItems();
      fmtToggleAll.disabled = vis.length === 0;
      fmtToggleAll.textContent = vis.some((it) => !it.open) ? 'Expand all' : 'Collapse all';
    }

    function applyFilter() {
      const raw = fmtSearch ? fmtSearch.value.trim() : '';
      const q = raw.toLowerCase();
      let visCount = 0;
      const extSet = new Set();
      items.forEach((it) => {
        const labelEl = it.querySelector('.fmt-item-label');
        const extsEl = it.querySelector('.fmt-item-exts');
        const descEl = it.querySelector('.fmt-item-desc');
        const catOk = activeCat === 'all' || it.dataset.cat === activeCat;
        const text = (
          labelEl.textContent + ' ' + extsEl.textContent + ' ' +
          (it.dataset.tags || '') + ' ' + descEl.textContent
        ).toLowerCase();
        const match = catOk && (!q || text.includes(q));
        it.classList.toggle('is-hidden', !match);
        // Auto-open matches so the matched text shows; collapse when cleared.
        it.open = q ? match : false;
        const hq = (q && match) ? q : '';
        highlightEl(labelEl, hq);
        it.querySelectorAll('.fmt-item-ext').forEach((s) => highlightEl(s, hq));
        highlightEl(descEl, hq);
        if (match) {
          visCount++;
          extsEl.textContent.split(/\s+/).forEach((t) => { if (t) extSet.add(t.toLowerCase()); });
        }
      });
      let firstVisibleLabel = null;
      labels.forEach((label) => {
        const list = label.nextElementSibling;
        const visible = list ? list.querySelectorAll('.fmt-item:not(.is-hidden)').length : 0;
        label.style.display = visible ? '' : 'none';
        label.classList.remove('is-first-visible');
        if (visible && !firstVisibleLabel) firstVisibleLabel = label;
      });
      if (firstVisibleLabel) firstVisibleLabel.classList.add('is-first-visible');
      if (fmtResultCount) {
        fmtResultCount.textContent =
          visCount + (visCount === 1 ? ' format' : ' formats') + ' · ' + extSet.size + ' extensions';
      }
      if (fmtEmpty) {
        fmtEmpty.hidden = visCount !== 0;
        if (visCount === 0) fmtEmpty.textContent = raw ? `No formats match “${raw}”.` : 'No formats in this category.';
      }
      syncToggleAll();
    }

    function hideFmt() { fmtOverlay.hidden = true; document.body.style.overflow = ''; fmtOverlay._backClose = null; }
    function openFmt() {
      const wasHidden = fmtOverlay.hidden;
      fmtOverlay.hidden = false;
      document.body.style.overflow = 'hidden';
      if (wasHidden) fmtOverlay._backClose = openOverlayBack(hideFmt);   // device Back closes it
      activeCat = 'all';
      buildChips();
      if (fmtSearch) {
        fmtSearch.value = '';
        if (matchMedia('(pointer:fine)').matches) fmtSearch.focus();
      }
      applyFilter();
    }
    function closeFmt() { if (fmtOverlay._backClose) fmtOverlay._backClose(); else hideFmt(); }

    buildChips();

    document.querySelectorAll('[data-fmt-open]').forEach((trigger) => {
      if (trigger._fmtWired) return;
      trigger._fmtWired = true;
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openFmt();
      });
    });

    if (fmtClose && !fmtClose._wired) { fmtClose._wired = true; fmtClose.addEventListener('click', closeFmt); }
    if (fmtToggleAll && !fmtToggleAll._wired) {
      fmtToggleAll._wired = true;
      fmtToggleAll.addEventListener('click', () => {
        const vis = visibleItems();
        const expand = vis.some((it) => !it.open);
        vis.forEach((it) => { it.open = expand; });
        syncToggleAll();
      });
    }
    if (!fmtOverlay._wired) {
      fmtOverlay._wired = true;
      fmtOverlay.addEventListener('click', (e) => { if (e.target === fmtOverlay) closeFmt(); });
    }
    // Each extension token is a link to its /formats page. The overlay lives
    // outside the SPA-swapped regions, so letting navigate.js do an in-place hop
    // would leave the (now orphaned) overlay open with the body scroll locked.
    // Intercept here: stop the click reaching navigate.js, suppress the parent
    // <details> toggle, and do a full navigation that tears the overlay down.
    if (!fmtOverlay._extNavWired) {
      fmtOverlay._extNavWired = true;
      fmtOverlay.addEventListener('click', (e) => {
        const a = e.target.closest('a.fmt-item-ext');
        if (!a || !fmtOverlay.contains(a)) return;
        e.preventDefault();
        e.stopPropagation();
        location.assign(a.getAttribute('href'));
      });
    }
    if (!boot._fmtKeyWired) {
      // Persists across navigations, so close self-contained off a fresh lookup
      // rather than this boot's (possibly stale) closeFmt/fmtOverlay.
      boot._fmtKeyWired = true;
      window.addEventListener('keydown', (e) => {
        const ov = $('fmtOverlay');
        if (e.key === 'Escape' && ov && !ov.hidden) {
          if (ov._backClose) ov._backClose();
          else { ov.hidden = true; document.body.style.overflow = ''; }
        }
      });
    }
    if (fmtSearch && !fmtSearch._wired) { fmtSearch._wired = true; fmtSearch.addEventListener('input', applyFilter); }

    // Sitelinks searchbox / deep-link: /?q=foo (the WebSite schema's SearchAction
    // target) and /formats?q=foo open the formats overlay pre-filtered, so a query
    // from search results lands directly on matching formats.
    if (fmtSearch) {
      const q = new URLSearchParams(location.search).get('q');
      if (q) {
        openFmt();
        fmtSearch.value = q;
        applyFilter();
      }
    }
  }

  // ----- "I'm feeling lucky" -> a random per-format landing page -----
  // Any [data-fmt-random] button jumps to a random /formats/<ext> page. The
  // ext list comes from the same catalog that drives the overlay, and the
  // full-wins routing mirrors tools/prerender-format-pages.mjs (a full row gets
  // /formats/<ext>, an id-only one /formats/id/<ext>), so it never points at a
  // page that does not exist. A throwaway <a> click lets navigate.js do the SPA
  // View Transition (and falls back to a plain navigation if it is absent).
  document.querySelectorAll('[data-fmt-random]').forEach((trigger) => {
    if (trigger._fmtRandWired) return;
    trigger._fmtRandWired = true;
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      const full = new Set();
      const all = new Set();
      for (const g of catalogGrouped()) {
        for (const r of g.rows) {
          for (const tok of r.exts) {
            const k = tok.toLowerCase();
            all.add(k);
            if (r.depth === 'full') full.add(k);
          }
        }
      }
      const keys = [...all];
      if (!keys.length) return;
      const k = keys[Math.floor(Math.random() * keys.length)];
      const path = full.has(k) ? `/formats/${k}` : `/formats/id/${k}`;
      const a = document.createElement('a');
      a.href = path;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  });

  // ----- Inline search on the /formats hub page -----
  // Filters the on-page catalog list (the same .fmt-item markup the overlay uses)
  // live, so visitors can narrow the whole catalog without opening the popup. An
  // AND match across the label, extension list, search tags and description.
  const fmtPageSearch = $('fmtPageSearch');
  if (fmtPageSearch && !fmtPageSearch._wired) {
    fmtPageSearch._wired = true;
    const pItems = Array.from(document.querySelectorAll('.formats-page .fmt-item'));
    const pLabels = Array.from(document.querySelectorAll('.formats-page .fmt-section-label'));
    const pStatus = $('fmtPageSearchStatus');
    const applyPageFilter = () => {
      const raw = fmtPageSearch.value.trim();
      const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
      let vis = 0;
      pItems.forEach((it) => {
        const labelEl = it.querySelector('.fmt-item-label');
        const extsEl = it.querySelector('.fmt-item-exts');
        const descEl = it.querySelector('.fmt-item-desc');
        const hay = (
          (labelEl ? labelEl.textContent : '') + ' ' +
          (extsEl ? extsEl.textContent : '') + ' ' +
          (it.dataset.tags || '') + ' ' +
          (descEl ? descEl.textContent : '')
        ).toLowerCase();
        const match = !tokens.length || tokens.every((t) => hay.includes(t));
        it.classList.toggle('is-hidden', !match);
        it.open = tokens.length ? match : false;   // open matches so the desc shows
        if (match) vis++;
      });
      pLabels.forEach((label) => {
        const list = label.nextElementSibling;
        const n = list ? list.querySelectorAll('.fmt-item:not(.is-hidden)').length : 0;
        label.style.display = n ? '' : 'none';
      });
      if (pStatus) {
        pStatus.hidden = !raw;
        if (raw) pStatus.textContent = vis
          ? vis + (vis === 1 ? ' format matches' : ' formats match')
          : 'No formats match “' + raw + '”.';
      }
    };
    fmtPageSearch.addEventListener('input', applyPageFilter);
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
