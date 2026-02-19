-- Add conditioning benchmarks (running, rowing, bike) to athlete_profiles
ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS conditioning jsonb NOT NULL DEFAULT '{}';
