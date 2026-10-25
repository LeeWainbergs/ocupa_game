/* Mood check-ins and an optional child-led dragon-breathing pause. */
const FEELING_OPTIONS = [
  { value: 'happy', label: 'שמחה', emoji: '🐉😄' },
  { value: 'calm', label: 'רוגע', emoji: '🐉😌' },
  { value: 'tired', label: 'עייפות', emoji: '🐉😴' },
  { value: 'sad', label: 'עצב', emoji: '🐉😢' },
  { value: 'worried', label: 'דאגה', emoji: '🐉😟' },
  { value: 'angry', label: 'כעס', emoji: '🐉😠' },
  { value: 'unsure', label: 'לא בטוח/ה', emoji: '🐉🤔' },
  { value: 'preferNot', label: 'לא רוצה לבחור', emoji: '🐉💭' },
];
const BREATH_OPTIONS = [
  { value: '1', label: 'נשימה אחת', emoji: '🔥' },
  { value: '3', label: '3 נשימות', emoji: '🔥🔥' },
  { value: '5', label: '5 נשימות', emoji: '🔥🔥🔥' },
];
T.FEELINGS = Object.fromEntries(FEELING_OPTIONS.map(({ value, label, emoji }) => [value, { label, emoji }]));

T.tasks.register({
  key: 'engineStart',
  name: 'איך הלב מרגיש? ונשימת דרקון',
  domain: 'זיהוי תחושה ובחירה בכלי הרגעה',
  slot: 'core',
  arousal: 0,
  gross: false,
  jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],
  minAge: 3,
  durationSec: { short: 15, full: 30 },
  levels: 0,
  params() { return {}; },
  run(ctx) { return moodCheck(ctx, 'start'); },
  simulate(p = {}) { return { feeling: p.feeling || 'calm', breaths: p.breaths || 1, method: 'simulation' }; },
  version: 1,
});

T.tasks.register({
  key: 'engineEnd',
  name: 'איך הלב מרגיש עכשיו?',
  domain: 'דיווח עצמי על תחושה',
  slot: 'core',
  arousal: 0,
  gross: false,
  jump: false,
  needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],
  minAge: 3,
  durationSec: { short: 15, full: 30 },
  levels: 0,
  params() { return {}; },
  run(ctx) { return moodCheck(ctx, 'end'); },
  simulate(p = {}) { return { feeling: p.feeling || 'calm', method: 'simulation' }; },
  version: 1,
});

async function choose(ctx, title, options, simulatedValue) {
  const { nonverbal, G, say, taskBox, setManualPick } = ctx;
  const box = document.getElementById('child-choices');
  if (!box) throw new Error('Mood choice panel is missing');
  box.className = 'choices choices--feelings';
  box.innerHTML = options.map((option) => `<button class="choice" data-w="${option.value}" type="button" aria-label="${option.label}"><span aria-hidden="true">${option.emoji}</span><small>${option.label}</small></button>`).join('');
  box.hidden = false;
  taskBox().textContent = '';
  const cards = [...box.querySelectorAll('.choice')];
  let selected = null;
  const select = (value, method) => {
    if (selected === null) selected = { value, method };
  };
  cards.forEach((card) => card.addEventListener('click', () => select(card.dataset.w, 'touch')));
  setManualPick((value) => select(value, 'aide'));
  T.ui.aideFeelings(true, title, options);
  try {
    await say(nonverbal
      ? `${title} ${G('הצבע', 'הצביעי')} על כרטיס, או ${G('הראה', 'הראי')} לי באצבע.`
      : `${title} אפשר לספר לי או לבחור כרטיס.`);
    if (T.audio.mode === 'sim') select(simulatedValue, 'simulation');
    const deadline = Date.now() + 35000;
    while (selected === null && Date.now() < deadline) await ctx.wait(80);
    if (selected) {
      cards.forEach((card) => card.classList.toggle('is-picked', card.dataset.w === selected.value));
      await ctx.wait(250);
    }
    return selected;
  } finally {
    setManualPick(null);
    T.ui.aideFeelings(false);
    box.hidden = true;
    box.innerHTML = '';
  }
}

async function dragonBreaths(ctx, count, task) {
  let completed = 0, action = null;
  const deadline = Date.now() + 60000;
  const aideOptions = [
    { value: 'done', label: 'הנשיפה הסתיימה', emoji: '🔥' },
    { value: 'stop', label: 'מספיק לי', emoji: '🐉' },
  ];
  ctx.setManualPick((value) => {
    action = value;
    if (value === 'stop') T.tombi.stopSpeaking();
  });
  T.ui.aideFeelings(true, 'נשימת דרקון:', aideOptions);
  try {
    for (let index = 0; index < count; index++) {
      action = null;
      const finish = (value) => { action = value; };
      task.innerHTML = `<div class="dragon-breath"><span aria-hidden="true">🐉 🔥</span><p>נשימת דרקון ${index + 1} מתוך ${count}</p><button class="btn btn-ghost dragon-breath-done" type="button">סיימתי נשיפה</button><button class="btn btn-ghost dragon-breath-stop" type="button">מספיק לי</button></div>`;
      task.querySelector('.dragon-breath-done').addEventListener('click', () => finish('done'));
      task.querySelector('.dragon-breath-stop').addEventListener('click', () => {
        finish('stop');
        T.tombi.stopSpeaking();
      });
      const inhale = ctx.G('קח', 'קחי'), exhale = ctx.G('נשוף', 'נשפי');
      await ctx.say(`${inhale} נשימה שנעימה לך, וכשנוח לך ${exhale} בעדינות כמו דרקון שמוציא להבה קטנה. אפשר לעצור בכל רגע.`);
      if (T.audio.mode === 'sim') finish('done');
      while (action === null && Date.now() < deadline) await ctx.wait(80);
      if (action !== 'done') break;
      completed++;
    }
  } finally {
    ctx.setManualPick(null);
    T.ui.aideFeelings(false);
    task.textContent = '';
  }
  return completed;
}

async function moodCheck(ctx, which) {
  const { say } = ctx;
  const isStart = which === 'start';
  const feelingChoice = await choose(
    ctx,
    isStart ? 'איך הלב שלך מרגיש היום?' : 'איך הלב שלך מרגיש עכשיו?',
    FEELING_OPTIONS,
    T.tasks.get(isStart ? 'engineStart' : 'engineEnd').simulate().feeling,
  );
  if (!feelingChoice) return { feeling: null, method: null, skipped: true };

  const result = { feeling: feelingChoice.value, method: feelingChoice.method };
  if (isStart) {
    const breathChoice = await choose(
      ctx,
      `כמה נשימות דרקון עדינות ${ctx.G('תרצה', 'תרצי')}?`,
      BREATH_OPTIONS,
      String(T.tasks.get('engineStart').simulate().breaths),
    );
    if (!breathChoice) return { ...result, breathCount: null, breathsCompleted: 0 };
    const count = Number(breathChoice.value);
    const breathsCompleted = await dragonBreaths(ctx, count, ctx.taskBox());
    return { ...result, breathCount: count, breathsCompleted, breathMethod: breathChoice.method };
  }
  await say('תודה ששיתפת אותי.');
  return result;
}
