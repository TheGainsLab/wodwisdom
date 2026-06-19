# Whole-Athlete Integration — All-Access (Programming + Engine)

How to make the two siloed programs behave like one coached athlete. Builds on the conditioning-state
read layer (`docs/conditioning_state_spec.md`, `_shared/conditioning-state.ts`).

## The problem (sharpest for all-access)

An all-access athlete runs **two programs at once**: the AI-generated CrossFit/strength program
(`generate-program-v2/v3`, calendar-structured, `days_per_week`) and the self-paced Engine
(720-day conditioning). The **read** layer is now cross-aware (profile/training analysis see both).
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

**Consumers:**
- **chat** (engine coach + general coach): "6 sessions across both programs this week, RPE trending up
  — consider an easier piece today."
- **adjust-workout / finalize-modification**: scale today's prescription when combined load is high.

---

## Part B — Engine-aware program generation

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

**Writer-prompt rules** (added to the v2/v3 system prompt when the field is present):

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
2. **Part B** — `concurrent_conditioning` payload field + population (entitlement-gated) + v2/v3 writer
   rules. (Highest value for all-access; structural, low-risk.)
3. **Part A** — `buildAthleteLoadState()` merging both programs → wire into chat + adjust-workout.
4. Tests + runtime verification (one all-access fixture end-to-end).

## Scope guardrails

- Activates only for all-access; programming-only and engine-only paths unchanged.
- Generation gains *awareness*, not control over the Engine — coexistence, never re-prescription.
- All signals heuristic, transparent, confidence-gated, consistent with the read layer.
