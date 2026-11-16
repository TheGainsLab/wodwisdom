-- Continuum: one running curve for every running modality and unit.
-- Decided 2026-11-16. Running's power-duration curve is well known, so it is
-- authored from the literature rather than fitted: for a trained, balanced
-- runner, 30-s pace ≈ 1.42× 10-minute pace and 60-minute pace ≈ 0.89×.
-- A pace multiple is unit-free (metres, miles, km per minute give the same
-- ratio), so the same points serve every distance unit. Calories on a
-- curved treadmill scale close to speed → same curve as a first pass.
-- Echo bike in metres/miles stays WITHOUT a curve (uncommon; no published
-- distance formula; one athlete) — founder decision.
INSERT INTO engine_pd_curves (modality, units, r, seconds)
SELECT m.modality, u.units, c.r, c.seconds
FROM (VALUES
  ('outdoor_run'), ('track_run'), ('road_run'), ('trail_run'),
  ('assault_runner'), ('assault_runner_run'), ('motorized_treadmill'), ('other_treadmill')
) AS m(modality)
CROSS JOIN (VALUES ('meters'), ('miles'), ('kilometers'), ('cal')) AS u(units)
CROSS JOIN (VALUES
  (1.55, 10), (1.48, 20), (1.42, 30), (1.36, 45), (1.32, 60), (1.16, 120), (1.10, 180),
  (1.07, 240), (1.00, 600), (0.97, 900), (0.95, 1200), (0.92, 1800), (0.89, 3600)
) AS c(r, seconds)
ON CONFLICT (modality, units, r) DO NOTHING;
