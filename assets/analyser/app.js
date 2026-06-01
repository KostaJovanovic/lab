/* Analyser - entry point
   - Boots photo + audio + video modules
   - Acts as the page-wide drop target (until the first file lands)
   - Classifies dropped files into photo / audio / video / unknown
   - Renders a basic dump for unknown formats */

import { initPhoto, renderPhoto } from './photo.js';
import { initAudio, renderAudio } from './audio.js';
import { initVideo, renderVideo } from './video.js';

function $(id) { return document.getElementById(id); }

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
async function sha256Hex(file) {
  if (!crypto.subtle) return null;
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- file classification ----------
const PHOTO_EXTS = new Set([
  'jpg','jpeg','jpe','jif','jfif','png','gif','webp','heic','heif','heics','heifs',
  'bmp','tif','tiff','svg','avif','jxl','ico',
  'raw','arw','cr2','cr3','nef','dng','raf','rw2','orf','pef','sr2','srw','x3f'
]);
const AUDIO_EXTS = new Set([
  'mp3','wav','wave','m4a','m4b','aac','flac','ogg','oga','opus',
  'aiff','aif','aifc','wma','weba','amr','ac3','dts','mka','mid','midi'
]);
const VIDEO_EXTS = new Set([
  'mp4','m4v','mov','avi','mkv','webm','wmv','flv',
  '3gp','3g2','mpg','mpeg','mts','m2ts','ts','vob','ogv'
]);

function fileExt(name) {
  const m = (name || '').match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function classifyFile(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'photo';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  const ext = fileExt(file.name);
  if (PHOTO_EXTS.has(ext)) return 'photo';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'unknown';
}

// ---------- magic-byte guess (for unknown files) ----------
/**
 * Best-effort format identification from the first ~128 bytes of a file.
 *
 * File formats start with distinctive byte sequences ("magic numbers") that
 * the OS and tools use to tell them apart even when the extension lies. This
 * function checks against the most common ones (PDF, PNG, JPEG, ZIP, MP3,
 * MP4, ELF, etc.). When nothing matches, it falls back to a printable-ASCII
 * heuristic to detect plain-text files.
 *
 * Returns a short human-readable label like "PNG image" or "ZIP container".
 */
function guessFormat(b) {
  if (!b || b.length < 4) return 'unknown';
  const a = (s, l) => Array.from(b.slice(s, s + l)).map((c) => String.fromCharCode(c)).join('');

  if (a(0, 4) === '%PDF')                                return 'PDF document';
  if (b[0] === 0x89 && a(1, 3) === 'PNG')                return 'PNG image';
  if (b[0] === 0xFF && b[1] === 0xD8)                    return 'JPEG image';
  if (a(0, 4) === 'GIF8')                                return 'GIF image';
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'WAVE')          return 'WAV audio';
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'WEBP')          return 'WebP image';
  if (a(0, 4) === 'RIFF' && a(8, 4) === 'AVI ')          return 'AVI video';
  if (a(0, 4) === 'OggS')                                return 'Ogg container';
  if (a(0, 4) === 'fLaC')                                return 'FLAC audio';
  if (a(0, 3) === 'ID3')                                 return 'MP3 (ID3-tagged)';
  if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)           return 'MPEG audio';
  if (a(4, 4) === 'ftyp')                                return 'MP4 / MOV / M4A (' + a(8, 4).replace(/[^\w]/g, '') + ')';
  if (b[0] === 0x50 && b[1] === 0x4B)                    return 'ZIP container (docx / xlsx / epub / apk / jar / ...)';
  if (a(0, 6) === '7z\xBC\xAF\x27\x1C')                  return '7-Zip archive';
  if (b[0] === 0x1F && b[1] === 0x8B)                    return 'gzip archive';
  if (a(0, 4) === 'Rar!')                                return 'RAR archive';
  if (b[0] === 0x7F && a(1, 3) === 'ELF')                return 'ELF binary';
  if (a(0, 2) === 'MZ')                                  return 'Windows EXE / DLL (MZ)';
  if (a(0, 5) === '<?xml')                               return 'XML document';
  if (a(0, 6) === 'SQLite')                              return 'SQLite database';
  if (a(0, 2) === 'BM')                                  return 'BMP image';
  if (a(0, 4) === '\x00\x00\x01\x00')                    return 'ICO icon';
  if ((a(0, 2) === 'II' && b[2] === 0x2A) || (a(0, 2) === 'MM' && b[3] === 0x2A)) return 'TIFF image';
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'Matroska / WebM';
  if (b[0] === 0xCA && b[1] === 0xFE && b[2] === 0xBA && b[3] === 0xBE) return 'Java class / Mach-O fat binary';

  let printable = 0;
  for (const c of b) if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7E)) printable++;
  if (printable / b.length > 0.85) return 'plain text';
  return 'unrecognised (binary)';
}

// ---------- unknown-file render ----------
async function renderUnknown(file, resultsEl) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Inspecting "${file.name}"…`));

  let headBytes;
  try {
    headBytes = new Uint8Array(await file.slice(0, 128).arrayBuffer());
  } catch (e) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Could not read this file: ' + (e && e.message)));
    return;
  }

  const hex   = Array.from(headBytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(headBytes).map((b) => (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.').join('');
  const guess = guessFormat(headBytes);

  resultsEl.innerHTML = '';

  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, 'Unknown file — best-effort inspection'));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name',     file.name));
  tbl.appendChild(row('Size',     `${fmtBytes(file.size)}   (${file.size.toLocaleString()} bytes)`));
  tbl.appendChild(row('MIME',     file.type || '-'));
  tbl.appendChild(row('Modified', file.lastModified ? new Date(file.lastModified).toISOString().replace('T', ' ').replace(/\..*$/, '') : '-'));
  tbl.appendChild(row('Extension', fileExt(file.name) || '-'));
  tbl.appendChild(row('Magic guess', guess));
  card.appendChild(tbl);

  card.appendChild(el('div', { class: 'anr-readout-section' }, 'First 128 bytes'));
  card.appendChild(el('pre', { class: 'anr-unknown-dump' }, 'HEX:\n' + hex + '\n\nASCII:\n' + ascii));

  card.appendChild(el('div', { class: 'anr-readout-section' }, 'SHA-256'));
  const hashOut = el('p', { class: 'anr-hint', style: 'word-break: break-all; font-size: 12px; margin: 4px 0 0;' }, 'computing…');
  card.appendChild(hashOut);

  // If it looks like text, show a small preview
  if (guess === 'plain text' || guess === 'XML document') {
    card.appendChild(el('div', { class: 'anr-readout-section' }, 'Text preview (first 2 kB)'));
    const previewOut = el('pre', { class: 'anr-ocr-text' }, '');
    card.appendChild(previewOut);
    file.slice(0, 2048).text().then((txt) => { previewOut.textContent = txt; }).catch(() => {});
  }

  resultsEl.appendChild(card);

  sha256Hex(file).then((h) => {
    hashOut.textContent = h || 'SHA-256 unavailable in this browser';
  });
}

// ---------- page-wide drag-drop ----------
function hasFiles(e) {
  const t = e.dataTransfer && e.dataTransfer.types;
  if (!t) return false;
  for (let i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
  return false;
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

  function handleFile(file) {
    if (!file) return;
    firstFileLoaded = true;
    if (pageDropEl) pageDropEl.hidden = true;
    const kind = classifyFile(file);

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

    if (kind === 'photo')       renderPhoto(file, photoResults);
    else if (kind === 'audio')  renderAudio(file, audioResults);
    else if (kind === 'video')  renderVideo(file, videoResults);
    else                        renderUnknown(file, unknownResults);
  }

  initPhoto({
    dropEl:    $('photoDrop'),
    inputEl:   $('photoInput'),
    resultsEl: photoResults,
    onFile:    handleFile
  });

  initAudio({
    dropEl:    $('audioDrop'),
    inputEl:   $('audioInput'),
    recordBtn: $('audioRecord'),
    liveBtn:   $('audioLive'),
    resultsEl: audioResults,
    onFile:    handleFile
  });

  initVideo({
    dropEl:    $('videoDrop'),
    inputEl:   $('videoInput'),
    resultsEl: videoResults,
    onFile:    handleFile
  });

  // ----- Page-level drag/drop -----
  // Before the first file lands the whole page is a drop target and an overlay
  // appears while a file is being dragged. After the first file, drops anywhere
  // still route through handleFile but the overlay no longer flashes.
  //
  // Why a `dragCounter`? `dragenter` / `dragleave` fire for every child element
  // the cursor crosses, not just the page boundary. Counting +1/-1 instead of
  // toggling on a single boolean prevents flicker while dragging across the
  // header, nav, dropzones, etc.
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragCounter++;
    if (!firstFileLoaded && pageDropEl) pageDropEl.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0 && pageDropEl) pageDropEl.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();   // required to allow drop
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter = 0;
    if (pageDropEl) pageDropEl.hidden = true;
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files) for (const file of files) handleFile(file);
  });

  // ----- Dark mode toggle -----
  const saved = localStorage.getItem('anr-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  const darkBtn = document.createElement('button');
  darkBtn.type = 'button';
  darkBtn.className = 'dark-toggle';
  darkBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Light' : 'Dark';
  darkBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('anr-theme', next);
    darkBtn.textContent = next === 'dark' ? 'Light' : 'Dark';
  });
  const nav = document.querySelector('.site-nav');
  if (nav) nav.appendChild(darkBtn);

  // ----- Clipboard paste (Ctrl+V) -----
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) handleFile(file);
      }
    }
  });

  // ----- Scroll-spy for the sticky nav -----
  const links = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
  const sections = links
    .map((a) => ({ a, el: document.querySelector(a.getAttribute('href')) }))
    .filter((s) => s.el);
  function onScroll() {
    let active = sections[0];
    const y = window.scrollY + 140;
    for (const s of sections) {
      if (s.el.offsetTop <= y) active = s;
    }
    for (const s of sections) s.a.classList.toggle('is-active', s === active);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
