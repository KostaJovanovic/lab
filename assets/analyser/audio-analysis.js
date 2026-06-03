/* Analyser - audio analysis
   Pure-computation routines over decoded sample buffers: level stats,
   spectral centroid, LUFS loudness, pitch (YIN), tempo, and stereo metrics.
   No DOM, no Web Audio - just arrays in, numbers out. */

export function computeStats(samples) {
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

export function computeCentroid(samples, sampleRate) {
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
export function computeLufs(samples, sampleRate) {
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
export function detectPitch(samples, sampleRate) {
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
export function detectBPM(samples, sampleRate) {
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
export function computeStereoStats(left, right) {
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
