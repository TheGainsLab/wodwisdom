-- signature_draft_queue — the one door through which every workout gets a
-- signature (founder ruling 2026-11-05: EVERY workout needs one; no
-- family-matching rules — the judge sees each structure and drafts it).
--
-- Producers enqueue (generation save stages, block edits, logged outside
-- workouts); the signature-draft-worker drains. Correctness rests on the
-- lease + reaper (the self-retrigger chain is only a latency optimization),
-- mirroring the v3 dispatcher's model:
--   - claim_signature_drafts is atomic (single-drainer lease + FOR UPDATE
--     SKIP LOCKED), so a live worker and a reaper re-dispatch can never
--     draft the same structure twice.
--   - The single-drainer lease is the GLOBAL Anthropic in-flight cap: one
--     chain drafts sequentially no matter how many gyms generate at 6am.
--     Raise deliberately if drain rate ever becomes the complaint.
--   - The partial unique index dedups the queue itself: twenty athletes
--     hitting the same structure enqueue one job.
--   - signature_draft_queue_gauge is the depth-by-age view: watch it to see
--     account-wide rate pressure coming instead of finding it in a ticket.

create table if not exists public.signature_draft_queue (
  id uuid primary key default gen_random_uuid(),

  -- 'structure': payload.workout is a canonical BlockPrescription (and
  --   payload.measured may carry the generation pass's expected benchmark,
  --   saving the worker a work-calc round-trip).
  -- 'text': payload.text / payload.block_scheme / payload.time_cap_seconds
  --   from a logged outside workout; the worker parses first.
  kind text not null check (kind in ('structure', 'text')),

  -- The wsh1_ hash this job is about (structure hash for 'structure',
  -- text hash for 'text') — the queue-dedup key.
  workout_hash text not null,

  payload jsonb not null,

  -- 1 = logged evidence is already waiting on this hash (a blocked athlete
  -- profile); 0 = program inventory nobody has done yet.
  priority int not null default 0,

  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'done', 'failed')),
  attempts int not null default 0,
  last_error text,
  enqueued_by text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live job per hash: re-enqueues of a structure already queued/claimed
-- are 23505 = already covered. done/failed rows fall out of the index so a
-- genuinely new need can re-enqueue later.
create unique index if not exists signature_draft_queue_live_hash_key
  on public.signature_draft_queue (workout_hash)
  where status in ('queued', 'claimed');

create index if not exists signature_draft_queue_pending_idx
  on public.signature_draft_queue (status, priority desc, created_at);

alter table public.signature_draft_queue enable row level security;
-- No policies: service-role access only (the worker and the producers).

-- The single-drainer lease row.
create table if not exists public.signature_draft_drainer (
  id int primary key default 1 check (id = 1),
  lease_until timestamptz,
  claim_token uuid
);
insert into public.signature_draft_drainer (id) values (1)
  on conflict (id) do nothing;
alter table public.signature_draft_drainer enable row level security;

-- Atomic claim: take/renew the drainer lease, then claim up to p_limit
-- queued jobs. Returns zero rows when another drainer holds a live lease
-- (the caller exits quietly) or the queue is empty.
--
-- Priority with age escalation: logged-evidence jobs (priority 1) claim
-- first, but anything queued past 4 hours claims as priority 1 too, so a
-- steady trickle of logged structures can never starve program inventory.
-- KNOWN LIMIT: the greatest(...) ordering is not indexable, so each claim
-- sorts all queued rows — fine at hundreds; if the gauge ever shows
-- sustained thousands, switch to a two-pass claim (priority-1 first, then
-- oldest) over an index on (status, created_at).
create or replace function public.claim_signature_drafts(
  p_token uuid,
  p_limit int default 5,
  p_lease_seconds int default 180
)
returns setof public.signature_draft_queue
language plpgsql
security definer
as $$
begin
  update public.signature_draft_drainer
     set lease_until = now() + make_interval(secs => p_lease_seconds),
         claim_token = p_token
   where id = 1
     and (lease_until is null or lease_until < now() or claim_token = p_token);
  if not found then
    return; -- another drainer is live
  end if;

  return query
  update public.signature_draft_queue q
     set status = 'claimed',
         claimed_at = now(),
         attempts = q.attempts + 1,
         updated_at = now()
   where q.id in (
     select sq.id from public.signature_draft_queue sq
      where sq.status = 'queued'
      order by greatest(
          sq.priority,
          case when sq.created_at < now() - interval '4 hours' then 1 else 0 end
        ) desc,
        sq.created_at
      for update skip locked
      limit p_limit
   )
   returning q.*;
end;
$$;

-- Heartbeat: renew the drainer lease between jobs. A batch of sequential
-- drafts can outlive any fixed lease (four parse+draft+measure jobs can
-- run minutes), and an expired lease would let a second drainer start —
-- silently doubling the global in-flight cap the lease exists to enforce.
-- Returns true while the lease is still this worker's; false means it was
-- lost (the worker should stop claiming more work after this batch).
create or replace function public.heartbeat_signature_drainer(
  p_token uuid,
  p_lease_seconds int default 180
)
returns boolean
language sql
security definer
as $$
  update public.signature_draft_drainer
     set lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = 1 and claim_token = p_token
  returning true;
$$;

-- Release the drainer lease (only the holder's token releases it).
create or replace function public.release_signature_drainer(p_token uuid)
returns void
language sql
security definer
as $$
  update public.signature_draft_drainer
     set lease_until = null, claim_token = null
   where id = 1 and claim_token = p_token;
$$;

-- Reaper sweep: claimed rows whose worker vanished (stale) go back to
-- queued for another attempt, or to failed past the attempt cap. Returns
-- the number of still-queued jobs so the reaper knows to fire the worker.
-- The stale threshold sits ABOVE worst-case batch wall time (4 jobs x
-- ~2 min each): a live worker heartbeats its lease but not its claimed
-- rows, so a threshold below batch time would requeue jobs a healthy
-- worker is still holding.
create or replace function public.reap_signature_drafts(
  p_stale_seconds int default 900,
  p_max_attempts int default 3
)
returns int
language plpgsql
security definer
as $$
declare
  v_queued int;
begin
  update public.signature_draft_queue
     set status = case when attempts >= p_max_attempts then 'failed' else 'queued' end,
         last_error = coalesce(last_error, 'worker vanished (reaped)'),
         updated_at = now()
   where status = 'claimed'
     and claimed_at < now() - make_interval(secs => p_stale_seconds);

  select count(*)::int into v_queued
    from public.signature_draft_queue where status = 'queued';
  return v_queued;
end;
$$;

-- Depth-by-age gauge: the early-warning dial for account-wide rate
-- pressure (drain rate < enqueue rate shows up here first). Age is only
-- meaningful for LIVE statuses — a terminal 'failed' row would otherwise
-- age forever and keep the dial alarming permanently, so failed reports
-- its count alone.
create or replace view public.signature_draft_queue_gauge as
select
  status,
  count(*) as n,
  case when status in ('queued', 'claimed') then min(created_at) end as oldest,
  case when status in ('queued', 'claimed')
    then extract(epoch from (now() - min(created_at)))::int end as oldest_age_seconds
from public.signature_draft_queue
where status in ('queued', 'claimed', 'failed')
group by status;
