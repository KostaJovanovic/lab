/* Analyser - service worker
   Precache the app shell; stale-while-revalidate the rest. */

const VERSION = 'analyser-v113';

// Local dev (server.bat on localhost, or a LAN IP for phone testing) skips all
// caching: the SW becomes a network pass-through so a single refresh shows the
// latest edits, with no manual cache clearing. Production (lab.valjdakosta.com)
// is none of these hosts, so it keeps the full offline-first behaviour below.
const HOST = self.location.hostname;
const DEV = HOST === 'localhost' || HOST === '127.0.0.1' || HOST === '0.0.0.0' ||
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(HOST);
const SHELL = [
  './',
  './about',
  './patch',
  './formats',
  './stats',
  './privacy',
  './manifest.json',
  './assets/css/analyser.css',
  './assets/css/fonts.css',
  './assets/js/core/app.js',
  './assets/js/core/effects.js',
  './assets/js/core/popups.js',
  './assets/js/core/export-data.js',
  './assets/js/core/util.js',
  './assets/js/core/formats.js',
  './assets/js/core/search.js',
  './assets/js/renderers/photo.js',
  './assets/js/renderers/photo-convert.js',
  './assets/js/renderers/gif-frames.js',
  './assets/js/games/asteroids.js',
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
  './assets/js/renderers/gitobject.js',
  './assets/js/renderers/unknown.js',
  './assets/js/renderers/proprietary.js',
  './assets/js/renderers/proprietary-formats.js',
  './assets/js/core/binutil.js',
  './assets/js/lib/plist.js',
  './assets/js/lib/cfbf.js',
  './assets/js/lib/sqlite.js',
  './assets/js/lib/libarchive-loader.js',
  './assets/js/lib/openjpeg-loader.js',
  './assets/js/lib/xz-loader.js',
  './assets/js/lib/lzma-loader.js',
  './assets/js/lib/legacy-decompress.js',
  './assets/js/lib/nrbf.js',
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
  './assets/js/renderers/paged.js',
  './assets/js/renderers/odf.js',
  './assets/js/renderers/legacy-office.js',
  './assets/js/renderers/textdoc.js',
  './assets/js/renderers/notebook.js',
  './assets/js/renderers/email.js',
  './assets/js/renderers/dataview.js',
  './assets/js/renderers/diagram.js',
  './assets/js/renderers/iwork.js',
  './assets/js/renderers/stl.js',
  './assets/js/renderers/model3d.js',
  './assets/js/renderers/timeline.js',
  './assets/js/lib/occt-loader.js',
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

// Cloudflare Turnstile script - cross-origin and CORS-less, so it can't go in the
// addAll() SHELL (that would fail the whole install). Precache it best-effort with
// a no-cors fetch + cache.put (which accepts opaque responses); any failure is
// swallowed so install still succeeds. The challenge itself still needs the
// network at run time - this just makes the script itself available.
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
function precacheTurnstile(cache) {
  return fetch(new Request(TURNSTILE_URL, { mode: 'no-cors' }))
    .then((res) => cache.put(TURNSTILE_URL, res))
    .catch(() => {});
}

self.addEventListener('install', (e) => {
  // Dev: don't precache anything, just take over immediately.
  if (DEV) { self.skipWaiting(); return; }
  // Cache each shell entry independently (allSettled) instead of cache.addAll's
  // all-or-nothing: a single transient miss (a file mid-regeneration, a OneDrive
  // sync lock, a stale dev server) used to reject the WHOLE install, leaving the
  // SW dead and nothing cached. Now the install always completes; any entry that
  // failed is logged and picked up later by the stale-while-revalidate fetch
  // handler. The fetch fast-path (cached || network) tolerates a missing entry.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) =>
        Promise.allSettled(SHELL.map((u) => c.add(u).catch((err) => {
          console.warn('SW precache skipped:', u, err && err.message);
          throw err;
        })))
          .then(() => precacheTurnstile(c))
      )
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
  // Dev: never intercept - let every request go straight to the network so edits
  // appear on a single refresh. The activate handler above already deleted any
  // pre-existing cache, so there's nothing stale left to serve.
  if (DEV) return;

  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol === 'chrome-extension:' || url.protocol === 'about:') return;

  // Stats endpoints are always live, never cached. POST is already skipped above;
  // this also lets GET /api/stats hit the network (and fail cleanly when offline,
  // which the /stats page handles) instead of being served a stale cached copy.
  if (url.pathname.startsWith('/api/')) return;

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
