-- Add interpreted_profile jsonb column to profile_evaluations.
--
-- generate-program writes the pre-generation reconciler output here so
-- admin can audit exactly what signals the generator saw (goal
-- classification, interpreted strength/skills/conditioning levels,
-- experience tier, injury blacklist, self-perception calibration, and
-- any detected blockers).

ALTER TABLE profile_evaluations
  ADD COLUMN IF NOT EXISTS interpreted_profile jsonb;
