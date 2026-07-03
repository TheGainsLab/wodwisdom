-- Task #5 — gym cohort program wiring (wodwisdom side).
-- Per-gym cohort config the regeneration cron rebuilds the shared Engine Class
-- program from. Populated by the affiliate portal when a class goes LIVE (the
-- affiliate-team half, via a consumer-keyed endpoint); the cron reads it.
--
-- Internal config: service_role only (no authenticated policies). Additive +
-- idempotent + SQL-editor-ready. One new relation -> reload PostgREST schema.

BEGIN;

CREATE TABLE IF NOT EXISTS gym_cohort_configs (
  -- The gym's tenant id (affiliate community id) — the cohort program's tenant.
  gym_id text PRIMARY KEY,
  domain_pack text NOT NULL DEFAULT 'crossfit@3',
  days_per_week int NOT NULL DEFAULT 5 CHECK (days_per_week BETWEEN 3 AND 6),
  session_length_minutes int,
  -- Canonical equipment keys the gym floor has (tier-status.ALL_EQUIPMENT_KEYS).
  equipment text[] NOT NULL DEFAULT '{}',
  target_level text NOT NULL DEFAULT 'intermediate'
    CHECK (target_level IN ('beginner', 'intermediate', 'advanced')),
  do_not_program text[] NOT NULL DEFAULT '{}',
  units text NOT NULL DEFAULT 'lbs' CHECK (units IN ('lbs', 'kg')),
  goal_text text,
  active boolean NOT NULL DEFAULT true,
  -- Drives the per-gym regeneration cadence (regenerate when null or 30d+ old).
  last_generated_at timestamptz,
  -- Poison-gym backoff + claim (task #5 review). last_attempt_at is the in-flight
  -- claim marker (set atomically by claim_due_gym_cohort before the ~200s LLM run,
  -- so a concurrent invocation can't grab the same gym); attempt_count + next_attempt_at
  -- rotate a persistently-failing gym to the back of the queue instead of starving
  -- the fleet head-of-line every tick.
  last_attempt_at timestamptz,
  attempt_count int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent add for envs where the table predates the backoff columns.
ALTER TABLE gym_cohort_configs ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE gym_cohort_configs ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0;
ALTER TABLE gym_cohort_configs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

-- domain_pack must be well-formed ("<sport>@<version>", e.g. crossfit@3) so a typo
-- like 'crossfit@4x' can't be written and then throw getDomainPack every run. The
-- REGISTERED-pack check stays in code (registry.getDomainPack, which the cron runs
-- after claim); the backoff columns above rotate an unregistered-but-well-formed
-- pack to the back rather than starving the fleet.
DO $$ BEGIN
  ALTER TABLE gym_cohort_configs
    ADD CONSTRAINT gym_cohort_configs_domain_pack_format
    CHECK (domain_pack ~ '^[a-z][a-z0-9_]*@[0-9]+$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Selection index: the cron orders (last_generated_at ASC NULLS FIRST) over active
-- rows, so the partial index must declare the SAME order for the LIMIT 1 to be an
-- index read (the prior NULLS-LAST default disagreed with the NULLS-FIRST query).
DROP INDEX IF EXISTS idx_gym_cohort_configs_due;
CREATE INDEX IF NOT EXISTS idx_gym_cohort_configs_due
  ON gym_cohort_configs (last_generated_at ASC NULLS FIRST)
  WHERE active;

-- updated_at maintenance (repo convention — set_updated_at() is the shared trigger fn).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gym_cohort_configs_updated_at ON gym_cohort_configs;
CREATE TRIGGER trg_gym_cohort_configs_updated_at
  BEFORE UPDATE ON gym_cohort_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Atomic claim of the most-due eligible gym (the repo's claim_program_stage idiom).
-- ONE round trip: FOR UPDATE SKIP LOCKED + stamp last_attempt_at so overlapping
-- invocations (pg_cron double-fire, retry, manual trigger during a run) can never
-- select and double-generate the same gym. Eligible = active, due, past its backoff
-- window (next_attempt_at), and not already claimed inside p_claim_window_seconds.
CREATE OR REPLACE FUNCTION claim_due_gym_cohort(
  p_regen_after_days int DEFAULT 30,
  p_claim_window_seconds int DEFAULT 900
)
RETURNS SETOF gym_cohort_configs
LANGUAGE plpgsql
AS $$
DECLARE
  v_due_cutoff   timestamptz := now() - make_interval(days => p_regen_after_days);
  v_claim_cutoff timestamptz := now() - make_interval(secs => p_claim_window_seconds);
BEGIN
  RETURN QUERY
  UPDATE gym_cohort_configs g
     SET last_attempt_at = now(),
         attempt_count   = g.attempt_count + 1
   WHERE g.gym_id = (
     SELECT c.gym_id FROM gym_cohort_configs c
      WHERE c.active
        AND (c.last_generated_at IS NULL OR c.last_generated_at < v_due_cutoff)
        AND (c.next_attempt_at   IS NULL OR c.next_attempt_at   <= now())
        AND (c.last_attempt_at   IS NULL OR c.last_attempt_at   <  v_claim_cutoff)
      ORDER BY c.last_generated_at ASC NULLS FIRST, c.gym_id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING g.*;
END;
$$;

ALTER TABLE gym_cohort_configs ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (the cron + the affiliate config-upsert endpoint) only.

COMMENT ON TABLE gym_cohort_configs IS 'Per-gym cohort spec for the Engine Class regeneration cron (task #5). Cron scheduled hourly for fleet drain; per-gym cadence is monthly.';
COMMENT ON FUNCTION claim_due_gym_cohort(int, int) IS 'Atomically claim the most-due eligible gym for cohort regeneration (FOR UPDATE SKIP LOCKED + last_attempt_at stamp). Returns 0 rows when nothing is due.';

NOTIFY pgrst, 'reload schema';

COMMIT;
