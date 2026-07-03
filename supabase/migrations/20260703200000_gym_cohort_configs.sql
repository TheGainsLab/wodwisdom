-- Task #5 — gym cohort program wiring (wodwisdom side).
-- Per-gym cohort config the monthly cron regenerates the shared Engine Class
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
  -- Drives the monthly regeneration cadence (regenerate when null or 30d+ old).
  last_generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gym_cohort_configs_due
  ON gym_cohort_configs (last_generated_at)
  WHERE active;

ALTER TABLE gym_cohort_configs ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (the cron + the affiliate config-upsert endpoint) only.

COMMENT ON TABLE gym_cohort_configs IS 'Per-gym cohort spec for the monthly Engine Class regeneration cron (task #5).';

NOTIFY pgrst, 'reload schema';

COMMIT;
