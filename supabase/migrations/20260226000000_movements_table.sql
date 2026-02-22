-- Movements table: full library for recognition + competition-derived essential flag
-- Recognition: use all rows for movement extraction, modality classification, frequency
-- Essential (Not Programmed): filter by competition_count > 0 to show only competition-tested movements

CREATE TABLE IF NOT EXISTS movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  modality text NOT NULL CHECK (modality IN ('W', 'G', 'M')),
  category text NOT NULL CHECK (category IN ('Weightlifting', 'Gymnastics', 'Monostructural')),
  aliases jsonb NOT NULL DEFAULT '[]',
  competition_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movements_canonical ON movements (canonical_name);
CREATE INDEX IF NOT EXISTS idx_movements_competition_count ON movements (competition_count) WHERE competition_count > 0;

COMMENT ON TABLE movements IS 'CrossFit movements for recognition and essential-absence display. competition_count > 0 = appeared in Open/Quarterfinals/Regionals = flag if missing from program.';
