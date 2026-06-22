-- Cache for the Engine day-coach quick-action chips (Warm-up / Pace this).
-- These are canned questions sent with empty history, so the answer is a pure
-- function of (user, day, chosen equipment, question) — safe to cache. Re-taps
-- then serve instantly and free, and stay consistent instead of re-rolling.
--
-- modality/units default to '' (not NULL) so the composite PK + upsert are
-- reliable. Written only by the chat edge function (service role); never read
-- or written by clients, so RLS is enabled with no policies (deny-all to anon/
-- authenticated; the service key bypasses RLS).

create table if not exists engine_coach_cache (
  user_id            uuid        not null,
  engine_program_day integer     not null,
  modality           text        not null default '',
  units              text        not null default '',
  question_key       text        not null,
  answer             text        not null,
  created_at         timestamptz not null default now(),
  primary key (user_id, engine_program_day, modality, units, question_key)
);

alter table engine_coach_cache enable row level security;
