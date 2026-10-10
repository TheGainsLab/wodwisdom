-- Tier-3 one-time intro stamp (founder, 2026-10-10).
--
-- Users with a programming entitlement see a how-to the first time they open
-- Goals & Schedule — the section's version of the account-confirmation
-- welcome ("the AI reads your numbers, not your mind"). Tapping Got-it
-- stamps this column and the section renders normally forever after.
--
-- Deliberately NO backfill: existing subscribers are exactly the
-- under-filling population the intro targets (the oly-seminar case), so
-- they see it once on their next Tier-3 open too.

ALTER TABLE public.athlete_profiles
  ADD COLUMN IF NOT EXISTS t3_intro_seen_at timestamptz;

COMMENT ON COLUMN public.athlete_profiles.t3_intro_seen_at IS
  'When the athlete dismissed the one-time Tier-3 (Goals & Schedule) intro. NULL = show it on next open for entitled users. Not backfilled by design.';
