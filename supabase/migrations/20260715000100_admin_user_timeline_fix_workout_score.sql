-- Fix admin_user_timeline: workout_logs.score does not exist.
--
-- The original 20260715000000 migration referenced w.score on workout_logs,
-- but that column was moved to workout_log_blocks in 20260231 (per-block
-- scores) and never re-added — plpgsql doesn't validate the body at CREATE
-- time, so the break only surfaced on first execution. Verified against the
-- live information_schema: this was the single invalid column reference in
-- the function; every other reference matches production.
--
-- The workout_log branch now derives the score the same way the existing
-- admin_list_workout_logs RPC derives top_score: first non-null block score
-- by sort_order. The jsonb key stays 'score' so the UI needs no change.
-- Everything else is identical to 20260715000000.

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
    -- Account lifecycle
    SELECT u.created_at AS event_at, 'signup'::text AS type, '{}'::jsonb AS detail
    FROM auth.users u WHERE u.id = target_user_id

    UNION ALL
    SELECT u.email_confirmed_at, 'email_confirmed', '{}'::jsonb
    FROM auth.users u WHERE u.id = target_user_id AND u.email_confirmed_at IS NOT NULL

    -- Athlete profile edits (history trigger already filters machine churn)
    UNION ALL
    SELECT h.changed_at, 'profile_update', jsonb_build_object('op', h.op)
    FROM athlete_profile_history h WHERE h.user_id = target_user_id

    -- Evaluations
    UNION ALL
    SELECT e.created_at, 'evaluation_profile', jsonb_build_object('id', e.id)
    FROM profile_evaluations e WHERE e.user_id = target_user_id

    UNION ALL
    SELECT e.created_at, 'evaluation_training', jsonb_build_object('id', e.id)
    FROM training_evaluations e WHERE e.user_id = target_user_id

    UNION ALL
    SELECT e.created_at, 'evaluation_nutrition', jsonb_build_object('id', e.id)
    FROM nutrition_evaluations e WHERE e.user_id = target_user_id

    -- Chat
    UNION ALL
    SELECT m.created_at, 'chat_question',
      jsonb_build_object('id', m.id, 'question', left(m.question, 160))
    FROM chat_messages m WHERE m.user_id = target_user_id

    UNION ALL
    SELECT r.created_at, 'chat_rating',
      jsonb_build_object('rating', r.rating, 'message_id', r.message_id)
    FROM chat_message_ratings r WHERE r.user_id = target_user_id

    -- Engine
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

    -- Training log (score lives on workout_log_blocks; take the first
    -- non-null block score by sort_order, mirroring admin_list_workout_logs)
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

    -- Nutrition, one event per logged day
    UNION ALL
    SELECT max(f.logged_at), 'nutrition_day',
      jsonb_build_object(
        'day', (f.logged_at AT TIME ZONE 'UTC')::date,
        'entries', count(*), 'calories', round(coalesce(sum(f.calories), 0))
      )
    FROM food_entries f WHERE f.user_id = target_user_id
    GROUP BY (f.logged_at AT TIME ZONE 'UTC')::date

    -- Programs
    UNION ALL
    SELECT p.created_at, 'program_created', jsonb_build_object('id', p.id, 'name', p.name)
    FROM programs p WHERE p.user_id = target_user_id

    -- Access lifecycle
    UNION ALL
    SELECT g.granted_at, 'entitlement',
      jsonb_build_object(
        'feature', g.feature, 'source', g.source,
        'source_kind', g.source_kind, 'expires_at', g.expires_at
      )
    FROM user_entitlements g WHERE g.user_id = target_user_id

    -- Outbound email (status reflects the latest Resend webhook event)
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

REVOKE ALL ON FUNCTION public.admin_user_timeline(uuid, int, timestamptz, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_user_timeline(uuid, int, timestamptz, text[]) TO authenticated;
