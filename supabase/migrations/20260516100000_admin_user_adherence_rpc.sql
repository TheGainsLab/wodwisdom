-- Step 21 of the v3 UX roadmap: admin adherence RPC.
--
-- Returns per-program completion stats for the last 3 programs of a user.
-- Phase 1 admin-only — surfaces inside AdminUserDetailPage. No athlete UI.
--
-- Metrics (all are pure completion signals, no quality-of-execution math):
--   1. Workout completion — completed workouts / prescribed workouts.
--      Rest days are implicit (no program_workouts row) so the ratio is
--      already rest-day-clean by construction.
--   2. Block completion — logged blocks / prescribed blocks across the
--      workouts the athlete actually completed (not across all prescribed
--      workouts; missing workouts are already counted in metric #1).
--   3. Movement skip rate — entries with completed=false / total entries
--      (Step 10 columns; missing on pre-Step-10 rows).
--
-- "Loggable" block types: strength / skills / accessory / metcon. Warm-up,
-- cool-down, mobility, and 'other' excluded — athletes typically skip those
-- without it being meaningful adherence signal.
--
-- v1/v3 unified via CASE on programs.program_version (prescribed blocks
-- live in program_blocks_v2 for v3, program_workout_blocks for v1).

CREATE OR REPLACE FUNCTION admin_user_adherence(target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  WITH
    user_programs AS (
      SELECT id, name, created_at, program_version
      FROM programs
      WHERE user_id = target_user_id
      ORDER BY created_at DESC
      LIMIT 3
    ),
    completed_logs AS (
      SELECT wl.id AS log_id, pw.program_id, wl.source_id AS program_workout_id
      FROM workout_logs wl
      JOIN program_workouts pw ON pw.id = wl.source_id
      WHERE wl.status = 'completed'
        AND pw.program_id IN (SELECT id FROM user_programs)
    ),
    prescribed_workouts AS (
      SELECT program_id, COUNT(*) AS n
      FROM program_workouts
      WHERE program_id IN (SELECT id FROM user_programs)
      GROUP BY program_id
    ),
    completed_workout_counts AS (
      SELECT program_id, COUNT(*) AS n
      FROM completed_logs
      GROUP BY program_id
    ),
    prescribed_blocks_v3 AS (
      SELECT cl.program_id, COUNT(*) AS n
      FROM completed_logs cl
      JOIN program_blocks_v2 pb ON pb.program_workout_id = cl.program_workout_id
      WHERE pb.block_type IN ('strength', 'skills', 'accessory', 'metcon')
      GROUP BY cl.program_id
    ),
    prescribed_blocks_v1 AS (
      SELECT cl.program_id, COUNT(*) AS n
      FROM completed_logs cl
      JOIN program_workout_blocks pwb ON pwb.program_workout_id = cl.program_workout_id
      WHERE pwb.block_type IN ('strength', 'skills', 'accessory', 'metcon')
      GROUP BY cl.program_id
    ),
    logged_blocks AS (
      SELECT cl.program_id, COUNT(*) AS n
      FROM completed_logs cl
      JOIN workout_log_blocks wlb ON wlb.log_id = cl.log_id
      WHERE wlb.block_type IN ('strength', 'skills', 'accessory', 'metcon')
      GROUP BY cl.program_id
    ),
    movement_counts AS (
      SELECT cl.program_id,
             COUNT(*) AS total_entries,
             COUNT(*) FILTER (WHERE wle.completed = false) AS skipped_entries
      FROM completed_logs cl
      JOIN workout_log_entries wle ON wle.log_id = cl.log_id
      GROUP BY cl.program_id
    )
  SELECT json_agg(
    json_build_object(
      'id', up.id,
      'name', up.name,
      'created_at', up.created_at,
      'program_version', up.program_version,
      'prescribed_workouts', COALESCE(pw.n, 0),
      'completed_workouts', COALESCE(cwc.n, 0),
      'prescribed_blocks', COALESCE(
        CASE WHEN up.program_version = 'v3' THEN pbv3.n ELSE pbv1.n END,
        0
      ),
      'logged_blocks', COALESCE(lb.n, 0),
      'total_entries', COALESCE(mc.total_entries, 0),
      'skipped_entries', COALESCE(mc.skipped_entries, 0)
    )
    ORDER BY up.created_at DESC
  ) INTO result
  FROM user_programs up
  LEFT JOIN prescribed_workouts pw ON pw.program_id = up.id
  LEFT JOIN completed_workout_counts cwc ON cwc.program_id = up.id
  LEFT JOIN prescribed_blocks_v3 pbv3 ON pbv3.program_id = up.id
  LEFT JOIN prescribed_blocks_v1 pbv1 ON pbv1.program_id = up.id
  LEFT JOIN logged_blocks lb ON lb.program_id = up.id
  LEFT JOIN movement_counts mc ON mc.program_id = up.id;

  RETURN COALESCE(result, '[]'::json);
END;
$$;
