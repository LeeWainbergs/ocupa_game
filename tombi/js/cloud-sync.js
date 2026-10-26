T.sync = (() => {
  const config = window.TOMBI_SYNC_CONFIG || {};
  const parentChildId = new URLSearchParams(window.location.search).get('parent');
  const parentMode = !!parentChildId;
  let staffToken = '';
  let staffPatients = [];
  let signedInEmail = '';
  let statusMessage = '';
  let statusError = false;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const apiBase = () => String(config.apiBaseUrl || '').replace(/\/+$/, '');
  function secureApiBase() {
    const base = apiBase();
    let url;
    try { url = new URL(base); } catch (error) { throw new Error('כתובת ה-API אינה תקינה.'); }
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(localHost && url.protocol === 'http:')) {
      throw new Error('סנכרון דורש חיבור HTTPS מאובטח.');
    }
    return base;
  }
  const clientReady = () => {
    const firebase = config.firebaseConfig || {};
    return Boolean(apiBase() && firebase.apiKey && firebase.authDomain && firebase.projectId && firebase.appId);
  };
  const setStatus = (message, isError = false) => {
    statusMessage = message;
    statusError = isError;
    const element = document.getElementById('cloud-sync-status');
    if (element) {
      element.textContent = message;
      element.classList.toggle('is-error', isError);
    }
    const parentBanner = document.getElementById('parent-sync-banner');
    if (parentBanner && parentMode && message) {
      parentBanner.textContent = message;
      parentBanner.classList.toggle('is-error', isError);
      parentBanner.hidden = false;
    }
  };

  async function apiRequest(path, token, init = {}) {
    if (!apiBase()) throw new Error('כתובת ה-API לא הוגדרה.');
    const freshToken = window.TOMBI_AUTH ? await window.TOMBI_AUTH.getIdToken() : '';
    token = freshToken;
    if (!token) throw new Error('צריך להתחבר לחשבון כדי לסנכרן.');
    const response = await fetch(`${secureApiBase()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.text();
      let detail = body;
      try { detail = JSON.parse(body).detail || body; } catch (error) { /* Keep the server response for the user. */ }
      throw new Error(`שגיאת סנכרון (${response.status}): ${detail}`);
    }
    return response.status === 204 ? null : response.json();
  }

  function tokenForMode() {
    if (parentMode) return sessionStorage.getItem('tombi.parent.token') || '';
    return staffToken;
  }

  function getClientSessionId(session) {
    const ids = T.store.settings.cloudSessionIds || (T.store.settings.cloudSessionIds = {});
    if (!ids[session.id]) {
      if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
        throw new Error('הדפדפן לא תומך ביצירת מזהה בטוח לסנכרון. יש לעדכן את הדפדפן.');
      }
      ids[session.id] = window.crypto.randomUUID();
      T.store.save();
    }
    return ids[session.id];
  }

  function safeSessionPayload(session) {
    const stageEntries = Object.entries(session.stages || {});
    const physicalStages = new Set((session.assists || []).filter((assist) => assist.type === 'physical').map((assist) => assist.stage));
    const stages = stageEntries.filter(([, result]) => result && typeof result === 'object').map(([key, result]) => ({
      key,
      score: Number.isInteger(result.score) && result.score >= 0 && result.score <= 100 ? result.score : null,
      level: Number.isInteger(result.level) && result.level >= 1 && result.level <= 5 ? result.level : null,
      confidence: Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1 ? result.confidence : null,
      physical_assist: physicalStages.has(key),
      skipped: Boolean(result.skipped),
    }));
    const scores = stages.map((stage) => stage.score).filter((score) => Number.isInteger(score));
    const levelChanges = {};
    (Array.isArray(session.levelChanges) ? session.levelChanges : []).forEach((change) => {
      if (change && ['echo', 'loudness', 'magic', 'snake'].includes(change.task)
        && Number.isInteger(change.to) && change.to >= 1 && change.to <= 5) {
        levelChanges[change.task] = change.to;
      }
    });
    const playedAt = new Date(Number(session.date));
    if (Number.isNaN(playedAt.getTime())) throw new Error('תאריך המפגש אינו תקין.');
    return {
      client_session_id: getClientSessionId(session),
      played_at: playedAt.toISOString(),
      duration_seconds: Math.max(0, Math.min(7200, Math.round(Number(session.durationSec) || 0))),
      score: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      stages,
      level_changes: levelChanges,
    };
  }

  function resetParentLevels(session) {
    if (!parentMode) return;
    try {
      const storageKey = `tombi.parent.levels.${parentChildId}`;
      const child = T.store.getChild(parentChildId);
      if (child && Array.isArray(session && session.levelChanges) && session.levelChanges.length) {
        sessionStorage.setItem(storageKey, JSON.stringify({
          steps: child.steps || {},
          levels: child.levels || {},
        }));
        return;
      }
      const savedLevels = sessionStorage.getItem(storageKey);
      if (savedLevels === null) return;
      const approved = JSON.parse(savedLevels);
      if (child && approved && typeof approved === 'object' && !Array.isArray(approved)) {
        if (approved.steps || approved.levels) {
          child.steps = { ...(approved.steps || {}) };
          child.levels = { ...(approved.levels || {}) };
        } else {
          child.steps = {};
          child.levels = { ...approved };
        }
        T.store.save();
      }
    } catch (error) {
      setStatus('לא ניתן לשחזר את השלבים שאושרו. חזרו למסך ההורים והתחברו שוב.', true);
    }
  }

  async function pushSession(session) {
    if (session.cloudSessionId || session.demo || session.sample || session.aborted || session.mode === 'sim' || session.mode === 'sample') return;
    const token = tokenForMode();
    if (!token) return;
    const childId = parentMode ? parentChildId : session.childId;
    const remotePatient = parentMode ? null : staffPatients.find((patient) => patient.linked_game_child_id === childId);
    if (!parentMode && !remotePatient) return;
    const payload = safeSessionPayload(session);
    const uploaded = T.store.settings.cloudUploadedSessions || (T.store.settings.cloudUploadedSessions = {});
    if (uploaded[session.id]) return;
    const path = parentMode
      ? `/v1/game/children/${encodeURIComponent(childId)}/sessions`
      : `/v1/game/patients/${encodeURIComponent(remotePatient.patient_id)}/sessions`;
    const response = await apiRequest(path, token, { method: 'POST', body: JSON.stringify(payload) });
    session.cloudSessionId = response.session_id;
    uploaded[session.id] = true;
    T.store.save();
  }

  async function sessionAdded(session) {
    try {
      await pushSession(session);
      if (parentMode) resetParentLevels(session);
    } catch (error) {
      setStatus(error.message || 'סנכרון המפגש נכשל. הנתונים נשמרו בדפדפן וינוסו שוב.', true);
      if (parentMode) resetParentLevels(session);
    }
  }

  async function flushLocalSessions() {
    const token = tokenForMode();
    if (!token) return;
    if (parentMode) {
      const child = T.store.getChild(parentChildId);
      if (!child) return;
      const sessions = T.store.sessionsOf(child.id);
      for (const session of sessions) await pushSession(session);
      resetParentLevels();
      return;
    }
    staffPatients = await apiRequest('/v1/game/patients', token);
    for (const remote of staffPatients) {
      if (remote.linked_game_child_id && remote.profile && !T.store.getChild(remote.linked_game_child_id)) {
        T.store.addChild({
          ...remote.profile,
          id: remote.linked_game_child_id,
          name: remote.display_name || remote.profile.display_name || '',
        });
      }
    }
    for (const child of T.store.data.children) {
      const remote = staffPatients.find((patient) => patient.linked_game_child_id === child.id);
      if (!remote) continue;
      if (remote.profile) {
        Object.assign(child, remote.profile);
        if (remote.display_name) child.name = remote.display_name;
        T.store.save();
      }
      for (const session of T.store.sessionsOf(child.id)) await pushSession(session);
      await downloadApprovedSessions(remote, child);
    }
  }

  async function downloadApprovedSessions(remote, child) {
    const sessions = await apiRequest(`/v1/game/patients/${encodeURIComponent(remote.patient_id)}/sessions?pending_only=false`, tokenForMode());
    for (const session of sessions.filter((item) => item.review_status === 'approved')) {
      const payload = session.payload;
      const stageResults = Object.fromEntries((payload.stages || []).map((stage) => [stage.key, {
        score: stage.score,
        skipped: stage.skipped,
        ...(stage.level ? { level: stage.level } : {}),
        ...(stage.confidence !== null && stage.confidence !== undefined ? { confidence: stage.confidence } : {}),
      }]));
      const assists = (payload.stages || []).filter((stage) => stage.physical_assist).map((stage) => ({ stage: stage.key, type: 'physical' }));
      T.store.mergeSyncedSession({
        id: `cloud-${session.session_id}`,
        cloudSessionId: session.session_id,
        childId: child.id,
        date: new Date(session.played_at).getTime(),
        durationSec: session.duration_seconds,
        mode: 'mic',
        stages: stageResults,
        assists,
        levelChanges: Object.entries(payload.level_changes || {}).map(([task, to]) => ({ task, to })),
      });
    }
  }

  async function loadGoogleIdentity() {
    if (!clientReady()) {
      setStatus('כדי להפעיל סנכרון, צריך להגדיר Firebase Auth וכתובת API בקובץ js/cloud-config.js.', true);
      return;
    }
    try {
      staffToken = await window.TOMBI_AUTH.signInWithGoogle();
      sessionStorage.setItem('tombi.staff.token', staffToken);
      signedInEmail = await window.TOMBI_AUTH.getEmail();
      staffPatients = await apiRequest('/v1/game/patients', staffToken);
      setStatus(`התחברת${signedInEmail ? ` כ־${signedInEmail}` : ''}. נמצאו ${staffPatients.length} ילדים מורשים.`);
      renderStaffPanel();
      await flushLocalSessions();
    } catch (error) {
      staffToken = '';
      sessionStorage.removeItem('tombi.staff.token');
      setStatus(error.message || 'ההתחברות או טעינת הילדים נכשלה.', true);
      renderStaffPanel();
    }
  }

  function renderStaffPanel() {
    if (parentMode) return;
    const panel = document.getElementById('cloud-sync-panel');
    if (!panel) return;
    if (!clientReady()) {
      panel.innerHTML = `<h2 id="cloud-sync-title">סנכרון מאובטח</h2>
        <p>סנכרון לענן אינו מוגדר עדיין. הנתונים נשארים בדפדפן הזה עד להגדרת Firebase Auth ושירות ה-API המאובטח.</p>
        <p id="cloud-sync-status" class="cloud-sync-status is-error">${escapeHtml(statusMessage || 'הגדירו Firebase ואת כתובת שירות המשחק לפני הפעלה.')}</p>`;
      return;
    }
    const token = tokenForMode();
    const children = T.store.data.children;
    const childOptions = children.map((child) =>
      `<option value="${escapeHtml(child.id)}">${escapeHtml(child.name || 'ילד/ה ללא שם')}</option>`).join('');
    const patientOptions = staffPatients.map((patient) =>
      `<option value="${escapeHtml(patient.patient_id)}" data-code="${escapeHtml(patient.patient_code)}">${escapeHtml(patient.display_name || `תיק ${patient.patient_code}`)}${patient.linked_game_child_id ? ' · מקושר' : ''}</option>`).join('');
    panel.innerHTML = `<h2 id="cloud-sync-title">סנכרון מאובטח</h2>
      <p>התחברות נעשית עם Google/Firebase, וכתובת הדוא״ל משמשת לאימות והרשאות. בסנכרון מועברים מזהה פרופיל/תיק, מועד ומשך מפגש, ציונים ונתוני משימות (כולל רמת ביטחון, סיוע פיזי ושינויי רמה). לא נשלחים הקלטות, טביעות קול, תוכניות טיפול או הערות.</p>
      <p>מחיקה מההגדרות מסירה את העותק המקומי בלבד. כדי למחוק מידע שכבר סונכרן, יש לפנות למנהל/ת המערכת שסיפקה את הגישה.</p>
      <p id="cloud-sync-status" class="cloud-sync-status${statusError ? ' is-error' : ''}" aria-live="polite">${escapeHtml(statusMessage || (token ? 'מחובר/ת לחשבון צוות.' : 'צריך להתחבר לחשבון צוות כדי להמשיך.'))}</p>
      <div class="cloud-sync-actions">
        <button class="btn btn-ghost" id="cloud-sync-login" type="button">${token ? 'התחברות מחדש / החלפת חשבון' : 'התחברות Google לצוות'}</button>
        ${token ? '<button class="btn btn-ghost" id="cloud-sync-logout" type="button">יציאה מסנכרון</button><button class="btn btn-ghost" id="cloud-sync-refresh" type="button">רענון נתונים</button>' : ''}
      </div>
      ${token ? `<div class="cloud-sync-grid">
        <label>פרופיל משחק מקומי
          <select id="cloud-sync-child">${childOptions || '<option value="">אין פרופילי משחק</option>'}</select>
        </label>
        <label>תיק ילד/ה ב-Ocupa
          <select id="cloud-sync-patient">${patientOptions || '<option value="">אין תיקים מורשים</option>'}</select>
        </label>
        <button class="btn" id="cloud-sync-link" type="button">קישור ידני בין הפרופילים</button>
      </div>
      <div class="cloud-sync-grid">
        <label>כתובת דוא״ל להזמנה
          <input id="cloud-sync-email" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com">
        </label>
        <label>סוג גישה
          <select id="cloud-sync-invite-type"><option value="guardian">אפוטרופוס</option><option value="staff">איש/אשת צוות</option></select>
        </label>
        <button class="btn btn-ghost" id="cloud-sync-invite" type="button">יצירת קישור הזמנה</button>
      </div>
      <label class="cloud-sync-share" id="cloud-sync-share-label" hidden>קישור חד־פעמי, בתוקף לשבעה ימים
        <input id="cloud-sync-share-link" readonly>
        <button class="btn btn-ghost" id="cloud-sync-copy" type="button">העתקה</button>
      </label>
      <section class="cloud-sync-review">
        <h3>מפגשי בית שממתינים לבדיקה</h3>
        <div id="cloud-sync-reviews"><p>בחרו תיק כדי לטעון מפגשים.</p></div>
      </section>
      <section class="cloud-sync-review">
        <h3>האפוטרופוסים המקושרים</h3>
        <div id="cloud-sync-guardians"><p>בחרו תיק כדי לטעון קישורים.</p></div>
      </section>
      <section class="cloud-sync-review">
        <h3>אנשי צוות מורשים</h3>
        <div id="cloud-sync-staff"><p>בחרו תיק כדי לטעון הרשאות.</p></div>
      </section>
      <section class="cloud-sync-review">
        <h3>הזמנות פעילות</h3>
        <div id="cloud-sync-invitations"><p>בחרו תיק כדי לטעון הזמנות.</p></div>
      </section>` : ''}`;

    panel.querySelector('#cloud-sync-login')?.addEventListener('click', loadGoogleIdentity);
    panel.querySelector('#cloud-sync-logout')?.addEventListener('click', async () => {
      try {
        await window.TOMBI_AUTH.signOut();
      } catch (error) {
        setStatus(error.message || 'היציאה מהחשבון נכשלה.', true);
        return;
      }
      staffToken = '';
      signedInEmail = '';
      staffPatients = [];
      sessionStorage.removeItem('tombi.staff.token');
      setStatus('יצאת מחשבון הסנכרון.');
      renderStaffPanel();
    });
    panel.querySelector('#cloud-sync-refresh')?.addEventListener('click', async () => {
      try {
        await flushLocalSessions();
        await loadPatientDetails();
        setStatus('הנתונים עודכנו.');
      } catch (error) { setStatus(error.message, true); }
    });
    panel.querySelector('#cloud-sync-patient')?.addEventListener('change', () => void loadPatientDetails());
    panel.querySelector('#cloud-sync-link')?.addEventListener('click', linkSelectedChild);
    panel.querySelector('#cloud-sync-invite')?.addEventListener('click', createInvitation);
    panel.querySelector('#cloud-sync-copy')?.addEventListener('click', async () => {
      const input = panel.querySelector('#cloud-sync-share-link');
      try {
        await navigator.clipboard.writeText(input.value);
        setStatus('קישור ההזמנה הועתק.');
      } catch (error) { setStatus('לא ניתן להעתיק אוטומטית. סמנו והעתיקו את הקישור.', true); }
    });
    if (token && staffPatients.length) void loadPatientDetails();
  }

  async function linkSelectedChild() {
    const panel = document.getElementById('cloud-sync-panel');
    const child = T.store.getChild(panel.querySelector('#cloud-sync-child')?.value);
    const patientId = panel.querySelector('#cloud-sync-patient')?.value;
    if (!child || !patientId) {
      setStatus('בחרו פרופיל משחק ותיק ילד/ה.', true);
      return;
    }
    const profile = {
      display_name: child.name || '',
      age: Number(child.age),
      gender: child.gender === 'f' ? 'f' : 'm',
      nonverbal: Boolean(child.nonverbal),
      canJump: child.canJump !== false,
      canStand: child.canStand !== false,
      soundSensitive: Boolean(child.soundSensitive),
      excludedTasks: Array.isArray(child.excludedTasks) ? child.excludedTasks : [],
      pinnedTasks: Array.isArray(child.pinnedTasks) ? child.pinnedTasks : [],
      steps: child.steps || {},
      levels: child.levels || {},
      levelLock: child.levelLock || {},
    };
    try {
      await apiRequest(`/v1/game/patients/${encodeURIComponent(patientId)}/profile`, tokenForMode(), {
        method: 'PUT',
        body: JSON.stringify({ game_child_id: child.id, profile }),
      });
      await flushLocalSessions();
      await loadPatientDetails();
      setStatus(`הפרופיל "${child.name}" קושר לתיק. אפשר ליצור קישור להורה או לצוות.`);
    } catch (error) { setStatus(error.message || 'קישור הפרופילים נכשל.', true); }
  }

  async function createInvitation() {
    const panel = document.getElementById('cloud-sync-panel');
    const patientId = panel.querySelector('#cloud-sync-patient')?.value;
    const email = panel.querySelector('#cloud-sync-email')?.value.trim();
    const invitationType = panel.querySelector('#cloud-sync-invite-type')?.value;
    if (!patientId || !email) {
      setStatus('בחרו תיק והזינו את כתובת הדוא״ל של המוזמן/ת.', true);
      return;
    }
    try {
      const invite = await apiRequest(`/v1/game/patients/${encodeURIComponent(patientId)}/invitations`, tokenForMode(), {
        method: 'POST',
        body: JSON.stringify({ email, invitation_type: invitationType }),
      });
      const link = new URL('parent.html', window.location.href);
      link.searchParams.set('invite', invite.code);
      const share = panel.querySelector('#cloud-sync-share-label');
      share.hidden = false;
      panel.querySelector('#cloud-sync-share-link').value = link.href;
      setStatus('הקישור נוצר. שלחו אותו רק לכתובת הדוא״ל שהוזמנה; הוא חד־פעמי ופג בעוד שבעה ימים.');
    } catch (error) { setStatus(error.message || 'יצירת הקישור נכשלה.', true); }
  }

  async function loadPatientDetails() {
    const panel = document.getElementById('cloud-sync-panel');
    const patientId = panel && panel.querySelector('#cloud-sync-patient')?.value;
    if (!patientId || !tokenForMode()) return;
    const reviews = panel.querySelector('#cloud-sync-reviews');
    const guardians = panel.querySelector('#cloud-sync-guardians');
    const staff = panel.querySelector('#cloud-sync-staff');
    const invitations = panel.querySelector('#cloud-sync-invitations');
    try {
      const [sessions, guardianLinks, staffLinks, activeInvitations] = await Promise.all([
        apiRequest(`/v1/game/patients/${encodeURIComponent(patientId)}/sessions`, tokenForMode()),
        apiRequest(`/v1/game/patients/${encodeURIComponent(patientId)}/guardians`, tokenForMode()),
        apiRequest(`/v1/game/patients/${encodeURIComponent(patientId)}/staff`, tokenForMode()),
        apiRequest(`/v1/game/patients/${encodeURIComponent(patientId)}/invitations`, tokenForMode()),
      ]);
      reviews.innerHTML = sessions.length ? sessions.map((session) => {
        const levelChanges = session.payload.level_changes || {};
        const levelControls = Object.entries(levelChanges).map(([key, level]) =>
          `<label class="cloud-sync-level"><input type="checkbox" data-level-key="${escapeHtml(key)}" data-level-value="${Number(level)}"> לאשר ${escapeHtml(key)} לשלב ${Number(level)}</label>`).join('');
        const stages = (session.payload.stages || []).map((stage) =>
          `${escapeHtml(stage.key)}: ${stage.skipped ? 'דולג' : stage.score === null ? '—' : `${Number(stage.score)}/100`}`).join(' · ');
        return `<article class="cloud-sync-card"><b>${new Date(session.played_at).toLocaleString('he-IL')} · ציון ${session.payload.score ?? '—'}</b>
          <p>משך ${Math.round(session.duration_seconds / 60)} דקות · ${stages}</p>${levelControls}
          <div class="cloud-sync-actions"><button class="btn btn-small" data-review="approved" data-session="${escapeHtml(session.session_id)}">אישור</button>
          <button class="btn btn-small btn-danger-ghost" data-review="rejected" data-session="${escapeHtml(session.session_id)}">דחייה</button></div></article>`;
      }).join('') : '<p>אין מפגשים שממתינים לבדיקה.</p>';
      guardians.innerHTML = guardianLinks.length ? guardianLinks.map((link) =>
        `<div class="cloud-sync-card"><span>${escapeHtml(link.email)} · ${new Date(link.linked_at).toLocaleDateString('he-IL')}</span>
        <button class="btn btn-small btn-danger-ghost" data-revoke-guardian="${escapeHtml(link.link_id)}">ביטול קישור</button></div>`).join('') : '<p>אין אפוטרופוסים מקושרים.</p>';
      staff.innerHTML = staffLinks.length ? staffLinks.map((link) =>
        `<div class="cloud-sync-card"><span>${escapeHtml(link.email)} · ${new Date(link.granted_at).toLocaleDateString('he-IL')}</span>
        <button class="btn btn-small btn-danger-ghost" data-revoke-staff="${escapeHtml(link.access_id)}">ביטול הרשאה</button></div>`).join('') : '<p>אין אנשי צוות נוספים עם הרשאה.</p>';
      invitations.innerHTML = activeInvitations.length ? activeInvitations.map((invite) =>
        `<div class="cloud-sync-card"><span>${escapeHtml(invite.email)} · ${invite.invitation_type === 'guardian' ? 'אפוטרופוס' : 'צוות'} · עד ${new Date(invite.expires_at).toLocaleDateString('he-IL')}</span>
        <button class="btn btn-small btn-danger-ghost" data-revoke-invitation="${escapeHtml(invite.invitation_id)}">ביטול הזמנה</button></div>`).join('') : '<p>אין הזמנות פעילות.</p>';
      reviews.querySelectorAll('[data-review]').forEach((button) => button.addEventListener('click', () => void reviewSession(patientId, button)));
      guardians.querySelectorAll('[data-revoke-guardian]').forEach((button) => button.addEventListener('click', () => void revokeLink(patientId, button.dataset.revokeGuardian, 'guardian')));
      staff.querySelectorAll('[data-revoke-staff]').forEach((button) => button.addEventListener('click', () => void revokeLink(patientId, button.dataset.revokeStaff, 'staff')));
      invitations.querySelectorAll('[data-revoke-invitation]').forEach((button) => button.addEventListener('click', () => void revokeInvitation(patientId, button.dataset.revokeInvitation)));
    } catch (error) {
      setStatus(error.message || 'טעינת מפגשים והרשאות נכשלה.', true);
      reviews.innerHTML = guardians.innerHTML = staff.innerHTML = invitations.innerHTML = '<p>לא ניתן לטעון את הנתונים.</p>';
    }
  }

  async function reviewSession(patientId, button) {
    const card = button.closest('.cloud-sync-card');
    const approved = {};
    if (button.dataset.review === 'approved') {
      card.querySelectorAll('[data-level-key]:checked').forEach((checkbox) => {
        approved[checkbox.dataset.levelKey] = Number(checkbox.dataset.levelValue);
      });
    }
    try {
      await apiRequest(`/v1/game/patients/${encodeURIComponent(patientId)}/sessions/${encodeURIComponent(button.dataset.session)}/review`, tokenForMode(), {
        method: 'POST',
        body: JSON.stringify({ decision: button.dataset.review, approved_level_changes: approved }),
      });
      await loadPatientDetails();
      setStatus(button.dataset.review === 'approved' ? 'המפגש אושר.' : 'המפגש נדחה.');
    } catch (error) { setStatus(error.message || 'בדיקת המפגש נכשלה.', true); }
  }

  async function revokeLink(patientId, linkId, kind) {
    try {
      await apiRequest(`/v1/game/patients/${encodeURIComponent(patientId)}/${kind === 'guardian' ? 'guardians' : 'staff'}/${encodeURIComponent(linkId)}/revoke`, tokenForMode(), { method: 'POST' });
      await loadPatientDetails();
      setStatus(kind === 'guardian' ? 'קישור האפוטרופוס בוטל.' : 'הרשאת איש/אשת הצוות בוטלה.');
    } catch (error) { setStatus(error.message || 'ביטול ההרשאה נכשל.', true); }
  }

  async function revokeInvitation(patientId, invitationId) {
    try {
      await apiRequest(`/v1/game/patients/${encodeURIComponent(patientId)}/invitations/${encodeURIComponent(invitationId)}/revoke`, tokenForMode(), { method: 'POST' });
      await loadPatientDetails();
      setStatus('ההזמנה בוטלה.');
    } catch (error) { setStatus(error.message || 'ביטול ההזמנה נכשל.', true); }
  }

  async function start() {
    if (parentMode) {
      staffToken = '';
      if (!clientReady()) return;
      try {
        const token = await window.TOMBI_AUTH.getIdToken();
        if (!token) {
          sessionStorage.removeItem('tombi.parent.token');
          throw new Error('צריך להתחבר מחדש דרך מסך ההורים כדי לסנכרן.');
        }
        sessionStorage.setItem('tombi.parent.token', token);
        await flushLocalSessions();
      } catch (error) {
        setStatus(error.message || 'המפגש נשמר במכשיר אך טרם הסתנכרן.', true);
      }
      return;
    }
    if (!clientReady()) {
      renderStaffPanel();
      return;
    }
    try {
      staffToken = await window.TOMBI_AUTH.getIdToken();
      if (!staffToken) {
        sessionStorage.removeItem('tombi.staff.token');
        renderStaffPanel();
        return;
      }
      sessionStorage.setItem('tombi.staff.token', staffToken);
      signedInEmail = await window.TOMBI_AUTH.getEmail();
      staffPatients = await apiRequest('/v1/game/patients', staffToken);
      renderStaffPanel();
      await flushLocalSessions();
    } catch (error) {
      staffToken = '';
      staffPatients = [];
      sessionStorage.removeItem('tombi.staff.token');
      setStatus(error.message || 'לא ניתן לשחזר את החיבור או לסנכרן מפגשים.', true);
      renderStaffPanel();
    }
  }

  window.addEventListener('online', () => {
    void flushLocalSessions().then(() => {
      if (parentMode) setStatus('החיבור חזר והמפגשים הסתנכרנו.');
    }).catch((error) => setStatus(error.message || 'הסנכרון נכשל לאחר חזרת החיבור.', true));
  });

  return { start, renderStaffPanel, sessionAdded };
})();
