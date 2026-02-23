-- Add type column to profile_evaluations to distinguish analysis types
ALTER TABLE profile_evaluations
  ADD COLUMN type text NOT NULL DEFAULT 'full';

-- Update index to include type for efficient per-type queries
CREATE INDEX idx_profile_evaluations_user_type ON profile_evaluations(user_id, type, created_at DESC);
