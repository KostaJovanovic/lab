/* Analyser - entry point
   - Boots photo + audio + video modules
   - Acts as the page-wide drop target (until the first file lands)
   - Classifies dropped files into photo / audio / video / unknown
   - Renders a basic dump for unknown formats */

const COMMIT_COUNT = 17;
const VERSION_OFFSET = 17;

import { initPhoto, renderPhoto } from './photo.js';
import { initAudio, renderAudio } from './audio.js';
import { initVideo, renderVideo } from './video.js';
import { renderPdf } from './pdf.js';
import { renderArchive } from './archive.js';
import { renderSvg } from './svg.js';
import { renderCsv } from './csv.js';
import { renderUnknown } from './unknown.js';
import { renderProprietary, isProprietaryExt } from './proprietary.js';
import { initSearch } from './search.js';
import { fileExt } from './util.js';

function $(id) { return document.getElementById(id); }

// ---------- file classification ----------
const PHOTO_EXTS = new Set([
  'jpg','jpeg','jpe','jif','jfif','png','gif','webp','heic','heif','heics','heifs',
  'bmp','tif','tiff','avif','jxl','ico',
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

const CSV_EXTS = new Set(['csv', 'tsv']);
const SVG_EXTS = new Set(['svg']);

function classifyFile(file) {
  const t = (file.type || '').toLowerCase();
  const ext = fileExt(file.name);
  // SVG before generic image/ MIME so it gets its own handler
  if (t === 'image/svg+xml' || SVG_EXTS.has(ext)) return 'svg';
  if (t.startsWith('image/')) return 'photo';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (CSV_EXTS.has(ext) || t === 'text/csv' || t === 'text/tab-separated-values') return 'csv';
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

    function scrollTo(hash) {
      const el = document.querySelector(hash);
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 60;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    }

    if (kind === 'photo') {
      markNav('#photo');
      scrollTo('#photo');
      renderPhoto(file, photoResults);
    } else if (kind === 'audio') {
      markNav('#audio');
      scrollTo('#audio');
      renderAudio(file, audioResults);
    } else if (kind === 'video') {
      markNav('#video');
      markNav('#audio');
      markNav('#photo');
      scrollTo('#video');
      renderVideo(file, videoResults);
    } else if (kind === 'pdf') {
      scrollTo('#unknownResults');
      renderPdf(file, unknownResults);
    } else if (kind === 'zip') {
      scrollTo('#unknownResults');
      renderArchive(file, unknownResults);
    } else if (kind === 'svg') {
      scrollTo('#unknownResults');
      renderSvg(file, unknownResults);
    } else if (kind === 'csv') {
      scrollTo('#unknownResults');
      renderCsv(file, unknownResults);
    } else if (kind === 'proprietary') {
      scrollTo('#unknownResults');
      renderProprietary(file, unknownResults);
    } else {
      scrollTo('#unknownResults');
      renderUnknown(file, unknownResults);
    }
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
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter = 0;
      const drop = $('pageDrop');
      if (drop) drop.hidden = true;
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

  // ----- Version number -----
  const verEl = $('versionNum');
  if (verEl) {
    const minor = Math.max(0, COMMIT_COUNT - VERSION_OFFSET);
    verEl.textContent = '1.' + minor;
  }

  // ----- Dark mode toggle -----
  const saved = localStorage.getItem('anr-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  const darkBtn = $('darkToggle');
  if (darkBtn) {
    darkBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'Disable' : 'Enable';
    darkBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('anr-theme', next);
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

    if (title && byline && mark && window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
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
        inside = true;
        for (const l of letters) l.el.style.transition = 'font-weight 0.15s ease';
        raf = requestAnimationFrame(tick);
        setTimeout(() => { for (const l of letters) l.el.style.transition = ''; }, 150);
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
    }

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
  const TESS_DATA = 'https://cdn.jsdelivr.net/npm/tesseract.js-data@5.0.0/tessdata_fast';
  const TESS_WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/worker.min.js';

  const TIERS = {
    essentials: [
      './index.html', './manifest.json', './assets/analyser.css', './assets/fonts.css',
      './assets/analyser/app.js', './assets/analyser/util.js', './assets/analyser/search.js',
      './assets/analyser/photo.js', './assets/analyser/audio.js', './assets/analyser/audio-analysis.js',
      './assets/analyser/audio-codec.js', './assets/analyser/video.js', './assets/analyser/spectrogram.js',
      './assets/analyser/pdf.js', './assets/analyser/archive.js', './assets/analyser/svg.js',
      './assets/analyser/csv.js', './assets/analyser/unknown.js', './assets/analyser/proprietary.js',
      './assets/favicon.svg', './assets/icon.png',
      'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js',
      './assets/fonts/geist-latin.woff2', './assets/fonts/geist-latin-ext.woff2',
      './assets/fonts/geist-cyrillic.woff2', './assets/fonts/geist-cyrillic-ext.woff2',
      './assets/fonts/geist-vietnamese.woff2',
      './assets/fonts/geist-mono-latin.woff2', './assets/fonts/geist-mono-latin-ext.woff2',
      './assets/fonts/geist-mono-cyrillic.woff2', './assets/fonts/geist-mono-cyrillic-ext.woff2',
      './assets/fonts/geist-mono-symbols.woff2', './assets/fonts/geist-mono-vietnamese.woff2',
      'https://cdn.jsdelivr.net/npm/@imagemagick/magick-wasm@0.0.40/dist/index.mjs',
      'https://cdn.jsdelivr.net/npm/@imagemagick/magick-wasm@0.0.40/dist/magick.wasm',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
      'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js'
    ],
    everything: [
      'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
      'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js',
      TESS_WORKER,
      TESS_DATA + '/eng.traineddata.gz',
      'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
      'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
      'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs',
      'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js'
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
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') installBtn.hidden = true;
      deferredPrompt = null;
    });
  }
  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.hidden = true;
    deferredPrompt = null;
  });

  // ----- Offline clear -----
  const clearBtn = document.getElementById('offlineClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await caches.delete('analyser-offline');
      document.querySelectorAll('.offline-btn').forEach(b => {
        b.classList.remove('is-done', 'is-active');
        b.querySelector('.offline-bar').hidden = true;
        const tier = b.dataset.tier;
        const sizes = { essentials: '~47 MB', everything: '~57 MB', complete: '~190 MB' };
        b.querySelector('.offline-size').textContent = sizes[tier];
      });
    });
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
