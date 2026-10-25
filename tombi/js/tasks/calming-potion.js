/* calming-potion.js — "שיקוי הרוגע": long exhales or soft humming fill Tombi's potion. */
(() => {
  const M = T.ot.metrics;
  const VISUAL_GOAL_SEC = 6;

  function render(box, trials) {
    box.innerHTML = `<div class="potion">
      <div class="potion-bottle" aria-hidden="true"><div class="potion-liquid"></div></div>
      <div class="potion-time" aria-live="polite">0.0 שניות</div>
      <div class="potion-trials" aria-label="נשיפות"></div>
      <p class="potion-caption">נשיפה 1 מתוך ${trials}</p></div>`;
    const liquid = box.querySelector('.potion-liquid');
    return {
      fill(fraction) { liquid.style.setProperty('--fill', Math.max(0, Math.min(1, fraction))); },
      time(seconds) { box.querySelector('.potion-time').textContent = `${seconds.toFixed(1)} שניות`; },
      caption(text) { box.querySelector('.potion-caption').textContent = text; },
      chip(text) { box.querySelector('.potion-trials').insertAdjacentHTML('beforeend', `<span class="chip">${text}</span>`); },
    };
  }

  T.ot.register({
    key: 'calmingPotion',
    name: 'שיקוי הרוגע',
    domain: 'ויסות חושי ונשימה',
    arousal: -1,
    durationSec: { short: 60, full: 100 },
    params() { return { trials: 3, maxExhaleSec: 15 }; },
    async execute(ctx, p, run) {
      const trialCount = p.short ? 2 : p.trials || 3;
      const ui = render(ctx.taskBox(), trialCount);
      const previousGap = T.audio.cfg.gapMs;
      const trials = [];
      let filledSec = 0;
      await run.prompt(`טומבי צריך שיקוי רוגע. כל נשיפה ארוכה או זמזום רך ממלאים את הבקבוק. אפשר לעמוד, או ללכת לאט בחדר בזמן שנושפים.`, 'intro');
      T.audio.cfg.gapMs = 250;
      try {
        for (let index = 0; index < trialCount; index++) {
          ui.caption(`נשיפה ${index + 1} מתוך ${trialCount}`);
          ui.time(0);
          const inhale = ctx.G('קח', 'קחי'), hum = ctx.G('זמזם', 'זמזמי'), blow = ctx.G('נשוף', 'נשפי');
          await run.prompt(index === 0
            ? `${inhale} נשימה דרך האף… ועכשיו ${hum} "מממ" או ${blow} לאט לאט לתוך השיקוי.`
            : `עוד נשיפה ארוכה ורכה לתוך השיקוי.`, `exhale_${index + 1}`);
          if (T.audio.mode === 'sim') T.tasks.get('calmingPotion').simulate({ ms: 3200 + index * 700 });
          let liveStart = null;
          const response = await run.awaitResponse({
            maxMs: (p.maxExhaleSec || 15) * 1000, startTimeoutMs: 8000, endSilenceMs: 800,
            minVoiceMs: 200, minDurMs: 200, requireVoiced: false, label: `exhale_${index + 1}`,
            onLive: (type, event) => {
              if (type === 'onset' && liveStart === null) liveStart = event.t;
              if (type === 'frame' && liveStart !== null) {
                const seconds = (event.t - liveStart) / 1000;
                ui.time(seconds);
                ui.fill((filledSec + seconds) / (VISUAL_GOAL_SEC * trialCount));
              }
              if (type === 'segment') liveStart = null;
            },
          });
          const longest = response.audioValid.reduce((best, segment) => (!best || segment.dur > best.dur ? segment : best), null);
          let steadiness = M.stability([]);
          let clipped = false;
          if (longest) {
            const frames = T.audio.framesBetween(longest.start + longest.dur * 0.1, longest.end - longest.dur * 0.1);
            steadiness = M.stability(frames);
            clipped = T.audio.framesBetween(longest.start, longest.end).some((frame) => frame.clipped);
          }
          const exhaleSec = longest ? M.toSec(longest.dur) : 0;
          filledSec += exhaleSec;
          ui.fill(filledSec / (VISUAL_GOAL_SEC * trialCount));
          ui.chip(longest ? `${exhaleSec.toFixed(1)} ש׳` : '—');
          trials.push({
            trial: index + 1,
            source: response.source,
            latency_sec: M.toSec(response.latencyMs),
            exhale_duration_sec: exhaleSec,
            total_sound_sec: M.toSec(response.childVoiceMs),
            break_count: Math.max(0, response.audioValid.length - 1),
            clipped,
            ...steadiness,
          });
          if (longest) {
            T.tombi.chime('good');
            await ctx.say(index === trialCount - 1 ? 'השיקוי מלא. איזה רוגע.' : 'השיקוי התמלא עוד!');
          } else {
            await ctx.say(index === trialCount - 1 ? 'תודה. השיקוי מוכן.' : 'זה בסדר. ננסה עוד נשיפה אחת.');
          }
        }
      } finally {
        T.audio.cfg.gapMs = previousGap;
      }

      const measured = trials.filter((trial) => trial.exhale_duration_sec > 0);
      return run.finish({
        confidence: trials.length ? measured.length / trials.length : 0,
        metrics: {
          trials_planned: trialCount,
          trials_with_sound: measured.length,
          duration_sec: measured.length ? Math.max(...measured.map((trial) => trial.exhale_duration_sec)) : 0,
          exhale_duration_sec: trials.map((trial) => trial.exhale_duration_sec),
          exhale_duration_summary: M.stats(measured.map((trial) => trial.exhale_duration_sec)),
          latency_sec: trials.map((trial) => trial.latency_sec),
          audio_stability_score: M.stats(measured.map((trial) => trial.audio_stability_score)).mean,
          amplitude_sd_db: M.stats(measured.map((trial) => trial.amplitude_sd_db)).mean,
          pitch_stability_score: M.stats(measured.map((trial) => trial.pitch_stability_score)).mean,
          pitch_sd_semitones: M.stats(measured.map((trial) => trial.pitch_sd_semitones)).mean,
          voiced_fraction: M.stats(measured.map((trial) => trial.voiced_fraction)).mean,
          break_count_total: trials.reduce((sum, trial) => sum + trial.break_count, 0),
        },
        trials,
        definitions: {
          duration_sec: 'משך הנשיפה/הזמזום הרציף הארוך ביותר במשימה',
          exhale_duration_sec: 'לכל ניסיון: משך הקטע הרציף הארוך ביותר (הפסקה של 250 מ״ש מסיימת קטע)',
          audio_stability_score: 'חלק הפריימים (10 מ״ש) בתוך ±3 dB מהעוצמה החציונית, ב־80% האמצעיים של הנשיפה (0–1)',
          amplitude_sd_db: 'סטיית התקן של העוצמה ב־dB באותו חלון',
          pitch_stability_score: 'חלק הפריימים הקוליים בתוך ±1 חצי טון מהגובה החציוני (0–1); ריק בנשיפה ללא קול',
          pitch_sd_semitones: 'סטיית התקן של גובה הצליל בחצאי טונים',
          voiced_fraction: 'חלק הפריימים עם גובה צליל מזוהה (זמזום) לעומת נשיפה שקטה',
          break_count: 'מספר ההפסקות בתוך חלון הנשיפה',
        },
      });
    },
    simulate(p = {}) {
      T.audio.sim.voice(p.ms || 3500, 0.18, 290, p.delayMs || 900);
    },
    version: 1,
  });
})();
