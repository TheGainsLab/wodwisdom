-- Ranking similarity between every pair of Open workouts in the same year.
-- Run in the COMPETITION SERVICE project. Read-only. Returns about 170 rows;
-- no athlete-level data leaves the database.
--
-- Cohort: men's RX athletes with a valid, ranked RX result on every workout
-- of that year's Open.
-- raw_corr:   correlation of athletes' percentile ranks on the two workouts.
-- resid_corr: the same after subtracting each athlete's own average
--             percentile for the year (removes general fitness).
with res as (
  select c.year, w.ordinal, wr.competitor_id, wr.workout_rank
  from crossfit.workout_results wr
  join crossfit.workouts w      on w.id = wr.workout_id
  join crossfit.competitions c  on c.id = w.competition_id
  where c.competition_type = 'open'
    and c.gender = 'M'
    and w.tier = 'rx'
    and wr.scaled = 0
    and wr.valid
    and wr.workout_rank is not null
),
k as (
  select year, count(distinct ordinal) as k from res group by year
),
complete as (
  select r.year, r.competitor_id
  from res r join k using (year)
  group by r.year, r.competitor_id, k.k
  having count(distinct r.ordinal) = k.k
),
p as (
  select r.year, r.ordinal, r.competitor_id,
         percent_rank() over (partition by r.year, r.ordinal
                              order by r.workout_rank) as pr
  from res r join complete using (year, competitor_id)
),
d as (
  select p.*, pr - avg(pr) over (partition by year, competitor_id) as resid
  from p
),
names as (
  select c.year, wc.ordinal, wc.workout_name
  from crossfit.workout_catalog wc
  join crossfit.competitions c on c.id = wc.competition_id
  where c.competition_type = 'open' and c.gender = 'M' and wc.tier = 'rx'
)
select a.year,
       a.ordinal as ordinal_1, n1.workout_name as workout_1,
       b.ordinal as ordinal_2, n2.workout_name as workout_2,
       k.k as workouts_in_year,
       count(*) as athletes,
       round(corr(a.pr, b.pr)::numeric, 4)       as raw_corr,
       round(corr(a.resid, b.resid)::numeric, 4) as resid_corr
from d a
join d b on b.year = a.year and b.competitor_id = a.competitor_id
        and b.ordinal > a.ordinal
join k on k.year = a.year
left join names n1 on n1.year = a.year and n1.ordinal = a.ordinal
left join names n2 on n2.year = a.year and n2.ordinal = b.ordinal
group by a.year, a.ordinal, n1.workout_name, b.ordinal, n2.workout_name, k.k
order by a.year, a.ordinal, b.ordinal;
