-- Admin dashboard analytics RPCs — Phase 1
-- Provides aggregate stats for Overview, Engagement, and Users tabs

-- ============================================================
-- 1. Overview stats: active users, subscribers, MRR, conversions
-- ============================================================
CREATE OR REPLACE FUNCTION admin_overview_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    -- Active users
    'active_today', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages
      WHERE created_at >= CURRENT_DATE
    ),
    'active_7d', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    ),
    'active_30d', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    ),
    'total_users', (
      SELECT COUNT(*) FROM profiles
    ),
    'new_signups_7d', (
      SELECT COUNT(*) FROM auth.users
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    ),
    'new_signups_30d', (
      SELECT COUNT(*) FROM auth.users
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    ),

    -- Subscribers by plan
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

    -- All entitled users (including manual/admin grants)
    'entitled_users', (
      SELECT json_agg(row_to_json(s)) FROM (
        SELECT feature, COUNT(DISTINCT user_id) as count
        FROM user_entitlements
        WHERE (expires_at IS NULL OR expires_at > NOW())
        GROUP BY feature
        ORDER BY count DESC
      ) s
    ),

    -- Trial conversion: users with entitlements / total users
    'users_with_entitlements', (
      SELECT COUNT(DISTINCT user_id) FROM user_entitlements
      WHERE (expires_at IS NULL OR expires_at > NOW())
    ),

    -- Profile completion funnel
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
-- 2. Feature usage: what are people doing
-- ============================================================
CREATE OR REPLACE FUNCTION admin_feature_usage(days_back int DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
  since timestamptz := CURRENT_DATE - (days_back || ' days')::interval;
BEGIN
  SELECT json_build_object(
    -- Chat usage
    'chat_questions', (
      SELECT COUNT(*) FROM chat_messages WHERE created_at >= since
    ),
    'chat_users', (
      SELECT COUNT(DISTINCT user_id) FROM chat_messages WHERE created_at >= since
    ),
    'chat_by_day', (
      SELECT json_agg(row_to_json(d) ORDER BY d.day) FROM (
        SELECT date_trunc('day', created_at)::date as day,
               COUNT(*) as questions,
               COUNT(DISTINCT user_id) as users
        FROM chat_messages
        WHERE created_at >= since
        GROUP BY 1
      ) d
    ),

    -- Token consumption
    'total_input_tokens', (
      SELECT COALESCE(SUM(input_tokens), 0) FROM chat_messages WHERE created_at >= since
    ),
    'total_output_tokens', (
      SELECT COALESCE(SUM(output_tokens), 0) FROM chat_messages WHERE created_at >= since
    ),

    -- Engine usage
    'engine_sessions', (
      SELECT COUNT(*) FROM engine_workout_sessions WHERE created_at >= since
    ),
    'engine_users', (
      SELECT COUNT(DISTINCT user_id) FROM engine_workout_sessions WHERE created_at >= since
    ),

    -- Nutrition usage
    'nutrition_entries', (
      SELECT COUNT(*) FROM food_entries WHERE created_at >= since
    ),
    'nutrition_users', (
      SELECT COUNT(DISTINCT user_id) FROM food_entries WHERE created_at >= since
    ),
    'nutrition_days_logged', (
      SELECT COUNT(DISTINCT (user_id, date)) FROM daily_nutrition
      WHERE date >= (CURRENT_DATE - days_back)
    ),

    -- Program generation
    'programs_generated', (
      SELECT COUNT(*) FROM programs WHERE source = 'generated' AND created_at >= since
    ),
    'evaluations_run', (
      SELECT COUNT(*) FROM profile_evaluations WHERE created_at >= since
    ),

    -- Workouts logged
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
-- 3. Enhanced user list with activity across all features
-- ============================================================
CREATE OR REPLACE FUNCTION admin_user_list_v2()
RETURNS TABLE(
  id uuid,
  email text,
  full_name text,
  role text,
  signup_date timestamptz,
  last_active timestamptz,
  entitlements text[],
  question_count bigint,
  total_tokens bigint,
  engine_day integer,
  engine_sessions_count bigint,
  nutrition_days_logged bigint,
  workouts_logged bigint,
  programs_count bigint,
  has_profile boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.role,
    au.created_at as signup_date,
    GREATEST(
      (SELECT MAX(cm.created_at) FROM chat_messages cm WHERE cm.user_id = p.id),
      (SELECT MAX(fe.created_at) FROM food_entries fe WHERE fe.user_id = p.id),
      (SELECT MAX(es.created_at) FROM engine_workout_sessions es WHERE es.user_id = p.id),
      (SELECT MAX(wl.created_at) FROM workout_logs wl WHERE wl.user_id = p.id)
    ) as last_active,
    (
      SELECT ARRAY_AGG(DISTINCT ue.feature)
      FROM user_entitlements ue
      WHERE ue.user_id = p.id
        AND (ue.expires_at IS NULL OR ue.expires_at > NOW())
    ) as entitlements,
    (SELECT COUNT(*) FROM chat_messages cm WHERE cm.user_id = p.id) as question_count,
    (SELECT COALESCE(SUM(cm.input_tokens + cm.output_tokens), 0) FROM chat_messages cm WHERE cm.user_id = p.id) as total_tokens,
    ap.engine_current_day as engine_day,
    (SELECT COUNT(*) FROM engine_workout_sessions es WHERE es.user_id = p.id) as engine_sessions_count,
    (SELECT COUNT(DISTINCT dn.date) FROM daily_nutrition dn WHERE dn.user_id = p.id) as nutrition_days_logged,
    (SELECT COUNT(*) FROM workout_logs wl WHERE wl.user_id = p.id) as workouts_logged,
    (SELECT COUNT(*) FROM programs pr WHERE pr.user_id = p.id) as programs_count,
    (ap.user_id IS NOT NULL) as has_profile
  FROM profiles p
  JOIN auth.users au ON au.id = p.id
  LEFT JOIN athlete_profiles ap ON ap.user_id = p.id
  ORDER BY last_active DESC NULLS LAST;
END;
$$;

-- ============================================================
-- 4. Single user detail — everything about one user
-- ============================================================
CREATE OR REPLACE FUNCTION admin_user_detail(target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    -- Account info
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

    -- Entitlements
    'entitlements', (
      SELECT json_agg(row_to_json(e)) FROM (
        SELECT feature, source, granted_at, expires_at
        FROM user_entitlements
        WHERE user_id = target_user_id
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY granted_at
      ) e
    ),

    -- Profile completeness
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

    -- Chat usage
    'chat', (
      SELECT json_build_object(
        'total_questions', COUNT(*),
        'total_input_tokens', COALESCE(SUM(input_tokens), 0),
        'total_output_tokens', COALESCE(SUM(output_tokens), 0),
        'last_question', MAX(created_at),
        'questions_7d', COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'),
        'questions_30d', COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')
      )
      FROM chat_messages WHERE user_id = target_user_id
    ),

    -- Engine progress
    'engine', (
      SELECT json_build_object(
        'total_sessions', COUNT(*),
        'last_session', MAX(created_at),
        'sessions_30d', COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'),
        'modalities', (
          SELECT json_agg(DISTINCT modality) FROM engine_workout_sessions WHERE user_id = target_user_id
        ),
        'avg_performance_ratio', ROUND(AVG(performance_ratio)::numeric, 2)
      )
      FROM engine_workout_sessions WHERE user_id = target_user_id
    ),

    -- Nutrition
    'nutrition', (
      SELECT json_build_object(
        'total_entries', (SELECT COUNT(*) FROM food_entries WHERE user_id = target_user_id),
        'days_logged', (SELECT COUNT(DISTINCT date) FROM daily_nutrition WHERE user_id = target_user_id),
        'last_entry', (SELECT MAX(created_at) FROM food_entries WHERE user_id = target_user_id),
        'avg_daily_calories', (SELECT ROUND(AVG(total_calories)) FROM daily_nutrition WHERE user_id = target_user_id AND total_calories > 0),
        'entries_30d', (SELECT COUNT(*) FROM food_entries WHERE user_id = target_user_id AND created_at >= CURRENT_DATE - INTERVAL '30 days')
      )
    ),

    -- Programs
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

    -- Evaluations
    'evaluations', (
      SELECT json_agg(row_to_json(ev)) FROM (
        SELECT id, created_at
        FROM profile_evaluations
        WHERE user_id = target_user_id
        ORDER BY created_at DESC
        LIMIT 10
      ) ev
    ),

    -- Workout logging
    'workouts', (
      SELECT json_build_object(
        'total_logged', (SELECT COUNT(*) FROM workout_logs WHERE user_id = target_user_id),
        'last_logged', (SELECT MAX(created_at) FROM workout_logs WHERE user_id = target_user_id),
        'logged_30d', (SELECT COUNT(*) FROM workout_logs WHERE user_id = target_user_id AND created_at >= CURRENT_DATE - INTERVAL '30 days')
      )
    )
  ) INTO result;
  RETURN result;
END;
$$;
