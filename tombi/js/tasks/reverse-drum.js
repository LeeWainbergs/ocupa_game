/* Luria-style response-count conflict task. */
T.tasks.register({
  key: 'reverseDrum', name: 'התוף ההפוך', domain: 'עכבה ותכנון מוטורי',
  slot: 'inhibition', arousal: 0, gross: false, jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 60, full: 90 }, levels: 5,
  params(level = 1) { return { level, items: level === 1 ? 8 : 16, sequence: [2, 1, 2, 2, 1, 1, 1, 2, 1, 2, 2, 1, 1, 2, 2, 1] }; },
  run(ctx, p) {
    return (async () => {
      const itemCount = p.short ? Math.min(8, p.items) : p.items;
      await T.activity.start(ctx, { title: 'התוף ההפוך', picture: 'hands', intro: 'reverse_intro', instruction: 'reverse_go' });
      const practice = p.isNew ? await T.activity.practice(ctx, () => T.audio.sim.clap(250, 0.45), { minIoiMs: 130, minAboveFloor: 9 }) : null;
      p.sequence.slice(0, itemCount).forEach((hits, i) => {
        const count = p.level === 1 ? hits : 3 - hits;
        for (let j = 0; j < count; j++) T.activity.beat(i * 850 + j * 160, { low: true, gate: true });
      });
      const total = itemCount * 850;
      const events = await T.activity.collect(ctx, { durationMs: total, minIoiMs: 130, minAboveFloor: 9, simulate: () => T.tasks.get('reverseDrum').simulate({ ...p, items: itemCount }) });
      const correctCounts = [];
      const seq = p.sequence.slice(0, itemCount);
      for (let i = 0; i < seq.length; i++) {
        const count = events.filter((event) => event.t >= i * 850 + 350 && event.t < (i + 1) * 850).length;
        const targetCount = p.level === 1 ? seq[i] : 3 - seq[i];
        correctCounts.push({ target: seq[i], targetCount, count, correct: count === targetCount });
      }
      const correct = correctCounts.filter((item) => item.correct).length;
      await ctx.say(T.activity.line('reverse_praise3', ctx), `reverse_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(events, 100 * correct / Math.max(1, correctCounts.length), { items: correctCounts, correctCount: correct, imitationErrors: p.level === 1 ? 0 : correctCounts.filter((item) => item.count === item.target).length, level: p.level, practice });
    })();
  },
  simulate(p) {
    p.sequence.slice(0, p.items).forEach((target, i) => {
      const count = p.level === 1 ? target : 3 - target;
      for (let j = 0; j < count; j++) T.audio.sim.clap(i * 850 + 350 + j * 260, 0.48);
    });
  },
  version: 1,
});
