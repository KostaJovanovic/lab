# Analyser — project guide

## Adding a new file type

**`assets/js/core/formats.js` is the single source of truth for supported file
types.** The format overlay (index.html), the "All supported file types" tables
(about.html), the overlay search, and the `classifyFile()` routing in app.js are
all driven from it — edit one file and they all update.

### 1. The catalog (formats.js) — almost always the only file you touch
File: `assets/js/core/formats.js`

- **Routing**: add the lowercase extension to the right classification set —
  `PHOTO_EXTS`, `AUDIO_EXTS`, `VIDEO_EXTS`, `CSV_EXTS`, or `SVG_EXTS`. These drive
  `classifyFile()` in app.js.
- **Display + search**: add (or extend) a row in `FULL_ANALYSIS` (deep analysis)
  or `IDENTIFICATION` (identification-only). Each row is
  `{ label, exts, tags, desc }`:
  - `exts` — space-separated extension list (curated casing) shown in the tables.
  - `tags` — extra search keywords: software/brand names and synonyms so a user
    can find SLDPRT by typing "solidworks". This is what makes the overlay search
    by origin work.
  - `desc` — one keyword-rich sentence shown under the ext list on the about page.
    This is the indexable SEO text for "how to open a .X file"-type searches, so
    name the key software/brands and what Analyser does with the format. The about
    page also gives each row a `#fmt-<slug>` anchor and each extension token an
    `#ext-<ext>` anchor (via renderAboutFormats) for deep-linking.
- **Photo conversion**: if it's a photo needing conversion, also add it to
  `HEIC_EXTS` (heic2any) or `RAW_EXTS` (ImageMagick WASM) in this same file.

That's it for the common cases (a new photo/audio/video extension, or a new
identification-only format that also needs a parser — see step 2).

### 2. Header parser for identification-only formats (proprietary.js)
File: `assets/js/renderers/proprietary.js`

- Add an entry to the `FORMATS` object: key is the lowercase extension, value is
  `{ app, icon, magic?, parse?, zip? }`. `magic` matches header bytes; `parse`
  is a hint (`'text'`/`'xml'`/`'html'`). Add a dedicated `parseXxx()` if the
  format has a header worth decoding (see `parsePsd`, `parseDwg`, etc.).
- `formats.js` holds the *catalog/display*; `proprietary.js` holds the *parsing
  logic*. A purely identification-only format that just needs to be listed can
  live in `formats.js` alone, but to extract metadata it needs a `FORMATS` entry
  here too.

### 3. New top-level category (rare)
If the format isn't photo/audio/video/csv/svg and needs its own renderer:
- Create a module (e.g. `assets/js/renderers/newtype.js`), export
  `renderNewtype(file, resultsEl)`.
- Import it in app.js and add a branch in `classifyFile()` and `handleFile()`.
  See how `csv`, `svg`, `pdf`, `zip`, `proprietary` are wired.
- Add the new module to the `SHELL` array in `sw.js` for offline caching.

### 4. Optional polish (only if the format is common)
- **Dropzone hints** (`index.html`, quickdrop section): the three dropzones list
  example extensions. Update only if the format is worth calling out.
- **Patch notes** (`about.html`, section `id="when"`): on commit, add a new entry
  at the top (version + date/time from `git log --format="%ai"` + short note).
  Move the 4th-from-top entry into the `<details class="about-formats">` dropdown
  (only the 3 latest stay visible).

## Version numbering

Every commit is its own version. The number after the dot is the commit's
1-based position **within its major era**, zero-padded to two digits: `0.01`,
`0.02`, … `0.09`, `0.10`, `0.11`. A commit listed in `RELEASE_COMMITS` (in
`app.js`) bumps the major version and resets the counter, so that commit shows as
`1.0` and the commit right after it is `1.01`.

- `COMMIT_COUNT` in `app.js` is the current commit number, bumped automatically by
  `save.bat` on each commit. Don't change it manually.
- `RELEASE_COMMITS` in `app.js` is the sorted list of commit numbers crowned as
  major releases. It is currently `[29]` (commit 29 = `1.0`). To crown a future
  `2.0`, append that commit's number. The display logic lives in
  `analyserVersion()` in `app.js`.
- `save.bat` mirrors this with a `RELEASE=29` constant (used only to echo the
  version it's bumping to). **Keep `RELEASE` in sync with `RELEASE_COMMITS`** — if
  you ever crown a second release, save.bat's single-`RELEASE` echo will need
  extending, but the real source of truth is `analyserVersion()`.

History note: the scheme was reset on 3 June 2026 — every commit was re-derived
into this 0.NN / 1.0 / 1.NN sequence (commit 29, the "Checkpoint" mega-update with
Excel/EPUB/PPTX/STL viewers and full offline support, was chosen as `1.0`). The
patch notes in `about.html` (`id="when"`) were rewritten to one entry per commit.

## SPA navigation

Pages use `assets/js/core/navigate.js` for View Transitions API-based SPA navigation. When the page swaps:
- `boot()` in `app.js` re-runs (triggered by `anr:navigate` event).
- One-time setup (window listeners, letter hover effect) is guarded by `boot._once`.
- Per-navigation setup (scroll-spy, anchors, dark mode, search) runs every time.

If you add new window-level event listeners, put them inside the `if (!boot._once)` guard to prevent duplicates.

## File structure

```
index.html          — main page
about.html          — about/info page
sw.js               — service worker
save.bat            — git add + commit + push with version bump
assets/
  css/
    analyser.css    — all styles
    fonts.css       — @font-face declarations (url(../fonts/...))
  fonts/            — Geist woff2 files
  img/              — banner, favicons, app icons
  vendor/           — third-party libraries (exifr, ffmpeg, imagemagick, ...)
  js/
    core/
      app.js        — entry point, file classification, boot()
      formats.js    — central format catalog (sets + display tables + renderers)
      search.js     — metadata search
      navigate.js   — SPA router (View Transitions API)
      util.js       — shared DOM helpers and formatters
      binutil.js    — shared binary toolkit (cursor reader, decoders, magic)
    renderers/      — one module per top-level type:
      photo.js      — photo analysis (EXIF, histogram, OCR, etc.)
      audio.js / audio-analysis.js / audio-codec.js / audio-player.js
      video.js / video-avi.js / spectrogram.js
      pdf.js · archive.js · svg.js · csv.js · markdown.js · comic.js · geo.js
      docx.js · xlsx.js · epub.js · pptx.js · stl.js · zip.js · folder.js
      unknown.js    — hex dump and basic identification
      proprietary.js — 200+ format identification by magic bytes (lazy chunk dispatch)
    parsers/        — parsers-*.js, lazy per-domain metadata parser chunks
    lib/            — plist · cfbf · sqlite · *-loader (shared binary + WASM helpers)
```
