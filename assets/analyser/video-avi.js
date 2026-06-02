/* Analyser - AVI (RIFF) container parsing
   Browsers can't play most AVI files (typically Motion-JPEG video + PCM audio),
   so we parse the container ourselves: read the header for dimensions/codec/
   audio format, pull the raw MJPEG frames and PCM audio out of the `movi` list,
   and re-wrap the PCM as a WAV the browser *can* play. Used by video.js when the
   normal <video> path fails on an AVI. No DOM or cross-module dependencies. */

import { roundFps } from './util.js';

// Read just the AVI header chunks (avih/strh/strf) from the first 8 KB. Returns
// { width, height, fps, duration, totalFrames, codec, audioCodec, audioFormat }
// or null if the file isn't an AVI / has no video stream.
export async function parseAviHeader(file) {
  const size = Math.min(file.size, 8192);
  const buf = await file.slice(0, size).arrayBuffer();
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const tag = (o) => String.fromCharCode(u8[o], u8[o+1], u8[o+2], u8[o+3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'AVI ') return null;

  const info = {};
  let lastStreamType = null;
  let pos = 12;
  while (pos + 8 < size) {
    const ckId = tag(pos);
    const ckSize = view.getUint32(pos + 4, true);
    if (ckId === 'avih' && pos + 8 + 56 <= size) {
      const d = pos + 8;
      info.microSecPerFrame = view.getUint32(d, true);
      info.totalFrames = view.getUint32(d + 16, true);
      info.width = view.getUint32(d + 32, true);
      info.height = view.getUint32(d + 36, true);
      if (info.microSecPerFrame > 0) {
        info.fps = roundFps(1000000 / info.microSecPerFrame);
        info.duration = info.totalFrames * info.microSecPerFrame / 1000000;
      }
    }
    if (ckId === 'strh' && pos + 8 + 56 <= size) {
      const d = pos + 8;
      const fccType = tag(d);
      const fccHandler = tag(d + 4);
      lastStreamType = fccType;
      if (fccType === 'vids') info.codec = fccHandler.trim() || undefined;
      if (fccType === 'auds') info.audioCodec = fccHandler.trim() || undefined;
    }
    if (ckId === 'strf' && lastStreamType === 'auds' && pos + 8 + 16 <= size) {
      const d = pos + 8;
      info.audioFormat = {
        formatTag: view.getUint16(d, true),
        channels: view.getUint16(d + 2, true),
        sampleRate: view.getUint32(d + 4, true),
        avgBytesPerSec: view.getUint32(d + 8, true),
        blockAlign: view.getUint16(d + 12, true),
        bitsPerSample: view.getUint16(d + 14, true)
      };
    }
    if (ckId === 'LIST') { pos += 12; continue; }
    pos += 8 + ckSize + (ckSize & 1);
  }
  return info.width ? info : null;
}

// Walk the `movi` list and collect the payloads: MJPEG frames (00dc/00db, each a
// standalone JPEG) and PCM audio (01wb). When the audio is uncompressed PCM
// (formatTag 1), decode it into an AudioBuffer. Returns { videoFrames, audioBuffer? }
// or null. Capped at 500 MB since it reads the whole file into memory.
export async function extractAviData(file, aviInfo) {
  if (file.size > 500 * 1024 * 1024) return null;
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const tag = (o) => (o + 4 <= buf.byteLength)
    ? String.fromCharCode(u8[o], u8[o+1], u8[o+2], u8[o+3]) : '';

  let moviStart = -1, moviEnd = -1, pos = 12;
  while (pos + 12 < buf.byteLength) {
    const ckId = tag(pos);
    const ckSize = view.getUint32(pos + 4, true);
    if (ckSize === 0 || pos + ckSize > buf.byteLength + 8) break;
    if (ckId === 'LIST' && tag(pos + 8) === 'movi') {
      moviStart = pos + 12;
      moviEnd = Math.min(pos + 8 + ckSize, buf.byteLength);
      break;
    }
    if (ckId === 'LIST') { pos += 12; continue; }
    pos += 8 + ckSize + (ckSize & 1);
  }
  if (moviStart < 0) return null;

  const audioChunks = [], videoFrames = [];
  pos = moviStart;
  while (pos + 8 <= moviEnd) {
    const ckId = tag(pos);
    const ckSize = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;
    if (dataStart + ckSize > buf.byteLength || ckSize === 0) break;
    if ((ckId === '00dc' || ckId === '00db') && ckSize > 2)
      videoFrames.push(buf.slice(dataStart, dataStart + ckSize));
    if (ckId === '01wb' && ckSize > 0)
      audioChunks.push(new Uint8Array(buf, dataStart, ckSize));
    if (ckId === 'LIST') { pos += 12; continue; }
    pos += 8 + ckSize + (ckSize & 1);
  }

  const result = { videoFrames };
  const fmt = aviInfo && aviInfo.audioFormat;
  if (audioChunks.length && fmt && fmt.formatTag === 1 && fmt.bitsPerSample) {
    const totalSize = audioChunks.reduce((s, c) => s + c.length, 0);
    const pcm = new Uint8Array(totalSize);
    let off = 0;
    for (const c of audioChunks) { pcm.set(c, off); off += c.length; }
    const bytesPerSample = fmt.bitsPerSample / 8;
    const frameSize = bytesPerSample * fmt.channels;
    const totalFrames = Math.floor(totalSize / frameSize);
    if (totalFrames > 0) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuf = ac.createBuffer(fmt.channels, totalFrames, fmt.sampleRate);
      const pcmView = new DataView(pcm.buffer);
      for (let ch = 0; ch < fmt.channels; ch++) {
        const chData = audioBuf.getChannelData(ch);
        for (let i = 0; i < totalFrames; i++) {
          const bytePos = i * frameSize + ch * bytesPerSample;
          if (bytePos + bytesPerSample > totalSize) break;
          if (bytesPerSample === 2) chData[i] = pcmView.getInt16(bytePos, true) / 0x8000;
          else if (bytesPerSample === 1) chData[i] = (pcmView.getUint8(bytePos) - 128) / 128;
        }
      }
      result.audioBuffer = audioBuf;
    }
  }
  return result;
}

// Encode an AudioBuffer as a 16-bit PCM WAV Blob (interleaved), so the extracted
// AVI audio can be handed to a normal <audio> element.
export function encodeWav(audioBuf) {
  const ch = audioBuf.numberOfChannels, sr = audioBuf.sampleRate, len = audioBuf.length;
  const block = ch * 2, dataSize = len * block;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  let o = 0;
  const ws = (s) => { for (let i = 0; i < s.length; i++) v.setUint8(o++, s.charCodeAt(i)); };
  ws('RIFF'); v.setUint32(o, 36 + dataSize, true); o += 4; ws('WAVEfmt ');
  v.setUint32(o, 16, true); o += 4;
  v.setUint16(o, 1, true); o += 2;
  v.setUint16(o, ch, true); o += 2;
  v.setUint32(o, sr, true); o += 4;
  v.setUint32(o, sr * block, true); o += 4;
  v.setUint16(o, block, true); o += 2;
  v.setUint16(o, 16, true); o += 2;
  ws('data'); v.setUint32(o, dataSize, true); o += 4;
  const chData = [];
  for (let c = 0; c < ch; c++) chData.push(audioBuf.getChannelData(c));
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      let s = Math.max(-1, Math.min(1, chData[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
