/* Analyser - lazy parser chunk: documents, ebooks, publishing (more).

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'docs'` is opened. Each entry in PARSERS is
   `({head, file, ext}) => rows` where `rows` is a plain object of label->value
   pairs (rendered as a readout), optionally carrying
   `_sections: [{title, node, open?}]` for collapsible blocks and
   `_previewNode` for a preview. Return null to fall back to the generic card.

   Dependency-free: comic-book / OPC / ODF-flat / web-archive containers reuse
   openZip or are walked from their headers; TeX/markup/journal text formats are
   parsed with regex. Formats rated both rare AND hard (CBR/CB7/CHM/WPD/Quark/
   PageMaker/LIT/AZW/KFX, and CFBF-backed .pub/.hwp) stay identification-only.
   No top-level side effects. */

import { el, row, fmtBytes } from '../core/util.js';
import { Reader, ascii, findBytes, latin1, utf8 } from '../core/binutil.js';
import { openZip } from '../renderers/zip.js';

// ---------- small shared helpers ----------

// A scrollable <pre> for raw text / outlines / file lists.
function preBlock(text, cls) {
  return el('pre', {
    class: cls || 'anr-code',
    style: 'max-height:360px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0;',
  }, text);
}

async function fileText(file, cap = 4 * 1024 * 1024) {
  return file.slice(0, Math.min(file.size, cap)).text();
}

// Pull the first capture group of a regex from text, trimmed, or null.
function pick(text, re) { const m = text.match(re); return m ? m[1].trim() : null; }

// Strip a tiny bit of XML: collapse entities we care about and trim.
function xmlText(s) {
  return (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

// First tag content match (namespace-agnostic): <ns:tag ...>VALUE</ns:tag>.
function tag(text, name) {
  const re = new RegExp('<(?:[\\w.-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?' + name + '>', 'i');
  const m = text.match(re);
  return m ? xmlText(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : null;
}

// Count non-overlapping matches of a global regex.
function countRe(text, re) { const m = text.match(re); return m ? m.length : 0; }

// ---------- image-header dimension probes (browser-native formats) ----------

// Returns {w, h, fmt} from the first bytes of a raster image, or null.
function imageDims(b) {
  if (!b || b.length < 12) return null;
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    // IHDR width/height are big-endian u32 at offset 16/20.
    if (b.length >= 24) {
      const w = (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0;
      const h = (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0;
      return { w, h, fmt: 'PNG' };
    }
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    const w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8);
    return { w, h, fmt: 'GIF' };
  }
  // JPEG: scan segments for SOF marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const marker = b[p + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += 2; continue; }
      const len = (b[p + 2] << 8) | b[p + 3];
      // SOF0..SOF15 except DHT(0xc4)/DAC(0xcc)/RSTn carry frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (b[p + 5] << 8) | b[p + 6];
        const w = (b[p + 7] << 8) | b[p + 8];
        return { w, h, fmt: 'JPEG' };
      }
      p += 2 + len;
    }
    return { fmt: 'JPEG' };
  }
  // WebP (RIFF....WEBP)
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const fourcc = ascii(b, 12, 4);
    if (fourcc === 'VP8 ' && b.length >= 30) {
      const w = ((b[26] | (b[27] << 8)) & 0x3fff);
      const h = ((b[28] | (b[29] << 8)) & 0x3fff);
      return { w, h, fmt: 'WebP' };
    }
    if (fourcc === 'VP8L' && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >> 14) & 0x3fff) + 1;
      return { w, h, fmt: 'WebP (lossless)' };
    }
    if (fourcc === 'VP8X' && b.length >= 30) {
      const w = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
      const h = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
      return { w, h, fmt: 'WebP (extended)' };
    }
    return { fmt: 'WebP' };
  }
  return null;
}

const NATIVE_IMG = /\.(jpe?g|png|gif|webp)$/i;
function imgMime(name) {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

// Build an <img> preview node from raw bytes (object URL, revoked on load).
function imgPreview(bytes, mime) {
  try {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = el('img', {
      src: url, alt: 'first page',
      style: 'max-width:100%;max-height:420px;display:block;border-radius:6px;',
    });
    img.addEventListener('load', () => URL.revokeObjectURL(url));
    return img;
  } catch (_) { return null; }
}

// ---------- ComicInfo.xml ----------
function parseComicInfo(xml) {
  if (!xml) return null;
  const out = {};
  for (const [t, label] of [
    ['Title', 'Title'], ['Series', 'Series'], ['Number', 'Number'],
    ['Volume', 'Volume'], ['Writer', 'Writer'], ['Penciller', 'Penciller'],
    ['Publisher', 'Publisher'], ['Year', 'Year'], ['Genre', 'Genre'],
    ['LanguageISO', 'Language'], ['PageCount', 'PageCount (declared)'],
  ]) {
    const v = tag(xml, t);
    if (v) out[label] = v;
  }
  const summary = tag(xml, 'Summary');
  return { fields: out, summary };
}

// ---------- CBZ (Comic Book ZIP) ----------
async function parseCbz(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const imgEntries = zip.entries
    .filter((e) => /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(e.name) && !/\/$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (!imgEntries.length && !zip.has('ComicInfo.xml')) return null;
  const out = { 'Format': 'Comic Book ZIP (.cbz)' };
  out['Pages'] = imgEntries.length;
  // Format breakdown.
  const byFmt = {};
  for (const e of imgEntries) { const ex = (e.name.match(/\.([^.]+)$/) || [])[1].toLowerCase(); byFmt[ex] = (byFmt[ex] || 0) + 1; }
  if (Object.keys(byFmt).length) out['Page formats'] = Object.entries(byFmt).map(([k, v]) => k + ' (' + v + ')').join(', ');

  // ComicInfo.xml metadata.
  const ciName = zip.names().find((n) => /(^|\/)ComicInfo\.xml$/i.test(n));
  if (ciName) {
    const ci = parseComicInfo(await zip.text(ciName));
    if (ci) {
      for (const [k, v] of Object.entries(ci.fields)) out[k] = v;
      if (ci.summary) out._sections = [{ title: 'Summary', node: preBlock(ci.summary) }];
    }
  }

  // Per-page dimensions (probe first up-to-12 image headers).
  const dimLines = [];
  for (const e of imgEntries.slice(0, 12)) {
    try {
      const bytes = await zip.bytes(e.name);
      const d = bytes && imageDims(bytes);
      dimLines.push((d && d.w ? d.w + '×' + d.h : '?') + (d ? '  ' + d.fmt : '') + '  ' + e.name);
    } catch (_) { dimLines.push('?  ' + e.name); }
  }
  if (dimLines.length) {
    const sec = { title: 'Pages (' + imgEntries.length + ', first ' + dimLines.length + ' measured)', node: preBlock(dimLines.join('\n')) };
    out._sections = (out._sections || []).concat(sec);
  }

  // Preview: first page if it's browser-native.
  const first = imgEntries[0];
  if (first && NATIVE_IMG.test(first.name)) {
    try {
      const bytes = await zip.bytes(first.name);
      if (bytes) { const node = imgPreview(bytes, imgMime(first.name)); if (node) out._previewNode = node; }
    } catch (_) {}
  }
  return out;
}

// ---------- TAR walk (for CBT) ----------
function tarStr(b, off, len) {
  let end = off;
  while (end < off + len && b[end] !== 0) end++;
  return ascii(b, off, end - off).trim();
}
function tarOctal(b, off, len) {
  let s = '';
  for (let i = off; i < off + len; i++) {
    const c = b[i];
    if (c === 0 || c === 0x20) { if (s) break; else continue; }
    if (c < 0x30 || c > 0x37) break;
    s += String.fromCharCode(c);
  }
  return s ? parseInt(s, 8) : 0;
}
// Returns [{name, size, dataStart}] from a tar buffer.
function tarMembers(b) {
  const items = [];
  let pos = 0, longName = null;
  while (pos + 512 <= b.length) {
    let allZero = true;
    for (let i = 0; i < 512; i++) { if (b[pos + i] !== 0) { allZero = false; break; } }
    if (allZero) break;
    let name = tarStr(b, pos, 100);
    const prefix = ascii(b, 257, 5) === 'ustar' ? tarStr(b, pos + 345, 155) : '';
    if (prefix) name = prefix + '/' + name;
    const size = tarOctal(b, pos + 124, 12);
    const typeChar = String.fromCharCode(b[pos + 156] || 0x30);
    const dataStart = pos + 512;
    if (longName) { name = longName; longName = null; }
    if (typeChar === 'L') {
      longName = ascii(b, dataStart, size).replace(/\0+$/, '');
    } else if (!/[gx5]/.test(typeChar)) {
      if (name) items.push({ name, size, dataStart });
    }
    pos = dataStart + Math.ceil(size / 512) * 512;
    if (items.length > 20000) break;
  }
  return items;
}

// ---------- CBR / CB7 (Comic Book RAR / 7-Zip, via libarchive WASM) ----------
// Mirrors parseCbz but extracts through the lazily-loaded libarchive worker.
// Returns null on any failure so the caller falls back to identification rows.
async function parseComicArchive(file, ext) {
  let extractArchive;
  try {
    ({ extractArchive } = await import('../lib/libarchive-loader.js'));
  } catch (_) { return null; }

  let handle;
  try { handle = await extractArchive(file); } catch (_) { return null; }

  try {
    const imgEntries = handle.entries
      .filter((e) => /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(e.name) && !/\/$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const ciEntry = handle.entries.find((e) => /(^|\/)ComicInfo\.xml$/i.test(e.name));
    if (!imgEntries.length && !ciEntry) return null;

    const label = ext === 'cb7' ? 'Comic Book 7-Zip (.cb7)' : 'Comic Book RAR (.cbr)';
    const out = { 'Format': label };
    out['Pages'] = imgEntries.length;

    // Format breakdown.
    const byFmt = {};
    for (const e of imgEntries) { const ex = (e.name.match(/\.([^.]+)$/) || [])[1].toLowerCase(); byFmt[ex] = (byFmt[ex] || 0) + 1; }
    if (Object.keys(byFmt).length) out['Page formats'] = Object.entries(byFmt).map(([k, v]) => k + ' (' + v + ')').join(', ');

    // ComicInfo.xml metadata.
    if (ciEntry) {
      try {
        const xml = utf8(await ciEntry.getBytes());
        const ci = parseComicInfo(xml);
        if (ci) {
          for (const [k, v] of Object.entries(ci.fields)) out[k] = v;
          if (ci.summary) out._sections = [{ title: 'Summary', node: preBlock(ci.summary) }];
        }
      } catch (_) {}
    }

    // Per-page dimensions (probe first up-to-12 image headers).
    const dimLines = [];
    for (const e of imgEntries.slice(0, 12)) {
      try {
        const bytes = await e.getBytes();
        const d = bytes && imageDims(bytes);
        dimLines.push((d && d.w ? d.w + '×' + d.h : '?') + (d ? '  ' + d.fmt : '') + '  ' + e.name);
      } catch (_) { dimLines.push('?  ' + e.name); }
    }
    if (dimLines.length) {
      const sec = { title: 'Pages (' + imgEntries.length + ', first ' + dimLines.length + ' measured)', node: preBlock(dimLines.join('\n')) };
      out._sections = (out._sections || []).concat(sec);
    }

    // Preview: first page if it's browser-native.
    const first = imgEntries[0];
    if (first && NATIVE_IMG.test(first.name)) {
      try {
        const bytes = await first.getBytes();
        if (bytes) { const node = imgPreview(bytes, imgMime(first.name)); if (node) out._previewNode = node; }
      } catch (_) {}
    }
    return out;
  } catch (_) {
    return null;
  } finally {
    try { handle.close(); } catch (_) {}
  }
}

// ---------- CBT (Comic Book TAR) ----------
async function parseCbt(file) {
  const cap = Math.min(file.size, 32 * 1024 * 1024);
  const b = new Uint8Array(await file.slice(0, cap).arrayBuffer());
  // Validate a plausible tar.
  if (ascii(b, 257, 5) !== 'ustar' && tarOctal(b, 124, 12) <= 0) return null;
  let members;
  try { members = tarMembers(b); } catch (_) { return null; }
  const imgs = members
    .filter((m) => /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(m.name))
    .sort((a, c) => a.name.localeCompare(c.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (!imgs.length) return null;
  const out = { 'Format': 'Comic Book TAR (.cbt)' };
  out['Pages'] = imgs.length;
  const byFmt = {};
  for (const m of imgs) { const ex = (m.name.match(/\.([^.]+)$/) || [])[1].toLowerCase(); byFmt[ex] = (byFmt[ex] || 0) + 1; }
  out['Page formats'] = Object.entries(byFmt).map(([k, v]) => k + ' (' + v + ')').join(', ');

  const ci = members.find((m) => /(^|\/)ComicInfo\.xml$/i.test(m.name));
  if (ci) {
    const xml = utf8(b.subarray(ci.dataStart, ci.dataStart + ci.size));
    const parsed = parseComicInfo(xml);
    if (parsed) { for (const [k, v] of Object.entries(parsed.fields)) out[k] = v; if (parsed.summary) out._sections = [{ title: 'Summary', node: preBlock(parsed.summary) }]; }
  }
  const lines = imgs.slice(0, 200).map((m) => fmtBytes(m.size).padStart(10) + '  ' + m.name);
  out._sections = (out._sections || []).concat({ title: 'Pages (' + imgs.length + ')', node: preBlock(lines.join('\n')) });
  return out;
}

// ---------- OPC / ZIP-doc shared bits ----------

// Read OOXML / OPC core.xml-style Dublin-Core metadata into out.
function opcCore(out, coreXml) {
  if (!coreXml) return;
  for (const [t, label] of [
    ['title', 'Title'], ['subject', 'Subject'], ['creator', 'Author'],
    ['description', 'Description'], ['keywords', 'Keywords'],
    ['lastModifiedBy', 'Last modified by'], ['revision', 'Revision'],
    ['category', 'Category'], ['language', 'Language'],
  ]) {
    const v = tag(coreXml, t);
    if (v) out[label] = v;
  }
  const created = tag(coreXml, 'created');
  const modified = tag(coreXml, 'modified');
  if (created) out['Created'] = created;
  if (modified) out['Modified'] = modified;
}

// ---------- XPS / OpenXPS ----------
async function parseXps(file, ext) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const names = zip.names();
  const out = { 'Format': ext === 'oxps' ? 'OpenXPS document (.oxps)' : 'XML Paper Specification (.xps)' };
  // FixedDocument / page parts.
  const pages = zip.entries.filter((e) => /\/Pages\/.+\.fpage$/i.test(e.name) || /\.fpage$/i.test(e.name));
  const docs = zip.entries.filter((e) => /\.fdoc$/i.test(e.name));
  if (docs.length) out['Documents'] = docs.length;
  out['Pages'] = pages.length;
  out['Fonts'] = zip.entries.filter((e) => /\/Fonts\/|\.(odttf|ttf|otf)$/i.test(e.name)).length;
  out['Images'] = zip.entries.filter((e) => /\.(png|jpe?g|tiff?|wdp|jxr)$/i.test(e.name)).length;
  const coreName = names.find((n) => /docProps\/core\.xml$/i.test(n) || /core\.xml$/i.test(n));
  if (coreName) opcCore(out, await zip.text(coreName));
  if (names.some((n) => /\.wdp$|\.jxr$/i.test(n))) out['Image codec'] = 'JPEG XR (HD Photo) present';
  return out;
}

// ---------- HWPX (Hangul OWPML) ----------
async function parseHwpx(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'Hangul Word Processor XML (.hwpx, OWPML)' };
  const version = await zip.text('version.xml');
  if (version) {
    const v = pick(version, /(?:app|target)Version="([^"]+)"/i) || pick(version, /version="([^"]+)"/i);
    if (v) out['Version'] = v;
    const app = pick(version, /application="([^"]+)"/i);
    if (app) out['Application'] = app;
  }
  const sections = zip.entries.filter((e) => /Contents\/section\d+\.xml$/i.test(e.name));
  out['Sections'] = sections.length;
  out['Fonts'] = zip.entries.filter((e) => /fontface|\.(ttf|otf)$/i.test(e.name)).length || '-';
  out['Embedded media'] = zip.entries.filter((e) => /^BinData\//i.test(e.name)).length;
  // settings.xml / content.hpf may carry page info.
  const header = await zip.text('Contents/header.xml');
  if (header) {
    const pageCnt = countRe(header, /<hh:beginNum\b|<hp:pagePr\b/gi);
    if (pageCnt) out['Page properties'] = pageCnt;
  }
  return out;
}

// ---------- FB3 (FictionBook 3) ----------
async function parseFb3(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'FictionBook 3 (.fb3)' };
  const descName = zip.names().find((n) => /description\.xml$/i.test(n)) ||
                   zip.names().find((n) => /core\.xml$/i.test(n));
  if (descName) {
    const xml = await zip.text(descName);
    const t = tag(xml, 'title') || tag(xml, 'main');
    if (t) out['Title'] = t;
    const authors = Array.from(xml.matchAll(/<author>([\s\S]*?)<\/author>/gi))
      .map((m) => [tag(m[1], 'first'), tag(m[1], 'middle'), tag(m[1], 'last')].filter(Boolean).join(' ')).filter(Boolean);
    if (authors.length) out['Authors'] = authors.join('; ');
    const genres = Array.from(xml.matchAll(/<subject>([^<]+)<\/subject>/gi)).map((m) => m[1].trim());
    if (genres.length) out['Genres'] = genres.join(', ');
    const lang = tag(xml, 'lang');
    if (lang) out['Language'] = lang;
  }
  const bodies = zip.entries.filter((e) => /fb3\/body.*\.xml$/i.test(e.name) || /body\d*\.xml$/i.test(e.name));
  if (bodies.length) out['Body parts'] = bodies.length;
  out['Cover / images'] = zip.entries.filter((e) => /\.(png|jpe?g|gif)$/i.test(e.name)).length;
  // Chapter count: count <section> in body parts (first body only, to bound work).
  if (bodies.length) {
    try { const bxml = await zip.text(bodies[0].name); const ch = countRe(bxml, /<section\b/gi); if (ch) out['Sections (body 1)'] = ch; } catch (_) {}
  }
  return out;
}

// ---------- iBooks (.ibooks) ----------
async function parseIbooks(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'Apple iBooks Author book (.ibooks)' };
  const opfName = zip.names().find((n) => /\.opf$/i.test(n));
  if (opfName) {
    const opf = await zip.text(opfName);
    const t = tag(opf, 'title'); if (t) out['Title'] = t;
    const creators = Array.from(opf.matchAll(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/gi)).map((m) => xmlText(m[1]));
    if (creators.length) out['Author'] = creators.join('; ');
    const pub = tag(opf, 'publisher'); if (pub) out['Publisher'] = pub;
    const lang = tag(opf, 'language'); if (lang) out['Language'] = lang;
    out['Manifest items'] = countRe(opf, /<item\b/gi);
    out['Spine items'] = countRe(opf, /<itemref\b/gi);
  }
  if (zip.names().some((n) => /com\.apple\.ibooks/i.test(n))) out['Apple extensions'] = 'present';
  return Object.keys(out).length > 1 ? out : null;
}

// ---------- Scrivener (.scriv / .scrivx) ----------
async function parseScriv(file, ext) {
  // .scrivx is the XML; .scriv is the package folder (when dropped as a file it's
  // rare, but treat its text as the scrivx).
  const text = await fileText(file, 8 * 1024 * 1024);
  if (!/<ScrivenerProject/i.test(text) && !/<Binder\b/i.test(text)) return null;
  const out = { 'Format': 'Scrivener project (' + (ext === 'scriv' ? '.scriv' : '.scrivx') + ')' };
  const ver = pick(text, /Version="([^"]+)"/i);
  if (ver) out['Version'] = ver;
  const items = countRe(text, /<BinderItem\b/gi);
  out['Binder items'] = items;
  const byType = {};
  for (const m of text.matchAll(/<BinderItem[^>]*\bType="([^"]+)"/gi)) byType[m[1]] = (byType[m[1]] || 0) + 1;
  if (byType['Text']) out['Documents'] = byType['Text'];
  if (Object.keys(byType).length) out['Item types'] = Object.entries(byType).map(([k, v]) => k + ' (' + v + ')').join(', ');
  // Title outline (first 60 titles).
  const titles = Array.from(text.matchAll(/<Title>([^<]+)<\/Title>/gi)).map((m) => xmlText(m[1])).slice(0, 60);
  if (titles.length) out._sections = [{ title: 'Binder titles (first ' + titles.length + ')', node: preBlock(titles.join('\n')) }];
  return out;
}

// ---------- AbiWord (.abw / .zabw) ----------
async function parseAbw(file, ext) {
  let text;
  if (ext === 'zabw') {
    // .zabw is gzip-compressed .abw; try DecompressionStream.
    try {
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('gzip');
        const stream = file.slice(0, Math.min(file.size, 16 * 1024 * 1024)).stream().pipeThrough(ds);
        text = utf8(new Uint8Array(await new Response(stream).arrayBuffer()));
      }
    } catch (_) {}
  }
  if (!text) text = await fileText(file, 8 * 1024 * 1024);
  if (!/<abiword/i.test(text)) return null;
  const out = { 'Format': 'AbiWord document (.' + ext + ')' };
  const ver = pick(text, /<abiword[^>]*\bfileformat="([^"]+)"/i) || pick(text, /<abiword[^>]*\bversion="([^"]+)"/i);
  if (ver) out['File format'] = ver;
  // Dublin-core metadata lives in <m key="dc.title">value</m>.
  const meta = (k) => pick(text, new RegExp('<m\\s+key="' + k + '"\\s*>([^<]*)</m>', 'i'));
  const title = meta('dc.title'); if (title) out['Title'] = title;
  const creator = meta('dc.creator'); if (creator) out['Author'] = creator;
  const desc = meta('dc.description'); if (desc) out['Description'] = desc;
  out['Paragraphs'] = countRe(text, /<p(\s[^>]*)?>/gi);
  out['Images'] = countRe(text, /<image\b/gi) + countRe(text, /<d\s+name="image/gi);
  return out;
}

// ---------- StarOffice / OOo 1.x (.sxw .sxc .sxi .sxd) ----------
const SX_APP = { sxw: 'Writer', sxc: 'Calc', sxi: 'Impress', sxd: 'Draw', sxg: 'Master', stw: 'Writer template', stc: 'Calc template', sti: 'Impress template' };
async function parseSx(file, ext) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'StarOffice / OpenOffice.org 1.x ' + (SX_APP[ext] || '') + ' (.' + ext + ')' };
  const mimetype = await zip.text('mimetype');
  if (mimetype) out['MIME type'] = mimetype.trim();
  const meta = await zip.text('meta.xml');
  if (meta) odfMeta(out, meta);
  return out;
}

// ---------- ODF templates (.ott .ots .otp .otg) ----------
const OTT_APP = { ott: 'Writer', ots: 'Calc', otp: 'Impress', otg: 'Draw' };
async function parseOtt(file, ext) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'OpenDocument ' + (OTT_APP[ext] || '') + ' template (.' + ext + ')' };
  const mimetype = await zip.text('mimetype');
  if (mimetype) out['MIME type'] = mimetype.trim();
  const meta = await zip.text('meta.xml');
  if (meta) odfMeta(out, meta);
  return out;
}

// Shared ODF meta.xml reader (office:meta dc + meta:document-statistic).
function odfMeta(out, meta) {
  const t = tag(meta, 'title'); if (t) out['Title'] = t;
  const creator = tag(meta, 'creator') || tag(meta, 'initial-creator'); if (creator) out['Author'] = creator;
  const gen = tag(meta, 'generator'); if (gen) out['Generator'] = gen;
  const subj = tag(meta, 'subject'); if (subj) out['Subject'] = subj;
  const kw = tag(meta, 'keyword'); if (kw) out['Keywords'] = kw;
  const date = tag(meta, 'date') || tag(meta, 'creation-date'); if (date) out['Modified'] = date;
  // document-statistic carries attributes (page/word/char counts).
  const stat = meta.match(/<meta:document-statistic([^>]*)\/?>/i);
  if (stat) {
    for (const [a, label] of [
      ['page-count', 'Pages'], ['paragraph-count', 'Paragraphs'], ['word-count', 'Words'],
      ['character-count', 'Characters'], ['image-count', 'Images'], ['object-count', 'Objects'],
      ['table-count', 'Tables'], ['cell-count', 'Cells'],
    ]) {
      const v = pick(stat[1], new RegExp('meta:' + a + '="([^"]+)"', 'i'));
      if (v) out[label] = v;
    }
  }
}

// ---------- ODF Flat XML (.fodt .fods .fodp .fodg) ----------
const FODT_APP = { fodt: 'Text', fods: 'Spreadsheet', fodp: 'Presentation', fodg: 'Drawing' };
async function parseFodt(file, ext) {
  const text = await fileText(file, 8 * 1024 * 1024);
  if (!/office:document\b/i.test(text)) return null;
  const out = { 'Format': 'OpenDocument Flat XML ' + (FODT_APP[ext] || '') + ' (.' + ext + ')' };
  const mt = pick(text, /office:mimetype="([^"]+)"/i);
  if (mt) out['MIME type'] = mt;
  // Metadata lives inline under <office:meta>.
  const metaBlock = (text.match(/<office:meta>([\s\S]*?)<\/office:meta>/i) || [])[1] || text;
  odfMeta(out, metaBlock);
  return out;
}

// ---------- Word templates (.dotx / .dotm) ----------
async function parseDotx(file, ext) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'Word template (.' + ext + ')' };
  const core = await zip.text('docProps/core.xml');
  if (core) opcCore(out, core);
  const app = await zip.text('docProps/app.xml');
  if (app) {
    const pages = tag(app, 'Pages'); if (pages) out['Pages'] = pages;
    const words = tag(app, 'Words'); if (words) out['Words'] = words;
    const company = tag(app, 'Company'); if (company) out['Company'] = company;
    const appName = tag(app, 'Application'); if (appName) out['Application'] = appName;
  }
  const hasMacro = zip.names().some((n) => /vbaProject\.bin$/i.test(n));
  out['Macros (VBA)'] = (ext === 'dotm' || hasMacro) ? (hasMacro ? 'present (vbaProject.bin)' : 'macro-enabled template') : 'none';
  return out;
}

// ---------- Visio (.vsdx) ----------
async function parseVsdx(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'Microsoft Visio drawing (.vsdx)' };
  const core = await zip.text('docProps/core.xml');
  if (core) opcCore(out, core);
  const pages = zip.entries.filter((e) => /visio\/pages\/page\d+\.xml$/i.test(e.name));
  out['Pages'] = pages.length || countRe((await zip.text('visio/pages/pages.xml')) || '', /<Page\b/gi);
  out['Masters'] = zip.entries.filter((e) => /visio\/masters\/master\d+\.xml$/i.test(e.name)).length;
  out['Embedded images'] = zip.entries.filter((e) => /visio\/media\//i.test(e.name)).length;
  out['Thumbnail'] = zip.names().some((n) => /docProps\/thumbnail/i.test(n)) ? 'present' : 'none';
  return out;
}

// ---------- TeX / LaTeX (.tex .latex .sty .cls) ----------
async function parseTex(file, ext) {
  const text = await fileText(file, 4 * 1024 * 1024);
  const out = { 'Format': (ext === 'sty' ? 'LaTeX package (.sty)' : ext === 'cls' ? 'LaTeX class (.cls)' : 'TeX / LaTeX source (.' + ext + ')') };
  const docclass = pick(text, /\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/);
  if (docclass) out['Document class'] = docclass;
  if (ext === 'cls') { const p = pick(text, /\\ProvidesClass\{([^}]+)\}(?:\[([^\]]*)\])?/); if (p) out['Provides class'] = p; }
  if (ext === 'sty') { const p = pick(text, /\\ProvidesPackage\{([^}]+)\}(?:\[([^\]]*)\])?/); if (p) out['Provides package'] = p; }
  const title = pick(text, /\\title\{([^}]*)\}/); if (title) out['Title'] = title.replace(/\\\w+\{?|\}/g, '').trim();
  const author = pick(text, /\\author\{([^}]*)\}/); if (author) out['Author'] = author.replace(/\\\w+\{?|\}|\\and/g, ' ').replace(/\s+/g, ' ').trim();
  const pkgs = Array.from(text.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)).flatMap((m) => m[1].split(',').map((s) => s.trim())).filter(Boolean);
  if (pkgs.length) out['Packages'] = pkgs.length + ': ' + Array.from(new Set(pkgs)).slice(0, 20).join(', ');
  out['Sections'] = countRe(text, /\\(?:chapter|section|subsection|subsubsection)\*?\{/g);
  out['Figures'] = countRe(text, /\\begin\{figure\*?\}/g);
  out['Tables'] = countRe(text, /\\begin\{table\*?\}/g);
  out['Equations'] = countRe(text, /\\begin\{(?:equation|align|gather|multline)\*?\}/g);
  out['Citations'] = countRe(text, /\\cite[tp]?\*?\{/g);
  const includes = Array.from(text.matchAll(/\\(?:input|include)\{([^}]+)\}/g)).map((m) => m[1]);
  if (includes.length) out['Includes'] = includes.length;
  const bib = pick(text, /\\bibliography\{([^}]+)\}/) || (text.match(/\\addbibresource\{([^}]+)\}/) || [])[1];
  if (bib) out['Bibliography'] = bib;
  if (includes.length) out._sections = [{ title: 'Includes (' + includes.length + ')', node: preBlock(includes.join('\n')) }];
  return out;
}

// ---------- BibTeX (.bib) ----------
async function parseBib(file) {
  const text = await fileText(file, 8 * 1024 * 1024);
  const entries = Array.from(text.matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,/g));
  if (!entries.length) return null;
  const out = { 'Format': 'BibTeX bibliography (.bib)' };
  out['Entries'] = entries.filter((m) => !/^(string|preamble|comment)$/i.test(m[1])).length;
  const byType = {}; const keys = []; const dupKeys = new Set(); const seen = new Set();
  for (const m of entries) {
    const type = m[1].toLowerCase();
    if (/^(string|preamble|comment)$/.test(type)) continue;
    byType[type] = (byType[type] || 0) + 1;
    const key = m[2];
    if (seen.has(key)) dupKeys.add(key); else seen.add(key);
    keys.push(key);
  }
  out['Entry types'] = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' (' + v + ')').join(', ');
  const years = Array.from(text.matchAll(/\byear\s*=\s*[{"]?\s*(\d{4})/gi)).map((m) => parseInt(m[1], 10)).filter((y) => y > 1000 && y < 2100);
  if (years.length) out['Year range'] = Math.min(...years) + '–' + Math.max(...years);
  if (dupKeys.size) out['⚠ Duplicate keys'] = dupKeys.size + ': ' + Array.from(dupKeys).slice(0, 10).join(', ');
  out._sections = [{ title: 'Citation keys (' + keys.length + ')', node: preBlock(keys.join('\n')) }];
  return out;
}

// ---------- reStructuredText (.rst) ----------
const RST_UNDERLINE = /^[=\-`:.'"~^_*+#]{3,}\s*$/;
async function parseRst(file) {
  const text = await fileText(file, 4 * 1024 * 1024);
  const lines = text.split(/\r?\n/);
  const out = { 'Format': 'reStructuredText (.rst)' };
  const headings = [];
  for (let i = 1; i < lines.length; i++) {
    if (RST_UNDERLINE.test(lines[i]) && lines[i - 1].trim() && lines[i].trim()[0] && lines[i].length >= lines[i - 1].trim().length - 2) {
      const txt = lines[i - 1].trim();
      if (txt && !/^[=\-`:.'"~^_*+#]+$/.test(txt)) headings.push(lines[i].trim()[0] + ' ' + txt);
    }
  }
  out['Headings'] = headings.length;
  out['Directives'] = countRe(text, /^\.\.\s+[\w-]+::/gm);
  out['Links / refs'] = countRe(text, /`[^`]+`_|\.\.\s+_[\w -]+:/g);
  out['Code blocks'] = countRe(text, /^\.\.\s+code(?:-block)?::/gm) + countRe(text, /::\s*$/gm);
  out['Words'] = (text.match(/\S+/g) || []).length;
  if (headings.length) out._sections = [{ title: 'Outline (' + headings.length + ')', node: preBlock(headings.slice(0, 200).join('\n')) }];
  return out;
}

// ---------- AsciiDoc (.adoc / .asciidoc) ----------
async function parseAdoc(file) {
  const text = await fileText(file, 4 * 1024 * 1024);
  const lines = text.split(/\r?\n/);
  const out = { 'Format': 'AsciiDoc (.adoc)' };
  const titleLine = lines.find((l) => /^=\s+\S/.test(l));
  if (titleLine) out['Title'] = titleLine.replace(/^=\s+/, '').trim();
  // Line right after a doc title (no markup) is author; revision starts with 'v'.
  if (titleLine) {
    const idx = lines.indexOf(titleLine);
    const a = (lines[idx + 1] || '').trim();
    if (a && !/^[:=]/.test(a) && !RST_UNDERLINE.test(a)) out['Author'] = a.split('<')[0].trim();
    const rev = (lines[idx + 2] || '').trim();
    if (/^v?\d/.test(rev)) out['Revision'] = rev;
  }
  const headings = lines.filter((l) => /^={2,6}\s+\S/.test(l)).map((l) => l.replace(/^(=+)\s+/, (_, e) => '  '.repeat(e.length - 1) + '• ').trimEnd());
  out['Sections'] = headings.length;
  const attrs = Array.from(text.matchAll(/^:([\w!-]+):/gm)).map((m) => m[1]);
  if (attrs.length) out['Attributes'] = attrs.length;
  out['Includes'] = countRe(text, /^include::/gm);
  out['Images'] = countRe(text, /image::?[^\[]+\[/g);
  if (headings.length) out._sections = [{ title: 'Outline (' + headings.length + ')', node: preBlock(headings.slice(0, 200).join('\n')) }];
  return out;
}

// ---------- Emacs Org-mode (.org) ----------
async function parseOrg(file) {
  const text = await fileText(file, 4 * 1024 * 1024);
  const out = { 'Format': 'Emacs Org-mode (.org)' };
  const title = pick(text, /^#\+TITLE:\s*(.+)$/im); if (title) out['Title'] = title;
  const author = pick(text, /^#\+AUTHOR:\s*(.+)$/im); if (author) out['Author'] = author;
  const date = pick(text, /^#\+DATE:\s*(.+)$/im); if (date) out['Date'] = date;
  const headings = (text.match(/^\*+\s+.+$/gm) || []);
  out['Headings'] = headings.length;
  out['TODO'] = countRe(text, /^\*+\s+TODO\b/gm);
  out['DONE'] = countRe(text, /^\*+\s+DONE\b/gm);
  out['Code blocks'] = countRe(text, /^#\+BEGIN_SRC\b/gim);
  // Outline preview.
  const outline = headings.slice(0, 200).map((h) => {
    const m = h.match(/^(\*+)\s+(.*)$/);
    return '  '.repeat(m[1].length - 1) + '• ' + m[2];
  });
  if (outline.length) out._sections = [{ title: 'Outline (' + headings.length + ')', node: preBlock(outline.join('\n')) }];
  return out;
}

// ---------- Textile (.textile) ----------
async function parseTextile(file) {
  const text = await fileText(file, 4 * 1024 * 1024);
  const out = { 'Format': 'Textile markup (.textile)' };
  const headings = (text.match(/^h[1-6]\.\s+.+$/gm) || []);
  out['Headings'] = headings.length;
  out['Links'] = countRe(text, /"[^"]+":\S+/g);
  out['Images'] = countRe(text, /!\S+!/g);
  out['Words'] = (text.match(/\S+/g) || []).length;
  if (headings.length) out._sections = [{ title: 'Outline', node: preBlock(headings.slice(0, 200).map((h) => h.replace(/^h(\d)\.\s+/, (_, n) => '  '.repeat(n - 1) + '• ')).join('\n')) }];
  return out;
}

// ---------- TEI XML (.tei) ----------
async function parseTei(file) {
  const text = await fileText(file, 6 * 1024 * 1024);
  if (!/<TEI[\s>]/i.test(text) && !/<teiHeader/i.test(text)) return null;
  const out = { 'Format': 'TEI XML (Text Encoding Initiative)' };
  const t = tag(text, 'title'); if (t) out['Title'] = t;
  const author = tag(text, 'author'); if (author) out['Author'] = author;
  const pub = tag(text, 'publisher'); if (pub) out['Publisher'] = pub;
  out['Divisions'] = countRe(text, /<div\b/gi);
  out['Paragraphs'] = countRe(text, /<p[\s>]/gi);
  out['Page breaks'] = countRe(text, /<pb\b/gi);
  out['Notes'] = countRe(text, /<note\b/gi);
  return out;
}

// ---------- R Markdown / Quarto (.rmd / .qmd) ----------
async function parseRmd(file, ext) {
  const text = await fileText(file, 4 * 1024 * 1024);
  const out = { 'Format': ext === 'qmd' ? 'Quarto document (.qmd)' : 'R Markdown (.rmd)' };
  // YAML front-matter between leading --- fences.
  const ym = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (ym) {
    const y = ym[1];
    const title = pick(y, /^title:\s*["']?(.+?)["']?\s*$/im); if (title) out['Title'] = title;
    const author = pick(y, /^author:\s*["']?(.+?)["']?\s*$/im); if (author) out['Author'] = author;
    const fmt = pick(y, /^format:\s*(.+)$/im) || pick(y, /^output:\s*(.+)$/im); if (fmt) out['Output / format'] = fmt;
    const engine = pick(y, /^engine:\s*(.+)$/im); if (engine) out['Engine'] = engine;
  }
  // Fenced code chunks ```{engine ...}
  const chunks = Array.from(text.matchAll(/^```\{([a-zA-Z0-9_]+)/gm)).map((m) => m[1].toLowerCase());
  out['Code chunks'] = chunks.length;
  if (chunks.length) {
    const byEng = {};
    for (const c of chunks) byEng[c] = (byEng[c] || 0) + 1;
    out['Chunks by engine'] = Object.entries(byEng).map(([k, v]) => k + ' (' + v + ')').join(', ');
  }
  out['Headings'] = countRe(text, /^#{1,6}\s+\S/gm);
  return out;
}

// ---------- Apple RTFD (.rtfd) ----------
async function parseRtfd(file) {
  // .rtfd is a package; if dropped as a file it may be a flattened bundle. Treat
  // best-effort: look for an inner TXT.rtf header in the bytes.
  const text = await fileText(file, 2 * 1024 * 1024);
  const out = { 'Format': 'Apple RTFD document (.rtfd)' };
  if (/\{\\rtf/i.test(text)) {
    out['Inner RTF'] = 'TXT.rtf present';
    const ansicpg = pick(text, /\\ansicpg(\d+)/i); if (ansicpg) out['Code page'] = 'cp' + ansicpg;
    const cocoa = pick(text, /\\cocoartf(\d+)/i); if (cocoa) out['Cocoa RTF version'] = cocoa;
  } else {
    out['Note'] = 'RTFD bundle (TXT.rtf + attachments) - drop the .rtfd folder to inspect attachments';
  }
  out['Embedded refs'] = countRe(text, /\\NeXTGraphic\b/gi);
  return out;
}

// ---------- MHTML / MHT web archive ----------
async function parseMht(file) {
  const text = await fileText(file, 4 * 1024 * 1024);
  if (!/Content-Type:\s*multipart\/related/i.test(text) && !/^From:\s*<Saved by/im.test(text)) {
    if (!/MIME-Version:/i.test(text)) return null;
  }
  const out = { 'Format': 'MHTML web archive (.mht / .mhtml)' };
  const subject = pick(text, /^Subject:\s*(.+)$/im); if (subject) out['Title'] = subject.trim();
  const date = pick(text, /^Date:\s*(.+)$/im); if (date) out['Saved'] = date.trim();
  const snapshot = pick(text, /^Snapshot-Content-Location:\s*(.+)$/im); if (snapshot) out['Original URL'] = snapshot.trim();
  // Resource inventory by Content-Type.
  const types = {};
  for (const m of text.matchAll(/^Content-Type:\s*([^;\r\n]+)/gim)) {
    const ct = m[1].trim().toLowerCase();
    if (/multipart/.test(ct)) continue;
    types[ct] = (types[ct] || 0) + 1;
  }
  const total = Object.values(types).reduce((a, b) => a + b, 0);
  out['Resources'] = total;
  if (Object.keys(types).length) {
    out._sections = [{ title: 'By content-type', node: preBlock(Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ': ' + v).join('\n')) }];
  }
  return out;
}

// ---------- WARC (.warc) ----------
async function parseWarc(file, ext) {
  // .warc.gz handled as identification (gz wrapper) unless plain; try plain text.
  if (ext === 'warc.gz' || /\.gz$/i.test((file.name || ''))) {
    return { 'Format': 'Web ARChive (gzip-compressed, .warc.gz)', 'Note': 'Each record is individually gzipped; decompress to enumerate (browser DecompressionStream can inflate per-record).' };
  }
  const text = await fileText(file, 6 * 1024 * 1024);
  if (!/^WARC\/\d/m.test(text)) return null;
  const out = { 'Format': 'Web ARChive (.warc)' };
  const types = {}; const urls = new Set(); const hosts = new Set(); const dates = [];
  for (const m of text.matchAll(/^WARC-Type:\s*(\S+)/gim)) types[m[1].toLowerCase()] = (types[m[1].toLowerCase()] || 0) + 1;
  for (const m of text.matchAll(/^WARC-Target-URI:\s*(\S+)/gim)) {
    const u = m[1].trim(); urls.add(u);
    try { hosts.add(new URL(u).host); } catch (_) {}
  }
  for (const m of text.matchAll(/^WARC-Date:\s*(\S+)/gim)) dates.push(m[1]);
  out['Records (scanned)'] = Object.values(types).reduce((a, b) => a + b, 0);
  out['Record types'] = Object.entries(types).map(([k, v]) => k + ' (' + v + ')').join(', ');
  out['Distinct URLs'] = urls.size;
  out['Distinct hosts'] = hosts.size;
  if (dates.length) { dates.sort(); out['Date range'] = dates[0] + ' → ' + dates[dates.length - 1]; }
  if (hosts.size) out._sections = [{ title: 'Hosts (' + hosts.size + ')', node: preBlock(Array.from(hosts).slice(0, 200).join('\n')) }];
  return out;
}

// ---------- MAFF (.maff) ----------
async function parseMaff(file) {
  let zip; try { zip = await openZip(file); } catch (_) { return null; }
  const out = { 'Format': 'Mozilla Archive Format (.maff)' };
  const rdfName = zip.names().find((n) => /index\.rdf$/i.test(n));
  if (rdfName) {
    const rdf = await zip.text(rdfName);
    const url = pick(rdf, /<MAF:originalurl[^>]*\bRDF:resource="([^"]+)"/i) || pick(rdf, /originalurl[^>]*>([^<]+)</i);
    if (url) out['Original URL'] = url;
    const title = pick(rdf, /<MAF:title[^>]*\bRDF:resource="([^"]+)"/i) || pick(rdf, /title[^>]*>([^<]+)</i);
    if (title) out['Title'] = title;
    const date = pick(rdf, /<MAF:archivetime[^>]*\bRDF:resource="([^"]+)"/i) || pick(rdf, /archivetime[^>]*>([^<]+)</i);
    if (date) out['Capture date'] = date;
  }
  // Top-level page folders.
  const folders = new Set();
  for (const n of zip.names()) { const f = n.split('/')[0]; if (f) folders.add(f); }
  out['Archived pages'] = folders.size;
  out['Resources'] = zip.entries.filter((e) => !/\/$/.test(e.name)).length;
  return out;
}

// ---------- JATS / NXML journal article ----------
async function parseJats(file) {
  const text = await fileText(file, 6 * 1024 * 1024);
  if (!/<article\b/i.test(text) && !/JATS|journalpublishing/i.test(text)) return null;
  const out = { 'Format': 'JATS journal article XML' };
  const meta = (text.match(/<article-meta>([\s\S]*?)<\/article-meta>/i) || [])[1] || text;
  const title = tag(meta, 'article-title'); if (title) out['Title'] = title;
  const journal = tag(text, 'journal-title'); if (journal) out['Journal'] = journal;
  const doi = (meta.match(/<article-id[^>]*pub-id-type="doi"[^>]*>([^<]+)</i) || [])[1]; if (doi) out['DOI'] = doi.trim();
  // Authors from contrib name elements.
  const authors = Array.from(meta.matchAll(/<contrib\b[^>]*>([\s\S]*?)<\/contrib>/gi))
    .map((m) => { const sn = tag(m[1], 'surname'); const gn = tag(m[1], 'given-names'); return [gn, sn].filter(Boolean).join(' '); })
    .filter(Boolean);
  if (authors.length) out['Authors'] = authors.slice(0, 12).join('; ') + (authors.length > 12 ? '; …' : '');
  out['References'] = countRe(text, /<ref\b/gi);
  out['Figures'] = countRe(text, /<fig\b/gi);
  out['Tables'] = countRe(text, /<table-wrap\b/gi);
  const abstract = tag(text, 'abstract');
  if (abstract) out._sections = [{ title: 'Abstract', node: preBlock(abstract.replace(/\s+/g, ' ').trim()) }];
  return out;
}

// ---------- DVI (.dvi) ----------
async function parseDvi(file) {
  const b = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  // Preamble opcode 247, then version (2 = standard, 3 = XeTeX).
  if (b[0] !== 0xf7) return null;
  const version = b[1];
  const r = new Reader(b); r.seek(2);
  const num = r.u32();    // numerator
  const den = r.u32();    // denominator
  const mag = r.u32();    // magnification
  const cmtLen = r.u8();
  const comment = ascii(b, 15, cmtLen);
  const out = {
    'Format': 'TeX DVI (Device Independent)',
    'DVI version': version + (version === 2 ? ' (standard)' : version === 3 ? ' (XeTeX)' : version === 5 ? ' (pTeX)' : ''),
    'Magnification': (mag / 1000).toFixed(3) + '×',
    'Units': num + '/' + den,
  };
  if (comment) out['Comment'] = comment;
  // Page count: postamble (opcode 248) holds it; scan from tail for bop (139) count instead.
  // Read a tail chunk and count 'bop' (0x8B) page-begin opcodes is unreliable;
  // instead read the postamble pointer at the very end (4 bytes before the 223 padding).
  return out;
}

// ---------- identification-only (rare AND hard) ----------
function ident(name, note) { return () => ({ 'Format': name, 'Note': note }); }

// ---------- dispatch ----------
export const PARSERS = {
  // Comic books
  cbz: (c) => parseCbz(c.file),
  cbt: (c) => parseCbt(c.file),
  // OPC / ZIP docs
  xps: (c) => parseXps(c.file, c.ext),
  oxps: (c) => parseXps(c.file, c.ext),
  hwpx: (c) => parseHwpx(c.file),
  fb3: (c) => parseFb3(c.file),
  ibooks: (c) => parseIbooks(c.file),
  scriv: (c) => parseScriv(c.file, c.ext),
  scrivx: (c) => parseScriv(c.file, c.ext),
  abw: (c) => parseAbw(c.file, c.ext),
  zabw: (c) => parseAbw(c.file, c.ext),
  sxw: (c) => parseSx(c.file, c.ext),
  sxc: (c) => parseSx(c.file, c.ext),
  sxi: (c) => parseSx(c.file, c.ext),
  fodt: (c) => parseFodt(c.file, c.ext),
  fods: (c) => parseFodt(c.file, c.ext),
  fodp: (c) => parseFodt(c.file, c.ext),
  fodg: (c) => parseFodt(c.file, c.ext),
  ott: (c) => parseOtt(c.file, c.ext),
  ots: (c) => parseOtt(c.file, c.ext),
  otp: (c) => parseOtt(c.file, c.ext),
  dotx: (c) => parseDotx(c.file, c.ext),
  dotm: (c) => parseDotx(c.file, c.ext),
  vsdx: (c) => parseVsdx(c.file),
  // TeX / markup
  tex: (c) => parseTex(c.file, c.ext),
  latex: (c) => parseTex(c.file, c.ext),
  sty: (c) => parseTex(c.file, c.ext),
  cls: (c) => parseTex(c.file, c.ext),
  bib: (c) => parseBib(c.file),
  rst: (c) => parseRst(c.file),
  adoc: (c) => parseAdoc(c.file),
  asciidoc: (c) => parseAdoc(c.file),
  org: (c) => parseOrg(c.file),
  textile: (c) => parseTextile(c.file),
  tei: (c) => parseTei(c.file),
  rmd: (c) => parseRmd(c.file, c.ext),
  qmd: (c) => parseRmd(c.file, c.ext),
  rtfd: (c) => parseRtfd(c.file),
  // Web archives
  mht: (c) => parseMht(c.file),
  mhtml: (c) => parseMht(c.file),
  warc: (c) => parseWarc(c.file, c.ext),
  maff: (c) => parseMaff(c.file),
  // Journals / structured
  jats: (c) => parseJats(c.file),
  nxml: (c) => parseJats(c.file),
  dvi: (c) => parseDvi(c.file),
  // Comic Book RAR / 7-Zip: extract + preview via libarchive WASM, falling
  // back to identification rows if the decoder fails to load or parse.
  cbr: async (c) => (await parseComicArchive(c.file, 'cbr')) ||
    ident('Comic Book RAR (.cbr)', 'RAR-compressed comic; the in-browser unrar decoder could not read it (identification only).')(),
  cb7: async (c) => (await parseComicArchive(c.file, 'cb7')) ||
    ident('Comic Book 7-Zip (.cb7)', '7z-compressed comic; the in-browser 7z decoder could not read it (identification only).')(),
  // identification-only: rare AND hard (or needing external decoders wired later)
  chm: ident('Compiled HTML Help (.chm)', 'Microsoft ITSF help container; identification only.'),
  wpd: ident('WordPerfect Document (.wpd)', 'Corel WordPerfect; identification only.'),
  pub: ident('Microsoft Publisher (.pub)', 'OLE2/CFBF container; needs a CFBF reader (wired later) for metadata.'),
  hwp: ident('Hangul Word Processor (.hwp)', 'OLE2/CFBF container; needs a CFBF reader (wired later) for metadata.'),
  qxd: ident('QuarkXPress Document (.qxd)', 'Quark proprietary binary; identification only.'),
  qxp: ident('QuarkXPress Project (.qxp)', 'Quark proprietary binary; identification only.'),
  pmd: ident('Adobe PageMaker (.pmd)', 'PageMaker proprietary binary; identification only.'),
  lit: ident('Microsoft Reader eBook (.lit)', 'ITOLITLS DRM container; identification only.'),
  kfx: ident('Amazon Kindle KFX (.kfx)', 'Amazon KFX/KDF container; identification only.'),
};
