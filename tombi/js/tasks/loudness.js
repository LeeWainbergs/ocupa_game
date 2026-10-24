/* loudness.js — mouse and lion grading task definition. */
T.tasks.register({
  key: 'loudness',
  name: 'עכבר ואריה',
  domain: 'הדרגה וויסות',
  slot: 'grading',
  arousal: 0,
  gross: false,
  jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],
  minAge: 3,
  durationSec: { short: 50, full: 90 },
  levels: 5,
  params(level, age, child) { return T.levels.params('loudness', level, child || { age }); },
  async run(ctx, p) {
    const box = ctx.taskBox(), level = p.level || T.levels.get(ctx.child, 'loudness');
    const params = { ...T.levels.params('loudness', level, ctx.child), ...p };
    if (params.tunnel) return tunnelLoudness(ctx, level, params.short);
    const animals = [['mouse', '🐭', 'עכבר'], ...(params.compareCat ? [['cat', '🐱', 'חתול']] : []), ['lion', '🦁', 'אריה']];
    box.innerHTML = `<div class="loud${params.compareCat ? ' has-cat' : ''}">${animals.map(([id, emoji, name]) => `
      <div class="loud-animal" id="${id}"><span class="loud-emoji" aria-hidden="true">${emoji}</span><span class="loud-name">${name}</span><div class="meter"><i></i></div></div>`).join('')}</div>`;
    const rounds = [];
    const confidence = [];
    const one = async (who) => {
      const element = box.querySelector('#' + who);
      box.querySelectorAll('.loud-animal').forEach((animal) => animal.classList.toggle('is-on', animal === element));
      const bar = element.querySelector('.meter i'), label = animals.find(([id]) => id === who)[2];
      const txt = params.holdSeconds
        ? `${ctx.nonverbal ? `${ctx.G('תעשה', 'תעשי')} קול` : `${ctx.G('תגיד', 'תגידי')} שלום`} כמו ${label}, וה${ctx.G('חזק', 'חזקה')} אותו יציב במשך שתי שניות`
        : who === 'cat'
          ? (ctx.nonverbal ? `${ctx.G('תעשה', 'תעשי')} קול בינוני, כמו חתול` : `${ctx.G('תגיד', 'תגידי')} שלום בקול בינוני, כמו חתול`)
        : who === 'mouse'
          ? (ctx.nonverbal ? `${ctx.G('תעשה', 'תעשי')} קול קטן ושקט, כמו עכבר קטן` : `${ctx.G('תגיד', 'תגידי')} שלום בשקט, כמו עכבר קטן`)
          : (ctx.nonverbal ? `ועכשיו ${ctx.G('תעשה', 'תעשי')} קול חזק, כמו אריה!` : `ועכשיו ${ctx.G('תגיד', 'תגידי')} שלום חזק, כמו אריה!`);
      await ctx.say(txt, `loud_${who}_${ctx.nonverbal ? 'nv' : 'v'}_${ctx.child.gender}`);
      if (T.audio.mode === 'sim') this.simulate({ who, holdSeconds: params.holdSeconds });
      const response = await ctx.listen({
        maxMs: params.holdSeconds ? 5000 : 6000, startTimeoutMs: 7000, endSilenceMs: 900, minDurMs: 120,
        onLive: (type, event) => {
          if (type === 'frame') {
            const value = Math.max(0, Math.min(1, (event.db - T.audio.floor) / 45));
            bar.style.width = `${Math.round(value * 100)}%`;
            element.style.setProperty('--grow', 1 + value * 0.5);
          }
        },
      });

      const valid = response.segments.filter((segment) => !segment.manual && segment.levelDb !== null);
      confidence.push(valid.length
        ? valid.filter((segment) => segment.peakDb - segment.floorDb >= 12).length / valid.length
        : 0);
      if (!valid.length) return null;
      const best = params.holdSeconds
        ? valid.reduce((a, b) => b.dur > a.dur ? b : a)
        : valid.reduce((a, b) => b.levelDb > a.levelDb ? b : a);
      if (!params.holdSeconds) return { db: best.levelDb, aboveFloor: best.levelDb - best.floorDb };
      const frames = T.audio.framesBetween(best.start, best.end).filter((frame) => frame.db > T.audio.floor + T.audio.cfg.sensitivity);
      const spread = frames.length ? Math.max(...frames.map((frame) => frame.db)) - Math.min(...frames.map((frame) => frame.db)) : 45;
      const stabilityScore = best.dur >= params.holdSeconds * 1000 ? Math.round(Math.max(0, Math.min(100, 100 - spread * 20))) : 0;
      return { db: best.levelDb, aboveFloor: best.levelDb - best.floorDb, dur: best.dur, variationDb: +spread.toFixed(1), stabilityScore };
    };
    for (let i = 0; i < (params.short ? 1 : 2); i++) {
      const mouse = await one('mouse'), cat = params.compareCat ? await one('cat') : null, lion = await one('lion');
      if (params.holdSeconds) {
        const score = mouse && lion ? Math.round((mouse.stabilityScore + lion.stabilityScore) / 2) : 0;
        rounds.push({
          mouseDb: mouse && +mouse.db.toFixed(1), lionDb: lion && +lion.db.toFixed(1),
          mouseDur: mouse && mouse.dur, lionDur: lion && lion.dur,
          mouseVariationDb: mouse && mouse.variationDb, lionVariationDb: lion && lion.variationDb, score,
        });
      } else if (params.compareCat) {
        const ordered = mouse && cat && lion ? [mouse.db < cat.db, cat.db < lion.db] : [];
        rounds.push({
          mouseDb: mouse && +mouse.db.toFixed(1), catDb: cat && +cat.db.toFixed(1), lionDb: lion && +lion.db.toFixed(1),
          order: ordered.length ? ordered.every(Boolean) : false,
          score: ordered.length ? ordered.filter(Boolean).length * 50 : 0,
        });
      } else if (mouse && lion) {
        const diff = lion.db - mouse.db;
        rounds.push({ mouseDb: +mouse.db.toFixed(1), lionDb: +lion.db.toFixed(1), diffDb: +diff.toFixed(1), ratio: +(10 ** (diff / 20)).toFixed(2), score: Math.round(Math.max(0, Math.min(100, (diff / params.targetDb) * 100))) });
      } else rounds.push({ mouseDb: mouse && +mouse.db.toFixed(1), lionDb: lion && +lion.db.toFixed(1), diffDb: null, ratio: null, score: 0 });
      T.tombi.chime('good'); T.tombi.happy();
      await ctx.say(i === 0 ? 'יופי! עוד פעם אחת.' : 'כל הכבוד!', i === 0 ? 'again_once' : 'praise1');
    }
    const scored = rounds.filter((round) => round.diffDb !== null);
    const meanDiff = scored.length ? scored.reduce((sum, round) => sum + round.diffDb, 0) / scored.length : null;
    return {
      rounds, ratio: meanDiff === null ? null : +(10 ** (meanDiff / 20)).toFixed(2),
      consistencyDb: scored.length === 2 ? +Math.abs(scored[0].diffDb - scored[1].diffDb).toFixed(1) : null,
      score: Math.round(rounds.reduce((sum, round) => sum + round.score, 0) / rounds.length), level,
      confidence: confidence.length ? confidence.reduce((sum, value) => sum + value, 0) / confidence.length : 0,
    };
  },
  simulate(p = {}) {
    const loudness = p.who === 'lion' ? 0.38 : p.who === 'mouse' ? 0.045 : 0.16;
    T.audio.sim.voice(p.holdSeconds ? 2200 : 450, loudness);
  },
  version: 1,
});

async function tunnelLoudness(ctx, level, short) {
  const box = ctx.taskBox(), { child, nonverbal } = ctx;
  const line = (key) => T.lines.get(key, child.gender, nonverbal);
  box.innerHTML = `<div class="loud"><div class="loud-animal is-on"><span class="loud-name">עכבר · מנהרה · אריה</span><div class="meter"><i></i></div></div></div>`;
  await ctx.say(line('tunnel_intro'), `tunnel_intro_${child.gender}_${nonverbal ? 'nv' : 'v'}`);
  await ctx.say(line('tunnel_try'), `tunnel_try_${child.gender}_${nonverbal ? 'nv' : 'v'}`);
  await ctx.say(line('tunnel_demo'), `tunnel_baseline_${child.gender}_${nonverbal ? 'nv' : 'v'}`);
  if (T.audio.mode === 'sim') T.tasks.get('loudness').simulate({ who: 'baseline' });
  const baseline = await ctx.listen({ maxMs: 1800, startTimeoutMs: 2200, endSilenceMs: 350, minDurMs: 300 });
  const baselineSegments = baseline.segments.filter((segment) => !segment.manual && segment.levelDb !== null);
  const baseDb = baselineSegments.length ? Math.max(...baselineSegments.map((segment) => segment.levelDb)) : null;
  const baselineRelativeDb = baseDb === null ? null : baseDb - T.audio.floor;
  let roles = level === 3 ? [-8, 8] : level === 4 ? [-8, -4, 0, 4, 8] : [8, 4, 0, -4, -8];
  if (short && roles.length > 3) roles = [roles[0], roles[2], roles[4]];
  const measurements = [];
  for (let i = 0; i < roles.length; i++) {
    const offset = roles[i];
    const instruction = i === 0 ? line('tunnel_go') : offset > 0 ? line('tunnel_lion') : line('tunnel_demo');
    await ctx.say(instruction, `tunnel_trial_${level}_${i}_${child.gender}_${nonverbal ? 'nv' : 'v'}`);
    if (T.audio.mode === 'sim') T.tasks.get('loudness').simulate({ who: offset > 4 ? 'lion' : offset < 0 ? 'mouse' : 'baseline' });
    const response = await ctx.listen({ maxMs: 2200, startTimeoutMs: 2600, endSilenceMs: 350, minDurMs: 250 });
    const valid = response.segments.filter((segment) => !segment.manual && segment.levelDb !== null);
    const best = valid.reduce((a, b) => !a || b.levelDb > a.levelDb ? b : a, null);
    const relativeDb = best ? best.levelDb - T.audio.floor : null;
    measurements.push({
      expectedOffsetDb: offset, relativeDb,
      overShout: !!best && (best.levelDb > -1 || (baseDb !== null && best.levelDb - baseDb > 20)),
      clipped: !!best && best.peakDb > -1,
    });
    const bar = box.querySelector('.meter i');
    if (best && bar) bar.style.width = `${Math.max(0, Math.min(100, ((best.levelDb - T.audio.floor) / 40) * 100))}%`;
  }
  const measured = measurements.map((measurement) => measurement.relativeDb).filter(Number.isFinite);
  let score = 0;
  if (baselineRelativeDb !== null && measured.length) {
    if (level === 3) score = (measurements[0].relativeDb !== null && measurements[0].relativeDb <= baselineRelativeDb - 6 ? 50 : 0) + (measurements[1].relativeDb !== null && measurements[1].relativeDb >= baselineRelativeDb + 6 ? 50 : 0);
    else {
      const pairs = measurements.slice(1).filter((item, i) => item.relativeDb !== null && measurements[i].relativeDb !== null);
      const monotonic = pairs.length ? pairs.filter((item, i) => level === 4 ? item.relativeDb >= measurements[i].relativeDb : item.relativeDb <= measurements[i].relativeDb).length / pairs.length : 0;
      score = 100 * monotonic;
    }
  }
  await ctx.say(line('tunnel_praise3'), `tunnel_praise3_${child.gender}_${nonverbal ? 'nv' : 'v'}`);
  const ratio = measurements[0].relativeDb !== null && measurements[1].relativeDb !== null
    ? +(10 ** ((measurements[1].relativeDb - measurements[0].relativeDb) / 20)).toFixed(2) : null;
  return {
    rounds: measurements, baseDb, baselineRelativeDb, ratio, score: Math.round(score),
    confidence: measurements.filter((measurement) => measurement.relativeDb !== null).length / measurements.length,
    overShout: measurements.filter((measurement) => measurement.overShout).length, level,
  };
}
