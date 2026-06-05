/* Analyser - service worker
   Precache the app shell; stale-while-revalidate the rest. */

const VERSION = 'analyser-v59';
const SHELL = [
  './',
  './index.html',
  './about.html',
  './patch.html',
  './manifest.json',
  './assets/css/analyser.css',
  './assets/css/fonts.css',
  './assets/js/core/app.js',
  './assets/js/core/util.js',
  './assets/js/core/formats.js',
  './assets/js/core/search.js',
  './assets/js/renderers/photo.js',
  './assets/js/renderers/photo-convert.js',
  './assets/js/renderers/audio.js',
  './assets/js/renderers/audio-player.js',
  './assets/js/renderers/audio-analysis.js',
  './assets/js/renderers/audio-codec.js',
  './assets/js/renderers/video.js',
  './assets/js/renderers/video-avi.js',
  './assets/js/renderers/spectrogram.js',
  './assets/js/renderers/pdf.js',
  './assets/js/renderers/archive.js',
  './assets/js/renderers/svg.js',
  './assets/js/renderers/csv.js',
  './assets/js/renderers/lrc.js',
  './assets/js/renderers/midi.js',
  './assets/js/renderers/subtitles.js',
  './assets/js/renderers/geo.js',
  './assets/js/renderers/markdown.js',
  './assets/js/renderers/comic.js',
  './assets/js/renderers/unknown.js',
  './assets/js/renderers/proprietary.js',
  './assets/js/core/binutil.js',
  './assets/js/lib/plist.js',
  './assets/js/lib/cfbf.js',
  './assets/js/lib/sqlite.js',
  './assets/js/lib/libarchive-loader.js',
  './assets/js/lib/openjpeg-loader.js',
  './assets/js/lib/xz-loader.js',
  './assets/js/lib/ghostscript-loader.js',
  './assets/js/parsers/parsers-dev.js',
  './assets/js/parsers/parsers-archive.js',
  './assets/js/parsers/parsers-email.js',
  './assets/js/parsers/parsers-security.js',
  './assets/js/parsers/parsers-gaming.js',
  './assets/js/parsers/parsers-disk.js',
  './assets/js/parsers/parsers-sci.js',
  './assets/js/parsers/parsers-osmisc.js',
  './assets/js/parsers/parsers-image.js',
  './assets/js/parsers/parsers-threed.js',
  './assets/js/parsers/parsers-geodata.js',
  './assets/js/parsers/parsers-audio.js',
  './assets/js/parsers/parsers-video.js',
  './assets/js/parsers/parsers-docs.js',
  './assets/js/parsers/parsers-raw.js',
  './assets/js/renderers/docx.js',
  './assets/js/renderers/xlsx.js',
  './assets/js/renderers/epub.js',
  './assets/js/renderers/pptx.js',
  './assets/js/renderers/stl.js',
  './assets/js/renderers/zip.js',
  './assets/js/renderers/folder.js',
  './assets/js/renderers/folder-archive-shared.js',
  './assets/js/renderers/treemap.js',
  './assets/js/core/navigate.js',
  './assets/img/favicon.svg',
  './assets/img/icon.png',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/vendor/exifr.umd.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol === 'chrome-extension:' || url.protocol === 'about:') return;

  e.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
