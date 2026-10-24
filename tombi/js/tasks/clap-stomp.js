/* Alternating surface sequence. One microphone cannot identify which hand or side was used. */
T.tasks.register({
  key: 'clapStomp', name: 'כף-רגל / סיר-שולחן', domain: 'תזמון ורצף בילטרלי',
  slot: 'rhythm', arousal: 0, gross: false, jump: false,
  needs: { space: 0, hardFloor: true, standing: false, object: 'pot-table', quietRoom: false },
  modes: ['verbal', 'nonverbal'], minAge: 3, durationSec: { short: 40, full: 65 }, levels: 5,
  params(level = 1) { return { level, sequence: level < 3 ? ['clap', 'stomp', 'clap', 'stomp', 'clap', 'stomp'] : ['pot', 'table', 'pot', 'table', 'pot', 'table'] }; },
  run(ctx, p) {
    return (async () => {
      const sequence = p.short ? p.sequence.slice(0, 4) : p.sequence;
      const params = { ...p, sequence };
      await T.activity.start(ctx, { title: 'כף-רגל וסיר-שולחן', picture: p.level < 3 ? 'hands' : 'pot', intro: 'table_intro', instruction: 'table_go' });
      const practice = p.isNew ? await T.activity.practice(ctx, () => T.audio.sim.clap(250, 0.45), { minIoiMs: 130, minAboveFloor: 9 }) : null;
      const events = await T.activity.collect(ctx, { durationMs: sequence.length * 700 + 700, minIoiMs: 130, minAboveFloor: 9, simulate: () => T.tasks.get('clapStomp').simulate(params) });
      const classes = events.map((event) => event.cls);
      const expected = sequence;
      const errors = levenshtein(classes, expected);
      const sequenceAccuracy = Math.max(0, 1 - errors / expected.length);
      const confidentClasses = classes.filter((cls) => cls !== 'uncertain');
      const alternating = confidentClasses.length > 1 ? confidentClasses.slice(1).filter((cls, i) => cls !== confidentClasses[i]).length / (confidentClasses.length - 1) : 0;
      const times = events.map((event) => event.t), intervals = times.slice(1).map((t, i) => t - times[i]);
      const mean = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
      const cv = intervals.length && mean ? Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length) / mean : 1;
      const score = 100 * (0.6 * sequenceAccuracy + 0.25 * alternating + 0.15 * Math.max(0, 1 - cv / 0.4));
      await ctx.say(T.activity.line('table_praise3', ctx), `table_praise3_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.activity.result(events, score, { sequenceAccuracy, alternating, cvIoi: cv, sequence: classes, confidentOnsets: confidentClasses.length, note: 'המחלקות אינן מזהות איזו יד הקישה', level: p.level, practice });
    })();
  },
  simulate(p) {
    p.sequence.forEach((kind, i) => {
      const method = kind === 'clap' ? 'clap' : kind === 'pot' ? 'pot' : kind === 'table' ? 'table' : 'stomp';
      T.audio.sim[method](250 + i * 700, 0.5);
    });
  },
  version: 1,
});

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      const uncertain = a[i - 1] === 'uncertain';
      row[j] = Math.min(row[j] + (uncertain ? 0 : 1), row[j - 1] + 1, previous + (uncertain || a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
