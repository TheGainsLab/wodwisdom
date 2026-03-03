-- Add time_domain column to workout_log_blocks for metcon heat map
ALTER TABLE workout_log_blocks
  ADD COLUMN IF NOT EXISTS time_domain text CHECK (time_domain IN ('short', 'medium', 'long'));
