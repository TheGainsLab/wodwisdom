-- Step 2 of timezone fix: replace UTC current_date with each user's
-- local date inside the RPCs that drive quota enforcement and admin
-- analytics.
--
-- - get_daily_usage / increment_usage: look up profiles.timezone for
--   the target user and bucket the daily counter by their local date.
--   Reads and writes share the same bucket, so quotas reset cleanly at
--   the user's local midnight.
-- - admin_overview_stats / admin_feature_usage / admin_user_detail:
--   gain a tz TEXT DEFAULT 'UTC' parameter. The frontend passes the
--   admin's browser timezone so dashboard "today / 7d / 30d" windows
--   align with the admin's local clock instead of UTC.
--
-- Adding a parameter is a signature change, so the admin functions are
-- DROP + CREATE. The user-scoped functions keep their signature and use
-- CREATE OR REPLACE.

-- ============================================================
-- User-scoped: daily quota
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_daily_usage(check_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(du.question_count, 0)
  FROM public.daily_usage du
  WHERE du.user_id = check_user_id
    AND du.date = (NOW() AT TIME ZONE COALESCE(
      (SELECT p.timezone FROM public.profiles p WHERE p.id = check_user_id),
      'UTC'
    ))::date;
$function$;

CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id uuid,
  p_input_tokens integer DEFAULT 0,
  p_output_tokens integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_today date;
BEGIN
  v_today := (NOW() AT TIME ZONE COALESCE(
    (SELECT timezone FROM public.profiles WHERE id = p_user_id),
    'UTC'
  ))::date;

  INSERT INTO public.daily_usage (user_id, date, question_count, total_input_tokens, total_output_tokens)
  VALUES (p_user_id, v_today, 1, p_input_tokens, p_output_tokens)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    question_count = daily_usage.question_count + 1,
    total_input_tokens = daily_usage.total_input_tokens + p_input_tokens,
    total_output_tokens = daily_usage.total_output_tokens + p_output_tokens;
END;
$function$;

-- ============================================================
-- Admin: Overview stats — accepts admin's timezone
-- ============================================================

DROP FUNCTION IF EXISTS admin_overview_stats();
DROP FUNCTION IF EXISTS admin_overview_stats(text);

CREATE OR REPLACE FUNCTION admin_overview_stats(tz text DEFAULT 'UTC')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  today date := (NOW() AT TIME ZONE tz)::date;
BEGIN
  SELECT json_build_object(
    'active_today', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages
      WHERE created_at >= today
    ),
    'active_7d', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages
      WHERE created_at >= today - INTERVAL '7 days'
    ),
    'active_30d', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages
      WHERE created_at >= today - INTERVAL '30 days'
    ),
    'total_users', (
      SELECT COUNT(*) FROM profiles
    ),
    'new_signups_7d', (
      SELECT COUNT(*) FROM auth.users
      WHERE created_at >= today - INTERVAL '7 days'
    ),
    'new_signups_30d', (
      SELECT COUNT(*) FROM auth.users
      WHERE created_at >= today - INTERVAL '30 days'
    ),

    'subscribers', (
      SELECT json_agg(row_to_json(s)) FROM (
        SELECT feature, COUNT(DISTINCT user_id) as count
        FROM user_entitlements
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND source NOT IN ('manual', 'admin')
        GROUP BY feature
        ORDER BY count DESC
      ) s
    ),

    'entitled_users', (
      SELECT json_agg(row_to_json(s)) FROM (
        SELECT feature, COUNT(DISTINCT user_id) as count
        FROM user_entitlements
        WHERE (expires_at IS NULL OR expires_at > NOW())
        GROUP BY feature
        ORDER BY count DESC
      ) s
    ),

    'users_with_entitlements', (
      SELECT COUNT(DISTINCT user_id) FROM user_entitlements
      WHERE (expires_at IS NULL OR expires_at > NOW())
    ),

    'profiles_with_lifts', (
      SELECT COUNT(*) FROM athlete_profiles
      WHERE lifts IS NOT NULL AND lifts != '{}'::jsonb
        AND EXISTS (SELECT 1 FROM jsonb_each_text(lifts) WHERE value::numeric > 0)
    ),
    'profiles_with_evaluation', (
      SELECT COUNT(DISTINCT user_id) FROM profile_evaluations
    ),
    'profiles_with_program', (
      SELECT COUNT(DISTINCT user_id) FROM programs WHERE source = 'generated'
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- ============================================================
-- Admin: Feature usage — accepts admin's timezone
-- ============================================================

DROP FUNCTION IF EXISTS admin_feature_usage(int);
DROP FUNCTION IF EXISTS admin_feature_usage(int, text);

CREATE OR REPLACE FUNCTION admin_feature_usage(days_back int DEFAULT 30, tz text DEFAULT 'UTC')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  today date := (NOW() AT TIME ZONE tz)::date;
  since timestamptz := today - (days_back || ' days')::interval;
BEGIN
  SELECT json_build_object(
    'chat_questions', (
      SELECT COUNT(*) FROM chat_messages WHERE created_at >= since
    ),
    'chat_users', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages WHERE created_at >= since
    ),
    'chat_by_day', (
      SELECT json_agg(row_to_json(d) ORDER BY d.day) FROM (
        SELECT (created_at AT TIME ZONE tz)::date as day,
               COUNT(*) as questions,
               COUNT(DISTINCT user_id) as users
        FROM chat_messages
        WHERE created_at >= since
        GROUP BY 1
      ) d
    ),

    'total_input_tokens', (
      SELECT COALESCE(SUM(input_tokens), 0) FROM chat_messages WHERE created_at >= since
    ),
    'total_output_tokens', (
      SELECT COALESCE(SUM(output_tokens), 0) FROM chat_messages WHERE created_at >= since
    ),

    'engine_sessions', (
      SELECT COUNT(*) FROM engine_workout_sessions WHERE created_at >= since
    ),
    'engine_users', (
      SELECT COUNT(DISTINCT user_id) FROM engine_workout_sessions WHERE created_at >= since
    ),

    'nutrition_entries', (
      SELECT COUNT(*) FROM food_entries WHERE created_at >= since
    ),
    'nutrition_users', (
      SELECT COUNT(DISTINCT user_id) FROM food_entries WHERE created_at >= since
    ),
    'nutrition_days_logged', (
      SELECT COUNT(DISTINCT (user_id, date)) FROM daily_nutrition
      WHERE date >= today - days_back
    ),

    'programs_generated', (
      SELECT COUNT(*) FROM programs WHERE source = 'generated' AND created_at >= since
    ),
    'evaluations_run', (
      SELECT COUNT(*) FROM profile_evaluations WHERE created_at >= since
    ),

    'workouts_logged', (
      SELECT COUNT(*) FROM workout_logs WHERE created_at >= since
    ),
    'workout_users', (
      SELECT COUNT(DISTINCT user_id) FROM workout_logs WHERE created_at >= since
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- ============================================================
-- Admin: User detail — accepts admin's timezone
-- ============================================================

DROP FUNCTION IF EXISTS admin_user_detail(uuid);
DROP FUNCTION IF EXISTS admin_user_detail(uuid, text);

CREATE OR REPLACE FUNCTION admin_user_detail(target_user_id uuid, tz text DEFAULT 'UTC')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  today date := (NOW() AT TIME ZONE tz)::date;
BEGIN
  SELECT json_build_object(
    'profile', (
      SELECT row_to_json(p) FROM (
        SELECT pr.id, pr.email, pr.full_name, pr.role,
               au.created_at as signup_date,
               pr.stripe_customer_id
        FROM profiles pr
        JOIN auth.users au ON au.id = pr.id
        WHERE pr.id = target_user_id
      ) p
    ),

    'entitlements', (
      SELECT json_agg(row_to_json(e)) FROM (
        SELECT feature, source, granted_at, expires_at
        FROM user_entitlements
        WHERE user_id = target_user_id
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY granted_at
      ) e
    ),

    'athlete_profile', (
      SELECT json_build_object(
        'has_lifts', (lifts IS NOT NULL AND lifts != '{}'::jsonb),
        'lift_count', (SELECT COUNT(*) FROM jsonb_each_text(COALESCE(lifts, '{}'::jsonb)) WHERE value::numeric > 0),
        'has_skills', (skills IS NOT NULL AND skills != '{}'::jsonb),
        'skill_count', (SELECT COUNT(*) FROM jsonb_each_text(COALESCE(skills, '{}'::jsonb)) WHERE value != 'none' AND value != ''),
        'has_conditioning', (conditioning IS NOT NULL AND conditioning != '{}'::jsonb),
        'engine_current_day', engine_current_day,
        'engine_months_unlocked', engine_months_unlocked
      )
      FROM athlete_profiles WHERE user_id = target_user_id
    ),

    'chat', (
      SELECT json_build_object(
        'total_questions', COUNT(*),
        'total_input_tokens', COALESCE(SUM(input_tokens), 0),
        'total_output_tokens', COALESCE(SUM(output_tokens), 0),
        'last_question', MAX(created_at),
        'questions_7d', COUNT(*) FILTER (WHERE created_at >= today - INTERVAL '7 days'),
        'questions_30d', COUNT(*) FILTER (WHERE created_at >= today - INTERVAL '30 days')
      )
      FROM chat_messages WHERE user_id = target_user_id
    ),

    'engine', (
      SELECT json_build_object(
        'total_sessions', COUNT(*),
        'last_session', MAX(created_at),
        'sessions_30d', COUNT(*) FILTER (WHERE created_at >= today - INTERVAL '30 days'),
        'modalities', (
          SELECT json_agg(DISTINCT modality) FROM engine_workout_sessions WHERE user_id = target_user_id
        ),
        'avg_performance_ratio', ROUND(AVG(performance_ratio)::numeric, 2)
      )
      FROM engine_workout_sessions WHERE user_id = target_user_id
    ),

    'nutrition', (
      SELECT json_build_object(
        'total_entries', (SELECT COUNT(*) FROM food_entries WHERE user_id = target_user_id),
        'days_logged', (SELECT COUNT(DISTINCT date) FROM daily_nutrition WHERE user_id = target_user_id),
        'last_entry', (SELECT MAX(created_at) FROM food_entries WHERE user_id = target_user_id),
        'avg_daily_calories', (SELECT ROUND(AVG(total_calories)) FROM daily_nutrition WHERE user_id = target_user_id AND total_calories > 0),
        'entries_30d', (SELECT COUNT(*) FROM food_entries WHERE user_id = target_user_id AND created_at >= today - INTERVAL '30 days')
      )
    ),

    'programs', (
      SELECT json_agg(row_to_json(pr)) FROM (
        SELECT id, name, source, created_at,
          (SELECT COUNT(*) FROM program_workouts pw WHERE pw.program_id = programs.id) as workout_count
        FROM programs
        WHERE user_id = target_user_id
        ORDER BY created_at DESC
        LIMIT 10
      ) pr
    ),

    'evaluations', (
      SELECT json_agg(row_to_json(ev)) FROM (
        SELECT id, created_at
        FROM profile_evaluations
        WHERE user_id = target_user_id
        ORDER BY created_at DESC
        LIMIT 10
      ) ev
    ),

    'workouts', (
      SELECT json_build_object(
        'total_logged', (SELECT COUNT(*) FROM workout_logs WHERE user_id = target_user_id),
        'last_logged', (SELECT MAX(created_at) FROM workout_logs WHERE user_id = target_user_id),
        'logged_30d', (SELECT COUNT(*) FROM workout_logs WHERE user_id = target_user_id AND created_at >= today - INTERVAL '30 days')
      )
    )
  ) INTO result;
  RETURN result;
END;
$$;
