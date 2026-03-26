-- AI Log feature: external program support, subscription gating, and source tracking

-- 1. Add source tracking to programs table
--    'generated' = created by our AI, 'uploaded' = user uploaded for our system, 'external' = gym programming for AI Log
ALTER TABLE programs
  ADD COLUMN source text NOT NULL DEFAULT 'generated'
    CHECK (source IN ('generated', 'uploaded', 'external'));

-- External program metadata (gym name, ongoing vs one-time)
ALTER TABLE programs
  ADD COLUMN gym_name text,
  ADD COLUMN is_ongoing boolean NOT NULL DEFAULT false;

-- 2. Re-add source_type to workout_logs (was dropped in 20260235 migration)
ALTER TABLE workout_logs
  ADD COLUMN source_type text NOT NULL DEFAULT 'program'
    CHECK (source_type IN ('review', 'program', 'manual', 'external'));

-- 3. Gating: AI Log access uses the existing user_entitlements table
--    with feature = 'ailog' (same pattern as 'engine')
--    No schema change needed — just insert entitlements for users who purchase AI Log

-- 4. Index for querying external programs efficiently
CREATE INDEX idx_programs_source ON programs(source) WHERE source = 'external';
CREATE INDEX idx_programs_user_source ON programs(user_id, source);
