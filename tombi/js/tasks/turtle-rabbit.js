/* Motor tempo-shifting task: quick rabbit steps, then deliberately slow turtle steps. */
T.tasks.register({
  key: 'turtleRabbit', name: 'צב וארנב', domain: 'ויסות טמפו מוטורי',
  slot: 'transition', arousal: -1, gross: true, jump: false,
  needs: { space: 1, hardFloor: true, standing: true, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 35, full: 55 }, levels: 5,
  params(level = 1, age = 5, child = {}) { return { level, age, seated: child.canStand === false, phaseMs: level > 2 ? 18000 : 14000 }; },
  run(ctx, p) {
    return (async () => {
      const phaseMs = p.short ? Math.min(10000, p.phaseMs) : p.phaseMs;
      await T.activity.start(ctx, { title: 'צב וארנב', picture: 'animals', intro: 'turtle_intro', instruction: 'turtle_go' });
      const practice = p.isNew ? await T.activity.practice(ctx, () => T.audio.sim.stomp(250, 0.42), { minIoiMs: 220, minAboveFloor: 9 }) : null;
      const started = T.audio.now();
      const events = await T.activity.collect(ctx, {
        durationMs: phaseMs * 2 + 500,
        minIoiMs: 220,
        minAboveFloor: 9,
        simulate: () => T.tasks.get('turtleRabbit').simulate({ ...p, phaseMs }),
      });
      const split = started + phaseMs + 250;
      const rabbit = events.filter((event) => event.t < split), turtle = events.filter((event) => event.t >= split);
      const intervals = (list) => list.slice(1).map((event, i) => event.t - list[i].t);
      const fast = intervals(rabbit), slow = intervals(turtle);
      const smt = fast.length ? fast.sort((a, b) => a - b)[Math.floor(fast.length / 2)] : null;
      const slowMedian = slow.length ? slow.sort((a, b) => a - b)[Math.floor(slow.length / 2)] : null;
      const slowRatio = smt && slowMedian ? slowMedian / smt : 0;
      const mean = slow.length ? slow.reduce((sum, value) => sum + value, 0) / slow.length : 0;
      const slowCv = slow.length && mean ? Math.sqrt(slow.reduce((sum, value) => sum + (value - mean) ** 2, 0) / slow.length) / mean : 1;
      const hold = slow.length && smt ? slow.filter((interval) => interval >= 1.3 * smt).length / slow.length : 0;
      const score = 100 * (0.6 * Math.min(1, Math.max(0, slowRatio - 1)) + 0.25 * hold + 0.15 * Math.max(0, 1 - slowCv / 0.5));
      await ctx.say(T.activity.line('turtle_slow', ctx), `turtle_slow_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      await ctx.say(T.activity.line('turtle_praise3', ctx), `turtle_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(events, score, { smtMs: smt, slowRatio, slowCv, hold, seated: p.seated, level: p.level, practice });
    })();
  },
  simulate(p) {
    const fastInterval = 360;
    const fastCount = Math.max(9, Math.floor(p.phaseMs / fastInterval));
    for (let i = 0; i < fastCount; i++) T.audio.sim.stomp(200 + i * fastInterval, 0.48);
    const slowInterval = 850;
    const slowCount = Math.max(6, Math.floor(p.phaseMs / slowInterval));
    for (let i = 0; i < slowCount; i++) T.audio.sim.stomp(p.phaseMs + 300 + i * slowInterval, 0.42);
  },
  version: 1,
});
