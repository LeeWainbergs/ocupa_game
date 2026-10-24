/* engine.js — the opening and closing engine check. */
T.tasks.register({
  key: 'engineStart',
  name: 'בדיקת מנוע',
  domain: 'מודעות עצמית לרמת העוררות',
  slot: 'core',
  arousal: 0,
  gross: false,
  jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],
  minAge: 3,
  durationSec: { short: 15, full: 30 },
  levels: 1,
  params() { return {}; },
  run(ctx) { return engineCheck(ctx, 'start'); },
  simulate(p = {}) { return { choice: p.choice || 'fish', method: 'simulation' }; },
  version: 1,
});

T.tasks.register({
  key: 'engineEnd',
  name: 'בדיקת מנוע שוב',
  domain: 'ויסות לאורך המפגש',
  slot: 'core',
  arousal: 0,
  gross: false,
  jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],
  minAge: 3,
  durationSec: { short: 15, full: 30 },
  levels: 1,
  params() { return {}; },
  run(ctx) { return engineCheck(ctx, 'end'); },
  simulate(p = {}) { return { choice: p.choice || 'fish', method: 'simulation' }; },
  version: 1,
});

async function engineCheck(ctx, which) {
  const { child, nonverbal, G, say, listen, classify, words, engineLabels, taskBox, setManualPick } = ctx;
  const box = document.getElementById('child-choices');
  box.className = 'choices';
  box.innerHTML = words.map((word) => `<button class="choice" data-w="${word}" type="button" aria-label="${engineLabels[word].label}"><span aria-hidden="true">${engineLabels[word].emoji}</span></button>`).join('');
  box.hidden = false;
  taskBox().innerHTML = '';
  const cards = [...box.querySelectorAll('.choice')];
  const mark = (word, cls) => cards.forEach((card) => card.classList.toggle(cls, card.dataset.w === word));
  let pickResolve;
  const picked = new Promise((resolve) => { pickResolve = resolve; });
  cards.forEach((card) => card.addEventListener('click', () => pickResolve({ word: card.dataset.w, method: 'touch' })));
  setManualPick((word) => pickResolve({ word, method: 'aide' }));
  T.ui.aideEngine(true);
  if (which === 'start') {
    await say(nonverbal
      ? `איך המנוע בגוף שלך עכשיו? ${G('תראה', 'תראי')} לי באצבע: צב, לאט. דג, בדיוק טוב. או קוף, מהיר מדי.`
      : `איך המנוע בגוף שלך עכשיו? צב, לאט. דג, בדיוק טוב. או קוף, מהיר מדי?`, `engine_start_${nonverbal ? 'nv' : 'v'}_${child.gender}`);
  } else {
    await say(nonverbal ? `ואיך המנוע עכשיו? ${G('תראה', 'תראי')} לי: צב, דג או קוף?` : 'ואיך המנוע עכשיו? צב, דג או קוף?', `engine_end_${nonverbal ? 'nv' : 'v'}_${child.gender}`);
  }
  if (T.audio.mode === 'sim') {
    const result = T.tasks.get(which === 'start' ? 'engineStart' : 'engineEnd').simulate();
    pickResolve({ word: result.choice, method: result.method });
  }

  let voiceFeats = null, guess = null, settled = false;
  const signal = { cancelled: false };
  const voiceLoop = async () => {
    if (nonverbal) return new Promise(() => {});
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await listen({ maxMs: 7000, startTimeoutMs: 8000, endSilenceMs: 600, minDurMs: 150, stopAfterFirst: true, signal });
      if (settled) return null;
      const segment = response.segments.find((item) => !item.manual && item.dur < 2000);
      if (!segment) continue;
      const result = classify(segment);
      voiceFeats = result.feats;
      if (result.word && result.confident) return { word: result.word, method: 'voice' };
      guess = result.word;
      if (guess) mark(guess, 'is-guess');
      if (settled) return null;
      await say(`${G('תראה', 'תראי')} לי באצבע`, `engine_point_${child.gender}`);
      return new Promise(() => {});
    }
    return new Promise(() => {});
  };
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 35000));
  let result;
  try { result = await Promise.race([picked, voiceLoop(), timeout]); }
  catch (error) { box.hidden = true; throw error; }
  finally {
    settled = true; signal.cancelled = true;
    setManualPick(null); T.ui.aideEngine(false);
  }
  const hideChoices = () => setTimeout(() => { box.hidden = true; box.innerHTML = ''; }, 1400);
  if (!result) { box.hidden = true; return { choice: null, method: null, score: 0, skipped: true }; }
  mark(result.word, 'is-picked');
  box.classList.add('is-done');
  hideChoices();
  if (voiceFeats && result.method !== 'voice') T.store.addTemplate(child.id, result.word, voiceFeats);
  T.tombi.chime('good'); T.tombi.happy();
  const thanks = { turtle: 'צב. תודה שסיפרת לי.', fish: 'דג. תודה שסיפרת לי.', monkey: 'קוף. תודה שסיפרת לי.' };
  await say(thanks[result.word], `engine_thanks_${result.word}`);
  return { choice: result.word, method: result.method, guess, score: 100 };
}
