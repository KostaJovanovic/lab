/* Analyser - lazy parser chunk: video / streaming containers & manifests.

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'video'` is opened. Each entry in PARSERS is `({head, file, ext}) =>
   rows` where `rows` is a plain object of label->value pairs, optionally carrying
   `_sections: [{title, node, open?}]` for collapsible blocks and `_previewNode`
   for a decoded preview. Return null to fall back to the generic identification
   card. Dependency-free: only the shared binary toolkit + DOM helpers.

   Covers: streaming manifests (HLS m3u8/m3u, DASH mpd, Smooth Streaming ism/ismc,
   Adobe HDS f4m, playlists asx/wpl/xspf/pls); pro/broadcast (MXF, GXF, LXF, DV);
   ASF/RealMedia (asf, rm/rmvb); MP4-family wrappers (divx, f4v, insv/insp, lrv,
   gifv); elementary streams (ivf, y4m, m2v/m1v/mpv, raw H.264/H.265, AV1 obu,
   MPEG PS/TS); recordings (wtv, dvr-ms, trp/tp PVR, ogm); other containers (nut);
   plus identification-only for the rare+hard ones (dpx, cin, dav, yuv). */

import { el, row, fmtBytes } from '../core/util.js';
import { Reader, ascii, findBytes, matchMagic, startsWithAscii, latin1, utf8 } from '../core/binutil.js';

// ---------- small helpers ----------

// A scrollable <pre> for raw text / listings.
function preBlock(text, cls) {
  return el('pre', { class: cls || 'anr-code', style: 'max-height:360px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0;' }, text);
}

// Read up to `n` bytes from a File starting at `off`. Returns Uint8Array.
async function readSlice(file, off, n) {
  const end = Math.min(file.size, off + n);
  if (off >= file.size) return new Uint8Array(0);
  return new Uint8Array(await file.slice(off, end).arrayBuffer());
}

// Seconds -> H:MM:SS(.mmm) string.
function fmtDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '-';
  const whole = Math.floor(sec);
  const ms = Math.round((sec - whole) * 1000);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const hh = h > 0 ? h + ':' : '';
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return hh + mm + ':' + ss + (ms ? '.' + String(ms).padStart(3, '0') : '');
}

// Parse an ISO-8601 duration (PnYnMnDTnHnMnS) into seconds, or null.
function parseIsoDuration(s) {
  if (!s) return null;
  const m = /^-?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, w, d, h, mi, se] = m.map((x) => (x == null ? 0 : parseFloat(x)));
  return y * 31536000 + mo * 2592000 + w * 604800 + d * 86400 + h * 3600 + mi * 60 + se;
}

// Parse XML text into a Document, or null on parse error.
function parseXml(text) {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    return doc;
  } catch (_) { return null; }
}

// Read the full file as text, capped to a sane size for text manifests.
async function readText(file, cap = 4 * 1024 * 1024) {
  return file.slice(0, Math.min(file.size, cap)).text();
}

// ============================================================================
//  STREAMING MANIFESTS (text / XML)
// ============================================================================

// ---------- HLS .m3u8 / .m3u ----------
function parseHls(text, ext) {
  // Plain (non-HLS) M3U fallback handled by parsePlaylist; require #EXTM3U here.
  if (!/#EXTM3U/.test(text)) return null;
  const isHls = /#EXT-X-/.test(text);
  if (!isHls) return null; // basic .m3u handled elsewhere
  const lines = text.split(/\r?\n/);
  const out = { 'Format': 'HLS playlist (.' + ext + ')' };
  const ver = (text.match(/#EXT-X-VERSION:(\d+)/) || [])[1];
  if (ver) out['HLS version'] = ver;

  const isMaster = /#EXT-X-STREAM-INF/.test(text);
  out['Playlist type'] = isMaster ? 'Master (variant) playlist' : 'Media (segment) playlist';

  if (isMaster) {
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = l.slice('#EXT-X-STREAM-INF:'.length);
        const bw = (attrs.match(/BANDWIDTH=(\d+)/) || [])[1];
        const res = (attrs.match(/RESOLUTION=([0-9x]+)/) || [])[1];
        const codecs = (attrs.match(/CODECS="([^"]*)"/) || [])[1];
        const fr = (attrs.match(/FRAME-RATE=([\d.]+)/) || [])[1];
        // URI is the next non-comment line.
        let uri = '';
        for (let j = i + 1; j < lines.length; j++) { const t = lines[j].trim(); if (t && !t.startsWith('#')) { uri = t; break; } }
        variants.push({ bw: bw ? parseInt(bw, 10) : 0, res, codecs, fr, uri });
      }
    }
    const audioGroups = (text.match(/#EXT-X-MEDIA:TYPE=AUDIO/g) || []).length;
    const subGroups = (text.match(/#EXT-X-MEDIA:TYPE=SUBTITLES/g) || []).length;
    out['Variant streams'] = variants.length;
    if (audioGroups) out['Alternate audio renditions'] = audioGroups;
    if (subGroups) out['Subtitle renditions'] = subGroups;
    const bws = variants.map((v) => v.bw).filter(Boolean);
    if (bws.length) out['Bandwidth range'] = Math.round(Math.min(...bws) / 1000) + ' - ' + Math.round(Math.max(...bws) / 1000) + ' kbps';
    if (variants.length) {
      const rows = variants.sort((a, b) => a.bw - b.bw).map((v) => {
        const parts = [];
        if (v.res) parts.push(v.res);
        if (v.bw) parts.push(Math.round(v.bw / 1000) + ' kbps');
        if (v.fr) parts.push(v.fr + ' fps');
        if (v.codecs) parts.push(v.codecs);
        return (parts.join('  ') || '(variant)') + (v.uri ? '\n    -> ' + v.uri : '');
      });
      out._sections = [{ title: 'Variants (' + variants.length + ')', node: preBlock(rows.join('\n')), open: true }];
    }
  } else {
    const durs = [];
    for (const m of text.matchAll(/#EXTINF:([\d.]+)/g)) durs.push(parseFloat(m[1]));
    const total = durs.reduce((a, b) => a + b, 0);
    out['Segments'] = durs.length;
    if (durs.length) {
      out['Total runtime'] = fmtDuration(total);
      out['Target duration'] = (text.match(/#EXT-X-TARGETDURATION:(\d+)/) || [])[1] || '-';
    }
    const ptype = (text.match(/#EXT-X-PLAYLIST-TYPE:(\w+)/) || [])[1];
    if (ptype) out['Type'] = ptype;
    out['Live / VOD'] = /#EXT-X-ENDLIST/.test(text) ? 'VOD (has ENDLIST)' : 'Live / event (no ENDLIST)';
    const map = text.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (map) out['Init segment (fMP4)'] = map[1];
  }

  const keyMatch = text.match(/#EXT-X-KEY:([^\r\n]+)/);
  if (keyMatch) {
    const method = (keyMatch[1].match(/METHOD=([A-Z0-9-]+)/) || [])[1];
    const fmt = (keyMatch[1].match(/KEYFORMAT="([^"]*)"/) || [])[1];
    out['Encryption'] = (method || 'present') + (fmt ? ' (' + fmt + ')' : '');
  } else {
    out['Encryption'] = 'none';
  }
  return out;
}

// ---------- MPEG-DASH .mpd ----------
function parseDash(text) {
  const doc = parseXml(text);
  if (!doc) return null;
  const mpd = doc.querySelector('MPD');
  if (!mpd) return null;
  const out = { 'Format': 'MPEG-DASH manifest (.mpd)' };
  const profiles = mpd.getAttribute('profiles');
  if (profiles) out['Profiles'] = profiles.split(',').map((p) => p.split(':').pop()).join(', ');
  out['Type'] = mpd.getAttribute('type') || 'static';
  const dur = parseIsoDuration(mpd.getAttribute('mediaPresentationDuration'));
  if (dur != null) out['Presentation duration'] = fmtDuration(dur);
  const minBuf = parseIsoDuration(mpd.getAttribute('minBufferTime'));
  if (minBuf != null) out['Min buffer time'] = minBuf + 's';

  const adaptSets = Array.from(doc.querySelectorAll('AdaptationSet'));
  const reps = Array.from(doc.querySelectorAll('Representation'));
  out['Periods'] = doc.querySelectorAll('Period').length;
  out['Adaptation sets'] = adaptSets.length;
  out['Representations'] = reps.length;

  const langs = new Set();
  let video = 0, audio = 0, text2 = 0;
  for (const a of adaptSets) {
    const ct = a.getAttribute('contentType') || (a.getAttribute('mimeType') || '').split('/')[0];
    if (/video/.test(ct)) video++; else if (/audio/.test(ct)) audio++; else if (/text|application/.test(ct)) text2++;
    const lng = a.getAttribute('lang'); if (lng) langs.add(lng);
  }
  out['Tracks'] = video + ' video, ' + audio + ' audio' + (text2 ? ', ' + text2 + ' text' : '');
  if (langs.size) out['Languages'] = Array.from(langs).join(', ');

  // DRM (ContentProtection)
  const cps = Array.from(doc.querySelectorAll('ContentProtection'));
  if (cps.length) {
    const systems = new Set();
    for (const cp of cps) {
      const scheme = (cp.getAttribute('schemeIdUri') || '').toLowerCase();
      if (scheme.includes('edef8ba9')) systems.add('Widevine');
      else if (scheme.includes('9a04f079')) systems.add('PlayReady');
      else if (scheme.includes('94ce86fb')) systems.add('FairPlay');
      else if (scheme.includes('mp4protection')) systems.add('Common Encryption (cenc)');
      else { const v = cp.getAttribute('value'); if (v) systems.add(v); }
    }
    out['DRM / protection'] = Array.from(systems).join(', ') || 'present';
  } else {
    out['DRM / protection'] = 'none (clear)';
  }

  // Per-representation detail
  const lines = reps.slice(0, 60).map((r) => {
    const id = r.getAttribute('id') || '?';
    const bw = r.getAttribute('bandwidth');
    const w = r.getAttribute('width'), h = r.getAttribute('height');
    const codec = r.getAttribute('codecs');
    const fr = r.getAttribute('frameRate');
    const parts = ['#' + id];
    if (w && h) parts.push(w + 'x' + h);
    if (bw) parts.push(Math.round(parseInt(bw, 10) / 1000) + ' kbps');
    if (fr) parts.push((/\//.test(fr) ? (eval2(fr)) : fr) + ' fps');
    if (codec) parts.push(codec);
    return parts.join('  ');
  });
  if (lines.length) out._sections = [{ title: 'Representations (' + reps.length + ')', node: preBlock(lines.join('\n')), open: true }];
  return out;
}

// Safe "a/b" -> number for frame-rate fractions (no eval).
function eval2(frac) {
  const m = /^(\d+)\/(\d+)$/.exec(frac);
  if (m && +m[2]) return Math.round((+m[1] / +m[2]) * 100) / 100;
  return frac;
}

// ---------- Smooth Streaming .ism / .ismc ----------
function parseSmooth(text) {
  const doc = parseXml(text);
  if (!doc) return null;
  const root = doc.querySelector('SmoothStreamingMedia, smil\\:smil, smil');
  const ssm = doc.querySelector('SmoothStreamingMedia');
  if (!ssm && !/SmoothStreamingMedia|<smil/i.test(text)) return null;
  const out = { 'Format': 'Smooth Streaming manifest' };
  if (ssm) {
    out['Manifest'] = '.ismc (client manifest)';
    const ver = ssm.getAttribute('MajorVersion');
    if (ver) out['Version'] = ver + '.' + (ssm.getAttribute('MinorVersion') || '0');
    const ts = parseInt(ssm.getAttribute('TimeScale') || '10000000', 10);
    const dur = parseInt(ssm.getAttribute('Duration') || '0', 10);
    if (dur && ts) out['Duration'] = fmtDuration(dur / ts);
    out['Live'] = ssm.getAttribute('IsLive') === 'TRUE' ? 'yes' : 'no';
    const indexes = Array.from(doc.querySelectorAll('StreamIndex'));
    out['Stream indexes'] = indexes.length;
    const langs = new Set();
    const lines = [];
    for (const si of indexes) {
      const type = si.getAttribute('Type');
      const lng = si.getAttribute('Language'); if (lng) langs.add(lng);
      const qualities = Array.from(si.querySelectorAll('QualityLevel'));
      lines.push(type + (lng ? ' [' + lng + ']' : '') + ': ' + qualities.length + ' quality level(s)');
      for (const q of qualities.slice(0, 12)) {
        const br = q.getAttribute('Bitrate');
        const w = q.getAttribute('MaxWidth'), h = q.getAttribute('MaxHeight');
        const fourcc = q.getAttribute('FourCC');
        const parts = ['   '];
        if (w && h) parts.push(w + 'x' + h);
        if (br) parts.push(Math.round(parseInt(br, 10) / 1000) + ' kbps');
        if (fourcc) parts.push(fourcc);
        lines.push(parts.join('  '));
      }
    }
    if (langs.size) out['Languages'] = Array.from(langs).join(', ');
    const prot = doc.querySelector('Protection');
    out['DRM / protection'] = prot ? 'PlayReady (Protection header present)' : 'none';
    if (lines.length) out._sections = [{ title: 'Quality levels', node: preBlock(lines.join('\n')), open: true }];
  } else {
    out['Manifest'] = '.ism (server manifest, SMIL)';
    const videos = doc.querySelectorAll('video').length;
    const audios = doc.querySelectorAll('audio').length;
    out['Video tracks'] = videos;
    out['Audio tracks'] = audios;
    const srcs = Array.from(doc.querySelectorAll('video, audio')).map((n) => n.getAttribute('src')).filter(Boolean);
    if (srcs.length) out._sections = [{ title: 'Sources', node: preBlock(srcs.join('\n')) }];
  }
  return out;
}

// ---------- Adobe HDS .f4m ----------
function parseF4m(text) {
  const doc = parseXml(text);
  if (!doc) return null;
  if (!/<manifest/i.test(text)) return null;
  const out = { 'Format': 'Adobe HDS manifest (.f4m)' };
  const id = doc.querySelector('id'); if (id) out['Stream ID'] = id.textContent.trim();
  const dur = doc.querySelector('duration'); if (dur) { const d = parseFloat(dur.textContent); if (d) out['Duration'] = fmtDuration(d); }
  const stype = doc.querySelector('streamType'); if (stype) out['Stream type'] = stype.textContent.trim();
  const medias = Array.from(doc.querySelectorAll('media'));
  out['Media (bitrates)'] = medias.length;
  const drm = doc.querySelector('drmAdditionalHeader, pv-2.0, drmMetadata');
  out['DRM'] = drm || /flashaccess|drm/i.test(text) ? 'Adobe Access (DRM present)' : 'none';
  const lines = medias.map((m) => {
    const br = m.getAttribute('bitrate');
    const w = m.getAttribute('width'), h = m.getAttribute('height');
    const url = m.getAttribute('url') || m.getAttribute('href') || '';
    const parts = [];
    if (w && h) parts.push(w + 'x' + h);
    if (br) parts.push(br + ' kbps');
    if (url) parts.push('-> ' + url);
    return parts.join('  ') || '(media)';
  });
  if (lines.length) out._sections = [{ title: 'Media renditions', node: preBlock(lines.join('\n')) }];
  return out;
}

// ---------- Generic playlists .asx / .wpl / .xspf / .pls ----------
function parsePlaylist(text, ext) {
  if (ext === 'pls') {
    if (!/\[playlist\]/i.test(text)) return null;
    const files = Array.from(text.matchAll(/^File\d+\s*=\s*(.+)$/gim)).map((m) => m[1].trim());
    const titles = Array.from(text.matchAll(/^Title\d+\s*=\s*(.+)$/gim)).map((m) => m[1].trim());
    const out = {
      'Format': 'PLS playlist (Winamp/SHOUTcast)',
      'Entries': (text.match(/^NumberOfEntries\s*=\s*(\d+)/im) || [])[1] || files.length,
      'Tracks / streams': files.length,
    };
    const lines = files.map((f, i) => (titles[i] ? titles[i] + '  ' : '') + f);
    if (lines.length) out._sections = [{ title: 'Entries', node: preBlock(lines.join('\n')) }];
    return out;
  }
  // ASX is often case-insensitive / not well-formed XML; use regex as fallback.
  if (ext === 'asx') {
    if (!/<asx/i.test(text)) return null;
    const entries = (text.match(/<entry\b/gi) || []).length;
    const refs = Array.from(text.matchAll(/<ref\b[^>]*href\s*=\s*"([^"]+)"/gi)).map((m) => m[1]);
    const titles = Array.from(text.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)).map((m) => m[1].trim());
    const out = {
      'Format': 'ASX playlist (Windows Media)',
      'Entries': entries || refs.length,
      'Stream references': refs.length,
    };
    if (titles.length) out['Titles'] = titles.slice(0, 5).join(' | ') + (titles.length > 5 ? ' …' : '');
    if (refs.length) out._sections = [{ title: 'Stream URLs', node: preBlock(refs.join('\n')) }];
    return out;
  }
  const doc = parseXml(text);
  if (ext === 'wpl') {
    if (!doc || !/<smil/i.test(text)) return null;
    const media = Array.from(doc.querySelectorAll('media')).map((m) => m.getAttribute('src')).filter(Boolean);
    const title = doc.querySelector('title');
    const out = {
      'Format': 'WPL playlist (Windows Media Player)',
      'Title': title ? title.textContent.trim() : '-',
      'Tracks': media.length,
    };
    if (media.length) out._sections = [{ title: 'Tracks', node: preBlock(media.join('\n')) }];
    return out;
  }
  if (ext === 'xspf') {
    if (!doc || !/<playlist/i.test(text)) return null;
    const tracks = Array.from(doc.querySelectorAll('track'));
    const title = doc.querySelector('playlist > title');
    const out = {
      'Format': 'XSPF playlist (XML Shareable Playlist)',
      'Playlist title': title ? title.textContent.trim() : '-',
      'Tracks': tracks.length,
    };
    const lines = tracks.slice(0, 200).map((t) => {
      const loc = t.querySelector('location');
      const ti = t.querySelector('title');
      return (ti ? ti.textContent.trim() + '  ' : '') + (loc ? loc.textContent.trim() : '');
    });
    if (lines.length) out._sections = [{ title: 'Tracks', node: preBlock(lines.join('\n')) }];
    return out;
  }
  return null;
}

// ============================================================================
//  PRO / BROADCAST
// ============================================================================

// ---------- MXF .mxf (SMPTE 377) ----------
const MXF_PARTITION = [0x06, 0x0E, 0x2B, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0D, 0x01, 0x02, 0x01, 0x01];
async function parseMxf(file) {
  const head = await readSlice(file, 0, 65536);
  // Header partition pack key: 06 0E 2B 34 02 05 01 01 0D 01 02 01 01 ...
  if (!matchMagic(head, MXF_PARTITION)) {
    // Some files start with a run-in; search for the key in the first 64KB.
    const idx = findBytes(head, new Uint8Array(MXF_PARTITION));
    if (idx < 0) return null;
  }
  const out = { 'Format': 'MXF (Material Exchange Format, SMPTE 377)' };
  // The partition pack key's byte 14 (index 13) is the partition status; byte 14
  // onward the version. Operational pattern is in byte 14 region of the key.
  let base = matchMagic(head, MXF_PARTITION) ? 0 : findBytes(head, new Uint8Array(MXF_PARTITION));
  if (base < 0) base = 0;
  // Operational Pattern label is registered; surface the OP byte (index 13 of key = kind).
  const opByte = head[base + 13];
  out['Partition'] = opByte === 0x02 ? 'Header (closed/complete)' : 'Header partition';
  // Operational Pattern is stored later in the header metadata; do a cheap scan
  // for the OP UL family (06 0E 2B 34 04 01 01 ... 0D 01 02 01 ...).
  // Decode major/minor version from partition pack body if present.
  try {
    const r = new Reader(head, false);
    r.seek(base + 16); // skip 16-byte key
    // BER length
    let len = r.u8();
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + r.u8(); }
    const major = r.u16(), minor = r.u16();
    out['MXF version'] = major + '.' + minor;
    const kagSize = r.u32();
    if (kagSize) out['KAG size'] = kagSize + ' bytes';
  } catch (_) {}
  // Operational pattern label heuristic: OP1a is the common one.
  const opUL = [0x06, 0x0E, 0x2B, 0x34, 0x04, 0x01, 0x01];
  const opIdx = findBytes(head, new Uint8Array(opUL));
  if (opIdx >= 0 && opIdx + 14 < head.length) {
    const b13 = head[opIdx + 12], b14 = head[opIdx + 13], b15 = head[opIdx + 14];
    if (b13 === 0x0D && b14 === 0x01 && b15 === 0x02) {
      // some OP labels live here; keep generic
    }
  }
  // Essence container labels carry the codec family - look for known ULs.
  const codecHints = [];
  const hex = (arr) => new Uint8Array(arr);
  if (findBytes(head, hex([0x04, 0x01, 0x02, 0x02, 0x01])) >= 0) codecHints.push('MPEG');
  if (findBytes(head, hex([0x0A, 0x0E, 0x10, 0x00])) >= 0 || findBytes(head, hex([0x6A, 0x70, 0x65, 0x67])) >= 0) codecHints.push('JPEG2000');
  // Surface any embedded company / product name (UTF-16 strings are common).
  const asciiBlob = ascii(head, 0, head.length);
  const prod = asciiBlob.match(/(Avid|Sony|Canon|Panasonic|FFmpeg|OP1a|XDCAM|ProRes|DNxHD|IMF)/i);
  if (prod) out['Product hint'] = prod[1];
  out['Note'] = 'KLV-structured SMPTE container; full essence/timecode decode needs the metadata sets.';
  return out;
}

// ---------- GXF .gxf (General eXchange Format, SMPTE 360M) ----------
async function parseGxf(file) {
  const head = await readSlice(file, 0, 64);
  // Packet leader: 00 00 00 00 01 (5 bytes) then packet type.
  if (!(head[0] === 0 && head[1] === 0 && head[2] === 0 && head[3] === 0 && head[4] === 0x01)) return null;
  const pktType = head[5];
  const out = { 'Format': 'GXF (General eXchange Format, SMPTE 360M)' };
  out['First packet type'] = pktType === 0xBC ? 'Map packet' : pktType === 0xBF ? 'Media packet' : pktType === 0xFB ? 'End-of-stream' : '0x' + pktType.toString(16);
  out['Vendor'] = 'Grass Valley (Profile/K2 servers)';
  out['Note'] = 'SMPTE 360M video server interchange container.';
  return out;
}

// ---------- LXF .lxf (Leitch eXchange Format) ----------
async function parseLxf(file) {
  const head = await readSlice(file, 0, 32);
  if (ascii(head, 0, 6) !== 'LEITCH') return null;
  const out = { 'Format': 'LXF (Leitch eXchange Format)' };
  out['Signature'] = 'LEITCH';
  out['Vendor'] = 'Leitch / Harris (broadcast servers)';
  out['Note'] = 'Header signature identified; stream/codec detail needs full LXF parsing.';
  return out;
}

// ---------- Raw DV .dv / .dif ----------
async function parseDv(file) {
  const head = await readSlice(file, 0, 480);
  // DIF block: section header (SCT) in top 3 bits of byte 0. Header block id is 0x1F at byte 0? Use DV header section: first block sct=0 (header).
  // DV DIF: byte0 top 3 bits = section type; header section = 000. Validate via the DSF/APT flags in the header block.
  if (head.length < 80) return null;
  // Header DIF block starts the frame; byte 3 of header section holds DSF (50/60).
  const sct = head[0] >> 5;
  if (sct !== 0) return null; // not a header section
  const out = { 'Format': 'Raw DV stream (.' + (file.name && /\.dif$/i.test(file.name) ? 'dif' : 'dv') + ')' };
  // DSF bit: byte 3 bit 7. 0 = NTSC (525/60), 1 = PAL (625/50).
  const dsf = (head[3] >> 7) & 1;
  out['Video system'] = dsf ? 'PAL (625/50)' : 'NTSC (525/60)';
  out['Resolution'] = dsf ? '720 x 576' : '720 x 480';
  out['Frame rate'] = dsf ? '25 fps' : '29.97 fps';
  // VAUX recording date/time lives in subcode/VAUX DIF blocks; do a light scan
  // of the first frame for the VAUX "recording date" pack (0x62) and time (0x63).
  try {
    const blob = head;
    // VAUX source control pack 0x61 carries aspect ratio bits.
    for (let i = 0; i + 5 <= blob.length; i += 1) {
      if (blob[i] === 0x61 && i + 4 < blob.length) {
        const aspect = (blob[i + 2] >> 0) & 0x07;
        out['Aspect ratio'] = (aspect === 0x02 || aspect === 0x07) ? '16:9' : '4:3';
        break;
      }
    }
  } catch (_) {}
  out['Audio'] = dsf ? '2ch 48kHz (typical PAL DV)' : '2ch 48kHz (typical NTSC DV)';
  out['Note'] = 'DV25 DIF-block stream; per-frame timecode in subcode blocks.';
  return out;
}

// ============================================================================
//  ASF / REALMEDIA
// ============================================================================

// ASF object GUIDs (little-endian, as stored).
const ASF_HEADER = [0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11, 0xA6, 0xD9, 0x00, 0xAA, 0x00, 0x62, 0xCE, 0x6C];
const ASF_FILE_PROPS = [0xA1, 0xDC, 0xAB, 0x8C, 0x47, 0xA9, 0xCF, 0x11, 0x8E, 0xE4, 0x00, 0xC0, 0x0C, 0x20, 0x53, 0x65];
const ASF_STREAM_PROPS = [0x91, 0x07, 0xDC, 0xB7, 0xB7, 0xA9, 0xCF, 0x11, 0x8E, 0xE6, 0x00, 0xC0, 0x0C, 0x20, 0x53, 0x65];
const ASF_CONTENT_DESC = [0x33, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11, 0xA6, 0xD9, 0x00, 0xAA, 0x00, 0x62, 0xCE, 0x6C];
const ASF_AUDIO_MEDIA = [0x40, 0x9E, 0x69, 0xF8, 0x4D, 0x5B, 0xCF, 0x11, 0xA8, 0xFD, 0x00, 0x80, 0x5F, 0x5C, 0x44, 0x2B];
const ASF_VIDEO_MEDIA = [0xC0, 0xEF, 0x19, 0xBC, 0x4D, 0x5B, 0xCF, 0x11, 0xA8, 0xFD, 0x00, 0x80, 0x5F, 0x5C, 0x44, 0x2B];

async function parseAsf(file, ext) {
  const head = await readSlice(file, 0, Math.min(file.size, 65536));
  if (!matchMagic(head, ASF_HEADER)) return null;
  const r = new Reader(head, true);
  r.seek(16); // header object GUID
  const headerSize = Number(r.u64());
  const numObjects = r.u32();
  r.skip(2);
  const isWmv = ext === 'wmv' || ext === 'wma' || ext === 'dvr-ms';
  const out = { 'Format': ext === 'dvr-ms' ? 'Microsoft Recorded TV (.dvr-ms, ASF)' : 'ASF (Advanced Systems Format)' };
  out['Header objects'] = numObjects;

  // File properties object.
  const fpIdx = findBytes(head, new Uint8Array(ASF_FILE_PROPS));
  if (fpIdx >= 0) {
    const fr = new Reader(head, true);
    fr.seek(fpIdx + 24); // 16 GUID + 8 size -> start of fields; FileID(16)+TotalSize(8)+CreationDate(8)+DataPackets(8)+PlayDur(8)+SendDur(8)+Preroll(8)
    fr.skip(16 + 8 + 8); // FileID, FileSize, CreationDate
    const dataPackets = Number(fr.u64());
    const playDur = Number(fr.u64()); // 100-ns units
    const sendDur = Number(fr.u64());
    const preroll = Number(fr.u64()); // ms
    fr.skip(4); // flags
    const minPkt = fr.u32(), maxPkt = fr.u32();
    const maxBitrate = fr.u32();
    const seconds = playDur / 1e7 - preroll / 1000;
    if (seconds > 0) out['Duration'] = fmtDuration(seconds);
    if (maxBitrate) out['Max bitrate'] = Math.round(maxBitrate / 1000) + ' kbps';
    out['Data packets'] = dataPackets.toLocaleString();
  }

  // Stream codecs.
  const streams = [];
  let pos = 30;
  for (let n = 0; n < numObjects && pos + 24 <= head.length; n++) {
    const guid = head.subarray(pos, pos + 16);
    const objSize = Number(new Reader(head, true).seek(pos + 16).u64());
    if (objSize <= 0 || objSize > headerSize) break;
    if (matchMagic(guid, ASF_STREAM_PROPS, 0)) {
      const sr = new Reader(head, true); sr.seek(pos + 24);
      const stType = head.subarray(pos + 24, pos + 40);
      let kind = 'unknown';
      if (matchMagic(stType, ASF_VIDEO_MEDIA, 0)) kind = 'video';
      else if (matchMagic(stType, ASF_AUDIO_MEDIA, 0)) kind = 'audio';
      streams.push(kind);
    }
    pos += objSize;
  }
  if (streams.length) {
    const v = streams.filter((s) => s === 'video').length;
    const a = streams.filter((s) => s === 'audio').length;
    out['Streams'] = streams.length + ' (' + v + ' video, ' + a + ' audio)';
  }

  // Content description (title/author/etc.) - UTF-16LE length-prefixed fields.
  const cdIdx = findBytes(head, new Uint8Array(ASF_CONTENT_DESC));
  if (cdIdx >= 0) {
    try {
      const cr = new Reader(head, true); cr.seek(cdIdx + 24);
      const lens = [cr.u16(), cr.u16(), cr.u16(), cr.u16(), cr.u16()];
      const labels = ['Title', 'Author', 'Copyright', 'Description', 'Rating'];
      for (let i = 0; i < 5; i++) {
        const blen = lens[i];
        if (blen > 0 && cr.pos + blen <= head.length) {
          const s = new TextDecoder('utf-16le').decode(head.subarray(cr.pos, cr.pos + blen)).replace(/\0+$/, '').trim();
          if (s) out[labels[i]] = s;
        }
        cr.skip(blen);
      }
    } catch (_) {}
  }
  if (ext === 'dvr-ms') out['Note'] = 'Windows Media Center recording (ASF with DVR extension objects).';
  return out;
}

// ---------- RealMedia .rm / .rmvb ----------
async function parseReal(file) {
  const head = await readSlice(file, 0, Math.min(file.size, 65536));
  if (ascii(head, 0, 4) !== '.RMF') return null;
  const out = { 'Format': 'RealMedia (.RMF)' };
  // Chunk walk: each chunk = 4-byte id + 4-byte size (big-endian).
  const streams = [];
  let pos = 0;
  try {
    while (pos + 8 <= head.length) {
      const id = ascii(head, pos, 4);
      const r = new Reader(head, false); r.seek(pos + 4);
      const size = r.u32();
      if (size < 8 || size > head.length) break;
      if (id === 'PROP') {
        const pr = new Reader(head, false); pr.seek(pos + 10);
        const maxBitrate = pr.u32(), avgBitrate = pr.u32();
        pr.skip(8); // max/avg packet size
        const numPackets = pr.u32();
        const duration = pr.u32(); // ms
        if (avgBitrate) out['Average bitrate'] = Math.round(avgBitrate / 1000) + ' kbps';
        if (duration) out['Duration'] = fmtDuration(duration / 1000);
        if (numPackets) out['Packets'] = numPackets.toLocaleString();
      } else if (id === 'MDPR') {
        // Media properties: stream name, mime type, type-specific data with FourCC.
        const mr = new Reader(head, false); mr.seek(pos + 10);
        mr.skip(4 * 5 + 2); // maxBitrate, avgBitrate, maxPktSize, avgPktSize, startTime... + preroll/duration vary
        // simpler: scan the chunk body for a known FourCC.
        const body = head.subarray(pos, Math.min(pos + size, head.length));
        const bs = ascii(body, 0, body.length);
        let codec = null;
        if (/VIDORV/.test(bs)) codec = 'RealVideo (' + (bs.match(/VIDORV(\w+)/) || [])[0] + ')';
        else if (/RV40|RV30|RV20|RV10/.test(bs)) codec = 'RealVideo ' + (bs.match(/RV\d0/) || [])[0];
        else if (/cook|raac|sipr|atrc|dnet|RAAC|COOK/i.test(bs)) codec = 'RealAudio (' + (bs.match(/cook|raac|sipr|atrc|dnet/i) || [])[0] + ')';
        streams.push(codec || 'stream');
      } else if (id === 'CONT') {
        // Content description: title/author/copyright/comment (length-prefixed).
        try {
          const cr = new Reader(head, false); cr.seek(pos + 10);
          for (const lbl of ['Title', 'Author', 'Copyright', 'Comment']) {
            const slen = cr.u16();
            if (slen > 0 && cr.pos + slen <= head.length) {
              const s = latin1(head.subarray(cr.pos, cr.pos + slen)).trim();
              if (s) out[lbl] = s;
            }
            cr.skip(slen);
          }
        } catch (_) {}
      } else if (id === 'DATA' || id === 'INDX') {
        break;
      }
      pos += size; // each chunk's size field (incl. the .RMF header) advances us
    }
  } catch (_) {}
  if (streams.length) out['Streams'] = streams.length + ': ' + streams.join(', ');
  out['Container'] = 'RealNetworks RealMedia';
  return out;
}

// ============================================================================
//  MP4-FAMILY WRAPPERS
// ============================================================================

// Walk top-level MP4/ISOBMFF boxes from a head buffer; returns map of box->offset
// and basic ftyp info. Also descends into moov/trak/mdia to pull resolution/codec.
function readMp4Boxes(buf) {
  const r = new Reader(buf, false); // boxes are big-endian
  const top = [];
  let ftyp = null;
  while (r.pos + 8 <= buf.length) {
    const start = r.pos;
    let size = r.u32();
    const type = ascii(buf, r.pos, 4); r.skip(4);
    if (size === 1) { size = Number(r.u64()); }
    else if (size === 0) { size = buf.length - start; }
    if (size < 8 || start + size > buf.length + 0x7fffffff) break;
    if (type === 'ftyp') ftyp = ascii(buf, start + 8, Math.min(size - 8, 4));
    top.push({ type, start, size });
    if (size <= 0) break;
    r.seek(start + size);
    if (top.length > 64) break;
  }
  return { top, ftyp };
}

// Pull video track resolution / codec from a moov box (best effort, head only).
function mp4TrackInfo(buf, moovStart, moovSize) {
  const info = { codecs: [], width: 0, height: 0, durationSec: 0, timescale: 0, fps: 0 };
  const end = Math.min(moovStart + moovSize, buf.length);
  // mvhd for overall timescale/duration.
  const mvhd = findBoxIn(buf, moovStart, end, 'mvhd');
  if (mvhd >= 0) {
    const r = new Reader(buf, false); r.seek(mvhd + 8);
    const ver = r.u8(); r.skip(3);
    if (ver === 1) { r.skip(16); info.timescale = r.u32(); info.durationSec = Number(r.u64()) / (info.timescale || 1); }
    else { r.skip(8); info.timescale = r.u32(); info.durationSec = r.u32() / (info.timescale || 1); }
  }
  // Find stsd sample entries (avc1/hev1/hvc1/vp09/av01/mp4a etc.).
  let scan = moovStart;
  const visualCodecs = { avc1: 'H.264/AVC', avc3: 'H.264/AVC', hev1: 'H.265/HEVC', hvc1: 'H.265/HEVC', vp08: 'VP8', vp09: 'VP9', av01: 'AV1', mp4v: 'MPEG-4 Visual', 'jpeg': 'MJPEG', s263: 'H.263' };
  const audioCodecs = { mp4a: 'AAC', 'ac-3': 'AC-3', 'ec-3': 'E-AC-3', 'Opus': 'Opus', alac: 'ALAC', 'fLaC': 'FLAC' };
  let stsd;
  while ((stsd = findBoxIn(buf, scan, end, 'stsd')) >= 0) {
    const r = new Reader(buf, false); r.seek(stsd + 8);
    r.skip(4); // version+flags
    const count = r.u32();
    for (let i = 0; i < count && r.pos + 8 <= end; i++) {
      const entStart = r.pos;
      const entSize = r.u32();
      const fmt = ascii(buf, r.pos, 4); r.skip(4);
      if (visualCodecs[fmt]) {
        info.codecs.push(visualCodecs[fmt]);
        // VisualSampleEntry: 6 reserved + 2 idx + 16 predefined/reserved -> width@24, height@26
        const w = buf.length > entStart + 8 + 24 + 1 ? (buf[entStart + 8 + 24] << 8) | buf[entStart + 8 + 25] : 0;
        const h = buf.length > entStart + 8 + 26 + 1 ? (buf[entStart + 8 + 26] << 8) | buf[entStart + 8 + 27] : 0;
        if (w && h && !info.width) { info.width = w; info.height = h; }
      } else if (audioCodecs[fmt]) {
        info.codecs.push(audioCodecs[fmt]);
      }
      if (entSize < 8) break;
      r.seek(entStart + entSize);
    }
    scan = stsd + 8;
  }
  return info;
}

// Find a box of `type` between [start,end) at any nesting (linear scan for the
// 4-char type preceded by a plausible 4-byte size). Good enough for head buffers.
function findBoxIn(buf, start, end, type) {
  const t = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
  for (let i = start; i + 8 <= end; i++) {
    if (buf[i + 4] === t[0] && buf[i + 5] === t[1] && buf[i + 6] === t[2] && buf[i + 7] === t[3]) return i;
  }
  return -1;
}

// Generic ISOBMFF/MP4 wrapper readout for f4v/lrv/insv/gifv-as-mp4/divx-as-mp4.
async function parseMp4Wrapper(file, label, note) {
  const buf = await readSlice(file, 0, Math.min(file.size, 1 << 20));
  const { top, ftyp } = readMp4Boxes(buf);
  if (!top.length || !top.some((b) => b.type === 'ftyp')) return null;
  const out = { 'Format': label };
  if (ftyp) out['Brand'] = ftyp;
  const moov = top.find((b) => b.type === 'moov');
  if (moov) {
    const info = mp4TrackInfo(buf, moov.start, moov.size);
    if (info.width && info.height) out['Resolution'] = info.width + ' x ' + info.height;
    if (info.durationSec) out['Duration'] = fmtDuration(info.durationSec);
    if (info.codecs.length) out['Codecs'] = Array.from(new Set(info.codecs)).join(', ');
    if (info.durationSec && file.size) out['Overall bitrate'] = Math.round((file.size * 8) / info.durationSec / 1000) + ' kbps';
  } else {
    out['moov'] = 'not in first 1 MB (fragmented or moov at end)';
  }
  if (note) out['Note'] = note;
  return out;
}

// ---------- DivX (.divx) - RIFF/AVI ----------
async function parseDivx(file) {
  const head = await readSlice(file, 0, 4096);
  if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 4) !== 'AVI ') {
    // Some .divx are actually MP4.
    return parseMp4Wrapper(file, 'DivX Media Format (.divx, MP4)', 'DivX-branded MP4 container.');
  }
  const out = { 'Format': 'DivX Media Format (.divx, RIFF/AVI)' };
  // avih main header inside hdrl.
  const avih = findBytes(head, new Uint8Array([0x61, 0x76, 0x69, 0x68])); // 'avih'
  if (avih >= 0) {
    const r = new Reader(head, true); r.seek(avih + 8);
    const usPerFrame = r.u32();
    r.skip(4 + 4 + 4);
    const totalFrames = r.u32();
    r.skip(4);
    const streams = r.u32();
    r.skip(4);
    const w = r.u32(), h = r.u32();
    if (w && h) out['Resolution'] = w + ' x ' + h;
    if (usPerFrame) { const fps = 1e6 / usPerFrame; out['Frame rate'] = (Math.round(fps * 100) / 100) + ' fps'; if (totalFrames) out['Duration'] = fmtDuration(totalFrames / fps); }
    if (totalFrames) out['Total frames'] = totalFrames.toLocaleString();
    out['Streams'] = streams;
  }
  // FourCC from strf BITMAPINFOHEADER (after 'strf').
  const strf = findBytes(head, new Uint8Array([0x73, 0x74, 0x72, 0x66]));
  if (strf >= 0 && strf + 8 + 20 < head.length) {
    const cc = ascii(head, strf + 8 + 16, 4);
    if (cc && /[A-Za-z0-9]/.test(cc)) out['Video FourCC'] = cc;
  }
  return out;
}

// ---------- Insta360 .insv / .insp ----------
async function parseInsta360(file, ext) {
  const isPhoto = ext === 'insp';
  if (isPhoto) {
    const head = await readSlice(file, 0, 8);
    // .insp is JPEG + trailer.
    if (!(head[0] === 0xFF && head[1] === 0xD8)) {
      // Some insp are PNG/other; still flag as Insta360.
    }
    const out = { 'Format': 'Insta360 photo (.insp)', 'Base image': head[0] === 0xFF && head[1] === 0xD8 ? 'JPEG' : 'image' };
    out['360 content'] = 'yes (dual-fisheye / equirectangular)';
    const tail = await readTrailerString(file);
    if (tail.model) out['Camera model'] = tail.model;
    out['Note'] = 'JPEG with an Insta360 trailer (model, dual-lens calibration, gyro/IMU).';
    return out;
  }
  const buf = await readSlice(file, 0, Math.min(file.size, 1 << 20));
  const { top, ftyp } = readMp4Boxes(buf);
  if (!top.some((b) => b.type === 'ftyp')) return null;
  const out = { 'Format': 'Insta360 video (.insv, MP4)' };
  if (ftyp) out['Brand'] = ftyp;
  const moov = top.find((b) => b.type === 'moov');
  if (moov) {
    const info = mp4TrackInfo(buf, moov.start, moov.size);
    if (info.width && info.height) out['Resolution'] = info.width + ' x ' + info.height;
    if (info.durationSec) out['Duration'] = fmtDuration(info.durationSec);
    if (info.codecs.length) out['Codecs'] = Array.from(new Set(info.codecs)).join(', ');
  }
  out['360 content'] = 'yes (dual-lens panoramic)';
  const tail = await readTrailerString(file);
  if (tail.model) out['Camera model'] = tail.model;
  out['Note'] = 'MP4 with an Insta360 trailer carrying model/gyro/IMU metadata.';
  return out;
}

// Read the file tail and look for an Insta360 magic + model string.
async function readTrailerString(file) {
  const res = {};
  try {
    const tail = await readSlice(file, Math.max(0, file.size - 64), 64);
    const s = ascii(tail, 0, tail.length);
    // Insta360 trailer signature "8db42d694ccc418790edff439fe026bf".
    if (/8db42d69|4ccc4187/i.test(s)) res.signature = true;
    const probe = await readSlice(file, Math.max(0, file.size - 4096), 4096);
    const txt = ascii(probe, 0, probe.length);
    const m = txt.match(/Insta360 ?(ONE [A-Z0-9]+|X\d?|GO ?\d?|RS|Pro ?\d?)/i);
    if (m) res.model = 'Insta360 ' + m[1];
  } catch (_) {}
  return res;
}

// ============================================================================
//  ELEMENTARY / RAW STREAMS
// ============================================================================

// ---------- IVF (.ivf) ----------
async function parseIvf(file) {
  const head = await readSlice(file, 0, 64);
  if (ascii(head, 0, 4) !== 'DKIF') return null;
  const r = new Reader(head, true); r.seek(4);
  const version = r.u16();
  const hdrLen = r.u16();
  const fourcc = ascii(head, 8, 4);
  const w = r.seek(12).u16(), h = r.u16();
  const rateNum = r.u32(), rateDen = r.u32();
  const frameCount = r.u32();
  const codecMap = { VP80: 'VP8', VP90: 'VP9', AV01: 'AV1', 'H264': 'H.264', HEVC: 'H.265' };
  const out = {
    'Format': 'IVF elementary stream',
    'Codec': (codecMap[fourcc] || fourcc) + ' (FourCC ' + fourcc + ')',
    'Resolution': w + ' x ' + h,
  };
  if (rateDen) { const fps = rateNum / rateDen; out['Frame rate'] = (Math.round(fps * 1000) / 1000) + ' fps'; out['Header time base'] = rateNum + '/' + rateDen; if (frameCount) out['Duration'] = fmtDuration(frameCount / fps); }
  if (frameCount) out['Frame count'] = frameCount.toLocaleString();
  out['Header version'] = version;
  return out;
}

// ---------- Y4M (.y4m) ----------
async function parseY4m(file) {
  const head = await readSlice(file, 0, 256);
  if (ascii(head, 0, 9) !== 'YUV4MPEG2') return null;
  // Header is one ASCII line ending in 0x0A.
  let end = 9; while (end < head.length && head[end] !== 0x0A) end++;
  const line = ascii(head, 0, end);
  const out = { 'Format': 'YUV4MPEG2 (.y4m raw)' };
  const w = (line.match(/\sW(\d+)/) || [])[1];
  const h = (line.match(/\sH(\d+)/) || [])[1];
  if (w && h) out['Resolution'] = w + ' x ' + h;
  const fr = (line.match(/\sF(\d+):(\d+)/) || []);
  if (fr[1]) { const fps = +fr[1] / (+fr[2] || 1); out['Frame rate'] = (Math.round(fps * 1000) / 1000) + ' fps (' + fr[1] + ':' + fr[2] + ')'; }
  const il = (line.match(/\sI(\w)/) || [])[1];
  const ilMap = { p: 'Progressive', t: 'Top-field-first', b: 'Bottom-field-first', m: 'Mixed' };
  if (il) out['Interlacing'] = ilMap[il] || il;
  const ar = (line.match(/\sA(\d+):(\d+)/) || []);
  if (ar[1]) out['Pixel aspect ratio'] = ar[1] + ':' + ar[2];
  const cs = (line.match(/\sC(\S+)/) || [])[1];
  if (cs) out['Chroma subsampling'] = cs;
  return out;
}

// ---------- MPEG-1/2 elementary .m2v / .m1v / .mpv ----------
const MPEG_AR = { 1: '1:1 (square)', 2: '4:3', 3: '16:9', 4: '2.21:1' };
const MPEG_FR = { 1: 23.976, 2: 24, 3: 25, 4: 29.97, 5: 30, 6: 50, 7: 59.94, 8: 60 };
async function parseMpegVideo(file, ext) {
  const head = await readSlice(file, 0, 4096);
  // Sequence header start code: 00 00 01 B3.
  const idx = findBytes(head, new Uint8Array([0x00, 0x00, 0x01, 0xB3]));
  if (idx < 0) return null;
  const p = idx + 4;
  if (p + 7 > head.length) return null;
  // 12 bits width, 12 bits height.
  const width = (head[p] << 4) | (head[p + 1] >> 4);
  const height = ((head[p + 1] & 0x0F) << 8) | head[p + 2];
  const arCode = head[p + 3] >> 4;
  const frCode = head[p + 3] & 0x0F;
  // bitrate: 18 bits starting at p+4.
  const bitrate = ((head[p + 4] << 10) | (head[p + 5] << 2) | (head[p + 6] >> 6)) >>> 0;
  const out = { 'Format': 'MPEG-1/2 elementary video (.' + ext + ')' };
  out['Resolution'] = width + ' x ' + height;
  out['Aspect ratio'] = MPEG_AR[arCode] || ('code ' + arCode);
  if (MPEG_FR[frCode]) out['Frame rate'] = MPEG_FR[frCode] + ' fps';
  if (bitrate && bitrate !== 0x3FFFF) out['Bitrate'] = Math.round(bitrate * 400 / 1000) + ' kbps';
  // MPEG-2 if a sequence extension start code 00 00 01 B5 follows.
  out['Profile'] = findBytes(head, new Uint8Array([0x00, 0x00, 0x01, 0xB5]), idx) >= 0 ? 'MPEG-2 (has sequence extension)' : 'MPEG-1';
  return out;
}

// ---------- Exp-Golomb reader (for H.264/H.265 SPS) ----------
class BitReader {
  constructor(bytes) { this.b = bytes; this.pos = 0; }
  bit() { const byte = this.b[this.pos >> 3]; const off = 7 - (this.pos & 7); this.pos++; return (byte >> off) & 1; }
  bits(n) { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | this.bit(); return v >>> 0; }
  ue() { let zeros = 0; while (this.pos < this.b.length * 8 && this.bit() === 0) zeros++; let v = 0; for (let i = 0; i < zeros; i++) v = (v << 1) | this.bit(); return v + (1 << zeros) - 1; }
  se() { const k = this.ue(); return (k & 1) ? (k + 1) >> 1 : -(k >> 1); }
}

// Strip emulation prevention bytes (00 00 03 -> 00 00) from a NAL RBSP.
function stripEpb(bytes) {
  const out = []; let zeros = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (zeros >= 2 && bytes[i] === 0x03) { zeros = 0; continue; }
    out.push(bytes[i]);
    if (bytes[i] === 0) zeros++; else zeros = 0;
  }
  return new Uint8Array(out);
}

// Find Annex-B NAL units; returns array of {type, start, end} (start at NAL header byte).
function findNals(buf, hevc) {
  const nals = [];
  for (let i = 0; i + 3 < buf.length; i++) {
    const sc3 = buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1;
    const sc4 = buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1;
    if (sc3 || sc4) {
      const nalStart = i + (sc4 ? 4 : 3);
      const type = hevc ? (buf[nalStart] >> 1) & 0x3f : buf[nalStart] & 0x1f;
      nals.push({ type, start: nalStart });
      i = nalStart;
      if (nals.length > 64) break;
    }
  }
  // compute ends
  for (let k = 0; k < nals.length; k++) nals[k].end = k + 1 < nals.length ? nals[k + 1].start - 3 : buf.length;
  return nals;
}

const H264_PROFILES = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' };
async function parseH264(file) {
  const buf = await readSlice(file, 0, 65536);
  const nals = findNals(buf, false);
  const sps = nals.find((n) => n.type === 7);
  if (!sps) return null;
  const rbsp = stripEpb(buf.subarray(sps.start + 1, Math.min(sps.end, sps.start + 200)));
  const br = new BitReader(rbsp);
  const profileIdc = br.bits(8);
  br.bits(8); // constraint flags + reserved
  const levelIdc = br.bits(8);
  br.ue(); // sps id
  let chroma = 1;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(profileIdc)) {
    chroma = br.ue();
    if (chroma === 3) br.bit();
    br.ue(); br.ue(); br.bit();
    if (br.bit()) { for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) { if (br.bit()) { /* skip scaling list */ } } }
  }
  br.ue(); // log2_max_frame_num
  const pocType = br.ue();
  if (pocType === 0) br.ue();
  else if (pocType === 1) { br.bit(); br.se(); br.se(); const n = br.ue(); for (let i = 0; i < n; i++) br.se(); }
  br.ue(); // max_num_ref_frames
  br.bit(); // gaps_in_frame_num
  const wMbs = br.ue() + 1;
  const hMapUnits = br.ue() + 1;
  const frameMbsOnly = br.bit();
  if (!frameMbsOnly) br.bit();
  br.bit(); // direct_8x8
  let cropL = 0, cropR = 0, cropT = 0, cropB = 0;
  if (br.bit()) { cropL = br.ue(); cropR = br.ue(); cropT = br.ue(); cropB = br.ue(); }
  const width = wMbs * 16 - (cropL + cropR) * 2;
  const height = (2 - frameMbsOnly) * hMapUnits * 16 - (cropT + cropB) * 2;
  const chromaNames = ['monochrome', '4:2:0', '4:2:2', '4:4:4'];
  return {
    'Format': 'Raw H.264 / AVC stream (Annex B)',
    'Profile': H264_PROFILES[profileIdc] || ('profile ' + profileIdc),
    'Level': (levelIdc / 10).toFixed(1),
    'Resolution': width + ' x ' + height,
    'Chroma format': chromaNames[chroma] || ('idc ' + chroma),
    'NAL units (head)': nals.length,
  };
}

const H265_PROFILES = { 1: 'Main', 2: 'Main 10', 3: 'Main Still Picture', 4: 'Range Extensions' };
async function parseH265(file) {
  const buf = await readSlice(file, 0, 65536);
  const nals = findNals(buf, true);
  const sps = nals.find((n) => n.type === 33);
  if (!sps) return null;
  const rbsp = stripEpb(buf.subarray(sps.start + 2, Math.min(sps.end, sps.start + 300)));
  const br = new BitReader(rbsp);
  br.bits(4); // sps_video_parameter_set_id
  const maxSubLayers = br.bits(3);
  br.bit(); // temporal_id_nesting
  // profile_tier_level
  br.bits(2); // general_profile_space
  br.bit();   // general_tier_flag
  const profileIdc = br.bits(5);
  br.bits(32); // compatibility flags
  br.bits(48); // constraint flags etc.
  const levelIdc = br.bits(8);
  // sub-layer present flags
  const subProfile = [], subLevel = [];
  for (let i = 0; i < maxSubLayers - 1; i++) { subProfile.push(br.bit()); subLevel.push(br.bit()); }
  if (maxSubLayers - 1 > 0) for (let i = maxSubLayers - 1; i < 8; i++) br.bits(2);
  for (let i = 0; i < maxSubLayers - 1; i++) { if (subProfile[i]) br.bits(88); if (subLevel[i]) br.bits(8); }
  br.ue(); // sps_seq_parameter_set_id
  const chromaIdc = br.ue();
  if (chromaIdc === 3) br.bit();
  const width = br.ue();
  const height = br.ue();
  let cropL = 0, cropR = 0, cropT = 0, cropB = 0;
  if (br.bit()) { cropL = br.ue(); cropR = br.ue(); cropT = br.ue(); cropB = br.ue(); }
  const bitDepthLuma = br.ue() + 8;
  const chromaNames = ['monochrome', '4:2:0', '4:2:2', '4:4:4'];
  const subW = chromaIdc === 1 || chromaIdc === 2 ? 2 : 1;
  const subH = chromaIdc === 1 ? 2 : 1;
  return {
    'Format': 'Raw H.265 / HEVC stream (Annex B)',
    'Profile': H265_PROFILES[profileIdc] || ('profile ' + profileIdc),
    'Level': (levelIdc / 30).toFixed(1),
    'Resolution': (width - (cropL + cropR) * subW) + ' x ' + (height - (cropT + cropB) * subH),
    'Bit depth': bitDepthLuma + '-bit',
    'Chroma format': chromaNames[chromaIdc] || ('idc ' + chromaIdc),
    'NAL units (head)': nals.length,
  };
}

// ---------- AV1 OBU (.obu) ----------
async function parseObu(file) {
  const buf = await readSlice(file, 0, 4096);
  const br = new BitReader(buf);
  // Walk OBUs until sequence header (type 1).
  let pos = 0; let guard = 0;
  while (pos + 1 < buf.length && guard++ < 32) {
    const b = new BitReader(buf.subarray(pos));
    b.bit(); // forbidden
    const obuType = b.bits(4);
    const ext = b.bit();
    const hasSize = b.bit();
    b.bit(); // reserved
    let cur = pos + 1;
    if (ext) cur += 1;
    let size = 0;
    if (hasSize) {
      // leb128
      let shift = 0, val = 0;
      for (let i = 0; i < 8; i++) { const byte = buf[cur++]; val |= (byte & 0x7f) << shift; if (!(byte & 0x80)) break; shift += 7; }
      size = val;
    } else { size = buf.length - cur; }
    if (obuType === 1) {
      // sequence header OBU
      const sb = new BitReader(buf.subarray(cur));
      const seqProfile = sb.bits(3);
      sb.bit(); // still_picture
      const reducedHdr = sb.bit();
      if (reducedHdr) {
        sb.bits(5); // seq_level_idx
      } else {
        const timingInfo = sb.bit();
        if (timingInfo) { sb.bits(32); sb.bits(32); const eq = sb.bit(); if (eq) { /* leb */ } sb.bit(); }
        sb.bit(); // initial_display_delay_present
        const opCnt = sb.bits(5) + 1;
        for (let i = 0; i < opCnt; i++) { sb.bits(12); const lvl = sb.bits(5); if (lvl > 7) sb.bit(); }
      }
      const wBits = sb.bits(4) + 1;
      const hBits = sb.bits(4) + 1;
      const maxW = sb.bits(wBits) + 1;
      const maxH = sb.bits(hBits) + 1;
      const profiles = ['Main', 'High', 'Professional'];
      return {
        'Format': 'AV1 OBU stream (.obu)',
        'Profile': profiles[seqProfile] || ('profile ' + seqProfile),
        'Max resolution': maxW + ' x ' + maxH,
        'Header type': reducedHdr ? 'reduced' : 'full',
        'Note': 'Low-overhead AV1 open bitstream unit stream.',
      };
    }
    pos = cur + size;
    if (size <= 0) break;
  }
  // Couldn't find a sequence header but magic-ish; return minimal.
  return { 'Format': 'AV1 OBU stream (.obu)', 'Note': 'OBU stream; sequence header not in first 4 KB.' };
}

// ============================================================================
//  MPEG PROGRAM / TRANSPORT STREAMS
// ============================================================================

const TS_STREAM_TYPES = {
  0x01: 'MPEG-1 Video', 0x02: 'MPEG-2 Video', 0x03: 'MPEG-1 Audio', 0x04: 'MPEG-2 Audio',
  0x0F: 'AAC Audio (ADTS)', 0x10: 'MPEG-4 Visual', 0x11: 'AAC Audio (LATM)', 0x1B: 'H.264/AVC',
  0x24: 'H.265/HEVC', 0x81: 'AC-3 (ATSC)', 0x87: 'E-AC-3', 0x06: 'PES private (subtitles/AC-3)',
};
// Parse an MPEG-2 Transport Stream: find sync, read PAT then PMT for stream types.
async function parseMpegTs(file, ext) {
  const buf = await readSlice(file, 0, 1 << 20);
  // Find packet size & sync alignment. Standard 188; M2TS 192 (4-byte TP_extra).
  let pktSize = 188, off = 0;
  // Require a run of consecutive sync bytes at a fixed stride; for tiny files
  // (1-2 packets) accept whatever fits, but always at least the first sync byte.
  let found = false;
  for (const [sz, lead] of [[188, 0], [192, 4], [204, 0]]) {
    const limit = Math.min(buf.length - sz, 1024);
    for (let o = lead; o <= limit; o++) {
      if (buf[o] !== 0x47) continue;
      let runs = 1;
      while (o + runs * sz < buf.length && buf[o + runs * sz] === 0x47 && runs < 4) runs++;
      // Need 3 in a row when the file is large enough; otherwise accept 2 (or 1
      // if the file holds a single packet) to stay robust on truncated captures.
      const need = buf.length >= o + sz * 3 ? 3 : buf.length >= o + sz * 2 ? 2 : 1;
      if (runs >= need) { pktSize = sz; off = o; found = true; break; }
    }
    if (found) break;
  }
  if (!found) return null;
  const out = { 'Format': (ext === 'trp' || ext === 'tp') ? 'PVR / DVB recording (.' + ext + ', MPEG-TS)' : 'MPEG-2 Transport Stream (.' + ext + ')' };
  out['Packet size'] = pktSize + (pktSize === 192 ? ' (M2TS/BDAV)' : pktSize === 204 ? ' (with FEC)' : '');

  // Collect PMT PIDs from PAT (PID 0), then stream types from PMTs.
  const pmtPids = new Set();
  const programs = [];
  const streamTypes = new Set();
  let scanned = 0;
  for (let o = off; o + pktSize <= buf.length && scanned < 4000; o += pktSize, scanned++) {
    let p = o;
    if (pktSize === 192) p += 4;
    if (buf[p] !== 0x47) continue;
    const pid = ((buf[p + 1] & 0x1f) << 8) | buf[p + 2];
    const payloadStart = (buf[p + 1] & 0x40) !== 0;
    const adaptation = (buf[p + 3] >> 4) & 0x3;
    let pl = p + 4;
    if (adaptation & 0x2) pl += 1 + buf[pl];
    if (pid === 0 && payloadStart) {
      // PAT
      pl += 1 + buf[pl]; // pointer field
      const sectionLen = ((buf[pl + 1] & 0x0f) << 8) | buf[pl + 2];
      let q = pl + 8;
      const end = pl + 3 + sectionLen - 4;
      while (q + 4 <= end && q + 4 <= buf.length) {
        const prog = (buf[q] << 8) | buf[q + 1];
        const pmtPid = ((buf[q + 2] & 0x1f) << 8) | buf[q + 3];
        if (prog !== 0) { pmtPids.add(pmtPid); programs.push(prog); }
        q += 4;
      }
    } else if (pmtPids.has(pid) && payloadStart) {
      // PMT
      pl += 1 + buf[pl];
      const sectionLen = ((buf[pl + 1] & 0x0f) << 8) | buf[pl + 2];
      const progInfoLen = ((buf[pl + 10] & 0x0f) << 8) | buf[pl + 11];
      let q = pl + 12 + progInfoLen;
      const end = pl + 3 + sectionLen - 4;
      while (q + 5 <= end && q + 5 <= buf.length) {
        const st = buf[q];
        const esInfoLen = ((buf[q + 3] & 0x0f) << 8) | buf[q + 4];
        streamTypes.add(st);
        q += 5 + esInfoLen;
      }
    }
  }
  out['Programs'] = programs.length || (pmtPids.size ? pmtPids.size : 1);
  if (streamTypes.size) {
    const names = Array.from(streamTypes).map((t) => TS_STREAM_TYPES[t] || ('type 0x' + t.toString(16)));
    out['Elementary streams'] = names.join(', ');
  }
  out['Packets scanned'] = scanned.toLocaleString();
  return out;
}

// Parse an MPEG Program Stream (.m2p / .h2v): pack header 00 00 01 BA, scan PES.
async function parseMpegPs(file, ext) {
  const buf = await readSlice(file, 0, 1 << 20);
  const packIdx = findBytes(buf, new Uint8Array([0x00, 0x00, 0x01, 0xBA]));
  if (packIdx < 0) return null;
  const out = { 'Format': 'MPEG Program Stream (.' + ext + ')' };
  // Determine MPEG-1 vs MPEG-2 pack header (top bits after BA).
  const marker = buf[packIdx + 4] >> 6;
  out['Variant'] = marker === 0x01 ? 'MPEG-2 PS' : 'MPEG-1 PS';
  // Scan PES stream ids to enumerate elementary streams.
  const streams = new Set();
  for (let i = packIdx; i + 4 < buf.length && i < 262144; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      const id = buf[i + 3];
      if (id >= 0xC0 && id <= 0xDF) streams.add('Audio (MPEG)');
      else if (id >= 0xE0 && id <= 0xEF) streams.add('Video (MPEG)');
      else if (id === 0xBD) streams.add('Private 1 (AC-3/DTS/subtitles)');
      else if (id === 0xBF) streams.add('Private 2');
    }
  }
  if (streams.size) out['Elementary streams'] = Array.from(streams).join(', ');
  return out;
}

// ============================================================================
//  RECORDINGS / OTHER CONTAINERS
// ============================================================================

// ---------- Windows Recorded TV .wtv ----------
const WTV_MAGIC = [0xB7, 0xD8, 0x00, 0x20, 0x37, 0x49, 0xDA, 0x11, 0xA6, 0x4E, 0x00, 0x07, 0xE9, 0x5E, 0xAD, 0x8D];
async function parseWtv(file) {
  const head = await readSlice(file, 0, Math.min(file.size, 1 << 20));
  if (!matchMagic(head, WTV_MAGIC)) return null;
  const out = { 'Format': 'Windows Recorded TV (.wtv)' };
  // WTV stores metadata as UTF-16LE key/value pairs scattered in the file.
  // Scan for known metadata key strings and pull the nearby UTF-16 value.
  const u16 = new TextDecoder('utf-16le').decode(head);
  const grab = (key) => {
    const i = u16.indexOf(key);
    if (i < 0) return null;
    // value usually follows after some bytes; take the next printable UTF-16 run.
    const after = u16.slice(i + key.length, i + key.length + 600);
    const m = after.match(/([^\x00-\x08\x0e-\x1f][\x20-￿]{2,200})/);
    return m ? m[1].replace(/\0/g, '').trim() : null;
  };
  const title = grab('Title') || grab('WM/SubTitle');
  const channel = grab('WM/MediaStationCallSign') || grab('Channel');
  const desc = grab('WM/SubTitleDescription') || grab('Description');
  if (title) out['Title'] = title.slice(0, 120);
  if (channel) out['Channel'] = channel.slice(0, 60);
  if (desc) out['Description'] = desc.slice(0, 200);
  out['Container'] = 'Microsoft WTV (Media Center / Windows 7+ recordings)';
  out['Note'] = 'Profile/timestamp tables hold duration & codecs; metadata is UTF-16 key/value.';
  return out;
}

// ---------- Ogg Media .ogm ----------
async function parseOgm(file) {
  const buf = await readSlice(file, 0, 65536);
  if (ascii(buf, 0, 4) !== 'OggS') return null;
  const out = { 'Format': 'Ogg Media (.ogm)' };
  // Walk Ogg pages; first page of each logical stream carries the codec header.
  let video = 0, audio = 0, text2 = 0;
  const codecs = new Set();
  let pos = 0, pages = 0;
  while (pos + 27 < buf.length && pages < 200) {
    if (ascii(buf, pos, 4) !== 'OggS') break;
    const segCount = buf[pos + 26];
    let pageDataLen = 0;
    for (let i = 0; i < segCount; i++) pageDataLen += buf[pos + 27 + i];
    const dataStart = pos + 27 + segCount;
    const data = buf.subarray(dataStart, dataStart + Math.min(pageDataLen, 128));
    const tag = ascii(data, 0, 8);
    if (/video/.test(tag) || /\x01video/.test(latin1(data))) { video++; const cc = ascii(data, 9, 4); if (cc) codecs.add(cc); }
    else if (/audio/.test(tag)) { audio++; }
    else if (/text/.test(tag)) { text2++; }
    else if (/vorbis/.test(latin1(data))) { audio++; codecs.add('Vorbis'); }
    else if (/theora/.test(latin1(data))) { video++; codecs.add('Theora'); }
    pos = dataStart + pageDataLen;
    pages++;
  }
  out['Logical streams'] = video + ' video, ' + audio + ' audio' + (text2 ? ', ' + text2 + ' text/subtitle' : '');
  if (codecs.size) out['Codecs'] = Array.from(codecs).join(', ');
  out['Note'] = 'Ogg container with OGM video/audio/subtitle headers (fansub-era).';
  return out;
}

// ---------- NUT container (.nut) ----------
async function parseNut(file) {
  const head = await readSlice(file, 0, 64);
  // Main startcode: "nut/multimedia container\0" begins with 'nut\0' style; actual
  // NUT file startcode is 0x4E 0x4D ... The main header startcode is a 64-bit
  // value; the file begins with "nut/multimedia container" in many muxes.
  const s = ascii(head, 0, 24);
  const magicMain = head[0] === 0x4E && head[1] === 0x4D; // 'NM'
  if (!/nut\/multimedia|nut/i.test(s) && !magicMain) {
    // FFmpeg NUT main startcode bytes: 'N','M' (0x4E4D...) is part of 7-byte code.
    return null;
  }
  return {
    'Format': 'NUT container (.nut)',
    'Origin': 'FFmpeg / MPlayer multimedia container',
    'Note': 'NUT startcode identified; stream headers carried in framed packets.',
  };
}

// ============================================================================
//  IDENTIFICATION-ONLY (rare AND hard)
// ============================================================================

async function parseDpx(file) {
  const head = await readSlice(file, 0, 1664);
  const magic = ascii(head, 0, 4);
  const be = magic === 'SDPX';
  const le = magic === 'XPDS';
  if (!be && !le) return null;
  const r = new Reader(head, le);
  const out = { 'Format': 'DPX (Digital Picture Exchange, SMPTE 268M)' };
  out['Byte order'] = be ? 'Big-endian (SDPX)' : 'Little-endian (XPDS)';
  try {
    // Image element: pixelsPerLine @0x6C, linesPerElement @0x70 (in generic header).
    const w = r.seek(0x6C).u32();
    const h = r.seek(0x70).u32();
    if (w && h && w < 100000 && h < 100000) out['Resolution'] = w + ' x ' + h;
    const creator = ascii(head, 0xA0, 100).replace(/\0.*$/, '').trim();
    if (creator) out['Creator'] = creator;
  } catch (_) {}
  out['Note'] = 'Frame-per-file DI/VFX image; full colorimetry/bit-depth decode is identification-only here.';
  return out;
}

async function parseCin(file) {
  const head = await readSlice(file, 0, 256);
  // Cineon magic: 0x80 0x2A 0x5F 0xD7.
  if (!(head[0] === 0x80 && head[1] === 0x2A && head[2] === 0x5F && head[3] === 0xD7)) return null;
  return {
    'Format': 'Cineon (.cin, Kodak)',
    'Note': '10-bit log DI image (SMPTE 268M precursor); identification only.',
  };
}

async function parseDav(file) {
  const head = await readSlice(file, 0, 32);
  // Dahua DAV often begins with "DHAV" or a proprietary marker; many are encrypted.
  const s = ascii(head, 0, 8);
  if (!/DHAV|DAHUA/i.test(s) && !(head[0] === 0x44 && head[1] === 0x48)) {
    // Accept by extension dispatch even if header is opaque/encrypted.
  }
  return {
    'Format': 'Dahua DVR video (.dav)',
    'Header': /DHAV/.test(s) ? 'DHAV signature' : 'opaque / likely encrypted',
    'Note': 'Dahua/CCTV recording; frames are often proprietary-encrypted. Identification only.',
  };
}

async function parseYuv(file) {
  return {
    'Format': 'Raw planar YUV (.yuv)',
    'File size': fmtBytes(file.size),
    'Note': 'Headerless raw YUV - resolution, chroma subsampling and bit depth must be supplied out-of-band.',
  };
}

// ============================================================================
//  DISPATCH
// ============================================================================

function wrap(fn) {
  return async (c) => { try { return await fn(c); } catch (_) { return null; } };
}

// Text-manifest dispatch reads the file once and routes by extension.
function textParser(fn) {
  return wrap(async (c) => {
    const text = await readText(c.file);
    return fn(text, c.ext);
  });
}

export const PARSERS = {
  // Streaming manifests
  m3u8: textParser((t, e) => parseHls(t, e) || parsePlaylist(t, e)),
  m3u: textParser((t, e) => parseHls(t, e) || parsePlaylist(t, e)),
  mpd: textParser((t) => parseDash(t)),
  ism: textParser((t) => parseSmooth(t)),
  ismc: textParser((t) => parseSmooth(t)),
  f4m: textParser((t) => parseF4m(t)),
  asx: textParser((t, e) => parsePlaylist(t, e)),
  wpl: textParser((t, e) => parsePlaylist(t, e)),
  xspf: textParser((t, e) => parsePlaylist(t, e)),
  pls: textParser((t, e) => parsePlaylist(t, e)),

  // Pro / broadcast
  mxf: wrap((c) => parseMxf(c.file)),
  gxf: wrap((c) => parseGxf(c.file)),
  lxf: wrap((c) => parseLxf(c.file)),
  dv: wrap((c) => parseDv(c.file)),
  dif: wrap((c) => parseDv(c.file)),

  // ASF / RealMedia
  asf: wrap((c) => parseAsf(c.file, c.ext)),
  'dvr-ms': wrap((c) => parseAsf(c.file, c.ext)),
  rm: wrap((c) => parseReal(c.file)),
  rmvb: wrap((c) => parseReal(c.file)),

  // MP4-family wrappers
  divx: wrap((c) => parseDivx(c.file)),
  f4v: wrap((c) => parseMp4Wrapper(c.file, 'Flash MP4 Video (.f4v)', 'Adobe F4V - ISOBMFF/MP4 box structure.')),
  insv: wrap((c) => parseInsta360(c.file, c.ext)),
  insp: wrap((c) => parseInsta360(c.file, c.ext)),
  lrv: wrap((c) => parseMp4Wrapper(c.file, 'Low-Res Video proxy (.lrv)', 'GoPro/DJI/Insta360 low-resolution proxy of a full-res clip.')),
  gifv: wrap((c) => parseMp4Wrapper(c.file, 'GIFV (video GIF, .gifv)', 'Imgur-style animated clip wrapping an MP4/WebM bitstream.')),

  // Elementary / raw streams
  ivf: wrap((c) => parseIvf(c.file)),
  y4m: wrap((c) => parseY4m(c.file)),
  m2v: wrap((c) => parseMpegVideo(c.file, c.ext)),
  m1v: wrap((c) => parseMpegVideo(c.file, c.ext)),
  mpv: wrap((c) => parseMpegVideo(c.file, c.ext)),
  '264': wrap((c) => parseH264(c.file)),
  h264: wrap((c) => parseH264(c.file)),
  avc: wrap((c) => parseH264(c.file)),
  '265': wrap((c) => parseH265(c.file)),
  h265: wrap((c) => parseH265(c.file)),
  hevc: wrap((c) => parseH265(c.file)),
  obu: wrap((c) => parseObu(c.file)),

  // MPEG PS/TS variants & PVR recordings
  m2p: wrap((c) => parseMpegPs(c.file, c.ext)),
  h2v: wrap((c) => parseMpegPs(c.file, c.ext) || parseMpegTs(c.file, c.ext)),
  m2t: wrap((c) => parseMpegTs(c.file, c.ext)),
  trp: wrap((c) => parseMpegTs(c.file, c.ext)),
  tp: wrap((c) => parseMpegTs(c.file, c.ext)),

  // Recordings / other containers
  wtv: wrap((c) => parseWtv(c.file)),
  ogm: wrap((c) => parseOgm(c.file)),
  nut: wrap((c) => parseNut(c.file)),

  // Identification-only (rare AND hard)
  dpx: wrap((c) => parseDpx(c.file)),
  cin: wrap((c) => parseCin(c.file)),
  dav: wrap((c) => parseDav(c.file)),
  yuv: wrap((c) => parseYuv(c.file)),
};
