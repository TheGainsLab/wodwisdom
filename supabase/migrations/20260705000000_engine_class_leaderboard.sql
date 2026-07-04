-- F4 — Gym Engine Class leaderboard + TV (wodwisdom side).
-- GYM_PORTAL_FLOWS §F4 / GYM_SKU_SPEC §1. wodwisdom owns the logged-score ENTRIES
-- (the score of record — ONE PROFILE keeps data single-homed); the affiliate owns
-- the moderation DECISIONS (flag/hide/adjust) and reads these entries via the seam-1
-- endpoint. Divisions are gender (from athlete_profiles, read-time) + modality
-- (per-workout). W·kg normalization divides log-time watts by the profile's LIVE
-- bodyweight at read time (ONE PROFILE corollary a) — so nothing here caches
-- bodyweight as a second write target.
--
-- Additive + idempotent + SQL-editor-ready. Two new relations -> reload PostgREST.

BEGIN;

-- =============================================================================
-- engine_class_results — one logged Engine Class result per (member, cohort
-- workout). The leaderboard ENTRY; its id is the opaque `result_ref` the affiliate
-- moderation ledger keys on. The score of record lives HERE (ONE PROFILE).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.engine_class_results (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- = result_ref
  gym_id            text NOT NULL,                                -- community/tenant id
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The cohort program + workout position the result is for (the shared "path").
  cohort_program_id uuid NOT NULL REFERENCES public.engine_cohort_programs(id) ON DELETE CASCADE,
  week_num          int  NOT NULL,
  day_num           int  NOT NULL,
  workout_date      date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  -- Divisions axis: the workout's modality (row/bike/run/mixed/…); gender comes
  -- from athlete_profiles at read time (ONE PROFILE). Snapshotted here because it
  -- is a property of the WORKOUT, not the athlete.
  modality          text,
  score_type        text NOT NULL CHECK (score_type IN ('for_time','amrap','load','reps','rounds_reps','other')),
  -- What to render. score_sort = a single "higher is better" ranking value (for_time
  -- stores negative seconds) so the RAW board orders by one column regardless of type.
  score_display     text NOT NULL,
  score_sort        numeric,
  rx                boolean NOT NULL DEFAULT true,
  -- Physics (data-service work-calc), computed at LOG time. w_per_kg is NOT stored —
  -- the leaderboard derives it read-time = avg_power_watts / live bodyweight.
  avg_power_watts   numeric,
  total_joules      numeric,
  body_mass_kg      numeric,            -- the mass used at log time (audit)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- One result per member per workout (a re-log updates it).
  UNIQUE (gym_id, user_id, cohort_program_id, week_num, day_num)
);

CREATE INDEX IF NOT EXISTS idx_engine_class_results_workout
  ON public.engine_class_results (gym_id, cohort_program_id, week_num, day_num);
CREATE INDEX IF NOT EXISTS idx_engine_class_results_program
  ON public.engine_class_results (gym_id, cohort_program_id);

-- set_updated_at() is the shared trigger fn (repo convention).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_engine_class_results_updated_at ON public.engine_class_results;
CREATE TRIGGER trg_engine_class_results_updated_at
  BEFORE UPDATE ON public.engine_class_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: a member reads/writes only their OWN results (drives "your results" in the
-- PWA). The cross-member leaderboard + TV + seam-1 reads run service-role in edge
-- functions (they apply privacy shaping + the moderation ledger before output).
ALTER TABLE public.engine_class_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engine_class_results FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.engine_class_results TO authenticated;

DROP POLICY IF EXISTS engine_class_results_select_own ON public.engine_class_results;
CREATE POLICY engine_class_results_select_own ON public.engine_class_results
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS engine_class_results_insert_own ON public.engine_class_results;
CREATE POLICY engine_class_results_insert_own ON public.engine_class_results
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS engine_class_results_update_own ON public.engine_class_results;
CREATE POLICY engine_class_results_update_own ON public.engine_class_results
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

COMMENT ON TABLE public.engine_class_results IS
  'F4 leaderboard entries — one logged Engine Class result per (member, cohort workout). id = the moderation result_ref (affiliate keys its ledger on it). Score of record lives here (ONE PROFILE); W·kg derived read-time from athlete_profiles.bodyweight.';

-- =============================================================================
-- gym_tv_tokens — tokenized no-login access for the gym-wall TV. A token maps to a
-- gym; the /tv page + engine-class-tv edge fn resolve it (verify_jwt=false) and
-- return today's Rx + the rolling leaderboard. Revocable.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.gym_tv_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      text NOT NULL,
  token       text NOT NULL UNIQUE,     -- high-entropy; the URL secret
  label       text,                     -- e.g. "Front desk TV"
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz               -- non-null = disabled
);

CREATE INDEX IF NOT EXISTS idx_gym_tv_tokens_gym ON public.gym_tv_tokens (gym_id);

-- Service-role only (the TV edge fn reads it; the affiliate portal / an admin mints
-- tokens). No anon/authenticated access — the token itself is the capability.
ALTER TABLE public.gym_tv_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gym_tv_tokens FROM anon, authenticated;

COMMENT ON TABLE public.gym_tv_tokens IS
  'Tokenized no-login access to a gym''s TV leaderboard (F4 TV mode). token = the URL capability; service-role read only.';

NOTIFY pgrst, 'reload schema';

COMMIT;
