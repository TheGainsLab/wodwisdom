-- Provisional obs_noise_var widens 400 -> 625 (sd 20 -> 25), acceptance
-- run 3 (2026-11-04): the pure-time channel measured ~20 points median
-- |percentile error|, so sd 20 was already optimistic. Backfill keeps
-- existing ledger rows consistent with log-workout's new placeholder;
-- the WHERE pins it to the placeholder value so any row that ever gets
-- a fitted, per-structure noise is never touched.
UPDATE signature_evidence
SET obs_noise_var = 625
WHERE source = 'logged_solo'
  AND obs_noise_var = 400;
