/* Analyser - lazy parser chunk: audio (lossless/hi-res, containers, speech,
   instruments, trackers, chiptunes, Audacity projects).

   Loaded on demand by renderProprietary() when a file whose FORMATS entry has
   `chunk: 'audio'` is opened. Each entry in PARSERS is `({head, file, ext}) =>
   rows` where `rows` is a plain object of label->value pairs, optionally carrying
   `_sections: [{title, node, open?}]` for collapsible blocks and `_previewNode`.
   Return null to fall back to the generic identification card. Dependency-free:
   only the shared toolkit. */

import { el, row, fmtBytes, preBlock, readSlice } from '../core/util.js';
import { Reader, ascii, findBytes, matchMagic, startsWithAscii, latin1, utf8, gunzip } from '../core/binutil.js';
import { sqliteSummary } from '../lib/sqlite.js';

// ---------- small helpers ----------

// Clean a fixed-width ASCII field (drop NULs/control, trim).
function cleanAscii(bytes, start, len) {
  let s = '';
  const end = Math.min(start + len, bytes.length);
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s.replace(/\s+$/, '').trim();
}

// Format seconds as M:SS or H:MM:SS.
function fmtDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '-';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}

const fmtRate = (hz) => hz >= 1000 ? (hz / 1000).toFixed(hz % 1000 ? 1 : 0).replace(/\.0$/, '') + ' kHz' : hz + ' Hz';

// ---------- APEv2 tag reader (footer of APE/WavPack/Musepack/etc.) ----------
// Looks for an APEv2 footer in the last 32+N bytes of the file. Returns a flat
// map of key->value (text items only), or null.
async function readApev2(file) {
  try {
    const tail = await readSlice(file, Math.max(0, file.size - 65536), 65536);
    // Footer = "APETAGEX" + 4B version + 4B size + 4B item count + 4B flags + 8B reserved
    const idx = findBytes(tail, [0x41, 0x50, 0x45, 0x54, 0x41, 0x47, 0x45, 0x58], 0);
    if (idx < 0) return null;
    // Find the LAST occurrence (footer, not header) by scanning forward.
    let last = idx;
    for (let p = idx + 1; ; ) {
      const n = findBytes(tail, [0x41, 0x50, 0x45, 0x54, 0x41, 0x47, 0x45, 0x58], p);
      if (n < 0) break; last = n; p = n + 1;
    }
    const r = new Reader(tail, true); r.seek(last + 8);
    r.u32(); // version
    const size = r.u32();
    const count = r.u32();
    const flags = r.u32();
    // Footer flag bit 29 set => this is a header. Item data precedes a footer.
    const isHeader = (flags & 0x20000000) !== 0;
    let p;
    if (isHeader) p = last + 32;
    else {
      // size includes the footer (32B). Items start size-32 before the footer.
      p = last + 32 - size;
    }
    if (p < 0 || p >= tail.length) return null;
    const out = {};
    for (let i = 0; i < count && i < 200; i++) {
      if (p + 8 > tail.length) break;
      const r2 = new Reader(tail, true); r2.seek(p);
      const vlen = r2.u32();
      const iflags = r2.u32();
      p += 8;
      let key = '';
      while (p < tail.length && tail[p] !== 0) { key += String.fromCharCode(tail[p]); p++; }
      p++; // skip NUL
      if (p + vlen > tail.length) break;
      const isText = ((iflags >> 1) & 0x03) === 0;
      if (isText && vlen < 4096) out[key] = utf8(tail.subarray(p, p + vlen)).replace(/\0/g, '');
      p += vlen;
    }
    return Object.keys(out).length ? out : null;
  } catch (_) { return null; }
}

function apeTagSection(tags) {
  if (!tags) return null;
  const lines = Object.entries(tags).map(([k, v]) => k + ': ' + v);
  return { title: 'APEv2 tags (' + lines.length + ')', node: preBlock(lines.join('\n')) };
}

// ---------- ID3v2 (used by DSF, MP2) - skip past it / surface a few frames ----------
function id3v2Size(head, off) {
  // head[off..off+10] is the ID3 header. Returns total tag size incl. header, or 0.
  if (!(head[off] === 0x49 && head[off + 1] === 0x44 && head[off + 2] === 0x33)) return 0;
  const sz = (head[off + 6] << 21) | (head[off + 7] << 14) | (head[off + 8] << 7) | head[off + 9];
  return 10 + sz;
}

// =====================================================================
//  Lossless / hi-res
// =====================================================================

// ---------- APE (Monkey's Audio) ----------
const APE_COMPRESSION = { 1000: 'Fast', 2000: 'Normal', 3000: 'High', 4000: 'Extra High', 5000: 'Insane' };
async function parseApe(file) {
  const head = await readSlice(file, 0, 128);
  if (ascii(head, 0, 4) !== 'MAC ') return null;
  const r = new Reader(head, true); r.seek(4);
  const version = r.u16();
  const out = { 'Format': "Monkey's Audio (.ape)" };
  out['Version'] = (version / 1000).toFixed(2);
  let rate = 0, channels = 0, bits = 0, totalFrames = 0, blocksPerFrame = 0, finalBlocks = 0, compression = 0;
  if (version >= 3980) {
    // New header: descriptor (52B) then APE_HEADER.
    r.seek(4 + 2 + 2); // magic, version, padding
    const descBytes = r.u32(); // descriptor length
    r.u32(); // header bytes
    r.u32(); // seektable bytes
    r.u32(); // header data bytes
    r.u32(); // ape frame data bytes
    r.u32(); // ape frame data bytes high
    r.u32(); // terminating data bytes
    r.skip(16); // md5
    // APE_HEADER starts at descriptor length
    const hr = new Reader(head, true); hr.seek(descBytes);
    compression = hr.u16();
    hr.u16(); // format flags
    blocksPerFrame = hr.u32();
    finalBlocks = hr.u32();
    totalFrames = hr.u32();
    bits = hr.u16();
    channels = hr.u16();
    rate = hr.u32();
  } else {
    // Old header (<3980): fields right after version.
    compression = r.u16();
    r.u16(); // format flags
    channels = r.u16();
    rate = r.u32();
    r.u32(); r.u32(); // header/terminating bytes
    totalFrames = r.u32();
    finalBlocks = r.u32();
    bits = 16;
    blocksPerFrame = (version >= 3950) ? 73728 * 4 : 73728;
  }
  out['Compression'] = APE_COMPRESSION[compression] || ('level ' + compression);
  if (rate) out['Sample rate'] = fmtRate(rate);
  if (bits) out['Bit depth'] = bits + '-bit';
  if (channels) out['Channels'] = channels;
  if (rate && totalFrames && blocksPerFrame) {
    const samples = (totalFrames - 1) * blocksPerFrame + finalBlocks;
    out['Duration'] = fmtDuration(samples / rate);
  }
  const tags = await readApev2(file);
  const sec = apeTagSection(tags);
  if (sec) out._sections = [sec];
  return out;
}

// ---------- WavPack ----------
async function parseWavpack(file) {
  const head = await readSlice(file, 0, 32);
  if (ascii(head, 0, 4) !== 'wvpk') return null;
  const r = new Reader(head, true); r.seek(4);
  r.u32(); // block size
  const verNeeded = r.u16();
  r.u8(); r.u8(); // track no, index no
  const totalSamples = r.u32();
  r.u32(); // block index
  r.u32(); // block samples
  const flags = r.u32();
  const out = { 'Format': 'WavPack (.wv)' };
  out['Version'] = '0x' + verNeeded.toString(16);
  // flags: bits 0-1 bytes/sample-1 ; bit2 mono ; bit3 hybrid ; bit23-26 sample rate index
  const bytesPerSample = (flags & 0x03) + 1;
  out['Bit depth'] = (bytesPerSample * 8) + '-bit' + ((flags & 0x80) ? ' (float)' : '');
  out['Channels'] = (flags & 0x04) ? 1 : 2;
  const SR = [6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000, 192000];
  const srIdx = (flags >> 23) & 0x0F;
  const rate = srIdx < 15 ? SR[srIdx] : 0;
  if (rate) { out['Sample rate'] = fmtRate(rate); if (totalSamples && totalSamples !== 0xFFFFFFFF) out['Duration'] = fmtDuration(totalSamples / rate); }
  out['Mode'] = (flags & 0x08) ? 'Hybrid (lossy/lossless)' : 'Lossless';
  const tags = await readApev2(file);
  const sec = apeTagSection(tags);
  if (sec) out._sections = [sec];
  return out;
}

// ---------- TAK ----------
async function parseTak(file) {
  const head = await readSlice(file, 0, 64);
  if (ascii(head, 0, 4) !== 'tBaK') return null;
  const out = { 'Format': 'TAK - Tom\'s lossless Audio Kompressor (.tak)' };
  // TAK metadata blocks follow; the STREAMINFO block (type 1) holds rate/channels.
  // Block header: 1 byte type+flags, 3 bytes size (LE), then payload.
  try {
    const buf = await readSlice(file, 4, 4096);
    let p = 0;
    for (let guard = 0; guard < 64 && p + 4 < buf.length; guard++) {
      const type = buf[p] & 0x7F;
      const size = buf[p + 1] | (buf[p + 2] << 8) | (buf[p + 3] << 16);
      p += 4;
      if (type === 0) break; // END
      if (type === 1 && p + 10 <= buf.length) {
        // STREAMINFO: bit-packed. Sample rate (18 bits) + channels + bits roughly.
        const r = new Reader(buf, true); r.seek(p);
        const w = r.u32();
        const sampleRate = (w & 0x3FFFF) + 6000; // 18-bit field, biased
        if (sampleRate >= 6000 && sampleRate <= 384000) out['Sample rate'] = fmtRate(sampleRate);
        break;
      }
      if (size <= 0 || size > buf.length) break;
      p += size;
    }
  } catch (_) {}
  const tags = await readApev2(file);
  const sec = apeTagSection(tags);
  if (sec) out._sections = [sec];
  return out;
}

// ---------- TTA (True Audio) ----------
async function parseTta(file) {
  const head = await readSlice(file, 0, 32);
  if (ascii(head, 0, 3) !== 'TTA') return null;
  const out = { 'Format': 'True Audio (.tta)' };
  // TTA1 header: "TTA1", u16 format, u16 channels, u16 bits, u32 rate, u32 samples, u32 crc
  const r = new Reader(head, true);
  if (head[3] === 0x31) { // '1'
    r.seek(4);
    r.u16(); // audio format
    const channels = r.u16();
    const bits = r.u16();
    const rate = r.u32();
    const samples = r.u32();
    out['Sample rate'] = fmtRate(rate);
    out['Bit depth'] = bits + '-bit';
    out['Channels'] = channels;
    if (rate) out['Duration'] = fmtDuration(samples / rate);
  }
  const tags = await readApev2(file);
  const sec = apeTagSection(tags);
  if (sec) out._sections = [sec];
  return out;
}

// ---------- OptimFROG ----------
function parseOptimfrog(head, ext) {
  if (ascii(head, 0, 4) !== 'OFR ' && ascii(head, 0, 3) !== 'OFR') return null;
  return {
    'Format': 'OptimFROG (.' + ext + ')',
    'Type': ext === 'ofs' ? 'OptimFROG DualStream (lossy)' : 'OptimFROG lossless',
    'Note': 'High-ratio lossless audio compressor by Florin Ghido. Header identified; full stream-info decode needs the OptimFROG bitstream reader.',
  };
}

// ---------- Shorten ----------
function parseShorten(head) {
  if (ascii(head, 0, 4) !== 'ajkg') return null;
  return {
    'Format': 'Shorten (.shn)',
    'Version': head[4],
    'Note': 'Early lossless/near-lossless compressor (SoftSound). Identification only.',
  };
}

// ---------- DSD: DSF (Sony) ----------
async function parseDsf(file) {
  const head = await readSlice(file, 0, 92);
  if (ascii(head, 0, 4) !== 'DSD ') return null;
  const out = { 'Format': 'DSD Stream File (.dsf)' };
  const r = new Reader(head, true);
  r.seek(12); // DSD chunk: magic(4) + chunkSize(8)
  const totalSize = r.u64();
  const metaPtr = r.u64();
  // fmt chunk should follow at offset 28
  if (ascii(head, 28, 4) === 'fmt ') {
    const fr = new Reader(head, true); fr.seek(28 + 12); // skip "fmt " + size(8)
    fr.u32(); // format version
    fr.u32(); // format id
    const chanType = fr.u32();
    const channels = fr.u32();
    const rate = fr.u32();
    const bits = fr.u32();
    const sampleCount = fr.u64();
    out['Sample rate'] = (rate / 1000000).toFixed(2).replace(/\.00$/, '') + ' MHz (DSD' + Math.round(rate / 44100) + ')';
    out['Channels'] = channels;
    out['Bits per sample'] = bits;
    if (rate) out['Duration'] = fmtDuration(Number(sampleCount) / rate);
    out['Channel layout'] = ['', 'mono', 'stereo', '3ch', 'quad', '', '5.1', ''][chanType] || ('type ' + chanType);
  }
  if (metaPtr && metaPtr > 0n) out['ID3v2 metadata'] = 'present (offset 0x' + metaPtr.toString(16) + ')';
  return out;
}

// ---------- DSD: DFF (Philips DSDIFF) ----------
async function parseDff(file) {
  const head = await readSlice(file, 0, 4096);
  if (ascii(head, 0, 4) !== 'FRM8') return null;
  if (ascii(head, 12, 4) !== 'DSD ') return null;
  const out = { 'Format': 'DSDIFF (.dff)' };
  // Walk top-level chunks inside FRM8 (after 12-byte header) to find PROP/FS/CHNL.
  try {
    let p = 16; // after FRM8 + size(8) + "DSD "
    let dst = false, rate = 0, channels = 0;
    for (let g = 0; g < 64 && p + 12 <= head.length; g++) {
      const id = ascii(head, p, 4);
      const r = new Reader(head, true); r.seek(p + 4);
      const sz = Number(r.u64());
      const body = p + 12;
      if (id === 'PROP') {
        // PROP has type then sub-chunks (FS, CHNL, CMPR ...)
        let q = body + 4; // skip prop type "SND "
        for (let g2 = 0; g2 < 32 && q + 12 <= head.length; g2++) {
          const sid = ascii(head, q, 4);
          const sr = new Reader(head, true); sr.seek(q + 4);
          const ssz = Number(sr.u64());
          const sbody = q + 12;
          if (sid === 'FS  ' && sbody + 4 <= head.length) { rate = new Reader(head, true).seek(sbody).u32(); }
          else if (sid === 'CHNL' && sbody + 2 <= head.length) { channels = new Reader(head, true).seek(sbody).u16(); }
          else if (sid === 'CMPR' && sbody + 4 <= head.length) { dst = ascii(head, sbody, 4) === 'DST '; }
          q = sbody + ssz + (ssz & 1);
        }
        break;
      }
      p = body + sz + (sz & 1);
    }
    if (rate) out['Sample rate'] = (rate / 1000000).toFixed(2).replace(/\.00$/, '') + ' MHz (DSD' + Math.round(rate / 44100) + ')';
    if (channels) out['Channels'] = channels;
    out['Compression'] = dst ? 'DST (lossless compressed)' : 'DSD (uncompressed)';
  } catch (_) {}
  return out;
}

// ---------- Musepack ----------
async function parseMusepack(file, ext) {
  const head = await readSlice(file, 0, 32);
  const sig = ascii(head, 0, 4);
  const out = { 'Format': 'Musepack (.' + ext + ')' };
  if (sig === 'MPCK') {
    // SV8: packet-based. First packet "SH" (stream header).
    out['Stream version'] = 'SV8';
    const idx = findBytes(head, [0x53, 0x48], 4); // "SH"
    if (idx > 0) {
      // SH packet: 'SH' + size (varint) + crc(4) + version(1) + sampleCount(varint) ...
      out['Note'] = 'SV8 stream header present.';
    }
  } else if (sig.startsWith('MP+')) {
    out['Stream version'] = 'SV7';
    const r = new Reader(head, true); r.seek(3);
    r.u8(); // 0x07
    const frameCount = r.u32();
    const flags = r.u32();
    const SR = [44100, 48000, 37800, 32000];
    out['Sample rate'] = fmtRate(SR[flags & 0x03] || 44100);
    out['Frames'] = frameCount;
    out['Channels'] = 2;
    const samples = frameCount * 1152;
    const rate = SR[flags & 0x03] || 44100;
    out['Duration'] = fmtDuration(samples / rate);
  } else {
    return null;
  }
  const tags = await readApev2(file);
  const sec = apeTagSection(tags);
  if (sec) out._sections = [sec];
  return out;
}

// =====================================================================
//  Containers / PCM
// =====================================================================

const WAVE_CODECS = { 1: 'PCM', 3: 'IEEE float', 6: 'A-law', 7: 'mu-law', 0x55: 'MP3', 0xFFFE: 'Extensible' };

// Walk RIFF/RF64 chunks in a buffer; calls cb(id, offset, size).
function walkRiff(buf, start, cb) {
  let p = start;
  for (let g = 0; g < 256 && p + 8 <= buf.length; g++) {
    const id = ascii(buf, p, 4);
    const r = new Reader(buf, true); r.seek(p + 4);
    let sz = r.u32();
    const body = p + 8;
    cb(id, body, sz);
    if (sz === 0xFFFFFFFF) break; // RF64 placeholder handled by caller
    p = body + sz + (sz & 1);
  }
}

// ---------- CAF (Core Audio Format) ----------
const CAF_CODECS = { 'lpcm': 'Linear PCM', 'aac ': 'AAC', 'alac': 'Apple Lossless', 'ima4': 'IMA ADPCM', 'ulaw': 'mu-law', 'alaw': 'A-law', '.mp3': 'MP3', 'opus': 'Opus' };
async function parseCaf(file) {
  const head = await readSlice(file, 0, 256);
  if (ascii(head, 0, 4) !== 'caff') return null;
  const out = { 'Format': 'Core Audio Format (.caf)' };
  // After 8-byte file header: chunks of "type"(4) + size(s64 BE) + body.
  let p = 8, rate = 0, frames = 0;
  const r0 = new Reader(head, false); // CAF is big-endian
  for (let g = 0; g < 32 && p + 12 <= head.length; g++) {
    const type = ascii(head, p, 4);
    const sr = new Reader(head, false); sr.seek(p + 4);
    const size = Number(sr.u64());
    const body = p + 12;
    if (type === 'desc' && body + 32 <= head.length) {
      const dr = new Reader(head, false); dr.seek(body);
      rate = dr.f64();
      const codec = ascii(head, body + 8, 4);
      dr.seek(body + 12); dr.u32(); // format flags
      const bytesPerPacket = dr.u32();
      const framesPerPacket = dr.u32();
      const channels = dr.u32();
      const bitsPerChannel = dr.u32();
      out['Codec'] = CAF_CODECS[codec] || codec;
      if (rate) out['Sample rate'] = fmtRate(Math.round(rate));
      out['Channels'] = channels;
      if (bitsPerChannel) out['Bit depth'] = bitsPerChannel + '-bit';
    }
    if (type === 'pakt' && body + 16 <= head.length) {
      const pr = new Reader(head, false); pr.seek(body);
      frames = Number(pr.u64()); // number of packets... approximate
    }
    if (size < 0) break;
    p = body + size;
  }
  if (rate && frames) out['Duration'] = fmtDuration(frames / rate);
  return out;
}

// ---------- RF64 / BW64 ----------
async function parseRf64(file) {
  const head = await readSlice(file, 0, 4096);
  const id = ascii(head, 0, 4);
  if (id !== 'RF64' && id !== 'BW64') return null;
  if (ascii(head, 8, 4) !== 'WAVE') return null;
  const out = { 'Format': id === 'BW64' ? 'BW64 (Broadcast Wave 64-bit)' : 'RF64 (64-bit RIFF)' };
  let rate = 0, channels = 0, bits = 0, codec = 0, sampleCount64 = 0n;
  walkRiff(head, 12, (cid, off, sz) => {
    if (cid === 'ds64' && off + 24 <= head.length) {
      const r = new Reader(head, true); r.seek(off);
      const riffSize = r.u64();
      const dataSize = r.u64();
      sampleCount64 = r.u64();
      out['RIFF size (64-bit)'] = fmtBytes(Number(riffSize));
      out['data size (64-bit)'] = fmtBytes(Number(dataSize));
    } else if (cid === 'fmt ' && off + 16 <= head.length) {
      const r = new Reader(head, true); r.seek(off);
      codec = r.u16(); channels = r.u16(); rate = r.u32();
      r.u32(); r.u16(); bits = r.u16();
    } else if (cid === 'bext' && off + 256 <= head.length) {
      out['BWF originator'] = cleanAscii(head, off + 256, 32);
    }
  });
  if (codec) out['Codec'] = WAVE_CODECS[codec] || ('0x' + codec.toString(16));
  if (rate) out['Sample rate'] = fmtRate(rate);
  if (bits) out['Bit depth'] = bits + '-bit';
  if (channels) out['Channels'] = channels;
  if (rate && sampleCount64) out['Duration'] = fmtDuration(Number(sampleCount64) / rate);
  return out;
}

// ---------- Wave64 (Sony) ----------
// Wave64 uses 16-byte GUIDs and 64-bit sizes. riff GUID:
// 72 69 66 66 2E 91 CF 11 A5 D6 28 DB 04 C1 00 00 ("riff" + GUID tail)
async function parseWave64(file) {
  const head = await readSlice(file, 0, 4096);
  // First 4 bytes are 'r','i','f','f' of the GUID.
  if (!(head[0] === 0x72 && head[1] === 0x69 && head[2] === 0x66 && head[3] === 0x66)) return null;
  const out = { 'Format': 'Sony Wave64 (.w64)' };
  // Header: riff GUID (16) + riff size (8) + wave GUID (16). Then chunks:
  // chunk GUID (16) + size (8, includes the 24-byte header) + body, padded to 8.
  try {
    let p = 40; // after riff GUID(16)+size(8)+wave GUID(16)
    let rate = 0, channels = 0, bits = 0, codec = 0;
    for (let g = 0; g < 32 && p + 24 <= head.length; g++) {
      const guidStart = ascii(head, p, 4); // first 4 chars identify the chunk
      const r = new Reader(head, true); r.seek(p + 16);
      const size = Number(r.u64()); // includes 24-byte header
      const body = p + 24;
      if (guidStart === 'fmt ' && body + 16 <= head.length) {
        const fr = new Reader(head, true); fr.seek(body);
        codec = fr.u16(); channels = fr.u16(); rate = fr.u32();
        fr.u32(); fr.u16(); bits = fr.u16();
        break;
      }
      if (size < 24) break;
      p = body + (size - 24);
      p = (p + 7) & ~7; // 8-byte align
    }
    if (codec) out['Codec'] = WAVE_CODECS[codec] || ('0x' + codec.toString(16));
    if (rate) out['Sample rate'] = fmtRate(rate);
    if (bits) out['Bit depth'] = bits + '-bit';
    if (channels) out['Channels'] = channels;
  } catch (_) {}
  return out;
}

// ---------- AU / SND (Sun/NeXT) ----------
const AU_ENCODINGS = { 1: 'mu-law 8-bit', 2: 'PCM 8-bit', 3: 'PCM 16-bit', 4: 'PCM 24-bit', 5: 'PCM 32-bit', 6: 'float 32-bit', 7: 'double 64-bit', 27: 'A-law 8-bit' };
const AU_BITS = { 1: 8, 2: 8, 3: 16, 4: 24, 5: 32, 6: 32, 7: 64, 27: 8 };
async function parseAu(file) {
  const head = await readSlice(file, 0, 64);
  // Magic ".snd" = 0x2E736E64 big-endian.
  if (!(head[0] === 0x2E && head[1] === 0x73 && head[2] === 0x6E && head[3] === 0x64)) return null;
  const r = new Reader(head, false); r.seek(4);
  const dataOffset = r.u32();
  const dataSize = r.u32();
  const encoding = r.u32();
  const rate = r.u32();
  const channels = r.u32();
  const out = { 'Format': 'Sun/NeXT audio (.au/.snd)' };
  out['Encoding'] = AU_ENCODINGS[encoding] || ('code ' + encoding);
  out['Sample rate'] = fmtRate(rate);
  out['Channels'] = channels;
  const bits = AU_BITS[encoding];
  if (bits && rate && channels && dataSize !== 0xFFFFFFFF) {
    const frames = (dataSize * 8) / (bits * channels);
    out['Duration'] = fmtDuration(frames / rate);
  }
  if (dataOffset > 24) out['Annotation'] = cleanAscii(head, 24, Math.min(dataOffset - 24, 40)) || '-';
  return out;
}

// ---------- VOC (Creative Voice) ----------
async function parseVoc(file) {
  const head = await readSlice(file, 0, 32);
  if (!startsWithAscii(head, 'Creative Voice File')) return null;
  const r = new Reader(head, true); r.seek(20);
  const dataOffset = r.u16();
  const version = r.u16();
  const out = { 'Format': 'Creative Voice File (.voc)' };
  out['Version'] = (version >> 8) + '.' + (version & 0xFF);
  out['Data block offset'] = '0x' + dataOffset.toString(16);
  return out;
}

// ---------- Broadcast Wave (.bwf) — RIFF/WAVE with bext chunk ----------
async function parseBwf(file) {
  const head = await readSlice(file, 0, 4096);
  if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 4) !== 'WAVE') return null;
  const out = { 'Format': 'Broadcast Wave Format (.bwf)' };
  let rate = 0, channels = 0, bits = 0, codec = 0, hasBext = false;
  walkRiff(head, 12, (cid, off, sz) => {
    if (cid === 'fmt ' && off + 16 <= head.length) {
      const r = new Reader(head, true); r.seek(off);
      codec = r.u16(); channels = r.u16(); rate = r.u32();
      r.u32(); r.u16(); bits = r.u16();
    } else if (cid === 'bext' && off + 602 <= head.length) {
      hasBext = true;
      out['Description'] = cleanAscii(head, off, 256) || '-';
      out['Originator'] = cleanAscii(head, off + 256, 32) || '-';
      out['Originator reference'] = cleanAscii(head, off + 288, 32) || '-';
      out['Origination date'] = cleanAscii(head, off + 320, 10) || '-';
      out['Origination time'] = cleanAscii(head, off + 330, 8) || '-';
      const r = new Reader(head, true); r.seek(off + 338);
      const tsLow = r.u32(); const tsHigh = r.u32();
      const samples = tsHigh * 4294967296 + tsLow;
      if (rate && samples) out['SMPTE timecode start'] = fmtDuration(samples / rate) + ' (' + samples + ' samples)';
      const ver = r.u16();
      out['BWF version'] = ver;
    }
  });
  if (!hasBext) return null; // plain WAV, not BWF
  if (codec) out['Codec'] = WAVE_CODECS[codec] || ('0x' + codec.toString(16));
  if (rate) out['Sample rate'] = fmtRate(rate);
  if (bits) out['Bit depth'] = bits + '-bit';
  if (channels) out['Channels'] = channels;
  return out;
}

// =====================================================================
//  Speech / mobile
// =====================================================================

// ---------- Speex (Ogg/Speex) ----------
async function parseSpeex(file) {
  const head = await readSlice(file, 0, 256);
  if (ascii(head, 0, 4) !== 'OggS') return null;
  const idx = findBytes(head, [0x53, 0x70, 0x65, 0x65, 0x78, 0x20, 0x20, 0x20], 0); // "Speex   "
  if (idx < 0) return null;
  const out = { 'Format': 'Speex (Ogg/Speex)' };
  // Speex header: "Speex   "(8) + version string(20) + version_id(4) + header_size(4)
  //  + rate(4) + mode(4) + mode_bitstream_version(4) + channels(4) + bitrate(4) ...
  const r = new Reader(head, true); r.seek(idx + 8);
  out['Encoder version'] = cleanAscii(head, idx + 8, 20) || '-';
  r.seek(idx + 28);
  r.u32(); // version id
  r.u32(); // header size
  const rate = r.u32();
  const mode = r.u32();
  r.u32(); // mode bitstream version
  const channels = r.u32();
  const bitrate = r.i32();
  out['Sample rate'] = fmtRate(rate);
  out['Mode'] = ['Narrowband (8 kHz)', 'Wideband (16 kHz)', 'Ultra-wideband (32 kHz)'][mode] || ('mode ' + mode);
  out['Channels'] = channels;
  if (bitrate > 0) out['Bitrate'] = (bitrate / 1000).toFixed(1) + ' kbps';
  return out;
}

// ---------- AMR-WB ----------
function parseAwb(head) {
  // Single-channel: "#!AMR-WB\n"
  if (startsWithAscii(head, '#!AMR-WB')) {
    return { 'Format': 'AMR-WB (.awb)', 'Codec': 'AMR-WB (G.722.2)', 'Sample rate': '16 kHz', 'Note': 'Adaptive Multi-Rate Wideband speech.' };
  }
  return null;
}

// ---------- QCP (Qualcomm PureVoice) ----------
async function parseQcp(file) {
  const head = await readSlice(file, 0, 80);
  if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 4) !== 'QLCM') return null;
  const out = { 'Format': 'QCP (Qualcomm PureVoice)' };
  // fmt chunk at 12: "fmt "(4) + size(4) + major(1)+minor(1) + codec GUID(16) + version(2) + codecName(80)...
  if (ascii(head, 12, 4) === 'fmt ') {
    const codecName = cleanAscii(head, 36, 32);
    out['Codec'] = codecName || 'QCELP/EVRC';
    // GUID first 4 bytes distinguish QCELP vs EVRC
    const guid0 = head[20];
    if (/qcelp/i.test(codecName)) out['Codec family'] = 'QCELP';
    else if (/evrc/i.test(codecName)) out['Codec family'] = 'EVRC';
  }
  return out;
}

// ---------- ISO-BMFF box walk (3GA / M4R) ----------
async function parseIsoAudio(file, ext, label) {
  const head = await readSlice(file, 0, 4096);
  if (ascii(head, 4, 4) !== 'ftyp') return null;
  const out = { 'Format': label };
  out['Major brand'] = cleanAscii(head, 8, 4) || '-';
  // Walk boxes to find moov/trak/mdia/mdhd (timescale+duration) and stsd (codec).
  try {
    const moov = findBytes(head, [0x6D, 0x6F, 0x6F, 0x76], 0); // "moov"
    // mdhd: timescale(4) + duration(4) at version 0
    const mdhd = findBytes(head, [0x6D, 0x64, 0x68, 0x64], 0);
    if (mdhd >= 0 && mdhd + 24 <= head.length) {
      const r = new Reader(head, false); r.seek(mdhd + 4);
      const version = r.u8(); r.skip(3);
      if (version === 0) { r.skip(8); const ts = r.u32(); const dur = r.u32(); if (ts) out['Duration'] = fmtDuration(dur / ts); out['Timescale'] = ts; }
      else { r.skip(16); const ts = r.u32(); const dur = Number(r.u64()); if (ts) out['Duration'] = fmtDuration(dur / ts); out['Timescale'] = ts; }
    }
    // stsd codec FourCC: look for known audio sample entries.
    for (const cc of ['mp4a', 'alac', 'Opus', 'samr', 'sawb', 'ac-3']) {
      if (findBytes(head, Array.from(cc).map((ch) => ch.charCodeAt(0)), 0) >= 0) { out['Codec'] = cc; break; }
    }
    // sample rate often in the audio sample entry (samplerate is u16.u16 fixed). Best-effort skip.
  } catch (_) {}
  return out;
}

// ---------- GSM 06.10 raw ----------
function parseGsm(head, file) {
  // No real magic; GSM frames are 33 bytes, first nibble of each = 0xD.
  // Heuristic: first byte high nibble == 0xD.
  if ((head[0] >> 4) !== 0x0D) return null;
  const out = { 'Format': 'GSM 06.10 raw (.gsm)', 'Codec': 'GSM full-rate', 'Sample rate': '8 kHz (assumed)' };
  if (file && file.size) {
    const frames = Math.floor(file.size / 33);
    out['Frames'] = frames;
    out['Duration'] = fmtDuration(frames * 160 / 8000); // 160 samples/frame @ 8kHz
  }
  out['Note'] = 'Headerless; parameters assumed (8 kHz, 33-byte frames).';
  return out;
}

// =====================================================================
//  MPEG layer 1/2
// =====================================================================

const MP_BITRATES = {
  // [version][layer] -> array indexed by 4-bit bitrate field
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const MP_CHANMODE = ['Stereo', 'Joint stereo', 'Dual channel', 'Mono'];
async function parseMpeg12(file, ext) {
  const head = await readSlice(file, 0, 8192);
  // Skip ID3v2 if present.
  let off = 0;
  const id3 = id3v2Size(head, 0);
  if (id3) off = id3;
  // Find frame sync (0xFFE).
  let sync = -1;
  for (let i = off; i + 4 < head.length; i++) {
    if (head[i] === 0xFF && (head[i + 1] & 0xE0) === 0xE0) { sync = i; break; }
  }
  if (sync < 0) return null;
  const b1 = head[sync + 1], b2 = head[sync + 2], b3 = head[sync + 3];
  const verBits = (b1 >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layerBits = (b1 >> 1) & 0x03; // 3=I, 2=II, 1=III
  const layer = { 3: 1, 2: 2, 1: 3 }[layerBits];
  if (!layer || (ext === 'mp1' && layer !== 1) || (ext === 'mp2' && layer !== 2)) {
    // Allow either if extension doesn't strictly match, but require layer 1/2.
    if (layer !== 1 && layer !== 2) return null;
  }
  const verNum = verBits === 3 ? 1 : 2;
  const brField = (b2 >> 4) & 0x0F;
  const srField = (b2 >> 2) & 0x03;
  const channelMode = (b3 >> 6) & 0x03;
  const out = { 'Format': 'MPEG-1/2 Audio Layer ' + (layer === 1 ? 'I' : 'II') + ' (.' + ext + ')' };
  out['MPEG version'] = verBits === 3 ? '1' : verBits === 2 ? '2' : '2.5';
  out['Layer'] = layer === 1 ? 'I' : 'II';
  const brKey = verNum + '-' + layer;
  const bitrate = (MP_BITRATES[brKey] || [])[brField];
  if (bitrate) out['Bitrate'] = bitrate + ' kbps';
  const rate = (MP_RATES[verBits] || [])[srField];
  if (rate) out['Sample rate'] = fmtRate(rate);
  out['Channel mode'] = MP_CHANMODE[channelMode];
  // Estimate duration from CBR.
  if (bitrate && file.size) out['Duration (est, CBR)'] = fmtDuration((file.size - off) * 8 / (bitrate * 1000));
  if (id3) out['ID3v2 tag'] = 'present (' + fmtBytes(id3) + ')';
  return out;
}

// =====================================================================
//  Instruments / MIDI-ish
// =====================================================================

// ---------- SoundFont (.sf2/.sf3) ----------
async function parseSf2(file, ext) {
  const head = await readSlice(file, 0, 65536);
  if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 4) !== 'sfbk') return null;
  const out = { 'Format': 'SoundFont ' + (ext === 'sf3' ? '3 (Vorbis-compressed)' : '2') + ' (.' + ext + ')' };
  // RIFF LIST 'INFO' holds ifil/isng/INAM/IENG/ICRD etc. as sub-chunks.
  const info = {};
  let presets = 0, instruments = 0, samples = 0;
  walkRiff(head, 12, (cid, off, sz) => {
    if (cid === 'LIST') {
      const listType = ascii(head, off, 4);
      if (listType === 'INFO') {
        walkRiff(head, off + 4, (sid, soff, ssz) => {
          if (ssz > 0 && ssz < 512) {
            const map = { INAM: 'Bank name', isng: 'Sound engine', IENG: 'Author/engineer', ICRD: 'Creation date', IPRD: 'Product', ICOP: 'Copyright', ISFT: 'Software', ICMT: 'Comment' };
            if (map[sid]) info[map[sid]] = cleanAscii(head, soff, ssz);
            if (sid === 'ifil' && soff + 4 <= head.length) { const r = new Reader(head, true); r.seek(soff); info['SoundFont version'] = r.u16() + '.' + r.u16(); }
          }
        });
      }
    }
  });
  // pdta LIST has phdr/inst/shdr - each record is fixed size; count = bytes/recsize - 1.
  walkRiff(head, 12, (cid, off, sz) => {
    if (cid === 'LIST' && ascii(head, off, 4) === 'pdta') {
      walkRiff(head, off + 4, (sid, soff, ssz) => {
        if (sid === 'phdr') presets = Math.max(0, Math.floor(ssz / 38) - 1);
        else if (sid === 'inst') instruments = Math.max(0, Math.floor(ssz / 22) - 1);
        else if (sid === 'shdr') samples = Math.max(0, Math.floor(ssz / 46) - 1);
      });
    }
  });
  Object.assign(out, info);
  if (presets) out['Presets'] = presets;
  if (instruments) out['Instruments'] = instruments;
  if (samples) out['Samples'] = samples;
  return out;
}

// ---------- SFZ ----------
async function parseSfz(file) {
  const text = await file.slice(0, Math.min(file.size, 1 << 20)).text();
  if (!/<(region|group|global|control|master)>/i.test(text)) return null;
  const count = (re) => (text.match(re) || []).length;
  const samples = Array.from(text.matchAll(/sample=([^\r\n]+)/gi)).map((m) => m[1].trim());
  const keys = Array.from(text.matchAll(/(?:lokey|hikey|key)=([A-Ga-g#\d-]+)/gi)).map((m) => m[1]);
  const out = {
    'Format': 'SFZ instrument (.sfz)',
    'Regions': count(/<region>/gi),
    'Groups': count(/<group>/gi),
    'Samples referenced': new Set(samples).size,
  };
  if (keys.length) out['Key references'] = keys.length;
  const uniq = Array.from(new Set(samples)).slice(0, 200);
  if (uniq.length) out._sections = [{ title: 'Samples (' + uniq.length + ')', node: preBlock(uniq.join('\n')) }];
  return out;
}

// ---------- DLS ----------
async function parseDls(file) {
  const head = await readSlice(file, 0, 65536);
  if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 4) !== 'DLS ') return null;
  const out = { 'Format': 'Downloadable Sounds (.dls)' };
  let instruments = 0;
  walkRiff(head, 12, (cid, off, sz) => {
    if (cid === 'colh' && off + 4 <= head.length) { const r = new Reader(head, true); r.seek(off); instruments = r.u32(); }
    if (cid === 'LIST' && ascii(head, off, 4) === 'INFO') {
      walkRiff(head, off + 4, (sid, soff, ssz) => {
        if (ssz > 0 && ssz < 512) {
          const map = { INAM: 'Name', IENG: 'Engineer', ICOP: 'Copyright', IART: 'Artist', ISFT: 'Software' };
          if (map[sid]) out[map[sid]] = cleanAscii(head, soff, ssz);
        }
      });
    }
  });
  if (instruments) out['Instruments'] = instruments;
  return out;
}

// ---------- RIFF MIDI (.rmi) ----------
async function parseRmi(file) {
  const head = await readSlice(file, 0, 4096);
  if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 4) !== 'RMID') return null;
  const out = { 'Format': 'RIFF MIDI (.rmi)' };
  walkRiff(head, 12, (cid, off, sz) => {
    if (cid === 'data' && ascii(head, off, 4) === 'MThd') {
      const r = new Reader(head, false); r.seek(off + 8);
      const fmt = r.u16(); const tracks = r.u16(); const div = r.u16();
      out['MIDI format'] = ['0 (single track)', '1 (multi-track)', '2 (multi-song)'][fmt] || fmt;
      out['Tracks'] = tracks;
      out['Division'] = (div & 0x8000) ? 'SMPTE' : (div + ' PPQN');
    }
    if (cid === 'DLS ' || (cid === 'LIST' && ascii(head, off, 4) === 'DLS ')) out['Embedded DLS'] = 'yes';
  });
  if (findBytes(head, [0x73, 0x66, 0x62, 0x6B], 0) >= 0) out['Embedded SoundFont'] = 'yes (sfbk)';
  return out;
}

// ---------- SMAF (.mmf) ----------
async function parseSmaf(file) {
  const head = await readSlice(file, 0, 256);
  if (ascii(head, 0, 4) !== 'MMMD') return null;
  return {
    'Format': 'SMAF / Synthetic music Mobile Application Format (.mmf)',
    'Vendor': 'Yamaha',
    'Note': 'Mobile ringtone/sound format. MMMD container identified; sequence/contents chunks not decoded.',
  };
}

// ---------- GigaStudio (.gig) ----------
async function parseGig(file) {
  const head = await readSlice(file, 0, 64);
  if (ascii(head, 0, 4) !== 'RIFF') return null;
  const form = ascii(head, 8, 4);
  if (form !== 'DLS ' && form !== 'gig ') return null;
  return {
    'Format': 'GigaStudio instrument (.gig)',
    'Container': 'DLS-based RIFF',
    'Note': 'Tascam/NemeSys GigaStudio sampler instrument. DLS-based; full instrument/sample listing not decoded.',
  };
}

// ---------- RTTTL / RTX (ringtone text) ----------
async function parseRtttl(file) {
  const text = (await file.slice(0, Math.min(file.size, 65536)).text()).trim();
  const parts = text.split(':');
  if (parts.length < 3) return null;
  const name = parts[0].trim();
  const defaults = parts[1].trim();
  const notes = parts.slice(2).join(':');
  const noteCount = notes.split(',').filter((s) => s.trim()).length;
  const bpm = (defaults.match(/b=(\d+)/) || [])[1];
  const out = {
    'Format': 'RTTTL ringtone (.rtttl/.rtx)',
    'Name': name || '-',
    'Defaults': defaults || '-',
    'Tempo (BPM)': bpm || '-',
    'Notes': noteCount,
  };
  return out;
}

// ---------- iMelody (.imy) ----------
async function parseImelody(file) {
  const text = await file.slice(0, Math.min(file.size, 65536)).text();
  if (!/BEGIN:IMELODY/i.test(text)) return null;
  const grab = (k) => (text.match(new RegExp('^' + k + ':(.*)$', 'im')) || [])[1];
  const melody = (text.match(/^MELODY:(.*)$/im) || [])[1] || '';
  const out = {
    'Format': 'iMelody ringtone (.imy)',
    'Name': (grab('NAME') || '').trim() || '-',
    'Composer': (grab('COMPOSER') || '').trim() || '-',
    'Beat': (grab('BEAT') || '').trim() || '-',
    'Melody length': melody.trim().length + ' chars',
  };
  return out;
}

// ---------- Atari SAP ----------
async function parseSap(file) {
  const head = await readSlice(file, 0, 1024);
  if (ascii(head, 0, 4) !== 'SAP\r' && !startsWithAscii(head, 'SAP')) return null;
  const text = latin1(head).split('\x00')[0];
  const grab = (k) => { const m = text.match(new RegExp('^' + k + '\\s+"?([^"\\r\\n]*)"?', 'im')); return m ? m[1].trim() : null; };
  const out = { 'Format': 'Atari SAP (POKEY music)' };
  out['Name'] = grab('NAME') || '-';
  out['Author'] = grab('AUTHOR') || '-';
  out['Date'] = grab('DATE') || '-';
  out['Type'] = grab('TYPE') || '-';
  const songs = grab('SONGS');
  if (songs) out['Songs'] = songs;
  return out;
}

// =====================================================================
//  Tracker modules
// =====================================================================

// ---------- MOD (Amiga / ProTracker) ----------
const MOD_TAGS = {
  'M.K.': 4, 'M!K!': 4, 'FLT4': 4, 'FLT8': 8, '4CHN': 4, '6CHN': 6, '8CHN': 8,
  'CD81': 8, 'OKTA': 8, '2CHN': 2, 'OCTA': 8,
};
async function parseMod(file) {
  if (file.size < 1084) return null;
  const head = await readSlice(file, 0, 1084);
  const tag = ascii(head, 1080, 4);
  let channels = MOD_TAGS[tag];
  if (channels == null) {
    const m = tag.match(/^(\d+)CHN$/) || tag.match(/^(\d+)CH$/) || tag.match(/^TDZ(\d)$/);
    if (m) channels = parseInt(m[1], 10);
  }
  if (channels == null) return null; // not a 31-sample MOD
  const out = { 'Format': 'Amiga module (.mod)' };
  out['Format tag'] = tag;
  out['Channels'] = channels;
  out['Title'] = cleanAscii(head, 0, 20) || '(none)';
  // 31 sample headers (30 bytes each) start at offset 20.
  const names = [];
  for (let i = 0; i < 31; i++) {
    const nm = cleanAscii(head, 20 + i * 30, 22);
    if (nm) names.push(nm);
  }
  // Song length (number of patterns in order) at 950.
  out['Song positions'] = head[950];
  if (names.length) out._sections = [{ title: 'Sample names (' + names.length + ' of 31)', node: preBlock(names.join('\n')) }];
  return out;
}

// ---------- XM (FastTracker 2) ----------
async function parseXm(file) {
  const head = await readSlice(file, 0, 80);
  if (!startsWithAscii(head, 'Extended Module: ')) return null;
  const out = { 'Format': 'Extended Module (.xm)' };
  out['Title'] = cleanAscii(head, 17, 20) || '(none)';
  out['Tracker'] = cleanAscii(head, 38, 20) || '-';
  const r = new Reader(head, true); r.seek(58);
  const version = r.u16();
  out['Version'] = '0x' + version.toString(16);
  // Header at 60: size(4) + songLen(2) + restart(2) + channels(2) + patterns(2) + instruments(2)
  r.seek(60); r.u32();
  const songLen = r.u16(); r.u16();
  const channels = r.u16(); const patterns = r.u16(); const instruments = r.u16();
  out['Channels'] = channels;
  out['Patterns'] = patterns;
  out['Instruments'] = instruments;
  out['Song length'] = songLen;
  return out;
}

// ---------- IT (Impulse Tracker) ----------
async function parseIt(file) {
  const head = await readSlice(file, 0, 256);
  if (ascii(head, 0, 4) !== 'IMPM') return null;
  const out = { 'Format': 'Impulse Tracker (.it)' };
  out['Song name'] = cleanAscii(head, 4, 26) || '(none)';
  const r = new Reader(head, true); r.seek(32);
  const ordNum = r.u16();
  const insNum = r.u16();
  const smpNum = r.u16();
  const patNum = r.u16();
  const cwtv = r.u16();
  const cmwt = r.u16();
  out['Created with'] = 'v' + ((cwtv >> 8) & 0x0F) + '.' + (cwtv & 0xFF).toString(16).padStart(2, '0');
  out['Orders'] = ordNum;
  out['Instruments'] = insNum;
  out['Samples'] = smpNum;
  out['Patterns'] = patNum;
  // Message: flags at 0x2E, special at 0x2C; message length/offset at 0x36/0x38.
  try {
    const r2 = new Reader(head, true); r2.seek(0x36);
    const msgLen = r2.u16();
    const msgOff = r2.u32();
    if (msgLen > 0 && msgLen < 8192) {
      const msgBuf = await readSlice(file, msgOff, msgLen);
      const msg = latin1(msgBuf).replace(/\r/g, '\n').replace(/\0/g, '').trim();
      if (msg) out._sections = [{ title: 'Song message', node: preBlock(msg) }];
    }
  } catch (_) {}
  return out;
}

// ---------- S3M (Scream Tracker 3) ----------
async function parseS3m(file) {
  const head = await readSlice(file, 0, 96);
  if (ascii(head, 44, 4) !== 'SCRM') return null;
  const out = { 'Format': 'Scream Tracker 3 (.s3m)' };
  out['Title'] = cleanAscii(head, 0, 28) || '(none)';
  const r = new Reader(head, true); r.seek(32);
  const ordNum = r.u16();
  const insNum = r.u16();
  const patNum = r.u16();
  out['Orders'] = ordNum;
  out['Instruments'] = insNum;
  out['Patterns'] = patNum;
  out['Initial tempo'] = head[0x31];
  out['Initial BPM'] = head[0x32];
  out['Global volume'] = head[0x30];
  // Channel map at 0x40: 32 bytes, 0xFF = disabled.
  let channels = 0;
  for (let i = 0; i < 32; i++) if (head[0x40 + i] !== 0xFF) channels++;
  out['Channels'] = channels;
  return out;
}

// ---------- STM (Scream Tracker 2) ----------
async function parseStm(file) {
  const head = await readSlice(file, 0, 64);
  const id = cleanAscii(head, 20, 8);
  if (!/!Scream!|BMOD2STM|!SCREAM!/i.test(id) && head[28] !== 0x1A) return null;
  const out = { 'Format': 'Scream Tracker 2 (.stm)' };
  out['Title'] = cleanAscii(head, 0, 20) || '(none)';
  out['Tracker'] = id || '-';
  out['Type'] = head[29] === 2 ? 'Module' : 'Song';
  out['Tempo'] = head[32];
  out['Patterns'] = head[33];
  return out;
}

// ---------- MTM (MultiTracker) ----------
async function parseMtm(file) {
  const head = await readSlice(file, 0, 64);
  if (ascii(head, 0, 3) !== 'MTM') return null;
  const out = { 'Format': 'MultiTracker (.mtm)' };
  out['Version'] = (head[3] >> 4) + '.' + (head[3] & 0x0F);
  out['Title'] = cleanAscii(head, 4, 20) || '(none)';
  const r = new Reader(head, true); r.seek(24);
  const tracks = r.u16();
  const lastPattern = r.u8();
  const lastOrder = r.u8();
  out['Tracks'] = tracks;
  out['Patterns'] = lastPattern + 1;
  out['Orders'] = lastOrder + 1;
  return out;
}

// ---------- MED / MMD (OctaMED) ----------
async function parseMed(file) {
  const head = await readSlice(file, 0, 64);
  const id = ascii(head, 0, 4);
  if (!/^MMD[0-3]$/.test(id)) return null;
  return {
    'Format': 'OctaMED module (.med/.mmd)',
    'Version': id,
    'Note': 'Amiga OctaMED/MED tracker module. Header identified; block/instrument decode not implemented.',
  };
}

// ---------- 669 (Composer 669) ----------
async function parse669(file) {
  const head = await readSlice(file, 0, 256);
  const id = ascii(head, 0, 2);
  if (id !== 'if' && id !== 'JN') return null;
  const out = { 'Format': 'Composer 669 module (.669)' };
  out['Variant'] = id === 'JN' ? 'Extended 669 (UNIS 669)' : 'Original 669';
  out['Message'] = cleanAscii(head, 2, 108) || '-';
  out['Samples'] = head[110];
  out['Patterns'] = head[111];
  return out;
}

// ---------- FAR (Farandole Composer) ----------
async function parseFar(file) {
  const head = await readSlice(file, 0, 128);
  // Magic: 0xFE 'FAR' followed by ... actually "FAR\xFE"
  if (!(head[0] === 0xFE && ascii(head, 1, 3) === 'FAR')) return null;
  const out = { 'Format': 'Farandole Composer module (.far)' };
  out['Title'] = cleanAscii(head, 4, 40) || '(none)';
  return out;
}

// ---------- OKT (Oktalyzer) ----------
async function parseOkt(file) {
  const head = await readSlice(file, 0, 16);
  if (ascii(head, 0, 8) !== 'OKTASONG') return null;
  return {
    'Format': 'Oktalyzer module (.okt)',
    'Note': 'Amiga 8-channel Oktalyzer module. OKTASONG container identified; CMOD/SAMP chunk decode not implemented.',
  };
}

// =====================================================================
//  Chiptune
// =====================================================================

// ---------- NSF / NSFE ----------
async function parseNsf(file, ext) {
  const head = await readSlice(file, 0, 256);
  if (ext === 'nsfe' || ascii(head, 0, 4) === 'NSFE') {
    if (ascii(head, 0, 4) !== 'NSFE') return null;
    const out = { 'Format': 'NES Sound Format Extended (.nsfe)' };
    // Walk NSFE chunks: 4B size (LE) + 4B id + body.
    let p = 4;
    for (let g = 0; g < 64 && p + 8 <= head.length; g++) {
      const r = new Reader(head, true); r.seek(p);
      const sz = r.u32();
      const id = ascii(head, p + 4, 4);
      const body = p + 8;
      if (id === 'INFO' && body + 9 <= head.length) {
        out['Songs'] = head[body + 8] || 1;
      } else if (id === 'auth') {
        const parts = latin1(head.subarray(body, Math.min(body + sz, head.length))).split('\x00');
        if (parts[0]) out['Title'] = parts[0];
        if (parts[1]) out['Artist'] = parts[1];
        if (parts[2]) out['Copyright'] = parts[2];
        if (parts[3]) out['Ripper'] = parts[3];
      } else if (id === 'NEND') break;
      p = body + sz;
    }
    return out;
  }
  // Classic NSF: "NESM\x1A"
  if (!(ascii(head, 0, 4) === 'NESM' && head[4] === 0x1A)) return null;
  const out = { 'Format': 'NES Sound Format (.nsf)' };
  out['Version'] = head[5];
  out['Songs'] = head[6];
  out['Starting song'] = head[7];
  out['Title'] = cleanAscii(head, 0x0E, 32) || '-';
  out['Artist'] = cleanAscii(head, 0x2E, 32) || '-';
  out['Copyright'] = cleanAscii(head, 0x4E, 32) || '-';
  const chip = head[0x7B];
  const chips = [];
  if (chip & 0x01) chips.push('VRC6');
  if (chip & 0x02) chips.push('VRC7');
  if (chip & 0x04) chips.push('FDS');
  if (chip & 0x08) chips.push('MMC5');
  if (chip & 0x10) chips.push('Namco 163');
  if (chip & 0x20) chips.push('Sunsoft 5B');
  out['Expansion chips'] = chips.length ? chips.join(', ') : 'none (2A03 only)';
  out['Region'] = (head[0x7A] & 0x01) ? 'PAL' : 'NTSC';
  return out;
}

// ---------- SPC (SNES SPC700) ----------
async function parseSpc(file) {
  const head = await readSlice(file, 0, 0x10200);
  if (!startsWithAscii(head, 'SNES-SPC700 Sound File Data')) return null;
  const out = { 'Format': 'SNES SPC700 dump (.spc)' };
  // ID666 tag at 0x2E. Header has tag-present byte at 0x23.
  const hasTag = head[0x23] === 0x1A;
  if (hasTag) {
    out['Song title'] = cleanAscii(head, 0x2E, 32) || '-';
    out['Game title'] = cleanAscii(head, 0x4E, 32) || '-';
    out['Dumper'] = cleanAscii(head, 0x6E, 16) || '-';
    out['Comments'] = cleanAscii(head, 0x7E, 32) || '-';
    out['Artist'] = cleanAscii(head, 0xB1, 32) || '-';
    const dur = cleanAscii(head, 0xA9, 3);
    const fade = cleanAscii(head, 0xAC, 5);
    if (dur) out['Duration'] = dur + ' s';
    if (fade) out['Fade'] = fade + ' ms';
  } else {
    out['ID666 tag'] = 'absent';
  }
  out['Version'] = cleanAscii(head, 0x21, 2) || '-';
  return out;
}

// ---------- VGM / VGZ ----------
const VGM_CHIPS = [
  [0x0C, 'SN76489 (PSG)'], [0x10, 'YM2413 (OPLL)'], [0x2C, 'YM2612 (OPN2)'], [0x30, 'YM2151 (OPM)'],
  [0x38, 'Sega PCM'], [0x40, 'RF5C68'], [0x44, 'YM2203 (OPN)'], [0x48, 'YM2608 (OPNA)'],
  [0x4C, 'YM2610 (OPNB)'], [0x50, 'YM3812 (OPL2)'], [0x54, 'YM3526 (OPL)'], [0x5C, 'YMF262 (OPL3)'],
  [0x80, 'RF5C164'], [0x98, 'NES APU'], [0xA0, 'MultiPCM'], [0xAC, 'HuC6280'], [0xB8, 'OKIM6258'],
];
async function parseVgm(file, ext) {
  let head = await readSlice(file, 0, 256);
  let gd3Buf = null, gd3Off = 0;
  if (ext === 'vgz' || (head[0] === 0x1F && head[1] === 0x8B)) {
    const full = new Uint8Array(await file.arrayBuffer());
    const inflated = await gunzip(full);
    if (!inflated) return null;
    head = inflated.subarray(0, Math.min(inflated.length, 256));
    gd3Buf = inflated;
  }
  if (ascii(head, 0, 4) !== 'Vgm ') return null;
  const out = { 'Format': ext === 'vgz' ? 'VGM (gzip-compressed, .vgz)' : 'Video Game Music log (.vgm)' };
  const r = new Reader(head, true);
  r.seek(8); const version = r.u32();
  out['Version'] = ((version >> 8) & 0xFF).toString(16) + '.' + (version & 0xFF).toString(16).padStart(2, '0');
  r.seek(4); const eofOffset = r.u32();
  r.seek(0x18); const totalSamples = r.u32();
  if (totalSamples) out['Duration'] = fmtDuration(totalSamples / 44100);
  r.seek(0x14); const gd3Rel = r.u32();
  // Detect chips with nonzero clock.
  const chips = [];
  for (const [off, name] of VGM_CHIPS) {
    if (off + 4 <= head.length) {
      const clk = new Reader(head, true).seek(off).u32() & 0x3FFFFFFF;
      if (clk) chips.push(name + ' @ ' + (clk / 1000000).toFixed(3).replace(/\.?0+$/, '') + ' MHz');
    }
  }
  if (chips.length) out['Sound chips'] = chips.join('; ');
  // GD3 tag.
  if (gd3Rel && (gd3Buf || file.size)) {
    try {
      const gd3Abs = 0x14 + gd3Rel;
      const buf = gd3Buf || new Uint8Array(await file.arrayBuffer());
      if (ascii(buf, gd3Abs, 4) === 'Gd3 ') {
        const gr = new Reader(buf, true); gr.seek(gd3Abs + 8);
        const len = gr.u32();
        const start = gd3Abs + 12;
        const fields = [];
        let p = start; let cur = '';
        const end = Math.min(start + len, buf.length);
        for (let i = start; i + 1 < end && fields.length < 11; i += 2) {
          const cc = buf[i] | (buf[i + 1] << 8);
          if (cc === 0) { fields.push(cur); cur = ''; } else cur += String.fromCharCode(cc);
        }
        const labels = ['Track (EN)', 'Track (JP)', 'Game (EN)', 'Game (JP)', 'System (EN)', 'System (JP)', 'Author (EN)', 'Author (JP)', 'Release date', 'VGM by', 'Notes'];
        for (let i = 0; i < labels.length && i < fields.length; i++) if (fields[i]) out[labels[i]] = fields[i];
      }
    } catch (_) {}
  }
  return out;
}

// ---------- GBS ----------
async function parseGbs(file) {
  const head = await readSlice(file, 0, 256);
  if (ascii(head, 0, 3) !== 'GBS') return null;
  const out = { 'Format': 'Game Boy Sound (.gbs)' };
  out['Version'] = head[3];
  out['Songs'] = head[4];
  out['Title'] = cleanAscii(head, 0x10, 32) || '-';
  out['Author'] = cleanAscii(head, 0x30, 32) || '-';
  out['Copyright'] = cleanAscii(head, 0x50, 32) || '-';
  return out;
}

// ---------- AY (ZX Spectrum / Amstrad) ----------
async function parseAy(file) {
  const head = await readSlice(file, 0, 256);
  if (ascii(head, 0, 8) !== 'ZXAYEMUL') return null;
  const out = { 'Format': 'AY chiptune (.ay)' };
  // Pointers at 0x12 (author) and 0x14 (misc) are relative big-endian offsets.
  const r = new Reader(head, false);
  out['Songs'] = head[0x10] + 1;
  try {
    r.seek(0x12); const authorRel = r.i16(); const authorOff = 0x12 + authorRel;
    if (authorOff > 0 && authorOff < head.length) out['Author'] = cleanAscii(head, authorOff, 64);
    r.seek(0x14); const miscRel = r.i16(); const miscOff = 0x14 + miscRel;
    if (miscOff > 0 && miscOff < head.length) out['Misc'] = cleanAscii(head, miscOff, 64);
  } catch (_) {}
  return out;
}

// ---------- YM (Atari ST YM2149) ----------
async function parseYm(file) {
  let head = await readSlice(file, 0, 64);
  // Often LHA-compressed; raw starts with YM2!/YM3!/YM5!/YM6! or "YMT".
  const id = ascii(head, 0, 4);
  if (!/^YM[2-6]!$/.test(id) && ascii(head, 0, 3) !== 'YM6' && ascii(head, 0, 3) !== 'YM5') {
    // Check for LHA wrapper signature "-lh5-" at offset 2.
    if (ascii(head, 2, 5) === '-lh5-') {
      return { 'Format': 'Atari ST YM chiptune (.ym)', 'Note': 'LHA-compressed YM file; inner YM header not decoded (no LHA decompressor).' };
    }
    return null;
  }
  const out = { 'Format': 'Atari ST YM chiptune (.ym)' };
  out['Version'] = id;
  if (/^YM[56]!$/.test(id) && ascii(head, 4, 8) === 'LeOnArD!') {
    const r = new Reader(head, false); r.seek(12);
    const frames = r.u32();
    out['Frames'] = frames;
    out['Duration'] = fmtDuration(frames / 50); // 50 Hz VBL
  }
  return out;
}

// =====================================================================
//  Audacity
// =====================================================================

// ---------- AUP (Audacity XML project) ----------
async function parseAup(file) {
  const text = await file.slice(0, Math.min(file.size, 1 << 20)).text();
  if (!/<project\b/i.test(text) && !/audacityproject/i.test(text)) return null;
  const out = { 'Format': 'Audacity project (.aup)' };
  const rate = (text.match(/rate="([\d.]+)"/) || [])[1];
  const ver = (text.match(/(?:projname[^>]*version|version)="([\d.]+)"/i) || [])[1];
  if (rate) out['Sample rate'] = fmtRate(parseFloat(rate));
  if (ver) out['Audacity version'] = ver;
  const wavetracks = (text.match(/<wavetrack\b/gi) || []).length;
  const labeltracks = (text.match(/<labeltrack\b/gi) || []).length;
  out['Wave tracks'] = wavetracks;
  if (labeltracks) out['Label tracks'] = labeltracks;
  const tags = Array.from(text.matchAll(/<tag\s+name="([^"]+)"\s+value="([^"]*)"/gi)).map((m) => m[1] + ': ' + m[2]);
  if (tags.length) out._sections = [{ title: 'Metadata tags', node: preBlock(tags.join('\n')) }];
  return out;
}

// ---------- AUP3 (Audacity SQLite project) ----------
function aup3IdOnly() {
  return {
    'Format': 'Audacity 3 project (.aup3)',
    'Container': 'SQLite database',
    'Note': 'Audacity 3.x stores the whole project in one SQLite file. Sample rate, track list and tags live in DB tables; the SQLite reader couldn’t open them.',
  };
}

async function parseAup3(file) {
  const head = await readSlice(file, 0, 16);
  if (!startsWithAscii(head, 'SQLite format 3')) return null;

  let summary = null;
  try {
    summary = await sqliteSummary(file);
    if (!summary || !summary.db) return aup3IdOnly();
    const db = summary.db;
    try {
      const out = { 'Format': 'Audacity 3 project (.aup3)', 'Container': 'SQLite database' };

      // The `project` table holds a single row with a `dict` + `doc` blob: the
      // project XML (mirrors the old .aup). Surface sample rate / version / track
      // count by sniffing the XML, with row-count fallbacks for tracks.
      let docXml = '';
      try {
        const res = db.exec('SELECT dict, doc FROM project LIMIT 1');
        if (res && res[0] && res[0].values && res[0].values[0]) {
          for (const cell of res[0].values[0]) {
            if (cell instanceof Uint8Array) docXml += latin1(cell);
            else if (typeof cell === 'string') docXml += cell;
          }
        }
      } catch (_) { /* no `project` table or unreadable blob */ }

      if (docXml) {
        const rate = (docXml.match(/rate="([\d.]+)"/) || [])[1];
        const ver = (docXml.match(/(?:audacityversion|version)="([\d.]+)"/i) || [])[1];
        if (rate) out['Sample rate'] = fmtRate(parseFloat(rate));
        if (ver) out['Audacity version'] = ver;
        const waveTracks = (docXml.match(/<wavetrack\b/gi) || []).length;
        const labelTracks = (docXml.match(/<labeltrack\b/gi) || []).length;
        const noteTracks = (docXml.match(/<notetrack\b/gi) || []).length;
        if (waveTracks) out['Wave tracks'] = waveTracks;
        if (labelTracks) out['Label tracks'] = labelTracks;
        if (noteTracks) out['Note tracks'] = noteTracks;
        const tags = Array.from(docXml.matchAll(/<tag\s+name="([^"]+)"\s+value="([^"]*)"/gi)).map((m) => m[1] + ': ' + m[2]);
        if (tags.length) out._aup3Tags = tags;
      }

      // Audio data lives in the `sampleblocks` table (one row per block).
      const counts = summary.rowCounts || {};
      if (counts.sampleblocks != null) out['Sample blocks'] = counts.sampleblocks.toLocaleString();
      if (counts.autosave != null) out['Autosave rows'] = counts.autosave;
      if (counts.tags != null && out['Tags'] == null) out['Tag rows'] = counts.tags;

      const sections = [];
      if (out._aup3Tags) { sections.push({ title: 'Metadata tags (' + out._aup3Tags.length + ')', node: preBlock(out._aup3Tags.join('\n')) }); delete out._aup3Tags; }
      if (summary.tables.length) {
        sections.push({ title: 'Tables (' + summary.tables.length + ')', node: preBlock(summary.tables.map((t) => t + (counts[t] != null ? '  (' + counts[t].toLocaleString() + ' rows)' : '')).join('\n')) });
      }
      if (sections.length) out._sections = sections;
      return out;
    } finally {
      try { db.close(); } catch (_) {}
    }
  } catch (_) {
    if (summary && summary.db) { try { summary.db.close(); } catch (_) {} }
    return aup3IdOnly();
  }
}

// =====================================================================
//  Identification-only (rare AND hard)
// =====================================================================

async function idOnly(file, ext) {
  const head = await readSlice(file, 0, 16);
  const info = {
    mo3: ['MO3 compressed module', 'un4seen MO3: a compressed wrapper around MOD/XM/IT/S3M. Header identified; the proprietary MO3 codec is needed to read the inner module.'],
    umx: ['Unreal Music Package', 'Epic Games UMX: an Unreal package wrapping a tracker module. Full parse needs the Unreal package format reader.'],
    psf: ['Portable Sound Format', 'PSF: zlib-compressed program + driver data per platform (PSX, etc.). [TAG] block decode and zlib needed for full info.'],
    minipsf: ['Portable Sound Format (mini)', 'miniPSF references a shared _lib PSF. Needs the PSF reader plus the companion library file.'],
    psf2: ['Portable Sound Format 2', 'PSF2 (PlayStation 2): a virtual filesystem of compressed sections. Full parse needs the PSF2 reader.'],
    sfark: ['sfArk SoundFont', 'sfArk: a heavily compressed SoundFont (decompresses to .sf2). The proprietary sfArk codec is required.'],
    mqa: ['MQA audio', 'Master Quality Authenticated signalling is embedded inside FLAC/WAV PCM and is not a standalone container; detection needs deep stream analysis.'],
  };
  const [label, note] = info[ext] || [ext.toUpperCase(), 'Identification only.'];
  const out = { 'Format': label };
  const sig = ascii(head, 0, 4).replace(/[^\x20-\x7e]/g, '.');
  if (sig.trim()) out['Header signature'] = sig;
  out['Note'] = note;
  return out;
}

// ---------- dispatch ----------
function wrap(fn) {
  return async (c) => { try { const r = await fn(c); return r || null; } catch (_) { return null; } };
}

export const PARSERS = {
  // Lossless / hi-res
  ape: wrap((c) => parseApe(c.file)),
  wv: wrap((c) => parseWavpack(c.file)),
  tak: wrap((c) => parseTak(c.file)),
  tta: wrap((c) => parseTta(c.file)),
  ofr: wrap((c) => parseOptimfrog(c.head, c.ext)),
  ofs: wrap((c) => parseOptimfrog(c.head, c.ext)),
  shn: wrap((c) => parseShorten(c.head)),
  dsf: wrap((c) => parseDsf(c.file)),
  dff: wrap((c) => parseDff(c.file)),
  mpc: wrap((c) => parseMusepack(c.file, c.ext)),
  'mp+': wrap((c) => parseMusepack(c.file, c.ext)),
  mpp: wrap((c) => parseMusepack(c.file, c.ext)),

  // Containers / PCM
  caf: wrap((c) => parseCaf(c.file)),
  rf64: wrap((c) => parseRf64(c.file)),
  bw64: wrap((c) => parseRf64(c.file)),
  w64: wrap((c) => parseWave64(c.file)),
  au: wrap((c) => parseAu(c.file)),
  snd: wrap((c) => parseAu(c.file)),
  voc: wrap((c) => parseVoc(c.file)),
  bwf: wrap((c) => parseBwf(c.file)),

  // Speech / mobile
  spx: wrap((c) => parseSpeex(c.file)),
  awb: wrap((c) => parseAwb(c.head)),
  qcp: wrap((c) => parseQcp(c.file)),
  '3ga': wrap((c) => parseIsoAudio(c.file, c.ext, '3GPP audio (.3ga)')),
  m4r: wrap((c) => parseIsoAudio(c.file, c.ext, 'iPhone ringtone (.m4r)')),
  gsm: wrap((c) => parseGsm(c.head, c.file)),

  // MPEG layer 1/2
  mp2: wrap((c) => parseMpeg12(c.file, c.ext)),
  mp1: wrap((c) => parseMpeg12(c.file, c.ext)),

  // Instruments / MIDI-ish
  sf2: wrap((c) => parseSf2(c.file, c.ext)),
  sf3: wrap((c) => parseSf2(c.file, c.ext)),
  sfz: wrap((c) => parseSfz(c.file)),
  dls: wrap((c) => parseDls(c.file)),
  rmi: wrap((c) => parseRmi(c.file)),
  mmf: wrap((c) => parseSmaf(c.file)),
  gig: wrap((c) => parseGig(c.file)),
  rtttl: wrap((c) => parseRtttl(c.file)),
  rtx: wrap((c) => parseRtttl(c.file)),
  imy: wrap((c) => parseImelody(c.file)),
  sap: wrap((c) => parseSap(c.file)),

  // Tracker modules
  mod: wrap((c) => parseMod(c.file)),
  xm: wrap((c) => parseXm(c.file)),
  it: wrap((c) => parseIt(c.file)),
  s3m: wrap((c) => parseS3m(c.file)),
  stm: wrap((c) => parseStm(c.file)),
  mtm: wrap((c) => parseMtm(c.file)),
  med: wrap((c) => parseMed(c.file)),
  mmd: wrap((c) => parseMed(c.file)),
  '669': wrap((c) => parse669(c.file)),
  far: wrap((c) => parseFar(c.file)),
  okt: wrap((c) => parseOkt(c.file)),

  // Chiptune
  nsf: wrap((c) => parseNsf(c.file, c.ext)),
  nsfe: wrap((c) => parseNsf(c.file, c.ext)),
  spc: wrap((c) => parseSpc(c.file)),
  vgm: wrap((c) => parseVgm(c.file, c.ext)),
  vgz: wrap((c) => parseVgm(c.file, c.ext)),
  gbs: wrap((c) => parseGbs(c.file)),
  ay: wrap((c) => parseAy(c.file)),
  ym: wrap((c) => parseYm(c.file)),

  // Audacity
  aup: wrap((c) => parseAup(c.file)),
  aup3: wrap((c) => parseAup3(c.file)),

  // Identification-only (rare + hard)
  mo3: wrap((c) => idOnly(c.file, c.ext)),
  umx: wrap((c) => idOnly(c.file, c.ext)),
  psf: wrap((c) => idOnly(c.file, c.ext)),
  minipsf: wrap((c) => idOnly(c.file, c.ext)),
  psf2: wrap((c) => idOnly(c.file, c.ext)),
  sfark: wrap((c) => idOnly(c.file, c.ext)),
  mqa: wrap((c) => idOnly(c.file, c.ext)),
};
