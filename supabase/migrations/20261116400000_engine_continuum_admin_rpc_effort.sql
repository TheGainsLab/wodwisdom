-- Continuum v2: the per-athlete admin RPC returns continuum_effort_s (the
-- effort-duration coordinate added in 20261116200000). Without it the admin
-- page had no x position for any session and drew an empty chart.

CREATE OR REPLACE FUNCTION public.admin_engine_continuum(target_user_id uuid)
RETURNS jsonb
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
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'date', s.date, 'day_type', s.day_type, 'modality', s.modality, 'units', s.units,
        'actual_pace', s.actual_pace, 'target_pace', s.target_pace,
        'r', s.continuum_r, 'effort_s', s.continuum_effort_s, 'bout_s', s.continuum_bout_s, 'sustain', s.continuum_sustain, 'evidence', s.continuum_evidence,
        'intervals', s.workout_data->'total_intervals', 'total_work_time', s.workout_data->'total_work_time',
        'total_rest_time', s.workout_data->'total_rest_time'
      ) ORDER BY s.date, s.created_at)
      FROM engine_workout_sessions s
      WHERE s.user_id = target_user_id AND s.completed = true
    ), '[]'::jsonb),
    'trials', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'modality', t.modality, 'units', t.units, 'pace', t.calculated_rpm, 'date', t.date, 'is_current', t.is_current
      ) ORDER BY t.date)
      FROM engine_time_trials t
      WHERE t.user_id = target_user_id AND t.calculated_rpm IS NOT NULL
    ), '[]'::jsonb),
    'curve', (SELECT ap.engine_curve FROM athlete_profiles ap WHERE ap.user_id = target_user_id),
    'curves', COALESCE((
      SELECT jsonb_object_agg(k, pts) FROM (
        SELECT c.modality || '|' || c.units AS k,
               jsonb_agg(jsonb_build_object('r', c.r, 'seconds', c.seconds) ORDER BY c.r DESC) AS pts
        FROM engine_pd_curves c GROUP BY c.modality, c.units
      ) x
    ), '{}'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_engine_continuum(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_engine_continuum(uuid) TO authenticated;
