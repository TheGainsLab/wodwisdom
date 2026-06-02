-- Persist a logged throwback's placement (computed at log time by
-- competition-placement) onto its competition_workout_results row, so it
-- survives reloads and feeds "Your workouts" + the movement list without
-- recomputing placement on every page load.
--
-- Apply via the dashboard SQL editor (no explicit BEGIN/COMMIT — that wrapper
-- silently rolls back here; see deploy notes). All nullable: placement can be
-- unavailable (thin cohort, uncomputable score) and the row still saves.

ALTER TABLE public.competition_workout_results
  ADD COLUMN IF NOT EXISTS cohort_percentile    numeric CHECK (cohort_percentile IS NULL OR (cohort_percentile >= 0 AND cohort_percentile <= 100)),
  ADD COLUMN IF NOT EXISTS worldwide_percentile numeric CHECK (worldwide_percentile IS NULL OR (worldwide_percentile >= 0 AND worldwide_percentile <= 100)),
  ADD COLUMN IF NOT EXISTS worldwide_rank       integer CHECK (worldwide_rank IS NULL OR worldwide_rank > 0),
  ADD COLUMN IF NOT EXISTS field_size           integer CHECK (field_size IS NULL OR field_size >= 0),
  ADD COLUMN IF NOT EXISTS cohort_size          integer CHECK (cohort_size IS NULL OR cohort_size >= 0);

COMMENT ON COLUMN public.competition_workout_results.cohort_percentile IS
  'Age-cohort percentile from competition-placement at log time (the value the movement list uses). NULL when placement was unavailable or no age_band.';
COMMENT ON COLUMN public.competition_workout_results.worldwide_percentile IS
  'Worldwide (all-gender-field) percentile from competition-placement at log time.';

-- Verify: expect the 5 new columns present.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'competition_workout_results'
  AND column_name IN ('cohort_percentile','worldwide_percentile','worldwide_rank','field_size','cohort_size')
ORDER BY column_name;
