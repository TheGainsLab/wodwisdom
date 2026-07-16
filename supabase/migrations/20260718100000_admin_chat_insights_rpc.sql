-- Admin chat insights rollup: powers the "AI Chat Insights" section on the
-- Engagement tab. Aggregates the AI-assigned labels in chat_question_insights
-- (20260718000000) joined to chat_messages for question previews.
--
-- days_back = NULL means all time (the taxonomy mix over the full history is
-- the headline view); otherwise the window filters on chat_messages.created_at
-- (when the question was ASKED, not when it was classified).
--
-- Gated on is_current_user_admin(); logged against the all-zeros sentinel
-- (no single target user — same convention as admin_activity_feed).

CREATE OR REPLACE FUNCTION public.admin_chat_insights(
  days_back int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cutoff timestamptz := CASE WHEN days_back IS NULL THEN NULL
                             ELSE now() - make_interval(days => LEAST(GREATEST(days_back, 1), 3650)) END;
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM log_admin_access(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'chat_insights',
    jsonb_build_object('days_back', days_back)
  );

  WITH scoped AS (
    SELECT i.*, m.question, m.created_at AS asked_at
    FROM chat_question_insights i
    JOIN chat_messages m ON m.id = i.message_id
    WHERE cutoff IS NULL OR m.created_at >= cutoff
  )
  SELECT jsonb_build_object(
    'total_classified', (SELECT count(*) FROM scoped),
    'unclassified', (
      SELECT count(*) FROM chat_messages m
      LEFT JOIN chat_question_insights i ON i.message_id = m.id
      WHERE i.message_id IS NULL AND m.question IS NOT NULL AND m.question <> ''
        AND (cutoff IS NULL OR m.created_at >= cutoff)
    ),
    'topics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('topic', topic, 'n', n) ORDER BY n DESC)
      FROM (SELECT topic, count(*) AS n FROM scoped GROUP BY topic) t
    ), '[]'::jsonb),
    'intents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('intent', intent, 'n', n) ORDER BY n DESC)
      FROM (SELECT intent, count(*) AS n FROM scoped GROUP BY intent) t
    ), '[]'::jsonb),
    'buying_intent_n', (SELECT count(*) FROM scoped WHERE buying_intent),
    'review_worthy_n', (SELECT count(*) FROM scoped WHERE review_worthy),
    'feature_requests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'question', left(question, 160), 'asked_at', asked_at, 'user_id', user_id
      ) ORDER BY asked_at DESC)
      FROM (SELECT * FROM scoped WHERE intent = 'feature_request' ORDER BY asked_at DESC LIMIT 15) f
    ), '[]'::jsonb),
    'review_queue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'question', left(question, 160), 'asked_at', asked_at, 'user_id', user_id
      ) ORDER BY asked_at DESC)
      FROM (SELECT * FROM scoped WHERE review_worthy ORDER BY asked_at DESC LIMIT 15) r
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_chat_insights(int) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_chat_insights(int) TO authenticated;
