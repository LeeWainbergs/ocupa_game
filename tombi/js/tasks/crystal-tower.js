/* crystal-tower.js — "מגדל הקריסטלים": the child builds a real tower and reports each floor by voice. */
(() => {
  const M = T.ot.metrics;
  const ORDINALS = ['ראשונה', 'שנייה', 'שלישית', 'רביעית', 'חמישית', 'שישית', 'שביעית', 'שמינית'];
  const COUNTS = ['', 'קומה אחת', 'שתי קומות', 'שלוש קומות', 'ארבע קומות', 'חמש קומות', 'שש קומות', 'שבע קומות', 'שמונה קומות'];

  function render(box, floors) {
    box.innerHTML = `<div class="crystal-tower">
      <div class="crystal-stack" aria-label="מגדל הקריסטלים">${Array.from({ length: floors }, (_, index) =>
        `<span class="crystal" data-floor="${index + 1}" aria-hidden="true"></span>`).join('')}</div>
      <p class="crystal-caption" aria-live="polite">מתחילים לבנות…</p></div>`;
    return {
      light(floor) { box.querySelector(`.crystal[data-floor="${floor}"]`)?.classList.add('on'); },
      caption(text) { box.querySelector('.crystal-caption').textContent = text; },
    };
  }

  function feedback(ctx, floor, floors, latencyMs, previousMs) {
    const done = COUNTS[floor] || `${floor} קומות`;
    if (floor === floors) return `${done}! המגדל מוכן ונוצץ.`;
    let pace = 'המגדל גדל.';
    if (Number.isFinite(latencyMs) && Number.isFinite(previousMs)) {
      if (latencyMs > previousMs * 1.5) pace = 'לקחת את הזמן ובנית בזהירות.';
      else if (latencyMs < previousMs * 0.6) pace = 'איזה מהר! עכשיו לאט ובעדינות.';
    }
    return `${done}! ${pace}`;
  }

  T.ot.register({
    key: 'crystalTower',
    name: 'מגדל הקריסטלים',
    domain: 'מוטוריקה עדינה ודירוג תנועה',
    needs: { object: 'blocks' },
    durationSec: { short: 75, full: 120 },
    params(level, age) { return { floors: Number(age) < 5 ? 4 : 5, floorWaitSec: 45 }; },
    async execute(ctx, p, run) {
      const floors = p.short ? 3 : p.floors || 5;
      const waitMs = (p.floorWaitSec || 45) * 1000;
      const ui = render(ctx.taskBox(), floors);
      const speak = ctx.nonverbal ? `${ctx.G('תשמיע', 'תשמיעי')} לי קול שמח` : `${ctx.G('תגיד', 'תגידי')} לי: קומה מוכנה!`;
      await run.prompt(`בוא${ctx.G('', 'י')} נבנה מגדל קריסטלים! ${ctx.G('שים', 'שימי')} קובייה על קובייה. בכל פעם שקומה מוכנה, ${speak}`, 'intro');

      const reports = [];
      let reminders = 0;
      for (let floor = 1; floor <= floors; floor++) {
        ui.caption(`קומה ${floor} מתוך ${floors}`);
        await run.prompt(floor === 1 ? `קומה ${ORDINALS[0]}. ${ctx.G('בנה', 'בני')} לאט ובזהירות.` : `עכשיו קומה ${ORDINALS[floor - 1] || floor}.`, `floor_${floor}`);
        const listenFloor = (attempt) => {
          if (T.audio.mode === 'sim') T.tasks.get('crystalTower').simulate({ delayMs: 1200 + floor * 250 });
          return run.awaitResponse({
            maxMs: waitMs, endSilenceMs: waitMs, minVoiceMs: 300, requireVoiced: true, stopOnFirst: true,
            label: `floor_${floor}${attempt ? '_retry' : ''}`,
            aide: { title: 'מגדל הקריסטלים:', options: [{ value: 'done', label: `קומה ${floor} מוכנה`, emoji: '💎' }], endsWindow: true },
          });
        };
        let response = await listenFloor(0);
        let floorReminders = 0;
        if (response.source === 'none') {
          floorReminders = 1;
          reminders++;
          await run.prompt(`אני מחכה ומקשיב. כשהקומה מוכנה, ${ctx.G('ספר', 'ספרי')} לי.`, `floor_${floor}_reminder`);
          response = await listenFloor(1);
        }
        if (response.source === 'none') {
          reports.push({ floor, reported: false, source: 'none', reminders: floorReminders, non_voice_sounds: response.other.length });
          break;
        }
        const previous = reports.length ? reports[reports.length - 1].latencyMs : null;
        reports.push({
          floor, reported: true, source: response.source, reminders: floorReminders,
          responseMs: response.responseMs, latencyMs: response.latencyMs,
          voiceMs: response.valid[0] && !response.valid[0].manual ? response.valid[0].dur : null,
          non_voice_sounds: response.other.length,
        });
        ui.light(floor);
        T.tombi.chime('good');
        T.tombi.happy();
        await ctx.say(feedback(ctx, floor, floors, response.latencyMs, previous));
      }

      const done = reports.filter((report) => report.reported);
      if (done.length < floors) await ctx.say(done.length ? `עצרנו כאן. בנית ${COUNTS[done.length] || `${done.length} קומות`}. איזה מגדל!` : 'נבנה את המגדל בפעם אחרת.');
      const reportTimes = done.map((report) => report.responseMs);
      const interMs = M.intervals(reportTimes);
      const latencies = done.map((report) => report.latencyMs);
      return run.finish({
        confidence: done.length ? done.filter((report) => report.source === 'audio').length / done.length : 0,
        metrics: {
          floors_target: floors,
          floors_reported: done.length,
          floors_reported_by_voice: done.filter((report) => report.source === 'audio').length,
          floors_reported_by_aide: done.filter((report) => report.source !== 'audio').length,
          build_duration_sec: reportTimes.length ? M.toSec(reportTimes[reportTimes.length - 1] - run.t0) : null,
          first_report_latency_sec: done.length ? M.toSec(done[0].latencyMs) : null,
          latency_sec: latencies.map(M.toSec),
          inter_response_time_sec: interMs.map(M.toSec),
          inter_response_time_summary: M.stats(interMs.map(M.toSec)),
          reminders_total: reminders,
          non_voice_sounds_total: reports.reduce((sum, report) => sum + report.non_voice_sounds, 0),
        },
        trials: reports.map((report) => ({
          floor: report.floor,
          reported: report.reported,
          source: report.source,
          report_t_sec: Number.isFinite(report.responseMs) ? run.rel(report.responseMs) : null,
          latency_sec: M.toSec(report.latencyMs),
          voice_duration_sec: M.toSec(report.voiceMs),
          non_voice_sounds: report.non_voice_sounds,
          reminders: report.reminders,
        })),
        definitions: {
          latency_sec: 'לכל קומה: מסיום ההנחיה "עכשיו קומה…" ועד תחילת הדיווח הקולי (זמן הבנייה של הקומה)',
          inter_response_time_sec: 'מרווחים בין תחילת דיווחי "קומה מוכנה" עוקבים, כולל זמן המשוב של טומבי',
          build_duration_sec: 'מתחילת המשימה ועד הדיווח האחרון',
          non_voice_sounds: 'צלילים ללא גובה צליל (למשל נקישות קוביות) שלא נספרו כדיווח',
        },
      });
    },
    simulate(p = {}) {
      const delay = p.delayMs || 1500;
      T.audio.sim.clap(Math.max(0, delay - 600), 0.3);
      T.audio.sim.voice(700, 0.25, 300, delay);
    },
    version: 1,
  });
})();
