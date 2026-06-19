# Engine Leaderboard — Design Plan

> Status: **planning / outline**. No implementation yet. Captures the data we
> capture for Engine users, the comparison-axis model, the board set, and the
> infrastructure required before building.

## 1. Architectural premises (read first)

1. **Self-paced.** Each user has their own `athlete_profiles.engine_current_day`
   and advances independently. At any calendar moment users are scattered across
   the program — **there is no shared "today's workout."** The comparison axis is
   the *workout / demand*, never the calendar date (like an erg "all-time class"
   board).
2. **Multi-track, one catalog.** Beyond the 720-day program, users can switch
   tracks (Hyrox, VO2 / VO3 / VO4, 3-day variants, varied order). These are
   registered in `engine_programs` and mapped via `engine_program_mapping`. They
   do **not** define new workouts — each track's "Cat. Day" points back into the
   **same shared `engine_workouts` catalog** and the same 22 `day_type`s. So a
   leaderboard built on the shared catalog / day_types / normalized metrics works
   across all tracks automatically. **Track-switching is a non-issue if we never
   key on a track's per-variant sequence position.**
3. **Comparison key = catalog `day_number`, never `program_sequence_order`.**
   Variants reorder the catalog, so the only stable workout identity is the
   catalog day number (`engine_program_mapping.engine_workout_day_number`).
   **RESOLVED (was open question #2):** `engine_workout_sessions.program_day_number`
   already stores the **catalog day_number**, not the sequence position. Trace:
   the dashboard links with `day.day_number` (catalog) → URL param →
   `loadWorkoutForDay` queries `engine_workouts.day_number` against the
   `main_5day` catalog → saved as `program_day_number`
   (EngineDashboardPage.tsx:260, EngineTrainingDayPage.tsx:358/655–656,
   engineService.ts:285). So per-workout boards can key directly on
   `program_day_number` with **no mapping resolution**, and a Hyrox user and a
   720 user who hit the same catalog day are directly comparable. (`program_day`
   is a redundant duplicate of `program_day_number`; a user can reach the same
   catalog day via two tracks — dedupe to their best.)

## 2. Data we capture

Per completed workout → one row in **`engine_workout_sessions`** (RLS-locked to
the owner):

| Field | Meaning | Use |
|---|---|---|
| `program_day_number` | Program day of the session | Resolve to catalog day for per-workout comparison |
| `day_type` | One of 22 workout types | Grouping / energy-system boards |
| `modality` | Equipment (`c2_row_erg`, `echo_bike`, `ski_erg`, runner…) | **Required filter on all absolute boards** |
| `units` | calories / meters / watts | Must match within a board |
| `actual_pace` / `calculated_rpm` | Absolute output rate | Absolute / per-workout boards |
| `target_pace` | Expected pace from user's time trial | Baseline |
| `performance_ratio` | `actual_pace / target_pace` | **The one machine-agnostic performance signal** |
| `total_output` | Total cals / meters | Volume boards |
| `average_heart_rate` / `peak_heart_rate` | HR | Efficiency context (noisy) |
| `perceived_exertion` | 1–10 RPE | Effort context |
| `date` / `created_at` | When logged | Streaks, recency, windowing |
| `workout_data` (jsonb) | Realized session detail | Holds `avg_work_rest_ratio`, `total_work_time`, `total_rest_time`, `intervals_completed` |

Supporting:
- **`engine_time_trials`** — per-modality standardized benchmark (`calculated_rpm`,
  `is_current`). Day 1 of every track is a `time_trial` (600s max effort).
- **`engine_user_performance_metrics`** — per `(user, day_type, modality)`:
  `learned_max_pace`, `rolling_avg_ratio`, rolling last-4 ratios.
- **`engine_workouts.avg_work_rest_ratio`** — prescribed work:rest per catalog day.

## 3. The comparison-axis model

The central finding from design discussion: **`performance_ratio` is the only
metric that is genuinely machine-agnostic.** It's a pure percentage ("I exceeded
my target by 6%"), so the machine cancels out and it pools across all machines
*and* all tracks. Everything else either measures real physical output (machine-
locked) or measures adherence (machine-irrelevant but not a performance ranking).

That gives three axes:

### Axis A — Universal (machine cancels out): the performance-ratio family
One global board where the whole community competes together, regardless of
machine or track. The dimensionless property is inherited by anything derived
from the ratio, so this is several boards:
- **Execution score** — best single `performance_ratio` (peak).
- **Sustained quality** — rolling-average ratio (`rolling_avg_ratio`, last-4 stored).
- **Most consistent** — lowest variance in ratio.
- **Most improved** — trend/slope of ratio over time (also dimensionless → still
  machine-agnostic).

This is the inclusive headline: nobody is excluded by equipment or track, and you
win by executing *your own* targets.

### Axis B — Adherence (machine-irrelevant): showing up
Counts of activity, comparable across everyone. Ranks discipline, not fitness —
the most inclusive boards, great for retention:
- Current **streak**, **sessions** per week/month, **total training minutes**.

### Axis C — Machine-locked (machine is the unit): absolute performance
Most users train on one machine, so once they **select a machine**, these boards
are well-populated. Rule: fixing the machine isn't enough — you must also fix the
*effort/demand*, because sprint pace and endurance pace on the same rower aren't
comparable. Sub-boards, by how the effort is standardized:

**C1 — Time-trial records (standardized effort) → the headline machine-locked board.**
One identical 600s max test per machine, stored in `engine_time_trials`
(`is_current`). Directly comparable, hard to dispute, feeds PR history and
most-improved. "Biggest Engine" per machine.

**C2 — Work:rest-ratio bands (the primary performance axis) — preferred over raw day_type.**
Work:rest ratio is a continuous, physiologically meaningful variable that *cuts
across* day types and largely determines achievable pace. It collapses the 22
types into a few **dense, well-populated** bands while preserving the
energy-system story. Already captured per session
(`workout_data.avg_work_rest_ratio`) and already used as a chart axis in
`EngineAnalyticsPage.renderWorkRest()`.
- Metric: peak / best-avg `actual_pace` per `(modality, work:rest band)`.
- Bands already exist in code — `formatWorkRestRatio()` buckets to
  `3:1 / 2:1 / 3:2 / 1:1 / 2:3 / 1:2 / 1:3` (long-rest = glycolytic, balanced ≈
  VO2-threshold, short/continuous = aerobic durability), and
  `EngineAnalyticsPage.renderWorkRest()` already groups avg pace by these buckets
  per modality. The leaderboard reuses the same bucketing.
- **Caveat — work duration confound:** a 1:1 at 15s work vs 4-min work yield very
  different paces. Band by `(work:rest band × work-duration bucket)`, or treat
  ratio as a coarse axis.
- **Caveat — jsonb:** RPC reads `workout_data->>'avg_work_rest_ratio'`; promote to
  a real indexed column if it becomes primary.

**C3 — Day-type "engine pillars" (named presets layered on C2).**
A day type makes a good standalone board only when it's diagnostic / max-
expression, structurally standardized, and names a distinct quality. Four qualify
and together form an **"engine profile" across the energy-system ladder** — a
sprinter tops one, a diesel engine tops another, so there are multiple ways to win:

| Day type | Measures | Board name | Metric |
|---|---|---|---|
| `anaerobic` | Glycolytic power (max-effort bursts) | **Biggest Glycolytic Engine** | peak pace |
| `max_aerobic_power` | VO2max (severe intervals) | **Biggest Aerobic Power / VO2max** | best avg pace |
| `threshold` | Lactate threshold (sustained) | **Biggest Threshold Engine** | best sustained pace |
| `time_trial` | Aerobic max ceiling (diagnostic) | **Biggest Engine** | `calculated_rpm` |

Specials:
- `synthesis` — phase-12 capstone ("audit of conditioning completeness"). Sparse
  by design → a **prestige / "you made it"** board.
- `rocket_races_a/b` — uniquely test **pacing consistency**; rank *lowest output
  variance*, not max pace. Niche but on-brand.

**Exclude from max-pace boards:** `endurance`, `polarized`, `flux`, `flux_stages`,
`devour` family, `towers`, `ascending`, `interval` — these prescribe Zone-2 / fixed
sub-max pace, so ranking pace rewards doing them *wrong*. They feed volume /
consistency boards only.

**Standardization caveat:** only `time_trial` is fully fixed (600s). `anaerobic`,
`max_aerobic_power`, `threshold` vary in rounds/duration across catalog days — rank
on **peak pace** (robust to structure) or **pin to a specific catalog day**.

**C4 — Volume (per machine).** Sum `total_output` (or meters) per window — doesn't
need a standardized effort; more work legitimately = more output. Comparable once
`(modality, units)` fixed. (Training load `intensity³ × avg_hr × √duration` is an
alternative effort-weighted volume metric, but HR-dependent — secondary.)

### Axis D — Energy-system signatures (already computed, athlete-archetype)
The Overview analytics already compute three **dimensionless pace ratios** that
characterize *what kind of athlete* you are, not just how fit:
- **Glycolytic** = avg anaerobic pace ÷ time-trial pace
- **Aerobic** = avg max-aerobic-power pace ÷ time-trial pace
- **Systems** = avg anaerobic pace ÷ avg max-aerobic-power pace (top-end spread)

Because they're ratios of paces, units cancel. They're computed per modality, so
rank within a machine to stay rigorous — but conceptually they rank *archetype*:
the **Systems** board crowns the most explosive/glycolytic-dominant athlete, the
**Aerobic** board the biggest diesel engine. Novel, brag-worthy, and **already
calculated** — strong engagement value for near-zero new computation.

### Engagement features layered on top (low build cost)
- **PR feed — "PRs set this week."** `isPersonalBestSession()` and
  `learned_max_pace` (per `day_type×modality`, in `engine_user_performance_metrics`)
  already detect bests. Surface a rolling feed of opted-in users' new PRs — social
  proof without a ranking. Share-card accents ("PR", "% above target") already exist.
- **HR efficiency** = `(pace ÷ avg_hr) × 1000` (already in HR Analytics). Engaging
  "most efficient engine" framing but HR is age/individual-dependent → v2 experiment.

## 4. Privacy & identity *(confirmed: opt-in via profile)*
- Add `engine_leaderboard_opt_in boolean DEFAULT false` to `athlete_profiles`,
  toggled in profile/settings. Aggregation must filter to opted-in users only.
- Add a public-safe display name (`engine_leaderboard_display_name`, optional
  avatar). Don't expose `profiles.full_name` / email by default.

## 5. Cross-user read path
All Engine tables are RLS-locked to the owner — no user can read another's rows
today. Provide a **`SECURITY DEFINER` aggregation RPC** (mirroring
`admin_list_engine_sessions`) available to `authenticated`, returning only
opt-in, leaderboard-safe columns (display name, metric, rank). Materialized view
is the scale-up option.

## 6. Open questions / caveats
1. **Ranking metric for the universal board** — best vs rolling vs consistency vs
   improved (all viable as separate boards).
2. ~~Confirm what `program_day_number` stores~~ **RESOLVED** — it's the catalog
   day_number; per-workout boards key on it directly (see §1.3).
3. **Work-duration confound** on work:rest bands (§C2).
4. **Min-N per board** before display, to avoid leaderboards of one (matters most
   for per-machine / per-day-type / pillar boards).
5. **Anti-cheat** — scores self-reported; flag implausible ratio outliers for v1
   rather than blocking.
6. **Cross-day-type ratio comparability** — is +5% on a sprint == +5% on endurance?
   Second-order; accept for v1.

## 7. Suggested build order
1. Confirm §6.1–6.2.
2. Migration: opt-in flag + display name on `athlete_profiles`; profile UI.
3. Migration: `SECURITY DEFINER` aggregation RPC(s), opt-in-filtered.
4. Ship two headline boards first: **Axis A execution score** (universal) +
   **Axis B streak** (adherence) — both well-populated day one.
5. Add machine-locked layer: **C1 time-trial records**, then **C2 work:rest bands**
   with the **C3 pillar** presets.
6. Layer in volume, most-improved, and the synthesis/rocket-races specials.
