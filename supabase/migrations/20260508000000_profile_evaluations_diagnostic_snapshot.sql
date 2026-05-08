-- Add diagnostic_snapshot column to profile_evaluations for reproducibility.
--
-- Captures the AthleteDiagnostic object computed by derive-athlete-diagnostic.ts
-- at eval time. Lets us reproduce exactly what the model saw later, even after
-- the diagnostic rules evolve.
--
-- Nullable; existing rows keep null. New evals populate it from runAnalysis.

ALTER TABLE public.profile_evaluations
  ADD COLUMN IF NOT EXISTS diagnostic_snapshot jsonb;

COMMENT ON COLUMN public.profile_evaluations.diagnostic_snapshot IS
  'Snapshot of AthleteDiagnostic (per derive-athlete-diagnostic.ts schema_version) at the time the eval was computed. Reproducibility / audit trail.';
