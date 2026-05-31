-- Convert every `numeric` column holding a physical measurement to
-- `double precision` so Supabase serializes them as JSON numbers instead
-- of strings. The `numeric` type is arbitrary-precision decimal and is
-- always serialized as a string to preserve precision — necessary for
-- financial data, footgun for everything else.
--
-- Bug class eliminated: client code doing `typeof x === "number"` (or any
-- math operator that doesn't auto-coerce) silently failing when a numeric
-- column arrives as `"50"` instead of `50`. Most visible recently as
-- optimistic metcon benchmarks (Cal Row sent to upstream without the
-- volume specifier because `calories` was a string).
--
-- Convention going forward: physical measurements (weights, distances,
-- calories, watts, percentages, paces) use `double precision`. `numeric`
-- reserved for financial / exact-precision use only.

-- Programming + workout path -------------------------------------------

ALTER TABLE program_movements_v2
  ALTER COLUMN weight TYPE double precision,
  ALTER COLUMN distance TYPE double precision,
  ALTER COLUMN calories TYPE double precision,
  ALTER COLUMN target_pct_1rm TYPE double precision;

ALTER TABLE workout_log_entries
  ALTER COLUMN prescribed_weight TYPE double precision,
  ALTER COLUMN prescribed_rpe TYPE smallint USING prescribed_rpe::smallint,
  ALTER COLUMN calories TYPE double precision,
  ALTER COLUMN distance TYPE double precision;

ALTER TABLE workout_log_blocks
  ALTER COLUMN units_per_min TYPE double precision,
  ALTER COLUMN joules TYPE double precision,
  ALTER COLUMN avg_power_watts TYPE double precision,
  ALTER COLUMN avg_w_per_kg TYPE double precision,
  ALTER COLUMN body_mass_kg TYPE double precision;

-- Competition / Tier 4 power path --------------------------------------

ALTER TABLE competition_workout_results
  ALTER COLUMN joules TYPE double precision,
  ALTER COLUMN avg_power_watts TYPE double precision,
  ALTER COLUMN avg_w_per_kg TYPE double precision,
  ALTER COLUMN body_mass_kg TYPE double precision;

-- Movement reference data (read by metconScoring local fallback) -------

ALTER TABLE movements
  ALTER COLUMN work_rate TYPE double precision,
  ALTER COLUMN weight_degradation_rate TYPE double precision;

-- Engine domain --------------------------------------------------------

ALTER TABLE engine_workouts
  ALTER COLUMN base_intensity_percent TYPE double precision,
  ALTER COLUMN avg_work_rest_ratio TYPE double precision;

ALTER TABLE engine_workout_sessions
  ALTER COLUMN target_pace TYPE double precision,
  ALTER COLUMN actual_pace TYPE double precision,
  ALTER COLUMN total_output TYPE double precision,
  ALTER COLUMN performance_ratio TYPE double precision,
  ALTER COLUMN calculated_rpm TYPE double precision;

ALTER TABLE engine_time_trials
  ALTER COLUMN total_output TYPE double precision,
  ALTER COLUMN calculated_rpm TYPE double precision;

ALTER TABLE engine_user_performance_metrics
  ALTER COLUMN learned_max_pace TYPE double precision,
  ALTER COLUMN rolling_avg_ratio TYPE double precision;

-- Profile + program classification -------------------------------------

ALTER TABLE athlete_profiles
  ALTER COLUMN bodyweight TYPE double precision,
  ALTER COLUMN tdee_override TYPE double precision;

ALTER TABLE program_workouts
  ALTER COLUMN classified_confidence TYPE double precision;
