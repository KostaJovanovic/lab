<div align="center">

![Analyser](assets/img/banner.jpg)

# Analyser

### Drop a file. Find out everything. Upload nothing.

A small, local, **forensic workbench** for photos, sound, video, documents, archives, 3D models and 200+ other formats. Every byte is read and crunched **in your browser** - no servers, no accounts, no analytics, nothing ever leaves your machine.

[**Open the app →**](https://lab.valjdakosta.com/) &nbsp;·&nbsp; [Changelog](https://lab.valjdakosta.com/patch.html) &nbsp;·&nbsp; [About](https://lab.valjdakosta.com/about.html)

![status](https://img.shields.io/badge/status-alive-brightgreen?style=flat-square)
![privacy](https://img.shields.io/badge/data%20uploaded-0%20bytes-blue?style=flat-square)
![pwa](https://img.shields.io/badge/PWA-offline%20ready-9cf?style=flat-square)
![deps](https://img.shields.io/badge/framework-none-lightgrey?style=flat-square)

</div>

---

> [!NOTE]
> **This README is a placeholder.** It looks the part, but the full docs - architecture deep-dive, format-by-format coverage, contribution guide - are still being written. Poke around the source in the meantime; it is friendlier than it looks.

## What it does

Drag anything onto the page and Analyser figures out what it is, then tells you everything it can:

```
   your file ──▶  [ classify ]  ──▶  photo · audio · video · doc · archive · 3D · unknown
                                          │
                                          ▼
                                 read · decode · measure · visualise
                                          │
                                          ▼
                                 metadata · forensics · previews
```

- 📷 **Photos** - full EXIF / IPTC / XMP / ICC, GPS on a map, colour palette, histogram, sharpness, focus point, OCR in 32 languages, QR scan, LSB steganography planes, perceptual hash, and AI-generation markers.
- 🎵 **Audio** - waveform, real-time FFT spectrogram, loudness (LUFS), pitch, BPM, clipping, stereo vectorscope, embedded tags, lyrics and cover art (auto-analysed as a photo).
- 🎬 **Video** - container, codec, resolution, frame rate, automatic scene detection, frame stepping, contact sheets and audio extraction.
- 📄 **Documents** - viewers for PDF, Word, Excel, PowerPoint and EPUB, with text, tables, images and OCR.
- 🗺️ **Data & code** - CSV/TSV tables, SVG, MIDI scores, subtitles, GPX/KML/GeoJSON plotted on a map, and pretty-printed source.
- 📦 **Archives & 3D** - browse ZIPs and folders as a tree, inspect STL models in interactive WebGL.
- 🔍 **Everything else** - 200+ proprietary formats identified by magic bytes, with a hex dump and SHA-256 for anything unrecognised.

## Why it is different

| | |
|---|---|
| 🔒 **100% local** | Files are read with the File API and processed on-device. The network is never touched. |
| ✈️ **Offline-first** | Installable PWA. Cache the heavy tools once and it works on a plane. |
| 🪶 **No framework** | Vanilla ES modules, hand-written parsers, lazy-loaded everything. |
| ⚡ **Instant** | No upload round-trip - analysis starts the moment you drop. |

## Run it locally

```bash
git clone https://github.com/KostaJovanovic/lab.git
cd lab

# any static file server works - it is just HTML/CSS/JS
python -m http.server 8000
#   ...or...
npx serve .

# then open http://localhost:8000
```

No build step. No `node_modules`. No config.

## Under the hood

`HTML + CSS + vanilla JS (ES modules)` · service-worker caching · View Transitions SPA router · hand-rolled radix-2 FFT · a pile of lazy-loaded WASM (FFmpeg, ImageMagick, Tesseract, pdf.js) that only download when you actually need them.

```
assets/js/
  core/       app.js (entry + file classification), formats.js (catalog),
              util.js (helpers), search.js, navigate.js, binutil.js
  renderers/  photo · audio · video · pdf · archive · svg · csv · stl · ...
              the per-type renderers (+ proprietary.js, 200+ formats by magic bytes)
  parsers/    parsers-*.js   lazy per-domain metadata parser chunks
  lib/        plist · cfbf · sqlite · *-loader   shared binary + WASM helpers
assets/css/   analyser.css, fonts.css
assets/img/   banner, favicons, app icons
assets/vendor/  third-party libraries
```

## Status

🚧 Actively built, versioned per commit, shipped to [lab.valjdakosta.com](https://lab.valjdakosta.com/). Expect things to move fast and occasionally wobble.

---

<div align="center">

Made with too much curiosity by **[valjdakosta](https://valjdakosta.com/)**

<sub>Nothing here phones home. Promise.</sub>

</div>
