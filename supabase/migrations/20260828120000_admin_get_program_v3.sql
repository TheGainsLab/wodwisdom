-- admin_get_program: v3 support (2026-08-28).
--
-- The April RPC predates v3 structured storage: it renders workout_text +
-- program_workout_blocks (the v1 prose tables). A v3 program stores
-- workout_text = NULL and puts all content in program_blocks_v2 +
-- program_movements_v2, so from /admin/users/:id/programs every v3 program
-- showed its day tree with blank days ("a program with no workouts") while
-- the athlete saw a complete program.
--
-- This adds a per-workout `blocks_v2` array (blocks with nested movements,
-- both in sort order). v1 fields are unchanged, so old programs render
-- exactly as before; the page prefers blocks_v2 when present.
--
-- Gate matches the 20260827 hardening pass (service_role OR admin).

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
  IF NOT (auth.role() = 'service_role' OR public.is_current_user_admin()) THEN
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
          -- v3 structured content: blocks with nested movements.
          'blocks_v2', (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', bv.id,
                'block_type', bv.block_type,
                'block_label', bv.block_label,
                'block_scheme', bv.block_scheme,
                'time_cap_seconds', bv.time_cap_seconds,
                'block_notes', bv.block_notes,
                'sort_order', bv.sort_order,
                'movements', COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', mv.id,
                      'movement', mv.movement,
                      'sets', mv.sets,
                      'reps', mv.reps,
                      'rep_scheme', mv.rep_scheme,
                      'weight', mv.weight,
                      'weight_unit', mv.weight_unit,
                      'rpe', mv.rpe,
                      'time_seconds', mv.time_seconds,
                      'distance', mv.distance,
                      'distance_unit', mv.distance_unit,
                      'calories', mv.calories,
                      'scaling_note', mv.scaling_note,
                      'target_pct_1rm', mv.target_pct_1rm,
                      'sort_order', mv.sort_order
                    ) ORDER BY mv.sort_order
                  )
                  FROM program_movements_v2 mv
                  WHERE mv.block_id = bv.id
                ), '[]'::jsonb)
              ) ORDER BY bv.sort_order
            )
            FROM program_blocks_v2 bv
            WHERE bv.program_workout_id = pw.id
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
