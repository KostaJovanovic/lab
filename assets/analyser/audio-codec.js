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
  // FLAC
  if (ascii(0, 4) === 'fLaC') return { container: 'FLAC' };
  // OGG
  if (ascii(0, 4) === 'OggS') return { container: 'OGG' };
  // ID3-tagged MP3
  if (ascii(0, 3) === 'ID3') return { container: 'MP3', codec: 'MPEG Layer 3' };
  // AAC ADTS — 12-bit sync 0xFFF, layer=0
  if (head[0] === 0xFF && (head[1] & 0xF0) === 0xF0 && (head[1] & 0x06) === 0x00)
    return { container: 'AAC', codec: 'AAC (ADTS)' };
  // Raw MPEG frame (FF Ex/Fx)
  if (head[0] === 0xFF && (head[1] & 0xE0) === 0xE0) return { container: 'MP3', codec: 'MPEG audio' };
  // MP4/M4A
  if (ascii(4, 4) === 'ftyp') return { container: 'MP4/M4A', codec: ascii(8, 4).trim() };
  // Opus in OGG handled above
  return { container: 'unknown' };
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
