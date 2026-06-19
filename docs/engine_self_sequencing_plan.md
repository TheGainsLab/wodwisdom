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
adapted sequence written to training_schedule (engine rows)
```

- **Build location:** here (no existing WIP — only the manual scheduling rails + the diagnosis brain).
- **Trigger:** **weekly, starting after month 1** (month 1 builds the baseline data — sessions + time
  trials — needed for a valid diagnosis; no adaptation before then).
- **Authority:** **all AI.** The AI makes the re-sequencing decision from the diagnosis + catalogue.
  (Not deterministic rules.) A deterministic **validation** layer still enforces the guardrails on the
  AI's output.
- **Guardrail scope:** **taxonomy + parameter envelope only** (settled). Substitute same-tier day-types,
  insert weak-root exposures, hold/advance phase, tune params within each day-type's `block_N_params`
  ranges. Never author novel day-types/structures.

## Remaining build (revised)

1. ✅ **`computeConditioningDiagnosis()`** — structured single-source diagnosis (done;
   `conditioning-state.ts`). The AI's input.
2. **Catalogue payload** — expose the day-type taxonomy (coaching_intent + `block_N_params` envelopes)
   and competency graph (tiers + prerequisite edges) as the AI's option space. *Re-add prerequisite edges
   to code (removed in the position-free cleanup).*
3. **AI sequencer edge function** — assemble prompt (diagnosis + catalogue + guardrails + current
   position + upcoming window) → Claude call with a structured output schema → the proposed adapted
   sequence. Use `_shared/call-claude.ts`.
4. **Guardrail validation** — deterministically reject/repair any AI output that leaves the taxonomy or a
   day-type's param envelope before it is persisted.
5. **Persist to `training_schedule`** — write engine rows; runner/dashboard resolve "next" from the
   adapted schedule (fall back to mapping). Preserve once-and-done + months gating.
6. **Weekly trigger** — cron gated on month ≥ 2; explainability ("why did the Engine change this?") from
   `coaching_intent` + diagnosis; tests + one end-to-end fixture.
