/* snake.js — sustained quiet-sound task definition. */
T.tasks.register({
  key: 'snake',
  name: 'נחש שקט',
  domain: 'ויסות נשימה',
  slot: 'calm',
  arousal: -1,
  gross: false,
  jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],
  minAge: 3,
  durationSec: { short: 50, full: 90 },
  levels: 5,
  params(level, age, child) { return T.levels.params('snake', level, child || { age }); },
  async run(ctx, p) {
    const box = ctx.taskBox();
    box.innerHTML = `<div class="snake"><div class="snake-track"><div class="snake-body"><span class="snake-head" aria-hidden="true">🐍</span></div></div><div class="snake-time" aria-live="polite">0.0 שניות</div><div class="snake-trials"></div></div>`;
    const body = box.querySelector('.snake-body'), time = box.querySelector('.snake-time'), trials = box.querySelector('.snake-trials');
    const level = p.level || T.levels.get(ctx.child, 'snake');
    const target = (T.store.settings.snakeTarget || 0) || p.targetSeconds || T.levels.params('snake', level, ctx.child).targetSeconds;
    const line = (key) => T.lines.get(key, ctx.child.gender, ctx.nonverbal);
    await ctx.say(line('snake_intro'), `snake_intro_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
    await T.tombi.hiss(1600);
    const previousGap = T.audio.cfg.gapMs;
    T.audio.cfg.gapMs = 250;
    const durations = [];
    const stabilityDb = [];
    const sibilance = [];
    let breakCount = 0, clipped = false;
    try {
      for (let i = 0; i < 3; i++) {
        body.style.setProperty('--len', 0);
        time.textContent = '0.0 שניות';
        const instruction = i === 0 ? 'snake_go' : 'snake_encourage';
        await ctx.say(line(instruction), `snake_trial_${i}_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
        if (T.audio.mode === 'sim') T.tasks.get('snake').simulate({ targetSeconds: Math.max(1, target - i * 0.5) });
        let segmentStart = null;
        const response = await ctx.listen({
          maxMs: 20000, startTimeoutMs: 8000, endSilenceMs: 700, minDurMs: 200,
          onLive: (type, event) => {
            if (type === 'onset' && segmentStart === null) segmentStart = event.t;
            if (type === 'frame' && event.clipped) {
              clipped = true;
              T.ui.flash('הצליל חזק מדי למיקרופון — להתרחק ממנו מעט');
            }
            if (type === 'frame' && segmentStart !== null) {
              const seconds = (event.t - segmentStart) / 1000;
              body.style.setProperty('--len', Math.min(1, seconds / Math.max(target * 1.5, 6)));
              time.textContent = `${seconds.toFixed(1)} שניות`;
            }
            if (type === 'segment') segmentStart = null;
          },
        });
        const validSegments = response.segments.filter((segment) => {
          if (segment.manual || segment.levelDb - segment.floorDb < 10) return false;
          const features = T.dsp.sibilanceFeatures(T.audio.grab(segment.start, segment.end));
          const valid = features.highBandRatio > 0.5 && features.zcr > 0.1 && features.f0Hz === 0;
          if (valid) sibilance.push(features.highBandRatio);
          return valid;
        });
        breakCount += Math.max(0, validSegments.length - 1);
        const longest = validSegments.reduce((best, segment) => !best || segment.dur > best.dur ? segment : best, null);
        const duration = longest ? longest.dur / 1000 : 0;
        if (longest) {
          const middleStart = longest.start + longest.dur * 0.1, middleEnd = longest.end - longest.dur * 0.1;
          const levels = T.audio.framesBetween(middleStart, middleEnd).map((frame) => frame.db);
          const meanLevel = levels.length ? levels.reduce((sum, value) => sum + value, 0) / levels.length : 0;
          stabilityDb.push(levels.length ? Math.sqrt(levels.reduce((sum, value) => sum + (value - meanLevel) ** 2, 0) / levels.length) : null);
        } else stabilityDb.push(null);
        durations.push(+duration.toFixed(2));
        time.textContent = `${duration.toFixed(1)} שניות`;
        trials.insertAdjacentHTML('beforeend', `<span class="chip">${duration.toFixed(1)} ש׳</span>`);
        if (duration > 0) {
          T.tombi.chime('good'); T.tombi.happy();
          await ctx.say(duration >= target ? 'וואו, איזה נחש ארוך!' : ctx.praise(), duration >= target ? 'snake_long' : ctx.lastPraiseKey);
        }
      }
    } finally { T.audio.cfg.gapMs = previousGap; }
    const valid = durations.filter((duration) => duration > 0);
    const mean = valid.length ? valid.reduce((sum, duration) => sum + duration, 0) / valid.length : 0;
    const best = Math.max(0, ...durations);
    const variance = durations.length ? durations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / durations.length : 0;
    const bestStabilityDb = stabilityDb[durations.indexOf(best)] ?? null;
    return {
      durations, best, mean: +mean.toFixed(2), trialSd: +Math.sqrt(variance).toFixed(2),
      targetSec: target, bestStabilityDb, sibilanceRatio: sibilance.length ? sibilance.reduce((sum, value) => sum + value, 0) / sibilance.length : null,
      clipped,
      score: Math.round(Math.min(100, (best / target) * 100) * Math.max(0.6, 1 - breakCount * 0.1)),
      breakCount,
      confidence: valid.length / durations.length,
    };
  },
  simulate(p = {}) {
    T.audio.sim.hiss(Math.max(300, (Number(p.targetSeconds) || 4) * 1000), 0.15);
  },
  version: 1,
});
