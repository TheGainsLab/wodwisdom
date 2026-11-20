-- Visitor traffic (2026-11-19): where signed-out visitors come from, what
-- they arrive on, and whether a visit ends in an account.
--
-- visitor_events (20261118100000) recorded page views and calculator use but
-- nothing about a visit's SOURCE, and nothing tied a visit to the account it
-- produced. This adds:
--
--   visit_start  { source?, medium?, campaign?, referrer?, landing, device }
--                once per visit, on its first tracked page. `referrer` is the
--                referring HOST only; `device` is phone | tablet | desktop.
--
-- and admin_report_traffic(p_days) for the /admin/reports Traffic section.
--
-- Visit → account: the client now sends the visit id in the signup metadata
-- (auth.users.raw_user_meta_data->>'visit_id', beside `acquisition`), so the
-- report can count the accounts a source or a landing page produced. No
-- schema change is needed for that.
--
-- Still anonymous: no user id on the event, no IP, no free text, and the
-- visit id is per tab (sessionStorage) — it counts visits, not people.

-- 1. Allow the new event. The CHECK was declared inline, so find it by what
--    it constrains rather than trusting a generated name.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.visitor_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%page_view%'
  LOOP
    EXECUTE format('ALTER TABLE public.visitor_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE visitor_events
  ADD CONSTRAINT visitor_events_event_check
  CHECK (event IN ('page_view', 'calculator_used', 'visit_start'));

CREATE INDEX IF NOT EXISTS idx_visitor_events_visit ON visitor_events(visit_id);

COMMENT ON TABLE visitor_events IS
  'Anonymous usage of public pages: visit_start {source, medium, campaign, referrer, landing, device}, page_view {path}, calculator_used {calculator, result}. Insert-only from clients (anon + authenticated); no client reads. visit_id is a per-tab random id, not a person.';

-- 2. A path as a low-cardinality page name: one row for all papers, one for
--    all Q&A entries.
CREATE OR REPLACE FUNCTION public.visitor_page_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL OR p = '' THEN '(unknown)'
    WHEN p LIKE '/knowledge/%' THEN '/knowledge/:paper'
    WHEN p LIKE '/qa/%' THEN '/qa/:entry'
    ELSE p
  END
$$;

-- 3. The report. Signed-out visits only (signed-in page views live in
--    app_events); calculator use counts everyone.
--
--    A visit's source is its campaign tag if it had one, else the referring
--    site, else "direct". Visits recorded before visit_start existed have no
--    source row and read "(not recorded)".
CREATE OR REPLACE FUNCTION public.admin_report_traffic(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  since timestamptz;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM log_admin_access(auth.uid(), 'reports', jsonb_build_object('section', 'traffic'));

  since := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 7), 90)));

  WITH ev AS (
    SELECT * FROM visitor_events e WHERE e.created_at >= since
  ),
  -- One row per signed-out visit: its page views, whether it reached the
  -- sign-up page, and (from visit_start) its source, landing page and device.
  visits AS (
    SELECT
      e.visit_id,
      COUNT(*) FILTER (WHERE e.event = 'page_view') AS page_views,
      BOOL_OR(e.event = 'page_view' AND e.props->>'path' = '/auth') AS reached_signup,
      MAX(CASE WHEN e.event = 'visit_start'
               THEN COALESCE(NULLIF(e.props->>'source', ''), NULLIF(e.props->>'referrer', ''), 'direct') END) AS source,
      MAX(CASE WHEN e.event = 'visit_start' THEN visitor_page_name(e.props->>'landing') END) AS landing,
      MAX(CASE WHEN e.event = 'visit_start' THEN NULLIF(e.props->>'device', '') END) AS device
    FROM ev e
    WHERE e.signed_in = false AND e.event IN ('page_view', 'visit_start')
    GROUP BY e.visit_id
  ),
  -- Accounts created in the window whose signup carried a visit id.
  accounts AS (
    SELECT au.id, au.raw_user_meta_data->>'visit_id' AS visit_id
    FROM auth.users au
    WHERE au.created_at >= since
      AND COALESCE(au.raw_user_meta_data->>'visit_id', '') <> ''
  ),
  joined AS (
    SELECT v.*, (a.id IS NOT NULL) AS made_account
    FROM visits v LEFT JOIN accounts a ON a.visit_id = v.visit_id
  )
  SELECT jsonb_build_object(
    'days', GREATEST(1, LEAST(COALESCE(p_days, 7), 90)),
    'visits', (SELECT COUNT(*) FROM joined),
    'single_page_visits', (SELECT COUNT(*) FROM joined WHERE page_views <= 1),
    'page_views', (SELECT COALESCE(SUM(page_views), 0) FROM joined),
    'reached_signup', (SELECT COUNT(*) FROM joined WHERE reached_signup),
    'accounts', (SELECT COUNT(*) FROM joined WHERE made_account),
    -- Accounts whose signup carried a visit id that matches no visit in the
    -- window (the visit was excluded, or began before the window).
    'accounts_unmatched', (
      SELECT COUNT(*) FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM visits v WHERE v.visit_id = a.visit_id)
    ),
    'by_source', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', t.name, 'visits', t.visits, 'reached_signup', t.reached, 'accounts', t.accounts) ORDER BY t.visits DESC, t.name), '[]'::jsonb)
      FROM (
        SELECT COALESCE(source, '(not recorded)') AS name, COUNT(*) AS visits,
               COUNT(*) FILTER (WHERE reached_signup) AS reached,
               COUNT(*) FILTER (WHERE made_account) AS accounts
        FROM joined GROUP BY 1 ORDER BY 2 DESC LIMIT 15
      ) t
    ),
    'by_landing', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', t.name, 'visits', t.visits, 'reached_signup', t.reached, 'accounts', t.accounts) ORDER BY t.visits DESC, t.name), '[]'::jsonb)
      FROM (
        SELECT COALESCE(landing, '(not recorded)') AS name, COUNT(*) AS visits,
               COUNT(*) FILTER (WHERE reached_signup) AS reached,
               COUNT(*) FILTER (WHERE made_account) AS accounts
        FROM joined GROUP BY 1 ORDER BY 2 DESC LIMIT 15
      ) t
    ),
    'by_device', (
      SELECT COALESCE(jsonb_object_agg(t.name, t.visits), '{}'::jsonb)
      FROM (SELECT COALESCE(device, '(not recorded)') AS name, COUNT(*) AS visits FROM joined GROUP BY 1) t
    ),
    'top_pages', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', t.name, 'views', t.views, 'visits', t.visits) ORDER BY t.views DESC, t.name), '[]'::jsonb)
      FROM (
        SELECT visitor_page_name(e.props->>'path') AS name, COUNT(*) AS views, COUNT(DISTINCT e.visit_id) AS visits
        FROM ev e
        WHERE e.event = 'page_view' AND e.signed_in = false
        GROUP BY 1 ORDER BY 2 DESC LIMIT 15
      ) t
    ),
    'calculators', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', t.name, 'uses', t.uses) ORDER BY t.uses DESC, t.name), '[]'::jsonb)
      FROM (
        SELECT COALESCE(e.props->>'calculator', '(unknown)') AS name, COUNT(*) AS uses
        FROM ev e WHERE e.event = 'calculator_used'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 25
      ) t
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_report_traffic(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_report_traffic(integer) TO authenticated;
