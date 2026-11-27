-- Movement list review with the founder (2026-11-27), and a block field.
--
-- The list is the same for every member and is shown to the AI as a guide to
-- names. Reviewing dry runs of the rebuilt metcon composer turned up
-- duplicates, style variants and movements offered where they do not belong
-- (a goblet squat in a metcon). This migration:
--
--   1. folds redundant entries into one (lunges, a duplicate kettlebell
--      swing, chest-to-wall into wall-facing, kipping ring dip);
--   2. removes Sumo Deadlift High Pull and Cluster;
--   3. renames Row to Rowing, Crossover to Crossover Double Under, and the
--      handstand push-up entries to one spelling (HSPU), and Knee Raise to
--      Hanging Knee Raise;
--   4. adds movements.blocks: which training blocks each movement is offered
--      for. The metcon marks start from data (a movement in at least 10 of
--      the 3,800 main site metcons) with the founder's corrections; the
--      other blocks are a first draft to be corrected;
--   5. renames "Row" to "Rowing" on programs already written.
--
-- Every statement is keyed by canonical_name and safe to run more than once.

-- 1. Entries folded into another. The old name stays as a hidden alternate
--    spelling, so workouts already written and typed-in names still resolve.
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Weighted Walking Lunge", "Weighted walking lunge"]'::jsonb) AS a
)
WHERE canonical_name = 'dumbbell_walking_lunge';
DELETE FROM public.movements WHERE canonical_name = 'weighted_walking_lunge';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Lunge"]'::jsonb) AS a
)
WHERE canonical_name = 'walking_lunge';
DELETE FROM public.movements WHERE canonical_name = 'lunge';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Dumbbell Front Rack Walking Lunge", "Dumbbell front rack walking lunge"]'::jsonb) AS a
)
WHERE canonical_name = 'dumbbell_walking_lunge';
DELETE FROM public.movements WHERE canonical_name = 'dumbbell_front_rack_walking_lunge';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Dumbbell Overhead Lunge", "Dumbbell overhead lunge", "Right-arm dumbbell overhead lunge", "Left-arm dumbbell overhead lunge"]'::jsonb) AS a
)
WHERE canonical_name = 'dumbbell_walking_lunge';
DELETE FROM public.movements WHERE canonical_name = 'dumbbell_overhead_lunge';
DELETE FROM public.movements WHERE canonical_name = 'kb_swing';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Chest To Wall Hspu", "Chest to wall handstand push-up"]'::jsonb) AS a
)
WHERE canonical_name = 'wall_facing_hspu';
DELETE FROM public.movements WHERE canonical_name = 'chest_to_wall_hspu';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Kipping Ring Dip"]'::jsonb) AS a
)
WHERE canonical_name = 'ring_dip';
DELETE FROM public.movements WHERE canonical_name = 'kipping_ring_dip';

-- 2. Removed entirely: no longer offered for new work. Workouts already written keep them.
DELETE FROM public.movements WHERE canonical_name IN ('sdhp', 'sumo_deadlift_high_pull', 'cluster');

-- 3. Renamed. The old name stays as a hidden alternate spelling.
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Row"]'::jsonb) AS a
)
WHERE canonical_name = 'row';
UPDATE public.movements
SET display_name = 'Rowing',
    aliases = (SELECT COALESCE(jsonb_agg(a ORDER BY a), '[]'::jsonb) FROM jsonb_array_elements_text(aliases) AS a WHERE lower(a) <> lower('Rowing'))
WHERE canonical_name = 'row';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Crossover", "Crossovers"]'::jsonb) AS a
)
WHERE canonical_name = 'crossover';
UPDATE public.movements
SET display_name = 'Crossover Double Under',
    aliases = (SELECT COALESCE(jsonb_agg(a ORDER BY a), '[]'::jsonb) FROM jsonb_array_elements_text(aliases) AS a WHERE lower(a) <> lower('Crossover Double Under'))
WHERE canonical_name = 'crossover';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Handstand Push Up"]'::jsonb) AS a
)
WHERE canonical_name = 'handstand_push_up';
UPDATE public.movements
SET display_name = 'HSPU',
    aliases = (SELECT COALESCE(jsonb_agg(a ORDER BY a), '[]'::jsonb) FROM jsonb_array_elements_text(aliases) AS a WHERE lower(a) <> lower('HSPU'))
WHERE canonical_name = 'handstand_push_up';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Strict Hspu"]'::jsonb) AS a
)
WHERE canonical_name = 'strict_hspu';
UPDATE public.movements
SET display_name = 'Strict HSPU',
    aliases = (SELECT COALESCE(jsonb_agg(a ORDER BY a), '[]'::jsonb) FROM jsonb_array_elements_text(aliases) AS a WHERE lower(a) <> lower('Strict HSPU'))
WHERE canonical_name = 'strict_hspu';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Deficit Hspu"]'::jsonb) AS a
)
WHERE canonical_name = 'deficit_hspu';
UPDATE public.movements
SET display_name = 'Deficit HSPU',
    aliases = (SELECT COALESCE(jsonb_agg(a ORDER BY a), '[]'::jsonb) FROM jsonb_array_elements_text(aliases) AS a WHERE lower(a) <> lower('Deficit HSPU'))
WHERE canonical_name = 'deficit_hspu';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Strict Deficit Handstand Push Up"]'::jsonb) AS a
)
WHERE canonical_name = 'strict_deficit_handstand_push_up';
UPDATE public.movements
SET display_name = 'Strict Deficit HSPU',
    aliases = (SELECT COALESCE(jsonb_agg(a ORDER BY a), '[]'::jsonb) FROM jsonb_array_elements_text(aliases) AS a WHERE lower(a) <> lower('Strict Deficit HSPU'))
WHERE canonical_name = 'strict_deficit_handstand_push_up';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Wall Facing Hspu"]'::jsonb) AS a
)
WHERE canonical_name = 'wall_facing_hspu';
UPDATE public.movements
SET display_name = 'Wall Facing HSPU',
    aliases = (SELECT COALESCE(jsonb_agg(a ORDER BY a), '[]'::jsonb) FROM jsonb_array_elements_text(aliases) AS a WHERE lower(a) <> lower('Wall Facing HSPU'))
WHERE canonical_name = 'wall_facing_hspu';
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Knee Raise"]'::jsonb) AS a
)
WHERE canonical_name = 'knee_raise';
UPDATE public.movements
SET display_name = 'Hanging Knee Raise',
    aliases = (SELECT COALESCE(jsonb_agg(a ORDER BY a), '[]'::jsonb) FROM jsonb_array_elements_text(aliases) AS a WHERE lower(a) <> lower('Hanging Knee Raise'))
WHERE canonical_name = 'knee_raise';

-- 4. Which blocks each movement belongs in.
ALTER TABLE public.movements ADD COLUMN IF NOT EXISTS blocks text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.movements.blocks IS
  'The training blocks this movement is offered for: warm-up, skills, strength, accessory, metcon. A guide shown to the AI that writes each block; nothing is checked against it.';
UPDATE public.movements m
SET blocks = v.blocks
FROM (VALUES
  ('air_squat', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('back_squat', ARRAY['accessory', 'metcon', 'strength']::text[]),
  ('bar_dip', ARRAY['accessory', 'skills', 'warm-up']::text[]),
  ('bar_facing_burpee', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('bar_muscle_up', ARRAY['metcon', 'skills']::text[]),
  ('barbell_row', ARRAY['accessory']::text[]),
  ('bench_press', ARRAY['accessory', 'metcon', 'strength']::text[]),
  ('bike', ARRAY['metcon', 'warm-up']::text[]),
  ('box_jump', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('box_jump_over', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('burpee', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('burpee_box_jump', ARRAY['skills', 'warm-up']::text[]),
  ('burpee_box_jump_over', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('burpee_muscle_up', ARRAY['skills']::text[]),
  ('burpee_pull_up', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('chest_to_bar', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('clean', ARRAY['metcon', 'strength']::text[]),
  ('clean_and_jerk', ARRAY['metcon', 'strength']::text[]),
  ('clean_pull', ARRAY['accessory']::text[]),
  ('crossover', ARRAY['skills', 'warm-up']::text[]),
  ('deadlift', ARRAY['metcon', 'strength']::text[]),
  ('deficit_hspu', ARRAY['skills']::text[]),
  ('deficit_push_up', ARRAY['accessory', 'skills', 'warm-up']::text[]),
  ('double_under', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('dumbbell_box_step_up', ARRAY['accessory', 'metcon']::text[]),
  ('dumbbell_clean', ARRAY['accessory']::text[]),
  ('dumbbell_deadlift', ARRAY['accessory']::text[]),
  ('dumbbell_front_squat', ARRAY['accessory']::text[]),
  ('dumbbell_ground_to_overhead', ARRAY['accessory']::text[]),
  ('dumbbell_hang_clean_and_jerk', ARRAY['accessory']::text[]),
  ('dumbbell_hang_clean_to_overhead', ARRAY['accessory']::text[]),
  ('dumbbell_hang_snatch', ARRAY['accessory']::text[]),
  ('dumbbell_push_press', ARRAY['accessory']::text[]),
  ('dumbbell_row', ARRAY['accessory']::text[]),
  ('dumbbell_shoulder_to_overhead', ARRAY['accessory']::text[]),
  ('dumbbell_snatch', ARRAY['accessory', 'metcon']::text[]),
  ('dumbbell_squat', ARRAY['accessory', 'metcon']::text[]),
  ('dumbbell_thruster', ARRAY['accessory', 'metcon']::text[]),
  ('dumbbell_walking_lunge', ARRAY['accessory', 'metcon']::text[]),
  ('farmer_carry', ARRAY['accessory', 'metcon']::text[]),
  ('front_rack_walking_lunge', ARRAY['accessory']::text[]),
  ('front_squat', ARRAY['accessory', 'metcon', 'strength']::text[]),
  ('ghd_sit_up', ARRAY['accessory', 'metcon', 'skills', 'warm-up']::text[]),
  ('goblet_squat', ARRAY['accessory', 'warm-up']::text[]),
  ('ground_to_overhead', ARRAY['metcon']::text[]),
  ('handstand_push_up', ARRAY['metcon', 'skills']::text[]),
  ('handstand_walk', ARRAY['metcon', 'skills']::text[]),
  ('hang_clean', ARRAY['metcon', 'strength']::text[]),
  ('hang_power_clean', ARRAY['metcon', 'strength']::text[]),
  ('hang_power_snatch', ARRAY['metcon', 'strength']::text[]),
  ('hang_snatch', ARRAY['strength']::text[]),
  ('hang_squat_clean', ARRAY['metcon', 'strength']::text[]),
  ('hang_squat_snatch', ARRAY['strength']::text[]),
  ('hip_clean', ARRAY['accessory', 'warm-up']::text[]),
  ('hollow_rock', ARRAY['accessory', 'skills', 'warm-up']::text[]),
  ('jerk', ARRAY['metcon', 'strength']::text[]),
  ('jumping_jack', ARRAY['accessory', 'skills', 'warm-up']::text[]),
  ('kettlebell_snatch', ARRAY['accessory', 'metcon']::text[]),
  ('kettlebell_swing', ARRAY['accessory', 'metcon', 'warm-up']::text[]),
  ('knee_raise', ARRAY['accessory', 'skills', 'warm-up']::text[]),
  ('l_sit', ARRAY['accessory', 'metcon', 'skills', 'warm-up']::text[]),
  ('lateral_burpee_over_dumbbell', ARRAY['accessory', 'skills', 'warm-up']::text[]),
  ('legless_rope_climb', ARRAY['metcon', 'skills']::text[]),
  ('muscle_clean', ARRAY['accessory', 'warm-up']::text[]),
  ('muscle_up', ARRAY['metcon', 'skills']::text[]),
  ('overhead_squat', ARRAY['metcon', 'strength']::text[]),
  ('overhead_walking_lunge', ARRAY['accessory', 'metcon']::text[]),
  ('pistol', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('plank', ARRAY['accessory', 'metcon', 'skills', 'warm-up']::text[]),
  ('power_clean', ARRAY['metcon', 'strength']::text[]),
  ('power_snatch', ARRAY['metcon', 'strength']::text[]),
  ('pull_up', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('push_jerk', ARRAY['metcon', 'strength']::text[]),
  ('push_press', ARRAY['metcon', 'strength']::text[]),
  ('push_up', ARRAY['accessory', 'metcon', 'skills', 'warm-up']::text[]),
  ('ring_dip', ARRAY['accessory', 'metcon', 'skills', 'warm-up']::text[]),
  ('ring_muscle_up', ARRAY['metcon', 'skills']::text[]),
  ('ring_row', ARRAY['accessory', 'skills', 'warm-up']::text[]),
  ('romanian_deadlift', ARRAY['accessory']::text[]),
  ('rope_climb', ARRAY['metcon', 'skills']::text[]),
  ('row', ARRAY['metcon', 'warm-up']::text[]),
  ('run', ARRAY['metcon', 'warm-up']::text[]),
  ('shoulder_to_overhead', ARRAY['metcon']::text[]),
  ('shuttle_run', ARRAY['warm-up']::text[]),
  ('single_under', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('sit_up', ARRAY['accessory', 'metcon', 'skills', 'warm-up']::text[]),
  ('ski_erg', ARRAY['warm-up']::text[]),
  ('snatch', ARRAY['metcon', 'strength']::text[]),
  ('snatch_balance', ARRAY['accessory', 'strength', 'warm-up']::text[]),
  ('snatch_pull', ARRAY['accessory']::text[]),
  ('split_clean', ARRAY['strength']::text[]),
  ('split_jerk', ARRAY['strength']::text[]),
  ('squat_clean', ARRAY['metcon']::text[]),
  ('squat_clean_and_jerk', ARRAY['strength']::text[]),
  ('squat_snatch', ARRAY['metcon']::text[]),
  ('strict_deficit_handstand_push_up', ARRAY['skills']::text[]),
  ('strict_hspu', ARRAY['metcon', 'skills']::text[]),
  ('strict_press', ARRAY['accessory', 'metcon', 'strength']::text[]),
  ('strict_pull_up', ARRAY['accessory', 'metcon', 'skills', 'warm-up']::text[]),
  ('strict_ring_dip', ARRAY['accessory', 'metcon', 'skills', 'warm-up']::text[]),
  ('sumo_deadlift', ARRAY['accessory', 'strength']::text[]),
  ('superman', ARRAY['accessory', 'skills', 'warm-up']::text[]),
  ('swim', ARRAY['metcon']::text[]),
  ('thruster', ARRAY['metcon']::text[]),
  ('toes_to_bar', ARRAY['metcon', 'skills', 'warm-up']::text[]),
  ('turkish_get_up', ARRAY['accessory', 'metcon', 'warm-up']::text[]),
  ('v_up', ARRAY['accessory', 'skills', 'warm-up']::text[]),
  ('walking_lunge', ARRAY['accessory', 'metcon', 'skills', 'warm-up']::text[]),
  ('wall_ball', ARRAY['accessory', 'metcon', 'warm-up']::text[]),
  ('wall_facing_hspu', ARRAY['skills']::text[]),
  ('wall_walk', ARRAY['metcon', 'skills', 'warm-up']::text[])
) AS v(canonical_name, blocks)
WHERE m.canonical_name = v.canonical_name;

-- 5. Programs already written: the rowing machine reads "Rowing". Exact name
--    only; "Easy Row" (warm-ups) and the strength rows are untouched.
UPDATE public.program_movements_v2 SET movement = 'Rowing' WHERE movement = 'Row';

NOTIFY pgrst, 'reload schema';
