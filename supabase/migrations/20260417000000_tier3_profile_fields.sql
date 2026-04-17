-- Tier 3 (training context) fields on athlete_profiles.
-- Required to run AI Programming. See src/utils/tier-status.ts for the
-- canonical completeness rules.
ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS days_per_week integer,
  ADD COLUMN IF NOT EXISTS session_length_minutes integer,
  ADD COLUMN IF NOT EXISTS gym_type text,
  ADD COLUMN IF NOT EXISTS years_training text,
  ADD COLUMN IF NOT EXISTS injuries_constraints text,
  ADD COLUMN IF NOT EXISTS training_split text;
