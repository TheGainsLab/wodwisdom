-- AI sequencing becomes the default: on for everyone, opt-out in Settings.
--
-- engine_ai_sequencing began as an opt-in rollout gate (20260620100000,
-- default false, dogfood only). The sequencer has run the full loop —
-- cron, consumption detection, generation, validation, catalogue fallback —
-- in production since then. This flips the semantics: true is the product
-- default ("every session personalized"), false is a user's opt-out back to
-- the fixed authored sequence, surfaced as a Settings toggle.
--
-- Opt-out semantics are finish-your-block: the flag gates GENERATION only.
-- Already-generated days keep rendering; past the last generated position
-- the authored catalogue takes over. Toggling is therefore free of side
-- effects in both directions — re-enabling generates fresh from the
-- athlete's current state on the next cron tick.
--
-- ⚠ RUNNING THIS MIGRATION IS THE ROLLOUT MOMENT: the backfill turns the
-- sequencer on for every existing athlete_profiles row, and the cron will
-- begin generating first blocks for all Engine users (throttled to 2 per
-- 15-minute tick — a full drain takes a few hours).

ALTER TABLE athlete_profiles
  ALTER COLUMN engine_ai_sequencing SET DEFAULT true;

UPDATE athlete_profiles
SET engine_ai_sequencing = true
WHERE engine_ai_sequencing = false;
