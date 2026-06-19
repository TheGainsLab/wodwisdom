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

## Three decisions to lock before step 4

1. **Trigger** — when does the Engine re-evaluate? (after each completed session / at phase boundaries /
   on demand). *Recommend: after each session, cheaply, plus a phase-boundary review.*
2. **Authority** — who decides? (deterministic rules over the diagnosis / AI reasoning / user-confirmed).
   *Recommend: rules-first within the guardrails — explainable and safe — AI as an optional later layer.*
3. **Guardrail scope** — strictly within the day-type taxonomy + param envelope (Lever B/C), or may it
   author novel sequences/structures? *Recommend: within taxonomy + envelope only; that's the
   authored-arc protection we designed.*

## Open coordination question

No backend sequencer exists yet, and `training_schedule` is frontend-written. **Where is the
self-sequencing logic being built** — is the team building it elsewhere, or is this workstream to build
it here? That determines whether the next concrete action is "reconcile with existing WIP" or "start the
`computeConditioningDiagnosis()` extraction."
