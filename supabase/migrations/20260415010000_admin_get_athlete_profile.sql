-- Admin drill-down #1: athlete profile.
-- Returns the full athlete_profiles row for a target user. Used by the
-- AdminAthleteProfilePage sub-page to render a read-only view of lifts,
-- skills, conditioning, equipment, etc.

CREATE OR REPLACE FUNCTION public.admin_get_athlete_profile(
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

  PERFORM log_admin_access(target_user_id, 'athlete_profile', NULL);

  SELECT to_jsonb(ap.*) INTO result
  FROM athlete_profiles ap
  WHERE user_id = target_user_id;

  -- Include updated_at on the owning profile as a fallback "last activity"
  -- hint even when the athlete_profiles row is missing. Also include the
  -- target user's email + full_name so the admin page can render a header
  -- without an extra round-trip.
  RETURN jsonb_build_object(
    'athlete_profile', result,
    'user', (
      SELECT jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'full_name', p.full_name
      )
      FROM profiles p
      WHERE p.id = target_user_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_athlete_profile(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_athlete_profile(uuid) TO authenticated;
