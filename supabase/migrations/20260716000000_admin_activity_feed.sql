-- Admin cross-user activity feed.
--
-- RPC for /admin/activity: the same event union as admin_user_timeline
-- (20260715000000/000100) but across ALL users, each event joined to
-- profiles for name/email so the feed answers "who has been doing what over
-- the last few days" — the drill-down the Overview tab's anonymous
-- active-user counts can't provide.
--
-- TIME-BOUNDED BY DESIGN: the per-user timeline can afford unbounded UNIONs
-- because every branch filters on an indexed user_id; a global feed over all
-- history would walk every event table end to end. p_days is clamped to
-- 1..30 (default 3) and every branch filters on its timestamp before the
-- union, so each scan stays proportional to the window.
--
-- Column references verified against the live information_schema (2026-07-15
-- paste), same audit that fixed 20260715000100 — notably workout score lives
-- on workout_log_blocks, and source_type exists on workout_logs (re-added in
-- 20260277 after the 20260235 drop).
--
-- Audit: admin_access_log.target_user_id is NOT NULL and log_admin_access
-- swallows insert failures, so a NULL target would silently skip logging.
-- Feed views are therefore logged against the all-zeros sentinel uuid with
-- resource 'activity_feed' (no FK on the column; queryable and unambiguous).

CREATE OR REPLACE FUNCTION public.admin_activity_feed(
  p_days int DEFAULT 3,
  p_limit int DEFAULT 50,
  p_before timestamptz DEFAULT NULL,
  p_types text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  days int := LEAST(GREATEST(COALESCE(p_days, 3), 1), 30);
  cutoff timestamptz;
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  cutoff := now() - make_interval(days => days);

  PERFORM log_admin_access(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'activity_feed',
    jsonb_build_object('days', days, 'limit', p_limit, 'before', p_before, 'types', p_types)
  );

  WITH ev AS (
    -- Account lifecycle
    SELECT u.id AS user_id, u.created_at AS event_at, 'signup'::text AS type, '{}'::jsonb AS detail
    FROM auth.users u WHERE u.created_at >= cutoff

    UNION ALL
    SELECT u.id, u.email_confirmed_at, 'email_confirmed', '{}'::jsonb
    FROM auth.users u WHERE u.email_confirmed_at >= cutoff

    -- Athlete profile edits
    UNION ALL
    SELECT h.user_id, h.changed_at, 'profile_update', jsonb_build_object('op', h.op)
    FROM athlete_profile_history h WHERE h.changed_at >= cutoff

    -- Evaluations
    UNION ALL
    SELECT e.user_id, e.created_at, 'evaluation_profile', jsonb_build_object('id', e.id)
    FROM profile_evaluations e WHERE e.created_at >= cutoff

    UNION ALL
    SELECT e.user_id, e.created_at, 'evaluation_training', jsonb_build_object('id', e.id)
    FROM training_evaluations e WHERE e.created_at >= cutoff

    UNION ALL
    SELECT e.user_id, e.created_at, 'evaluation_nutrition', jsonb_build_object('id', e.id)
    FROM nutrition_evaluations e WHERE e.created_at >= cutoff

    -- Chat
    UNION ALL
    SELECT m.user_id, m.created_at, 'chat_question',
      jsonb_build_object('id', m.id, 'question', left(m.question, 160))
    FROM chat_messages m WHERE m.created_at >= cutoff

    UNION ALL
    SELECT r.user_id, r.created_at, 'chat_rating',
      jsonb_build_object('rating', r.rating, 'message_id', r.message_id)
    FROM chat_message_ratings r WHERE r.created_at >= cutoff

    -- Engine
    UNION ALL
    SELECT s.user_id, s.created_at, 'engine_session',
      jsonb_build_object(
        'id', s.id, 'program_day_number', s.program_day_number,
        'day_type', s.day_type, 'modality', s.modality,
        'performance_ratio', s.performance_ratio, 'completed', s.completed
      )
    FROM engine_workout_sessions s WHERE s.created_at >= cutoff

    UNION ALL
    SELECT t.user_id, t.created_at, 'time_trial',
      jsonb_build_object('modality', t.modality, 'total_output', t.total_output, 'units', t.units)
    FROM engine_time_trials t WHERE t.created_at >= cutoff

    -- Training log (score from first non-null block score, as in
    -- admin_list_workout_logs / admin_user_timeline)
    UNION ALL
    SELECT w.user_id, w.created_at, 'workout_log',
      jsonb_build_object(
        'id', w.id, 'workout_type', w.workout_type, 'source_type', w.source_type,
        'score', (
          SELECT b.score FROM workout_log_blocks b
          WHERE b.log_id = w.id AND b.score IS NOT NULL
          ORDER BY b.sort_order LIMIT 1
        ),
        'workout_date', w.workout_date
      )
    FROM workout_logs w WHERE w.created_at >= cutoff

    -- Nutrition, one event per user per logged day
    UNION ALL
    SELECT f.user_id, max(f.logged_at), 'nutrition_day',
      jsonb_build_object(
        'day', (f.logged_at AT TIME ZONE 'UTC')::date,
        'entries', count(*), 'calories', round(coalesce(sum(f.calories), 0))
      )
    FROM food_entries f WHERE f.logged_at >= cutoff
    GROUP BY f.user_id, (f.logged_at AT TIME ZONE 'UTC')::date

    -- Programs
    UNION ALL
    SELECT p.user_id, p.created_at, 'program_created', jsonb_build_object('id', p.id, 'name', p.name)
    FROM programs p WHERE p.created_at >= cutoff

    -- Access lifecycle
    UNION ALL
    SELECT g.user_id, g.granted_at, 'entitlement',
      jsonb_build_object(
        'feature', g.feature, 'source', g.source,
        'source_kind', g.source_kind, 'expires_at', g.expires_at
      )
    FROM user_entitlements g WHERE g.granted_at >= cutoff

    -- Outbound email
    UNION ALL
    SELECT s.user_id, s.sent_at, 'email',
      jsonb_build_object(
        'id', s.id, 'subject', s.subject, 'template_key', s.template_key,
        'status', s.status, 'last_event_at', s.last_event_at
      )
    FROM email_sends s WHERE s.sent_at >= cutoff
  ),
  page AS (
    SELECT ev.*, pr.full_name AS user_name, pr.email AS user_email
    FROM ev
    LEFT JOIN profiles pr ON pr.id = ev.user_id
    WHERE ev.event_at IS NOT NULL
      AND (p_before IS NULL OR ev.event_at < p_before)
      AND (p_types IS NULL OR ev.type = ANY(p_types))
    ORDER BY ev.event_at DESC
    LIMIT p_limit + 1
  )
  SELECT jsonb_build_object(
    'days', days,
    'counts', (
      SELECT COALESCE(jsonb_object_agg(type, n), '{}'::jsonb)
      FROM (SELECT type, count(*) AS n FROM ev WHERE event_at IS NOT NULL GROUP BY type) c
    ),
    'active_users', (SELECT count(DISTINCT user_id) FROM ev WHERE event_at IS NOT NULL),
    'has_more', (SELECT count(*) FROM page) > p_limit,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_at', p.event_at, 'type', p.type, 'detail', p.detail,
        'user_id', p.user_id, 'user_name', p.user_name, 'user_email', p.user_email
      ) ORDER BY p.event_at DESC)
      FROM (SELECT * FROM page ORDER BY event_at DESC LIMIT p_limit) p
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_activity_feed(int, int, timestamptz, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_activity_feed(int, int, timestamptz, text[]) TO authenticated;
