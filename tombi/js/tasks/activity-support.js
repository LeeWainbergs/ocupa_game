/* Shared timing, event collection, and child-safe SVG helpers for motor tasks. */
window.T = window.T || {};

T.activity = (() => {
  function line(key, ctx) {
    return T.lines.get(key, ctx.child.gender, ctx.nonverbal);
  }

  function picture(kind) {
    const shapes = {
      cloud: '<path d="M25 52h52a17 17 0 0 0 0-34 24 24 0 0 0-45 5 15 15 0 0 0-7 29Z" fill="#fff" stroke="#85b8ae" stroke-width="3"/>',
      stop: '<circle cx="50" cy="50" r="34" fill="#8bc9ae" stroke="#397e69" stroke-width="4"/><path d="M35 50h30" stroke="#fff" stroke-width="7" stroke-linecap="round"/>',
      animals: '<path d="M27 61 31 35l16 5 11-12 10 16 8 17Z" fill="#b8d9a1" stroke="#557d61" stroke-width="3"/><path d="M21 67h57" stroke="#557d61" stroke-width="4" stroke-linecap="round"/>',
      hands: '<path d="M28 64V37a5 5 0 0 1 10 0V25a5 5 0 0 1 10 0v11-17a5 5 0 0 1 10 0v18-12a5 5 0 0 1 10 0v22c0 16-8 25-22 25-10 0-18-3-18-8Z" fill="#f5cda9" stroke="#976d55" stroke-width="3"/>',
      pot: '<path d="M24 43h52l-5 32H29Z" fill="#b9c9ce" stroke="#527078" stroke-width="4"/><path d="M18 45h64M34 35h32" stroke="#527078" stroke-width="4" stroke-linecap="round"/>',
      egg: '<path d="M50 15c-17 0-29 24-29 42a29 29 0 0 0 58 0c0-18-12-42-29-42Z" fill="#f4d88f" stroke="#a98243" stroke-width="4"/><circle cx="39" cy="48" r="4" fill="#df9777"/><circle cx="59" cy="59" r="5" fill="#88b9a2"/>',
      candle: '<path d="M35 42h30v36H35Z" fill="#f5d88b" stroke="#a98243" stroke-width="3"/><path d="M50 10c14 16 4 22 0 25-11-9-8-18 0-25Z" fill="#ffc66c" stroke="#d78b3c" stroke-width="2"/>',
      tunnel: '<path d="M17 75V50a33 33 0 0 1 66 0v25Z" fill="#385f50"/><path d="M34 75V50a16 16 0 0 1 32 0v25Z" fill="#ffe3a2"/>',
      foot: '<path d="M41 72c-9-2-11-10-5-17 4-5 5-17 12-19 8-2 10 13 14 20 5 9-7 19-21 16Z" fill="#efc6a5" stroke="#976d55" stroke-width="3"/>',
    };
    return `<svg class="activity-picture" viewBox="0 0 100 100" role="img" aria-label="${kind}">${shapes[kind] || shapes.foot}</svg>`;
  }

  async function collect(ctx, { durationMs, minIoiMs = 130, minAboveFloor = 10, simulate, drainMs = 420 }) {
    const events = [];
    let cutoff = Infinity;
    T.onsets.configure({ minIoiMs, minAboveFloor, floorFrozen: true });
    const off = T.onsets.on((event) => {
      if (event.t > cutoff) return;
      if (event.repeat) {
        T.ui.onsetRepeat(true);
        return;
      }
      T.ui.onsetRepeat(false);
      events.push(event);
    });
    try {
      if (T.audio.mode === 'sim' && simulate) simulate();
      await ctx.wait(durationMs);
      cutoff = T.audio.now();
      if (drainMs > 0) await ctx.wait(drainMs);
      return events;
    } finally {
      off();
      T.onsets.configure({ floorFrozen: false });
      T.ui.onsetRepeat(false);
    }
  }

  async function start(ctx, { title, picture: visual, intro, instruction }) {
    await T.audio.calibrateTaskFloor();
    T.audio.setOnsetConfig({ centroids: ctx.child.soundCentroids || {}, floorFrozen: false });
    const childPicture = document.getElementById('activity-picture');
    childPicture.innerHTML = picture(visual);
    childPicture.hidden = false;
    const task = document.getElementById('task');
    task.textContent = `בטיחות: ${title}. יש לוודא מרחב פנוי ורצפה מתאימה.`;
    await ctx.say(line(intro, ctx), `${intro}_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
    await ctx.say(line(instruction, ctx), `${instruction}_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
  }

  async function practice(ctx, simulate, { minIoiMs = 130, minAboveFloor = 9 } = {}) {
    let events = [], attempts = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      attempts++;
      if (attempt) await ctx.say(line('activity_practice_again', ctx), `activity_practice_again_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      else await ctx.say(line('activity_practice', ctx), `activity_practice_${ctx.child.gender}_${ctx.nonverbal ? 'nv' : 'v'}`);
      events = await collect(ctx, {
        durationMs: 1200, minIoiMs, minAboveFloor,
        simulate: () => simulate && simulate(),
      });
      if (events.length) break;
    }
    return { attempts, detected: events.length > 0 };
  }

  function result(events, score, raw = {}) {
    const childPicture = document.getElementById('activity-picture');
    if (childPicture) childPicture.hidden = true;
    const confidence = events.length
      ? events.filter((event) => event.cls !== 'uncertain' && event.clsConf >= 0.4 && event.snr >= 12).length / events.length
      : 0;
    return { score: Math.round(Math.max(0, Math.min(100, score))), confidence, events: events.map(({ t, peakDb, aboveFloor, cls, clsConf, snr }) => ({ t, peakDb, aboveFloor, cls, clsConf, snr })), ...raw };
  }

  function beat(delayMs, { low = false, gate = false } = {}) {
    const audioContext = T.audio.ctx;
    if (!audioContext) throw new Error('AudioContext must be running before scheduling Tombi beats');
    const when = audioContext.currentTime + delayMs / 1000;
    const scheduled = T.tombi.drum(when, { low });
    if (gate && scheduled !== null) {
      const from = scheduled * 1000 + T.audio.loopbackMs - 10;
      T.audio.gateWindow(from, from + 250);
    }
    return scheduled;
  }

  return { line, picture, collect, start, practice, result, beat };
})();
