-- Continuum v2: the population diagnostic groups by EFFORT DURATION bands.
-- v2 curves index nodes by `seconds` (not `r`); the v1 RPC read n->>'r' and
-- so matched nothing after the v2 replay. Same output shape as before.

CREATE OR REPLACE FUNCTION public.admin_continuum_population()
RETURNS jsonb
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

  WITH nodes AS (
    SELECT ap.user_id,
           (n->>'seconds')::numeric AS seconds,
           (n->>'m')::numeric AS m,
           (n->>'conf')::numeric AS conf,
           n->>'state' AS state
    FROM athlete_profiles ap
    CROSS JOIN LATERAL jsonb_array_elements(ap.engine_curve->'nodes') AS n
    WHERE ap.engine_curve IS NOT NULL AND (ap.engine_curve->>'version')::int >= 2
  ),
  bands AS (
    -- long efforts first, as on the chart (left = slow twitch)
    SELECT * FROM (VALUES
      ('20–40 min', 1200, 2400, 1), ('10–20 min', 600, 1200, 2), ('4–10 min', 240, 600, 3), ('2–4 min', 120, 240, 4),
      ('1–2 min', 60, 120, 5), ('30–60 s', 30, 60, 6), ('≤30 s', 0, 30, 7)
    ) AS b(label, lo, hi, ord)
  ),
  per_athlete AS (
    SELECT b.label, b.ord, nd.user_id,
           SUM(nd.m * nd.conf) / NULLIF(SUM(nd.conf), 0) AS m_weighted,
           BOOL_OR(nd.state = 'measured') AS measured
    FROM bands b JOIN nodes nd ON nd.seconds >= b.lo AND nd.seconds < b.hi
    GROUP BY b.label, b.ord, nd.user_id
  ),
  per_band AS (
    SELECT b.label, b.ord,
           ROUND(AVG(pa.m_weighted) FILTER (WHERE pa.measured), 3) AS avg_m_measured,
           COUNT(*) FILTER (WHERE pa.measured)                      AS n_measured,
           ROUND(AVG(pa.m_weighted), 3)                             AS avg_m_all,
           COUNT(*) FILTER (WHERE pa.m_weighted IS NOT NULL)        AS n_all
    FROM bands b LEFT JOIN per_athlete pa ON pa.label = b.label
    GROUP BY b.label, b.ord
  )
  SELECT jsonb_build_object(
    'athletes_with_curve', (SELECT COUNT(*) FROM athlete_profiles WHERE engine_curve IS NOT NULL),
    'regions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'label', pb.label, 'avg_m_measured', pb.avg_m_measured, 'n_measured', pb.n_measured,
        'avg_m_all', pb.avg_m_all, 'n_all', pb.n_all
      ) ORDER BY pb.ord)
      FROM per_band pb
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_continuum_population() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_continuum_population() TO authenticated;
