-- Reporting layer piece 2 (2026-07-18): revenue + cohorts.
--
-- 1. monthly_revenue_stats() — the previous CALENDAR month from the
--    billing_events ledger: purchases by plan and currency, voluntary vs
--    involuntary churn, refunds, disputes, plan changes, average tenure of
--    the departed. Emailed by the monthly-report function on the 1st.
--
-- 2. cohort_funnel(p_weeks) — per signup-week cohort: how many signed up,
--    completed an eval, opened checkout, purchased — with acquisition
--    sources as they accumulate. Machinery ships now; insight arrives as
--    labeled weeks stack up.

CREATE OR REPLACE FUNCTION public.monthly_revenue_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT date_trunc('month', now() - interval '1 month') AS m_start,
           date_trunc('month', now()) AS m_end
  ),
  month_events AS (
    SELECT be.* FROM billing_events be, bounds b
    WHERE be.created_at >= b.m_start AND be.created_at < b.m_end
  )
  SELECT jsonb_build_object(
    'month', to_char((SELECT m_start FROM bounds), 'YYYY-MM'),
    'purchases', (
      SELECT jsonb_build_object(
        'count', COUNT(*),
        'by_plan', COALESCE((SELECT jsonb_object_agg(t.plan, t.cnt) FROM (
          SELECT COALESCE(plan, '?') AS plan, COUNT(*) AS cnt FROM month_events
          WHERE event_type = 'purchased' GROUP BY 1) t), '{}'::jsonb),
        'by_currency', COALESCE((SELECT jsonb_object_agg(t.cur, t.cnt) FROM (
          SELECT COALESCE(currency, '?') AS cur, COUNT(*) AS cnt FROM month_events
          WHERE event_type = 'purchased' GROUP BY 1) t), '{}'::jsonb)
      )
      FROM month_events WHERE event_type = 'purchased'
    ),
    'churn', (
      SELECT jsonb_build_object(
        'voluntary', COUNT(*) FILTER (WHERE event_type = 'canceled'),
        'involuntary', COUNT(*) FILTER (WHERE event_type = 'payment_churn'),
        'avg_tenure_days', ROUND(AVG(tenure_days) FILTER (WHERE event_type = 'canceled' AND tenure_days IS NOT NULL))
      )
      FROM month_events
    ),
    'payment_failures', (SELECT COUNT(*) FROM month_events WHERE event_type = 'payment_failed'),
    'refunds', (
      SELECT jsonb_build_object('count', COUNT(*), 'amount_cents', COALESCE(SUM(amount_cents), 0))
      FROM month_events WHERE event_type = 'refunded'
    ),
    'disputes', (SELECT COUNT(*) FROM month_events WHERE event_type = 'dispute'),
    'plan_changes', (SELECT COUNT(*) FROM month_events WHERE event_type = 'plan_changed')
  );
$$;

REVOKE ALL ON FUNCTION public.monthly_revenue_stats() FROM public, anon, authenticated;

-- ── Cohort funnel ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cohort_funnel(p_weeks int DEFAULT 8)
RETURNS TABLE (
  cohort_week date,
  signups bigint,
  evaluated bigint,
  opened_checkout bigint,
  purchased bigint,
  sources jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cohort AS (
    SELECT au.id,
           date_trunc('week', au.created_at)::date AS week,
           COALESCE(
             au.raw_user_meta_data->'acquisition'->>'source',
             au.raw_user_meta_data->'acquisition'->>'referrer',
             'direct'
           ) AS src
    FROM auth.users au
    WHERE au.created_at >= date_trunc('week', now()) - (p_weeks || ' weeks')::interval
  )
  SELECT
    c.week,
    COUNT(*) AS signups,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM profile_evaluations pe WHERE pe.user_id = c.id)) AS evaluated,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM checkout_attempts ca WHERE ca.user_id = c.id)) AS opened_checkout,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM checkout_attempts ca WHERE ca.user_id = c.id AND ca.status = 'completed')) AS purchased,
    COALESCE((SELECT jsonb_object_agg(t.src, t.cnt) FROM (
      SELECT c2.src, COUNT(*) AS cnt FROM cohort c2 WHERE c2.week = c.week GROUP BY c2.src) t), '{}'::jsonb)
  FROM cohort c
  GROUP BY c.week
  ORDER BY c.week DESC;
$$;

REVOKE ALL ON FUNCTION public.cohort_funnel(int) FROM public, anon, authenticated;
