-- Coach Program Tool: Analysis and Modification tables

-- 1. program_analyses: computed analysis data for the dashboard
CREATE TABLE program_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  modal_balance jsonb NOT NULL DEFAULT '{}',
  time_domains jsonb NOT NULL DEFAULT '{}',
  workout_structure jsonb NOT NULL DEFAULT '{}',
  workout_formats jsonb NOT NULL DEFAULT '{}',
  movement_frequency jsonb NOT NULL DEFAULT '[]',
  notices jsonb NOT NULL DEFAULT '[]',
  not_programmed jsonb NOT NULL DEFAULT '{}',
  consecutive_overlaps jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(program_id)
);

CREATE INDEX idx_program_analyses_program_id ON program_analyses(program_id);

-- 2. program_modifications: tracks each incorporate batch
CREATE TABLE program_modifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  selected_movements jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewing', 'finalized', 'discarded')),
  modified_analysis jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_program_modifications_program_id ON program_modifications(program_id);

-- 3. modified_workouts: individual proposed changes
CREATE TABLE modified_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modification_id uuid NOT NULL REFERENCES program_modifications(id) ON DELETE CASCADE,
  original_workout_id uuid NOT NULL REFERENCES program_workouts(id) ON DELETE CASCADE,
  modified_text text NOT NULL,
  change_summary text,
  rationale text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX idx_modified_workouts_modification_id ON modified_workouts(modification_id);

-- RLS for program_analyses
ALTER TABLE program_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage analyses for own programs" ON program_analyses
  FOR ALL USING (
    EXISTS (SELECT 1 FROM programs WHERE programs.id = program_id AND programs.user_id = auth.uid())
  );

-- RLS for program_modifications
ALTER TABLE program_modifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage modifications for own programs" ON program_modifications
  FOR ALL USING (
    EXISTS (SELECT 1 FROM programs WHERE programs.id = program_id AND programs.user_id = auth.uid())
  );

-- RLS for modified_workouts (via program through modification)
ALTER TABLE modified_workouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage modified workouts for own programs" ON modified_workouts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM program_modifications pm
      JOIN programs p ON p.id = pm.program_id
      WHERE pm.id = modification_id AND p.user_id = auth.uid()
    )
  );

-- Trigger to keep updated_at current on program_analyses
CREATE OR REPLACE FUNCTION update_program_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER program_analyses_updated_at
  BEFORE UPDATE ON program_analyses
  FOR EACH ROW EXECUTE FUNCTION update_program_analyses_updated_at();

-- 4. finalize_program_modification: apply approved changes to program_workouts
CREATE OR REPLACE FUNCTION finalize_program_modification(p_modification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_program_id uuid;
BEGIN
  SELECT pm.program_id INTO v_program_id
  FROM program_modifications pm
  JOIN programs p ON p.id = pm.program_id
  WHERE pm.id = p_modification_id AND p.user_id = auth.uid();

  IF v_program_id IS NULL THEN
    RAISE EXCEPTION 'Modification not found or access denied';
  END IF;

  UPDATE program_workouts pw
  SET workout_text = mw.modified_text
  FROM modified_workouts mw
  WHERE mw.modification_id = p_modification_id
    AND mw.status = 'approved'
    AND mw.original_workout_id = pw.id;

  UPDATE program_modifications
  SET status = 'finalized'
  WHERE id = p_modification_id;
END;
$$;
