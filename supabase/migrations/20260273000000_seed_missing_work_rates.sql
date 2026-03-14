-- Seed work rates for common metcon movements that were missing.
-- Values are reps per minute at median metcon pace (or meters/min for distance-based).

-- Gymnastics (G)
UPDATE movements SET work_rate = 40.00 WHERE canonical_name = 'air_squat';
UPDATE movements SET work_rate = 20.00 WHERE canonical_name = 'kipping_pull_up';
UPDATE movements SET work_rate = 20.00 WHERE canonical_name = 'sit_up';
UPDATE movements SET work_rate = 20.00 WHERE canonical_name = 'bar_dip';
UPDATE movements SET work_rate = 20.00 WHERE canonical_name = 'dip';
UPDATE movements SET work_rate = 3.00  WHERE canonical_name = 'handstand_walk'; -- ~3 lengths/min (7.5m each)
UPDATE movements SET work_rate = 3.00  WHERE canonical_name = 'wall_walk';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'burpee_box_jump';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'burpee_pull_up';
UPDATE movements SET work_rate = 6.00  WHERE canonical_name = 'burpee_muscle_up';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'lateral_burpee_over_dumbbell';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'step_up';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'box_step_up';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'strict_ring_dip';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'kipping_ring_dip';
UPDATE movements SET work_rate = 25.00 WHERE canonical_name = 'deficit_push_up';
UPDATE movements SET work_rate = 10.00 WHERE canonical_name = 'deficit_hspu';
UPDATE movements SET work_rate = 10.00 WHERE canonical_name = 'strict_hspu';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'hollow_rock';

-- Weightlifting (W) — common in metcons
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'front_squat';
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'back_squat';
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'squat';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.70 WHERE canonical_name = 'sumo_deadlift';
UPDATE movements SET work_rate = 15.00, weight_degradation_rate = 0.70 WHERE canonical_name = 'hang_clean';
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 1.00 WHERE canonical_name = 'squat_clean_and_jerk';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'jerk';
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'split_jerk';
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'press';
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'strict_press';
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'bench_press';
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'cluster';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.70 WHERE canonical_name = 'dumbbell_deadlift';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'dumbbell_clean';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'dumbbell_push_press';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'dumbbell_front_squat';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'dumbbell_box_step_up';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'dumbbell_overhead_lunge';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'dumbbell_walking_lunge';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'weighted_walking_lunge';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'overhead_walking_lunge';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'front_rack_walking_lunge';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'dumbbell_shoulder_to_overhead';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'dumbbell_ground_to_overhead';

-- Monostructural (M)
UPDATE movements SET work_rate = 350.00 WHERE canonical_name = 'assault_bike';
UPDATE movements SET work_rate = 50.00  WHERE canonical_name = 'swim';
UPDATE movements SET work_rate = 50.00  WHERE canonical_name = 'swimming';
