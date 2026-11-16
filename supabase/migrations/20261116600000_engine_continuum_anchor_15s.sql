-- Continuum: move the 2.6× anchor from 30 s to 15 s (decided 2026-11-16).
--
-- 2.6× VO2max power is the research figure for PEAK power, a 10–15 s effort,
-- not a 30-s one. With it at 30 s the first production run put the base's
-- median 30-s max (2.27×) at 0.86 of balanced — the curve, not the athletes.
-- Re-anchored: 2.6× @ 15 s, 2.2× @ 30 s (the glycolytic reference for
-- CrossFit, and this base's median), 1.0× @ 600 s unchanged. Envelope
-- midpoints between. The Concept2 curves are derived from the Echo
-- (metres ^0.30 → ≈1.27× @ 30 s; calories ^0.73 → ≈1.78×) so they follow.
-- The running curve (20261116500000) is authored separately and is unchanged.

-- Echo family: Echo, Assault, Airdyne, other fan bikes — calories.
DELETE FROM engine_pd_curves
WHERE units = 'cal' AND modality IN ('echo_bike', 'assault_bike', 'airdyne_bike', 'other_bike');

INSERT INTO engine_pd_curves (modality, units, r, seconds)
SELECT m.modality, 'cal', c.r, c.seconds
FROM (VALUES ('echo_bike'), ('assault_bike'), ('airdyne_bike'), ('other_bike')) AS m(modality)
CROSS JOIN (VALUES
  (2.8, 10), (2.6, 15), (2.5, 20), (2.2, 30), (1.95, 45), (1.75, 60), (1.35, 120), (1.2, 180),
  (1.12, 240), (1.0, 600), (0.95, 900), (0.92, 1200), (0.88, 1800), (0.82, 3600)
) AS c(r, seconds)
ON CONFLICT (modality, units, r) DO NOTHING;

-- Concept2-class ergs: derived from the new Echo curve, as in 20261116200000.
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

-- The curves changed: every athlete's engine_curve must be replayed —
-- deploy step: full backfill run { all: true, stale_only: false }.
