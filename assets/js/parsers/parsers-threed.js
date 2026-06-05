/* Analyser - lazy parser chunk: 3D / CAD / mesh / scene / point-cloud formats.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'threed'` is opened. Each entry in PARSERS is
   `({head, file, ext}) => rows` where `rows` is a plain object of label->value
   pairs (rendered as a readout), optionally carrying `_sections:[{title,node,
   open?}]` and `_previewNode`. Return null to fall back to the generic card.

   HEADER / METADATA extraction only - no WebGL viewer, no mesh render. Just
   counts and metadata. Dependency-free. */

import { el, row, fmtBytes, preBlock } from '../core/util.js';
import { Reader, ascii, findBytes, matchMagic, startsWithAscii, latin1, utf8, gunzip } from '../core/binutil.js';
import { openZip } from '../renderers/zip.js';

// ---------- small helpers ----------

// Read the first `n` bytes of a file as a Uint8Array (clamped to file size).
async function head(file, n) {
  return new Uint8Array(await file.slice(0, Math.min(file.size, n)).arrayBuffer());
}
// Read the first `n` bytes as text.
async function headText(file, n) {
  return file.slice(0, Math.min(file.size, n)).text();
}

// Format a bounding box from {min:[x,y,z], max:[..]} (3 dp).
function fmtBbox(bb) {
  if (!bb || !isFinite(bb.min[0])) return null;
  const r = (a) => a.map((v) => (Math.round(v * 1000) / 1000)).join(', ');
  return '[' + r(bb.min) + '] -> [' + r(bb.max) + ']';
}
function bboxAdd(bb, x, y, z) {
  if (x < bb.min[0]) bb.min[0] = x; if (x > bb.max[0]) bb.max[0] = x;
  if (y < bb.min[1]) bb.min[1] = y; if (y > bb.max[1]) bb.max[1] = y;
  if (z < bb.min[2]) bb.min[2] = z; if (z > bb.max[2]) bb.max[2] = z;
}
function newBbox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

const SAMPLE = 2 * 1024 * 1024;   // bytes scanned for line-based formats / bbox

// ---------- Wavefront OBJ ----------
async function parseObj(file) {
  const text = await headText(file, Math.min(file.size, SAMPLE));
  let v = 0, vn = 0, vt = 0, f = 0;
  const groups = new Set(), objects = new Set(), mtllibs = new Set();
  let usemtl = 0;
  const bb = newBbox();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const l = line.trimStart();
    if (l.charCodeAt(0) === 35) continue;             // '#'
    if (l.startsWith('v ')) {
      v++;
      const p = l.slice(2).trim().split(/\s+/);
      const x = +p[0], y = +p[1], z = +p[2];
      if (isFinite(x) && isFinite(y) && isFinite(z)) bboxAdd(bb, x, y, z);
    } else if (l.startsWith('vn ')) vn++;
    else if (l.startsWith('vt ')) vt++;
    else if (l.startsWith('f ')) f++;
    else if (l.startsWith('g ')) { const n = l.slice(2).trim(); if (n) groups.add(n); }
    else if (l.startsWith('o ')) { const n = l.slice(2).trim(); if (n) objects.add(n); }
    else if (l.startsWith('mtllib')) l.slice(6).trim().split(/\s+/).forEach((m) => m && mtllibs.add(m));
    else if (l.startsWith('usemtl')) usemtl++;
  }
  if (!v && !f) return null;
  const truncated = file.size > SAMPLE;
  const out = {
    'Format': 'Wavefront OBJ' + (truncated ? ' (first 2 MB sampled)' : ''),
    'Vertices (v)': v.toLocaleString(),
    'Normals (vn)': vn.toLocaleString(),
    'Texture coords (vt)': vt.toLocaleString(),
    'Faces (f)': f.toLocaleString(),
  };
  if (objects.size) out['Objects'] = objects.size;
  if (groups.size) out['Groups'] = groups.size;
  if (usemtl) out['Material refs (usemtl)'] = usemtl;
  if (mtllibs.size) out['Material libraries'] = Array.from(mtllibs).join(', ');
  const box = fmtBbox(bb);
  if (box) out['Bounding box'] = box;
  return out;
}

// ---------- PLY (Stanford) ----------
async function parsePly(file) {
  const text = await headText(file, 65536);
  if (!/^ply\s/.test(text)) return null;
  const endIdx = text.indexOf('end_header');
  const header = endIdx >= 0 ? text.slice(0, endIdx) : text;
  const lines = header.split(/\r?\n/);
  let format = '?', version = '';
  const elements = [];      // {name, count}
  const comments = [];
  let cur = null;
  let hasNormals = false, hasColor = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('format ')) {
      const p = l.split(/\s+/); format = p[1]; version = p[2] || '';
    } else if (l.startsWith('comment ')) comments.push(l.slice(8).trim());
    else if (l.startsWith('element ')) {
      const p = l.split(/\s+/); cur = { name: p[1], count: parseInt(p[2], 10) || 0 };
      elements.push(cur);
    } else if (l.startsWith('property ')) {
      const name = l.split(/\s+/).pop().toLowerCase();
      if (name === 'nx' || name === 'ny' || name === 'nz') hasNormals = true;
      if (name === 'red' || name === 'green' || name === 'blue' || name === 'r' || name === 'g' || name === 'b') hasColor = true;
    }
  }
  const fmtMap = { ascii: 'ASCII', binary_little_endian: 'binary (little-endian)', binary_big_endian: 'binary (big-endian)' };
  const vtx = elements.find((e) => e.name === 'vertex');
  const face = elements.find((e) => e.name === 'face');
  const out = {
    'Format': 'Stanford PLY',
    'Encoding': (fmtMap[format] || format) + (version ? ' ' + version : ''),
  };
  if (vtx) out['Vertices'] = vtx.count.toLocaleString();
  if (face) out['Faces'] = face.count.toLocaleString();
  const others = elements.filter((e) => e.name !== 'vertex' && e.name !== 'face');
  if (others.length) out['Other elements'] = others.map((e) => e.name + ' (' + e.count + ')').join(', ');
  out['Per-vertex normals'] = hasNormals ? 'yes' : 'no';
  out['Per-vertex colour'] = hasColor ? 'yes' : 'no';
  const software = comments.find((c) => /[A-Za-z]/.test(c));
  if (software) out['Comment'] = comments.slice(0, 4).join(' | ');
  return out;
}

// ---------- OFF ----------
async function parseOff(file) {
  const text = await headText(file, 8192);
  const lines = text.split(/\r?\n/);
  let i = 0;
  // first non-empty, non-comment line
  const first = () => { while (i < lines.length) { const l = lines[i++].trim(); if (l && l[0] !== '#') return l; } return null; };
  let l0 = first();
  if (!l0) return null;
  let colored = false, hasNormals = false, dim4 = false;
  // header keyword may be OFF, COFF (colour), NOFF (normals), 4OFF, etc., and the
  // counts may share that first line.
  const m = l0.match(/^(ST|C|N|4|n)*OFF\b\s*(.*)$/);
  if (!m) return null;
  const pfx = l0.slice(0, l0.indexOf('OFF'));
  if (/C/.test(pfx)) colored = true;
  if (/N/.test(pfx)) hasNormals = true;
  if (/4/.test(pfx)) dim4 = true;
  let countsLine = m[2].trim();
  if (!countsLine) countsLine = first() || '';
  const nums = countsLine.split(/\s+/).map((n) => parseInt(n, 10));
  if (nums.length < 2 || !isFinite(nums[0])) return null;
  const [nv, nf, ne] = nums;
  const out = {
    'Format': 'OFF mesh' + (dim4 ? ' (4D)' : ''),
    'Vertices': (nv || 0).toLocaleString(),
    'Faces': (nf || 0).toLocaleString(),
  };
  if (ne) out['Edges'] = ne.toLocaleString();
  out['Per-vertex colour'] = colored ? 'yes' : 'no';
  if (hasNormals) out['Per-vertex normals'] = 'yes';
  return out;
}

// ---------- glTF (JSON) ----------
async function parseGltf(file) {
  let j;
  try { j = JSON.parse(await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).text()); } catch (_) { return null; }
  if (!j || !j.asset) return null;
  const a = j.asset;
  const out = { 'Format': 'glTF (JSON)' };
  if (a.version) out['glTF version'] = a.version;
  if (a.generator) out['Generator'] = a.generator;
  if (a.copyright) out['Copyright'] = a.copyright;
  const cnt = (k) => Array.isArray(j[k]) ? j[k].length : 0;
  out['Scenes'] = cnt('scenes');
  out['Nodes'] = cnt('nodes');
  out['Meshes'] = cnt('meshes');
  out['Materials'] = cnt('materials');
  out['Textures'] = cnt('textures');
  out['Images'] = cnt('images');
  out['Accessors'] = cnt('accessors');
  out['Animations'] = cnt('animations');
  out['Skins'] = cnt('skins');
  if (Array.isArray(j.meshes)) {
    let prims = 0; for (const m of j.meshes) prims += (m.primitives || []).length;
    if (prims) out['Mesh primitives'] = prims;
  }
  const exts = new Set([...(j.extensionsUsed || []), ...(j.extensionsRequired || [])]);
  if (exts.size) out['Extensions'] = Array.from(exts).join(', ');
  return out;
}

// ---------- 3MF ----------
async function parse3mf(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const modelName = zip.names().find((n) => /3D\/.*\.model$/i.test(n)) || zip.names().find((n) => /\.model$/i.test(n));
  if (!modelName) return null;
  let xml; try { xml = await zip.text(modelName); } catch (_) { return null; }
  if (!xml) return null;
  const out = { 'Format': '3MF (3D Manufacturing Format)' };
  const unit = (xml.match(/\bunit\s*=\s*"([^"]+)"/) || [])[1];
  if (unit) out['Units'] = unit;
  const meta = (k) => (xml.match(new RegExp('<metadata[^>]*name="(?:[^":]*:)?' + k + '"[^>]*>([^<]*)</metadata>', 'i')) || [])[1];
  const title = meta('Title'); if (title) out['Title'] = title;
  const designer = meta('Designer'); if (designer) out['Designer'] = designer;
  const app = meta('Application'); if (app) out['Application'] = app;
  out['Objects'] = (xml.match(/<object\b/gi) || []).length;
  let tris = (xml.match(/<triangle\b/gi) || []).length;
  out['Triangles'] = tris.toLocaleString();
  out['Vertices'] = (xml.match(/<vertex\b/gi) || []).length.toLocaleString();
  const colors = (xml.match(/<m:color\b/gi) || []).length || (xml.match(/<color\b/gi) || []).length;
  if (colors) out['Colours'] = colors;
  const mats = (xml.match(/<basematerials\b/gi) || []).length;
  if (mats) out['Material groups'] = mats;
  return out;
}

// ---------- AMF ----------
async function parseAmf(file) {
  // AMF may be raw XML or a zip wrapping a .amf
  const sig = await head(file, 4);
  let xml = null;
  if (sig[0] === 0x50 && sig[1] === 0x4B) {
    try {
      const zip = await openZip(file);
      const name = zip.names().find((n) => /\.amf$/i.test(n)) || zip.names()[0];
      if (name) xml = await zip.text(name);
    } catch (_) {}
  } else {
    xml = await headText(file, Math.min(file.size, SAMPLE));
  }
  if (!xml || !/<amf/i.test(xml)) return null;
  const out = { 'Format': 'AMF (Additive Manufacturing File)' };
  const unit = (xml.match(/<amf[^>]*\bunit\s*=\s*"([^"]+)"/i) || [])[1];
  if (unit) out['Units'] = unit;
  const ver = (xml.match(/<amf[^>]*\bversion\s*=\s*"([^"]+)"/i) || [])[1];
  if (ver) out['Version'] = ver;
  const meta = (k) => (xml.match(new RegExp('<metadata[^>]*type="' + k + '"[^>]*>([^<]*)</metadata>', 'i')) || [])[1];
  const title = meta('Name') || meta('Title'); if (title) out['Title'] = title;
  const author = meta('Author') || meta('Designer'); if (author) out['Author'] = author;
  out['Objects'] = (xml.match(/<object\b/gi) || []).length;
  out['Materials'] = (xml.match(/<material\b/gi) || []).length;
  out['Triangles'] = (xml.match(/<triangle\b/gi) || []).length.toLocaleString();
  out['Vertices'] = (xml.match(/<vertex\b/gi) || []).length.toLocaleString();
  return out;
}

// ---------- MagicaVoxel VOX ----------
async function parseVox(file) {
  const b = await head(file, Math.min(file.size, 1024 * 1024));
  if (ascii(b, 0, 4) !== 'VOX ') return null;
  const r = new Reader(b, true); r.seek(4);
  const version = r.u32();
  const out = { 'Format': 'MagicaVoxel VOX', 'Version': version };
  const sizes = []; let voxels = 0, models = 0, paletteCustom = false;
  try {
    // expect MAIN chunk
    if (r.ascii(4) !== 'MAIN') { /* keep going anyway */ }
    r.skip(8); // content size + children size of MAIN
    while (r.remaining() >= 12) {
      const id = r.ascii(4);
      const contentSize = r.u32();
      r.u32(); // children size
      const next = r.tell() + contentSize;
      if (id === 'SIZE') {
        const x = r.u32(), y = r.u32(), z = r.u32();
        sizes.push([x, y, z]);
      } else if (id === 'XYZI') {
        const n = r.u32(); voxels += n; models++;
      } else if (id === 'RGBA') {
        paletteCustom = true;
      } else if (id === 'PACK') {
        // explicit model count
      }
      if (next <= r.tell()) break;
      r.seek(next);
      if (next > b.length) break;
    }
  } catch (_) {}
  if (sizes.length) out['Model dimensions'] = sizes.slice(0, 4).map((s) => s.join('x')).join(', ') + (sizes.length > 4 ? ', ...' : '');
  out['Models'] = models || sizes.length || 1;
  if (voxels) out['Voxels'] = voxels.toLocaleString();
  out['Palette'] = paletteCustom ? 'custom RGBA' : 'default';
  return out;
}

// ---------- COLLADA (.dae) / ZAE ----------
function parseDaeXml(xml) {
  const out = { 'Format': 'COLLADA (DAE)' };
  const tool = (xml.match(/<authoring_tool>([^<]*)<\/authoring_tool>/i) || [])[1];
  if (tool) out['Authoring tool'] = tool;
  const up = (xml.match(/<up_axis>([^<]*)<\/up_axis>/i) || [])[1];
  if (up) out['Up axis'] = up;
  const unitM = xml.match(/<unit\b([^>]*)\/?>/i);
  if (unitM) {
    const name = (unitM[1].match(/name="([^"]+)"/) || [])[1];
    const meter = (unitM[1].match(/meter="([^"]+)"/) || [])[1];
    if (name || meter) out['Units'] = (name || '') + (meter ? ' (' + meter + ' m)' : '');
  }
  const ver = (xml.match(/<COLLADA[^>]*\bversion="([^"]+)"/i) || [])[1];
  if (ver) out['COLLADA version'] = ver;
  out['Geometries'] = (xml.match(/<geometry\b/gi) || []).length;
  out['Meshes'] = (xml.match(/<mesh\b/gi) || []).length;
  const polys = (xml.match(/<polylist\b/gi) || []).length + (xml.match(/<polygons\b/gi) || []).length + (xml.match(/<triangles\b/gi) || []).length;
  out['Polygon primitives'] = polys;
  out['Materials'] = (xml.match(/<material\b/gi) || []).length;
  out['Nodes'] = (xml.match(/<node\b/gi) || []).length;
  const anims = (xml.match(/<animation\b/gi) || []).length;
  if (anims) out['Animations'] = anims;
  return out;
}
async function parseDae(file) {
  const xml = await headText(file, Math.min(file.size, SAMPLE));
  if (!/<COLLADA/i.test(xml)) return null;
  return parseDaeXml(xml);
}
async function parseZae(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const daeName = zip.names().find((n) => /\.dae$/i.test(n));
  if (!daeName) return null;
  const xml = await zip.text(daeName);
  if (!xml) return null;
  const out = parseDaeXml(xml);
  out['Format'] = 'ZAE (zipped COLLADA)';
  out['Root document'] = daeName;
  const assets = zip.names().filter((n) => !/\/$/.test(n) && n !== daeName);
  if (assets.length) out['_sections'] = [{ title: 'Bundled assets (' + assets.length + ')', node: preBlock(assets.join('\n')) }];
  return out;
}

// ---------- USD Crate (.usdc binary) ----------
async function parseUsdc(file) {
  const b = await head(file, 64);
  if (ascii(b, 0, 8) !== 'PXR-USDC') return null;
  const r = new Reader(b, true); r.seek(8);
  const major = r.u8(), minor = r.u8(), patch = r.u8();
  const out = {
    'Format': 'USD Crate (binary)',
    'Version': major + '.' + minor + '.' + patch,
    'Note': 'Pixar Universal Scene Description, binary crate',
  };
  // TOC offset is a u64 at byte 16
  try {
    r.seek(16); const tocOffset = Number(r.u64());
    if (tocOffset > 0 && tocOffset < file.size) {
      const tb = new Uint8Array(await file.slice(tocOffset, Math.min(file.size, tocOffset + 4096)).arrayBuffer());
      const tr = new Reader(tb, true);
      const sectionCount = Number(tr.u64());
      if (sectionCount > 0 && sectionCount < 64) {
        const names = [];
        for (let i = 0; i < sectionCount && tr.remaining() >= 16; i++) {
          const name = tr.ascii(16).replace(/\0+$/, '').replace(/[^\x20-\x7e]/g, '');
          tr.skip(16); // start + size (u64 each)
          if (name) names.push(name);
        }
        if (names.length) out['TOC sections'] = names.join(', ');
      }
    }
  } catch (_) {}
  return out;
}

// ---------- X3D / VRML ----------
async function parseX3d(file, ext) {
  const text = await headText(file, Math.min(file.size, SAMPLE));
  const isVrml = /^#VRML/i.test(text) || ext === 'wrl' || ext === 'vrml';
  const isX3d = /<X3D/i.test(text) || ext === 'x3d' || ext === 'x3dv';
  if (!isVrml && !isX3d) return null;
  const out = {};
  if (isX3d && /<X3D/i.test(text)) {
    out['Format'] = 'X3D';
    const profile = (text.match(/<X3D[^>]*\bprofile="([^"]+)"/i) || [])[1];
    if (profile) out['Profile'] = profile;
    const version = (text.match(/<X3D[^>]*\bversion="([^"]+)"/i) || [])[1];
    if (version) out['Version'] = version;
    out['Transforms'] = (text.match(/<Transform\b/gi) || []).length;
    out['Shapes'] = (text.match(/<Shape\b/gi) || []).length;
    out['IndexedFaceSets'] = (text.match(/<IndexedFaceSet\b/gi) || []).length;
    out['Materials'] = (text.match(/<Material\b/gi) || []).length;
    out['Viewpoints'] = (text.match(/<Viewpoint\b/gi) || []).length;
  } else {
    out['Format'] = 'VRML';
    const ver = (text.match(/^#VRML\s+(\S+\s+\S+)/i) || [])[1];
    if (ver) out['Header'] = ver.trim();
    out['Transforms'] = (text.match(/\bTransform\s*\{/g) || []).length;
    out['Shapes'] = (text.match(/\bShape\s*\{/g) || []).length;
    out['IndexedFaceSets'] = (text.match(/\bIndexedFaceSet\s*\{/g) || []).length;
    out['Materials'] = (text.match(/\bMaterial\s*\{/g) || []).length;
  }
  if (file.size > SAMPLE) out['Note'] = 'counts from first 2 MB';
  return out;
}

// ---------- LightWave LWO / LWS ----------
async function parseLwo(file, ext) {
  const b = await head(file, Math.min(file.size, SAMPLE));
  if (ext === 'lws') {
    const text = latin1(b);
    if (!/^LWSC/.test(text)) return null;
    const out = { 'Format': 'LightWave Scene (LWS)' };
    const ver = (text.match(/^LWSC\s*\r?\n?\s*(\d+)/) || [])[1];
    if (ver) out['Version'] = ver;
    out['Objects'] = (text.match(/^(LoadObjectLayer|AddNullObject|LoadObject)\b/gm) || []).length;
    out['Lights'] = (text.match(/^AddLight\b/gm) || []).length;
    out['Cameras'] = (text.match(/^AddCamera\b/gm) || []).length;
    const fr = (text.match(/^FirstFrame\s+(\d+)/m) || [])[1];
    const lr = (text.match(/^LastFrame\s+(\d+)/m) || [])[1];
    if (fr || lr) out['Frame range'] = (fr || '?') + ' - ' + (lr || '?');
    return out;
  }
  // LWO: IFF FORM container
  if (ascii(b, 0, 4) !== 'FORM') return null;
  const r = new Reader(b, false); r.seek(4);
  const formLen = r.u32();
  const formType = r.ascii(4);
  if (!/^(LWO2|LWOB|LWO3|LWLO)$/.test(formType)) return null;
  const out = {
    'Format': 'LightWave Object (LWO)',
    'IFF type': formType + (formType === 'LWOB' ? ' (v5.x)' : formType === 'LWO2' ? ' (v6+)' : ''),
  };
  let layers = 0, points = 0, polys = 0, surfaces = 0;
  try {
    while (r.remaining() >= 8) {
      const id = r.ascii(4);
      const len = r.u32();
      const next = r.tell() + len + (len & 1);   // IFF chunks are word-aligned
      if (id === 'LAYR') layers++;
      else if (id === 'PNTS') points += Math.floor(len / 12);
      else if (id === 'POLS') polys++;
      else if (id === 'SURF') surfaces++;
      if (next <= r.tell() || next > b.length) break;
      r.seek(next);
    }
  } catch (_) {}
  out['Layers'] = layers || 1;
  if (points) out['Points'] = points.toLocaleString();
  if (polys) out['Polygon chunks'] = polys;
  if (surfaces) out['Surfaces'] = surfaces;
  if (file.size > SAMPLE) out['Note'] = 'partial (first 2 MB)';
  return out;
}

// ---------- draw.io / diagrams.net ----------
async function parseDrawio(file) {
  const text = await headText(file, Math.min(file.size, SAMPLE));
  if (!/<mxfile|<mxGraphModel/i.test(text)) return null;
  const out = { 'Format': 'draw.io / diagrams.net diagram' };
  const host = (text.match(/<mxfile[^>]*\bhost="([^"]+)"/i) || [])[1];
  if (host) out['Host'] = host;
  const date = (text.match(/<mxfile[^>]*\bmodified="([^"]+)"/i) || [])[1];
  if (date) out['Modified'] = date;
  const agent = (text.match(/<mxfile[^>]*\bagent="([^"]+)"/i) || [])[1];
  if (agent) out['Agent'] = agent.slice(0, 80);
  const diagrams = Array.from(text.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/gi));
  const diagramSelfClose = (text.match(/<diagram\b[^>]*\/>/gi) || []).length;
  out['Pages'] = diagrams.length + diagramSelfClose;
  // Cells may be stored compressed (deflate+base64) inside each <diagram>.
  let cells = 0, vertices = 0, edges = 0, decoded = false;
  let plainCells = (text.match(/<mxCell\b/gi) || []).length;
  if (plainCells) {
    cells = plainCells;
    vertices = (text.match(/vertex="1"/gi) || []).length;
    edges = (text.match(/edge="1"/gi) || []).length;
  } else {
    for (const m of diagrams) {
      const payload = m[1].trim();
      if (!payload || /</.test(payload)) continue;
      try {
        const bin = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
        if (typeof DecompressionStream !== 'undefined') {
          const ds = new DecompressionStream('deflate-raw');
          const stream = new Blob([bin]).stream().pipeThrough(ds);
          const xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
          const inner = decodeURIComponent(utf8(xmlBytes));
          cells += (inner.match(/<mxCell\b/gi) || []).length;
          vertices += (inner.match(/vertex="1"/gi) || []).length;
          edges += (inner.match(/edge="1"/gi) || []).length;
          decoded = true;
        }
      } catch (_) {}
    }
  }
  if (cells) {
    out['Cells'] = cells + (decoded ? ' (decompressed)' : '');
    out['Shapes (vertices)'] = vertices;
    out['Edges'] = edges;
  }
  return out;
}

// ---------- Quake models md2 / md3 / mdl ----------
async function parseQuakeModel(file, ext) {
  const b = await head(file, Math.min(file.size, 1024 * 1024));
  const magic = ascii(b, 0, 4);
  const r = new Reader(b, true);
  if (magic === 'IDP2') {           // Quake II md2
    // header: magic, version, skinwidth, skinheight, framesize,
    //         num_skins, num_xyz, num_st, num_tris, num_glcmds, num_frames
    r.seek(4); const version = r.u32();
    r.skip(12); // skinwidth, skinheight, framesize
    const numSkins = r.u32(), numVerts = r.u32(), numTexcoords = r.u32(), numTris = r.u32();
    r.skip(4); // num_glcmds
    const numFrames = r.u32();
    return {
      'Format': 'Quake II model (MD2)',
      'Version': version,
      'Frames': numFrames.toLocaleString(),
      'Vertices/frame': numVerts.toLocaleString(),
      'Texture coords': numTexcoords.toLocaleString(),
      'Triangles': numTris.toLocaleString(),
      'Skins': numSkins,
    };
  }
  if (magic === 'IDP3') {           // Quake III md3
    r.seek(4); const version = r.u32();
    const name = r.ascii(64).replace(/\0+$/, '').trim();
    r.skip(4); // flags
    const numFrames = r.u32(), numTags = r.u32(), numSurfaces = r.u32(), numSkins = r.u32();
    return {
      'Format': 'Quake III model (MD3)',
      'Version': version,
      'Internal name': name || '-',
      'Frames': numFrames.toLocaleString(),
      'Tags': numTags,
      'Surfaces': numSurfaces,
      'Skins': numSkins,
    };
  }
  if (magic === 'IDPO') {           // Quake I mdl
    r.seek(4); const version = r.u32();
    r.skip(12); // scale vec3
    r.skip(12); // translate vec3
    r.skip(4);  // bounding radius
    r.skip(12); // eye position
    const numSkins = r.u32();
    r.skip(8); // skinwidth, skinheight
    const numVerts = r.u32(), numTris = r.u32(), numFrames = r.u32();
    return {
      'Format': 'Quake model (MDL)',
      'Version': version,
      'Frames': numFrames.toLocaleString(),
      'Vertices': numVerts.toLocaleString(),
      'Triangles': numTris.toLocaleString(),
      'Skins': numSkins,
    };
  }
  return null;
}

// ---------- LAS / LAZ point cloud ----------
async function parseLas(file, ext) {
  const b = await head(file, 384);
  if (ascii(b, 0, 4) !== 'LASF') return null;
  const r = new Reader(b, true); r.seek(4);
  r.skip(2);  // file source id
  r.skip(2);  // global encoding
  r.skip(16); // project GUID
  const verMajor = r.u8(), verMinor = r.u8();
  const systemId = r.ascii(32).replace(/\0+$/, '').trim();
  const genSoft = r.ascii(32).replace(/\0+$/, '').trim();
  const creationDay = r.u16(), creationYear = r.u16();
  const headerSize = r.u16();
  const offsetToData = r.u32();
  const numVlr = r.u32();
  const pointFormat = r.u8();
  const pointLen = r.u16();
  let pointCount = r.u32();          // legacy 32-bit count
  r.skip(5 * 4);                     // legacy points-by-return (5 x u32)
  const sx = r.f64(), sy = r.f64(), sz = r.f64();
  const ox = r.f64(), oy = r.f64(), oz = r.f64();
  const maxX = r.f64(), minX = r.f64();
  const maxY = r.f64(), minY = r.f64();
  const maxZ = r.f64(), minZ = r.f64();
  // 1.4 introduced a 64-bit point count at offset 247
  if (verMajor === 1 && verMinor >= 4 && b.length >= 255) {
    try { const r2 = new Reader(b, true); r2.seek(247); const big = Number(r2.u64()); if (big > 0) pointCount = big; } catch (_) {}
  }
  const fmtHasGps = pointFormat === 1 || pointFormat >= 3;
  const fmtHasRgb = pointFormat === 2 || pointFormat === 3 || pointFormat === 5 || pointFormat === 7 || pointFormat === 8 || pointFormat === 10;
  const out = {
    'Format': ext === 'laz' ? 'LAZ (compressed LAS)' : 'LAS point cloud',
    'LAS version': verMajor + '.' + verMinor,
    'Point format': pointFormat + ' (' + pointLen + ' bytes/point)',
    'Points': pointCount.toLocaleString(),
  };
  if (genSoft) out['Generating software'] = genSoft;
  if (systemId) out['System ID'] = systemId;
  if (creationYear) out['Created'] = 'day ' + creationDay + ', ' + creationYear;
  out['X bounds'] = minX.toFixed(3) + ' .. ' + maxX.toFixed(3);
  out['Y bounds'] = minY.toFixed(3) + ' .. ' + maxY.toFixed(3);
  out['Z bounds'] = minZ.toFixed(3) + ' .. ' + maxZ.toFixed(3);
  out['Scale (x,y,z)'] = [sx, sy, sz].join(', ');
  out['Offset (x,y,z)'] = [ox, oy, oz].join(', ');
  out['GPS time'] = fmtHasGps ? 'yes' : 'no';
  out['RGB colour'] = fmtHasRgb ? 'yes' : 'no';
  out['VLR records'] = numVlr;
  if (ext === 'laz') out['Compression'] = 'LASzip (LAZ)';
  return out;
}

// ---------- PCD (Point Cloud Data) ----------
async function parsePcd(file) {
  const text = await headText(file, 8192);
  if (!/(^|\n)\s*(#|VERSION|FIELDS)/i.test(text.slice(0, 200)) && !/POINTS/.test(text)) return null;
  const line = (kw) => { const m = text.match(new RegExp('^' + kw + '\\s+(.+)$', 'mi')); return m ? m[1].trim() : null; };
  const fields = line('FIELDS');
  const points = line('POINTS');
  if (!fields && !points) return null;
  const out = { 'Format': 'PCD (Point Cloud Data)' };
  const version = line('VERSION'); if (version) out['Version'] = version;
  if (fields) out['Fields'] = fields;
  const size = line('SIZE'); if (size) out['Field sizes'] = size;
  const type = line('TYPE'); if (type) out['Field types'] = type;
  const width = line('WIDTH'), height = line('HEIGHT');
  if (width || height) out['Dimensions'] = (width || '?') + ' x ' + (height || '?');
  if (points) out['Points'] = (parseInt(points, 10) || points).toLocaleString();
  const vp = line('VIEWPOINT'); if (vp) out['Viewpoint'] = vp;
  const data = line('DATA'); if (data) out['Data encoding'] = data;
  return out;
}

// ---------- PTS / PTX ASCII point clouds ----------
async function parsePtsPtx(file, ext) {
  const text = await headText(file, Math.min(file.size, SAMPLE));
  const lines = text.split(/\r?\n/);
  let i = 0;
  const nextNonEmpty = () => { while (i < lines.length) { const l = lines[i++].trim(); if (l) return l; } return null; };
  if (ext === 'ptx') {
    // PTX: cols, rows, then 4 lines scanner position (1x3) + 3x3 axes, then 4x4 transform
    const cols = nextNonEmpty(), rows = nextNonEmpty();
    if (!/^\d+$/.test(cols || '') || !/^\d+$/.test(rows || '')) return null;
    const out = { 'Format': 'PTX point cloud (Leica/Cyclone)' };
    out['Grid'] = cols + ' cols x ' + rows + ' rows';
    out['Declared points'] = (parseInt(cols, 10) * parseInt(rows, 10)).toLocaleString();
    // 4 lines scanner registration (position + 3 axis vectors), then 4 lines matrix
    const reg = [];
    for (let k = 0; k < 4; k++) { const l = nextNonEmpty(); if (l) reg.push(l); }
    const mat = [];
    for (let k = 0; k < 4; k++) { const l = nextNonEmpty(); if (l) mat.push(l); }
    if (mat.length === 4 && mat.every((l) => l.split(/\s+/).length === 4)) {
      out['_sections'] = [{ title: 'Registration (4x4 matrix)', node: preBlock(mat.join('\n')) }];
    }
    // first data line column count
    const first = nextNonEmpty();
    if (first) out['Columns/point'] = describePtsCols(first.split(/\s+/).length);
    return out;
  }
  // PTS: optional count header then rows of "x y z [intensity] [r g b]"
  const first = nextNonEmpty();
  if (!first) return null;
  const out = { 'Format': 'PTS point cloud' };
  let dataLine = first;
  if (/^\d+$/.test(first)) { out['Declared points'] = parseInt(first, 10).toLocaleString(); dataLine = nextNonEmpty(); }
  if (!dataLine) return null;
  const cols = dataLine.split(/\s+/).length;
  out['Columns/point'] = describePtsCols(cols);
  // bbox over sampled lines
  const bb = newBbox(); let counted = 0;
  for (; i < lines.length; i++) {
    const p = lines[i].trim().split(/\s+/);
    const x = +p[0], y = +p[1], z = +p[2];
    if (isFinite(x) && isFinite(y) && isFinite(z)) { bboxAdd(bb, x, y, z); counted++; }
  }
  const box = fmtBbox(bb);
  if (box) out['Bounding box (sampled)'] = box;
  out['Sampled points'] = counted.toLocaleString() + (file.size > SAMPLE ? ' (first 2 MB)' : '');
  return out;
}
function describePtsCols(n) {
  if (n >= 7) return n + ' (XYZ + intensity + RGB)';
  if (n === 6) return '6 (XYZ + RGB)';
  if (n === 4) return '4 (XYZ + intensity)';
  if (n === 3) return '3 (XYZ)';
  return String(n);
}

// ---------- E57 ----------
async function parseE57(file) {
  const b = await head(file, 64);
  if (ascii(b, 0, 8) !== 'ASTM-E57') return null;
  const r = new Reader(b, true); r.seek(8);
  const verMajor = r.u16(), verMinor = r.u16();
  const fileLen = Number(r.u64());
  const xmlOffset = Number(r.u64());
  const xmlLength = Number(r.u64());
  const out = {
    'Format': 'E57 point cloud (ASTM E57)',
    'Version': verMajor + '.' + verMinor,
    'File length': fmtBytes(fileLen),
  };
  // The XML section at the file tail holds scan metadata.
  if (xmlOffset > 0 && xmlLength > 0 && xmlOffset + Math.min(xmlLength, 524288) <= file.size) {
    try {
      const xml = await file.slice(xmlOffset, xmlOffset + Math.min(xmlLength, 524288)).text();
      const scans = (xml.match(/<vectorChild\b/gi) || []).length || (xml.match(/type="Structure"/gi) || []).length;
      const data3d = (xml.match(/<data3D\b/i) ? (xml.match(/<vectorChild\b/gi) || []).length : 0);
      const guid = (xml.match(/<guid[^>]*>([^<]+)<\/guid>/i) || [])[1];
      const sensorVendor = (xml.match(/<sensorVendor[^>]*>([^<]+)<\/sensorVendor>/i) || [])[1];
      const sensorModel = (xml.match(/<sensorModel[^>]*>([^<]+)<\/sensorModel>/i) || [])[1];
      const records = Array.from(xml.matchAll(/<records\b[^>]*>(\d+)<\/records>/gi)).reduce((a, m) => a + (parseInt(m[1], 10) || 0), 0);
      const ts = (xml.match(/<dateTimeValue[^>]*>([^<]+)<\/dateTimeValue>/i) || [])[1];
      if (scans) out['Scans (data3D)'] = scans;
      if (records) out['Total point records'] = records.toLocaleString();
      if (sensorVendor || sensorModel) out['Sensor'] = [sensorVendor, sensorModel].filter(Boolean).join(' ');
      if (ts) out['Timestamp'] = ts;
      if (guid) out['GUID'] = guid;
    } catch (_) {}
  }
  return out;
}

// ---------- IFC (STEP) / IFCZIP ----------
function parseIfcText(text) {
  const out = { 'Format': 'IFC (Industry Foundation Classes)' };
  const schema = (text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i) || [])[1];
  if (schema) out['Schema'] = schema;
  const nameM = text.match(/FILE_NAME\s*\(([\s\S]*?)\)\s*;/i);
  if (nameM) {
    const parts = nameM[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    if (parts[0]) out['File name'] = parts[0];
    if (parts[1]) out['Timestamp'] = parts[1];
    const app = (nameM[1].match(/'([^']*(?:Revit|ArchiCAD|Tekla|Allplan|Bentley|IfcOpenShell|BlenderBIM)[^']*)'/i) || [])[1];
    if (app) out['Application'] = app;
  }
  const count = (e) => (text.match(new RegExp('=\\s*' + e + '\\(', 'gi')) || []).length;
  out['IfcWall'] = count('IFCWALL');
  out['IfcDoor'] = count('IFCDOOR');
  out['IfcWindow'] = count('IFCWINDOW');
  out['IfcSpace'] = count('IFCSPACE');
  out['IfcBuildingStorey'] = count('IFCBUILDINGSTOREY');
  return out;
}
async function parseIfc(file) {
  const text = await headText(file, Math.min(file.size, SAMPLE));
  if (!/ISO-10303-21|FILE_SCHEMA/i.test(text)) return null;
  const out = parseIfcText(text);
  if (file.size > SAMPLE) out['Note'] = 'entity counts from first 2 MB';
  return out;
}
async function parseIfcZip(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const name = zip.names().find((n) => /\.ifc$/i.test(n));
  if (!name) return null;
  const text = await zip.text(name);
  if (!text) return null;
  const out = parseIfcText(text);
  out['Format'] = 'IFCZIP (compressed IFC)';
  out['Inner file'] = name;
  return out;
}

// ---------- VRM (glTF + VRM extension) ----------
async function parseVrm(file) {
  // VRM is a GLB; the JSON chunk holds the VRM extension.
  const b = await head(file, Math.min(file.size, 4 * 1024 * 1024));
  if (ascii(b, 0, 4) !== 'glTF') return null;
  const r = new Reader(b, true); r.seek(12);
  let json = null;
  try {
    while (r.remaining() >= 8) {
      const len = r.u32();
      const type = r.u32();
      if (type === 0x4E4F534A) {   // 'JSON'
        json = utf8(r.bytes_(len));
        break;
      }
      r.skip(len);
    }
  } catch (_) {}
  if (!json) return null;
  let j; try { j = JSON.parse(json); } catch (_) { return null; }
  const ext = (j.extensions && (j.extensions.VRM || j.extensions.VRMC_vrm)) || null;
  const out = { 'Format': 'VRM avatar (glTF)' };
  if (j.asset && j.asset.generator) out['Generator'] = j.asset.generator;
  const meta = ext && (ext.meta || ext);
  if (meta) {
    const title = meta.title || meta.name; if (title) out['Title'] = title;
    const author = meta.author || (Array.isArray(meta.authors) ? meta.authors.join(', ') : null); if (author) out['Author'] = author;
    const license = meta.licenseName || meta.licenseUrl || meta.commercialUssageName || meta.avatarPermission; if (license) out['License'] = String(license);
    out['VRM spec'] = j.extensions && j.extensions.VRMC_vrm ? '1.0' : '0.x';
  }
  const humanoid = ext && (ext.humanoid || (ext.humanBones && ext));
  if (ext && ext.humanoid && Array.isArray(ext.humanoid.humanBones)) out['Humanoid bones'] = ext.humanoid.humanBones.length;
  else if (ext && ext.humanBones) out['Humanoid bones'] = Array.isArray(ext.humanBones) ? ext.humanBones.length : Object.keys(ext.humanBones).length;
  const bs = ext && (ext.blendShapeMaster || ext.expressions || ext.blendShape);
  if (bs && bs.blendShapeGroups) out['Blendshapes'] = bs.blendShapeGroups.length;
  else if (bs && bs.preset) out['Blendshapes'] = Object.keys(bs.preset).length;
  out['Meshes'] = (j.meshes || []).length;
  out['Materials'] = (j.materials || []).length;
  out['Textures'] = (j.textures || []).length;
  return out;
}

// ---------- JT (Jupiter Tessellation) ----------
async function parseJt(file) {
  const b = await head(file, 80);
  // Version header is an 80-byte ASCII string starting with "Version"
  const hdr = latin1(b.subarray(0, 80));
  if (!/^Version\s/i.test(hdr)) return null;
  const out = { 'Format': 'JT (Jupiter Tessellation)' };
  const ver = (hdr.match(/^Version\s+([\d.]+)/i) || [])[1];
  if (ver) out['JT version'] = ver;
  out['Version header'] = hdr.replace(/\0+/g, '').trim().slice(0, 80);
  // TOC count follows the GUID after the 80-byte header (offset 80 + 16 GUID = 96)
  try {
    const tb = new Uint8Array(await file.slice(80, 200).arrayBuffer());
    const tr = new Reader(tb, true);
    tr.skip(16); // GUID
    const tocOffset = Number(tr.u64 ? tr.u64() : tr.u32());
    if (tocOffset > 0 && tocOffset < file.size) {
      const cb = new Uint8Array(await file.slice(tocOffset, tocOffset + 4).arrayBuffer());
      const cr = new Reader(cb, true);
      const entryCount = cr.u32();
      if (entryCount > 0 && entryCount < 1e6) out['TOC segments'] = entryCount;
    }
  } catch (_) {}
  out['Note'] = 'Siemens NX / Teamcenter tessellated 3D';
  return out;
}

// ---------- Gaussian splats: .splat / .spz ----------
async function parseSplat(file) {
  // Antimatter15 .splat: packed 32-byte records (pos f32x3, scale f32x3, rgba u8x4, rot u8x4)
  if (file.size < 32 || file.size % 32 !== 0) {
    // still report if close - but require exact multiple to identify
    if (file.size % 32 !== 0) return { 'Format': 'Gaussian splat (.splat)', 'Note': 'size not a multiple of 32 - non-standard layout', 'File size': fmtBytes(file.size) };
  }
  const count = Math.floor(file.size / 32);
  const out = {
    'Format': 'Gaussian splat (.splat)',
    'Splats': count.toLocaleString(),
    'Record size': '32 bytes',
  };
  // bbox from sampled positions (first 3 f32 of each record)
  try {
    const n = Math.min(count, 200000);
    const b = new Uint8Array(await file.slice(0, n * 32).arrayBuffer());
    const r = new Reader(b, true);
    const bb = newBbox();
    for (let k = 0; k < n; k++) {
      const x = r.f32(), y = r.f32(), z = r.f32();
      r.skip(32 - 12);
      if (isFinite(x) && isFinite(y) && isFinite(z)) bboxAdd(bb, x, y, z);
    }
    const box = fmtBbox(bb);
    if (box) out['Bounding box' + (n < count ? ' (sampled)' : '')] = box;
  } catch (_) {}
  return out;
}
async function parseSpz(file) {
  const raw = await head(file, 64);
  let b = raw;
  // SPZ payload is gzip-compressed.
  if (raw[0] === 0x1F && raw[1] === 0x8B) {
    const all = new Uint8Array(await file.arrayBuffer());
    const inf = await gunzip(all);
    if (inf) b = inf;
  }
  // header: magic u32 (0x5053474E 'NGSP'), version u32, numPoints u32, shDegree u8, ...
  const r = new Reader(b, true);
  const magic = r.u32();
  if (magic !== 0x5053474e) {
    // try big-endian / ascii fallback
    if (ascii(b, 0, 4) !== 'NGSP') return null;
  }
  const version = r.u32();
  const numPoints = r.u32();
  const shDegree = r.u8();
  const fractionalBits = r.u8();
  const flags = r.u8();
  return {
    'Format': 'SPZ (compressed Gaussian splat)',
    'Version': version,
    'Splats': (numPoints >>> 0).toLocaleString(),
    'SH degree': shDegree,
    'Fractional bits': fractionalBits,
    'Antialiased': (flags & 0x1) ? 'yes' : 'no',
    'Note': 'Niantic / Scaniverse compressed 3DGS',
  };
}

// ---------- identification-only (rare AND hard) ----------
function ident(name, note) {
  return () => ({ 'Format': name, 'Note': note });
}
async function parseAbc(file) {
  const b = await head(file, 16);
  // Ogawa: 'Ogawa' magic; HDF5: \x89HDF
  let variant = 'unknown';
  if (ascii(b, 0, 5) === 'Ogawa') variant = 'Ogawa';
  else if (b[0] === 0x89 && ascii(b, 1, 3) === 'HDF') variant = 'HDF5 (legacy)';
  return {
    'Format': 'Alembic (ABC)',
    'Container': variant,
    'Note': 'Animated 3D cache (Maya/Houdini). Full hierarchy decode needs the Alembic library.',
  };
}
async function parseVdb(file) {
  const b = await head(file, 16);
  // OpenVDB magic: 0x56 0x44 0x42 0x00 ... (or starts with 0x20 0x42 0x44 0x56 LE)
  return {
    'Format': 'OpenVDB',
    'Note': 'Sparse volumetric grids (Houdini/Blender). Grid metadata decode needs the OpenVDB library.',
  };
}

// ---------- dispatch ----------
export const PARSERS = {
  // meshes / scenes (already in FORMATS as identification - add richer parse)
  obj:   (c) => parseObj(c.file),
  ply:   (c) => parsePly(c.file),
  gltf:  (c) => parseGltf(c.file),
  '3mf': (c) => parse3mf(c.file),
  amf:   (c) => parseAmf(c.file),

  // new mesh / scene formats
  off:   (c) => parseOff(c.file),
  vox:   (c) => parseVox(c.file),
  dae:   (c) => parseDae(c.file),
  zae:   (c) => parseZae(c.file),
  usdc:  (c) => parseUsdc(c.file),
  x3d:   (c) => parseX3d(c.file, c.ext),
  x3dv:  (c) => parseX3d(c.file, c.ext),
  wrl:   (c) => parseX3d(c.file, c.ext),
  vrml:  (c) => parseX3d(c.file, c.ext),
  lwo:   (c) => parseLwo(c.file, c.ext),
  lws:   (c) => parseLwo(c.file, c.ext),
  drawio: (c) => parseDrawio(c.file),
  dio:   (c) => parseDrawio(c.file),
  md2:   (c) => parseQuakeModel(c.file, c.ext),
  md3:   (c) => parseQuakeModel(c.file, c.ext),
  mdl:   (c) => parseQuakeModel(c.file, c.ext),
  vrm:   (c) => parseVrm(c.file),
  jt:    (c) => parseJt(c.file),

  // point clouds
  las:   (c) => parseLas(c.file, c.ext),
  laz:   (c) => parseLas(c.file, c.ext),
  pcd:   (c) => parsePcd(c.file),
  pts:   (c) => parsePtsPtx(c.file, c.ext),
  ptx:   (c) => parsePtsPtx(c.file, c.ext),
  e57:   (c) => parseE57(c.file),

  // BIM / CAD exchange
  ifc:    (c) => parseIfc(c.file),
  ifczip: (c) => parseIfcZip(c.file),

  // Gaussian splats
  splat: (c) => parseSplat(c.file),
  spz:   (c) => parseSpz(c.file),

  // identification-only (rare AND hard)
  abc:   (c) => parseAbc(c.file),
  vdb:   (c) => parseVdb(c.file),
  prc:   ident('PRC (3D PDF)', 'Adobe/ISO 3D PDF stream. Tessellation/B-rep decode needs a dedicated PRC reader.'),
  fls:   ident('FARO scan (FLS)', 'FARO laser-scan project. Proprietary binary - identification only.'),
  fws:   ident('FARO workspace (FWS)', 'FARO scan workspace. Proprietary binary - identification only.'),
};
