-- Enrich competition_workout_results with catalog metadata captured at log time.
--
-- A logged Try-It stores only competition_workout_id + score + placement + power.
-- To feed the evaluator/generator the way IMPORTED competition history does, the
-- result needs the workout's identity (name / movements / time-domain). That
-- metadata lives only in the external competition catalog, so log-throwback —
-- which already fetches GET /workouts/{id} — now also captures it onto the row.
-- build-writer-payload then reads enriched rows; no catalog fetch in the
-- eval/generation hot path (Option A: enrich at write).
--
-- All nullable / best-effort: a row still saves if the catalog lookup fails.

ALTER TABLE competition_workout_results
  ADD COLUMN IF NOT EXISTS workout_name text,
  ADD COLUMN IF NOT EXISTS movements text[],
  ADD COLUMN IF NOT EXISTS time_domain text,
  ADD COLUMN IF NOT EXISTS classification text;
