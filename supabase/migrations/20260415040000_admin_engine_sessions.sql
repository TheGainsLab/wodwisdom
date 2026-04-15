-- Admin drill-down #5: engine sessions + time trials.
--
-- Three RPCs for /admin/users/:id/engine-sessions:
--   admin_list_engine_sessions: paginated sessions with filters, plus header
--     aggregates so the list page can render without a second round-trip.
--   admin_get_engine_session: full detail for one session (raw workout_data
--     included for debugging).
--   admin_list_time_trials: all time trials for the user (smaller dataset,
--     returned in full).
-- All gated on is_current_user_admin().

-- ─── 1. List sessions (with filters + aggregates) ───────────────────

CREATE OR REPLACE FUNCTION public.admin_list_engine_sessions(
  target_user_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0,
  p_day_type text DEFAULT NULL,
  p_modality text DEFAULT NULL,
  p_since timestamptz DEFAULT NULL
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
    'totals', (
      SELECT jsonb_build_object(
        'total_sessions', COUNT(*),
        'sessions_30d', COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'),
        'avg_performance_ratio', ROUND(AVG(performance_ratio)::numeric, 2)
      )
      FROM engine_workout_sessions
      WHERE user_id = target_user_id AND completed = true
    ),
    'filter_options', (
      SELECT jsonb_build_object(
        'day_types', COALESCE((
          SELECT jsonb_agg(DISTINCT day_type ORDER BY day_type)
          FROM engine_workout_sessions
          WHERE user_id = target_user_id AND day_type IS NOT NULL
        ), '[]'::jsonb),
        'modalities', COALESCE((
          SELECT jsonb_agg(DISTINCT modality ORDER BY modality)
          FROM engine_workout_sessions
          WHERE user_id = target_user_id AND modality IS NOT NULL
        ), '[]'::jsonb)
      )
    ),
    'total_filtered', (
      SELECT COUNT(*) FROM engine_workout_sessions
      WHERE user_id = target_user_id
        AND (p_day_type IS NULL OR day_type = p_day_type)
        AND (p_modality IS NULL OR modality = p_modality)
        AND (p_since IS NULL OR created_at >= p_since)
    ),
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'date', date,
        'created_at', created_at,
        'program_day', program_day,
        'program_day_number', program_day_number,
        'day_type', day_type,
        'modality', modality,
        'units', units,
        'target_pace', target_pace,
        'actual_pace', actual_pace,
        'total_output', total_output,
        'performance_ratio', performance_ratio,
        'calculated_rpm', calculated_rpm,
        'perceived_exertion', perceived_exertion,
        'average_heart_rate', average_heart_rate,
        'peak_heart_rate', peak_heart_rate,
        'completed', completed,
        'program_version', program_version
      ) ORDER BY created_at DESC)
      FROM (
        SELECT * FROM engine_workout_sessions
        WHERE user_id = target_user_id
          AND (p_day_type IS NULL OR day_type = p_day_type)
          AND (p_modality IS NULL OR modality = p_modality)
          AND (p_since IS NULL OR created_at >= p_since)
        ORDER BY created_at DESC
        LIMIT p_limit OFFSET p_offset
      ) s
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_engine_sessions(uuid, int, int, text, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_engine_sessions(uuid, int, int, text, text, timestamptz) TO authenticated;

-- ─── 2. Single session detail ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_engine_session(
  target_user_id uuid,
  session_id uuid
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
    'engine_session',
    jsonb_build_object('session_id', session_id)
  );

  SELECT to_jsonb(s.*) INTO result
  FROM engine_workout_sessions s
  WHERE s.id = session_id AND s.user_id = target_user_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_engine_session(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_engine_session(uuid, uuid) TO authenticated;

-- ─── 3. Time trials ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_time_trials(
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

  PERFORM log_admin_access(target_user_id, 'engine_time_trials', NULL);

  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'date', date,
    'modality', modality,
    'total_output', total_output,
    'calculated_rpm', calculated_rpm,
    'units', units,
    'is_current', is_current,
    'created_at', created_at
  ) ORDER BY created_at DESC)
  INTO result
  FROM engine_time_trials
  WHERE user_id = target_user_id;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_time_trials(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_time_trials(uuid) TO authenticated;
