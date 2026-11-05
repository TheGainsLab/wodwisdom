-- Measured obs_noise_var replaces the provisional placeholder:
-- 625 (sd 25, provisional) -> 550 (sd ~23.4), measured by acceptance
-- run 7 (2026-11-05) against the calibrated engine (se2026.11.05-1,
-- curve calc:20261104T211807Z): scoreable core n=56, bias -8.7,
-- var 547, in-sample. Pinned to the placeholder values so any row
-- that ever receives a fitted per-structure noise is never touched.
UPDATE signature_evidence
SET obs_noise_var = 550
WHERE source = 'logged_solo'
  AND obs_noise_var IN (400, 625);
