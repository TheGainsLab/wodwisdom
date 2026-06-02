-- Widen carry-forward continuity (user_previous_cycle_summary).
--
-- Replaces the Phase-1 shape (completion_pct / skip_pct / skill_volume) with a
-- prescription-first shape. PRINCIPLE: never infer a negative training signal
-- (cut volume, deload, regress) from the ABSENCE of logging — a busy week or a
-- light logger is not low capacity. So completion_pct and skip_pct are REMOVED
-- (they punished non-loggers); the prior PRESCRIPTION is the backbone and logged
-- actuals are purely additive.
--
-- New output:
--   logged        — were there any completed logs to lean on (informational).
--   strength[]    — per lift from last cycle's PRESCRIPTION (program_movements_v2):
--                   top_pct_1rm, top_weight, sessions; plus logged_avg_rpe /
--                   logged_hit_rate (null when unlogged → progress normally, no
--                   penalty). Empty for a v1 prior program (no structured rows).
--   conditioning  — metcon time-domain coverage from prescribed time caps.
--   skill_volume  — per canonical skill: reps/holds ACTUALLY logged (positive
--                   signal only; never used to regress).
--
-- Same single-arg signature, so CREATE OR REPLACE is safe/idempotent. Month-
-- level scoping (summarize only the prior month of the SAME program) is a
-- follow-up for the v3 month-append path.

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
  v_last_completed_date date;
  v_logged boolean;
  v_strength json;
  v_conditioning json;
  v_skill_volume json;
BEGIN
  -- Most-recently-active completed program (last log date wins).
  SELECT p.id, p.name, MAX(wl.workout_date)
  INTO v_program_id, v_program_name, v_last_completed_date
  FROM programs p
  JOIN program_workouts pw ON pw.program_id = p.id
  JOIN workout_logs wl ON wl.source_id = pw.id AND wl.status = 'completed'
  WHERE p.user_id = target_user_id
  GROUP BY p.id, p.name
  ORDER BY MAX(wl.workout_date) DESC NULLS LAST
  LIMIT 1;

  IF v_program_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM workout_log_entries wle
    JOIN workout_logs wl ON wl.id = wle.log_id
    JOIN program_workouts pw ON pw.id = wl.source_id
    WHERE pw.program_id = v_program_id AND wl.status = 'completed'
  ) INTO v_logged;

  -- STRENGTH: prescription backbone (always present for a v3 prior cycle; empty
  -- for v1) LEFT JOIN logged actuals (additive — null when unlogged).
  WITH presc AS (
    SELECT
      LOWER(REGEXP_REPLACE(TRIM(pm.movement), '[-\s]+', '_', 'g')) AS lift,
      MAX(pm.target_pct_1rm) AS top_pct_1rm,
      MAX(pm.weight) FILTER (WHERE pm.weight_unit = 'lbs') AS top_weight,
      COUNT(*)::int AS sessions
    FROM program_movements_v2 pm
    JOIN program_blocks_v2 pb ON pb.id = pm.block_id
    JOIN program_workouts pw ON pw.id = pb.program_workout_id
    WHERE pw.program_id = v_program_id
      AND pb.block_type IN ('strength', 'accessory')
    GROUP BY 1
  ),
  actuals AS (
    SELECT
      LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) AS lift,
      ROUND(AVG(wle.rpe)::numeric, 1) AS logged_avg_rpe,
      ROUND(
        100.0 * COUNT(*) FILTER (
          WHERE wle.prescribed_weight IS NOT NULL AND wle.weight IS NOT NULL
            AND wle.weight >= wle.prescribed_weight
        )
        / NULLIF(COUNT(*) FILTER (
          WHERE wle.prescribed_weight IS NOT NULL AND wle.weight IS NOT NULL
        ), 0)
      )::int AS logged_hit_rate
    FROM workout_log_entries wle
    JOIN workout_logs wl ON wl.id = wle.log_id
    JOIN program_workouts pw ON pw.id = wl.source_id
    WHERE pw.program_id = v_program_id AND wl.status = 'completed'
    GROUP BY 1
  )
  SELECT json_agg(
    json_build_object(
      'lift', presc.lift,
      'top_pct_1rm', presc.top_pct_1rm,
      'top_weight', presc.top_weight,
      'sessions', presc.sessions,
      'logged_avg_rpe', a.logged_avg_rpe,
      'logged_hit_rate', a.logged_hit_rate
    ) ORDER BY presc.sessions DESC, presc.lift
  )
  INTO v_strength
  FROM presc
  LEFT JOIN actuals a USING (lift);

  -- CONDITIONING: metcon time-domain coverage from prescribed time caps.
  WITH metcons AS (
    SELECT pb.time_cap_seconds AS cap
    FROM program_blocks_v2 pb
    JOIN program_workouts pw ON pw.id = pb.program_workout_id
    WHERE pw.program_id = v_program_id AND pb.block_type = 'metcon'
  )
  SELECT json_build_object(
    'metcons', COUNT(*),
    'time_domains', json_build_object(
      'short',   COUNT(*) FILTER (WHERE cap IS NOT NULL AND cap < 480),
      'medium',  COUNT(*) FILTER (WHERE cap >= 480 AND cap <= 900),
      'long',    COUNT(*) FILTER (WHERE cap > 900),
      'untimed', COUNT(*) FILTER (WHERE cap IS NULL)
    )
  )
  INTO v_conditioning
  FROM metcons;

  -- SKILL VOLUME: reps/holds actually logged (positive signal only).
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
    json_build_object('total_reps', total_reps, 'total_hold_seconds', total_hold_seconds, 'days', day_count)
  )
  INTO v_skill_volume
  FROM agg;

  SELECT json_build_object(
    'program_id', v_program_id,
    'program_name', v_program_name,
    'last_completed_date', v_last_completed_date,
    'logged', v_logged,
    'strength', COALESCE(v_strength, '[]'::json),
    'conditioning', v_conditioning,
    'skill_volume', COALESCE(v_skill_volume, '{}'::json)
  )
  INTO result;

  RETURN result;
END;
$$;
