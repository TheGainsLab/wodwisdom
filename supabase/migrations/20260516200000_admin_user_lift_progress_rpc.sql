-- Step 22 of the v3 UX roadmap: admin per-lift progress RPC.
--
-- Returns one entry per canonical barbell lift that the athlete has at
-- least one logged set for in the lookback window. Each entry carries:
--   - lift_key + human display name (e.g. "back_squat" / "Back Squat")
--   - current 1RM from athlete_profiles.lifts (if set)
--   - data points: per workout-date max actual weight
--
-- Phase 1 scope decisions:
--   - Match by canonical movement name only (lowercase + underscore
--     normalize). DB stores display strings ("Back Squat"); normalize and
--     compare to the canonical list. Variants like "DB Bench Press" are
--     intentionally excluded — different movement, different progression.
--   - Group per workout_date (not per set) and take MAX(weight). Avoids 5
--     noisy points from a 5-set day; preserves "what they hit that day."
--   - 90-day default window. Configurable via the days_back parameter.
--   - Lifts with zero data points dropped from the result so the frontend
--     doesn't render empty cards.
--   - Step 18 prescribed_weight is NOT plotted yet — dataset is sparse
--     (just the rollout). Once it builds up, a future iteration can overlay
--     prescribed vs actual.

CREATE OR REPLACE FUNCTION admin_user_lift_progress(
  target_user_id uuid,
  days_back int DEFAULT 90
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  v_lift_keys text[] := ARRAY[
    'back_squat','front_squat','overhead_squat','deadlift',
    'snatch','power_snatch','clean','clean_and_jerk','jerk','power_clean','push_jerk',
    'press','push_press','bench_press'
  ];
  v_lift_order_map jsonb := jsonb_build_object(
    'back_squat', 1, 'deadlift', 2, 'bench_press', 3, 'press', 4,
    'front_squat', 5, 'overhead_squat', 6, 'push_press', 7,
    'snatch', 8, 'clean_and_jerk', 9, 'clean', 10,
    'power_clean', 11, 'power_snatch', 12, 'jerk', 13, 'push_jerk', 14
  );
  v_units text;
  v_lifts jsonb;
BEGIN
  SELECT units, lifts INTO v_units, v_lifts
  FROM athlete_profiles
  WHERE user_id = target_user_id;

  WITH lift_entries AS (
    SELECT
      LOWER(REPLACE(TRIM(wle.movement), ' ', '_')) AS lift_key,
      wl.workout_date AS day,
      MAX(wle.weight) AS max_weight,
      MAX(wle.weight_unit) AS weight_unit
    FROM workout_log_entries wle
    JOIN workout_logs wl ON wl.id = wle.log_id
    WHERE wl.user_id = target_user_id
      AND wle.weight IS NOT NULL
      AND wle.weight > 0
      AND wl.workout_date >= (CURRENT_DATE - (days_back || ' days')::interval)::date
      AND LOWER(REPLACE(TRIM(wle.movement), ' ', '_')) = ANY(v_lift_keys)
    GROUP BY 1, 2
  ),
  per_lift AS (
    SELECT
      lift_key,
      json_agg(
        json_build_object(
          'date', day,
          'max_weight', max_weight,
          'weight_unit', weight_unit
        ) ORDER BY day
      ) AS points
    FROM lift_entries
    GROUP BY lift_key
  )
  SELECT json_agg(
    json_build_object(
      'lift_key', pl.lift_key,
      'display_name', initcap(replace(pl.lift_key, '_', ' ')),
      'current_1rm', NULLIF(v_lifts ->> pl.lift_key, '')::numeric,
      'current_1rm_unit', v_units,
      'points', pl.points
    )
    ORDER BY COALESCE((v_lift_order_map ->> pl.lift_key)::int, 99)
  ) INTO result
  FROM per_lift pl;

  RETURN COALESCE(result, '[]'::json);
END;
$$;
