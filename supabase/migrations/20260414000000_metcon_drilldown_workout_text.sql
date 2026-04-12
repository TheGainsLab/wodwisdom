-- Update get_metcon_drilldown to also return block_id and block_text
-- so the UI can show the actual workout when a row is expanded.

CREATE OR REPLACE FUNCTION get_metcon_drilldown(
  p_user_id uuid,
  p_movement text,
  p_time_domain text
)
RETURNS TABLE (
  block_id uuid,
  block_label text,
  block_text text,
  score text,
  percentile smallint,
  performance_tier text,
  workout_date date
)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (b.id)
    b.id AS block_id,
    b.block_label,
    b.block_text,
    b.score,
    CAST(b.percentile AS smallint),
    b.performance_tier,
    l.workout_date
  FROM workout_log_entries e
  JOIN workout_log_blocks b ON e.block_id = b.id
  JOIN workout_logs l ON b.log_id = l.id
  WHERE l.user_id = p_user_id
    AND b.block_type = 'metcon'
    AND b.time_domain = p_time_domain
    AND b.percentile IS NOT NULL
    AND normalize_movement_name(e.movement) = p_movement
  ORDER BY b.id, l.workout_date DESC;
$$;
