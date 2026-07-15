-- Fix the "active user" definition: count all product activity, not just chat.
--
-- admin_overview_stats defined active_today/7d/30d purely from chat_messages,
-- so an Engine subscriber who trains daily but never chats — or a nutrition
-- logger, or a workout logger — read as INACTIVE in the headline dashboard
-- numbers. Active now means "produced any content-write in the window":
-- chat message, engine session, workout log, or food entry (the same four
-- tables admin_user_list_v2 already uses for last_active, and the same
-- de-facto activity definition admin-delete-users protects).
--
-- The function is reproduced VERBATIM from its latest form (20260702120000,
-- which added the gym-grant exclusion) with ONLY the three active_* subqueries
-- changed — same discipline that migration used.

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
      SELECT COUNT(DISTINCT user_id) FROM (
        SELECT user_id FROM chat_messages WHERE created_at >= today
        UNION ALL SELECT user_id FROM engine_workout_sessions WHERE created_at >= today
        UNION ALL SELECT user_id FROM workout_logs WHERE created_at >= today
        UNION ALL SELECT user_id FROM food_entries WHERE logged_at >= today
      ) a
    ),
    'active_7d', (
      SELECT COUNT(DISTINCT user_id) FROM (
        SELECT user_id FROM chat_messages WHERE created_at >= today - INTERVAL '7 days'
        UNION ALL SELECT user_id FROM engine_workout_sessions WHERE created_at >= today - INTERVAL '7 days'
        UNION ALL SELECT user_id FROM workout_logs WHERE created_at >= today - INTERVAL '7 days'
        UNION ALL SELECT user_id FROM food_entries WHERE logged_at >= today - INTERVAL '7 days'
      ) a
    ),
    'active_30d', (
      SELECT COUNT(DISTINCT user_id) FROM (
        SELECT user_id FROM chat_messages WHERE created_at >= today - INTERVAL '30 days'
        UNION ALL SELECT user_id FROM engine_workout_sessions WHERE created_at >= today - INTERVAL '30 days'
        UNION ALL SELECT user_id FROM workout_logs WHERE created_at >= today - INTERVAL '30 days'
        UNION ALL SELECT user_id FROM food_entries WHERE logged_at >= today - INTERVAL '30 days'
      ) a
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
          AND source_kind <> 'gym_grant'
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
