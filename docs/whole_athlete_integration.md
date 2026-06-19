# Whole-Athlete Integration — All-Access (Programming + Engine)

How to make the two siloed programs behave like one coached athlete. Builds on the conditioning-state
read layer (`docs/conditioning_state_spec.md`, `_shared/conditioning-state.ts`).

## The problem (sharpest for all-access)

An all-access athlete runs **two programs at once**: the AI-generated CrossFit/strength program
(`generate-program-v3`, calendar-structured, `days_per_week`) and the self-paced Engine
(720-day conditioning, on its **own separate route tree** `/engine/*` with its own dashboard, training,
review, and analytics UI). The **read** layer is now cross-aware (profile/training analysis see both).
The **generate/act** layer is not. Concrete risks:

- **Concurrent-load conflict** — a hard metcon prescribed on top of a hard Engine session.
- **Redundant conditioning** — the program adds steady erg intervals the Engine already owns.
- **Blind to true gaps** — the program can't bias toward a lagging energy system it can't see.
- **Readiness underestimated** — the conditioning-state fatigue signal counts Engine load only;
  the strength/metcon load sits on top, unseen.

## The key architectural split

The Engine is **self-paced** ("next in sequence whenever you show up") — it has no calendar binding.
The generated program **is** calendar-structured. So at *generation time* you know the program's days
but **not** which calendar day the athlete will do a given Engine session. That forces two distinct
signals with different time horizons and consumers — do **not** conflate them:

| Signal | Horizon | Knows day alignment? | Consumer |
|---|---|---|---|
| **Structural conditioning load** | the month ahead | No (Engine self-paced) | program **generation** |
| **Acute combined readiness** | today | Yes (today's Engine session is known) | **daily coach** / adjust-workout |

> Generation deconflicts at the **weekly-load / structural** level. Day-level deconfliction happens at
> **daily-coaching** time, when today's actual Engine session is knowable. This split is forced by the
> Engine's self-paced design, and trying to do day-level planning at generation time would be wrong.

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

**Consumers — and why it must hit BOTH UIs.** The two programs live on **separate routes**: the Engine
coach is reached from `/engine/training/:day/review` (calls `chat` with `engine_program_day`), while the
programming coach/adjust-workout is reached from the main app. Neither UI shows the whole athlete — only
the shared backend signal does. So the combined readiness must be injected into **both** coach surfaces:
- **chat, Engine side** (`engine_program_day` present): "you've also done 4 programming sessions this
  week — today's Engine threshold piece is fine, but keep it controlled."
- **chat, programming side + adjust-workout / finalize-modification**: scale today's metcon when the
  athlete also has Engine load stacked up this week.

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

**Writer-prompt rules** (added to the v3 system prompt when the field is present):

1. **Don't duplicate Engine volume.** The athlete already does N conditioning sessions/week on the
   Engine. Bias *this program's* conditioning down, and toward **complementary** stimuli (mixed-modal
   CrossFit metcons, gymnastic-conditioning), not steady erg intervals the Engine already owns.
2. **Reduce metabolic redundancy week-wide.** Exact day alignment is unknown, so don't try to dodge a
   specific Engine day — instead lower the program's overall same-system metabolic load so the *combined
   week* is balanced.
3. **Treat the combined week as the real frequency.** Effective load ≈ `days_per_week` + Engine
   sessions/week. Set program volume/intensity against the combined total, not `days_per_week` alone.
4. **Support gaps in its own lane, don't double-dose.** If LT is lagging, the program may support it via
   tempo/pacing choices — coordinated with, not stacked on, the Engine.
5. **Never re-prescribe or replace the Engine.** The Engine stays the authored, separate program.
   Generation only adjusts *its own* conditioning to coexist.

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

**Consequence:** Part B (awareness) is the ceiling without new plumbing. Generation can be told *not to
duplicate* the Engine, but it cannot *place* an Engine session. The two programs coordinate only by
avoidance, and generation stays structural (no day alignment) — see the split table above.

### The bridge (separate track, after Part B): an `engine_conditioning` block type

A new block type referencing an Engine session would let generation actually place conditioning. Two
flavors, very different in risk:

- **Surface / reference (recommended first):** the program drops a deep-link card ("Conditioning →
  your next Engine session → Open in Engine") on its conditioning days. The Engine keeps execution +
  progression; the program becomes the home-base calendar that points to it. Unifies the calendar and
  gives day alignment, low risk, preserves both systems' authority. Completion read back from
  `engine_workout_sessions`.
- **Orchestrate (deferred):** the generator selects specific Engine day_types and schedules them as
  part of its own periodization. This reaches into the Engine's authored 720-day sequence (**Lever B**)
  and fights its 5-day cadence — the authored-arc decision we are deliberately deferring.

This bridge is what would collapse the structural/acute split (generation would *know* day alignment
because it placed the session) — but only by accepting progression coupling. Treat as its own track.
