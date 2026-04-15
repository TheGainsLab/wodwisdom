-- Admin drill-down #4: programs.
--
-- Two RPCs for /admin/users/:id/programs:
--   admin_list_programs: sidebar list with per-program aggregates.
--   admin_get_program: full program tree (month → week → day → blocks)
--     with completion overlay derived from workout_logs.
--
-- Note: Engine is NOT represented in the programs table. Engine programs
-- live in athlete_profiles.engine_program_version + engine_workout_sessions
-- and are handled by the Engine drill-down (Todo 5). This RPC covers only
-- source IN ('generated', 'uploaded', 'external') programs.
--
-- Authorization: gated on is_current_user_admin(); detail call logs access.

-- ─── 1. List programs ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_programs(
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'source', p.source,
      'gym_name', p.gym_name,
      'is_ongoing', p.is_ongoing,
      'committed', p.committed,
      'generated_months', p.generated_months,
      'subscription_start', p.subscription_start,
      'created_at', p.created_at,
      'workout_count', (SELECT COUNT(*) FROM program_workouts WHERE program_id = p.id)
    ) ORDER BY p.created_at DESC
  ) INTO result
  FROM programs p
  WHERE p.user_id = target_user_id;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_programs(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_programs(uuid) TO authenticated;

-- ─── 2. Full program tree with completion overlay ───────────────────

CREATE OR REPLACE FUNCTION public.admin_get_program(
  target_user_id uuid,
  p_program_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prog_row programs%ROWTYPE;
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM log_admin_access(
    target_user_id,
    'program',
    jsonb_build_object('program_id', p_program_id)
  );

  SELECT * INTO prog_row FROM programs WHERE id = p_program_id AND user_id = target_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  result := jsonb_build_object(
    'program', to_jsonb(prog_row),
    'workouts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pw.id,
          'month_number', pw.month_number,
          'week_num', pw.week_num,
          'day_num', pw.day_num,
          'sort_order', pw.sort_order,
          'workout_text', pw.workout_text,
          'blocks', (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', b.id,
                'block_type', b.block_type,
                'block_order', b.block_order,
                'block_text', b.block_text
              ) ORDER BY b.block_order
            )
            FROM program_workout_blocks b
            WHERE b.program_workout_id = pw.id
          ),
          -- Completion overlay: was this day logged by the user?
          'log_id', (
            SELECT wl.id
            FROM workout_logs wl
            WHERE wl.user_id = target_user_id
              AND wl.source_type = 'program'
              AND wl.source_id = pw.id
            ORDER BY wl.created_at DESC
            LIMIT 1
          )
        ) ORDER BY pw.month_number, pw.week_num, pw.day_num, pw.sort_order
      )
      FROM program_workouts pw
      WHERE pw.program_id = p_program_id
    ), '[]'::jsonb)
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_program(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_program(uuid, uuid) TO authenticated;
