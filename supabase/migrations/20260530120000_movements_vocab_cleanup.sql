-- Movements vocab cleanup: merge 13 duplicate rows (all competition_count=0)
-- + backfill shorthand/abbreviation aliases. Generated for review; apply via dashboard.
UPDATE public.movements SET aliases = '["Air squats", "Bodyweight squat"]'::jsonb WHERE canonical_name = 'air_squat';
UPDATE public.movements SET aliases = '["Assault bike", "AB", "Air bike", "Assault"]'::jsonb WHERE canonical_name = 'assault_bike';
UPDATE public.movements SET aliases = '["Back squat", "BS", "Back squats"]'::jsonb WHERE canonical_name = 'back_squat';
UPDATE public.movements SET aliases = '["Bar-facing burpee", "Bar facing burpee", "BFB", "Bar-facing burpees"]'::jsonb WHERE canonical_name = 'bar_facing_burpee';
UPDATE public.movements SET aliases = '["Bar muscle-up", "BMU", "BMUs", "Bar MU"]'::jsonb WHERE canonical_name = 'bar_muscle_up';
UPDATE public.movements SET aliases = '["Biking", "Bike erg", "Bicycle"]'::jsonb WHERE canonical_name = 'bike';
UPDATE public.movements SET aliases = '["Box jump", "Box jumps"]'::jsonb WHERE canonical_name = 'box_jump';
UPDATE public.movements SET aliases = '["Box jump-over", "Box jump over", "BJO", "Box jump overs", "Box jump-overs"]'::jsonb WHERE canonical_name = 'box_jump_over';
UPDATE public.movements SET aliases = '["Burpees"]'::jsonb WHERE canonical_name = 'burpee';
UPDATE public.movements SET aliases = '["Chest to bar pull-up", "Chest-to-bar pull-up", "C2B", "CTB", "Chest-to-bar", "C2B pull-up"]'::jsonb WHERE canonical_name = 'chest_to_bar';
UPDATE public.movements SET aliases = '["Cleans"]'::jsonb WHERE canonical_name = 'clean';
UPDATE public.movements SET aliases = '["Clean and jerk", "C&J", "Clean & jerk", "CnJ"]'::jsonb WHERE canonical_name = 'clean_and_jerk';
UPDATE public.movements SET aliases = '["DL", "Deadlifts", "Conventional deadlift"]'::jsonb WHERE canonical_name = 'deadlift';
UPDATE public.movements SET aliases = '["Double-under", "DU", "DUs", "Dubs", "Double Unders"]'::jsonb WHERE canonical_name = 'double_under';
UPDATE public.movements SET aliases = '["DB clean"]'::jsonb WHERE canonical_name = 'dumbbell_clean';
UPDATE public.movements SET aliases = '["DB deadlift"]'::jsonb WHERE canonical_name = 'dumbbell_deadlift';
UPDATE public.movements SET aliases = '["DB push press"]'::jsonb WHERE canonical_name = 'dumbbell_push_press';
UPDATE public.movements SET aliases = '["Dumbbell snatch", "Single-arm dumbbell snatch", "One-arm dumbbell snatch", "DB snatch"]'::jsonb WHERE canonical_name = 'dumbbell_snatch';
UPDATE public.movements SET aliases = '["Dumbbell squat", "DB squat"]'::jsonb WHERE canonical_name = 'dumbbell_squat';
UPDATE public.movements SET aliases = '["Dumbbell thruster", "DB thruster", "DB thrusters"]'::jsonb WHERE canonical_name = 'dumbbell_thruster';
UPDATE public.movements SET aliases = '["Echo"]'::jsonb WHERE canonical_name = 'echo_bike';
UPDATE public.movements SET aliases = '["Dumbbell farmer carry", "Farmers carry", "Farmer''s carry", "Farmer''s walk", "Farmers walk"]'::jsonb WHERE canonical_name = 'farmer_carry';
UPDATE public.movements SET aliases = '["Front squat", "FS", "Front squats"]'::jsonb WHERE canonical_name = 'front_squat';
UPDATE public.movements SET aliases = '["GHD sit-up", "GHD", "GHD situp", "GHD sit-ups", "GHDs"]'::jsonb WHERE canonical_name = 'ghd_sit_up';
UPDATE public.movements SET aliases = '["Goblet squats"]'::jsonb WHERE canonical_name = 'goblet_squat';
UPDATE public.movements SET aliases = '["Ground to overhead", "G2OH", "GTOH", "Ground-to-overhead"]'::jsonb WHERE canonical_name = 'ground_to_overhead';
UPDATE public.movements SET aliases = '["Handstand push-up", "HSPU", "HSPUs", "Handstand pushup"]'::jsonb WHERE canonical_name = 'handstand_push_up';
UPDATE public.movements SET aliases = '["Handstand walk", "Obstacle handstand walk", "HSW", "HS walk", "Handstand walks"]'::jsonb WHERE canonical_name = 'handstand_walk';
UPDATE public.movements SET aliases = '["Hang power clean", "HPC"]'::jsonb WHERE canonical_name = 'hang_power_clean';
UPDATE public.movements SET aliases = '["HPS"]'::jsonb WHERE canonical_name = 'hang_power_snatch';
UPDATE public.movements SET aliases = '["Hang squat clean"]'::jsonb WHERE canonical_name = 'hang_squat_clean';
UPDATE public.movements SET aliases = '["Jerks"]'::jsonb WHERE canonical_name = 'jerk';
UPDATE public.movements SET aliases = '["Skipping"]'::jsonb WHERE canonical_name = 'jump_rope';
UPDATE public.movements SET aliases = '["Kettlebell snatch", "KB snatch"]'::jsonb WHERE canonical_name = 'kettlebell_snatch';
UPDATE public.movements SET aliases = '["Kettlebell swing", "KBS", "KB swing", "American kettlebell swing", "Russian kettlebell swing", "Kettlebell swings"]'::jsonb WHERE canonical_name = 'kettlebell_swing';
UPDATE public.movements SET aliases = '["Kipping pull-up", "Kipping pullup"]'::jsonb WHERE canonical_name = 'kipping_pull_up';
UPDATE public.movements SET aliases = '["L-sit", "Lsit"]'::jsonb WHERE canonical_name = 'l_sit';
UPDATE public.movements SET aliases = '["Legless rope ascent", "Legless rope climb", "LRC", "Legless rope climbs"]'::jsonb WHERE canonical_name = 'legless_rope_climb';
UPDATE public.movements SET aliases = '["Muscle-up", "Strict muscle-up", "MU", "MUs"]'::jsonb WHERE canonical_name = 'muscle_up';
UPDATE public.movements SET aliases = '["Overhead squat", "OHS"]'::jsonb WHERE canonical_name = 'overhead_squat';
UPDATE public.movements SET aliases = '["Alternating pistol squat", "Alternating pistol", "Pistol squat", "Pistols", "Pistol squats", "Single-leg squat"]'::jsonb WHERE canonical_name = 'pistol';
UPDATE public.movements SET aliases = '["Power clean", "PC", "Power cleans"]'::jsonb WHERE canonical_name = 'power_clean';
UPDATE public.movements SET aliases = '["Power snatch", "PSN", "Power snatches"]'::jsonb WHERE canonical_name = 'power_snatch';
UPDATE public.movements SET aliases = '["Pull-up", "Pull-ups", "Pullup", "Pullups"]'::jsonb WHERE canonical_name = 'pull_up';
UPDATE public.movements SET aliases = '["PJ", "Push jerks"]'::jsonb WHERE canonical_name = 'push_jerk';
UPDATE public.movements SET aliases = '["Push press", "PP", "Push presses"]'::jsonb WHERE canonical_name = 'push_press';
UPDATE public.movements SET aliases = '["Push-up", "Push-ups", "Pushups", "Pushup"]'::jsonb WHERE canonical_name = 'push_up';
UPDATE public.movements SET aliases = '["Ring muscle-up", "RMU", "RMUs", "Ring MU"]'::jsonb WHERE canonical_name = 'ring_muscle_up';
UPDATE public.movements SET aliases = '["RDL", "Romanian deadlift"]'::jsonb WHERE canonical_name = 'romanian_deadlift';
UPDATE public.movements SET aliases = '["Rope climb", "RC", "Rope climbs"]'::jsonb WHERE canonical_name = 'rope_climb';
UPDATE public.movements SET aliases = '["Rowing", "Erg", "Rower", "C2 row"]'::jsonb WHERE canonical_name = 'row';
UPDATE public.movements SET aliases = '["Running", "Runs"]'::jsonb WHERE canonical_name = 'run';
UPDATE public.movements SET aliases = '["Shoulder to overhead", "Axle shoulder to overhead", "S2OH", "STOH", "Shoulder-to-overhead"]'::jsonb WHERE canonical_name = 'shoulder_to_overhead';
UPDATE public.movements SET aliases = '["SU", "Single-under", "Singles"]'::jsonb WHERE canonical_name = 'single_under';
UPDATE public.movements SET aliases = '["Sit-up", "Situp", "Situps", "Sit-ups"]'::jsonb WHERE canonical_name = 'sit_up';
UPDATE public.movements SET aliases = '["Ski", "SkiErg", "Ski-erg"]'::jsonb WHERE canonical_name = 'ski_erg';
UPDATE public.movements SET aliases = '["Snatches", "SN"]'::jsonb WHERE canonical_name = 'snatch';
UPDATE public.movements SET aliases = '["SJ", "Split jerks"]'::jsonb WHERE canonical_name = 'split_jerk';
UPDATE public.movements SET aliases = '["Squat clean", "Squat cleans", "Full clean"]'::jsonb WHERE canonical_name = 'squat_clean';
UPDATE public.movements SET aliases = '["Squat snatch", "Squat snatches", "Full snatch"]'::jsonb WHERE canonical_name = 'squat_snatch';
UPDATE public.movements SET aliases = '["Strict press", "Overhead press", "Shoulder press"]'::jsonb WHERE canonical_name = 'strict_press';
UPDATE public.movements SET aliases = '["Strict pull-up", "Strict pullup"]'::jsonb WHERE canonical_name = 'strict_pull_up';
UPDATE public.movements SET aliases = '["Sumo deadlift"]'::jsonb WHERE canonical_name = 'sumo_deadlift';
UPDATE public.movements SET aliases = '["Sumo deadlift high pull", "SDHP"]'::jsonb WHERE canonical_name = 'sumo_deadlift_high_pull';
UPDATE public.movements SET aliases = '["Swimming", "Swims"]'::jsonb WHERE canonical_name = 'swim';
UPDATE public.movements SET aliases = '["Thrusters"]'::jsonb WHERE canonical_name = 'thruster';
UPDATE public.movements SET aliases = '["Toes to bar", "T2B", "TTB", "Toes-to-bar", "Toes 2 bar"]'::jsonb WHERE canonical_name = 'toes_to_bar';
UPDATE public.movements SET aliases = '["TGU", "Turkish get-up", "Turkish getup", "TGUs"]'::jsonb WHERE canonical_name = 'turkish_get_up';
UPDATE public.movements SET aliases = '["V-up", "V ups", "Vups"]'::jsonb WHERE canonical_name = 'v_up';
UPDATE public.movements SET aliases = '["Wall ball", "WB", "WBs", "Wallball", "Wall balls", "Wall ball shot"]'::jsonb WHERE canonical_name = 'wall_ball';
UPDATE public.movements SET aliases = '["Wall walk", "Wall walks", "WW"]'::jsonb WHERE canonical_name = 'wall_walk';

DELETE FROM public.movements WHERE canonical_name IN ('double_unders', 'burpees', 'pistols', 'rope_climbs', 'pushup', 'hspu', 'biking', 'rowing', 'running', 'swimming', 'kb_swing', 'sdhp', 'tgu');

-- New canonical movement: Sprint (kept separate from Run; numeric fields left null)
INSERT INTO public.movements (id, canonical_name, display_name, modality, category, aliases, competition_count, created_at)
SELECT gen_random_uuid(), 'sprint', 'Sprint', 'M', 'Monostructural', '["Sprints","Sprinting"]'::jsonb, 0, now()
WHERE NOT EXISTS (SELECT 1 FROM public.movements WHERE canonical_name = 'sprint');

-- Verify: expect total=127, sprint=1
SELECT count(*) AS total, count(*) FILTER (WHERE canonical_name = 'sprint') AS sprint FROM public.movements;