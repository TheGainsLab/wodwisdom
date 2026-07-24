-- Heal engine_current_day pointers corrupted by catalog+1 advancement.
--
-- engine_current_day and sessions' program_day_number store CATALOG day
-- numbers, but a program's day order is its mapping's program_sequence_order.
-- advanceCurrentDay/switchProgram advanced pointers as catalog+1, which is
-- only correct for plain main_5day (the sole identity mapping). Every other
-- program (3-day/4-day subsets skip catalog days; varied programs reorder
-- them entirely) accumulated pointers that point at days outside — or in the
-- wrong order of — the athlete's program. (July '26: Dylan Hebert, pointer at
-- catalog 3, a day that isn't in main_3day; NM2 at 363 on a 144-day program.)
--
-- Heal rule: pointer := catalog day of the athlete's FIRST INCOMPLETE
-- sequence position (post-restart, current program). Deterministic and
-- never teleports anyone forward; for varied athletes who were unknowingly
-- walked through the catalog order, this resumes the intended varied order.
--
-- SKIPPED (manual review, see the query at the bottom): accounts with any
-- completed post-restart session whose day is NOT in their current program's
-- mapping — their history is cross-program (e.g. NM2's vo2max sessions at
-- catalog 362/422) and a mechanical rule shouldn't decide for them.
--
-- Plain main_5day users are untouched (identity mapping — +1 was correct).

WITH prog_users AS (
  SELECT ap.user_id,
         ap.engine_program_version AS prog,
         ap.engine_current_day,
         NULLIF(ap.engine_restarts->>ap.engine_program_version, '')::timestamptz AS restart_at
  FROM athlete_profiles ap
  WHERE ap.engine_program_version IS NOT NULL
    AND ap.engine_program_version <> 'main_5day'
),
completed AS (
  SELECT u.user_id, u.prog, s.program_day_number
  FROM prog_users u
  JOIN engine_workout_sessions s
    ON s.user_id = u.user_id
   AND s.program_version = u.prog
   AND s.completed
   AND s.program_day_number IS NOT NULL
   AND (u.restart_at IS NULL OR s.created_at > u.restart_at)
),
dirty AS (
  -- Any completion outside the current program's mapping → manual review.
  SELECT DISTINCT c.user_id
  FROM completed c
  LEFT JOIN engine_program_mapping m
    ON m.engine_program_id = c.prog
   AND m.engine_workout_day_number = c.program_day_number
  WHERE m.engine_workout_day_number IS NULL
),
target AS (
  SELECT u.user_id, u.engine_current_day,
         (SELECT m.engine_workout_day_number
          FROM engine_program_mapping m
          WHERE m.engine_program_id = u.prog
            AND NOT EXISTS (
              SELECT 1 FROM completed c
              WHERE c.user_id = u.user_id
                AND c.program_day_number = m.engine_workout_day_number)
          ORDER BY m.program_sequence_order
          LIMIT 1) AS new_day
  FROM prog_users u
  WHERE u.user_id NOT IN (SELECT user_id FROM dirty)
)
UPDATE athlete_profiles ap
SET engine_current_day = t.new_day
FROM target t
WHERE ap.user_id = t.user_id
  AND t.new_day IS NOT NULL
  AND ap.engine_current_day <> t.new_day;

-- ── Manual-review list (run separately; heal above skipped these) ──────────
-- SELECT p.email, ap.engine_program_version, ap.engine_current_day,
--        array_agg(DISTINCT s.program_day_number ORDER BY s.program_day_number)
--          AS out_of_program_days
-- FROM athlete_profiles ap
-- JOIN profiles p ON p.id = ap.user_id
-- JOIN engine_workout_sessions s
--   ON s.user_id = ap.user_id AND s.completed
--  AND s.program_version = ap.engine_program_version
--  AND s.program_day_number IS NOT NULL
-- LEFT JOIN engine_program_mapping m
--   ON m.engine_program_id = ap.engine_program_version
--  AND m.engine_workout_day_number = s.program_day_number
-- WHERE m.engine_workout_day_number IS NULL
-- GROUP BY p.email, ap.engine_program_version, ap.engine_current_day;
