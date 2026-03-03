-- RPC: returns heat map data for a user's metcon review
-- Rows = movement names, Columns = time domains (short/medium/long)
-- Each cell = avg percentile + count of metcons

CREATE OR REPLACE FUNCTION get_metcon_heatmap(p_user_id uuid)
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
    AND b.percentile IS NOT NULL
    AND b.time_domain IS NOT NULL
  GROUP BY e.movement, b.time_domain
  ORDER BY e.movement;
$$;
