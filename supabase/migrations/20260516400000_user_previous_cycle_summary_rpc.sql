-- Step 27 of the v3 UX roadmap: carry-forward continuity.
--
-- Returns a compact summary of the athlete's most-recently-active completed
-- program so the writer (skeleton + full v3 generators) can adapt volume
-- and difficulty for the next cycle. NULL when no prior cycle has any
-- completed workouts (first-time athlete or no logging history).
--
-- "Most recently active" = the program whose last completed workout_date
-- is most recent. Different from "most recently created" because an
-- athlete might generate a program and never log against it; that
-- shouldn't carry forward into the next cycle.
--
-- Phase 1 metrics (intentionally narrow to ship now; expand later):
--   - workout_completion_pct  — did the athlete show up?
--   - skip_pct                — did they finish what they started?
--   - skill_volume            — per canonical skill: total reps + day count.
--                               Skips lifts + load_signal — Step 18's
--                               prescribed_weight data is sparse on day 1
--                               and not useful until cycles accumulate.
--
-- Skill name normalizer mirrors admin_user_skill_volume (+s fallback for
-- singular DB forms).

CREATE OR REPLACE FUNCTION user_previous_cycle_summary(target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  v_skill_keys text[] := ARRAY[
    'muscle_ups','bar_muscle_ups','strict_ring_muscle_ups',
    'toes_to_bar',
    'strict_pull_ups','kipping_pull_ups','butterfly_pull_ups','chest_to_bar_pull_ups',
    'rope_climbs','legless_rope_climbs',
    'wall_facing_hspu','hspu','strict_hspu','deficit_hspu',
    'ring_dips','l_sit','handstand_walk','double_unders','pistols','ghd_sit_ups'
  ];
  v_program_id uuid;
  v_program_name text;
  v_program_created_at timestamptz;
  v_last_completed_date date;
  v_prescribed_workouts int;
  v_completed_workouts int;
  v_total_entries int;
  v_skipped_entries int;
  v_skill_volume json;
BEGIN
  -- Find the most-recently-active completed program (last log date wins).
  SELECT p.id, p.name, p.created_at, MAX(wl.workout_date)
  INTO v_program_id, v_program_name, v_program_created_at, v_last_completed_date
  FROM programs p
  JOIN program_workouts pw ON pw.program_id = p.id
  JOIN workout_logs wl ON wl.source_id = pw.id AND wl.status = 'completed'
  WHERE p.user_id = target_user_id
  GROUP BY p.id, p.name, p.created_at
  ORDER BY MAX(wl.workout_date) DESC NULLS LAST
  LIMIT 1;

  IF v_program_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Workout counts
  SELECT COUNT(*) INTO v_prescribed_workouts
  FROM program_workouts WHERE program_id = v_program_id;

  SELECT COUNT(*) INTO v_completed_workouts
  FROM workout_logs wl
  JOIN program_workouts pw ON pw.id = wl.source_id
  WHERE pw.program_id = v_program_id AND wl.status = 'completed';

  -- Movement skip rate over completed workouts
  SELECT COUNT(*), COUNT(*) FILTER (WHERE wle.completed = false)
  INTO v_total_entries, v_skipped_entries
  FROM workout_log_entries wle
  JOIN workout_logs wl ON wl.id = wle.log_id
  JOIN program_workouts pw ON pw.id = wl.source_id
  WHERE pw.program_id = v_program_id AND wl.status = 'completed';

  -- Per-skill volume (only for canonical skills; +s fallback for singular forms)
  WITH matched AS (
    SELECT
      CASE
        WHEN LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) = ANY(v_skill_keys)
          THEN LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g'))
        WHEN (LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) || 's') = ANY(v_skill_keys)
          THEN LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) || 's'
        ELSE NULL
      END AS skill_key,
      wl.workout_date AS day,
      wle.reps_completed,
      wle.reps,
      wle.hold_seconds
    FROM workout_log_entries wle
    JOIN workout_logs wl ON wl.id = wle.log_id
    JOIN program_workouts pw ON pw.id = wl.source_id
    WHERE pw.program_id = v_program_id AND wl.status = 'completed'
  ),
  agg AS (
    SELECT
      skill_key,
      SUM(COALESCE(reps_completed, reps, 0))::int AS total_reps,
      SUM(COALESCE(hold_seconds, 0))::int AS total_hold_seconds,
      COUNT(DISTINCT day)::int AS day_count
    FROM matched
    WHERE skill_key IS NOT NULL
    GROUP BY skill_key
    HAVING SUM(COALESCE(reps_completed, reps, 0)) > 0
        OR SUM(COALESCE(hold_seconds, 0)) > 0
  )
  SELECT json_object_agg(
    skill_key,
    json_build_object(
      'total_reps', total_reps,
      'total_hold_seconds', total_hold_seconds,
      'days', day_count
    )
  )
  INTO v_skill_volume
  FROM agg;

  SELECT json_build_object(
    'program_id', v_program_id,
    'program_name', v_program_name,
    'program_created_at', v_program_created_at,
    'last_completed_date', v_last_completed_date,
    'workouts', json_build_object(
      'prescribed', v_prescribed_workouts,
      'completed', v_completed_workouts,
      'completion_pct', CASE WHEN v_prescribed_workouts > 0
        THEN ROUND(100.0 * v_completed_workouts / v_prescribed_workouts)::int
        ELSE NULL END
    ),
    'movement_skip', json_build_object(
      'total_entries', v_total_entries,
      'skipped_entries', v_skipped_entries,
      'skip_pct', CASE WHEN v_total_entries > 0
        THEN ROUND(100.0 * v_skipped_entries / v_total_entries)::int
        ELSE NULL END
    ),
    'skill_volume', COALESCE(v_skill_volume, '{}'::json)
  )
  INTO result;

  RETURN result;
END;
$$;
