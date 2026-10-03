-- admin_user_metcon_blocks — the training-side feed for the performance
-- grid on the admin user-detail page: every scored (percentile-carrying)
-- logged metcon block with its time domain and the movement names logged
-- against it. The frontend reduces these to the same duration × barbell ×
-- skill grid it builds from competition all_results, so linked athletes
-- get competition + training stacked and everyone else gets training alone.
--
-- Movements come from workout_log_entries matched by block_id, with the
-- legacy block_label fallback the Training Log page itself uses.

CREATE OR REPLACE FUNCTION admin_user_metcon_blocks(target_user_id uuid)
RETURNS TABLE(
  workout_date date,
  block_label text,
  time_domain text,
  percentile numeric,
  movements text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  -- In-function admin gate (same pattern as admin_user_list_v2).
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  RETURN QUERY
  SELECT
    wl.workout_date,
    wlb.block_label,
    wlb.time_domain,
    wlb.percentile::numeric,
    COALESCE(
      (SELECT array_agg(DISTINCT e.movement)
         FROM workout_log_entries e
        WHERE e.log_id = wlb.log_id
          AND e.movement IS NOT NULL
          AND (e.block_id = wlb.id
               OR (e.block_id IS NULL AND e.block_label = wlb.block_label))),
      '{}'::text[]
    ) AS movements
  FROM workout_log_blocks wlb
  JOIN workout_logs wl ON wl.id = wlb.log_id
  WHERE wl.user_id = target_user_id
    AND wlb.block_type = 'metcon'
    AND wlb.percentile IS NOT NULL
  ORDER BY wl.workout_date DESC;
END;
$func$;

REVOKE ALL ON FUNCTION admin_user_metcon_blocks(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_user_metcon_blocks(uuid) TO authenticated;
