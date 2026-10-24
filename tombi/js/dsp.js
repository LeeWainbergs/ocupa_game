/* dsp.js — עיבוד אות מקומי: FFT, גובה צליל, MFCC ו-DTW.
   שום דבר כאן לא שומר הקלטה: מחשבים מאפיינים ומשליכים את האודיו. */
window.T = window.T || {};

T.dsp = (() => {
  // ---------- FFT (radix-2, in place) ----------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // ---------- Pitch (normalized autocorrelation) ----------
  // Returns Hz, or 0 when the frame is not clearly periodic.
  function pitch(buf, sr, minHz = 80, maxHz = 650) {
    const n = buf.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += buf[i];
    mean /= n;
    const x = new Float32Array(n);
    let e0 = 0;
    for (let i = 0; i < n; i++) { x[i] = buf[i] - mean; e0 += x[i] * x[i]; }
    if (e0 < 1e-7) return 0;
    const minLag = Math.floor(sr / maxHz), maxLag = Math.min(n - 2, Math.ceil(sr / minHz));
    let best = 0, bestLag = 0;
    const corr = new Float32Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0, e1 = 0, e2 = 0;
      for (let i = 0; i + lag < n; i++) {
        s += x[i] * x[i + lag];
        e1 += x[i] * x[i];
        e2 += x[i + lag] * x[i + lag];
      }
      const c = s / Math.sqrt(e1 * e2 + 1e-12);
      corr[lag] = c;
      if (c > best) { best = c; bestLag = lag; }
    }
    if (best < 0.55 || bestLag === 0) return 0;
    // prefer the shortest lag that is almost as good (avoids octave errors)
    for (let lag = minLag; lag < bestLag; lag++) {
      if (corr[lag] > best * 0.9 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) { bestLag = lag; break; }
    }
    // parabolic interpolation
    const a = corr[bestLag - 1] || 0, b = corr[bestLag], c = corr[bestLag + 1] || 0;
    const d = (a - c) / (2 * (a - 2 * b + c) || 1);
    return sr / (bestLag + (isFinite(d) ? d : 0));
  }

  // ---------- MFCC ----------
  const SR = 16000, WIN = 400, HOP = 160, NFFT = 512, NMEL = 26, NCEP = 13;
  const hz2mel = (h) => 2595 * Math.log10(1 + h / 700);
  const mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);
  const hamming = Float32Array.from({ length: WIN }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
  const melBank = (() => {
    const lo = hz2mel(100), hi = hz2mel(7000);
    const pts = Array.from({ length: NMEL + 2 }, (_, i) => mel2hz(lo + ((hi - lo) * i) / (NMEL + 1)));
    const bins = pts.map((h) => Math.floor(((NFFT + 1) * h) / SR));
    const bank = [];
    for (let m = 1; m <= NMEL; m++) {
      const f = new Float32Array(NFFT / 2 + 1);
      for (let k = bins[m - 1]; k < bins[m]; k++) f[k] = (k - bins[m - 1]) / (bins[m] - bins[m - 1] || 1);
      for (let k = bins[m]; k < bins[m + 1]; k++) f[k] = (bins[m + 1] - k) / (bins[m + 1] - bins[m] || 1);
      bank.push(f);
    }
    return bank;
  })();

  // 16 kHz mono -> array of 12-dim vectors (c1..c12), mean-normalized per utterance
  function mfcc(sig) {
    const frames = [];
    const re = new Float32Array(NFFT), im = new Float32Array(NFFT);
    for (let start = 0; start + WIN <= sig.length; start += HOP) {
      re.fill(0); im.fill(0);
      let prev = start > 0 ? sig[start - 1] : 0;
      for (let i = 0; i < WIN; i++) {
        const s = sig[start + i];
        re[i] = (s - 0.97 * prev) * hamming[i]; // pre-emphasis
        prev = s;
      }
      fft(re, im);
      const pow = new Float32Array(NFFT / 2 + 1);
      for (let k = 0; k <= NFFT / 2; k++) pow[k] = re[k] * re[k] + im[k] * im[k];
      const logMel = new Float32Array(NMEL);
      for (let m = 0; m < NMEL; m++) {
        let s = 0;
        const f = melBank[m];
        for (let k = 0; k < f.length; k++) if (f[k]) s += f[k] * pow[k];
        logMel[m] = Math.log(s + 1e-10);
      }
      const c = [];
      for (let n = 1; n < NCEP; n++) {
        let s = 0;
        for (let m = 0; m < NMEL; m++) s += logMel[m] * Math.cos((Math.PI * n * (m + 0.5)) / NMEL);
        c.push(s);
      }
      frames.push(c);
    }
    if (!frames.length) return frames;
    const mean = new Array(NCEP - 1).fill(0);
    frames.forEach((f) => f.forEach((v, i) => (mean[i] += v / frames.length)));
    return frames.map((f) => f.map((v, i) => Math.round((v - mean[i]) * 100) / 100));
  }

  // Dynamic time warping, normalized by path length
  function dtw(a, b) {
    const n = a.length, m = b.length;
    if (!n || !m) return Infinity;
    const band = Math.max(Math.abs(n - m) + 5, Math.floor(Math.max(n, m) * 0.4));
    let prev = new Float64Array(m + 1).fill(Infinity);
    let prevLen = new Float64Array(m + 1);
    prev[0] = 0;
    for (let i = 1; i <= n; i++) {
      const cur = new Float64Array(m + 1).fill(Infinity);
      const curLen = new Float64Array(m + 1);
      const jc = Math.round((i * m) / n);
      for (let j = Math.max(1, jc - band); j <= Math.min(m, jc + band); j++) {
        let d = 0;
        const x = a[i - 1], y = b[j - 1];
        for (let k = 0; k < x.length; k++) { const t = x[k] - y[k]; d += t * t; }
        d = Math.sqrt(d);
        let best = prev[j - 1], len = prevLen[j - 1];
        if (prev[j] < best) { best = prev[j]; len = prevLen[j]; }
        if (cur[j - 1] < best) { best = cur[j - 1]; len = curLen[j - 1]; }
        cur[j] = best + d;
        curLen[j] = len + 1;
      }
      prev = cur; prevLen = curLen;
    }
    return prev[m] / (prevLen[m] || 1);
  }

  // Energy share above 3.5 kHz in the first 100 ms: high for "צב" (ts-), low for "דג"/"קוף"
  function onsetSibilance(sig) {
    const n = Math.min(sig.length, 1600);
    if (n < 512) return 0;
    const re = new Float32Array(512), im = new Float32Array(512);
    let hiE = 0, allE = 0;
    for (let start = 0; start + 512 <= n; start += 256) {
      re.fill(0); im.fill(0);
      for (let i = 0; i < 512; i++) re[i] = sig[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 511));
      fft(re, im);
      for (let k = 1; k <= 256; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        allE += p;
        if (k * (SR / 512) > 3500) hiE += p;
      }
    }
    return allE ? hiE / allE : 0;
  }

  const ONSET_NFFT = 512;
  const onsetWindow = Float32Array.from({ length: ONSET_NFFT }, (_, i) =>
    0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (ONSET_NFFT - 1)));
  const ONSET_BANDS = Array.from({ length: 10 }, (_, i) => {
    const low = 50 * (8000 / 50) ** (i / 10);
    const high = 50 * (8000 / 50) ** ((i + 1) / 10);
    return { low, high };
  });

  function onsetBands(samples, sr = SR) {
    if (samples.length < ONSET_NFFT) throw new RangeError('Onset spectrum requires 512 samples');
    const re = new Float32Array(ONSET_NFFT), im = new Float32Array(ONSET_NFFT);
    const offset = samples.length - ONSET_NFFT;
    for (let i = 0; i < ONSET_NFFT; i++) re[i] = samples[offset + i] * onsetWindow[i];
    fft(re, im);
    return ONSET_BANDS.map(({ low, high }) => {
      let energy = 0;
      for (let k = 1; k <= ONSET_NFFT / 2; k++) {
        const hz = (k * sr) / ONSET_NFFT;
        if (hz >= low && hz < high) energy += re[k] * re[k] + im[k] * im[k];
      }
      return Math.log(Math.sqrt(energy) + 1e-9);
    });
  }

  function maxFilterBands(bands) {
    return bands.map((_, i) => Math.max(bands[Math.max(0, i - 1)], bands[i], bands[Math.min(bands.length - 1, i + 1)]));
  }

  function onsetFlux(current, lagged) {
    const now = maxFilterBands(current), past = maxFilterBands(lagged);
    return now.reduce((sum, value, i) => sum + Math.max(0, value - past[i]), 0);
  }

  const median = (values) => {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  function adaptiveOnsetThreshold(values) {
    const center = median(values);
    const mad = median(values.map((value) => Math.abs(value - center)));
    return center + 4 * mad;
  }

  function sibilanceFeatures(samples, sr = SR) {
    const size = 512, hop = 160;
    let totalEnergy = 0, highEnergy = 0, crossings = 0, samplesUsed = 0;
    const re = new Float32Array(size), im = new Float32Array(size);
    for (let start = 0; start + size <= samples.length; start += hop) {
      re.fill(0); im.fill(0);
      for (let i = 0; i < size; i++) re[i] = samples[start + i];
      fft(re, im);
      for (let bin = 1; bin <= size / 2; bin++) {
        const hz = (bin * sr) / size;
        const energy = re[bin] * re[bin] + im[bin] * im[bin];
        totalEnergy += energy;
        if (hz >= 4000) highEnergy += energy;
      }
    }
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
      samplesUsed++;
    }
    const highBandRatio = totalEnergy ? highEnergy / totalEnergy : 0;
    const zcr = crossings / Math.max(1, samplesUsed);
    return {
      highBandRatio,
      zcr,
      f0Hz: highBandRatio > 0.5 && zcr > 0.1 ? 0 : pitch(samples, sr, 80, 1200),
    };
  }

  function onsetFeatures(samples, sr = SR) {
    const n = samples.length;
    const toSamples = (ms) => Math.min(n, Math.max(0, Math.round((ms * sr) / 1000)));
    const start = toSamples(30), end = Math.min(n, toSamples(80));
    if (end <= start) return null;
    let totalEnergy = 0, lowEnergy = 0, crossings = 0, weightedHz = 0, spectralEnergy = 0;
    const re = new Float32Array(ONSET_NFFT), im = new Float32Array(ONSET_NFFT);
    let usedFrames = 0;
    for (let frameStart = start; frameStart + ONSET_NFFT <= end; frameStart += ONSET_NFFT / 2) {
      re.fill(0); im.fill(0);
      for (let i = 0; i < ONSET_NFFT; i++) re[i] = samples[frameStart + i] * onsetWindow[i];
      fft(re, im);
      for (let k = 1; k <= ONSET_NFFT / 2; k++) {
        const hz = (k * sr) / ONSET_NFFT;
        const energy = re[k] * re[k] + im[k] * im[k];
        totalEnergy += energy;
        if (hz < 300) lowEnergy += energy;
        weightedHz += hz * energy;
        spectralEnergy += energy;
      }

      usedFrames++;
    }
    for (let i = start + 1; i < end; i++) {
      if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
    }
    const periodic = samples.slice(start, end);
    let mean = 0;
    for (const sample of periodic) mean += sample;
    mean /= periodic.length || 1;
    let bestCorrelation = 0;
    const minLag = Math.max(1, Math.floor(sr / 1200));
    const maxLag = Math.min(periodic.length - 2, Math.ceil(sr / 80));
    for (let lag = minLag; lag <= maxLag; lag++) {
      let product = 0, energyA = 0, energyB = 0;
      for (let i = 0; i + lag < periodic.length; i++) {
        const a = periodic[i] - mean, b = periodic[i + lag] - mean;
        product += a * b; energyA += a * a; energyB += b * b;
      }
      bestCorrelation = Math.max(bestCorrelation, product / Math.sqrt(energyA * energyB + 1e-12));
    }
    const burstStart = toSamples(0), burstEnd = Math.min(n, toSamples(400));
    const envelope = [];
    const window = Math.max(1, Math.round(sr * 0.005));
    for (let i = burstStart; i + window <= burstEnd; i += window) {
      let energy = 0;
      for (let j = i; j < i + window; j++) energy += samples[j] * samples[j];
      envelope.push({ ms: ((i - burstStart) * 1000) / sr, db: 10 * Math.log10(energy / window + 1e-12) });
    }
    const peakDb = Math.max(-120, ...envelope.map((frame) => frame.db));
    const decay = envelope.find((frame) => frame.ms > 0 && frame.db <= peakDb - 20);
    const active = envelope.filter((frame) => frame.db > peakDb - 20);
    return {
      lowBandRatio: totalEnergy ? lowEnergy / totalEnergy : 0,
      centroidHz: spectralEnergy ? weightedHz / spectralEnergy : 0,
      zcr: crossings / Math.max(1, end - start - 1),
      harmonicity: bestCorrelation,
      f0Hz: pitch(periodic, sr, 80, 1200),
      decayMs: decay ? decay.ms : 400,
      durationMs: active.length ? active[active.length - 1].ms + 5 : 0,
      analysisFrames: usedFrames,
    };
  }

  const FEATURE_KEYS = ['lowBandRatio', 'centroidHz', 'zcr', 'harmonicity', 'decayMs', 'durationMs'];
  const FEATURE_SCALES = [1, 8000, 0.5, 1, 400, 400];
  function normalizeOnsetFeatures(features) {
    return FEATURE_KEYS.map((key, i) => Math.max(0, Math.min(1, Number(features[key]) / FEATURE_SCALES[i])));
  }

  function classifyOnset(features, centroids = {}) {
    const entries = Object.entries(centroids).filter(([, values]) =>
      Array.isArray(values) && values.length === FEATURE_KEYS.length && values.every(Number.isFinite));
    if (entries.length >= 2) {
      const vector = normalizeOnsetFeatures(features);
      const ranked = entries.map(([cls, values]) => ({
        cls,
        distance: Math.sqrt(vector.reduce((sum, value, i) => sum + (value - values[i]) ** 2, 0)),
      })).sort((a, b) => a.distance - b.distance);
      const margin = ranked[1].distance ? (ranked[1].distance - ranked[0].distance) / ranked[1].distance : 0;
      return {
        cls: margin < 0.15 ? 'uncertain' : ranked[0].cls,
        clsConf: Math.max(0, Math.min(1, margin / 0.4)),
        distance: ranked[0].distance,
      };
    }

    let cls = 'uncertain', clsConf = 0.25;
    if (features.f0Hz > 0 && features.harmonicity >= 0.55 && features.durationMs >= 180) {
      cls = 'voice'; clsConf = 0.7;
    } else if (features.zcr > 0.18 && features.lowBandRatio < 0.2 && features.centroidHz > 2500) {
      cls = 'hiss'; clsConf = 0.65;
    } else if (features.lowBandRatio > 0.55) {
      cls = features.decayMs > 180 ? 'ball' : features.durationMs > 100 ? 'landing' : 'stomp';
      clsConf = 0.55;
    } else if (features.centroidHz > 1200 && features.durationMs < 100) {
      cls = 'clap'; clsConf = 0.55;
    } else if (features.decayMs > 130) {
      cls = 'pot'; clsConf = 0.45;
    } else if (features.centroidHz > 250) {
      cls = 'table'; clsConf = 0.4;
    }
    return { cls, clsConf };
  }

  function peakPick(frames, options = {}) {
    const hopMs = options.hopMs || 10;
    const lookAhead = Math.max(1, Math.round((options.preMaxMs || 30) / hopMs));
    const meanFrames = Math.max(1, Math.round((options.preAvgMs || 100) / hopMs));
    const ioi = options.minIoiMs || 130;
    const delta = options.delta || 0;
    const minimum = options.floorDb + (options.minAboveFloor === undefined ? 10 : options.minAboveFloor);
    const picked = [];
    let lastT = -Infinity;
    for (let i = meanFrames; i + lookAhead < frames.length; i++) {
      const frame = frames[i];
      const history = frames.slice(Math.max(0, i - meanFrames), i);
      const mean = history.reduce((sum, item) => sum + item.odf, 0) / history.length;
      const local = frames.slice(i - lookAhead, i + lookAhead + 1);
      const localMax = Math.max(...local.map((item) => item.odf));
      if (frame.odf < mean + delta || frame.db < minimum || frame.odf !== localMax
        || local.findIndex((item) => item.odf === localMax) !== lookAhead) continue;
      if (frame.t - lastT >= ioi) { picked.push(frame); lastT = frame.t; }
    }
    return picked;
  }

  function acceptOnset(t, peakDb, lastT, lastPeakDb, minIoiMs, retriggerMs = 100) {
    const elapsed = t - lastT;
    if (!Number.isFinite(lastT)) return true;
    if (elapsed < 0 || elapsed < minIoiMs) return false;
    const decayedEnvelope = lastPeakDb - 20 * Math.log10(1 + elapsed / 100);
    return elapsed >= retriggerMs || peakDb >= decayedEnvelope + 6;
  }

  function isTimeGated(t, windows) {
    return windows.some((window) => t >= window[0] && t <= window[1]);
  }

  function mergeLandings(onsets, windowMs = 120) {
    const merged = [];
    onsets.forEach((onset) => {
      const last = merged[merged.length - 1];
      if (last && onset.t - last.t <= windowMs) {
        last.t = Math.min(last.t, onset.t);
        last.peakDb = Math.max(last.peakDb, onset.peakDb);
        last.members++;
      } else merged.push({ ...onset, members: 1 });
    });
    return merged;
  }

  function ballFell(onsets) {
    for (let i = 2; i < onsets.length; i++) {
      const previous = onsets[i - 1].t - onsets[i - 2].t;
      const current = onsets[i].t - onsets[i - 1].t;
      if (current >= previous * 0.6 && current <= previous * 0.9) return true;
    }
    return false;
  }

  return {
    fft, pitch, mfcc, dtw, onsetSibilance, SR, onsetBands, onsetFlux,
    adaptiveOnsetThreshold, onsetFeatures, sibilanceFeatures, normalizeOnsetFeatures, classifyOnset,
    peakPick, acceptOnset, isTimeGated, mergeLandings, ballFell,
  };
})();
