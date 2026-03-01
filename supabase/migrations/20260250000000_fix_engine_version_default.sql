-- Fix engine_program_version default: '5-day' was never updated to match
-- the program registry IDs ('main_5day', 'main_3day', etc.).
-- New profiles were getting '5-day' which has no mapping rows.

-- 1. Update the column default for future rows
ALTER TABLE athlete_profiles
  ALTER COLUMN engine_program_version SET DEFAULT 'main_5day';

-- 2. Fix any existing rows that still have the legacy values
UPDATE athlete_profiles SET engine_program_version = 'main_5day'  WHERE engine_program_version = '5-day';
UPDATE athlete_profiles SET engine_program_version = 'main_3day'  WHERE engine_program_version = '3-day';
