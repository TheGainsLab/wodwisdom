-- Add 'aerobic' to the workout_log_blocks block_type CHECK constraint.
-- Recovery Day archetype emits a Zone 2 Aerobic block, which logs as
-- block_type 'aerobic'.

ALTER TABLE workout_log_blocks DROP CONSTRAINT workout_log_blocks_block_type_check;

ALTER TABLE workout_log_blocks ADD CONSTRAINT workout_log_blocks_block_type_check
  CHECK (block_type IN ('warm-up', 'mobility', 'skills', 'strength', 'metcon', 'cool-down', 'accessory', 'aerobic', 'other'));
