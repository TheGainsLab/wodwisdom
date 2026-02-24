-- Program workout blocks: normalized block-level data for querying (e.g. "show all strength blocks")
CREATE TABLE program_workout_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_workout_id uuid NOT NULL REFERENCES program_workouts(id) ON DELETE CASCADE,
  block_type text NOT NULL,
  block_order integer NOT NULL,
  block_text text NOT NULL
);

CREATE INDEX idx_program_workout_blocks_workout ON program_workout_blocks(program_workout_id);
CREATE INDEX idx_program_workout_blocks_type ON program_workout_blocks(block_type);

ALTER TABLE program_workout_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select blocks for own programs" ON program_workout_blocks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM program_workouts pw
      JOIN programs p ON p.id = pw.program_id
      WHERE pw.id = program_workout_blocks.program_workout_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert blocks for own programs" ON program_workout_blocks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM program_workouts pw
      JOIN programs p ON p.id = pw.program_id
      WHERE pw.id = program_workout_blocks.program_workout_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update blocks for own programs" ON program_workout_blocks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM program_workouts pw
      JOIN programs p ON p.id = pw.program_id
      WHERE pw.id = program_workout_blocks.program_workout_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete blocks for own programs" ON program_workout_blocks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM program_workouts pw
      JOIN programs p ON p.id = pw.program_id
      WHERE pw.id = program_workout_blocks.program_workout_id AND p.user_id = auth.uid()
    )
  );
