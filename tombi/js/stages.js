/* stages.js — ששת שלבי המפגש. כל שלב מחזיר מדדים גולמיים וציון 0–100. */
T.session = (() => {
  const SKIP = { skip: true };
  const ABORT = { abort: true };
  let child = null, rec = null, nonverbal = false;
  let paused = false, skipFlag = false, abortFlag = false, calmRequested = false, skippedTasks = 0;
  let stageKey = '', lastPrompt = null, liveWindow = null, onManualPick = null;

  const G = (m, f) => (child && child.gender === 'f' ? f : m);
  const $task = () => document.getElementById('task');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function check() {
    while (paused && !abortFlag && !skipFlag) await sleep(120);
    if (abortFlag) throw ABORT;
    if (skipFlag) { skipFlag = false; throw SKIP; }
  }
  async function wait(ms) {
    const end = performance.now() + ms;
    while (performance.now() < end) { await check(); await sleep(Math.min(80, end - performance.now())); }
    await check();
  }
  async function say(text, key) {
    await check();
    if (key && T.lines) {
      const variant = key.match(/^(.+)_([mf])_(nv|v)$/);
      const lineKey = T.lines.has(key) ? key : variant && variant[1];
      if (lineKey && T.lines.has(lineKey)) text = T.lines.get(lineKey, child.gender, nonverbal);
    }
    lastPrompt = { text, key };
    T.tombi.setMood('talk');
    await T.tombi.say(text, key);
    await check();
  }

  /* listen(): opens a response window and gathers the child's sound segments.
     Adult-pitched segments are kept apart and do not count. */
  function listen({ maxMs = 6000, startTimeoutMs = maxMs, endSilenceMs = 1000, minDurMs = 100, stopAfterFirst = false, onLive, signal } = {}) {
    return new Promise((resolve, reject) => {
      const t0 = T.audio.now();
      const segs = [], adult = [];
      let firstOnset = null, lastEnd = null, done = false;
      T.tombi.setMood('listen');
      T.ui.listening(true);
      const off = T.audio.on((type, d) => {
        if (type === 'onset' && d.t >= t0 - 30) {
          if (firstOnset === null) firstOnset = d.t;
          onLive && onLive('onset', d);
        }
        if (type === 'segment' && d.end >= t0) {
          if (d.adult) { adult.push(d); rec.adultIgnored = (rec.adultIgnored || 0) + 1; T.ui.flash('קול מבוגר — לא נספר'); return; }
          if (d.dur >= minDurMs) { segs.push(d); lastEnd = T.audio.now(); onLive && onLive('segment', d); }
        }
        if (type === 'frame') onLive && onLive('frame', d);
      });
      liveWindow = {
        manual() {
          const t = T.audio.now();
          const seg = { start: t, end: t + 300, dur: 300, manual: true, levelDb: null };
          if (firstOnset === null) firstOnset = t;
          segs.push(seg); lastEnd = t + 300;
          onLive && onLive('segment', seg);
          T.ui.flash('סומנה תגובה ידנית');
        },
      };
      const finish = (why) => {
        if (done) return;
        done = true; clearInterval(iv); off(); liveWindow = null;
        T.tombi.setMood('idle'); T.ui.listening(false);
        if (why && why !== 'ok') return reject(why);
        resolve({ t0, t1: T.audio.now(), segments: segs, adult, firstOnset: segs.length ? Math.min(...segs.map((s) => s.start)) : null, anyOnset: firstOnset });
      };
      const iv = setInterval(() => {
        if (signal && signal.cancelled) return finish('ok');
        if (abortFlag) return finish(ABORT);
        if (skipFlag) { skipFlag = false; return finish(SKIP); }
        if (paused) return;
        const el = T.audio.now() - t0;
        const lv = T.audio.level;
        if (stopAfterFirst && segs.length) return finish('ok');
        if (el > maxMs && !lv.active) return finish('ok');
        if (el > maxMs + 6000) return finish('ok');
        if (!segs.length && firstOnset === null && el > startTimeoutMs) return finish('ok');
        if (lastEnd && !lv.active && T.audio.now() - lastEnd > endSilenceMs) return finish('ok');
      }, 50);
    });
  }

  // syllable / clap peaks inside the child's segments
  function countPeaks(t0, t1, segments) {
    const fr = T.audio.framesBetween(t0, t1);
    const inSeg = (t) => segments.some((s) => !s.manual && t >= s.start - 30 && t <= s.end + 30);
    const thr = T.audio.floor + T.audio.cfg.sensitivity;
    const sm = fr.map((f, i) => ({ t: f.t, v: (fr[Math.max(0, i - 1)].db + f.db + fr[Math.min(fr.length - 1, i + 1)].db) / 3 }));
    const onsets = [];
    let inPeak = false, valley = Infinity, peak = -Infinity, lastOn = -1e9;
    for (const f of sm) {
      if (!inPeak) {
        valley = Math.min(valley, f.v);
        if (f.v > thr && f.v > valley + 6 && f.t - lastOn > 110 && inSeg(f.t)) { inPeak = true; peak = f.v; onsets.push(f.t); lastOn = f.t; }
      } else {
        peak = Math.max(peak, f.v);
        if (f.v < peak - 7 || f.v < thr - 3) { inPeak = false; valley = f.v; }
      }
    }
    return onsets;
  }

  // ---------- word matching for צב / דג / קוף ----------
  const WORDS = ['turtle', 'fish', 'monkey'];
  function classify(seg) {
    const audio = T.audio.grab(seg.start, seg.end);
    const feats = T.dsp.mfcc(audio);
    const tpl = (child && child.templates) || {};
    const ready = WORDS.every((w) => tpl[w] && tpl[w].length);
    if (ready && feats.length > 5) {
      const dist = WORDS.map((w) => Math.min(...tpl[w].map((t) => T.dsp.dtw(feats, t))));
      const order = dist.map((d, i) => [d, i]).sort((a, b) => a[0] - b[0]);
      const margin = (order[1][0] - order[0][0]) / order[0][0];
      return { word: WORDS[order[0][1]], confident: margin > 0.1, margin, feats };
    }
    // no samples yet: only the "ts" of צב is reasonably clear
    const sib = T.dsp.onsetSibilance(audio);
    return { word: sib > 0.4 ? 'turtle' : null, confident: false, margin: 0, feats };
  }

  // ---------- UI helpers ----------
  const ENGINE = {
    turtle: { label: 'צב', note: 'איטי', emoji: '🐢' },
    fish: { label: 'דג', note: 'בדיוק טוב', emoji: '🐟' },
    monkey: { label: 'קוף', note: 'מהיר מדי', emoji: '🐒' },
  };
  T.ENGINE = ENGINE;

  function stageHeader(stage, i) {
    stageKey = stage.key;
    T.ui.setStage(i, stage);
  }

  const PRAISES = [['כל הכבוד!', 'praise1'], ['יופי!', 'praise2'], ['מעולה!', 'praise3'], ['איזה יופי!', 'praise4']];
  let praiseI = 0;
  function praise() { const p = PRAISES[praiseI++ % PRAISES.length]; lastPraiseKey = p[1]; return p[0]; }
  let lastPraiseKey = null;

  const DEFAULT_PLAN = ['wakeUp', 'engineStart', 'echo', 'loudness', 'magic', 'snake', 'engineEnd'];
  let STAGES = DEFAULT_PLAN.map((key) => T.tasks.get(key));

  function resolvePlan(plan) {
    const entries = plan === undefined
      ? DEFAULT_PLAN.map((key) => ({ key, reason: 'סדר המפגש הקיים' }))
      : Array.isArray(plan) ? plan : plan && plan.tasks;
    if (!Array.isArray(entries)) throw new TypeError('Session plan must be an array of task keys');
    return entries.map((entry) => {
      const normalized = typeof entry === 'string' ? { key: entry } : entry;
      const task = T.tasks.get(normalized && normalized.key);
      if (!task) throw new Error(`Unknown task in session plan: ${normalized && normalized.key}`);
      return {
        ...normalized,
        key: task.key,
        name: task.name,
        domain: task.domain,
        reason: normalized.reason || 'תוכנית מותאמת',
      };
    });
  }

  function taskContext() {
    const context = {
      listen, say, wait, check, countPeaks, praise, G, child, nonverbal,
      taskBox: $task,
      classify,
      words: WORDS,
      engineLabels: ENGINE,
      setManualPick(fn) { onManualPick = fn; },
    };
    Object.defineProperty(context, 'lastPraiseKey', { get: () => lastPraiseKey });
    return context;
  }

  async function run(c, opts = {}) {
    child = c; nonverbal = !!c.nonverbal;
    T.tombi.setSoundSensitive(!!c.soundSensitive);
    T.levels.ensure(c);
    paused = false; skipFlag = false; abortFlag = false;
    calmRequested = false; skippedTasks = 0;
    T.ui.offerCalm && T.ui.offerCalm(false);
    const generated = opts.plan === undefined && T.planner
      ? T.planner.build(c, opts.setting || {}, T.store.sessionsOf(c.id))
      : null;
    const planned = generated ? generated.tasks : opts.plan;
    const setting = opts.setting || generated && generated.setting || {};
    const plan = resolvePlan(planned);
    STAGES = plan.map((entry) => T.tasks.get(entry.key));
    T.ui.setPlan && T.ui.setPlan(plan);
    rec = {
      childId: c.id, date: Date.now(), nonverbal, mode: T.audio.mode, stages: {}, assists: [],
      adultIgnored: 0, levelChanges: [], plan, setting,
      demo: !!c.demo, sample: !!c.sample,
      clinicianApproved: !!opts.clinicianApproved,
      goalSnapshot: T.goals ? T.goals.activeApproved(c).map((goal) => ({
        id: goal.id, title: goal.title, taskKeys: goal.taskKeys.slice(), baseline: goal.baseline, target: goal.target,
      })) : [],
    };
    const startT = performance.now();
    await say(`שלום ${c.name}! אני טומבי. בוא${G('', 'י')} נשחק ביחד!`, null);
    for (let i = 0; i < plan.length; i++) {
      const entry = plan[i];
      const task = T.tasks.get(entry.key);
      if (entry.skip) {
        rec.stages[entry.key] = { skipped: true, score: null, short: !!entry.short, reason: entry.reason || 'לא נכללה במפגש' };
        T.ui.stageDone(i, null);
        continue;
      }
      if (calmRequested && !['transition', 'calm'].includes(entry.slot) && !['turtleRabbit', 'snake', 'engineEnd'].includes(entry.key)) {
        rec.stages[entry.key] = { skipped: true, score: null, short: !!entry.short, reason: 'מעבר להרגעה' };
        T.ui.stageDone(i, null);
        continue;
      }
      stageHeader(task, i);
      const key = task.key;
      const level = T.levels.NAMES[key] ? T.levels.get(c, key) : null;
      try {
        if (entry.optional && planBudgetExceeded(startT, rec.setting)) {
          rec.stages[key] = { skipped: true, score: null, short: !!entry.short, reason: 'חריגה מתקציב הזמן', ...(level ? { level } : {}) };
          T.ui.stageDone(i, null);
          continue;
        }
        const params = task.params(level || 1, c.age, c);
        params.short = !!entry.short;
        const r = await task.run(taskContext(), params);
        if (r) {
          if (level && !r.level) r.level = level;
          r.short = !!params.short;
        }
        rec.stages[key] = r;
        T.ui.stageDone(i, r);
        if (key === 'engineStart' && r && r.choice && T.planner) {
          const replace = (slot, taskKey, reason) => {
            const index = plan.findIndex((item) => item.slot === slot);
            const next = T.tasks.get(taskKey);
            if (!next || index < 0 || plan[index].key === taskKey) return false;
            const history = T.store.sessionsOf(c.id);
            if (!T.planner.canReplace(plan, index, taskKey, c, setting, history)) {
              const gradingIndex = plan.findIndex((item) => item.slot === 'grading' && item.optional && !item.skip);
              const wouldExceedNewLimit = T.planner.isNewTask(taskKey, c, history)
                && plan.filter((item, itemIndex) => itemIndex !== index && !item.skip
                  && T.planner.isNewTask(item.key, c, history)).length > 0;
              if (!wouldExceedNewLimit || gradingIndex < 0 || gradingIndex === index
                || !T.planner.isNewTask(plan[gradingIndex].key, c, history)) return false;
              plan[gradingIndex] = { ...plan[gradingIndex], skip: true, reason: 'הותאם למגבלת משימה חדשה אחת' };
              if (!T.planner.canReplace(plan, index, taskKey, c, setting, history)) {
                plan[gradingIndex] = { ...plan[gradingIndex], skip: false };
                return false;
              }
            }
            plan[index] = { ...plan[index], key: taskKey, name: next.name, domain: next.domain, reason };
            if (T.goals) plan[index].goalIds = T.goals.goalsForTask(c, taskKey, true).map((goal) => goal.id);
            rec.plan = plan.map((item) => ({ ...item }));
            STAGES[index] = next;
            T.ui.setPlan && T.ui.setPlan(plan);
            return true;
          };
          if (r.choice === 'monkey') {
            replace('rhythm', 'echo', 'התאמה למנוע מהיר');
            replace('arousal', 'stompFreeze', 'הקפאה ארוכה לפי בדיקת המנוע');
          } else if (r.choice === 'turtle') {
            if (c.canStand === false) {
              replace('rhythm', 'march', 'אפשרות מעוררת לפי בדיקת המנוע');
              replace('arousal', 'jumps', 'אפשרות מעוררת לפי בדיקת המנוע');
            } else if (c.canJump !== false) {
              replace('rhythm', 'echo', 'ריווח לפני משימת תנועה מעוררת');
              replace('arousal', 'jumps', 'אפשרות מעוררת לפי בדיקת המנוע');
            }
          }
        }
        if (r && Number.isFinite(r.score) && (r.score < 30 || rec.assists.filter((a) => a.stage === key && ['model', 'physical'].includes(a.type)).length >= 3)) {
          const next = plan.slice(i + 1).find((entry) => !['engineStart', 'engineEnd'].includes(entry.key));
          if (next) next.short = true;
        }
      } catch (e) {
        if (e === SKIP) {
          rec.stages[key] = { skipped: true, score: null, short: !!entry.short, ...(level ? { level } : {}) };
          skippedTasks++;
          if (skippedTasks >= 2) T.ui.offerCalm && T.ui.offerCalm(true);
          const next = plan.slice(i + 1).find((item) => !['engineStart', 'engineEnd'].includes(item.key));
          if (next) next.short = true;
          T.ui.stageDone(i, null); T.tombi.stopSpeaking(); T.audio.setGate(false); continue;
        }
        if (e === ABORT) break;
        throw e;
      }
    }
    rec.durationSec = Math.round((performance.now() - startT) / 1000);
    rec.aborted = abortFlag;
    const done = Object.values(rec.stages).filter((s) => !s.skipped).length;
    if (done > 0) {
      T.store.addSession(rec);
      T.levels.updateAfterSession(c, rec);
    }
    if (!abortFlag) {
      T.tombi.chime('end'); T.tombi.happy();
      await T.tombi.say(`סיימנו! את${G('ה', '')} ${G('אלוף', 'אלופה')}. להתראות!`, `end_${c.gender}`);
    }
    T.tombi.setSoundSensitive(false);
    T.ui.offerCalm && T.ui.offerCalm(false);
    return done > 0 ? rec : null;
  }

  function planBudgetExceeded(startT, setting) {
    const budgetSec = Number(setting && setting.budgetMin) * 60;
    return Number.isFinite(budgetSec) && budgetSec > 0 && (performance.now() - startT) / 1000 > budgetSec + 120;
  }

  return {
    run, get STAGES() { return STAGES; }, listen, classify, G,
    get record() { return rec; },
    get stageKey() { return stageKey; },
    get paused() { return paused; },
    pause(v) { paused = v; if (v) T.tombi.stopSpeaking(); },
    skip() { skipFlag = true; T.tombi.stopSpeaking(); },
    jumpToCalm() { calmRequested = true; skipFlag = true; T.tombi.stopSpeaking(); },
    abort() { abortFlag = true; T.tombi.stopSpeaking(); },
    manual() { liveWindow && liveWindow.manual(); },
    pickEngine(w) { onManualPick && onManualPick(w); },
    repeat() { if (lastPrompt) { rec && rec.assists.push({ stage: stageKey, type: 'repeat', t: Date.now() }); T.tombi.say(lastPrompt.text, lastPrompt.key); } },
    assist(type) { if (rec) rec.assists.push({ stage: stageKey, type, t: Date.now() }); },
    setChildForTeaching(c) { child = c; },
  };
})();
