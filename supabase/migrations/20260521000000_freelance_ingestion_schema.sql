-- Freelance ingestion — schema (Phase 1).
--
-- Extends workout_log_blocks + workout_log_entries so the freelance-ingestion
-- path (paste any program -> parse -> confirm -> log) can represent and score
-- every block type it ingests:
--   - a new 'cardio' block type (erg / running work)
--   - cardio metric columns: modality, work_seconds, units_per_min(+basis)
--   - metcon power columns: joules / avg_power_watts / avg_w_per_kg /
--     body_mass_kg  (same names as competition_workout_results, migration
--     20260520000000, so the two scoring paths stay consistent)
--   - entry-level `calories` for calorie-based cardio movements: the
--     workout_log_entries.distance_unit CHECK only allows 'ft'/'m', so
--     calorie cardio currently has nowhere to land.
--
-- `modality` is intentionally free text with no CHECK -- matching how the
-- Year of the Engine tables store it (engine_time_trials.modality etc. are
-- all `text NOT NULL`, no constraint). The value vocabulary is aligned to
-- YOTE at the parser layer, not the database, so adding a machine never
-- requires a migration.

-- 1. Add 'cardio' to the workout_log_blocks block_type CHECK.
ALTER TABLE workout_log_blocks DROP CONSTRAINT workout_log_blocks_block_type_check;
ALTER TABLE workout_log_blocks ADD CONSTRAINT workout_log_blocks_block_type_check
  CHECK (block_type IN (
    'warm-up', 'mobility', 'skills', 'strength', 'metcon', 'cardio',
    'cool-down', 'accessory', 'active-recovery', 'other'
  ));

-- 2. Cardio metric columns on workout_log_blocks.
ALTER TABLE workout_log_blocks
  ADD COLUMN IF NOT EXISTS modality text,
  ADD COLUMN IF NOT EXISTS work_seconds integer,
  ADD COLUMN IF NOT EXISTS units_per_min numeric,
  ADD COLUMN IF NOT EXISTS units_per_min_basis text;

COMMENT ON COLUMN workout_log_blocks.modality IS
  'Cardio machine/modality lane. Free text, vocabulary aligned to the Year of the Engine modality strings (pinned at the parser layer). Cross-machine comparison is not meaningful -- comparison is within-modality only.';
COMMENT ON COLUMN workout_log_blocks.work_seconds IS
  'Total work time for a cardio block, in seconds -- the denominator for units_per_min.';
COMMENT ON COLUMN workout_log_blocks.units_per_min IS
  'YOTE-style cardio rate: total score units divided by work minutes.';
COMMENT ON COLUMN workout_log_blocks.units_per_min_basis IS
  'Unit that units_per_min is expressed in (e.g. cal or m). Makes the rate self-describing without an entry join.';

-- 3. Metcon power columns on workout_log_blocks (mirrors competition_workout_results).
ALTER TABLE workout_log_blocks
  ADD COLUMN IF NOT EXISTS joules numeric,
  ADD COLUMN IF NOT EXISTS avg_power_watts numeric,
  ADD COLUMN IF NOT EXISTS avg_w_per_kg numeric,
  ADD COLUMN IF NOT EXISTS body_mass_kg numeric;

COMMENT ON COLUMN workout_log_blocks.joules IS
  'Total mechanical work for a scored metcon block, from the power engine (work-calc).';
COMMENT ON COLUMN workout_log_blocks.avg_power_watts IS
  'Average power (joules / time) for the metcon block.';
COMMENT ON COLUMN workout_log_blocks.avg_w_per_kg IS
  'Bodyweight-normalized average power for the metcon block.';
COMMENT ON COLUMN workout_log_blocks.body_mass_kg IS
  'Body mass used in the power computation (personalized, or population default when unknown).';

-- 4. Entry-level calories for calorie-based cardio movements.
ALTER TABLE workout_log_entries
  ADD COLUMN IF NOT EXISTS calories numeric;

COMMENT ON COLUMN workout_log_entries.calories IS
  'Calorie count for calorie-based cardio movements (e.g. "30 cal row"). distance_unit only allows ft/m, so calorie work lands here.';
