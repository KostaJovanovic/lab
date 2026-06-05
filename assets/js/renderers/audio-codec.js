/* Analyser - audio container/codec helpers
   Sniffs the container/codec from a file header, and wraps raw AAC (ADTS)
   in a minimal M4A container so browsers that won't decode bare ADTS can. */

// --- File header peek (sample rate, bit depth, codec hints) ---
export async function peekContainer(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = (s, l) => String.fromCharCode(...head.slice(s, s + l));

  // WAV
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') {
    // fmt chunk usually at offset 12
    const dv = new DataView(head.buffer);
    const fmtId = ascii(12, 4);
    if (fmtId === 'fmt ') {
      const audioFormat = dv.getUint16(20, true);
      const channels    = dv.getUint16(22, true);
      const sampleRate  = dv.getUint32(24, true);
      const byteRate    = dv.getUint32(28, true);
      const bitDepth    = dv.getUint16(34, true);
      const formatName  = { 1: 'PCM', 3: 'IEEE Float', 6: 'A-law', 7: 'µ-law', 0xFFFE: 'WAVE_FORMAT_EXTENSIBLE' }[audioFormat] || ('0x' + audioFormat.toString(16));
      return { container: 'WAV', codec: formatName, channels, sampleRate, bitDepth, bitrate: byteRate * 8 };
    }
    return { container: 'WAV' };
  }
  // FLAC - the STREAMINFO block (always first, right after the 'fLaC' marker +
  // its 4-byte block header) holds sample rate / channels / bit depth.
  if (ascii(0, 4) === 'fLaC') {
    const b = head;                       // STREAMINFO data starts at offset 8
    const sampleRate = (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);   // 20 bits
    const channels   = ((b[20] >> 1) & 0x07) + 1;                     // 3 bits
    const bitDepth   = (((b[20] & 0x01) << 4) | (b[21] >> 4)) + 1;    // 5 bits
    const base = { container: 'FLAC', codec: 'FLAC (lossless)' };
    if (sampleRate > 0) {
      Object.assign(base, { sampleRate, channels, bitDepth });
      // Extra STREAMINFO facts: total samples (36 bits), MD5 of the raw audio
      // (16 bytes), and the lossless compression ratio vs. uncompressed PCM.
      try {
        Object.assign(base, detailFlac(b, file.size, sampleRate, channels, bitDepth));
      } catch (_) { /* best-effort */ }
    }
    return base;
  }
  // OGG
  if (ascii(0, 4) === 'OggS') return { container: 'OGG' };
  // ID3-tagged MP3
  if (ascii(0, 3) === 'ID3') {
    const base = { container: 'MP3', codec: 'MPEG Layer 3' };
    try { Object.assign(base, await detailMp3(file)); } catch (_) { /* best-effort */ }
    return base;
  }
  // AAC ADTS - 12-bit sync 0xFFF, layer=0
  if (head[0] === 0xFF && (head[1] & 0xF0) === 0xF0 && (head[1] & 0x06) === 0x00)
    return { container: 'AAC', codec: 'AAC (ADTS)' };
  // Raw MPEG frame (FF Ex/Fx)
  if (head[0] === 0xFF && (head[1] & 0xE0) === 0xE0) {
    const base = { container: 'MP3', codec: 'MPEG audio' };
    try { Object.assign(base, await detailMp3(file)); } catch (_) { /* best-effort */ }
    return base;
  }
  // MP4/M4A
  if (ascii(4, 4) === 'ftyp') return { container: 'MP4/M4A', codec: ascii(8, 4).trim() };
  // Opus in OGG handled above
  return { container: 'unknown' };
}

// --- FLAC STREAMINFO extras (total samples, MD5, compression ratio) ---
// `b` is the file head (>= 42 bytes), with STREAMINFO data starting at offset 8.
function detailFlac(b, fileSize, sampleRate, channels, bitDepth) {
  const out = {};
  // total samples: 36-bit field. Laid out after sampleRate(20)+channels(3)+
  // bitsPerSample(5) = 28 bits into the 8 bytes starting at b[18], so it's the low
  // 4 bits of b[21] plus all of b[22..25]. Compute the low 32 bits unsigned, then
  // add the top nibble * 2^32 to avoid 32-bit shift overflow.
  const low32 = ((b[22] << 24) | (b[23] << 16) | (b[24] << 8) | b[25]) >>> 0;
  const total = (b[21] & 0x0F) * 0x100000000 + low32;
  if (total > 0) out.totalSamples = total;

  // MD5 of the unencoded audio: 16 bytes immediately after the 8-byte field block.
  if (b.length >= 42) {
    let md5 = '';
    let nonZero = false;
    for (let i = 26; i < 42; i++) {
      md5 += b[i].toString(16).padStart(2, '0');
      if (b[i] !== 0) nonZero = true;
    }
    if (nonZero) out.flacMd5 = md5;
  }

  // Compression ratio vs. uncompressed PCM of the same samples.
  if (total > 0 && fileSize > 0 && sampleRate > 0) {
    const uncompressed = total * channels * Math.ceil(bitDepth / 8);
    if (uncompressed > 0) out.compressionRatio = uncompressed / fileSize;
  }
  return out;
}

// --- MP3 frame / Xing / VBRI / LAME decode (bitrate, CBR/VBR, encoder) ---
// MPEG audio bitrate table [version][layer][index], kbps. version: 1=MPEG1,
// 2=MPEG2/2.5. layer index: 1=L1,2=L2,3=L3.
const MP3_BITRATES = {
  1: { // MPEG1
    1: [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
    2: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
    3: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
  },
  2: { // MPEG2 / MPEG2.5
    1: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
    2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
    3: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
  },
};
const MP3_SRATE = {
  3: [44100, 48000, 32000],   // MPEG1
  2: [22050, 24000, 16000],   // MPEG2
  0: [11025, 12000, 8000],    // MPEG2.5
};
const MP3_LAME_PRESETS = {
  // a small map of common LAME preset codes (from the LAME tag) to names
  0xFB: 'V0', 0xF4: 'V2', 0x3C0: 'CBR 320',
};

async function detailMp3(file) {
  // Read enough for an ID3v2 tag + the first audio frame's Xing/VBRI header.
  const cap = Math.min(file.size, 64 * 1024);
  const buf = new Uint8Array(await file.slice(0, cap).arrayBuffer());

  // Skip an ID3v2 tag if present (synchsafe size at offsets 6-9).
  let off = 0;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const tagSize = ((buf[6] & 0x7F) << 21) | ((buf[7] & 0x7F) << 14) |
                    ((buf[8] & 0x7F) << 7) | (buf[9] & 0x7F);
    off = 10 + tagSize;
    const footer = (buf[5] & 0x10) ? 10 : 0;   // ID3v2.4 footer
    off += footer;
  }

  // Find the first valid MPEG audio frame header (11 sync bits + sane fields).
  let h = -1;
  for (let i = off; i + 4 <= buf.length; i++) {
    if (buf[i] !== 0xFF || (buf[i + 1] & 0xE0) !== 0xE0) continue;
    const verBits = (buf[i + 1] >> 3) & 0x03;   // 0=2.5 1=reserved 2=2 3=1
    const layerBits = (buf[i + 1] >> 1) & 0x03; // 0=reserved 1=L3 2=L2 3=L1
    const brIdx = (buf[i + 2] >> 4) & 0x0F;
    const srIdx = (buf[i + 2] >> 2) & 0x03;
    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 0x0F || srIdx === 3) continue;
    h = i; break;
  }
  if (h < 0) return {};

  const verBits = (buf[h + 1] >> 3) & 0x03;
  const layerBits = (buf[h + 1] >> 1) & 0x03;
  const brIdx = (buf[h + 2] >> 4) & 0x0F;
  const srIdx = (buf[h + 2] >> 2) & 0x03;
  const padding = (buf[h + 2] >> 1) & 0x01;
  const chMode = (buf[h + 3] >> 6) & 0x03;      // 0=stereo 1=joint 2=dual 3=mono

  const layer = 4 - layerBits;                  // 1/2/3
  const verName = verBits === 3 ? 'MPEG-1' : verBits === 2 ? 'MPEG-2' : 'MPEG-2.5';
  const brVer = verBits === 3 ? 1 : 2;          // bitrate table group
  const frameBitrate = (MP3_BITRATES[brVer][layer] || [])[brIdx] || 0;  // kbps
  const sampleRate = (MP3_SRATE[verBits] || MP3_SRATE[2])[srIdx] || 0;
  const channels = chMode === 3 ? 1 : 2;
  const chName = chMode === 0 ? 'stereo' : chMode === 1 ? 'joint stereo'
              : chMode === 2 ? 'dual channel' : 'mono';

  const out = {
    codec: `${verName} Audio Layer ${layer}`,
    mpegVersion: verName,
    mpegLayer: 'Layer ' + layer,
    channelMode: chName,
  };
  if (sampleRate > 0) out.sampleRate = sampleRate;
  if (channels > 0) out.channels = channels;

  // Locate the Xing/Info or VBRI header within this frame.
  // Xing/Info side-info offset: MPEG1 mono=21, else 36; MPEG2 mono=13, else 21.
  let vbr = false, frameCount = 0, encoder = null, hasXing = false, hasVbri = false;
  const xingOff = h + 4 + (verBits === 3 ? (channels === 1 ? 17 : 32)
                                         : (channels === 1 ? 9 : 17));
  const tag4 = (p) => p + 4 <= buf.length
    ? String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]) : '';
  const xt = tag4(xingOff);
  if (xt === 'Xing' || xt === 'Info') {
    hasXing = true;
    vbr = xt === 'Xing';            // 'Info' = CBR with a Xing-style TOC
    const flags = (buf[xingOff + 4] << 24 | buf[xingOff + 5] << 16 |
                   buf[xingOff + 6] << 8 | buf[xingOff + 7]) >>> 0;
    let p = xingOff + 8;
    if (flags & 0x01) { frameCount = ((buf[p] << 24 | buf[p + 1] << 16 | buf[p + 2] << 8 | buf[p + 3]) >>> 0); p += 4; }
    if (flags & 0x02) p += 4;       // bytes field
    if (flags & 0x04) p += 100;     // TOC
    if (flags & 0x08) p += 4;       // quality
    // LAME / encoder tag: 9 ASCII bytes (e.g. "LAME3.100").
    if (p + 9 <= buf.length) {
      const enc = String.fromCharCode(...buf.slice(p, p + 9)).replace(/\0+$/, '').trim();
      if (/^(LAME|Lavf|Lavc|GOGO|Xing)/i.test(enc)) {
        encoder = enc;
        // LAME revision/preset byte sits a little further on; surface the preset
        // code when it maps to a known name.
        const presetCode = (buf[p + 21] << 8 | buf[p + 22]);
        if (MP3_LAME_PRESETS[presetCode]) encoder += ' (' + MP3_LAME_PRESETS[presetCode] + ')';
      } else if (enc && /[ -~]/.test(enc[0])) {
        encoder = enc;
      }
    }
  } else {
    // VBRI header is always 32 bytes after the frame header (Fraunhofer encoders).
    const vbriOff = h + 4 + 32;
    if (tag4(vbriOff) === 'VBRI') { hasVbri = true; vbr = true; encoder = 'Fraunhofer (VBRI)'; }
  }

  // Bitrate text: CBR uses the frame's table value; VBR averages over the file.
  if (vbr) {
    let avg = 0;
    // Prefer frame-count-based duration when available, else fall back to the
    // frame header bitrate as a rough hint.
    if (frameCount > 0 && sampleRate > 0) {
      const samplesPerFrame = layer === 1 ? 384 : (verBits === 3 ? 1152 : 576);
      const duration = (frameCount * samplesPerFrame) / sampleRate;
      if (duration > 0) avg = Math.round((file.size * 8) / duration / 1000);
    }
    if (!avg) avg = frameBitrate;
    if (avg > 0) {
      out.bitrate = avg * 1000;            // bits/sec (numeric, for existing row)
      out.bitrateText = '~' + avg + ' kbps VBR';
    }
  } else if (frameBitrate > 0) {
    out.bitrate = frameBitrate * 1000;
    out.bitrateText = frameBitrate + ' kbps CBR';
  }

  if (encoder) out.encoder = encoder;
  if (frameCount > 0) out.frameCount = frameCount;
  return out;
}

// --- AAC ADTS → M4A container (browser compat) ---
export function adtsToM4a(arrayBuffer) {
  const src = new Uint8Array(arrayBuffer);
  const RATES = [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
  const frameData = [], frameSizes = [];
  let profile, freqIdx, chanCfg, i = 0;
  if (src.length > 10 && src[0] === 0x49 && src[1] === 0x44 && src[2] === 0x33)
    i = 10 + (((src[6]&0x7F)<<21)|((src[7]&0x7F)<<14)|((src[8]&0x7F)<<7)|(src[9]&0x7F));
  while (i + 7 <= src.length) {
    if (src[i] !== 0xFF || (src[i+1] & 0xF6) !== 0xF0) { i++; continue; }
    profile = ((src[i+2]>>6)&3)+1; freqIdx = (src[i+2]>>2)&0xF;
    chanCfg = ((src[i+2]&1)<<2)|((src[i+3]>>6)&3);
    if (freqIdx >= 13) { i++; continue; }
    const len = ((src[i+3]&3)<<11)|(src[i+4]<<3)|((src[i+5]>>5)&7);
    if (len < 7 || i + len > src.length) break;
    const hdr = (src[i+1]&1) ? 7 : 9;
    frameData.push(src.slice(i+hdr, i+len)); frameSizes.push(len-hdr);
    i += len;
  }
  if (!frameSizes.length) return null;
  const rate = RATES[freqIdx]||44100, ch = chanCfg||2, N = frameSizes.length;
  let rawSize = 0; for (const s of frameSizes) rawSize += s;
  const stszBox = 20+N*4, moov = 540+N*4, total = 568+N*4+rawSize, chunkOff = 568+N*4;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  let o = 0;
  const w4 = v => { dv.setUint32(o,v); o+=4; };
  const w2 = v => { dv.setUint16(o,v); o+=2; };
  const w1 = v => { out[o++]=v; };
  const ws = s => { for(let j=0;j<s.length;j++) out[o++]=s.charCodeAt(j); };
  const sk = n => { o+=n; };
  const bx = (t,s) => { w4(s); ws(t); };
  bx('ftyp',20); ws('M4A '); w4(0); ws('isom');
  bx('moov',moov);
  bx('mvhd',108); sk(4); sk(8); w4(rate); w4(N*1024);
  w4(0x00010000); w2(0x0100); sk(10);
  w4(0x00010000); sk(12); w4(0x00010000); sk(12); w4(0x40000000);
  sk(24); w4(2);
  bx('trak',424+N*4);
  bx('tkhd',92); sk(3); w1(3); sk(8); w4(1); sk(4); w4(N*1024); sk(8); sk(4);
  w2(0x0100); sk(2);
  w4(0x00010000); sk(12); w4(0x00010000); sk(12); w4(0x40000000); sk(8);
  bx('mdia',324+N*4);
  bx('mdhd',32); sk(4); sk(8); w4(rate); w4(N*1024); w2(0x55C4); sk(2);
  bx('hdlr',33); sk(4); sk(4); ws('soun'); sk(12); w1(0);
  bx('minf',251+N*4);
  bx('smhd',16); sk(8);
  bx('dinf',36); bx('dref',28); sk(4); w4(1); bx('url ',12); sk(3); w1(1);
  bx('stbl',191+N*4);
  bx('stsd',91); sk(4); w4(1);
  bx('mp4a',75); sk(6); w2(1); sk(8); w2(ch); w2(16); sk(4); w4(rate<<16);
  bx('esds',39); sk(4);
  w1(0x03); w1(25); w2(1); w1(0);
  w1(0x04); w1(17); w1(0x40); w1(0x15); sk(3); w4(0); w4(0);
  w1(0x05); w1(2); w1((profile<<3)|(freqIdx>>1)); w1(((freqIdx&1)<<7)|(chanCfg<<3));
  w1(0x06); w1(1); w1(0x02);
  bx('stts',24); sk(4); w4(1); w4(N); w4(1024);
  bx('stsc',28); sk(4); w4(1); w4(1); w4(N); w4(1);
  bx('stsz',stszBox); sk(4); w4(0); w4(N); for(const s of frameSizes) w4(s);
  bx('stco',20); sk(4); w4(1); w4(chunkOff);
  bx('mdat',8+rawSize); for(const f of frameData){ out.set(f,o); o+=f.length; }
  return out.buffer;
}

// --- Read BPM from file metadata (ID3v2 TBPM / MP4 tmpo) ---
export async function readTagBPM(file) {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());

  // ID3v2 TBPM frame
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    const ver = head[3];
    const tagSize = ((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14) |
                    ((head[8] & 0x7F) << 7) | (head[9] & 0x7F);
    const needed = Math.min(tagSize + 10, file.size, 65536);
    const buf = needed > head.length
      ? new Uint8Array(await file.slice(0, needed).arrayBuffer()) : head;
    let pos = 10;
    const idLen = ver === 2 ? 3 : 4;
    const hdrLen = ver === 2 ? 6 : 10;
    const target = ver === 2 ? 'TBP' : 'TBPM';
    while (pos + hdrLen < buf.length && pos < tagSize + 10) {
      const id = String.fromCharCode(...buf.slice(pos, pos + idLen));
      if (id[0] === '\0') break;
      let sz;
      if (ver === 2) sz = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
      else if (ver === 4) sz = ((buf[pos + 4] & 0x7F) << 21) | ((buf[pos + 5] & 0x7F) << 14) |
                               ((buf[pos + 6] & 0x7F) << 7) | (buf[pos + 7] & 0x7F);
      else sz = (buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7];
      if (sz <= 0 || pos + hdrLen + sz > buf.length) break;
      if (id === target) {
        const data = buf.slice(pos + hdrLen, pos + hdrLen + sz);
        const enc = data[0];
        let text;
        if (enc === 0 || enc === 3) text = String.fromCharCode(...data.slice(1));
        else text = new TextDecoder(enc === 2 ? 'utf-16be' : 'utf-16').decode(data.slice(1));
        const val = parseInt(text.replace(/\0/g, ''), 10);
        if (val > 0 && val < 999) return val;
      }
      pos += hdrLen + sz;
    }
  }

  // MP4/M4A tmpo atom
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    const size = Math.min(file.size, 131072);
    const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
    for (let i = 0; i + 8 < buf.length; i++) {
      if (buf[i] === 0x74 && buf[i + 1] === 0x6D && buf[i + 2] === 0x70 && buf[i + 3] === 0x6F) {
        const dv = new DataView(buf.buffer, i + 4);
        if (i + 12 <= buf.length) {
          const val = dv.getUint16(8 - 4, false);
          if (val > 0 && val < 999) return val;
        }
      }
    }
  }

  return null;
}

// --- Extract embedded cover art (ID3v2 APIC / MP4 covr / FLAC PICTURE) ---
// Returns { bytes: Uint8Array, mime: string } or null.
export async function extractCoverArt(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return extractId3Pic(file, head);
  if (head[0] === 0x66 && head[1] === 0x4C && head[2] === 0x61 && head[3] === 0x43) return extractFlacPic(file);
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return extractMp4Cover(file);
  return null;
}

async function extractId3Pic(file, head) {
  const ver = head[3];
  const tagSize = ((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14) |
                  ((head[8] & 0x7F) << 7) | (head[9] & 0x7F);
  const needed = Math.min(tagSize + 10, file.size, 20 * 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, needed).arrayBuffer());
  let pos = 10;
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  const target = ver === 2 ? 'PIC' : 'APIC';
  while (pos + hdrLen < buf.length && pos < tagSize + 10) {
    const id = String.fromCharCode(...buf.slice(pos, pos + idLen));
    if (id[0] === '\0') break;
    let sz;
    if (ver === 2) sz = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
    else if (ver === 4) sz = ((buf[pos + 4] & 0x7F) << 21) | ((buf[pos + 5] & 0x7F) << 14) |
                             ((buf[pos + 6] & 0x7F) << 7) | (buf[pos + 7] & 0x7F);
    else sz = (buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7];
    if (sz <= 0 || pos + hdrLen + sz > buf.length) break;
    if (id === target) {
      const data = buf.slice(pos + hdrLen, pos + hdrLen + sz);
      let p = 0;
      const enc = data[p]; p++;
      let mime;
      if (target === 'PIC') {
        const fmt = String.fromCharCode(data[p], data[p + 1], data[p + 2]); p += 3;
        mime = fmt.toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
      } else {
        let s = '';
        while (p < data.length && data[p] !== 0) { s += String.fromCharCode(data[p]); p++; }
        p++;
        mime = s || 'image/jpeg';
      }
      p++; // picture type byte
      // description, terminated by null (UTF-16 → double null)
      if (enc === 1 || enc === 2) { while (p + 1 < data.length && !(data[p] === 0 && data[p + 1] === 0)) p += 2; p += 2; }
      else { while (p < data.length && data[p] !== 0) p++; p++; }
      if (p < data.length) return { bytes: data.slice(p), mime };
    }
    pos += hdrLen + sz;
  }
  return null;
}

async function extractMp4Cover(file) {
  const size = Math.min(file.size, 24 * 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i + 24 < buf.length; i++) {
    // 'covr'
    if (buf[i] === 0x63 && buf[i + 1] === 0x6F && buf[i + 2] === 0x76 && buf[i + 3] === 0x72) {
      const d = i + 4; // child 'data' atom
      if (d + 16 > buf.length) continue;
      if (!(buf[d + 4] === 0x64 && buf[d + 5] === 0x61 && buf[d + 6] === 0x74 && buf[d + 7] === 0x61)) continue;
      const dataSize = dv.getUint32(d, false);
      const typeFlag = dv.getUint32(d + 8, false) & 0xFF; // 13 JPEG, 14 PNG, 27 BMP
      const imgStart = d + 16;
      const imgLen = dataSize - 16;
      if (imgLen > 0 && imgStart + imgLen <= buf.length) {
        const mime = typeFlag === 14 ? 'image/png' : typeFlag === 27 ? 'image/bmp' : 'image/jpeg';
        return { bytes: buf.slice(imgStart, imgStart + imgLen), mime };
      }
    }
  }
  return null;
}

async function extractFlacPic(file) {
  const size = Math.min(file.size, 24 * 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 4; // after 'fLaC'
  while (pos + 4 <= buf.length) {
    const flag = buf[pos];
    const last = (flag & 0x80) !== 0;
    const type = flag & 0x7F;
    const len = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    const body = pos + 4;
    if (type === 6 && body + 32 <= buf.length) { // PICTURE
      let p = body + 4; // skip picture type
      const mimeLen = dv.getUint32(p, false); p += 4;
      const mime = String.fromCharCode(...buf.slice(p, p + mimeLen)); p += mimeLen;
      const descLen = dv.getUint32(p, false); p += 4; p += descLen;
      p += 16; // width, height, depth, colours
      const dataLen = dv.getUint32(p, false); p += 4;
      if (dataLen > 0 && p + dataLen <= buf.length) return { bytes: buf.slice(p, p + dataLen), mime: mime || 'image/jpeg' };
    }
    if (last) break;
    pos = body + len;
  }
  return null;
}

// --- Read text tags (title/artist/album/.../lyrics) from common containers ---
// Returns { tags: [[name, value], ...], lyrics: string|null }. Best-effort; an
// unparseable/absent tag block just yields an empty result.
export async function readAudioTags(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return await readId3Tags(file, head);
    if (head[0] === 0x66 && head[1] === 0x4C && head[2] === 0x61 && head[3] === 0x43) return await readFlacTags(file);
    if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return await readMp4Tags(file);
    if (head[0] === 0x4F && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return await readVorbisLikeTags(file);
  } catch (_) { /* ignore */ }
  return { tags: [], lyrics: null };
}

function decodeStr(bytes, enc) {
  try {
    if (enc === 1) return new TextDecoder('utf-16').decode(bytes);     // UTF-16 w/ BOM
    if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);   // UTF-16BE
    if (enc === 3) return new TextDecoder('utf-8').decode(bytes);      // UTF-8
    return new TextDecoder('iso-8859-1').decode(bytes);               // Latin-1
  } catch (_) { try { return new TextDecoder().decode(bytes); } catch (__) { return ''; } }
}
const clean = (s) => (s || '').replace(/\0+$/, '').trim();

const ID3_NAMES = {
  TIT2: 'Title', TT2: 'Title', TPE1: 'Artist', TP1: 'Artist', TPE2: 'Album artist', TP2: 'Album artist',
  TALB: 'Album', TAL: 'Album', TYER: 'Year', TYE: 'Year', TDRC: 'Year', TDAT: 'Date', TCON: 'Genre', TCO: 'Genre',
  TRCK: 'Track', TRK: 'Track', TPOS: 'Disc', TCOM: 'Composer', TCM: 'Composer', TBPM: 'BPM', TB: 'BPM',
  TPUB: 'Publisher', TENC: 'Encoded by', TSSE: 'Encoder', TSRC: 'ISRC', TOPE: 'Original artist',
  TEXT: 'Lyricist', TOAL: 'Original album', TLAN: 'Language', WXXX: 'URL', WOAR: 'Artist URL',
};

async function readId3Tags(file, head) {
  const ver = head[3];
  const tagSize = ((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14) | ((head[8] & 0x7F) << 7) | (head[9] & 0x7F);
  const needed = Math.min(tagSize + 10, file.size, 20 * 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, needed).arrayBuffer());
  const tags = []; let lyrics = null;
  let pos = 10;
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  while (pos + hdrLen < buf.length && pos < tagSize + 10) {
    const id = String.fromCharCode(...buf.slice(pos, pos + idLen));
    if (id[0] === '\0' || !/^[A-Z0-9]+$/.test(id)) break;
    let sz;
    if (ver === 2) sz = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
    else if (ver === 4) sz = ((buf[pos + 4] & 0x7F) << 21) | ((buf[pos + 5] & 0x7F) << 14) | ((buf[pos + 6] & 0x7F) << 7) | (buf[pos + 7] & 0x7F);
    else sz = (buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7];
    if (sz <= 0 || pos + hdrLen + sz > buf.length) break;
    const data = buf.slice(pos + hdrLen, pos + hdrLen + sz);
    if (id === 'USLT' || id === 'ULT' || id === 'SYLT') {
      // encoding(1) + lang(3) + descriptor(null-term) + text
      const enc = data[0]; let p = 4;
      if (enc === 1 || enc === 2) { while (p + 1 < data.length && !(data[p] === 0 && data[p + 1] === 0)) p += 2; p += 2; }
      else { while (p < data.length && data[p] !== 0) p++; p++; }
      const txt = clean(decodeStr(data.slice(p), enc));
      if (txt) lyrics = txt;
    } else if (id === 'COMM' || id === 'COM') {
      const enc = data[0]; let p = 4;
      if (enc === 1 || enc === 2) { while (p + 1 < data.length && !(data[p] === 0 && data[p + 1] === 0)) p += 2; p += 2; }
      else { while (p < data.length && data[p] !== 0) p++; p++; }
      const txt = clean(decodeStr(data.slice(p), enc));
      if (txt) tags.push(['Comment', txt]);
    } else if (id[0] === 'T' && ID3_NAMES[id]) {
      const txt = clean(decodeStr(data.slice(1), data[0]));
      if (txt) tags.push([ID3_NAMES[id], txt]);
    }
    pos += hdrLen + sz;
  }
  return { tags, lyrics };
}

const VORBIS_NAMES = {
  TITLE: 'Title', ARTIST: 'Artist', ALBUM: 'Album', ALBUMARTIST: 'Album artist', DATE: 'Year', YEAR: 'Year',
  GENRE: 'Genre', TRACKNUMBER: 'Track', DISCNUMBER: 'Disc', COMPOSER: 'Composer', PERFORMER: 'Performer',
  ORGANIZATION: 'Publisher', PUBLISHER: 'Publisher', COMMENT: 'Comment', DESCRIPTION: 'Description',
  BPM: 'BPM', ISRC: 'ISRC', COPYRIGHT: 'Copyright', ENCODER: 'Encoder', LANGUAGE: 'Language',
};
// Parse a Vorbis-comment block (vendor + count + KEY=VALUE entries) into tags.
function parseVorbisComments(buf, start, dv) {
  const tags = []; let lyrics = null; let p = start;
  const vlen = dv.getUint32(p, true); p += 4 + vlen;
  let count = dv.getUint32(p, true); p += 4;
  for (let i = 0; i < count && p + 4 <= buf.length; i++) {
    const len = dv.getUint32(p, true); p += 4;
    if (len <= 0 || p + len > buf.length) break;
    const entry = new TextDecoder('utf-8').decode(buf.slice(p, p + len)); p += len;
    const eq = entry.indexOf('=');
    if (eq < 0) continue;
    const key = entry.slice(0, eq).toUpperCase();
    const val = clean(entry.slice(eq + 1));
    if (!val) continue;
    if (key === 'LYRICS' || key === 'UNSYNCEDLYRICS' || key === 'LYRICS-XXX') lyrics = val;
    else if (VORBIS_NAMES[key]) tags.push([VORBIS_NAMES[key], val]);
  }
  return { tags, lyrics };
}

async function readFlacTags(file) {
  const size = Math.min(file.size, 8 * 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 4;
  while (pos + 4 <= buf.length) {
    const flag = buf[pos];
    const type = flag & 0x7F;
    const len = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    const body = pos + 4;
    if (type === 4 && body + 8 <= buf.length) return parseVorbisComments(buf, body, dv); // VORBIS_COMMENT
    if (flag & 0x80) break;
    pos = body + len;
  }
  return { tags: [], lyrics: null };
}

// OGG (Vorbis/Opus): the comment header lives in the 2nd logical page. Rather than
// fully parse OGG paging, scan for the comment signature and parse from there.
async function readVorbisLikeTags(file) {
  const size = Math.min(file.size, 1 * 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i + 8 < buf.length; i++) {
    // Vorbis comment packet: 0x03 'vorbis'
    if (buf[i] === 0x03 && buf[i+1]===0x76 && buf[i+2]===0x6F && buf[i+3]===0x72 && buf[i+4]===0x62 && buf[i+5]===0x69 && buf[i+6]===0x73)
      return parseVorbisComments(buf, i + 7, dv);
    // Opus comment packet: 'OpusTags'
    if (buf[i]===0x4F && buf[i+1]===0x70 && buf[i+2]===0x75 && buf[i+3]===0x73 && buf[i+4]===0x54 && buf[i+5]===0x61 && buf[i+6]===0x67 && buf[i+7]===0x73)
      return parseVorbisComments(buf, i + 8, dv);
  }
  return { tags: [], lyrics: null };
}

const MP4_NAMES = {
  '©nam': 'Title', '©ART': 'Artist', 'aART': 'Album artist', '©alb': 'Album', '©day': 'Year',
  '©gen': 'Genre', 'gnre': 'Genre', '©wrt': 'Composer', '©cmt': 'Comment', '©too': 'Encoder',
  '©lyr': 'Lyrics', 'cprt': 'Copyright', '©grp': 'Grouping', 'desc': 'Description', 'ldes': 'Long description',
};
async function readMp4Tags(file) {
  const size = Math.min(file.size, 24 * 1024 * 1024);
  const buf = new Uint8Array(await file.slice(0, size).arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tags = []; let lyrics = null;
  const dec = new TextDecoder('utf-8');
  const keys = Object.keys(MP4_NAMES);
  for (let i = 0; i + 24 < buf.length; i++) {
    let atom = null;
    for (const k of keys) {
      if (buf[i] === k.charCodeAt(0) && buf[i+1] === k.charCodeAt(1) && buf[i+2] === k.charCodeAt(2) && buf[i+3] === k.charCodeAt(3)) { atom = k; break; }
    }
    if (!atom) continue;
    const d = i + 4; // expect child 'data' atom
    if (d + 16 > buf.length) continue;
    if (!(buf[d+4]===0x64 && buf[d+5]===0x61 && buf[d+6]===0x74 && buf[d+7]===0x61)) continue;
    const dataSize = dv.getUint32(d, false);
    const valStart = d + 16, valLen = dataSize - 16;
    if (valLen <= 0 || valStart + valLen > buf.length) continue;
    const val = clean(dec.decode(buf.slice(valStart, valStart + valLen)));
    if (!val) continue;
    if (atom === '©lyr') lyrics = val;
    else tags.push([MP4_NAMES[atom], val]);
  }
  return { tags, lyrics };
}
