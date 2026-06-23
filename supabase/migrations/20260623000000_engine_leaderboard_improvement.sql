-- Engine Leaderboard — Board 3: Most Improved (time-trial % pace improvement).
-- Ranks athletes by best_rpm / first_rpm - 1 within a (modality, units) bucket,
-- so progress (not raw fitness) wins. Same privacy model as Boards 1/2: a
-- SECURITY DEFINER function over RLS-protected engine_time_trials, exposing only
-- rank + display name + the metric. Admins and leaderboard_excluded never appear;
-- opted-out users still count but render as "Anonymous Athlete".
--
-- Eligibility: an athlete needs >= 2 time trials in the bucket (can't improve off
-- one attempt) and first_rpm > 0. A bucket needs >= 5 eligible athletes or the
-- function returns nothing. Returns top 10 plus the viewer's own anchored row.
-- "best" is the all-time MAX rpm (a later regression never erases the achievement).

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
    where (select count(*) from eligible) >= 5
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
