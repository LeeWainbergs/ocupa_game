/* goals.js — clinician-managed child goals linked to task evidence. */
window.T = window.T || {};

T.goals = (() => {
  const CATALOG = [
    {
      key: 'rhythm', title: 'תזמון ורצף', domain: 'תזמון ורצף',
      description: 'תרגול חיקוי קצב, תזמון והמשכיות.',
      tasks: ['echo', 'march', 'clapStomp'],
    },
    {
      key: 'inhibition', title: 'המתנה ועצירה', domain: 'עכבה',
      description: 'תרגול תגובה למטרה, המתנה ועצירה לפי סימן.',
      tasks: ['magic', 'reverseDrum', 'stompFreeze'],
    },
    {
      key: 'regulation', title: 'ויסות תנועה', domain: 'ויסות תנועה',
      description: 'תרגול שינוי קצב, שליטה בתנועה ומעברים.',
      tasks: ['turtleRabbit', 'stompFreeze', 'march'],
    },
    {
      key: 'grading', title: 'דירוג עוצמה', domain: 'דירוג עוצמה',
      description: 'תרגול הבחנה והפקה של עוצמות שונות.',
      tasks: ['loudness', 'elephantMouse'],
    },
    {
      key: 'motor-planning', title: 'תכנון ותיאום מוטורי', domain: 'תכנון מוטורי',
      description: 'תרגול רצף, תיאום ותכנון תנועה.',
      tasks: ['jumps', 'clapStomp', 'ball', 'reverseDrum'],
    },
    {
      key: 'breath', title: 'ויסות נשימה וקול', domain: 'ויסות נשימה',
      description: 'תרגול הפקת צליל רציף ומדורג.',
      tasks: ['snake', 'loudness'],
    },
  ];
  const byKey = Object.fromEntries(CATALOG.map((goal) => [goal.key, goal]));
  const makeId = () => `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  function normalize(goal) {
    const template = byKey[goal.template];
    if (!template) throw new Error(`Unknown goal template: ${goal.template}`);
    const taskKeys = Array.isArray(goal.taskKeys)
      ? [...new Set(goal.taskKeys.filter((key) => template.tasks.includes(key)))]
      : template.tasks.slice();
    if (!taskKeys.length) throw new TypeError(`Goal ${goal.template} must include at least one task`);
    const baseline = goal.baseline === '' || goal.baseline === null || goal.baseline === undefined
      ? null : Number(goal.baseline);
    const target = Number(goal.target);
    if (baseline !== null && (!Number.isFinite(baseline) || baseline < 0 || baseline > 100)) {
      throw new RangeError('Goal baseline must be between 0 and 100');
    }
    if (!Number.isFinite(target) || target < 1 || target > 100) {
      throw new RangeError('Goal target must be between 1 and 100');
    }
    return {
      id: goal.id || makeId(), template: goal.template, title: String(goal.title || '').trim() || template.title,
      domain: template.domain, taskKeys, metric: 'score', unit: 'ציון משימה 0–100',
      baseline, target, status: ['active', 'achieved', 'paused'].includes(goal.status) ? goal.status : 'active',
      approved: !!goal.approved, approvedBy: String(goal.approvedBy || '').trim(),
      approvedAt: Number(goal.approvedAt) || null, createdAt: Number(goal.createdAt) || Date.now(),
    };
  }

  function forChild(child) {
    if (!child) return [];
    if (!Array.isArray(child.goals)) child.goals = [];
    child.goals = child.goals.map(normalize);
    return child.goals;
  }

  function setForChild(child, goals) {
    if (!child) throw new TypeError('A child is required to save goals');
    if (!Array.isArray(goals)) throw new TypeError('Goals must be an array');
    const normalized = goals.map(normalize);
    const ids = new Set();
    normalized.forEach((goal) => {
      if (ids.has(goal.id)) throw new Error(`Duplicate goal id: ${goal.id}`);
      ids.add(goal.id);
    });
    child.goals = normalized;
    T.store.save();
    return child.goals;
  }

  function sessionsFor(child, history) {
    return (history || T.store.sessionsOf(child.id)).filter((session) => {
      if (session.childId !== child.id || session.aborted || session.mode === 'sim') return false;
      return child.demo ? !!(session.sample || session.demo) : !session.sample && !session.demo;
    });
  }

  function evidence(child, goal, history) {
    const rows = [];
    sessionsFor(child, history).forEach((session) => {
      const measurements = goal.taskKeys.flatMap((taskKey) => {
        const result = session.stages && session.stages[taskKey];
        if (!result || result.skipped || !Number.isFinite(result.score)) return [];
        const confidence = result.confidence === undefined ? 1 : Number(result.confidence);
        return [{
          taskKey, score: Number(result.score),
          confidence: Number.isFinite(confidence) ? confidence : 0,
          assisted: (session.assists || []).some((assist) => assist.stage === taskKey && assist.type !== 'repeat'),
        }];
      });
      const valid = measurements.filter((item) => item.confidence >= 0.6);
      if (!measurements.length) return;
      const scored = valid.length ? valid : measurements;
      rows.push({
        sessionId: session.id, date: session.date,
        taskKeys: measurements.map((item) => item.taskKey),
        score: scored.reduce((sum, item) => sum + item.score, 0) / scored.length,
        confidence: scored.reduce((sum, item) => sum + item.confidence, 0) / scored.length,
        valid: valid.length > 0, uncertainCount: measurements.length - valid.length,
        assisted: valid.some((item) => item.assisted),
      });
    });
    return rows.sort((a, b) => a.date - b.date);
  }

  function evaluate(child, goal, history) {
    const rows = evidence(child, goal, history);
    const valid = rows.filter((row) => row.valid);
    const recent = valid.slice(-3);
    const average = (items, key) => items.length
      ? items.reduce((sum, item) => sum + item[key], 0) / items.length : null;
    const scores = recent.map((row) => row.score);
    const first = valid.length ? valid[0].score : null;
    const recentAverage = average(recent, 'score');
    const confidence = average(recent, 'confidence');
    const assistRate = recent.length ? recent.filter((row) => row.assisted).length / recent.length : null;
    const baseline = goal.baseline === null ? first : Number(goal.baseline);
    let trend = 'אין עדיין מספיק מדידות תקפות';
    if (scores.length >= 2) {
      const delta = scores[scores.length - 1] - scores[0];
      trend = delta > 5 ? 'מגמת עלייה במדדים שנאספו' : delta < -5 ? 'נרשמה ירידה במדדים האחרונים' : 'המדדים האחרונים דומים זה לזה';
    }
    const review = rows.some((row) => row.uncertainCount > 0) || rows.length > valid.length
      || (recent.length >= 3 && baseline !== null && recentAverage <= baseline + 3);
    const recommendation = !recent.length
      ? 'נדרשות מדידות תקפות לפני המלצה'
      : confidence < 0.75 || assistRate > 0.5
        ? 'כדאי לבדוק את תנאי המדידה ורמת התמיכה'
        : recentAverage >= goal.target
          ? 'היעד הושג במדידות האחרונות — מומלץ לאשר זאת מקצועית'
          : review
            ? 'מומלץ לעיין במטרה ובדרך המדידה לפני שינוי התוכנית'
            : 'להמשיך לעקוב אחר אותה מטרה';
    return {
      rows, validCount: valid.length, recentCount: recent.length, first, baseline,
      recentAverage, confidence, assistRate, uncertainCount: rows.reduce((sum, row) => sum + row.uncertainCount, 0),
      trend, recommendation,
      review, targetReached: recent.length >= 2 && recentAverage >= goal.target,
      direction: recent.length >= 2 && baseline !== null
        ? Math.sign(recentAverage - baseline) : 0,
    };
  }

  function activeApproved(child) {
    return forChild(child).filter((goal) => goal.status === 'active' && goal.approved);
  }

  function goalsForTask(child, taskKey, approvedOnly = false) {
    const goals = approvedOnly ? activeApproved(child) : forChild(child).filter((goal) => goal.status === 'active');
    return goals.filter((goal) => goal.taskKeys.includes(taskKey));
  }

  function updateCarryover(child, sessionId, text, context = 'home') {
    if (!child) throw new TypeError('A child is required to save carryover notes');
    const clean = String(text || '').trim();
    if (!clean) throw new TypeError('Carryover note cannot be empty');
    child.carryoverNotes = Array.isArray(child.carryoverNotes) ? child.carryoverNotes : [];
    child.carryoverNotes.push({
      id: makeId(), sessionId: sessionId || null, date: Date.now(), context: ['home', 'kindergarten', 'clinic'].includes(context) ? context : 'home',
      text: clean,
    });
    child.carryoverNotes = child.carryoverNotes.slice(-50);
    T.store.save();
    return child.carryoverNotes[child.carryoverNotes.length - 1];
  }

  return { CATALOG, byKey, normalize, forChild, setForChild, evidence, evaluate, activeApproved, goalsForTask, updateCarryover };
})();
