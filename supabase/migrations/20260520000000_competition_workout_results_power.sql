-- Competition workout results — power snapshot (Phase 2, "Try it" / collect-them-all).
--
-- When a competition_log user logs a throwback, we compute its work/power and
-- store it here. Unlike the scraped competition bundle (computed upstream at
-- the default mass 84M / 64W), throwback power is computed at the athlete's
-- ACTUAL body weight via the work-calc service — so it's personalized, and
-- body_mass_kg records the mass used so the snapshot stays interpretable as
-- the athlete's weight changes over time.
--
-- Computed once at log time, not recomputed per view — cheaper, and it pins
-- the weight-of-the-day. All four columns are nullable: NULL when the workout
-- contains movements the work-calc model hasn't covered yet, or the compute
-- otherwise couldn't run.

ALTER TABLE public.competition_workout_results
  ADD COLUMN IF NOT EXISTS joules          numeric CHECK (joules IS NULL OR joules >= 0),
  ADD COLUMN IF NOT EXISTS avg_power_watts numeric CHECK (avg_power_watts IS NULL OR avg_power_watts >= 0),
  ADD COLUMN IF NOT EXISTS avg_w_per_kg    numeric CHECK (avg_w_per_kg IS NULL OR avg_w_per_kg >= 0),
  ADD COLUMN IF NOT EXISTS body_mass_kg    numeric CHECK (body_mass_kg IS NULL OR body_mass_kg > 0);

COMMENT ON COLUMN public.competition_workout_results.joules IS
  'Total work for this throwback attempt (joules). Computed at log time via the work-calc service at body_mass_kg. NULL when unmodeled movements / compute unavailable.';
COMMENT ON COLUMN public.competition_workout_results.avg_power_watts IS
  'Average power for this attempt (watts), computed at body_mass_kg. NULL when not computable.';
COMMENT ON COLUMN public.competition_workout_results.avg_w_per_kg IS
  'Average power per kg of body weight for this attempt. NULL when not computable.';
COMMENT ON COLUMN public.competition_workout_results.body_mass_kg IS
  'Athlete body mass (kg) used for the joules/watts computation. Snapshotted so the power figures stay interpretable as the athlete''s weight changes.';
