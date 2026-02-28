-- Drop subscription_status from profiles (replaced by user_entitlements)
-- Drop engine_subscription_status from athlete_profiles (replaced by user_entitlements)

-- 1. Update the handle_new_user trigger to stop setting subscription_status
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'user'
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        email = COALESCE(EXCLUDED.email, profiles.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Update admin_user_list to show entitlement status instead of subscription_status
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
    CASE WHEN e.cnt > 0 THEN 'active' ELSE 'inactive' END AS subscription_status,
    COALESCE(u.question_count, 0) AS question_count,
    COALESCE(u.total_tokens, 0) AS total_tokens,
    u.last_active
  FROM profiles p
  LEFT JOIN (
    SELECT user_id, count(*) AS cnt
    FROM user_entitlements
    WHERE expires_at IS NULL OR expires_at > now()
    GROUP BY user_id
  ) e ON e.user_id = p.id
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

-- 3. Drop the columns
ALTER TABLE profiles DROP COLUMN IF EXISTS subscription_status;
ALTER TABLE athlete_profiles DROP COLUMN IF EXISTS engine_subscription_status;
