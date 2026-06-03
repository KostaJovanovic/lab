/* Analyser - entry point
   - Boots photo + audio + video modules
   - Acts as the page-wide drop target (until the first file lands)
   - Classifies dropped files into photo / audio / video / unknown
   - Renders a basic dump for unknown formats */

const COMMIT_COUNT = 34;
const VERSION_OFFSET = 32;

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
import { initSearch } from './search.js';
import { fileExt, el } from './util.js';
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

function showDropLoader(file) {
  clearTimeout(_dropLoaderTimer);
  const name = (file && file.name) ? file.name : 'file';
  _dropLoaderTimer = setTimeout(() => {
    if (!_dropLoaderEl || !_dropLoaderEl.isConnected) {
      const fill = el('div', { class: 'anr-drop-loader-fill' });
      const track = el('div', { class: 'anr-drop-loader-track' }, fill);
      const label = el('div', { class: 'anr-drop-loader-label' }, '');
      _dropLoaderEl = el('div', { class: 'anr-drop-loader', role: 'status', 'aria-live': 'polite' }, [label, track]);
      _dropLoaderEl._label = label;
      document.body.appendChild(_dropLoaderEl);
    }
    _dropLoaderEl._label.textContent = 'Reading ' + name + '…';
    requestAnimationFrame(() => _dropLoaderEl.classList.add('is-open'));
  }, 160);
}

function hideDropLoader() {
  clearTimeout(_dropLoaderTimer);
  if (_dropLoaderEl) _dropLoaderEl.classList.remove('is-open');
}

// ---------- file classification ----------
// Extension sets live in formats.js (the central catalog). See that file to
// add a new type — the overlay, about page, and search update automatically.

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
  if (PHOTO_EXTS.has(ext)) return 'photo';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (isProprietaryExt(ext)) return 'proprietary';
  return 'unknown';
}

// ---------- page-wide drag-drop ----------
function hasFiles(e) {
  const t = e.dataTransfer && e.dataTransfer.types;
  if (!t) return false;
  for (let i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
  return false;
}

let _handleFile = null;
let _scrollHandler = null;

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

  async function handleFile(file) {
    if (!file) return;
    showDropLoader(file);

    // Clear all previous results
    photoResults.innerHTML = ''; photoResults.hidden = true;
    audioResults.innerHTML = ''; audioResults.hidden = true;
    videoResults.innerHTML = ''; videoResults.hidden = true;
    unknownResults.innerHTML = ''; unknownResults.hidden = true;

    // Clear preview slots
    const previewSlots = ['photoPreview', 'photoOcrSlot', 'photoHistSlot', 'videoPreview'];
    for (const id of previewSlots) {
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

    firstFileLoaded = true;
    if (pageDropEl) pageDropEl.hidden = true;
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

    let renderPromise;
    if (kind === 'photo') {
      markNav('#photo');
      markAnalysed('photo');
      scrollTo('#photo');
      renderPromise = renderPhoto(file, photoResults);
    } else if (kind === 'audio') {
      markNav('#audio');
      markAnalysed('audio');
      scrollTo('#audio');
      renderPromise = renderAudio(file, audioResults);
    } else if (kind === 'video') {
      markNav('#video');
      markNav('#audio');
      markNav('#photo');
      markAnalysed('video');
      markAnalysed('photo');
      scrollTo('#video');
      renderPromise = renderVideo(file, videoResults);
    } else if (kind === 'docx') {
      scrollTo('#unknownResults');
      renderPromise = renderDocx(file, unknownResults);
    } else if (kind === 'xlsx') {
      scrollTo('#unknownResults');
      renderPromise = renderXlsx(file, unknownResults);
    } else if (kind === 'epub') {
      scrollTo('#unknownResults');
      renderPromise = renderEpub(file, unknownResults);
    } else if (kind === 'pptx') {
      scrollTo('#unknownResults');
      renderPromise = renderPptx(file, unknownResults);
    } else if (kind === 'stl') {
      scrollTo('#unknownResults');
      renderPromise = renderStl(file, unknownResults);
    } else if (kind === 'pdf') {
      scrollTo('#unknownResults');
      renderPromise = renderPdf(file, unknownResults);
    } else if (kind === 'zip') {
      scrollTo('#unknownResults');
      renderPromise = renderArchive(file, unknownResults);
    } else if (kind === 'svg') {
      scrollTo('#unknownResults');
      renderPromise = renderSvg(file, unknownResults);
    } else if (kind === 'csv') {
      scrollTo('#unknownResults');
      renderPromise = renderCsv(file, unknownResults);
    } else if (kind === 'proprietary') {
      scrollTo('#unknownResults');
      renderPromise = renderProprietary(file, unknownResults);
    } else {
      scrollTo('#unknownResults');
      renderPromise = renderUnknown(file, unknownResults);
    }
    // Hide the bottom loader once the renderer settles (or immediately if it
    // wasn't async). Errors still dismiss it so it can't get stuck on screen.
    Promise.resolve(renderPromise).catch(() => {}).finally(() => hideDropLoader());
  }
  _handleFile = handleFile;

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

      // Only the description text opens the picker — never the results/controls
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

      const folderFiles = await walkItems(e.dataTransfer);
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
        return;
      }

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

  if (window._anrPendingFile && photoResults) {
    handleFile(window._anrPendingFile);
    delete window._anrPendingFile;
  }
  if (window._anrPendingFolder && unknownResults) {
    renderFolder(window._anrPendingFolder, unknownResults);
    delete window._anrPendingFolder;
  }

  // ----- Version number -----
  const verEl = $('versionNum');
  if (verEl) {
    const minor = Math.max(0, COMMIT_COUNT - VERSION_OFFSET);
    verEl.textContent = '1.' + minor;
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
    darkBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Disable' : 'Enable';
    darkBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      anrSet('anr-theme', next);
      darkBtn.textContent = next === 'dark' ? 'Disable' : 'Enable';
    });
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

    // ----- Header letter-proximity effect (one-time) -----
    const mark = document.querySelector('.site-mark');
    const title = document.querySelector('.site-title');
    const byline = document.querySelector('.site-byline');

    function splitText(container, baseWeight) {
      const spacing = getComputedStyle(container).letterSpacing;
      const spans = [];
      function makeSpan(ch, parent) {
        const s = document.createElement('span');
        s.textContent = ch;
        s.style.display = 'inline-block';
        s.style.fontWeight = baseWeight;
        s.style.letterSpacing = spacing;
        if (ch === ' ') s.style.width = '0.25em';
        parent.appendChild(s);
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

    var sweepRunning = false;
    var sweepCleanup = 0;

    function makeSweep(letters, radius, duration) {
      return function sweep() {
        sweepRunning = true;
        const rect = mark.getBoundingClientRect();
        const sx = rect.left - radius;
        const ex = rect.right + radius;
        const cy = rect.top + rect.height * 0.5;
        const span = ex - sx;
        let t0 = null;
        function frame(ts) {
          if (!sweepRunning) return;
          if (!t0) t0 = ts;
          const p = Math.min(1, (ts - t0) / duration);
          const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          const vx = sx + e * span;
          for (const l of letters) {
            const r = l.el.getBoundingClientRect();
            const d = Math.hypot(vx - (r.left + r.width / 2), cy - (r.top + r.height / 2));
            const f = Math.min(1, d / radius);
            l.el.style.fontWeight = Math.round(l.base * f + 300 * (1 - f));
          }
          if (p < 1) requestAnimationFrame(frame);
          else {
            for (const l of letters) {
              l.el.style.transition = 'font-weight 0.4s ease';
              l.el.style.fontWeight = l.base;
            }
            sweepCleanup = setTimeout(() => {
              for (const l of letters) l.el.style.transition = '';
              sweepRunning = false;
            }, 500);
          }
        }
        requestAnimationFrame(frame);
      };
    }

    if (title && byline && mark && window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
      const letters = initLetters();
      const RADIUS = 120;
      let mx = -9999, my = -9999, raf = 0, inside = false;

      function tick() {
        for (const l of letters) {
          const r = l.el.getBoundingClientRect();
          const dist = Math.hypot(mx - (r.left + r.width / 2), my - (r.top + r.height / 2));
          const t = Math.min(1, dist / RADIUS);
          l.el.style.fontWeight = Math.round(l.base * t + 300 * (1 - t));
        }
        if (inside) raf = requestAnimationFrame(tick);
      }

      mark.addEventListener('mouseenter', () => {
        if (sweepRunning) {
          sweepRunning = false;
          clearTimeout(sweepCleanup);
          for (const l of letters) l.el.style.transition = '';
        }
        inside = true;
        raf = requestAnimationFrame(tick);
      });
      mark.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
      mark.addEventListener('mouseleave', () => {
        inside = false;
        cancelAnimationFrame(raf);
        for (const l of letters) {
          l.el.style.transition = 'font-weight 0.3s ease';
          l.el.style.fontWeight = l.base;
        }
      });

      setTimeout(makeSweep(letters, RADIUS, 3500), 800);
    } else if (title && byline && mark && window.matchMedia('(pointer: coarse)').matches) {
      const letters = initLetters();
      const sweep = makeSweep(letters, 80, 3500);
      setTimeout(sweep, 800);
      setInterval(sweep, 8000);
    }

    setInterval(anrSweep, ANR_REFRESH);

    boot._once = true;
  } // end one-time guard

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
      './', './index.html', './about.html', './manifest.json', './assets/analyser.css', './assets/fonts.css',
      './assets/analyser/app.js', './assets/analyser/formats.js', './assets/analyser/util.js', './assets/analyser/search.js',
      './assets/analyser/photo.js', './assets/analyser/audio.js', './assets/analyser/audio-analysis.js',
      './assets/analyser/audio-codec.js', './assets/analyser/video.js', './assets/analyser/spectrogram.js',
      './assets/analyser/pdf.js', './assets/analyser/archive.js', './assets/analyser/svg.js',
      './assets/analyser/csv.js', './assets/analyser/unknown.js', './assets/analyser/proprietary.js',
      './assets/analyser/folder.js', './assets/analyser/navigate.js',
      './assets/analyser/photo-convert.js', './assets/analyser/audio-player.js', './assets/analyser/video-avi.js',
      './assets/analyser/docx.js', './assets/analyser/xlsx.js', './assets/analyser/epub.js',
      './assets/analyser/pptx.js', './assets/analyser/stl.js', './assets/analyser/zip.js',
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
      './assets/vendor/ffmpeg/ffmpeg-core.js',
      './assets/vendor/ffmpeg/ffmpeg-core.wasm',
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
    complete: [
      'srp', 'srp_latn', 'hrv', 'deu', 'fra', 'ita', 'spa', 'rus', 'ell', 'ara',
      'jpn', 'chi_sim', 'chi_tra', 'kor', 'heb', 'tur', 'ukr', 'pol', 'ron',
      'hun', 'ces', 'slk', 'slv', 'bul', 'mkd', 'nld', 'por', 'swe', 'nor', 'fin', 'dan'
    ].map(c => TESS_DATA + '/' + c + '.traineddata.gz')
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
        const total = Math.max(10, Math.floor((btn.clientWidth - ch * 2 - 32) / ch));
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
      setTimeout(() => { installBtn.textContent = 'Install as app'; }, 5000);
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
      setTimeout(() => { clearBtn.textContent = 'Clear all site data'; }, 3000);
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
