-- First-program intro stamp (founder, 2026-10-10).
--
-- The first time a user opens a generated program, a one-time card
-- introduces how coaching works: the per-block Coach button, the day chat
-- (where changes are proposed and approved, plus manual Edit — "you always
-- have the last word"), the main Coach chat, logging feeding next month,
-- and the Message-a-human-coach valve. "Built for you. Not by yourself."
--
-- Deliberately NO backfill: existing program-holders discovered these
-- paths by frustration or not at all — they see the card once too
-- ("a two-second inconvenience at worst").

ALTER TABLE public.athlete_profiles
  ADD COLUMN IF NOT EXISTS program_intro_seen_at timestamptz;

COMMENT ON COLUMN public.athlete_profiles.program_intro_seen_at IS
  'When the athlete dismissed the one-time how-coaching-works card on first opening a generated program. NULL = show on next open. Not backfilled by design.';
