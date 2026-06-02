# Analyser — project guide

## Adding a new file type

When adding support for a new file format, update **all** of these locations:

### 1. Classification (app.js)
File: `assets/analyser/app.js`

- **Photo/Audio/Video**: Add the extension to `PHOTO_EXTS`, `AUDIO_EXTS`, or `VIDEO_EXTS` sets at the top of the file. These drive the `classifyFile()` function that routes dropped files to the correct renderer.
- **New category**: If the format doesn't fit photo/audio/video, add a new branch in `classifyFile()` and in the `handleFile()` switch (around line 160). See how `csv`, `svg`, `pdf`, `zip`, `proprietary` are handled.

### 2. Photo subtype sets (photo.js)
File: `assets/analyser/photo.js`

- `HEIC_EXTS` — extensions that need HEIC-to-JPEG conversion via heic2any before analysis.
- `RAW_EXTS` — extensions that need RAW-to-PNG conversion via ImageMagick WASM before analysis.
- If the new format is a photo that needs conversion, add it to the appropriate set.

### 3. Renderer (new formats)
- **Photo/Audio/Video**: The existing `renderPhoto`, `renderAudio`, `renderVideo` handle all files in their category. No new renderer needed unless the format needs special treatment.
- **Proprietary / identification-only**: Add an entry to the `FORMATS` object in `assets/analyser/proprietary.js`. Each key is a lowercase extension, each value is `{ name, category, magic?, parse? }`. The `magic` array matches header bytes; `parse(view, file)` extracts metadata rows.
- **Full analysis (new category)**: Create a new module (e.g. `assets/analyser/newtype.js`), export `renderNewtype(file, resultsEl)`, import it in `app.js`, and wire it into `handleFile()`.

### 4. About page (about.html)
File: `about.html`, section `id="what"`

- **Capabilities list** (`<dl class="about-caps">`): If the format adds new analysis capabilities, update or add a `<dt>`/`<dd>` entry.
- **Supported formats dropdown** (`<details class="about-formats">`): Add the extension to the correct table — "Full analysis" if it gets deep analysis, "Identification + basic metadata" if it's proprietary/identification-only.

### 5. Format help overlay (index.html)
File: `index.html`, inside `<div id="fmtOverlay">`

- Add the extension to the matching `<tr data-fmt>` row in the correct table.
- Update the `data-tags` attribute on that row if the format has a well-known origin/software name (e.g. `solidworks` for SLDPRT). This makes it searchable by software name.

### 6. Service worker (sw.js)
File: `sw.js`

- If you created a new JS module, add it to the `SHELL` array so it's cached for offline use.

### 7. Dropzone hints (index.html)
File: `index.html`, quickdrop section

- The first dropzone ("Drop a photo or video") lists key photo/video extensions as hints.
- The second dropzone ("Drop a sound") lists audio extensions.
- The third dropzone ("Drop any file") lists other categories.
- Only update these if the new format is common enough to be worth calling out.

### 8. Patch notes (about.html)
File: `about.html`, section `id="when"`

- When the change is committed, add a new patch entry at the top (before the current latest). See the HTML comment above the section for the format: version number, date/time from `git log --format="%ai"`, and a short description.
- Move the 4th-from-top entry into the `<details class="about-formats">` dropdown (only 3 latest are visible).

## Version numbering

Formula: `1.(commit_count - 17)`. The constant `COMMIT_COUNT` in `app.js` is updated automatically by `save.bat` on each commit. `VERSION_OFFSET` is 17. Don't change these manually.

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
