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
      const practice = p.isNew ? await T.activity.practice(ctx, () => T.audio.sim.stomp(250, 0.45), { minIoiMs: 220, minAboveFloor: 12 }) : null;
      const trials = [];
      const freezeCount = p.short ? 1 : p.freezes;
      for (let i = 0; i < freezeCount; i++) {
        const beats = p.level === 1 ? 8 : 5 + Math.floor(Math.random() * 8);
        for (let beat = 0; beat < beats; beat++) T.activity.beat(250 + beat * 300);
        const goDurationMs = beats * 300 + 450;
        const goEvents = await T.activity.collect(ctx, {
          durationMs: goDurationMs, minIoiMs: 220, minAboveFloor: 12,
          simulate: () => Array.from({ length: Math.max(2, Math.ceil(beats / 2)) }, (_, step) => T.audio.sim.stomp(300 + step * 550, 0.5)),
        });
        await ctx.say(T.activity.line('statue_freeze', ctx), `statue_freeze_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
        const stopAt = T.audio.now();
        const graceMs = p.level === 1 ? 600 : 400;
        const freezeEvents = await T.activity.collect(ctx, {
          durationMs: graceMs + p.freezeMs, minIoiMs: 220, minAboveFloor: 12,
          simulate: () => {},
        });
        const scoredFreezeEvents = freezeEvents.filter((event) => event.t >= stopAt + graceMs);
        const stopLat = freezeEvents.length ? Math.max(0, freezeEvents[freezeEvents.length - 1].t - stopAt) : 0;
        await ctx.say(T.activity.line('statue_go', ctx), `statue_go_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
        const restartAt = T.audio.now();
        const restartEvents = await T.activity.collect(ctx, {
          durationMs: 1500, minIoiMs: 220, minAboveFloor: 12,
          simulate: () => T.audio.sim.stomp(350, 0.5),
        });
        const restart = restartEvents.find((event) => event.t >= restartAt);
        trials.push({
          beats, stopLatMs: Math.round(stopLat), comm: scoredFreezeEvents.length,
          freezeOK: scoredFreezeEvents.length === 0,
          restartLatMs: restart ? Math.round(restart.t - restartAt) : null,
          goCount: goEvents.length, events: [...goEvents, ...freezeEvents, ...restartEvents],
        });
      }
      const freezeOk = trials.filter((trial) => trial.freezeOK).length / Math.max(1, trials.length);
      const stopLat = Math.max(0, ...trials.map((trial) => trial.stopLatMs));
      const engage = Math.min(1, trials.reduce((sum, trial) => sum + trial.goCount, 0)
        / Math.max(1, trials.reduce((sum, trial) => sum + trial.beats * 0.5, 0)));
      const score = 100 * (0.5 * freezeOk + 0.25 * Math.max(0, Math.min(1, 1 - (stopLat - 300) / 900)) + 0.25 * engage);
      await ctx.say(T.activity.line('statue_praise3', ctx), `statue_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      const events = trials.flatMap((trial) => trial.events);
      return T.activity.result(events, score, {
        stopLatMs: stopLat, freezeEvents: trials.reduce((sum, trial) => sum + trial.comm, 0),
        freezeOK: freezeOk, engage, restartLatMs: trials.map((trial) => trial.restartLatMs),
        trials, seated: p.seated, level: p.level, practice,
      });
    })();
  },
  simulate(p = {}) { for (let i = 0; i < Math.max(2, Math.ceil((p.beats || 8) / 2)); i++) T.audio.sim.stomp(300 + i * 550, 0.5); },
  version: 1,
});
