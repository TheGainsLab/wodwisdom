# Whole-Athlete Integration — All-Access (Programming + Engine)

How to make the two siloed programs behave like one coached athlete. Builds on the conditioning-state
read layer (`docs/conditioning_state_spec.md`, `_shared/conditioning-state.ts`).

## Governing principle (read this first)

> **All-access = a complete AI program AND a complete Engine, both at FULL footprint, surfaced in one
> calendar. Choosing both never shrinks either one.**

All-access users are high-volume athletes (two-a-days, lots of gym time) or pick-and-choosers. They pay
for two full products *because they want both in full*. Therefore:

- **Additive, not substitutive.** The Engine session is shown **alongside** the program's full day
  (metcon included), never in place of it. The unified calendar is a **superset** of both programs.
- **Same-day Engine + metcon is expected**, not a conflict to resolve away — it's the two-a-day they want.
- **No volume budgeting / deduplication.** The program is generated at full footprint independent of
  Engine cadence; the Engine runs its full cadence.
- **Pick-and-choose.** The calendar presents the full menu of both; the athlete picks what they do; the
  AI coaches based on what they *actually* complete.

The AI's role across both programs is **coordination + honest fatigue flagging — never subtraction.**

## The problem (sharpest for all-access)

An all-access athlete runs **two programs at once**: the AI-generated CrossFit/strength program
(`generate-program-v3`, calendar-structured, `days_per_week`) and the self-paced Engine
(720-day conditioning, on its **own separate route tree** `/engine/*` with its own dashboard, training,
review, and analytics UI). The **read** layer is now cross-aware (profile/training analysis see both).
The **generate/act** layer is not — the two programs don't *meet* anywhere. The real gaps (note: NOT
"too much volume" — that's wanted):

- **No single calendar** — the athlete manages two apps; nothing shows the combined day/week.
- **No sequencing help** — on a day with both a hard metcon and a hard Engine piece, nothing advises
  order / AM-PM / relative intensity.
- **Genuine overreaching can hide** — the readiness signal counts Engine load only; the strength/metcon
  load sits on top, unseen. (The fix is *flagging*, not trimming.)
- **No complementary awareness** — the program can't *choose* to lean into its lane (mixed-modal) when
  it knows the Engine owns monostructural aerobic work. (A quality option, never a reason to write less.)

## The key architectural split

The Engine is **self-paced** ("next in sequence whenever you show up") — it has no calendar binding.
The generated program **is** calendar-structured. So at *generation time* you know the program's days
but **not** which calendar day the athlete will do a given Engine session. That forces two distinct
signals with different time horizons and consumers — do **not** conflate them:

| Signal | Horizon | Knows day alignment? | Consumer | Used for |
|---|---|---|---|---|
| **Structural awareness** | the month ahead | No (Engine self-paced) | program **generation** | complementary *emphasis* only |
| **Acute combined readiness** | today | Yes (today's Engine session is known) | **daily coach** / adjust-workout | sequencing + overreaching flags |

> Neither signal *subtracts*. Generation uses structural awareness to shape the program's *character*
> (lean into mixed-modal) at full footprint. The daily coach uses acute readiness — where today's Engine
> session IS knowable — to advise **sequencing** (order, AM/PM) and to **flag genuine overreaching**.
> The split is forced by the Engine being self-paced; day-level *planning* can only happen at coaching
> time, and even then it advises, it doesn't trim.

---

## Part A — Unified readiness (spans both programs)

**Today:** `buildConditioningState` fatigue = Engine RPE/ratio only.

**Add** a sibling helper `buildAthleteLoadState()` that merges:
- **Engine load** — sessions/week, recent RPE, performance-ratio trend (already computed).
- **Programming load** — `workout_logs` density (sessions/week), recent block RPE
  (`workout_log_entries.rpe`), rough volume.

→ a transparent, confidence-gated weekly-load + acute-readiness summary (same heuristic style — no
black box). Keep `conditioning-state.ts` pure/Engine-only and reusable; `buildAthleteLoadState`
*composes* it with the programming side.

It **advises, it doesn't auto-trim.** Default is full volume; the coach helps the athlete *sequence* the
two sessions and only suggests backing off on *genuine* fatigue signals (RPE climbing, output dropping,
HR drift) — as a recommendation the athlete can take or leave, respecting that they chose this load.

**Consumers — and why it must hit BOTH UIs.** The two programs live on **separate routes**: the Engine
coach is reached from `/engine/training/:day/review` (calls `chat` with `engine_program_day`), while the
programming coach/adjust-workout is reached from the main app. Neither UI shows the whole athlete — only
the shared backend signal does. So the combined readiness must be injected into **both** coach surfaces:
- **chat, Engine side** (`engine_program_day` present): "you've got a hard metcon logged today too —
  do this Engine threshold piece fresh in the AM, metcon in the PM."
- **chat, programming side + adjust-workout / finalize-modification**: sequencing advice, and an
  *optional* scale suggestion only when genuine overreaching shows — never an automatic reduction.

The athlete hits these on different days from different routes; the backend signal is the only place the
two programs meet.

---

## Part B — Engine-aware program generation

Target is **`generate-program-v3`** only — it consumes `buildWriterPayload()` / `WriterPayload`
(`generate-program-v3/index.ts:704`). v2 is a deprecated iterative step and is not touched.

Add an optional field to `WriterPayload` (`_shared/build-writer-payload.ts`):

```ts
/** Present only for all-access athletes with Engine data; null otherwise. */
concurrent_conditioning: {
  active: true;
  program_version: string;            // '5-day' | '3-day'
  engine_sessions_per_week: number;   // structural weekly conditioning the program must coexist with
  modalities: string[];               // which ergs they use (row/bike/ski)
  energy_systems: {                   // from the SAME roll-up as conditioning-state
    AB: Status; AP: Status; LT: Status; GL: Status;  // 'strong'|'solid'|'lagging'|'unknown'
  };
} | null;
```

Populated in `buildWriterPayload()`, gated on: has `programming` entitlement **and** Engine data
present. Pure-programming athletes → `null` → generation unchanged. Pure-Engine athletes don't generate.

**Writer-prompt rules** (added to the v3 system prompt when the field is present). The field is for
*awareness and complementary emphasis only* — *never* to reduce the program's footprint:

1. **Generate a complete program at full footprint.** The athlete chose both products and wants both
   in full. Do **not** shrink volume, drop metcons, or lower intensity because the Engine exists. The
   combined week is *supposed* to be high — that's what they bought.
2. **Lean into your lane (optional, quality only).** You may *emphasize* what the program does best —
   mixed-modal, barbell cycling, gymnastics under fatigue — knowing the Engine covers monostructural
   aerobic/glycolytic work. This shapes *character*, not *amount*. Never write less; just need not be
   the sole source of pure-erg conditioning.
3. **Same-day coexistence is fine.** A program day may carry a full metcon even though the athlete also
   has an Engine session that day — that two-a-day is intended. Sequencing is the daily coach's job
   (Part A), not generation's.
4. **Never re-prescribe or replace the Engine.** The Engine stays the authored, separate program at its
   full cadence. Generation neither selects Engine content nor trims its own to make room.

---

## Shared source of truth (refactor first)

Extract a structured `computeConditioningDiagnosis()` from `conditioning-state.ts` (calibration +
energy-system roll-up + weak roots) returning a typed object. Then:
- `buildConditioningState` formats it as the text block (read layer),
- `buildWriterPayload` maps it into `concurrent_conditioning` (generation),
- `buildAthleteLoadState` consumes it (readiness).

One computation, three consumers — no drift.

## Build order

1. **Refactor** — extract `computeConditioningDiagnosis()` as the single source.
2. **Part B** — `concurrent_conditioning` payload field + population (entitlement-gated) + v3 writer
   rules. (Highest value for all-access; structural, low-risk.)
3. **Part A** — `buildAthleteLoadState()` merging both programs → wire into **both** coach surfaces
   (chat Engine-side and programming-side) + adjust-workout.
4. Tests + runtime verification (one all-access fixture end-to-end).

## Scope guardrails

- Activates only for all-access; programming-only and engine-only paths unchanged.
- Generation gains *awareness*, not control over the Engine — coexistence, never re-prescription.
- All signals heuristic, transparent, confidence-gated, consistent with the read layer.

---

## Constraint: there is no "Engine-as-block" primitive (awareness is the ceiling)

Today an Engine session **cannot be inserted into an AI-generated program**. Three separate systems
would each have to change:

1. **Schema** — v3 block types are movement-based only (`warm-up, mobility, skills, strength,
   accessory, metcon, active-recovery, cool-down`); blocks are made of `program_movements_v2`. An
   Engine session is a day_type + modality + interval structure, not movements. No block type can
   hold "Engine Day 184."
2. **Execution UI** — Engine runs in its own runner (`EngineTrainingDayPage`: timer, modality, pace
   targets, pace/HR/RPE logging → `engine_workout_sessions`); program blocks render/log as movements
   → `workout_logs`. Separate execution + logging paths.
3. **Progression** — the Engine owns `current_day`, `months_unlocked`, time-trial baselines, and the
   performance metrics; a program day has none of that.

**Consequence:** Part B (awareness) is the ceiling without new plumbing. The two programs run in full but
never *meet* on one calendar; the athlete still manages two apps. The bridge below fixes the calendar
unification — **additively** (it surfaces the Engine session alongside the full program day, it does not
replace anything).

### The bridge (separate track, after Part B): an `engine_conditioning` block type

A new block type referencing an Engine session would surface it *inside* the program calendar — **as an
additional block alongside the full program day, never replacing the metcon.** The unified calendar is a
**superset** of both programs (full AI program day + the Engine session, including same-day two-a-days).
Two flavors, very different in risk:

- **Surface / reference (recommended first):** the program shows a deep-link card ("Engine →
  your next Engine session → Open in Engine") on the calendar, added to whatever else that day holds.
  The Engine keeps execution + progression; the program becomes the home-base calendar that points to it.
  Unifies the calendar and
  gives day alignment, low risk, preserves both systems' authority. Completion read back from
  `engine_workout_sessions`.
- **Orchestrate (deferred):** the generator selects specific Engine day_types and schedules them as
  part of its own periodization. This reaches into the Engine's authored 720-day sequence (**Lever B**)
  and fights its 5-day cadence — the authored-arc decision we are deliberately deferring.

This bridge is what would collapse the structural/acute split (generation would *know* day alignment
because it placed the session) — but only by accepting progression coupling. Treat as its own track.
