-- Reporting layer piece 3 (2026-07-18): admin-gated wrappers so the
-- /admin/reports page can read the reporting RPCs from the client. House
-- pattern (admin_list_rated_messages): is_current_user_admin() gate inside,
-- GRANT to authenticated, access logged once per fetch.

CREATE OR REPLACE FUNCTION public.admin_report_digest_history(p_limit int DEFAULT 12)
RETURNS TABLE (run_at timestamptz, stats jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM log_admin_access(auth.uid(), 'reports', jsonb_build_object('section', 'digest_history'));
  RETURN QUERY
    SELECT dr.run_at, dr.stats FROM digest_runs dr
    ORDER BY dr.run_at DESC LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_report_subscriber_health()
RETURNS SETOF record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM log_admin_access(auth.uid(), 'reports', jsonb_build_object('section', 'subscriber_health'));
  RETURN QUERY SELECT * FROM subscriber_health() AS t;
END;
$$;

-- SETOF record needs a column list at call time; give the client a typed
-- wrapper instead (same shape as subscriber_health).
DROP FUNCTION IF EXISTS public.admin_report_subscriber_health();
CREATE OR REPLACE FUNCTION public.admin_report_subscriber_health()
RETURNS TABLE (
  user_id uuid, email text, full_name text, features text[], source_kinds text[],
  signup_at timestamptz, last_sign_in_at timestamptz, last_training_at timestamptz,
  last_any_activity_at timestamptz, pwa_installed boolean,
  engine_sessions bigint, workouts bigint, nutrition_entries bigint, chat_questions bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM log_admin_access(auth.uid(), 'reports', jsonb_build_object('section', 'subscriber_health'));
  RETURN QUERY SELECT * FROM subscriber_health();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_report_monthly_revenue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM log_admin_access(auth.uid(), 'reports', jsonb_build_object('section', 'monthly_revenue'));
  RETURN monthly_revenue_stats();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_report_cohorts(p_weeks int DEFAULT 8)
RETURNS TABLE (
  cohort_week date, signups bigint, evaluated bigint,
  opened_checkout bigint, purchased bigint, sources jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM log_admin_access(auth.uid(), 'reports', jsonb_build_object('section', 'cohorts'));
  RETURN QUERY SELECT * FROM cohort_funnel(p_weeks);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_digest_history(int) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_report_digest_history(int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_report_subscriber_health() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_report_subscriber_health() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_report_monthly_revenue() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_report_monthly_revenue() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_report_cohorts(int) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_report_cohorts(int) TO authenticated;
