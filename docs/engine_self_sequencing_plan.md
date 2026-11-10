# Engine Self-Sequencing — Plan & Sequencing Decision

## Decision: build Engine self-sequencing BEFORE combining with AI programming

The Engine gaining the ability to adapt its own sequence ("self-aware") comes **first**; the all-access
combining work (unified coordination, generation awareness) comes **after**.

Why:
- **Self-sequencing redefines "the Engine's next session"** — the exact thing every combining feature
  points at. Building integration on a mid-flux sequence definition means rework.
- **It stands alone** — it improves the experience for the *entire* Engine user base, not just the
  all-access subset. Bigger, more differentiated win, and it's the original "use the deep conditioning
  data" opportunity.
- **Risk containment** — self-sequencing is sensitive on its own (mutable per-user sequence, authored-arc
  integrity, Lever B/C guardrails). Don't layer all-access coordination on top simultaneously.

## Two compatibility constraints (carry these through the Engine build)

These keep the later combining work nearly free instead of forcing a re-bridge:

1. **Build on the shared diagnosis.** The sequencer's decision input is
   `computeConditioningDiagnosis()` (calibration gate + AB/AP/LT/GL roll-up + weak roots + trends, from
   `conditioning-state.ts`). It is *also* the integration's brain. Building it here (for the more
   demanding consumer) makes it robust for the prompt-awareness consumer for free. Not "starting the
   combining project" — it's the Engine's own decision layer.
2. **Persist the adapted sequence to `training_schedule`.** That table is already per-user, mutable, and
   dual-program (`program_workout_id` XOR `engine_workout_id`, same-date coexistence allowed; `engine_
   schedule_once` enforces once-per-engine-day). If the self-aware Engine expresses its adapted order as
   engine rows there, the unified all-access calendar **falls out automatically**. Sequence onto a
   private table instead and you'll have to re-bridge later.

The shipped read layer (conditioning-state in chat / training-analysis / profile-analysis / workout-
review) stays as-is — independent and harmless; all-access users already get cross-aware *analysis*.

---

## Current state (what exists today)

- **Sequence authority = static.** "Next Engine day" is the `engine_current_day` pointer walked against
  the fixed `engine_program_mapping` (`src/lib/engineService.ts` → `getWorkoutsForProgram`,
  `advanceCurrentDay`). No adaptation.
- **`training_schedule`** — per-user dual-program dating overlay, written from the frontend
  (`src/lib/trainingSchedule.ts`); NOT yet the sequence authority. `engine_schedule_once` = one row per
  engine day per user.
- **Diagnosis read layer** — `_shared/conditioning-state.ts`: calibration, energy-system roll-up, weak
  roots, fatigue. Currently formats a prompt block only (no structured export yet).
- **Competency model** — TS constant in `conditioning-state.ts` + `docs/engine_competency_graph.md`:
  tiers, energy-system tags, dev/assess class, prerequisite edges, and (per day-type) the
  `block_N_params` envelopes that bound Lever C.

## Build plan

1. **Extract `computeConditioningDiagnosis()`** — refactor `conditioning-state.ts` so the structured
   diagnosis is a typed object (current text block becomes one formatter over it). Single source for
   sequencer + integration + read layer.
2. **Encode the competency graph as a queryable decision model** — tiers, prerequisite edges, dev/assess
   class, and each day-type's `block_N_params` envelope, so the sequencer reasons over data not prose.
3. **Lock the re-sequencing policy (needs 3 decisions — see below).**
4. **Build the sequencer** — input: diagnosis + graph + current position. Output: next action within the
   guardrails — keep default next / substitute same-tier variant / insert weak-root exposure / hold or
   advance phase (Lever B); later, tune params within envelope (Lever C). Deterministic and explainable.
5. **Make `training_schedule` the "next" authority** — sequencer writes engine rows; runner/dashboard
   resolve "next" from the adapted schedule (fall back to mapping), preserving once-and-done + months
   gating. Touches `engineService.ts` next-day resolution + `advanceCurrentDay`.
6. **Guardrails** — validity gating (don't adapt on stale time trials / `rolling_count < 2`), respect
   `engine_months_unlocked`, never exceed a day-type envelope or break authored-arc coherence.
7. **Explainability** — "why did the Engine change this?" from `coaching_intent` + the diagnosis
   ("inserted an extra threshold exposure — your LT is lagging").
8. **Tests + runtime verification** (pure decision-policy tests + one end-to-end fixture).

## Locked decisions (the architecture)

The flow:

```
completed engine_workout_sessions
        ↓
computeConditioningDiagnosis()   ← our model (calibration + AB/AP/LT/GL roll-up + weak roots + fatigue)
        ↓                          (built: supabase/functions/_shared/conditioning-state.ts)
AI sequencer  +  day-type catalogue (engine_day_types: coaching_intent, block_N_params envelope;
        ↓                            competency graph: tiers + prerequisite edges)
generated days saved as engine_workouts rows; engine_user_day_overrides maps the user's
upcoming positions (current_day, +1, ...) → those generated workouts
```

The Engine queue is **position-based** (`engine_current_day` = highest completed + 1; the dashboard /
runner resolve a day by position). Month-unlock is the access/billing unit (12-20 days); the operating
unit is **sequential weekly completion** (athletes are counseled to it — jumping breaks the AI). The
sequencer overrides only the **content** at the next week's positions; progression, access gating and the
UI are untouched. Positions beyond the generated week fall back to the static catalog until the user
finishes the week and the next run fills them. Trigger is **completion-driven** (finish the generated
week → generate the next), gated on >= 10 completed days.

- **Build location:** here (no existing WIP — only the manual scheduling rails + the diagnosis brain).
- **Trigger:** **weekly, starting after the athlete completes 10 Engine days** (those first 10 build the
  baseline — sessions + time trials — needed for a valid diagnosis; the loop no-ops before then).
- **Authority:** **all AI.** The AI makes the re-sequencing decision from the diagnosis + catalogue.
  (Not deterministic rules.) A deterministic **validation** layer still enforces the guardrails on the
  AI's output.
- **Guardrail scope:** **taxonomy + parameter envelope only** (settled). Substitute same-tier day-types,
  insert weak-root exposures, hold/advance phase, tune params within each day-type's `block_N_params`
  ranges. Never author novel day-types/structures.

### Generative, not selective

The 22 day-types are a **generative grammar**, not a 720-day list to pick from. Picking a pre-authored
catalog day is deterministic and needs no AI — **generation within the envelope is the whole reason to
use AI.** The AI generates a concrete day by choosing values inside a day_type's `block_N_params`
envelope (Lever B = which day_type, Lever C = the params, together). A generated day has the **same
`block_params` shape as a catalog day**, so the Engine runner executes it unchanged: persist the
generated workout as an `engine_workout` row, then schedule it in `training_schedule`. The catalogue is
effectively unlimited; the validator guarantees every generated value stays inside the authored bounds.

## Remaining build (revised)

1. ✅ **`computeConditioningDiagnosis()`** — structured single-source diagnosis (done;
   `conditioning-state.ts`). The AI's input.
2. **Catalogue payload** — expose the day-type taxonomy (coaching_intent + `block_N_params` envelopes)
   and competency graph (tiers + prerequisite edges) as the AI's option space. *Re-add prerequisite edges
   to code (removed in the position-free cleanup).*
3. ✅ **AI sequencer edge function** (`engine-resequence`) — gate (>=10 completed days) → diagnosis +
   catalogue + current phase → `callClaude` → `parseProposal` → `validateProposal` → persist accepted
   days as `engine_workouts` rows + schedule in `training_schedule`. `dry_run` supported.
4. ✅ **Guardrail validation** — `validateProposal` deterministically rejects any AI output outside the
   taxonomy or a day-type's envelope before persistence.
5. ✅ **Per-user position override** — `engine_user_day_overrides` (migration) maps a user's
   `sequence_position` → a generated `engine_workout`. `engine-resequence` writes overrides at positions
   `current_day..+N-1` (not `training_schedule`). `getWorkoutsForProgram` + `loadWorkoutForDay` swap the
   generated content in at overridden positions and fall back to the catalog elsewhere. Pure content
   swap; dashboard/runner/logging/access-gating unchanged.
6. ✅ **Intensity ownership (#4)** — on AI days (`program_type 'gen:'`) the runtime target drops the
   rolling multiplier (`effectiveRollingMult` in `EngineTrainingDayPage`); the AI's paceRange IS the
   target, rolling becomes a read-only sensor. No-op for catalog days.
7. ✅ **Automatic trigger (#5)** — server-side cron (`engine-resequence-cron`) runs the shared
   `runResequence()` core for opt-in athletes (`athlete_profiles.engine_ai_sequencing`, default false)
   whose current block is consumed (`current_day` past their highest override). No client involvement,
   self-healing, test-user-gated. `engine-resequence` (HTTP) is now a thin wrapper over the same core for
   admin dry-run preview.

### Rollout / ops
- Apply migration `20260620100000_engine_ai_sequencing_flag.sql`.
- Deploy `engine-resequence` + `engine-resequence-cron` (the latter is `verify_jwt=false`).
- Schedule the cron via pg_cron (e.g. every 15 min).
- Enable test athletes: `UPDATE athlete_profiles SET engine_ai_sequencing = true WHERE user_id = '…'`.
- Widen by bulk-enabling / flipping the default once validated. The flag is also a per-user kill-switch.

---

## Addendum (2026-11-10): assessment month, intake, and tracks → settings

Founder decisions from the retention review (the Luke Manchester case and the
subscriber funnel: of 59 retail Engine subscribers, 21 have reached the 10-day
sequencer gate; 8 of the 12 who cancelled had completed four days or fewer).
The sequencer cannot help anyone who leaves before it starts, and the tracks
were the pre-sequencer way of offering variety. With a sequencer, both give
way to one curriculum plus a small set of athlete settings.

### The thesis, stated once

Give the AI the information it needs and it makes better sequencing judgments
than a hand-authored easy-to-hard list. Every existing track is already an
instance of that thesis done by hand (Hyrox opens with towers, VO2 opens with
devour — month-25 and month-19 types in the main curriculum). The sequencer is
the same act, per athlete, live.

One rule stays outside the AI because it is a product decision, not a
training judgment: **the reveal rate** — how fast new stimulus types are
introduced over the life of the subscription (the "novelty budget"). The AI
has full freedom inside it.

### Intake (new subscribers)

Two required choices and two context questions. No track picker.

1. **Days per week: 3, 4 or 5.** The one structural commitment. Sets the
   month length (12 / 16 / 20 positions) for the program's life; the sequencer
   never changes day count.
2. **Goal.** Presets that carry the old track names (General engine, VO2 max,
   Race prep / Hyrox) plus a free-text line. Writes `engine_goal`; later shapes
   emphasis and reveal rate from month two.
3. **What else do you train each week?** Feeds the sequencer's other-load
   awareness (already supported).
4. **Which machines will you use?** Steers time trials to the modalities the
   athlete will actually rotate, and sizes expectations about per-modality
   data (see diagnosis roll-up below).

### Month one is an assessment month — the same for every goal

Any serious protocol tests before it prescribes. Month one is the test, and
the product says so ("Month one is your assessment: the Engine is learning
how you respond to each kind of work"). Goal shaping begins in month two.

| Cadence | Month-one types | Positions | Exposures per type |
|---|---|---|---|
| 3-day | anaerobic, max aerobic power, endurance | 12 | 4 / 4 / 3 |
| 4-day | anaerobic, max aerobic power, threshold, endurance | 16 | 4 / 4 / 3 / 4 |
| 5-day | the written 5-day month one | 20 | 4 / 4 / 4 / 3 / 4 |

The 4-day month swaps interval (close to max aerobic power in what it
measures) for threshold (a distinct system). Proposed layout, derived from
the written 5-day month by dropping its four interval days and keeping the
pinned time trial:

```
 1 TT   2 ana   3 end   4 MAP   5 ana   6 end   7 MAP   8 thr
 9 end 10 MAP  11 thr  12 ana  13 MAP  14 thr  15 ana  16 end
```

**Time trials are unchanged:** day one of every month, pinned, the monthly
recalibration. The month-two time trial is simply the first retest; the
sequencer's first generated block follows it.

### Sequencer gate: a criterion, not a day count

Replace `MIN_COMPLETED_DAYS = 10` with: **at least two scored sessions in
every stimulus type the current month uses**, capped at 10 completed days so
nobody waits longer than today. Each assessment month above satisfies the
criterion by its final week; it is the condition the number 10 was standing
in for. Month-one decisions are low-stakes (which of three to five primitives,
and dose), so an early wrong call costs one ordinary session.

### Diagnosis: roll ratios up across modalities per type

Ratios are tracked per (day type, modality). An athlete rotating four
machines feeds each cell a quarter of the data and starves the diagnosis for
months. Keep modality for **pacing** (per-modality baselines are correct);
roll ratios up **per type** for the sequencer's judgment.

### Show the judgment on every day

The sequencer writes a "why today" line on generated days. Give static
catalog days one too, from the day type's `coaching_intent`. A fixed
assessment month then reads as authored, not arbitrary — the cheapest
retention lever in this document.

### Tracks → settings (migration)

Each track is cadence + emphasis + reveal rate. Existing subscribers receive
the settings their track implies; their position carries over; the authored
mappings stay in the database as the fallback plan and the novelty budget.
Track names survive as goal presets.

| Track | Days/wk | Goal preset | Reveal | Subscribers (2026-11-10) |
|---|---|---|---|---|
| main_5day | 5 | General | 36-month | 22 |
| main_3day | 3 | General | 36-month | 19 |
| vo2max_4day | 4 | VO2 max | 12-month | 8 |
| vo2max_3day | 3 | VO2 max | 12-month | 3 |
| main_3day_varied | 3 | General | 12-month | 3 |
| hyrox_3day | 3 | Race prep | 12-month | 2 |
| main_5day_varied | 5 | General | 12-month | 1 |
| hyrox_5day | 5 | Race prep | 12-month | 1 |

The Mini Cycle tracks are the sequencer's job by definition (same material,
reordered) and retire first. The VO2 tracks are the most engaged cohort
(median 8 days done); whatever replaces them must still produce a month two
that opens with devour and infinity for a VO2 goal — test the sequencer
against those athletes' actual months before retiring the mapping.

### Coach: tell the truth about adaptation

The Coach must describe both mechanisms in one answer: pace targets adapt
from the first sessions (rolling multiplier, live for everyone); the
sequence of sessions adapts after the assessment month (sequencer). It must
never deny the sequencer exists, and never pitch a paid tier to a paying
subscriber unless asked. (Separate PR to the chat prompt.)

### Metric

Share of new subscribers who complete **five Engine days in their first
three weeks**. Secondary: share reaching ten. Compare the first sequencer
cohort against the 21 static-sequence athletes past day ten on day-five
retention and ratio improvement.

### Order of work

1. Gate criterion (two scored sessions per type, cap 10) — `run-resequence.ts`.
2. "Why today" on static days — day page + `coaching_intent`.
3. Diagnosis roll-up across modalities — `conditioning-state.ts`.
4. Intake questions and `engine_goal` presets — onboarding + Engine dashboard.
5. Author the 4-day general month one (16-row mapping) once the layout above is approved.
6. Tracks → settings migration; hide the track picker for new subscribers.
7. Novelty budget as an explicit rule in the sequencer's pool computation.

### All Access: one goal, shared plans, one leader (decided 2026-11-10)

1. **One goal.** Intake asks it once. For All Access the Engine setup
   pre-fills from the profile goal and lets the athlete refine it for
   conditioning; both generators read the same text with the Engine addition
   appended. Two goal boxes for one person is a latent inconsistency.
2. **The sequencer sees Programming's upcoming week.** Today it reads
   Programming's *logged* load (workout_log blocks/entries + external
   activities). Add the next seven days of generated strength and metcon
   blocks so it can place a hard anaerobic day away from a heavy squat day
   instead of discovering the collision in the log. This mirrors what
   Programming already receives from the Engine (trailing 28-day zone
   minutes + projected 4 weeks).
3. **Direction of authority unchanged.** Programming flexes around the
   Engine's plan (the existing Engine-awareness contract). The Engine knows
   Programming's plan and avoids collisions, but never rewrites its
   curriculum because a strength block is heavy. Two mutually adapting
   systems oscillate; one leads, one follows, and the Engine's deterministic
   grammar makes it the natural leader.

### New-subscriber sequence (decided 2026-11-10)

Checkout complete → **Engine setup** (days per week: 3 or 5 until a 4-day
month exists; one free-text goal/week-context box, pre-filled from the
profile goal for All Access) → **assessment-month briefing** (Day 1 time
trial, the month's type counts for the chosen cadence, the retest day, two
lines on how adaptation works) → **Start Day 1**. The track picker stays
behind Switch Program for existing subscribers until the tracks → settings
migration. The Coach prompt carries the same assessment-month sentence.
