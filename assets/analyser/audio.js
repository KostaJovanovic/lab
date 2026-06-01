/* Analyser - audio module
   Handles uploaded files, mic recording, and live spectrogram.
   Renders waveform, file info, and an interactive spectrogram. */

import {
  computeSpectrogram, renderSpectrogram, colormaps, windows,
  frequencyTicks, timeTicks, formatHz, formatTime
} from './spectrogram.js';

let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function row(label, value) {
  return el('tr', {}, [
    el('th', {}, label),
    el('td', {}, value == null || value === '' ? '-' : String(value))
  ]);
}

// --- File header peek (sample rate, bit depth, codec hints) ---
async function peekContainer(file) {
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
function adtsToM4a(arrayBuffer) {
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

// --- Decode helpers ---
async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  // decodeAudioData mutates buffer in some browsers, so pass a copy
  const copy = buf.slice(0);
  return await ctx().decodeAudioData(copy);
}

function getMono(audioBuffer) {
  const n = audioBuffer.length;
  const out = new Float32Array(n);
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const k = 1 / audioBuffer.numberOfChannels;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

function computeStats(samples) {
  let peak = 0, sumSq = 0, clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSq += samples[i] * samples[i];
    if (a >= 0.999) clipped++;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  const peakDb = 20 * Math.log10(peak + 1e-12);
  const rmsDb  = 20 * Math.log10(rms  + 1e-12);
  return { peak, rms, peakDb, rmsDb, clipped };
}

function computeCentroid(samples, sampleRate) {
  const N = 4096;
  const frames = Math.floor(samples.length / N);
  if (frames === 0) return null;
  let totalCentroid = 0;
  for (let f = 0; f < frames; f++) {
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = samples[f * N + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    for (let s = 1; s < N; s <<= 1) {
      for (let k = 0; k < N; k += s << 1) {
        for (let j = 0; j < s; j++) {
          const a = -Math.PI * j / s;
          const wr = Math.cos(a), wi = Math.sin(a);
          const tr = re[k + j + s] * wr - im[k + j + s] * wi;
          const ti = re[k + j + s] * wi + im[k + j + s] * wr;
          re[k + j + s] = re[k + j] - tr; im[k + j + s] = im[k + j] - ti;
          re[k + j] += tr; im[k + j] += ti;
        }
      }
    }
    let num = 0, den = 0;
    for (let i = 0; i < N / 2; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      const freq = (i * sampleRate) / N;
      num += freq * mag;
      den += mag;
    }
    if (den > 0) totalCentroid += num / den;
  }
  return totalCentroid / frames;
}

// --- LUFS integrated loudness (K-weighted) ---
function computeLufs(samples, sampleRate) {
  // Apply K-weighting: Stage 1 - high shelf +4 dB at 1681 Hz
  // Stage 2 - high-pass at 38 Hz
  // Both implemented as biquad filters on the sample array

  function applyBiquad(x, b0, b1, b2, a1, a2) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      y[i] = yi;
      x2 = x1; x1 = xi;
      y2 = y1; y1 = yi;
    }
    return y;
  }

  // Stage 1: High shelf at 1681 Hz, +4 dB gain
  // Using RBJ cookbook high-shelf formula
  const shelfF0 = 1681.974450955533;
  const shelfG  = 3.999843853973347; // dB
  const shelfQ  = 0.7071752369554196;
  const A1  = Math.pow(10, shelfG / 40);
  const w1  = 2 * Math.PI * shelfF0 / sampleRate;
  const sin1 = Math.sin(w1), cos1 = Math.cos(w1);
  const alpha1 = sin1 / (2 * shelfQ);
  const a0_s = (A1 + 1) - (A1 - 1) * cos1 + 2 * Math.sqrt(A1) * alpha1;
  const hs_b0 = (A1 * ((A1 + 1) + (A1 - 1) * cos1 + 2 * Math.sqrt(A1) * alpha1)) / a0_s;
  const hs_b1 = (-2 * A1 * ((A1 - 1) + (A1 + 1) * cos1)) / a0_s;
  const hs_b2 = (A1 * ((A1 + 1) + (A1 - 1) * cos1 - 2 * Math.sqrt(A1) * alpha1)) / a0_s;
  const hs_a1 = (2 * ((A1 - 1) - (A1 + 1) * cos1)) / a0_s;
  const hs_a2 = ((A1 + 1) - (A1 - 1) * cos1 - 2 * Math.sqrt(A1) * alpha1) / a0_s;

  // Stage 2: High-pass at 38 Hz (Butterworth, Q = 0.5)
  const hpF0 = 38.13547087602444;
  const hpQ  = 0.5003270373238773;
  const w2  = 2 * Math.PI * hpF0 / sampleRate;
  const sin2 = Math.sin(w2), cos2 = Math.cos(w2);
  const alpha2 = sin2 / (2 * hpQ);
  const a0_h = 1 + alpha2;
  const hp_b0 = ((1 + cos2) / 2) / a0_h;
  const hp_b1 = (-(1 + cos2)) / a0_h;
  const hp_b2 = ((1 + cos2) / 2) / a0_h;
  const hp_a1 = (-2 * cos2) / a0_h;
  const hp_a2 = (1 - alpha2) / a0_h;

  // Apply filters
  const stage1 = applyBiquad(samples, hs_b0, hs_b1, hs_b2, hs_a1, hs_a2);
  const filtered = applyBiquad(stage1, hp_b0, hp_b1, hp_b2, hp_a1, hp_a2);

  // Mean square of filtered signal
  let sumSq = 0;
  for (let i = 0; i < filtered.length; i++) {
    sumSq += filtered[i] * filtered[i];
  }
  const meanSquare = sumSq / filtered.length;

  // Convert to LUFS
  const lufs = -0.691 + 10 * Math.log10(meanSquare + 1e-30);
  return lufs;
}

// --- Pitch detection (YIN autocorrelation) ---
function detectPitch(samples, sampleRate) {
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const W = 4096;
  const threshold = 0.15;

  // Take a window from the middle of the audio
  const mid = Math.floor(samples.length / 2);
  const start = Math.max(0, mid - Math.floor(W / 2));
  const end = Math.min(samples.length, start + W);
  const len = end - start;
  if (len < W / 2) return null;

  const buf = samples.subarray(start, end);
  const halfLen = Math.floor(len / 2);

  // Step 1: Difference function
  const d = new Float32Array(halfLen);
  for (let tau = 0; tau < halfLen; tau++) {
    let sum = 0;
    for (let j = 0; j < halfLen; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference function
  const dPrime = new Float32Array(halfLen);
  dPrime[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfLen; tau++) {
    runningSum += d[tau];
    dPrime[tau] = d[tau] * tau / runningSum;
  }

  // Step 3: Find the first minimum below threshold
  // Start from tau corresponding to ~20 Hz max period down to high freq
  const minTau = Math.max(2, Math.floor(sampleRate / 2000)); // up to 2000 Hz
  const maxTau = Math.min(halfLen - 1, Math.floor(sampleRate / 20)); // down to 20 Hz
  let bestTau = -1;

  for (let tau = minTau; tau < maxTau; tau++) {
    if (dPrime[tau] < threshold) {
      // Find the local minimum in this dip
      while (tau + 1 < maxTau && dPrime[tau + 1] < dPrime[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau < 0) return null;

  // Step 4: Parabolic interpolation for sub-sample accuracy
  let betterTau = bestTau;
  if (bestTau > 0 && bestTau < halfLen - 1) {
    const s0 = dPrime[bestTau - 1];
    const s1 = dPrime[bestTau];
    const s2 = dPrime[bestTau + 1];
    const shift = (s0 - s2) / (2 * (s0 - 2 * s1 + s2));
    if (Math.abs(shift) < 1) {
      betterTau = bestTau + shift;
    }
  }

  const frequency = sampleRate / betterTau;

  // Sanity check
  if (frequency < 20 || frequency > 5000 || !isFinite(frequency)) return null;

  // Convert to note name and cents
  const semitone = 12 * Math.log2(frequency / 440) + 69;
  const roundedSemitone = Math.round(semitone);
  const cents = Math.round((semitone - roundedSemitone) * 100);
  const noteIndex = ((roundedSemitone % 12) + 12) % 12;
  const octave = Math.floor(roundedSemitone / 12) - 1;
  const note = NOTE_NAMES[noteIndex] + octave;

  return { frequency, note, cents };
}

// --- BPM / Tempo detection (onset detection + autocorrelation) ---
function detectBPM(samples, sampleRate) {
  const N = 1024;                    // FFT window size
  const hop = N / 2;                 // 50 % overlap
  const halfN = N / 2;
  const numFrames = Math.floor((samples.length - N) / hop);
  if (numFrames < 4) return null;

  // Compute magnitude spectra for each frame
  const mags = [];
  for (let f = 0; f < numFrames; f++) {
    const off = f * hop;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    // Hann window + copy
    for (let i = 0; i < N; i++) {
      re[i] = samples[off + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    }
    // In-place radix-2 FFT (same pattern as computeCentroid)
    for (let s = 1; s < N; s <<= 1) {
      for (let k = 0; k < N; k += s << 1) {
        for (let j = 0; j < s; j++) {
          const a = -Math.PI * j / s;
          const wr = Math.cos(a), wi = Math.sin(a);
          const tr = re[k + j + s] * wr - im[k + j + s] * wi;
          const ti = re[k + j + s] * wi + im[k + j + s] * wr;
          re[k + j + s] = re[k + j] - tr;
          im[k + j + s] = im[k + j] - ti;
          re[k + j] += tr;
          im[k + j] += ti;
        }
      }
    }
    const mag = new Float32Array(halfN);
    for (let i = 0; i < halfN; i++) {
      mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    mags.push(mag);
  }

  // Spectral flux: sum of positive magnitude differences between consecutive frames
  const flux = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    let sum = 0;
    for (let i = 0; i < halfN; i++) {
      const diff = mags[f][i] - mags[f - 1][i];
      if (diff > 0) sum += diff;
    }
    flux[f] = sum;
  }

  // Adaptive peak picking: onset if flux > local mean * 1.5
  const medianW = 8;
  const onsets = new Float32Array(numFrames);
  for (let f = medianW; f < numFrames - medianW; f++) {
    let localMean = 0;
    for (let j = f - medianW; j <= f + medianW; j++) localMean += flux[j];
    localMean /= (2 * medianW + 1);
    onsets[f] = (flux[f] > localMean * 1.5 && flux[f] > 0) ? flux[f] : 0;
  }

  // Autocorrelation of the onset signal to find dominant period
  // Search between 60 and 200 BPM
  const framesPerSec = sampleRate / hop;
  const minLag = Math.floor(framesPerSec * 60 / 200); // 200 BPM
  const maxLag = Math.ceil(framesPerSec * 60 / 60);   // 60 BPM
  if (maxLag >= numFrames) return null;

  let bestLag = minLag;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag && lag < numFrames; lag++) {
    let corr = 0;
    const len = numFrames - lag;
    for (let i = 0; i < len; i++) {
      corr += onsets[i] * onsets[i + lag];
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Parabolic interpolation around the peak for sub-frame accuracy
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    let corrPrev = 0, corrNext = 0;
    const len = numFrames - bestLag;
    for (let i = 0; i < len; i++) {
      if (i + bestLag - 1 >= 0 && i + bestLag - 1 < numFrames)
        corrPrev += onsets[i] * onsets[i + bestLag - 1];
      if (i + bestLag + 1 < numFrames)
        corrNext += onsets[i] * onsets[i + bestLag + 1];
    }
    const denom = corrPrev - 2 * bestCorr + corrNext;
    if (Math.abs(denom) > 1e-12) {
      const shift = 0.5 * (corrPrev - corrNext) / denom;
      if (Math.abs(shift) < 1) refinedLag = bestLag + shift;
    }
  }

  const periodSec = refinedLag / framesPerSec;
  const bpm = 60 / periodSec;

  // Clamp to reasonable range
  if (bpm < 60 || bpm > 200 || !isFinite(bpm)) return null;
  return Math.round(bpm);
}

// --- Stereo analysis: phase correlation, width, vectorscope ---
function computeStereoStats(left, right) {
  let sumLR = 0, sumLL = 0, sumRR = 0;
  let sumMid = 0, sumSide = 0;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    sumLR += left[i] * right[i];
    sumLL += left[i] * left[i];
    sumRR += right[i] * right[i];
    const mid  = (left[i] + right[i]) * 0.5;
    const side = (left[i] - right[i]) * 0.5;
    sumMid  += mid * mid;
    sumSide += side * side;
  }
  const denom = Math.sqrt(sumLL * sumRR);
  const correlation = denom > 1e-12 ? sumLR / denom : 0;
  const width = 1 - Math.abs(correlation);
  const midLevel  = Math.sqrt(sumMid / n);
  const sideLevel = Math.sqrt(sumSide / n);
  return { correlation, width, midLevel, sideLevel };
}

function renderVectorscope(canvas, left, right) {
  const size = canvas.width;
  const ctxC = canvas.getContext('2d');
  ctxC.fillStyle = '#1a1a1a';
  ctxC.fillRect(0, 0, size, size);

  // Draw guides: centre cross + diagonal axes
  const cx = size / 2, cy = size / 2;
  ctxC.strokeStyle = '#333';
  ctxC.lineWidth = 1;
  // Horizontal and vertical (mono = vertical, hard-pan = horizontal after rotation)
  ctxC.beginPath();
  ctxC.moveTo(cx, 0); ctxC.lineTo(cx, size);
  ctxC.moveTo(0, cy); ctxC.lineTo(size, cy);
  ctxC.stroke();

  // Labels
  ctxC.fillStyle = '#666';
  ctxC.font = '10px monospace';
  ctxC.textAlign = 'center';
  ctxC.fillText('M', cx, 10);
  ctxC.fillText('S', size - 8, cy + 4);
  ctxC.fillText('L', cx - 6, 10);
  ctxC.textAlign = 'left';
  ctxC.fillText('R', cx + 3, 10);

  const n = Math.min(left.length, right.length);
  if (n === 0) return;

  // Downsample to max ~40k dots for performance
  const maxDots = 40000;
  const step = Math.max(1, Math.floor(n / maxDots));
  const scale = size * 0.42; // leave a small margin

  // Use ImageData for efficient semi-transparent dot rendering
  const imgData = ctxC.getImageData(0, 0, size, size);
  const data = imgData.data;

  for (let i = 0; i < n; i += step) {
    const l = left[i], r = right[i];
    // 45-degree rotation: mid on Y (vertical), side on X (horizontal)
    const mid  = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    const px = Math.round(cx + side * scale);
    const py = Math.round(cy - mid * scale);
    if (px < 0 || px >= size || py < 0 || py >= size) continue;
    const idx = (py * size + px) * 4;
    // Additive blending for density visualisation
    data[idx]     = Math.min(255, data[idx]     + 12);  // R
    data[idx + 1] = Math.min(255, data[idx + 1] + 28);  // G
    data[idx + 2] = Math.min(255, data[idx + 2] + 18);  // B
    data[idx + 3] = 255;
  }

  ctxC.putImageData(imgData, 0, 0);
  ctxC.strokeStyle = '#C8DCE8';
  ctxC.strokeRect(0, 0, size, size);
}

// --- Waveform render (downsampled min/max per pixel) ---
function renderWaveform(canvas, samples) {
  const ctxC = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctxC.fillStyle = '#1a1a1a';
  ctxC.fillRect(0, 0, w, h);
  ctxC.strokeStyle = '#445f74';
  ctxC.lineWidth = 1;
  ctxC.beginPath();
  ctxC.moveTo(0, h / 2);
  ctxC.lineTo(w, h / 2);
  ctxC.stroke();

  if (!samples.length) return;
  const samplesPerPx = samples.length / w;
  const clipRegions = [];
  for (let x = 0; x < w; x++) {
    const start = Math.floor(x * samplesPerPx);
    const end   = Math.floor((x + 1) * samplesPerPx);
    let mn = 1, mx = -1, clip = false;
    for (let i = start; i < end && i < samples.length; i++) {
      const v = samples[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      if (Math.abs(v) >= 0.999) clip = true;
    }
    const y1 = ((1 - mx) / 2) * h;
    const y2 = ((1 - mn) / 2) * h;
    const bh = Math.max(1, y2 - y1);
    if (clip) {
      clipRegions.push({ x, y: y1, h: bh });
      ctxC.fillStyle = '#444';
      ctxC.fillRect(x, y1, 1, bh);
    } else {
      ctxC.fillStyle = '#80a4ba';
      ctxC.fillRect(x, y1, 1, bh);
    }
  }
  if (clipRegions.length) {
    ctxC.save();
    ctxC.beginPath();
    for (const r of clipRegions) ctxC.rect(r.x, r.y, 1, r.h);
    ctxC.clip();
    const stripe = 6;
    ctxC.lineWidth = 2;
    for (let d = -h; d < w + h; d += stripe * 2) {
      ctxC.strokeStyle = '#fff';
      ctxC.beginPath(); ctxC.moveTo(d, 0); ctxC.lineTo(d + h, h); ctxC.stroke();
      ctxC.strokeStyle = '#222';
      ctxC.beginPath(); ctxC.moveTo(d + stripe, 0); ctxC.lineTo(d + stripe + h, h); ctxC.stroke();
    }
    ctxC.restore();
  }
  ctxC.strokeStyle = '#C8DCE8';
  ctxC.strokeRect(0, 0, w, h);
}

function buildFreqAxis(axisEl, sampleRate, scale) {
  axisEl.innerHTML = '';
  const minHz = scale === 'log' ? 20 : 0;
  const maxHz = sampleRate / 2;
  const ticks = frequencyTicks(minHz, maxHz, scale);

  for (const hz of ticks) {
    let frac;
    if (scale === 'log') {
      const lo = Math.log10(minHz);
      const hi = Math.log10(maxHz);
      frac = (Math.log10(hz) - lo) / (hi - lo);
    } else {
      frac = (hz - minHz) / (maxHz - minHz);
    }
    const span = el('span', {}, formatHz(hz));
    span.style.top = ((1 - frac) * 100) + '%';
    axisEl.appendChild(span);
  }
}

function buildTimeAxis(axisEl, durationSec) {
  axisEl.innerHTML = '';
  const ticks = timeTicks(durationSec);
  for (const t of ticks) {
    const span = el('span', {}, formatTime(t));
    span.style.left = ((t / durationSec) * 100) + '%';
    axisEl.appendChild(span);
  }
}

// --- Spectrogram UI panel (shared for file + recording) ---
export function makeSpectrogramPanel(samples, sampleRate, opts = {}) {
  const card = el('div', { class: 'anr-card anr-spec-card' });
  card.appendChild(el('h3', {}, 'Spectrogram'));

  // --- controls ---
  const controls = el('div', { class: 'anr-controls' });
  const toggle = el('div', { class: 'anr-toggle' });
  const btnLog = el('button', { type: 'button', class: 'is-active' }, 'LOG');
  const btnLin = el('button', { type: 'button' }, 'LINEAR');
  toggle.appendChild(btnLog); toggle.appendChild(btnLin);

  const fftSel  = el('select', {}, ['256','512','1024','2048','4096','8192'].map((v) => el('option', { value: v }, v)));
  fftSel.value = '2048';
  const winSel  = el('select', {}, ['hann','hamming','blackman','rect'].map((v) => el('option', { value: v }, v)));
  const cmapSel = el('select', {}, Object.keys(colormaps).map((v) => el('option', { value: v }, v)));
  const zoomSel = el('select', {}, ['1','1.5','2','3','4','6','8','12','16'].map((v) => el('option', { value: v }, v + 'x')));
  zoomSel.value = '1';
  const heightSel = el('select', {}, ['240','320','420','560','720','900'].map((v) => el('option', { value: v }, v + 'px')));
  heightSel.value = '420';

  const saveBtn = el('button', { type: 'button', class: 'anr-fs-btn' }, 'Save PNG');
  const fsBtn   = el('button', { type: 'button', class: 'anr-fs-btn' }, 'Fullscreen');

  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Axis'),   toggle]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'FFT'),    fftSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Window'), winSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Colour'), cmapSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Zoom'),   zoomSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Height'), heightSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [saveBtn]));
  controls.appendChild(el('div', { class: 'anr-control' }, [fsBtn]));
  card.appendChild(controls);

  // --- spectrogram body ---
  const wrap     = el('div', { class: 'anr-spec-wrap' });
  const yWrap    = el('div', { class: 'anr-spec-yaxis-wrap' });
  const axisY    = el('div', { class: 'anr-spec-yaxis' });
  const corner   = el('div', { class: 'anr-spec-corner' });
  yWrap.appendChild(axisY); yWrap.appendChild(corner);

  const scrollEl = el('div', { class: 'anr-spec-scroll' });
  const canvas   = el('canvas', { class: 'anr-spec-canvas' });
  const axisX    = el('div', { class: 'anr-spec-xaxis' });
  scrollEl.appendChild(canvas); scrollEl.appendChild(axisX);

  wrap.appendChild(yWrap); wrap.appendChild(scrollEl);
  card.appendChild(wrap);

  const status = el('p', { class: 'anr-hint anr-spec-hint', style: 'margin: 6px 0 0; text-align: right;' }, 'computing...');
  card.appendChild(status);

  let state = {
    scale: 'log', cmap: 'viridis', fftSize: 2048, winName: 'hann',
    zoom: 1, height: 420
  };
  let cached = null;

  function isFs() { return document.fullscreenElement === card; }
  function availableWidth() {
    const total = wrap.clientWidth || 600;
    return Math.max(200, total - 44 - 4);
  }
  function availableHeight() {
    return Math.max(160, (wrap.clientHeight || state.height + 22) - 22);
  }
  function sizeCanvas() {
    const baseW = availableWidth();
    const w = Math.max(200, Math.round(baseW * state.zoom));
    const h = isFs() ? availableHeight() : state.height;
    canvas.width  = w;
    canvas.height = h;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    axisX.style.width   = w + 'px';
  }

  function recompute() {
    const t0 = performance.now();
    if (!cached || cached.fftSize !== state.fftSize || cached.winName !== state.winName) {
      const spec = computeSpectrogram(samples, sampleRate, {
        fftSize: state.fftSize,
        hopSize: Math.floor(state.fftSize / 4),
        window:  state.winName
      });
      cached = { fftSize: state.fftSize, winName: state.winName, spec };
    }
    sizeCanvas();
    renderSpectrogram(canvas, cached.spec, { scale: state.scale, colormap: state.cmap });
    const duration = samples.length / sampleRate;
    buildFreqAxis(axisY, sampleRate, state.scale);
    buildTimeAxis(axisX, duration);
    const ms = (performance.now() - t0).toFixed(0);
    status.textContent = `${cached.spec.frames} frames × ${cached.spec.bins} bins | ${canvas.width}×${canvas.height} px | ${ms} ms`;
  }

  btnLog.addEventListener('click', () => {
    state.scale = 'log';
    btnLog.classList.add('is-active'); btnLin.classList.remove('is-active');
    recompute();
  });
  btnLin.addEventListener('click', () => {
    state.scale = 'linear';
    btnLin.classList.add('is-active'); btnLog.classList.remove('is-active');
    recompute();
  });
  fftSel.addEventListener('change',    () => { state.fftSize = parseInt(fftSel.value, 10); recompute(); });
  winSel.addEventListener('change',    () => { state.winName = winSel.value; recompute(); });
  cmapSel.addEventListener('change',   () => { state.cmap    = cmapSel.value; recompute(); });
  zoomSel.addEventListener('change',   () => { state.zoom    = parseFloat(zoomSel.value); recompute(); });
  heightSel.addEventListener('change', () => { state.height  = parseInt(heightSel.value, 10); recompute(); });

  saveBtn.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: (opts.basename || 'spectrogram') + '.png' });
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    }, 'image/png');
  });

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (card.requestFullscreen || card.webkitRequestFullscreen).call(card);
    }
  });
  function onFsChange() {
    fsBtn.textContent = isFs() ? 'Exit fullscreen' : 'Fullscreen';
    requestAnimationFrame(recompute);
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  let resizeRaf;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const newW = Math.max(200, Math.round(availableWidth() * state.zoom));
      if (Math.abs(newW - canvas.width) > 2 || isFs()) recompute();
    });
  });

  // Defer until in DOM so clientWidth is real
  setTimeout(recompute, 0);
  setTimeout(recompute, 80);

  return card;
}

// --- Render uploaded / recorded audio results ---
export async function renderAudio(file, resultsEl, opts = {}) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { class: 'anr-info' }, `Decoding "${file.name}"...`));
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let header = {};
  try { header = await peekContainer(file); } catch (e) { /* ignore */ }

  let playbackFile = file;
  let audioBuffer;

  if (header.container === 'AAC') {
    try {
      const wrapped = adtsToM4a(await file.arrayBuffer());
      if (wrapped) {
        playbackFile = new File([wrapped], file.name.replace(/\.[^.]+$/, '.m4a'), { type: 'audio/mp4' });
        audioBuffer = await ctx().decodeAudioData(wrapped.slice(0));
      }
    } catch (_) {}
  }

  if (!audioBuffer) {
    try {
      audioBuffer = await decodeFile(file);
    } catch (e) {
      resultsEl.innerHTML = '';
      resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Could not decode this file. Format may not be supported by your browser.'));
      return;
    }
  }

  resultsEl.innerHTML = '';

  const mono = getMono(audioBuffer);
  const stats = computeStats(mono);

  // ---- File info card ----
  const infoCard = el('div', { class: 'anr-card' });
  infoCard.appendChild(el('h3', {}, 'File info'));
  const audioEl = el('audio', { controls: '', src: URL.createObjectURL(playbackFile), style: 'width:100%; margin-bottom:8px;' });
  infoCard.appendChild(audioEl);

  const tbl = el('table', { class: 'anr-readout' });
  tbl.appendChild(row('Name',           file.name));
  tbl.appendChild(row('Size',           fmtBytes(file.size)));
  tbl.appendChild(row('MIME',           file.type || header.container || '-'));
  if (header.container) tbl.appendChild(row('Container',     header.container));
  if (header.codec)     tbl.appendChild(row('Codec',         header.codec));
  tbl.appendChild(row('Duration',       formatTime(audioBuffer.duration)));
  tbl.appendChild(row('Sample rate',    audioBuffer.sampleRate.toLocaleString() + ' Hz'));
  tbl.appendChild(row('Channels',       audioBuffer.numberOfChannels));
  if (header.bitDepth)  tbl.appendChild(row('Bit depth',     header.bitDepth + ' bit'));
  if (header.bitrate)   tbl.appendChild(row('Bitrate',       (header.bitrate / 1000).toFixed(0) + ' kbps'));
  tbl.appendChild(row('Peak',           stats.peak.toFixed(3) + '  (' + stats.peakDb.toFixed(1) + ' dBFS)'));
  tbl.appendChild(row('RMS',            stats.rms.toFixed(3)  + '  (' + stats.rmsDb.toFixed(1)  + ' dBFS)'));
  const lufsValue = computeLufs(mono, audioBuffer.sampleRate);
  tbl.appendChild(row('Loudness',       (isFinite(lufsValue) ? lufsValue.toFixed(1) + ' LUFS' : '-')));
  if (stats.clipped > 0) {
    const pct = ((stats.clipped / mono.length) * 100).toFixed(3);
    tbl.appendChild(row('Clipping', stats.clipped.toLocaleString() + ' samples  (' + pct + '%)'));
  } else {
    tbl.appendChild(row('Clipping', 'None'));
  }
  const centroid = computeCentroid(mono, audioBuffer.sampleRate);
  if (centroid != null) {
    const label = centroid < 1500 ? 'warm' : centroid < 4000 ? 'neutral' : 'bright';
    tbl.appendChild(row('Spectral centroid', Math.round(centroid).toLocaleString() + ' Hz  (' + label + ')'));
  }
  const pitchResult = detectPitch(mono, audioBuffer.sampleRate);
  if (pitchResult) {
    const centsStr = pitchResult.cents >= 0 ? '+' + pitchResult.cents : String(pitchResult.cents);
    tbl.appendChild(row('Pitch', pitchResult.note + '  (' + pitchResult.frequency.toFixed(1) + ' Hz, ' + centsStr + ' cents)'));
  } else {
    tbl.appendChild(row('Pitch', 'N/A'));
  }
  const bpm = detectBPM(mono, audioBuffer.sampleRate);
  tbl.appendChild(row('BPM', bpm != null ? bpm + ' BPM' : 'N/A'));
  tbl.appendChild(row('Total samples',  mono.length.toLocaleString()));
  infoCard.appendChild(tbl);
  resultsEl.appendChild(infoCard);

  // ---- Waveform card ----
  const waveCard = el('div', { class: 'anr-card' });
  waveCard.appendChild(el('h3', {}, 'Waveform'));
  const waveCanvas = el('canvas', { class: 'anr-waveform' });
  waveCanvas.width = 1024; waveCanvas.height = 80;
  waveCard.appendChild(waveCanvas);
  renderWaveform(waveCanvas, mono);

  // --- Interactive waveform: region selection, zoom, WAV export ---
  let selStart = null, selEnd = null;
  let isSelecting = false;
  let zoomStart = 0, zoomEnd = mono.length;

  // Overlay canvas for selection highlight
  const overlayCanvas = el('canvas', { class: 'anr-waveform', style: 'position:absolute; top:0; left:0; pointer-events:none;' });
  overlayCanvas.width = waveCanvas.width;
  overlayCanvas.height = waveCanvas.height;

  // Wrap the waveform canvas in a relative container
  const waveWrap = el('div', { style: 'position:relative; display:inline-block; width:100%;' });
  waveWrap.appendChild(waveCanvas);
  waveWrap.appendChild(overlayCanvas);
  // Replace the canvas in the card with the wrapper
  waveCard.replaceChild(waveWrap, waveCard.querySelector('.anr-waveform'));

  // Selection info + buttons container (shown when selection exists)
  const selInfo = el('div', { class: 'anr-controls', style: 'display:none; flex-wrap:wrap; gap:8px; margin-top:6px; align-items:center;' });
  const selLabel = el('span', { style: 'font-size:0.85em; opacity:0.8;' }, '');
  const zoomBtn = el('button', { type: 'button', class: 'anr-btn', style: 'font-size:0.82em; padding:3px 10px;' }, 'Zoom');
  const resetZoomBtn = el('button', { type: 'button', class: 'anr-btn', style: 'font-size:0.82em; padding:3px 10px; display:none;' }, 'Reset zoom');
  const exportBtn = el('button', { type: 'button', class: 'anr-btn', style: 'font-size:0.82em; padding:3px 10px;' }, 'Export WAV');
  selInfo.appendChild(selLabel);
  selInfo.appendChild(zoomBtn);
  selInfo.appendChild(resetZoomBtn);
  selInfo.appendChild(exportBtn);
  waveCard.appendChild(selInfo);

  function drawOverlay() {
    const octx = overlayCanvas.getContext('2d');
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (selStart == null || selEnd == null) return;
    const visLen = zoomEnd - zoomStart;
    const x1 = ((Math.min(selStart, selEnd) - zoomStart) / visLen) * overlayCanvas.width;
    const x2 = ((Math.max(selStart, selEnd) - zoomStart) / visLen) * overlayCanvas.width;
    octx.fillStyle = 'rgba(100, 180, 255, 0.3)';
    octx.fillRect(x1, 0, x2 - x1, overlayCanvas.height);
    octx.strokeStyle = 'rgba(100, 180, 255, 0.7)';
    octx.lineWidth = 1;
    octx.strokeRect(x1, 0, x2 - x1, overlayCanvas.height);
  }

  function updateSelInfo() {
    if (selStart == null || selEnd == null || selStart === selEnd) {
      selInfo.style.display = 'none';
      return;
    }
    selInfo.style.display = 'flex';
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    const selSamples = mono.subarray(s, e);
    const dur = (e - s) / audioBuffer.sampleRate;
    const selStats = computeStats(selSamples);
    selLabel.textContent = 'Selection: ' + dur.toFixed(3) + ' s, '
      + (e - s).toLocaleString() + ' samples | Peak: '
      + selStats.peak.toFixed(3) + ' (' + selStats.peakDb.toFixed(1) + ' dBFS) | RMS: '
      + selStats.rms.toFixed(3) + ' (' + selStats.rmsDb.toFixed(1) + ' dBFS)';
  }

  function xToSample(x) {
    const rect = waveCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    const visLen = zoomEnd - zoomStart;
    return Math.round(zoomStart + frac * visLen);
  }

  waveCanvas.style.cursor = 'crosshair';
  waveCanvas.addEventListener('mousedown', (e) => {
    isSelecting = true;
    selStart = xToSample(e.clientX);
    selEnd = selStart;
    drawOverlay();
    updateSelInfo();
    e.preventDefault();
  });

  waveCanvas.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    selEnd = xToSample(e.clientX);
    drawOverlay();
  });

  window.addEventListener('mouseup', () => {
    if (!isSelecting) return;
    isSelecting = false;
    if (selStart != null && selEnd != null && selStart !== selEnd) {
      // Normalize order
      if (selStart > selEnd) { const tmp = selStart; selStart = selEnd; selEnd = tmp; }
      updateSelInfo();
    }
    drawOverlay();
  });

  function redrawWaveform() {
    const visibleSamples = mono.subarray(zoomStart, zoomEnd);
    renderWaveform(waveCanvas, visibleSamples);
    overlayCanvas.width = waveCanvas.width;
    overlayCanvas.height = waveCanvas.height;
    drawOverlay();
  }

  zoomBtn.addEventListener('click', () => {
    if (selStart == null || selEnd == null || selStart === selEnd) return;
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    zoomStart = s;
    zoomEnd = e;
    selStart = null;
    selEnd = null;
    redrawWaveform();
    updateSelInfo();
    resetZoomBtn.style.display = '';
  });

  resetZoomBtn.addEventListener('click', () => {
    zoomStart = 0;
    zoomEnd = mono.length;
    selStart = null;
    selEnd = null;
    redrawWaveform();
    updateSelInfo();
    resetZoomBtn.style.display = 'none';
  });

  exportBtn.addEventListener('click', () => {
    if (selStart == null || selEnd == null || selStart === selEnd) return;
    const s = Math.min(selStart, selEnd);
    const e = Math.max(selStart, selEnd);
    const selSamples = mono.subarray(s, e);
    const numSamples = selSamples.length;
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = audioBuffer.sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const bufferSize = 44 + dataSize;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // RIFF header
    let offset = 0;
    const writeStr = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)); };
    writeStr('RIFF');
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeStr('WAVE');

    // fmt chunk
    writeStr('fmt ');
    view.setUint32(offset, 16, true); offset += 4;          // chunk size
    view.setUint16(offset, 1, true); offset += 2;           // PCM format
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, audioBuffer.sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitsPerSample, true); offset += 2;

    // data chunk
    writeStr('data');
    view.setUint32(offset, dataSize, true); offset += 4;

    // Convert Float32 to Int16
    for (let i = 0; i < numSamples; i++) {
      let sample = selSamples[i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: (file.name || 'selection').replace(/\.[^.]+$/, '') + '_selection.wav' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  });

  resultsEl.appendChild(waveCard);

  // ---- Spectrogram ----
  const basename = (file.name || 'spectrogram').replace(/\.[^/.]+$/, '');
  resultsEl.appendChild(makeSpectrogramPanel(mono, audioBuffer.sampleRate, { basename }));

  // ---- Stereo Width / Vectorscope card (stereo files only) ----
  if (audioBuffer.numberOfChannels >= 2) {
    const left  = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const stereo = computeStereoStats(left, right);

    const stereoCard = el('div', { class: 'anr-card' });
    stereoCard.appendChild(el('h3', {}, 'Stereo analysis'));

    const stereoTbl = el('table', { class: 'anr-readout' });
    const corrPct  = (stereo.correlation * 100).toFixed(1);
    const corrHint = stereo.correlation > 0.8 ? 'mono-like'
                   : stereo.correlation < -0.2 ? 'out of phase'
                   : stereo.correlation < 0.3 ? 'wide' : 'normal';
    stereoTbl.appendChild(row('Phase correlation', stereo.correlation.toFixed(3) + '  (' + corrPct + '%, ' + corrHint + ')'));
    stereoTbl.appendChild(row('Stereo width',      stereo.width.toFixed(3)));
    stereoTbl.appendChild(row('Mid level',         stereo.midLevel.toFixed(4)));
    stereoTbl.appendChild(row('Side level',        stereo.sideLevel.toFixed(4)));
    const msRatio = stereo.midLevel > 1e-12
      ? (stereo.sideLevel / stereo.midLevel).toFixed(3)
      : '-';
    stereoTbl.appendChild(row('Side / Mid ratio',  msRatio));
    stereoCard.appendChild(stereoTbl);

    // Vectorscope canvas
    const vsCanvas = el('canvas', { width: '200', height: '200', style: 'display:block; margin:8px auto 0;' });
    stereoCard.appendChild(vsCanvas);
    renderVectorscope(vsCanvas, left, right);

    resultsEl.appendChild(stereoCard);
  }
}

// --- Recording UI ---
async function startRecording(resultsEl, recordBtn) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Microphone access denied or unavailable.'));
    return;
  }

  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const liveCard = el('div', { class: 'anr-card' });
  liveCard.appendChild(el('h3', {}, 'Recording...'));
  const timer = el('p', { class: 'anr-hint' }, '0.0 s');
  const stopBtn = el('button', { type: 'button', class: 'anr-btn' }, 'Stop');
  liveCard.appendChild(timer);
  liveCard.appendChild(stopBtn);
  resultsEl.appendChild(liveCard);

  const startMs = performance.now();
  const tick = setInterval(() => {
    timer.textContent = ((performance.now() - startMs) / 1000).toFixed(1) + ' s';
  }, 100);

  rec.start();
  recordBtn.classList.add('is-recording');

  return new Promise((resolve) => {
    function finish() {
      clearInterval(tick);
      recordBtn.classList.remove('is-recording');
      stream.getTracks().forEach((t) => t.stop());
    }
    rec.onstop = async () => {
      finish();
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      const ext = (mime.match(/audio\/(\w+)/) || [, 'webm'])[1];
      const file = new File([blob], 'recording.' + ext, { type: blob.type });
      await renderAudio(file, resultsEl);
      resolve(file);
    };
    stopBtn.addEventListener('click', () => rec.stop());
  });
}

// --- Live spectrogram (no recording, just visualise the mic) ---
async function startLive(resultsEl, liveBtn) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('div', { class: 'anr-error' }, 'Microphone access denied or unavailable.'));
    return;
  }

  const ac = ctx();
  await ac.resume();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);

  resultsEl.hidden = false;
  resultsEl.innerHTML = '';
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // --- card / controls ---
  const card = el('div', { class: 'anr-card anr-spec-card' });
  card.appendChild(el('h3', {}, 'Live spectrogram'));

  const controls = el('div', { class: 'anr-controls' });
  const toggle = el('div', { class: 'anr-toggle' });
  const btnLog = el('button', { type: 'button', class: 'is-active' }, 'LOG');
  const btnLin = el('button', { type: 'button' }, 'LINEAR');
  toggle.appendChild(btnLog); toggle.appendChild(btnLin);

  const fftSel    = el('select', {}, ['512','1024','2048','4096','8192'].map((v) => el('option', { value: v }, v)));
  fftSel.value = '2048';
  const cmapSel   = el('select', {}, Object.keys(colormaps).map((v) => el('option', { value: v }, v)));
  const heightSel = el('select', {}, ['240','320','420','560','720','900'].map((v) => el('option', { value: v }, v + 'px')));
  heightSel.value = '420';
  const fsBtn     = el('button', { type: 'button', class: 'anr-fs-btn' }, 'Fullscreen');
  const stopBtn   = el('button', { type: 'button', class: 'anr-btn' }, 'Stop');

  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Axis'),   toggle]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'FFT'),    fftSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Colour'), cmapSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [el('label', {}, 'Height'), heightSel]));
  controls.appendChild(el('div', { class: 'anr-control' }, [fsBtn]));
  controls.appendChild(el('div', { class: 'anr-control' }, [stopBtn]));
  card.appendChild(controls);

  // --- body (yaxis + scroll/canvas), no x-axis (no fixed time in live mode) ---
  const wrap     = el('div', { class: 'anr-spec-wrap' });
  const yWrap    = el('div', { class: 'anr-spec-yaxis-wrap' });
  const axisY    = el('div', { class: 'anr-spec-yaxis' });
  yWrap.appendChild(axisY);
  const scrollEl = el('div', { class: 'anr-spec-scroll' });
  const canvas   = el('canvas', { class: 'anr-spec-canvas' });
  scrollEl.appendChild(canvas);
  wrap.appendChild(yWrap); wrap.appendChild(scrollEl);
  card.appendChild(wrap);
  resultsEl.appendChild(card);

  let state = { scale: 'log', cmap: 'viridis', height: 420 };

  function isFs() { return document.fullscreenElement === card; }
  function availableWidth()  { return Math.max(200, (wrap.clientWidth || 600) - 48); }
  function availableHeight() { return Math.max(160, (wrap.clientHeight || state.height) - 2); }

  const ctxC = canvas.getContext('2d');

  // Resizing the canvas wipes its bitmap, which would lose the streaming
  // history in live mode. `preserve` snapshots the old contents into a temp
  // canvas, then redraws the rightmost slice (most recent audio) anchored
  // to the right edge of the new size — so the stream visually continues
  // instead of restarting from black.
  function sizeCanvas(preserve = true) {
    const newW = availableWidth();
    const newH = isFs() ? availableHeight() : state.height;
    if (newW === canvas.width && newH === canvas.height) return;

    if (preserve && canvas.width && canvas.height) {
      // Copy old content into a temp canvas, then redraw scaled-or-cropped
      const tmp = document.createElement('canvas');
      tmp.width  = canvas.width;
      tmp.height = canvas.height;
      tmp.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width  = newW;
      canvas.height = newH;
      canvas.style.width  = newW + 'px';
      canvas.style.height = newH + 'px';
      ctxC.fillStyle = '#0a0a0a';
      ctxC.fillRect(0, 0, newW, newH);
      // Keep the rightmost portion at the right edge (visual continuity)
      const drawW = Math.min(tmp.width, newW);
      const drawH = Math.min(tmp.height, newH);
      ctxC.drawImage(tmp,
        tmp.width - drawW, tmp.height - drawH, drawW, drawH,
        newW - drawW,      newH - drawH,      drawW, drawH);
    } else {
      canvas.width  = newW;
      canvas.height = newH;
      canvas.style.width  = newW + 'px';
      canvas.style.height = newH + 'px';
      ctxC.fillStyle = '#0a0a0a';
      ctxC.fillRect(0, 0, newW, newH);
    }
  }

  function rebuildAxis() { buildFreqAxis(axisY, ac.sampleRate, state.scale); }

  sizeCanvas(false);
  rebuildAxis();

  btnLog.addEventListener('click', () => { state.scale = 'log';    btnLog.classList.add('is-active'); btnLin.classList.remove('is-active'); rebuildAxis(); });
  btnLin.addEventListener('click', () => { state.scale = 'linear'; btnLin.classList.add('is-active'); btnLog.classList.remove('is-active'); rebuildAxis(); });
  fftSel.addEventListener('change',    () => { analyser.fftSize = parseInt(fftSel.value, 10); });
  cmapSel.addEventListener('change',   () => { state.cmap = cmapSel.value; });
  heightSel.addEventListener('change', () => { state.height = parseInt(heightSel.value, 10); sizeCanvas(); });

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (card.requestFullscreen || card.webkitRequestFullscreen).call(card);
    }
  });
  function onFsChange() {
    fsBtn.textContent = isFs() ? 'Exit fullscreen' : 'Fullscreen';
    requestAnimationFrame(() => sizeCanvas());
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  let liveRaf;
  function onWinResize() {
    cancelAnimationFrame(liveRaf);
    liveRaf = requestAnimationFrame(() => sizeCanvas());
  }
  window.addEventListener('resize', onWinResize);

  let dbData = new Float32Array(analyser.frequencyBinCount);
  const colW = 2;
  let stopped = false;
  liveBtn.classList.add('is-active');

  function tick() {
    if (stopped) return;
    const bins = analyser.frequencyBinCount;
    if (dbData.length !== bins) dbData = new Float32Array(bins);
    analyser.getFloatFrequencyData(dbData);

    const w = canvas.width, h = canvas.height;
    if (w <= colW || h <= 0) return requestAnimationFrame(tick);

    const img = ctxC.getImageData(colW, 0, w - colW, h);
    ctxC.putImageData(img, 0, 0);
    ctxC.fillStyle = '#0a0a0a';
    ctxC.fillRect(w - colW, 0, colW, h);

    const cmap = colormaps[state.cmap] || colormaps.viridis;
    const nyq = ac.sampleRate / 2;
    const dbFloor = -100, dbCeil = -10;
    const range = dbCeil - dbFloor;
    const colImg = ctxC.createImageData(colW, h);

    for (let y = 0; y < h; y++) {
      let binF;
      if (state.scale === 'log') {
        const logMin = Math.log10(20);
        const logMax = Math.log10(nyq);
        const frac = 1 - y / (h - 1);
        const hz = Math.pow(10, logMin + frac * (logMax - logMin));
        binF = (hz / nyq) * bins;
      } else {
        const frac = 1 - y / (h - 1);
        binF = frac * bins;
      }
      const b0 = Math.max(0, Math.min(bins - 1, Math.floor(binF)));
      const b1 = Math.max(0, Math.min(bins - 1, b0 + 1));
      const k  = binF - b0;
      const db = dbData[b0] + (dbData[b1] - dbData[b0]) * k;
      let t = (db - dbFloor) / range;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const [r, g, bl] = cmap(t);
      for (let x = 0; x < colW; x++) {
        const o = (y * colW + x) * 4;
        colImg.data[o]     = r;
        colImg.data[o + 1] = g;
        colImg.data[o + 2] = bl;
        colImg.data[o + 3] = 255;
      }
    }
    ctxC.putImageData(colImg, w - colW, 0);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  stopBtn.addEventListener('click', () => {
    stopped = true;
    liveBtn.classList.remove('is-active');
    stream.getTracks().forEach((t) => t.stop());
    try { src.disconnect(); } catch (_) {}
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    window.removeEventListener('resize', onWinResize);
  });
}

// --- Setup ---
export function initAudio({ dropEl, inputEl, recordBtn, liveBtn, resultsEl, onFile }) {
  const handle = onFile || ((file) => renderAudio(file, resultsEl));

  inputEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handle(file);
    inputEl.value = '';
  });

  // Visual highlight only; the actual drop is handled at the window level
  ['dragenter', 'dragover'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.add('is-dragover'))
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.remove('is-dragover'))
  );

  recordBtn.addEventListener('click', () => {
    if (recordBtn.classList.contains('is-recording')) return;
    startRecording(resultsEl, recordBtn);
  });

  liveBtn.addEventListener('click', () => {
    if (liveBtn.classList.contains('is-active')) return;
    startLive(resultsEl, liveBtn);
  });
}
