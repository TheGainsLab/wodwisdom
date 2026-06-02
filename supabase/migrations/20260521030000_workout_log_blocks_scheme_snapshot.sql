-- workout_log_blocks — snapshot block-level prescription (P5 step 1.5).
--
-- When a v3 program block is logged, its structured `block_scheme` +
-- `time_cap_seconds` were lost: StartWorkoutPage renders them as header
-- chips (not prose) and never folds them into the persisted `block_text`,
-- and `workout_log_blocks` had no columns for them.
--
-- The P5 power converter needs the scheme to resolve a metcon's rounds /
-- ladder. Snapshotting it onto the logged block — rather than joining back
-- to `program_blocks_v2` at compute time — keeps a logged workout
-- self-describing: a program can be edited after a workout was logged, so a
-- join would return a scheme the athlete never actually did. Same principle
-- as the `workout_log_entries.prescribed_*` columns (the movement-level
-- prescription snapshot); this extends that snapshot to the block level.
--
-- Forward-only: populated for newly-logged workouts; existing rows stay null.

ALTER TABLE workout_log_blocks
  ADD COLUMN IF NOT EXISTS block_scheme text,
  ADD COLUMN IF NOT EXISTS time_cap_seconds integer;

COMMENT ON COLUMN workout_log_blocks.block_scheme IS
  'Snapshot of the prescribed scheme at log time ("21-15-9 for time", "AMRAP 12", "5x5 @80%"). Null on rows logged before this column / on non-program logs.';
COMMENT ON COLUMN workout_log_blocks.time_cap_seconds IS
  'Snapshot of the prescribed time cap at log time, in seconds. Null when not applicable.';
