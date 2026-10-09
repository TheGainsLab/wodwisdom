-- Admin: per-modality energy-system inputs for a user, mirroring the
-- athlete-facing Engine Analytics "Energy Systems Ratio" exactly:
--   glycolytic = avg anaerobic-day pace / latest time-trial pace
--   aerobic    = avg max-aerobic-day pace / latest time-trial pace
--   systems    = avg anaerobic-day pace / avg max-aerobic-day pace
-- The RPC returns the averaged inputs (the ratios are divisions the client
-- does, same as the user page) so the admin view can also show the raw
-- paces and session counts behind each number. Session filter matches the
-- user page: completed sessions, actual_pace > 0, day_type anaerobic /
-- max_aerobic_power; the baseline is the modality's latest time trial by
-- date with calculated_rpm > 0.

CREATE OR REPLACE FUNCTION public.admin_engine_energy_ratios(
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

  PERFORM log_admin_access(target_user_id, 'engine_energy_ratios', NULL);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'modality', m.modality,
    'units', m.units,
    'anaerobic_avg_pace', m.anaerobic_avg_pace,
    'anaerobic_sessions', m.anaerobic_sessions,
    'max_aerobic_avg_pace', m.max_aerobic_avg_pace,
    'max_aerobic_sessions', m.max_aerobic_sessions,
    'tt_pace', t.tt_pace,
    'tt_date', t.tt_date
  ) ORDER BY m.modality), '[]'::jsonb)
  INTO result
  FROM (
    SELECT
      modality,
      MAX(units) AS units,
      ROUND(AVG(actual_pace) FILTER (WHERE day_type = 'anaerobic')::numeric, 2) AS anaerobic_avg_pace,
      COUNT(*) FILTER (WHERE day_type = 'anaerobic') AS anaerobic_sessions,
      ROUND(AVG(actual_pace) FILTER (WHERE day_type = 'max_aerobic_power')::numeric, 2) AS max_aerobic_avg_pace,
      COUNT(*) FILTER (WHERE day_type = 'max_aerobic_power') AS max_aerobic_sessions
    FROM engine_workout_sessions
    WHERE user_id = target_user_id
      AND completed = true
      AND day_type IN ('anaerobic', 'max_aerobic_power')
      AND actual_pace IS NOT NULL AND actual_pace > 0
      AND modality IS NOT NULL
    GROUP BY modality
  ) m
  LEFT JOIN LATERAL (
    SELECT tt.calculated_rpm AS tt_pace, tt.date AS tt_date
    FROM engine_time_trials tt
    WHERE tt.user_id = target_user_id
      AND tt.modality = m.modality
      AND tt.calculated_rpm IS NOT NULL AND tt.calculated_rpm > 0
    ORDER BY tt.date DESC
    LIMIT 1
  ) t ON true;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_engine_energy_ratios(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_engine_energy_ratios(uuid) TO authenticated;
