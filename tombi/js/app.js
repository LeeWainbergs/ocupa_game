/* app.js — מסכים, פאנל סייעת, הגדרות וחיבור כל החלקים */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stripHomeEmoji = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D\u20E3]/gu, '').trim();
  const escHome = (s) => esc(stripHomeEmoji(s));
  const IMG = window.TOMBI_IMG || 'assets/tombi.jpg';
  const DEMO = !!window.TOMBI_DEMO; // the online demo: no microphone, no printing or file downloads
  T.store.load();
  $$('[data-tombi-home]').forEach((img) => { img.src = IMG; });
  const homeHeader = $('#screen-home .topbar');
  const topActions = $('#adult-top-actions');
  if (homeHeader && topActions) {
    topActions.append($('#btn-home-backup'), $('#btn-settings'), $('#btn-help'));
    ['#btn-home-backup', '#btn-settings'].forEach((selector) => {
      $(selector).classList.remove('icon-btn');
      $(selector).classList.add('adult-icon-btn');
    });
    homeHeader.remove();
  }
  if (DEMO) {
    $('#btn-mic').hidden = true;
    $('#mic-error').hidden = false;
    $('#mic-error').className = 'warn';
    $('#mic-error').textContent = 'זו גרסת הדגמה בדפדפן, בלי גישה למיקרופון. במצב סימולציה מפעילים את התגובות של "הילד" מתוך פאנל הסייעת. הגרסה המלאה, עם מיקרופון, רצה מ-VS Code.';
    if (!T.store.data.children.length) T.report.makeDemoData();
  }
  const S = T.store.settings;

  // apply saved settings
  Object.assign(T.tombi.voiceCfg, S.voice || {});
  if (S.sensitivity) T.audio.cfg.sensitivity = S.sensitivity;
  if (S.adultFilter !== undefined) T.audio.cfg.adultFilter = S.adultFilter;
  if (S.adultHz) T.audio.cfg.adultHz = S.adultHz;

  let current = null; // child
  let currentPlan = null;
  let tombiMounted = false;

  // ---------- routing ----------
  function show(name) {
    $$('.screen').forEach((s) => (s.hidden = s.id !== 'screen-' + name));
    $('#adult-shell').classList.toggle('is-game', name === 'game');
    const labels = { home: 'טומבי', child: 'פרטי ילד', prep: 'הכנה למפגש', done: 'סיכום מפגש', report: 'דוח התקדמות', settings: 'הגדרות' };
    const crumb = $('#adult-breadcrumb');
    crumb.innerHTML = name === 'home'
      ? '<span>Ocupa</span><i>‹</i><b>טומבי</b>'
      : `<span>Ocupa</span><i>‹</i><span>טומבי</span><i>‹</i><b>${esc(labels[name] || 'טומבי')}</b>`;
    $$('[data-nav]').forEach((item) => {
      const active = (name === 'home' && item.dataset.nav === 'home') || (name === 'settings' && item.dataset.nav === 'settings');
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    closeSidebar();
    window.scrollTo(0, 0);
    if (name === 'home') renderHome();
    if (name === 'settings') renderSettings();
  }
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

  function confirmBox(text) {
    return new Promise((res) => {
      $('#modal-text').textContent = text;
      $('#modal').hidden = false;
      const done = (v) => { $('#modal').hidden = true; $('#modal-yes').onclick = $('#modal-no').onclick = null; res(v); };
      $('#modal-yes').onclick = () => done(true);
      $('#modal-no').onclick = () => done(false);
      $('#modal-no').focus();
    });
  }

  function closeSidebar() {
    $('#adult-shell').classList.remove('sidebar-open');
    $('#sidebar-scrim').hidden = true;
    $('#btn-menu-toggle').setAttribute('aria-expanded', 'false');
  }
  function openSidebar() {
    $('#adult-shell').classList.add('sidebar-open');
    $('#sidebar-scrim').hidden = false;
    $('#btn-menu-toggle').setAttribute('aria-expanded', 'true');
  }
  $('#btn-menu-toggle').onclick = () => {
    if ($('#adult-shell').classList.contains('sidebar-open')) closeSidebar(); else openSidebar();
  };
  $('#sidebar-scrim').onclick = closeSidebar;
  $('[data-nav="home"]').onclick = () => show('home');
  $('[data-nav="children"]').onclick = goToChildren;
  $('[data-nav="reports"]').onclick = goToChildren;
  $('[data-nav="settings"]').onclick = () => show('settings');
  $('#btn-new-session').onclick = () => {
    const child = T.store.data.children.slice().sort((a, b) => childLastDate(b) - childLastDate(a))[0];
    if (child) openPrep(child); else openChildForm(null);
  };
  $('#btn-help').onclick = () => { $('#help-modal').hidden = false; $('#btn-help-close').focus(); };
  $('#btn-help-close').onclick = () => { $('#help-modal').hidden = true; $('#btn-help').focus(); };
  $('#help-modal').addEventListener('click', (event) => {
    if (event.target === $('#help-modal')) $('#btn-help-close').click();
  });

  // ---------- home ----------
  const HOME_TASKS = [
    ...Object.entries(T.levels.NAMES).map(([task, title]) => [task, title, T.levels.DESCRIPTIONS[task]]),
  ];
  function greetingByTime(date) {
    const hour = date.getHours();
    return hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : hour < 21 ? 'ערב טוב' : 'לילה טוב';
  }
  const HOME_PALETTE = [
    ['#2F9A8B', '#EEF8F3'], ['#247E75', '#E9F5F2'], ['#35566F', '#EEF3F6'],
    ['#287F8A', '#EAF5F6'], ['#49677A', '#EFF3F5'],
  ];
  let homeQuery = '';
  let homeSort = 'recent';
  try {
    const savedSort = localStorage.getItem('tombi.homeSort');
    if (['recent', 'name', 'needed'].includes(savedSort)) homeSort = savedSort;
  } catch (e) { console.warn('לא ניתן לטעון את סדר הילדים השמור.', e); }

  function sessionScore(s) {
    const scores = ['echo', 'loudness', 'magic', 'snake']
      .map((key) => s.stages && s.stages[key])
      .filter((stage) => stage && !stage.skipped && Number.isFinite(stage.score))
      .map((stage) => stage.score);
    return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
  }
  const homeSessions = (id) => T.store.sessionsOf(id).filter((s) => s.mode !== 'sim');
  function childLastSession(child) {
    const sessions = homeSessions(child.id);
    return sessions[sessions.length - 1] || null;
  }
  function childLastDate(child) {
    const session = childLastSession(child);
    return session ? session.date : 0;
  }
  function avatarColors(child) {
    const seed = Array.from(String(child.id || child.name)).reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const [color, tint] = HOME_PALETTE[seed % HOME_PALETTE.length];
    return { color, tint };
  }
  function relativeHomeDate(timestamp) {
    const target = new Date(timestamp);
    const today = new Date();
    target.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const days = Math.round((today - target) / 86400000);
    if (days <= 0) return 'היום';
    if (days === 1) return 'אתמול';
    if (days < 30) return `לפני ${days} ימים`;
    return new Date(timestamp).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function homeSpark(values, color) {
    if (!values.length) return '';
    const w = 220, h = 38, pad = 4;
    const min = Math.max(0, Math.min(...values) - 5);
    const max = Math.min(100, Math.max(...values) + 5) || 1;
    const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
    const y = (v) => h - pad - ((v - min) / Math.max(1, max - min)) * (h - 2 * pad);
    const points = values.map((value, i) => [x(i), y(value)]);
    const path = points.map((point, i) => `${i ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
    return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="מגמת הציון במפגשים" style="--child-color:${color}">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }
  function scoreRing(score, color, empty = false) {
    const value = score === null ? 0 : Math.max(0, Math.min(100, score));
    return `<div class="score-ring${empty ? ' is-empty' : ''}" style="--child-color:${color}" role="img" aria-label="${score === null ? 'אין עדיין ציון' : `ציון ${score}`}">
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-track" cx="18" cy="18" r="15.9"/><circle class="ring-value" cx="18" cy="18" r="15.9" stroke-dasharray="${value} 100"/></svg>
      <div class="ring-copy"><b>${score === null ? '—' : score}</b></div>
    </div>`;
  }
  const initials = (name) => Array.from(stripHomeEmoji(name || '?')).slice(0, 2).join('') || '?';
  function renderHomeStats() {
    const stats = $('#home-stats');
    const sessions = T.store.data.sessions.filter((session) => session.mode !== 'sim' && !session.sample && !session.demo);
    if (!sessions.length) {
      stats.hidden = true;
      stats.innerHTML = '';
      return;
    }
    const now = new Date();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const weekSessions = sessions.filter((session) => session.date >= weekStart.getTime() && session.date <= now.getTime());
    const goal = Math.max(1, Number(S.weeklyGoal) || 6);
    const percent = Math.round((weekSessions.length / goal) * 100);
    const ringPercent = Math.min(100, percent);
    const seconds = weekSessions.reduce((sum, session) => sum + (Number(session.durationSec) || 0), 0);
    const minutes = Math.round(seconds / 60);
    const average = weekSessions.length ? Math.round(seconds / weekSessions.length / 60) : 0;
    const activeSince = now.getTime() - 30 * 86400000;
    const activeChildren = new Set(sessions.filter((session) => session.date >= activeSince && session.date <= now.getTime()).map((session) => session.childId)).size;
    const datePart = (date) => date.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
    const backupAt = Number(T.store.settings.lastBackupAt) || 0;
    const backupAge = backupAt ? Math.max(0, Math.floor((Date.now() - backupAt) / 86400000)) : null;
    const backupDue = !DEMO && (backupAge === null || backupAge >= 14);
    const attention = [];
    T.store.data.children.forEach((child) => {
      const latest = childLastSession(child);
      const days = latest ? Math.floor((Date.now() - latest.date) / 86400000) : Infinity;
      const colors = avatarColors(child);
      if (days >= 14) attention.push({ kind: 'start', child, colors, name: child.name, reason: latest ? `לא היה מפגש כבר ${days} יום` : 'עדיין לא היה מפגש', label: 'להתחיל ‹' });
      if (latest) (latest.levelChanges || []).filter((change) => change.from !== change.to).forEach((change) => {
        const taskName = T.levels.NAMES[change.task] || '';
        attention.push({
          kind: 'level', child, colors, name: child.name,
          reason: change.to > change.from
            ? `${child.gender === 'f' ? 'עלתה' : 'עלה'} לשלב ${change.to} ב${taskName}`
            : `${child.gender === 'f' ? 'ירדה' : 'ירד'} לשלב ${change.to} ב${taskName}`,
          tag: change.to > change.from ? '<span class="tag amber">שלב חדש</span>' : '<span class="tag gray">שלב קל יותר</span>',
        });
      });
    });
    if (backupDue && sessions.length) {
      attention.push({ kind: 'backup', colors: { color: 'var(--muted)', tint: '#EEF1F3' }, name: 'גיבוי נתונים', reason: backupAge === null ? 'עוד לא נעשה גיבוי' : `גיבוי אחרון לפני ${backupAge} ימים`, label: 'לגבות ‹' });
    }
    const items = attention.slice(0, 4);
    const attentionRows = items.map((item) => `<div class="attention-row">
      <span class="attention-avatar" style="--avatar-bg:${item.colors.tint};--avatar-color:${item.colors.color}">${item.kind === 'backup' ? '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>' : escHome(initials(item.name))}</span>
      <div class="attention-copy"><b>${escHome(item.name)}</b><span>${esc(item.reason)}</span></div>
      ${item.tag || (item.kind === 'start' ? `<button class="text-link" data-attention-start="${esc(item.child.id)}" type="button">להתחיל ‹</button>` : item.kind === 'backup' ? '<button class="text-link" data-attention-backup type="button">לגבות ‹</button>' : '')}
    </div>`).join('');
    stats.innerHTML = `<div class="summary-grid">
      <article class="card summary-card" style="--card-accent:var(--teal)">
        <header class="summary-head"><div class="summary-title"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><div><h3>מעקב מפגשים</h3><p>השבוע · ${datePart(weekStart)}–${datePart(weekEnd)}</p></div></div><span class="summary-label">מתחילת השבוע</span></header>
        <div class="summary-body"><div class="goal-ring" role="img" aria-label="${percent}% מהיעד"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-track" cx="18" cy="18" r="15.9"/><circle class="ring-value" cx="18" cy="18" r="15.9" stroke-dasharray="${ringPercent} 100"/></svg><div class="ring-copy"><b>${percent}%</b><small>מהיעד</small></div></div>
          <div class="summary-rows"><div class="summary-row"><span>מפגשים</span><b>${weekSessions.length} מתוך ${goal}</b></div><div class="summary-row"><span>דקות מפגש</span><b>${minutes}</b></div><div class="summary-row"><span>ילדים פעילים</span><b>${activeChildren}</b></div></div></div>
        <footer class="summary-foot"><button class="text-link" data-scroll-children type="button">לכל המפגשים ‹</button><span>ממוצע ${average} דק׳ למפגש</span></footer>
      </article>
      <article class="card summary-card attention-card" style="--card-accent:var(--pink)">
        <header class="summary-head"><div class="summary-title"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.01"/></svg><div><h3>דורש תשומת לב</h3><p>מה כדאי לעשות היום</p></div></div><span class="tag red">${items.length} פתוחים</span></header>
        <div class="attention-list">${attentionRows || '<p class="all-current">הכול מעודכן. אין משהו דחוף היום.</p>'}</div>
      </article>
    </div>`;
    stats.hidden = false;
    $$('[data-scroll-children]', stats).forEach((button) => { button.onclick = goToChildren; });
    $$('[data-attention-start]', stats).forEach((button) => { button.onclick = () => openPrep(T.store.getChild(button.dataset.attentionStart)); });
    $$('[data-attention-backup]', stats).forEach((button) => {
      button.onclick = () => {
        try { backupData(); } catch (error) { console.error('יצירת קובץ הגיבוי נכשלה.', error); window.alert('לא ניתן ליצור את קובץ הגיבוי.'); }
      };
    });
  }
  function renderHome() {
    const list = $('#children');
    const kids = T.store.data.children;
    const now = new Date();
    $('#home-date').textContent = greetingByTime(now);
    $$('[data-tombi-home]').forEach((img) => { img.src = IMG; });
    $('#btn-home-backup').hidden = DEMO;
    $('#nav-child-count').textContent = kids.length || '';
    $('#home-child-count').textContent = kids.length ? `(${kids.length})` : '';
    renderHomeStats();

    const backupButton = $('#btn-home-backup');
    const oldBackup = Number(T.store.settings.lastBackupAt) || 0;
    const backupAge = oldBackup ? Math.max(0, Math.floor((Date.now() - oldBackup) / 86400000)) : null;
    const backupNeedsReminder = !DEMO && T.store.data.sessions.some((session) => session.mode !== 'sim') && (backupAge === null || backupAge >= 14);
    const backupLabel = backupNeedsReminder
      ? (backupAge === null ? 'עוד לא נעשה גיבוי' : `גיבוי אחרון לפני ${backupAge} ימים`)
      : 'הורדת גיבוי';
    backupButton.classList.toggle('has-dot', backupNeedsReminder);
    backupButton.title = backupLabel;
    backupButton.setAttribute('aria-label', backupLabel);
    const lastChild = kids.slice().sort((a, b) => childLastDate(b) - childLastDate(a))[0] || null;
    const continueButton = $('#btn-continue-child');
    continueButton.hidden = !lastChild;
    if (lastChild) {
      $('#continue-child-label').textContent = `להמשיך עם ${stripHomeEmoji(lastChild.name)}`;
      continueButton.onclick = () => openPrep(T.store.getChild(lastChild.id));
    } else continueButton.onclick = null;

    $('#home-children-section').hidden = !kids.length;
    $('#home-tools').hidden = kids.length < 4;
    $('#home-search').value = homeQuery;
    $$('.sort-control [data-sort]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.sort === homeSort);
      button.setAttribute('aria-pressed', String(button.dataset.sort === homeSort));
    });
    if (!kids.length) {
      $('#home-stats').hidden = true;
      $('#home-stats').innerHTML = '';
      list.innerHTML = `<div class="home-empty card">
        <h3>עוד אין ילדים</h3>
        <p>מוסיפים ילד ומתחילים מפגש, או פותחים ילד לדוגמה כדי לראות איך נראים הכרטיסים והדוח.</p>
        <div class="row"><button class="btn" data-empty="add" type="button">ילד חדש</button><button class="btn btn-secondary" data-empty="sample" type="button">ילד לדוגמה</button></div>
      </div>`;
      $('[data-empty="add"]', list).onclick = () => openChildForm(null);
      $('[data-empty="sample"]', list).onclick = () => { T.report.makeDemoData(); renderHome(); };
      return;
    }

    const filtered = kids.filter((child) => child.name.toLocaleLowerCase('he').includes(homeQuery.trim().toLocaleLowerCase('he')));
    const sorted = filtered.slice().sort((a, b) => {
      if (homeSort === 'name') return a.name.localeCompare(b.name, 'he');
      if (homeSort === 'needed') return childLastDate(a) - childLastDate(b) || a.name.localeCompare(b.name, 'he');
      return childLastDate(b) - childLastDate(a) || a.name.localeCompare(b.name, 'he');
    });
    const nextId = lastChild ? lastChild.id : (sorted[0] && sorted[0].id);
    const cards = sorted.map((child) => {
      const sessions = homeSessions(child.id);
      const allSessions = T.store.sessionsOf(child.id);
      const last = sessions[sessions.length - 1] || null;
      const scores = sessions.map((session) => sessionScore(session)).filter((score) => score !== null);
      const sparkScores = scores.slice(-12);
      const currentScore = scores.length ? scores[scores.length - 1] : null;
      const comparison = scores.length > 3 ? scores[scores.length - 4] : scores.length > 1 ? scores[0] : currentScore;
      const delta = currentScore === null || comparison === null ? null : currentScore - comparison;
      const staleDays = last ? Math.floor((Date.now() - last.date) / 86400000) : Infinity;
      const changes = last ? (last.levelChanges || []).filter((change) => change.from !== change.to) : [];
      const levelUp = changes.find((change) => change.to > change.from);
      const levelDown = changes.find((change) => change.to < change.from);
      const isSample = !!child.sample || sessions.some((session) => session.sample);
      const palette = avatarColors(child);
      const taskRows = HOME_TASKS.map(([task, label]) => {
        const result = last && last.stages && last.stages[task];
        const score = result && !result.skipped && Number.isFinite(result.score) ? Math.max(0, Math.min(100, result.score)) : null;
        const level = T.levels.get(child, task);
        const raised = changes.some((change) => change.task === task && change.to > change.from);
        return `<div class="task-row"><span class="task-name"><b>${label}</b><small>${T.levels.DESCRIPTIONS[task]}</small></span><span class="level-badge${raised ? ' is-up' : ''}">${raised ? 'שלב חדש · ' : ''}שלב ${level}</span><b class="task-score">${score === null ? '—' : score}</b></div>`;
      }).join('');
      const startEngine = last && last.stages && last.stages.engineStart && T.ENGINE[last.stages.engineStart.choice];
      const endEngine = last && last.stages && last.stages.engineEnd && T.ENGINE[last.stages.engineEnd.choice];
      const engineLine = startEngine && endEngine ? `<p class="engine-line">מנוע: <b>${esc(startEngine.label)} ← ${esc(endEngine.label)}</b></p>` : '';
      const tags = [
        child.id === nextId ? '<span class="tag teal">הבא בתור</span>' : '',
        isSample ? '<span class="tag gray">דוגמה</span>' : '',
        child.nonverbal ? '<span class="tag gray">ללא מילים</span>' : '',
        last && staleDays >= 14 ? `<span class="tag red">${staleDays} יום בלי מפגש</span>` : '',
        levelUp ? '<span class="tag amber">שלב חדש</span>' : levelDown ? '<span class="tag gray">שלב קל יותר</span>' : '',
      ].filter(Boolean).join('');
      const meta = `גיל ${esc(child.age)} · ${sessions.length} מפגשים${last ? ` · אחרון ${relativeHomeDate(last.date)}` : ''}`;
      const body = last ? `<div class="kid-body">
        <div class="kid-score">${scoreRing(currentScore, palette.color)}${delta === null ? '' : `<span class="score-delta${delta < 0 ? ' is-down' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${delta < 0 ? 'M12 5v14M7 14l5 5 5-5' : 'M12 19V5M7 10l5-5 5 5'}"/></svg>${Math.abs(delta)}</span>`}${homeSpark(sparkScores, palette.color)}</div>
        <div class="task-rows">${taskRows}</div>
      </div>${engineLine}` : `<div class="kid-empty-session">${scoreRing(null, palette.color, true)}<p>עוד לא היה מפגש. טומבי מחכה!</p></div>`;
      return `<article class="card kid-card" style="--card-accent:${palette.color}">
        <header class="kid-head">
          <span class="kid-avatar" style="--avatar-bg:${palette.tint};--avatar-color:${palette.color}">${escHome(initials(child.name))}</span>
          <div class="kid-who"><h3>${escHome(child.name)} ${tags}</h3><p class="kid-meta">${meta}</p></div>
          <span class="kid-side-label">מפגש אחרון</span>
        </header>
        ${body}
        <footer class="kid-foot">
          <button class="text-link" data-report="${esc(child.id)}" type="button">לדוח התקדמות ‹</button>
          <div class="kid-actions">
            <button class="adult-icon-btn" data-pdf="${esc(child.id)}" type="button" aria-label="הורדת הדוח כ-PDF" title="${allSessions.length ? 'הורדת הדוח כ-PDF' : 'אין עדיין מפגשים'}"${!allSessions.length ? ' disabled' : ''}${DEMO ? ' hidden' : ''}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14l3 3 3-3"/></svg>
            </button>
            <button class="adult-icon-btn" data-edit="${esc(child.id)}" type="button" aria-label="עריכת ${esc(child.name)}" title="עריכה"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
            <button class="btn btn-small" data-start="${esc(child.id)}" type="button"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"><path d="M8 5v14l11-7z"/></svg>התחלת מפגש</button>
          </div>
        </footer>
      </article>`;
    }).join('');
    const noMatches = sorted.length ? '' : '<div class="home-empty card"><h3>לא מצאנו ילד בשם הזה</h3><p>אפשר לנסות חיפוש אחר.</p></div>';
    const addCard = `<button class="add-card" data-home-add type="button"><span class="add-plus"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><b>ילד חדש</b><span>שם, גיל, ואם צריך מסלול ללא מילים</span></button>`;
    list.innerHTML = cards + noMatches + addCard;
    $$('[data-start]', list).forEach((button) => { button.onclick = () => openPrep(T.store.getChild(button.dataset.start)); });
    $$('[data-report]', list).forEach((button) => { button.onclick = () => openReport(T.store.getChild(button.dataset.report)); });
    $$('[data-edit]', list).forEach((button) => { button.onclick = () => openChildForm(T.store.getChild(button.dataset.edit)); });
    $$('[data-pdf]', list).forEach((button) => {
      button.onclick = () => downloadHomeReport(T.store.getChild(button.dataset.pdf), button).catch((error) => {
        console.error('יצירת דוח PDF ממסך הבית נכשלה.', error);
        window.alert('לא ניתן ליצור את ה-PDF. אפשר לנסות שוב או לבחור בהדפסה.');
      });
    });
    $('[data-home-add]', list).onclick = () => openChildForm(null);
  }
  function goToChildren() {
    if ($('#screen-home').hidden) show('home');
    requestAnimationFrame(() => $('#home-children-section').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  $('#home-search').addEventListener('input', (e) => {
    const cursor = e.target.selectionStart;
    homeQuery = e.target.value;
    renderHome();
    $('#home-search').focus();
    $('#home-search').setSelectionRange(cursor, cursor);
  });
  $$('.sort-control [data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      homeSort = button.dataset.sort;
      try { localStorage.setItem('tombi.homeSort', homeSort); } catch (e) { console.warn('לא ניתן לשמור את סדר הילדים.', e); }
      renderHome();
    });
  });
  function backupData() {
    const previous = T.store.settings.lastBackupAt;
    T.store.settings.lastBackupAt = Date.now();
    T.store.save();
    try {
      download(`tombi-backup-${new Date().toISOString().slice(0, 10)}.json`, T.store.exportJSON(), 'application/json');
      if (!$('#screen-home').hidden) renderHome();
    } catch (error) {
      if (previous === undefined) delete T.store.settings.lastBackupAt;
      else T.store.settings.lastBackupAt = previous;
      T.store.save();
      throw error;
    }
  }
  $('#btn-home-backup').onclick = () => {
    try { backupData(); }
    catch (error) { console.error('יצירת קובץ הגיבוי נכשלה.', error); window.alert('לא ניתן ליצור את קובץ הגיבוי.'); }
  };
  async function downloadHomeReport(child, button) {
    if (!child) return;
    const container = document.createElement('div');
    container.className = 'report';
    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;direction:rtl;';
    document.body.appendChild(container);
    try {
      T.report.render(child, container);
      await T.pdf.download(container, reportFilename(child), button);
    } finally { container.remove(); }
  }
  function reportFilename(child) {
    const safeName = String(child.name || 'ילד').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'ילד';
    return `טומבי - ${safeName} - דוח התקדמות - ${new Date().toISOString().slice(0, 10)}.pdf`;
  }
  $('#btn-add-child').onclick = () => openChildForm(null);
  $('#btn-settings').onclick = () => show('settings');

  // ---------- child form ----------
  let editing = null;
  function openChildForm(c) {
    editing = c;
    $('#child-form-title').textContent = c ? `עריכה: ${c.name}` : 'ילד חדש';
    $('#f-name').value = c ? c.name : '';
    $('#f-age').value = c ? c.age : 5;
    $$('input[name="gender"]').forEach((r) => (r.checked = r.value === (c ? c.gender : 'm')));
    $('#f-nonverbal').checked = !!(c && c.nonverbal);
    $('#f-can-jump').checked = !c || c.canJump !== false;
    $('#f-can-stand').checked = !c || c.canStand !== false;
    $('#f-sound-sensitive').checked = !!(c && c.soundSensitive);
    $('#child-task-exclusions').innerHTML = `<div class="hint">משימות לא מתאימות לילד</div>${T.tasks.all().filter((task) => !task.key.startsWith('engine')).map((task) => `<label class="check"><input type="checkbox" data-exclude-task="${esc(task.key)}"${c && (c.excludedTasks || []).includes(task.key) ? ' checked' : ''}> ${esc(task.name)}</label>`).join('')}`;
    const savedGoals = c ? T.goals.forChild(c) : [];
    $('#child-goals').innerHTML = T.goals.CATALOG.map((template) => {
      const goal = savedGoals.find((item) => item.template === template.key);
      return `<fieldset class="goal-editor-card" data-goal-card="${esc(template.key)}">
        <label class="check goal-select"><input type="checkbox" data-goal-select="${esc(template.key)}"${goal ? ' checked' : ''}> <strong>${esc(template.title)}</strong></label>
        <p class="hint">${esc(template.description)} משימות: ${template.tasks.map((key) => esc(T.tasks.get(key).name)).join(', ')}.</p>
        <div class="goal-fields">
          <label>נקודת התחלה (0–100, ריק = לפי המדידה הראשונה)<input type="number" min="0" max="100" step="1" data-goal-baseline="${esc(template.key)}" value="${goal && goal.baseline !== null ? esc(goal.baseline) : ''}"></label>
          <label>יעד מדד (0–100)<input type="number" min="1" max="100" step="1" data-goal-target="${esc(template.key)}" value="${goal ? esc(goal.target) : '80'}"></label>
        </div>
        <label class="check"><input type="checkbox" data-goal-approved="${esc(template.key)}"${goal && goal.approved ? ' checked' : ''}> אושרה על ידי מטפל/ת</label>
        <label>שם המטפל/ת המאשר/ת<input type="text" maxlength="60" data-goal-approver="${esc(template.key)}" value="${goal ? esc(goal.approvedBy) : ''}"${goal && goal.approved ? ' required' : ''}></label>
      </fieldset>`;
    }).join('');
    $('#child-goals').querySelectorAll('[data-goal-select]').forEach((input) => {
      const card = input.closest('[data-goal-card]');
      const update = () => {
        card.classList.toggle('is-inactive', !input.checked);
        card.querySelectorAll('.goal-fields input, [data-goal-approved], [data-goal-approver]').forEach((control) => {
          if (control.matches('[data-goal-approver]')) {
            const approved = card.querySelector('[data-goal-approved]').checked;
            control.required = input.checked && approved;
          }
          control.disabled = !input.checked;
        });
      };
      input.addEventListener('change', update);
      update();
    });
    $('#child-goals').querySelectorAll('[data-goal-approved]').forEach((input) => {
      input.addEventListener('change', () => {
        const approver = $(`[data-goal-approver="${input.dataset.goalApproved}"]`, $('#child-goals'));
        approver.required = input.checked;
        if (!input.checked) approver.value = '';
      });
    });
    $('#child-levels').hidden = !c;
    if (c) {
      T.levels.ensure(c);
      $('#child-level-controls').innerHTML = Object.entries(T.levels.NAMES).map(([task, name]) => `
        <div class="level-control">
          <div class="level-task-copy"><strong>${name}</strong><small>${T.levels.DESCRIPTIONS[task]}</small></div>
          <div class="level-stepper">
            <button type="button" data-level-step="-1" data-task="${task}" aria-label="הפחתת שלב ב${name}">−</button>
            <input type="number" min="1" max="5" step="1" value="${T.levels.get(c, task)}" data-level-value="${task}" aria-label="שלב ${name}">
            <button type="button" data-level-step="1" data-task="${task}" aria-label="העלאת שלב ב${name}">+</button>
          </div>
          <label class="check"><input type="checkbox" data-level-lock="${task}"${c.levelLock[task] ? ' checked' : ''}>לנעול</label>
        </div>`).join('');
    } else $('#child-level-controls').innerHTML = '';
    $('#btn-del-child').hidden = !c;
    show('child');
    $('#f-name').focus();
  }
  $('#child-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = {
      name: $('#f-name').value.trim(), age: +$('#f-age').value, gender: $('input[name="gender"]:checked').value,
      nonverbal: $('#f-nonverbal').checked, canJump: $('#f-can-jump').checked, canStand: $('#f-can-stand').checked,
      soundSensitive: $('#f-sound-sensitive').checked,
      excludedTasks: $$('[data-exclude-task]').filter((input) => input.checked).map((input) => input.dataset.excludeTask),
      goals: T.goals.CATALOG.filter((template) => $(`[data-goal-select="${template.key}"]`, $('#child-goals')).checked).map((template) => {
        const previous = editing && T.goals.forChild(editing).find((goal) => goal.template === template.key);
        const approved = $(`[data-goal-approved="${template.key}"]`, $('#child-goals')).checked;
        return T.goals.normalize({
          ...(previous || {}), template: template.key,
          baseline: $(`[data-goal-baseline="${template.key}"]`, $('#child-goals')).value,
          target: $(`[data-goal-target="${template.key}"]`, $('#child-goals')).value,
          approved,
          approvedBy: approved ? $(`[data-goal-approver="${template.key}"]`, $('#child-goals')).value.trim() : '',
          approvedAt: approved && !(previous && previous.approved) ? Date.now() : previous && previous.approvedAt,
        });
      }),
    };
    if (!v.name) return;
    if (editing) {
      v.levels = Object.fromEntries(Object.keys(T.levels.NAMES).map((task) => [task, Math.max(1, Math.min(5, Math.round(Number($(`[data-level-value="${task}"]`).value) || 1)))]));
      v.levelLock = Object.fromEntries(Object.keys(T.levels.NAMES).map((task) => [task, $(`[data-level-lock="${task}"]`).checked]));
    }
    if (editing) T.store.updateChild(editing.id, v); else T.store.addChild(v);
    show('home');
  });
  $('#child-level-controls').addEventListener('click', (e) => {
    const button = e.target.closest('[data-level-step]');
    if (!button) return;
    const input = $(`[data-level-value="${button.dataset.task}"]`);
    input.value = Math.max(1, Math.min(5, Number(input.value) + Number(button.dataset.levelStep)));
  });
  $('#btn-del-child').onclick = async () => {
    if (editing && (await confirmBox(`למחוק את ${editing.name} ואת כל המפגשים שלו? אי אפשר לבטל.`))) { T.store.removeChild(editing.id); show('home'); }
  };

  // ---------- prep ----------
  let meterOff = null;
  function openPrep(c) {
    current = c;
    T.levels.ensure(c);
    if (!T.store.settings.sessionBudget) T.store.settings.sessionBudget = Number(c.age) < 4 ? 6 : 9;
    $('#plan-budget').value = String(T.store.settings.sessionBudget);
    const savedSetting = T.store.settings.sessionSetting || {};
    $('#plan-room').value = ['clinic', 'home', 'kindergarten'].includes(savedSetting.room) ? savedSetting.room : 'clinic';
    $('#plan-hard-floor').checked = savedSetting.hardFloor !== false;
    $('#plan-space').checked = savedSetting.freeSpace !== false;
    $('#plan-pot').checked = savedSetting.pot !== false;
    $('#plan-ball').checked = savedSetting.ball !== false;
    $('#plan-quiet').checked = savedSetting.quietRoom !== false;
    $('#prep-name').textContent = c.name;
    $('#plan-approved').checked = false;
    $('#prep-step-words').hidden = !!c.nonverbal;
    updateTeachCounts();
    $('#voice-warn').hidden = T.tombi.hasHebrewVoice();
    renderPlan(true);
    if (T.audio.mode !== 'off') unlockPrep();
    show('prep');
  }
  const PLAN_PICTURES = {
    wakeUp: 'cloud', engineStart: 'animals', engineEnd: 'cloud', echo: 'hands', loudness: 'tunnel',
    magic: 'candle', snake: 'animals', stompFreeze: 'stop', jumps: 'cloud', turtleRabbit: 'animals',
    reverseDrum: 'hands', clapStomp: 'pot', ball: 'egg', elephantMouse: 'foot', march: 'foot',
  };
  function readPlanSetting() {
    return {
      room: $('#plan-room').value,
      budgetMin: Number($('#plan-budget').value),
      hardFloor: $('#plan-hard-floor').checked,
      freeSpace: $('#plan-space').checked,
      pot: $('#plan-pot').checked,
      ball: $('#plan-ball').checked,
      quietRoom: $('#plan-quiet').checked,
    };
  }
  function renderPlan(rebuild = false) {
    if (!current) return;
    $('#plan-warning').hidden = true;
    const setting = readPlanSetting();
    if (rebuild || !currentPlan) {
      const pinned = current && current.pinnedTasks || [];
      currentPlan = T.planner.build(current, setting, T.store.sessionsOf(current.id), { pinned });
    }
    currentPlan.setting = setting;
    $('#plan-room').value = setting.room;
    $('#plan-budget').value = String(currentPlan.setting.budgetMin);
    const rows = currentPlan.tasks.map((entry, index) => {
      const history = T.store.sessionsOf(current.id);
      const candidates = entry.mandatory ? [] : T.tasks.all().filter((task) => task.slot === entry.slot
        && T.planner.canReplace(currentPlan.tasks, index, task.key, current, setting, history));
      const options = candidates.map((task) => `<option value="${esc(task.key)}"${task.key === entry.key ? ' selected' : ''}>${esc(task.name)}</option>`).join('');
      const picture = PLAN_PICTURES[entry.key] || 'foot';
      const task = T.tasks.get(entry.key);
      const duration = task.durationSec[entry.short ? 'short' : 'full'];
      const level = T.levels.NAMES[entry.key] ? T.levels.get(current, entry.key) : null;
      const linkedGoals = (entry.goalIds || []).map((id) => T.goals.forChild(current).find((goal) => goal.id === id)).filter(Boolean);
      const taskControl = candidates.length > 1
        ? `<select data-plan-task="${index}" aria-label="בחירת משימה">${options}</select>`
        : '<span class="plan-fixed">קבוע</span>';
      const skipControl = entry.mandatory
        ? '<span class="plan-fixed">חובה</span>'
        : `<label class="check"><input type="checkbox" data-plan-skip="${index}"${entry.skip ? ' checked' : ''}> דילוג</label>`;
      const pinControl = entry.mandatory ? '' : `<label class="check"><input type="checkbox" data-plan-pin="${index}"${entry.pinned ? ' checked' : ''}> נעיצה</label>`;
      return `<div class="oc-plan-item${entry.skip ? ' is-skipped' : ''}" data-plan-item="${index}">
        <span>${T.activity.picture(picture)}<b>${esc(entry.name)}${level ? ` · שלב ${level}` : ''}</b><small>${esc(entry.reason)} · ${duration} שנ׳${entry.short ? ' · גרסה קצרה' : ''}${linkedGoals.length ? ` · מטרות: ${linkedGoals.map((goal) => esc(goal.title)).join(', ')}` : ''}</small></span>
        ${taskControl}${skipControl}${pinControl}
      </div>`;
    }).join('');
    $('#plan-items').innerHTML = `<div class="oc-plan-items">${rows}</div>`;
    const activeGoals = T.goals.activeApproved(current);
    $('#plan-goal-summary').hidden = !activeGoals.length;
    $('#plan-goal-summary').innerHTML = activeGoals.length
      ? `<strong>מטרות מאושרות לתכנון</strong><ul>${activeGoals.map((goal) => {
        const state = T.goals.evaluate(current, goal);
        return `<li><b>${esc(goal.title)}</b> — ${esc(state.recommendation)}${state.recentAverage !== null ? ` (ממוצע אחרון ${Math.round(state.recentAverage)}/100)` : ''}</li>`;
      }).join('')}</ul>`
      : '';
    $('#plan-approval-row').hidden = !activeGoals.length;
    refreshPlanApproval();
    currentPlan.estimatedSec = T.planner.estimate(currentPlan.tasks);
    currentPlan.budgetSec = currentPlan.setting.budgetMin * 60;
    const overBudget = currentPlan.estimatedSec > currentPlan.budgetSec;
    const minutes = Math.floor(currentPlan.estimatedSec / 60);
    const seconds = currentPlan.estimatedSec % 60;
    $('#plan-total').textContent = `משך משוער: ${minutes} דק׳${seconds ? ` ו־${seconds} שנ׳` : ''} מתוך ${currentPlan.setting.budgetMin} דקות${overBudget ? ' — חורג מהתקציב' : ''}`;
    $('#plan-total').className = `oc-plan-total${overBudget ? ' is-over' : ''}`;
    const progress = Math.min(100, Math.round(currentPlan.estimatedSec / currentPlan.budgetSec * 100));
    $('#plan-progress').setAttribute('aria-valuenow', String(progress));
    $('#plan-progress').setAttribute('aria-valuetext', overBudget ? 'התוכנית חורגת מהתקציב' : `${progress}% מהתקציב`);
    $('#plan-progress-fill').style.width = `${progress}%`;
    $('#plan-progress').classList.toggle('is-over', overBudget);
  }
  $('#plan-items').addEventListener('change', (event) => {
    const target = event.target;
    const index = Number(target.dataset.planTask ?? target.dataset.planSkip ?? target.dataset.planPin);
    const entry = currentPlan && currentPlan.tasks[index];
    if (!entry) return;
    if (target.matches('[data-plan-task]')) {
      const task = T.tasks.get(target.value);
      if (task && !T.planner.canReplace(currentPlan.tasks, index, task.key, current, currentPlan.setting, T.store.sessionsOf(current.id))) {
        target.value = entry.key;
        $('#plan-warning').textContent = 'המשימה אינה מתאימה לתנאי המפגש או יוצרת רצף תנועה לא מאוזן. התוכנית הקודמת נשמרה.';
        $('#plan-warning').hidden = false;
        return;
      }
      if (task) {
        const goals = T.goals.goalsForTask(current, task.key, true);
        Object.assign(entry, {
          key: task.key, name: task.name, domain: task.domain,
          reason: goals.length ? `בחירה ידנית · קשור למטרה: ${goals[0].title}` : 'בחירה של הסייעת',
          goalIds: goals.map((goal) => goal.id),
          isNew: T.planner.isNewTask(task.key, current, T.store.sessionsOf(current.id)),
          skip: false,
        });
      }
    } else if (target.matches('[data-plan-skip]')) entry.skip = target.checked;
    else if (target.matches('[data-plan-pin]')) {
      entry.pinned = target.checked;
      current.pinnedTasks = currentPlan.tasks.filter((item) => item.pinned).map((item) => item.key);
      T.store.save();
    }
    if ($('#plan-approved')) $('#plan-approved').checked = false;
    renderPlan();
  });
  $('#plan-rebuild').onclick = () => { $('#plan-approved').checked = false; renderPlan(true); };
  $('#plan-approved').addEventListener('change', refreshPlanApproval);
  function refreshPlanApproval() {
    const hasGoals = !!(current && T.goals.activeApproved(current).length);
    if ($('#plan-approval-row')) $('#plan-approval-row').hidden = !hasGoals;
    if ($('#btn-start')) $('#btn-start').disabled = T.audio.mode === 'off' || (hasGoals && !$('#plan-approved').checked);
  }
  ['#plan-room', '#plan-budget', '#plan-hard-floor', '#plan-space', '#plan-pot', '#plan-ball', '#plan-quiet'].forEach((selector) => {
    $(selector).addEventListener('change', () => {
      const setting = readPlanSetting();
      T.store.settings.sessionBudget = setting.budgetMin;
      T.store.settings.sessionSetting = {
        room: setting.room, hardFloor: setting.hardFloor, freeSpace: setting.freeSpace,
        pot: setting.pot, ball: setting.ball, quietRoom: setting.quietRoom,
      };
      T.store.save();
      $('#plan-approved').checked = false;
      renderPlan(true);
    });
  });
  function unlockPrep() {
    ['#prep-step-cal', '#prep-step-words', '#prep-step-go'].forEach((s) => $(s).classList.remove('is-locked'));
    refreshPlanApproval();
    $('#btn-cal').disabled = false;
    $('#btn-mic').classList.toggle('is-active', T.audio.mode === 'mic');
    $('#btn-sim').classList.toggle('is-active', T.audio.mode === 'sim');
    if (!meterOff) meterOff = T.audio.on((t, f) => t === 'frame' && drawMeter($('#prep-meter'), f, $('#prep-readout')));
  }
  async function startInput(kind) {
    if (!DEMO) $('#mic-error').hidden = true;
    try {
      if (T.audio.mode !== 'off' && T.audio.mode !== kind) { T.audio.stop(); location.reload(); return; }
      if (T.audio.mode === 'off') {
        if (kind === 'mic') await T.audio.startMic(); else await T.audio.startSim();
      }
      const applied = T.audio.applied;
      $('#audio-constraints-warn').hidden = !(applied.echoCancellation || applied.noiseSuppression || applied.autoGainControl);
      unlockPrep();
      $('#prep-readout').textContent = 'שקט בבקשה… מכייל';
      await T.audio.calibrate(2000);
      $('#prep-readout').textContent = `רעש רקע ${Math.round(T.audio.floor)} dB. אפשר לדבר ולראות את המד זז.`;
    } catch (err) {
      const e = $('#mic-error');
      e.hidden = false;
      e.textContent = err && err.name === 'NotAllowedError'
        ? 'הדפדפן לא קיבל רשות למיקרופון. לוחצים על סמל המנעול ליד כתובת האתר, מאפשרים מיקרופון ומרעננים. אפשר גם לנסות במצב סימולציה.'
        : 'לא הצלחתי לפתוח את המיקרופון. צריך לפתוח את הדף מ-Live Server ב-Chrome (כתובת שמתחילה ב-localhost). אפשר לנסות במצב סימולציה.';
    }
  }
  $('#btn-mic').onclick = () => startInput('mic');
  if (DEMO) $('#btn-mic').onclick = null;
  $('#btn-sim').onclick = () => startInput('sim');
  $('#btn-cal').onclick = async () => { $('#prep-readout').textContent = 'שקט בבקשה… מכייל'; await T.audio.calibrate(2000); $('#prep-readout').textContent = `רעש רקע ${Math.round(T.audio.floor)} dB`; };

  function updateTeachCounts() {
    const t = (current && current.templates) || {};
    $$('.teach-btn').forEach((b) => { const n = (t[b.dataset.w] || []).length; $('small', b).textContent = n ? `✓ ${n}` : ''; });
  }
  $$('.teach-btn').forEach((b) => (b.onclick = async () => {
    if (T.audio.mode === 'off') return;
    const w = b.dataset.w, name = { turtle: 'צב', fish: 'דג', monkey: 'קוף' }[w];
    $('#teach-status').textContent = `מקשיב… שהילד יגיד "${name}"`;
    b.classList.add('is-listening');
    const seg = await new Promise((res) => {
      const off = T.audio.on((type, d) => { if (type === 'segment' && d.dur > 150 && d.dur < 2000) { off(); res(d); } });
      setTimeout(() => { off(); res(null); }, 6000);
    });
    b.classList.remove('is-listening');
    if (!seg) { $('#teach-status').textContent = 'לא שמעתי. אפשר לנסות שוב.'; return; }
    const feats = T.dsp.mfcc(T.audio.grab(seg.start, seg.end));
    T.store.addTemplate(current.id, w, feats);
    current = T.store.getChild(current.id);
    updateTeachCounts();
    $('#teach-status').textContent = `נשמרה טביעת קול של "${name}" (${(seg.dur / 1000).toFixed(1)} שניות). ההקלטה עצמה נמחקה.`;
  }));

  // ---------- meters ----------
  let meterRaf = new Map();
  function drawMeter(cv, f, readout) {
    if (!cv || cv.offsetParent === null || meterRaf.get(cv)) return;
    meterRaf.set(cv, true);
    requestAnimationFrame(() => {
      meterRaf.set(cv, false);
      const g = cv.getContext('2d'), W = cv.width, H = cv.height;
      const lo = -90, hi = -10, x = (db) => ((Math.max(lo, Math.min(hi, db)) - lo) / (hi - lo)) * W;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#E4EEEA'; g.fillRect(0, 0, W, H);
      const thr = T.audio.floor + T.audio.cfg.sensitivity;
      g.fillStyle = f.active ? (T.audio.level.hz && T.audio.level.hz < T.audio.cfg.adultHz ? '#B7791F' : '#1F7A6D') : '#9DB5AE';
      g.fillRect(W - x(f.db), 8, x(f.db), H - 16);
      g.fillStyle = '#14211F'; g.fillRect(W - x(T.audio.floor) - 1, 0, 2, H);
      g.fillStyle = '#D9480F'; g.fillRect(W - x(thr) - 1, 0, 3, H);
      if (readout && f.active) readout.textContent = `${Math.round(f.db - T.audio.floor)} dB מעל הרקע${f.hz ? ` · ${Math.round(f.hz)} הרץ · ${f.hz < T.audio.cfg.adultHz ? 'נשמע כמו מבוגר' : 'נשמע כמו ילד'}` : ''}`;
    });
  }

  // ---------- game ----------
  const stagebar = $('#stagebar');
  stagebar.innerHTML = T.session.STAGES.map((s, i) => `<span class="step" data-i="${i}"><b>${i + 1}</b><span>${s.name}</span></span>`).join('');

  T.ui = {
    bubble(text) { $('#bubble').textContent = text; },
    refreshAudioWarnings() {
      const applied = T.audio.applied;
      const enabled = [
        ['echoCancellation', 'ביטול הד'], ['noiseSuppression', 'דיכוי רעש'], ['autoGainControl', 'הגבר אוטומטי'],
      ].filter(([key]) => applied[key] === true).map(([, label]) => label);
      const constraintsWarning = $('#aide-audio-constraints-warn');
      constraintsWarning.hidden = !enabled.length;
      constraintsWarning.textContent = enabled.length
        ? `הדפדפן השאיר פעיל עיבוד אודיו (${enabled.join(', ')}); מדידות הצליל עלולות להיות פחות מדויקות.`
        : '';
      const loopbackWarning = $('#aide-loopback-warn');
      loopbackWarning.hidden = !T.audio.loopbackCalibrated || !T.audio.loopbackLowConfidence;
      loopbackWarning.textContent = 'הכיול לא זיהה מספיק סמנים או שהריצוד גבוה. כדאי לבדוק עוצמת רמקול וחיבור Bluetooth; מדדי תזמון יהיו בביטחון נמוך.';
    },
    onsetRepeat(show) { $('#onset-repeat-warn').hidden = !show; },
    offerCalm(show) { $('#a-calm').hidden = !show; },
    listening(v) {
      const el = $('#listen-state');
      el.classList.toggle('on', v);
      el.textContent = v ? 'טומבי מקשיב לילד' : 'טומבי מדבר';
    },
    setPlan(plan) {
      stagebar.innerHTML = plan.map((entry, i) => `<span class="step" data-i="${i}"><b>${i + 1}</b><span>${esc(entry.name)}</span></span>`).join('');
      $('#aide-plan-next').textContent = `המשימות בתוכנית: ${plan.map((entry) => entry.name).join(' · ')}`;
    },
    flash(msg) { log(msg); },
    setStage(i, task = T.session.STAGES[i]) {
      $$('.step', stagebar).forEach((s, j) => { s.classList.toggle('is-now', j === i); });
      const st = task;
      const taskLevel = T.levels.NAMES[st.key] && current ? ` · שלב ${T.levels.get(current, st.key)}` : '';
      $('#aide-stage').innerHTML = `<b>שלב ${i + 1}: ${esc(st.name)}${taskLevel}</b><span>${esc(st.domain)}</span>`;
      $('#task').innerHTML = '';
      log(`התחיל שלב ${i + 1}: ${st.name}`);
    },
    stageDone(i, r) {
      const s = $(`.step[data-i="${i}"]`, stagebar);
      s.classList.remove('is-now');
      s.classList.add(r && !r.skipped ? 'is-done' : 'is-skipped');
      if (r && !r.skipped) log(`שלב ${i + 1} הסתיים${Number.isFinite(r.score) ? ` · ציון ${r.score}` : ''}`);
      else log(`שלב ${i + 1} דולג`);
    },
    aideEngine(v) { $('#aide-engine').hidden = !v; },
  };
  function log(msg) {
    const li = document.createElement('li');
    li.textContent = `${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${msg}`;
    $('#aide-log').prepend(li);
    while ($('#aide-log').children.length > 40) $('#aide-log').lastChild.remove();
  }

  let aideMeterOff = null, lastRec = null;
  $('#btn-start').onclick = async () => {
    show('game');
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
    try { await navigator.wakeLock?.request('screen'); } catch (e) {}
    $('#aide-sim').hidden = T.audio.mode !== 'sim';
    $('#aide-finished').hidden = true;
    $('#aide-controls').hidden = false;
    openAide(T.audio.mode === 'sim');
    T.ui.refreshAudioWarnings();
    if (!tombiMounted) { await T.tombi.mount($('#tombi-canvas'), IMG); tombiMounted = true; } else T.tombi.resize();
    T.tombi.setSimulationMode(T.audio.mode === 'sim');
    $$('.step', stagebar).forEach((s) => (s.className = 'step'));
    $('#aide-log').innerHTML = '';
    $('#assist-count').textContent = '0';
    $('#a-pause').firstChild.textContent = 'השהיה ';
    if (!aideMeterOff) aideMeterOff = T.audio.on((t, f) => t === 'frame' && drawMeter($('#aide-meter'), f, $('#aide-readout')));
    lastRec = null;
    try {
      const plan = currentPlan ? currentPlan.tasks.filter((entry) => !entry.skip) : undefined;
      lastRec = await T.session.run(T.store.getChild(current.id), {
        plan, setting: currentPlan && currentPlan.setting,
        clinicianApproved: !T.goals.activeApproved(current).length || $('#plan-approved').checked,
      });
    } catch (e) { console.error(e); log('שגיאה: ' + e.message); }
    // the child still sees only Tombi; the adult moves on from the panel
    $('#aide-controls').hidden = true;
    $('#aide-finished').hidden = false;
    $('#bubble').textContent = '';
    openAide(true);
  };
  $('#a-finish').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (e) {}
    T.tombi.setSimulationMode(false);
    openAide(false);
    showDone(lastRec);
  };

  function openAide(v) {
    $('#aide').hidden = !v;
    $('#screen-game').classList.toggle('aide-open', v);
  }
  // long-press (1 s) on the top-left corner opens the panel; a child's quick tap does nothing
  const hot = $('#aide-hotspot');
  let pressT = null;
  hot.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hot.classList.add('is-pressing');
    pressT = setTimeout(() => { hot.classList.remove('is-pressing'); openAide(true); }, 1000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => hot.addEventListener(ev, () => { clearTimeout(pressT); hot.classList.remove('is-pressing'); }));
  $('#aide-close').onclick = () => openAide(false);
  $('#a-manual').onclick = () => T.session.manual();
  $('#a-repeat').onclick = () => T.session.repeat();
  $('#a-skip').onclick = () => T.session.skip();
  $('#a-calm').onclick = () => T.session.jumpToCalm();
  $('#a-pause').onclick = () => {
    const p = !T.session.paused;
    T.session.pause(p);
    $('#a-pause').firstChild.textContent = p ? 'המשך ' : 'השהיה ';
    T.ui.flash(p ? 'מושהה' : 'ממשיכים');
  };
  $('#a-end').onclick = async () => { if (await confirmBox('לסיים את המפגש עכשיו? מה שנמדד עד כאן יישמר.')) T.session.abort(); };
  $$('[data-pick]').forEach((b) => (b.onclick = () => T.session.pickEngine(b.dataset.pick)));
  $$('[data-assist]').forEach((b) => (b.onclick = () => {
    T.session.assist(b.dataset.assist);
    const n = (T.session.record?.assists || []).filter((a) => a.type !== 'repeat').length;
    $('#assist-count').textContent = n;
    T.ui.flash(`נרשמה עזרה: ${b.textContent}`);
  }));
  const simActs = {
    word: () => T.audio.sim.voice(420, 0.22),
    soft: () => T.audio.sim.voice(600, 0.025),
    loud: () => T.audio.sim.voice(650, 0.4),
    ba2: () => { T.audio.sim.voice(200, 0.25, 300, 0); T.audio.sim.voice(200, 0.25, 300, 560); },
    ba3: () => { T.audio.sim.voice(200, 0.25, 300, 0); T.audio.sim.voice(200, 0.25, 300, 470); T.audio.sim.voice(200, 0.25, 300, 920); },
    clap4: () => [0, 390, 770, 1530].forEach((d) => T.audio.sim.clap(d)),
    sss: () => T.audio.sim.hiss(4000, 0.15),
    adult: () => T.audio.sim.adult(700),
  };
  $$('[data-sim]').forEach((b) => (b.onclick = () => simActs[b.dataset.sim]()));

  document.addEventListener('keydown', (e) => {
    if ($('#screen-game').hidden || e.target.closest('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); T.session.manual(); }
    else if (k === 'r' || k === 'ר') T.session.repeat();
    else if (k === 'p' || k === 'פ') $('#a-pause').click();
    else if (k === 'n' || k === 'מ') T.session.skip();
    else if (k === 'a' || k === 'ש') openAide($('#aide').hidden);
  });

  // ---------- done ----------
  function showDone(rec) {
    const body = $('#done-body');
    $('#btn-done-pdf').hidden = DEMO || !rec;
    if (!rec) { body.innerHTML = '<p>המפגש הסתיים לפני שנמדד משהו, אז לא נשמר.</p>'; show('done'); return; }
    const names = Object.fromEntries(T.session.STAGES.map((s) => [s.key, s]));
    const changes = (rec.levelChanges || []).map((change) => {
      const task = T.levels.NAMES[change.task];
      if (!task) return '';
      return change.to > change.from
        ? `<p class="level-change">⬆ ${esc(current.name)} עלה${current.gender === 'f' ? 'תה' : ''} לשלב ${change.to} ב${esc(task)}</p>`
        : `<p class="level-change">${esc(current.name)} ${current.gender === 'f' ? 'תשחק' : 'ישחק'} בשלב ${change.to} ב${esc(task)} בפעם הבאה, כדי ${current.gender === 'f' ? 'שיהיה לה' : 'שיהיה לו'} כיף להצליח.</p>`;
    }).join('');
    const meetingDate = new Date(rec.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
    body.innerHTML = `<header class="pdf-session-head"><span class="ocupa-report-logo" aria-label="Ocupa"><svg class="ocupa-mark" viewBox="0 0 42 42" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="2" y="21" width="19" height="19"/><circle cx="31" cy="30.5" r="9.5"/><path d="M21 2 L31 20 L11 20 Z"/></g></svg><span class="ocupa-word" dir="ltr">ocupa</span></span><img src="assets/ocupa-tombi-cutout.png" alt=""><div><b>טומבי · סיכום מפגש</b><span>${esc(current.name)} · גיל ${esc(current.age)} · ${meetingDate}</span></div></header>
      <ul class="done-list">${Object.entries(rec.stages).map(([k, r]) => `<li><span>${esc(names[k].name)}<small>${esc(names[k].domain)}</small></span>
      <b>${r.skipped ? 'דולג' : k.startsWith('engine') ? (r.choice ? T.ENGINE[r.choice].emoji + ' ' + esc(T.ENGINE[r.choice].label) : '—') : `${esc(r.score)}${r.level ? ` · שלב ${r.level}` : ''}`}</b></li>`).join('')}</ul>
      ${changes}
      <p class="hint">משך ${Math.round(rec.durationSec / 60)} דקות · עזרה של הסייעת: ${(rec.assists || []).filter((a) => a.type !== 'repeat').length}${rec.adultIgnored ? ` · ${rec.adultIgnored} קולות מבוגר לא נספרו` : ''}${rec.mode === 'sim' ? ' · מפגש סימולציה' : ''}</p>`;
    show('done');
  }
  $('#btn-done-report').onclick = () => openReport(T.store.getChild(current.id));
  $('#btn-done-pdf').onclick = async (e) => {
    const rec = lastRec;
    if (!rec || DEMO) return;
    const date = new Date(rec.date).toISOString().slice(0, 10);
    try { await T.pdf.download($('#done-body'), `טומבי - ${safeFilenamePart(current.name)} - מפגש ${date}.pdf`, e.currentTarget); }
    catch (error) { console.error('יצירת סיכום PDF נכשלה.', error); window.alert('לא ניתן ליצור את ה-PDF. אפשר לנסות שוב או לבחור בהדפסה.'); }
  };
  function safeFilenamePart(value) {
    return String(value || 'ילד').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'ילד';
  }

  // ---------- report ----------
  function openReport(c) {
    current = c;
    T.report.render(c, $('#report-body'));
    if (DEMO) $$('[data-act="print"],[data-act="pdf"],[data-act="csv"],[data-act="mail"]', $('#report-body')).forEach((b) => (b.hidden = true));
    show('report');
  }
  $('#report-body').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (b.hasAttribute('data-goal-achieve')) {
      const goal = T.goals.forChild(current).find((item) => item.id === b.dataset.goalAchieve);
      if (goal && (await confirmBox(`לאשר מקצועית שמטרת "${goal.title}" הושגה?`))) {
        goal.status = 'achieved';
        goal.achievedAt = Date.now();
        goal.achievedBy = goal.approvedBy || '';
        T.store.save();
        openReport(current);
      }
      return;
    }
    if (b.hasAttribute('data-carryover-save')) {
      const field = $('#carryover-text');
      try {
        T.goals.updateCarryover(current, (T.store.sessionsOf(current.id).slice(-1)[0] || {}).id,
          field.value, $('#carryover-context').value);
        openReport(current);
      } catch (error) {
        window.alert(error.message);
        field.focus();
      }
      return;
    }
    if (act === 'print') window.print();
    if (act === 'pdf' && !DEMO) {
      try { await T.pdf.download($('#report-body'), `טומבי - ${safeFilenamePart(current.name)} - דוח התקדמות - ${new Date().toISOString().slice(0, 10)}.pdf`, b); }
      catch (error) { console.error('יצירת דוח PDF נכשלה.', error); window.alert('לא ניתן ליצור את ה-PDF. אפשר לנסות שוב או לבחור בהדפסה.'); }
    }
    if (act === 'copy') {
      const t = T.report.summaryText(current);
      try { await navigator.clipboard.writeText(t); b.textContent = 'הועתק'; } catch (err) { b.textContent = 'ההעתקה נחסמה'; }
      setTimeout(() => (b.textContent = 'העתקת הסיכום'), 1800);
    }
    if (act === 'mail') {
      // opens a draft in the user's own mail app; nothing is sent automatically
      const subject = `סיכום מפגשי טומבי: ${current.name}`;
      location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(T.report.summaryText(current))}`;
    }
    if (act === 'csv') download(`tombi-${current.name}.csv`, T.report.csv(current), 'text/csv;charset=utf-8');
    if (b.dataset.del && (await confirmBox('למחוק את המפגש הזה?'))) { T.store.removeSession(b.dataset.del); openReport(current); }
  });
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- settings ----------
  function renderSettings() {
    const vs = T.tombi.loadVoices();
    const sel = $('#s-voice');
    sel.innerHTML = vs.length ? vs.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)}</option>`).join('') : '<option value="">אין קול עברי בדפדפן הזה</option>';
    sel.value = T.tombi.voiceCfg.voiceURI || (vs[0] && vs[0].voiceURI) || '';
    $('#s-voice-hint').textContent = vs.length ? '' : 'ב-Windows: הגדרות > זמן ושפה > דיבור > הוספת קולות > עברית, ואז להפעיל מחדש את Chrome. באנדרואיד: הגדרות > נגישות > המרת טקסט לדיבור > Google > עברית. בינתיים טומבי מציג את הטקסט ומזיז את הפה, ואפשר להקליט את השורות בקול שלך.';
    $('#s-rate').value = T.tombi.voiceCfg.rate;
    $('#s-pitch').value = T.tombi.voiceCfg.pitch;
    $('#s-sens').value = T.audio.cfg.sensitivity; $('#s-sens-out').textContent = T.audio.cfg.sensitivity;
    $('#s-adult').checked = T.audio.cfg.adultFilter;
    $('#s-adulthz').value = T.audio.cfg.adultHz; $('#s-adult-out').textContent = T.audio.cfg.adultHz;
    $('#s-snake').value = S.snakeTarget || 0;
    $('#s-weekly-goal').value = Math.max(1, Number(S.weeklyGoal) || 6);
    renderLines();
    if (DEMO) ['#s-export', '#s-import'].forEach((q) => ($(q).closest('.btn') || $(q)).setAttribute('hidden', ''));
  }
  const saveVoice = () => { S.voice = { ...T.tombi.voiceCfg }; T.store.save(); };
  $('#s-voice').onchange = (e) => { T.tombi.voiceCfg.voiceURI = e.target.value; saveVoice(); };
  $('#s-rate').oninput = (e) => { T.tombi.voiceCfg.rate = +e.target.value; saveVoice(); };
  $('#s-pitch').oninput = (e) => { T.tombi.voiceCfg.pitch = +e.target.value; saveVoice(); };
  $('#s-test').onclick = async () => { await T.audio.ensureCtx(); T.tombi.say('שלום! אני טומבי, הדרקון. בוא נשחק!'); };
  $('#s-sens').oninput = (e) => { T.audio.cfg.sensitivity = S.sensitivity = +e.target.value; $('#s-sens-out').textContent = e.target.value; T.store.save(); };
  $('#s-adult').onchange = (e) => { T.audio.cfg.adultFilter = S.adultFilter = e.target.checked; T.store.save(); };
  $('#s-adulthz').oninput = (e) => { T.audio.cfg.adultHz = S.adultHz = +e.target.value; $('#s-adult-out').textContent = e.target.value; T.store.save(); };
  $('#s-snake').onchange = (e) => { S.snakeTarget = +e.target.value || 0; T.store.save(); };
  $('#s-weekly-goal').onchange = (e) => {
    const goal = Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 6)));
    e.target.value = goal;
    S.weeklyGoal = goal;
    T.store.save();
    if (!$('#screen-home').hidden) renderHome();
  };
  $('#s-export').onclick = () => {
    try { backupData(); }
    catch (error) { console.error('יצירת קובץ הגיבוי נכשלה.', error); window.alert('לא ניתן ליצור את קובץ הגיבוי.'); }
  };
  $('#s-import').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { T.store.importJSON(await f.text()); $('#s-data-status').textContent = 'הגיבוי שוחזר.'; } catch (err) { $('#s-data-status').textContent = err.message; }
    e.target.value = '';
  };
  $('#s-sample').onclick = () => {
    const result = T.report.makeDemoData();
    $('#s-data-status').textContent = result.added
      ? `נוספו נתוני הדגמה סינתטיים עבור: ${result.names.join(', ')}. הנתונים מסומנים כהדגמה ואינם משנים תוכניות של ילדים אמיתיים.`
      : 'נתוני ההדגמה כבר קיימים. לא נוצרו רשומות כפולות.';
  };
  $('#s-wipe').onclick = async () => {
    if (await confirmBox('למחוק את כל הילדים, המפגשים וההגדרות מהדפדפן הזה? כדאי לגבות קודם.')) {
      try { localStorage.removeItem('tombi.v1'); } catch (e) {}
      location.reload();
    }
  };

  let recorder = null;
  async function renderLines() {
    const lines = S.lines || [];
    const have = new Set((await T.voiceStore.keys()) || []);
    const box = $('#lines');
    box.innerHTML = lines.length ? lines.map((t, i) => `<div class="line-row${have.has(t) ? ' has' : ''}">
      <span class="line-text">${esc(t)}</span>
      <span class="row">
        <button class="btn btn-small" data-rec="${i}" type="button">${have.has(t) ? 'להקליט שוב' : 'להקליט'}</button>
        ${have.has(t) ? `<button class="btn btn-small btn-ghost" data-play="${i}" type="button">לשמוע</button><button class="btn btn-small btn-danger-ghost" data-rm="${i}" type="button">מחיקה</button>` : ''}
      </span></div>`).join('') : '<p class="hint">עוד אין שורות. הן יופיעו אחרי מפגש ראשון (או מפגש סימולציה).</p>';
    $$('[data-play]', box).forEach((b) => (b.onclick = async () => { await T.audio.ensureCtx(); T.tombi.say(lines[+b.dataset.play]); }));
    $$('[data-rm]', box).forEach((b) => (b.onclick = async () => { await T.voiceStore.del(lines[+b.dataset.rm]); renderLines(); }));
    $$('[data-rec]', box).forEach((b) => (b.onclick = async () => {
      if (recorder) { recorder.stop(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          recorder = null;
          await T.voiceStore.put(lines[+b.dataset.rec], new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }));
          renderLines();
        };
        recorder.start();
        b.textContent = 'עצירה';
        b.classList.add('btn-danger');
      } catch (err) { $('#s-data-status').textContent = 'אין גישה למיקרופון להקלטה.'; }
    }));
  }

  // first screen
  show('home');
})();
