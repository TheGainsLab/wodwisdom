# Engine Leaderboard — Design Plan

> Status: **planning / outline**. No code yet. Captures the data we already
> capture for Engine users, the comparison model, the board layout, and the
> infrastructure work required before building.

## 1. Architectural premise (read this first)

The Engine program is **self-paced**. Each user has their own
`athlete_profiles.engine_current_day` and advances independently as they
complete sessions. At any given calendar moment, users are scattered across
the 720-day program — **there is no shared "today's workout" everyone does
together.**

The consequence for ranking: the comparison axis is **the workout itself,
not the calendar date**. Two users are comparable when they performed the
*same prescribed workout*, regardless of *when* they did it — the same model
as an erg / Peloton "all-time class leaderboard."

"Top scores across different days" therefore means: *for each program
day / workout, who posted the top scores.*

## 2. Data we already capture

Every completed workout writes a row to **`engine_workout_sessions`**
(RLS-locked to the owning user). Fields relevant to ranking:

| Field | Meaning | Role in leaderboard |
|---|---|---|
| `program_day_number` | Which program day this session was | Primary comparison key (exact same prescribed blocks/intensity) — see §6 caveat |
| `day_type` | One of 22 workout types (`time_trial`, `endurance`, `threshold`, `rocket_races_a`, …) | Broader comparison key / grouping |
| `modality` | Equipment (`c2_row_erg`, `echo_bike`, `assault_runner`, …) | Pace only comparable within one modality |
| `units` | calories / meters / watts | Must match to compare absolute output |
| `actual_pace` / `calculated_rpm` | Absolute output rate | Absolute-speed ranking |
| `target_pace` | Expected pace from the user's time trial | Baseline for normalization |
| `performance_ratio` | `actual_pace / target_pace` | **Normalized effort — comparable across fitness levels and modalities** |
| `total_output` | Total cals / meters | Volume ranking |
| `average_heart_rate` / `peak_heart_rate` | Heart rate | Efficiency / intensity context |
| `perceived_exertion` | 1–10 RPE | Effort context |
| `phase` / `month` | Program phase / calendar month in program | Progress grouping |
| `date` / `created_at` | When logged | Streaks, recency, time-windowing |
| `program_version` | Variant (`5-day` / `3-day` / `_varied`) | Fairness scoping — see §6 |

Supporting tables:
- **`engine_time_trials`** — per-modality fitness baselines (`calculated_rpm`,
  `is_current`). A pure fitness ranking by machine.
- **`engine_user_performance_metrics`** — per `(user, day_type, modality)`:
  `learned_max_pace`, `rolling_avg_ratio`, rolling last-4 ratios. Already a
  consistency signal, computed on every save by the
  `update_engine_performance_metrics` RPC.

## 3. The central design tension — what is fair to compare?

Two candidate ranking metrics, each with trade-offs:

1. **Absolute pace** (`actual_pace` / `calculated_rpm`) — pure speed. Valid
   **only within a fixed `(day_type|program_day, modality, units)` triple.**
   Rewards the genuinely fittest athlete, but is equipment-gated and can feel
   intimidating to newer users.
2. **Performance ratio** (`actual_pace / target_pace`) — already normalized to
   each athlete's own time trial. Comparable across people of different fitness
   and loosely across modalities. Rewards "beating your own target," which fits
   a structured program and is more inclusive.

**Recommendation (pending your call — you marked this TBD):** lead with
**performance ratio** for cross-user boards, and offer **absolute-pace**
boards scoped to a single `(workout, modality, units)` for the competitive /
PR crowd. A simple toggle on one board can serve both.

## 4. Proposed board structure

**Board A — Per-Workout Leaderboards** *(the headline; matches "top scores
across different days")*
- For a given workout (`program_day_number`, or `day_type` for the broader
  view), rank everyone who has *ever* completed it.
- Filters: modality, units, time window (this week / month / all-time).
- Default metric: `performance_ratio`; toggle to absolute pace when a single
  modality+units is selected.
- This is the recurring engagement driver: every workout has its own all-time
  board, and a user beating a workout immediately sees where they landed.

**Board B — By Workout Type** (the 22 `day_type`s)
- Aggregate across all program days of a type: best and average
  `performance_ratio` per user, drill-down into per-modality absolute boards.
- Good "records book" browse experience.

**Board C — Modality Records**
- Per `(modality, units)`: top current time-trial `calculated_rpm` from
  `engine_time_trials WHERE is_current`. A pure fitness ranking by machine,
  independent of program progress.

**Secondary / supporting metrics** (surface as smaller boards or profile
badges, not the headline):
- **Consistency** — sessions logged per window; current streak (from `date`).
- **Volume** — sum of `total_output` per modality over a window.
- **Program progress** — furthest `program_day_number` / month reached, or
  completion rate.

## 5. Prerequisite infrastructure (gaps in today's model)

These are real blockers, not afterthoughts — fold them into the build.

### 5a. Cross-user read path
Every Engine table is RLS-locked to its owner, so no user can read another's
sessions today. The leaderboard needs one of:
- **`SECURITY DEFINER` RPC(s)** that return only pre-aggregated, opt-in,
  leaderboard-safe columns (display name, metric, rank) — mirrors the existing
  `admin_list_engine_sessions` pattern but available to all `authenticated`
  users. **Recommended** — least new surface area, easy to scope to opted-in
  users only.
- A **materialized view** refreshed on a schedule — better at scale, more
  moving parts (refresh cadence, staleness).

### 5b. Opt-in + identity *(confirmed: opt-in via profile)*
- Add an **opt-in flag** to `athlete_profiles`
  (e.g. `engine_leaderboard_opt_in boolean DEFAULT false`), toggled from the
  user's profile/settings.
- Add a **public-safe display name** for the leaderboard. Today sessions only
  join to `profiles.full_name` / email — neither is appropriate to show
  publicly by default. Options: reuse `full_name` with consent, or add a
  dedicated `engine_leaderboard_display_name` (and optional avatar).
- The aggregation RPC must filter to `engine_leaderboard_opt_in = true` so
  non-participants never appear.

## 6. Open questions / fairness caveats to resolve before building

1. **Ranking metric** — performance ratio vs absolute vs toggle. *(You marked
   TBD; recommendation in §3.)*
2. **Comparison key = catalog day vs sequence order.** Program variants
   (`main_5day_varied`, etc.) **reorder** the catalog via
   `engine_program_mapping` — `program_sequence_order` differs from the catalog
   `engine_workout_day_number`. To compare users on the *same actual workout
   content*, the key must be the **catalog day_number**, not the per-variant
   sequence position. **Action:** confirm what `engine_workout_sessions.program_day_number`
   actually stores (catalog day vs sequence order). If it stores sequence
   order, the leaderboard must resolve it back to catalog day via the mapping
   table, or rank by `day_type` only.
3. **Cross-modality fairness.** Even on the same workout, a rower and a bike
   produce non-comparable absolute output. `performance_ratio` normalizes this;
   absolute boards must always be modality+units-scoped.
4. **Time-trial dependence.** `performance_ratio` and `target_pace` are only
   meaningful if the user has a current time trial for that modality
   (`is_current = true`). Sessions without one should be excluded from
   ratio-based boards.
5. **Anti-cheat.** Scores are self-reported. For v1, accept honor-system; flag
   implausible `performance_ratio` outliers (e.g. > some threshold) for review
   rather than blocking.
6. **Minimum participation.** Boards with one entry aren't compelling — decide
   a minimum-N before a board is shown, and how sparse workouts (rare day
   types) are handled.

## 7. Suggested build order

1. Confirm §6.2 (comparison key) and §3 (ranking metric).
2. Migration: opt-in flag + display name on `athlete_profiles`; profile UI to
   set them.
3. Migration: `SECURITY DEFINER` aggregation RPC(s) for Board A
   (per-workout), filtered to opted-in users, returning rank + display name +
   metric only.
4. Frontend: leaderboard page + per-workout entry points from the workout
   review screen ("you ranked #N on this workout").
5. Layer in Boards B/C and secondary metrics once A is validated.
