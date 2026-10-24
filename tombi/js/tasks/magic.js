/* magic.js — inhibitory response task definition. */
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
    const story = params.short ? params.story.slice(0, 8) : params.story;
    box.innerHTML = `<div class="story"><div class="night-sky" aria-hidden="true"></div><div class="story-caption">סיפור הכוכב</div></div>`;
    const sky = box.querySelector('.night-sky'), caption = box.querySelector('.story-caption');
    const line = (key) => T.lines.get(key, ctx.child.gender, ctx.nonverbal);
    await ctx.say(line('magic_intro'), `magic_intro_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
    await ctx.say(line('magic_demo'), `magic_demo_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
    caption.textContent = 'ניסיון';
    for (let tries = 0; tries < 2; tries++) {
      await ctx.say('ניסיון: ראיתי כוכב קטן בשמיים!', 'star_magic_practice');
      if (T.audio.mode === 'sim') this.simulate({ story: [['כוכב', true]], responseMs: params.responseMs });
      const response = await ctx.listen({ maxMs: params.responseMs, startTimeoutMs: params.responseMs, endSilenceMs: 300, stopAfterFirst: true });
      if (response.segments.length) {
        star(sky); T.tombi.chime('good'); T.tombi.happy();
        await ctx.say('בדיוק ככה!', 'magic_practice_ok');
        break;
      }
      if (tries === 0) await ctx.say(ctx.nonverbal ? 'כששומעים כוכב, עושים קול. עוד פעם.' : 'כששומעים כוכב, אומרים הופ! עוד פעם.', `star_magic_practice_again_${ctx.nonverbal ? 'nv' : 'v'}`);
    }
    await ctx.say('עכשיו הסיפור מתחיל.', 'magic_start');
    const events = [];
    for (let i = 0; i < story.length; i++) {
      const [text, isTarget, isNoGo, audioKey] = story[i];
      caption.textContent = `משפט ${i + 1} מתוך ${story.length}`;
      const originalRate = T.tombi.voiceCfg.rate;
      T.tombi.voiceCfg.rate = originalRate * params.speechRate;
      try { await ctx.say(text, audioKey || `story_${i}`); }
      finally { T.tombi.voiceCfg.rate = originalRate; }
      const lineEnd = T.audio.now() - 280;
      if (T.audio.mode === 'sim') this.simulate({ story: [[text, !!isTarget || !!isNoGo]], responseMs: params.responseMs });
      const response = await ctx.listen({ maxMs: params.responseMs, startTimeoutMs: params.responseMs, endSilenceMs: 250, stopAfterFirst: true });
      const responded = response.segments.length > 0;
      const reactionMs = responded ? Math.round(response.firstOnset - lineEnd) : null;
      events.push({ i, target: !!isTarget, noGo: !!isNoGo, responded, rt: reactionMs, confidence: response.adult.length ? 0 : 1 });
      if (isTarget) star(sky, responded);
      if (isTarget && responded) { T.tombi.chime('good'); T.tombi.happy(); }
    }
    const targets = events.filter((event) => event.target), distractors = events.filter((event) => !event.target);
    const hits = targets.filter((event) => event.responded).length;
    const falseAlarms = distractors.filter((event) => event.responded).length;
    const reactionTimes = targets.filter((event) => event.responded && event.rt !== null).map((event) => event.rt);
    const score = Math.round(100 * Math.max(0, Math.min(1, hits / targets.length - falseAlarms / distractors.length)));
    await ctx.say('איזה סיפור! כל הכבוד.', 'magic_done');
    return {
      events, targetWord: 'צפרדע', hits, misses: targets.length - hits,
      falseAlarms, nTargets: targets.length, nDistractors: distractors.length,
      meanRtMs: reactionTimes.length ? Math.round(reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length) : null,
      score, level, confidence: events.reduce((sum, event) => sum + event.confidence, 0) / events.length,
    };
  },
  simulate(p = {}) {
    let delay = 0;
    (p.story || []).forEach((item) => {
      if (item[1]) T.audio.sim.voice(280, 0.28, 300, delay + 450);
      delay += (p.responseMs || 2200) + 500;
    });
  },
  version: 1,
});

function star(sky, hit = true) {
  const shape = document.createElement('span');
  shape.className = 'story-star' + (hit ? ' is-hit' : '');
  shape.textContent = '✦';
  shape.style.setProperty('--x', `${10 + Math.random() * 75}%`);
  sky.appendChild(shape);
}
