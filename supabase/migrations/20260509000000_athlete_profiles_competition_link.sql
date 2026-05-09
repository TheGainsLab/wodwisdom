-- Add Tier 4 competition linkage columns to athlete_profiles.
--
-- Athletes optionally link their CrossFit Games competitor record so the
-- diagnostic can fetch their personal competition history bundle from the
-- competition-service Supabase project. Both columns are nullable; users
-- who don't link see no behavior change.
--
-- competition_athlete_id    : id from the other project's normalized_athletes
--                             table (e.g., "1731470").
-- competition_athlete_label : human-readable label captured at link time
--                             ("Connor Hynes"), surfaced in the profile UI.

ALTER TABLE public.athlete_profiles
  ADD COLUMN IF NOT EXISTS competition_athlete_id    text,
  ADD COLUMN IF NOT EXISTS competition_athlete_label text;

COMMENT ON COLUMN public.athlete_profiles.competition_athlete_id IS
  'CrossFit Games competitor_id linked by the athlete (Tier 4). NULL when unlinked. Used by fetchTier4Bundle to call the competition-service programming-profile endpoint.';

COMMENT ON COLUMN public.athlete_profiles.competition_athlete_label IS
  'Human-readable label for the linked competition record (name). Captured at link time so the UI can show what was linked without re-fetching.';
