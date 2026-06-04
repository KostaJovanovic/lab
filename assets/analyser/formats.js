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
   1. Classification sets (lowercase, exhaustive) - drive routing logic.
   2. Display catalog (FULL_ANALYSIS / IDENTIFICATION) - curated, nicely-cased
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
        (e.g. append "JPE" to the Photo row). Done - overlay, about page, and
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
     label - category name (first column)
     exts  - space-separated extensions, curated casing (e.g. "WebP", "glTF")
     tags  - extra search keywords: brand/software names + synonyms
     note  - optional prose shown instead of the ext list on the about page
   ============================================================================ */

import { el } from './util.js';

// ---------- classification extension sets (logic) ----------
// Lowercase. These route a dropped file to the right renderer in app.js.

export const PHOTO_EXTS = new Set([
  'jpg','jpeg','jpe','jif','jfif','png','gif','webp','heic','heif','heics','heifs',
  'bmp','tif','tiff','avif','jxl','ico',
  'raw','arw','cr2','cr3','nef','dng','raf','rw2','orf','pef','sr2','srw','x3f',
  // THM = the JPEG thumbnail a camera writes next to each movie clip (Canon et al.)
  'thm'
]);

export const AUDIO_EXTS = new Set([
  'mp3','wav','wave','m4a','m4b','aac','flac','ogg','oga','opus',
  'aiff','aif','aifc','wma','weba','amr','ac3','dts','mka'
]);

export const VIDEO_EXTS = new Set([
  'mp4','m4v','mov','avi','mkv','webm','wmv','flv',
  '3gp','3g2','mpg','mpeg','mts','m2ts','ts','vob','ogv'
]);

export const CSV_EXTS = new Set(['csv', 'tsv']);
export const SVG_EXTS = new Set(['svg']);

// Photo conversion subsets - used by photo.js to decide which images need
// HEIC-to-JPEG (heic2any) or RAW-to-PNG (ImageMagick WASM) conversion first.
export const HEIC_EXTS = new Set(['heic', 'heif', 'heics', 'heifs']);
export const RAW_EXTS  = new Set(['arw', 'cr2', 'cr3', 'nef', 'dng', 'raf', 'rw2', 'orf', 'pef', 'sr2', 'srw', 'x3f', 'raw']);

// Document and archive sets - used by folder/archive shared module for
// category classification in treemaps and breakdowns.
export const DOC_EXTS = new Set([
  'pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','csv','json',
  'xml','html','css','js','ts','tsx','jsx','yaml','yml','toml','ini',
  'rtf','odt','ods','odp','epub','log','sql','sh','bat','py','rb','java',
  'c','h','cpp','rs','go'
]);
export const ARCHIVE_EXTS = new Set([
  'zip','rar','7z','tar','gz','bz2','xz','zst','tgz'
]);

// ---------- display catalog (overlay + about page) ----------
// Each row: { label, exts, tags, note? }
//   label - category name shown in the first column
//   exts  - space-separated extension list (curated casing) for display/search
//   tags  - extra search keywords (software/brand names, synonyms)
//   note  - optional prose shown instead of the ext list on the about page
//           (used where a plain extension list undersells what we do, e.g. PDF)

export const FULL_ANALYSIS = [
  { label: 'Photo',     exts: 'JPG JPEG JIF JFIF PNG GIF WebP HEIC HEIF BMP TIFF AVIF JXL ICO RAW ARW CR2 CR3 NEF DNG RAF RW2 ORF PEF SR2 SRW X3F THM', tags: 'image picture camera photograph sony nikon canon fuji olympus pentax sigma samsung apple google pixel thm thumbnail movie video clip preview ixus powershot', desc: 'View EXIF, GPS, camera settings, histograms, OCR text, and AI-generation markers in JPG, PNG, HEIC, WebP, TIFF, and RAW photos from Sony, Nikon, Canon, Fujifilm, and more. Also opens THM movie-thumbnail files - the small JPEG preview a camera saves next to each video clip.' },
  { label: 'Sound',     exts: 'MP3 WAV M4A M4B AAC FLAC OGG OPUS AIFF WMA AMR AC3 DTS MKA', tags: 'audio music podcast recording microphone audiobook', desc: 'Inspect the waveform, spectrogram, codec, bitrate, channels, and tags of MP3, WAV, FLAC, M4A, AAC, OGG, and Opus audio.' },
  { label: 'Video',     exts: 'MP4 MOV AVI MKV WebM WMV FLV 3GP 3G2 MPG MPEG MTS M2TS TS VOB OGV', tags: 'movie film clip recording screen', desc: 'Read the container, codec, resolution, and frame rate of MP4, MOV, MKV, AVI, and WebM video, step through frames, and extract the audio track.' },
  { label: 'PDF',       exts: 'PDF', tags: 'adobe acrobat document', desc: 'View pages, extract text and embedded images, run OCR, and read the metadata of PDF documents.' },
  { label: 'Office docs', exts: 'DOCX XLSX PPTX EPUB', tags: 'microsoft word excel powerpoint slides spreadsheet ebook epub viewer reader', desc: 'Open and read Microsoft Word (DOCX), Excel (XLSX), and PowerPoint (PPTX), plus EPUB e-books - text, tables, slides, and chapters.' },
  { label: '3D model',  exts: 'STL', tags: 'stl 3d model mesh print cad solidworks triangle viewer webgl', desc: 'View STL models in an interactive WebGL viewer with triangle count, surface area, and volume.' },
  { label: 'Archives',  exts: 'ZIP', tags: 'compressed zip', desc: 'Browse the file tree and compression details of ZIP archives without extracting them.' },
  { label: 'Data',      exts: 'CSV TSV SVG', tags: 'spreadsheet vector markup data table', desc: 'Preview CSV and TSV tables with per-column stats, and view or rasterise SVG vector graphics.' },
  { label: 'Lyrics',    exts: 'LRC', tags: 'lyrics synced timed karaoke song subtitle text', desc: 'Parse .lrc timed-lyric files: read the artist/title/album ID tags and every timestamped line.' },
  { label: 'Subtitles', exts: 'SRT VTT ASS SSA', tags: 'subtitle caption closed captions srt webvtt substation alpha timed text cues', desc: 'Parse subtitle cues and timing from SubRip (SRT), WebVTT, and ASS/SSA: cue count, on-screen time, and a full timed cue list.' },
  { label: 'MIDI',      exts: 'MID MIDI', tags: 'midi music score sequencer general gm synthesizer notes tempo instruments', desc: 'Parse Standard MIDI Files: format, tempo (BPM), time signature, General MIDI instruments, track names, note counts, and duration.' },
  { label: 'Map data',  exts: 'GPX KML GeoJSON', tags: 'gps track waypoint route geojson kml google earth strava garmin map coordinates location gis', desc: 'Parse GPX tracks, KML placemarks, and GeoJSON features - counts, distance, elevation, time span, and bounds - plotted on an OpenStreetMap map.' },
  { label: 'Web / code', exts: 'HTML CSS JS TS TSX JSX JSON YAML XML MD', tags: 'programming development website react typescript javascript node', desc: 'Preview and inspect HTML, CSS, JavaScript, TypeScript, JSON, YAML, XML, and Markdown source files.' },
];

export const IDENTIFICATION = [
  { label: 'Documents',       exts: 'DOC XLS PPT PPSX ODT ODS ODP ODG RTF Pages Numbers Keynote', tags: 'microsoft office word excel powerpoint apple iwork libreoffice openoffice google docs sheets slides rich text format wordpad', desc: 'Identify and read metadata from legacy and open-document files: Microsoft Word, Excel, and PowerPoint (DOC, XLS, PPT), Apple iWork (Pages, Numbers, Keynote), LibreOffice/OpenOffice (ODT, ODS, ODP), and RTF.' },
  { label: 'Adobe',           exts: 'PSD PSB AI INDD INDT IDML AEP AEPX AET PRPROJ MOGRT SESX XD FLA SWF XMP LRtemplate LRcat ACV ACO ASL ABR GRD PAT', tags: 'photoshop illustrator indesign after effects premiere pro audition xd animate flash lightroom substance', desc: 'Identify Adobe project files and read their metadata: Photoshop (PSD, PSB), Illustrator (AI), InDesign (INDD), After Effects (AEP, AEPX), Premiere Pro (PRPROJ), XD, Animate (FLA), and Lightroom.' },
  { label: 'Design',          exts: 'FIG Sketch afphoto afdesign afpub Procreate XCF KRA PDN SPP SBSAR SBS', tags: 'figma sketch affinity photo designer publisher procreate gimp krita paint.net substance painter', desc: 'Identify design-app files: Figma (FIG), Sketch, Affinity Photo/Designer/Publisher, Procreate, GIMP (XCF), Krita (KRA), Paint.NET, and Substance.' },
  { label: 'CAD',             exts: 'DWG DXF DWT SLDPRT SLDASM SLDDRW F3D F3Z IPT IAM IDW 3DM SKP 3DS MAX C4D HIP ZPR ZTL MA MB CATPART CATPRODUCT PRT ASM BRD SCH KiCad_pcb GH GHX', tags: 'autocad autodesk solidworks fusion 360 inventor rhinoceros rhino grasshopper sketchup trimble 3ds max cinema 4d maxon houdini sidefx zbrush pixologic maya catia dassault eagle kicad electronic pcb', desc: 'Identify CAD files and read header metadata: AutoCAD (DWG, DXF), SolidWorks (SLDPRT, SLDASM), Fusion 360 (F3D), Inventor (IPT, IAM), Rhino (3DM) and Grasshopper (GH, GHX), SketchUp (SKP), 3ds Max, Cinema 4D, Houdini, ZBrush, Maya, CATIA, Eagle, and KiCad.' },
  { label: 'CAD exchange',    exts: 'STEP STP IGES IGS SAT X_T X_B', tags: 'parasolid acis exchange neutral format', desc: 'Identify neutral CAD exchange formats: STEP, IGES, Parasolid (X_T, X_B), and ACIS (SAT).' },
  { label: '3D / printing',   exts: 'OBJ FBX glTF GLB PLY USDZ USD USDA 3MF AMF BLEND', tags: 'blender mesh model 3d printing prusa bambu cura slicer wavefront autodesk pixar apple unity unreal stl', desc: 'Identify 3D and 3D-printing files: Wavefront OBJ, FBX, glTF/GLB, PLY, USD/USDZ, 3MF, AMF, and Blender (BLEND).' },
  { label: 'Archives',        exts: 'RAR 7Z TAR GZ BZ2 XZ ZST TGZ', tags: 'winrar 7zip compressed archive tar gzip bzip zstandard', desc: 'Identify and read metadata from RAR, 7z, TAR, GZip, BZip2, XZ, and Zstandard archives.' },
  { label: 'Fonts',           exts: 'TTF OTF WOFF WOFF2 TTC', tags: 'font typeface typography truetype opentype web woff', desc: 'Preview fonts and read their metadata: TrueType (TTF), OpenType (OTF), web fonts (WOFF, WOFF2), and collections (TTC), with variable-axis animation.' },
  { label: 'eBooks',          exts: 'MOBI AZW AZW3 FB2 DJVU', tags: 'ebook kindle amazon reader kobo calibre', desc: 'Identify e-book files: Kindle (MOBI, AZW, AZW3), FictionBook (FB2), and DjVu.' },
  { label: 'Subtitles (other)', exts: 'SUB', tags: 'subtitle caption microdvd subviewer', desc: 'Identify MicroDVD/SubViewer (SUB) subtitle files. SRT, VTT, and ASS/SSA get full cue parsing (see above).' },
  { label: 'Music production', exts: 'ALS ALP FLP RPP LOGIC LOGICX PTX CPR BAND', tags: 'ableton fl studio fruity loops reaper logic pro tools cubase garageband steinberg daw', desc: 'Identify DAW project files and read version, tempo, and plugin data: Ableton Live (ALS), FL Studio (FLP), Reaper (RPP), Logic Pro, Pro Tools (PTX), and Cubase (CPR).' },
  { label: 'Databases',       exts: 'SQLite DB MDB ACCDB', tags: 'sqlite microsoft access database sql', desc: 'Identify and read metadata from SQLite, Microsoft Access (MDB, ACCDB), and other databases.' },
  { label: 'GIS / mapping',   exts: 'SHP KMZ', tags: 'geographic gis mapping google earth shapefile esri kmz', desc: 'Identify geographic files: Shapefile (SHP) and zipped Google Earth (KMZ). GPX, KML, and GeoJSON get full parsing + a map (see above).' },
  { label: 'Disk images',     exts: 'ISO IMG VHD VHDX VMDK QCOW2 VDI', tags: 'virtual machine disk image hyper-v vmware virtualbox qemu boot partition table mbr gpt fat16 fat32 ntfs exfat volume sd card usb raw dd clone', desc: 'Identify disk and virtual-machine images: ISO, VHD/VHDX (Hyper-V), VMDK (VMware), QCOW2 (QEMU), and VDI (VirtualBox). For raw IMG images it decodes the partition table (MBR/GPT) and the first volume\'s filesystem - FAT16/32, NTFS, exFAT - with label, cluster size, and volume size.' },
  { label: 'Recordings',      exts: 'REC', tags: 'pvr dvr recording video mpeg transport stream topfield humax camera cctv getdataback reclaime recovery session', desc: 'Identify REC files, telling apart PVR/DVR video recordings (MPEG-TS / MPEG program stream) from data-recovery session files (GetDataBack, ReclaiMe) and reading their details.' },
  { label: 'Game engines',    exts: 'UNITYPACKAGE UASSET UMAP GODOT TSCN TRES', tags: 'unity unreal godot game development asset', desc: 'Identify game-engine assets: Unity (UNITYPACKAGE), Unreal Engine (UASSET, UMAP), and Godot (TSCN, TRES).' },
  { label: 'Game saves',      exts: 'BEPIS', tags: 'ultrakill save game progress slot bepis hakita', desc: 'Identify game save files, including ULTRAKILL saves (BEPIS), and read their stored progress.' },
  { label: 'Valve / Steam',   exts: 'VDF ACF', tags: 'valve steam keyvalues kv source engine appmanifest libraryfolders loginusers config app manifest', desc: 'Parse Valve KeyValues files (VDF) and Steam app manifests (ACF) - appmanifest, libraryfolders, loginusers, and config - surfacing the App ID, name, install dir, size on disk, and the full key tree.' },
  { label: 'Config',          exts: 'TOML INI ENV CONF CFG PROPERTIES', tags: 'configuration settings dotenv toml ini', desc: 'Identify configuration files: TOML, INI, .env, CONF, CFG, and Java properties.' },
  { label: 'Executables',     exts: 'EXE DLL MSI APK IPA DMG AppImage', tags: 'windows android apple mac macos linux program application installer package', desc: 'Identify and read metadata from programs and installers: Windows (EXE, DLL, MSI), Android (APK), iOS (IPA), macOS (DMG), and Linux (AppImage).' },
  { label: 'Video editing',   exts: 'DRP', tags: 'davinci resolve blackmagic', desc: 'Identify DaVinci Resolve (DRP) project files from Blackmagic Design.' },
  { label: 'CNC / 3D print',  exts: 'GCODE GCO NC NGC TAP CNC', tags: 'gcode cnc 3d printing slicer prusa cura bambu orca simplify3d slic3r mill router lathe laser plasma fusion 360 mastercam grbl fanuc haas vectric carbide lightburn spindle tool', desc: 'Analyse G-code for 3D printers and CNC machines - detect the slicer or CAM tool, machine and controller, toolpath, and print or cut dimensions (Prusa, Bambu, Cura, Fusion 360, Mastercam, GRBL, Fanuc, Haas).' },
  { label: 'Surround audio',  exts: 'EC3 EAC3 TrueHD THD MLP Atmos', tags: 'dolby digital plus eac3 truehd atmos surround 5.1 7.1 meridian lossless object audio home theatre', desc: 'Identify Dolby surround codecs - Digital Plus (E-AC-3), TrueHD, MLP, and Atmos - with channel-layout detection (5.1, 7.1).' },
  { label: 'Certificates',    exts: 'CRT CER PEM DER', tags: 'x509 certificate ssl tls https security openssl public key private rsa ec', desc: 'Identify and decode X.509 security certificates (CRT, CER, PEM, DER) - subject, issuer, validity dates, and key details.' },
  { label: 'Engineering',     exts: 'CDP', tags: 'cdp4 comet data platform esa engineering systems concurrent design', desc: 'Identify CDP4 (COMET) concurrent-design engineering files from the ESA systems-engineering toolset.' },
  { label: 'Logs',            exts: 'LOG', tags: 'log file server apache nginx syslog error debug', desc: 'Identify log files and their origin - Apache, Nginx, syslog, Python, Java/Log4j, and Android logcat.' },
  { label: 'Camera catalog',  exts: 'CTG', tags: 'canon dcim catalog index database camera memory card ixus powershot thumbnail eos digital ic', desc: 'Identify and decode Canon camera catalog files (CTG) - the DCIM index a Canon camera keeps to track each folder: the catalogued folder path, folder number, recorded-shot count, and photo / movie / voice-memo entry counts. Holds no image data.' },
  { label: 'Shortcuts',       exts: 'LNK URL WEBLOC', tags: 'windows shortcut link lnk target arguments working directory internet shortcut url web macos webloc alias launcher pointer desktop', desc: 'Decode shortcut files: Windows shortcuts (LNK) - target path, arguments, working directory, icon, hotkey, window state, and target timestamp - plus internet shortcuts (URL) and macOS web shortcuts (WEBLOC), surfacing the URL or path they point to.' },
  { label: 'Other',           exts: 'TORRENT PART CRDOWNLOAD', tags: 'bittorrent peer to peer p2p download partial incomplete chrome firefox crdownload', desc: 'Identify BitTorrent files (TORRENT) and their file list, plus partial or incomplete downloads (PART, CRDOWNLOAD).' },
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
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const section = (title, rows) => {
    container.appendChild(el('p', { class: 'anr-readout-section' }, title));
    const table = el('table', { class: 'anr-readout about-readout' });
    for (const r of rows) {
      // Each extension token gets an id (e.g. #ext-sldprt) so a "how to open a
      // .sldprt file" link can deep-link straight to it; the row carries a
      // category id (e.g. #fmt-cad). `desc` is the indexable, keyword-rich line
      // that search engines match against.
      const extNodes = [];
      r.exts.split(/\s+/).forEach((t, i) => {
        if (i) extNodes.push(' ');
        extNodes.push(el('span', { class: 'about-ext', id: 'ext-' + t.toLowerCase() }, t));
      });
      const td = el('td', {}, [
        el('span', { class: 'about-exts' }, extNodes),
        r.desc ? el('span', { class: 'about-fmt-desc' }, r.desc) : null
      ]);
      table.appendChild(el('tr', { id: 'fmt-' + slug(r.label) }, [el('th', {}, r.label), td]));
    }
    container.appendChild(table);
  };
  section('Full analysis', FULL_ANALYSIS);
  section('Identification + basic metadata', IDENTIFICATION);
}
