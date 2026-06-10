# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Analyser — project guide

Analyser is a **zero-backend, browser-only forensic workbench**: drop a file and
it classifies and analyses it entirely on-device (File API + lazy-loaded WASM),
uploading nothing. It's vanilla HTML/CSS/ES-module JS — **no framework, no build
step, no `node_modules`, no tests**. Deployed as static assets to Cloudflare
(`lab.valjdakosta.com`) and installable as an offline PWA.

## Commands

There is no build, lint, or test pipeline — editing a file *is* the dev loop.

- **Run locally**: `server.bat` launches
  `serve.py` on port **3000** and opens a browser. Use this, not
  `python -m http.server`: `serve.py` mirrors production Cloudflare routing
  (clean URLs — `/about` serves `about.html`, `/about.html` 308-redirects to
  `/about` — plus the SPA fallback). A plain static server 404s `/about` and
  `/patch`, which is the usual "the about page is broken locally" cause.
  Binds `0.0.0.0`, so the printed Network URL works for phone testing on the
  same Wi-Fi.
- **Commit + version bump + push**: `save.bat` (menu) or `save.bat save`. This
  is the **only** correct way to commit — it bumps `COMMIT_COUNT` in `app.js`
  and the `VERSION` cache epoch in `sw.js`, computes the version label, then
  `git add . && git commit && git push origin main`. `save.bat commit` commits
  without pushing; `save.bat --force` force-pushes. Don't hand-edit
  `COMMIT_COUNT` or commit around this script.
- **Deploy**: pushing to `main` ships via Cloudflare (config in
  `wrangler.jsonc`). No manual deploy step.

## Site-content writing convention

All **user-facing text** (HTML pages, patch notes, format `desc` strings) is
intentionally **em-dash-free** and uses British spelling (colour, analyse,
visualise). Use a spaced hyphen " - " as the separator, never `—`. (This doc and
other internal `.md`/code comments aren't bound by it.)

## Adding a new file type

**`assets/js/core/formats.js` is the single source of truth for supported file
types.** The format overlay (index.html), the "All supported file types" tables
(about.html), the overlay search, and the `classifyFile()` routing in app.js are
all driven from it — edit one file and they all update.

### 1. The catalog (formats.js) — almost always the only file you touch
File: `assets/js/core/formats.js`

- **Routing**: add the lowercase extension to the right classification set —
  `PHOTO_EXTS`, `AUDIO_EXTS`, `VIDEO_EXTS`, `CSV_EXTS`, or `SVG_EXTS`. These drive
  `classifyFile()` in app.js. (Two further sets, `DOC_EXTS` and `ARCHIVE_EXTS`,
  don't route — they classify entries for the folder/archive treemap breakdowns.)
- **Display + search**: add (or extend) a row in `FULL_ANALYSIS` (deep analysis)
  or — for identification-only formats — `IDENTIFICATION_CORE` (well-known
  proprietary formats) / `IDENTIFICATION_EXTENDED` (the long-tail expansion, one
  row per parsers/ chunk domain). `IDENTIFICATION` is just the concatenation of
  the two. Each row is `{ label, exts, tags, desc, note? }`:
  - `exts` — space-separated extension list (curated casing) shown in the tables.
  - `tags` — extra search keywords: software/brand names and synonyms so a user
    can find SLDPRT by typing "solidworks". This is what makes the overlay search
    by origin work.
  - `desc` — one keyword-rich sentence shown under the ext list on the about page.
    This is the indexable SEO text for "how to open a .X file"-type searches, so
    name the key software/brands and what Analyser does with the format. The about
    page also gives each row a `#fmt-<slug>` anchor and each extension token an
    `#ext-<ext>` anchor (via renderAboutFormats) for deep-linking.
  - `note` (optional) — prose shown *instead of* the ext list on the about page,
    where a bare extension list undersells the feature (e.g. PDF).
- **Category mapping**: if you add a row with a **new `label`**, also map that
  label to one of the `CATEGORIES` keys in the `CAT_OF` object (same file) —
  the overlay/about list group rows by domain category, and unmapped labels
  fall back to 'system'.
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
- **Patch notes** (`patch.html`, section `id="when"` — the public changelog, a
  separate page from about.html): on every commit add one `<div class="patch-entry">`
  at the top (version, 1-3 word Title-Case codename, date/time from
  `git log -1 --format=%ai`, then `<ul class="patch-list">` of concrete changes),
  move what is now the 4th-from-top entry into the `<details class="about-formats">`
  "Older updates" block (exactly the latest 3 stay visible), and add a matching
  `<=3`-sentence one-liner to `PATCH_TLDR` in `app.js` keyed by the version number.
  An in-file HTML comment at the top of that section is the authoritative style
  guide (tags, naming, tone, hyperlink rules). The newest entry's version **must**
  equal the version computed by `analyserVersion()` in `app.js` — never let them
  drift.

## Generated SEO pages (`/formats` and `/formats/<ext>`)

Two sets of pages are **generated from the catalog** on every commit (by
`save.bat`, which runs the two Node scripts below — plus
`tools/stamp-counts.mjs`, see below — before `git add`). They are
the site's SEO surface for "what is a .X file" / "how to open a .X file"
searches. **Never hand-edit the generated regions/files — edit the source and
re-run the generator.** Preview locally with `server.bat` then visit `/formats`
or `/formats/<ext>`.

**Single source of truth:** `assets/js/core/formats.js`. It exports
`catalogGrouped()` (a DOM-free view of the catalog) which both generators read,
so the pages can never drift from the overlay / about list.

### 1. `/formats` — the hub (`formats.html`)
- Generated by **`tools/prerender-formats.mjs`** between the
  `<!-- FORMATS:START -->` / `<!-- FORMATS:END -->` markers, with the exact
  format count stamped between the `<!--FMTCOUNT-->` markers. Everything outside
  the markers (head, intro, the searchable popup, footer) is hand-authored.
- Lists **all** formats; each extension keeps its `#fmt-<slug>` / `#ext-<ext>`
  deep-link anchors. For full-analysis rows it also emits "Per-format guides"
  links into the row description, pointing at the `/formats/<ext>` pages.

### 2. `/formats/<ext>` — per-extension landing pages (`formats/*.html`)
- Generated by **`tools/prerender-format-pages.mjs`**, **one file per
  extension** — but only for extensions whose catalog row is **`depth: 'full'`**
  (a real viewer / deep analysis; "more than basic identification"). `depth` is
  not a field on the row — `catalogGrouped()` derives it from which array the
  row lives in: `FULL_ANALYSIS` → `'full'`, either `IDENTIFICATION_*` → `'id'`. The
  identification-only formats deliberately get no page. The `formats/` directory
  is wiped and rebuilt each run, so removing an extension removes its page.
- The hub file `formats.html` (served at `/formats`) and the `formats/`
  directory (serving `/formats/<ext>`) coexist deliberately — the server resolves
  `/formats` to the file (there is no `formats/index.html`).
- Per-extension copy lives in **`tools/format-page-content.mjs`** as
  `EXT_PAGES[<lowercase-ext>] = { name, blurb }` — the unique "what is a .X file"
  line that keeps the pages from being thin/duplicate (the catalog `desc` is
  shared by all siblings in a row, so it can't carry that uniqueness).
- The generator also writes **`sitemap-formats.xml`** (referenced from
  `robots.txt` alongside the main sitemap).

### 3. Static count stamping (`tools/stamp-counts.mjs`)
- Also run by `save.bat` on every commit. Bakes the live `formatCount()` into
  the static, crawler-only surfaces that can't run JS — the "N+ file types"
  numbers in `index.html`/`patch.html` meta+JSON-LD text and `manifest.json` —
  and refreshes the `<lastmod>` dates in `sitemap.xml`. Never hand-edit those
  numbers; they are overwritten on the next commit. (The in-app counts are
  filled at runtime from `formatCount()` via the `data-fmt-count` pass in
  app.js.)

### Upkeep checklist when you add/change a format
1. Edit the catalog in `formats.js` as usual (see "Adding a new file type").
   `/formats` updates automatically.
2. **If the new extension is `depth: 'full'`** (it gets a viewer / deep
   analysis), add a matching `EXT_PAGES` entry in
   `tools/format-page-content.mjs`. If you forget, the generator **prints a
   WARNING** listing every full-analysis extension missing copy (and uses a
   generic fallback line), so a `save.bat` run tells you what to fill in.
3. House style for `blurb`/`name`: British spelling, no em-dashes, one or two
   plain sentences (what it is + where it comes from).
4. Gotchas: `formats/*.html` use **root-absolute** asset/nav paths (`/assets/…`,
   `/formats`) — correct for how the site is served (dev server + Cloudflare,
   both from root). They will NOT style/script when opened as a bare `file://`
   (and ES-module `app.js` can't load over `file://` anyway), so always preview
   via `server.bat`, not by double-clicking the file. `tools/` is in
   `.assetsignore` (dev-only, never served); `formats/` and `sitemap-formats.xml`
   **are** served. Don't add the per-format pages to `sw.js` `SHELL` (too many;
   they cache on visit).

## Version numbering

Every commit is its own version. The number after the dot is the commit's
1-based position **within its major era**, zero-padded to two digits: `0.01`,
`0.02`, … `0.09`, `0.10`, `0.11`. Each commit listed in `RELEASE_COMMITS` (in
`app.js`) bumps the major version and resets the counter, so that commit shows as
`X.0` and the commit right after it is `X.01`.

- `COMMIT_COUNT` in `app.js` is the current commit number, bumped automatically by
  `save.bat` on each commit. Don't change it manually.
- `RELEASE_COMMITS` in `app.js` is the sorted list of commit numbers crowned as
  major releases. It is currently `[29, 60]` (commit 29 = `1.0`, commit 60 =
  `2.0`). To crown a future `3.0`, append that commit's number. The display logic
  lives in `analyserVersion()` in `app.js`.
- `save.bat` mirrors this with a `RELEASES=29,60` constant (used only to echo the
  version it's bumping to). **Keep `RELEASES` in sync with `RELEASE_COMMITS`** —
  its PowerShell snippet now walks the full list exactly like `analyserVersion()`,
  so crowning another release is just appending the commit number in both places.

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
index.html          — main page (the drop/analyse app)
about.html          — about/info page (format tables, #ext-/#fmt- anchors)
patch.html          — public changelog (one .patch-entry per commit)
formats.html        — generated /formats hub (see Generated SEO pages)
formats/            — generated /formats/<ext> pages (wiped + rebuilt per commit)
tools/              — Node generator scripts (dev-only, in .assetsignore)
README.md           — public GitHub readme (visitor-facing overview; this
                      file is the real working guidance)
sw.js               — service worker (precache SHELL + cache epoch VERSION)
serve.py            — local dev server mirroring Cloudflare clean-URL routing
server.bat          — launch serve.py on :3000 (opens browser)
save.bat            — commit + version bump + push (the only way to commit)
wrangler.jsonc      — Cloudflare static-asset deploy config
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
      photo.js      — photo analysis (EXIF, histogram, OCR, etc.) (+ photo-convert.js)
      audio.js / audio-analysis.js / audio-codec.js / audio-player.js
      video.js / video-avi.js / spectrogram.js
      pdf.js · archive.js · svg.js · csv.js · markdown.js · comic.js · geo.js
      docx.js · xlsx.js · epub.js · pptx.js · zip.js · folder.js
      stl.js · model3d.js — 3D viewers (STL; OBJ/PLY/STEP/3MF and friends)
      timeline.js · midi.js · subtitles.js · lrc.js — EDL/FCPXML/OTIO, MIDI, SRT/VTT/ASS, lyrics
      treemap.js · folder-archive-shared.js — shared folder/ZIP breakdown visualisation
      unknown.js    — hex dump and basic identification
      proprietary.js — 200+ format identification by magic bytes (lazy chunk dispatch)
    parsers/        — parsers-<domain>.js, lazy metadata parser chunks dispatched
                      by proprietary.js (audio, video, image, raw, docs, dev,
                      archive, gaming, threed, geodata, sci, security, email,
                      disk, osmisc)
    lib/            — plist · cfbf · sqlite · *-loader (shared binary + WASM
                      loader helpers: libarchive, xz, occt, ghostscript, openjpeg)
```
