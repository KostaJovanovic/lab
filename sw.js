/* Analyser - service worker
   Precache the app shell; stale-while-revalidate the rest. */

const VERSION = 'analyser-v18';
const SHELL = [
  './',
  './index.html',
  './about.html',
  './manifest.json',
  './assets/analyser.css',
  './assets/fonts.css',
  './assets/analyser/app.js',
  './assets/analyser/util.js',
  './assets/analyser/formats.js',
  './assets/analyser/search.js',
  './assets/analyser/photo.js',
  './assets/analyser/audio.js',
  './assets/analyser/audio-analysis.js',
  './assets/analyser/audio-codec.js',
  './assets/analyser/video.js',
  './assets/analyser/video-avi.js',
  './assets/analyser/spectrogram.js',
  './assets/analyser/pdf.js',
  './assets/analyser/archive.js',
  './assets/analyser/svg.js',
  './assets/analyser/csv.js',
  './assets/analyser/unknown.js',
  './assets/analyser/proprietary.js',
  './assets/analyser/folder.js',
  './assets/analyser/navigate.js',
  './assets/favicon.svg',
  './assets/icon.png',
  'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(
      SHELL.map((u) => new Request(u, { mode: u.startsWith('http') ? 'no-cors' : 'same-origin' }))
    )).then(() => self.skipWaiting())
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
