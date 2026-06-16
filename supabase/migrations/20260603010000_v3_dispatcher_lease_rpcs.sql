-- v3 async dispatcher: lease + fencing + reaper RPCs.
--
-- The atomic stage claim is the dispatcher's correctness guarantee against
-- double-running a stage (which would double-fill a week or double-append a
-- month). It must be a single UPDATE ... RETURNING evaluated in the database --
-- PostgREST filters can't express `locked_at < now() - <lease>`, and an
-- app-level read-then-write is check-then-act (racy if a lease slips). All three
-- are SQL functions called only by the service role (generate-program-v3 worker
-- + job-reaper); execute is revoked from anon/authenticated.

-- claim_program_stage: atomically claim a job's current stage.
-- Returns the job row if claimed (caller proceeds), 0 rows otherwise (caller
-- aborts -- another worker holds a live lease, or the stage already advanced).
-- Writes a fresh random claim_token = the fencing token: the heartbeat and the
-- final state-commit both run WHERE claim_token = <mine>, so if this job is
-- reclaimed by the reaper mid-stage, the superseded worker's writes match 0 rows
-- and it aborts without corrupting state.
create or replace function claim_program_stage(
  p_job_id uuid,
  p_expected_stage text,
  p_lease_seconds int
) returns program_jobs
language sql
as $$
  update program_jobs
     set locked_at   = now(),
         claim_token = gen_random_uuid()::text
   where id = p_job_id
     and status = 'processing'
     and next_stage = p_expected_stage
     and (locked_at is null or locked_at < now() - make_interval(secs => p_lease_seconds))
  returning *;
$$;

-- heartbeat_program_stage: bump the lease while a stage runs, but ONLY if this
-- worker still holds the fencing token. Returns true if still owner, NULL/0 rows
-- if superseded (worker should stop -- a reaper reclaimed the job).
create or replace function heartbeat_program_stage(
  p_job_id uuid,
  p_claim_token text
) returns boolean
language sql
as $$
  update program_jobs
     set locked_at = now()
   where id = p_job_id
     and claim_token = p_claim_token
  returning true;
$$;

-- find_stale_program_jobs: the reaper's sweep. Processing jobs sitting at a
-- stage whose lease has gone stale (worker died / was wall-clock-killed without
-- markFailed). A writer stage that THREW is already status='failed' and excluded
-- here -- so the reaper only ever re-dispatches VANISHED stages, never re-rolls a
-- writer stage that explicitly failed (the resume ruling, self-enforced by the
-- status filter).
create or replace function find_stale_program_jobs(
  p_staleness_seconds int
) returns setof program_jobs
language sql
as $$
  select *
    from program_jobs
   where status = 'processing'
     and next_stage is not null
     and (locked_at is null or locked_at < now() - make_interval(secs => p_staleness_seconds))
$$;

revoke all on function claim_program_stage(uuid, text, int)   from public, anon, authenticated;
revoke all on function heartbeat_program_stage(uuid, text)     from public, anon, authenticated;
revoke all on function find_stale_program_jobs(int)            from public, anon, authenticated;
