-- ai_edit_log — one row per successful AI Edit *propose* on a v3 block.
--
-- This single table does triple duty:
--   1. LOCK   — a row's existence for a block_id means AI Edit has been used
--               on that block. AI Edit is one-shot per block (the athlete
--               uses Coach + manual edit as the safety valves for more).
--   2. METER  — rows are the usage record for AI Edit's separate budget.
--   3. PROVENANCE — `original` + `proposal` capture the full before/after of
--               every athlete-requested change, feeding the generator's
--               learning loop ("athletes always lighten Day 4").
--
-- Written by the adjust-workout edge fn on a SUCCESSFUL propose (a failed
-- LLM call writes nothing, so it doesn't burn the block's one shot). The
-- client updates `outcome` when the athlete accepts or refuses the diff.

CREATE TABLE IF NOT EXISTS ai_edit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES program_blocks_v2(id) ON DELETE CASCADE,
  request text NOT NULL,                 -- the athlete's natural-language ask
  original jsonb,                        -- block before the edit (BlockPrescription)
  proposal jsonb NOT NULL,               -- proposed block (BlockPrescription)
  outcome text CHECK (outcome IN ('accepted', 'refused')),  -- null until resolved
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_edit_log_block ON ai_edit_log(block_id);
CREATE INDEX IF NOT EXISTS idx_ai_edit_log_user ON ai_edit_log(user_id, created_at);

ALTER TABLE ai_edit_log ENABLE ROW LEVEL SECURITY;

-- Users can read/insert/update their own rows. (The edge fn inserts via the
-- service role; the client reads rows to know which blocks are locked and
-- updates `outcome` on accept/refuse.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_edit_log' AND policyname = 'Users select own ai_edit_log') THEN
    CREATE POLICY "Users select own ai_edit_log" ON ai_edit_log
      FOR SELECT USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_edit_log' AND policyname = 'Users insert own ai_edit_log') THEN
    CREATE POLICY "Users insert own ai_edit_log" ON ai_edit_log
      FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_edit_log' AND policyname = 'Users update own ai_edit_log') THEN
    CREATE POLICY "Users update own ai_edit_log" ON ai_edit_log
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
END;
$$;
