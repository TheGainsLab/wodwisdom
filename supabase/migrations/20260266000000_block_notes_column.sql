-- Add a dedicated notes column to workout_log_blocks so every block type
-- stores notes consistently (instead of overloading score or workout_logs.notes).
ALTER TABLE workout_log_blocks ADD COLUMN IF NOT EXISTS notes text;
