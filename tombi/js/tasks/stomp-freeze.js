/* Gross-motor stop and restart task. */
T.tasks.register({
  key: 'stompFreeze', name: 'רוקעים ונעצרים', domain: 'עכבה ועצירה של תנועה',
  slot: 'arousal', arousal: 2, gross: true, jump: false,
  needs: { space: 1.5, hardFloor: true, standing: true, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 50, full: 90 }, levels: 5,
  params(level = 1, age = 5, child = {}) { return { level, age, seated: child.canStand === false, freezes: level === 1 ? 2 : 3, freezeMs: level === 1 ? 2000 : level === 5 ? 5000 : 3000 }; },
  run(ctx, p) {
    return (async () => {
      await T.activity.start(ctx, { title: 'רוקעים ונעצרים', picture: 'stop', intro: 'statue_intro', instruction: 'statue_go' });
      for (let i = 0; i < 8; i++) T.activity.beat(250 + i * 300);
      const started = T.audio.now(), events = await T.activity.collect(ctx, {
        durationMs: p.freezeMs + 6500, minIoiMs: 220, minAboveFloor: 12,
        simulate: () => Array.from({ length: 9 }, (_, i) => T.audio.sim.stomp(300 + i * 300, 0.5)),
      });
      const cut = started + 300 + 8 * 300;
      const freezeEvents = events.filter((event) => event.t >= cut + 400 && event.t <= cut + 400 + p.freezeMs);
      const goEvents = events.filter((event) => event.t < cut || event.t > cut + 400 + p.freezeMs);
      const stopLat = freezeEvents.length ? Math.max(0, freezeEvents[0].t - cut) : 0;
      const freezeOk = freezeEvents.length ? 0 : 1;
      const engage = Math.min(1, goEvents.length / 4);
      const score = 100 * (0.5 * freezeOk + 0.25 * Math.max(0, Math.min(1, 1 - (stopLat - 300) / 900)) + 0.25 * engage);
      await ctx.say(T.activity.line('statue_praise3', ctx), `statue_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(events, score, { stopLatMs: Math.round(stopLat), freezeEvents: freezeEvents.length, freezeOK: freezeOk, engage, seated: p.seated, level: p.level });
    })();
  },
  simulate(p) { for (let i = 0; i < 9; i++) T.audio.sim.stomp(300 + i * 300, 0.5); },
  version: 1,
});
