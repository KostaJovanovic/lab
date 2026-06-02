/* Analyser - proprietary file format identification
   Identifies Adobe, CAD, 3D, and other proprietary formats by extension
   and magic bytes. Extracts whatever metadata is accessible without
   full format parsers. */

import { el, row, fmtBytes, sha256Hex } from './util.js';

// ---------- format database ----------
const FORMATS = {
  // Adobe
  psd:     { app: 'Adobe Photoshop', icon: 'Ps', magic: [0x38, 0x42, 0x50, 0x53] },
  psb:     { app: 'Adobe Photoshop (Large)', icon: 'Ps' },
  ai:      { app: 'Adobe Illustrator', icon: 'Ai' },
  indd:    { app: 'Adobe InDesign', icon: 'Id' },
  indt:    { app: 'Adobe InDesign Template', icon: 'Id' },
  idml:    { app: 'Adobe InDesign (IDML)', icon: 'Id' },
  aep:     { app: 'Adobe After Effects', icon: 'Ae' },
  aet:     { app: 'Adobe After Effects Template', icon: 'Ae' },
  prproj:  { app: 'Adobe Premiere Pro', icon: 'Pr' },
  mogrt:   { app: 'Adobe Motion Graphics Template', icon: 'Ae' },
  sesx:    { app: 'Adobe Audition', icon: 'Au' },
  xd:      { app: 'Adobe XD', icon: 'Xd' },
  fla:     { app: 'Adobe Animate / Flash', icon: 'An' },
  swf:     { app: 'Adobe Flash (SWF)', icon: 'Fl', magic: [0x46, 0x57, 0x53] },
  afl:     { app: 'Adobe Flash', icon: 'Fl' },

  // Adobe sidecar / settings
  xmp:     { app: 'XMP Sidecar (Adobe metadata)', icon: 'XMP', parse: 'xml' },
  lrtemplate: { app: 'Adobe Lightroom Template', icon: 'Lr' },
  lrcat:   { app: 'Adobe Lightroom Catalog', icon: 'Lr' },
  acv:     { app: 'Adobe Photoshop Curves', icon: 'Ps' },
  aco:     { app: 'Adobe Photoshop Color Swatches', icon: 'Ps' },
  asl:     { app: 'Adobe Photoshop Styles', icon: 'Ps' },
  abr:     { app: 'Adobe Photoshop Brushes', icon: 'Ps' },
  grd:     { app: 'Adobe Photoshop Gradients', icon: 'Ps' },
  pat:     { app: 'Adobe Photoshop Patterns', icon: 'Ps' },

  // CAD - SolidWorks
  sldprt:  { app: 'SolidWorks Part', icon: 'SW' },
  sldasm:  { app: 'SolidWorks Assembly', icon: 'SW' },
  slddrw:  { app: 'SolidWorks Drawing', icon: 'SW' },

  // CAD - Fusion 360
  f3d:     { app: 'Autodesk Fusion 360', icon: 'F360' },
  f3z:     { app: 'Autodesk Fusion 360 Archive', icon: 'F360' },

  // CAD - AutoCAD
  dwg:     { app: 'AutoCAD Drawing', icon: 'DWG', magic: [0x41, 0x43] },
  dxf:     { app: 'AutoCAD DXF Exchange', icon: 'DXF' },
  dwt:     { app: 'AutoCAD Template', icon: 'DWG' },

  // CAD - Inventor
  ipt:     { app: 'Autodesk Inventor Part', icon: 'INV' },
  iam:     { app: 'Autodesk Inventor Assembly', icon: 'INV' },
  idw:     { app: 'Autodesk Inventor Drawing', icon: 'INV' },

  // CAD - Other
  '3dm':   { app: 'Rhinoceros 3D', icon: '3DM' },
  gh:      { app: 'Grasshopper (Rhino)', icon: 'GH' },
  ghx:     { app: 'Grasshopper XML (Rhino)', icon: 'GH' },
  skp:     { app: 'SketchUp', icon: 'SKP' },
  '3ds':   { app: 'Autodesk 3ds Max', icon: '3DS' },
  max:     { app: 'Autodesk 3ds Max Scene', icon: 'MAX' },
  ma:      { app: 'Autodesk Maya ASCII', icon: 'MA' },
  mb:      { app: 'Autodesk Maya Binary', icon: 'MA' },
  c4d:     { app: 'Maxon Cinema 4D', icon: 'C4D' },
  hip:     { app: 'SideFX Houdini', icon: 'HOU' },
  hipnc:   { app: 'SideFX Houdini Non-Commercial', icon: 'HOU' },
  zpr:     { app: 'Pixologic ZBrush', icon: 'ZB' },
  ztl:     { app: 'Pixologic ZBrush Tool', icon: 'ZB' },

  // CAD exchange
  step:    { app: 'STEP CAD Exchange', icon: 'STP' },
  stp:     { app: 'STEP CAD Exchange', icon: 'STP' },
  iges:    { app: 'IGES CAD Exchange', icon: 'IGS' },
  igs:     { app: 'IGES CAD Exchange', icon: 'IGS' },
  sat:     { app: 'ACIS SAT (3D geometry)', icon: 'SAT' },
  x_t:     { app: 'Parasolid Text', icon: 'XT' },
  x_b:     { app: 'Parasolid Binary', icon: 'XB' },

  // 3D mesh
  stl:     { app: 'STL (3D printing)', icon: 'STL' },
  obj:     { app: 'Wavefront OBJ', icon: 'OBJ' },
  fbx:     { app: 'Autodesk FBX', icon: 'FBX', magic: [0x4B, 0x61, 0x79, 0x64] },
  gltf:    { app: 'glTF 3D Scene', icon: 'GL' },
  glb:     { app: 'glTF Binary', icon: 'GL', magic: [0x67, 0x6C, 0x54, 0x46] },
  ply:     { app: 'PLY Point Cloud / Mesh', icon: 'PLY' },
  usdz:    { app: 'Universal Scene Description (Apple AR)', icon: 'USD' },
  usd:     { app: 'Universal Scene Description', icon: 'USD' },
  usda:    { app: 'Universal Scene Description ASCII', icon: 'USD' },

  // Blender
  blend:   { app: 'Blender', icon: 'BL', magic: [0x42, 0x4C, 0x45, 0x4E, 0x44, 0x45, 0x52] },

  // CATIA / Creo / NX
  catpart:    { app: 'CATIA Part', icon: 'CAT' },
  catproduct: { app: 'CATIA Product', icon: 'CAT' },
  cgr:        { app: 'CATIA Graphics', icon: 'CAT' },
  prt:        { app: 'Creo / Pro-E / NX Part', icon: 'PRT' },
  asm:        { app: 'Creo / Pro-E Assembly', icon: 'ASM' },

  // EDA / PCB
  brd:     { app: 'Eagle / Altium PCB', icon: 'PCB' },
  sch:     { app: 'Eagle / KiCad Schematic', icon: 'SCH' },
  kicad_pcb: { app: 'KiCad PCB', icon: 'KiC' },

  // Microsoft Office (binary)
  doc:     { app: 'Microsoft Word', icon: 'W' },
  xls:     { app: 'Microsoft Excel', icon: 'X' },
  ppt:     { app: 'Microsoft PowerPoint', icon: 'P' },

  // Microsoft Office (Open XML — ZIP-based)
  docx:    { app: 'Microsoft Word', icon: 'W', zip: true },
  xlsx:    { app: 'Microsoft Excel', icon: 'X', zip: true },
  pptx:    { app: 'Microsoft PowerPoint', icon: 'P', zip: true },

  // Apple
  pages:   { app: 'Apple Pages', icon: 'PG', zip: true },
  numbers: { app: 'Apple Numbers', icon: 'NM', zip: true },
  keynote: { app: 'Apple Keynote', icon: 'KN', zip: true },
  sketch:  { app: 'Sketch', icon: 'SK', zip: true },

  // 3D printing
  '3mf':   { app: '3D Manufacturing Format', icon: '3MF', zip: true },
  amf:     { app: 'Additive Manufacturing File', icon: 'AMF' },

  // Figma (local)
  fig:     { app: 'Figma', icon: 'FG' },

  // Substance
  spp:     { app: 'Adobe Substance Painter', icon: 'SP' },
  sbsar:   { app: 'Adobe Substance Archive', icon: 'SB' },
  sbs:     { app: 'Adobe Substance Designer', icon: 'SD' },

  // Paint.NET
  pdn:     { app: 'Paint.NET', icon: 'PDN' },

  // Microsoft Office (presentations)
  ppsx:    { app: 'Microsoft PowerPoint Show', icon: 'P', zip: true },

  // OpenDocument
  odt:     { app: 'OpenDocument Text (LibreOffice Writer)', icon: 'OD', zip: true },
  ods:     { app: 'OpenDocument Spreadsheet (LibreOffice Calc)', icon: 'OD', zip: true },
  odp:     { app: 'OpenDocument Presentation (LibreOffice Impress)', icon: 'OD', zip: true },
  odg:     { app: 'OpenDocument Graphics (LibreOffice Draw)', icon: 'OD', zip: true },

  // GIMP
  xcf:     { app: 'GIMP', icon: 'XCF' },

  // Affinity
  afphoto: { app: 'Affinity Photo', icon: 'AF' },
  afdesign:{ app: 'Affinity Designer', icon: 'AF' },
  afpub:   { app: 'Affinity Publisher', icon: 'AF' },

  // Procreate
  procreate: { app: 'Procreate', icon: 'PR', zip: true },

  // Krita
  kra:     { app: 'Krita', icon: 'KR', zip: true },

  // DaVinci Resolve
  drp:     { app: 'DaVinci Resolve Project', icon: 'DR' },

  // Music production
  als:     { app: 'Ableton Live Set', icon: 'ABL' },
  alp:     { app: 'Ableton Live Pack', icon: 'ABL' },
  flp:     { app: 'FL Studio Project', icon: 'FL', magic: [0x46, 0x4C, 0x68, 0x64] },
  rpp:     { app: 'Reaper Project', icon: 'RPP', parse: 'text' },
  'rpp-bak': { app: 'Reaper Project Backup', icon: 'RPP', parse: 'text' },
  logic:   { app: 'Logic Pro Project', icon: 'LGC' },
  logicx:  { app: 'Logic Pro X Project', icon: 'LGC' },
  ptx:     { app: 'Pro Tools Session', icon: 'PT' },
  cpr:     { app: 'Steinberg Cubase Project', icon: 'CUB' },
  band:    { app: 'GarageBand Project', icon: 'GB' },

  // Archives
  rar:     { app: 'RAR Archive', icon: 'RAR', magic: [0x52, 0x61, 0x72, 0x21] },
  '7z':    { app: '7-Zip Archive', icon: '7Z', magic: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] },
  tar:     { app: 'Tar Archive', icon: 'TAR' },
  gz:      { app: 'Gzip Archive', icon: 'GZ', magic: [0x1F, 0x8B] },
  bz2:     { app: 'Bzip2 Archive', icon: 'BZ2', magic: [0x42, 0x5A, 0x68] },
  xz:      { app: 'XZ Archive', icon: 'XZ', magic: [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00] },
  zst:     { app: 'Zstandard Archive', icon: 'ZST', magic: [0x28, 0xB5, 0x2F, 0xFD] },
  tgz:     { app: 'Gzipped Tar Archive', icon: 'TGZ', magic: [0x1F, 0x8B] },

  // Disk images
  iso:     { app: 'ISO Disk Image', icon: 'ISO' },
  img:     { app: 'Disk Image', icon: 'IMG' },
  vhd:     { app: 'Virtual Hard Disk (Hyper-V)', icon: 'VHD' },
  vhdx:    { app: 'Virtual Hard Disk v2 (Hyper-V)', icon: 'VHD' },
  vmdk:    { app: 'VMware Virtual Disk', icon: 'VMD' },
  qcow2:   { app: 'QEMU Copy-on-Write Disk', icon: 'QCW' },
  vdi:     { app: 'VirtualBox Disk Image', icon: 'VDI' },

  // Fonts
  ttf:     { app: 'TrueType Font', icon: 'TTF', magic: [0x00, 0x01, 0x00, 0x00] },
  otf:     { app: 'OpenType Font', icon: 'OTF', magic: [0x4F, 0x54, 0x54, 0x4F] },
  woff:    { app: 'Web Open Font Format', icon: 'WF', magic: [0x77, 0x4F, 0x46, 0x46] },
  woff2:   { app: 'Web Open Font Format 2', icon: 'WF2', magic: [0x77, 0x4F, 0x46, 0x32] },
  ttc:     { app: 'TrueType Font Collection', icon: 'TTC' },

  // eBooks
  epub:    { app: 'EPUB eBook', icon: 'EPB', zip: true },
  mobi:    { app: 'Kindle / Mobipocket eBook', icon: 'MOB' },
  azw3:    { app: 'Kindle Format 8 eBook', icon: 'AZW' },
  azw:     { app: 'Kindle eBook', icon: 'AZW' },
  fb2:     { app: 'FictionBook eBook', icon: 'FB2', parse: 'xml' },
  djvu:    { app: 'DjVu Document', icon: 'DJV' },

  // Subtitles
  srt:     { app: 'SubRip Subtitle', icon: 'SRT', parse: 'text' },
  vtt:     { app: 'WebVTT Subtitle', icon: 'VTT', parse: 'text' },
  ass:     { app: 'Advanced SubStation Alpha', icon: 'ASS', parse: 'text' },
  ssa:     { app: 'SubStation Alpha', icon: 'SSA', parse: 'text' },
  sub:     { app: 'MicroDVD / VobSub Subtitle', icon: 'SUB', parse: 'text' },

  // Database
  sqlite:  { app: 'SQLite Database', icon: 'SQL', magic: [0x53, 0x51, 0x4C, 0x69, 0x74, 0x65] },
  db:      { app: 'Database File', icon: 'DB' },
  mdb:     { app: 'Microsoft Access Database', icon: 'MDB' },
  accdb:   { app: 'Microsoft Access Database', icon: 'MDB' },

  // GIS / Mapping
  shp:     { app: 'ESRI Shapefile', icon: 'SHP' },
  kml:     { app: 'Keyhole Markup Language (Google Earth)', icon: 'KML', parse: 'xml' },
  kmz:     { app: 'KML Archive (Google Earth)', icon: 'KMZ', zip: true },
  gpx:     { app: 'GPS Exchange Format', icon: 'GPX', parse: 'xml' },
  geojson: { app: 'GeoJSON', icon: 'GEO', parse: 'text' },

  // Game engines
  unitypackage: { app: 'Unity Asset Package', icon: 'UNI' },
  uasset:  { app: 'Unreal Engine Asset', icon: 'UE' },
  umap:    { app: 'Unreal Engine Map', icon: 'UE' },
  godot:   { app: 'Godot Project', icon: 'GOD', parse: 'text' },
  tscn:    { app: 'Godot Scene', icon: 'GOD', parse: 'text' },
  tres:    { app: 'Godot Resource', icon: 'GOD', parse: 'text' },

  // Torrent
  torrent: { app: 'BitTorrent Metainfo', icon: 'TOR' },

  // CNC / 3D printing
  gcode:   { app: 'G-Code (CNC / 3D printing)', icon: 'GC', parse: 'text' },
  gco:     { app: 'G-Code (CNC / 3D printing)', icon: 'GC', parse: 'text' },
  nc:      { app: 'G-Code (CNC)', icon: 'NC', parse: 'text' },
  ngc:     { app: 'G-Code (CNC)', icon: 'NC', parse: 'text' },

  // Log files
  log:     { app: 'Log File', icon: 'LOG', parse: 'text' },

  // Config
  toml:    { app: 'TOML Config', icon: 'TML', parse: 'text' },
  ini:     { app: 'INI Config', icon: 'INI', parse: 'text' },
  env:     { app: 'Environment Variables', icon: 'ENV', parse: 'text' },
  conf:    { app: 'Configuration File', icon: 'CNF', parse: 'text' },
  cfg:     { app: 'Configuration File', icon: 'CFG', parse: 'text' },
  properties: { app: 'Java Properties', icon: 'PRP', parse: 'text' },

  // Executables
  exe:     { app: 'Windows Executable', icon: 'EXE', magic: [0x4D, 0x5A] },
  dll:     { app: 'Windows Dynamic Library', icon: 'DLL', magic: [0x4D, 0x5A] },
  msi:     { app: 'Windows Installer', icon: 'MSI' },
  apk:     { app: 'Android Application', icon: 'APK', zip: true },
  ipa:     { app: 'iOS Application', icon: 'IPA', zip: true },
  dmg:     { app: 'macOS Disk Image', icon: 'DMG' },
  appimage:{ app: 'Linux AppImage', icon: 'APP' },

  // Web
  html:    { app: 'HTML Document', icon: 'HTML', parse: 'html' },
  htm:     { app: 'HTML Document', icon: 'HTML', parse: 'html' },
  css:     { app: 'CSS Stylesheet', icon: 'CSS', parse: 'text' },
  js:      { app: 'JavaScript', icon: 'JS', parse: 'text' },
  mjs:     { app: 'JavaScript Module', icon: 'JS', parse: 'text' },
  ts:      { app: 'TypeScript', icon: 'TS', parse: 'text' },
  tsx:     { app: 'TypeScript JSX', icon: 'TSX', parse: 'text' },
  jsx:     { app: 'React JSX', icon: 'JSX', parse: 'text' },
  json:    { app: 'JSON', icon: 'JSON', parse: 'text' },
  yaml:    { app: 'YAML', icon: 'YML', parse: 'text' },
  yml:     { app: 'YAML', icon: 'YML', parse: 'text' },
  xml:     { app: 'XML Document', icon: 'XML', parse: 'xml' },
  md:      { app: 'Markdown', icon: 'MD', parse: 'text' },
  txt:     { app: 'Plain Text', icon: 'TXT', parse: 'text' },
};

// ---------- helpers ----------
function extFromName(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/^\./, '') : '';
}

function ascii(buf, start, len) {
  let s = '';
  for (let i = start; i < start + len && i < buf.length; i++) {
    const c = buf[i];
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s;
}

// ---------- PSD header ----------
function parsePsd(buf) {
  if (buf.length < 30) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = ascii(buf, 0, 4);
  if (sig !== '8BPS') return null;
  const version = view.getUint16(4);
  const channels = view.getUint16(12);
  const height = view.getUint32(14);
  const width = view.getUint32(18);
  const depth = view.getUint16(22);
  const modeMap = { 0: 'Bitmap', 1: 'Grayscale', 2: 'Indexed', 3: 'RGB', 4: 'CMYK', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab' };
  const mode = modeMap[view.getUint16(24)] || 'Unknown';
  return {
    'Version': version === 2 ? 'PSB (Large Document)' : 'PSD',
    'Dimensions': width + ' × ' + height,
    'Channels': channels,
    'Bit depth': depth + ' bits/channel',
    'Color mode': mode
  };
}

// ---------- DWG version ----------
function parseDwg(buf) {
  const ver = ascii(buf, 0, 6);
  const versions = {
    'AC1032': '2018–2024', 'AC1027': '2013–2017', 'AC1024': '2010–2012',
    'AC1021': '2007–2009', 'AC1018': '2004–2006', 'AC1015': '2000–2003',
    'AC1014': 'R14', 'AC1012': 'R13', 'AC1009': 'R11/R12'
  };
  const mapped = versions[ver];
  if (!mapped) return null;
  return { 'DWG version': ver, 'AutoCAD version': mapped };
}

// ---------- Blender header ----------
function parseBlender(buf) {
  const sig = ascii(buf, 0, 7);
  if (sig !== 'BLENDER') return null;
  const ptrSize = buf[7] === 0x5F ? '32-bit' : '64-bit';
  const endian = buf[8] === 0x56 ? 'Little-endian' : 'Big-endian';
  const version = ascii(buf, 9, 3);
  const major = version[0];
  const minor = version.slice(1);
  return {
    'Blender version': major + '.' + minor,
    'Pointer size': ptrSize,
    'Endianness': endian
  };
}

// ---------- FBX ----------
function parseFbx(buf) {
  const sig = ascii(buf, 0, 20);
  if (!sig.startsWith('Kaydara FBX Binary')) return null;
  if (buf.length < 27) return { 'Format': 'FBX Binary' };
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = view.getUint32(23, true);
  return {
    'Format': 'FBX Binary',
    'FBX version': (version / 1000).toFixed(1)
  };
}

// ---------- glTF / GLB ----------
function parseGlb(buf) {
  if (buf.length < 12) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546C67) return null;
  const version = view.getUint32(4, true);
  const totalLen = view.getUint32(8, true);
  return {
    'Format': 'glTF Binary (GLB)',
    'glTF version': version + '.0',
    'Total size': fmtBytes(totalLen)
  };
}

// ---------- STL ----------
function parseStl(buf) {
  const head = ascii(buf, 0, 5);
  if (head === 'solid') {
    const headerLine = ascii(buf, 0, Math.min(80, buf.length)).trim();
    const name = headerLine.slice(5).trim();
    return { 'Format': 'STL ASCII', 'Name': name || '(unnamed)' };
  }
  if (buf.length >= 84) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const triangles = view.getUint32(80, true);
    return { 'Format': 'STL Binary', 'Triangles': triangles.toLocaleString() };
  }
  return null;
}

// ---------- SWF ----------
function parseSwf(buf) {
  if (buf.length < 8) return null;
  const sig = String.fromCharCode(buf[0]) + 'WS';
  if (buf[1] !== 0x57 || buf[2] !== 0x53) return null;
  const compressed = buf[0] === 0x43 ? 'zlib' : buf[0] === 0x5A ? 'LZMA' : 'none';
  const version = buf[3];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fileLen = view.getUint32(4, true);
  return {
    'SWF version': version,
    'Compression': compressed,
    'Uncompressed size': fmtBytes(fileLen)
  };
}

// ---------- XMP sidecar (XML) ----------
async function parseXmp(file) {
  try {
    const text = await file.text();
    const fields = {};
    const tags = [
      ['xmp:CreatorTool', 'Creator tool'],
      ['xmp:CreateDate', 'Created'],
      ['xmp:ModifyDate', 'Modified'],
      ['xmp:MetadataDate', 'Metadata date'],
      ['dc:creator', 'Author'],
      ['dc:title', 'Title'],
      ['dc:description', 'Description'],
      ['dc:subject', 'Keywords'],
      ['photoshop:ColorMode', 'Color mode'],
      ['photoshop:ICCProfile', 'ICC profile'],
      ['tiff:Make', 'Camera make'],
      ['tiff:Model', 'Camera model'],
      ['exif:ExposureTime', 'Exposure'],
      ['exif:FNumber', 'Aperture'],
      ['exif:ISOSpeedRatings', 'ISO'],
      ['crs:Version', 'Camera Raw version'],
      ['crs:ProcessVersion', 'Process version'],
      ['crs:WhiteBalance', 'White balance'],
    ];
    for (const [tag, label] of tags) {
      const re = new RegExp('<' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^>]*>([^<]+)</', 'i');
      const m = text.match(re);
      if (m) fields[label] = m[1].trim();
    }
    // Also try rdf:li for lists
    for (const [tag, label] of tags) {
      if (fields[label]) continue;
      const blockRe = new RegExp('<' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?<\\/[^>]+>', 'i');
      const block = text.match(blockRe);
      if (block) {
        const items = [...block[0].matchAll(/<rdf:li[^>]*>([^<]+)<\/rdf:li>/gi)].map(m => m[1].trim());
        if (items.length) fields[label] = items.join(', ');
      }
    }
    return { fields, raw: text };
  } catch (_) {
    return null;
  }
}

// ---------- PE / EXE ----------
function parsePe(buf) {
  if (buf.length < 64 || buf[0] !== 0x4D || buf[1] !== 0x5A) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const peOffset = view.getUint32(0x3C, true);
  if (peOffset + 6 > buf.length) return { 'Format': 'MS-DOS / PE' };
  if (buf[peOffset] !== 0x50 || buf[peOffset + 1] !== 0x45) return { 'Format': 'MS-DOS executable' };
  const machine = view.getUint16(peOffset + 4, true);
  const machines = { 0x14C: 'x86 (32-bit)', 0x8664: 'x64 (64-bit)', 0xAA64: 'ARM64' };
  const arch = machines[machine] || '0x' + machine.toString(16);
  const sections = view.getUint16(peOffset + 6, true);
  const timestamp = view.getUint32(peOffset + 8, true);
  const date = timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 19).replace('T', ' ') : 'N/A';
  const optMagic = peOffset + 24 < buf.length ? view.getUint16(peOffset + 24, true) : 0;
  const peType = optMagic === 0x20B ? 'PE32+ (64-bit)' : optMagic === 0x10B ? 'PE32 (32-bit)' : 'PE';
  return {
    'Format': peType,
    'Architecture': arch,
    'Sections': sections,
    'Compile date': date
  };
}

// ---------- OLE compound doc (SolidWorks, old Office) ----------
function parseOle(buf) {
  if (buf.length < 512) return null;
  if (buf[0] !== 0xD0 || buf[1] !== 0xCF || buf[2] !== 0x11 || buf[3] !== 0xE0) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const minor = view.getUint16(24, true);
  const major = view.getUint16(26, true);
  return { 'OLE version': major + '.' + minor };
}

// ---------- Font (TTF / OTF) ----------
async function parseFont(file) {
  const size = Math.min(file.size, 65536);
  const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
  if (buf.length < 12) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint32(0);
  if (magic !== 0x00010000 && magic !== 0x4F54544F) return null;
  const numTables = view.getUint16(4);
  let nameOff = 0;
  for (let i = 0; i < numTables && 12 + i * 16 + 16 <= buf.length; i++) {
    if (ascii(buf, 12 + i * 16, 4) === 'name') {
      nameOff = view.getUint32(12 + i * 16 + 8);
      break;
    }
  }
  if (!nameOff || nameOff + 6 > buf.length) return null;
  const count = view.getUint16(nameOff + 2);
  const strOff = nameOff + view.getUint16(nameOff + 4);
  const wanted = { 1: 'Family', 2: 'Style', 4: 'Full name', 5: 'Version', 8: 'Manufacturer', 9: 'Designer' };
  const names = {};
  for (let i = 0; i < count && nameOff + 6 + i * 12 + 12 <= buf.length; i++) {
    const base = nameOff + 6 + i * 12;
    const pid = view.getUint16(base);
    const nid = view.getUint16(base + 6);
    const len = view.getUint16(base + 8);
    const off = view.getUint16(base + 10);
    const label = wanted[nid];
    if (!label || names[label]) continue;
    const s = strOff + off;
    if (s + len > buf.length) continue;
    let text;
    if (pid === 3 || pid === 0) {
      const codes = [];
      for (let j = 0; j < len - 1; j += 2) codes.push(view.getUint16(s + j));
      text = String.fromCharCode(...codes);
    } else {
      text = ascii(buf, s, len);
    }
    if (text.trim()) names[label] = text.trim();
  }
  return Object.keys(names).length ? names : null;
}

// ---------- FL Studio (.flp) ----------
function parseFlp(buf) {
  if (buf.length < 10) return null;
  const sig = ascii(buf, 0, 4);
  if (sig !== 'FLhd') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = view.getUint32(4, true);
  const format = view.getUint16(8, true);
  const channels = headerLen >= 10 && buf.length >= 12 ? view.getUint16(10, true) : null;
  return {
    'Format version': format,
    ...(channels != null ? { 'Channels': channels } : {})
  };
}

// ---------- RAR ----------
function parseRar(buf) {
  if (buf.length < 7) return null;
  const sig4 = ascii(buf, 0, 4);
  if (sig4 !== 'Rar!') return null;
  if (buf[4] === 0x1A && buf[5] === 0x07 && buf[6] === 0x01) return { 'RAR version': '5.x' };
  if (buf[4] === 0x1A && buf[5] === 0x07 && buf[6] === 0x00) return { 'RAR version': '4.x / earlier' };
  return { 'RAR version': 'unknown' };
}

// ---------- 7-Zip ----------
function parse7z(buf) {
  if (buf.length < 12) return null;
  if (buf[0] !== 0x37 || buf[1] !== 0x7A || buf[2] !== 0xBC || buf[3] !== 0xAF) return null;
  return { '7z version': buf[6] + '.' + buf[7] };
}

// ---------- SQLite ----------
function parseSqlite(buf) {
  if (buf.length < 100) return null;
  const sig = ascii(buf, 0, 15);
  if (sig !== 'SQLite format 3') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const pageSize = view.getUint16(16);
  const ps = pageSize === 1 ? 65536 : pageSize;
  const writeVer = buf[18];
  const readVer = buf[19];
  const journal = { 1: 'legacy', 2: 'WAL' };
  return {
    'Page size': ps.toLocaleString() + ' bytes',
    'Write format': journal[writeVer] || writeVer,
    'Read format': journal[readVer] || readVer,
    'SQLite version': view.getUint32(96) ? String(view.getUint32(96)) : undefined
  };
}

// ---------- GIMP XCF ----------
function parseXcf(buf) {
  const sig = ascii(buf, 0, 9);
  if (sig !== 'gimp xcf ') return null;
  const verStr = ascii(buf, 9, 5).replace(/\0/g, '');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = buf.length >= 18 ? view.getUint32(14) : null;
  const height = buf.length >= 22 ? view.getUint32(18) : null;
  const colorMode = buf.length >= 26 ? view.getUint32(22) : null;
  const modes = { 0: 'RGB', 1: 'Grayscale', 2: 'Indexed' };
  const result = { 'XCF version': verStr || 'v0 (original)' };
  if (width && height) result['Dimensions'] = width + ' × ' + height;
  if (colorMode != null) result['Color mode'] = modes[colorMode] || 'Unknown';
  return result;
}

// ---------- ISO 9660 ----------
function parseIso(buf) {
  if (buf.length < 100) return null;
  const id = ascii(buf, 1, 5);
  if (id === 'CD001') {
    return {
      'Format': 'ISO 9660',
      'System': ascii(buf, 8, 32).trim() || undefined,
      'Volume': ascii(buf, 40, 32).trim() || undefined
    };
  }
  return null;
}

// ---------- Adobe InDesign ----------
function parseIndd(buf) {
  if (buf.length < 16) return null;
  const sig = ascii(buf, 0, 16);
  if (!sig.startsWith('\x06\x06')) return null;
  return null;
}

// ---------- ZIP-based doc metadata (DOCX, XLSX, PPTX, EPUB, ODF) ----------
async function parseZipMeta(file, ext) {
  try {
    const size = Math.min(file.size, 131072);
    const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
    const view = new DataView(buf.buffer);
    if (buf[0] !== 0x50 || buf[1] !== 0x4B) return null;
    const entries = [];
    let pos = 0;
    while (pos + 30 < buf.length) {
      if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4B || buf[pos + 2] !== 0x03 || buf[pos + 3] !== 0x04) break;
      const method = view.getUint16(pos + 8, true);
      const compSize = view.getUint32(pos + 18, true);
      const uncompSize = view.getUint32(pos + 22, true);
      const nameLen = view.getUint16(pos + 26, true);
      const extraLen = view.getUint16(pos + 28, true);
      const name = ascii(buf, pos + 30, nameLen);
      const dataStart = pos + 30 + nameLen + extraLen;
      entries.push({ name, method, compSize, uncompSize, dataStart });
      pos = dataStart + compSize;
    }
    const readEntry = async (entry) => {
      const raw = buf.slice(entry.dataStart, entry.dataStart + entry.compSize);
      if (entry.method === 0) return new TextDecoder().decode(raw);
      if (entry.method === 8 && typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(raw);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return new TextDecoder().decode(out);
      }
      return null;
    };
    const fields = {};
    const coreEntry = entries.find(e => e.name === 'docProps/core.xml');
    if (coreEntry) {
      const xml = await readEntry(coreEntry);
      if (xml) {
        const grab = (tag) => { const m = xml.match(new RegExp('<(?:dc:|cp:)?' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
        const creator = grab('creator');
        const title = grab('title');
        const created = grab('created');
        const modified = grab('modified');
        const lastBy = grab('lastModifiedBy');
        const revision = grab('revision');
        if (creator) fields['Author'] = creator;
        if (title) fields['Title'] = title;
        if (lastBy) fields['Last modified by'] = lastBy;
        if (created) fields['Created'] = created;
        if (modified) fields['Modified'] = modified;
        if (revision) fields['Revision'] = revision;
      }
    }
    const appEntry = entries.find(e => e.name === 'docProps/app.xml');
    if (appEntry) {
      const xml = await readEntry(appEntry);
      if (xml) {
        const grab = (tag) => { const m = xml.match(new RegExp('<' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
        const app = grab('Application');
        const appVer = grab('AppVersion');
        const pages = grab('Pages');
        const words = grab('Words');
        const slides = grab('Slides');
        if (app) fields['Application'] = app + (appVer ? ' ' + appVer : '');
        if (pages) fields['Pages'] = pages;
        if (words) fields['Words'] = words;
        if (slides) fields['Slides'] = slides;
      }
    }
    // EPUB: META-INF/container.xml -> content.opf
    if (ext === 'epub') {
      const opfEntry = entries.find(e => e.name.endsWith('.opf'));
      if (opfEntry) {
        const xml = await readEntry(opfEntry);
        if (xml) {
          const grab = (tag) => { const m = xml.match(new RegExp('<dc:' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
          const title = grab('title');
          const creator = grab('creator');
          const publisher = grab('publisher');
          const lang = grab('language');
          const date = grab('date');
          if (title) fields['Title'] = title;
          if (creator) fields['Author'] = creator;
          if (publisher) fields['Publisher'] = publisher;
          if (lang) fields['Language'] = lang;
          if (date) fields['Date'] = date;
        }
      }
    }
    // ODF (ODT/ODS/ODP): meta.xml
    const metaEntry = entries.find(e => e.name === 'meta.xml');
    if (metaEntry) {
      const xml = await readEntry(metaEntry);
      if (xml) {
        const grab = (tag) => { const m = xml.match(new RegExp('<meta:' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
        const gen = grab('generator');
        const created = grab('creation-date');
        if (gen) fields['Generator'] = gen;
        if (created && !fields['Created']) fields['Created'] = created;
        const dcGrab = (tag) => { const m = xml.match(new RegExp('<dc:' + tag + '[^>]*>([^<]+)<')); return m ? m[1].trim() : null; };
        const title = dcGrab('title');
        const creator = dcGrab('creator');
        if (title && !fields['Title']) fields['Title'] = title;
        if (creator && !fields['Author']) fields['Author'] = creator;
      }
    }
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- Generic text version detection ----------
async function parseTextVersion(file) {
  try {
    const text = await file.slice(0, 4096).text();
    const lines = text.split('\n').slice(0, 20);
    const fields = {};
    for (const line of lines) {
      const ver = line.match(/(?:version|ver)[:\s=]+([0-9][0-9.a-z-]*)/i);
      if (ver && !fields['Version']) fields['Version'] = ver[1];
      const gen = line.match(/(?:generator|creator|created.?(?:with|by)|application)[:\s=]+(.{2,60})/i);
      if (gen && !fields['Creator']) fields['Creator'] = gen[1].trim().replace(/[";]/g, '');
    }
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- Gzipped XML project (Ableton .als, Premiere .prproj) ----------
async function parseGzipXmlProject(file, ext) {
  try {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] !== 0x1F || head[1] !== 0x8B) return null;
    if (typeof DecompressionStream === 'undefined') return null;
    const chunk = file.slice(0, Math.min(file.size, 65536));
    const ds = new DecompressionStream('gzip');
    const reader = chunk.stream().pipeThrough(ds).getReader();
    let xml = '';
    while (xml.length < 8192) {
      const { done, value } = await reader.read();
      if (done) break;
      xml += new TextDecoder().decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    const fields = {};
    if (ext === 'als' || ext === 'alp') {
      const ver = xml.match(/Creator="([^"]+)"/);
      if (ver) fields['Creator'] = ver[1];
      const schema = xml.match(/SchemaChangeCount="(\d+)"/);
      if (schema) fields['Schema version'] = schema[1];
    } else if (ext === 'prproj') {
      const ver = xml.match(/Version="([^"]+)"/);
      if (ver) fields['Project version'] = ver[1];
      const build = xml.match(/<Build>([^<]+)</);
      if (build) fields['Build'] = build[1];
    }
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- Torrent ----------
async function parseTorrent(file) {
  try {
    const text = await file.slice(0, 8192).text();
    const fields = {};
    const announce = text.match(/8:announce(\d+):/);
    if (announce) {
      const len = parseInt(announce[1], 10);
      const idx = text.indexOf(announce[0]) + announce[0].length;
      fields['Tracker'] = text.slice(idx, idx + len);
    }
    const name = text.match(/4:name(\d+):/);
    if (name) {
      const len = parseInt(name[1], 10);
      const idx = text.indexOf(name[0]) + name[0].length;
      fields['Name'] = text.slice(idx, idx + Math.min(len, 200));
    }
    const createdBy = text.match(/10:created by(\d+):/);
    if (createdBy) {
      const len = parseInt(createdBy[1], 10);
      const idx = text.indexOf(createdBy[0]) + createdBy[0].length;
      fields['Created by'] = text.slice(idx, idx + Math.min(len, 100));
    }
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- GCode ----------
async function parseGcode(file) {
  try {
    const headSize = Math.min(file.size, 16384);
    const headText = await file.slice(0, headSize).text();
    const tailText = file.size > headSize
      ? await file.slice(file.size - Math.min(file.size, 8192)).text() : '';
    const text = headText + '\n' + tailText;
    const fields = {};

    const slicerPatterns = [
      [/generated by (PrusaSlicer[^\n]*)/i],
      [/generated by (OrcaSlicer[^\n]*)/i],
      [/generated by (BambuStudio[^\n]*)/i],
      [/generated by (SuperSlicer[^\n]*)/i],
      [/generated by (Simplify3D[^\n]*)/i],
      [/Generated with (Cura_SteamEngine[^\n]*)/i],
      [/generated by (Slic3r[^\n]*)/i],
      [/(KISSlicer[^\n]*)/i],
      [/(IdeaMaker[^\n]*)/i],
    ];
    for (const [re] of slicerPatterns) {
      const m = text.match(re);
      if (m) { fields['Slicer'] = m[1].trim(); break; }
    }

    const kvPat = [
      [/;\s*printer_model\s*=\s*(.+)/i, 'Printer'],
      [/;\s*nozzle_diameter\s*=\s*([0-9.]+)/i, 'Nozzle'],
      [/;\s*layer_height\s*=\s*([0-9.]+)/i, 'Layer height'],
      [/;\s*fill_density\s*=\s*(.+)/i, 'Infill'],
      [/;\s*filament_type\s*=\s*(.+)/i, 'Filament'],
      [/;\s*(?:bed_temperature|first_layer_bed_temperature)\s*=\s*(\d+)/i, 'Bed temp'],
      [/;\s*(?:temperature|first_layer_temperature)\s*=\s*(\d+)/i, 'Nozzle temp'],
      [/;\s*estimated\s+printing\s+time[^=]*=\s*(.+)/i, 'Print time'],
      [/;\s*filament\s+used\s*\[mm\]\s*=\s*([0-9.]+)/i, 'Filament (mm)'],
      [/;\s*filament\s+used\s*\[g\]\s*=\s*([0-9.]+)/i, 'Filament (g)'],
      [/;\s*filament\s+used\s*\[cm3\]\s*=\s*([0-9.]+)/i, 'Filament (cm³)'],
      [/;\s*(?:total\s+)?layer(?:s|\s+count)?\s*[:=]\s*(\d+)/i, 'Layers'],
      [/;LAYER_COUNT:(\d+)/i, 'Layers'],
      [/;\s*perimeters\s*=\s*(\d+)/i, 'Perimeters'],
    ];
    for (const [re, label] of kvPat) {
      const m = text.match(re);
      if (m && !fields[label]) fields[label] = m[1].trim();
    }

    const minx = text.match(/;\s*MINX:([0-9.-]+)/i);
    const maxx = text.match(/;\s*MAXX:([0-9.-]+)/i);
    const miny = text.match(/;\s*MINY:([0-9.-]+)/i);
    const maxy = text.match(/;\s*MAXY:([0-9.-]+)/i);
    const maxz = text.match(/;\s*MAXZ:([0-9.-]+)/i);
    if (minx && maxx && miny && maxy) {
      const w = (parseFloat(maxx[1]) - parseFloat(minx[1])).toFixed(1);
      const d = (parseFloat(maxy[1]) - parseFloat(miny[1])).toFixed(1);
      let dims = w + ' × ' + d;
      if (maxz) dims += ' × ' + parseFloat(maxz[1]).toFixed(1);
      fields['Print size'] = dims + ' mm';
    }

    if (fields['Nozzle']) fields['Nozzle'] += ' mm';
    if (fields['Layer height']) fields['Layer height'] += ' mm';
    if (fields['Bed temp']) fields['Bed temp'] += ' °C';
    if (fields['Nozzle temp']) fields['Nozzle temp'] += ' °C';

    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- Log file origin ----------
async function parseLogOrigin(file) {
  try {
    const text = await file.slice(0, 8192).text();
    const lines = text.split('\n').filter(l => l.trim()).slice(0, 30);
    if (!lines.length) return null;
    const fields = {};
    const patterns = [
      { name: 'Apache / Nginx access log',
        re: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s.*\[\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2}/ },
      { name: 'Nginx error log',
        re: /^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s+\[(emerg|alert|crit|error|warn|notice|info|debug)\]/ },
      { name: 'Apache error log',
        re: /^\[[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{2}\s\d{2}:\d{2}:\d{2}/ },
      { name: 'Syslog',
        re: /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S+/ },
      { name: 'Python logging',
        re: /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s/ },
      { name: 'Java / Log4j',
        re: /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\[/ },
      { name: 'IIS W3C log',
        re: /^#Software:\s*Microsoft|^#Fields:\s*date\s+time\s+s-/i },
      { name: 'Android logcat',
        re: /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+[VDIWEF]\s/ },
      { name: 'JSON structured log',
        re: /^\s*\{.*"(timestamp|time|@timestamp|ts|level|severity|msg|message)":/ },
      { name: 'AWS CloudWatch / Lambda',
        re: /^(START|END|REPORT)\s+RequestId:|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s+[a-f0-9-]+\s/ },
      { name: 'Docker container log',
        re: /^\{"log":".*","stream":"(stdout|stderr)","time":"/ },
    ];
    let matched = null, matchCount = 0;
    for (const pat of patterns) {
      let hits = 0;
      for (const line of lines) if (pat.re.test(line)) hits++;
      if (hits > matchCount) { matchCount = hits; matched = pat; }
    }
    if (matched && matchCount >= Math.min(2, lines.length)) {
      fields['Log format'] = matched.name;
      fields['Confidence'] = Math.round((matchCount / lines.length) * 100) + '%';
    }
    const levelCounts = {};
    const levelRe = /\b(TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|CRITICAL|FATAL|EMERG|ALERT|CRIT)\b/gi;
    for (const line of lines) {
      const m = line.match(levelRe);
      if (m) { const lvl = m[0].toUpperCase(); levelCounts[lvl] = (levelCounts[lvl] || 0) + 1; }
    }
    if (Object.keys(levelCounts).length)
      fields['Log levels (sample)'] = Object.entries(levelCounts)
        .sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ': ' + v).join(', ');
    const ips = new Set();
    for (const line of lines) {
      const ipMatch = line.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g);
      if (ipMatch) for (const ip of ipMatch) ips.add(ip);
    }
    if (ips.size) fields['IPs (sample)'] = ips.size + ' unique';
    fields['Lines (sample)'] = lines.length + (file.size > 8192 ? '+' : '');
    return Object.keys(fields).length > 1 ? fields : null;
  } catch (_) { return null; }
}

// ---------- STEP / IGES text peek ----------
async function parseTextCad(file, format) {
  try {
    const text = await file.slice(0, 4096).text();
    const fields = {};
    if (format === 'STEP') {
      const desc = text.match(/DESCRIPTION\s*\(\s*'([^']+)'/);
      if (desc) fields['Description'] = desc[1];
      const impl = text.match(/IMPLEMENTATION_LEVEL\s*=\s*'([^']+)'/i) || text.match(/implementation_level\s*\(\s*'([^']+)'/i);
      if (impl) fields['Implementation level'] = impl[1];
      const schema = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
      if (schema) fields['Schema'] = schema[1];
      const author = text.match(/FILE_NAME\s*\([^,]*,\s*'([^']+)'/i);
      if (author) fields['Timestamp'] = author[1];
      const org = text.match(/ORIGINATING_SYSTEM\s*=\s*'([^']+)'/i) || text.match(/originating_system\s*\(\s*'([^']+)'/i);
      if (org) fields['Originating system'] = org[1];
    } else if (format === 'IGES') {
      const lines = text.split('\n');
      if (lines.length > 0) {
        const start = lines[0];
        if (start.length >= 72) {
          fields['Sending system'] = start.slice(24, 48).trim() || undefined;
        }
      }
    }
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- main render ----------
export async function renderProprietary(file, container) {
  const ext = extFromName(file.name);
  const fmt = FORMATS[ext];
  if (!fmt) return false;

  container.hidden = false;
  const card = el('div', { class: 'anr-card' });
  card.appendChild(el('h3', {}, fmt.app));

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Application', fmt.app));
  tbl.appendChild(row('File', file.name));
  tbl.appendChild(row('Size', fmtBytes(file.size)));

  // Read header bytes for magic-based parsing
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  let extra = null;

  if (ext === 'psd' || ext === 'psb') extra = parsePsd(head);
  else if (ext === 'dwg' || ext === 'dwt') extra = parseDwg(head);
  else if (ext === 'blend') extra = parseBlender(head);
  else if (ext === 'fbx') extra = parseFbx(head);
  else if (ext === 'glb') extra = parseGlb(head);
  else if (ext === 'stl') extra = parseStl(head);
  else if (ext === 'swf') extra = parseSwf(head);
  else if (ext === 'exe' || ext === 'dll') extra = parsePe(head);
  else if (ext === 'ttf' || ext === 'otf') extra = await parseFont(file);
  else if (ext === 'flp') extra = parseFlp(head);
  else if (ext === 'rar') extra = parseRar(head);
  else if (ext === '7z') extra = parse7z(head);
  else if (ext === 'sqlite' || ext === 'db') extra = parseSqlite(head);
  else if (ext === 'xcf') extra = parseXcf(head);
  else if (ext === 'torrent') extra = await parseTorrent(file);
  else if (ext === 'als' || ext === 'alp' || ext === 'prproj') extra = await parseGzipXmlProject(file, ext);
  else if (ext === 'gcode' || ext === 'gco' || ext === 'nc' || ext === 'ngc') extra = await parseGcode(file);
  else if (ext === 'log') extra = await parseLogOrigin(file);

  // ISO: primary volume descriptor at sector 16 (32768 bytes)
  if (!extra && ext === 'iso' && file.size > 32868) {
    const isoBuf = new Uint8Array(await file.slice(32768, 32868).arrayBuffer());
    extra = parseIso(isoBuf);
  }

  // OLE-based formats (SolidWorks, old Office)
  if (!extra && (head[0] === 0xD0 && head[1] === 0xCF)) {
    extra = parseOle(head);
  }

  // Text-based CAD exchange
  if (!extra && (ext === 'step' || ext === 'stp')) extra = await parseTextCad(file, 'STEP');
  if (!extra && (ext === 'iges' || ext === 'igs')) extra = await parseTextCad(file, 'IGES');

  // ZIP-based document formats
  if (!extra && fmt.zip) extra = await parseZipMeta(file, ext);

  // Generic text/XML version detection for formats without a dedicated parser
  if (!extra && (fmt.parse === 'text' || fmt.parse === 'xml')) extra = await parseTextVersion(file);

  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) tbl.appendChild(row(k, String(v)));
    }
  }

  // XMP sidecar — full metadata parse
  let xmpData = null;
  if (ext === 'xmp') {
    xmpData = await parseXmp(file);
    if (xmpData) {
      for (const [k, v] of Object.entries(xmpData.fields)) {
        tbl.appendChild(row(k, v));
      }
    }
  }

  // MIME type if available
  if (file.type) tbl.appendChild(row('MIME type', file.type));

  // Last modified
  if (file.lastModified) {
    tbl.appendChild(row('Last modified', new Date(file.lastModified).toLocaleString()));
  }

  card.appendChild(tbl);

  // SHA-256 hash
  const hashRow = row('SHA-256', 'computing…');
  tbl.appendChild(hashRow);
  sha256Hex(file).then(h => {
    const td = hashRow.querySelector('td');
    if (td) td.textContent = h;
  });

  // Text / code preview for web files
  if (fmt.parse === 'text' || fmt.parse === 'html') {
    try {
      const fullText = await file.text();
      const lines = fullText.split('\n');
      tbl.insertBefore(row('Lines', lines.length.toLocaleString()), hashRow);

      // HTML: sandboxed rendered preview
      if (fmt.parse === 'html') {
        const previewDet = el('details', { style: 'margin-top: 14px;', open: '' });
        previewDet.appendChild(el('summary', {}, 'Rendered preview'));
        const blob = new Blob([fullText], { type: 'text/html;charset=utf-8' });
        const iframe = el('iframe', {
          src: URL.createObjectURL(blob),
          sandbox: 'allow-same-origin',
          style: 'width:100%;height:400px;border:1px solid var(--rule);background:#fff;margin-top:8px'
        });
        previewDet.appendChild(iframe);
        card.appendChild(previewDet);
      }

      const det = el('details', { style: 'margin-top: 14px;' });
      const summary = el('summary', { style: 'display:flex;align-items:center;gap:10px' });
      summary.appendChild(document.createTextNode('Source (first 200 lines)'));
      const openBtn = el('button', {
        type: 'button',
        class: 'anr-open-tab',
        style: 'font-family:var(--font-mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;' +
               'background:transparent;border:1px solid var(--hairline);color:var(--muted);padding:2px 8px;cursor:pointer'
      }, 'Open full');
      openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const b = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
        window.open(URL.createObjectURL(b), '_blank');
      });
      summary.appendChild(openBtn);
      det.appendChild(summary);
      const pre = el('pre', { class: 'anr-code', style: 'max-height:400px; overflow:auto; font-size:12px;' });
      pre.textContent = lines.slice(0, 200).join('\n');
      det.appendChild(pre);
      card.appendChild(det);
    } catch (_) {}
  }

  // XMP raw XML preview
  if (xmpData && xmpData.raw) {
    const det = el('details', { style: 'margin-top: 14px;' });
    det.appendChild(el('summary', {}, 'Raw XMP'));
    const pre = el('pre', { class: 'anr-code', style: 'max-height:400px; overflow:auto; font-size:12px;' });
    pre.textContent = xmpData.raw;
    det.appendChild(pre);
    card.appendChild(det);
  }

  container.appendChild(card);
  return true;
}

// Check if a file extension is a known proprietary format
export function isProprietaryExt(ext) {
  return ext in FORMATS;
}
