-- Admin role and analytics RPC functions

-- 1. Add check constraint for valid roles (drop both possible constraint names)
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS valid_role;
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'coach', 'owner', 'admin'));

-- 2. Aggregate usage stats
CREATE OR REPLACE FUNCTION admin_usage_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total_questions', (SELECT count(*) FROM chat_messages),
    'today_questions', (SELECT count(*) FROM chat_messages WHERE created_at >= CURRENT_DATE),
    'week_questions', (SELECT count(*) FROM chat_messages WHERE created_at >= date_trunc('week', CURRENT_DATE)),
    'month_questions', (SELECT count(*) FROM chat_messages WHERE created_at >= date_trunc('month', CURRENT_DATE)),
    'total_input_tokens', (SELECT COALESCE(sum(input_tokens), 0) FROM chat_messages),
    'total_output_tokens', (SELECT COALESCE(sum(output_tokens), 0) FROM chat_messages),
    'today_input_tokens', (SELECT COALESCE(sum(input_tokens), 0) FROM chat_messages WHERE created_at >= CURRENT_DATE),
    'today_output_tokens', (SELECT COALESCE(sum(output_tokens), 0) FROM chat_messages WHERE created_at >= CURRENT_DATE),
    'active_users_today', (SELECT count(DISTINCT user_id) FROM chat_messages WHERE created_at >= CURRENT_DATE),
    'active_users_week', (SELECT count(DISTINCT user_id) FROM chat_messages WHERE created_at >= date_trunc('week', CURRENT_DATE)),
    'active_users_month', (SELECT count(DISTINCT user_id) FROM chat_messages WHERE created_at >= date_trunc('month', CURRENT_DATE)),
    'total_users', (SELECT count(*) FROM profiles),
    'total_bookmarks', (SELECT count(*) FROM bookmarks)
  ) INTO result;
  RETURN result;
END;
$$;

-- 3. Daily trend for the last N days
CREATE OR REPLACE FUNCTION admin_daily_trend(days_back int DEFAULT 30)
RETURNS TABLE(day date, question_count bigint, unique_users bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    d::date AS day,
    count(cm.id) AS question_count,
    count(DISTINCT cm.user_id) AS unique_users
  FROM generate_series(
    CURRENT_DATE - (days_back || ' days')::interval,
    CURRENT_DATE,
    '1 day'
  ) AS d
  LEFT JOIN chat_messages cm ON cm.created_at::date = d::date
  GROUP BY d::date
  ORDER BY d::date;
$$;

-- 4. Top users by question count
CREATE OR REPLACE FUNCTION admin_top_users(limit_count int DEFAULT 10)
RETURNS TABLE(user_id uuid, full_name text, email text, question_count bigint, total_tokens bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    cm.user_id,
    p.full_name,
    p.email,
    count(cm.id) AS question_count,
    COALESCE(sum(cm.input_tokens + cm.output_tokens), 0) AS total_tokens
  FROM chat_messages cm
  JOIN profiles p ON p.id = cm.user_id
  GROUP BY cm.user_id, p.full_name, p.email
  ORDER BY question_count DESC
  LIMIT limit_count;
$$;

-- 5. Full user list with usage stats
CREATE OR REPLACE FUNCTION admin_user_list()
RETURNS TABLE(
  id uuid,
  email text,
  full_name text,
  role text,
  subscription_status text,
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
    p.subscription_status,
    COALESCE(u.question_count, 0) AS question_count,
    COALESCE(u.total_tokens, 0) AS total_tokens,
    u.last_active
  FROM profiles p
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

-- Bootstrap: grant admin to your user (run manually)
-- UPDATE profiles SET role = 'admin' WHERE email = 'YOUR_EMAIL_HERE';
