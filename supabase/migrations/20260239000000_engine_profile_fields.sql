-- Add Engine-specific fields to athlete_profiles
ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS engine_program_version text DEFAULT '5-day',
  ADD COLUMN IF NOT EXISTS engine_current_day integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS engine_months_unlocked integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS engine_subscription_status text DEFAULT 'inactive';
