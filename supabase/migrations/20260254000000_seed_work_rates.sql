-- Seed work rates for common metcon movements.
-- Values ported from mobile app benchmarks (reps per minute at median pace).
-- weight_degradation_rate: 0.7 = mild (deadlift/power clean), 0.8 = medium (thruster/snatch), 1.0 = high (squat clean/OHS).

-- Weightlifting (W)
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'snatch';
UPDATE movements SET work_rate = 15.00, weight_degradation_rate = 0.70 WHERE canonical_name = 'power_snatch';
UPDATE movements SET work_rate = 9.00,  weight_degradation_rate = 1.00 WHERE canonical_name = 'squat_snatch';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.70 WHERE canonical_name = 'deadlift';
UPDATE movements SET work_rate = 15.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'overhead_squat';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'thruster';
UPDATE movements SET work_rate = 15.00, weight_degradation_rate = 0.70 WHERE canonical_name = 'power_clean';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 1.00 WHERE canonical_name = 'squat_clean';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'clean_and_jerk';
UPDATE movements SET work_rate = 15.00, weight_degradation_rate = 0.70 WHERE canonical_name = 'clean';
UPDATE movements SET work_rate = 20.00 WHERE canonical_name = 'wall_ball';
UPDATE movements SET work_rate = 30.00 WHERE canonical_name = 'kettlebell_swing';
UPDATE movements SET work_rate = 30.00 WHERE canonical_name = 'kb_swing';
UPDATE movements SET work_rate = 21.00 WHERE canonical_name = 'kettlebell_snatch';
UPDATE movements SET work_rate = 20.79 WHERE canonical_name = 'dumbbell_snatch';
UPDATE movements SET work_rate = 15.42 WHERE canonical_name = 'dumbbell_thruster';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'dumbbell_hang_clean_and_jerk';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'shoulder_to_overhead';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'ground_to_overhead';
UPDATE movements SET work_rate = 24.00 WHERE canonical_name = 'ghd_sit_up';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'push_press';
UPDATE movements SET work_rate = 10.00, weight_degradation_rate = 0.80 WHERE canonical_name = 'push_jerk';
UPDATE movements SET work_rate = 15.00, weight_degradation_rate = 0.70 WHERE canonical_name = 'hang_power_clean';
UPDATE movements SET work_rate = 12.00, weight_degradation_rate = 1.00 WHERE canonical_name = 'hang_squat_clean';
UPDATE movements SET work_rate = 15.00, weight_degradation_rate = 0.70 WHERE canonical_name = 'hang_power_snatch';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'sumo_deadlift_high_pull';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'sdhp';

-- Gymnastics (G)
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'pull_up';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'strict_pull_up';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'chest_to_bar';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'toes_to_bar';
UPDATE movements SET work_rate = 7.50  WHERE canonical_name = 'bar_muscle_up';
UPDATE movements SET work_rate = 9.00  WHERE canonical_name = 'ring_muscle_up';
UPDATE movements SET work_rate = 9.00  WHERE canonical_name = 'muscle_up';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'handstand_push_up';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'hspu';
UPDATE movements SET work_rate = 30.00 WHERE canonical_name = 'push_up';
UPDATE movements SET work_rate = 30.00 WHERE canonical_name = 'pushup';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'burpee';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'burpees';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'bar_facing_burpee';
UPDATE movements SET work_rate = 12.00 WHERE canonical_name = 'burpee_box_jump_over';
UPDATE movements SET work_rate = 21.21 WHERE canonical_name = 'box_jump';
UPDATE movements SET work_rate = 21.21 WHERE canonical_name = 'box_jumps';
UPDATE movements SET work_rate = 18.75 WHERE canonical_name = 'box_jump_over';
UPDATE movements SET work_rate = 6.00  WHERE canonical_name = 'rope_climb';
UPDATE movements SET work_rate = 6.00  WHERE canonical_name = 'rope_climbs';
UPDATE movements SET work_rate = 4.50  WHERE canonical_name = 'legless_rope_climb';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'ring_dip';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'ring_dips';
UPDATE movements SET work_rate = 20.00 WHERE canonical_name = 'lunge';
UPDATE movements SET work_rate = 20.00 WHERE canonical_name = 'walking_lunge';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'pistol';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'pistols';
UPDATE movements SET work_rate = 20.00 WHERE canonical_name = 'v_up';
UPDATE movements SET work_rate = 20.00 WHERE canonical_name = 'knee_raise';

-- Monostructural (M)
UPDATE movements SET work_rate = 60.00 WHERE canonical_name = 'double_under';
UPDATE movements SET work_rate = 60.00 WHERE canonical_name = 'double_unders';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'row';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'rowing';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'bike';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'biking';
UPDATE movements SET work_rate = 18.00 WHERE canonical_name = 'echo_bike';
UPDATE movements SET work_rate = 15.00 WHERE canonical_name = 'ski_erg';
UPDATE movements SET work_rate = 120.00 WHERE canonical_name = 'single_under';
UPDATE movements SET work_rate = 120.00 WHERE canonical_name = 'jump_rope';

-- Run: special case — work_rate is meters per minute (not reps)
-- 200m in ~45s at median pace ≈ 267 m/min
UPDATE movements SET work_rate = 267.00 WHERE canonical_name = 'run';
UPDATE movements SET work_rate = 267.00 WHERE canonical_name = 'running';
UPDATE movements SET work_rate = 240.00 WHERE canonical_name = 'shuttle_run';
