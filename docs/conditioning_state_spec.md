# Build Spec — Step 1: `buildConditioningState()`

**Goal:** turn the ~20 stored per-competency mastery scores into a compact, AI-readable summary of
the athlete's conditioning, in the program's own vocabulary (see `engine_competency_graph.md`).

**Visibility:** none. This is a backend prompt-context helper. No UI, no new screen, no schema
change. Users perceive it only indirectly, via a smarter AI coach. Fully reversible.

**Pattern to mirror:** `supabase/functions/_shared/training-history.ts → fetchAndFormatRecentHistory()`
(returns a formatted text block; no-ops to `""` when the user has no relevant data).

---

## Location & signature

`supabase/functions/_shared/conditioning-state.ts`

```ts
export async function buildConditioningState(
  supa: SupabaseClient,
  userId: string,
  opts?: { recentDays?: number; staleAfterDays?: number; maxLines?: number },
): Promise<string>   // "" when the user has no Engine data → no-op for non-Engine users
```

---

## Inputs (queried in parallel)

| Source | Fields | Used for |
|---|---|---|
| `athlete_profiles` | `engine_program_version`, `engine_current_day` | Curriculum position → tier + next hero day-type |
| `engine_time_trials` | `modality`, `units`, `calculated_rpm`, `date`, `is_current` | **Substrate validity gate** + baseline progression |
| `engine_user_performance_metrics` | `day_type`, `modality`, `rolling_avg_ratio`, `rolling_count`, `learned_max_pace`, `last_4_ratios` | The ~20 mastery scores + trend + confidence |
| `engine_workout_sessions` | `date`, `day_type`, `modality`, `performance_ratio`, `perceived_exertion`, `average_heart_rate`, `peak_heart_rate` | Recency, recovery gaps, RPE-vs-output divergence |

**Static graph metadata** (inline TS constant for now; step 3 makes it queryable):
`day_type → { tier, systems: ('AB'|'AP'|'LT'|'GL')[], class: 'DEV'|'ASSESS', isRoot }`.
Phosphagen (PH) is intentionally **not** an axis — no PH score is produced.

---

## Computation

1. **Substrate / calibration gate (do first).** Per modality with recent sessions, find latest
   `is_current` time trial; compute age. Label `STALE` if age > `staleAfterDays` (default ~40;
   cadence is ~20), or `UNCALIBRATED` if none. Compute baseline progression (first→latest TT rpm).
   *Any competency on a stale/missing-TT modality is reported as low-confidence, not diagnosed.*
2. **Per-competency mastery.** For each `(day_type, modality)`: `rolling_avg_ratio` + trend from
   `last_4_ratios` (rising / flat / falling) + confidence from `rolling_count` (`<2` = low).
3. **Energy-system roll-up.** Aggregate the rooted competencies into **AB / AP / LT / GL** status,
   confidence-weighted. Flag a **weak root** only when ratio is clearly < 1.0 *and* confidence is
   adequate *and* the modality's TT is valid.
4. **Curriculum position.** Map `engine_current_day` → tier/phase; identify the **next hero
   day-type** coming and whether its prerequisite roots are strong → a readiness flag.
5. **Fatigue / recency.** Inter-session gaps; last-session date; **RPE-vs-ratio divergence**
   (high RPE + low ratio = fatigue signal).

## Output (compact labelled block, token-budgeted)

```
ENGINE CONDITIONING STATE
Calibration: C2 Row TT current (12d). Bike TT STALE (61d) — bike scores low-confidence.
  Baseline: row 285→312 rpm over 5 trials (+9%).
Energy systems (row): AB strong (1.04, rising) · AP solid (1.01) · LT lagging (0.92, flat) · GL solid (1.02)
Weak root: LT (threshold 0.91 x4, flux 0.93) — confidence ok.
Curriculum: day 318 (Tier 2, flux_stages phase). Next hero: hybrid_aerobic (~day 245-window already seen).
  Readiness: AP/flux prerequisites met; LT softness may show under density.
Fatigue: last 3 sessions RPE 8-9 vs ratio falling — possible accumulation. 4-day gap before that.
```

---

## Integration (this step)

Inject into the **engine coach first** — append `buildConditioningState()` output inside
`chat/index.ts → buildEngineCoachingContext()`, behind the existing `engineCoachingMode` gate.
(Wiring into the broader shared context for the other 6 AI functions is step 2.)

## Guardrails / correctness

- No-op (`""`) when no Engine data — zero effect on non-Engine users.
- **Confidence gating:** never assert a gap on `rolling_count < 2`.
- **Validity gating:** stale/missing TT → label "uncalibrated", do not diagnose.
- **Per-modality:** never cross-compare modalities that lack current time trials.
- **No PH claims:** phosphagen is primer-only; produce no phosphagen score.
- **Token budget:** cap via `maxLines`; summarize rather than dump every `(day_type, modality)` pair.

## Tests

- No-op path (user with no engine rows).
- Stale-TT path (scores marked low-confidence, no weak-root assertions).
- Healthy path (formatter output shape, energy-system roll-up math, trend detection).
