# Tombi: new OT tasks + smart session planner

Read this whole file before writing code. Then read `docs/tasks/tasks-spec.md` (the research report, in Hebrew). It is the source of truth for every threshold, formula and level in this prompt. Where this prompt and the spec differ, this prompt wins. Where this prompt is silent, follow the spec.

Work in the phases below, in order. After each phase the app must still run in Chrome via Live Server, in both microphone mode and simulation mode, and the six existing stages must still work. At the end of each phase, stop and print a short summary of what changed and how to test it.

---

## 0. Ground rules (do not break these)

1. **First read the current code**: `index.html`, `js/stages.js`, `js/audio.js`, `js/dsp.js`, `js/tombi.js`, `js/lines.js`, `js/storage.js`, `js/app.js`, `js/report.js`, `docs/spec.md`. My code may have changed since this prompt was written (home screen redesign, levels 1-5 per task). Adapt to what is actually there. Do not undo the home screen, the Ocupa styling, the levels rule, the PDF report or anything else in `docs/spec.md`.
2. Plain HTML/CSS/JS, classic scripts under the global `T`, no build step, no npm, no frameworks. New files go in `js/` and are linked in `index.html` in the right order.
3. **Never recognize words. Measure sound**: onset time, loudness relative to the noise floor, duration, count, sound class (stomp / clap / table / pot / ball / voice / hiss). Everything runs locally in the browser. **No audio is saved anywhere**: not in localStorage, not in IndexedDB, not as a file. Only numbers.
4. Framing: sound is only the response channel. Each task reports an OT domain (regulation, grading of force, timing, inhibition, motor planning, bilateral coordination), never a speech measure.
5. **Child view stays as it is**: only Tombi in his forest, full-screen, no text, no numbers, no buttons. A task may show only the few pictures the child needs (clouds for jumps, a stop sign for freeze, turtle/rabbit, elephant/mouse, pot/table, hand/foot icons). Feedback stays glow, sparkles, chime and the `happy` clip. Everything else (live meters, counts, confidence, buttons) goes in the hidden aide panel.
6. Hebrew gender: use the existing `G(m, f)` helper for every line. Nonverbal children get their own line variant where the instruction mentions speaking.
7. **Tombi's lines**: add every new line to `js/lines.js` by **appending at the end only**. Never reorder or renumber existing lines, because recorded files `001.mp3, 002.mp3…` are mapped by number. Every `say(text, key)` call gets a unique stable key.
8. Every task has a **simulation** path so the whole session can be demoed without a microphone (see Phase B.7).
9. Keep the code style of the existing files: short comments, same naming, same idioms.

---

## Phase A: turn the fixed stage list into a task registry

Today `STAGES` in `stages.js` is a fixed array of 6. Replace it with a registry, keeping the six existing tasks working exactly as now.

Create `js/tasks/registry.js` with `T.tasks.register(def)` and `T.tasks.get(key)`, `T.tasks.all()`. Move each task into its own file under `js/tasks/` (`engine.js`, `echo.js`, `loudness.js`, `magic.js`, `snake.js`, then the new ones). Shared helpers (`listen`, `say`, `wait`, `check`, `countPeaks`, `praise`, `G`) stay in `stages.js` and are passed in a `ctx` object.

Task definition:

```js
T.tasks.register({
  key: 'stompFreeze',            // stable id, used in saved sessions and levels
  name: 'רוקעים ונעצרים',          // shown to the aide / in reports
  domain: 'עכבה ועצירה של תנועה',   // OT domain, shown in reports
  slot: 'arousal',               // 'core' | 'rhythm' | 'arousal' | 'inhibition' | 'grading' | 'calm' | 'transition'
  arousal: 2,                    // -2 calming … +2 alerting, used for ordering and adaptation
  gross: true,                   // whole-body movement (standing)
  jump: false,                   // involves jumping
  needs: { space: 1.5, hardFloor: true, standing: true, object: null, quietRoom: false },
  modes: ['verbal', 'nonverbal'],// which tracks it supports
  minAge: 3,
  durationSec: { short: 50, full: 90 },
  levels: 5,
  params(level, age, child) { … }, // returns the parameters for this level (from the spec)
  async run(ctx, p) { … },        // plays the task, returns { score, confidence, raw… }
  simulate(p) { … },              // schedules synthetic child sounds for sim mode
  version: 1,
});
```

`run()` returns `{ score: 0-100, confidence: 0-1, level, short: bool, ...raw }`. Raw metrics are saved as today. Add `confidence` (share of events detected with a clear class and SNR ≥ 12 dB) so the report can grey out low-confidence results.

The session runner (`T.session.run`) now takes a **plan** (Phase C) instead of the fixed list. If no plan is given, it builds the default plan, which for now equals the current six stages in the current order.

Stored sessions keep the same shape: `rec.stages[key] = result`. Add `rec.plan` (the plan that was used, with reasons) and `rec.setting` (room type, equipment). Old saved sessions must still load and show in reports.

---

## Phase B: audio engine additions

All in `js/audio.js` and `js/dsp.js` unless noted. Keep the existing VAD and segments; add the new detector next to them.

### B.1 getUserMedia and clock
- Keep `echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1`. After opening, read `track.getSettings()` and store what the browser actually applied in `T.audio.applied`. Show a warning in the aide panel if any of the three is still on.
- Create the AudioContext with `latencyHint: 'interactive'`.
- All of Tombi's beats are scheduled with `source.start(ctx.currentTime + lead)`. All onsets are timestamped on the same AudioContext clock (frame index in the worklet). Do not use `setTimeout` for anything that is measured.

### B.2 Onset detector (`T.onsets`)
SuperFlux-style onset detection function on the 16 kHz stream:
- 512-point FFT, 10 ms hop, 10 log-spaced bands (50 Hz to 8 kHz), log magnitude.
- 3-band max filter across frequency, positive differences only, lag 2 frames.
- Peak picking, causal: local max over 30 ms, above the mean of the previous 100 ms plus δ, where δ = median + 4·MAD of the ODF over the last 3 s. And frame energy ≥ F + `minAboveFloor` dB (task parameter, default 10).
- Minimum inter-onset interval per task (`minIoiMs`): claps 130, table 130, pot 150, stomps 220, ball 200, jump landings 300.
- Re-trigger guard: within 80-150 ms after an onset, ignore new peaks unless they are ≥ 6 dB above the decaying envelope (room reverb).
- Timestamp: refine to the point where the envelope reaches 50% of the peak, 1-2 ms resolution, using the raw samples in the ring buffer.
- Emits `onsetX` events: `{ t, peakDb, aboveFloor, bands, feats, cls, clsConf }`.

### B.3 Sound class features and per-child calibration
For each onset compute, from 30-80 ms after it: low-band ratio `E(<300 Hz)/E(total)`, spectral centroid, zero-crossing rate, harmonicity (autocorrelation peak), decay time (−20 dB), duration of the energy burst.
- Heuristic classes as in the spec table (stomp/landing, clap, table, pot, ball, voice, hiss).
- **Per-session calibration** ("Tombi wakes up", see C.1): the child shows Tombi 3 stomps and 3 claps (plus pot and table if the planned tasks need them). Store the class centroids for this session and classify by nearest centroid on 4-6 normalized features. If the distance to the best and second-best centroid is within 15%, mark `clsConf` low and the event as "uncertain": it is not counted as an error.
- Save the centroids per child (numbers only) so the next session starts from them.

### B.4 Noise floor and SNR
- Before each task: measure F as the 15th percentile of frame dB over 2 s of quiet. **Freeze F for the duration of the task** (the adaptive floor must not learn the child's stomping or a freeze period).
- Any trial with SNR < 12 dB is flagged `repeat` and does not count. The aide panel shows a "רועש מדי" chip.

### B.5 Loopback latency calibration
At the start of a session (inside "Tombi wakes up"), play 8 short marker tones at known AudioContext times in a band the child does not produce (a 3.5 kHz chirp, 20 ms). Detect them in the mic. Median difference = `T.audio.loopbackMs`, SD = jitter. If fewer than 80% are found or jitter > 10 ms, show a warning to the aide ("רמקול Bluetooth? הגבירי עוצמה"), and use 0 ms with low confidence for timing tasks. Never trust `outputLatency`. Store per device in settings.

### B.6 Gating Tombi's own sounds
Three layers, chosen per task:
1. **Frequency separation**: in stomp/jump tasks Tombi's beat is a high woodblock/bell (energy > 1 kHz) and the stomp detector looks at < 300 Hz; in clap tasks Tombi's beat is a low drum (< 300 Hz) and claps are detected at 0.5-3 kHz.
2. **Time gating**: for every sound Tombi plays at time t, ignore onsets in `[t + loopback − 10, t + loopback + decay]` (decay 150-300 ms). Implement as `T.audio.gateWindow(t0, t1)`.
3. In tasks where the child plays **with** the beat (march), do not time-gate (it would delete the child's on-beat steps): use frequency separation only.
Also keep the existing speech gate while Tombi talks.

### B.7 Tombi's instruments and simulation
- In `tombi.js` add synthesized instruments, no audio files: `drum(when, {low|high})` (low: 60-120 Hz sine with fast pitch drop; high: woodblock, band-passed noise burst at 1.5-3 kHz), `bell(when)`, `chirp(when)`. Each returns the scheduled AudioContext time so tasks can compute asynchrony.
- Extend `T.audio.sim` with `stomp(delay, loud)`, `jumpLanding(delay, loud)` (two thumps 5-60 ms apart), `table(delay)`, `pot(delay)`, `ball(delay, loud)`, `rustle(ms)`. Each task's `simulate(p)` uses them to act like a plausible child (some timing noise, an occasional error), so every task can be shown in sim mode.

### B.8 Dev page
Add `dev/onsets.html` (not linked from the app): live ODF plot, detected onsets with class and confidence, band energies, floor, SNR. This is for tuning thresholds in a real room. Put the pure functions (ODF, peak picking, features, classifier, scoring formulas) in `js/dsp.js` / `js/scoring.js` with no DOM access, and add `dev/tests.html` that runs them on synthetic signals and prints pass/fail.

---

## Phase C: smart session planner (not overloading)

Create `js/planner.js` with `T.planner.build(child, setting, history, opts) → plan`.

### C.1 Session template (about 9 minutes, arousal curve: wake → organize → peak → inhibit → grade → calm → check)

| # | Slot | Candidates | Fixed? |
|---|---|---|---|
| 0 | "טומבי מתעורר": floor, loopback, show 3 stomps / 3 claps / normal voice | calibration | always, ~40 s, not scored |
| 1 | core: engine check | `engineStart` | always |
| 2 | rhythm (organize) | `march`, `echo`, `clapStomp` | pick 1 |
| 3 | arousal + motor inhibition | `stompFreeze`, `jumps` | pick 1 |
| 4 | inhibition | `magic`, `reverseDrum` | pick 1 |
| 5 | grading | `loudness` (incl. tunnel levels), `elephantMouse`, `ball` | pick 1, optional |
| 6 | transition | `turtleRabbit` (turtle part only, short) | always, ~40 s |
| 7 | calm | `snake` | always |
| 8 | core: engine check again | `engineEnd` | always |

### C.2 Hard filters (a candidate is not eligible if…)
- Child is nonverbal and the task has no `nonverbal` mode.
- `minAge` > child age.
- The task needs something the setting lacks: hard floor, 1.5 m free space, a pot, a ball, a quiet room. `ball` and the whisper levels of `loudness` need `quietRoom` (not in kindergarten mode).
- Child profile flags: `canJump:false` excludes `jumps`; `canStand:false` uses the seated variant where one exists (stomps seated, feet on floor) and otherwise excludes; `soundSensitive:true` lowers Tombi's drum volume and excludes level 5 of `stompFreeze` (distractor noises).
- The therapist excluded the task for this child.

### C.3 Priority among eligible candidates in a slot
```
P = 3·due + 2·need + 1·novelty − 3·playedLastSession + 4·pinned + small seeded random (date + child id)
due      = 1 if not played in the last 3 sessions (so every task gets a fresh data point for the graph)
need     = 1 if the last score < 60
novelty  = 0.5 if never played
```
Take the highest P per slot.

### C.4 Load rules (this is what keeps it from being too much)
- **At most one new (never played) task per session.** A new task starts at level 1 with a practice round that is not scored.
- At most **one jumping task** per session, and never two standing gross-motor tasks back to back without a non-standing task between them (if slot 2 and 3 are both standing gross-motor, prefer `echo` in slot 2).
- **Time budget**: default 9 min; ages 3.0-3.9 default 6-7 min; options 6 / 9 / 12 in the plan card. Estimate each task with `durationSec.full`, plus 15 s per transition. If over budget: first use `short` versions (fewer trials), then drop slot 5, then drop slot 2. Never drop core, transition or calm.
- Task length inside: no task longer than 2 min. Trials per task are capped by the task's `short`/`full` params.

### C.5 Adaptation during the session
- **After engine check at the start**: if the child chose **monkey** (too fast), swap slot 3 to `stompFreeze` with long freezes (not `jumps`), use the lower-arousal option in slot 2, and add one extra snake trial. If **turtle** (slow), prefer `jumps` or `march` (alerting) and keep slot 5. Fish: keep the plan. Record the swap reason in `rec.plan`.
- If a task scores < 30, or the aide logged ≥ 3 model/physical assists in it, or it was skipped, the next non-core task switches to its `short` version.
- If two tasks were skipped, the aide panel offers "לעבור להרגעה" (jump to transition → snake → engine end).
- If elapsed time > budget + 2 min, skip remaining optional slots automatically.

### C.6 Levels
Use the existing per-child level rule from `docs/spec.md` (1-5 per task; up after 2 sessions ≥ 80, down after 2 sessions < 40). New tasks join that rule with their own key. `params(level, age)` turns the level into concrete numbers from the spec. Only results with `confidence ≥ 0.6` count toward level changes.

### C.7 UI
- **Before "start session"**: a "תוכנית המפגש" card (Ocupa style, `oc-` classes, in the aide/therapist screen, never in the child view):
  - The planned tasks in order, each with its picture, name, level badge, minutes, and a reason chip ("לא שוחק 3 מפגשים", "חדש", "לחיזוק", "לפי בדיקת המנוע").
  - For each slot: a dropdown to swap with another eligible task from that slot, a toggle to skip it, a pin to keep it in future sessions.
  - Total time bar (green ≤ budget, orange over).
  - Setting: room type (קליניקה / בית / גן), equipment checkboxes (רצפה קשה, מקום פנוי 1.5 מ׳, סיר, כדור), budget 6/9/12.
  - Button "תכנון מחדש" re-runs the planner.
- **Child card** (edit child): new fields `canJump`, `canStand`, `soundSensitive`, excluded tasks (checkbox list).
- **Aide panel during session**: next tasks in the plan, live view per task (counts, ODF/level meter, class of last event, confidence), the existing buttons, plus "נספר" / "לא נספר" to correct the last detected event, and "לעבור להרגעה".
- **Report**: new tasks appear with their domain, raw metrics and the level. Low-confidence results are shown greyed with "זיהוי חלקי". Add the new keys to the CSV export. Keep the PDF.

---

## Phase D: upgrade existing tasks (from the critique of the Gemini ideas)

Details and formulas: spec, section "ביקורת על ארבע ההצעות של Gemini".

1. **`loudness` (עכבר ואריה) gets the tunnel as levels 3-5.** Per session calibrate the child's normal voice `L_base` (1.5 s comfortable "אאא"). Mouse band: above F + 6 dB and below L_base − 6 dB. Lion: ≥ L_base + 6 dB. Over-shout flag: > L_base + 20 dB or clipping (report it separately, it does not lower the score). Levels: 1 lion vs silence; 2 mouse/lion contrast ≥ 8 dB; 3 tunnel: mouse for 3 s then lion; 4 "the sun rises slowly": 5-step crescendo, Spearman ρ ≥ 0.8; 5 decrescendo back into the tunnel. Score formula from the spec. Levels 1-2 keep the current behaviour so old data stays comparable. Nonverbal: any voiced sound counts.
2. **`magic` (מילת הקסם) gets a lure ladder.** Level 1 Bear/Dragon (same word, Tombi's voice = "hop", sleepy dragon voice = silence); 2 "צפרדע" vs similar words; 3 bell vs lure sounds (drum, beep); 4 irregular timing; 5 rule switch with a visual cue. Go:no-go ≈ 75:25. **Every lure Tombi plays is gated** (B.6). Commission %, omission % (go window 2,500 ms), median RT on go, self-correction (onset < 250 ms that stops = 1 point, as in HTKS). Use RT in the score only from age 4.5. Nonverbal: clap or stomp instead of "hop".
3. **`snake` (נחש שקט) gets two modes.** *Capacity* (default): Tombi never says stop, he encourages; the target (age + 1 s) is a golden line on the snake, not the end; best of 3 and SD between trials. /s/ detection: E(4-8 kHz)/E(total) > 0.5, high ZCR, no F0, level > F + 10 dB. Gaps < 150 ms are ignored, > 250 ms count as a break. Stability = SD of the dB envelope over the middle 80%. Never blow into the mic: detect clipping and tell the aide. *Stop on cue* (level 4-5, inhibition): Tombi says "די!" at a random time 2-5 s, measure stop latency until the envelope drops below F + 6 dB. Score per spec.
4. **New `march` (מצעד הדרקון), replaces Gemini's "dragon steps".** Tombi plays a high woodblock beat, the child marches in place. Order: in-phase → continuation (beat stops after 8-12 beats, measure 8-12 more steps) → anti-phase only at level 5 for ages 5-6. Tempo: 400-450 ms for ages 3-4, 450-550 ms for ages 5-6. Ignore the first 2-4 steps. Metrics: phase φ, vector length R, mean asynchrony (positive = late is normal at this age), TempoMatch = median IOI / IBI, CV of ITI, drift slope. Hit window ±25% IBI (ages 3-4) / ±20% (5-6), tilted toward late. Optional 10-15 s free march first to measure spontaneous tempo. Score and levels per spec.

`echo` (הד קולי) stays as it is.

---

## Phase E: seven new tasks

All details (flow, detection, metrics, score formula, levels, adaptations, safety): spec, section "שבע משימות חדשות". Summary of what each must do:

| key | name | slot | detection | main metrics | score |
|---|---|---|---|---|---|
| `stompFreeze` | רוקעים ונעצרים | arousal | stomps < 300 Hz, ≥ F+12, minIOI 220; Tombi's beat > 1 kHz; freeze window starts 400 ms after the stop (600 ms at level 1); rustle > F+6 for > 200 ms = noisy move | StopLat, Comm (onsets in freeze), FreezeOK, RestartLat, Engage | `100·(0.5·FreezeOK + 0.25·clamp(1−(StopLat−300)/900) + 0.25·Engage)` |
| `jumps` | קפיצות הדרקון | arousal | landings < 300 Hz, ≥ F+12, minIOI 300, merge onsets within 120 ms into one landing; count landings, not height | CountErr, Overshoot (jumps after N), rate, CV_IOI, soft landing at level 4 | `100·(0.5·max(0,1−CountErr/N) + 0.2·(Overshoot==0) + 0.3·max(0,1−CV/0.4))` |
| `reverseDrum` | התוף ההפוך (Luria) | inhibition | Tombi's low drum gated; claps 0.5-3 kHz, minIOI 130; response window 150 ms after Tombi's last hit, 2,000-2,500 ms long; count 0/1/2/other | Acc over 16 items in the fixed order from the spec (after 2 practice items), imitation errors vs other errors, RT | `100·Acc`; the report shows the published age mean next to it (64% at 3.5, 81% at 4, 88% at 5, 94% at 6) |
| `turtleRabbit` | צב וארנב | transition (full version can also fill slot 2) | stomps, minIOI 220, threshold lowered to F+9 in turtle part | SMT = median IOI rabbit, SlowRatio, SlowCV, Hold | `100·(0.6·min(1,(SlowRatio−1)/1) + 0.25·Hold + 0.15·max(0,1−SlowCV/0.5))` |
| `clapStomp` | כף-רגל / סיר-שולחן | rhythm | onset + class (clap vs stomp; pot vs table) by the session centroids; uncertain = not an error. The mic cannot tell which hand: the two surfaces are placed on different sides | SeqAcc (1 − Levenshtein/len), Alt %, CV_IOI, Conf | `100·(0.6·SeqAcc + 0.25·Alt + 0.15·max(0,1−CV/0.4))` |
| `ball` | כדור הדרקון | grading (optional, quiet room only) | thumps, minIOI 200; a run of ≥ 3 onsets where each IOI is 0.6-0.9 of the previous = the ball fell, ends the streak | Streak, CV_IOI, SD of peak dB | `100·(0.6·min(1,Streak/Target) + 0.2·max(0,1−CV/0.4) + 0.2·max(0,1−SD/6))` |
| `elephantMouse` | רגלי פיל ורגלי עכבר | grading | stomps, peak dB < 300 Hz relative to F; mouse must still be ≥ F+6; calibrate 3 normal steps | Contrast (median elephant − median mouse), Sep (AUC), SD within, OverEffort (clipping), Spearman ρ at level 5 | `100·(0.5·min(1,Contrast/12) + 0.3·(Sep−0.5)/0.5 + 0.2·max(0,1−SD/6))` |

For every new task:
- Implement all 5 levels in `params(level, age)` exactly as in the spec.
- Add a practice round before the first scored trial (not scored), and teach to criterion: up to 3 explanations, as in the Luria protocol.
- Nonverbal: none of these needs speech; make sure the lines that ask to "say" something have a nonverbal variant.
- Seated variant where it makes sense (`stompFreeze`, `turtleRabbit`, `elephantMouse`: stomping while seated, feet on the floor).
- The child view shows only Tombi plus that task's pictures (see rule 0.5). Pictures go in `assets/tasks/` (I will add images made with Gemini; until then use simple inline SVG placeholders, never emoji in the final child view).
- Safety line for the aide shown before the task in the panel (space, floor, socks, device out of the ball's way).
- A `simulate(p)` path.
- Write the Hebrew lines with `G()`; I will refine the wording with Gemini later, so keep each line in `lines.js` and do not hard-code text in other places.

---

## Phase F: check before you finish

1. Sim mode: run three full sessions for three demo children (age 3 verbal, age 5 nonverbal, age 6 with `canJump:false`). Each must finish in the planned time ±1 min, follow the load rules, and save sessions that show in the report, the graph, the PDF and the CSV.
2. Planner unit checks in `dev/tests.html`: no two new tasks in one session; ≤ 1 jump task; budget respected; monkey/turtle swaps; nonverbal filter; kindergarten mode excludes `ball` and tunnel whisper levels.
3. Detection checks in `dev/tests.html` on synthetic signals: stomp vs clap classification, min IOI, re-trigger guard, landing merge (two thumps 40 ms apart = 1 landing), gating removes Tombi's beat, ball "fell" detection.
4. The six existing stages give the same scores as before on the same simulated input (no regression).
5. No audio is stored anywhere (search the code for `Blob`, `MediaRecorder`, IndexedDB writes of audio).
6. Update `README.md` (Hebrew): the new tasks table, the plan card, the setting options, the dev page, and a "כיול בשטח" section listing every threshold that should be tuned after real sessions.

Print at the end: the list of files changed, how to open the plan card, and which thresholds are design guesses that need tuning in the pilot.
