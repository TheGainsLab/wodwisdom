-- my_training_counts — the Analytics Overview's count-based signals
-- (founder redesign, 2026-09-07): positive counts only, no denominators,
-- no prescription math. Replaces my_adherence as the Overview's source
-- (my_adherence stays for the admin page's clinical view).
--
--   days_trained        distinct dates with a COMPLETED workout log —
--                       "a day you logged anything is a day you trained";
--                       sidesteps the finish-button/partial-day semantics.
--   per-program blocks  logged blocks by type (strength / metcon / skills /
--                       accessory — warm-up/cool-down/mobility excluded, as
--                       everywhere), across that program's completed logs.
--                       Same block semantics as admin_user_adherence's
--                       logged_blocks, split by type.
--
-- Self-scoped (auth.uid()); safe for every authenticated user.

CREATE OR REPLACE FUNCTION my_training_counts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  uid uuid := auth.uid();
BEGIN
  WITH
    completed AS (
      SELECT id AS log_id, workout_date, source_id
      FROM workout_logs
      WHERE user_id = uid AND status = 'completed'
    ),
    user_programs AS (
      SELECT id, name, created_at
      FROM programs
      WHERE user_id = uid
      ORDER BY created_at DESC
      LIMIT 3
    ),
    program_logs AS (
      SELECT c.log_id, c.workout_date, pw.program_id
      FROM completed c
      JOIN program_workouts pw ON pw.id = c.source_id
      WHERE pw.program_id IN (SELECT id FROM user_programs)
    ),
    per_program AS (
      SELECT
        up.id, up.name, up.created_at,
        (SELECT COUNT(DISTINCT pl.workout_date) FROM program_logs pl WHERE pl.program_id = up.id) AS days_trained,
        COALESCE(bc.strength_blocks, 0) AS strength_blocks,
        COALESCE(bc.metcon_blocks, 0) AS metcon_blocks,
        COALESCE(bc.skills_blocks, 0) AS skills_blocks,
        COALESCE(bc.accessory_blocks, 0) AS accessory_blocks
      FROM user_programs up
      LEFT JOIN (
        SELECT pl.program_id,
               COUNT(*) FILTER (WHERE wlb.block_type = 'strength') AS strength_blocks,
               COUNT(*) FILTER (WHERE wlb.block_type = 'metcon') AS metcon_blocks,
               COUNT(*) FILTER (WHERE wlb.block_type = 'skills') AS skills_blocks,
               COUNT(*) FILTER (WHERE wlb.block_type = 'accessory') AS accessory_blocks
        FROM program_logs pl
        JOIN workout_log_blocks wlb ON wlb.log_id = pl.log_id
        WHERE wlb.block_type IN ('strength', 'metcon', 'skills', 'accessory')
        GROUP BY pl.program_id
      ) bc ON bc.program_id = up.id
    )
  SELECT json_build_object(
    'days_trained_total', (SELECT COUNT(DISTINCT workout_date) FROM completed),
    'days_trained_30d', (
      SELECT COUNT(DISTINCT workout_date) FROM completed
      WHERE workout_date >= (CURRENT_DATE - interval '30 days')::date
    ),
    'programs', COALESCE(
      (SELECT json_agg(
         json_build_object(
           'id', pp.id,
           'name', pp.name,
           'created_at', pp.created_at,
           'days_trained', pp.days_trained,
           'strength_blocks', pp.strength_blocks,
           'metcon_blocks', pp.metcon_blocks,
           'skills_blocks', pp.skills_blocks,
           'accessory_blocks', pp.accessory_blocks
         ) ORDER BY pp.created_at DESC
       ) FROM per_program pp),
      '[]'::json
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION my_training_counts() FROM public, anon;
GRANT EXECUTE ON FUNCTION my_training_counts() TO authenticated;
