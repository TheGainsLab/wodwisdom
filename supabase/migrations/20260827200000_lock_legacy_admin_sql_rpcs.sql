-- Close the last three admin RPC exposures.
--
-- The 20260827100000 hardening sweep gated every plpgsql admin function but
-- (by design, with a warning) skipped LANGUAGE sql ones. Five were skipped:
-- monthly_revenue_stats and resume_nudge_candidates were already locked with
-- REVOKEs at creation; these three legacy analytics functions (2026-02 era,
-- pre-dating is_current_user_admin) were not:
--
--   admin_daily_trend, admin_top_users, admin_user_list
--
-- Their only caller is the admin-data edge function via the service role —
-- zero frontend callers — so the right lock is the same REVOKE pattern the
-- revenue functions use: no direct client access at all, service role
-- unaffected (its grant is separate from public/anon/authenticated).

REVOKE ALL ON FUNCTION public.admin_daily_trend(int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_top_users(int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_user_list() FROM public, anon, authenticated;
