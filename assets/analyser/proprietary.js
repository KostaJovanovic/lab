/* Analyser - proprietary file format identification
   Identifies Adobe, CAD, 3D, and other proprietary formats by extension
   and magic bytes. Extracts whatever metadata is accessible without
   full format parsers. */

import { el, row, rowHelp, fmtBytes, sha256Row } from './util.js';
import { openZip } from './zip.js';

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

  // Microsoft Office (Open XML - ZIP-based)
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
  tap:     { app: 'G-Code (CNC)', icon: 'NC', parse: 'text' },
  cnc:     { app: 'G-Code (CNC)', icon: 'NC', parse: 'text' },

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

  // Adobe After Effects XML project
  aepx:    { app: 'Adobe After Effects (XML)', icon: 'Ae', parse: 'xml' },

  // Rich Text
  rtf:     { app: 'Rich Text Format', icon: 'RTF', parse: 'text' },

  // X.509 certificates / keys
  crt:     { app: 'X.509 Certificate', icon: 'CRT' },
  cer:     { app: 'X.509 Certificate', icon: 'CER' },
  pem:     { app: 'PEM Certificate / Key', icon: 'PEM' },
  der:     { app: 'DER Certificate', icon: 'DER' },

  // Partial downloads
  part:    { app: 'Partial Download', icon: 'PRT' },
  crdownload: { app: 'Chrome Partial Download', icon: 'PRT' },

  // Dolby surround / object audio containers
  ec3:     { app: 'Dolby Digital Plus (E-AC-3)', icon: 'DD+' },
  eac3:    { app: 'Dolby Digital Plus (E-AC-3)', icon: 'DD+' },
  thd:     { app: 'Dolby TrueHD', icon: 'THD' },
  mlp:     { app: 'Meridian Lossless Packing', icon: 'MLP' },
  atmos:   { app: 'Dolby Atmos Master', icon: 'ATM' },

  // Engineering
  cdp:     { app: 'CDP4 (COMET Data Platform)', icon: 'CDP' },

  // Game saves
  bepis:   { app: 'ULTRAKILL Save', icon: 'UK' },

  // Valve / Steam
  vdf:     { app: 'Valve Data (KeyValues)', icon: 'VDF' },
  acf:     { app: 'Steam App Manifest', icon: 'ACF' },

  // Camera catalog (the DCIM index a Canon camera writes alongside the photos)
  ctg:     { app: 'Canon Camera Catalog', icon: 'CTG' },

  // Shortcuts
  lnk:     { app: 'Windows Shortcut', icon: 'LNK', magic: [0x4C, 0x00, 0x00, 0x00] },
  url:     { app: 'Internet Shortcut', icon: 'URL', parse: 'text' },
  webloc:  { app: 'macOS Web Shortcut', icon: 'WEB', parse: 'xml' },

  // REC: ambiguous - a PVR/DVR video recording OR a data-recovery session.
  // parseRec() sniffs the content to tell which.
  rec:     { app: 'REC File', icon: 'REC' },
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
  const numSections = view.getUint16(peOffset + 6, true);
  const timestamp = view.getUint32(peOffset + 8, true);
  const date = timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 19).replace('T', ' ') : 'N/A';
  const optMagic = peOffset + 24 < buf.length ? view.getUint16(peOffset + 24, true) : 0;
  const is64 = optMagic === 0x20B;
  const peType = is64 ? 'PE32+ (64-bit)' : optMagic === 0x10B ? 'PE32 (32-bit)' : 'PE';
  const result = {
    'Format': peType,
    'Architecture': arch,
    'Sections': numSections,
    'Compile date': date
  };

  // COFF characteristics (peOffset + 22)
  const characteristics = view.getUint16(peOffset + 22, true);
  const chFlags = [];
  if (characteristics & 0x2000) chFlags.push('DLL');
  else if (characteristics & 0x0002) chFlags.push('Executable');
  if (characteristics & 0x0020) chFlags.push('Large-address-aware');
  if (characteristics & 0x0001) chFlags.push('Relocs-stripped');
  if (characteristics & 0x0100) chFlags.push('32-bit-machine');
  if (chFlags.length) result['Characteristics'] = chFlags.join(', ');

  // Section names (table starts after the optional header)
  const sizeOfOptHdr = view.getUint16(peOffset + 20, true);
  const secTableOff = peOffset + 24 + sizeOfOptHdr;
  const secNames = [];
  for (let s = 0; s < numSections && secTableOff + s * 40 + 8 <= buf.length; s++) {
    let nm = '';
    for (let b = 0; b < 8; b++) {
      const ch = buf[secTableOff + s * 40 + b];
      if (!ch) break;
      if (ch >= 32 && ch < 127) nm += String.fromCharCode(ch);
    }
    if (nm) secNames.push(nm);
  }
  if (secNames.length) result['Section names'] = secNames.join(', ');

  const optBase = peOffset + 24;
  if (optBase + 2 > buf.length) return result;
  try {
    // Linker version (optBase + 2 / + 3)
    if (optBase + 4 <= buf.length) {
      result['Linker version'] = buf[optBase + 2] + '.' + buf[optBase + 3];
    }
    const subsysOff = optBase + 68;
    if (subsysOff + 2 <= buf.length) {
      const ss = view.getUint16(subsysOff, true);
      const subsystems = { 1: 'Native', 2: 'Windows GUI', 3: 'Windows Console', 5: 'OS/2 Console', 7: 'POSIX Console', 9: 'Windows CE GUI', 10: 'EFI Application', 14: 'Xbox' };
      result['Subsystem'] = subsystems[ss] || 'Unknown (' + ss + ')';
    }
    // Subsystem version (optBase + 48 major / + 50 minor)
    if (optBase + 52 <= buf.length) {
      const maj = view.getUint16(optBase + 48, true);
      const min = view.getUint16(optBase + 50, true);
      if (maj || min) result['Subsystem version'] = maj + '.' + min;
    }
    // Image size (optBase + 56)
    if (optBase + 60 <= buf.length) {
      const imgSize = view.getUint32(optBase + 56, true);
      if (imgSize) result['Image size'] = fmtBytes(imgSize);
    }
    // DllCharacteristics (optBase + 70) - security mitigations
    if (optBase + 72 <= buf.length) {
      const dc = view.getUint16(optBase + 70, true);
      const sec = [];
      if (dc & 0x0020) sec.push('High-entropy ASLR');
      if (dc & 0x0040) sec.push('ASLR');
      if (dc & 0x0080) sec.push('Force-integrity');
      if (dc & 0x0100) sec.push('DEP/NX');
      if (dc & 0x0400) sec.push('No-SEH');
      if (dc & 0x4000) sec.push('Control-Flow-Guard');
      if (dc & 0x8000) sec.push('Terminal-server-aware');
      if (sec.length) result['Security mitigations'] = sec.join(', ');
    }
    const entryOff = optBase + 16;
    if (entryOff + 4 <= buf.length) {
      const ep = view.getUint32(entryOff, true);
      if (ep) result['Entry point'] = '0x' + ep.toString(16).toUpperCase();
    }
    const ddBase = optBase + (is64 ? 112 : 96);
    const ddCount = ddBase >= 4 ? view.getUint32(ddBase - 4, true) : 0;
    if (ddCount > 14 && ddBase + 14 * 8 + 4 <= buf.length) {
      const clrRva = view.getUint32(ddBase + 14 * 8, true);
      if (clrRva) result['.NET'] = 'Yes (CLR)';
    }
    // Resource directory (data dir index 2) → file offset, for VS_VERSIONINFO.
    if (ddCount > 2 && ddBase + 2 * 8 + 4 <= buf.length) {
      const rsrcRva = view.getUint32(ddBase + 2 * 8, true);
      const rsrcSize = view.getUint32(ddBase + 2 * 8 + 4, true);
      if (rsrcRva && rsrcSize) {
        for (let s = 0; s < numSections && secTableOff + s * 40 + 40 <= buf.length; s++) {
          const secVa = view.getUint32(secTableOff + s * 40 + 12, true);
          const secVSize = view.getUint32(secTableOff + s * 40 + 8, true);
          const secRaw = view.getUint32(secTableOff + s * 40 + 20, true);
          if (rsrcRva >= secVa && rsrcRva < secVa + secVSize) {
            result._rsrc = { off: secRaw + (rsrcRva - secVa), size: rsrcSize };
            break;
          }
        }
      }
    }
    if (ddCount > 1 && ddBase + 1 * 8 + 4 <= buf.length) {
      const importRva = view.getUint32(ddBase + 1 * 8, true);
      const importSize = view.getUint32(ddBase + 1 * 8 + 4, true);
      if (importRva && importSize) {
        const sizeOfOptHdr = view.getUint16(peOffset + 20, true);
        const secTableOff = peOffset + 24 + sizeOfOptHdr;
        let importFileOff = 0;
        for (let s = 0; s < numSections && secTableOff + s * 40 + 40 <= buf.length; s++) {
          const secVa = view.getUint32(secTableOff + s * 40 + 12, true);
          const secVSize = view.getUint32(secTableOff + s * 40 + 8, true);
          const secRaw = view.getUint32(secTableOff + s * 40 + 20, true);
          if (importRva >= secVa && importRva < secVa + secVSize) {
            importFileOff = secRaw + (importRva - secVa);
            break;
          }
        }
        if (importFileOff && importFileOff + 20 <= buf.length) {
          let dllCount = 0;
          for (let off = importFileOff; off + 20 <= buf.length; off += 20) {
            const nameRva = view.getUint32(off + 12, true);
            if (!nameRva) break;
            dllCount++;
            if (dllCount > 200) break;
          }
          if (dllCount) result['Imported DLLs'] = dllCount;
        }
      }
    }
  } catch (_) {}
  return result;
}

// VS_VERSIONINFO string reader. A "String" entry is laid out as:
//   wLength(2) wValueLength(2) wType(2) szKey(UTF-16, null-term) [pad to 4]
//   Value(UTF-16, wValueLength words, null-term)
// We find szKey as a real key (it must be followed by a UTF-16 null terminator,
// which rejects the same text appearing inside an embedded manifest/resource),
// then read exactly the declared value length so we never spill into the next
// entry or pick up alignment padding.
function readUtf16Value(buf, key) {
  const kb = [];
  for (let i = 0; i < key.length; i++) { kb.push(key.charCodeAt(i) & 0xFF, 0); }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  outer:
  for (let i = 6; i + kb.length + 2 <= buf.length; i++) {
    for (let j = 0; j < kb.length; j++) { if (buf[i + j] !== kb[j]) continue outer; }
    const after = i + kb.length;
    // Must be a genuine szKey: terminated by a UTF-16 NUL right after the name.
    if (buf[after] !== 0 || buf[after + 1] !== 0) continue;
    const wValueLength = dv.getUint16(i - 4, true); // value length in words
    const structStart = i - 6;
    let p = after + 2; // past key + its NUL terminator
    // Value is 32-bit aligned relative to the (DWORD-aligned) struct start.
    p += (4 - ((p - structStart) % 4)) % 4;
    const maxWords = wValueLength > 0 ? wValueLength : 256;
    let s = '';
    for (let w = 0; w < maxWords && p + 1 < buf.length; w++) {
      const c = buf[p] | (buf[p + 1] << 8);
      p += 2;
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    s = s.trim();
    if (s) return s;
  }
  return null;
}

async function parseExe(c) {
  const result = parsePe(c.head) || {};
  const rsrc = result._rsrc;
  delete result._rsrc;
  if (rsrc && rsrc.size && c.file) {
    try {
      const size = Math.min(rsrc.size, 4 * 1024 * 1024);
      const buf = new Uint8Array(await c.file.slice(rsrc.off, rsrc.off + size).arrayBuffer());
      // VS_FIXEDFILEINFO signature 0xFEEF04BD (little-endian: BD 04 EF FE)
      let sig = -1;
      for (let i = 0; i + 24 <= buf.length; i++) {
        if (buf[i] === 0xBD && buf[i + 1] === 0x04 && buf[i + 2] === 0xEF && buf[i + 3] === 0xFE) { sig = i; break; }
      }
      if (sig >= 0) {
        const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const ver = (ms, ls) => (ms >>> 16) + '.' + (ms & 0xFFFF) + '.' + (ls >>> 16) + '.' + (ls & 0xFFFF);
        const fileMS = v.getUint32(sig + 8, true), fileLS = v.getUint32(sig + 12, true);
        const prodMS = v.getUint32(sig + 16, true), prodLS = v.getUint32(sig + 20, true);
        if (fileMS || fileLS) result['File version'] = ver(fileMS, fileLS);
        if (prodMS || prodLS) result['Product version'] = ver(prodMS, prodLS);
      }
      const fields = [
        ['ProductName', 'Product name'], ['FileDescription', 'Description'],
        ['CompanyName', 'Company'], ['LegalCopyright', 'Copyright'],
        ['OriginalFilename', 'Original filename'], ['InternalName', 'Internal name'],
      ];
      for (const [key, label] of fields) {
        const val = readUtf16Value(buf, key);
        if (val) result[label] = val;
      }
    } catch (_) {}
  }
  return result;
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
  let nameOff = 0, fvarOff = 0;
  for (let i = 0; i < numTables && 12 + i * 16 + 16 <= buf.length; i++) {
    const tag = ascii(buf, 12 + i * 16, 4);
    if (tag === 'name') nameOff = view.getUint32(12 + i * 16 + 8);
    else if (tag === 'fvar') fvarOff = view.getUint32(12 + i * 16 + 8);
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
  // fvar: variable-font axes. Header: major(2) minor(2) axesArrayOffset(2)
  // reserved(2) axisCount(2) axisSize(2), then axisCount records of
  // {tag(4) min(16.16) default(16.16) max(16.16) flags(2) nameID(2)}.
  if (fvarOff && fvarOff + 16 <= buf.length) {
    const axesOff = fvarOff + view.getUint16(fvarOff + 4);
    const axisCount = view.getUint16(fvarOff + 8);
    const axisSize = view.getUint16(fvarOff + 10);
    const axes = [];
    let wght = null;
    for (let i = 0; i < axisCount; i++) {
      const a = axesOff + i * axisSize;
      if (a + 20 > buf.length) break;
      const tag = ascii(buf, a, 4);
      const min = view.getInt32(a + 4) / 65536;
      const def = view.getInt32(a + 8) / 65536;
      const max = view.getInt32(a + 12) / 65536;
      axes.push(tag);
      if (tag === 'wght') wght = { min, def, max };
    }
    names['Variable font'] = 'Yes - ' + axisCount + ' axis' + (axisCount === 1 ? '' : 'es') + ' (' + axes.join(', ') + ')';
    names._font = { variable: true, wght: wght || { min: 100, def: 400, max: 900 } };
  }
  return Object.keys(names).length ? names : null;
}

// ---------- FL Studio (.flp) ----------
// Decode an FLP text-event payload. Modern FL Studio (11.5+) stores strings as
// UTF-16LE; older versions use single-byte text. Sniff by the density of NUL
// bytes, then drop the trailing terminator.
function decodeFlpText(bytes) {
  if (!bytes.length) return '';
  let zeros = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) zeros++;
  let text;
  if (bytes.length >= 2 && zeros >= bytes.length / 3) {
    const codes = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) codes.push(bytes[i] | (bytes[i + 1] << 8));
    text = String.fromCharCode(...codes);
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  return text.replace(/\0+$/, '').trim();
}

async function parseFlp(file) {
  // FLPs are small; read up to 8 MB to cover the whole event stream.
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer());
  if (buf.length < 10 || ascii(buf, 0, 4) !== 'FLhd') return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = view.getUint32(4, true);
  const format = view.getUint16(8, true);
  const channelCount = view.getUint16(10, true);
  const ppq = view.getUint16(12, true);
  const fields = { 'Format': format === 0 ? 'Song' : 'Format ' + format };
  if (channelCount) fields['Channels'] = channelCount;
  if (ppq) fields['PPQ (ticks/beat)'] = ppq;

  // Locate the FLdt data chunk (right after the FLhd chunk).
  let pos = 8 + headerLen;
  if (pos + 8 > buf.length || ascii(buf, pos, 4) !== 'FLdt') return fields;
  const dataLen = view.getUint32(pos + 4, true);
  pos += 8;
  const end = Math.min(buf.length, pos + dataLen);

  const channelNames = [];
  const plugins = new Set();
  let title, comment, version, tempo, genre, author;

  while (pos < end) {
    const id = buf[pos++];
    if (id < 0x40) {                         // BYTE event
      pos += 1;
    } else if (id < 0x80) {                  // WORD event
      if (id === 0x42 && pos + 2 <= end) tempo = view.getUint16(pos, true); // legacy Tempo
      pos += 2;
    } else if (id < 0xC0) {                  // DWORD event
      if (id === 0x9C && pos + 4 <= end) tempo = view.getUint32(pos, true) / 1000; // FineTempo
      pos += 4;
    } else {                                 // TEXT / DATA event (varint length)
      let len = 0, shift = 0, b;
      do { b = buf[pos++]; len |= (b & 0x7F) << shift; shift += 7; } while (b & 0x80 && pos < end);
      const data = buf.subarray(pos, pos + len);
      pos += len;
      switch (id) {
        case 199: version = decodeFlpText(data); break;       // FLP_Version (ASCII)
        case 194: title = decodeFlpText(data); break;          // Title
        case 195: comment = decodeFlpText(data); break;        // Comment
        case 206: genre = decodeFlpText(data); break;          // Genre
        case 207: author = decodeFlpText(data); break;         // Author
        case 192: { const n = decodeFlpText(data); if (n) channelNames.push(n); break; } // ChanName
        case 201: case 203: {                                   // DefPluginName / PluginName
          const n = decodeFlpText(data); if (n && /[a-zA-Z]/.test(n)) plugins.add(n); break;
        }
      }
    }
  }

  if (version) fields['FL Studio version'] = version;
  if (tempo) fields['Tempo'] = (Math.round(tempo * 100) / 100) + ' BPM';
  if (title) fields['Title'] = title;
  if (author) fields['Author'] = author;
  if (genre) fields['Genre'] = genre;
  if (comment) fields['Comment'] = comment.slice(0, 300);
  if (channelNames.length) fields['Named channels'] = channelNames.slice(0, 30).join(', ');
  if (plugins.size) fields['Plugins'] = [...plugins].slice(0, 40).join(', ');
  return fields;
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
// ---------- ZIP-based doc metadata (DOCX, XLSX, PPTX, EPUB, ODF) ----------
async function parseZipMeta(file, ext) {
  try {
    const zip = await openZip(file, 131072);
    const fields = {};
    if (zip.has('docProps/core.xml')) {
      const xml = await zip.text('docProps/core.xml');
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
    if (zip.has('docProps/app.xml')) {
      const xml = await zip.text('docProps/app.xml');
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
    // EPUB: content.opf carries Dublin Core metadata
    if (ext === 'epub') {
      const opfEntry = zip.match(/\.opf$/)[0];
      if (opfEntry) {
        const xml = await zip.text(opfEntry.name);
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
    if (zip.has('meta.xml')) {
      const xml = await zip.text('meta.xml');
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
    const raw = new Uint8Array(await file.arrayBuffer());
    let pos = 0;
    const td = new TextDecoder('latin1');
    function peek() { return td.decode(raw.subarray(pos, pos + 1)); }
    function decode() {
      if (pos >= raw.length) return null;
      const ch = peek();
      if (ch === 'i') {
        pos++;
        let end = pos;
        while (end < raw.length && raw[end] !== 0x65) end++;
        const val = parseInt(td.decode(raw.subarray(pos, end)), 10);
        pos = end + 1;
        return val;
      }
      if (ch === 'l') {
        pos++;
        const list = [];
        while (pos < raw.length && peek() !== 'e') list.push(decode());
        pos++;
        return list;
      }
      if (ch === 'd') {
        pos++;
        const dict = {};
        while (pos < raw.length && peek() !== 'e') {
          const key = decode();
          dict[key] = decode();
        }
        pos++;
        return dict;
      }
      let colonIdx = pos;
      while (colonIdx < raw.length && raw[colonIdx] !== 0x3A) colonIdx++;
      const len = parseInt(td.decode(raw.subarray(pos, colonIdx)), 10);
      pos = colonIdx + 1;
      const data = raw.subarray(pos, pos + len);
      pos += len;
      return td.decode(data);
    }
    const torrent = decode();
    if (!torrent || typeof torrent !== 'object') return null;
    const fields = {};
    if (torrent.announce) fields['Tracker'] = torrent.announce;
    const info = torrent.info;
    if (info) {
      if (info.name) fields['Name'] = info.name.slice(0, 200);
      if (info['piece length']) fields['Piece size'] = fmtBytes(info['piece length']);
      if (info.pieces) fields['Pieces'] = Math.floor(info.pieces.length / 20);
      if (info.length) {
        fields['Total size'] = fmtBytes(info.length);
      } else if (info.files) {
        const total = info.files.reduce((s, f) => s + (f.length || 0), 0);
        fields['Total size'] = fmtBytes(total);
        fields['Files'] = info.files.length;
        const fileList = info.files.slice(0, 20).map(f => {
          const path = Array.isArray(f.path) ? f.path.join('/') : f.path;
          return path + '  (' + fmtBytes(f.length) + ')';
        });
        if (info.files.length > 20) fileList.push('… and ' + (info.files.length - 20) + ' more');
        fields['_fileList'] = fileList;
      }
    }
    if (torrent['created by']) fields['Created by'] = torrent['created by'];
    if (torrent['creation date']) {
      fields['Created'] = new Date(torrent['creation date'] * 1000).toISOString().slice(0, 19).replace('T', ' ');
    }
    if (torrent.comment) fields['Comment'] = torrent.comment.slice(0, 300);
    if (torrent['announce-list'] && Array.isArray(torrent['announce-list'])) {
      const trackers = torrent['announce-list'].flat().filter(Boolean);
      if (trackers.length > 1) fields['Trackers'] = trackers.length;
    }
    if (torrent.nodes) fields['DHT'] = 'Yes (' + torrent.nodes.length + ' nodes)';
    return Object.keys(fields).length ? fields : null;
  } catch (_) {
    return null;
  }
}

// ---------- GCode ----------
async function parseGcode(file) {
  try {
    // Read a generous window so machining stats (tools, bounding box) are
    // representative, plus the tail (slicers/CAM often summarise at the end).
    const scanSize = Math.min(file.size, 2 * 1024 * 1024);
    const mainText = await file.slice(0, scanSize).text();
    const tailText = file.size > scanSize
      ? await file.slice(file.size - 8192).text() : '';
    const text = mainText + '\n' + tailText;
    const truncated = file.size > scanSize;

    // --- 3D-printing vs CNC discrimination ---
    const hasExtrusion = /(?:^|\s)G[01]\b[^;\n]*\bE-?\d/m.test(mainText);
    const hasTemp = /\bM(?:104|109|140|190)\b/.test(mainText);
    const slicerHit = /(PrusaSlicer|OrcaSlicer|BambuStudio|SuperSlicer|Simplify3D|Cura_SteamEngine|Slic3r|KISSlicer|IdeaMaker)/i.test(text);
    const isPrinting = hasExtrusion || hasTemp || slicerHit;

    if (isPrinting) return parseGcodePrinting(text);
    return parseGcodeCnc(text, truncated);
  } catch (_) {
    return null;
  }
}

// 3D-printing G-code (slicer, nozzle/bed temps, filament, dimensions).
function parseGcodePrinting(text) {
  const fields = { 'G-code type': '3D printing (FFF/FDM)' };
  const slicerPatterns = [
    /generated by (PrusaSlicer[^\n]*)/i, /generated by (OrcaSlicer[^\n]*)/i,
    /generated by (BambuStudio[^\n]*)/i, /generated by (SuperSlicer[^\n]*)/i,
    /generated by (Simplify3D[^\n]*)/i, /Generated with (Cura_SteamEngine[^\n]*)/i,
    /generated by (Slic3r[^\n]*)/i, /(KISSlicer[^\n]*)/i, /(IdeaMaker[^\n]*)/i,
  ];
  for (const re of slicerPatterns) {
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
  const g = (re) => { const m = text.match(re); return m ? parseFloat(m[1]) : null; };
  const minx = g(/;\s*MINX:([0-9.-]+)/i), maxx = g(/;\s*MAXX:([0-9.-]+)/i);
  const miny = g(/;\s*MINY:([0-9.-]+)/i), maxy = g(/;\s*MAXY:([0-9.-]+)/i);
  const maxz = g(/;\s*MAXZ:([0-9.-]+)/i);
  if (minx != null && maxx != null && miny != null && maxy != null) {
    let dims = (maxx - minx).toFixed(1) + ' × ' + (maxy - miny).toFixed(1);
    if (maxz != null) dims += ' × ' + maxz.toFixed(1);
    fields['Print size'] = dims + ' mm';
  }
  if (fields['Nozzle']) fields['Nozzle'] += ' mm';
  if (fields['Layer height']) fields['Layer height'] += ' mm';
  if (fields['Bed temp']) fields['Bed temp'] += ' °C';
  if (fields['Nozzle temp']) fields['Nozzle temp'] += ' °C';
  return fields;
}

// CNC / machining G-code: identify the CAM post, controller, machine type, and
// pull machining statistics (units, tools, spindle, feeds, work offsets, extent).
function parseGcodeCnc(text, truncated) {
  const fields = {};

  // --- CAM software / post-processor (from header comments) ---
  const camPatterns = [
    [/\(T\d+\s+D=[\d.]+\s+CR=/i, 'Autodesk Fusion 360 / HSM'],
    [/Autodesk\s+(?:Fusion|HSM|Inventor\s+CAM)/i, 'Autodesk Fusion 360 / HSM'],
    [/MASTERCAM|\(MCX FILE/i, 'Mastercam'],
    [/Exported by FreeCAD|FreeCAD\s+Path/i, 'FreeCAD Path'],
    [/Vectric|VCarve|Aspire|PhotoVCarve/i, 'Vectric (VCarve / Aspire)'],
    [/Carbide Create/i, 'Carbide Create'],
    [/Estlcam/i, 'Estlcam'],
    [/SheetCam/i, 'SheetCam'],
    [/LightBurn/i, 'LightBurn'],
    [/Generated by Easel|;\s*Easel/i, 'Easel (Inventables)'],
    [/PowerMILL|Delcam/i, 'Autodesk PowerMill'],
    [/SolidCAM/i, 'SolidCAM'],
    [/(?:^|\n)\s*\(?\s*SprutCAM/i, 'SprutCAM'],
    [/Bantam|Othermill/i, 'Bantam Tools'],
    [/bCNC/i, 'bCNC'],
  ];
  for (const [re, name] of camPatterns) {
    if (re.test(text)) { fields['CAM software'] = name; break; }
  }

  // --- Controller / dialect ---
  const hasOprog = /(?:^|\n)\s*O\d{1,5}\b/.test(text) || /^%\s*$/m.test(text);
  const hasGrblCfg = /\$[0-9]+\s*=|\$\$|\$H\b|\$G\b/.test(text);
  if (hasGrblCfg) fields['Controller'] = 'GRBL';
  else if (hasOprog) fields['Controller'] = 'Fanuc / Haas style (O-numbered, %-wrapped)';

  // --- Units ---
  const inch = /\bG20\b/.test(text), mm = /\bG21\b/.test(text);
  const unit = inch && !mm ? 'in' : 'mm';
  fields['Units'] = inch && !mm ? 'Inch (G20)' : mm ? 'Millimetre (G21)' : 'Unspecified';

  // --- Motion / feature flags ---
  const hasArcs = /\bG0?[23]\b/.test(text);
  const cannedCycle = /\bG8[1-9]\b/.test(text);
  const hasSpindle = /\bM0?[34]\b/.test(text);
  const hasCoolant = /\bM0?[78]\b/.test(text);
  const hasY = /(?:^|\s)Y-?\d/m.test(text);
  const hasZ = /(?:^|\s)Z-?\d/m.test(text);
  const hasX = /(?:^|\s)X-?\d/m.test(text);
  const isLaserPlasma = /LightBurn|laser|plasma|SheetCam/i.test(text) ||
    (hasSpindle && !hasZ && /\bM0?[34]\b[^;\n]*S/i.test(text));

  // --- Machine type inference ---
  let machine;
  if (/LightBurn|\blaser\b/i.test(text)) machine = 'Laser cutter / engraver';
  else if (/plasma|SheetCam/i.test(text)) machine = 'Plasma / oxy-fuel cutter';
  else if (hasX && hasZ && !hasY) machine = 'CNC lathe / turning';
  else if (cannedCycle && !hasArcs) machine = 'CNC drilling';
  else if (hasZ && (hasArcs || hasSpindle)) machine = 'CNC mill / router (3-axis)';
  else if (isLaserPlasma) machine = 'Laser / plasma (2-axis)';
  else machine = 'CNC machining (generic)';
  fields['G-code type'] = 'CNC machining';
  fields['Likely machine'] = machine;

  // --- Stats over motion lines ---
  const lines = text.split('\n');
  let maxS = 0, maxF = 0, absolute = true, relativeSeen = false;
  const tools = new Set(), offsets = new Set();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const numAfter = (line, letter) => {
    const m = line.match(new RegExp(letter + '\\s*(-?\\d+\\.?\\d*)'));
    return m ? parseFloat(m[1]) : null;
  };
  for (let raw of lines) {
    const line = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
    if (!line) continue;
    if (/\bG90\b/.test(line)) absolute = true;
    if (/\bG91\b/.test(line)) { absolute = false; relativeSeen = true; }
    const sM = line.match(/\bS(\d+\.?\d*)/); if (sM) maxS = Math.max(maxS, parseFloat(sM[1]));
    const fM = line.match(/\bF(\d+\.?\d*)/); if (fM) maxF = Math.max(maxF, parseFloat(fM[1]));
    const tM = line.match(/\bT(\d+)/); if (tM && /\bM0?6\b/.test(line) || (tM && /^T\d+$/.test(line))) tools.add(parseInt(tM[1], 10));
    const wM = line.match(/\bG5[4-9]\b/); if (wM) offsets.add(wM[0]);
    if (absolute && /\bG0?[0-3]\b/.test(line)) {
      const x = numAfter(line, 'X'), y = numAfter(line, 'Y'), z = numAfter(line, 'Z');
      if (x != null) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      if (y != null) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      if (z != null) { minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    }
  }

  if (tools.size) fields['Tools used'] = tools.size + ' (T' + [...tools].sort((a, b) => a - b).join(', T') + ')';
  if (offsets.size) fields['Work offsets'] = [...offsets].sort().join(', ');
  if (maxS) fields['Max spindle / power'] = maxS + (isLaserPlasma ? ' (S)' : ' RPM');
  if (maxF) fields['Max feed rate'] = maxF + ' ' + unit + '/min';
  if (hasCoolant) fields['Coolant'] = 'Yes (M7/M8)';
  fields['Arc moves'] = hasArcs ? 'Yes (G2/G3)' : 'No';
  if (cannedCycle) fields['Canned cycles'] = 'Yes (drilling/boring)';

  if (!relativeSeen && minX !== Infinity && minY !== Infinity) {
    let ext = (maxX - minX).toFixed(2) + ' × ' + (maxY - minY).toFixed(2);
    if (minZ !== Infinity) ext += ' × ' + (maxZ - minZ).toFixed(2);
    fields['Extent (X×Y×Z)'] = ext + ' ' + unit;
    if (minZ !== Infinity) fields['Z range'] = minZ.toFixed(2) + ' to ' + maxZ.toFixed(2) + ' ' + unit;
  }
  fields['Lines scanned'] = lines.length.toLocaleString() + (truncated ? ' (file truncated for analysis)' : '');
  return fields;
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

// ---------- MSI (Windows Installer, OLE compound) ----------
function parseMsi(head) {
  if (head.length < 8 || head[0] !== 0xD0 || head[1] !== 0xCF || head[2] !== 0x11 || head[3] !== 0xE0) {
    return { 'Type': 'Windows Installer (MSI)' };
  }
  const fields = { 'Type': 'Windows Installer database (OLE)' };
  const ole = parseOle(head);
  if (ole) Object.assign(fields, ole);
  // The SummaryInformation property set stores a Template like "Intel;1033" or
  // "x64;1033" (platform;language) - scan the header bytes for it.
  try {
    const txt = new TextDecoder('latin1').decode(head);
    const tmpl = txt.match(/(Intel64|Intel|x64|Arm64|Arm);(\d{3,5})/);
    if (tmpl) {
      fields['Platform'] = tmpl[1] === 'Intel' ? 'x86 (32-bit)' : tmpl[1];
      fields['Language'] = tmpl[2];
    }
  } catch (_) {}
  return fields;
}

// ---------- X.509 certificate (PEM / DER) ----------
function parseCert(file) {
  return file.arrayBuffer().then((ab) => {
    let der = new Uint8Array(ab);
    const fields = {};
    // PEM? (ASCII armour). Decode the base64 body of the first block.
    const headStr = new TextDecoder('latin1').decode(der.subarray(0, 64));
    if (headStr.indexOf('-----BEGIN') !== -1) {
      const full = new TextDecoder('latin1').decode(der);
      const m = full.match(/-----BEGIN ([^-]+)-----([\s\S]*?)-----END/);
      if (m) {
        fields['Encoding'] = 'PEM';
        fields['Block'] = m[1].trim();
        if (/PRIVATE KEY/.test(m[1])) {
          fields['Contains'] = 'Private key';
          return fields; // don't try to ASN.1-parse a key as a cert
        }
        try { der = Uint8Array.from(atob(m[2].replace(/\s+/g, '')), (ch) => ch.charCodeAt(0)); }
        catch (_) { return fields; }
      }
    } else {
      fields['Encoding'] = 'DER (binary)';
    }
    try {
      const info = parseX509(der);
      if (info) Object.assign(fields, info);
    } catch (_) {}
    return Object.keys(fields).length ? fields : null;
  }).catch(() => null);
}

// Minimal ASN.1 DER walker, just enough to pull the interesting fields out of an
// X.509 certificate (serial, validity, issuer/subject CN, algorithms, key size).
function parseX509(der) {
  let p = 0;
  function readLen() {
    let len = der[p++];
    if (len & 0x80) {
      const n = len & 0x7F;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[p++];
    }
    return len;
  }
  function readTLV() {
    const tag = der[p++];
    const len = readLen();
    const start = p;
    p += len;
    return { tag, len, start, end: start + len };
  }
  function oidToStr(start, end) {
    const bytes = der.subarray(start, end);
    const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
    let val = 0;
    for (let i = 1; i < bytes.length; i++) {
      val = (val << 7) | (bytes[i] & 0x7F);
      if (!(bytes[i] & 0x80)) { parts.push(val); val = 0; }
    }
    return parts.join('.');
  }
  const OIDS = {
    '1.2.840.113549.1.1.1': 'RSA', '1.2.840.113549.1.1.11': 'SHA-256 with RSA',
    '1.2.840.113549.1.1.5': 'SHA-1 with RSA', '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
    '1.2.840.113549.1.1.13': 'SHA-512 with RSA', '1.2.840.10045.2.1': 'EC',
    '1.2.840.10045.4.3.2': 'ECDSA with SHA-256', '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
    '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C',
  };
  function readName(end) {
    // SEQUENCE of RDNs; pull out CN/O if present.
    const parts = [];
    while (p < end) {
      const set = readTLV();             // SET
      const setEnd = set.end;
      while (p < setEnd) {
        const seq = readTLV();           // SEQUENCE { OID, value }
        const oid = readTLV();
        const oidStr = oidToStr(oid.start, oid.end);
        const val = readTLV();
        const text = new TextDecoder().decode(der.subarray(val.start, val.end));
        const key = OIDS[oidStr];
        if (key === 'CN') parts.unshift(text);
        else if (key === 'O') parts.push(text);
        p = seq.end;
      }
    }
    return parts.join(', ');
  }
  function readTime(tlv) {
    const s = new TextDecoder().decode(der.subarray(tlv.start, tlv.end));
    // UTCTime YYMMDDHHMMSSZ or GeneralizedTime YYYYMMDD...
    let yr, rest;
    if (tlv.tag === 0x17) { yr = parseInt(s.slice(0, 2), 10); yr += yr < 50 ? 2000 : 1900; rest = s.slice(2); }
    else { yr = parseInt(s.slice(0, 4), 10); rest = s.slice(4); }
    const mo = rest.slice(0, 2), da = rest.slice(2, 4), hh = rest.slice(4, 6), mm = rest.slice(6, 8);
    return yr + '-' + mo + '-' + da + ' ' + hh + ':' + mm;
  }

  const fields = {};
  const cert = readTLV();              // Certificate SEQUENCE
  const tbs = readTLV();               // TBSCertificate SEQUENCE
  const tbsEnd = tbs.end;
  // [0] version (optional, EXPLICIT)
  if (der[p] === 0xA0) { const v = readTLV(); const vi = readTLV(); fields['Version'] = 'v' + (der[vi.start] + 1); }
  const serial = readTLV();            // INTEGER serial
  const serialHex = Array.from(der.subarray(serial.start, serial.end)).map(b => b.toString(16).padStart(2, '0')).join(':');
  if (serialHex) fields['Serial'] = serialHex.length > 48 ? serialHex.slice(0, 48) + '…' : serialHex;
  const sigAlg = readTLV();            // SEQUENCE { OID }
  const sigOid = readTLV();
  fields['Signature'] = OIDS[oidToStr(sigOid.start, sigOid.end)] || oidToStr(sigOid.start, sigOid.end);
  p = sigAlg.end;
  const issuer = readTLV();            // issuer Name
  const issuerStr = readName(issuer.end);
  if (issuerStr) fields['Issuer'] = issuerStr;
  p = issuer.end;
  const validity = readTLV();          // SEQUENCE { notBefore, notAfter }
  const nb = readTLV(); fields['Valid from'] = readTime(nb); p = nb.end;
  const na = readTLV(); fields['Valid to'] = readTime(na); p = validity.end;
  const subject = readTLV();           // subject Name
  const subjStr = readName(subject.end);
  if (subjStr) fields['Subject'] = subjStr;
  p = subject.end;
  const spki = readTLV();              // SubjectPublicKeyInfo SEQUENCE
  const algSeq = readTLV();
  const algOid = readTLV();
  const algName = OIDS[oidToStr(algOid.start, algOid.end)] || 'key';
  fields['Key type'] = algName;
  p = algSeq.end;
  const keyBits = readTLV();           // BIT STRING
  if (algName === 'RSA') {
    // BIT STRING -> SEQUENCE { modulus INTEGER, exponent }
    let kp = keyBits.start + 1;        // skip unused-bits byte
    if (der[kp] === 0x30) {
      const save = p; p = kp; readTLV(); const mod = readTLV(); p = save;
      let bytes = mod.len;
      if (der[mod.start] === 0x00) bytes -= 1; // leading zero
      fields['Key size'] = (bytes * 8) + ' bit';
    }
  }
  return fields;
}

// ---------- After Effects XML project (.aepx) ----------
async function parseAepx(file) {
  try {
    const text = await file.text();
    const fields = {};
    // Footage / asset references
    const assets = [...text.matchAll(/fullpath="([^"]+)"/g)].map(m => m[1]);
    const uniqAssets = [...new Set(assets)];
    if (uniqAssets.length) {
      fields['Assets'] = uniqAssets.length;
      fields['_fileList'] = uniqAssets.slice(0, 30).map(a => a.replace(/&amp;/g, '&'));
    }
    // Effect match-names (ADBE ...) used across comps
    const effects = [...new Set([...text.matchAll(/<string>(ADBE [^<]+)<\/string>/g)].map(m => m[1]))];
    if (effects.length) fields['Effects'] = effects.length;
    // Plain string names (comp / layer / folder names) - first few, filtered
    const names = [...new Set([...text.matchAll(/<string>([^<]{1,60})<\/string>/g)]
      .map(m => m[1]).filter(s => !s.startsWith('ADBE ') && /[a-zA-Z]/.test(s)))];
    if (names.length) fields['Named items'] = names.length;
    // Composition count (each comp has a <Layr> grouping under an <Item>)
    const comps = (text.match(/<idta/g) || []).length;
    if (comps) fields['Items'] = comps;
    return Object.keys(fields).length ? fields : { 'Type': 'After Effects XML project' };
  } catch (_) {
    return null;
  }
}

// ---------- Partial download (.part / .crdownload) ----------
async function parsePart(file, head) {
  const fields = { 'Status': 'Incomplete download' };
  fields['Bytes present'] = fmtBytes(file.size);
  const sig = guessFromMagic(head);
  if (sig) fields['Detected original format'] = sig;
  else fields['Detected original format'] = 'Unrecognised (' +
    Array.from(head.subarray(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ') + ')';
  return fields;
}

// Small magic-byte sniffer for the partial-download detector.
function guessFromMagic(b) {
  const a = (s, l) => Array.from(b.subarray(s, s + l)).map(c => String.fromCharCode(c)).join('');
  if (a(0, 4) === '%PDF') return 'PDF document';
  if (b[0] === 0x50 && b[1] === 0x4B) return 'ZIP / Office / archive';
  if (b[0] === 0x4D && b[1] === 0x5A) return 'Windows executable (PE)';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'JPEG image';
  if (a(0, 8) === '\x89PNG\r\n\x1a\n') return 'PNG image';
  if (a(0, 6) === 'GIF89a' || a(0, 6) === 'GIF87a') return 'GIF image';
  if (a(0, 4) === 'RIFF') return 'RIFF (WAV / AVI / WebP)';
  if (a(0, 4) === 'OggS') return 'Ogg media';
  if (a(0, 4) === 'fLaC') return 'FLAC audio';
  if (b[0] === 0x1F && b[1] === 0x8B) return 'GZIP archive';
  if (a(0, 4) === '7z\xBC\xAF') return '7-Zip archive';
  if (a(0, 4) === 'Rar!') return 'RAR archive';
  if (a(4, 4) === 'ftyp') return 'MP4 / MOV / HEIF';
  if (a(0, 5) === '<?xml') return 'XML document';
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'MP3 (ID3) audio';
  if (b[0] === 0xD0 && b[1] === 0xCF) return 'OLE compound (legacy Office / MSI)';
  return null;
}

// ---------- Dolby Digital Plus / E-AC-3 (.ec3) ----------
function parseEac3(head) {
  // Find the 0x0B77 sync word, then read the bitstream header for acmod + lfe.
  let off = -1;
  for (let i = 0; i + 1 < Math.min(head.length, 4096); i++) {
    if (head[i] === 0x0B && head[i + 1] === 0x77) { off = i + 2; break; }
  }
  const fields = { 'Codec': 'Dolby Digital Plus (E-AC-3)' };
  if (off < 0 || off + 4 > head.length) return fields;
  // Bit reader starting at the byte after the sync word.
  let bitPos = off * 8;
  const bits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = head[bitPos >> 3];
      const bit = (byte >> (7 - (bitPos & 7))) & 1;
      v = (v << 1) | bit;
      bitPos++;
    }
    return v;
  };
  bits(2);                    // strmtyp
  bits(3);                    // substreamid
  bits(11);                   // frmsiz
  const fscod = bits(2);
  if (fscod === 3) bits(2); else bits(2); // fscod2 / numblkscod
  const acmod = bits(3);
  const lfeon = bits(1);
  const chans = [2, 1, 2, 3, 3, 4, 4, 5][acmod] + (lfeon ? 1 : 0);
  const layout = { 1: 'Mono', 2: 'Stereo', 3: '3.0', 4: '3.0 (surround)', 6: '5.1', 5: '4.0' };
  fields['Channels'] = lfeon ? (chans - 1) + '.1' : String(chans);
  if (acmod === 7) fields['Layout'] = lfeon ? '5.1 surround' : '5.0 surround';
  const rates = { 0: '48 kHz', 1: '44.1 kHz', 2: '32 kHz' };
  if (rates[fscod]) fields['Sample rate'] = rates[fscod];
  return fields;
}

// ---------- Dolby TrueHD / MLP (.thd / .mlp) ----------
function parseTrueHd(head) {
  // MLP major sync: format_sync at offset 4 is 0xF8726FBA (TrueHD) or 0xF8726FBB (MLP).
  for (let i = 0; i + 8 < Math.min(head.length, 4096); i++) {
    if (head[i + 4] === 0xF8 && head[i + 5] === 0x72 && head[i + 6] === 0x6F &&
        (head[i + 7] === 0xBA || head[i + 7] === 0xBB)) {
      const isTrueHd = head[i + 7] === 0xBA;
      return { 'Codec': isTrueHd ? 'Dolby TrueHD' : 'MLP (Meridian Lossless Packing)', 'Container': 'MLP major sync found' };
    }
  }
  return { 'Codec': 'Dolby TrueHD / MLP' };
}

// ---------- CDP4 (COMET Data Platform) ----------
async function parseCdp(file, head) {
  const fields = { 'Application': 'CDP4 (COMET Data Platform)' };
  const a = (s, l) => Array.from(head.subarray(s, s + l)).map(c => String.fromCharCode(c)).join('');
  if (a(0, 15) === 'SQLite format 3') {
    fields['Container'] = 'SQLite database';
  } else if (head[0] === 0x50 && head[1] === 0x4B) {
    fields['Container'] = 'ZIP archive (annotated model)';
    const meta = await parseZipMeta(file, 'zip').catch(() => null);
    if (meta) Object.assign(fields, meta);
  } else {
    const txt = a(0, Math.min(head.length, 256)).trimStart();
    if (txt[0] === '{' || txt[0] === '[') fields['Container'] = 'JSON';
    else if (txt.startsWith('<?xml') || txt[0] === '<') fields['Container'] = 'XML';
    else fields['Container'] = 'Binary';
  }
  return fields;
}

// ---------- ULTRAKILL save (.bepis) ----------
// The internal layout isn't publicly documented, so this is best-effort:
// identify the container, then surface any readable strings (level / weapon /
// difficulty names, JSON keys) found in the bytes.
async function parseBepis(file, head) {
  const fields = { 'Game': 'ULTRAKILL', 'File type': 'Save data' };
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
  const headStr = new TextDecoder('latin1').decode(buf.subarray(0, 256)).trimStart();

  // JSON save?
  if (headStr[0] === '{' || headStr[0] === '[') {
    fields['Container'] = 'JSON';
    try {
      const obj = JSON.parse(new TextDecoder('utf-8').decode(buf));
      const keys = Object.keys(obj);
      if (keys.length) fields['Fields'] = keys.slice(0, 20).join(', ');
    } catch (_) { /* truncated / not pure JSON */ }
    return fields;
  }

  // Binary save - pull printable ASCII runs (≥4 chars) as a hint at contents.
  fields['Container'] = 'Binary';
  const strings = [];
  let cur = '';
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7F) {
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= 4 && /[a-zA-Z]/.test(cur)) strings.push(cur);
      cur = '';
    }
  }
  if (cur.length >= 4) strings.push(cur);
  const uniq = [...new Set(strings)];
  // Highlight known ULTRAKILL tokens if present.
  const known = uniq.filter(s => /(level|prelude|layer|secret|rank|difficulty|brutal|violent|standard|harmless|cybergrind|weapon|revolver|shotgun|nailgun|railcannon|fist|whiplash|coin|time|kills|style)/i.test(s));
  if (known.length) fields['Recognised tokens'] = known.slice(0, 25).join(', ');
  if (uniq.length) fields['_readableText'] = uniq.slice(0, 300).join('\n');
  return fields;
}

// ---------- Canon camera catalog (.CTG) ----------
// A CTG is the index a Canon camera keeps under DCIM/CANONMSC so it knows what's
// on the card without rescanning. There's no public spec; these offsets were
// reverse-engineered from IXUS/PowerShot cards and are read defensively (every
// field is bounds- and sanity-checked, so a different model's CTG still at least
// identifies). It carries NO image data. Two variants:
//   • per-folder (e.g. 107.CTG) - starts with the folder path "X:\DCIM\nnnCANON"
//   • master    (D.CTG)         - starts with a uint32 folder count
async function parseCtg(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fields = { 'Vendor': 'Canon', 'File type': 'Camera catalog (DCIM index)' };

  // Per-folder catalog begins with a drive path like "D:\DCIM\107CANON".
  const isPath = buf.length > 8 &&
    buf[0] >= 0x41 && buf[0] <= 0x5A &&        // drive letter A-Z
    buf[1] === 0x3A &&                          // ':'
    (buf[2] === 0x5C || buf[2] === 0x2F);       // '\' or '/'

  if (isPath) {
    fields['Catalog type'] = 'Per-folder index';
    let end = 0;
    while (end < buf.length && end < 260 && buf[end] !== 0) end++;
    fields['Catalogues folder'] = new TextDecoder('latin1').decode(buf.subarray(0, end));

    // Folder number + recorded-shot count (uint16 LE) at observed offsets.
    if (buf.length > 0x84) {
      const folderNo = dv.getUint16(0x80, true);
      const shots = dv.getUint16(0x82, true);
      if (folderNo >= 100 && folderNo <= 999) fields['Folder number'] = String(folderNo);
      if (shots > 0 && shots <= 5000) fields['Shots recorded'] = String(shots);
    }
    // Presence bitmap (uint32 LE): one set bit per occupied frame slot.
    if (buf.length > 0xec) {
      const bmp = dv.getUint32(0xe8, true);
      let bits = 0;
      for (let i = 0; i < 32; i++) if ((bmp >>> i) & 1) bits++;
      if (bits > 0 && bits <= 1000) fields['Frames in use (bitmap)'] = String(bits);
    }
    // Entry-prefix table near the end: IMG_ (photos), MVI_ (movies), SND_ (the
    // voice-memo slot Canon pairs with each photo). Count by scanning the bytes.
    const txt = ascii(buf, 0, buf.length);
    const n = (re) => (txt.match(re) || []).length;
    const nImg = n(/IMG_/g), nMvi = n(/MVI_/g), nSnd = n(/SND_/g);
    if (nImg) fields['Photo entries (IMG_)'] = String(nImg);
    if (nMvi) fields['Movie entries (MVI_)'] = String(nMvi);
    if (nSnd) fields['Voice-memo slots (SND_)'] = String(nSnd);
  } else {
    fields['Catalog type'] = 'Master index (D.CTG)';
    if (buf.length >= 4) {
      const folders = dv.getUint32(0, true);
      if (folders > 0 && folders < 100000) fields['Folders catalogued'] = String(folders);
    }
  }

  fields['Contains'] = 'Index only — no image data';
  return fields;
}

// ---------- Windows shortcut (.LNK) ----------
// MS-SHLLINK shell link: a binary pointer to a file/folder. We read the header
// (flags, target timestamps, size, window/hotkey), skip the LinkTargetIDList,
// pull the real target path out of LinkInfo's LocalBasePath, then read the
// StringData blocks (name / relative-path / working-dir / arguments / icon) that
// the LinkFlags say are present. StringData is UTF-16 when the Unicode flag is set.
const LNK_CLSID = [0x01,0x14,0x02,0x00,0x00,0x00,0x00,0x00,0xC0,0x00,0x00,0x00,0x00,0x00,0x00,0x46];
function lnkFiletime(dv, off) {
  const lo = dv.getUint32(off, true), hi = dv.getUint32(off + 4, true);
  const ft = hi * 4294967296 + lo;            // 100-ns ticks since 1601-01-01
  if (!ft) return null;
  const d = new Date(ft / 10000 - 11644473600000);
  return isNaN(d.getTime()) ? null : d.toLocaleString();
}
function lnkCStr(buf, start) {                  // null-terminated ANSI string
  if (start < 0 || start >= buf.length) return '';
  let end = start;
  while (end < buf.length && buf[end] !== 0) end++;
  return new TextDecoder('latin1').decode(buf.subarray(start, end));
}
function lnkHotkey(raw) {
  const key = raw & 0xFF, mod = (raw >> 8) & 0xFF;
  if (!key) return null;
  const parts = [];
  if (mod & 0x02) parts.push('Ctrl');
  if (mod & 0x04) parts.push('Alt');
  if (mod & 0x01) parts.push('Shift');
  if (key >= 0x30 && key <= 0x5A) parts.push(String.fromCharCode(key));
  else if (key >= 0x70 && key <= 0x87) parts.push('F' + (key - 0x6F));
  else parts.push('0x' + key.toString(16));
  return parts.join(' + ');
}
async function parseLnk(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 262144)).arrayBuffer());
  if (buf.length < 0x4C) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x4C) return null;            // HeaderSize
  for (let i = 0; i < 16; i++) if (buf[4 + i] !== LNK_CLSID[i]) return null;

  const flags = dv.getUint32(0x14, true);
  const attrs = dv.getUint32(0x18, true);
  const targetSize = dv.getUint32(0x34, true);
  const showCmd = dv.getUint32(0x3C, true);
  const hotkey = dv.getUint16(0x40, true);
  const isUni = !!(flags & 0x80);

  let off = 0x4C;
  if (flags & 0x01) {                          // HasLinkTargetIDList → skip it
    if (off + 2 > buf.length) return null;
    off += 2 + dv.getUint16(off, true);
  }

  let localPath = null;
  if ((flags & 0x02) && off + 28 <= buf.length) {            // HasLinkInfo
    const li = off;
    const liSize = dv.getUint32(li, true);
    const liFlags = dv.getUint32(li + 8, true);
    const localBaseOff = dv.getUint32(li + 16, true);
    const suffixOff = dv.getUint32(li + 24, true);
    if ((liFlags & 0x01) && localBaseOff) {                  // VolumeIDAndLocalBasePath
      localPath = lnkCStr(buf, li + localBaseOff);
      if (suffixOff) localPath += lnkCStr(buf, li + suffixOff);
    }
    if (liSize > 0 && li + liSize <= buf.length) off = li + liSize;
  }

  const readStr = () => {                       // a StringData block
    if (off + 2 > buf.length) return null;
    const n = dv.getUint16(off, true); off += 2;
    let s = '';
    if (isUni) { for (let i = 0; i < n && off + 1 < buf.length; i++) { s += String.fromCharCode(dv.getUint16(off, true)); off += 2; } }
    else       { for (let i = 0; i < n && off < buf.length; i++)     { s += String.fromCharCode(buf[off]); off += 1; } }
    return s;
  };
  let name = null, rel = null, work = null, args = null, icon = null;
  if (flags & 0x04) name = readStr();           // HasName (description)
  if (flags & 0x08) rel  = readStr();           // HasRelativePath
  if (flags & 0x10) work = readStr();           // HasWorkingDir
  if (flags & 0x20) args = readStr();           // HasArguments
  if (flags & 0x40) icon = readStr();           // HasIconLocation

  const isDir = !!(attrs & 0x10);
  const fields = { 'Type': 'Windows shortcut (.LNK)' };
  const target = localPath || rel;
  if (target) fields['Target'] = target;
  if (isDir) fields['Target type'] = 'Folder';
  if (rel && rel !== target) fields['Relative path'] = rel;
  if (args) fields['Arguments'] = args;
  if (work) fields['Working directory'] = work;
  if (name) fields['Description'] = name;
  if (icon) fields['Icon location'] = icon;
  if (!isDir && targetSize) fields['Target size'] = fmtBytes(targetSize);
  const showMap = { 1: 'Normal window', 3: 'Maximized', 7: 'Minimized' };
  if (showMap[showCmd]) fields['Window'] = showMap[showCmd];
  const hk = lnkHotkey(hotkey);
  if (hk) fields['Hotkey'] = hk;
  const wt = lnkFiletime(dv, 0x2C);
  if (wt) fields['Target modified'] = wt;
  return fields;
}

// ---------- Internet shortcut (.URL) ----------
async function parseUrlShortcut(file) {
  const text = await file.text();
  const fields = { 'Type': 'Internet shortcut (.URL)' };
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const url  = grab(/^\s*URL\s*=\s*(.+)$/im);
  const icon = grab(/^\s*IconFile\s*=\s*(.+)$/im);
  const idx  = grab(/^\s*IconIndex\s*=\s*(.+)$/im);
  if (url)  fields['URL'] = url;
  if (icon) fields['Icon file'] = icon;
  if (idx)  fields['Icon index'] = idx;
  return fields;
}

// ---------- macOS web shortcut (.webloc) ----------
async function parseWebloc(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  const text = new TextDecoder('latin1').decode(buf);
  const fields = { 'Type': 'macOS web shortcut (.webloc)' };
  fields['Format'] = text.startsWith('bplist') ? 'Binary plist' : 'XML plist';
  const m = text.match(/<key>\s*URL\s*<\/key>\s*<string>([^<]+)<\/string>/i)
        || text.match(/<string>([^<]+)<\/string>/i)
        || text.match(/https?:\/\/[^\x00-\x1f"'<>\\]+/);
  if (m) fields['URL'] = (m[1] || m[0]).trim();
  return fields;
}

// ---------- Disk image (.IMG and other raw images) ----------
// Decodes the partition scheme (MBR / GPT / none) and the first volume's
// filesystem (FAT12/16/32, NTFS, exFAT) straight from the boot records, so a raw
// card/USB/floppy image reports its real layout instead of just "disk image".
const MBR_PART_TYPES = {
  0x01: 'FAT12', 0x04: 'FAT16 (<32M)', 0x05: 'Extended', 0x06: 'FAT16',
  0x07: 'NTFS / exFAT', 0x0b: 'FAT32 (CHS)', 0x0c: 'FAT32 (LBA)',
  0x0e: 'FAT16 (LBA)', 0x0f: 'Extended (LBA)', 0x82: 'Linux swap',
  0x83: 'Linux', 0xa5: 'FreeBSD', 0xaf: 'HFS / HFS+', 0xee: 'GPT protective',
  0xef: 'EFI System',
};
function fmtGuid(b, o) {
  const h = (i) => b[o + i].toString(16).padStart(2, '0');
  return (h(3) + h(2) + h(1) + h(0) + '-' + h(5) + h(4) + '-' + h(7) + h(6) + '-' +
          h(8) + h(9) + '-' + h(10) + h(11) + h(12) + h(13) + h(14) + h(15)).toUpperCase();
}
// Parse a FAT boot sector (BPB) at offset `off` in buf. Returns a fields object.
function parseFatVbr(buf, off) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = {};
  const oem = ascii(buf, off + 3, 8).trim();
  const bps = dv.getUint16(off + 0x0b, true);
  const spc = buf[off + 0x0d];
  const totalSec = dv.getUint16(off + 0x13, true) || dv.getUint32(off + 0x20, true);
  const fs36 = ascii(buf, off + 0x36, 8).trim();
  const fs52 = ascii(buf, off + 0x52, 8).trim();
  let fsType, label, serial;
  if (fs52.startsWith('FAT32')) {
    fsType = 'FAT32'; label = ascii(buf, off + 0x47, 11).trim(); serial = dv.getUint32(off + 0x43, true);
  } else {
    fsType = fs36.startsWith('FAT') ? fs36 : (ascii(buf, off + 3, 5) === 'NTFS' ? 'NTFS' : (ascii(buf, off + 3, 5) === 'EXFAT' ? 'exFAT' : null));
    label = ascii(buf, off + 0x2b, 11).trim(); serial = dv.getUint32(off + 0x27, true);
  }
  if (fsType) out['Filesystem'] = fsType;
  if (label && label !== 'NO NAME') out['Volume label'] = label;
  if (oem) out['Formatted by'] = oem;
  if (bps && spc) out['Cluster size'] = (bps * spc / 1024) + ' KB (' + spc + ' sectors)';
  if (bps) out['Bytes/sector'] = String(bps);
  if (totalSec && bps) out['Volume size'] = fmtBytes(totalSec * bps);
  if (serial) out['Volume serial'] = (serial >>> 0).toString(16).toUpperCase().padStart(8, '0').replace(/(.{4})(.{4})/, '$1-$2');
  return out;
}
async function parseDiskImage(file) {
  const fields = { 'Type': 'Disk image' };
  try {
    const sec0 = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    const dv = new DataView(sec0.buffer, sec0.byteOffset, sec0.byteLength);
    const has55aa = sec0[510] === 0x55 && sec0[511] === 0xaa;

    // Sector 0 is itself a volume boot record (superfloppy - no partition table)?
    const fsAt36 = ascii(sec0, 0x36, 5), fsAt52 = ascii(sec0, 0x52, 5), at3 = ascii(sec0, 3, 5);
    const vbrLike = (sec0[0] === 0xeb || sec0[0] === 0xe9) &&
      (fsAt36.startsWith('FAT') || fsAt52.startsWith('FAT') || at3 === 'NTFS' || at3 === 'EXFAT');

    if (vbrLike) {
      fields['Partitioning'] = 'None (single volume / superfloppy)';
      Object.assign(fields, parseFatVbr(sec0, 0));
    } else if (has55aa) {
      const parts = [];
      for (let p = 0; p < 4; p++) {
        const o = 0x1be + p * 16;
        const type = sec0[o + 4];
        if (type === 0) continue;
        parts.push({ active: sec0[o] === 0x80, type, lba: dv.getUint32(o + 8, true), count: dv.getUint32(o + 12, true) });
      }
      // GPT (protective MBR = single type-0xEE entry)
      if (parts.length === 1 && parts[0].type === 0xee) {
        const gpt = new Uint8Array(await file.slice(512, 512 + 92).arrayBuffer());
        if (ascii(gpt, 0, 8) === 'EFI PART') {
          const gdv = new DataView(gpt.buffer, gpt.byteOffset, gpt.byteLength);
          fields['Partitioning'] = 'GPT';
          fields['Disk GUID'] = fmtGuid(gpt, 0x38);
          const entLba = Number(gdv.getBigUint64(0x48, true));
          const numEnt = gdv.getUint32(0x50, true);
          const entSz = gdv.getUint32(0x54, true);
          const arr = new Uint8Array(await file.slice(entLba * 512, entLba * 512 + Math.min(numEnt * entSz, 32768)).arrayBuffer());
          const list = [];
          for (let i = 0; i + entSz <= arr.length && i / entSz < numEnt; i += entSz) {
            let empty = true;
            for (let j = 0; j < 16; j++) if (arr[i + j] !== 0) { empty = false; break; }
            if (empty) continue;
            const edv = new DataView(arr.buffer, arr.byteOffset + i, entSz);
            const first = Number(edv.getBigUint64(0x20, true)), last = Number(edv.getBigUint64(0x28, true));
            let nm = '';
            for (let c = 0; c < 36; c++) { const ch = arr[i + 0x38 + c * 2] | (arr[i + 0x38 + c * 2 + 1] << 8); if (!ch) break; nm += String.fromCharCode(ch); }
            list.push((nm || 'Partition') + ' — ' + fmtBytes((last - first + 1) * 512));
          }
          fields['Partitions'] = String(list.length);
          list.slice(0, 8).forEach((p, i) => { fields['Partition ' + (i + 1)] = p; });
        } else {
          fields['Partitioning'] = 'GPT (header unreadable)';
        }
      } else if (parts.length) {
        fields['Partitioning'] = 'MBR';
        fields['Partitions'] = String(parts.length);
        parts.forEach((pt, i) => {
          fields['Partition ' + (i + 1)] = (MBR_PART_TYPES[pt.type] || ('type 0x' + pt.type.toString(16))) +
            ' — ' + fmtBytes(pt.count * 512) + (pt.active ? ' (active)' : '');
        });
        // Decode the first partition's filesystem from its boot sector.
        const first = parts[0];
        const off = first.lba * 512;
        if (off + 512 <= file.size) {
          const vbr = new Uint8Array(await file.slice(off, off + 512).arrayBuffer());
          Object.assign(fields, parseFatVbr(vbr, 0));
        }
      } else {
        fields['Partitioning'] = 'None (boot signature only)';
      }
    } else {
      fields['Note'] = 'No MBR/VBR signature — raw or unrecognised image';
    }
  } catch (_) { /* best-effort; show whatever we gathered */ }
  fields['Image size'] = fmtBytes(file.size);
  return fields;
}

// ---------- REC: PVR/DVR recording OR data-recovery session ----------
// .rec is overloaded: many DVRs/PVRs save video as .rec, but recovery tools
// (GetDataBack, ReclaiMe) also save .rec session files. Sniff the bytes to tell
// them apart. We pull only structural fields from session XML - never the embedded
// license key.
async function parseRec(file) {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 8192)).arrayBuffer());
  const text = new TextDecoder('latin1').decode(head);
  const trimmed = text.replace(/^﻿/, '').trimStart();
  const fields = {};

  if (trimmed.startsWith('<?xml') || trimmed[0] === '<') {
    const g = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
    if (/getdatabackrecovery/i.test(text)) {
      fields['Type'] = 'GetDataBack recovery session';
      const tool = g(/<recfilecreator>([^<]+)/i), ver = g(/<recfilecreatorversion>([^<]+)/i);
      if (tool) fields['Tool'] = tool + (ver ? ' ' + ver : '');
      const t = g(/<recfiletime>([^<]+)/i); if (t) fields['Saved'] = t;
      const name = g(/<name>([^<]+)/i), kind = g(/<kind>([^<]+)/i);
      if (name || kind) fields['Source'] = [name, kind].filter(Boolean).join(' — ');
      const from = g(/<fromsector>(\d+)/i), to = g(/<tosector>(\d+)/i);
      if (to) { const sec = (+to) - (+(from || 0)) + 1; fields['Imaged range'] = (+(from || 0)) + '–' + to + ' sectors (' + fmtBytes(sec * 512) + ')'; }
      const id = g(/<recoveryid>([^<]+)/i); if (id) fields['Recovery ID'] = id;
      return fields;
    }
    if (/reclaime/i.test(text)) { fields['Type'] = 'ReclaiMe recovery session'; return fields; }
    fields['Type'] = 'XML session / recovery file';
    return fields;
  }

  // Binary - most likely a PVR/DVR video recording.
  if (head[0] === 0x47 && head[188] === 0x47 && head[376] === 0x47) {
    fields['Type'] = 'Video recording (MPEG-TS)';
    fields['Note'] = 'PVR/DVR transport-stream recording (188-byte packets)';
  } else if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0xba) {
    fields['Type'] = 'Video recording (MPEG program stream)';
  } else {
    fields['Type'] = 'REC recording (unrecognised container)';
    fields['Note'] = 'Commonly a PVR/DVR or camera video recording';
  }
  return fields;
}

// ---------- Rich Text Format (.rtf) ----------
async function parseRtf(file) {
  try {
    const text = await file.text();
    if (!text.startsWith('{\\rtf')) return { 'Type': 'Rich Text (header not found)' };
    const fields = {};
    const ver = text.match(/\{\\rtf(\d+)/);
    if (ver) fields['RTF version'] = ver[1];
    const cs = text.match(/\\ansicpg(\d+)/);
    if (cs) fields['Code page'] = cs[1];
    const gen = text.match(/\{\\\*\\generator ([^;}]+)[;}]/);
    if (gen) fields['Generator'] = gen[1].trim();
    // Info group: title / author
    const title = text.match(/\{\\title ([^}]*)\}/);
    if (title) fields['Title'] = title[1].trim();
    const author = text.match(/\{\\author ([^}]*)\}/);
    if (author) fields['Author'] = author[1].trim();
    fields['_readableText'] = stripRtf(text).slice(0, 20000);
    return fields;
  } catch (_) {
    return null;
  }
}

// Strip RTF control words and groups down to readable plain text.
function stripRtf(rtf) {
  let out = '';
  let i = 0;
  const n = rtf.length;
  let skipUntilDepth = -1;
  let depth = 0;
  while (i < n) {
    const ch = rtf[i];
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { if (depth === skipUntilDepth) skipUntilDepth = -1; depth--; i++; continue; }
    if (skipUntilDepth !== -1) { i++; continue; }
    if (ch === '\\') {
      // Escaped literal char?
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') { out += next; i += 2; continue; }
      if (next === "'") { // hex byte
        i += 4; continue;
      }
      if (next === '*') { i += 2; continue; } // \* ignorable-destination marker
      // Control word
      const m = rtf.slice(i).match(/^\\([a-zA-Z]+)(-?\d+)? ?/);
      if (m) {
        const word = m[1];
        // Groups whose entire content should be dropped (metadata / fonts / etc).
        if (/^(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|datastore|generator|\*)$/.test(word)) {
          skipUntilDepth = depth;
        }
        if (word === 'par' || word === 'line' || word === 'pard') out += '\n';
        if (word === 'tab') out += '\t';
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') { i++; continue; }
    out += ch;
    i++;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Font preview (live rendering via FontFace) ----------
let fontPreviewSeq = 0;
async function renderFontPreview(file, card, fontInfo) {
  let face;
  const family = 'anr-font-' + (++fontPreviewSeq);
  try {
    const buf = await file.arrayBuffer();
    face = new FontFace(family, buf);
    await face.load();
    document.fonts.add(face);
  } catch (_) {
    return; // browser couldn't load the font (e.g. unsupported flavour)
  }

  const previewCard = el('div', { class: 'anr-card' });
  previewCard.appendChild(el('h3', {}, 'Font preview'));
  const pangram = 'The quick brown fox jumps over the lazy dog';

  // Sizes
  const sizes = [48, 36, 28, 22, 18, 14];
  for (const sz of sizes) {
    previewCard.appendChild(el('p', {
      style: `font-family:'${family}';font-size:${sz}px;line-height:1.25;margin:6px 0;`
    }, pangram));
  }

  // Alphabet + numerals
  previewCard.appendChild(el('p', {
    style: `font-family:'${family}';font-size:24px;margin:14px 0 2px;`
  }, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  previewCard.appendChild(el('p', {
    style: `font-family:'${family}';font-size:24px;margin:2px 0;`
  }, 'abcdefghijklmnopqrstuvwxyz 0123456789 & ? !'));

  // Varying weights
  const wRow = el('div', { style: 'margin-top:14px;border-top:1px solid var(--rule);padding-top:12px;' });
  wRow.appendChild(el('div', { class: 'anr-readout-section' }, 'Weights'));
  for (const w of [100, 300, 400, 500, 700, 900]) {
    wRow.appendChild(el('p', {
      style: `font-family:'${family}';font-weight:${w};font-size:22px;margin:3px 0;`
    }, w + ' - ' + pangram));
  }
  previewCard.appendChild(wRow);

  // Variable font: animate a big "A" pulsing weight from lightest to boldest,
  // ease-in-out, looping. Driven by requestAnimationFrame so it works everywhere.
  if (fontInfo && fontInfo.variable && fontInfo.wght) {
    const { min, max } = fontInfo.wght;
    const varRow = el('div', { style: 'margin-top:14px;border-top:1px solid var(--rule);padding-top:12px;text-align:center;' });
    varRow.appendChild(el('div', { class: 'anr-readout-section', style: 'text-align:left;' },
      'Variable axis - weight ' + Math.round(min) + ' to ' + Math.round(max)));
    const bigA = el('div', {
      style: `font-family:'${family}';font-size:140px;line-height:1.1;font-variation-settings:"wght" ${min};`
    }, 'A');
    varRow.appendChild(bigA);
    previewCard.appendChild(varRow);
    const period = 3000; // ms for a full lightest→boldest sweep
    let t0 = null;
    const tick = (ts) => {
      if (!bigA.isConnected) return; // stop when removed (new file analysed)
      if (t0 === null) t0 = ts;
      // Triangle wave 0→1→0 with ease-in-out shaping.
      const phase = ((ts - t0) % (period * 2)) / period;
      const tri = phase <= 1 ? phase : 2 - phase;
      const eased = tri < 0.5 ? 2 * tri * tri : 1 - Math.pow(-2 * tri + 2, 2) / 2;
      bigA.style.fontVariationSettings = '"wght" ' + Math.round(min + (max - min) * eased);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  card.appendChild(previewCard);
}

// ---------- Valve KeyValues (.vdf / .acf) ----------
// Steam/Source text format: nested "key" "value" pairs with { } blocks. Used by
// appmanifest, libraryfolders, loginusers, config, etc.
function prettyKV(obj, indent) {
  indent = indent || 0;
  const pad = '  '.repeat(indent);
  let s = '';
  for (const k in obj) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      s += pad + k + '\n' + pad + '{\n' + prettyKV(v, indent + 1) + pad + '}\n';
    } else {
      s += pad + k + '  =  ' + v + '\n';
    }
  }
  return s;
}

async function parseVdf(file) {
  let text;
  try { text = await file.text(); } catch (_) { return null; }
  if (!text) return null;

  // Tokenise: quoted strings (with escapes), braces, or bare tokens. Line // and
  // block comments are stripped first.
  text = text.replace(/\/\/[^\n]*/g, '');
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\{)|(\})|([^\s"{}]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2]) tokens.push({ t: '{' });
    else if (m[3]) tokens.push({ t: '}' });
    else if (m[1] !== undefined) tokens.push({ t: 's', v: m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') });
    else tokens.push({ t: 's', v: m[4] });
  }
  if (!tokens.length) return null;

  let i = 0;
  function parseObj() {
    const obj = {};
    while (i < tokens.length) {
      const tk = tokens[i];
      if (tk.t === '}') { i++; break; }
      if (tk.t !== 's') { i++; continue; }
      const key = tk.v; i++;
      const next = tokens[i];
      if (next && next.t === '{') { i++; obj[key] = parseObj(); }
      else if (next && next.t === 's') { obj[key] = next.v; i++; }
      else { obj[key] = ''; }
    }
    return obj;
  }

  let rootKey = null, root = null;
  if (tokens[0].t === 's' && tokens[1] && tokens[1].t === '{') {
    rootKey = tokens[0].v; i = 2; root = parseObj();
  } else {
    i = 0; root = parseObj();
  }
  if (!root || !Object.keys(root).length) return null;

  // Count leaves + surface notable fields found anywhere in the tree.
  let leaves = 0;
  const notable = {};
  const NOTE = { appid: 'App ID', name: 'Name', installdir: 'Install dir',
    buildid: 'Build ID', SizeOnDisk: 'Size on disk', LastUpdated: 'Last updated',
    LastOwner: 'Last owner', universe: 'Universe', PersonaName: 'Persona name',
    AccountName: 'Account name', language: 'Language', version: 'Version' };
  (function walk(o) {
    for (const k in o) {
      const v = o[k];
      if (v && typeof v === 'object') walk(v);
      else { leaves++; if (NOTE[k] && notable[k] === undefined) notable[k] = v; }
    }
  })(root);

  const res = { 'Format': 'Valve KeyValues (VDF)' };
  if (rootKey) res['Root key'] = rootKey;
  res['Total entries'] = leaves.toLocaleString();
  for (const k in notable) {
    let v = notable[k];
    if (k === 'SizeOnDisk' && /^\d+$/.test(v)) v = fmtBytes(Number(v));
    if ((k === 'LastUpdated' || k === 'LastOwner') && /^\d{9,}$/.test(v)) {
      const d = new Date(Number(v) * 1000);
      if (!isNaN(d)) v = v + '  (' + d.toLocaleString() + ')';
    }
    res[NOTE[k]] = v;
  }
  res._readableText = prettyKV(rootKey ? { [rootKey]: root } : root);
  return res;
}

// ---------- per-extension parser dispatch ----------
// Maps an extension to a metadata parser. Functions receive { head, file, ext }
// and may be sync or async (the caller awaits the result). To add a format,
// drop a line here rather than extending a branch chain.
const PARSERS = {
  vdf:   c => parseVdf(c.file),
  acf:   c => parseVdf(c.file),
  psd:   c => parsePsd(c.head),
  psb:   c => parsePsd(c.head),
  dwg:   c => parseDwg(c.head),
  dwt:   c => parseDwg(c.head),
  blend: c => parseBlender(c.head),
  fbx:   c => parseFbx(c.head),
  glb:   c => parseGlb(c.head),
  stl:   c => parseStl(c.head),
  swf:   c => parseSwf(c.head),
  exe:   c => parseExe(c),
  dll:   c => parseExe(c),
  ttf:   c => parseFont(c.file),
  otf:   c => parseFont(c.file),
  flp:   c => parseFlp(c.file),
  rar:   c => parseRar(c.head),
  '7z':  c => parse7z(c.head),
  sqlite: c => parseSqlite(c.head),
  db:    c => parseSqlite(c.head),
  lrcat: c => parseSqlite(c.head),   // Lightroom catalog is a SQLite database
  xcf:   c => parseXcf(c.head),
  torrent: c => parseTorrent(c.file),
  als:   c => parseGzipXmlProject(c.file, c.ext),
  alp:   c => parseGzipXmlProject(c.file, c.ext),
  prproj: c => parseGzipXmlProject(c.file, c.ext),
  gcode: c => parseGcode(c.file),
  gco:   c => parseGcode(c.file),
  nc:    c => parseGcode(c.file),
  ngc:   c => parseGcode(c.file),
  tap:   c => parseGcode(c.file),
  cnc:   c => parseGcode(c.file),
  log:   c => parseLogOrigin(c.file),
  msi:   c => parseMsi(c.head),
  crt:   c => parseCert(c.file),
  cer:   c => parseCert(c.file),
  pem:   c => parseCert(c.file),
  der:   c => parseCert(c.file),
  aepx:  c => parseAepx(c.file),
  part:  c => parsePart(c.file, c.head),
  crdownload: c => parsePart(c.file, c.head),
  ec3:   c => parseEac3(c.head),
  eac3:  c => parseEac3(c.head),
  thd:   c => parseTrueHd(c.head),
  mlp:   c => parseTrueHd(c.head),
  cdp:   c => parseCdp(c.file, c.head),
  rtf:   c => parseRtf(c.file),
  bepis: c => parseBepis(c.file, c.head),
  ctg:   c => parseCtg(c.file),
  lnk:   c => parseLnk(c.file),
  url:   c => parseUrlShortcut(c.file),
  webloc: c => parseWebloc(c.file),
  img:   c => parseDiskImage(c.file),
  rec:   c => parseRec(c.file),
};

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

  // Read header bytes for magic-based parsing (more for PE/EXE to walk import tables)
  const headSize = (ext === 'exe' || ext === 'dll' || ext === 'msi') ? Math.min(file.size, 65536) : 4096;
  const head = new Uint8Array(await file.slice(0, headSize).arrayBuffer());
  let extra = null;

  // Per-extension metadata parsers. Each receives { head, file, ext } and may be
  // sync or async; the result is awaited. Aliases (e.g. psd/psb) share an entry.
  const fn = PARSERS[ext];
  if (fn) extra = await fn({ head, file, ext });

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

  let extraFileList = null;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (k === '_fileList') { extraFileList = v; continue; }
      if (k.startsWith('_')) continue;   // internal payloads (e.g. _font, _readableText)
      if (v !== undefined) tbl.appendChild(row(k, String(v)));
    }
  }

  // XMP sidecar - full metadata parse
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
  if (file.type) tbl.appendChild(rowHelp('MIME type', file.type, "The MIME type is the standard label for the file's format (for example image/jpeg or audio/mpeg). The browser reads it from the extension or the operating system, so it's a hint rather than proof of the real format."));

  // Last modified
  if (file.lastModified) {
    tbl.appendChild(row('Last modified', new Date(file.lastModified).toLocaleString()));
  }

  card.appendChild(tbl);

  // Font preview (TTF/OTF/WOFF/WOFF2/TTC) - render sample text live with the font.
  if (ext === 'ttf' || ext === 'otf' || ext === 'woff' || ext === 'woff2' || ext === 'ttc') {
    await renderFontPreview(file, card, extra && extra._font);
  }

  // Torrent file list (rendered as its own block beneath the readout)
  if (extraFileList && extraFileList.length) {
    const det = el('details', { style: 'margin-top: 14px;' });
    det.appendChild(el('summary', {}, 'Contents (' + extraFileList.length + ' entries)'));
    const pre = el('pre', { class: 'anr-code', style: 'max-height:400px; overflow:auto; font-size:12px;' });
    pre.textContent = extraFileList.join('\n');
    det.appendChild(pre);
    card.appendChild(det);
  }

  const hashRow = sha256Row(file);
  tbl.appendChild(hashRow);

  // Readable text block (e.g. RTF stripped of control words)
  if (extra && extra._readableText) {
    const det = el('details', { style: 'margin-top: 14px;', open: '' });
    det.appendChild(el('summary', {}, 'Readable text'));
    const pre = el('pre', { class: 'anr-ocr-text', style: 'max-height:400px; overflow:auto; white-space:pre-wrap;' });
    pre.textContent = extra._readableText;
    det.appendChild(pre);
    card.appendChild(det);
  }

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
        // Reuse the "Supported formats" overlay styling: the header (file name +
        // close) lives OUTSIDE the scrolling body, so the close button stays put
        // instead of scrolling away with the text. No search bar.
        const closeBtn = el('button', { type: 'button', class: 'fmt-overlay-close' }, '×');
        const header = el('div', { class: 'fmt-overlay-header' }, [el('h3', {}, file.name), closeBtn]);
        const fullPre = el('pre', { class: 'anr-code', style: 'font-size:12px;white-space:pre-wrap;word-break:break-all;margin:0;' });
        fullPre.textContent = fullText;
        const body = el('div', { class: 'fmt-overlay-body' }, [fullPre]);
        const inner = el('div', { class: 'fmt-overlay-inner' }, [header, body]);
        const overlay = el('div', { class: 'fmt-overlay anr-text-overlay' }, [inner]);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        const onKey = (ev) => { if (ev.key === 'Escape') close(); };
        function close() { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); }
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
        document.addEventListener('keydown', onKey);
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
