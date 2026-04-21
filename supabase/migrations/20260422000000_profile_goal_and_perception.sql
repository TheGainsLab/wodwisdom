-- Add goal (free text) and self_perception_level columns to athlete_profiles.
-- These drive the pre-generation classifier / reconciler pipeline.
--
-- goal — free text describing what the athlete is training for.
--   Parsed by the parse-goal edge function into structured signals
--   (primary goal type, time horizon, named event, emphasis).
--
-- self_perception_level — user-declared experience level from a fixed list:
--   'beginner' | 'intermediate' | 'advanced' | 'competitive' | 'not_sure'.
--   Reconciled against evidence-based level (from 1RMs + skills + conditioning)
--   to calibrate coaching tone.

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS goal text,
  ADD COLUMN IF NOT EXISTS self_perception_level text;
