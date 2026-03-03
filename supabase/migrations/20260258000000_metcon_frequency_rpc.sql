-- RPC: returns frequency data for a user's metcon heatmap
-- Same shape as get_metcon_heatmap but includes ALL logged metcons
-- (not just those with a percentile score).
-- avg_percentile is nullable — populated only when scored data exists.

CREATE OR REPLACE FUNCTION get_metcon_frequency(p_user_id uuid)
RETURNS TABLE (
  movement text,
  time_domain text,
  avg_percentile smallint,
  workout_count bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.movement,
    b.time_domain,
    CAST(ROUND(AVG(b.percentile)) AS smallint) AS avg_percentile,
    COUNT(*) AS workout_count
  FROM workout_log_entries e
  JOIN workout_log_blocks b ON e.block_id = b.id
  JOIN workout_logs l ON b.log_id = l.id
  WHERE l.user_id = p_user_id
    AND b.block_type = 'metcon'
    AND b.time_domain IS NOT NULL
  GROUP BY e.movement, b.time_domain
  ORDER BY e.movement;
$$;
