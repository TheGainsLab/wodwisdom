-- Add equipment inventory to athlete profiles
-- Stores a JSON object of equipment keys → boolean (available/not)
ALTER TABLE athlete_profiles
ADD COLUMN IF NOT EXISTS equipment jsonb DEFAULT '{}'::jsonb;
