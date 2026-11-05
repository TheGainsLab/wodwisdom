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
      order by sq.priority desc, sq.created_at
      for update skip locked
      limit p_limit
   )
   returning q.*;
end;
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
create or replace function public.reap_signature_drafts(
  p_stale_seconds int default 300,
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
-- pressure (drain rate < enqueue rate shows up here first).
create or replace view public.signature_draft_queue_gauge as
select
  status,
  count(*) as n,
  min(created_at) as oldest,
  extract(epoch from (now() - min(created_at)))::int as oldest_age_seconds
from public.signature_draft_queue
where status in ('queued', 'claimed', 'failed')
group by status;
