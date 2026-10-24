/* Go/no-go inhibition task with an age-safe lure ladder. */
T.tasks.register({
  key: 'magic',
  name: 'מילת הקסם',
  domain: 'קשב ועכבה',
  slot: 'inhibition',
  arousal: 0,
  gross: false,
  jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],
  minAge: 3,
  durationSec: { short: 60, full: 120 },
  levels: 5,
  params(level, age, child) { return T.levels.params('magic', level, child || { age }); },
  async run(ctx, p) {
    const box = ctx.taskBox();
    const level = p.level || T.levels.get(ctx.child, 'magic');
    const params = { ...T.levels.params('magic', level, ctx.child), ...p };
    const items = params.short ? params.items.slice(0, 8) : params.items;
    box.innerHTML = '<div class="story"><div class="night-sky" aria-hidden="true"></div><div class="story-cue" aria-hidden="true"></div></div>';
    const sky = box.querySelector('.night-sky'), cue = box.querySelector('.story-cue');
    const line = (key) => T.lines.get(key, ctx.child.gender, ctx.nonverbal);
    const suffix = `${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`;
    await ctx.say(line('magic_intro'), `magic_intro_${suffix}`);
    await ctx.say(line(level <= 2 ? 'magic_demo' : level === 5 ? 'magic_demo_switch' : 'magic_demo_sounds'), `magic_ladder_demo_${level}_${suffix}`);

    let practiceAttempts = 0;
    const practiceItem = level <= 2
      ? { go: true, kind: 'word', word: 'צפרדע', voice: 'normal', rule: 'star' }
      : { go: true, kind: 'sound', sound: level === 5 ? 'bell' : 'bell', rule: 'star' };
    for (let attempt = 0; attempt < 3; attempt++) {
      practiceAttempts++;
      await ctx.say(line(attempt ? 'magic_practice_again' : 'magic_practice'), `magic_practice_${attempt}_${suffix}`);
      await presentCue(ctx, practiceItem, params, cue, `practice_${attempt}`);
      if (T.audio.mode === 'sim') this.simulate({ go: true });
      const response = await ctx.listen({
        maxMs: params.responseMs, startTimeoutMs: params.responseMs,
        endSilenceMs: 300, stopAfterFirst: true,
      });
      if (response.segments.length) {
        star(sky);
        await ctx.say(line('magic_correct'), `magic_correct_${suffix}`);
        break;
      }
    }

    const events = [];
    let activeRule = null;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (params.ruleSwitch && item.rule !== activeRule) {
        activeRule = item.rule;
        cue.innerHTML = ruleIcon(activeRule);
        await ctx.say(line(activeRule === 'star' ? 'magic_rule_star' : 'magic_rule_moon'), `magic_rule_${activeRule}_${suffix}`);
      }
      const stimulusEnd = await presentCue(ctx, item, params, cue, `trial_${index}`);
      if (T.audio.mode === 'sim') this.simulate({ go: item.go });
      const response = await ctx.listen({
        maxMs: params.responseMs, startTimeoutMs: params.responseMs,
        endSilenceMs: 300, minDurMs: 100, stopAfterFirst: true,
      });
      const segment = response.segments[0] || null;
      const responded = !!segment;
      const selfCorrection = !item.go && responded && segment.dur < 250;
      const rtMs = responded && response.firstOnset !== null
        ? Math.max(0, Math.round(response.firstOnset - stimulusEnd))
        : null;
      const confidence = !responded ? (response.adult.length ? 0 : 1) : segment.manual ? 0.4 : 1;
      events.push({
        index, go: item.go, noGo: !item.go, rule: item.rule,
        stimulus: item.kind === 'word' ? item.word : item.sound,
        responded, falseAlarm: !item.go && responded && !selfCorrection,
        selfCorrection, rtMs, responseDurationMs: segment ? segment.dur : null,
        confidence, stimulusGated: true,
      });
      if (item.go) star(sky, responded);
      if (item.go && responded) { T.tombi.chime('good'); T.tombi.happy(); }
      if (params.irregular && index < items.length - 1) await ctx.wait(350 + Math.round(Math.random() * 900));
    }

    const goItems = events.filter((event) => event.go);
    const noGoItems = events.filter((event) => event.noGo);
    const hits = goItems.filter((event) => event.responded).length;
    const omissions = goItems.length - hits;
    const falseAlarms = noGoItems.filter((event) => event.falseAlarm).length;
    const commissionRate = noGoItems.length ? falseAlarms / noGoItems.length : 0;
    const omissionRate = goItems.length ? omissions / goItems.length : 0;
    const reactionTimes = goItems.filter((event) => event.responded && event.rtMs !== null).map((event) => event.rtMs);
    const medianRtMs = reactionTimes.length
      ? reactionTimes.slice().sort((a, b) => a - b)[Math.floor(reactionTimes.length / 2)]
      : null;
    const age = Number(ctx.child.age) || 5;
    const rtScore = medianRtMs === null ? 0 : Math.max(0, Math.min(1, (2500 - medianRtMs) / 1500));
    const score = age >= 4.5
      ? 100 * (0.5 * (1 - commissionRate) + 0.35 * (1 - omissionRate) + 0.15 * rtScore)
      : 100 * (0.5 * (1 - commissionRate) + 0.35 * (1 - omissionRate)) / 0.85;
    await ctx.say(line('magic_done'), `magic_done_${suffix}`);
    return {
      events, targetWord: level <= 2 ? 'צפרדע' : null,
      hits, misses: omissions, falseAlarms, nTargets: goItems.length, nDistractors: noGoItems.length,
      commissionPercent: Math.round(commissionRate * 100),
      omissionPercent: Math.round(omissionRate * 100),
      selfCorrections: events.filter((event) => event.selfCorrection).length,
      medianRtMs, rtIncludedInScore: age >= 4.5,
      level, practiceAttempts, score: Math.round(Math.max(0, Math.min(100, score))),
      confidence: events.length ? events.reduce((sum, event) => sum + event.confidence, 0) / events.length : 0,
    };
  },
  simulate(p = {}) {
    if (p.go) T.audio.sim.clap(250, 0.45);
  },
  version: 2,
});

async function presentCue(ctx, item, params, cue, key) {
  if (params.ruleSwitch) cue.innerHTML = ruleIcon(item.rule);
  if (item.kind === 'word') {
    const lineKey = item.word === 'צב' ? 'magic_word_turtle' : item.voice === 'sleepy' || item.word === 'צפרדה' ? 'magic_word_lure' : 'magic_word_target';
    const rate = T.tombi.voiceCfg.rate;
    T.tombi.voiceCfg.rate = rate * (item.voice === 'sleepy' ? 0.72 : 1);
    try {
      await ctx.say(T.lines.get(lineKey, ctx.child.gender, ctx.nonverbal), `magic_${key}_${lineKey}_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      return T.audio.now() - 280;
    } finally {
      T.tombi.voiceCfg.rate = rate;
    }
  }

  T.audio.setGate(true);
  try {
    if (item.sound === 'bell') T.tombi.bell();
    else if (item.sound === 'drum') T.tombi.drum();
    else T.tombi.chirp();
    await ctx.wait(item.sound === 'drum' ? 300 : 380);
    return T.audio.now();
  } finally {
    T.audio.setGate(false);
  }
}

function ruleIcon(rule) {
  return rule === 'star'
    ? '<svg viewBox="0 0 100 100" role="img" aria-label="כוכב"><path d="m50 8 11 29 31 1-24 19 8 30-26-17-26 17 8-30L8 38l31-1Z" fill="#f7d76a" stroke="#fff1a8" stroke-width="4" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 100 100" role="img" aria-label="ירח"><path d="M62 10a40 40 0 1 0 28 67A35 35 0 0 1 62 10Z" fill="#d7e6ff" stroke="#fff" stroke-width="4"/></svg>';
}

function star(sky, hit = true) {
  const shape = document.createElement('span');
  shape.className = 'story-star' + (hit ? ' is-hit' : '');
  shape.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="m50 8 11 29 31 1-24 19 8 30-26-17-26 17 8-30L8 38l31-1Z" fill="currentColor" stroke="#fff1a8" stroke-width="4" stroke-linejoin="round"/></svg>';
  shape.style.setProperty('--x', `${10 + Math.random() * 75}%`);
  sky.appendChild(shape);
}
