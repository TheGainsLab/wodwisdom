-- Tier 2 (Athletic Data) completion goes REVIEWED-based (founder call,
-- 2026-10-05): the section completes when the athlete has SAVED it, however
-- sparse the data. The old data-shape gate (5 core lifts, all skills rated,
-- 2k row + one run) stopped blocking: blanks are often permanent and
-- legitimate (no rower, a shoulder that doesn't bench, a sport that never
-- tests a 1RM snatch), and the generator is headed to other sports whose
-- intake collects different data entirely. The shape requirements survive
-- as the informational `missing` list (sparse-save warning, UI chips) and
-- as the evaluation's confidence inputs — they inform, they don't gate.

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS athletic_reviewed_at timestamptz;

-- Backfill: every existing profile row exists because of at least one save,
-- which is exactly what "reviewed" now means. Without this, every current
-- user's Step 2 regresses to incomplete and the reconciler's canRunPrograms
-- gate starts refusing month deliveries.
UPDATE athlete_profiles
   SET athletic_reviewed_at = COALESCE(athletic_reviewed_at, updated_at, now());
