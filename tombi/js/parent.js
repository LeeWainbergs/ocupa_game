(() => {
  const config = window.TOMBI_SYNC_CONFIG || {};
  const apiBase = String(config.apiBaseUrl || '').replace(/\/+$/, '');
  const firebaseConfig = config.firebaseConfig || {};
  const clientConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
  const inviteCode = new URLSearchParams(window.location.search).get('invite') || '';
  const previewMode = new URLSearchParams(window.location.search).get('preview') === '1';
  const message = document.getElementById('parent-message');
  const login = document.getElementById('parent-login');
  const children = document.getElementById('parent-children');
  const logout = document.getElementById('parent-logout');
  const previewBadge = document.getElementById('parent-preview-badge');
  let authToken = sessionStorage.getItem('tombi.parent.token') || '';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const setMessage = (text, error = false) => {
    message.textContent = text;
    message.classList.toggle('is-error', error);
  };

  async function request(path, init = {}) {
    if (!apiBase) throw new Error('החיבור לענן עדיין לא הוגדר. פנו לצוות.');
    const freshToken = window.TOMBI_AUTH ? await window.TOMBI_AUTH.getIdToken() : '';
    authToken = freshToken || authToken;
    if (!authToken) throw new Error('צריך להתחבר לחשבון כדי להמשיך.');
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      let detail = await response.text();
      try { detail = JSON.parse(detail).detail || detail; } catch (error) { /* Show the server's message. */ }
      throw new Error(`הפעולה נכשלה (${response.status}): ${detail}`);
    }
    return response.status === 204 ? null : response.json();
  }

  function saveParentProfile(child, approvedSessions) {
    const profile = child.profile || {};
    const gameChild = {
      id: child.game_child_id,
      name: profile.display_name || 'הילד/ה',
      age: profile.age,
      gender: profile.gender,
      nonverbal: Boolean(profile.nonverbal),
      canJump: profile.canJump !== false,
      canStand: profile.canStand !== false,
      soundSensitive: Boolean(profile.soundSensitive),
      excludedTasks: profile.excludedTasks || [],
      pinnedTasks: profile.pinnedTasks || [],
      levels: profile.levels || {},
      levelLock: profile.levelLock || {},
      templates: {},
      soundCentroids: {},
      createdAt: Date.now(),
    };
    const sessions = approvedSessions.map((session) => {
      const payload = session.payload || {};
      const stages = Object.fromEntries((payload.stages || []).map((stage) => [stage.key, {
        score: stage.score,
        skipped: Boolean(stage.skipped),
        ...(stage.level ? { level: stage.level } : {}),
        ...(stage.confidence !== null && stage.confidence !== undefined ? { confidence: stage.confidence } : {}),
      }]));
      const assists = (payload.stages || []).filter((stage) => stage.physical_assist).map((stage) => ({ stage: stage.key, type: 'physical' }));
      return {
        id: `cloud-${session.session_id}`,
        cloudSessionId: session.session_id,
        childId: child.game_child_id,
        date: new Date(session.played_at).getTime(),
        durationSec: session.duration_seconds,
        mode: 'mic',
        stages,
        assists,
        levelChanges: Object.entries(payload.level_changes || {}).map(([task, to]) => ({ task, to })),
      };
    });
    const storeKey = `tombi.parent.v1.${encodeURIComponent(child.game_child_id)}`;
    let old = { children: [], sessions: [], settings: {} };
    try { old = JSON.parse(localStorage.getItem(storeKey) || 'null') || old; } catch (error) { /* Replace unreadable local cache with a clean child-only cache. */ }
    old.children = [gameChild];
    old.sessions = [...old.sessions.filter((session) => !session.cloudSessionId), ...sessions];
    old.settings = old.settings || {};
    localStorage.setItem(storeKey, JSON.stringify(old));
    sessionStorage.setItem(`tombi.parent.levels.${child.game_child_id}`, JSON.stringify(gameChild.levels));
  }

  function launchPreviewGame() {
    const childId = 'demo-parent-preview';
    const child = {
      id: childId, name: 'תמר (דוגמה)', age: 5, gender: 'f', nonverbal: false,
      canJump: true, canStand: true, soundSensitive: false, excludedTasks: [], pinnedTasks: [],
      levels: {}, levelLock: {}, goals: [], templates: {}, soundCentroids: {}, createdAt: Date.now(),
      demo: true, sample: true,
    };
    const key = `tombi.parent.v1.${encodeURIComponent(childId)}`;
    try {
      localStorage.setItem(key, JSON.stringify({ children: [child], sessions: [], settings: {} }));
      window.location.href = `index.html?parent=${encodeURIComponent(childId)}`;
    } catch (error) {
      setMessage('לא ניתן לשמור את פרופיל ההדגמה בדפדפן הזה.', true);
    }
  }

  function showPreview() {
    previewBadge.hidden = false;
    login.hidden = true;
    children.hidden = false;
    children.innerHTML = `
      <div class="parent-preview-notice" role="note">
        <b>סביבת תצוגה</b>
        <span>השם, ההתקדמות והדוחות בעמוד הזה הם דוגמאות בלבד. לא מוצגים כאן נתונים של ילד/ה אמיתי/ת.</span>
      </div>
      <article class="parent-child-card parent-game-card">
        <p class="parent-card-kicker">משחק בבית</p>
        <h2>תמר (דוגמה)</h2>
        <p>משחקים עם טומבי בקצב נעים. אפשר לעצור בכל רגע.</p>
        <button class="parent-button" data-preview-play type="button">למשחק הדגמה עם טומבי</button>
      </article>
      <section class="parent-weekly-reports" aria-labelledby="parent-reports-title">
        <div class="parent-reports-heading">
          <div><p class="parent-card-kicker">מהגן, פעם בשבוע</p><h2 id="parent-reports-title">הדוחות השבועיים</h2></div>
          <span class="parent-report-count">2 דוחות לדוגמה</span>
        </div>
        <p class="parent-reports-intro">לאחר שהגן יבדוק ויפרסם דוח, הוא יופיע כאן. לפי ההגדרה שנבחרה, תישלח להורה הודעת דוא״ל עם קישור לדוח.</p>
        <div class="parent-report-list">
          <article class="parent-report-card">
            <div class="parent-report-meta"><span>12–16 באוקטובר 2026</span><span>פורסם · דוגמה</span></div>
            <h3>השבוע של תמר</h3>
            <p>השבוע תרגלנו חיקוי קצב, עצירה והמתנה. תמר השתתפה בשני מפגשים, ובחרה כמה פעמים בנשימת דרקון להפסקה.</p>
            <details><summary>פתיחת הדוח</summary><p>במפגשים תרגלנו הקשבה לתבנית קצרה וחיקוי שלה, מעבר בין תנועה לעצירה, והמתנה לתור. נמשיך להציע הוראות קצרות, בחירה בין שתי אפשרויות והפסקה לפי הצורך.</p><p class="parent-report-note">הדגמת תצוגה בלבד — אין כאן נתוני מדידה של ילד/ה אמיתי/ת.</p></details>
          </article>
          <article class="parent-report-card">
            <div class="parent-report-meta"><span>5–9 באוקטובר 2026</span><span>פורסם · דוגמה</span></div>
            <h3>השבוע של תמר</h3>
            <p>הכרנו את שגרת טומבי ואת האפשרות לבחור איך מרגישים בתחילת המפגש ובסופו.</p>
            <details><summary>פתיחת הדוח</summary><p>נבנתה היכרות עם מבנה קבוע וצפוי: פתיחה, משחקים קצרים, וסיום רגוע. הדוח השבועי נועד לשיתוף ותיאום עם המשפחה, ואינו אבחוני.</p><p class="parent-report-note">הדגמת תצוגה בלבד — אין כאן נתוני מדידה של ילד/ה אמיתי/ת.</p></details>
          </article>
        </div>
      </section>
      <p class="parent-preview-email">דוחות אמיתיים יישלחו רק אחרי אישור צוות. הודעת הדוא״ל תכלול קישור מאובטח; תוכן הדוח יוצג בפורטל.</p>`;
    children.querySelector('[data-preview-play]').addEventListener('click', launchPreviewGame);
    setMessage('אפשר לראות כאן איך ייראה המרחב המשפחתי לאחר התחברות.');
  }

  async function showChildren() {
    children.hidden = false;
    logout.hidden = false;
    const linkedChildren = await request('/v1/game/children');
    if (!linkedChildren.length) {
      children.innerHTML = '<p>עדיין אין ילד/ה מקושר/ת לחשבון הזה. בקשו מהצוות לשלוח הזמנה.</p>';
      setMessage('התחברת בהצלחה, אך אין קישור פעיל לחשבון הזה.');
      return;
    }
    const withSessions = await Promise.all(linkedChildren.map(async (child) => {
      const sessions = await request(`/v1/game/children/${encodeURIComponent(child.game_child_id)}/sessions`);
      return { ...child, sessions };
    }));
    children.innerHTML = withSessions.map((child) => {
      const approvedSessions = child.sessions.filter((session) => session.review_status === 'approved');
      saveParentProfile(child, approvedSessions);
      const rows = child.sessions.slice(0, 5).map((session) =>
        `<li><span>${new Date(session.played_at).toLocaleDateString('he-IL')}</span>
        <span>${session.review_status === 'approved' ? 'נבדק ואושר' : session.review_status === 'rejected' ? 'נבדק על ידי הצוות' : 'ממתין לבדיקה'}</span>
        <b>${session.payload.score ?? '—'}</b></li>`).join('');
      return `<article class="parent-child-card">
        <h2>משחקים עם ${escapeHtml(child.display_name || 'טומבי')}</h2>
        <p>${approvedSessions.length} מפגשים שאושרו על ידי הצוות</p>
        <button class="parent-button" data-play="${escapeHtml(child.game_child_id)}" type="button">מתחילים לשחק</button>
        <section class="parent-weekly-reports" aria-label="דוחות שבועיים מהגן">
          <h3>דוחות שבועיים מהגן</h3>
          <p>תיבת הדוחות השבועיים עדיין לא חוברה לשירות הפרסום של הגן. כאן יופיעו דוחות שהצוות בדק ופרסם.</p>
        </section>
        <h3>מפגשים אחרונים</h3>
        ${rows ? `<ul>${rows}</ul>` : '<p>עדיין אין מפגשים.</p>'}
      </article>`;
    }).join('');
    children.querySelectorAll('[data-play]').forEach((button) => {
      button.addEventListener('click', () => {
        const childId = button.dataset.play;
        window.location.href = `index.html?parent=${encodeURIComponent(childId)}`;
      });
    });
    setMessage('התחברת בהצלחה. ההתקדמות תופיע לצוות לאחר סנכרון ובדיקה.');
  }

  async function handleToken(token) {
    authToken = token;
    sessionStorage.setItem('tombi.parent.token', token);
    login.disabled = true;
    try {
      if (inviteCode) {
        const accepted = await request('/v1/game/invitations/accept', {
          method: 'POST',
          body: JSON.stringify({ code: inviteCode }),
        });
        const url = new URL(window.location.href);
        url.searchParams.delete('invite');
        window.history.replaceState({}, '', url);
        if (accepted.invitation_type === 'staff') {
          sessionStorage.setItem('tombi.staff.token', token);
          setMessage('הזמנת איש/אשת צוות אושרה. אפשר לחזור למשחק ולהתחבר במסך הסנכרון.');
          login.textContent = 'מעבר למשחק';
          login.disabled = false;
          login.onclick = () => { window.location.href = 'index.html'; };
          return;
        }
      }
      await showChildren();
    } catch (error) {
      setMessage(error.message || 'ההתחברות נכשלה. בדקו שהוזמנתם לכתובת Google הזו ונסו שוב.', true);
    } finally {
      login.disabled = false;
    }
  }

  async function signIn() {
    if (!apiBase || !clientConfigured) {
      setMessage('החיבור לענן עדיין לא הוגדר. פנו לצוות.', true);
      return;
    }
    login.disabled = true;
    try {
      await handleToken(await window.TOMBI_AUTH.signInWithGoogle());
    } catch (error) {
      setMessage(error.message || 'ההתחברות נכשלה. נסו שוב.', true);
    } finally {
      login.disabled = false;
    }
  }

  login.addEventListener('click', signIn);
  logout.addEventListener('click', async () => {
    try {
      await window.TOMBI_AUTH.signOut();
    } catch (error) {
      setMessage(error.message || 'היציאה מהחשבון נכשלה.', true);
      return;
    }
    sessionStorage.removeItem('tombi.parent.token');
    authToken = '';
    children.innerHTML = '';
    children.hidden = true;
    logout.hidden = true;
    setMessage('יצאת מהחשבון.');
  });
  if (previewMode) showPreview();
  else if (!apiBase || !clientConfigured) setMessage('החיבור לענן עדיין לא הוגדר. פנו לצוות.', true);
  else void window.TOMBI_AUTH.getIdToken()
    .then((token) => {
      if (!token) return;
      authToken = token;
      sessionStorage.setItem('tombi.parent.token', token);
      return inviteCode ? handleToken(token) : showChildren();
    })
    .catch((error) => setMessage(error.message, true));
})();
