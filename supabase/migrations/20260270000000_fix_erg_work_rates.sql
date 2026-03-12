-- Fix work_rate for rowing, bike, and ski_erg.
-- These are distance-based movements (like run) so work_rate should be
-- meters per minute, not reps per minute.
-- Previously set to 18 m/min which made a 500m row take ~28 minutes.

-- Row: ~1:47/500m median pace ≈ 280 m/min
UPDATE movements SET work_rate = 280.00 WHERE canonical_name = 'row';
UPDATE movements SET work_rate = 280.00 WHERE canonical_name = 'rowing';

-- Bike / Echo Bike: ≈ 350 m/min equivalent
UPDATE movements SET work_rate = 350.00 WHERE canonical_name = 'bike';
UPDATE movements SET work_rate = 350.00 WHERE canonical_name = 'biking';
UPDATE movements SET work_rate = 350.00 WHERE canonical_name = 'echo_bike';

-- Ski Erg: slightly slower than row ≈ 260 m/min
UPDATE movements SET work_rate = 260.00 WHERE canonical_name = 'ski_erg';
