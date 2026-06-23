-- Engine Leaderboard — Board 3: Most Improved (time-trial % pace improvement).
-- Ranks athletes by best_rpm / first_rpm - 1 within a (modality, units) bucket,
-- so progress (not raw fitness) wins. Same privacy model as Boards 1/2: a
-- SECURITY DEFINER function over RLS-protected engine_time_trials, exposing only
-- rank + display name + the metric. Admins and leaderboard_excluded never appear;
-- opted-out users still count but render as "Anonymous Athlete".
--
-- Eligibility: an athlete needs >= 2 time trials in the bucket (can't improve off
-- one attempt) and first_rpm > 0. A bucket needs >= 10 eligible athletes or the
-- function returns nothing (and the UI hides the board entirely until a bucket
-- reaches 10 — see engine_leaderboard_tt_improvement_buckets). Returns top 10 plus
-- the viewer's own anchored row. "best" is the all-time MAX rpm (a later
-- regression never erases the achievement).

create or replace function engine_leaderboard_tt_improvement(p_viewer uuid, p_modality text, p_units text)
returns table (rnk bigint, display_name text, improvement_pct numeric, first_rpm numeric, best_rpm numeric, is_viewer boolean)
language sql
security definer
set search_path = public
as $$
  with tt as (
    select t.user_id, t.calculated_rpm, t.date, t.created_at
    from engine_time_trials t
    where t.modality = p_modality and t.units = p_units
      and t.calculated_rpm is not null and t.calculated_rpm > 0
  ),
  per_user as (
    select user_id,
           (array_agg(calculated_rpm order by date asc, created_at asc))[1] as first_rpm,
           max(calculated_rpm) as best_rpm
    from tt
    group by user_id
    having count(*) >= 2
  ),
  eligible as (
    select pu.user_id, pu.first_rpm, pu.best_rpm,
           round(((pu.best_rpm / pu.first_rpm - 1) * 100)::numeric, 1) as improvement_pct,
           p.full_name, p.leaderboard_anonymous
    from per_user pu
    join profiles p on p.id = pu.user_id
    where pu.first_rpm > 0
      and coalesce(p.role, '') <> 'admin'
      and not coalesce(p.leaderboard_excluded, false)
  ),
  gated as (
    select * from eligible
    where (select count(*) from eligible) >= 10
  ),
  ranked as (
    select e.*, rank() over (order by e.improvement_pct desc, e.best_rpm desc) as rnk
    from gated e
  )
  select r.rnk,
         engine_leaderboard_name(r.full_name, r.leaderboard_anonymous) as display_name,
         r.improvement_pct, r.first_rpm, r.best_rpm,
         (r.user_id = p_viewer) as is_viewer
  from ranked r
  where r.rnk <= 10 or r.user_id = p_viewer
  order by r.rnk;
$$;

grant execute on function engine_leaderboard_tt_improvement(uuid, text, text) to authenticated;

-- Buckets that qualify for the improvement board: (modality, units) where >= 10
-- athletes each have >= 2 time trials. The UI hides the "Most Improved" tab when
-- this returns nothing, and uses it to populate the tab's own bucket dropdown
-- (so only buckets that actually render appear there). Flags the viewer's
-- most-used equipment so the UI can default to a relevant, populated board.
create or replace function engine_leaderboard_tt_improvement_buckets(p_viewer uuid)
returns table (modality text, units text, athletes bigint, is_viewer_default boolean)
language sql
security definer
set search_path = public
as $$
  with per_user as (
    select t.modality, t.units, t.user_id
    from engine_time_trials t
    join profiles p on p.id = t.user_id
    where t.calculated_rpm is not null and t.calculated_rpm > 0
      and coalesce(p.role, '') <> 'admin'
      and not coalesce(p.leaderboard_excluded, false)
    group by t.modality, t.units, t.user_id
    having count(*) >= 2
  ),
  buckets as (
    select modality, units, count(*) as athletes
    from per_user
    group by modality, units
    having count(*) >= 10
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

grant execute on function engine_leaderboard_tt_improvement_buckets(uuid) to authenticated;
