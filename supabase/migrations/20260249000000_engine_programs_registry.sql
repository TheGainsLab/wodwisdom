-- Engine programs registry: authoritative list of available program variants.
-- Replaces hardcoded '5-day'/'3-day' strings with queryable metadata.

CREATE TABLE engine_programs (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  days_per_week integer NOT NULL,
  total_days integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE engine_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read programs" ON engine_programs FOR SELECT USING (true);

-- Seed the 4 existing variants
INSERT INTO engine_programs (id, name, description, days_per_week, total_days, sort_order) VALUES
  ('main_5day',        'Year of the Engine',              'The full 720-day program — 5 sessions per week across 36 months.',        5, 720, 1),
  ('main_3day',        'Year of the Engine (3-Day)',       'Same program quality at 3 sessions per week — 432 training days.',        3, 432, 2),
  ('main_5day_varied', 'Engine: Varied Order',             'All 720 days in a shuffled sequence for returning athletes. 5 per week.', 5, 720, 3),
  ('main_3day_varied', 'Engine: Varied Order (3-Day)',     '432 days in a shuffled sequence at 3 sessions per week.',                 3, 432, 4);

-- Migrate existing athlete_profiles from display labels to program IDs
UPDATE athlete_profiles SET engine_program_version = 'main_5day' WHERE engine_program_version = '5-day';
UPDATE athlete_profiles SET engine_program_version = 'main_3day' WHERE engine_program_version = '3-day';
