-- Fix: admin_get_workout_log's "log_id" parameter collided with the log_id
-- column on workout_log_blocks / workout_log_entries, causing
-- "column reference \"log_id\" is ambiguous" at runtime.
-- Drop the old signature and recreate with p_log_id.

DROP FUNCTION IF EXISTS public.admin_get_workout_log(uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_get_workout_log(
  target_user_id uuid,
  p_log_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  log_row workout_logs%ROWTYPE;
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM log_admin_access(
    target_user_id,
    'workout_log',
    jsonb_build_object('log_id', p_log_id)
  );

  SELECT * INTO log_row FROM workout_logs WHERE id = p_log_id AND user_id = target_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  result := jsonb_build_object(
    'log', to_jsonb(log_row),
    'blocks', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.sort_order)
      FROM workout_log_blocks b
      WHERE b.log_id = p_log_id
    ), '[]'::jsonb),
    'entries', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.sort_order)
      FROM workout_log_entries e
      WHERE e.log_id = p_log_id
    ), '[]'::jsonb),
    'review', (
      CASE WHEN log_row.source_type = 'review' AND log_row.source_id IS NOT NULL THEN
        (SELECT to_jsonb(r) FROM workout_reviews r WHERE r.id = log_row.source_id)
      ELSE NULL END
    )
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_workout_log(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_workout_log(uuid, uuid) TO authenticated;
