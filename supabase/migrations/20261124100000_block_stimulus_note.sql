-- program_blocks_v2.stimulus_note (2026-11-24).
--
-- When a conditioning piece is composed, the AI writes a short note saying
-- what the piece is for and how to pace it ("Sustained aerobic cruise — pick
-- a pace on round 1 you can repeat in round 3"). It was saved into
-- block_notes, which the app deliberately never shows because that column
-- also holds the writer's internal working. So the one sentence written FOR
-- the athlete was hidden from them.
--
--   stimulus_note   the piece's purpose and pacing, shown under the metcon
--     on the day page and the program page. Set only for composed metcons.
--
-- Nullable, no default, no data rewrite: blocks written before this stay as
-- they are and show no note. Safe to run twice.

ALTER TABLE program_blocks_v2
  ADD COLUMN IF NOT EXISTS stimulus_note text;

COMMENT ON COLUMN program_blocks_v2.stimulus_note IS
  'A composed metcon''s purpose and pacing, written for the athlete and shown under the piece. NULL on blocks written before 2026-11-24 and on blocks that are not composed metcons.';
