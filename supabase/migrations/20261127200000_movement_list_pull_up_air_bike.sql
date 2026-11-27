-- Movement list clean-up (founder, 2026-11-27).
--
-- 1. "Kipping Pull Up" is removed: a pull-up is written "Pull Up". Strict Pull
--    Up, Chest To Bar and Burpee Pull Up stay. The old name is kept as an
--    alternate spelling of Pull Up so workouts already written still resolve.
-- 2. The three bike rows (Bike, Assault Bike, Echo Bike) become one: "Air
--    Bike". The old names are kept as alternate spellings. All three held the
--    same work rate (350).
--
-- Workouts already written keep their text. Safe to run more than once.

-- aliases is jsonb (an array of strings).
UPDATE public.movements
SET aliases = (
  SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Kipping Pull Up", "Kipping Pull-Up"]'::jsonb) AS a
)
WHERE canonical_name = 'pull_up';

DELETE FROM public.movements WHERE canonical_name = 'kipping_pull_up';

UPDATE public.movements
SET display_name = 'Air Bike',
    aliases = (
      SELECT COALESCE(jsonb_agg(DISTINCT a ORDER BY a), '[]'::jsonb)
      FROM jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb) || '["Bike", "Biking", "Assault Bike", "Echo Bike"]'::jsonb) AS a
    )
WHERE canonical_name = 'bike';

DELETE FROM public.movements WHERE canonical_name IN ('assault_bike', 'echo_bike');

-- 3. Programs already written for members: the three old bike names become
--    "Air Bike" (founder, 2026-11-27). Exact names only; "Easy Bike" (warm-up
--    and cool-down) and "Bike Erg" (a different machine) are left as they are.
--    Only the movement name changes on these lines.
UPDATE public.program_movements_v2
SET movement = 'Air Bike'
WHERE movement IN ('Bike', 'Assault Bike', 'Echo Bike');
