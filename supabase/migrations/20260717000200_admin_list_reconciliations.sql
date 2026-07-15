-- Admin ops health: expose the reconciliation audit trail to the admin UI.
--
-- programming_reconciliations (both sweeps, discriminated by kind) is
-- RLS-locked with no policies — until now only the SQL editor could answer
-- "did the sweeps run, what did they heal, who got flagged". This RPC powers
-- /admin/ops: recent runs, newest first, with the full healed/flagged/errors
-- payloads for expansion (they contain per-user reports including the
-- over_entitled flags added in the engine fence work).
--
-- Gated on is_current_user_admin(); logged against the all-zeros sentinel
-- (no single target user — same convention as admin_activity_feed).

CREATE OR REPLACE FUNCTION public.admin_list_reconciliations(
  p_limit int DEFAULT 30,
  p_kind text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  lim int := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM log_admin_access(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'ops.reconciliations',
    jsonb_build_object('limit', lim, 'kind', p_kind)
  );

  SELECT jsonb_build_object(
    'runs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'ran_at', r.ran_at,
        'kind', r.kind,
        'dry_run', r.dry_run,
        'checked', r.checked,
        'healthy', r.healthy,
        'healed', r.healed,
        'flagged', r.flagged,
        'errors', r.errors
      ) ORDER BY r.ran_at DESC)
      FROM (
        SELECT * FROM programming_reconciliations
        WHERE (p_kind IS NULL OR kind = p_kind)
        ORDER BY ran_at DESC
        LIMIT lim
      ) r
    ), '[]'::jsonb),
    'last_run_at', (
      SELECT jsonb_object_agg(kind, max_ran)
      FROM (SELECT kind, max(ran_at) AS max_ran FROM programming_reconciliations GROUP BY kind) k
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_reconciliations(int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_reconciliations(int, text) TO authenticated;
