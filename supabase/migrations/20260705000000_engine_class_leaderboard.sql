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

-- pgcrypto provides digest() (TV-token hashing) + gen_random_uuid(). Supabase ships it
-- in the `extensions` schema; idempotent no-op if already present.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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

-- One index covers both the per-workout read (full key) and the program-wide read
-- (its (gym_id, cohort_program_id) prefix) — no separate prefix index (pure write cost).
CREATE INDEX IF NOT EXISTS idx_engine_class_results_workout
  ON public.engine_class_results (gym_id, cohort_program_id, week_num, day_num);

-- set_updated_at() is the shared trigger fn (repo convention).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_engine_class_results_updated_at ON public.engine_class_results;
CREATE TRIGGER trg_engine_class_results_updated_at
  BEFORE UPDATE ON public.engine_class_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: WRITES ARE SERVICE-ROLE ONLY. The sole writer is the engine-class-log edge
-- function (service role), which enforces the gate AND computes avg_power_watts via
-- the physics service. If members could INSERT/UPDATE directly (an own-row policy
-- constrains only user_id, NOT gym_id / cohort_program_id / avg_power_watts /
-- score_sort), any member could fabricate a top W·kg score or inject a row onto
-- ANOTHER gym's board — defeating the anti-cheat and tenant isolation. So no write
-- grant to authenticated. A member MAY read their own rows (harmless; a future
-- "your results" view). Cross-member leaderboard/TV/seam-1 reads run service-role in
-- the edge fns (privacy shaping + moderation ledger applied before output).
ALTER TABLE public.engine_class_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engine_class_results FROM anon, authenticated;
GRANT SELECT ON public.engine_class_results TO authenticated;

DROP POLICY IF EXISTS engine_class_results_select_own ON public.engine_class_results;
CREATE POLICY engine_class_results_select_own ON public.engine_class_results
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- No INSERT/UPDATE/DELETE policy: service_role (the edge fn) bypasses RLS and is the
-- only writer.

COMMENT ON TABLE public.engine_class_results IS
  'F4 leaderboard entries — one logged Engine Class result per (member, cohort workout). id = the moderation result_ref (affiliate keys its ledger on it). Score of record lives here (ONE PROFILE); W·kg derived read-time from athlete_profiles.bodyweight.';

-- =============================================================================
-- gym_tv_tokens — tokenized no-login access for the gym-wall TV. A token maps to a
-- gym; the /tv page + engine-class-tv edge fn resolve it (verify_jwt=false) and
-- return today's Rx + the rolling leaderboard. Revocable + expirable.
--
-- The token is stored only as a SHA-256 DIGEST (repo key discipline, per consumer-auth)
-- — a DB/backup leak yields digests, not working wall-URLs. The plaintext is returned
-- ONCE at mint time and never persisted; the edge fn looks up by digest.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.gym_tv_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        text NOT NULL,
  token_digest  text NOT NULL UNIQUE,     -- sha256(token) hex; the lookup key
  label         text,                     -- e.g. "Front desk TV"
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,              -- optional; past it the token is dead
  revoked_at    timestamptz               -- non-null = disabled
);

CREATE INDEX IF NOT EXISTS idx_gym_tv_tokens_gym ON public.gym_tv_tokens (gym_id);

-- Service-role only (the TV edge fn reads it; an admin / the portal mints via the fn
-- below). No anon/authenticated access — the token itself is the capability.
ALTER TABLE public.gym_tv_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gym_tv_tokens FROM anon, authenticated;

COMMENT ON TABLE public.gym_tv_tokens IS
  'Tokenized no-login access to a gym''s TV leaderboard (F4 TV mode). Stores sha256(token) only; plaintext returned once at mint. Service-role read only.';

-- Mint a TV token: generates a high-entropy secret, stores only its digest, and
-- RETURNS the plaintext ONCE. SECURITY DEFINER so an operator/portal calls it via RPC
-- (service-role) without direct table write. p_ttl_days null = no expiry.
CREATE OR REPLACE FUNCTION mint_gym_tv_token(p_gym_id text, p_label text DEFAULT NULL, p_ttl_days int DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_digest text := encode(digest(v_token, 'sha256'), 'hex');
BEGIN
  INSERT INTO public.gym_tv_tokens (gym_id, token_digest, label, expires_at)
  VALUES (p_gym_id, v_digest, p_label,
          CASE WHEN p_ttl_days IS NULL THEN NULL ELSE now() + make_interval(days => p_ttl_days) END);
  RETURN v_token; -- the ONLY time the plaintext exists; caller stores it in the URL
END;
$$;

REVOKE ALL ON FUNCTION mint_gym_tv_token(text, text, int) FROM anon, authenticated;
COMMENT ON FUNCTION mint_gym_tv_token(text, text, int) IS
  'Mint a gym TV token (F4). Returns the plaintext ONCE; stores only its sha256 digest. Service-role only.';

NOTIFY pgrst, 'reload schema';

COMMIT;
