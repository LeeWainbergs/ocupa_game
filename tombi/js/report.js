/* report.js — דוח התקדמות למטפלת ולהורים: משפטי סיכום, גרפים וטבלת מפגשים */
T.report = (() => {
  const ENG_LEVEL = { turtle: 0, fish: 1, monkey: 2 };
  const ENG_NAME = { turtle: 'צב', fish: 'דג', monkey: 'קוף' };
  const ENG_AS = { turtle: 'כצב', fish: 'כדג', monkey: 'כקוף' };
  const ASSIST = { verbal: 'מילולית', model: 'הדגמה', physical: 'פיזית', gesture: 'רמז/הצבעה', repeat: 'חזרה על הוראה' };
  const fmtDate = (t) => new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  const fmtDateLong = (t) => new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (v, d = 1) => (v === null || v === undefined || isNaN(v) ? '—' : (+v).toFixed(d).replace(/\.0$/, ''));
  const st = (s, k) => (s.stages && s.stages[k] && !s.stages[k].skipped ? s.stages[k] : null);
  const realAssists = (s) => (s.assists || []).filter((a) => a.type !== 'repeat');

  function sentences(child, sessions) {
    const G = (m, f) => (child.gender === 'f' ? f : m);
    const out = [];
    const last = sessions[sessions.length - 1], prev = sessions[sessions.length - 2];
    if (!last) return out;

    // regulation (engine check at start and end)
    const recent = sessions.slice(-5).filter((s) => st(s, 'engineStart')?.choice && st(s, 'engineEnd')?.choice);
    if (recent.length) {
      const count = {};
      recent.forEach((s) => (count[s.stages.engineStart.choice] = (count[s.stages.engineStart.choice] || 0) + 1));
      const S = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
      const n = recent.filter((s) => s.stages.engineStart.choice === S && s.stages.engineEnd.choice === 'fish').length;
      let text;
      if (S !== 'fish' && n > 0) text = `${G('התחיל', 'התחילה')} ${ENG_AS[S]} ו${G('סיים', 'סיימה')} כדג ב־${n} מתוך ${recent.length} המפגשים האחרונים`;
      else {
        const endC = {};
        recent.forEach((s) => (endC[s.stages.engineEnd.choice] = (endC[s.stages.engineEnd.choice] || 0) + 1));
        const E = Object.keys(endC).sort((a, b) => endC[b] - endC[a])[0];
        text = `בתחילת המפגש בדרך כלל ${ENG_NAME[S]}, ובסיום בדרך כלל ${ENG_NAME[E]} (${recent.length} מפגשים אחרונים)`;
      }
      out.push({ domain: 'ויסות', text });
    }
    const L = st(last, 'loudness'), Lp = prev && st(prev, 'loudness');
    if (L && L.ratio) out.push({ domain: 'הדרגת קול', text: `אריה חזק פי ${num(L.ratio)} מעכבר${Lp && Lp.ratio ? ` (במפגש הקודם פי ${num(Lp.ratio)})` : ''}` });
    const M = st(last, 'magic'), Mp = prev && st(prev, 'magic');
    if (M) out.push({ domain: 'לעצור ולחכות', text: `${M.falseAlarms} תגובות מיותרות מתוך ${M.nDistractors}${Mp ? ` (במפגש הקודם ${Mp.falseAlarms})` : ''}; ${M.hits} מתוך ${M.nTargets} ${M.targetWord ? `הופעות של המילה ${M.targetWord} זוהו` : 'צפרדעים נתפסו'}${M.meanRtMs ? `, זמן תגובה ממוצע ${num(M.meanRtMs / 1000)} שניות` : ''}` });
    const S5 = st(last, 'snake'), S5p = prev && st(prev, 'snake');
    if (S5) out.push({ domain: 'להחזיק צליל', text: `צליל סססס ממוצע של ${num(S5.mean)} שניות${S5p ? ` (במפגש הקודם ${num(S5p.mean)})` : ''}` });
    const E = st(last, 'echo'), Ep = prev && st(prev, 'echo');
    if (E) out.push({ domain: 'לתפוס את הקצב', text: `${E.correctCount} מתוך ${E.trials.length} מקצבים בכמות הנכונה${E.meanDevMs !== null ? `, סטייה ממוצעת ${E.meanDevMs} מ״ש` : ''}${Ep ? ` (במפגש הקודם ${Ep.correctCount} מתוך ${Ep.trials.length})` : ''}` });
    const A = realAssists(last), Ap = prev ? realAssists(prev) : null;
    const byType = {};
    A.forEach((a) => (byType[a.type] = (byType[a.type] || 0) + 1));
    const parts = Object.entries(byType).map(([k, v]) => `${v} ${ASSIST[k] || k}`).join(', ');
    out.push({ domain: 'עצמאות', text: A.length ? `הסייעת עזרה ${A.length === 1 ? 'פעם אחת' : A.length + ' פעמים'}: ${parts}${Ap ? ` (במפגש הקודם ${Ap.length})` : ''}` : `בלי עזרה של הסייעת${Ap && Ap.length ? ` (במפגש הקודם ${Ap.length})` : ''}` });
    return out;
  }

  // ---------- charts (inline SVG, single series each) ----------
  function lineChart({ title, unit, sessions, value, fmt = (v) => num(v), yMax, yMin = 0, task }) {
    const pts = sessions.map((s, i) => ({ i, s, v: value(s) })).filter((p) => p.v !== null && p.v !== undefined && !isNaN(p.v));
    if (!pts.length) return `<figure class="chart"><figcaption>${esc(title)}</figcaption><p class="chart-empty">אין עדיין נתונים</p></figure>`;
    const W = 340, H = 170, P = { l: 34, r: 14, t: 16, b: 28 };
    const max = yMax ?? (Math.max(...pts.map((p) => p.v)) * 1.2 || 1);
    const n = sessions.length;
    const x = (i) => (n === 1 ? (P.l + W - P.r) / 2 : P.l + (i / (n - 1)) * (W - P.l - P.r));
    const y = (v) => H - P.b - ((v - yMin) / (max - yMin)) * (H - P.t - P.b);
    const ticks = [yMin, (yMin + max) / 2, max];
    const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    const area = pts.length > 1 ? `${path}L${x(pts[pts.length - 1].i).toFixed(1)},${y(yMin)}L${x(pts[0].i).toFixed(1)},${y(yMin)}Z` : '';
    const lastP = pts[pts.length - 1];
    const markers = task ? sessions.map((session, i) => {
      const stage = session.stages && session.stages[task];
      const previous = i > 0 && sessions[i - 1].stages && sessions[i - 1].stages[task];
      if (!stage || !previous || (stage.level || 1) === (previous.level || 1)) return '';
      return `<g class="level-marker"><line x1="${x(i)}" x2="${x(i)}" y1="${P.t}" y2="${H - P.b}"/><text x="${Math.min(x(i) + 4, W - P.r - 48)}" y="${P.t + 11}">שלב ${stage.level || 1}</text></g>`;
    }).join('') : '';
    return `<figure class="chart"><figcaption>${esc(title)}${unit ? ` <span class="unit">(${esc(unit)})</span>` : ''}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" direction="ltr">
        ${ticks.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
        ${sessions.map((s, i) => (n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1) ? `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDate(s.date)}</text>` : '').join('')}
        ${markers}
        ${area ? `<path class="area" d="${area}"/>` : ''}
        <path class="line" d="${path}"/>
        ${pts.map((p) => {
          const stage = task && p.s.stages && p.s.stages[task];
          const level = stage && (stage.level || 1);
          return `<g class="pt"><circle cx="${x(p.i)}" cy="${y(p.v)}" r="12" class="hit"/><circle cx="${x(p.i)}" cy="${y(p.v)}" r="${p === lastP ? 5 : 3.5}" class="dot${p === lastP ? ' last' : ''}"/><title>${fmtDateLong(p.s.date)}: ${fmt(p.v)}${unit ? ' ' + unit : ''}${level ? ` · שלב ${level}` : ''}</title></g>`;
        }).join('')}
        <text class="endlabel" x="${Math.min(x(lastP.i), W - P.r - 2)}" y="${y(lastP.v) - 10}" text-anchor="${n === 1 ? 'middle' : 'end'}">${fmt(lastP.v)}${task && lastP.s.stages && lastP.s.stages[task] ? ` · שלב ${lastP.s.stages[task].level || 1}` : ''}</text>
      </svg></figure>`;
  }

  function engineChart(sessions) {
    const rows = sessions.filter((s) => st(s, 'engineStart')?.choice || st(s, 'engineEnd')?.choice);
    if (!rows.length) return `<figure class="chart chart-wide"><figcaption>בדיקת מנוע: תחילת המפגש מול סופו</figcaption><p class="chart-empty">אין עדיין נתונים</p></figure>`;
    const W = 700, H = 190, P = { l: 56, r: 16, t: 18, b: 28 };
    const n = rows.length;
    const x = (i) => (n === 1 ? (P.l + W - P.r) / 2 : P.l + 14 + (i / (n - 1)) * (W - P.l - P.r - 28));
    const y = (lv) => H - P.b - (lv / 2) * (H - P.t - P.b);
    const lv = (s, k) => (st(s, k)?.choice ? ENG_LEVEL[s.stages[k].choice] : null);
    return `<figure class="chart chart-wide"><figcaption>בדיקת מנוע: תחילת המפגש מול סופו</figcaption>
      <div class="legend"><span><i class="sw sw-start"></i>תחילת מפגש</span><span><i class="sw sw-end"></i>סוף מפגש</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="בדיקת מנוע לאורך המפגשים" direction="ltr">
        ${[0, 1, 2].map((l) => `<line class="grid${l === 1 ? ' grid-mid' : ''}" x1="${P.l}" x2="${W - P.r}" y1="${y(l)}" y2="${y(l)}"/><text class="tick tick-eng" x="${P.l - 8}" y="${y(l) + 4}" text-anchor="end">${['צב', 'דג', 'קוף'][l]}</text>`).join('')}
        ${rows.map((s, i) => {
          const a = lv(s, 'engineStart'), b = lv(s, 'engineEnd');
          const cx = x(i), off = 5;
          return `<g class="pt">
            ${a !== null && b !== null && a !== b ? `<line class="eng-link" x1="${cx - off}" y1="${y(a)}" x2="${cx + off}" y2="${y(b)}"/>` : ''}
            ${a !== null ? `<circle class="eng-start" cx="${cx - off}" cy="${y(a)}" r="6"/>` : ''}
            ${b !== null ? `<circle class="eng-end" cx="${cx + off}" cy="${y(b)}" r="6"/>` : ''}
            <rect class="hit" x="${cx - 16}" y="${P.t - 6}" width="32" height="${H - P.t - P.b + 12}"/>
            <title>${fmtDateLong(s.date)}: התחלה ${a !== null ? ENG_NAME[s.stages.engineStart.choice] : '—'}, סוף ${b !== null ? ENG_NAME[s.stages.engineEnd.choice] : '—'}</title>
            ${(n <= 10 || i % Math.ceil(n / 10) === 0 || i === n - 1) ? `<text class="tick" x="${cx}" y="${H - 8}" text-anchor="middle">${fmtDate(s.date)}</text>` : ''}
          </g>`;
        }).join('')}
      </svg></figure>`;
  }

  function scoreCell(s, k) {
    const v = st(s, k);
    if (!s.stages[k]) return '<td class="na">—</td>';
    if (s.stages[k].skipped) return '<td class="na">דולג</td>';
    if (k.startsWith('engine')) return `<td>${v.choice ? ENG_NAME[v.choice] : '—'}</td>`;
    const lowConfidence = Number.isFinite(v.confidence) && v.confidence < 0.6;
    return `<td${lowConfidence ? ' class="low-confidence" title="זיהוי חלקי — ביטחון נמוך מ־60%"' : ''}><span class="score s${Math.min(4, Math.floor((v.score ?? 0) / 25))}">${v.score ?? '—'}</span>${v.level ? `<small class="score-level"> · שלב ${v.level}</small>` : ''}${lowConfidence ? '<small class="score-level"> · זיהוי חלקי</small>' : ''}</td>`;
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
          <p class="report-levels">${currentLevels}</p>
        </div>
        <div class="report-actions no-print">
          <button class="btn btn-ghost" data-act="print" type="button">הדפסה</button>
          <button class="btn" data-act="pdf" type="button">הורדת PDF</button>
          <button class="btn btn-ghost" data-act="copy" type="button">העתקת הסיכום</button>
          <button class="btn btn-ghost" data-act="mail" type="button">שליחה במייל…</button>
          <button class="btn btn-ghost" data-act="csv" type="button">ייצוא לאקסל (CSV)</button>
        </div>
      </header>
      ${sessions.length ? '' : '<p class="empty">עוד אין מפגשים לילד הזה. אחרי המפגש הראשון יופיעו כאן הסיכום והגרפים.</p>'}
      ${sent.length ? `<section class="summary"><h2>מה רואים במפגש האחרון</h2><dl class="sentences">${sent.map((s) => `<div><dt>${esc(s.domain)}</dt><dd>${esc(s.text)}</dd></div>`).join('')}</dl></section>` : ''}
      ${goalsSection(child)}
      ${sessions.length ? `<section class="charts"><h2>התקדמות לאורך זמן</h2>
        ${engineChart(sessions)}
        <div class="chart-grid">
          ${lineChart({ title: 'עוצמת הקול: אריה חזק פי… מעכבר', sessions, task: 'loudness', value: (s) => st(s, 'loudness')?.ratio ?? null, fmt: (v) => '×' + num(v) })}
          ${lineChart({ title: 'לעצור ולחכות: תגובות מיותרות בסיפור', sessions, task: 'magic', value: (s) => st(s, 'magic')?.falseAlarms ?? null, yMax: 8, fmt: (v) => num(v, 0) })}
          ${lineChart({ title: 'להחזיק צליל: משך צליל סססס ממוצע', unit: 'שניות', sessions, task: 'snake', value: (s) => st(s, 'snake')?.mean ?? null, fmt: (v) => num(v) })}
          ${lineChart({ title: 'לתפוס את הקצב: ציון חיקוי הקצב', unit: '0–100', sessions, task: 'echo', value: (s) => st(s, 'echo')?.score ?? null, yMax: 100, fmt: (v) => num(v, 0) })}
          ${lineChart({ title: 'קשב: תגובות למילת המטרה', unit: 'תגובות', sessions, task: 'magic', value: (s) => st(s, 'magic')?.hits ?? null, yMax: 5, fmt: (v) => num(v, 0) })}
          ${lineChart({ title: 'עצמאות: פעמים שהסייעת עזרה', sessions, value: (s) => realAssists(s).length, fmt: (v) => num(v, 0) })}
        </div></section>
      <section class="table-wrap"><h2>כל המפגשים</h2>
        <div class="scroll-x"><table class="sessions">
          <thead><tr><th>תאריך</th><th>משך</th><th>שלבים</th>${reportTasks.map((task) => `<th>${esc(task.name)}</th>`).join('')}<th>עזרה</th><th class="no-print"></th></tr></thead>
          <tbody>${sessions.slice().reverse().map((s) => `<tr>
            <td>${fmtDateLong(s.date)}${s.mode === 'sim' ? ' <span class="tag">סימולציה</span>' : ''}${s.sample ? ' <span class="tag">דוגמה</span>' : ''}</td>
            <td>${s.durationSec ? Math.round(s.durationSec / 60) + ' דק׳' : '—'}</td>
            <td>${esc(sessionLevels(s))}</td>
            ${reportTasks.map((task) => scoreCell(s, task.key)).join('')}
            <td>${realAssists(s).length}</td>
            <td class="no-print"><button class="link-btn" data-del="${s.id}" type="button">מחיקה</button></td></tr>`).join('')}</tbody>
        </table></div>
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
    const taskColumns = T.tasks.all().flatMap((task) => [`${task.name} ציון`, `${task.name} ביטחון`]);
    const head = ['תאריך', 'משך (שניות)', 'מנוע התחלה', 'הד ציון', 'הד נכונים', 'הד סטייה מ"ש', 'אריה/עכבר פי', 'עוצמה ציון', 'תגובות למילת המטרה', 'תגובות מיותרות', 'זמן תגובה מ"ש', 'קשב ציון', 'סססס ממוצע ש', 'סססס הכי ארוך ש', 'נשימה ציון', 'מנוע סוף', 'עזרות', 'ללא מילים', 'מצב', 'אישור תוכנית מטפל/ת', 'מטרות בתוכנית', ...taskColumns];
    const rows = sessions.map((s) => {
      const e = st(s, 'echo') || {}, l = st(s, 'loudness') || {}, m = st(s, 'magic') || {}, n = st(s, 'snake') || {};
      const taskValues = T.tasks.all().flatMap((task) => {
        const result = st(s, task.key);
        return [result && result.score, result && result.confidence];
      });
      const goalTitles = (s.goalSnapshot || []).map((goal) => goal.title).join(' | ');
      return [new Date(s.date).toISOString().slice(0, 16).replace('T', ' '), s.durationSec, ENG_NAME[st(s, 'engineStart')?.choice] || '', e.score, e.correctCount, e.meanDevMs, l.ratio, l.score, m.hits, m.falseAlarms, m.meanRtMs, m.score, n.mean, n.best, n.score, ENG_NAME[st(s, 'engineEnd')?.choice] || '', realAssists(s).length, s.nonverbal ? 'כן' : 'לא', s.mode === 'sim' ? 'סימולציה' : s.sample ? 'דוגמה' : 'מיקרופון', s.clinicianApproved ? 'כן' : 'לא', goalTitles, ...taskValues];
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
            const linked = child.goals.some((goal) => goal.taskKeys.includes(task.key));
            const taskScore = Math.max(0, Math.min(100, score + (linked ? 0 : ((index % 3) - 1) * 8)));
            const confidence = profile.key === 'ben' && i === 1 ? 0.48
              : profile.key === 'dan' && i === 2 ? 0.54 : 0.82;
            stages[task.key] = { score: taskScore, confidence, level: Math.min(5, Math.floor(i / 2) + 1) };
          });
          const echoScore = stages.echo.score, loudnessScore = stages.loudness.score;
          const magicScore = stages.magic.score, snakeScore = stages.snake.score;
          stages.engineStart = { choice: i < 2 ? 'monkey' : 'fish', method: 'voice', score: 100, confidence: 0.9 };
          stages.engineEnd = { choice: i < 1 ? 'monkey' : 'fish', method: 'voice', score: 100, confidence: 0.9 };
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
          session.goalSnapshot = child.goals.map((goal) => ({ id: goal.id, title: goal.title, taskKeys: goal.taskKeys, baseline: goal.baseline, target: goal.target }));
        });
        T.store.save();
      }
      names.push(profile.name);
    });
    return { added, names };
  }

  return { render, sentences, summaryText, csv, makeDemoData, makeSample: makeDemoData, ASSIST };
})();
