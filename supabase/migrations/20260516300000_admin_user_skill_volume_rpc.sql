-- Step 23 of the v3 UX roadmap: admin per-skill volume RPC.
--
-- Returns one entry per canonical skill the athlete has logged in the
-- lookback window. Mirrors admin_user_lift_progress (Step 22) but the
-- metric is volume (reps or hold seconds), not max weight.
--
-- Phase 1 scope decisions:
--   - Match canonical skill display names (e.g. "Bar Muscle-Ups",
--     "Toes-to-Bar", "HSPU") against ALL_SKILL_KEYS in tier-status. The
--     normalizer lowercases and converts both hyphens and spaces to
--     underscores so "Toes-to-Bar" → "toes_to_bar".
--   - Per workout_date, sum reps_completed (preferring reps_completed
--     over the raw reps column, which is set only for prescribed-rep
--     contexts that v3 skills don't use). Also sum hold_seconds for the
--     same window so hold-based skills (L-Sit, handstand walks) carry
--     usable data.
--   - The frontend picks the dominant metric per skill: if any data
--     point has total_reps > 0, plot reps; else fall back to hold_seconds.
--     This keeps the chart's y-axis units coherent within a card.
--   - Days_back default 90 days, configurable.

CREATE OR REPLACE FUNCTION admin_user_skill_volume(
  target_user_id uuid,
  days_back int DEFAULT 90
)
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
  v_skill_display jsonb := jsonb_build_object(
    'muscle_ups','Muscle-Ups','bar_muscle_ups','Bar Muscle-Ups','strict_ring_muscle_ups','Strict Ring Muscle-Ups',
    'toes_to_bar','Toes-to-Bar',
    'strict_pull_ups','Strict Pull-Ups','kipping_pull_ups','Kipping Pull-Ups',
    'butterfly_pull_ups','Butterfly Pull-Ups','chest_to_bar_pull_ups','Chest-to-Bar Pull-Ups',
    'rope_climbs','Rope Climbs','legless_rope_climbs','Legless Rope Climbs',
    'wall_facing_hspu','Wall-Facing HSPU','hspu','HSPU','strict_hspu','Strict HSPU','deficit_hspu','Deficit HSPU',
    'ring_dips','Ring Dips','l_sit','L-Sit','handstand_walk','Handstand Walk',
    'double_unders','Double-Unders','pistols','Pistols','ghd_sit_ups','GHD Sit-Ups'
  );
  v_skills jsonb;
BEGIN
  SELECT skills INTO v_skills
  FROM athlete_profiles
  WHERE user_id = target_user_id;

  WITH skill_entries AS (
    SELECT
      LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) AS skill_key,
      wl.workout_date AS day,
      SUM(COALESCE(wle.reps_completed, wle.reps, 0)) AS total_reps,
      SUM(COALESCE(wle.hold_seconds, 0)) AS total_hold_seconds
    FROM workout_log_entries wle
    JOIN workout_logs wl ON wl.id = wle.log_id
    WHERE wl.user_id = target_user_id
      AND wl.workout_date >= (CURRENT_DATE - (days_back || ' days')::interval)::date
      AND LOWER(REGEXP_REPLACE(TRIM(wle.movement), '[-\s]+', '_', 'g')) = ANY(v_skill_keys)
    GROUP BY 1, 2
    HAVING SUM(COALESCE(wle.reps_completed, wle.reps, 0)) > 0
        OR SUM(COALESCE(wle.hold_seconds, 0)) > 0
  ),
  per_skill AS (
    SELECT
      skill_key,
      json_agg(
        json_build_object(
          'date', day,
          'total_reps', total_reps,
          'total_hold_seconds', total_hold_seconds
        ) ORDER BY day
      ) AS points,
      SUM(total_reps) AS sum_reps,
      SUM(total_hold_seconds) AS sum_hold
    FROM skill_entries
    GROUP BY skill_key
  )
  SELECT json_agg(
    json_build_object(
      'skill_key', ps.skill_key,
      'display_name', v_skill_display ->> ps.skill_key,
      'self_rating', NULLIF(v_skills ->> ps.skill_key, ''),
      'metric', CASE WHEN ps.sum_reps > 0 THEN 'reps' ELSE 'hold_seconds' END,
      'points', ps.points
    )
    ORDER BY (ps.sum_reps + ps.sum_hold) DESC
  ) INTO result
  FROM per_skill ps;

  RETURN COALESCE(result, '[]'::json);
END;
$$;
