-- main_4day mapping rows were created without week_number (20261110100000).
-- Week numbers run through the program (month m = weeks 4m-3..4m, four
-- positions a week), and the cadence switch (engine-switch.ts) lands an
-- athlete by week — so the 4-day program needs them like the 3- and 5-day.
WITH numbered AS (
  SELECT id,
         (month - 1) * 4 + ((row_number() OVER (PARTITION BY month ORDER BY program_sequence_order) - 1) / 4 + 1) AS wk
  FROM engine_program_mapping
  WHERE engine_program_id = 'main_4day'
)
UPDATE engine_program_mapping m
SET week_number = n.wk
FROM numbered n
WHERE m.id = n.id AND m.week_number IS NULL;
