-- Granular stage label for in-progress v2 program-generation jobs.
--
-- program_jobs.status is coarse (pending/processing/complete/failed).
-- The v2 worker takes minutes — splitting "processing" into per-stage
-- labels lets the client surface what's happening: "Drafting program",
-- "Checking audits", "Safety review", "Saving".
--
-- Null on v1 jobs (no breakage) and on jobs that haven't picked up yet.

ALTER TABLE program_jobs
  ADD COLUMN IF NOT EXISTS stage text;

COMMENT ON COLUMN program_jobs.stage IS
  'v2 only: granular sub-status while status=processing. Values: payload_built, writer_attempt_N, auditing, safety_review, safety_regen, saving. Null on v1 jobs and before processing starts.';
