-- Phase 1 of the training journal (Model 2): per-block performed date.
--
-- Today every block of a workout inherits the parent workout_logs.workout_date,
-- so a day whose blocks were done across multiple calendar days collapses to a
-- single date. This column records the date each block was actually performed,
-- letting the calendar show training on the days it really happened.
--
-- Capture: save-workout-block (incremental, one block per day) and log-workout
-- (finish) both preserve a block's performed_date across their delete+reinsert;
-- brand-new blocks fall back to this column's CURRENT_DATE default (the save day).

-- 1) Add nullable first so existing rows can be backfilled.
ALTER TABLE workout_log_blocks
  ADD COLUMN IF NOT EXISTS performed_date date;

-- 2) Backfill from the parent log's workout_date.
UPDATE workout_log_blocks b
SET performed_date = wl.workout_date
FROM workout_logs wl
WHERE wl.id = b.log_id
  AND b.performed_date IS NULL
  AND wl.workout_date IS NOT NULL;

-- 3) Any stragglers (missing parent date) fall back to the row's insert day.
UPDATE workout_log_blocks
SET performed_date = created_at::date
WHERE performed_date IS NULL;

-- 4) Default to the save day going forward; never null.
ALTER TABLE workout_log_blocks
  ALTER COLUMN performed_date SET DEFAULT CURRENT_DATE;
ALTER TABLE workout_log_blocks
  ALTER COLUMN performed_date SET NOT NULL;

-- 5) Index for date-keyed journal / calendar reads.
CREATE INDEX IF NOT EXISTS idx_workout_log_blocks_performed_date
  ON workout_log_blocks(performed_date);
