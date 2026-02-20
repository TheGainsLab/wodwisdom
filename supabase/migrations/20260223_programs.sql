-- Programs: multi-day/week program containers
CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Untitled Program',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_programs_user_id ON programs(user_id);

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own programs" ON programs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can select own programs" ON programs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own programs" ON programs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own programs" ON programs
  FOR DELETE USING (auth.uid() = user_id);

-- Program workouts: individual workout entries within a program
CREATE TABLE program_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_num integer NOT NULL DEFAULT 1,
  day_num integer NOT NULL DEFAULT 1,
  workout_text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_program_workouts_program_id ON program_workouts(program_id);

ALTER TABLE program_workouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert program workouts for own programs" ON program_workouts
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM programs WHERE programs.id = program_id AND programs.user_id = auth.uid())
  );

CREATE POLICY "Users can select program workouts for own programs" ON program_workouts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM programs WHERE programs.id = program_id AND programs.user_id = auth.uid())
  );

CREATE POLICY "Users can update program workouts for own programs" ON program_workouts
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM programs WHERE programs.id = program_id AND programs.user_id = auth.uid())
  );

CREATE POLICY "Users can delete program workouts for own programs" ON program_workouts
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM programs WHERE programs.id = program_id AND programs.user_id = auth.uid())
  );
