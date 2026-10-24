/* Ball-bounce pacing task. */
T.tasks.register({
  key: 'ball', name: 'כדור הדרקון', domain: 'דירוג כוח ותיאום עין-יד',
  slot: 'grading', arousal: 0, gross: false, jump: false,
  needs: { space: 1, hardFloor: false, standing: false, object: 'ball', quietRoom: true },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 45, full: 70 }, levels: 5,
  params(level = 1) { return { level, target: level < 3 ? 4 : 6 }; },
  run(ctx, p) {
    return (async () => {
      await T.activity.start(ctx, { title: 'כדור הדרקון', picture: 'egg', intro: 'ball_intro', instruction: 'ball_go' });
      const practice = p.isNew ? await T.activity.practice(ctx, () => T.audio.sim.ball(250, 0.42), { minIoiMs: 200, minAboveFloor: 10 }) : null;
      const events = await T.activity.collect(ctx, { durationMs: p.short ? 5000 : 8000, minIoiMs: 200, minAboveFloor: 10, simulate: () => T.tasks.get('ball').simulate(p) });
      const fell = T.dsp.ballFell(events);
      const iois = events.slice(1).map((event, i) => event.t - events[i].t);
      const mean = iois.length ? iois.reduce((sum, value) => sum + value, 0) / iois.length : 0;
      const cv = iois.length && mean ? Math.sqrt(iois.reduce((sum, value) => sum + (value - mean) ** 2, 0) / iois.length) / mean : 1;
      const levels = events.map((event) => event.peakDb), avg = levels.length ? levels.reduce((sum, value) => sum + value, 0) / levels.length : 0;
      const sd = levels.length ? Math.sqrt(levels.reduce((sum, value) => sum + (value - avg) ** 2, 0) / levels.length) : 10;
      const score = 100 * (0.6 * Math.min(1, events.length / p.target) + 0.2 * Math.max(0, 1 - cv / 0.4) + 0.2 * Math.max(0, 1 - sd / 6));
      await ctx.say(T.activity.line('ball_praise3', ctx), `ball_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(events, score, { streak: fell ? Math.min(events.length, 2) : events.length, target: p.target, ballFell: fell, cvIoi: cv, peakDbSd: sd, level: p.level, practice });
    })();
  },
  simulate(p) {
    for (let i = 0; i < p.target + 2; i++) T.audio.sim.ball(250 + i * (i > 4 ? 450 : 700), Math.max(0.2, 0.52 - i * 0.025));
  },
  version: 1,
});
