/* audio.js — מנוע ההאזנה.
   קולט מהמיקרופון (או ממצב סימולציה), מוריד ל-16kHz, מחשב עוצמה כל 10 מ"ש,
   מזהה תחילת וסוף קול ומעריך גובה צליל כדי להבדיל בין ילד למבוגר.
   האודיו נשמר רק במאגר זמני של כמה שניות בזיכרון, ולא נכתב לשום מקום. */
T.audio = (() => {
  const SR = 16000, HOP = 160, WIN = 320, RING_SEC = 12;
  let ctx = null, stream = null, srcNode = null, tapNode = null, simBus = null;
  let mode = 'off'; // 'mic' | 'sim' | 'off'
  let inRate = 48000, resampPos = 0, resampPrev = 0, hopCount = 0;
  const ring = new Float32Array(SR * RING_SEC);
  let ringWrite = 0; // total samples written (16k)
  let t0 = null; // AudioContext-clock milliseconds at sample 0
  let hopAcc = 0;
  let floorFrozen = false;
  let applied = {};
  let minIoiMs = 130, minAboveFloor = 10;
  let onsetSpectra = [], onsetFrames = [], onsetCandidates = [];
  let gateWindows = [], lastOnsetTime = -Infinity, lastOnsetPeakDb = -Infinity;
  let soundCentroids = {};
  let loopbackMs = 0, loopbackJitterMs = 0, loopbackLowConfidence = true, loopbackCalibrated = false;

  const cfg = {
    sensitivity: 12, // dB above noise floor that counts as sound
    gapMs: 180, // silence that ends a segment
    minSegMs: 90,
    adultFilter: true,
    adultHz: 210, // median pitch below this = adult voice
  };

  let floorDb = -62;
  let gate = false; // true while Tombi is talking: ignore everything
  let active = false, segStart = 0, lastActive = 0, segFrames = [];
  const frames = []; // {t, db, active, hz}
  const listeners = new Set();
  let level = { db: -100, floor: floorDb, hz: 0, active: false };

  const now = () => (ctx ? ctx.currentTime * 1000 : performance.now());
  const emit = (type, data) => listeners.forEach((fn) => fn(type, data));
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  function pushSamples(input, blockStartFrame, sampleRate = inRate) {
    inRate = sampleRate;
    const blockStartMs = Number.isFinite(blockStartFrame)
      ? (blockStartFrame / sampleRate) * 1000
      : now() - (input.length / sampleRate) * 1000;
    if (t0 === null) t0 = blockStartMs;
    const ratio = sampleRate / SR;
    // box-filter (average of the input samples since the last output) down to 16 kHz
    for (let i = 0; i < input.length; i++) {
      const s = input[i];
      resampPrev += s; hopCount++;
      resampPos += 1;
      if (resampPos >= ratio) {
        resampPos -= ratio;
        const v = resampPrev / hopCount;
        resampPrev = 0; hopCount = 0;
        ring[ringWrite % ring.length] = v;
        ringWrite++;
        hopAcc++;
        if (hopAcc >= HOP) { hopAcc = 0; analyseFrame(); }
      }
    }
  }

  function readRing(fromSample, count) {
    const out = new Float32Array(Math.max(0, count));
    const oldest = ringWrite - ring.length;
    for (let i = 0; i < count; i++) {
      const idx = fromSample + i;
      out[i] = idx < oldest || idx >= ringWrite ? 0 : ring[idx % ring.length];
    }
    return out;
  }
  const timeToSample = (t) => Math.round(((t - t0) / 1000) * SR);

  function analyseFrame() {
    const buf = readRing(ringWrite - WIN, WIN);
    let e = 0;
    for (let i = 0; i < WIN; i++) e += buf[i] * buf[i];
    const rms = Math.sqrt(e / WIN);
    const db = 20 * Math.log10(rms + 1e-9);
    const t = t0 + (ringWrite / SR) * 1000;
    const onsetBandValues = T.dsp.onsetBands(readRing(ringWrite - 512, 512), SR);
    const laggedBands = onsetSpectra.length >= 2 ? onsetSpectra[onsetSpectra.length - 2] : onsetBandValues;
    const odf = T.dsp.onsetFlux(onsetBandValues, laggedBands);
    onsetSpectra.push(onsetBandValues);
    if (onsetSpectra.length > 3) onsetSpectra.shift();
    processOnsetFrame({ t, db, odf, bands: onsetBandValues });
    const thrOn = floorDb + cfg.sensitivity;
    const thrOff = floorDb + cfg.sensitivity * 0.6;

    let hz = 0;
    if (db > thrOn) hz = T.dsp.pitch(readRing(ringWrite - 640, 640), SR);

    if (!gate) {
      if (!active && db > thrOn) {
        active = true; segStart = t - 10; segFrames = []; lastActive = t;
        emit('onset', { t: segStart, db });
      }
      if (active) {
        segFrames.push({ t, db, hz });
        if (db > thrOff) lastActive = t;
        if (t - lastActive > cfg.gapMs) closeSegment();
      }
    }
    // adaptive noise floor, follows quiet frames only
    if (!active && !gate && !floorFrozen) {
      if (db < floorDb) floorDb = floorDb * 0.9 + db * 0.1;
      else if (db < floorDb + 6) floorDb = floorDb * 0.995 + db * 0.005;
      floorDb = Math.max(-95, Math.min(-25, floorDb));
    }
    const clipped = buf.some((sample) => Math.abs(sample) >= 0.999);
    const f = { t, db, active: active && !gate, hz, bands: onsetBandValues, odf, clipped };
    frames.push(f);
    if (frames.length > 3000) frames.splice(0, 1000);
    level = { db, floor: floorDb, hz, active: f.active };
    emit('frame', f);
  }

  function processOnsetFrame(frame) {
    if (gate) {
      onsetCandidates = [];
      gateWindows = gateWindows.filter((window) => window[1] >= frame.t);
      return;
    }
    onsetFrames.push(frame);
    if (onsetFrames.length > 300) onsetFrames.shift();
    if (onsetFrames.length >= 4) {
      const peak = onsetFrames[onsetFrames.length - 4];
      const local = onsetFrames.slice(-7);
      const localMaximum = Math.max(...local.map((item) => item.odf));
      const recentOdf = onsetFrames.filter((item) => item.t >= peak.t - 3000 && item.t < peak.t);
      const previous100 = onsetFrames.filter((item) => item.t >= peak.t - 100 && item.t < peak.t);
      const odfThreshold = previous100.length
        ? previous100.reduce((sum, item) => sum + item.odf, 0) / previous100.length
          + T.dsp.adaptiveOnsetThreshold(recentOdf.map((item) => item.odf))
        : Infinity;
      if (peak.odf > odfThreshold && peak.db >= floorDb + minAboveFloor
        && peak.odf === localMaximum && local.findIndex((item) => item.odf === localMaximum) === 3
        && !T.dsp.isTimeGated(peak.t, gateWindows)) {
        onsetCandidates.push({ ...peak, peakDb: peak.db });
      }
    }

    const ready = onsetCandidates.filter((candidate) => frame.t >= candidate.t + 400);
    onsetCandidates = onsetCandidates.filter((candidate) => frame.t < candidate.t + 400);
    ready.forEach(emitOnset);
    gateWindows = gateWindows.filter((window) => window[1] + 400 >= frame.t);
  }

  function refineOnsetTime(peak) {
    const endSample = timeToSample(peak.t);
    const startSample = Math.max(ringWrite - ring.length, endSample - Math.round(SR * 0.08));
    const raw = readRing(startSample, endSample - startSample + 1);
    const threshold = (10 ** (peak.peakDb / 20)) * 0.5;
    const window = Math.max(1, Math.round(SR * 0.001));
    for (let i = 0; i + window <= raw.length; i += window) {
      let energy = 0;
      for (let j = i; j < i + window; j++) energy += raw[j] * raw[j];
      if (Math.sqrt(energy / window) >= threshold) {
        return t0 + ((startSample + i) / SR) * 1000;
      }
    }
    return peak.t;
  }

  function emitOnset(candidate) {
    const t = refineOnsetTime(candidate);
    if (T.dsp.isTimeGated(t, gateWindows)) return;
    if (!T.dsp.acceptOnset(t, candidate.peakDb, lastOnsetTime, lastOnsetPeakDb, minIoiMs)) return;

    const startSample = timeToSample(t);
    const samples = readRing(startSample, Math.round(SR * 0.4));
    const feats = T.dsp.onsetFeatures(samples, SR);
    if (!feats) return;
    const classification = T.dsp.classifyOnset(feats, soundCentroids);
    const event = {
      t, peakDb: candidate.peakDb, aboveFloor: candidate.peakDb - floorDb,
      bands: candidate.bands, feats, cls: classification.cls, clsConf: classification.clsConf,
      snr: candidate.peakDb - floorDb, repeat: candidate.peakDb - floorDb < 12,
    };
    lastOnsetTime = t;
    lastOnsetPeakDb = candidate.peakDb;
    emit('onsetX', event);
  }

  function closeSegment() {
    active = false;
    const end = lastActive;
    const dur = end - segStart;
    if (dur < cfg.minSegMs) return;
    const voiced = segFrames.filter((f) => f.hz > 0).map((f) => f.hz).sort((a, b) => a - b);
    const hz = voiced.length >= 3 ? voiced[Math.floor(voiced.length / 2)] : 0;
    const dbs = segFrames.map((f) => f.db);
    const peakDb = Math.max(...dbs);
    // robust level: mean energy of frames within 10 dB of the peak
    const strong = dbs.filter((d) => d > peakDb - 10);
    const meanLin = strong.reduce((s, d) => s + 10 ** (d / 10), 0) / strong.length;
    const levelDb = 10 * Math.log10(meanLin);
    const adult = cfg.adultFilter && hz > 0 && hz < cfg.adultHz && voiced.length > segFrames.length * 0.3;
    const seg = { start: segStart, end, dur, peakDb, levelDb, hz, adult, floorDb };
    emit('segment', seg);
  }

  // 16 kHz audio of a time span, for word matching. Lives only in memory.
  function grab(start, end) {
    const s0 = timeToSample(start - 40), s1 = timeToSample(end + 60);
    return readRing(s0, s1 - s0);
  }

  function framesBetween(a, b) { return frames.filter((f) => f.t >= a && f.t <= b); }

  async function ensureCtx() {
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is not supported by this browser');
      ctx = new AudioContextClass({ latencyHint: 'interactive' });
    }
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }

  async function connectTap(source) {
    inRate = ctx.sampleRate;
    const code = `class Tap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(512);this.n=0;this.s=0}
      process(i){const c=i[0]&&i[0][0];if(c){for(let k=0;k<c.length;k++){if(this.n===0)this.s=currentFrame+k;this.b[this.n++]=c[k];if(this.n===512){this.port.postMessage({samples:this.b.slice(0),startFrame:this.s});this.n=0}}}return true}}
      registerProcessor('tombi-tap',Tap);`;
    try {
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      tapNode = new AudioWorkletNode(ctx, 'tombi-tap');
      tapNode.port.onmessage = (e) => pushSamples(e.data.samples, e.data.startFrame, ctx.sampleRate);
    } catch (err) {
      console.warn('AudioWorklet unavailable; using ScriptProcessor for audio frames.', err);
      tapNode = ctx.createScriptProcessor(1024, 1, 1);
      tapNode.onaudioprocess = (e) => {
        const samples = e.inputBuffer.getChannelData(0);
        const startFrame = Math.round((ctx.currentTime - samples.length / ctx.sampleRate) * ctx.sampleRate);
        pushSamples(samples, startFrame, ctx.sampleRate);
      };
    }
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(tapNode);
    tapNode.connect(sink).connect(ctx.destination);
  }

  async function startMic() {
    await ensureCtx();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('The microphone stream did not provide an audio track');
    applied = track.getSettings();
    const savedLoopback = T.store && T.store.settings.loopbackByDevice
      && T.store.settings.loopbackByDevice[applied.deviceId];
    if (savedLoopback) {
      loopbackMs = Number(savedLoopback.loopbackMs) || 0;
      loopbackJitterMs = Number(savedLoopback.jitterMs) || 0;
      loopbackLowConfidence = !!savedLoopback.lowConfidence;
      loopbackCalibrated = true;
    }
    srcNode = ctx.createMediaStreamSource(stream);
    await connectTap(srcNode);
    mode = 'mic';
    return true;
  }

  // Simulation: synthetic "child" sounds go into the same analysis path (and quietly to the speakers)
  async function startSim() {
    await ensureCtx();
    simBus = ctx.createGain();
    const hiss = noiseSource(0.0006, true);
    hiss.connect(simBus);
    const monitor = ctx.createGain();
    monitor.gain.value = 0.35;
    simBus.connect(monitor).connect(ctx.destination);
    await connectTap(simBus);
    mode = 'sim';
    return true;
  }

  function noiseSource(gainVal, loop) {
    const len = ctx.sampleRate * 2;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = b; s.loop = !!loop;
    const g = ctx.createGain(); g.gain.value = gainVal;
    s.connect(g); s.start();
    return g;
  }

  const sim = {
    // a child-like voice: 300 Hz buzz through a soft filter
    voice(ms = 450, loud = 0.25, hz = 300, delay = 0) {
      if (mode !== 'sim') return;
      const t = ctx.currentTime + delay / 1000;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz;
      const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
      const vg = ctx.createGain(); vg.gain.value = hz * 0.02; vib.connect(vg).connect(o.frequency);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(loud, t + 0.04);
      g.gain.setValueAtTime(loud, t + ms / 1000 - 0.05);
      g.gain.linearRampToValueAtTime(0, t + ms / 1000);
      o.connect(f).connect(g).connect(simBus);
      o.start(t); vib.start(t); o.stop(t + ms / 1000 + 0.05); vib.stop(t + ms / 1000 + 0.05);
    },
    hiss(ms = 3000, loud = 0.12) {
      if (mode !== 'sim') return;
      const t = ctx.currentTime;
      const len = Math.ceil(ctx.sampleRate * (ms / 1000 + 0.1));
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource(); s.buffer = b;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3500;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(loud, t + 0.08);
      g.gain.setValueAtTime(loud, t + ms / 1000 - 0.1);
      g.gain.linearRampToValueAtTime(0, t + ms / 1000);
      s.connect(f).connect(g).connect(simBus); s.start(t);
    },
    clap(delay = 0, loud = 0.6) {
      if (mode !== 'sim') return;
      const t = ctx.currentTime + delay / 1000;
      const len = Math.ceil(ctx.sampleRate * 0.12);
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.018));
      const s = ctx.createBufferSource(); s.buffer = b;
      const g = ctx.createGain(); g.gain.value = loud;
      s.connect(g).connect(simBus); s.start(t);
    },
    adult(ms = 600) { sim.voice(ms, 0.25, 150); },
  };

  function setGate(v) {
    gate = v;
    if (v && active) { active = false; }
  }

  function gateWindow(from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      throw new TypeError('Gate windows use finite AudioContext-clock milliseconds in ascending order');
    }
    gateWindows.push([from, to]);
  }

  function setOnsetConfig(options = {}) {
    if (options.minIoiMs !== undefined) {
      const value = Number(options.minIoiMs);
      if (!Number.isFinite(value) || value < 0) throw new RangeError('minIoiMs must be non-negative');
      minIoiMs = value;
    }
    if (options.minAboveFloor !== undefined) {
      const value = Number(options.minAboveFloor);
      if (!Number.isFinite(value)) throw new RangeError('minAboveFloor must be finite');
      minAboveFloor = value;
    }
    if (options.floorFrozen !== undefined) floorFrozen = !!options.floorFrozen;
    if (options.centroids !== undefined) {
      soundCentroids = Object.fromEntries(Object.entries(options.centroids || {}).filter(([, values]) =>
        Array.isArray(values) && values.length === 6 && values.every(Number.isFinite)));
    }
  }

  function waitForFramesUntil(endTime) {
    if (mode === 'off') return Promise.reject(new Error('Audio input is not running'));
    return new Promise((resolve) => {
      const off = on((type, frame) => {
        if (type === 'frame' && frame.t >= endTime) { off(); resolve(); }
      });
    });
  }

  async function calibrate(ms = 2000) {
    if (!Number.isFinite(ms) || ms <= 0) throw new RangeError('Calibration duration must be positive');
    const start = now();
    await waitForFramesUntil(start + ms);
    const noiseFrames = framesBetween(start, start + ms).map((frame) => frame.db).sort((a, b) => a - b);
    if (noiseFrames.length < 100) throw new Error('Not enough microphone frames were collected for noise calibration');
    floorDb = Math.max(-95, Math.min(-30, noiseFrames[Math.floor((noiseFrames.length - 1) * 0.15)]));
    return floorDb;
  }

  async function calibrateTaskFloor() {
    floorFrozen = false;
    const floor = await calibrate(2000);
    floorFrozen = true;
    return floor;
  }

  function addSoundCalibration(label, events) {
    if (typeof label !== 'string' || !label || !Array.isArray(events) || !events.length) {
      throw new TypeError('Sound calibration requires a class name and detected events');
    }
    const features = events.map((event) => event.feats || event).filter((item) =>
      item && ['lowBandRatio', 'centroidHz', 'zcr', 'harmonicity', 'decayMs', 'durationMs']
        .every((key) => Number.isFinite(item[key])));
    if (!features.length) throw new TypeError('Calibration events need numeric onset features');
    const vectors = features.map(T.dsp.normalizeOnsetFeatures);
    soundCentroids[label] = vectors[0].map((_, i) =>
      vectors.reduce((sum, vector) => sum + vector[i], 0) / vectors.length);
    return soundCentroids[label];
  }

  function resetOnsets() {
    onsetFrames = [];
    onsetCandidates = [];
    onsetSpectra = [];
    gateWindows = [];
    lastOnsetTime = -Infinity;
    lastOnsetPeakDb = -Infinity;
  }

  function toneEnergy(samples, start, length, frequency) {
    const coeff = 2 * Math.cos((2 * Math.PI * frequency) / SR);
    let q0 = 0, q1 = 0, q2 = 0;
    for (let i = start; i < start + length && i < samples.length; i++) {
      q0 = coeff * q1 - q2 + samples[i];
      q2 = q1; q1 = q0;
    }
    return q1 * q1 + q2 * q2 - coeff * q1 * q2;
  }

  async function calibrateLoopback() {
    if (mode !== 'mic') throw new Error('Loopback calibration requires microphone mode');
    if (!T.tombi || typeof T.tombi.chirp !== 'function') throw new Error('Tombi chirp instrument is unavailable');
    const times = Array.from({ length: 8 }, (_, i) => ctx.currentTime + 0.5 + i * 0.5);
    times.forEach((time) => T.tombi.chirp(time));
    await waitForFramesUntil((times[times.length - 1] + 0.35) * 1000);

    const delays = [];
    times.forEach((time) => {
      const expectedMs = time * 1000;
      const samples = readRing(timeToSample(expectedMs - 150), Math.round(SR * 0.3));
      const windowSize = Math.round(SR * 0.02);
      const step = Math.round(SR * 0.001);
      let bestPower = 0, bestOffset = 0;
      for (let offset = 0; offset + windowSize <= samples.length; offset += step) {
        const power = toneEnergy(samples, offset, windowSize, 3500);
        if (power > bestPower) { bestPower = power; bestOffset = offset; }
      }
      const preWindow = Math.max(0, Math.round(SR * 0.05));
      const baseline = toneEnergy(samples, preWindow, windowSize, 3500);
      if (bestPower > baseline * 4 + 1e-10) {
        delays.push((bestOffset * 1000) / SR - 150);
      }
    });

    const ordered = delays.slice().sort((a, b) => a - b);
    const median = ordered.length ? ordered[Math.floor(ordered.length / 2)] : 0;
    loopbackJitterMs = ordered.length
      ? Math.sqrt(ordered.reduce((sum, value) => sum + (value - median) ** 2, 0) / ordered.length)
      : 0;
    loopbackLowConfidence = delays.length < 7 || loopbackJitterMs > 10;
    loopbackMs = loopbackLowConfidence ? 0 : median;
    loopbackCalibrated = true;
    if (T.store && applied.deviceId) {
      T.store.settings.loopbackByDevice = T.store.settings.loopbackByDevice || {};
      T.store.settings.loopbackByDevice[applied.deviceId] = {
        loopbackMs, jitterMs: loopbackJitterMs, lowConfidence: loopbackLowConfidence,
      };
      T.store.save();
    }
    if (T.ui && T.ui.refreshAudioWarnings) T.ui.refreshAudioWarnings();
    return { loopbackMs, jitterMs: loopbackJitterMs, found: delays.length, lowConfidence: loopbackLowConfidence };
  }

  function thump(delay = 0, loud = 0.55, hz = 90, duration = 0.12) {
    if (mode !== 'sim') return;
    const t = ctx.currentTime + delay / 1000;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(hz * 1.8, t);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, hz * 0.65), t + duration);
    gain.gain.setValueAtTime(loud, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    oscillator.connect(gain).connect(simBus);
    oscillator.start(t); oscillator.stop(t + duration + 0.01);
  }

  function noiseHit(delay = 0, loud = 0.5, duration = 0.09, frequency = 1200, type = 'bandpass') {
    if (mode !== 'sim') return;
    const t = ctx.currentTime + delay / 1000;
    const len = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * duration * 0.18));
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = buffer; filter.type = type; filter.frequency.value = frequency; gain.gain.value = loud;
    source.connect(filter).connect(gain).connect(simBus); source.start(t);
  }

  Object.assign(sim, {
    stomp: (delay = 0, loud = 0.55) => thump(delay, loud, 75, 0.14),
    jumpLanding(delay = 0, loud = 0.55) { thump(delay, loud, 75, 0.12); thump(delay + 35, loud * 0.72, 82, 0.1); },
    table: (delay = 0, loud = 0.5) => thump(delay, loud, 210, 0.08),
    pot: (delay = 0, loud = 0.45) => noiseHit(delay, loud, 0.35, 900, 'highpass'),
    ball: (delay = 0, loud = 0.5) => thump(delay, loud, 110, 0.1),
    rustle(duration = 300, loud = 0.02, delay = 0) {
      if (mode !== 'sim') return;
      const t = ctx.currentTime + delay / 1000, len = Math.ceil(ctx.sampleRate * duration / 1000);
      const b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * loud;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 800; s.buffer = b; s.connect(f).connect(simBus); s.start(t);
    },
  });

  function stop() {
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    stream = null; mode = 'off';
  }

  return {
    cfg, on, now, grab, framesBetween, startMic, startSim, calibrate, calibrateTaskFloor,
    calibrateLoopback, setGate, gateWindow, setOnsetConfig, addSoundCalibration, resetOnsets,
    stop, sim, ensureCtx,
    get ctx() { return ctx; }, get mode() { return mode; }, get level() { return level; },
    get floor() { return floorDb; }, set floor(v) { floorDb = v; }, get gated() { return gate; },
    get applied() { return { ...applied }; },
    get loopbackMs() { return loopbackMs; },
    get loopbackJitterMs() { return loopbackJitterMs; },
    get loopbackLowConfidence() { return loopbackLowConfidence; },
    get loopbackCalibrated() { return loopbackCalibrated; },
    get floorFrozen() { return floorFrozen; },
    get soundCentroids() { return JSON.parse(JSON.stringify(soundCentroids)); },
    set soundCentroids(centroids) { setOnsetConfig({ centroids }); },
  };
})();

T.onsets = {
  on(listener) {
    if (typeof listener !== 'function') throw new TypeError('An onset listener is required');
    return T.audio.on((type, event) => { if (type === 'onsetX') listener(event); });
  },
  configure: T.audio.setOnsetConfig,
  calibrateFloor: T.audio.calibrate,
  calibrateTaskFloor: T.audio.calibrateTaskFloor,
  features: T.dsp.onsetFeatures,
  classify: T.dsp.classifyOnset,
  addCalibration(label, events, childId) {
    const centroid = T.audio.addSoundCalibration(label, events);
    if (childId && T.store) T.store.setSoundCentroids(childId, T.audio.soundCentroids);
    return centroid;
  },
  setCentroids(centroids, childId) {
    T.audio.setOnsetConfig({ centroids });
    if (childId && T.store) T.store.setSoundCentroids(childId, T.audio.soundCentroids);
  },
  reset: T.audio.resetOnsets,
  gateWindow: T.audio.gateWindow,
  get centroids() { return T.audio.soundCentroids; },
};
