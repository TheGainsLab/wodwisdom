-- Add status column to workout_logs to support saving blocks incrementally.
-- 'in_progress' = user has started but not finished the day
-- 'completed'   = user has finished (current default, backward-compatible)

ALTER TABLE workout_logs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'
  CHECK (status IN ('in_progress', 'completed'));
