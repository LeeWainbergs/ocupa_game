/* emotion-guess.js — "מנחש הרגשות של טומבי": a short emotional story, a guess, and a brief dialogue. */
(() => {
  const M = T.ot.metrics;
  const EMOTIONS = {
    happy: { label: 'שמחה', emoji: '🐉😄', feels: 'שמח', help: 'לשתף חבר בשמחה' },
    sad: { label: 'עצב', emoji: '🐉😢', feels: 'עצוב', help: 'חיבוק או מישהו שיקשיב' },
    worried: { label: 'דאגה / פחד', emoji: '🐉😟', feels: 'מפחד', help: 'לנשום לאט ולהחזיק יד של מישהו' },
    angry: { label: 'כעס', emoji: '🐉😠', feels: 'כועס', help: 'לנשוף אש לאט ולספר מה קרה' },
  };
  const STORIES = [
    { id: 'ice-cream', tone: 'sad', text: 'טומבי קנה גלידת תות, ו… פלופ! הגלידה נפלה על הרצפה. טומבי הסתכל עליה ושתק.' },
    { id: 'friend-visit', tone: 'happy', text: 'היום חבר של טומבי בא לבקר, והם בנו יחד מערה מכריות. טומבי קפץ ונופף בכנפיים.' },
    { id: 'thunder', tone: 'worried', text: 'בלילה נשמע רעם חזק: בום! טומבי התכרבל מתחת לשמיכה ועצם את העיניים.' },
    { id: 'tower-knocked', tone: 'angry', text: 'טומבי בנה מגדל גבוה, ומישהו הפיל אותו בלי לשאול. טומבי נשף עשן מהאף.' },
  ];
  const AIDE_OPTIONS = [
    ...Object.entries(EMOTIONS).map(([value, emotion]) => ({ value, label: emotion.label, emoji: emotion.emoji })),
    { value: 'other', label: 'רגש אחר', emoji: '💬' },
    { value: 'noAnswer', label: 'לא ענה/תה', emoji: '🤐' },
  ];

  function pickStories(child, count) {
    const played = T.store && child && child.id
      ? T.store.sessionsOf(child.id).filter((session) => session.stages && session.stages.emotionGuess).length
      : 0;
    return Array.from({ length: count }, (_, index) => STORIES[(played + index) % STORIES.length]);
  }

  function render(box, total) {
    box.innerHTML = `<div class="emotion-guess">
      <div class="emotion-face" aria-hidden="true">🐉❔</div>
      <p class="emotion-caption" aria-live="polite">סיפור 1 מתוך ${total}</p></div>`;
    return {
      face(text) { box.querySelector('.emotion-face').textContent = text; },
      caption(text) { box.querySelector('.emotion-caption').textContent = text; },
    };
  }

  T.ot.register({
    key: 'emotionGuess',
    name: 'מנחש הרגשות של טומבי',
    domain: 'רגשי־חברתי ותיאוריית התודעה',
    modes: ['verbal'],
    durationSec: { short: 75, full: 120 },
    params() { return { stories: 3 }; },
    async execute(ctx, p, run) {
      const stories = pickStories(ctx.child, p.short ? 2 : p.stories || 3);
      const ui = render(ctx.taskBox(), stories.length);
      const trials = [];
      await run.prompt(`עכשיו אספר לך סיפורים קטנים עליי. ${ctx.G('תקשיב', 'תקשיבי')} טוב, ואחר כך ${ctx.G('תנחש', 'תנחשי')} איך הרגשתי.`, 'intro');

      for (let index = 0; index < stories.length; index++) {
        const story = stories[index];
        const emotion = EMOTIONS[story.tone];
        ui.caption(`סיפור ${index + 1} מתוך ${stories.length}`);
        ui.face('🐉❔');
        await run.prompt(story.text, `story_${story.id}`);
        await run.prompt('איך טומבי מרגיש עכשיו?', `question_${story.id}`);

        let aideCode = null;
        ctx.setManualPick((value) => { aideCode = { value, t: T.audio.now() }; });
        T.ui && T.ui.aideFeelings && T.ui.aideFeelings(true, 'מה הילד/ה אמר/ה? (סימון לא חובה)', AIDE_OPTIONS);
        let answer, followUp;
        try {
          if (T.audio.mode === 'sim') {
            T.tasks.get('emotionGuess').simulate({ ms: 800, delayMs: 1100 });
            aideCode = { value: story.tone, t: T.audio.now(), simulated: true };
          }
          answer = await run.awaitResponse({
            maxMs: 9000, startTimeoutMs: 10000, endSilenceMs: 1500, minVoiceMs: 150, requireVoiced: true,
            label: `answer_${story.id}`,
          });
          ui.face(emotion.emoji);
          const coded = aideCode && EMOTIONS[aideCode.value] ? aideCode.value : null;
          let reply;
          if (answer.source === 'none' && !coded) reply = `זה בסדר. אני חושב שטומבי הרגיש ${emotion.feels}.`;
          else if (coded === story.tone) reply = `נכון! טומבי הרגיש ${emotion.feels}.`;
          else if (coded) reply = `אולי. אני חושב שטומבי הרגיש גם קצת ${emotion.feels}.`;
          else reply = `תודה ששיתפת. אני הרגשתי ${emotion.feels}.`;
          await ctx.say(reply);
          await run.prompt(`ומה יכול לעזור לטומבי כשהוא ${emotion.feels}?`, `followup_${story.id}`);
          if (T.audio.mode === 'sim') T.tasks.get('emotionGuess').simulate({ ms: 1400, delayMs: 1400 });
          followUp = await run.awaitResponse({
            maxMs: 10000, startTimeoutMs: 10000, endSilenceMs: 1800, minVoiceMs: 150, requireVoiced: true,
            label: `followup_${story.id}`,
          });
          await ctx.say(followUp.audioValid.length ? 'רעיון טוב. תודה שעזרת לי.' : `אולי ${emotion.help}. תודה!`);
        } finally {
          ctx.setManualPick(null);
          T.ui && T.ui.aideFeelings && T.ui.aideFeelings(false);
        }

        const coded = aideCode ? aideCode.value : null;
        trials.push({
          story_id: story.id,
          story_tone: story.tone,
          response_detected: answer.source !== 'none',
          response_source: answer.source,
          latency_sec: M.toSec(answer.latencyMs),
          utterance_count: answer.audioValid.length,
          vocal_engagement_sec: M.toSec(answer.childVoiceMs),
          followup_latency_sec: M.toSec(followUp.latencyMs),
          followup_utterance_count: followUp.audioValid.length,
          followup_vocal_engagement_sec: M.toSec(followUp.childVoiceMs),
          total_vocal_engagement_sec: M.toSec(answer.childVoiceMs + followUp.childVoiceMs),
          adult_voice_sec: M.toSec(answer.adultVoiceMs + followUp.adultVoiceMs),
          aide_coded_emotion: coded,
          aide_coded_matches_story_tone: coded && EMOTIONS[coded] ? coded === story.tone : null,
        });
      }

      const answered = trials.filter((trial) => trial.response_detected);
      const latencies = trials.map((trial) => trial.latency_sec);
      return run.finish({
        confidence: trials.length ? trials.filter((trial) => trial.response_source === 'audio').length / trials.length : 0,
        metrics: {
          stories_presented: trials.length,
          stories_with_response: answered.length,
          latency_sec: latencies,
          latency_summary: M.stats(latencies),
          followup_latency_sec: trials.map((trial) => trial.followup_latency_sec),
          vocal_engagement_sec: M.round(trials.reduce((sum, trial) => sum + (trial.total_vocal_engagement_sec || 0), 0)),
          utterances_total: trials.reduce((sum, trial) => sum + trial.utterance_count + trial.followup_utterance_count, 0),
          adult_voice_sec: M.round(trials.reduce((sum, trial) => sum + (trial.adult_voice_sec || 0), 0)),
          aide_coded_count: trials.filter((trial) => trial.aide_coded_emotion).length,
          aide_coded_match_count: trials.filter((trial) => trial.aide_coded_matches_story_tone === true).length,
        },
        trials,
        definitions: {
          latency_sec: 'מסיום השאלה "איך טומבי מרגיש עכשיו?" ועד תחילת הקול הראשון של הילד/ה',
          vocal_engagement_sec: 'סך משך הדיבור של הילד/ה בתשובות ובשיחת ההמשך (ללא קול מבוגר)',
          utterance_count: 'מספר קטעי הדיבור הנפרדים (הפסקה של 180 מ״ש מפרידה ביניהם)',
          aide_coded_emotion: 'הרגש שהסייעת סימנה לפי מה שהילד/ה אמר/ה; המערכת אינה מפענחת מילים',
          aide_coded_matches_story_tone: 'השוואה פשוטה בין סימון הסייעת לטון שתוכנן לסיפור; ריק אם לא סומן',
        },
      });
    },
    simulate(p = {}) {
      T.audio.sim.voice(p.ms || 900, 0.25, 300, p.delayMs || 1000);
    },
    version: 1,
  });
})();
