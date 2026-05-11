-- Tier 4 / Competition History: cache the athlete's profile photo and best
-- finish at link time. Both come from the /athlete-search result the user
-- picked (the programming-profile bundle doesn't carry them), so we persist
-- them so the résumé card can render without a re-search on page load.
-- Both nullable; null for paste-ID-linked athletes (no search result).

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS competition_athlete_photo_url text,
  ADD COLUMN IF NOT EXISTS competition_athlete_best_finish text;
