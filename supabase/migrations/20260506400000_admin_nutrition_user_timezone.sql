-- Step 5 of timezone fix: admin nutrition RPCs bucket by the user's
-- timezone instead of hardcoded UTC.
--
-- Previously every (logged_at AT TIME ZONE 'UTC')::date treated the
-- admin's view as UTC-bucketed. For a user east or west of UTC, the
-- admin saw their meals attributed to a different calendar day than
-- the user actually experienced. Replace 'UTC' with the user's
-- profiles.timezone (fallback 'UTC' if unset). The 30-day window and
-- default since/until also align with the user's tz.

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
  v_tz text;
  since_d date;
  until_d date;
  thirty_days_ago timestamptz;
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  v_tz := COALESCE((SELECT timezone FROM profiles WHERE id = target_user_id), 'UTC');
  since_d := COALESCE(p_since, ((NOW() AT TIME ZONE v_tz)::date) - INTERVAL '60 days');
  until_d := COALESCE(p_until, (NOW() AT TIME ZONE v_tz)::date);
  thirty_days_ago := ((NOW() AT TIME ZONE v_tz)::date - INTERVAL '30 days') AT TIME ZONE v_tz;

  PERFORM log_admin_access(
    target_user_id,
    'nutrition.summary',
    jsonb_build_object('since', since_d, 'until', until_d)
  );

  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'total_days_ever', COUNT(DISTINCT (logged_at AT TIME ZONE v_tz)::date),
        'days_30d', COUNT(DISTINCT (logged_at AT TIME ZONE v_tz)::date)
          FILTER (WHERE logged_at >= thirty_days_ago),
        'total_entries', COUNT(*),
        'entries_30d', COUNT(*) FILTER (WHERE logged_at >= thirty_days_ago),
        'avg_calories_30d', ROUND(
          (SELECT AVG(day_total)::numeric FROM (
            SELECT SUM(calories) AS day_total
            FROM food_entries
            WHERE user_id = target_user_id
              AND logged_at >= thirty_days_ago
            GROUP BY (logged_at AT TIME ZONE v_tz)::date
          ) d)
        , 0)
      )
      FROM food_entries
      WHERE user_id = target_user_id
    ),
    'targets', (
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
          (logged_at AT TIME ZONE v_tz)::date AS day,
          ROUND(SUM(calories)::numeric, 0) AS cal,
          ROUND(SUM(protein)::numeric, 1) AS prot,
          ROUND(SUM(carbohydrate)::numeric, 1) AS carb,
          ROUND(SUM(fat)::numeric, 1) AS fat,
          COUNT(*) AS entries
        FROM food_entries
        WHERE user_id = target_user_id
          AND (logged_at AT TIME ZONE v_tz)::date BETWEEN since_d AND until_d
        GROUP BY (logged_at AT TIME ZONE v_tz)::date
      ) dd
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_nutrition_day(
  target_user_id uuid,
  p_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tz text;
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  v_tz := COALESCE((SELECT timezone FROM profiles WHERE id = target_user_id), 'UTC');

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
        AND (fe.logged_at AT TIME ZONE v_tz)::date = p_date
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
        AND (logged_at AT TIME ZONE v_tz)::date = p_date
    )
  ) INTO result;

  RETURN result;
END;
$$;
