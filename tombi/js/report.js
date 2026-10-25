/* report.js — דוח התקדמות למטפלת ולהורים: משפטי סיכום, גרפים וטבלת מפגשים */
T.report = (() => {
  const FEELING_NAMES = {
    happy: 'שמחה', calm: 'רוגע', tired: 'עייפות', sad: 'עצב',
    worried: 'דאגה', angry: 'כעס', unsure: 'לא בטוח/ה', preferNot: 'לא רוצה לבחור',
  };
  const ASSIST = { verbal: 'מילולית', model: 'הדגמה', physical: 'פיזית', gesture: 'רמז/הצבעה', repeat: 'חזרה על הוראה' };
  const fmtDate = (t) => new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  const fmtDateLong = (t) => new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (v, d = 1) => (v === null || v === undefined || isNaN(v) ? '—' : (+v).toFixed(d).replace(/\.0$/, ''));
  const st = (s, k) => (s.stages && s.stages[k] && !s.stages[k].skipped ? s.stages[k] : null);
  const realAssists = (s) => (s.assists || []).filter((a) => a.type !== 'repeat');
  const mean = (values) => {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  };
  const TASK_RAW_METRICS = {
    stompFreeze: [
      ['עצירות תקינות %', (r) => Number.isFinite(r.freezeOK) ? r.freezeOK * 100 : null],
      ['תגובות בהקפאה', (r) => r.freezeEvents],
      ['השהיית עצירה מ״ש', (r) => r.stopLatMs],
      ['השהיית חידוש ממוצעת מ״ש', (r) => mean(r.restartLatMs || [])],
      ['השתתפות %', (r) => Number.isFinite(r.engage) ? r.engage * 100 : null],
    ],
    jumps: [
      ['נחיתות', (r) => r.count],
      ['יעד נחיתות', (r) => r.targetTotal],
      ['שגיאת ספירה', (r) => r.countErr],
      ['נחיתות עודפות', (r) => r.overshoot],
      ['מקדם שונות IOI', (r) => r.cvIoi],
    ],
    reverseDrum: [
      ['מצב', (r) => r.mode === 'reverse' ? 'היפוך' : r.mode === 'imitation' ? 'חיקוי' : null],
      ['נכונים מתוך מנוקדים', (r) => Number.isFinite(r.correctCount) && Number.isFinite(r.scoredItemCount) ? `${r.correctCount}/${r.scoredItemCount}` : null],
      ['נכונים בטרום־מבחן', (r) => r.pretestCorrectCount],
      ['שגיאות חיקוי', (r) => r.imitationErrors],
      ['שגיאות אחרות', (r) => r.otherErrors],
    ],
    turtleRabbit: [
      ['קצב ארנב מ״ש', (r) => r.smtMs],
      ['יחס האטה', (r) => r.slowRatio],
      ['מקדם שונות צב', (r) => r.slowCv],
      ['שמירת האטה %', (r) => Number.isFinite(r.hold) ? r.hold * 100 : null],
    ],
    clapStomp: [
      ['דיוק רצף %', (r) => Number.isFinite(r.sequenceAccuracy) ? r.sequenceAccuracy * 100 : null],
      ['מעברים מתחלפים %', (r) => Number.isFinite(r.alternating) ? r.alternating * 100 : null],
      ['מקדם שונות IOI', (r) => r.cvIoi],
      ['onsets בטוחים', (r) => r.confidentOnsets],
    ],
    ball: [
      ['רצף מרבי', (r) => r.streak],
      ['זוהתה נפילה', (r) => typeof r.ballFell === 'boolean' ? (r.ballFell ? 'כן' : 'לא') : null],
      ['מקדם שונות IOI', (r) => r.cvIoi],
      ['סטיית עוצמה dB', (r) => r.peakDbSd],
    ],
    elephantMouse: [
      ['פיל dB', (r) => r.elephantDb],
      ['עכבר dB', (r) => r.mouseDb],
      ['ניגוד dB', (r) => r.contrastDb],
      ['הפרדה', (r) => r.separation],
      ['פיזור dB', (r) => r.spreadDb],
    ],
    march: [
      ['התאמת קצב', (r) => r.tempoMatch],
      ['מקדם שונות ITI', (r) => r.cvIti],
      ['אורך וקטור פאזה', (r) => r.phaseVectorLength],
      ['אסינכרוניה ממוצעת מ״ש', (r) => r.meanAsynchronyMs],
      ['פגיעות בחלון %', (r) => Number.isFinite(r.hitPercent) ? r.hitPercent * 100 : null],
      ['צעדי המשך', (r) => r.continuationSteps],
      ['סחיפת המשך מ״ש/צעד', (r) => r.continuationDriftMsPerStep],
      ['צעדים להתאוששות מטמפו', (r) => r.tempoRecoverySteps],
    ],
    snake: [
      ['משך ניסיונות ש׳', (r) => Array.isArray(r.durations) ? r.durations.join(' / ') : null],
      ['סטיית תקן בין ניסיונות ש׳', (r) => r.trialSd],
      ['יעד ש׳', (r) => r.targetSec],
      ['יציבות dB', (r) => r.bestStabilityDb],
      ['יחס סיבילנטיות', (r) => r.sibilanceRatio],
      ['חזרות בגלל הפסקה', (r) => r.breakCount],
      ['נקטע', (r) => typeof r.clipped === 'boolean' ? (r.clipped ? 'כן' : 'לא') : null],
      ['חביון עצירה מ״ש', (r) => r.stopLatencyMs],
      ['חביון עצירה לפי ניסיון מ״ש', (r) => Array.isArray(r.trialLatenciesMs) ? r.trialLatenciesMs.map((value) => value ?? '—').join(' / ') : null],
      ['מדידות תקפות', (r) => r.nValid],
    ],
    crystalTower: [
      ['קומות שדווחו', (r) => otMetric(r, 'floors_reported') !== null ? `${otMetric(r, 'floors_reported')}/${otMetric(r, 'floors_target')}` : null],
      ['משך כולל ש׳', (r) => otMetric(r, 'total_duration_sec')],
      ['זמן בין דיווחים ש׳', (r) => otList(r, 'inter_response_time_sec')],
      ['זמן בנייה לקומה ש׳', (r) => otList(r, 'latency_sec')],
      ['דיווחים ידניים', (r) => otMetric(r, 'floors_reported_by_aide')],
      ['דיווחים שהחלו בזמן ההנחיה', (r) => otMetric(r, 'responses_sounding_at_window_open') || null],
    ],
    calmingPotion: [
      ['נשיפה רציפה ארוכה ש׳', (r) => otMetric(r, 'duration_sec')],
      ['משך לפי ניסיון ש׳', (r) => otList(r, 'exhale_duration_sec')],
      ['יציבות עוצמה (0–1)', (r) => otMetric(r, 'audio_stability_score')],
      ['יציבות גובה צליל (0–1)', (r) => otMetric(r, 'pitch_stability_score')],
      ['הפסקות', (r) => otMetric(r, 'break_count_total')],
    ],
    emotionGuess: [
      ['סיפורים עם תגובה', (r) => otMetric(r, 'stories_with_response') !== null ? `${otMetric(r, 'stories_with_response')}/${otMetric(r, 'stories_presented')}` : null],
      ['זמן תגובה ש׳', (r) => otList(r, 'latency_sec')],
      ['משך דיבור כולל ש׳', (r) => otMetric(r, 'vocal_engagement_sec')],
      ['תגובות שהחלו בזמן ההנחיה', (r) => otMetric(r, 'responses_sounding_at_window_open') || null],
      ['סימוני סייעת תואמים', (r) => otMetric(r, 'aide_coded_count') ? `${otMetric(r, 'aide_coded_match_count')}/${otMetric(r, 'aide_coded_count')}` : null],
    ],
  };
  function otMetric(result, key) {
    const value = result && result.ot && result.ot.metrics ? result.ot.metrics[key] : undefined;
    return value === undefined ? null : value;
  }
  function otList(result, key) {
    const values = otMetric(result, key);
    return Array.isArray(values) && values.length ? values.map((value) => value ?? '—').join(' / ') : null;
  }
  function taskRawMetrics(key, result) {
    return (TASK_RAW_METRICS[key] || []).map(([label, getValue]) => [label, getValue(result || {})]);
  }
  function rawSummary(key, result, limit = 2) {
    return taskRawMetrics(key, result).filter(([, value]) => value !== null && value !== undefined && value !== '')
      .slice(0, limit).map(([label, value]) => `${label}: ${formatMetric(value)}`).join(' · ');
  }
  const formatMetric = (value) => typeof value === 'number' ? num(value, 1) : String(value);

  function sentences(child, sessions) {
    const out = [];
    const last = sessions[sessions.length - 1], prev = sessions[sessions.length - 2];
    if (!last) return out;

    const startFeeling = FEELING_NAMES[st(last, 'engineStart')?.feeling];
    const endFeeling = FEELING_NAMES[st(last, 'engineEnd')?.feeling];
    if (startFeeling || endFeeling) {
      out.push({
        domain: 'מצב רגשי',
        text: [
          startFeeling && `בתחילת המפגש: ${startFeeling}`,
          endFeeling && `בסיום: ${endFeeling}`,
        ].filter(Boolean).join(' · '),
      });
    }
    const L = st(last, 'loudness'), Lp = prev && st(prev, 'loudness');
    if (L && L.ratio) out.push({ domain: 'הפקת קול', text: `יחס העוצמה שנמדד בין קול חזק לחלש: ${num(L.ratio)}${Lp && Lp.ratio ? ` (במפגש הקודם: ${num(Lp.ratio)})` : ''}` });
    const M = st(last, 'magic'), Mp = prev && st(prev, 'magic');
    if (M) out.push({ domain: 'עיכוב תגובה וקשב שמיעתי', text: `${M.falseAlarms} תגובות שווא מתוך ${M.nDistractors}${Mp ? ` (במפגש הקודם: ${Mp.falseAlarms})` : ''}; זוהו ${M.hits} מתוך ${M.nTargets} ${M.targetWord ? `הופעות של מילת המטרה „${M.targetWord}”` : 'מטרות'}${M.meanRtMs ? `; זמן תגובה ממוצע: ${num(M.meanRtMs / 1000)} שניות` : ''}` });
    const S5 = st(last, 'snake'), S5p = prev && st(prev, 'snake');
    if (S5) out.push({ domain: 'משך הפקת צליל', text: `משך ממוצע של ${num(S5.mean)} שניות${S5p ? ` (במפגש הקודם: ${num(S5p.mean)} שניות)` : ''}` });
    const E = st(last, 'echo'), Ep = prev && st(prev, 'echo');
    if (E) out.push({ domain: 'חיקוי תבניות קצב', text: `${E.correctCount} מתוך ${E.trials.length} תבניות בוצעו במספר הפעימות הנכון${E.meanDevMs !== null ? `; סטייה ממוצעת: ${E.meanDevMs} מ״ש` : ''}${Ep ? ` (במפגש הקודם: ${Ep.correctCount} מתוך ${Ep.trials.length})` : ''}` });
    const A = realAssists(last), Ap = prev ? realAssists(prev) : null;
    const byType = {};
    A.forEach((a) => (byType[a.type] = (byType[a.type] || 0) + 1));
    const parts = Object.entries(byType).map(([k, v]) => `${v} ${ASSIST[k] || k}`).join(', ');
    out.push({ domain: 'תמיכה במהלך המפגש', text: A.length ? `נרשמו ${A.length} אירועי סיוע: ${parts}${Ap ? ` (במפגש הקודם: ${Ap.length})` : ''}` : `לא נרשמו אירועי סיוע${Ap && Ap.length ? ` (במפגש הקודם: ${Ap.length})` : ''}` });
    return out;
  }

  // ---------- charts (inline SVG, single series each) ----------
  function lineChart({ title, unit, sessions, value, fmt = (v) => num(v), yMax, yMin = 0, task, width = 340, height = 170, detail, showPointValues = false }) {
    const pts = sessions.map((s, i) => ({ i, s, v: value(s) })).filter((p) => p.v !== null && p.v !== undefined && !isNaN(p.v));
    const taskAttribute = task ? ` data-task="${esc(task)}"` : '';
    if (!pts.length) return `<figure class="chart"${taskAttribute}><figcaption>${esc(title)}</figcaption><p class="chart-empty">אין עדיין מדידות בתחום הזה</p></figure>`;
    const W = width, H = height, P = { l: width > 400 ? 44 : 34, r: 14, t: 20, b: 35 };
    const max = yMax ?? (Math.max(...pts.map((p) => p.v)) * 1.2 || 1);
    const n = sessions.length;
    const x = (i) => (n === 1 ? (P.l + W - P.r) / 2 : P.l + (i / (n - 1)) * (W - P.l - P.r));
    const y = (v) => H - P.b - ((v - yMin) / (max - yMin)) * (H - P.t - P.b);
    const ticks = [yMin, (yMin + max) / 2, max];
    const path = pts.map((p, k) => `${k && p.i === pts[k - 1].i + 1 ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const lastP = pts[pts.length - 1];
    const markers = task ? sessions.map((session, i) => {
      const stage = session.stages && session.stages[task];
      const previous = i > 0 && sessions[i - 1].stages && sessions[i - 1].stages[task];
      if (!stage || !previous || (stage.level || 1) === (previous.level || 1)) return '';
      return `<g class="level-marker"><line x1="${x(i)}" x2="${x(i)}" y1="${P.t}" y2="${H - P.b}"/><text x="${Math.min(x(i) + 4, W - P.r - 48)}" y="${P.t + 11}">שלב ${stage.level || 1}</text></g>`;
    }).join('') : '';
    const chartSummary = pts.map((point) => {
      const stage = task && point.s.stages && point.s.stages[task];
      const confidence = stage && Number.isFinite(stage.confidence) && stage.confidence < 0.6 ? ' · ביטחון זיהוי נמוך' : '';
      return `${fmtDateLong(point.s.date)}: ${fmt(point.v)}${confidence}`;
    }).join('; ');
    return `<figure class="chart"${taskAttribute}><figcaption>${esc(title)}${unit ? ` <span class="unit">(${esc(unit)})</span>` : ''}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${title}. ${chartSummary}`)}" direction="ltr">
        ${ticks.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
        ${sessions.map((s, i) => (n <= 5 || i % Math.ceil(n / 4) === 0 || i === n - 1) ? `<text class="tick" x="${x(i)}" y="${detail ? H - 19 : H - 8}" text-anchor="middle">${fmtDate(s.date)}</text>${detail ? `<text class="tick chart-count" x="${x(i)}" y="${H - 4}" text-anchor="middle">מפגש ${i + 1} · ${detail(s).replace(' משימות', '')}</text>` : ''}` : '').join('')}
        ${markers}
        <path class="line" d="${path}"/>
        ${pts.map((p) => {
          const stage = task && p.s.stages && p.s.stages[task];
          const level = stage && (stage.level || 1);
          const label = detail ? ` · ${detail(p.s)}` : '';
          const showValue = showPointValues && (n <= 6 || p.i % 2 === 0 || p.i === n - 1);
          const lowConfidence = stage && Number.isFinite(stage.confidence) && stage.confidence < 0.6;
          return `<g class="pt"><circle cx="${x(p.i)}" cy="${y(p.v)}" r="12" class="hit"/><circle cx="${x(p.i)}" cy="${y(p.v)}" r="${p === lastP ? 5 : 3.5}" class="dot${p === lastP ? ' last' : ''}${lowConfidence ? ' low-confidence' : ''}"/>${showValue ? `<text class="point-value" x="${x(p.i)}" y="${Math.max(P.t + 10, y(p.v) - 10)}" text-anchor="middle">${fmt(p.v)}</text>` : ''}<title>${fmtDateLong(p.s.date)}: ${fmt(p.v)}${unit ? ' ' + unit : ''}${level ? ` · שלב ${level}` : ''}${lowConfidence ? ' · ביטחון זיהוי נמוך' : ''}${label}</title></g>`;
        }).join('')}
        ${detail || showPointValues ? '' : `<text class="endlabel" x="${Math.min(x(lastP.i), W - P.r - 2)}" y="${y(lastP.v) - 10}" text-anchor="${n === 1 ? 'middle' : 'end'}">${fmt(lastP.v)}${task && lastP.s.stages && lastP.s.stages[task] ? ` · שלב ${lastP.s.stages[task].level || 1}` : ''}</text>`}
      </svg></figure>`;
  }

  const SCORE_TASKS = ['echo', 'loudness', 'magic', 'snake'];
  function scoreTrendCharts(sessions) {
    return `<div class="chart-grid score-trend-grid">${SCORE_TASKS.map((key) => lineChart({
      title: T.tasks.get(key).name,
      unit: 'ציון 0–100',
      sessions,
      task: key,
      value: (session) => {
        const stage = st(session, key);
        return stage && Number.isFinite(stage.score) ? stage.score : null;
      },
      yMax: 100,
      width: 360,
      height: 190,
      showPointValues: true,
    })).join('')}</div>`;
  }

  function taskResult(s, k) {
    const v = st(s, k);
    if (!s.stages[k]) return '—';
    if (s.stages[k].skipped) return 'דולג';
    if (k.startsWith('engine')) return FEELING_NAMES[v && v.feeling] || '—';
    const lowConfidence = Number.isFinite(v.confidence) && v.confidence < 0.6;
    const metrics = taskRawMetrics(k, v).filter(([, value]) => value !== null && value !== undefined)
      .map(([label, value]) => `${label}: ${formatMetric(value)}`);
    const scoreBadge = Number.isFinite(v.score) || !(T.ot && T.ot.isOtTask(k))
      ? `<span class="score s${Math.min(4, Math.floor((v.score ?? 0) / 25))}">${v.score ?? '—'}</span>`
      : '<span class="score-raw">מדדים גולמיים</span>';
    return `${scoreBadge}${v.level ? `<small class="score-level"> · שלב ${v.level}</small>` : ''}${lowConfidence ? '<small class="score-level"> · זיהוי חלקי</small>' : ''}${metrics.length ? `<small class="score-metrics">${metrics.map(esc).join('<br>')}</small>` : ''}`;
  }

  function scoreCell(s, k) {
    const v = st(s, k);
    const lowConfidence = Number.isFinite(v && v.confidence) && v.confidence < 0.6;
    return `<td${lowConfidence ? ' class="low-confidence" title="זיהוי חלקי — ביטחון נמוך מ־60%"' : ''}>${taskResult(s, k)}</td>`;
  }

  function pdfTaskResult(session, key) {
    const stage = session.stages && session.stages[key];
    if (!stage) return '—';
    if (stage.skipped) return 'דולג';
    if (key.startsWith('engine')) return FEELING_NAMES[stage.feeling] || '—';
    if (!Number.isFinite(stage.score) && T.ot && T.ot.isOtTask(key)) {
      const metrics = taskRawMetrics(key, stage).filter(([, value]) => value !== null && value !== undefined);
      return metrics.length ? `<small class="score-metrics">${metrics.map(([label, value]) => esc(`${label}: ${formatMetric(value)}`)).join('<br>')}</small>` : 'לא נמדד';
    }
    if (!Number.isFinite(stage.score)) return 'לא נמדד';
    const lowConfidence = Number.isFinite(stage.confidence) && stage.confidence < 0.6;
    return `<span class="score s${Math.min(4, Math.floor(stage.score / 25))}">${stage.score}</span>${stage.level ? `<small class="score-level">שלב ${stage.level}</small>` : ''}${lowConfidence ? '<small class="score-level">זיהוי חלקי</small>' : ''}`;
  }

  function sessionPdfDetails(sessions, tasks) {
    return `<div class="pdf-only pdf-session-details">${sessions.slice().reverse().map((session) => {
      const measuredTasks = tasks.filter((task) => session.stages && session.stages[task.key]);
      const mode = session.mode === 'sim' ? ' · מפגש סימולציה' : session.sample ? ' · נתוני דוגמה' : '';
      const rows = measuredTasks.map((task) => `<div class="pdf-session-task">
        <dt>${esc(task.name)}${task.domain ? `<small>${esc(task.domain)}</small>` : ''}</dt>
        <dd>${pdfTaskResult(session, task.key)}</dd>
      </div>`).join('');
      return `<article class="pdf-session-record">
        <header><h3>${fmtDateLong(session.date)}</h3><p>${session.durationSec ? `${Math.round(session.durationSec / 60)} דקות` : 'משך לא תועד'} · ${esc(sessionLevels(session))}${mode}</p></header>
        ${rows ? `<dl>${rows}</dl>` : '<p class="hint">לא תועדו מדידות במפגש זה.</p>'}
        <p class="pdf-session-support">עזרה של הסייעת: ${realAssists(session).length}</p>
      </article>`;
    }).join('')}</div>`;
  }

  function renderPdf(child, el) {
    T.levels.ensure(child);
    const allSessions = T.store.sessionsOf(child.id);
    const sessions = allSessions.filter((session) => session.mode !== 'sim');
    const reportSessions = sessions.map((session, index) => ({ session, index: index + 1 }));
    const dateRange = sessions.length
      ? `${fmtDateLong(sessions[0].date)} עד ${fmtDateLong(sessions[sessions.length - 1].date)}`
      : 'אין מפגשים מתועדים';
    const taskHeaders = SCORE_TASKS.map((key) => `<th scope="col">${esc(T.tasks.get(key).name)}</th>`).join('');
    const scoreRows = reportSessions.map(({ session, index }) => `<tr>
      <th scope="row">${index}</th>
      <td>${fmtDateLong(session.date)}</td>
      ${SCORE_TASKS.map((key) => {
        const stage = session.stages && session.stages[key];
        return `<td>${stage && !stage.skipped && Number.isFinite(stage.score) ? stage.score : '—'}</td>`;
      }).join('')}
    </tr>`).join('');
    const summary = sentences(child, sessions);
    const goals = T.goals ? T.goals.forChild(child).map((goal) => {
      const state = T.goals.evaluate(child, goal, allSessions);
      const status = goal.status === 'achieved' ? 'הושגה באישור מקצועי'
        : goal.status === 'paused' ? 'מושהית'
          : goal.approved ? 'פעילה ומאושרת' : 'ממתינה לאישור מקצועי';
      return `<article class="pdf-goal">
        <h3>${esc(goal.title)}</h3>
        <p>${esc(goal.domain)} · ${esc(status)}</p>
        <dl>
          <div><dt>נקודת התחלה</dt><dd>${state.baseline === null ? 'טרם נקבעה' : `${num(state.baseline, 0)}/100`}</dd></div>
          <div><dt>ממוצע עדכני</dt><dd>${state.recentAverage === null ? 'אין מדידה תקפה' : `${num(state.recentAverage, 0)}/100`}</dd></div>
          <div><dt>יעד</dt><dd>${goal.target}/100</dd></div>
          <div><dt>מדידות תקפות</dt><dd>${state.validCount} מתוך ${state.rows.length}</dd></div>
        </dl>
        <p>${esc(state.trend)}. הצעה לעיון: ${esc(state.recommendation)}. המידע אינו מסקנה קלינית.</p>
      </article>`;
    }).join('') : '';
    const carryover = (child.carryoverNotes || []).slice(-5).map((note) => {
      const context = { home: 'בית', kindergarten: 'גן', clinic: 'קליניקה' }[note.context] || note.context;
      return `<li><b>${esc(context)} · ${fmtDateLong(note.date)}:</b> ${esc(note.text)}</li>`;
    }).join('');
    const summaryCards = summary.map((item) => `<div><dt>${esc(item.domain)}</dt><dd>${esc(item.text)}</dd></div>`).join('');

    el.classList.add('pdf-mode', 'pdf-report-document');
    el.innerHTML = `<header class="pdf-document-header">
        <div class="pdf-document-brand"><span class="ocupa-report-logo" aria-label="Ocupa"><svg class="ocupa-mark" viewBox="0 0 42 42" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="2" y="21" width="19" height="19"/><circle cx="31" cy="30.5" r="9.5"/><path d="M21 2 L31 20 L11 20 Z"/></g></svg><span class="ocupa-word" dir="ltr">ocupa</span></span><span>דוח התקדמות</span></div>
        <h1>${esc(child.name)}</h1>
        <p>גיל ${esc(child.age)} · ${sessions.length} מפגשים מתועדים · ${esc(dateRange)}${child.nonverbal ? ' · מסלול ללא מילים' : ''}</p>
        <p class="pdf-document-notice">מסמך זה מסכם נתונים שנרשמו במערכת. הציונים הם מדדי ביצוע במשימות, אינם אבחוניים ואינם תחליף לשיקול דעת מקצועי.</p>
        ${child.demo || child.sample ? '<p class="pdf-demo-banner">נתוני הדגמה סינתטיים בלבד — אינם מתארים ילד/ה אמיתי/ת.</p>' : ''}
      </header>
      <section class="pdf-report-section pdf-score-chart">
        <h2>מגמות לפי תחום</h2>
        <p>כל גרף מציג תחום אחד, באותו סולם של 0–100. נקודה חלולה מסמנת ביטחון זיהוי נמוך; פער מסמן שלא נאסף ציון במפגש. מפגשי סימולציה אינם נכללים. הציונים הם מדדי ביצוע ואינם אבחוניים.</p>
        ${scoreTrendCharts(sessions)}
        <p class="pdf-chart-note">אין כאן ציון כולל: כל תחום מוצג בנפרד כדי לשמור על משמעות המדידה.</p>
      </section>
      <section class="pdf-report-section pdf-score-table">
        <h2>ציונים לפי מפגש</h2>
        ${scoreRows ? `<table><thead><tr><th scope="col">מפגש</th><th scope="col">תאריך</th>${taskHeaders}</tr></thead><tbody>${scoreRows}</tbody></table>` : '<p>אין עדיין מפגשים מתועדים.</p>'}
        <p class="pdf-report-note">מקף מציין שלא נאסף ציון במשימה באותו מפגש. המספרים בטבלה הם אותם ערכים שמוצגים בגרפים.</p>
      </section>
      ${summaryCards ? `<section class="pdf-report-section pdf-session-summary"><h2>סיכום המפגש האחרון</h2><dl>${summaryCards}</dl></section>` : ''}
      ${goals ? `<section class="pdf-report-section pdf-goal-section"><h2>מטרות שנקבעו למעקב</h2>${goals}</section>` : ''}
      ${carryover ? `<section class="pdf-report-section pdf-carryover-section"><h2>תצפיות מחוץ למפגש</h2><ul>${carryover}</ul></section>` : ''}
      <footer class="pdf-document-footer">הופק במערכת טומבי · ${fmtDateLong(Date.now())} · הניתוח מתבצע במכשיר; הקלטות קול אינן נשמרות.</footer>`;
    return { sessions };
  }

  function levelsTable(child, sessions) {
    T.levels.ensure(child);
    const rows = Object.entries(T.levels.NAMES).map(([task, name]) => {
      const level = T.levels.get(child, task);
      const changes = sessions.filter((s) => (s.levelChanges || []).some((change) => change.task === task && change.to === level));
      const fromSession = changes.length ? changes[changes.length - 1] : sessions.find((s) => s.stages && s.stages[task] && (s.stages[task].level || 1) === level);
      return `<tr><th scope="row">${esc(name)}</th><td>שלב ${level}</td><td>${fromSession ? fmtDateLong(fromSession.date) : '—'}</td></tr>`;
    });
    return `<section class="levels-summary"><h2>שלבים</h2><div class="scroll-x"><table class="levels-table"><thead><tr><th>משימה</th><th>שלב נוכחי</th><th>הגיע בתאריך</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></section>`;
  }

  function sessionLevels(s) {
    return Object.entries(T.levels.NAMES).map(([task, name]) => {
      const stage = s.stages && s.stages[task];
      return stage && !stage.skipped ? `${name} ${stage.level || 1}` : '';
    }).filter(Boolean).join(' · ') || '—';
  }

  function goalsSection(child) {
    if (!T.goals) return '';
    const goals = T.goals.forChild(child);
    const cards = goals.map((goal) => {
      const state = T.goals.evaluate(child, goal);
      const status = goal.status === 'achieved' ? 'הושגה באישור מקצועי'
        : goal.status === 'paused' ? 'מושהית' : goal.approved ? 'פעילה ומאושרת' : 'ממתינה לאישור מקצועי';
      const baseline = state.baseline === null ? 'טרם נקבעה' : `${num(state.baseline, 0)}/100`;
      const latest = state.recentAverage === null ? 'אין עדיין מדידה תקפה' : `${num(state.recentAverage, 0)}/100`;
      const confidence = state.confidence === null ? '—' : `${num(state.confidence * 100, 0)}%`;
      const assistance = state.assistRate === null ? '—' : `${num(state.assistRate * 100, 0)}% מהמדידות האחרונות כללו עזרה`;
      return `<article class="goal-report-card">
        <header><div><h3>${esc(goal.title)}</h3><p class="hint">${esc(goal.domain)} · ${esc(status)}</p></div>
          ${goal.approved && goal.status === 'active' && state.targetReached
            ? `<button class="btn btn-ghost btn-small no-print" type="button" data-goal-achieve="${esc(goal.id)}">סימון כהושגה באישור מקצועי</button>` : ''}
        </header>
        <p>${esc(state.trend)}</p>
        <dl class="goal-metrics">
          <div><dt>נקודת התחלה</dt><dd>${esc(baseline)}</dd></div>
          <div><dt>ממוצע עדכני</dt><dd>${esc(latest)} · יעד ${esc(goal.target)}/100</dd></div>
          <div><dt>מפגשי מדידה תקפים</dt><dd>${state.validCount} · ${state.rows.length} בסך הכול</dd></div>
          <div><dt>ביטחון ממוצע</dt><dd>${esc(confidence)}</dd></div>
          <div><dt>תמיכה</dt><dd>${esc(assistance)}</dd></div>
        </dl>
        ${state.uncertainCount ? `<p class="hint">${state.uncertainCount} מדידות משימה בביטחון נמוך הוחרגו מהחישוב.</p>` : ''}
        <p class="goal-recommendation"><b>הצעה לעיון:</b> ${esc(state.recommendation)}. זו הצעת מערכת על סמך הנתונים, לא מסקנה קלינית.</p>
        <p class="hint">משימות קשורות: ${goal.taskKeys.map((key) => esc(T.tasks.get(key).name)).join(', ')}</p>
      </article>`;
    }).join('');
    const notes = (child.carryoverNotes || []).slice().reverse().slice(0, 10);
    const contextNames = { home: 'בית', kindergarten: 'גן', clinic: 'קליניקה' };
    return `<section class="goal-report-section"><h2>מטרות וראיות להתקדמות</h2>
      ${child.demo ? '<p class="warn">נתוני הדגמה סינתטיים בלבד — אינם מתארים ילדים אמיתיים או תוצאות טיפול.</p>' : ''}
      ${cards || '<p class="hint">עדיין לא הוגדרו מטרות אישיות. אפשר להוסיף ולאשר מטרות בעריכת פרטי הילד.</p>'}
      <section class="carryover-section" aria-labelledby="carryover-title">
        <h3 id="carryover-title">תיעוד תפקוד מחוץ למפגש</h3>
        <div class="no-print">
          <p class="hint">תיעוד תצפית של הורה/מטפל/ת בבית, בגן או בקליניקה. זהו דיווח נפרד ממדדי המיקרופון.</p>
          <label>הקשר <select id="carryover-context"><option value="home">בית</option><option value="kindergarten">גן</option><option value="clinic">קליניקה</option></select></label>
          <label>מה נצפה? <textarea id="carryover-text" maxlength="500" rows="3" placeholder="תיאור קצר וממוקד, ללא מידע מזהה נוסף"></textarea></label>
          <button class="btn btn-ghost" type="button" data-carryover-save>שמירת תצפית</button>
        </div>
        ${notes.length ? `<ul class="carryover-list">${notes.map((note) => `<li><b>${esc(contextNames[note.context] || note.context)}</b> · ${fmtDateLong(note.date)} — ${esc(note.text)}</li>`).join('')}</ul>` : '<p class="hint">אין עדיין תצפיות מתועדות.</p>'}
      </section>
    </section>`;
  }

  function render(child, el) {
    T.levels.ensure(child);
    const sessions = T.store.sessionsOf(child.id);
    const chartSessions = sessions.filter((session) => session.mode !== 'sim');
    const sent = sentences(child, sessions);
    const last = sessions[sessions.length - 1];
    const ranges = sessions.length ? `${fmtDateLong(sessions[0].date)} עד ${fmtDateLong(last.date)}` : 'עדיין אין מפגשים';
    const currentLevels = Object.entries(T.levels.NAMES).map(([task, name]) => `${esc(name)}: שלב ${T.levels.get(child, task)}`).join(' · ');
    const reportTasks = T.tasks.all();
    el.innerHTML = `
      <header class="report-head">
        <div>
          <div class="report-title-line"><span class="ocupa-report-logo" aria-label="Ocupa"><svg class="ocupa-mark" viewBox="0 0 42 42" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="2" y="21" width="19" height="19"/><circle cx="31" cy="30.5" r="9.5"/><path d="M21 2 L31 20 L11 20 Z"/></g></svg><span class="ocupa-word" dir="ltr">ocupa</span></span><img src="assets/ocupa-tombi-cutout.png" alt=""><p class="eyebrow">טומבי · דוח התקדמות</p></div>
          <h1>${esc(child.name)}</h1>
          <p class="meta">גיל ${esc(child.age)} · ${sessions.length} מפגשים · ${esc(ranges)}${child.nonverbal ? ' · מסלול ללא מילים' : ''}${child.sample ? ' · <strong>נתוני דוגמה</strong>' : ''}</p>
          <p class="report-document-context">דוח תיעוד לצוות המטפל ולמשפחה · הופק בתאריך ${fmtDateLong(Date.now())}. המידע מסכם נתוני מפגשים ותצפיות ואינו מהווה אבחון או תחליף לשיקול דעת מקצועי.</p>
          ${child.demo || child.sample ? '<p class="pdf-demo-banner">נתוני הדגמה סינתטיים — לצורך המחשת המסמך בלבד.</p>' : ''}
          <p class="report-levels">${currentLevels}</p>
        </div>
        <div class="report-actions no-print">
          <button class="btn btn-ghost" data-act="print" type="button">הדפסה</button>
          <button class="btn" data-act="pdf" type="button">שמירה כ-PDF</button>
          <button class="btn btn-ghost" data-act="copy" type="button">העתקת הסיכום</button>
          <button class="btn btn-ghost" data-act="mail" type="button">שליחה במייל…</button>
          <button class="btn btn-ghost" data-act="csv" type="button">ייצוא לאקסל (CSV)</button>
          <button class="btn btn-ghost" data-act="ot-json" type="button">ייצוא מדדי ריפוי בעיסוק (JSON)</button>
        </div>
      </header>
      ${sessions.length ? '' : '<p class="empty">עוד אין מפגשים לילד הזה. אחרי המפגש הראשון יופיעו כאן הסיכום והגרפים.</p>'}
      ${sent.length ? `<section class="summary"><h2>סיכום המפגש האחרון</h2><dl class="sentences">${sent.map((s) => `<div><dt>${esc(s.domain)}</dt><dd>${esc(s.text)}</dd></div>`).join('')}</dl></section>` : ''}
      ${goalsSection(child)}
      ${sessions.length ? `<section class="charts score-progress-section"><h2>מגמות לפי תחום</h2>
        <p class="score-chart-description">כל גרף מציג תחום אחד, באותו סולם של 0–100, כדי שאפשר יהיה לעקוב אחר השינוי בלי לערבב בין משימות שונות. פער מציין שלא נאסף ציון במפגש; נקודה חלולה מסמנת ביטחון זיהוי נמוך. מפגשי סימולציה אינם נכללים.</p>
        ${scoreTrendCharts(chartSessions)}
        <p class="score-chart-note">הציונים מתארים ביצוע במשימות ואינם אבחון. כדי להבין את ההקשר, כדאי לעיין גם בסיכום המפגש ובפירוט הנתונים.</p>
        <details class="score-support-charts"><summary>מדדים נוספים לצוות המטפל</summary>
          <p class="score-chart-description">מדדים אלה משתמשים ביחידות שונות בין משימה למשימה, ולכן מוצגים בנפרד ואינם מיועדים להשוואה זה מול זה.</p>
          <div class="chart-grid">
            ${lineChart({ title: 'הפקת קול: יחס עוצמה בין קול חזק לחלש', sessions: chartSessions, task: 'loudness', value: (s) => st(s, 'loudness')?.ratio ?? null, fmt: (v) => '×' + num(v) })}
            ${lineChart({ title: 'עיכוב תגובה: תגובות שווא במהלך הסיפור', sessions: chartSessions, task: 'magic', value: (s) => st(s, 'magic')?.falseAlarms ?? null, yMax: 8, fmt: (v) => num(v, 0) })}
            ${lineChart({ title: 'משך הפקת צליל', unit: 'שניות', sessions: chartSessions, task: 'snake', value: (s) => st(s, 'snake')?.mean ?? null, fmt: (v) => num(v) })}
            ${lineChart({ title: 'חיקוי תבניות קצב: ציון ביצוע', unit: '0–100', sessions: chartSessions, task: 'echo', value: (s) => st(s, 'echo')?.score ?? null, yMax: 100, fmt: (v) => num(v, 0) })}
            ${lineChart({ title: 'קשב שמיעתי: זיהוי מילת המטרה', unit: 'תגובות', sessions: chartSessions, task: 'magic', value: (s) => st(s, 'magic')?.hits ?? null, yMax: 5, fmt: (v) => num(v, 0) })}
            ${lineChart({ title: 'תמיכה: מספר אירועי סיוע', sessions: chartSessions, value: (s) => realAssists(s).length, fmt: (v) => num(v, 0) })}
          </div>
        </details></section>
      <section class="table-wrap"><h2>תיעוד המפגשים</h2>
        <div class="screen-session-table"><div class="scroll-x"><table class="sessions">
          <thead><tr><th>תאריך</th><th>משך</th><th>שלבים</th>${reportTasks.map((task) => `<th>${esc(task.name)}${task.domain ? `<small class="task-domain">${esc(task.domain)}</small>` : ''}</th>`).join('')}<th>עזרה</th><th class="no-print"></th></tr></thead>
          <tbody>${sessions.slice().reverse().map((s) => `<tr>
            <td>${fmtDateLong(s.date)}${s.mode === 'sim' ? ' <span class="tag">סימולציה</span>' : ''}${s.sample ? ' <span class="tag">דוגמה</span>' : ''}</td>
            <td>${s.durationSec ? Math.round(s.durationSec / 60) + ' דק׳' : '—'}</td>
            <td>${esc(sessionLevels(s))}</td>
            ${reportTasks.map((task) => scoreCell(s, task.key)).join('')}
            <td>${realAssists(s).length}</td>
            <td class="no-print"><button class="link-btn" data-del="${s.id}" type="button">מחיקה</button></td></tr>`).join('')}</tbody>
        </table></div></div>
        ${sessionPdfDetails(sessions, reportTasks)}
        <p class="footnote">ציונים 0–100 לכל משימה. הקול משמש רק כדרך התגובה; מתרגלים חיקוי קצב, עוצמת קול, המתנה לפני תגובה והחזקת צליל. הניתוח נעשה בדפדפן, ושום הקלטה לא נשמרה.</p>
      </section>` : ''}${levelsTable(child, sessions)}`;
    return { sentences: sent, sessions };
  }

  function summaryText(child) {
    const sessions = T.store.sessionsOf(child.id);
    const s = sentences(child, sessions);
    const last = sessions[sessions.length - 1];
    const goalLines = T.goals ? T.goals.forChild(child).map((goal) => {
      const state = T.goals.evaluate(child, goal, sessions);
      return `מטרה ${goal.title} (${goal.approved ? 'מאושרת' : 'ממתינה לאישור'}): ${state.recommendation}; מדידות תקפות ${state.validCount}/${state.rows.length}; ממוצע אחרון ${state.recentAverage === null ? 'אין' : num(state.recentAverage, 0)}`;
    }) : [];
    const contextNames = { home: 'בית', kindergarten: 'גן', clinic: 'קליניקה' };
    const carryover = (child.carryoverNotes || []).slice(-5).map((note) => `תצפית ${fmtDateLong(note.date)} (${contextNames[note.context] || note.context}): ${note.text}`);
    return [`סיכום מפגשי טומבי: ${child.name}`, last ? `מפגש אחרון: ${fmtDateLong(last.date)} (סה״כ ${sessions.length} מפגשים)` : '', '', ...s.map((x) => `${x.domain}: ${x.text}`), ...goalLines, ...carryover, '', 'המדדים תומכים בעיון מקצועי ואינם אבחוניים. הניתוח נעשה במכשיר, בלי לשמור הקלטות.'].join('\n');
  }

  function csv(child) {
    const sessions = T.store.sessionsOf(child.id);
    const taskColumns = T.tasks.all().flatMap((task) => task.key.startsWith('engine')
      ? [`${task.name} בחירה`]
      : [`${task.name} ציון`, `${task.name} ביטחון`]);
    const taskMetricColumns = T.tasks.all().flatMap((task) =>
      taskRawMetrics(task.key).map(([label]) => `${task.name} ${label}`));
    const head = ['תאריך', 'משך (שניות)', 'תחושה בתחילת המפגש', 'הד ציון', 'הד נכונים', 'הד סטייה מ"ש', 'אריה/עכבר פי', 'עוצמה ציון', 'תגובות למילת המטרה', 'תגובות מיותרות', 'זמן תגובה מ"ש', 'קשב ציון', 'סססס ממוצע ש', 'סססס הכי ארוך ש', 'נשימה ציון', 'תחושה בסיום', 'עזרות', 'ללא מילים', 'מצב', 'אישור תוכנית מטפל/ת', 'מטרות בתוכנית', ...taskColumns, ...taskMetricColumns];
    const rows = sessions.map((s) => {
      const e = st(s, 'echo') || {}, l = st(s, 'loudness') || {}, m = st(s, 'magic') || {}, n = st(s, 'snake') || {};
      const taskValues = T.tasks.all().flatMap((task) => {
        const result = st(s, task.key);
        return task.key.startsWith('engine')
          ? [FEELING_NAMES[result && result.feeling] || '']
          : [result && result.score, result && result.confidence];
      });
      const taskMetricValues = T.tasks.all().flatMap((task) =>
        taskRawMetrics(task.key, st(s, task.key)).map(([, value]) => value));
      const goalTitles = (s.goalSnapshot || []).map((goal) => goal.title).join(' | ');
      return [new Date(s.date).toISOString().slice(0, 16).replace('T', ' '), s.durationSec, FEELING_NAMES[st(s, 'engineStart')?.feeling] || '', e.score, e.correctCount, e.meanDevMs, l.ratio, l.score, m.hits, m.falseAlarms, m.meanRtMs, m.score, n.mean, n.best, n.score, FEELING_NAMES[st(s, 'engineEnd')?.feeling] || '', realAssists(s).length, s.nonverbal ? 'כן' : 'לא', s.mode === 'sim' ? 'סימולציה' : s.sample ? 'דוגמה' : 'מיקרופון', s.clinicianApproved ? 'כן' : 'לא', goalTitles, ...taskValues, ...taskMetricValues];
    });
    return '﻿' + [head, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  }

  function makeDemoData() {
    const profiles = [
      { key: 'tom', name: 'תום', age: 5, gender: 'm', templates: ['rhythm', 'inhibition'], scores: [42, 49, 57, 68, 76], assist: [3, 3, 2, 1, 1] },
      { key: 'ben', name: 'בן', age: 4, gender: 'm', templates: ['motor-planning', 'regulation'], scores: [55, 57, 54, 59, 61], assist: [2, 2, 2, 3, 2] },
      { key: 'dan', name: 'דן', age: 6, gender: 'm', templates: ['grading', 'breath'], scores: [35, 44, 48, 55, 63], assist: [4, 3, 3, 2, 2] },
      { key: 'noa', name: 'נועה', age: 5, gender: 'f', templates: ['rhythm', 'inhibition'], scores: [45, 52, 60, 71, 82], assist: [3, 2, 2, 1, 0] },
    ];
    const day = 86400000;
    const names = [];
    let added = false;
    profiles.forEach((profile) => {
      let child = T.store.data.children.find((item) => item.demoKey === profile.key);
      let initialize = false;
      if (!child && profile.key === 'noa') {
        child = T.store.data.children.find((item) => item.sample && /^נועה/.test(item.name || ''));
        if (child) {
          initialize = true;
          added = true;
          child.name = profile.name;
          child.demoKey = profile.key;
          child.demo = true;
        }
      }
      if (!child) {
        const id = `demo-${profile.key}`;
        const collision = T.store.getChild(id);
        initialize = true;
        added = true;
        child = T.store.addChild({
          id: collision ? T.store.uid() : id, demoKey: profile.key, demo: true, sample: true,
          name: profile.name, age: profile.age, gender: profile.gender,
          levels: { echo: 1, loudness: 1, magic: 1, snake: 1 },
        });
      }
      child.demo = true;
      child.sample = true;
      child.demoKey = profile.key;
      if (initialize) {
        child.name = profile.name;
        child.age = profile.age;
        child.gender = profile.gender;
      }
      if (initialize || !Array.isArray(child.goals) || !child.goals.length) child.goals = profile.templates.map((template) => {
        const definition = T.goals.CATALOG.find((item) => item.key === template);
        return T.goals.normalize({
          id: `demo-${profile.key}-goal-${template}`, template, title: definition.title,
          baseline: profile.scores[0], target: 80, approved: true, approvedBy: 'נתוני הדגמה בלבד',
        });
      });
      T.store.save();
      const existing = T.store.sessionsOf(child.id).filter((session) => session.demo || session.sample);
      if (!existing.length) {
        added = true;
        const start = Date.now() - 5 * 7 * day;
        for (let i = 0; i < profile.scores.length; i++) {
          const score = profile.scores[i];
          const stages = {};
          T.tasks.all().forEach((task, index) => {
            if (task.ot) return;
            const linked = child.goals.some((goal) => goal.taskKeys.includes(task.key));
            const taskScore = Math.max(0, Math.min(100, score + (linked ? 0 : ((index % 3) - 1) * 8)));
            const confidence = profile.key === 'ben' && i === 1 ? 0.48
              : profile.key === 'dan' && i === 2 ? 0.54 : 0.82;
            stages[task.key] = { score: taskScore, confidence, level: Math.min(5, Math.floor(i / 2) + 1) };
          });
          const echoScore = stages.echo.score, loudnessScore = stages.loudness.score;
          const magicScore = stages.magic.score, snakeScore = stages.snake.score;
          stages.engineStart = { skipped: true, reason: 'אין דיווח עצמי בנתוני דוגמה' };
          stages.engineEnd = { skipped: true, reason: 'אין דיווח עצמי בנתוני דוגמה' };
          Object.assign(stages.echo, { trials: [1, 2, 3, 4].map((target) => ({ count: target, target })), correctCount: Math.round(echoScore / 25), meanDevMs: 280 - i * 32 });
          Object.assign(stages.loudness, { rounds: [], ratio: +(1.2 + loudnessScore / 45).toFixed(2), consistencyDb: 3 - i * 0.35 });
          Object.assign(stages.magic, { hits: Math.round(magicScore / 25), misses: 4 - Math.round(magicScore / 25), falseAlarms: Math.max(0, 5 - i), nTargets: 4, nDistractors: 8, meanRtMs: 1500 - i * 100 });
          const mean = +(1.5 + snakeScore / 18).toFixed(1);
          Object.assign(stages.snake, { durations: [mean - 0.3, mean + 0.4, mean - 0.1], best: mean + 0.4, mean, targetSec: 6 });
          const session = {
            childId: child.id, date: start + i * 7 * day + 10 * 3600000,
            sample: true, demo: true, mode: 'sample', durationSec: 480 + i * 12, nonverbal: false,
            clinicianApproved: true,
            goalSnapshot: child.goals.map((goal) => ({ id: goal.id, title: goal.title, taskKeys: goal.taskKeys, baseline: goal.baseline, target: goal.target })),
            plan: child.goals.flatMap((goal) => goal.taskKeys.slice(0, 1).map((key) => ({ key, reason: `נתוני הדגמה · ${goal.title}`, goalIds: [goal.id] }))),
            stages,
            assists: profile.assist[i] ? [{ stage: child.goals[0].taskKeys[0], type: 'verbal', t: 0 }] : [],
          };
          T.store.addSession(session);
        }
      } else {
        existing.forEach((session) => {
          session.demo = true;
          session.sample = true;
          session.clinicianApproved = true;
          // OT tasks record raw metrics only; drop invented scores left by older demo data
          Object.keys(session.stages || {}).forEach((key) => {
            const task = T.tasks.get(key);
            if (task && task.ot && !session.stages[key].ot) delete session.stages[key];
          });
          session.goalSnapshot = child.goals.map((goal) => ({ id: goal.id, title: goal.title, taskKeys: goal.taskKeys, baseline: goal.baseline, target: goal.target }));
        });
        T.store.save();
      }
      names.push(profile.name);
    });
    return { added, names };
  }

  return { render, renderPdf, sentences, summaryText, csv, rawSummary, makeDemoData, makeSample: makeDemoData, ASSIST };
})();
