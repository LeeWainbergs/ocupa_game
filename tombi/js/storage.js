/* storage.js — ילדים, מפגשים והגדרות. נשמר רק בדפדפן הזה (localStorage).
   לא נשמר אודיו גולמי, אלא נתוני מפגש ומאפייני קול מספריים. */
T.store = (() => {
  const parentChildId = new URLSearchParams(window.location.search).get('parent');
  const KEY = parentChildId ? `tombi.parent.v1.${encodeURIComponent(parentChildId)}` : 'tombi.v1';
  const DELETED_KEY = parentChildId ? `tombi.parent.deleted.${encodeURIComponent(parentChildId)}` : '';
  let data = { children: [], sessions: [], settings: {} };
  let memoryOnly = false;

  function load() {
    try {
      if (DELETED_KEY && localStorage.getItem(DELETED_KEY)) {
        data = { children: [], sessions: [], settings: {} };
        return data;
      }
      const raw = localStorage.getItem(KEY);
      if (raw) data = Object.assign({ children: [], sessions: [], settings: {} }, JSON.parse(raw));
    } catch (e) { memoryOnly = true; }
    return data;
  }
  function save() {
    try {
      if (DELETED_KEY && localStorage.getItem(DELETED_KEY)) {
        data = { children: [], sessions: [], settings: {} };
        localStorage.removeItem(KEY);
        return;
      }
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { memoryOnly = true; }
  }
  function clear() {
    localStorage.removeItem(KEY);
    data = { children: [], sessions: [], settings: {} };
    memoryOnly = false;
  }
  function markDeleted() {
    if (!DELETED_KEY) throw new Error('A child-specific profile is required to mark game data as deleted');
    localStorage.setItem(DELETED_KEY, '1');
    clear();
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function addChild(c) {
    const child = Object.assign({
      id: uid(), name: '', age: 5, gender: 'm', nonverbal: false, templates: {}, soundCentroids: {}, createdAt: Date.now(),
      canJump: true, canStand: true, soundSensitive: false, excludedTasks: [], pinnedTasks: [],
      calmOpener: 'fire',
      story: { season: 1, chapter: 1, lit: [], scales: 0, bests: {}, favoriteChapter: null, repeatFavourite: false },
      steps: {},
      levels: { echo: 1, loudness: 1, magic: 1, snake: 1 },
      levelLock: { echo: false, loudness: false, magic: false, snake: false },
    }, c);
    data.children.push(child); save();
    return child;
  }
  function updateChild(id, patch) {
    const c = getChild(id);
    if (c) { Object.assign(c, patch); save(); }
    return c;
  }
  function removeChild(id) {
    data.children = data.children.filter((c) => c.id !== id);
    data.sessions = data.sessions.filter((s) => s.childId !== id);
    save();
  }
  const getChild = (id) => data.children.find((c) => c.id === id);
  const sessionsOf = (id) => data.sessions.filter((s) => s.childId === id).sort((a, b) => a.date - b.date);
  function addSession(s) {
    s.id = s.id || uid(); data.sessions.push(s); save();
    if (T.sync && typeof T.sync.sessionAdded === 'function') {
      queueMicrotask(() => T.sync.sessionAdded(s));
    }
    return s;
  }
  function mergeSyncedSession(s) {
    if (!s || !s.cloudSessionId || data.sessions.some((session) => session.cloudSessionId === s.cloudSessionId)) return;
    data.sessions.push(s);
    const uploaded = data.settings.cloudUploadedSessions || (data.settings.cloudUploadedSessions = {});
    uploaded[s.id] = true;
    save();
  }
  function removeSession(id) { data.sessions = data.sessions.filter((s) => s.id !== id); save(); }

  function setSoundCentroids(childId, centroids) {
    const child = getChild(childId);
    if (!child) throw new Error(`Unknown child: ${childId}`);
    if (!centroids || typeof centroids !== 'object' || Array.isArray(centroids)) {
      throw new TypeError('Sound centroids must be a class-to-numeric-vector object');
    }
    const numeric = {};
    Object.entries(centroids).forEach(([label, vector]) => {
      if (!Array.isArray(vector) || vector.length !== 6 || !vector.every((value) => Number.isFinite(value))) {
        throw new TypeError(`Invalid numeric centroid for sound class: ${label}`);
      }
      numeric[label] = vector.map(Number);
    });
    child.soundCentroids = numeric;
    save();
    return child.soundCentroids;
  }

  const exportJSON = () => JSON.stringify({ app: 'tombi', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 1);
  function importJSON(text, merge = true) {
    const inc = JSON.parse(text);
    if (!inc || !Array.isArray(inc.children) || !Array.isArray(inc.sessions)) throw new Error('הקובץ לא נראה כמו גיבוי של טומבי');
    if (!merge) data = { children: [], sessions: [], settings: data.settings };
    const haveC = new Set(data.children.map((c) => c.id));
    const haveS = new Set(data.sessions.map((s) => s.id));
    inc.children.forEach((c) => !haveC.has(c.id) && data.children.push(c));
    inc.sessions.forEach((s) => !haveS.has(s.id) && data.sessions.push(s));
    save();
  }

  return {
    load, save, clear, markDeleted, uid, addChild, updateChild, removeChild, getChild, sessionsOf, addSession, mergeSyncedSession, removeSession,
    setSoundCentroids, exportJSON, importJSON,
    get data() { return data; }, get settings() { return data.settings; }, get memoryOnly() { return memoryOnly; },
    get deleted() {
      try { return Boolean(DELETED_KEY && localStorage.getItem(DELETED_KEY)); }
      catch (e) { memoryOnly = true; return false; }
    },
    get deletedKey() { return DELETED_KEY; },
  };
})();
