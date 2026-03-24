-- Helper: normalizes a raw movement string to its display_name from the
-- movements table.  Handles plural→singular, casing, and hyphen/space
-- variations by converting to canonical slug form and looking up the table.
-- Falls back to the original string when no match is found.

CREATE OR REPLACE FUNCTION normalize_movement_name(raw text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    -- 1. Exact slug match
    (SELECT m.display_name FROM movements m
     WHERE m.canonical_name = regexp_replace(
       regexp_replace(lower(trim(raw)), '[\s\-]+', '_', 'g'),
       '[^a-z0-9_]', '', 'g'
     )
     LIMIT 1),
    -- 2. Strip trailing 's' (plurals: "Thrusters" → "thruster")
    (SELECT m.display_name FROM movements m
     WHERE m.canonical_name = regexp_replace(
       regexp_replace(
         regexp_replace(lower(trim(raw)), '[\s\-]+', '_', 'g'),
         '[^a-z0-9_]', '', 'g'
       ),
       's$', ''
     )
     LIMIT 1),
    -- 3. Fallback: return original text as-is
    raw
  );
$$;

-- Rebuild get_metcon_heatmap with movement normalization
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
    normalize_movement_name(e.movement) AS movement,
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
  GROUP BY normalize_movement_name(e.movement), b.time_domain
  ORDER BY normalize_movement_name(e.movement);
$$;

-- Rebuild get_metcon_frequency with movement normalization
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
    normalize_movement_name(e.movement) AS movement,
    b.time_domain,
    CAST(ROUND(AVG(b.percentile)) AS smallint) AS avg_percentile,
    COUNT(*) AS workout_count
  FROM workout_log_entries e
  JOIN workout_log_blocks b ON e.block_id = b.id
  JOIN workout_logs l ON b.log_id = l.id
  WHERE l.user_id = p_user_id
    AND b.block_type = 'metcon'
    AND b.time_domain IS NOT NULL
  GROUP BY normalize_movement_name(e.movement), b.time_domain
  ORDER BY normalize_movement_name(e.movement);
$$;

-- Drill-down RPC: returns individual metcon results for a normalized movement + time domain.
-- Used when clicking a heatmap cell — matches all raw variants that normalize to the same name.
CREATE OR REPLACE FUNCTION get_metcon_drilldown(
  p_user_id uuid,
  p_movement text,
  p_time_domain text
)
RETURNS TABLE (
  block_label text,
  score text,
  percentile smallint,
  performance_tier text,
  workout_date date
)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (b.id)
    b.block_label,
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
