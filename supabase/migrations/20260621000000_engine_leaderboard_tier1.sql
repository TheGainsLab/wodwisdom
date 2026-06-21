-- Engine Leaderboard — Tier 1 (Board 1: Days Completed, Board 2: Time Trials).
-- Boards are read via SECURITY DEFINER functions: engine_workout_sessions and
-- engine_time_trials have per-user RLS (a client can only see its own rows), so
-- a cross-user leaderboard must run above RLS. These functions expose ONLY
-- leaderboard-safe output (rank, display name, the metric) — never email, never
-- raw rows, never user_id. Admins + explicitly-excluded users never appear in
-- rankings; opted-out users still count (cohorts stay real) but show as Anonymous.

-- 1) Privacy / exclusion flags on profiles.
alter table profiles add column if not exists leaderboard_anonymous boolean not null default false;
alter table profiles add column if not exists leaderboard_excluded  boolean not null default false;

-- Shared display-name rule: opted-out OR blank full_name -> "Anonymous Athlete".
-- (Never falls back to email — email is private, Settings-only.)
create or replace function engine_leaderboard_name(p_full_name text, p_anon boolean)
returns text language sql immutable as $$
  select case
    when p_anon then 'Anonymous Athlete'
    when nullif(btrim(p_full_name), '') is null then 'Anonymous Athlete'
    else p_full_name
  end;
$$;

-- 2) Board 1 — Days Completed (global, rolling window; default 30 days).
-- Metric: COUNT(DISTINCT (program_day_number, program_version)) — dedupes a day
-- logged twice and keeps counts honest across program switches. Returns the
-- top 10 plus the viewer's own row (anchored) even if outside the top 10.
create or replace function engine_leaderboard_days(p_viewer uuid, p_window_days integer default 30)
returns table (rnk bigint, display_name text, days bigint, is_viewer boolean)
language sql
security definer
set search_path = public
as $$
  with counts as (
    select s.user_id,
           count(distinct (s.program_day_number, s.program_version)) as days
    from engine_workout_sessions s
    join profiles p on p.id = s.user_id
    where s.completed
      and s.date >= current_date - make_interval(days => p_window_days)
      and coalesce(p.role, '') <> 'admin'
      and not coalesce(p.leaderboard_excluded, false)
    group by s.user_id
  ),
  ranked as (
    select c.user_id, c.days,
           rank() over (order by c.days desc) as rnk
    from counts c
  ),
  named as (
    select r.rnk,
           engine_leaderboard_name(p.full_name, p.leaderboard_anonymous) as display_name,
           r.days,
           (r.user_id = p_viewer) as is_viewer
    from ranked r
    join profiles p on p.id = r.user_id
  )
  select rnk, display_name, days, is_viewer
  from named
  where rnk <= 10 or is_viewer
  order by rnk;
$$;

-- 3) Board 2 — Time Trials. Buckets are (modality, units); min 5 athletes to show.
-- engine_leaderboard_tt_buckets: the viewable buckets + flags the viewer's
-- most-used equipment so the UI can default to a populated, relevant board.
create or replace function engine_leaderboard_tt_buckets(p_viewer uuid)
returns table (modality text, units text, athletes bigint, is_viewer_default boolean)
language sql
security definer
set search_path = public
as $$
  with buckets as (
    select t.modality, t.units, count(distinct t.user_id) as athletes
    from engine_time_trials t
    join profiles p on p.id = t.user_id
    where t.is_current
      and coalesce(p.role, '') <> 'admin'
      and not coalesce(p.leaderboard_excluded, false)
    group by t.modality, t.units
    having count(distinct t.user_id) >= 5
  ),
  viewer_pref as (
    select modality, units
    from engine_workout_sessions
    where user_id = p_viewer and completed
    group by modality, units
    order by count(*) desc
    limit 1
  )
  select b.modality, b.units, b.athletes,
         (vp.modality is not null and b.modality = vp.modality and b.units = vp.units) as is_viewer_default
  from buckets b
  left join viewer_pref vp on true
  order by b.athletes desc, b.modality, b.units;
$$;

-- engine_leaderboard_time_trials: ranked board for one (modality, units) bucket.
-- Rank by calculated_rpm (pace) among is_current baselines; tie-break by
-- total_output then earliest date so ranks don't jiggle. Min-5 enforced: returns
-- nothing if the bucket has fewer than 5 athletes.
create or replace function engine_leaderboard_time_trials(p_viewer uuid, p_modality text, p_units text)
returns table (rnk bigint, display_name text, rpm numeric, total_output numeric, is_viewer boolean)
language sql
security definer
set search_path = public
as $$
  with bucket as (
    select t.user_id, t.calculated_rpm, t.total_output, t.date,
           p.full_name, p.leaderboard_anonymous
    from engine_time_trials t
    join profiles p on p.id = t.user_id
    where t.is_current
      and t.modality = p_modality and t.units = p_units
      and coalesce(p.role, '') <> 'admin'
      and not coalesce(p.leaderboard_excluded, false)
  ),
  gated as (
    select * from bucket
    where (select count(distinct user_id) from bucket) >= 5
  ),
  ranked as (
    select b.user_id, b.calculated_rpm, b.total_output, b.full_name, b.leaderboard_anonymous,
           rank() over (order by b.calculated_rpm desc, b.total_output desc, b.date asc) as rnk
    from gated b
  )
  select r.rnk,
         engine_leaderboard_name(r.full_name, r.leaderboard_anonymous) as display_name,
         r.calculated_rpm as rpm,
         r.total_output,
         (r.user_id = p_viewer) as is_viewer
  from ranked r
  where r.rnk <= 10 or r.user_id = p_viewer
  order by r.rnk;
$$;

-- 4) Grants — authenticated users may call; the functions self-restrict output.
grant execute on function engine_leaderboard_days(uuid, integer)              to authenticated;
grant execute on function engine_leaderboard_tt_buckets(uuid)                 to authenticated;
grant execute on function engine_leaderboard_time_trials(uuid, text, text)    to authenticated;
