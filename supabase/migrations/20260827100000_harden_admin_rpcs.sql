-- Harden every admin RPC with an in-function authorization gate.
--
-- The admin_* functions are SECURITY DEFINER with default EXECUTE grants and
-- (for the pre-20260415 generation) NO authorization check — any authenticated
-- user calling e.g. admin_user_list_v2() directly got every user's email and
-- activity. The role check lived only in the frontend. 20260415000000 created
-- is_current_user_admin() and noted that "existing admin_* RPCs predate this
-- helper; they should be updated to use it when we harden authorization on
-- the admin surface" — this migration is that hardening.
--
-- Mechanism: rather than hand-reproducing ~30 function bodies (error-prone),
-- a DO block rewrites each live function from pg_get_functiondef, injecting a
-- gate as the first statement of the body:
--
--   IF NOT (auth.role() = 'service_role' OR public.is_current_user_admin())
--   THEN RAISE 'Not authorized' (42501);
--
-- service_role passes because edge functions legitimately call several of
-- these with the service key (admin-data, monthly-report, lifecycle-nudges).
-- Functions that already reference is_current_user_admin / an existing gate
-- are skipped, so the 20260415+ drill-down RPCs and admin_user_list_v2
-- (gated in 20260827000000) are untouched. Non-plpgsql functions are
-- reported and must be gated by hand; any rewrite failure aborts the
-- migration loudly.
--
-- Scope: public.admin_*, plus resume_nudge_candidates and
-- monthly_revenue_stats (user-email/revenue data, same exposure class).
--
-- GOING FORWARD: every new admin-scoped function must start its body with
-- this same gate — the sweep only covers what exists today.

DO $do$
DECLARE
  fn record;
  def text;
  body_start int;
  begin_pos int;
  patched int := 0;
  skipped_gated int := 0;
  skipped_lang text[] := '{}';
  gate constant text := E'BEGIN\n  IF NOT (auth.role() = ''service_role'' OR public.is_current_user_admin()) THEN\n    RAISE EXCEPTION ''Not authorized'' USING ERRCODE = ''42501'';\n  END IF;';
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, l.lanname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'admin\_%'
           OR p.proname IN ('resume_nudge_candidates', 'monthly_revenue_stats'))
      AND p.prokind = 'f'
      AND p.proname NOT IN ('admin_access_log')  -- table, not a function; defensive
    ORDER BY p.proname
  LOOP
    def := pg_get_functiondef(fn.oid);

    -- Already gated (drill-down generation, or previously hardened).
    IF def ~ 'is_current_user_admin|admin role required' THEN
      skipped_gated := skipped_gated + 1;
      CONTINUE;
    END IF;

    IF fn.lanname <> 'plpgsql' THEN
      skipped_lang := skipped_lang || (fn.proname || ' (' || fn.lanname || ')');
      CONTINUE;
    END IF;

    -- Find the body's opening BEGIN: first \mBEGIN\M after the $function$
    -- body delimiter, so header keywords can't be hit.
    body_start := position('$function$' in def);
    IF body_start = 0 THEN
      RAISE EXCEPTION 'admin-rpc hardening: % has unexpected body delimiter', fn.proname;
    END IF;
    begin_pos := regexp_instr(def, '\mBEGIN\M', body_start);
    IF begin_pos = 0 THEN
      RAISE EXCEPTION 'admin-rpc hardening: no BEGIN found in %', fn.proname;
    END IF;

    def := overlay(def placing gate from begin_pos for 5);
    EXECUTE def;
    patched := patched + 1;
    RAISE NOTICE 'admin-rpc hardening: gated %', fn.proname;
  END LOOP;

  RAISE NOTICE 'admin-rpc hardening: % gated, % already gated', patched, skipped_gated;
  IF array_length(skipped_lang, 1) IS NOT NULL THEN
    RAISE WARNING 'admin-rpc hardening: NON-plpgsql functions need manual gates: %', skipped_lang;
  END IF;
END
$do$;
