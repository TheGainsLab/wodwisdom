-- workout_signatures — the editorial signature library (Workout Signatures, phase 2).
--
-- One row = one workout's signature over the coach-state FOCUS_AREAS taxonomy
-- (the 11 development axes in _shared/coach-state.ts — the signature buckets
-- ARE the coach-state focuses, by design decision 2026-10-30).
--
-- Three weight vectors per workout, stored separately from day one:
--   demand         — what the workout requires (cohort-independent)
--   discrimination — what decides rank in the RX cohort (demand + cohort adjustments)
--   stimulus       — what adaptation performing it produces
-- Each is jsonb {focus_area: percent}: integer percents in 5% steps summing to 100.
-- Gates (binary walls) ride separately from the weights.
--
-- Rows are drafted by the signature-workout edge function (Sonnet) and
-- adjudicated by an admin in /admin/signatures. status='approved' rows are
-- the editorial artifact every downstream consumer reads.

create table if not exists public.workout_signatures (
  id uuid primary key default gen_random_uuid(),

  -- Where the workout comes from. 'open'/'quarterfinals' rows reference the
  -- competition catalog; 'adhoc' rows are pasted/uploaded one-offs.
  source text not null default 'adhoc'
    check (source in ('open', 'quarterfinals', 'adhoc')),
  competition_workout_id text,
  name text not null,

  -- The canonical structured workout (BlockPrescription shape — the same
  -- structure the generator writes and preprocess-program parses into).
  workout jsonb not null,

  -- The three weight vectors. discrimination/stimulus may be null while a
  -- draft is in progress; approval requires all three.
  demand jsonb not null,
  discrimination jsonb,
  stimulus jsonb,

  -- [{movement, kind: 'skill'|'load'|'capacity', detail}] — binary walls,
  -- kept outside the weights.
  gates jsonb not null default '[]'::jsonb,

  time_domain text check (time_domain in ('short', 'medium', 'long')),
  format text,
  archetype text,
  rationale text,

  -- Snapshot of the deterministic measured layer at save time
  -- (expected benchmark, cohort anchors, computed time domain).
  measured jsonb,

  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected')),
  drafted_model text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One signature per named workout per source ("22.1" exists once under 'open').
create unique index if not exists workout_signatures_source_name_key
  on public.workout_signatures (source, lower(name));

create index if not exists workout_signatures_status_idx
  on public.workout_signatures (status);

-- RLS on, no policies: every read/write goes through the signature-workout
-- edge function (service role), which enforces the admin gate itself.
alter table public.workout_signatures enable row level security;
