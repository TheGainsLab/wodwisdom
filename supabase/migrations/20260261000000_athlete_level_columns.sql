-- Add per-lift classification level columns to athlete_profiles
-- Levels: A (developing), B (intermediate), C (advanced) for strength lifts
-- Levels: A (developing), B (proficient) for oly lifts

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS squat_level text NOT NULL DEFAULT 'A',
  ADD COLUMN IF NOT EXISTS bench_level text NOT NULL DEFAULT 'B',
  ADD COLUMN IF NOT EXISTS deadlift_level text NOT NULL DEFAULT 'B',
  ADD COLUMN IF NOT EXISTS snatch_level text NOT NULL DEFAULT 'A',
  ADD COLUMN IF NOT EXISTS clean_jerk_level text NOT NULL DEFAULT 'A';
