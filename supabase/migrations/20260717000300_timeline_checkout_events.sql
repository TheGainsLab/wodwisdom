-- Surface checkout_attempts (20260717000100) as 'checkout' events in both
-- activity RPCs. Both functions are reproduced verbatim from their latest
-- forms (admin_user_timeline: 20260715000100; admin_activity_feed:
-- 20260716000000) with ONLY the checkout branch added.
--
-- Event shape: type 'checkout', detail {plan, interval, status, completed_at}.
-- A 'started' that never completes is the abandonment breadcrumb.

-- ─── admin_user_timeline ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_user_timeline(
  target_user_id uuid,
  p_limit int DEFAULT 30,
  p_before timestamptz DEFAULT NULL,
  p_types text[] DEFAULT NULL
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
    'timeline',
    jsonb_build_object('limit', p_limit, 'before', p_before, 'types', p_types)
  );

  WITH ev AS (
    SELECT u.created_at AS event_at, 'signup'::text AS type, '{}'::jsonb AS detail
    FROM auth.users u WHERE u.id = target_user_id

    UNION ALL
    SELECT u.email_confirmed_at, 'email_confirmed', '{}'::jsonb
    FROM auth.users u WHERE u.id = target_user_id AND u.email_confirmed_at IS NOT NULL

    UNION ALL
    SELECT h.changed_at, 'profile_update', jsonb_build_object('op', h.op)
    FROM athlete_profile_history h WHERE h.user_id = target_user_id

    UNION ALL
    SELECT e.created_at, 'evaluation_profile', jsonb_build_object('id', e.id)
    FROM profile_evaluations e WHERE e.user_id = target_user_id

    UNION ALL
    SELECT e.created_at, 'evaluation_training', jsonb_build_object('id', e.id)
    FROM training_evaluations e WHERE e.user_id = target_user_id

    UNION ALL
    SELECT e.created_at, 'evaluation_nutrition', jsonb_build_object('id', e.id)
    FROM nutrition_evaluations e WHERE e.user_id = target_user_id

    UNION ALL
    SELECT m.created_at, 'chat_question',
      jsonb_build_object('id', m.id, 'question', left(m.question, 160))
    FROM chat_messages m WHERE m.user_id = target_user_id

    UNION ALL
    SELECT r.created_at, 'chat_rating',
      jsonb_build_object('rating', r.rating, 'message_id', r.message_id)
    FROM chat_message_ratings r WHERE r.user_id = target_user_id

    UNION ALL
    SELECT s.created_at, 'engine_session',
      jsonb_build_object(
        'id', s.id, 'program_day_number', s.program_day_number,
        'day_type', s.day_type, 'modality', s.modality,
        'performance_ratio', s.performance_ratio, 'completed', s.completed
      )
    FROM engine_workout_sessions s WHERE s.user_id = target_user_id

    UNION ALL
    SELECT t.created_at, 'time_trial',
      jsonb_build_object('modality', t.modality, 'total_output', t.total_output, 'units', t.units)
    FROM engine_time_trials t WHERE t.user_id = target_user_id

    UNION ALL
    SELECT w.created_at, 'workout_log',
      jsonb_build_object(
        'id', w.id, 'workout_type', w.workout_type, 'source_type', w.source_type,
        'score', (
          SELECT b.score FROM workout_log_blocks b
          WHERE b.log_id = w.id AND b.score IS NOT NULL
          ORDER BY b.sort_order LIMIT 1
        ),
        'workout_date', w.workout_date
      )
    FROM workout_logs w WHERE w.user_id = target_user_id

    UNION ALL
    SELECT max(f.logged_at), 'nutrition_day',
      jsonb_build_object(
        'day', (f.logged_at AT TIME ZONE 'UTC')::date,
        'entries', count(*), 'calories', round(coalesce(sum(f.calories), 0))
      )
    FROM food_entries f WHERE f.user_id = target_user_id
    GROUP BY (f.logged_at AT TIME ZONE 'UTC')::date

    UNION ALL
    SELECT p.created_at, 'program_created', jsonb_build_object('id', p.id, 'name', p.name)
    FROM programs p WHERE p.user_id = target_user_id

    UNION ALL
    SELECT g.granted_at, 'entitlement',
      jsonb_build_object(
        'feature', g.feature, 'source', g.source,
        'source_kind', g.source_kind, 'expires_at', g.expires_at
      )
    FROM user_entitlements g WHERE g.user_id = target_user_id

    -- Checkout breadcrumbs (20260717000100)
    UNION ALL
    SELECT c.created_at, 'checkout',
      jsonb_build_object(
        'plan', c.plan, 'interval', c.billing_interval,
        'status', c.status, 'completed_at', c.completed_at
      )
    FROM checkout_attempts c WHERE c.user_id = target_user_id

    UNION ALL
    SELECT s.sent_at, 'email',
      jsonb_build_object(
        'id', s.id, 'subject', s.subject, 'template_key', s.template_key,
        'status', s.status, 'last_event_at', s.last_event_at
      )
    FROM email_sends s WHERE s.user_id = target_user_id
  ),
  page AS (
    SELECT * FROM ev
    WHERE event_at IS NOT NULL
      AND (p_before IS NULL OR event_at < p_before)
      AND (p_types IS NULL OR type = ANY(p_types))
    ORDER BY event_at DESC
    LIMIT p_limit + 1
  )
  SELECT jsonb_build_object(
    'counts', (
      SELECT COALESCE(jsonb_object_agg(type, n), '{}'::jsonb)
      FROM (SELECT type, count(*) AS n FROM ev WHERE event_at IS NOT NULL GROUP BY type) c
    ),
    'has_more', (SELECT count(*) FROM page) > p_limit,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_at', p.event_at, 'type', p.type, 'detail', p.detail
      ) ORDER BY p.event_at DESC)
      FROM (SELECT * FROM page ORDER BY event_at DESC LIMIT p_limit) p
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- ─── admin_activity_feed ─────────────────────────────────────────────

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
    SELECT u.id AS user_id, u.created_at AS event_at, 'signup'::text AS type, '{}'::jsonb AS detail
    FROM auth.users u WHERE u.created_at >= cutoff

    UNION ALL
    SELECT u.id, u.email_confirmed_at, 'email_confirmed', '{}'::jsonb
    FROM auth.users u WHERE u.email_confirmed_at >= cutoff

    UNION ALL
    SELECT h.user_id, h.changed_at, 'profile_update', jsonb_build_object('op', h.op)
    FROM athlete_profile_history h WHERE h.changed_at >= cutoff

    UNION ALL
    SELECT e.user_id, e.created_at, 'evaluation_profile', jsonb_build_object('id', e.id)
    FROM profile_evaluations e WHERE e.created_at >= cutoff

    UNION ALL
    SELECT e.user_id, e.created_at, 'evaluation_training', jsonb_build_object('id', e.id)
    FROM training_evaluations e WHERE e.created_at >= cutoff

    UNION ALL
    SELECT e.user_id, e.created_at, 'evaluation_nutrition', jsonb_build_object('id', e.id)
    FROM nutrition_evaluations e WHERE e.created_at >= cutoff

    UNION ALL
    SELECT m.user_id, m.created_at, 'chat_question',
      jsonb_build_object('id', m.id, 'question', left(m.question, 160))
    FROM chat_messages m WHERE m.created_at >= cutoff

    UNION ALL
    SELECT r.user_id, r.created_at, 'chat_rating',
      jsonb_build_object('rating', r.rating, 'message_id', r.message_id)
    FROM chat_message_ratings r WHERE r.created_at >= cutoff

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

    UNION ALL
    SELECT f.user_id, max(f.logged_at), 'nutrition_day',
      jsonb_build_object(
        'day', (f.logged_at AT TIME ZONE 'UTC')::date,
        'entries', count(*), 'calories', round(coalesce(sum(f.calories), 0))
      )
    FROM food_entries f WHERE f.logged_at >= cutoff
    GROUP BY f.user_id, (f.logged_at AT TIME ZONE 'UTC')::date

    UNION ALL
    SELECT p.user_id, p.created_at, 'program_created', jsonb_build_object('id', p.id, 'name', p.name)
    FROM programs p WHERE p.created_at >= cutoff

    UNION ALL
    SELECT g.user_id, g.granted_at, 'entitlement',
      jsonb_build_object(
        'feature', g.feature, 'source', g.source,
        'source_kind', g.source_kind, 'expires_at', g.expires_at
      )
    FROM user_entitlements g WHERE g.granted_at >= cutoff

    -- Checkout breadcrumbs (20260717000100). user_id may be NULL for
    -- account-less checkouts; those rows still appear (name shows unknown).
    UNION ALL
    SELECT c.user_id, c.created_at, 'checkout',
      jsonb_build_object(
        'plan', c.plan, 'interval', c.billing_interval,
        'status', c.status, 'completed_at', c.completed_at
      )
    FROM checkout_attempts c WHERE c.created_at >= cutoff

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
