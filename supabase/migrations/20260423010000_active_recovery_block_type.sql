-- Add 'active-recovery' to the workout_log_blocks block_type CHECK constraint.
-- Recovery Day archetype emits an Active Recovery block (easy movement +
-- mobility; NOT aerobic training — that stays with the Engine product).

ALTER TABLE workout_log_blocks DROP CONSTRAINT workout_log_blocks_block_type_check;

ALTER TABLE workout_log_blocks ADD CONSTRAINT workout_log_blocks_block_type_check
  CHECK (block_type IN ('warm-up', 'mobility', 'skills', 'strength', 'metcon', 'cool-down', 'accessory', 'active-recovery', 'other'));
