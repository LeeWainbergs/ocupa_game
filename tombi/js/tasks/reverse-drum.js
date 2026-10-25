/* Luria-style response-count conflict task. */
function reverseDrumTrials(params, itemCount) {
  const intervals = Array.from({ length: itemCount }, (_, index) =>
    params.trialIntervals?.[index] || params.intervalMs);
  let startMs = 0;
  return params.sequence.slice(0, itemCount).map((modelCount, index) => {
    const responseStartMs = startMs + (modelCount - 1) * 160 + 150;
    const responseEndMs = Math.min(responseStartMs + params.responseWindowMs, startMs + intervals[index]);
    const scored = params.level === 1 || index >= 2;
    const inverted = params.level >= 2 && scored;
    const trial = {
      index, startMs, intervalMs: intervals[index], modelCount,
      targetCount: inverted ? 3 - modelCount : modelCount,
      responseStartMs, responseEndMs, responseWindowMs: responseEndMs - responseStartMs,
      scored, inverted,
    };
    startMs += intervals[index];
    return trial;
  });
}

function scoreReverseDrumEvents(events, trials, sessionStart) {
  return trials.map((trial) => {
    const count = events.filter((event) =>
      event.t >= sessionStart + trial.responseStartMs
      && event.t < sessionStart + trial.responseEndMs).length;
    return {
      target: trial.modelCount,
      targetCount: trial.targetCount,
      count,
      correct: count === trial.targetCount,
      responseWindowMs: trial.responseWindowMs,
      scored: trial.scored,
      inverted: trial.inverted,
    };
  });
}

T.tasks.register({
  key: 'reverseDrum', name: 'התוף ההפוך', domain: 'עכבה ותכנון מוטורי',
  slot: 'inhibition', arousal: 0, gross: false, jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 60, full: 90 }, levels: 5,
  params(level = 1, age, child) { return T.levels.params('reverseDrum', level, child || { age }); },
  run(ctx, p) {
    return (async () => {
      p = { ...T.levels.params('reverseDrum', p.level, ctx.child), ...p };
      const itemCount = p.short ? Math.min(8, p.items) : p.items;
      await T.activity.start(ctx, {
        title: 'התוף ההפוך', picture: 'hands',
        intro: p.level === 1 ? 'reverse_imitation_intro' : 'reverse_intro',
        instruction: p.level === 1 ? 'reverse_imitation_go' : 'reverse_rule_intro',
      });
      const practice = p.isNew ? await T.activity.practice(ctx, () => T.audio.sim.clap(250, 0.45), { minIoiMs: 130, minAboveFloor: 9 }) : null;
      const sequence = p.sequence.slice(0, itemCount);
      const trials = reverseDrumTrials(p, itemCount);
      if (p.visualCue) document.getElementById('task').textContent = T.activity.line('reverse_visual_cue', ctx);
      const start = T.audio.now();
      trials.forEach((trial) => {
        const count = trial.modelCount;
        for (let beat = 0; beat < count; beat++) {
          T.activity.beat(trial.startMs + beat * 160, { low: true, gate: true });
        }
      });
      const events = await T.activity.collect(ctx, {
        durationMs: trials.reduce((sum, trial) => sum + trial.intervalMs, 0), minIoiMs: 130, minAboveFloor: 9,
        simulate: () => T.tasks.get('reverseDrum').simulate({ ...p, sequence, items: itemCount }),
      });
      const results = scoreReverseDrumEvents(events, trials, start);
      const scoredResults = results.filter((item) => item.scored);
      const correct = scoredResults.filter((item) => item.correct).length;
      await ctx.say(T.activity.line('reverse_praise3', ctx), `reverse_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(events, 100 * correct / Math.max(1, scoredResults.length), {
        items: results, correctCount: correct, scoredItemCount: scoredResults.length,
        itemCount, pretestCorrectCount: results.slice(0, 2).filter((item) => item.correct).length,
        imitationErrors: scoredResults.filter((item) => item.inverted && item.count === item.target).length,
        otherErrors: scoredResults.filter((item) => item.count !== item.target && item.count !== item.targetCount).length,
        level: p.level, mode: p.level >= 2 ? 'reverse' : 'imitation', practice,
      });
    })();
  },
  simulate(p) {
    const trials = reverseDrumTrials(p, Math.min(p.items, p.sequence.length));
    trials.forEach((trial) => {
      const responseCount = trial.targetCount;
      const lastCueMs = (trial.modelCount - 1) * 160;
      for (let clap = 0; clap < responseCount; clap++) {
        T.audio.sim.clap(trial.startMs + lastCueMs + 350 + clap * 260, 0.48);
      }
    });
  },
  scoreEvents: scoreReverseDrumEvents,
  trials: reverseDrumTrials,
  version: 1,
});
