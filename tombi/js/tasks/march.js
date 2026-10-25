/* Beat synchronisation, tempo adaptation, and continuation task. */
T.tasks.register({
  key: 'march', name: 'מצעד הדרקון', domain: 'תזמון וסנכרון מוטורי',
  slot: 'rhythm', arousal: 1, gross: true, jump: false,
  needs: { space: 1, hardFloor: true, standing: true, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 45, full: 70 }, levels: 5,
  params(level = 1, age = 5, child = {}) {
    return T.levels.params('march', level, { ...child, age });
  },
  async run(ctx, p) {
    const count = p.short ? Math.max(8, Math.ceil(p.count * 0.6)) : p.count;
    const continuationCount = p.short ? 8 : 12;
    const isAntiPhase = !!p.antiPhase && p.age >= 5;
    const suffix = `${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`;
    const line = (key) => T.activity.line(key, ctx);
    await T.activity.start(ctx, {
      title: 'מצעד הדרקון', picture: isAntiPhase ? 'hands' : 'foot', intro: 'march_intro',
      instruction: isAntiPhase ? 'march_antiphase' : 'march_go',
    });
    const practice = p.isNew
      ? await T.activity.practice(ctx, () => isAntiPhase ? T.audio.sim.clap(250, 0.42) : T.audio.sim.stomp(250, 0.42), { minIoiMs: 220, minAboveFloor: 9 })
      : null;
    await ctx.say(line('march_try'), `march_free_${suffix}`);
    const freeMarchDurationMs = p.short ? 6000 : 10000;
    const freeEvents = await T.activity.collect(ctx, {
      durationMs: freeMarchDurationMs, minIoiMs: 220, minAboveFloor: 9,
      simulate: () => T.tasks.get('march').simulate({ phase: 'free', durationMs: freeMarchDurationMs, ibi: p.ibi }),
    });
    const spontaneousSteps = freeEvents.filter((event) => event.cls === 'stomp');
    const spontaneousIntervals = spontaneousSteps.slice(1).map((event, index) => event.t - spontaneousSteps[index].t);
    const spontaneousIbiMs = spontaneousIntervals.length ? medianOf(spontaneousIntervals) : null;
    if (p.level >= 4) await ctx.say(line('march_shift'), `march_shift_${suffix}`);
    const syncOffsets = [], syncIbis = [];
    let offsetMs = 250, ibi = p.ibi;
    for (let index = 0; index < count; index++) {
      syncOffsets.push(offsetMs);
      syncIbis.push(ibi);
      if (p.tempoShiftMs && index === Math.ceil(count / 2) - 1) ibi += p.tempoShiftMs;
      offsetMs += ibi;
    }
    const beatTimes = syncOffsets.map((offset) => T.activity.beat(offset, { gate: true }) * 1000);
    const loopbackMs = T.audio.loopbackMs || 0;
    const syncEvents = await T.activity.collect(ctx, {
      durationMs: offsetMs + loopbackMs + 250, minIoiMs: 220, minAboveFloor: 9, drainMs: 0,
      simulate: () => T.tasks.get('march').simulate({
        phase: 'sync', offsets: syncOffsets, ibis: syncIbis, antiPhase: isAntiPhase, ibi: p.ibi,
      }),
    });
    await ctx.say(line('march_tired'), `march_tired_${suffix}`);
    await ctx.say(line('march_tired'), `march_tired_${suffix}`);
    const continuationEvents = await T.activity.collect(ctx, {
      durationMs: continuationCount * ibi + 1000, minIoiMs: 220, minAboveFloor: 9,
      simulate: () => T.tasks.get('march').simulate({ phase: 'continue', count: continuationCount, ibi, antiPhase: isAntiPhase }),
    });
    const allEvents = [...freeEvents, ...syncEvents, ...continuationEvents];
    const responseClass = isAntiPhase ? 'clap' : 'stomp';
    const syncSteps = syncEvents.filter((event) => event.cls === responseClass);
    const continuedSteps = continuationEvents.filter((event) => event.cls === responseClass);
    const measuredSteps = syncSteps.slice(2);
    const intervals = measuredSteps.slice(1).map((event, index) => event.t - measuredSteps[index].t);
    const median = intervals.length ? medianOf(intervals) : 0;
    const mean = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
    const cv = intervals.length && mean
      ? Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length) / mean
      : 1;
    const expectedMedianIbi = medianOf(syncIbis);
    const tempoMatch = median ? median / expectedMedianIbi : 0;
    const targetPhase = isAntiPhase ? Math.PI : 0;
    const phaseObservations = measuredSteps.flatMap((event) => {
      const corrected = event.t - loopbackMs;
      let nearest = -1, distance = Infinity;
      beatTimes.forEach((beat, index) => {
        const candidate = Math.abs(corrected - beat);
        if (candidate < distance) { nearest = index; distance = candidate; }
      });
      if (nearest < 0) return [];
      const localIbi = syncIbis[nearest] || p.ibi;
      const rawPhase = 2 * Math.PI * (corrected - beatTimes[nearest]) / localIbi;
      const error = wrapPhase(rawPhase - targetPhase);
      return [{ rawPhase, error, index: nearest }];
    });
    const vectorX = phaseObservations.reduce((sum, item) => sum + Math.cos(item.error), 0) / Math.max(1, phaseObservations.length);
    const vectorY = phaseObservations.reduce((sum, item) => sum + Math.sin(item.error), 0) / Math.max(1, phaseObservations.length);
    const vectorLength = Math.sqrt(vectorX ** 2 + vectorY ** 2);
    const hitWindow = p.age < 5 ? 0.25 : 0.2;
    const hitPercent = phaseObservations.length
      ? phaseObservations.filter((item) => Math.abs(item.error) / (2 * Math.PI) <= hitWindow).length / phaseObservations.length
      : 0;
    const rayleighP = phaseObservations.length > 10 ? rayleighPValue(phaseObservations.length, vectorLength) : 1;
    const continuationIntervals = continuedSteps.slice(1).map((event, index) => event.t - continuedSteps[index].t);
    const continuationMean = continuationIntervals.length
      ? continuationIntervals.reduce((sum, value) => sum + value, 0) / continuationIntervals.length : 0;
    const xMean = (continuationIntervals.length - 1) / 2;
    const denominator = continuationIntervals.reduce((sum, _, index) => sum + (index - xMean) ** 2, 0);
    const drift = denominator
      ? continuationIntervals.reduce((sum, value, index) => sum + (index - xMean) * (value - continuationMean), 0) / denominator
      : 0;
    const tempoScore = Math.max(0, 1 - Math.abs(tempoMatch - 1) / 0.25);
    const continuationScore = Math.max(0, 1 - Math.abs(drift) / (0.05 * expectedMedianIbi));
    const score = 100 * (0.35 * tempoScore + 0.35 * vectorLength + 0.15 * hitPercent + 0.15 * continuationScore);
    const postShift = phaseObservations.filter((item) => item.index >= Math.ceil(count / 2));
    const recoveredAt = p.tempoShiftMs
      ? postShift.findIndex((item) => Math.abs(item.error) / (2 * Math.PI) <= hitWindow)
      : -1;
    await ctx.say(line('march_praise3'), `march_praise3_${suffix}`);
    return T.activity.result(allEvents, score, {
      ibiMs: p.ibi, expectedMedianIbiMs: expectedMedianIbi, medianItiMs: median || null,
      tempoMatch, cvIti: cv, phaseVectorLength: vectorLength,
      meanAsynchronyMs: phaseObservations.length
        ? (targetPhase + Math.atan2(vectorY, vectorX)) * expectedMedianIbi / (2 * Math.PI) : null,
      targetPhaseRad: targetPhase, hitPercent, rayleighP,
      freeMarchSteps: spontaneousSteps.length, spontaneousIbiMs,
      continuationSteps: continuedSteps.length, continuationDriftMsPerStep: drift,
      tempoShiftMs: p.tempoShiftMs || 0,
      tempoRecoverySteps: recoveredAt < 0 ? null : recoveredAt + 1,
      seated: p.seated, level: p.level, practice,
    });
  },
  simulate(p = {}) {
    if (p.phase === 'free') {
      const interval = p.ibi || 500;
      for (let offset = 250; offset < p.durationMs; offset += interval) T.audio.sim.stomp(offset, 0.48);
      return;
    }
    if (!p.phase) {
      for (let index = 0; index < (p.count || 8) + (p.continuationCount || 8); index++) {
        T.audio.sim.stomp(250 + index * (p.ibi || 500), 0.48);
      }
      return;
    }
    if (p.phase === 'continue') {
      for (let index = 0; index < p.count; index++) {
        const onset = 250 + index * p.ibi;
        if (p.antiPhase) T.audio.sim.clap(onset + p.ibi / 2, 0.45);
        else T.audio.sim.stomp(onset, 0.48);
      }
      return;
    }
    (p.offsets || []).forEach((offset, index) => {
      const delay = offset + (p.antiPhase ? (p.ibis[index] / 2) : 0);
      if (p.antiPhase) T.audio.sim.clap(delay, 0.45);
      else T.audio.sim.stomp(delay, 0.48);
    });
  },
  version: 2,
});

function medianOf(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function wrapPhase(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function rayleighPValue(count, vectorLength) {
  const z = count * vectorLength ** 2;
  const correction = 1 + (2 * z - z ** 2) / (4 * count)
    - (24 * z - 132 * z ** 2 + 76 * z ** 3 - 9 * z ** 4) / (288 * count ** 2);
  return Math.max(0, Math.min(1, Math.exp(-z) * correction));
}
