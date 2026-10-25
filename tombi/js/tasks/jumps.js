/* Jump landing count and stop-at-target task. */
T.tasks.register({
  key: 'jumps', name: 'קפיצות הדרקון', domain: 'תכנון מוטורי וקואורדינציה דו-רגלית',
  slot: 'arousal', arousal: 2, gross: true, jump: true,
  needs: { space: 1.5, hardFloor: true, standing: true, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 45, full: 75 }, levels: 5,
  params(level = 1) {
    return {
      level, target: level === 1 ? 3 : 5, intervalMs: level >= 3 ? 800 : null,
      rounds: { short: 2, full: 4 },
    };
  },
  run(ctx, p) {
    return (async () => {
      await T.activity.start(ctx, { title: 'קפיצות הדרקון', picture: 'cloud', intro: 'jump_intro', instruction: 'jump_go' });
      const practice = p.isNew ? await T.activity.practice(ctx, () => T.audio.sim.jumpLanding(250, 0.45), { minIoiMs: 300, minAboveFloor: 12 }) : null;
      const roundCount = p.rounds[p.short ? 'short' : 'full'];
      const rounds = [];
      for (let index = 0; index < roundCount; index++) {
        if (index) await ctx.say(T.activity.line('jump_go', ctx), `jump_round_${index + 1}_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
        const events = await T.activity.collect(ctx, {
          durationMs: p.short ? 6000 : 8000, minIoiMs: 300, minAboveFloor: 12,
          simulate: () => T.tasks.get('jumps').simulate(p),
        });
        const landings = T.dsp.mergeLandings(events.filter((event) => event.cls === 'landing' || event.cls === 'stomp' || event.cls === 'ball'), 120);
        const countErr = Math.abs(landings.length - p.target), overshoot = Math.max(0, landings.length - p.target);
        const iois = landings.slice(1).map((event, i) => event.t - landings[i].t);
        const mean = iois.length ? iois.reduce((sum, value) => sum + value, 0) / iois.length : 0;
        const cv = iois.length && mean ? Math.sqrt(iois.reduce((sum, value) => sum + (value - mean) ** 2, 0) / iois.length) / mean : 0;
        const score = 100 * (0.5 * Math.max(0, 1 - countErr / p.target) + 0.2 * (overshoot === 0 ? 1 : 0) + 0.3 * Math.max(0, 1 - cv / 0.4));
        rounds.push({ events: landings, count: landings.length, countErr, overshoot, cvIoi: cv, score });
      }
      const landings = rounds.flatMap((round) => round.events);
      const score = rounds.reduce((sum, round) => sum + round.score, 0) / rounds.length;
      const countErr = rounds.reduce((sum, round) => sum + round.countErr, 0);
      const overshoot = rounds.reduce((sum, round) => sum + round.overshoot, 0);
      const cv = rounds.reduce((sum, round) => sum + round.cvIoi, 0) / rounds.length;
      await ctx.say(T.activity.line('jump_praise3', ctx), `jump_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(landings, score, {
        count: landings.length, target: p.target, targetTotal: p.target * roundCount,
        countErr, overshoot, cvIoi: cv,
        rounds: rounds.map(({ events, ...round }) => round),
        level: p.level, practice,
      });
    })();
  },
  simulate(p) { for (let i = 0; i < p.target; i++) T.audio.sim.jumpLanding(250 + i * (p.intervalMs || 650), 0.55); },
  version: 1,
});
