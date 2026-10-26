const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const source = (name) => process.env.TOMBI_TEST_INDEX
  ? execFileSync('git', ['show', `:tombi/js/${name}`], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' })
  : fs.readFileSync(path.join(__dirname, '..', 'js', name), 'utf8');
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('auth never restores a signed-out user from the initial state', async () => {
  const user = { email: 'synthetic@example.com', getIdToken: async () => 'synthetic-token' };
  const auth = {
    currentUser: null,
    setPersistence: async () => {},
    onAuthStateChanged(callback) {
      queueMicrotask(() => { this.currentUser = user; callback(user); });
      return () => {};
    },
    async signOut() { this.currentUser = null; },
  };
  const authFactory = Object.assign(() => auth, { Auth: { Persistence: { LOCAL: 'local' } } });
  const window = {
    TOMBI_SYNC_CONFIG: { firebaseConfig: { apiKey: 'test', authDomain: 'test', projectId: 'test', appId: 'test' } },
    firebase: { apps: [{}], auth: authFactory },
  };
  vm.runInNewContext(source('cloud-auth.js'), { window, document: { readyState: 'complete' } });
  assert.equal(await window.TOMBI_AUTH.getIdToken(), 'synthetic-token');
  await window.TOMBI_AUTH.signOut();
  assert.equal(await window.TOMBI_AUTH.getIdToken(), '');
  assert.equal(await window.TOMBI_AUTH.getEmail(), '');
});

test('parent storage is isolated and notifies sync when a session is saved', async () => {
  const localStorage = storage();
  const sessions = [];
  const T = { sync: { sessionAdded: (session) => sessions.push(session) } };
  vm.runInNewContext(source('storage.js'), {
    T, URLSearchParams, window: { location: { search: '?parent=synthetic-child' } },
    localStorage, queueMicrotask,
  });
  T.store.load();
  const session = T.store.addSession({ childId: 'synthetic-child' });
  await Promise.resolve();
  assert.equal(sessions[0], session);
  assert.equal(localStorage.getItem('tombi.v1'), null);
  assert.ok(localStorage.getItem('tombi.parent.v1.synthetic-child'));
  T.store.mergeSyncedSession({ id: 'cloud-1', cloudSessionId: '1', childId: 'synthetic-child' });
  T.store.mergeSyncedSession({ id: 'cloud-1', cloudSessionId: '1', childId: 'synthetic-child' });
  assert.equal(T.store.sessionsOf('synthetic-child').length, 2);
  localStorage.setItem('tombi.v1', 'unrelated-profile');
  T.store.clear();
  assert.equal(localStorage.getItem('tombi.parent.v1.synthetic-child'), null);
  assert.equal(localStorage.getItem('tombi.v1'), 'unrelated-profile');
  assert.equal(T.store.data.sessions.length, 0);
});

test('deleted parent profiles cannot be restored by a stale game tab', () => {
  const localStorage = storage();
  const context = {
    T: {}, URLSearchParams, window: { location: { search: '?parent=synthetic-child' } }, localStorage, queueMicrotask,
  };
  vm.runInNewContext(source('storage.js'), context);
  context.T.store.load();
  context.T.store.addChild({ id: 'synthetic-child', name: 'Synthetic Child' });
  context.T.store.markDeleted();
  assert.equal(localStorage.getItem('tombi.parent.deleted.synthetic-child'), '1');
  assert.equal(localStorage.getItem('tombi.parent.v1.synthetic-child'), null);
  context.T.store.addChild({ id: 'synthetic-child', name: 'Stale Child' });
  assert.equal(localStorage.getItem('tombi.parent.v1.synthetic-child'), null);
  assert.equal(context.T.store.data.children.length, 0);
});

test('new staff device downloads linked profiles without requiring a local child', async () => {
  const T = {};
  const localStorage = storage();
  const window = {
    location: { search: '' },
    addEventListener() {},
    TOMBI_SYNC_CONFIG: {
      apiBaseUrl: 'https://synthetic.invalid',
      firebaseConfig: { apiKey: 'test', authDomain: 'test', projectId: 'test', appId: 'test' },
    },
    TOMBI_AUTH: { getIdToken: async () => 'synthetic-token', getEmail: async () => 'staff@example.com' },
  };
  const context = {
    T, window, localStorage, sessionStorage: storage(), URL, URLSearchParams, queueMicrotask,
    document: { getElementById: () => null },
    fetch: async (url) => ({
      ok: true, status: 200,
      json: async () => url.endsWith('/v1/game/patients') ? [{
        patient_id: 'synthetic-patient', linked_game_child_id: 'synthetic-child',
        display_name: 'Synthetic Child',
        profile: { age: 5, gender: 'f', levels: { echo: 2 } },
      }] : [],
    }),
  };
  vm.runInNewContext(source('storage.js'), context);
  T.store.load();
  vm.runInNewContext(source('cloud-sync.js'), context);
  await T.sync.start();
  assert.equal(T.store.getChild('synthetic-child')?.name, 'Synthetic Child');
  assert.equal(T.store.getChild('synthetic-child')?.levels.echo, 2);
});

test('staff sync uploads only summary data and does not resend an uploaded session', async () => {
  const T = {};
  const uploads = [];
  const context = {
    T, localStorage: storage(), sessionStorage: storage(), URL, URLSearchParams, queueMicrotask,
    document: { getElementById: () => null },
    window: {
      location: { search: '' }, addEventListener() {},
      crypto: { randomUUID: () => 'synthetic-uuid' },
      TOMBI_SYNC_CONFIG: {
        apiBaseUrl: 'https://synthetic.invalid',
        firebaseConfig: { apiKey: 'test', authDomain: 'test', projectId: 'test', appId: 'test' },
      },
      TOMBI_AUTH: { getIdToken: async () => 'refreshed-token', getEmail: async () => 'staff@example.com' },
    },
    fetch: async (url, init) => {
      if (init.method === 'POST') uploads.push(JSON.parse(init.body));
      return {
        ok: true, status: 200,
        json: async () => url.endsWith('/v1/game/patients') ? [{
          patient_id: 'synthetic-patient', linked_game_child_id: 'synthetic-child', profile: null,
        }] : init.method === 'POST' ? { session_id: 'remote-session' } : [],
      };
    },
  };
  vm.runInNewContext(source('storage.js'), context);
  T.store.load();
  T.store.addChild({ id: 'synthetic-child' });
  const session = T.store.addSession({
    id: 'synthetic-session', childId: 'synthetic-child', date: 1, durationSec: 10,
    stages: { echo: { score: 70, level: 2, recording: 'not-for-upload' } },
    recording: 'not-for-upload', templates: { private: [1, 2] },
  });
  vm.runInNewContext(source('cloud-sync.js'), context);
  await T.sync.start();
  await T.sync.sessionAdded(session);
  assert.equal(uploads.length, 1);
  assert.deepEqual(Object.keys(uploads[0]).sort(),
    ['client_session_id', 'duration_seconds', 'level_changes', 'played_at', 'score', 'stages']);
  assert.equal(JSON.stringify(uploads[0]).includes('not-for-upload'), false);
  assert.equal(uploads[0].stages[0].score, 70);
  assert.equal(session.cloudSessionId, 'remote-session');
});

test('a cached parent token cannot send a request after Firebase sign-out', async () => {
  const sessionStorage = storage();
  sessionStorage.setItem('tombi.parent.token', 'stale-token');
  const child = { id: 'synthetic-child' };
  let requests = 0;
  const session = {
    id: 'synthetic-session', childId: child.id, date: 1, durationSec: 10,
  };
  const T = { store: { getChild: () => child, settings: {}, save() {} } };
  vm.runInNewContext(source('cloud-sync.js'), {
    T, sessionStorage, URLSearchParams,
    window: {
      location: { search: '?parent=synthetic-child' }, addEventListener() {},
      crypto: { randomUUID: () => 'synthetic-uuid' },
      TOMBI_SYNC_CONFIG: { apiBaseUrl: 'https://synthetic.invalid' },
      TOMBI_AUTH: { getIdToken: async () => '' },
    },
    document: { getElementById: () => null },
    fetch: async () => { requests += 1; throw new Error('Must not send'); },
  });
  await T.sync.sessionAdded(session);
  assert.equal(requests, 0);
});

test('cloud sync rejects insecure non-local API URLs before sending data', async () => {
  let requests = 0;
  const T = {};
  const context = {
    T, localStorage: storage(), sessionStorage: storage(), URL, URLSearchParams, queueMicrotask,
    document: { getElementById: () => null },
    window: {
      location: { search: '' }, addEventListener() {},
      TOMBI_SYNC_CONFIG: {
        apiBaseUrl: 'http://api.example.invalid',
        firebaseConfig: { apiKey: 'test', authDomain: 'test', projectId: 'test', appId: 'test' },
      },
      TOMBI_AUTH: { getIdToken: async () => 'synthetic-token', getEmail: async () => 'staff@example.com' },
    },
    fetch: async () => { requests += 1; throw new Error('Insecure API request should not be sent'); },
  };
  vm.runInNewContext(source('cloud-sync.js'), context);
  await T.sync.start();
  assert.equal(requests, 0);
});

test('parent portal rejects insecure non-local API URLs before sending data', async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, textContent: '', innerHTML: '',
      classList: { toggle() {} },
      addEventListener() {},
    });
    return elements.get(id);
  };
  let requests = 0;
  vm.runInNewContext(source('parent.js'), {
    URL, URLSearchParams, sessionStorage: storage(), document: { getElementById: element },
    window: {
      location: { search: '', href: 'http://localhost/parent.html' },
      TOMBI_SYNC_CONFIG: {
        apiBaseUrl: 'http://api.example.invalid',
        firebaseConfig: { apiKey: 'test', authDomain: 'test', projectId: 'test', appId: 'test' },
      },
      TOMBI_AUTH: { getIdToken: async () => 'synthetic-token' },
    },
    fetch: async () => { requests += 1; throw new Error('Insecure API request should not be sent'); },
  });
  await new Promise(setImmediate);
  assert.equal(requests, 0);
});

test('linked guardian can delete cloud game data and its local child cache', async () => {
  const localStorage = storage();
  const sessionStorage = storage();
  const childId = 'synthetic-child';
  const profileKey = `tombi.parent.v1.${encodeURIComponent(childId)}`;
  const deleteButton = {
    dataset: { deleteGameData: childId }, disabled: false, listeners: {},
    addEventListener(event, callback) { this.listeners[event] = callback; },
  };
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, textContent: '', innerHTML: '', listeners: {},
      classList: { toggle() {} },
      addEventListener(event, callback) { this.listeners[event] = callback; },
      querySelectorAll(selector) {
        return id === 'parent-children' && selector === '[data-delete-game-data]'
          && this.innerHTML.includes('data-delete-game-data') ? [deleteButton] : [];
      },
    });
    return elements.get(id);
  };
  const requests = [];
  let childrenReads = 0;
  let confirmationMessage = '';
  vm.runInNewContext(source('parent.js'), {
    URL, URLSearchParams, localStorage, sessionStorage,
    document: { getElementById: element },
    window: {
      location: { search: '', href: 'https://synthetic.invalid/parent.html' },
      TOMBI_SYNC_CONFIG: {
        apiBaseUrl: 'https://synthetic.invalid',
        firebaseConfig: { apiKey: 'test', authDomain: 'test', projectId: 'test', appId: 'test' },
      },
      TOMBI_AUTH: { getIdToken: async () => 'synthetic-token' },
      confirm: (message) => { confirmationMessage = message; return true; },
    },
    fetch: async (url, init = {}) => {
      requests.push({ url, method: init.method || 'GET' });
      let body = {};
      if (url.endsWith('/v1/game/children')) {
        childrenReads += 1;
        body = childrenReads === 1 ? [{
          game_child_id: childId, display_name: 'Synthetic Child',
          profile: { age: 5, gender: 'f', levels: {} },
        }] : [];
      } else if (url.endsWith('/sessions')) body = [];
      return { ok: true, status: 200, json: async () => body };
    },
  });
  await new Promise(setImmediate);
  assert.ok(localStorage.getItem(profileKey), element('parent-message').textContent);
  assert.equal(typeof deleteButton.listeners.click, 'function');
  await deleteButton.listeners.click();
  assert.match(confirmationMessage, /עותקים מקומיים בדפדפנים של מכשירים אחרים אינם נמחקים מרחוק/);
  assert.ok(requests.some((request) =>
    request.method === 'DELETE' && request.url.endsWith(`/v1/game/children/${childId}/data`)));
  assert.equal(localStorage.getItem(profileKey), null);
  assert.equal(localStorage.getItem(`tombi.parent.deleted.${childId}`), '1');
  assert.equal(sessionStorage.getItem(`tombi.parent.levels.${childId}`), null);
  assert.match(element('parent-message').textContent, /אין קישור/);
});

test('parent play does not retain unapproved levels when approved levels are empty', async () => {
  const sessionStorage = storage();
  sessionStorage.setItem('tombi.parent.levels.synthetic-child', '{}');
  const child = { levels: { echo: 3 } };
  const T = { store: { getChild: () => child, settings: {}, save() {} } };
  vm.runInNewContext(source('cloud-sync.js'), {
    T, sessionStorage, URLSearchParams,
    window: { location: { search: '?parent=synthetic-child' }, addEventListener() {} },
    document: { getElementById: () => null },
  });
  await T.sync.sessionAdded({ demo: true });
  assert.deepEqual(Object.keys(child.levels), []);
});

test('parent play restores approved difficulty steps as well as legacy levels', async () => {
  const sessionStorage = storage();
  sessionStorage.setItem('tombi.parent.levels.synthetic-child', JSON.stringify({
    steps: { echo: 7 },
    levels: { echo: 3 },
  }));
  const child = { steps: { echo: 1 }, levels: { echo: 1 } };
  const T = { store: { getChild: () => child, settings: {}, save() {} } };
  vm.runInNewContext(source('cloud-sync.js'), {
    T, sessionStorage, URLSearchParams,
    window: { location: { search: '?parent=synthetic-child' }, addEventListener() {} },
    document: { getElementById: () => null },
  });
  await T.sync.sessionAdded({ demo: true });
  assert.deepEqual({ ...child.steps }, { echo: 7 });
  assert.deepEqual({ ...child.levels }, { echo: 3 });
});

test('parent play keeps an automatically earned step after the session is uploaded', async () => {
  const sessionStorage = storage();
  sessionStorage.setItem('tombi.parent.levels.synthetic-child', JSON.stringify({
    steps: { echo: 7 },
    levels: { echo: 3 },
  }));
  const child = { steps: { echo: 8 }, levels: { echo: 3 } };
  const T = { store: { getChild: () => child, settings: {}, save() {} } };
  vm.runInNewContext(source('cloud-sync.js'), {
    T, sessionStorage, URLSearchParams,
    window: { location: { search: '?parent=synthetic-child' }, addEventListener() {} },
    document: { getElementById: () => null },
  });
  await T.sync.sessionAdded({ demo: true, levelChanges: [{ task: 'echo', fromStep: 7, toStep: 8 }] });
  assert.equal(child.steps.echo, 8);
  assert.equal(JSON.parse(sessionStorage.getItem('tombi.parent.levels.synthetic-child')).steps.echo, 8);
});

test('accepted parent invitation is not submitted again on account sign-in', async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      classList: { toggle() {} }, listeners: {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
      removeEventListener(event) { delete this.listeners[event]; },
      querySelectorAll: () => [],
    });
    return elements.get(id);
  };
  let acceptances = 0;
  vm.runInNewContext(source('parent.js'), {
    URL, URLSearchParams, sessionStorage: storage(),
    document: { getElementById: element },
    window: {
      location: { search: '?invite=synthetic-invite', href: 'https://synthetic.invalid/parent.html?invite=synthetic-invite' },
      history: { replaceState() {} },
      TOMBI_SYNC_CONFIG: {
        apiBaseUrl: 'https://synthetic.invalid',
        firebaseConfig: { apiKey: 'test', authDomain: 'test', projectId: 'test', appId: 'test' },
      },
      TOMBI_AUTH: {
        getIdToken: async () => 'synthetic-token',
        signInWithGoogle: async () => 'synthetic-token',
      },
    },
    fetch: async (url) => ({
      ok: true, status: 200,
      json: async () => {
        if (url.endsWith('/invitations/accept')) {
          acceptances += 1;
          return { invitation_type: 'guardian' };
        }
        return [];
      },
    }),
  });
  await new Promise(setImmediate);
  assert.equal(acceptances, 1);
  await element('parent-login').listeners.click();
  assert.equal(acceptances, 1);
});
