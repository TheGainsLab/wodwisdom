-- Behavior report (stage D readout — shipped WITH the capture, not after:
-- an immediately-visible section validates the event pipeline end-to-end
-- instead of letting a silent instrumentation bug eat two weeks of data).
--
-- admin_report_behavior(): last-7-days aggregates over app_events for the
-- /admin/reports Behavior section. House admin gate.

CREATE OR REPLACE FUNCTION public.admin_report_behavior()
RETURNS jsonb
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
  PERFORM log_admin_access(auth.uid(), 'reports', jsonb_build_object('section', 'behavior'));

  SELECT jsonb_build_object(
    'events_total', (
      SELECT COUNT(*) FROM app_events e WHERE e.created_at >= now() - interval '7 days'
    ),
    'users_seen', (
      SELECT COUNT(DISTINCT e.user_id) FROM app_events e WHERE e.created_at >= now() - interval '7 days'
    ),
    -- The train-without-log funnel: viewed → started timer → started logging
    -- → actually submitted (real table, not an event — the ground truth).
    'engine_funnel', (
      SELECT jsonb_build_object(
        'viewed', COUNT(*) FILTER (WHERE e.event = 'workout_viewed'),
        'timer_started', COUNT(*) FILTER (WHERE e.event = 'timer_started'),
        'log_started', COUNT(*) FILTER (WHERE e.event = 'log_started' AND e.props->>'kind' = 'engine'),
        'logged', (SELECT COUNT(*) FROM engine_workout_sessions s
                   WHERE s.created_at >= now() - interval '7 days' AND s.completed)
      )
      FROM app_events e WHERE e.created_at >= now() - interval '7 days'
    ),
    'nutrition_methods', (
      SELECT COALESCE(jsonb_object_agg(t.method, t.cnt), '{}'::jsonb)
      FROM (
        SELECT e.props->>'method' AS method, COUNT(*) AS cnt
        FROM app_events e
        WHERE e.event = 'nutrition_method' AND e.created_at >= now() - interval '7 days'
        GROUP BY 1
      ) t
    ),
    'paywall_hits', (
      SELECT COALESCE(jsonb_object_agg(t.feature, t.cnt), '{}'::jsonb)
      FROM (
        SELECT e.props->>'feature' AS feature, COUNT(*) AS cnt
        FROM app_events e
        WHERE e.event = 'paywall_hit' AND e.created_at >= now() - interval '7 days'
        GROUP BY 1
      ) t
    ),
    -- Pre-churn intent: WHO opened billing management (worth names, not
    -- just a count — each one is a conversation to have).
    'billing_portal', (
      SELECT COALESCE(jsonb_agg(DISTINCT p.email), '[]'::jsonb)
      FROM app_events e JOIN profiles p ON p.id = e.user_id
      WHERE e.event = 'billing_portal_opened' AND e.created_at >= now() - interval '7 days'
    ),
    'client_errors', (
      SELECT jsonb_build_object(
        'count', COUNT(*),
        'recent', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('path', t.path, 'msg', t.msg, 'at', t.at))
          FROM (
            SELECT e.props->>'path' AS path, e.props->>'msg' AS msg, e.created_at AS at
            FROM app_events e
            WHERE e.event = 'client_error' AND e.created_at >= now() - interval '7 days'
            ORDER BY e.created_at DESC LIMIT 5
          ) t
        ), '[]'::jsonb)
      )
      FROM app_events e
      WHERE e.event = 'client_error' AND e.created_at >= now() - interval '7 days'
    ),
    'top_routes', (
      SELECT COALESCE(jsonb_object_agg(t.path, t.cnt), '{}'::jsonb)
      FROM (
        SELECT e.props->>'path' AS path, COUNT(*) AS cnt
        FROM app_events e
        WHERE e.event = 'page_view' AND e.created_at >= now() - interval '7 days'
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 12
      ) t
    ),
    'other', (
      SELECT jsonb_build_object(
        'eval_viewed', COUNT(*) FILTER (WHERE e.event = 'eval_viewed'),
        'profile_started', COUNT(*) FILTER (WHERE e.event = 'profile_started'),
        'share_used', COUNT(*) FILTER (WHERE e.event = 'share_used'),
        'install_prompts', COUNT(*) FILTER (WHERE e.event = 'install_prompt')
      )
      FROM app_events e WHERE e.created_at >= now() - interval '7 days'
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_behavior() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_report_behavior() TO authenticated;
