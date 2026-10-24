/* echo.js — rhythm imitation task definition. */
T.tasks.register({
  key: 'echo',
  name: 'הד קולי',
  domain: 'תזמון ורצף',
  slot: 'rhythm',
  arousal: 0,
  gross: false,
  jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],
  minAge: 3,
  durationSec: { short: 50, full: 90 },
  levels: 5,
  params(level, age, child) { return T.levels.params('echo', level, child || { age }); },
  async run(ctx, p) {
    const box = ctx.taskBox();
    const level = p.level || T.levels.get(ctx.child, 'echo');
    const allPatterns = p.patterns || T.levels.params('echo', level, ctx.child).patterns;
    const patterns = p.short ? allPatterns.slice(0, 2) : allPatterns;
    const verb = ctx.nonverbal ? ctx.G('תמחא כפיים', 'תמחאי כפיים') : ctx.G('תגיד', 'תגידי');
    await ctx.say(ctx.nonverbal
      ? `עכשיו נשחק בהד. אני אעשה מקצב, ואת${ctx.G('ה', '')} ${verb} בדיוק כמוני.`
      : `עכשיו נשחק בהד. אני אגיד בָּה, ואת${ctx.G('ה', '')} ${verb} בדיוק כמוני.`, `echo_intro_${ctx.nonverbal ? 'nv' : 'v'}_${ctx.child.gender}`);
    const trials = [];
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      box.innerHTML = `<div class="echo">
        <div class="echo-row" aria-label="המקצב של טומבי">${pattern.map((ms, j) => `<span class="dot tombi-dot" style="--x:${(ms / 1700) * 100}%" data-j="${j}"></span>`).join('')}</div>
        <div class="echo-row child-row" aria-label="המקצב של הילד"></div>
        <div class="echo-caption">מקצב ${i + 1} מתוך ${patterns.length}</div></div>`;
      await ctx.say(ctx.G('תקשיב', 'תקשיבי'), `listen_${ctx.child.gender}`);
      await ctx.wait(250);
      pattern.forEach((ms, j) => {
        T.tombi.ba(ms, j === pattern.length - 1);
        setTimeout(() => box.querySelector(`.tombi-dot[data-j="${j}"]`)?.classList.add('on'), ms);
      });
      T.audio.setGate(true);
      await ctx.wait(pattern[pattern.length - 1] + 450);
      T.audio.setGate(false);
      await ctx.say(`עכשיו את${ctx.G('ה', '')}!`, `your_turn_${ctx.child.gender}`);
      const row = box.querySelector('.child-row');
      let liveT0 = null;
      if (T.audio.mode === 'sim') T.tasks.get('echo').simulate({ patterns: [pattern] });
      const response = await ctx.listen({
        maxMs: pattern[pattern.length - 1] + 4500, startTimeoutMs: 6000, endSilenceMs: 1300, minDurMs: 40,
        onLive: (type, event) => {
          if (type !== 'onset') return;
          if (liveT0 === null) liveT0 = event.t;
          row.insertAdjacentHTML('beforeend', `<span class="dot child-dot on" style="--x:${Math.min(100, ((event.t - liveT0) / 1700) * 100)}%"></span>`);
        },
      });
      const confidence = response.segments.length
        ? response.segments.filter((segment) => segment.peakDb - segment.floorDb >= 12).length / response.segments.length
        : 0;
      let onsets = response.segments.length ? ctx.countPeaks(response.t0, response.t1, response.segments) : [];
      if (!onsets.length && response.segments.length) onsets = response.segments.map((segment) => segment.start);
      const count = onsets.length, target = pattern.length;
      const targetIntervals = pattern.slice(1).map((value, j) => value - pattern[j]);
      const responseIntervals = onsets.slice(1).map((value, j) => value - onsets[j]);
      let deviationMs = null, relativeDeviation = null;
      if (count === target && count >= 2) {
        deviationMs = targetIntervals.reduce((sum, value, j) => sum + Math.abs(responseIntervals[j] - value), 0) / targetIntervals.length;
        relativeDeviation = targetIntervals.reduce((sum, value, j) => sum + Math.abs(responseIntervals[j] - value) / value, 0) / targetIntervals.length;
      }
      const countScore = count === 0 ? 0 : count === target ? 60 : Math.abs(count - target) === 1 ? 30 : 10;
      const rhythmScore = relativeDeviation === null ? 0 : 40 * Math.max(0, 1 - relativeDeviation / 0.6);
      const score = Math.round(countScore + rhythmScore);
      trials.push({
        pattern, onsets: onsets.map((time) => Math.round(time - (onsets[0] || 0))), count, target,
        devMs: deviationMs && Math.round(deviationMs), rel: relativeDeviation, score,
        rt: response.firstOnset ? Math.round(response.firstOnset - response.t0) : null, confidence,
      });
      row.innerHTML = onsets.map((time) => `<span class="dot child-dot on" style="--x:${Math.min(100, ((time - onsets[0]) / 1700) * 100)}%"></span>`).join('');
      if (count) { T.tombi.chime('good'); T.tombi.happy(); await ctx.say(ctx.praise(), ctx.lastPraiseKey); }
      else await ctx.say('נמשיך הלאה', 'move_on');
    }
    const answered = trials.filter((trial) => trial.count > 0);
    const deviations = trials.filter((trial) => trial.devMs !== null).map((trial) => trial.devMs);
    return {
      trials, correctCount: trials.filter((trial) => trial.count === trial.target).length,
      meanDevMs: deviations.length ? Math.round(deviations.reduce((sum, value) => sum + value, 0) / deviations.length) : null,
      answered: answered.length,
      confidence: trials.length ? trials.reduce((sum, trial) => sum + trial.confidence, 0) / trials.length : 0,
      score: Math.round(trials.reduce((sum, trial) => sum + trial.score, 0) / trials.length),
    };
  },
  simulate(p = {}) {
    let delay = 0;
    (p.patterns || []).forEach((pattern) => {
      pattern.forEach((ms) => T.audio.sim.clap(delay + ms, 0.45));
      delay += (pattern[pattern.length - 1] || 0) + 500;
    });
  },
  version: 1,
});
