-- Engine conditioning program tables
-- Supports the 720-day "Year of the Engine" structured conditioning program

-- 1. engine_day_types: workout type definitions (22 types)
CREATE TABLE engine_day_types (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  phase_requirement integer NOT NULL DEFAULT 1,
  block_count integer NOT NULL DEFAULT 1,
  set_rest_seconds integer,
  block_1_params jsonb,
  block_2_params jsonb,
  block_3_params jsonb,
  block_4_params jsonb,
  max_duration_minutes integer,
  is_support_day boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. engine_workouts: the 720 training days
CREATE TABLE engine_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_type text NOT NULL DEFAULT 'main_5day',
  day_number integer NOT NULL,
  day_type text NOT NULL REFERENCES engine_day_types(id),
  phase integer NOT NULL,
  block_count integer,
  set_rest_seconds integer,
  block_1_params jsonb,
  block_2_params jsonb,
  block_3_params jsonb,
  block_4_params jsonb,
  total_duration_minutes integer,
  base_intensity_percent numeric,
  month integer,
  avg_work_rest_ratio numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(program_type, day_number)
);

CREATE INDEX idx_engine_workouts_day_number ON engine_workouts(day_number);
CREATE INDEX idx_engine_workouts_phase ON engine_workouts(phase);
CREATE INDEX idx_engine_workouts_month ON engine_workouts(month);
CREATE INDEX idx_engine_workouts_day_type ON engine_workouts(day_type);

-- 3. engine_program_mapping: maps 5-day program to 3-day (and other variants)
CREATE TABLE engine_program_mapping (
  id serial PRIMARY KEY,
  engine_program_id text NOT NULL,
  engine_workout_day_number integer NOT NULL,
  program_sequence_order integer NOT NULL,
  week_number integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_engine_program_mapping_program ON engine_program_mapping(engine_program_id);
CREATE INDEX idx_engine_program_mapping_sequence ON engine_program_mapping(program_sequence_order);

-- 4. engine_time_trials: user baseline measurements per modality
CREATE TABLE engine_time_trials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modality text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  total_output numeric NOT NULL,
  calculated_rpm numeric,
  units text,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_engine_time_trials_user ON engine_time_trials(user_id);
CREATE INDEX idx_engine_time_trials_modality ON engine_time_trials(user_id, modality);

ALTER TABLE engine_time_trials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own time trials" ON engine_time_trials
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own time trials" ON engine_time_trials
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own time trials" ON engine_time_trials
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own time trials" ON engine_time_trials
  FOR DELETE USING (auth.uid() = user_id);

-- 5. engine_workout_sessions: user completed engine workouts
CREATE TABLE engine_workout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  program_day integer,
  program_day_number integer,
  day_type text,
  modality text,
  units text,
  target_pace numeric,
  actual_pace numeric,
  total_output numeric,
  performance_ratio numeric,
  calculated_rpm numeric,
  average_heart_rate integer,
  peak_heart_rate integer,
  perceived_exertion integer,
  workout_data jsonb,
  completed boolean NOT NULL DEFAULT true,
  program_version text DEFAULT '5-day',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_engine_sessions_user ON engine_workout_sessions(user_id);
CREATE INDEX idx_engine_sessions_date ON engine_workout_sessions(user_id, date);
CREATE INDEX idx_engine_sessions_day ON engine_workout_sessions(user_id, program_day_number);

ALTER TABLE engine_workout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own sessions" ON engine_workout_sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions" ON engine_workout_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON engine_workout_sessions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON engine_workout_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- 6. engine_user_modality_preferences: unit preferences per equipment
CREATE TABLE engine_user_modality_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modality text NOT NULL,
  primary_unit text,
  secondary_unit text,
  UNIQUE(user_id, modality)
);

ALTER TABLE engine_user_modality_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own preferences" ON engine_user_modality_preferences
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own preferences" ON engine_user_modality_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own preferences" ON engine_user_modality_preferences
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own preferences" ON engine_user_modality_preferences
  FOR DELETE USING (auth.uid() = user_id);

-- 7. engine_user_performance_metrics: rolling averages for pacing
CREATE TABLE engine_user_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_type text NOT NULL,
  modality text NOT NULL,
  learned_max_pace numeric,
  rolling_avg_ratio numeric,
  rolling_count integer NOT NULL DEFAULT 0,
  last_4_ratios jsonb NOT NULL DEFAULT '[]',
  UNIQUE(user_id, day_type, modality)
);

ALTER TABLE engine_user_performance_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own metrics" ON engine_user_performance_metrics
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own metrics" ON engine_user_performance_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own metrics" ON engine_user_performance_metrics
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own metrics" ON engine_user_performance_metrics
  FOR DELETE USING (auth.uid() = user_id);
