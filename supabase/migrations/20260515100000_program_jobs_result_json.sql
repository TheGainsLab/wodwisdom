-- v2 job-result inspection blob.
--
-- v1 generate-program writes to program_workouts (free-text). When v1's
-- job completes, the client navigates to /programs/<id> and reads the
-- prose from there. No "result blob" needed.
--
-- v2 generate-program-v2 writes structured rows to program_blocks_v2 +
-- program_movements_v2 + programs.month_plan. The admin V2OutputPanel
-- wants to render the writer's emitted WriterOutput directly without
-- reassembling it from the normalized tables. Add a result_json column
-- on program_jobs that v2 populates with { output, safety } so the
-- status poll can return it intact.
--
-- Null on v1 jobs (no breakage); null on v2 jobs that are still pending.

ALTER TABLE program_jobs
  ADD COLUMN IF NOT EXISTS result_json jsonb;

COMMENT ON COLUMN program_jobs.result_json IS
  'v2 only: { output: WriterOutput, safety: { safe, reasoning, errored } } emitted by the writer. Populated when status transitions to complete. Null on v1 jobs and on pending/processing v2 jobs.';
