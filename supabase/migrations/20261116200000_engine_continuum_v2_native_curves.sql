-- Continuum v2 (decided 2026-11-16, after the first production run):
--  - no unit conversion: every curve is in its machine's NATIVE pace multiples;
--  - the shared coordinate is EFFORT DURATION (the bout a balanced athlete
--    sustains at the delivered pace), stored per session as continuum_effort_s.
--
-- Why: the Concept2 curves had been copied from the Echo (2.6× @ 30 s) and
-- converted through watts; the population diagnostic showed their 30-s
-- ceiling actually sits near 1.95× watts = 1.25–1.33× PACE. Native curves,
-- anchored on this base's own rowers (1.33× @ 30 s, the same percentile as
-- 2.6× is of the Echo riders), replace them.

ALTER TABLE engine_workout_sessions ADD COLUMN IF NOT EXISTS continuum_effort_s integer NULL;
COMMENT ON COLUMN engine_workout_sessions.continuum_effort_s IS
  'effort duration: the single bout a balanced athlete sustains at the pace delivered (D(r), seconds) — the machine-independent coordinate';

-- Replace the Concept2-class curves. Metres: r_pace = r_echo^0.30 (power ∝ pace³;
-- 2.6^0.30 = 1.33). Calories on a C2 monitor (cal/hr = 4W+300): r_cal = r_echo^0.73 (≈2.0 @ 30 s).
DELETE FROM engine_pd_curves
WHERE modality IN ('c2_row_erg', 'c2_ski_erg', 'c2_bike_erg', 'rogue_row_erg');

INSERT INTO engine_pd_curves (modality, units, r, seconds)
SELECT m.modality, 'meters', ROUND(POWER(c.r, 0.30)::numeric, 3), c.seconds
FROM (VALUES ('c2_row_erg'), ('c2_ski_erg'), ('c2_bike_erg'), ('rogue_row_erg')) AS m(modality)
CROSS JOIN (SELECT r, seconds FROM engine_pd_curves WHERE modality = 'echo_bike' AND units = 'cal') AS c
ON CONFLICT (modality, units, r) DO NOTHING;

INSERT INTO engine_pd_curves (modality, units, r, seconds)
SELECT m.modality, 'cal', ROUND(POWER(c.r, 0.73)::numeric, 3), c.seconds
FROM (VALUES ('c2_row_erg'), ('c2_ski_erg'), ('c2_bike_erg')) AS m(modality)
CROSS JOIN (SELECT r, seconds FROM engine_pd_curves WHERE modality = 'echo_bike' AND units = 'cal') AS c
ON CONFLICT (modality, units, r) DO NOTHING;

-- Curves are v2 now: every athlete's engine_curve must be replayed. The
-- backfill checks module_version and recomputes; a full run
-- ({ all: true, stale_only: false }) is the deploy step.
