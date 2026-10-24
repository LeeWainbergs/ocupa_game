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
    const animals = [['mouse', 'עכבר'], ...(params.compareCat ? [['cat', 'חתול']] : []), ['lion', 'אריה']];
    const pictures = {
      mouse: '<circle cx="50" cy="52" r="23"/><circle cx="30" cy="31" r="11"/><circle cx="70" cy="31" r="11"/><circle cx="42" cy="49" r="2.5" fill="#17322d"/><circle cx="58" cy="49" r="2.5" fill="#17322d"/><path d="M47 59h6l-3 4Z"/><path d="M27 57 43 59m-16 5 16-2m25-5-16 2m16 3-16-1"/>',
      cat: '<path d="m27 40 2-19 15 11a27 27 0 0 1 12 0l15-11 2 19a28 28 0 1 1-46 0Z"/><circle cx="41" cy="49" r="2.5" fill="#17322d"/><circle cx="59" cy="49" r="2.5" fill="#17322d"/><path d="M47 59h6l-3 4Z"/>',
      lion: '<path d="m50 8 7 9 12-5 2 12 12 5-5 11 8 10-9 8 2 12-12 2-6 11-11-6-11 6-6-11-12-2 2-12-9-8 8-10-5-11 12-5 2-12 12 5Z"/><circle cx="50" cy="51" r="23" fill="#f5d88b"/><circle cx="42" cy="47" r="2.5" fill="#17322d"/><circle cx="58" cy="47" r="2.5" fill="#17322d"/><path d="M46 58h8l-4 5Z"/>',
    };
    box.innerHTML = `<div class="loud${params.compareCat ? ' has-cat' : ''}">${animals.map(([id, name]) => `
      <div class="loud-animal" id="${id}"><svg class="loud-emoji" viewBox="0 0 100 100" aria-hidden="true"><g fill="#f2c99e" stroke="#805d4c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${pictures[id]}</g></svg><span class="loud-name">${name}</span><div class="meter"><i></i></div></div>`).join('')}</div>`;
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
    T.audio.sim.voice(p.durationMs || (p.holdSeconds ? 2200 : 450), loudness);
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
    const isMouse = offset <= -6;
    const durationMs = level === 3 && i === 0 ? 3000 : 900;
    if (T.audio.mode === 'sim') T.tasks.get('loudness').simulate({
      who: offset > 4 ? 'lion' : isMouse ? 'mouse' : 'baseline',
      durationMs,
    });
    const response = await ctx.listen({ maxMs: durationMs + 300, startTimeoutMs: durationMs + 500, endSilenceMs: 350, minDurMs: 250 });
    const valid = response.segments.filter((segment) => !segment.manual && segment.levelDb !== null);
    const best = valid.reduce((a, b) => !a || b.levelDb > a.levelDb ? b : a, null);
    const relativeDb = best && baseDb !== null ? best.levelDb - baseDb : null;
    const frames = best ? T.audio.framesBetween(best.start, best.end) : [];
    const quietFrames = frames.filter((frame) => frame.db >= T.audio.floor + 6
      && baseDb !== null && frame.db <= baseDb - 6);
    measurements.push({
      expectedOffsetDb: offset, relativeDb,
      aboveFloorDb: best ? best.levelDb - T.audio.floor : null,
      holdQuiet: isMouse && frames.length ? quietFrames.length / frames.length : null,
      overShout: !!best && baseDb !== null && best.peakDb - baseDb > 20,
      clipped: !!best && (frames.some((frame) => frame.clipped) || best.peakDb > -1),
    });
    const bar = box.querySelector('.meter i');
    if (best && bar) bar.style.width = `${Math.max(0, Math.min(100, ((best.levelDb - T.audio.floor) / 40) * 100))}%`;
  }
  const mouseValues = measurements.filter((item) => item.expectedOffsetDb <= -6 && Number.isFinite(item.relativeDb)).map((item) => item.relativeDb);
  const lionValues = measurements.filter((item) => item.expectedOffsetDb >= 6 && Number.isFinite(item.relativeDb)).map((item) => item.relativeDb);
  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const mouseMedian = median(mouseValues), lionMedian = median(lionValues);
  const contrastDb = mouseMedian !== null && lionMedian !== null ? lionMedian - mouseMedian : null;
  const holdQuiet = measurements.filter((item) => item.holdQuiet !== null);
  const holdQuietScore = holdQuiet.length
    ? holdQuiet.reduce((sum, item) => sum + item.holdQuiet, 0) / holdQuiet.length : 0;
  const correlation = spearman(
    measurements.map((item) => item.expectedOffsetDb),
    measurements.map((item) => item.relativeDb),
  );
  const slopeMatch = Math.max(0, Math.min(1, correlation));
  const score = baselineRelativeDb === null ? 0
    : 100 * (0.4 * holdQuietScore + 0.4 * Math.min(1, Math.max(0, contrastDb || 0) / 12) + 0.2 * slopeMatch);
  await ctx.say(line('tunnel_praise3'), `tunnel_praise3_${child.gender}_${nonverbal ? 'nv' : 'v'}`);
  const ratio = mouseMedian !== null && lionMedian !== null
    ? +(10 ** (contrastDb / 20)).toFixed(2) : null;
  return {
    rounds: measurements, baseDb, baselineRelativeDb, mouseMedianDb: mouseMedian, lionMedianDb: lionMedian,
    contrastDb, holdQuiet: holdQuietScore, slopeMatch, ratio, score: Math.round(score),
    confidence: measurements.filter((measurement) => measurement.relativeDb !== null).length / measurements.length,
    overShout: measurements.filter((measurement) => measurement.overShout).length, level,
  };
}

function spearman(left, right) {
  const rank = (values) => values.map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value)
    .reduce((ranks, item, index, sorted) => {
      let end = index + 1;
      while (end < sorted.length && sorted[end].value === item.value) end++;
      const average = (index + end - 1) / 2 + 1;
      for (let i = index; i < end; i++) ranks[sorted[i].index] = average;
      return ranks;
    }, new Array(values.length));
  const pairs = left.map((value, index) => [value, right[index]]).filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
  if (pairs.length < 2) return 0;
  const x = rank(pairs.map(([value]) => value)), y = rank(pairs.map(([, value]) => value));
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const covariance = x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0);
  const normX = Math.sqrt(x.reduce((sum, value) => sum + (value - meanX) ** 2, 0));
  const normY = Math.sqrt(y.reduce((sum, value) => sum + (value - meanY) ** 2, 0));
  return normX && normY ? covariance / (normX * normY) : 0;
}
