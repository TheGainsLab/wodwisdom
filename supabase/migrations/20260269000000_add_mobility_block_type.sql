-- Add 'mobility' to the allowed block types for workout_log_blocks
ALTER TABLE workout_log_blocks DROP CONSTRAINT workout_log_blocks_block_type_check;
ALTER TABLE workout_log_blocks ADD CONSTRAINT workout_log_blocks_block_type_check
  CHECK (block_type IN ('warm-up', 'mobility', 'skills', 'strength', 'metcon', 'cool-down', 'accessory', 'other'));
