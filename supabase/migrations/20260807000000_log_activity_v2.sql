-- Log Activity v2 — block-aligned taxonomy + per-type parse fields + images.
--
-- The intake taxonomy now mirrors how athletes think about work (and how the
-- app's program blocks are named): conditioning / metcon / strength / skills /
-- other. The parser extracts a type-appropriate contract per category, and the
-- query-critical results land in typed columns here (same interpret-once
-- principle as v1: the athlete confirms structure at entry; every consumer
-- reads plain SQL, nobody re-interprets).
--
-- "engine" is deliberately NOT a workout_type: Engine is a program, not a kind
-- of work. An Engine athlete's extra erg session is conditioning — it feeds
-- the calendar, the coach, and the AI sequencer's other-load fingerprint, and
-- NEVER touches Engine pacing/advancement (standing wall).
--
-- Multi-movement structure (metcon movement lists etc.) intentionally stays in
-- the `parsed` JSONB — promoting it to workout_log_entries-grade modeling is
-- the parked AI Logger convergence, not this migration.

ALTER TABLE athlete_activities
  -- Block-aligned category. NULL on pre-v2 rows (consumers treat as before).
  ADD COLUMN IF NOT EXISTS workout_type text
    CHECK (workout_type IS NULL OR workout_type IN ('conditioning', 'metcon', 'strength', 'skills', 'other')),
  -- Conditioning: erg calories are the native unit for bike/row/ski work.
  ADD COLUMN IF NOT EXISTS calories numeric
    CHECK (calories IS NULL OR (calories > 0 AND calories < 100000)),
  -- Metcon: the result AS a result ("4:13", "12+7") — never smuggled into
  -- duration. Free text because score formats vary by workout shape.
  ADD COLUMN IF NOT EXISTS score text,
  -- Strength / skills: the flat single-movement case ("5x8 pull-ups",
  -- "3x12 curls @ 25 lb"). Multi-movement work stays in `parsed`.
  ADD COLUMN IF NOT EXISTS movement text,
  ADD COLUMN IF NOT EXISTS sets integer
    CHECK (sets IS NULL OR (sets > 0 AND sets <= 50)),
  ADD COLUMN IF NOT EXISTS reps integer
    CHECK (reps IS NULL OR (reps > 0 AND reps <= 1000)),
  ADD COLUMN IF NOT EXISTS weight numeric
    CHECK (weight IS NULL OR (weight > 0 AND weight < 2000)),
  ADD COLUMN IF NOT EXISTS weight_unit text
    CHECK (weight_unit IS NULL OR weight_unit IN ('lbs', 'kg')),
  -- Screenshot provenance: storage path in the activity-images bucket.
  -- The image is the true source for photo-born logs (raw_text then holds the
  -- athlete's caption and/or the AI summary).
  ADD COLUMN IF NOT EXISTS image_path text;

COMMENT ON COLUMN athlete_activities.workout_type IS
  'Block-aligned category (conditioning|metcon|strength|skills|other). AI pre-selects, athlete confirms. NULL = pre-v2 row.';
COMMENT ON COLUMN athlete_activities.score IS
  'Metcon result as a result ("4:13", "12+7") — never stored as duration.';

-- ── Private bucket for activity screenshots ─────────────────────────────
-- Owner-only via path prefix: every object key starts with the uploader's
-- user id (enforced below), so RLS is a prefix check.

INSERT INTO storage.buckets (id, name, public)
VALUES ('activity-images', 'activity-images', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "activity images: owner read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'activity-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "activity images: owner insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'activity-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "activity images: owner delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'activity-images' AND (storage.foldername(name))[1] = auth.uid()::text);
