/* Analyser - central format catalog
   ============================================================================
   SINGLE SOURCE OF TRUTH for which file types Analyser supports.

   Edit this file (and, for proprietary formats that need header parsing,
   proprietary.js) when adding a new file type. Everything else updates itself:
     - classifyFile() in app.js reads the *_EXTS sets below to route a drop
     - photo.js reads HEIC_EXTS / RAW_EXTS to decide on conversion
     - the format overlay on index.html is generated from FULL_ANALYSIS +
       IDENTIFICATION via renderFmtOverlay()
     - the "All supported file types" tables on about.html are generated from
       the same data via renderAboutFormats()
     - the overlay search box indexes the labels, extension lists, and tags

   Two kinds of data live here:
   1. Classification sets (lowercase, exhaustive) — drive routing logic.
   2. Display catalog (FULL_ANALYSIS / IDENTIFICATION) — curated, nicely-cased
      lists with search tags, shown in the overlay and about page.
   ----------------------------------------------------------------------------
   HOW TO ADD A FORMAT (read this before editing)

   Decide the kind first:
     • FULL ANALYSIS  = we open and analyse the bytes (photo, audio, video,
       csv, svg, pdf, zip, web/code). Routed to a real renderer.
     • IDENTIFICATION = we just name it and read header metadata (Adobe, CAD,
       fonts, etc.). Handled by proprietary.js.

   --- Case A: new extension for an EXISTING full-analysis category ---
   e.g. adding ".jpe" as another photo extension.
     1. Add 'jpe' to the matching set (PHOTO_EXTS here).
     2. Add the token to that category's `exts` string in FULL_ANALYSIS
        (e.g. append "JPE" to the Photo row). Done — overlay, about page, and
        search update on next load. No app.js change needed.
     • If it's a photo that needs decoding, also add it to HEIC_EXTS or
       RAW_EXTS so photo.js converts it first.

   --- Case B: new IDENTIFICATION-only format ---
   e.g. adding SketchUp ".skp".
     1. Add it to the right `IDENTIFICATION` row's `exts`, and add the software
        name to that row's `tags` so search-by-origin works (e.g. "sketchup").
        If no existing row fits, add a new { label, exts, tags } row.
     2. In proprietary.js, add a FORMATS entry: skp: { app, icon, magic?, parse? }.
        Add a parseXxx() if there's a header worth decoding.
     (Routing is automatic: classifyFile() falls back to isProprietaryExt().)

   --- Case C: brand-new full-analysis category with its own renderer ---
   Rare. See CLAUDE.md ("Adding a new file type" → step 3) for the app.js /
   sw.js wiring. The catalog part is still just a FULL_ANALYSIS row here.

   Field reference for a catalog row { label, exts, tags, note? }:
     label — category name (first column)
     exts  — space-separated extensions, curated casing (e.g. "WebP", "glTF")
     tags  — extra search keywords: brand/software names + synonyms
     note  — optional prose shown instead of the ext list on the about page
   ============================================================================ */

import { el } from './util.js';

// ---------- classification extension sets (logic) ----------
// Lowercase. These route a dropped file to the right renderer in app.js.

export const PHOTO_EXTS = new Set([
  'jpg','jpeg','jpe','jif','jfif','png','gif','webp','heic','heif','heics','heifs',
  'bmp','tif','tiff','avif','jxl','ico',
  'raw','arw','cr2','cr3','nef','dng','raf','rw2','orf','pef','sr2','srw','x3f'
]);

export const AUDIO_EXTS = new Set([
  'mp3','wav','wave','m4a','m4b','aac','flac','ogg','oga','opus',
  'aiff','aif','aifc','wma','weba','amr','ac3','dts','mka','mid','midi'
]);

export const VIDEO_EXTS = new Set([
  'mp4','m4v','mov','avi','mkv','webm','wmv','flv',
  '3gp','3g2','mpg','mpeg','mts','m2ts','ts','vob','ogv'
]);

export const CSV_EXTS = new Set(['csv', 'tsv']);
export const SVG_EXTS = new Set(['svg']);

// Photo conversion subsets — used by photo.js to decide which images need
// HEIC-to-JPEG (heic2any) or RAW-to-PNG (ImageMagick WASM) conversion first.
export const HEIC_EXTS = new Set(['heic', 'heif', 'heics', 'heifs']);
export const RAW_EXTS  = new Set(['arw', 'cr2', 'cr3', 'nef', 'dng', 'raf', 'rw2', 'orf', 'pef', 'sr2', 'srw', 'x3f', 'raw']);

// ---------- display catalog (overlay + about page) ----------
// Each row: { label, exts, tags, note? }
//   label — category name shown in the first column
//   exts  — space-separated extension list (curated casing) for display/search
//   tags  — extra search keywords (software/brand names, synonyms)
//   note  — optional prose shown instead of the ext list on the about page
//           (used where a plain extension list undersells what we do, e.g. PDF)

export const FULL_ANALYSIS = [
  { label: 'Photo',     exts: 'JPG JPEG JIF JFIF PNG GIF WebP HEIC HEIF BMP TIFF AVIF JXL ICO RAW ARW CR2 CR3 NEF DNG RAF RW2 ORF PEF SR2 SRW X3F', tags: 'image picture camera photograph sony nikon canon fuji olympus pentax sigma samsung apple google pixel' },
  { label: 'Sound',     exts: 'MP3 WAV M4A AAC FLAC OGG OPUS AIFF WMA AMR AC3 DTS MKA MIDI', tags: 'audio music podcast recording microphone' },
  { label: 'Video',     exts: 'MP4 MOV AVI MKV WebM WMV FLV 3GP MPG MPEG MTS M2TS TS VOB OGV', tags: 'movie film clip recording screen' },
  { label: 'PDF',       exts: 'PDF', tags: 'adobe acrobat document', note: 'Metadata, text extraction, page previews, OCR scanning' },
  { label: 'Archives',  exts: 'ZIP', tags: 'compressed zip' },
  { label: 'Data',      exts: 'CSV TSV SVG', tags: 'spreadsheet vector markup data table' },
  { label: 'Web / code', exts: 'HTML CSS JS TS TSX JSX JSON YAML XML MD', tags: 'programming development website react typescript javascript node' },
];

export const IDENTIFICATION = [
  { label: 'Documents',       exts: 'DOC DOCX XLS XLSX PPT PPTX PPSX ODT ODS ODP ODG Pages Numbers Keynote', tags: 'microsoft office word excel powerpoint apple iwork libreoffice openoffice google docs sheets slides' },
  { label: 'Adobe',           exts: 'PSD PSB AI INDD INDT IDML AEP AET PRPROJ MOGRT SESX XD FLA SWF XMP LRtemplate LRcat ACV ACO ASL ABR GRD PAT', tags: 'photoshop illustrator indesign after effects premiere pro audition xd animate flash lightroom substance' },
  { label: 'Design',          exts: 'FIG Sketch afphoto afdesign afpub Procreate XCF KRA PDN SPP SBSAR SBS', tags: 'figma sketch affinity photo designer publisher procreate gimp krita paint.net substance painter' },
  { label: 'CAD',             exts: 'DWG DXF DWT SLDPRT SLDASM SLDDRW F3D F3Z IPT IAM IDW 3DM SKP 3DS MAX C4D HIP ZPR ZTL MA MB CATPART CATPRODUCT PRT ASM BRD SCH KiCad', tags: 'autocad autodesk solidworks fusion 360 inventor rhinoceros rhino sketchup trimble 3ds max cinema 4d maxon houdini sidefx zbrush pixologic maya catia dassault eagle kicad electronic' },
  { label: 'CAD exchange',    exts: 'STEP STP IGES IGS SAT X_T X_B', tags: 'parasolid acis exchange neutral format' },
  { label: '3D / printing',   exts: 'STL OBJ FBX glTF GLB PLY USDZ USD USDA 3MF AMF BLEND', tags: 'blender mesh model 3d printing prusa bambu cura slicer wavefront autodesk pixar apple unity unreal' },
  { label: 'Archives',        exts: 'RAR 7Z TAR GZ BZ2 XZ ZST TGZ', tags: 'winrar 7zip compressed archive tar gzip bzip zstandard' },
  { label: 'Fonts',           exts: 'TTF OTF WOFF WOFF2 TTC', tags: 'font typeface typography truetype opentype web woff' },
  { label: 'eBooks',          exts: 'EPUB MOBI AZW AZW3 FB2 DJVU', tags: 'ebook kindle amazon reader kobo calibre' },
  { label: 'Subtitles',       exts: 'SRT VTT ASS SSA SUB', tags: 'subtitle caption closed captions srt webvtt' },
  { label: 'Music production', exts: 'ALS ALP FLP RPP LOGIC LOGICX PTX CPR BAND', tags: 'ableton fl studio fruity loops reaper logic pro tools cubase garageband steinberg daw' },
  { label: 'Databases',       exts: 'SQLite DB MDB ACCDB', tags: 'sqlite microsoft access database sql' },
  { label: 'GIS / mapping',   exts: 'SHP KML KMZ GPX GeoJSON', tags: 'geographic gis mapping google earth shapefile esri garmin strava' },
  { label: 'Disk images',     exts: 'ISO IMG VHD VHDX VMDK QCOW2 VDI', tags: 'virtual machine disk image hyper-v vmware virtualbox qemu boot' },
  { label: 'Game engines',    exts: 'UNITYPACKAGE UASSET UMAP GODOT TSCN TRES', tags: 'unity unreal godot game development asset' },
  { label: 'Config',          exts: 'TOML INI ENV CONF CFG PROPERTIES', tags: 'configuration settings dotenv toml ini' },
  { label: 'Executables',     exts: 'EXE DLL MSI APK IPA DMG AppImage', tags: 'windows android apple mac macos linux program application installer package' },
  { label: 'Video editing',   exts: 'DRP', tags: 'davinci resolve blackmagic' },
  { label: 'CNC / 3D print',  exts: 'GCODE GCO NC NGC', tags: 'gcode cnc 3d printing slicer prusa cura bambu orca simplify3d slic3r' },
  { label: 'Logs',            exts: 'LOG', tags: 'log file server apache nginx syslog error debug' },
  { label: 'Other',           exts: 'TORRENT', tags: 'bittorrent peer to peer p2p download' },
];

// ---------- renderers ----------

// Format help overlay on index.html. Generates section labels + searchable
// tables into the given container (#fmtBody). Rows carry data-fmt and data-tags
// so the search box in app.js can filter them.
export function renderFmtOverlay(container) {
  if (!container) return;
  container.innerHTML = '';
  const section = (title, rows) => {
    container.appendChild(el('p', { class: 'fmt-section-label' }, title));
    const table = el('table', { class: 'anr-readout fmt-table' });
    for (const r of rows) {
      table.appendChild(el('tr', { 'data-fmt': '', 'data-tags': r.tags || '' }, [
        el('th', {}, r.label),
        el('td', {}, r.exts)
      ]));
    }
    container.appendChild(table);
  };
  section('Full analysis', FULL_ANALYSIS);
  section('Identification + basic metadata', IDENTIFICATION);
}

// "All supported file types" tables on about.html. Same data, about-page
// styling. PDF-style rows with a `note` render the prose instead of the list.
export function renderAboutFormats(container) {
  if (!container) return;
  container.innerHTML = '';
  const section = (title, rows) => {
    container.appendChild(el('p', { class: 'anr-readout-section' }, title));
    const table = el('table', { class: 'anr-readout about-readout' });
    for (const r of rows) {
      const td = r.note
        ? el('td', {}, r.note)
        : el('td', {}, el('span', { class: 'about-exts' }, r.exts));
      table.appendChild(el('tr', {}, [el('th', {}, r.label), td]));
    }
    container.appendChild(table);
  };
  section('Full analysis', FULL_ANALYSIS);
  section('Identification + basic metadata', IDENTIFICATION);
}
