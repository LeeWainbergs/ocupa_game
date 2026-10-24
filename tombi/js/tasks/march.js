/* Beat synchronisation and continuation task. */
T.tasks.register({
  key: 'march', name: 'מצעד הדרקון', domain: 'תזמון וסנכרון מוטורי',
  slot: 'rhythm', arousal: 1, gross: true, jump: false,
  needs: { space: 1, hardFloor: true, standing: true, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 45, full: 70 }, levels: 5,
  params(level = 1, age = 5, child = {}) { return { level, age, seated: child.canStand === false, ibi: age < 5 ? 425 : 500, count: level < 3 ? 8 : 12 }; },
  run(ctx, p) {
    return (async () => {
      const count = p.short ? Math.max(4, Math.ceil(p.count * 0.6)) : p.count;
      const continuationCount = p.short ? 4 : 8;
      await T.activity.start(ctx, { title: 'מצעד הדרקון', picture: 'foot', intro: 'march_intro', instruction: 'march_go' });
      const started = T.audio.now();
      const beats = Array.from({ length: count }, (_, i) => T.activity.beat(250 + i * p.ibi) * 1000);
      const events = await T.activity.collect(ctx, {
        durationMs: (count + continuationCount) * p.ibi + 1000,
        minIoiMs: 220,
        minAboveFloor: 9,
        simulate: () => T.tasks.get('march').simulate({ ...p, count, continuationCount }),
      });
      const steps = events.slice(2);
      const intervals = steps.slice(1).map((event, i) => event.t - steps[i].t);
      const median = intervals.length ? intervals.slice().sort((a, b) => a - b)[Math.floor(intervals.length / 2)] : 0;
      const mean = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
      const cv = intervals.length && mean ? Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length) / mean : 1;
      const tempoMatch = median ? median / p.ibi : 0;
      const loopbackMs = T.audio.loopbackMs || 0;
      const phases = steps.flatMap((event) => {
        const nearestIndex = Math.round((event.t - (beats[0] + loopbackMs)) / p.ibi);
        if (nearestIndex < 0 || nearestIndex >= beats.length) return [];
        return [2 * Math.PI * (event.t - (beats[nearestIndex] + loopbackMs)) / p.ibi];
      });
      const vectorX = phases.reduce((sum, phase) => sum + Math.cos(phase), 0) / Math.max(1, phases.length);
      const vectorY = phases.reduce((sum, phase) => sum + Math.sin(phase), 0) / Math.max(1, phases.length);
      const vectorLength = Math.sqrt(vectorX ** 2 + vectorY ** 2);
      const hitWindow = p.age < 5 ? 0.25 : 0.2;
      const hitPercent = phases.length
        ? phases.filter((phase) => Math.abs(Math.atan2(Math.sin(phase), Math.cos(phase))) / (2 * Math.PI) <= hitWindow).length / phases.length
        : 0;
      const continuationStart = started + 250 + count * p.ibi;
      const continuation = steps.filter((event) => event.t >= continuationStart);
      const continuationIntervals = continuation.slice(1).map((event, i) => event.t - continuation[i].t);
      const xMean = (continuationIntervals.length - 1) / 2;
      const yMean = continuationIntervals.length ? continuationIntervals.reduce((sum, value) => sum + value, 0) / continuationIntervals.length : 0;
      const denominator = continuationIntervals.reduce((sum, _, i) => sum + (i - xMean) ** 2, 0);
      const drift = denominator ? continuationIntervals.reduce((sum, value, i) => sum + (i - xMean) * (value - yMean), 0) / denominator : 0;
      const tempoScore = Math.max(0, 1 - Math.abs(tempoMatch - 1) / 0.25);
      const continuationScore = Math.max(0, 1 - Math.abs(drift) / (0.05 * p.ibi));
      const score = 100 * (0.35 * tempoScore + 0.35 * vectorLength + 0.15 * hitPercent + 0.15 * continuationScore);
      await ctx.say(T.activity.line('march_praise3', ctx), `march_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(events, score, {
        ibiMs: p.ibi, medianItiMs: median || null, tempoMatch, cvIti: cv,
        phaseVectorLength: vectorLength, meanAsynchronyMs: phases.length ? Math.atan2(vectorY, vectorX) * p.ibi / (2 * Math.PI) : null,
        hitPercent, continuationSteps: continuation.length, continuationDriftMsPerStep: drift,
        seated: p.seated, level: p.level,
      });
    })();
  },
  simulate(p) {
    for (let i = 0; i < p.count + p.continuationCount; i++) T.audio.sim.stomp(250 + i * (p.ibi + (i % 3 - 1) * 25), 0.48);
  },
  version: 1,
});
