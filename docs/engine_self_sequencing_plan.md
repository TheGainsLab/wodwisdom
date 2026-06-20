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
