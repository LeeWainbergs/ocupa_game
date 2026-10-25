/* Relative force grading with heavy and quiet footstep sequences. */
T.tasks.register({
  key: 'elephantMouse', name: 'רגלי פיל ורגלי עכבר', domain: 'דירוג כוח וויסות תנועה',
  slot: 'grading', arousal: 0, gross: true, jump: false,
  needs: { space: 1, hardFloor: true, standing: true, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 45, full: 70 }, levels: 5,
  params(level = 1, age = 5, child = {}) { return { level, age, seated: child.canStand === false, rounds: { short: 2, full: 4 } }; },
  run(ctx, p) {
    return (async () => {
      await T.activity.start(ctx, { title: 'רגלי פיל ורגלי עכבר', picture: 'foot', intro: 'elephant_intro', instruction: 'elephant_go' });
      const practice = p.isNew ? await T.activity.practice(ctx, () => T.audio.sim.stomp(250, 0.55), { minIoiMs: 220, minAboveFloor: 6 }) : null;
      const durationMs = p.short ? 5000 : 7000;
      const roundCount = p.rounds[p.short ? 'short' : 'full'];
      const median = (list) => {
        const values = list.map((event) => event.peakDb).sort((a, b) => a - b);
        return values.length ? values[Math.floor(values.length / 2)] : null;
      };
      const groupSpread = (list) => {
        const center = median(list);
        return list.length ? Math.sqrt(list.reduce((sum, event) => sum + (event.peakDb - center) ** 2, 0) / list.length) : null;
      };
      const rounds = [];
      for (let index = 0; index < roundCount; index++) {
        if (index) await ctx.say(T.activity.line('elephant_go', ctx), `elephant_round_${index + 1}_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
        const started = T.audio.now();
        const events = await T.activity.collect(ctx, {
          durationMs, minIoiMs: 220, minAboveFloor: 6,
          simulate: () => T.tasks.get('elephantMouse').simulate({ ...p, durationMs }),
        });
        const midpoint = started + durationMs / 2;
        const elephant = events.filter((event) => event.t < midpoint), mouse = events.filter((event) => event.t >= midpoint);
        const elephantDb = median(elephant), mouseDb = median(mouse);
        const contrast = elephantDb !== null && mouseDb !== null ? elephantDb - mouseDb : 0;
        let wins = 0, pairs = 0;
        elephant.forEach((heavy) => mouse.forEach((quiet) => {
          wins += heavy.peakDb > quiet.peakDb ? 1 : heavy.peakDb === quiet.peakDb ? 0.5 : 0;
          pairs++;
        }));
        const separation = pairs ? wins / pairs : 0.5;
        const spreads = [groupSpread(elephant), groupSpread(mouse)].filter(Number.isFinite);
        const spread = spreads.length ? Math.sqrt(spreads.reduce((sum, value) => sum + value ** 2, 0) / spreads.length) : 10;
        const score = 100 * (0.5 * Math.min(1, Math.max(0, contrast) / 12) + 0.3 * Math.max(0, (separation - 0.5) / 0.5) + 0.2 * Math.max(0, 1 - spread / 6));
        rounds.push({ events, elephantDb, mouseDb, contrastDb: contrast, separation, spreadDb: spread, score });
      }
      const events = rounds.flatMap((round) => round.events);
      const average = (key) => rounds.reduce((sum, round) => sum + round[key], 0) / rounds.length;
      const center = (key) => median(rounds.map((round) => ({ peakDb: round[key] })).filter((event) => Number.isFinite(event.peakDb)));
      const elephantDb = center('elephantDb'), mouseDb = center('mouseDb');
      const contrast = elephantDb !== null && mouseDb !== null ? elephantDb - mouseDb : 0;
      const separation = average('separation'), spread = average('spreadDb'), score = average('score');
      await ctx.say(T.activity.line('elephant_mouse', ctx), `elephant_mouse_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      await ctx.say(T.activity.line('elephant_praise3', ctx), `elephant_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(events, score, {
        elephantDb, mouseDb, contrastDb: contrast, separation, spreadDb: spread,
        rounds: rounds.map(({ events: roundEvents, ...round }) => ({ ...round, onsetCount: roundEvents.length })),
        seated: p.seated, level: p.level, practice,
      });
    })();
  },
  simulate(p = {}) {
    for (let i = 0; i < 4; i++) T.audio.sim.stomp(250 + i * 450, 0.68);
    const secondPhase = p.durationMs ? p.durationMs / 2 + 250 : 3750;
    for (let i = 0; i < 4; i++) T.audio.sim.stomp(secondPhase + i * (p.durationMs ? 350 : 550), 0.28);
  },
  version: 1,
});
