-- Add set_number column for per-set strength logging
ALTER TABLE workout_log_entries ADD COLUMN set_number smallint;
