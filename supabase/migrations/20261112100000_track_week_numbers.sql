-- Week numbers for every program mapping that lacks them (Mini Cycle ×2,
-- VO2 ×2, Hyrox ×2). Founder, 2026-11-12: an athlete in month 3, week 2
-- who switches to a track should stay in month 3, week 2. The cadence
-- switch (engine-switch.ts) translates by week_number, so every track needs
-- them: four weeks a month at the program's own days_per_week, numbered
-- through the program (month m = weeks 4m-3..4m). Idempotent: only rows
-- with a NULL week_number are touched. A 12-month track has weeks 1..48; a
-- switch from a main program's month 13+ lands on the track's last day.
WITH numbered AS (
  SELECT m.id,
         (m.month - 1) * 4
           + ((row_number() OVER (PARTITION BY m.engine_program_id, m.month ORDER BY m.program_sequence_order) - 1)
              / p.days_per_week + 1) AS wk
  FROM engine_program_mapping m
  JOIN engine_programs p ON p.id = m.engine_program_id
  WHERE m.week_number IS NULL
)
UPDATE engine_program_mapping m
SET week_number = n.wk
FROM numbered n
WHERE m.id = n.id;
