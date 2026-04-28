-- Rename "Engine: Varied Order" → "Engine Mini Cycle" for the two
-- shuffled-sequence Engine variants. The underlying program IDs
-- (main_5day_varied, main_3day_varied) are unchanged — only the
-- display names users see in the program picker.
--
-- Drops the colon to match the marketing page (EngineFeaturePage.tsx),
-- which already uses the no-colon form.

UPDATE engine_programs
SET name = 'Engine Mini Cycle'
WHERE id = 'main_5day_varied';

UPDATE engine_programs
SET name = 'Engine Mini Cycle (3-Day)'
WHERE id = 'main_3day_varied';

-- Rename "VO2 Max (3-Day)" → "VO3 (3-Day)" in the program picker so
-- the DB matches the marketing page (which already calls it VO3).
UPDATE engine_programs
SET name = 'VO3 (3-Day)'
WHERE id = 'vo2max_3day';
