-- Engine continuum — Phase 0 (data only, nothing athlete-facing).
-- Spec: docs/conditioning_continuum_spec.md (v2). Plan: docs/conditioning_continuum_phase0_plan.md.
--
--  engine_pd_curves                         the balanced power-duration curve per machine/unit:
--                                           at pace r × trial, a balanced athlete sustains `seconds`.
--  engine_workout_sessions.continuum_*      per-session values (r, bout, sustain, evidence), computed
--                                           by engine-continuum-backfill from existing columns.
--  athlete_profiles.engine_curve            the athlete's multiplier curve M(r), replayed from history.
--  admin_engine_continuum(user)             everything the admin page draws.
--  admin_continuum_population()             avg M per region across athletes — the "near 1.0" diagnostic.

-- ─── 1. Reference curves ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS engine_pd_curves (
  modality text NOT NULL,
  units    text NOT NULL,
  r        numeric NOT NULL,   -- multiple of the 10-minute trial pace (comparable currency: watts for C2, cal for Echo)
  seconds  integer NOT NULL,   -- balanced max single bout at that pace
  PRIMARY KEY (modality, units, r)
);
COMMENT ON TABLE engine_pd_curves IS
  'Balanced power-duration curve per machine/unit: at r × trial pace a balanced athlete sustains one bout of `seconds`. Founder anchors 2026-11-16: 2.6× @ 30 s and 1.0× @ 600 s on Echo-bike calories. A refit must replay every athlete''s engine_curve (spec §3.6).';

ALTER TABLE engine_pd_curves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pd curves readable" ON engine_pd_curves;
CREATE POLICY "pd curves readable" ON engine_pd_curves FOR SELECT TO authenticated USING (true);

-- v1 seed. Echo bike calories is the authored curve. The Concept2 machines
-- receive the SAME r→seconds values as a first pass (their r is computed in
-- watts by the module; the Echo curve is close to linear in watts) — to be
-- refit from each machine's own max-effort data at the Phase 0 checkpoint.
INSERT INTO engine_pd_curves (modality, units, r, seconds)
SELECT m.modality, m.units, c.r, c.seconds
FROM (VALUES
  ('echo_bike', 'cal'),
  ('c2_row_erg', 'meters'), ('c2_row_erg', 'cal'),
  ('c2_ski_erg', 'meters'), ('c2_ski_erg', 'cal'),
  ('c2_bike_erg', 'meters'), ('c2_bike_erg', 'cal')
) AS m(modality, units)
CROSS JOIN (VALUES
  (3.20, 10), (2.90, 20), (2.60, 30), (2.20, 45), (1.80, 60), (1.35, 120), (1.20, 180),
  (1.12, 240), (1.00, 600), (0.95, 900), (0.92, 1200), (0.88, 1800), (0.82, 3600)
) AS c(r, seconds)
ON CONFLICT (modality, units, r) DO NOTHING;

-- ─── 2. Per-session values ─────────────────────────────────────────────────

ALTER TABLE engine_workout_sessions
  ADD COLUMN IF NOT EXISTS continuum_r        numeric NULL,
  ADD COLUMN IF NOT EXISTS continuum_bout_s   integer NULL,
  ADD COLUMN IF NOT EXISTS continuum_sustain  numeric NULL,
  ADD COLUMN IF NOT EXISTS continuum_evidence text    NULL;
ALTER TABLE engine_workout_sessions DROP CONSTRAINT IF EXISTS engine_sessions_continuum_evidence_check;
ALTER TABLE engine_workout_sessions ADD CONSTRAINT engine_sessions_continuum_evidence_check
  CHECK (continuum_evidence IS NULL OR continuum_evidence IN ('ceiling','floor','miss','record','zone2','no_trial','no_curve'));
COMMENT ON COLUMN engine_workout_sessions.continuum_r IS 'delivered pace as a multiple of the trial in force (comparable currency)';
COMMENT ON COLUMN engine_workout_sessions.continuum_bout_s IS 'the bout judged: longest work block of the prescription';
COMMENT ON COLUMN engine_workout_sessions.continuum_sustain IS 'bout ÷ balanced max bout at that pace; 1.0 = on the curve';
COMMENT ON COLUMN engine_workout_sessions.continuum_evidence IS 'ceiling | floor | miss | record | zone2 | no_trial | no_curve';

-- ─── 3. The athlete's curve ────────────────────────────────────────────────

ALTER TABLE athlete_profiles ADD COLUMN IF NOT EXISTS engine_curve jsonb NULL;
COMMENT ON COLUMN athlete_profiles.engine_curve IS
  'Continuum multiplier curve M(r): { version, nodes:[{r,m,conf,state}], flags:[], as_of, awaiting_right_anchor, computed_at, module_version }. Replayed from engine_workout_sessions by engine-continuum-backfill.';

-- ─── 4. Admin: one athlete ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_engine_continuum(target_user_id uuid)
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

  SELECT jsonb_build_object(
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'date', s.date, 'day_type', s.day_type, 'modality', s.modality, 'units', s.units,
        'actual_pace', s.actual_pace, 'target_pace', s.target_pace,
        'r', s.continuum_r, 'bout_s', s.continuum_bout_s, 'sustain', s.continuum_sustain, 'evidence', s.continuum_evidence,
        'intervals', s.workout_data->'total_intervals', 'total_work_time', s.workout_data->'total_work_time',
        'total_rest_time', s.workout_data->'total_rest_time'
      ) ORDER BY s.date, s.created_at)
      FROM engine_workout_sessions s
      WHERE s.user_id = target_user_id AND s.completed = true
    ), '[]'::jsonb),
    'trials', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'modality', t.modality, 'units', t.units, 'pace', t.calculated_rpm, 'date', t.date, 'is_current', t.is_current
      ) ORDER BY t.date)
      FROM engine_time_trials t
      WHERE t.user_id = target_user_id AND t.calculated_rpm IS NOT NULL
    ), '[]'::jsonb),
    'curve', (SELECT ap.engine_curve FROM athlete_profiles ap WHERE ap.user_id = target_user_id),
    'curves', COALESCE((
      SELECT jsonb_object_agg(k, pts) FROM (
        SELECT c.modality || '|' || c.units AS k,
               jsonb_agg(jsonb_build_object('r', c.r, 'seconds', c.seconds) ORDER BY c.r DESC) AS pts
        FROM engine_pd_curves c GROUP BY c.modality, c.units
      ) x
    ), '{}'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_engine_continuum(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_engine_continuum(uuid) TO authenticated;

-- ─── 5. Admin: the population diagnostic ───────────────────────────────────
-- Average M per region across athletes whose curve has that region measured.
-- Near 1.0 everywhere = the static curve is right; a region off 1.0 across
-- the population = the curve is wrong there (spec §3.6).

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
           (n->>'r')::numeric AS r,
           (n->>'m')::numeric AS m,
           (n->>'conf')::numeric AS conf,
           n->>'state' AS state
    FROM athlete_profiles ap
    CROSS JOIN LATERAL jsonb_array_elements(ap.engine_curve->'nodes') AS n
    WHERE ap.engine_curve IS NOT NULL
  ),
  regions AS (
    SELECT * FROM (VALUES
      ('0.85–0.95×', 0.85, 0.95), ('0.95–1.1×', 0.95, 1.1), ('1.1–1.3×', 1.1, 1.3), ('1.3–1.6×', 1.3, 1.6),
      ('1.6–2.0×', 1.6, 2.0), ('2.0–2.6×', 2.0, 2.6), ('>2.6×', 2.6, 100.0)
    ) AS r(label, lo, hi)
  ),
  per_athlete AS (
    SELECT rg.label, nd.user_id,
           SUM(nd.m * nd.conf) / NULLIF(SUM(nd.conf), 0) AS m_weighted,
           BOOL_OR(nd.state = 'measured') AS measured
    FROM regions rg JOIN nodes nd ON nd.r >= rg.lo AND nd.r < rg.hi
    GROUP BY rg.label, nd.user_id
  ),
  per_region AS (
    SELECT rg.label, rg.lo,
           ROUND(AVG(pa.m_weighted) FILTER (WHERE pa.measured), 3) AS avg_m_measured,
           COUNT(*) FILTER (WHERE pa.measured)                      AS n_measured,
           ROUND(AVG(pa.m_weighted), 3)                             AS avg_m_all,
           COUNT(*) FILTER (WHERE pa.m_weighted IS NOT NULL)        AS n_all
    FROM regions rg LEFT JOIN per_athlete pa ON pa.label = rg.label
    GROUP BY rg.label, rg.lo
  )
  SELECT jsonb_build_object(
    'athletes_with_curve', (SELECT COUNT(*) FROM athlete_profiles WHERE engine_curve IS NOT NULL),
    'regions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'label', pr.label, 'avg_m_measured', pr.avg_m_measured, 'n_measured', pr.n_measured,
        'avg_m_all', pr.avg_m_all, 'n_all', pr.n_all
      ) ORDER BY pr.lo)
      FROM per_region pr
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_continuum_population() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_continuum_population() TO authenticated;
