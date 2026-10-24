/* Relative force grading with heavy and quiet footstep sequences. */
T.tasks.register({
  key: 'elephantMouse', name: 'רגלי פיל ורגלי עכבר', domain: 'דירוג כוח וויסות תנועה',
  slot: 'grading', arousal: 0, gross: true, jump: false,
  needs: { space: 1, hardFloor: true, standing: true, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 45, full: 70 }, levels: 5,
  params(level = 1, age = 5, child = {}) { return { level, age, seated: child.canStand === false }; },
  run(ctx, p) {
    return (async () => {
      await T.activity.start(ctx, { title: 'רגלי פיל ורגלי עכבר', picture: 'foot', intro: 'elephant_intro', instruction: 'elephant_go' });
      const durationMs = p.short ? 5000 : 7000;
      const started = T.audio.now();
      const events = await T.activity.collect(ctx, { durationMs, minIoiMs: 220, minAboveFloor: 6, simulate: () => T.tasks.get('elephantMouse').simulate({ ...p, durationMs }) });
      const midpoint = started + durationMs / 2, elephant = events.filter((event) => event.t < midpoint), mouse = events.filter((event) => event.t >= midpoint);
      const median = (list) => {
        const values = list.map((event) => event.peakDb).sort((a, b) => a - b);
        return values.length ? values[Math.floor(values.length / 2)] : null;
      };
      const elephantDb = median(elephant), mouseDb = median(mouse);
      const contrast = elephantDb !== null && mouseDb !== null ? elephantDb - mouseDb : 0;
      let wins = 0, pairs = 0;
      elephant.forEach((heavy) => mouse.forEach((quiet) => {
        wins += heavy.peakDb > quiet.peakDb ? 1 : heavy.peakDb === quiet.peakDb ? 0.5 : 0;
        pairs++;
      }));
      const separation = pairs ? wins / pairs : 0.5;
      const groupSpread = (list) => {
        const center = median(list);
        return list.length ? Math.sqrt(list.reduce((sum, event) => sum + (event.peakDb - center) ** 2, 0) / list.length) : null;
      };
      const spreads = [groupSpread(elephant), groupSpread(mouse)].filter(Number.isFinite);
      const spread = spreads.length ? Math.sqrt(spreads.reduce((sum, value) => sum + value ** 2, 0) / spreads.length) : 10;
      const score = 100 * (0.5 * Math.min(1, Math.max(0, contrast) / 12) + 0.3 * Math.max(0, (separation - 0.5) / 0.5) + 0.2 * Math.max(0, 1 - spread / 6));
      await ctx.say(T.activity.line('elephant_mouse', ctx), `elephant_mouse_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      await ctx.say(T.activity.line('elephant_praise3', ctx), `elephant_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(events, score, { elephantDb, mouseDb, contrastDb: contrast, separation, spreadDb: spread, seated: p.seated, level: p.level });
    })();
  },
  simulate(p = {}) {
    for (let i = 0; i < 4; i++) T.audio.sim.stomp(250 + i * 450, 0.68);
    const secondPhase = p.durationMs ? p.durationMs / 2 + 250 : 3750;
    for (let i = 0; i < 4; i++) T.audio.sim.stomp(secondPhase + i * (p.durationMs ? 350 : 550), 0.28);
  },
  version: 1,
});
