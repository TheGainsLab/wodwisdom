-- Gym staged generation: resumable per-stage jobs for the cohort generator.
--
-- gym-cohort-cron ran the whole cohort pipeline (skeleton + 4 week-fills +
-- audits) in ONE edge invocation. The platform wall-clock kills an invocation
-- at ~200s while the pipeline needs ~8+ minutes — so the synchronous run could
-- NEVER complete (verified in production 2026-07-07: six attempts, every one
-- killed mid-run, zero rows ever persisted). This is the exact failure
-- generate-program-v3 hit and fixed with its per-stage dispatcher
-- (20260603000000_v3_async_dispatcher.sql); this migration mirrors that fix
-- for the gym path with a dedicated jobs table + the same lease/fencing RPCs.
--
-- Columns mirror program_jobs' dispatcher fields; gym-specific additions:
--   gym_id               : the tenant (affiliate community id), text like
--                          gym_cohort_configs.gym_id / engine_cohort_programs.tenant_id.
--   pause_after_skeleton : owner-review gate. When true the job parks at
--                          status='awaiting_approval' after the skeleton stage
--                          and only resumes on an explicit approve call
--                          (PROGRAMMING_STUDIO_DESIGN layer 1: nothing publishes
--                          unsigned). Default false (shakedown runs straight through).
--
-- Internal state: service_role only (RLS enabled, no policies) — the portal
-- reads job state through consumer-keyed endpoints, never directly.
-- Idempotent + SQL-editor-ready.

BEGIN;

CREATE TABLE IF NOT EXISTS gym_program_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'awaiting_approval', 'complete', 'failed')),
  -- Dispatcher control field (which stage runs next) vs. human-facing display label.
  next_stage text,
  stage text,
  -- Full resume context: shared payload + tdi (the envelope), roster, skeleton,
  -- accumulated weeks, surgical cursor — everything a stage needs to pick up.
  resume_state jsonb,
  -- The skeleton, mirrored out of resume_state the moment the skeleton stage
  -- returns (same pattern as program_jobs.skeleton_json) — this is what the
  -- owner review desk reads.
  skeleton_json jsonb,
  -- Lease + fencing (see 20260603010000_v3_dispatcher_lease_rpcs.sql for the
  -- correctness model: atomic claim, token-gated heartbeat + commit).
  locked_at timestamptz,
  claim_token text,
  stage_dispatch_attempts int NOT NULL DEFAULT 0,
  pause_after_skeleton boolean NOT NULL DEFAULT false,
  -- Terminal outputs.
  cohort_program_id uuid REFERENCES engine_cohort_programs(id) ON DELETE SET NULL,
  result_json jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reaper sweep: stale 'processing' jobs, keyed by stage (partial, like retail's).
CREATE INDEX IF NOT EXISTS idx_gym_program_jobs_next_stage
  ON gym_program_jobs (next_stage)
  WHERE status = 'processing';

-- The cron's in-flight guard: one active job per gym.
CREATE INDEX IF NOT EXISTS idx_gym_program_jobs_gym_active
  ON gym_program_jobs (gym_id)
  WHERE status IN ('processing', 'awaiting_approval');

ALTER TABLE gym_program_jobs ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only.

-- Saving-stage idempotency marker (mirrors retail's program_months gate).
-- persistCohortResult INSERTs a fresh engine_cohort_programs row per call, so a
-- reaper re-run of the saving stage could double-persist without this. The
-- marker's PK claims the save for a job; cohort_program_id is stamped after the
-- persist succeeds, so a re-entry can tell "already saved" (id present — reuse)
-- from "prior worker died mid-save" (id null — safe to redo after clearing).
CREATE TABLE IF NOT EXISTS gym_program_job_saves (
  job_id uuid PRIMARY KEY REFERENCES gym_program_jobs(id) ON DELETE CASCADE,
  cohort_program_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gym_program_job_saves ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only.

-- updated_at maintenance (repo convention).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gym_program_jobs_updated_at ON gym_program_jobs;
CREATE TRIGGER trg_gym_program_jobs_updated_at
  BEFORE UPDATE ON gym_program_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Lease RPCs — byte-for-byte the retail semantics, on the gym table. ────────
-- (See 20260603010000_v3_dispatcher_lease_rpcs.sql for why these must be single
-- UPDATE ... RETURNING statements evaluated in the database.)

CREATE OR REPLACE FUNCTION claim_gym_program_stage(
  p_job_id uuid,
  p_expected_stage text,
  p_lease_seconds int
) RETURNS gym_program_jobs
LANGUAGE sql
AS $$
  UPDATE gym_program_jobs
     SET locked_at   = now(),
         claim_token = gen_random_uuid()::text
   WHERE id = p_job_id
     AND status = 'processing'
     AND next_stage = p_expected_stage
     AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => p_lease_seconds))
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION heartbeat_gym_program_stage(
  p_job_id uuid,
  p_claim_token text
) RETURNS boolean
LANGUAGE sql
AS $$
  UPDATE gym_program_jobs
     SET locked_at = now()
   WHERE id = p_job_id
     AND claim_token = p_claim_token
  RETURNING true;
$$;

-- Only status='processing' is swept: a thrown stage is status='failed' (never
-- re-rolled), and a job parked at 'awaiting_approval' is invisible to the
-- reaper for as long as the owner takes to review.
CREATE OR REPLACE FUNCTION find_stale_gym_program_jobs(
  p_staleness_seconds int
) RETURNS SETOF gym_program_jobs
LANGUAGE sql
AS $$
  SELECT *
    FROM gym_program_jobs
   WHERE status = 'processing'
     AND next_stage IS NOT NULL
     AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => p_staleness_seconds))
$$;

REVOKE ALL ON FUNCTION claim_gym_program_stage(uuid, text, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION heartbeat_gym_program_stage(uuid, text)  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION find_stale_gym_program_jobs(int)         FROM public, anon, authenticated;

COMMENT ON TABLE gym_program_jobs IS
  'Resumable per-stage gym cohort generation jobs (mirror of program_jobs'' v3 dispatcher). One stage per edge invocation; lease + fencing token per claim_gym_program_stage.';

NOTIFY pgrst, 'reload schema';

COMMIT;
