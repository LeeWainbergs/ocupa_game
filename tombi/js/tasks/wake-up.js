/* Session-start calibration for noise, sound classes, and playback latency. */
T.tasks.register({
  key: 'wakeUp',
  name: 'טומבי מתעורר',
  domain: 'כיול',
  slot: 'calibration',
  arousal: 0,
  gross: false,
  jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],
  minAge: 3,
  durationSec: { short: 40, full: 40 },
  levels: 1,
  params() { return {}; },
  async run(ctx) {
    const picture = document.getElementById('activity-picture');
    const task = ctx.taskBox();
    try {
      await ctx.say('טומבי מתעורר. קודם נקשיב לשקט, ואז נראה לטומבי שלוש רקיעות ושלוש מחיאות.', 'wake_up_intro');
      const floorDb = await T.audio.calibrateTaskFloor();
      const loopback = T.audio.mode === 'mic' ? await T.audio.calibrateLoopback() : null;
      const collectClass = async (label, instruction, visual, simulate) => {
        picture.innerHTML = T.activity.picture(visual);
        picture.hidden = false;
        await ctx.say(instruction, `wake_up_${label}`);
        const events = await T.activity.collect(ctx, {
          durationMs: 2400,
          minIoiMs: label === 'stomp' ? 220 : 130,
          minAboveFloor: 9,
          simulate,
        });
        T.audio.setOnsetConfig({ floorFrozen: true });
        if (events.length >= 2) T.onsets.addCalibration(label, events, ctx.child.id);
        return events.length;
      };
      const stompCount = await collectClass('stomp', 'טומבי, תראה לי שלוש רקיעות במקום.', 'foot', () => {
        for (let i = 0; i < 3; i++) T.audio.sim.stomp(250 + i * 650, 0.5);
      });
      const clapCount = await collectClass('clap', 'ועכשיו שלוש מחיאות כפיים.', 'hands', () => {
        for (let i = 0; i < 3; i++) T.audio.sim.clap(250 + i * 650, 0.5);
      });
      const plan = T.session.record && T.session.record.plan || [];
      if (plan.some((entry) => entry.key === 'clapStomp') && T.levels.get(ctx.child, 'clapStomp') >= 3) {
        await collectClass('pot', 'הקש שלוש פעמים בעדינות על הסיר.', 'pot', () => {
          for (let i = 0; i < 3; i++) T.audio.sim.pot(250 + i * 650, 0.35);
        });
        await collectClass('table', 'ועכשיו הקש שלוש פעמים על השולחן.', 'hands', () => {
          for (let i = 0; i < 3; i++) T.audio.sim.table(250 + i * 650, 0.45);
        });
      }
      await ctx.say('ועכשיו קול רגיל ונעים, כמו כשאומרים אההה.', 'wake_up_voice');
      if (T.audio.mode === 'sim') T.audio.sim.voice(1300, 0.12);
      const voice = await ctx.listen({ maxMs: 1500, startTimeoutMs: 1800, endSilenceMs: 350, minDurMs: 250 });
      return {
        score: null,
        floorDb,
        loopback,
        calibratedClasses: { stompCount, clapCount },
        voiceLevelDb: voice.segments.find((segment) => !segment.manual && segment.levelDb !== null)?.levelDb ?? null,
        confidence: loopback ? (loopback.lowConfidence ? 0.4 : 1) : T.audio.mode === 'sim' ? 1 : 0,
      };
    } finally {
      T.audio.setOnsetConfig({ floorFrozen: false });
      picture.hidden = true;
      task.textContent = '';
    }
  },
  simulate() {},
  version: 1,
});
