-- admin_user_competition_link — the one fact the admin user-detail page needs
-- to show a linked user's competition data: their competition_athlete_id
-- (plus the label captured at link time). The page then feeds the id to the
-- verify-competition-athlete function, which already returns the full Tier 4
-- bundle to admins for ANY athlete.
--
-- A dedicated tiny RPC instead of widening admin_user_detail: that function
-- is large and the reproduce-verbatim discipline makes small additions
-- expensive; this one is self-contained and additive.

CREATE OR REPLACE FUNCTION admin_user_competition_link(target_user_id uuid)
RETURNS TABLE(competition_athlete_id text, competition_athlete_label text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  -- In-function admin gate (same pattern as admin_user_list_v2).
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  RETURN QUERY
  SELECT ap.competition_athlete_id, ap.competition_athlete_label
  FROM athlete_profiles ap
  WHERE ap.user_id = target_user_id
    AND ap.competition_athlete_id IS NOT NULL;
END;
$func$;

REVOKE ALL ON FUNCTION admin_user_competition_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_user_competition_link(uuid) TO authenticated;
