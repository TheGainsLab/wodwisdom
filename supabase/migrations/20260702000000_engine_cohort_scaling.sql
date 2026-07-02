-- Engine cohort scaling persistence (Phase 1).
--
-- Cohort mode (GYM_SKU_SPEC §1, GYM_PORTAL_FLOWS F2/F3) generates ONE shared class
-- program and scales it per member. Those per-member scalings must be QUERYABLE,
-- not just rendered artifacts — they are the raw material for the member
-- intelligence feed (F10: PR feed, stall detection, quiet-member alerts), which
-- joins them to what each member actually logged. This schema lands that now; the
-- feed itself builds in Phase 2b.
--
-- These are ENGINE-OWNED tables (the Engine's own state — distinct from wodwisdom's
-- program tables, which the Engine never writes). Written by the service role
-- (engine-generate); RLS on with no policies denies anon/authenticated direct
-- access (service_role bypasses RLS). A future Engine service would relocate these
-- to its own database; for Phase 1 they live in the wodwisdom project.
--
-- Idempotent; apply via the Supabase SQL editor. No PostgREST schema reload needed
-- (new tables, no function-signature changes).

BEGIN;

-- The shared class program a cohort ran.
CREATE TABLE IF NOT EXISTS public.engine_cohort_programs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  domain_pack   text NOT NULL,
  -- The shared audited WriterOutput + its skeleton (the "path" everyone runs).
  shared_output jsonb NOT NULL,
  skeleton      jsonb,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engine_cohort_programs_tenant
  ON public.engine_cohort_programs (tenant_id, created_at DESC);

-- One row per (cohort program, member) — the member's deterministic scaling.
CREATE TABLE IF NOT EXISTS public.engine_member_scaling (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_program_id     uuid NOT NULL REFERENCES public.engine_cohort_programs(id) ON DELETE CASCADE,
  tenant_id             text NOT NULL,
  -- Opaque member id (wodwisdom user id / gym member id). The join key to
  -- workout_logs for the F10 "linkage to logged results".
  athlete_ref           text NOT NULL,
  weight_unit           text NOT NULL,
  tier                  text,
  substitutions_pending int NOT NULL DEFAULT 0,
  -- The ScaledMovement[] — per-movement resolved_weight / basis_lift /
  -- needs_substitution. jsonb so the feed can query per movement/pattern.
  scaled_movements      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort_program_id, athlete_ref)
);

CREATE INDEX IF NOT EXISTS idx_engine_member_scaling_program
  ON public.engine_member_scaling (cohort_program_id);
CREATE INDEX IF NOT EXISTS idx_engine_member_scaling_athlete
  ON public.engine_member_scaling (tenant_id, athlete_ref, created_at DESC);

COMMENT ON TABLE public.engine_member_scaling IS
  'Per-member cohort scaling (Engine-owned). athlete_ref joins to workout_logs for '
  'the F10 member intelligence feed. Deterministic scaling core; needs_substitution '
  'flags the only AI-touched movements.';

-- Lock down: Engine-owned, service-role only.
ALTER TABLE public.engine_cohort_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_member_scaling  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engine_cohort_programs FROM anon, authenticated;
REVOKE ALL ON public.engine_member_scaling  FROM anon, authenticated;

COMMIT;
