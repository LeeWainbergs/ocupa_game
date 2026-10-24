/* registry.js — task definitions used by the session runner. */
window.T = window.T || {};

T.tasks = (() => {
  const definitions = new Map();

  function register(def) {
    if (!def || typeof def.key !== 'string' || !def.key || typeof def.run !== 'function') {
      throw new TypeError('A task needs a key and a run function');
    }
    if (definitions.has(def.key)) throw new Error(`Task already registered: ${def.key}`);
    definitions.set(def.key, Object.freeze(def));
    return def;
  }

  function get(key) {
    return definitions.get(key);
  }

  function all() {
    return [...definitions.values()];
  }

  return { register, get, all };
})();
