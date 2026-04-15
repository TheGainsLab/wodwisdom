-- Admin drill-down #3: evaluations.
--
-- Provides two RPCs for the /admin/users/:id/evaluations sub-page:
--   admin_list_evaluations: sidebar list grouped by type (profile / training /
--     nutrition). Returns only metadata (id, date, month_number, visible).
--   admin_get_evaluation: full eval body including analysis text and the raw
--     snapshots used as context at generation time.
--
-- Authorization: both gated on is_current_user_admin(). log_admin_access is
-- called from the detail RPC (not the list, to keep the audit log focused
-- on content access, not index queries).

-- ─── 1. List all evaluations for a user ──────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_evaluations(
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
    'profile', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'created_at', created_at
      ) ORDER BY created_at DESC)
      FROM profile_evaluations
      WHERE user_id = target_user_id
    ), '[]'::jsonb),

    'training', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'created_at', created_at,
        'month_number', month_number,
        'program_id', program_id,
        'visible', visible
      ) ORDER BY created_at DESC)
      FROM training_evaluations
      WHERE user_id = target_user_id
    ), '[]'::jsonb),

    'nutrition', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'created_at', created_at,
        'month_number', month_number,
        'program_id', program_id,
        'visible', visible
      ) ORDER BY created_at DESC)
      FROM nutrition_evaluations
      WHERE user_id = target_user_id
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_evaluations(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_evaluations(uuid) TO authenticated;

-- ─── 2. Get a single evaluation (any type) ───────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_evaluation(
  target_user_id uuid,
  eval_type text,        -- 'profile' | 'training' | 'nutrition'
  evaluation_id uuid
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

  PERFORM log_admin_access(
    target_user_id,
    'evaluation.' || eval_type,
    jsonb_build_object('evaluation_id', evaluation_id)
  );

  IF eval_type = 'profile' THEN
    SELECT to_jsonb(e.*) INTO result
    FROM profile_evaluations e
    WHERE e.id = evaluation_id AND e.user_id = target_user_id;

  ELSIF eval_type = 'training' THEN
    SELECT to_jsonb(e.*) INTO result
    FROM training_evaluations e
    WHERE e.id = evaluation_id AND e.user_id = target_user_id;

  ELSIF eval_type = 'nutrition' THEN
    SELECT to_jsonb(e.*) INTO result
    FROM nutrition_evaluations e
    WHERE e.id = evaluation_id AND e.user_id = target_user_id;

  ELSE
    RAISE EXCEPTION 'Invalid eval_type: %', eval_type USING ERRCODE = '22023';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_evaluation(uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_evaluation(uuid, text, uuid) TO authenticated;
