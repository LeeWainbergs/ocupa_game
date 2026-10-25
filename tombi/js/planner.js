/* planner.js — load-balanced session planning with conservative eligibility filters. */
window.T = window.T || {};

T.planner = (() => {
  const slots = [
    { slot: 'rhythm', candidates: ['march', 'echo', 'clapStomp'] },
    { slot: 'arousal', candidates: ['stompFreeze', 'jumps'] },
    { slot: 'inhibition', candidates: ['magic', 'reverseDrum'] },
    { slot: 'grading', candidates: ['loudness', 'elephantMouse', 'ball'], optional: true },
  ];
  const NEW_TASKS = new Set(['stompFreeze', 'jumps', 'reverseDrum', 'clapStomp', 'ball', 'elephantMouse', 'march']);
  const SEATED_TASKS = new Set(['stompFreeze', 'turtleRabbit', 'elephantMouse', 'march']);
  const MANDATORY_KEYS = new Set(['wakeUp', 'engineStart', 'turtleRabbit', 'snake', 'engineEnd']);
  const hash = (value) => Array.from(String(value)).reduce((result, char) => (result * 31 + char.charCodeAt(0)) >>> 0, 7);
  const seeded = (child, date, taskKey) => ((hash(`${child.id}:${date}:${taskKey}`) % 10000) / 10000);

  function levelFor(task, child) {
    return T.levels && T.levels.NAMES[task.key] ? T.levels.get(child, task.key) : 1;
  }

  function eligible(task, child, setting) {
    if (!task || task.minAge > Number(child.age || 0)) return false;
    if (child.nonverbal && !task.modes.includes('nonverbal')) return false;
    if ((child.excludedTasks || []).includes(task.key)) return false;
    if (task.jump && child.canJump === false) return false;
    if (child.soundSensitive && task.key === 'stompFreeze' && levelFor(task, child) >= 5) return false;
    if (task.needs.hardFloor && !setting.hardFloor) return false;
    if (task.needs.space > 0 && !setting.freeSpace) return false;
    if (setting.room === 'kindergarten' && task.key === 'ball') return false;
    if (task.needs.quietRoom && (setting.room === 'kindergarten' || !setting.quietRoom)) return false;
    if (task.key === 'loudness' && levelFor(task, child) >= 3
      && (setting.room === 'kindergarten' || !setting.quietRoom)) return false;
    if (task.needs.object === 'ball' && !setting.ball) return false;
    if (task.needs.object === 'pot-table' && !setting.pot) return false;
    if (task.needs.standing && child.canStand === false && !SEATED_TASKS.has(task.key)) return false;
    return true;
  }

  function playedKeys(sessions) {
    return new Set(sessions.flatMap((session) => Object.entries(session.stages || {})
      .filter(([, result]) => result && !result.skipped)
      .map(([key]) => key)));
  }

  function wasPlayedRecently(taskKey, sessions) {
    return sessions.some((session) => {
      const result = session.stages && session.stages[taskKey];
      return result && !result.skipped;
    });
  }

  function estimate(entries) {
    const active = entries.filter((entry) => !entry.skip);
    return active.reduce((sum, entry) => {
      const task = T.tasks.get(entry.key);
      if (!task) throw new Error(`Unknown task in session plan: ${entry.key}`);
      return sum + task.durationSec[entry.short ? 'short' : 'full'];
    }, 0) + Math.max(0, active.length - 1) * 15;
  }

  function violatesLoad(plan, child, priorKeys) {
    const active = plan.filter((entry) => !entry.skip);
    if (active.filter((entry) => T.tasks.get(entry.key).jump).length > 1) return true;
    if (active.filter((entry) => NEW_TASKS.has(entry.key) && !priorKeys.has(entry.key)).length > 1) return true;
    if (child.canStand === false) return false;
    return active.some((entry, index) => {
      if (!index) return false;
      const previous = T.tasks.get(active[index - 1].key);
      const task = T.tasks.get(entry.key);
      return previous.gross && previous.needs.standing && task.gross && task.needs.standing;
    });
  }

  function canReplace(plan, index, taskKey, child, setting, history = []) {
    const task = T.tasks.get(taskKey);
    if (!task || !plan[index] || task.slot !== plan[index].slot || !eligible(task, child, setting)) return false;
    const candidate = plan.map((entry, entryIndex) => entryIndex === index
      ? { ...entry, key: task.key, name: task.name, domain: task.domain, skip: false }
      : entry);
    const sessions = history.filter((session) => session.childId === child.id && session.mode !== 'sim'
      && (child.demo ? !!(session.sample || session.demo) : !session.sample && !session.demo));
    return !violatesLoad(candidate, child, playedKeys(sessions));
  }

  function isNewTask(taskKey, child, history = []) {
    const sessions = history.filter((session) => session.childId === child.id && session.mode !== 'sim'
      && (child.demo ? !!(session.sample || session.demo) : !session.sample && !session.demo));
    return NEW_TASKS.has(taskKey) && !playedKeys(sessions).has(taskKey);
  }

  function build(child, setting = {}, history = [], opts = {}) {
    const room = setting.room || 'clinic';
    const normalized = {
      room, hardFloor: setting.hardFloor !== false, freeSpace: setting.freeSpace !== false,
      pot: setting.pot !== false, ball: setting.ball !== false,
      quietRoom: setting.quietRoom !== undefined ? !!setting.quietRoom : room !== 'kindergarten',
      budgetMin: [6, 9, 12].includes(Number(setting.budgetMin)) ? Number(setting.budgetMin) : Number(child.age) < 4 ? 6 : 9,
    };
    const sessions = history.filter((session) => session.childId === child.id && session.mode !== 'sim'
      && (child.demo ? !!(session.sample || session.demo) : !session.sample && !session.demo))
      .sort((a, b) => Number(a.date || 0) - Number(b.date || 0));
    const priorKeys = playedKeys(sessions);
    const recent = sessions.slice(-3);
    const last = sessions[sessions.length - 1];
    const date = opts.date || new Date().toISOString().slice(0, 10);
    const pinned = new Set(opts.pinned || []);
    const chosen = [];

    for (const slot of slots) {
      const options = slot.candidates.map((key) => T.tasks.get(key)).filter((task) => eligible(task, child, normalized));
      if (!options.length) {
        if (slot.optional) continue;
        if (slot.slot === 'rhythm' && eligible(T.tasks.get('echo'), child, normalized)) options.push(T.tasks.get('echo'));
        else if (slot.slot === 'inhibition' && eligible(T.tasks.get('magic'), child, normalized)) options.push(T.tasks.get('magic'));
      }
      const ranked = options.map((task) => {
        const playedRecently = wasPlayedRecently(task.key, recent);
        const previous = last && last.stages && last.stages[task.key];
        const due = playedRecently ? 0 : 1;
        const need = previous && !previous.skipped && Number(previous.score) < 60 ? 1 : 0;
        const novelty = priorKeys.has(task.key) ? 0 : 0.5;
        const playedLast = previous && !previous.skipped ? 1 : 0;
        const linkedGoals = T.goals ? T.goals.goalsForTask(child, task.key, true) : [];
        const goalReviews = linkedGoals.map((goal) => ({ goal, state: T.goals.evaluate(child, goal, sessions) }));
        const activeGoalBoost = goalReviews.length ? 4 : 0;
        const reviewBoost = goalReviews.some(({ state }) => state.review || !state.validCount) ? 1 : 0;
        const score = 3 * due + 2 * need + novelty - 3 * playedLast
          + 4 * (pinned.has(task.key) ? 1 : 0) + activeGoalBoost + reviewBoost
          + seeded(child, date, task.key) / 100;
        return {
          task, score, due: !!due, need: !!need, pinned: pinned.has(task.key), goalReviews,
          isNew: NEW_TASKS.has(task.key) && !priorKeys.has(task.key),
        };
      }).filter((item) => !item.isNew || !chosen.some((selected) => selected.isNew));
      ranked.sort((a, b) => b.score - a.score);
      let pick = ranked[0];
      if (slot.slot === 'rhythm' && !priorKeys.has('echo')) pick = ranked.find((item) => item.task.key === 'echo') || pick;
      if (slot.slot === 'arousal' && chosen.length && chosen[chosen.length - 1].task.gross && pick && pick.task.gross) {
        pick = ranked.find((item) => !item.task.gross) || pick;
      }
      if (slot.slot === 'arousal' && chosen.some((item) => item.task.jump) && pick && pick.task.jump) {
        pick = ranked.find((item) => !item.task.jump) || pick;
      }
      if (pick) {
        const linkedGoal = pick.goalReviews[0] && pick.goalReviews[0].goal;
        const reason = linkedGoal
          ? `קשור למטרה: ${linkedGoal.title}`
          : pick.isNew ? 'חדש' : pick.pinned ? 'משימה נעוצה' : pick.due ? 'לא שוחק בשלושת המפגשים האחרונים' : pick.need ? 'לחיזוק' : 'לפי התוכנית';
        chosen.push({
          task: pick.task, reason, slot: slot.slot, optional: !!slot.optional, isNew: pick.isNew,
          goalIds: pick.goalReviews.map(({ goal }) => goal.id),
        });
      }
    }

    const byKey = Object.fromEntries(chosen.map((item) => [item.task.key, item]));
    let plan = [
      { task: T.tasks.get('wakeUp'), reason: 'כיול פתיחת מפגש', slot: 'calibration' },
      { task: T.tasks.get('engineStart'), reason: 'שאלה על התחושה ונשימת דרקון לבחירה', slot: 'core' },
      byKey.march || byKey.echo || byKey.clapStomp,
      byKey.stompFreeze || byKey.jumps,
      byKey.magic || byKey.reverseDrum,
      byKey.loudness || byKey.elephantMouse || byKey.ball,
      { task: T.tasks.get('turtleRabbit'), reason: 'מעבר להרגעה', slot: 'transition', short: true },
      { task: T.tasks.get('snake'), reason: 'הרגעה', slot: 'calm' },
      { task: T.tasks.get('engineEnd'), reason: 'שאלה על התחושה בסיום', slot: 'core' },
    ].filter(Boolean).map((item) => {
      const goals = T.goals ? T.goals.goalsForTask(child, item.task.key, true) : [];
      return {
        key: item.task.key, name: item.task.name, domain: item.task.domain, slot: item.slot, reason: item.reason,
        short: !!item.short, pinned: pinned.has(item.task.key), optional: !!item.optional,
        mandatory: MANDATORY_KEYS.has(item.task.key), isNew: !!item.isNew,
        goalIds: item.goalIds || goals.map((goal) => goal.id),
      };
    });

    if (violatesLoad(plan, child, priorKeys)) {
      const rhythmIndex = plan.findIndex((entry) => entry.slot === 'rhythm');
      if (rhythmIndex >= 0 && canReplace(plan, rhythmIndex, 'echo', child, normalized, sessions)) {
        const echo = T.tasks.get('echo');
        const goals = T.goals ? T.goals.goalsForTask(child, echo.key, true) : [];
        plan[rhythmIndex] = {
          ...plan[rhythmIndex], key: echo.key, name: echo.name, domain: echo.domain,
          reason: 'ריווח בין משימות תנועה', isNew: false, goalIds: goals.map((goal) => goal.id),
        };
      }
      const grading = plan.find((entry) => entry.slot === 'grading');
      if (grading && violatesLoad(plan, child, priorKeys)) grading.skip = true;
    }

    const budget = normalized.budgetMin * 60;
    if (estimate(plan) > budget) {
      plan = plan.map((entry) => ({ ...entry, short: true }));
      if (estimate(plan) > budget) plan = plan.filter((entry) => entry.slot !== 'grading');
      if (estimate(plan) > budget) plan = plan.filter((entry) => entry.slot !== 'rhythm');
    }
    return {
      tasks: plan, setting: normalized, budgetSec: budget, estimatedSec: estimate(plan),
      reasons: plan.map(({ key, reason }) => ({ key, reason })),
      goals: T.goals ? T.goals.activeApproved(child).map((goal) => ({
        id: goal.id, title: goal.title, state: T.goals.evaluate(child, goal, sessions),
      })) : [],
    };
  }

  return { build, eligible, estimate, canReplace, isNewTask, wasPlayedRecently };
})();
