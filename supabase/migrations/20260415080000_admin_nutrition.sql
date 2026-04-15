-- Admin drill-down #7: nutrition log.
--
-- Two RPCs for /admin/users/:id/nutrition:
--   admin_get_nutrition_summary: rolling daily summary for calendar dots
--     and the 30-day trend bars. Uses daily_nutrition where possible and
--     falls back to aggregating food_entries directly.
--   admin_get_nutrition_day: single day's food entries grouped by meal
--     plus the day's totals and targets.
-- Both gated on is_current_user_admin().

-- ─── 1. Daily summary range ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_nutrition_summary(
  target_user_id uuid,
  p_since date DEFAULT NULL,
  p_until date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  since_d date := COALESCE(p_since, CURRENT_DATE - INTERVAL '60 days');
  until_d date := COALESCE(p_until, CURRENT_DATE);
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM log_admin_access(
    target_user_id,
    'nutrition.summary',
    jsonb_build_object('since', since_d, 'until', until_d)
  );

  -- Derive daily totals from food_entries (more authoritative than
  -- daily_nutrition, which may not always be kept in sync).
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'total_days_ever', COUNT(DISTINCT (logged_at AT TIME ZONE 'UTC')::date),
        'days_30d', COUNT(DISTINCT (logged_at AT TIME ZONE 'UTC')::date)
          FILTER (WHERE logged_at >= CURRENT_DATE - INTERVAL '30 days'),
        'total_entries', COUNT(*),
        'entries_30d', COUNT(*) FILTER (WHERE logged_at >= CURRENT_DATE - INTERVAL '30 days'),
        'avg_calories_30d', ROUND(
          (SELECT AVG(day_total)::numeric FROM (
            SELECT SUM(calories) AS day_total
            FROM food_entries
            WHERE user_id = target_user_id
              AND logged_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY (logged_at AT TIME ZONE 'UTC')::date
          ) d)
        , 0)
      )
      FROM food_entries
      WHERE user_id = target_user_id
    ),
    'targets', (
      -- Most recent non-null target from daily_nutrition
      SELECT jsonb_build_object(
        'tdee', tdee_estimate,
        'bmr', bmr_estimate,
        'adjusted_tdee', adjusted_tdee
      )
      FROM daily_nutrition
      WHERE user_id = target_user_id AND tdee_estimate IS NOT NULL
      ORDER BY date DESC
      LIMIT 1
    ),
    'days', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'date', day,
          'total_calories', cal,
          'total_protein', prot,
          'total_carbohydrate', carb,
          'total_fat', fat,
          'entry_count', entries
        ) ORDER BY day
      )
      FROM (
        SELECT
          (logged_at AT TIME ZONE 'UTC')::date AS day,
          ROUND(SUM(calories)::numeric, 0) AS cal,
          ROUND(SUM(protein)::numeric, 1) AS prot,
          ROUND(SUM(carbohydrate)::numeric, 1) AS carb,
          ROUND(SUM(fat)::numeric, 1) AS fat,
          COUNT(*) AS entries
        FROM food_entries
        WHERE user_id = target_user_id
          AND (logged_at AT TIME ZONE 'UTC')::date BETWEEN since_d AND until_d
        GROUP BY (logged_at AT TIME ZONE 'UTC')::date
      ) dd
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_nutrition_summary(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_nutrition_summary(uuid, date, date) TO authenticated;

-- ─── 2. Single day detail ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_nutrition_day(
  target_user_id uuid,
  p_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM log_admin_access(
    target_user_id,
    'nutrition.day',
    jsonb_build_object('date', p_date)
  );

  SELECT jsonb_build_object(
    'date', p_date,
    'daily', (
      SELECT to_jsonb(dn.*)
      FROM daily_nutrition dn
      WHERE dn.user_id = target_user_id AND dn.date = p_date
    ),
    'entries', COALESCE((
      SELECT jsonb_agg(to_jsonb(fe) ORDER BY fe.logged_at)
      FROM food_entries fe
      WHERE fe.user_id = target_user_id
        AND (fe.logged_at AT TIME ZONE 'UTC')::date = p_date
    ), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'calories', ROUND(SUM(calories)::numeric, 0),
        'protein', ROUND(SUM(protein)::numeric, 1),
        'carbohydrate', ROUND(SUM(carbohydrate)::numeric, 1),
        'fat', ROUND(SUM(fat)::numeric, 1),
        'fiber', ROUND(SUM(fiber)::numeric, 1),
        'sodium', ROUND(SUM(sodium)::numeric, 0),
        'entry_count', COUNT(*)
      )
      FROM food_entries
      WHERE user_id = target_user_id
        AND (logged_at AT TIME ZONE 'UTC')::date = p_date
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_nutrition_day(uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_nutrition_day(uuid, date) TO authenticated;
