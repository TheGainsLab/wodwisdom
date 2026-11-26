-- The standing read of an Engine member's conditioning (2026-11-26).
--
-- One AI-written assessment per member, stored and reused, so the chat coach
-- and the sequencer work from the same judgment and not from a fresh reading
-- of the raw numbers each time. Coach only: no member-facing screen reads it.
--
-- Rows are appended, never updated: the latest row for a member is the current
-- one, and the earlier ones are the history of how the read changed. `basis`
-- is what the read was written from (session count, latest time trial, goal,
-- program, reset marker); a new one is written when the basis has moved on:
-- five more sessions, a new time trial, a changed goal or program, a reset,
-- or new instructions (builder_version).
--
-- Service role only: row level security is on and there are no policies, so
-- a member cannot read or write it from the app.

CREATE TABLE IF NOT EXISTS public.engine_assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assessment      jsonb NOT NULL,
  basis           jsonb NOT NULL,
  builder_version text  NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engine_assessments_user_latest
  ON public.engine_assessments (user_id, created_at DESC);

ALTER TABLE public.engine_assessments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.engine_assessments FROM anon, authenticated;
GRANT ALL ON public.engine_assessments TO service_role;

COMMENT ON TABLE public.engine_assessments IS
  'AI-written standing read of an Engine member''s conditioning. Append-only; latest row per user is current. Service role only. See supabase/functions/_shared/engine-assessment.ts.';

NOTIFY pgrst, 'reload schema';
