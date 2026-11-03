-- signature_fit_log — the append-only record of every production profile
-- fit (story-layer spec, design doc 2026-11-02, item 5).
--
-- Why it exists beside athlete_signature_profiles: the header row is
-- OVERWRITTEN on every refit (right for display), but the research record
-- must accumulate — each fit's n, level, dials, limiter, params version —
-- because (a) athlete concordance attaches to the SPECIFIC fit the athlete
-- reacted to (the known-athlete limiter validation, gathering for free),
-- and (b) fits logged across params versions are the drift monitor when
-- the model improves.
--
-- Writes: the refit function appends (service role). Concordance: the
-- athlete sets it on their own rows — enforced by COLUMN-LEVEL grant, so
-- the authenticated role can update nothing but the three concordance
-- fields, and RLS restricts which rows.

create table if not exists public.signature_fit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fitted_at timestamptz not null default now(),
  params_key text not null,
  n_evidence integer not null,
  level_mean numeric not null,
  level_sd numeric not null,
  axes jsonb not null,            -- {axis: {mean, sd}}
  limiter jsonb not null,         -- [{axis, p}] ranked
  source_mix jsonb not null default '{}'::jsonb,

  -- the athlete's reaction to THIS fit (null until they respond)
  concordance text check (concordance in ('match', 'partial', 'miss')),
  concordance_note text,
  concordance_at timestamptz
);

create index if not exists signature_fit_log_user_idx
  on public.signature_fit_log (user_id, fitted_at desc);

alter table public.signature_fit_log enable row level security;

create policy sfl_select_own on public.signature_fit_log
  for select using (user_id = auth.uid());

-- athletes may update their own rows... (row scope via RLS)
create policy sfl_update_own on public.signature_fit_log
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ...but only the concordance columns (column scope via grants):
revoke update on public.signature_fit_log from authenticated;
grant update (concordance, concordance_note, concordance_at)
  on public.signature_fit_log to authenticated;

-- Review items 1 and 6 (2026-11-03): the display must never own model
-- constants. The fit writes the prior sd it actually used onto each
-- vector row (resolution = 1 - sd/prior_sd is then computed against the
-- SAME prior the posterior came from, per stratum, forever), and the
-- header carries the cohort so the client stops hardcoding it.
alter table public.athlete_capability_vectors
  add column if not exists prior_sd_pct numeric;

alter table public.athlete_signature_profiles
  add column if not exists cohort text not null default 'open_rx_general';
