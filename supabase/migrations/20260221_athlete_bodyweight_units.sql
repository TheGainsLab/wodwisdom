-- Add bodyweight and units to athlete_profiles
ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS bodyweight numeric,
  ADD COLUMN IF NOT EXISTS units text NOT NULL DEFAULT 'lbs';
