<div align="center">

<img src="assets/img/banner.jpg" alt="Analyser banner" width="640">

# Analyser

**A zero-backend forensic workbench for files, running entirely in your browser.**

Drop in any file and it is classified, parsed and visualised on your device. Nothing is uploaded, ever.

[**Open Analyser**](https://lab.valjdakosta.com) · [Supported formats](https://lab.valjdakosta.com/formats) · [About](https://lab.valjdakosta.com/about) · [Changelog](https://lab.valjdakosta.com/patch)

</div>

---

## Why

Most "file inspector" sites work by uploading your file to a server, which is exactly what you do not want for private photos, contracts, disk images or key files. Analyser takes the opposite approach: the page is static, there is no backend at all, and every byte of analysis happens in your browser through the File API and lazy-loaded WebAssembly. It works offline as an installable PWA, and you can verify the no-upload claim with the network tab open.

## What it can open

Analyser recognises **~1,000 file types**. The depth varies by format: photos, audio, video, documents, 3D models, archives, maps and databases get full viewers and deep analysis, while hundreds of proprietary formats are identified by magic bytes with their header metadata decoded. Anything still unknown gets a hex dump and best-effort identification.

The full, searchable list is at [lab.valjdakosta.com/formats](https://lab.valjdakosta.com/formats), with a guide page for every format that gets deep analysis.

## Privacy

- No uploads: files are read with the File API and never leave the device.
- No accounts, no tracking, no analytics.
- The website uses ZERO tracking cookies.
- Works fully offline once installed; the service worker precaches the app shell and keeps the WASM engines after first use.
- Private keys and secrets found inside files are flagged, not transmitted.

## Style

You have probably never seen a file analysis website this stylish. It follows a [swiss design](https://en.wikipedia.org/wiki/Swiss_Style_(design)) inspired layout, color palette, and fonts which i am very happy with. I made sure to sacrifice no functionality or readability for the sake of being cool, and hopefully succeeded in it, too.

## Under the hood

The site is plain HTML, CSS and ES-module JavaScript. No framework, no build step, no `node_modules`. Heavy lifting is done by WebAssembly engines and specialist libraries, loaded lazily only when a file actually needs them:

- **FFmpeg** for video remuxing, frame extraction and audio decoding
- **ImageMagick** for RAW photo conversion
- **pdf.js** and **Ghostscript** for PDF and PostScript
- **Tesseract** for OCR
- **OpenCASCADE** for STEP/IGES tessellation (fetched on first use, then cached for offline)
- **sql.js** for SQLite, **libarchive** and **xz** for archives, **OpenJPEG** for JPEG 2000
- **exifr**, **heic2any**, **jsQR**, **Leaflet**, **fflate** and friends

Most parsing, though, is hand-written: a couple of hundred binary header parsers organised into lazy per-domain chunks, so the initial page stays small.

Deployment is just static assets on Cloudflare; every push to `main` ships.

## Running locally

```
server.bat
```

This starts a local instance on localhost:3000 and opens it in a browser. It keeps 100% of the functionality since everything was built to be server-independant. The printed network URL also works for phone testing on the same Wi-Fi.

There is nothing to install and nothing to build; editing a file and refreshing is the whole dev loop.

## Project layout

- `index.html` - the drop-and-analyse app
- `assets/js/core/formats.js` - the single source of truth for every supported file type
- `assets/js/renderers/` - one module per top-level type (photo, audio, video, PDF, 3D, ...)
- `assets/js/parsers/` - lazy per-domain metadata parsers for the long tail of formats
- `assets/js/lib/` - shared binary helpers and WASM loaders
- `assets/vendor/` - third-party libraries, served locally so the app stays offline-capable
- `tools/` - Node scripts that pre-render the `/formats` SEO pages from the catalog
- `sw.js` - the service worker behind the offline support

## Versioning

Every commit is its own version (currently in the 2.x era), stamped automatically at commit time. The full history, one entry per commit, is on the [changelog](https://lab.valjdakosta.com/patch).

## Credits

The idea for this website was mine, originally made as a simple tool for generating spectrograms and reading a photo aspect ratio, that spiraled out of control pretty quickly. Many thanks to my parents, who encouraged me to continue by finding this cool, and to friends who tested this for me on platforms i do not possess or use frequently (linux arch and debian, MacOS). This project was made possible with Claude.
