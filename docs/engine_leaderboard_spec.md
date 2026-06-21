# Engine Leaderboard — Design Spec

Status: **design / pre-build.** No code yet. This captures the agreed model so it's reviewable before
implementation. Companion to `engine_self_sequencing_plan.md`.

## Why this is hard (and the reframe that fixes it)

The Engine is individualized — the AI generates each athlete's days within day-type envelopes. So the naive
"highest score on day N" leaderboard breaks two ways:
1. Day N is **different content** for every athlete (can't compare).
2. On some days (endurance) a **high score means you did it wrong** — the target is a ceiling, not a floor.

The reframe: **don't rank "the day." Rank standardized, comparable things** — either a fixed protocol (time
trials), a pure consistency count (days completed), or a normalized *effort signature* (work:rest ratio at a
given pace). Because the AI generates within shared envelopes, many athletes naturally land on the same
signature, which *populates* fair cohorts instead of fragmenting them.

Two hard rules that follow:
- **Rank only raw performance within a `(modality, units)` bucket** — never `performance_ratio`. That column
  is `actual_pace / target_pace`, i.e. performance vs the athlete's *individualized* target; it breaks
  cross-athlete comparison and inverts on endurance.
- **Rank only efforts where "go max" == good training** — time trials and quality/max-effort day-types.
  Never the aerobic-target days. A leaderboard is a behavior magnet; ranking a day where "go hard" fights
  the prescription quietly incentivizes athletes to ignore their own coaching.

## The three boards

All performance comparison happens **within a `(modality, units)` bucket** — rowing meters and bike calories
are not comparable. "Pace" throughout = **units per minute** = `engine_workout_sessions.actual_pace`
(equivalently `calculated_rpm`, which is written identically at save; the time-trial table's rate field is
`engine_time_trials.calculated_rpm`).

### Board 1 — Days Completed  (ship-ready, no open decisions)
- **Source:** `engine_workout_sessions`.
- **Metric:** `COUNT(DISTINCT (program_day_number, program_version)) WHERE completed = true`.
  - `DISTINCT (program_day_number, program_version)` avoids inflation from a day logged twice, and keeps
    counts correct across program switches (positions are reused across programs).
- **Bucket:** none — this is the single **global** board everyone shares.
- **Window:** rolling **monthly** (`date` filter) so newcomers can win, plus a **current-streak** stat.
- **Calibration:** none. Pure consistency — the behavior that actually drives results.

### Board 2 — Time Trials  (ship-ready, no open decisions)
- **Source:** `engine_time_trials`.
- **Metric:** rank by `calculated_rpm` (pace) among rows where `is_current = true` (exactly one live baseline
  per athlete per modality/units). `total_output` available as an alternate absolute view.
- **Bucket:** `(modality, units)`.
- **Protocol:** fixed per modality (confirmed) — so the rate comparison is honest.

### Board 3 — Work:Rest Ratio  (the differentiator — needs setup + open decisions)
- **Source:** `engine_workout_sessions`, ranked by `actual_pace`.
- **Bucket:** `(modality, units, ratio band)`.
  - Ratio from `workout_data->>'avg_work_rest_ratio'` (computed from *actually completed* work/rest seconds).
  - **Ratio bands = canonical prescriptions** (the discrete ratios the day-types actually produce, e.g.
    `1:3, 1:2, 1:1, 2:1` — final list set from the taxonomy), snapping the continuous stored ratio to the
    nearest prescription.
- **No duration filter (decided).** Interval lengths are bounded ~30s–4min, the band where sustainable pace
  *converges* at a constant ratio (short-work/short-rest and long-work/long-rest cap pace by opposite
  mechanisms that roughly cancel). Extremes (10:10, 900:900) can't be generated, so ratio alone is fair
  enough. Revisit only if the data shows skew.
- **Cheat-resistance:** `actual_pace` is a **whole-session aggregate**, so front-loading early rounds tanks
  the average — fatigue is the referee. (See known gap below for the one residual exploit.)
- **Eligibility:** only **max-effort / quality** day-types (open decision — list below).
- **Selection per athlete:** best single session in a rolling window (open decision — recommend
  **best-in-last-90-days**).

## Display

**Per board: Top 10 + the viewer's own rank, anchored.** Never the full list (demotivating, and the
performance boards are bucketed so there's no single global list anyway).

- The viewer always sees the bucket's **Top 10**, plus **their own row pinned** even if they're #34, ideally
  with the 1–2 athletes directly above them ("you're #34, 0.4 cal/min behind #33"). That long-tail rank is
  what keeps the ~90% who aren't top-10 engaged.
- Board → bucket → top-10+you:
  - **Days completed:** global, Top 10 + your rank (+ streak).
  - **Time trials / Work:rest:** pick `(modality, units[, ratio band])`; **default to the viewer's own
    most-used equipment** (computed from their session history) so they land on a populated, relevant board.
- **Cohort < 5 → hide the bucket** with a graceful "not enough athletes here yet" rather than a 2-person board.
- **Anonymous athletes still hold a rank**, shown as "Anonymous Athlete."
- **Tie-break:** secondary by `total_output`, then earliest `date`, so ranks don't jiggle on reload.

## Privacy

- **Display name = `profiles.full_name`.** Never email. If `full_name` is blank, show nothing identifying
  (the app already only falls back to email privately in Settings, never on shared surfaces).
- **Default in, opt-out → "Anonymous"** (open decision — recommend this default). Opted-out athletes still
  *count* (cohorts stay real) but show no identity. Paired with the min-cohort-5 threshold so a small board
  can't de-anonymize someone by their known score.
- A true full opt-out (excluded entirely) offered for privacy-maximalists.

## Placement
Engine dashboard section (`EngineDashboardPage`).

## Open decisions (need a call before build of Board 3 / privacy)

1. **Ratio-board window & selection** — recommend **best session in last 90 days** (current + PR-flavored,
   not an ancient one-off).
2. **Ratio-board eligible day-types** — only types where max pace IS the goal. *Proposed starting set
   (coach to confirm/trim — this is a domain call, not a data one):* `anaerobic`, `interval`,
   `max_aerobic_power`, `threshold`, `devour`, `ascending_devour`, `descending_devour`, `infinity`,
   `hybrid_anaerobic`. **Excluded:** `endurance`, `hybrid_aerobic`, `polarized` (ceiling/mixed targets).
3. **Privacy default** — confirm default-in with opt-out-to-anonymous.
4. **Ratio band cut points** — the exact canonical ratios the day-types emit (snap `avg_work_rest_ratio` to
   these).
5. **Test/admin exclusion** — exclude internal accounts (e.g. AI test athletes, admins) so synthetic data
   doesn't top the boards. Confirm the flag to key off (e.g. `profiles.role`).

## Known gaps / risks

- **Truncation exploit (not airtight).** The schema can't verify an athlete completed the *prescribed* number
  of rounds: at save, `workout_data.intervals_completed` and `total_intervals` are written **identically**, so
  they don't flag a partial effort. Aggregate `actual_pace` defeats front-loading, but a user could rank high
  by doing a *shorter* version of a ratio structure. v1 options: accept-and-watch, or gate on
  `workout_data.total_work_time` falling in an expected range. Decide at/after launch; not a blocker.
- **Modality/units must be canonical** for bucketing — confirm they come from the fixed picker (a free-typed
  "Echo Bike" vs "echo_bike" would split a cohort).
- **Body-size/sex fairness** — absolute pace/output favors larger athletes. Inherent to output leaderboards;
  fine for v1. Sex/age divisions or per-kg are a later option (per-kg needs reliable bodyweight we may lack).

## Plumbing (Board 3 only)
- **Materialize `avg_work_rest_ratio` out of `workout_data` jsonb into a real indexed column** so the ratio
  board query is fast. Boards 1 and 2 need no schema change.

## Build order
1. **Tier 1 — Days Completed + Time Trials.** Zero open decisions, no schema change, map 1:1 onto
   purpose-built columns. ~80% of the engagement for ~20% of the work.
2. **Tier 2 — Work:Rest Ratio.** After decisions 1–5 are locked; needs the materialized column, banding, and
   cohort thresholds.

## Field reference (ground truth — verified against migrations)

- `engine_workout_sessions`: `day_type, modality, units, target_pace, actual_pace, total_output,
  performance_ratio, calculated_rpm, average_heart_rate, peak_heart_rate, perceived_exertion, completed,
  program_version, program_day_number, date, workout_data` (jsonb: `avg_work_rest_ratio, total_work_time,
  total_rest_time, intervals_completed, total_intervals`).
- `engine_time_trials`: `modality, units, total_output, calculated_rpm, is_current, date`.
- `engine_user_performance_metrics`: `day_type, modality, learned_max_pace, rolling_avg_ratio,
  rolling_count, last_4_ratios`.
- `profiles`: `full_name, role`.
