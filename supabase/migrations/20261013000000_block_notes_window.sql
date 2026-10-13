-- Widen the previous-cycle block-notes window: 30 notes @ 500 chars →
-- 80 notes @ 300 chars.
--
-- The 30-note cap was tuned for prompt cost, not cycle coverage: a diligent
-- athlete (5 days × ~3 noted blocks × 4 weeks) exceeds it by mid-month, and
-- since the window keeps the NEWEST notes, weeks 1–2 silently vanish from
-- month_in_review for exactly the most engaged loggers. 80 covers a full
-- month of dense logging; 300 chars still fits a three-sentence note (a
-- typical substantive note runs ~100), so the worst-case payload stays in
-- the same ballpark (24k vs 15k chars).
--
-- Everything below is 20260823000000 verbatim except the two bounds.
-- Same single-arg signature — CREATE OR REPLACE is safe.


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
  v_block_notes json;
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
      -- Effort lives on the block since the logging-fidelity redesign; per-set
      -- rpe still counts for pre-redesign logs.
      ROUND(AVG(COALESCE(wle.rpe, wlb.rpe))::numeric, 1) AS logged_avg_rpe,
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
    LEFT JOIN workout_log_blocks wlb ON wlb.id = wle.block_id
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

  -- BLOCK NOTES: the athlete's own words, newest first, bounded.
  WITH noted AS (
    SELECT
      COALESCE(b.performed_date, wl.workout_date) AS day,
      b.block_type,
      LEFT(TRIM(b.notes), 300) AS note
    FROM workout_log_blocks b
    JOIN workout_logs wl ON wl.id = b.log_id
    JOIN program_workouts pw ON pw.id = wl.source_id
    WHERE pw.program_id = v_program_id
      AND wl.status = 'completed'
      AND b.notes IS NOT NULL AND TRIM(b.notes) <> ''
    ORDER BY COALESCE(b.performed_date, wl.workout_date) DESC, b.sort_order
    LIMIT 80
  )
  SELECT json_agg(
    json_build_object('date', day, 'block_type', block_type, 'note', note)
    ORDER BY day DESC
  )
  INTO v_block_notes
  FROM noted;

  SELECT json_build_object(
    'program_id', v_program_id,
    'program_name', v_program_name,
    'last_completed_date', v_last_completed_date,
    'logged', v_logged,
    'strength', COALESCE(v_strength, '[]'::json),
    'conditioning', v_conditioning,
    'skill_volume', COALESCE(v_skill_volume, '{}'::json),
    'block_notes', COALESCE(v_block_notes, '[]'::json)
  )
  INTO result;

  RETURN result;
END;
$$;
