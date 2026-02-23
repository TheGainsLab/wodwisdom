-- Fix finalize_program_modification: accept user_id param (Edge Function uses service role, auth.uid() is null)
CREATE OR REPLACE FUNCTION finalize_program_modification(p_modification_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program_id uuid;
BEGIN
  SELECT pm.program_id INTO v_program_id
  FROM program_modifications pm
  JOIN programs p ON p.id = pm.program_id
  WHERE pm.id = p_modification_id AND p.user_id = p_user_id;

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'Modification not found or access denied';
  END IF;

  UPDATE program_workouts pw
  SET workout_text = mw.modified_text
  FROM modified_workouts mw
  WHERE mw.modification_id = p_modification_id
    AND mw.status = 'approved'
    AND mw.original_workout_id = pw.id;

  UPDATE program_modifications
  SET status = 'finalized'
  WHERE id = p_modification_id;
END;
$$;
