-- Lower run work_rate from 267 to 200 m/min.
-- 267 m/min (200m in 45s) is a sprint pace, too fast for metcon context.
-- 200 m/min (200m in 60s, ~2:30/500m) is more realistic mid-workout.

UPDATE movements SET work_rate = 200.00 WHERE canonical_name = 'run';
UPDATE movements SET work_rate = 200.00 WHERE canonical_name = 'running';
UPDATE movements SET work_rate = 180.00 WHERE canonical_name = 'shuttle_run';
