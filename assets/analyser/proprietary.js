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
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  let extra = null;

  if (ext === 'psd' || ext === 'psb') extra = parsePsd(head);
  else if (ext === 'dwg' || ext === 'dwt') extra = parseDwg(head);
  else if (ext === 'blend') extra = parseBlender(head);
  else if (ext === 'fbx') extra = parseFbx(head);
  else if (ext === 'glb') extra = parseGlb(head);
  else if (ext === 'stl') extra = parseStl(head);
  else if (ext === 'swf') extra = parseSwf(head);
  else if (ext === 'exe' || ext === 'dll') extra = parsePe(head);

  // OLE-based formats (SolidWorks, old Office)
  if (!extra && (head[0] === 0xD0 && head[1] === 0xCF)) {
    extra = parseOle(head);
  }

  // Text-based CAD exchange
  if (!extra && (ext === 'step' || ext === 'stp')) extra = await parseTextCad(file, 'STEP');
  if (!extra && (ext === 'iges' || ext === 'igs')) extra = await parseTextCad(file, 'IGES');

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
      const text = await file.slice(0, 50000).text();
      const lines = text.split('\n');
      const totalLines = (await file.text()).split('\n').length;
      tbl.insertBefore(row('Lines', totalLines.toLocaleString()), hashRow);
      const det = el('details', { style: 'margin-top: 14px;' });
      det.appendChild(el('summary', {}, 'Preview (first 200 lines)'));
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
