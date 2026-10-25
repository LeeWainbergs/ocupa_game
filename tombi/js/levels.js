/* levels.js — per-child adaptive difficulty for scored tasks. */
T.levels = (() => {
  const NAMES = {
    echo: 'לתפוס את הקצב',
    loudness: 'עוצמת הקול',
    magic: 'לעצור ולחכות',
    snake: 'להחזיק צליל',
    stompFreeze: 'רוקעים ונעצרים',
    jumps: 'קפיצות הדרקון',
    reverseDrum: 'התוף ההפוך',
    turtleRabbit: 'צב וארנב',
    clapStomp: 'כף-רגל וסיר-שולחן',
    ball: 'כדור הדרקון',
    elephantMouse: 'רגלי פיל ורגלי עכבר',
    march: 'מצעד הדרקון',
  };
  const DESCRIPTIONS = {
    echo: 'האם הילד מצליח להגיד "הופ!" בדיוק בזמן שטומבי ביקש.',
    loudness: 'האם הילד יודע לדבר בשקט או בחזקה לפי מה שהמשחק מבקש.',
    magic: 'האם הילד מגיב למילה כוכב בזמן הנכון ומתאפק כשלא שומעים אותה.',
    snake: 'כמה זמן הילד מצליח להפיק צליל רציף בלי להפסיק באמצע.',
    stompFreeze: 'האם הילד ממשיך לרקוע, עוצר בזמן ומתחיל מחדש.',
    jumps: 'ספירת נחיתות ועצירה במספר יעד.',
    reverseDrum: 'תגובה במספר הפוך למספר פעימות של טומבי.',
    turtleRabbit: 'מעבר מקצב צעדים מהיר לקצב איטי.',
    clapStomp: 'רצף הקשות ומעברים בין סוגי צליל.',
    ball: 'רצף ועקביות של צלילי הקפצת כדור.',
    elephantMouse: 'הבדל בעוצמת רקיעות בין פיל לעכבר.',
    march: 'תזמון צעדים עם פעימה והמשכיות אחריה.',
  };
  const TASKS = Object.keys(NAMES);
  const DEFAULT_LEVEL = 1;
  const clamp = (n) => Math.max(1, Math.min(5, Number(n) || DEFAULT_LEVEL));

  function realSessions(child) {
    if (!T.store || !T.store.sessionsOf) return [];
    return T.store.sessionsOf(child.id).filter((session) => session.mode !== 'sim' && session.mode !== 'sample' && !session.sample);
  }

  function initialLevel(child, task) {
    const recent = realSessions(child).slice().reverse().filter((session) => {
      const stage = session.stages && session.stages[task];
      return stage && !stage.skipped && Number.isFinite(stage.score) && (stage.confidence === undefined || stage.confidence >= 0.6);
    }).slice(0, 2);
    const levelOne = recent.filter((session) => (session.stages[task].level || 1) === DEFAULT_LEVEL);
    if (levelOne.length < 2) return DEFAULT_LEVEL;
    if (levelOne.every((session) => session.stages[task].score >= 80)) return 2;
    if (levelOne.every((session) => session.stages[task].score < 40)
      || levelOne.every((session) => (session.assists || []).some((assist) => assist.stage === task && assist.type === 'physical'))) return 1;
    return DEFAULT_LEVEL;
  }

  function ensure(child) {
    if (!child) return;
    const hadLevels = child.levels && typeof child.levels === 'object';
    child.levels = child.levels && typeof child.levels === 'object' ? child.levels : {};
    child.levelLock = child.levelLock && typeof child.levelLock === 'object' ? child.levelLock : {};
    let changed = !hadLevels;
    TASKS.forEach((task) => {
      if (!Number.isFinite(Number(child.levels[task]))) {
        child.levels[task] = hadLevels ? DEFAULT_LEVEL : initialLevel(child, task);
        changed = true;
      } else child.levels[task] = clamp(child.levels[task]);
      if (typeof child.levelLock[task] !== 'boolean') {
        child.levelLock[task] = false;
        changed = true;
      }
    });
    if (changed && T.store && T.store.save) T.store.save();
  }

  function get(child, task) {
    if (!NAMES[task]) throw new Error(`Unknown task level: ${task}`);
    ensure(child);
    return clamp(child.levels[task]);
  }

  function params(task, level, child) {
    const lv = clamp(level || (child ? get(child, task) : DEFAULT_LEVEL));
    if (task === 'echo') {
      const patterns = {
        1: [[0, 600], [0, 600, 1200], [0, 600]],
        2: [[0, 550], [0, 450, 900], [0, 380, 1150], [0, 380, 760, 1520]],
        3: [[0, 520], [0, 440, 880], [0, 360, 720], [0, 420, 840, 1260], [0, 330, 760, 1190]],
        4: [[0, 360, 720, 1080], [0, 340, 680, 1020, 1360], [0, 380, 760, 1140], [0, 300, 700, 1100, 1500], [0, 320, 640, 1080, 1520]],
        5: [[0, 288, 576, 864], [0, 272, 544, 816, 1088], [0, 304, 608, 912], [0, 240, 560, 880, 1200], [0, 288, 544, 896, 1184]],
      };
      return { patterns: patterns[lv] };
    }
    if (task === 'loudness') return { targetDb: lv === 1 ? 6 : lv === 2 ? 8 : 10, compareCat: lv >= 4, holdSeconds: lv === 5 ? 2 : 0, tunnel: lv >= 3, level: lv };
    if (task === 'magic') {
      const goPattern = [true, true, false, true, true, false, true, true, true, false, true, true];
      const items = goPattern.map((go, index) => {
        const rule = index < 6 ? 'star' : 'moon';
        const targetSound = rule === 'star' ? 'bell' : 'drum';
        if (lv === 1) return { go, kind: 'word', word: 'צפרדע', voice: go ? 'normal' : 'sleepy', rule };
        if (lv === 2) return { go, kind: 'word', word: go ? 'צפרדע' : (index % 2 ? 'צב' : 'צפרדה'), voice: 'normal', rule };
        if (lv === 3 || lv === 4) {
          return { go, kind: 'sound', sound: go ? 'bell' : (index % 2 ? 'drum' : 'chirp'), rule };
        }
        return { go, kind: 'sound', sound: go ? targetSound : (targetSound === 'bell' ? 'drum' : 'bell'), rule };
      });
      return {
        items, responseMs: 2500, irregular: lv >= 4,
        ruleSwitch: lv >= 5, level: lv,
      };
    }
    if (task === 'snake') return {
      targetSeconds: Math.min(12, Math.max(3, (Number(child && child.age) || 5) + 1) + (lv - 1)),
      mode: lv >= 4 ? 'stop-cue' : 'capacity', level: lv,
    };
    if (task === 'stompFreeze') return { level: lv, freezes: lv === 1 ? 2 : 3, freezeMs: lv === 1 ? 2000 : lv === 5 ? 5000 : lv === 2 ? 3000 : 4000, seated: child && child.canStand === false };
    if (task === 'jumps') return { level: lv, target: lv === 1 ? 3 : 5, intervalMs: lv >= 3 ? 800 : null };
    if (task === 'reverseDrum') {
      const irregularIntervals = [2700, 3100, 2500, 3300, 2800, 3200, 2600, 3000, 3400, 2500, 3100, 2700, 3300, 2800, 3200, 2600];
      return {
        level: lv, items: 16, sequence: [2, 1, 2, 2, 1, 1, 1, 2, 1, 2, 2, 1, 1, 2, 2, 1],
        invert: lv >= 2, visualCue: lv === 2, irregular: lv === 5,
        intervalMs: lv === 4 ? 2400 : 3000,
        trialIntervals: lv === 5 ? irregularIntervals : null,
        responseWindowMs: lv >= 4 ? 2000 : 2500,
      };
    }
    if (task === 'turtleRabbit') return { level: lv, phaseMs: lv > 2 ? 6000 : 4500, seated: child && child.canStand === false };
    if (task === 'clapStomp') return { level: lv, sequence: lv < 3 ? ['clap', 'stomp', 'clap', 'stomp', 'clap', 'stomp'] : ['pot', 'table', 'pot', 'table', 'pot', 'table'] };
    if (task === 'ball') return { level: lv, target: lv < 3 ? 4 : 6 };
    if (task === 'elephantMouse') return { level: lv, seated: child && child.canStand === false };
    if (task === 'march') {
      const age = Number(child && child.age) || 5;
      return {
        level: lv, age, ibi: age < 5 ? 425 : 500, count: lv < 3 ? 8 : 12,
        tempoShiftMs: lv >= 4 ? (age < 5 ? 50 : 60) : 0,
        antiPhase: lv >= 5 && age >= 5,
        seated: child && child.canStand === false,
      };
    }
    throw new Error(`Unknown task parameters: ${task}`);
  }

  function updateAfterSession(child, rec) {
    ensure(child);
    const changes = [];
    if (!rec) return changes;
    if (rec.mode === 'sim' || rec.mode === 'sample' || rec.sample || child.sample || rec.aborted) {
      rec.levelChanges = changes;
      return changes;
    }
    const sessions = realSessions(child);
    TASKS.forEach((task) => {
      const level = get(child, task);
      const played = sessions.filter((session) => {
        const result = session.stages && session.stages[task];
        return result && !result.skipped && Number.isFinite(result.score) && (result.confidence === undefined || result.confidence >= 0.6) && (result.level || DEFAULT_LEVEL) === level;
      }).slice(-2);
      if (played.length < 2 || child.levelLock[task]) return;
      const bothHigh = played.every((session) => session.stages[task].score >= 80);
      const bothLowOrPhysical = played.every((session) => session.stages[task].score < 40)
        || played.every((session) => (session.assists || []).some((assist) => assist.stage === task && assist.type === 'physical'));
      const to = bothHigh ? Math.min(5, level + 1) : bothLowOrPhysical ? Math.max(1, level - 1) : level;
      if (to !== level) {
        child.levels[task] = to;
        changes.push({ task, from: level, to });
      }
    });
    rec.levelChanges = changes;
    if (T.store && T.store.save) T.store.save();
    return changes;
  }

  return { get, params, updateAfterSession, NAMES, DESCRIPTIONS, ensure };
})();
