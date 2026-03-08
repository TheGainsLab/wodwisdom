-- Coaching guidelines: admin-managed rules the AI uses when generating programs.
-- Categories and guidelines are seeded incrementally over time.

CREATE TABLE coaching_guidelines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text NOT NULL
              CHECK (category IN (
                'movement','strength','progression','recovery',
                'scaling','metcon','skill','constraint','seasonal'
              )),
  scope       text NOT NULL DEFAULT 'all'
              CHECK (scope IN ('all','competition','beginner','gym-wide','individual')),
  scope_target text,
  guideline_text text NOT NULL,
  priority    integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Timestamp trigger
CREATE TRIGGER coaching_guidelines_updated_at
  BEFORE UPDATE ON coaching_guidelines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: readable by all authenticated users, no user-level writes (admin only via service key)
ALTER TABLE coaching_guidelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read guidelines"
  ON coaching_guidelines FOR SELECT
  USING (auth.role() = 'authenticated');

-- Indexes
CREATE INDEX idx_coaching_guidelines_category  ON coaching_guidelines (category);
CREATE INDEX idx_coaching_guidelines_active     ON coaching_guidelines (category, scope) WHERE is_active = true;
