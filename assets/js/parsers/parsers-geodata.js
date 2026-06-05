/* Analyser - lazy parser chunk: geospatial / GIS / remote-sensing formats.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'geodata'` is opened. Each entry in PARSERS is
   `({head, file, ext}) => rows` where `head` is the first ~4096 bytes, and
   `rows` is a plain object of label->value pairs (rendered as a readout),
   optionally carrying `_sections: [{title, node, open?}]` for collapsible blocks.
   Return null to fall back to the generic identification card.

   HEADER / METADATA ONLY — there is a separate map renderer (geo.js) for
   gpx/kml/geojson; this chunk covers the *other* geospatial formats with no map. */

import { el, row, fmtBytes, preBlock } from '../core/util.js';
import { Reader, ascii, findBytes, latin1, utf8 } from '../core/binutil.js';
import { sqliteSummary } from '../lib/sqlite.js';

// ---------- small helpers ----------

// Read up to `max` bytes of the file as text (UTF-8, lossy).
async function readText(file, max = 1_000_000) {
  return await file.slice(0, Math.min(file.size, max)).text();
}
// Read up to `max` bytes of the file as a Uint8Array.
async function readBytes(file, max) {
  const n = max == null ? file.size : Math.min(file.size, max);
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

// Format a coordinate to a sensible number of decimals.
const fc = (n) => (typeof n === 'number' && isFinite(n)) ? (+n.toFixed(6)).toString() : '-';
// Format a latitude/longitude bounding box.
function fmtBBox(minX, minY, maxX, maxY) {
  return 'X ' + fc(minX) + ' … ' + fc(maxX) + '  |  Y ' + fc(minY) + ' … ' + fc(maxY);
}

// Tally occurrences and render the top-N as "key (n)".
function topCounts(map, n = 12) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => k + ' (' + v + ')').join(', ');
}

// =====================================================================
//  TopoJSON
// =====================================================================
async function parseTopojson(file) {
  let j; try { j = JSON.parse(await readText(file, 16_000_000)); } catch (_) { return null; }
  if (!j || j.type !== 'Topology' || typeof j.objects !== 'object') return null;
  const out = { 'Format': 'TopoJSON (D3 topology)' };
  const layers = Object.keys(j.objects || {});
  out['Objects / layers'] = layers.length + (layers.length ? ': ' + layers.slice(0, 12).join(', ') : '');
  out['Arcs'] = Array.isArray(j.arcs) ? j.arcs.length.toLocaleString() : 0;
  // Count geometries across all layers.
  let geoms = 0; const byType = {};
  const walk = (g) => {
    if (!g) return;
    if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) { g.geometries.forEach(walk); return; }
    geoms++; if (g.type) byType[g.type] = (byType[g.type] || 0) + 1;
  };
  for (const k of layers) walk(j.objects[k]);
  out['Geometries'] = geoms.toLocaleString();
  if (Object.keys(byType).length) out['Geometry types'] = topCounts(byType);
  if (j.transform) {
    const t = j.transform;
    if (Array.isArray(t.scale)) out['Transform scale'] = t.scale.map((n) => fc(n)).join(', ');
    if (Array.isArray(t.translate)) out['Transform translate'] = t.translate.map((n) => fc(n)).join(', ');
    out['Quantised'] = 'yes (delta-encoded arcs)';
  }
  if (Array.isArray(j.bbox) && j.bbox.length === 4) out['Bounding box'] = fmtBBox(j.bbox[0], j.bbox[1], j.bbox[2], j.bbox[3]);
  return out;
}

// =====================================================================
//  OSM XML
// =====================================================================
async function parseOsm(file) {
  const text = await readText(file, 8_000_000);
  if (!/<osm\b/.test(text)) return null;
  const out = { 'Format': 'OpenStreetMap XML' };
  const gen = (text.match(/<osm\b[^>]*\bgenerator\s*=\s*"([^"]*)"/) || [])[1];
  const ver = (text.match(/<osm\b[^>]*\bversion\s*=\s*"([^"]*)"/) || [])[1];
  if (ver) out['API version'] = ver;
  if (gen) out['Generator'] = gen;
  const count = (re) => (text.match(re) || []).length;
  const nodes = count(/<node\b/g);
  const ways = count(/<way\b/g);
  const rels = count(/<relation\b/g);
  out['Nodes'] = nodes.toLocaleString();
  out['Ways'] = ways.toLocaleString();
  out['Relations'] = rels.toLocaleString();
  // Common tag keys.
  const tags = {};
  let m; const re = /<tag\b[^>]*\bk\s*=\s*"([^"]*)"/g;
  while ((m = re.exec(text))) tags[m[1]] = (tags[m[1]] || 0) + 1;
  if (Object.keys(tags).length) out['Top tag keys'] = topCounts(tags, 14);
  const b = text.match(/<bounds\b[^>]*\bminlat\s*=\s*"([^"]*)"[^>]*\bminlon\s*=\s*"([^"]*)"[^>]*\bmaxlat\s*=\s*"([^"]*)"[^>]*\bmaxlon\s*=\s*"([^"]*)"/);
  if (b) out['Bounds'] = fmtBBox(+b[2], +b[1], +b[4], +b[3]);
  if (text.length >= 8_000_000) out['Note'] = 'counts cover the first 8 MB only';
  return out;
}

// =====================================================================
//  Shapefile family
// =====================================================================
const SHP_TYPES = {
  0: 'Null', 1: 'Point', 3: 'PolyLine', 5: 'Polygon', 8: 'MultiPoint',
  11: 'PointZ', 13: 'PolyLineZ', 15: 'PolygonZ', 18: 'MultiPointZ',
  21: 'PointM', 23: 'PolyLineM', 25: 'PolygonM', 28: 'MultiPointM', 31: 'MultiPatch',
};

// Parse the shared 100-byte .shp / .shx header (big-endian code + LE body).
function shpHeader(head) {
  if (head.length < 100) return null;
  const r = new Reader(head); // big-endian
  const code = r.u32();
  if (code !== 9994) return null;
  r.seek(24);
  const wordLen = r.u32();            // file length in 16-bit words (incl. header)
  r.le(true);
  const version = r.u32();
  const shapeType = r.u32();
  const minX = r.f64(), minY = r.f64(), maxX = r.f64(), maxY = r.f64();
  const minZ = r.f64(), maxZ = r.f64(), minM = r.f64(), maxM = r.f64();
  return { wordLen, version, shapeType, minX, minY, maxX, maxY, minZ, maxZ, minM, maxM };
}

async function parseShp(file) {
  const head = await readBytes(file, 100);
  const h = shpHeader(head);
  if (!h) return null;
  const out = {
    'Format': 'ESRI Shapefile (.shp geometry)',
    'Shape type': (SHP_TYPES[h.shapeType] || 'type ' + h.shapeType),
    'File length': fmtBytes(h.wordLen * 2),
    'Bounding box': fmtBBox(h.minX, h.minY, h.maxX, h.maxY),
  };
  if (h.minZ || h.maxZ) out['Z range'] = fc(h.minZ) + ' … ' + fc(h.maxZ);
  if (h.minM || h.maxM) out['M range'] = fc(h.minM) + ' … ' + fc(h.maxM);
  // Count records by walking record headers (each: 4-byte BE record no + 4-byte BE content length in words).
  try {
    const buf = await readBytes(file, Math.min(file.size, 8_000_000));
    const r = new Reader(buf); // big-endian
    r.seek(100);
    let records = 0;
    while (r.remaining() >= 8) {
      r.u32();                          // record number
      const contentWords = r.u32();     // content length in 16-bit words
      const len = contentWords * 2;
      if (len < 0 || len > buf.length) break;
      if (r.remaining() < len) { records++; break; }
      r.skip(len);
      records++;
      if (records > 2_000_000) break;
    }
    out['Features'] = records.toLocaleString() + (file.size > 8_000_000 ? ' (first 8 MB)' : '');
  } catch (_) {}
  out['Companion files'] = '.dbf (attributes), .shx (index), .prj (CRS)';
  return out;
}

async function parseShx(file) {
  const head = await readBytes(file, 100);
  const h = shpHeader(head);
  if (!h) return null;
  // .shx body is fixed 8-byte records (offset + content length).
  const bodyBytes = h.wordLen * 2 - 100;
  const features = bodyBytes > 0 ? Math.floor(bodyBytes / 8) : 0;
  return {
    'Format': 'Shapefile index (.shx)',
    'Shape type': (SHP_TYPES[h.shapeType] || 'type ' + h.shapeType),
    'Features': features.toLocaleString(),
    'Bounding box': fmtBBox(h.minX, h.minY, h.maxX, h.maxY),
    'File length': fmtBytes(h.wordLen * 2),
  };
}

// dBASE field type names.
const DBF_TYPES = { C: 'Character', N: 'Numeric', F: 'Float', L: 'Logical', D: 'Date', M: 'Memo', B: 'Binary', G: 'General', P: 'Picture', '@': 'Timestamp', I: 'Integer', '+': 'Autoincrement', O: 'Double', T: 'DateTime', Y: 'Currency' };
const DBF_VERSIONS = { 0x02: 'FoxBASE', 0x03: 'dBASE III+', 0x04: 'dBASE IV', 0x05: 'dBASE V', 0x30: 'Visual FoxPro', 0x31: 'Visual FoxPro (autoinc)', 0x43: 'dBASE IV SQL table', 0x83: 'dBASE III+ with memo', 0x8b: 'dBASE IV with memo', 0xf5: 'FoxPro 2 with memo', 0xfb: 'FoxPro' };

async function parseDbf(file) {
  const head = await readBytes(file, 4096);
  if (head.length < 32) return null;
  const ver = head[0];
  if (!DBF_VERSIONS[ver] && (ver & 0x07) !== 0x03) return null; // loose validity gate
  const r = new Reader(head, true);
  r.seek(0); const versionByte = r.u8();
  const yy = r.u8(), mm = r.u8(), dd = r.u8();
  const numRecords = r.u32();
  const headerLen = r.u16();
  const recordLen = r.u16();
  const year = yy < 80 ? 2000 + yy : 1900 + yy;
  const out = {
    'Format': 'dBASE table (.dbf)',
    'Version': DBF_VERSIONS[versionByte] || ('byte 0x' + versionByte.toString(16)),
    'Last update': year + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0'),
    'Records': numRecords.toLocaleString(),
    'Record length': recordLen + ' bytes',
  };
  // Field descriptors: 32 bytes each from offset 32 until 0x0D terminator.
  const fields = [];
  let p = 32;
  while (p + 32 <= head.length && head[p] !== 0x0d) {
    const name = ascii(head, p, 11).replace(/\0.*$/, '');
    const type = String.fromCharCode(head[p + 11]);
    const length = head[p + 16];
    const dec = head[p + 17];
    fields.push({ name, type, length, dec });
    p += 32;
    if (fields.length > 255) break;
  }
  out['Fields'] = fields.length;
  if (fields.length) {
    const lines = fields.map((f) => `${f.name}  ${DBF_TYPES[f.type] || f.type}(${f.length}${f.dec ? ',' + f.dec : ''})`);
    out._sections = [{ title: 'Field definitions (' + fields.length + ')', node: preBlock(lines.join('\n')), open: true }];
  }
  return out;
}

async function parsePrj(file) {
  const text = (await readText(file, 64_000)).trim();
  if (!/^(GEOGCS|PROJCS|GEOGCRS|PROJCRS|BOUNDCRS|COMPD_CS|LOCAL_CS|VERTCS|ENGCRS)/i.test(text)) return null;
  const out = { 'Format': 'Projection / WKT CRS (.prj)' };
  const grab = (kw) => { const m = text.match(new RegExp(kw + '\\s*\\[\\s*"([^"]+)"', 'i')); return m ? m[1] : null; };
  const projcs = grab('PROJCS') || grab('PROJCRS');
  const geogcs = grab('GEOGCS') || grab('GEOGCRS');
  out['CRS name'] = projcs || geogcs || '(unnamed)';
  if (projcs && geogcs) out['Geographic CRS'] = geogcs;
  const proj = (text.match(/PROJECTION\s*\[\s*"([^"]+)"/i) || [])[1];
  if (proj) out['Projection'] = proj;
  const datum = grab('DATUM');
  if (datum) out['Datum'] = datum;
  const spheroid = (text.match(/SPHEROID\s*\[\s*"([^"]+)"/i) || [])[1];
  if (spheroid) out['Spheroid'] = spheroid;
  const unit = (text.match(/UNIT\s*\[\s*"([^"]+)"/i) || [])[1];
  if (unit) out['Units'] = unit;
  // EPSG / authority code — last AUTHORITY or ID is usually the CRS code.
  const auth = Array.from(text.matchAll(/(?:AUTHORITY|ID)\s*\[\s*"([^"]+)"\s*,\s*"?(\d+)"?/gi));
  if (auth.length) { const a = auth[auth.length - 1]; out['EPSG / authority'] = a[1] + ':' + a[2]; }
  out._sections = [{ title: 'WKT', node: preBlock(text.length > 8000 ? text.slice(0, 8000) + '\n…' : text) }];
  return out;
}

async function parseCpg(file) {
  const enc = (await readText(file, 256)).trim();
  if (!enc || enc.length > 64 || /[\x00]/.test(enc)) return null;
  return {
    'Format': 'Code page file (.cpg)',
    'Declared encoding': enc,
    'Note': 'Specifies the character encoding of the companion .dbf attribute table',
  };
}

// =====================================================================
//  World files (.pgw / .tfw / .jgw / .wld / etc.)
// =====================================================================
async function parseWorldFile(file, ext) {
  const text = (await readText(file, 4096)).trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length < 6) return null;
  const v = lines.slice(0, 6).map(Number);
  if (v.some((n) => !isFinite(n))) return null;
  const [A, D, B, E, C, F] = v;
  const raster = { pgw: 'PNG', tfw: 'TIFF', jgw: 'JPEG', gfw: 'GIF', bpw: 'BMP', wld: 'image' }[ext] || 'image';
  return {
    'Format': 'World file (.' + ext + ', georeferencing for ' + raster + ')',
    'Pixel size X': fc(A),
    'Pixel size Y': fc(E),
    'Rotation (row/col)': fc(D) + ' / ' + fc(B),
    'Top-left X (center)': fc(C),
    'Top-left Y (center)': fc(F),
    'Note': 'Six affine coefficients; pairs with a same-named raster image',
  };
}

// =====================================================================
//  GML
// =====================================================================
async function parseGml(file) {
  const text = await readText(file, 8_000_000);
  if (!/<(?:\w+:)?(?:FeatureCollection|featureMember|gml:|boundedBy)/i.test(text) && !/xmlns[^=]*=["'][^"']*\/gml/i.test(text)) {
    if (!/\bgml\b/i.test(text)) return null;
  }
  const out = { 'Format': 'Geography Markup Language (GML)' };
  const members = (text.match(/<(?:\w+:)?featureMember[\s>]/gi) || []).length
    + (text.match(/<(?:\w+:)?member[\s>]/gi) || []).length;
  if (members) out['Feature members'] = members.toLocaleString();
  // Feature type tags inside featureMember (best effort): collect element local-names that repeat.
  const types = {};
  let m; const re = /<(\w+):(\w+)[\s>\/]/g;
  while ((m = re.exec(text))) {
    const pfx = m[1].toLowerCase(), name = m[2];
    if (pfx === 'gml' || pfx === 'xsd' || pfx === 'xs' || pfx === 'wfs' || pfx === 'ogc' || pfx === 'xlink') continue;
    types[name] = (types[name] || 0) + 1;
  }
  const typeNames = Object.keys(types);
  if (typeNames.length) out['Feature types'] = topCounts(types, 12);
  const srs = (text.match(/srsName\s*=\s*"([^"]+)"/) || [])[1];
  if (srs) out['CRS (srsName)'] = srs;
  // boundedBy envelope.
  const env = text.match(/<(?:\w+:)?Envelope\b[\s\S]*?<\/(?:\w+:)?Envelope>/i) || text.match(/<(?:\w+:)?Box\b[\s\S]*?<\/(?:\w+:)?Box>/i);
  if (env) {
    const coords = (env[0].match(/-?\d+\.?\d*(?:[eE][-+]?\d+)?/g) || []).map(Number);
    if (coords.length >= 4) out['boundedBy'] = fmtBBox(coords[0], coords[1], coords[2], coords[3]);
  }
  if (text.length >= 8_000_000) out['Note'] = 'counts cover the first 8 MB only';
  return out;
}

// =====================================================================
//  NMEA 0183
// =====================================================================
function nmeaChecksumOk(line) {
  const star = line.lastIndexOf('*');
  if (star < 0 || star + 3 > line.length) return null;
  let cs = 0;
  for (let i = 1; i < star; i++) cs ^= line.charCodeAt(i);
  const want = parseInt(line.slice(star + 1, star + 3), 16);
  return cs === want;
}
// NMEA ddmm.mmmm -> decimal degrees.
function nmeaCoord(val, hemi) {
  if (!val) return null;
  const f = parseFloat(val); if (!isFinite(f)) return null;
  const deg = Math.floor(f / 100);
  const min = f - deg * 100;
  let dec = deg + min / 60;
  if (hemi === 'S' || hemi === 'W') dec = -dec;
  return dec;
}
async function parseNmea(file) {
  const text = await readText(file, 4_000_000);
  const lines = text.split(/\r?\n/);
  let fixes = 0, csOk = 0, csBad = 0, sats = 0, hdop = null;
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  let firstT = null, lastT = null, sentences = 0;
  const seenType = {};
  let looksNmea = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line[0] !== '$' && line[0] !== '!') continue;
    looksNmea = true; sentences++;
    const ck = nmeaChecksumOk(line);
    if (ck === true) csOk++; else if (ck === false) csBad++;
    const body = line.slice(1).split('*')[0];
    const f = body.split(',');
    const type = f[0].slice(-3); seenType[type] = (seenType[type] || 0) + 1;
    if (type === 'GGA') {
      if (f[6] && f[6] !== '0') fixes++;
      if (f[1]) { const t = f[1]; if (!firstT) firstT = t; lastT = t; }
      const la = nmeaCoord(f[2], f[3]); const lo = nmeaCoord(f[4], f[5]);
      if (la != null && lo != null) { minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); }
      if (f[7]) sats = Math.max(sats, parseInt(f[7], 10) || 0);
      if (f[8]) { const h = parseFloat(f[8]); if (isFinite(h)) hdop = hdop == null ? h : Math.min(hdop, h); }
    } else if (type === 'RMC') {
      if (f[1]) { const t = f[1]; if (!firstT) firstT = t; lastT = t; }
      const la = nmeaCoord(f[3], f[4]); const lo = nmeaCoord(f[5], f[6]);
      if (la != null && lo != null) { minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); }
    } else if (type === 'GSV') {
      if (f[3]) sats = Math.max(sats, parseInt(f[3], 10) || 0);
    }
  }
  if (!looksNmea) return null;
  const fmtTime = (t) => t && t.length >= 6 ? t.slice(0, 2) + ':' + t.slice(2, 4) + ':' + t.slice(4, 6) + ' UTC' : (t || '-');
  const out = {
    'Format': 'NMEA 0183 GPS log',
    'Sentences': sentences.toLocaleString(),
    'Sentence types': topCounts(seenType, 10),
    'GPS fixes': fixes.toLocaleString(),
  };
  if (firstT) out['First timestamp'] = fmtTime(firstT);
  if (lastT) out['Last timestamp'] = fmtTime(lastT);
  if (sats) out['Max satellites'] = sats;
  if (hdop != null) out['Best HDOP'] = fc(hdop);
  if (isFinite(minLat)) out['Bounds (lon/lat)'] = fmtBBox(minLon, minLat, maxLon, maxLat);
  if (csOk + csBad) out['Checksums'] = csOk + ' ok, ' + csBad + ' bad';
  if (text.length >= 4_000_000) out['Note'] = 'stats cover the first 4 MB only';
  return out;
}

// =====================================================================
//  IGC flight log
// =====================================================================
function igcCoord(d) {
  // B-record lat: DDMMmmm N, lon: DDDMMmmm E
  const m = d.match(/^(\d{2})(\d{2})(\d{3})([NS])(\d{3})(\d{2})(\d{3})([EW])/);
  if (!m) return null;
  let lat = +m[1] + (+m[2] + +m[3] / 1000) / 60; if (m[4] === 'S') lat = -lat;
  let lon = +m[5] + (+m[6] + +m[7] / 1000) / 60; if (m[8] === 'W') lon = -lon;
  return { lat, lon };
}
async function parseIgc(file) {
  const text = await readText(file, 8_000_000);
  if (!/^[AHBLG]/m.test(text) || !/\bH[FP]/.test(text) && !/^B\d{6}/m.test(text)) {
    if (!/^B\d{6}\d{7}[NS]/m.test(text)) return null;
  }
  const lines = text.split(/\r?\n/);
  const out = { 'Format': 'IGC flight log (FAI)' };
  const headers = {};
  let bcount = 0, firstT = null, lastT = null;
  let minAlt = Infinity, maxAlt = -Infinity;
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const line of lines) {
    const c = line[0];
    if (c === 'H') {
      const m = line.match(/^H[FP](\w{3})([^:]*:)?(.*)$/);
      if (m) headers[m[1]] = (m[3] || '').trim();
    } else if (c === 'B' && /^B\d{6}/.test(line)) {
      bcount++;
      const t = line.slice(1, 7); if (!firstT) firstT = t; lastT = t;
      const co = igcCoord(line.slice(7));
      if (co) { minLat = Math.min(minLat, co.lat); maxLat = Math.max(maxLat, co.lat); minLon = Math.min(minLon, co.lon); maxLon = Math.max(maxLon, co.lon); }
      // Altitudes: bytes 25-29 pressure alt, 30-34 GPS alt.
      const palt = parseInt(line.slice(25, 30), 10);
      const galt = parseInt(line.slice(30, 35), 10);
      const alt = isFinite(galt) && galt !== 0 ? galt : palt;
      if (isFinite(alt)) { minAlt = Math.min(minAlt, alt); maxAlt = Math.max(maxAlt, alt); }
    }
  }
  if (!bcount && !Object.keys(headers).length) return null;
  if (headers.PLT || headers.PILOTINCHARGE) out['Pilot'] = headers.PLT || headers.PILOTINCHARGE;
  if (headers.GTY) out['Glider type'] = headers.GTY;
  if (headers.GID) out['Glider ID'] = headers.GID;
  if (headers.DTE) out['Date (DDMMYY)'] = headers.DTE.replace(/[^\d]/g, '').slice(0, 6) || headers.DTE;
  if (headers.CID) out['Competition ID'] = headers.CID;
  out['Fix records (B)'] = bcount.toLocaleString();
  const fmtTime = (t) => t && t.length >= 6 ? t.slice(0, 2) + ':' + t.slice(2, 4) + ':' + t.slice(4, 6) + ' UTC' : '-';
  if (firstT) out['Time span'] = fmtTime(firstT) + ' → ' + fmtTime(lastT);
  if (isFinite(minAlt)) out['Altitude min/max'] = minAlt + ' / ' + maxAlt + ' m';
  if (isFinite(minLat)) out['Bounds (lon/lat)'] = fmtBBox(minLon, minLat, maxLon, maxLat);
  return out;
}

// =====================================================================
//  MapInfo TAB / MIF
// =====================================================================
async function parseTab(file) {
  const text = await readText(file, 256_000);
  if (!/!table/i.test(text) && !/^\s*!version/im.test(text)) return null;
  const out = { 'Format': 'MapInfo TAB' };
  const ver = (text.match(/!version\s+(\d+)/i) || [])[1];
  if (ver) out['Version'] = ver;
  const charset = (text.match(/!charset\s+"?([\w-]+)"?/i) || [])[1];
  if (charset) out['Charset'] = charset;
  const type = (text.match(/Type\s+(\w+)/i) || [])[1];
  if (type) out['Table type'] = type;
  // Linked files.
  const links = Array.from(text.matchAll(/(?:File|"|')\s*"?([\w .\-\\\/]+\.(?:dat|map|id|ind|dbf|csv|wks|xls|mdb|shp))"?/gi)).map((m) => m[1]);
  const fields = Array.from(text.matchAll(/^\s*(\w+)\s+(Char|Integer|SmallInt|Decimal|Float|Date|Logical|DateTime|Time)\b[^\n]*/gim)).map((m) => m[1] + ' ' + m[2]);
  if (fields.length) {
    out['Fields'] = fields.length;
    out._sections = [{ title: 'Field definitions (' + fields.length + ')', node: preBlock(fields.join('\n')) }];
  }
  if (links.length) out['Linked files'] = Array.from(new Set(links)).slice(0, 8).join(', ');
  return out;
}
async function parseMif(file) {
  const text = await readText(file, 4_000_000);
  if (!/\bVersion\b/i.test(text) || !/\b(Columns|CoordSys|Data)\b/i.test(text)) return null;
  const out = { 'Format': 'MapInfo Interchange (.mif)' };
  const ver = (text.match(/^\s*Version\s+(\d+)/im) || [])[1];
  if (ver) out['Version'] = ver;
  const charset = (text.match(/^\s*Charset\s+"?([\w-]+)"?/im) || [])[1];
  if (charset) out['Charset'] = charset;
  const coordsys = (text.match(/^\s*CoordSys\s+(.+)$/im) || [])[1];
  if (coordsys) out['CoordSys'] = coordsys.trim().slice(0, 120);
  const cols = (text.match(/^\s*Columns\s+(\d+)/im) || [])[1];
  if (cols) out['Columns'] = cols;
  // Geometry objects in the Data section.
  let geom = 0; const gt = {};
  const dataIdx = text.search(/^\s*Data\b/im);
  const body = dataIdx >= 0 ? text.slice(dataIdx) : text;
  let m; const re = /^\s*(Point|Line|Pline|Region|Arc|Text|Rect|Roundrect|Ellipse|Multipoint|Collection)\b/gim;
  while ((m = re.exec(body))) { geom++; const k = m[1]; gt[k] = (gt[k] || 0) + 1; }
  if (geom) { out['Geometry objects'] = geom.toLocaleString(); out['Geometry types'] = topCounts(gt, 10); }
  out['Note'] = '.mid companion holds attribute rows (not parsed; collides with MIDI)';
  return out;
}

// =====================================================================
//  GDAL VRT
// =====================================================================
async function parseVrt(file) {
  const text = await readText(file, 2_000_000);
  if (!/<VRTDataset\b/.test(text)) return null;
  const out = { 'Format': 'GDAL Virtual Raster (.vrt)' };
  const dm = text.match(/<VRTDataset\b[^>]*\brasterXSize\s*=\s*"(\d+)"[^>]*\brasterYSize\s*=\s*"(\d+)"/);
  if (dm) out['Raster size'] = dm[1] + ' × ' + dm[2] + ' px';
  const srs = (text.match(/<SRS[^>]*>([\s\S]*?)<\/SRS>/i) || [])[1];
  if (srs) {
    const name = (srs.match(/(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[\s*&quot;([^&]+)&quot;/) || srs.match(/(?:PROJCS|GEOGCS)\s*\[\s*"([^"]+)"/) || [])[1];
    out['SRS'] = name || srs.trim().slice(0, 80);
  }
  const gt = (text.match(/<GeoTransform>([\s\S]*?)<\/GeoTransform>/i) || [])[1];
  if (gt) {
    const v = gt.split(',').map((s) => parseFloat(s)).filter((n) => isFinite(n));
    if (v.length === 6) {
      out['Geotransform origin'] = fc(v[0]) + ', ' + fc(v[3]);
      out['Pixel size'] = fc(v[1]) + ' × ' + fc(v[5]);
    }
  }
  const bands = (text.match(/<VRTRasterBand\b/gi) || []).length;
  out['Bands'] = bands;
  const srcs = Array.from(text.matchAll(/<SourceFilename[^>]*>([^<]+)<\/SourceFilename>/gi)).map((m) => m[1].trim());
  if (srcs.length) {
    out['Source files'] = srcs.length;
    out._sections = [{ title: 'Sources (' + srcs.length + ')', node: preBlock(Array.from(new Set(srcs)).slice(0, 60).join('\n')) }];
  }
  return out;
}

// =====================================================================
//  PMTiles
// =====================================================================
const PMTILES_TILETYPE = { 0: 'Unknown', 1: 'Mapbox Vector Tile (MVT)', 2: 'PNG', 3: 'JPEG', 4: 'WebP', 5: 'AVIF' };
async function parsePmtiles(file) {
  const b = await readBytes(file, 127);
  if (b.length < 127 || ascii(b, 0, 7) !== 'PMTiles') return null;
  const r = new Reader(b, true);
  r.seek(7);
  const spec = r.u8();
  const out = { 'Format': 'PMTiles (Protomaps)', 'Spec version': spec };
  if (spec === 3) {
    r.seek(7 + 1);
    // Skip 8 u64 offset/length pairs (root dir, metadata, leaf dirs, tile data) = 8*8 = ... actually layout:
    // After byte 8: rootDirOffset(8) rootDirLength(8) jsonMetadataOffset(8) jsonMetadataLength(8)
    // leafDirOffset(8) leafDirLength(8) tileDataOffset(8) tileDataLength(8)
    r.skip(8 * 8); // pos now 8 + 64 = 72
    const addrCount = Number(r.u64());
    const tileCount = Number(r.u64());
    r.skip(8); // tileContentsCount
    const clustered = r.u8();
    const internalComp = r.u8();
    const tileComp = r.u8();
    const tileType = r.u8();
    const minZoom = r.u8();
    const maxZoom = r.u8();
    const minLonE7 = r.i32(); const minLatE7 = r.i32();
    const maxLonE7 = r.i32(); const maxLatE7 = r.i32();
    const centerZoom = r.u8();
    const centerLonE7 = r.i32(); const centerLatE7 = r.i32();
    out['Tile type'] = PMTILES_TILETYPE[tileType] || ('type ' + tileType);
    out['Zoom range'] = minZoom + ' … ' + maxZoom;
    out['Addressed tiles'] = addrCount.toLocaleString();
    out['Tile entries'] = tileCount.toLocaleString();
    out['Clustered'] = clustered ? 'yes' : 'no';
    out['Bounds (lon/lat)'] = fmtBBox(minLonE7 / 1e7, minLatE7 / 1e7, maxLonE7 / 1e7, maxLatE7 / 1e7);
    out['Center'] = fc(centerLonE7 / 1e7) + ', ' + fc(centerLatE7 / 1e7) + ' @ z' + centerZoom;
    const COMP = { 0: 'unknown', 1: 'none', 2: 'gzip', 3: 'brotli', 4: 'zstd' };
    out['Compression'] = 'tiles ' + (COMP[tileComp] || tileComp) + ', dirs ' + (COMP[internalComp] || internalComp);
  } else {
    out['Note'] = 'Older PMTiles spec (v' + spec + ') — header layout not decoded';
  }
  return out;
}

// =====================================================================
//  DTED
// =====================================================================
// DTED packs lat/lon as DDDMMSSH (degrees minutes seconds hemisphere).
function dtedAngle(s) {
  // e.g. "0340000W" or "00340000W"
  const m = s.match(/^0*(\d{1,3})(\d{2})(\d{2})([NSEW])/);
  if (!m) return null;
  let v = +m[1] + +m[2] / 60 + +m[3] / 3600;
  if (m[4] === 'S' || m[4] === 'W') v = -v;
  return v;
}
async function parseDted(file) {
  const b = await readBytes(file, 3428);
  if (ascii(b, 0, 3) !== 'UHL') return null;
  const txt = latin1(b.subarray(0, 80));
  const out = { 'Format': 'DTED (Digital Terrain Elevation Data)' };
  // UHL: bytes 4-12 lon origin, 12-20 lat origin (SW corner).
  const lonOrigin = dtedAngle(latin1(b.subarray(4, 12)));
  const latOrigin = dtedAngle(latin1(b.subarray(12, 20)));
  // Longitude/latitude interval in tenths of arc-seconds, bytes 20-24 / 24-28.
  const lonInt = parseInt(latin1(b.subarray(20, 24)), 10);
  const latInt = parseInt(latin1(b.subarray(24, 28)), 10);
  if (lonOrigin != null && latOrigin != null) out['SW corner (lon/lat)'] = fc(lonOrigin) + ', ' + fc(latOrigin);
  if (isFinite(lonInt)) out['Lon post spacing'] = (lonInt / 10) + ' arc-sec';
  if (isFinite(latInt)) out['Lat post spacing'] = (latInt / 10) + ' arc-sec';
  // Counts: bytes 47-51 longitude lines, 51-55 latitude points.
  const lonLines = parseInt(latin1(b.subarray(47, 51)), 10);
  const latPts = parseInt(latin1(b.subarray(51, 55)), 10);
  if (isFinite(lonLines) && isFinite(latPts)) out['Grid'] = lonLines + ' × ' + latPts + ' posts';
  // Security code at byte 32.
  const sec = String.fromCharCode(b[32]);
  if (/[USCT]/.test(sec)) out['Security'] = { U: 'Unclassified', S: 'Secret', C: 'Confidential', T: 'Top Secret' }[sec];
  out['Note'] = 'UHL header parsed; elevation min/max requires full grid scan';
  return out;
}

// =====================================================================
//  Esri ASCII grid (.asc / .grd)
// =====================================================================
async function parseEsriAscii(file) {
  const head = await readText(file, 65_536);
  if (!/^\s*ncols\b/i.test(head)) return null;
  const out = { 'Format': 'Esri ASCII grid' };
  const grab = (kw) => { const m = head.match(new RegExp('^\\s*' + kw + '\\s+(\\S+)', 'im')); return m ? m[1] : null; };
  const ncols = +grab('ncols'), nrows = +grab('nrows');
  const cellsize = parseFloat(grab('cellsize'));
  let xll = grab('xllcorner') || grab('xllcenter');
  let yll = grab('yllcorner') || grab('yllcenter');
  const nodata = grab('NODATA_value') || grab('nodata_value');
  out['Columns × rows'] = ncols + ' × ' + nrows;
  out['Cell size'] = isFinite(cellsize) ? fc(cellsize) : '-';
  if (xll != null && yll != null) {
    out['Lower-left corner'] = fc(+xll) + ', ' + fc(+yll);
    if (isFinite(ncols) && isFinite(nrows) && isFinite(cellsize)) {
      out['Extent'] = fmtBBox(+xll, +yll, +xll + ncols * cellsize, +yll + nrows * cellsize);
    }
  }
  if (nodata != null) out['NODATA value'] = nodata;
  // Value min/max from the first chunk of the data body.
  try {
    const body = await readText(file, 2_000_000);
    const headerEnd = body.search(/\n\s*(?:NODATA_value\s+\S+\s*\n)?/i);
    const dataStart = (() => {
      // find first line that is purely numbers (the grid body)
      const lines = body.split(/\r?\n/);
      let idx = 0, off = 0;
      for (const l of lines) {
        if (/^\s*[-\d.]/.test(l) && !/^\s*(ncols|nrows|xll|yll|cellsize|nodata)/i.test(l)) break;
        off += l.length + 1; idx++;
      }
      return off;
    })();
    const nums = body.slice(dataStart).match(/-?\d+\.?\d*(?:[eE][-+]?\d+)?/g) || [];
    const nd = nodata != null ? parseFloat(nodata) : null;
    let mn = Infinity, mx = -Infinity, n = 0;
    for (const s of nums) {
      const v = parseFloat(s);
      if (!isFinite(v) || (nd != null && v === nd)) continue;
      if (v < mn) mn = v; if (v > mx) mx = v; n++;
      if (n > 500_000) break;
    }
    if (n) out['Value range (sampled)'] = fc(mn) + ' … ' + fc(mx);
  } catch (_) {}
  return out;
}

// =====================================================================
//  SRTM .hgt
// =====================================================================
async function parseHgt(file, fileObj) {
  const name = (fileObj && fileObj.name) || '';
  const out = { 'Format': 'SRTM height tile (.hgt)' };
  // Tile origin from filename: e.g. N37W122.hgt -> SW corner of 1°×1° tile.
  const m = name.match(/([NS])(\d{2})([EW])(\d{3})/i);
  if (m) {
    let lat = +m[2]; if (m[1].toUpperCase() === 'S') lat = -lat;
    let lon = +m[4]; if (m[3].toUpperCase() === 'W') lon = -lon;
    out['Tile SW corner'] = fc(lon) + ', ' + fc(lat);
    out['Extent'] = fmtBBox(lon, lat, lon + 1, lat + 1);
  }
  // Resolution from file size: 1201²·2 = SRTM3 (90 m), 3601²·2 = SRTM1 (30 m).
  const size = fileObj ? fileObj.size : 0;
  const samples = size / 2;
  const dim = Math.round(Math.sqrt(samples));
  if (dim * dim * 2 === size) {
    out['Grid'] = dim + ' × ' + dim + ' posts';
    out['Resolution'] = dim === 3601 ? '1 arc-sec (~30 m, SRTM1)' : dim === 1201 ? '3 arc-sec (~90 m, SRTM3)' : (dim + ' posts/deg');
  }
  // Elevation min/max (big-endian int16, void = -32768).
  try {
    const b = await readBytes(file, Math.min(size, 4_000_000));
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i + 1 < b.length; i += 2) {
      const v = dv.getInt16(i, false);
      if (v === -32768) continue;
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    if (isFinite(mn)) out['Elevation min/max (sampled)'] = mn + ' / ' + mx + ' m';
  } catch (_) {}
  return out;
}

// =====================================================================
//  GeoPackage / MBTiles (SQLite-backed) — real parse via sql.js
// =====================================================================

// Run a query and return its first result set's {columns, values} or null.
function q(db, sql) {
  try {
    const res = db.exec(sql);
    if (res && res[0]) return res[0];
    return null;
  } catch (_) { return null; }
}

async function parseGpkg(file, ext) {
  let summary = null;
  try {
    summary = await sqliteSummary(file);
    if (!summary || !summary.db) return idOnly(file, ext);
    const db = summary.db;
    try {
      const out = { 'Format': 'GeoPackage (OGC GeoPackage, SQLite)' };
      // application_id / user_version from PRAGMA.
      const appId = q(db, 'PRAGMA application_id');
      if (appId && appId.values && appId.values[0]) {
        const id = Number(appId.values[0][0]) >>> 0;
        // 0x47504B47 'GPKG' (v1.2+) or 0x47503130 'GP10'/'GP11' (older).
        let tag = '';
        for (let i = 3; i >= 0; i--) { const c = (id >> (8 * i)) & 0xff; tag += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.'; }
        out['application_id'] = '0x' + id.toString(16).toUpperCase() + ' (' + tag + ')';
      }
      const userVer = q(db, 'PRAGMA user_version');
      if (userVer && userVer.values && userVer.values[0]) {
        const uv = Number(userVer.values[0][0]);
        out['user_version'] = uv ? (uv + ' (GeoPackage ' + (uv / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + ')') : uv;
      }

      // gpkg_contents: one row per layer (feature table or tile pyramid).
      const contents = q(db, 'SELECT table_name, data_type, identifier, min_x, min_y, max_x, max_y, srs_id FROM gpkg_contents');
      const layers = [];
      let features = 0, tiles = 0;
      if (contents && contents.values) {
        for (const rowv of contents.values) {
          const tableName = rowv[0], dataType = rowv[1], identifier = rowv[2];
          const minX = rowv[3], minY = rowv[4], maxX = rowv[5], maxY = rowv[6], srsId = rowv[7];
          if (dataType === 'features') features++;
          else if (dataType === 'tiles') tiles++;
          // Per-table row count.
          let count = null;
          try {
            const cr = db.exec('SELECT COUNT(*) FROM "' + String(tableName).replace(/"/g, '""') + '"');
            if (cr && cr[0] && cr[0].values && cr[0].values[0]) count = Number(cr[0].values[0][0]);
          } catch (_) {}
          let line = (tableName || '?') + '  [' + (dataType || '?') + ']';
          if (count != null) line += '  ' + count.toLocaleString() + (dataType === 'tiles' ? ' tiles' : ' rows');
          if (identifier && identifier !== tableName) line += '  — ' + identifier;
          if ([minX, minY, maxX, maxY].every((n) => typeof n === 'number' && isFinite(n))) {
            line += '\n    bbox ' + fmtBBox(minX, minY, maxX, maxY) + (srsId != null ? '  SRS ' + srsId : '');
          }
          layers.push(line);
        }
      }
      out['Layers'] = layers.length;
      if (features) out['Feature tables'] = features;
      if (tiles) out['Tile matrix sets'] = tiles;

      // Spatial reference systems.
      const srs = q(db, 'SELECT srs_name, srs_id, organization, organization_coordsys_id FROM gpkg_spatial_ref_sys ORDER BY srs_id');
      const srsLines = [];
      if (srs && srs.values) {
        for (const rowv of srs.values) {
          srsLines.push((rowv[1] != null ? rowv[1] : '?') + '  ' + (rowv[0] || '') + (rowv[2] ? '  (' + rowv[2] + ':' + (rowv[3] != null ? rowv[3] : '?') + ')' : ''));
        }
        out['Spatial ref systems'] = srs.values.length;
      }

      const sections = [];
      if (layers.length) sections.push({ title: 'Layers (' + layers.length + ')', node: preBlock(layers.join('\n')), open: true });
      if (srsLines.length) sections.push({ title: 'Spatial reference systems (' + srsLines.length + ')', node: preBlock(srsLines.join('\n')) });
      if (summary.tables.length) sections.push({ title: 'All tables (' + summary.tables.length + ')', node: preBlock(summary.tables.map((t) => t + (summary.rowCounts[t] != null ? '  (' + summary.rowCounts[t].toLocaleString() + ')' : '')).join('\n')) });
      if (sections.length) out._sections = sections;
      return out;
    } finally {
      try { db.close(); } catch (_) {}
    }
  } catch (_) {
    if (summary && summary.db) { try { summary.db.close(); } catch (_) {} }
    return idOnly(file, ext);
  }
}

async function parseMbtiles(file, ext) {
  let summary = null;
  try {
    summary = await sqliteSummary(file);
    if (!summary || !summary.db) return idOnly(file, ext);
    const db = summary.db;
    try {
      const out = { 'Format': 'MBTiles (Mapbox tile database, SQLite)' };
      // metadata: key/value pairs.
      const meta = {};
      const md = q(db, 'SELECT name, value FROM metadata');
      if (md && md.values) for (const rowv of md.values) meta[String(rowv[0])] = rowv[1];
      const pick = (k, label) => { if (meta[k] != null && meta[k] !== '') out[label] = String(meta[k]); };
      pick('name', 'Name');
      pick('format', 'Tile format');
      pick('minzoom', 'Min zoom');
      pick('maxzoom', 'Max zoom');
      pick('bounds', 'Bounds');
      pick('center', 'Center');
      pick('attribution', 'Attribution');
      pick('type', 'Type');
      pick('version', 'Version');
      pick('description', 'Description');

      // Tile count.
      try {
        const tc = db.exec('SELECT COUNT(*) FROM tiles');
        if (tc && tc[0] && tc[0].values && tc[0].values[0]) out['Tiles'] = Number(tc[0].values[0][0]).toLocaleString();
      } catch (_) {}

      const sections = [];
      const metaLines = Object.entries(meta).map(([k, v]) => k + ': ' + (v == null ? '' : String(v)));
      if (metaLines.length) sections.push({ title: 'metadata (' + metaLines.length + ')', node: preBlock(metaLines.join('\n')), open: true });
      if (summary.tables.length) sections.push({ title: 'All tables (' + summary.tables.length + ')', node: preBlock(summary.tables.map((t) => t + (summary.rowCounts[t] != null ? '  (' + summary.rowCounts[t].toLocaleString() + ')' : '')).join('\n')) });
      if (sections.length) out._sections = sections;
      return out;
    } finally {
      try { db.close(); } catch (_) {}
    }
  } catch (_) {
    if (summary && summary.db) { try { summary.db.close(); } catch (_) {} }
    return idOnly(file, ext);
  }
}

// =====================================================================
//  Identification-only (rare AND hard, or needs a SQLite reader)
// =====================================================================
function idOnly(file, ext) {
  const NOTES = {
    grib: 'WMO gridded binary (GRIB1). Edition/centre/message decode needs a GRIB section walker — not yet implemented.',
    grb: 'WMO gridded binary (GRIB1). Edition/centre/message decode needs a GRIB section walker — not yet implemented.',
    grib2: 'WMO GRIB2 gridded binary. Discipline/parameter/grid decode needs a GRIB2 section walker — not yet implemented.',
    nc: 'NetCDF (classic CDF magic or HDF5). Dimensions/variables/attributes need a CDF/HDF5 reader — not yet implemented.',
    cdf: 'NetCDF classic. Dimensions/variables/attributes need a CDF reader — not yet implemented.',
    nc4: 'NetCDF-4 (HDF5-based). Needs an HDF5 reader — not yet implemented.',
    pbf: 'OSM PBF: gzip/zlib-compressed protobuf blocks. Needs a protobuf + zlib decoder — not yet implemented.',
    gpkg: 'GeoPackage = SQLite database (gpkg_contents lists layers/SRS). Requires a SQLite reader (dependency).',
    mbtiles: 'MBTiles = SQLite database (metadata + tiles tables). Requires a SQLite reader (dependency).',
    sid: 'MrSID wavelet raster (LizardTech/Extensis). Decode is proprietary/impractical — identification only.',
    ecw: 'Enhanced Compression Wavelet raster (Hexagon/ERDAS). Decode is proprietary — identification only.',
    gdb: 'Esri File Geodatabase is a folder of .gdbtable members — drop the folder, not a single file.',
  };
  const NAMES = {
    grib: 'GRIB (WMO gridded binary)', grb: 'GRIB (WMO gridded binary)', grib2: 'GRIB2 (WMO gridded binary)',
    nc: 'NetCDF', cdf: 'NetCDF (classic)', nc4: 'NetCDF-4',
    pbf: 'OSM PBF (protobuf)', gpkg: 'GeoPackage (SQLite)', mbtiles: 'MBTiles (SQLite)',
    sid: 'MrSID raster', ecw: 'ECW raster', gdb: 'Esri File Geodatabase',
  };
  return { 'Format': NAMES[ext] || ext.toUpperCase(), 'Note': NOTES[ext] || 'Identification only.' };
}

// =====================================================================
//  dispatch
// =====================================================================
export const PARSERS = {
  // Full parsers
  topojson: (c) => parseTopojson(c.file),
  osm: (c) => parseOsm(c.file),
  shp: (c) => parseShp(c.file),
  shx: (c) => parseShx(c.file),
  dbf: (c) => parseDbf(c.file),
  prj: (c) => parsePrj(c.file),
  cpg: (c) => parseCpg(c.file),
  pgw: (c) => parseWorldFile(c.file, c.ext),
  tfw: (c) => parseWorldFile(c.file, c.ext),
  jgw: (c) => parseWorldFile(c.file, c.ext),
  wld: (c) => parseWorldFile(c.file, c.ext),
  gml: (c) => parseGml(c.file),
  nmea: (c) => parseNmea(c.file),
  nmea0183: (c) => parseNmea(c.file),
  igc: (c) => parseIgc(c.file),
  tab: (c) => parseTab(c.file),
  mif: (c) => parseMif(c.file),
  vrt: (c) => parseVrt(c.file),
  pmtiles: (c) => parsePmtiles(c.file),
  dt0: (c) => parseDted(c.file),
  dt1: (c) => parseDted(c.file),
  dt2: (c) => parseDted(c.file),
  dted: (c) => parseDted(c.file),
  asc: (c) => parseEsriAscii(c.file),
  grd: (c) => parseEsriAscii(c.file),
  hgt: (c) => parseHgt(c.file, c.file),

  // Identification-only (rare AND hard, or needs a SQLite reader)
  grib: (c) => idOnly(c.file, c.ext),
  grb: (c) => idOnly(c.file, c.ext),
  grib2: (c) => idOnly(c.file, c.ext),
  nc: (c) => idOnly(c.file, c.ext),
  cdf: (c) => idOnly(c.file, c.ext),
  nc4: (c) => idOnly(c.file, c.ext),
  pbf: (c) => idOnly(c.file, c.ext),
  gpkg: (c) => parseGpkg(c.file, c.ext),
  mbtiles: (c) => parseMbtiles(c.file, c.ext),
  sid: (c) => idOnly(c.file, c.ext),
  ecw: (c) => idOnly(c.file, c.ext),
  gdb: (c) => idOnly(c.file, c.ext),
};
