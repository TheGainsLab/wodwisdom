-- Remove default engine_program_version so new users see the program picker
-- instead of being silently assigned to main_5day.
ALTER TABLE athlete_profiles
  ALTER COLUMN engine_program_version DROP DEFAULT;

-- Set existing profiles that have engine_program_version = 'main_5day' but
-- no engine entitlement to NULL so they see the picker when they subscribe.
-- Users who have actively chosen main_5day will re-select it.
UPDATE athlete_profiles ap
  SET engine_program_version = NULL
  WHERE engine_program_version = 'main_5day'
    AND NOT EXISTS (
      SELECT 1 FROM user_entitlements ue
      WHERE ue.user_id = ap.user_id
        AND ue.feature = 'engine'
    );
