-- Logging fidelity: block-level RPE + calorie de-smuggling backfill.
--
-- 1. One effort signal per block. Per-set RPE was prefilled from the
--    prescription (the "logged" value was the question echoed back) and
--    every consumer collapses effort to block/day granularity anyway. The
--    log forms now ask once per block; entries' per-set rpe stays null
--    going forward (column kept — historical rows untouched).

ALTER TABLE workout_log_blocks
  ADD COLUMN IF NOT EXISTS rpe numeric
    CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10));

COMMENT ON COLUMN workout_log_blocks.rpe IS
  'Athlete-reported block effort (1-10), one signal per block. Replaces per-set entry RPE (which was prescription-prefilled noise).';

-- 2. Calorie de-smuggling backfill. MetconLog used to save calorie movements
--    as reps with distance_unit='cal' and distance NULL — a private encoding.
--    The honest column has existed since the freelance-ingestion migration
--    and had no active writer, so every smuggled row is identifiable and the
--    whole past converges on one dialect.

UPDATE workout_log_entries
SET calories = reps,
    reps = NULL,
    distance_unit = NULL
WHERE distance_unit = 'cal'
  AND calories IS NULL
  AND reps IS NOT NULL;
