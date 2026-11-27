-- Main site metcons, cleaned once, for the metcon composer (2026-11-27).
--
-- The library (chunks, category 'mainsite') holds every CrossFit main site
-- workout from 2001 to 2025. The composer is shown real ones as examples of
-- what a well-written workout looks like. It needs the workout and its name,
-- not the comment prompts, links, scaling, notes and tributes the page carried.
--
-- One row per main site metcon (For Time, AMRAP, Tabata, EMOM), holding the
-- cleaned text. The original chunk is never changed. Filled once by the
-- clean-mainsite-examples function (rules in _shared/mainsite-clean.ts);
-- re-running it replaces the cleaned text from the same originals.
--
-- Service role only: row level security is on and there are no policies.

CREATE TABLE IF NOT EXISTS public.mainsite_examples (
  chunk_id     text PRIMARY KEY REFERENCES public.chunks(id) ON DELETE CASCADE,
  workout_date date,
  kind         text NOT NULL,
  name         text,
  text         text NOT NULL,
  cleaned_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mainsite_examples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mainsite_examples FROM anon, authenticated;
GRANT ALL ON public.mainsite_examples TO service_role;

COMMENT ON TABLE public.mainsite_examples IS
  'Main site metcons cleaned to the workout itself, shown to the metcon composer as examples. One row per chunks row of category mainsite that is a metcon. Service role only.';

-- A fresh random draw for each build. 3,800 rows: a random sort is cheap.
CREATE OR REPLACE FUNCTION public.sample_mainsite_examples(n integer DEFAULT 100)
RETURNS TABLE (workout_date date, kind text, name text, text text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.workout_date, e.kind, e.name, e.text
  FROM public.mainsite_examples e
  ORDER BY random()
  LIMIT GREATEST(1, LEAST(COALESCE(n, 100), 300));
$$;

REVOKE ALL ON FUNCTION public.sample_mainsite_examples(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_mainsite_examples(integer) TO service_role;

NOTIFY pgrst, 'reload schema';
