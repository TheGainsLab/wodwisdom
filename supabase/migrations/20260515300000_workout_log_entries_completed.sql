-- Step 10 of the v3 UX roadmap: per-movement skip tracking.
--
-- Today an entry's presence in workout_log_entries implies "athlete did
-- this movement." That conflates two situations: (a) the athlete fully
-- completed the movement, and (b) the athlete left the prefilled row
-- alone and saved the block. Without a distinction, adherence dashboards
-- and carry-forward continuity (roadmap steps 21 + 27) can't tell apart
-- "I crushed every accessory rep" from "I bailed on Ring Dip but tapped
-- Save Block to move on."
--
-- New columns:
--   completed     — false only when the athlete explicitly skipped this
--                   movement. Defaults to true so existing rows + future
--                   rows-with-actuals stay marked completed.
--   skip_reason   — optional free-text or canned reason ("crowded gym",
--                   "shoulder twinge", "time", "substituted"). Only
--                   meaningful when completed = false.

ALTER TABLE workout_log_entries
  ADD COLUMN completed boolean NOT NULL DEFAULT true,
  ADD COLUMN skip_reason text;
