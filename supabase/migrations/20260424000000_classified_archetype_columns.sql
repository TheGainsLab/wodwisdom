-- Shadow classifier output columns on program_workouts.
--
-- When a program is generated, classify-day-type is run over each day
-- in the output. The returned label and confidence are persisted here
-- so we can query classifier accuracy against the requested day_type
-- without re-running the classifier or scraping logs.
--
--   day_type               — requested archetype (Phase 2a)
--   classified_archetype   — what the classifier said the day actually is
--   classified_confidence  — 0.00 to 1.00
--
-- Accuracy query: WHERE classified_archetype IS NOT NULL AND
--                       classified_archetype != day_type
-- tells us exactly where the generator drifted from spec.

ALTER TABLE program_workouts
  ADD COLUMN IF NOT EXISTS classified_archetype text,
  ADD COLUMN IF NOT EXISTS classified_confidence numeric(3,2);
