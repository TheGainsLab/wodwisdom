-- Admin drill-down #6: training log.
--
-- Two RPCs for /admin/users/:id/workouts:
--   admin_list_workout_logs: paginated list with filter support and header
--     aggregates (total / 30d / 7d).
--   admin_get_workout_log: full detail for one log, including its blocks,
--     movement entries, and linked AI review (if any).
--
-- Authorization: gated on is_current_user_admin(). log_admin_access is
-- called once per detail fetch, and once per list fetch with the filter
-- metadata.

-- ─── 1. List workout logs (paginated, filtered) ─────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_workout_logs(
  target_user_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0,
  p_source_type text DEFAULT NULL,     -- 'review' | 'program' | 'manual'
  p_block_type text DEFAULT NULL,      -- 'strength' | 'metcon' | 'skills' | etc.
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
        'total_logs', COUNT(*),
        'logs_7d',  COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'),
        'logs_30d', COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')
      )
      FROM workout_logs
      WHERE user_id = target_user_id
    ),
    'filter_options', jsonb_build_object(
      'source_types', jsonb_build_array('review', 'program', 'manual'),
      'block_types', jsonb_build_array('strength', 'metcon', 'skills', 'warm-up', 'cool-down', 'accessory', 'other')
    ),
    'total_filtered', (
      SELECT COUNT(DISTINCT wl.id) FROM workout_logs wl
      LEFT JOIN workout_log_blocks b ON b.log_id = wl.id
      WHERE wl.user_id = target_user_id
        AND (p_source_type IS NULL OR wl.source_type = p_source_type)
        AND (p_block_type IS NULL OR b.block_type = p_block_type)
        AND (p_since IS NULL OR wl.created_at >= p_since)
    ),
    'logs', COALESCE((
      SELECT jsonb_agg(log ORDER BY (log->>'created_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', wl.id,
          'workout_date', wl.workout_date,
          'workout_type', wl.workout_type,
          'workout_text', wl.workout_text,
          'source_type', wl.source_type,
          'source_id', wl.source_id,
          'status', wl.status,
          'created_at', wl.created_at,
          'block_count', (SELECT COUNT(*) FROM workout_log_blocks WHERE log_id = wl.id),
          'block_types', (
            SELECT jsonb_agg(DISTINCT block_type)
            FROM workout_log_blocks WHERE log_id = wl.id
          ),
          'top_score', (
            SELECT score FROM workout_log_blocks
            WHERE log_id = wl.id AND score IS NOT NULL
            ORDER BY sort_order LIMIT 1
          ),
          'entry_summary', (
            SELECT string_agg(
              CASE
                WHEN weight IS NOT NULL AND reps IS NOT NULL THEN
                  movement || ' ' || weight::text || weight_unit || '×' || reps::text
                WHEN reps IS NOT NULL THEN
                  movement || ' ×' || reps::text
                ELSE movement
              END,
              ' · '
              ORDER BY sort_order
            )
            FROM (
              SELECT movement, weight, weight_unit, reps, sort_order
              FROM workout_log_entries
              WHERE log_id = wl.id
              ORDER BY sort_order
              LIMIT 4
            ) e
          )
        ) AS log
        FROM workout_logs wl
        WHERE wl.user_id = target_user_id
          AND (p_source_type IS NULL OR wl.source_type = p_source_type)
          AND (p_block_type IS NULL OR EXISTS (
            SELECT 1 FROM workout_log_blocks b WHERE b.log_id = wl.id AND b.block_type = p_block_type
          ))
          AND (p_since IS NULL OR wl.created_at >= p_since)
        ORDER BY wl.created_at DESC
        LIMIT p_limit OFFSET p_offset
      ) items
    ), '[]'::jsonb)
  ) INTO result;

  PERFORM log_admin_access(
    target_user_id,
    'workout_logs.list',
    jsonb_build_object('source_type', p_source_type, 'block_type', p_block_type, 'since', p_since)
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_workout_logs(uuid, int, int, text, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_workout_logs(uuid, int, int, text, text, timestamptz) TO authenticated;

-- ─── 2. Full detail for one workout log ─────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_workout_log(
  target_user_id uuid,
  log_id uuid
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
    jsonb_build_object('log_id', log_id)
  );

  SELECT * INTO log_row FROM workout_logs WHERE id = log_id AND user_id = target_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  result := jsonb_build_object(
    'log', to_jsonb(log_row),
    'blocks', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.sort_order)
      FROM workout_log_blocks b
      WHERE b.log_id = log_id
    ), '[]'::jsonb),
    'entries', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.sort_order)
      FROM workout_log_entries e
      WHERE e.log_id = log_id
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
