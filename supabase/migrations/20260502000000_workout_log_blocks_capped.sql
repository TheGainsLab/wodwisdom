-- Add capped tracking to metcon blocks.
--
-- For-time workouts have a time cap. If the athlete doesn't finish in the
-- cap, they're "capped" — they record reps completed instead of a finish
-- time. Previously there was no way to record this, and entering a bare
-- rep count in the Score field was being parsed as seconds (so "142" reps
-- looked like a 2:22 finish, ranking them at the 99th percentile).
--
-- - capped: did the athlete hit the time cap without finishing?
-- - capped_reps: how many reps did they complete before the cap?
--
-- When capped is true, percentile/performance_tier are set null by the
-- scoring pipeline (no meaningful percentile without a finish time).

ALTER TABLE workout_log_blocks
  ADD COLUMN IF NOT EXISTS capped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capped_reps integer;

COMMENT ON COLUMN workout_log_blocks.capped IS
  'True when athlete was capped on a for-time workout (did not finish within time cap).';
COMMENT ON COLUMN workout_log_blocks.capped_reps IS
  'Total reps completed before the time cap (only meaningful when capped = true).';
