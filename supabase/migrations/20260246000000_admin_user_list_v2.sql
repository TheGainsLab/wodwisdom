-- Update admin_user_list to return per-product entitlement status
-- Replaces the single subscription_status with has_ai_suite, has_engine,
-- and engine_months_unlocked for granular admin control.

-- Must drop first because the return type changed
DROP FUNCTION IF EXISTS admin_user_list();

CREATE OR REPLACE FUNCTION admin_user_list()
RETURNS TABLE(
  id uuid,
  email text,
  full_name text,
  role text,
  has_ai_suite boolean,
  has_engine boolean,
  engine_months_unlocked integer,
  question_count bigint,
  total_tokens bigint,
  last_active timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.role,
    COALESCE(ai.has_ai_suite, false) AS has_ai_suite,
    COALESCE(eng.has_engine, false) AS has_engine,
    COALESCE(ap.engine_months_unlocked, 1) AS engine_months_unlocked,
    COALESCE(u.question_count, 0) AS question_count,
    COALESCE(u.total_tokens, 0) AS total_tokens,
    u.last_active
  FROM profiles p
  LEFT JOIN (
    SELECT user_id, true AS has_ai_suite
    FROM user_entitlements
    WHERE feature IN ('ai_chat', 'program_gen', 'workout_review', 'workout_log')
      AND (expires_at IS NULL OR expires_at > now())
    GROUP BY user_id
  ) ai ON ai.user_id = p.id
  LEFT JOIN (
    SELECT user_id, true AS has_engine
    FROM user_entitlements
    WHERE feature = 'engine'
      AND (expires_at IS NULL OR expires_at > now())
    GROUP BY user_id
  ) eng ON eng.user_id = p.id
  LEFT JOIN athlete_profiles ap ON ap.user_id = p.id
  LEFT JOIN (
    SELECT
      user_id,
      count(*) AS question_count,
      sum(input_tokens + output_tokens) AS total_tokens,
      max(created_at) AS last_active
    FROM chat_messages
    GROUP BY user_id
  ) u ON u.user_id = p.id
  ORDER BY u.question_count DESC NULLS LAST;
$$;
