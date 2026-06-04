-- v3 async dispatcher: resumable per-stage generation state on program_jobs.
--
-- v3 generate-program-v3 ran every stage in ONE edge invocation (~382-400s):
-- payload -> skeleton -> fill_week_1..4 -> benchmark_audit -> surgical ->
-- safety -> save. Supabase's edge wall-clock is ~400s, so heavy runs
-- (6-day weeks) died mid-fill and left zombie 'processing' jobs.
--
-- The fix splits generation across invocations (clock resets per hop). Each
-- stage is its own invocation; the job row carries the resume state, an atomic
-- lease, and a fencing token so a reaper cron can safely re-dispatch a vanished
-- stage without double-running it.
--
-- next_stage  : dispatcher control field (distinct from the existing `stage`
--               column, which is a human-facing display label).
-- resume_state: full resume context { payload, skeleton, weeks[], surgical
--               cursor, continuation {programId, monthNumber}, ... }.
-- locked_at   : lease timestamp; bumped as a heartbeat (~30-45s) while a stage
--               runs. Reaper reclaims when locked_at < now() - staleness.
-- claim_token : fencing token written at claim; heartbeat AND final commit are
--               gated WHERE claim_token = mine, so a superseded worker aborts.
-- stage_dispatch_attempts : reaper re-dispatch counter (reset to 0 on every
--               successful stage advance; capped before markFailed).

alter table program_jobs add column if not exists next_stage text;
alter table program_jobs add column if not exists resume_state jsonb;
alter table program_jobs add column if not exists locked_at timestamptz;
alter table program_jobs add column if not exists claim_token text;
alter table program_jobs add column if not exists stage_dispatch_attempts int not null default 0;

-- Fast reaper sweep: stale 'processing' jobs keyed by stage.
create index if not exists idx_program_jobs_next_stage
  on program_jobs (next_stage)
  where status = 'processing';

-- saving idempotency marker. A saved cycle is uniquely (program_id,
-- month_number) -- month_number lives on program_workouts (many rows per
-- month), and append-mode + the save rollback already key a cycle this way.
-- Inserted first in the saving stage's APPEND path as a dedup gate so the
-- automated continuation paths (stripe-webhook + quarterly cron, both append)
-- cannot silently write two month-2s. First-cycle generation is single-trigger
-- (one human click after profile completion) and guarded job-level instead.
create table if not exists program_months (
  program_id uuid not null references programs(id) on delete cascade,
  month_number int not null,
  created_at timestamptz not null default now(),
  primary key (program_id, month_number)
);

alter table program_months enable row level security;
-- (intentionally no policies: only the service role, which bypasses RLS,
--  reads/writes markers)
