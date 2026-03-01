-- Fix engine_workout_sessions.program_version: the column still defaults to
-- '5-day' which is a legacy alias, not a real program ID.  The previous fix
-- migration (20260250) corrected athlete_profiles but missed this table.
--
-- 1. Migrate existing rows from legacy aliases to canonical program IDs
-- 2. Drop the default entirely — sessions must always specify their version
--    explicitly so we fail fast rather than silently writing bad data.

-- 1. Fix existing rows
UPDATE engine_workout_sessions
  SET program_version = 'main_5day'
  WHERE program_version = '5-day';

UPDATE engine_workout_sessions
  SET program_version = 'main_3day'
  WHERE program_version = '3-day';

-- 2. Remove the default so the field must be provided explicitly
ALTER TABLE engine_workout_sessions
  ALTER COLUMN program_version DROP DEFAULT;
