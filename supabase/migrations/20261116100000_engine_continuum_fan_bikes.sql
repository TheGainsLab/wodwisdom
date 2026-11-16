-- Continuum: reference curves for the other fan bikes and the Rogue rower.
-- First production backfill (2026-11-16): 277 sessions had no curve —
-- 169 on assault_bike cal, 46 on airdyne_bike cal, 3 on rogue_row_erg m.
-- Fan bikes read calories the way the Echo does → the Echo curve as a first
-- pass; the Rogue rower is a Concept2-class erg → the C2 rower curve.
-- Runners, treadmills, miles/km units stay without a curve for now.
INSERT INTO engine_pd_curves (modality, units, r, seconds)
SELECT m.modality, m.units, c.r, c.seconds
FROM (VALUES ('assault_bike', 'cal'), ('airdyne_bike', 'cal'), ('other_bike', 'cal')) AS m(modality, units)
CROSS JOIN (SELECT r, seconds FROM engine_pd_curves WHERE modality = 'echo_bike' AND units = 'cal') AS c
ON CONFLICT (modality, units, r) DO NOTHING;

INSERT INTO engine_pd_curves (modality, units, r, seconds)
SELECT 'rogue_row_erg', 'meters', r, seconds FROM engine_pd_curves WHERE modality = 'c2_row_erg' AND units = 'meters'
ON CONFLICT (modality, units, r) DO NOTHING;
