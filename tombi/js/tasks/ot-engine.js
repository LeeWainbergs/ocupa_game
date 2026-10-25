/* ot-engine.js — shared runner for audio-only OT tasks ("white box").
   Roles: the child/aide act in the room and answer by voice; Tombi prompts, counts and acknowledges;
   the engine only records raw timing and audio values. It never scores, labels or interprets. */
window.T = window.T || {};

T.ot = (() => {
  const SCHEMA = 'tombi.ot-task/v1';
  const EXPORT_SCHEMA = 'tombi.ot-dashboard/v1';
  const ROLES = Object.freeze({
    child_aide: 'פעולה פיזית או מרחבית בחדר ותגובה קולית קצרה למיקרופון',
    tombi: 'הנחיה מילולית קצרה, ספירת שלבים ומשוב על התקדמות',
    system: 'איסוף מדדים כמותיים גולמיים בלבד, ללא ציון או פרשנות אבחונית',
  });
  const COMMON_DEFINITIONS = Object.freeze({
    total_duration_sec: 'זמן מתחילת המשימה (לפני ההנחיה הראשונה) ועד סיומה',
    latency_sec: 'זמן מסיום משפט ההנחיה של טומבי (כולל 280 מ״ש הגנת הד) ועד תחילת הקול התקף הראשון',
    inter_response_time_sec: 'מרווחי הזמן בין תחילת דיווחים קוליים עוקבים',
    audio_detection_ratio: 'חלק התגובות שזוהו במיקרופון (לעומת סימון ידני של הסייעת או היעדר תגובה)',
    adult_voice_sec: 'משך קול שזוהה כקול מבוגר; נרשם בנפרד ואינו נכלל במדדי הילד',
    responses_sounding_at_window_open: 'מספר תגובות שהקול בהן כבר נשמע כשנפתח חלון ההקשבה (הילד/ה דיבר/ה בזמן ההנחיה); לתגובות אלו זמן התגובה נרשם כ־null ולא כ־0',
  });
  // A vocal reaction faster than this is not humanly possible; such a sound began before listening opened.
  const SOUND_AT_OPEN_MS = 100;

  const round = (value, digits = 3) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
  const toSec = (ms) => (Number.isFinite(ms) ? round(ms / 1000) : null);

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function stats(values) {
    const valid = (values || []).filter(Number.isFinite);
    if (!valid.length) return { n: 0, mean: null, median: null, sd: null, min: null, max: null, cv: null };
    const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
    const sd = Math.sqrt(valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length);
    return {
      n: valid.length, mean: round(mean), median: round(median(valid)), sd: round(sd),
      min: round(Math.min(...valid)), max: round(Math.max(...valid)), cv: mean ? round(sd / mean) : null,
    };
  }

  function intervals(times) {
    const valid = (times || []).filter(Number.isFinite);
    return valid.slice(1).map((time, index) => time - valid[index]);
  }

  function latencyMs(promptEndMs, responseMs) {
    if (!Number.isFinite(promptEndMs) || !Number.isFinite(responseMs)) return null;
    return Math.max(0, responseMs - promptEndMs);
  }

  /* Raw steadiness of a sustained sound from 10 ms analysis frames ({ db, hz }).
     audio_stability_score = share of frames within ±toleranceDb of the median level (0–1).
     pitch_stability_score = share of voiced frames within ±toleranceSemitones of the median pitch (0–1). */
  function stability(frames, { toleranceDb = 3, toleranceSemitones = 1, minVoicedFrames = 10 } = {}) {
    const levels = (frames || []).map((frame) => frame.db).filter(Number.isFinite);
    const empty = {
      frame_count: 0, median_level_db: null, amplitude_sd_db: null, amplitude_cv: null, audio_stability_score: null,
      voiced_fraction: null, median_pitch_hz: null, pitch_sd_semitones: null, pitch_stability_score: null,
    };
    if (!levels.length) return empty;
    const medianDb = median(levels);
    const linear = levels.map((db) => 10 ** (db / 20));
    const voiced = frames.map((frame) => frame.hz).filter((hz) => Number.isFinite(hz) && hz > 0);
    const result = {
      ...empty,
      frame_count: levels.length,
      median_level_db: round(medianDb, 1),
      amplitude_sd_db: round(stats(levels).sd, 2),
      amplitude_cv: stats(linear).cv,
      audio_stability_score: round(levels.filter((db) => Math.abs(db - medianDb) <= toleranceDb).length / levels.length),
      voiced_fraction: round(voiced.length / frames.length),
    };
    if (voiced.length >= minVoicedFrames) {
      const medianHz = median(voiced);
      const semitones = voiced.map((hz) => 12 * Math.log2(hz / medianHz));
      result.median_pitch_hz = round(medianHz, 1);
      result.pitch_sd_semitones = round(stats(semitones).sd, 2);
      result.pitch_stability_score = round(semitones.filter((value) => Math.abs(value) <= toleranceSemitones).length / semitones.length);
    }
    return result;
  }

  /* One execution of an OT task: timestamps every prompt and response on the audio clock. */
  function createRun(ctx, def) {
    const startedAt = Date.now();
    const t0 = T.audio.now();
    const events = [];
    const rel = (time) => toSec(time - t0);
    let lastPromptEnd = null;

    function log(type, data = {}) {
      const event = { type, t_sec: rel(T.audio.now()), ...data };
      events.push(event);
      return event;
    }

    async function prompt(text, label = null) {
      await ctx.say(text);
      lastPromptEnd = T.audio.now();
      events.push({ type: 'prompt_end', label, t_sec: rel(lastPromptEnd) });
      return lastPromptEnd;
    }

    /* Opens a listening window after the last prompt and classifies what was heard.
       A valid response is a child (non-adult) segment of at least minVoiceMs; with requireVoiced it must also
       carry pitch, so block clacks or footsteps are logged as non-voice sounds instead of responses. */
    async function awaitResponse({
      promptEnd = lastPromptEnd, maxMs = 8000, startTimeoutMs = maxMs, endSilenceMs = 1200, minVoiceMs = 250,
      minDurMs = 80, requireVoiced = true, stopOnFirst = false, aide = null, onLive, label = null,
    } = {}) {
      const signal = { cancelled: false };
      const valid = [], other = [];
      let aidePick = null;
      const isValid = (segment) => segment.manual
        || (segment.dur >= minVoiceMs && (!requireVoiced || segment.hz > 0));
      if (aide) {
        ctx.setManualPick((value) => {
          aidePick = { value, t: T.audio.now() };
          if (aide.endsWindow) signal.cancelled = true;
        });
        T.ui && T.ui.aideFeelings && T.ui.aideFeelings(true, aide.title, aide.options);
      }
      let response;
      try {
        response = await ctx.listen({
          maxMs, startTimeoutMs, endSilenceMs, minDurMs, signal,
          onLive: (type, event) => {
            if (type === 'segment') {
              (isValid(event) ? valid : other).push(event);
              if (stopOnFirst && valid.length) signal.cancelled = true;
            }
            if (onLive) onLive(type, event);
          },
        });
      } finally {
        if (aide) {
          ctx.setManualPick(null);
          T.ui && T.ui.aideFeelings && T.ui.aideFeelings(false);
        }
      }
      const first = valid.length ? valid.reduce((best, segment) => (segment.start < best.start ? segment : best)) : null;
      const source = first ? (first.manual ? 'manual' : 'audio') : aidePick ? 'aide' : 'none';
      const responseMs = first ? first.start : aidePick ? aidePick.t : null;
      const audioValid = valid.filter((segment) => !segment.manual);
      const soundAtOpen = source === 'audio' && Number.isFinite(promptEnd) && responseMs - promptEnd < SOUND_AT_OPEN_MS;
      const result = {
        source, promptEnd, responseMs, soundAtOpen,
        latencyMs: soundAtOpen ? null : latencyMs(promptEnd, responseMs),
        valid, audioValid, other, adult: response.adult, aidePick,
        windowMs: response.t1 - response.t0,
        childVoiceMs: audioValid.reduce((sum, segment) => sum + segment.dur, 0),
        adultVoiceMs: response.adult.reduce((sum, segment) => sum + segment.dur, 0),
      };
      events.push({
        type: 'response_window', label, source,
        response_t_sec: Number.isFinite(responseMs) ? rel(responseMs) : null,
        latency_sec: toSec(result.latencyMs),
        sound_at_window_open: soundAtOpen,
        utterance_count: audioValid.length,
        child_voice_sec: toSec(result.childVoiceMs),
        non_voice_sounds: other.length,
        adult_segments: response.adult.length,
        window_sec: toSec(result.windowMs),
        aide_pick: aidePick ? aidePick.value : null,
      });
      return result;
    }

    function finish({ metrics = {}, trials = [], definitions = {}, confidence = null } = {}) {
      const endMs = T.audio.now();
      const record = {
        schema: SCHEMA,
        task_key: def.key,
        task_name: def.name,
        domain: def.domain,
        task_version: def.version || 1,
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date().toISOString(),
        input_mode: T.audio.mode,
        roles: ROLES,
        metrics: {
          total_duration_sec: toSec(endMs - t0),
          responses_sounding_at_window_open: events.filter((event) => event.sound_at_window_open).length,
          ...metrics,
        },
        trials,
        events,
        definitions: { ...COMMON_DEFINITIONS, ...definitions },
        interpretation: null,
      };
      return {
        score: null,
        confidence: Number.isFinite(confidence) ? round(confidence) : null,
        total_duration_sec: record.metrics.total_duration_sec,
        ot: record,
      };
    }

    return {
      t0, events, log, prompt, awaitResponse, finish, rel,
      get lastPromptEnd() { return lastPromptEnd; },
    };
  }

  /* Registers an OT task with conservative defaults; def.execute(ctx, params, run) returns run.finish(...). */
  function register(def) {
    if (!def || typeof def.execute !== 'function') throw new TypeError('An OT task needs an execute function');
    const { execute, ...rest } = def;
    return T.tasks.register({
      slot: 'ot', arousal: 0, gross: false, jump: false, levels: 0, minAge: 3,
      modes: ['verbal', 'nonverbal'],
      ...rest,
      needs: { space: 0, hardFloor: false, standing: false, object: null, quietRoom: false, ...(rest.needs || {}) },
      params: rest.params || (() => ({})),
      ot: true,
      async run(ctx, params) {
        return execute(ctx, params || {}, createRun(ctx, def));
      },
    });
  }

  const isOtTask = (key) => !!(T.tasks.get(key) && T.tasks.get(key).ot);

  /* Dashboard payload: every raw OT record per task, oldest first. */
  function exportChild(child, sessions) {
    const tasks = {};
    (sessions || []).slice().sort((a, b) => Number(a.date || 0) - Number(b.date || 0)).forEach((session) => {
      Object.entries(session.stages || {}).forEach(([key, result]) => {
        if (!result || result.skipped || !result.ot) return;
        (tasks[key] = tasks[key] || []).push({
          session_id: session.id || null,
          session_date: new Date(Number(session.date)).toISOString(),
          session_mode: session.mode || null,
          demo: !!(session.demo || session.sample),
          ...result.ot,
        });
      });
    });
    return {
      schema: EXPORT_SCHEMA,
      generated_at: new Date().toISOString(),
      child: { id: child.id, name: child.name, age: child.age },
      notice: 'נתונים כמותיים גולמיים בלבד. אין בהם ציון, סיווג או מסקנה אבחונית; הפרשנות נעשית על ידי המטפל/ת.',
      tasks,
    };
  }

  return {
    SCHEMA, EXPORT_SCHEMA, ROLES, register, createRun, exportChild, isOtTask,
    metrics: { round, toSec, median, stats, intervals, latencyMs, stability },
  };
})();
