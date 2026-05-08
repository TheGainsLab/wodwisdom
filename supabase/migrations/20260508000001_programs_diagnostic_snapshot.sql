-- Add diagnostic_snapshot column to programs for reproducibility.
--
-- Captures the AthleteDiagnostic object computed by derive-athlete-diagnostic.ts
-- when the program was generated. On monthly continuation the column is
-- updated to the latest diagnostic so it always reflects what the model saw
-- on the most recent generation.
--
-- Nullable; existing rows keep null. New programs populate it from generate-program.

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS diagnostic_snapshot jsonb;

COMMENT ON COLUMN public.programs.diagnostic_snapshot IS
  'Snapshot of AthleteDiagnostic (per derive-athlete-diagnostic.ts schema_version) at the time the program was generated or the most recent month appended. Reproducibility / audit trail.';
