-- Tiny RPC used by AdminSubPageLayout to render the user header on every
-- drill-down sub-page. Direct SELECT from profiles via the frontend is
-- blocked for non-self rows by RLS, so we expose this gated SECURITY
-- DEFINER function instead.

CREATE OR REPLACE FUNCTION public.admin_get_user_summary(
  target_user_id uuid
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

  SELECT jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'full_name', p.full_name,
    'role', p.role,
    'entitlement_features', COALESCE((
      SELECT jsonb_agg(DISTINCT feature ORDER BY feature)
      FROM user_entitlements
      WHERE user_id = target_user_id
        AND (expires_at IS NULL OR expires_at > now())
    ), '[]'::jsonb)
  ) INTO result
  FROM profiles p
  WHERE p.id = target_user_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_summary(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_user_summary(uuid) TO authenticated;
