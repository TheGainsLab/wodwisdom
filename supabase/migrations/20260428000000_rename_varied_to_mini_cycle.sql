-- Rename "Engine: Varied Order" → "Engine: Mini Cycle" for the two
-- shuffled-sequence Engine variants. The underlying program IDs
-- (main_5day_varied, main_3day_varied) are unchanged — only the
-- display names users see in the program picker.

UPDATE engine_programs
SET name = 'Engine: Mini Cycle'
WHERE id = 'main_5day_varied';

UPDATE engine_programs
SET name = 'Engine: Mini Cycle (3-Day)'
WHERE id = 'main_3day_varied';
