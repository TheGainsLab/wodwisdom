-- Program deletion becomes admin-only at the database layer.
--
-- The UI already hides delete from non-admins (ProgramsListPage), but the
-- owner DELETE policies still allowed any user to delete their programs row
-- from the browser console — re-enabling the Generate button and orphaning
-- the workout logs that pointed at the deleted days. Deletes on programs and
-- program_workouts now require admin. Block/movement deletes are untouched:
-- manual program editing legitimately removes those.
--
-- Also fixes the admin month-delete: the client deleted program_workouts and
-- rolled back generated_months, but never removed the program_months
-- idempotency marker (service-role only, so the client CAN'T remove it) —
-- leaving the next generation of that month to run the full pipeline and then
-- silently skip its save. admin_delete_program_month does all three steps.

-- ─── 1. Admin-only delete policies ───────────────────────────────────

DROP POLICY IF EXISTS "Users can delete own programs" ON programs;
CREATE POLICY "Admins can delete programs" ON programs
  FOR DELETE USING (is_current_user_admin());

DROP POLICY IF EXISTS "Users can delete program workouts for own programs" ON program_workouts;
CREATE POLICY "Admins can delete program workouts" ON program_workouts
  FOR DELETE USING (is_current_user_admin());

-- ─── 2. Month delete RPC (workouts + idempotency marker + counter) ───

CREATE OR REPLACE FUNCTION public.admin_delete_program_month(
  p_program_id uuid,
  p_month integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prog_user_id uuid;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO prog_user_id FROM programs WHERE id = p_program_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Program not found';
  END IF;

  PERFORM log_admin_access(
    prog_user_id,
    'program_month_delete',
    jsonb_build_object('program_id', p_program_id, 'month', p_month)
  );

  DELETE FROM program_workouts
  WHERE program_id = p_program_id AND month_number = p_month;

  -- The idempotency marker: without this, regenerating the month runs the
  -- full pipeline and then silently skips its save.
  DELETE FROM program_months
  WHERE program_id = p_program_id AND month_number = p_month;

  UPDATE programs
  SET generated_months = GREATEST(p_month - 1, 1)
  WHERE id = p_program_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_program_month(uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_delete_program_month(uuid, integer) TO authenticated;
