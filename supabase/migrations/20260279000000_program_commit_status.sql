-- AI Log commit workflow: external programs start as drafts and are committed to My Programs
-- Repurpose is_ongoing as deprecated; add committed flag for draft/committed state

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS committed boolean DEFAULT true;

-- Existing programs are all committed (they were created before the draft concept)
UPDATE programs SET committed = true WHERE committed IS NULL;

-- New external programs from AI Log will be created with committed = false (draft)
-- and set to true when the user commits them

-- Index for filtering drafts vs committed programs
CREATE INDEX IF NOT EXISTS idx_programs_committed
  ON programs(user_id, committed);
