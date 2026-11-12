-- "Tell your coach" notes (founder, 2026-11-12): the low-friction lever for
-- what an athlete wants more or less of, without touching the profile.
-- Written on the program page (per week) or saved from a Coach card. Read
-- by the Engine sequencer, AI Programming generation, and the Coach.
--
-- Horizon: 'next_week' (default) — consumed by the next generation of each
-- product that reads it, and expires anyway after 21 days; 'until_removed'
-- — stays until the athlete deletes it. A standing preference belongs in the
-- profile goal; the Coach offers that promotion when a note recurs.
CREATE TABLE IF NOT EXISTS coach_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  horizon text NOT NULL DEFAULT 'next_week' CHECK (horizon IN ('next_week', 'until_removed')),
  -- Where it was written: the program and week the athlete was looking at
  -- (null when saved from the Coach or the top-of-page list).
  program_id uuid NULL,
  week_num integer NULL,
  source text NOT NULL DEFAULT 'program_page' CHECK (source IN ('program_page', 'coach')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  -- Per-product consumption: a 'next_week' note is spent once each product
  -- has written something with it in view.
  consumed_engine_at timestamptz NULL,
  consumed_programming_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_notes_user_created ON coach_notes(user_id, created_at DESC);

ALTER TABLE coach_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notes select" ON coach_notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own notes insert" ON coach_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own notes update" ON coach_notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own notes delete" ON coach_notes FOR DELETE USING (auth.uid() = user_id);
