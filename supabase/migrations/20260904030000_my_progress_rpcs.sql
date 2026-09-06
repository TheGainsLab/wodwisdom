-- My Progress (v1): self-scoped wrappers over the existing admin analytics
-- RPCs, so athletes can see their own aggregates — the charts have existed
-- since May '26, but only behind the admin gate. Each wrapper pins
-- target_user_id to auth.uid(): a caller can only ever read themself, so
-- these are safe for every authenticated user even while the My Progress
-- PAGE ships admin-gated for founder review (frontend feature flag).
--
-- Payload shapes are identical to the admin RPCs by construction (direct
-- delegation), so the page reuses the admin card components unchanged.

CREATE OR REPLACE FUNCTION my_lift_progress(days_back int DEFAULT 90)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT admin_user_lift_progress(auth.uid(), days_back);
$$;

CREATE OR REPLACE FUNCTION my_skill_volume(days_back int DEFAULT 90)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT admin_user_skill_volume(auth.uid(), days_back);
$$;

CREATE OR REPLACE FUNCTION my_adherence()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT admin_user_adherence(auth.uid());
$$;

REVOKE ALL ON FUNCTION my_lift_progress(int) FROM public, anon;
REVOKE ALL ON FUNCTION my_skill_volume(int) FROM public, anon;
REVOKE ALL ON FUNCTION my_adherence() FROM public, anon;
GRANT EXECUTE ON FUNCTION my_lift_progress(int) TO authenticated;
GRANT EXECUTE ON FUNCTION my_skill_volume(int) TO authenticated;
GRANT EXECUTE ON FUNCTION my_adherence() TO authenticated;
