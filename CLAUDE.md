# Analyser — project guide

## Adding a new file type

**`assets/analyser/formats.js` is the single source of truth for supported file
types.** The format overlay (index.html), the "All supported file types" tables
(about.html), the overlay search, and the `classifyFile()` routing in app.js are
all driven from it — edit one file and they all update.

### 1. The catalog (formats.js) — almost always the only file you touch
File: `assets/analyser/formats.js`

- **Routing**: add the lowercase extension to the right classification set —
  `PHOTO_EXTS`, `AUDIO_EXTS`, `VIDEO_EXTS`, `CSV_EXTS`, or `SVG_EXTS`. These drive
  `classifyFile()` in app.js.
- **Display + search**: add (or extend) a row in `FULL_ANALYSIS` (deep analysis)
  or `IDENTIFICATION` (identification-only). Each row is
  `{ label, exts, tags, note? }`:
  - `exts` — space-separated extension list (curated casing) shown in the tables.
  - `tags` — extra search keywords: software/brand names and synonyms so a user
    can find SLDPRT by typing "solidworks". This is what makes the overlay search
    by origin work.
  - `note` — optional prose shown instead of the ext list on the about page
    (e.g. PDF).
- **Photo conversion**: if it's a photo needing conversion, also add it to
  `HEIC_EXTS` (heic2any) or `RAW_EXTS` (ImageMagick WASM) in this same file.

That's it for the common cases (a new photo/audio/video extension, or a new
identification-only format that also needs a parser — see step 2).

### 2. Header parser for identification-only formats (proprietary.js)
File: `assets/analyser/proprietary.js`

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
- Create a module (e.g. `assets/analyser/newtype.js`), export
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

Formula: `1.(commit_count - 25)`. The constant `COMMIT_COUNT` in `app.js` is updated automatically by `save.bat` on each commit. `VERSION_OFFSET` is 25. Don't change these manually.

## SPA navigation

Pages use `assets/analyser/navigate.js` for View Transitions API-based SPA navigation. When the page swaps:
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
  analyser.css      — all styles
  analyser/
    app.js          — entry point, file classification, boot()
    formats.js      — central format catalog (sets + display tables + renderers)
    photo.js        — photo analysis (EXIF, histogram, OCR, etc.)
    audio.js        — audio analysis (waveform, spectrogram, player)
    audio-analysis.js — audio stats helpers
    audio-codec.js  — codec detection from file headers
    video.js        — video analysis (container, fps, frames, scene detection)
    spectrogram.js  — FFT and spectrogram rendering
    pdf.js          — PDF viewer and text extraction
    archive.js      — ZIP browser
    svg.js          — SVG viewer
    csv.js          — CSV/TSV table viewer
    unknown.js      — hex dump and basic identification
    proprietary.js  — 200+ format identification by magic bytes
    folder.js       — folder drop overview
    search.js       — metadata search
    navigate.js     — SPA router (View Transitions API)
    util.js         — shared DOM helpers and formatters
```
