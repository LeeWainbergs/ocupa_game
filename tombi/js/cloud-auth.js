window.TOMBI_AUTH = (() => {
  const config = window.TOMBI_SYNC_CONFIG || {};
  let authPromise;
  let firstStatePromise;

  async function getAuth() {
    if (!authPromise) {
      authPromise = (async () => {
        const firebaseConfig = config.firebaseConfig || {};
        if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId || !firebaseConfig.appId) {
          return null;
        }
        if (document.readyState === 'loading') {
          await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
        }
        if (!window.firebase || !window.firebase.auth) {
          throw new Error('רכיב ההתחברות המאובטחת לא נטען. בדקו את החיבור לאינטרנט ונסו שוב.');
        }
        if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseConfig);
        const auth = window.firebase.auth();
        await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
        return auth;
      })();
    }
    return authPromise;
  }

  async function currentUser(auth) {
    if (auth.currentUser) return auth.currentUser;
    if (!firstStatePromise) {
      firstStatePromise = new Promise((resolve, reject) => {
        const unsubscribe = auth.onAuthStateChanged(
          (user) => {
            unsubscribe();
            resolve(user);
          },
          (error) => {
            unsubscribe();
            reject(error);
          },
        );
      });
    }
    return firstStatePromise;
  }

  async function signInWithGoogle() {
    const auth = await getAuth();
    if (!auth) throw new Error('החיבור המאובטח עדיין לא הוגדר. פנו לצוות.');
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await auth.signInWithPopup(provider);
    return result.user.getIdToken();
  }

  async function getIdToken() {
    const auth = await getAuth();
    if (!auth) return '';
    const user = await currentUser(auth);
    return user ? user.getIdToken() : '';
  }

  async function signOut() {
    const auth = await getAuth();
    if (auth) await auth.signOut();
  }

  async function getEmail() {
    const auth = await getAuth();
    if (!auth) return '';
    const user = await currentUser(auth);
    return user ? user.email || '' : '';
  }

  return { getEmail, getIdToken, signInWithGoogle, signOut };
})();
