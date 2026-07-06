-- athlete_profile_history — append-only history of the athlete intake profile.
--
-- athlete_profiles is a single mutable row per user, upserted in place on
-- every save: each edit destroys the previous values, and the only temporal
-- record today is whatever profile_snapshot a pipeline run (eval / program
-- generation) happened to freeze. This table closes that gap at the SOURCE:
-- a trigger appends a full jsonb snapshot of the row on every meaningful
-- change, so "what did the athlete say three months ago" (bodyweight over
-- time, goal changes, 1RM progression) is answerable regardless of pipeline
-- activity. Insurance first, features later — future time-series tables
-- (e.g. bodyweight/lift logs) can be backfilled from these rows.
--
-- CHURN FILTER: the same row also carries engine bookkeeping that machines
-- rewrite constantly (engine_current_day bumps on every completed session;
-- Stripe webhooks / crons touch engine_months_unlocked*). Snapshots are
-- skipped when ONLY those columns (or updated_at) changed — history records
-- athlete-meaningful edits, not engine ticks. The snapshot itself is the
-- FULL row, churn columns included; the filter applies to change detection
-- only. Machine-written columns added to athlete_profiles later should be
-- appended to the churn list in log_athlete_profile_change().
--
-- SCHEMA DRIFT: profile jsonb mirrors athlete_profiles as of the write, and
-- that table accretes columns over time — readers must tolerate old rows
-- missing keys or using since-changed conventions.

CREATE TABLE athlete_profile_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'INSERT' (first save) or 'UPDATE'.
  op text NOT NULL CHECK (op IN ('INSERT', 'UPDATE')),
  -- Full to_jsonb() snapshot of the athlete_profiles row AFTER the change.
  profile jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Time-ordered reads per athlete ("bodyweight over time").
CREATE INDEX idx_athlete_profile_history_user_time
  ON athlete_profile_history(user_id, changed_at);

ALTER TABLE athlete_profile_history ENABLE ROW LEVEL SECURITY;

-- Read-only to the owner; rows are written exclusively by the trigger below
-- (SECURITY DEFINER bypasses RLS). Append-only → no insert/update/delete
-- policies.
CREATE POLICY "select own" ON athlete_profile_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION log_athlete_profile_change()
RETURNS trigger AS $$
DECLARE
  -- Machine-churn columns ignored for change detection (still captured in
  -- the snapshot). updated_at is stamped on every save; the engine columns
  -- are rewritten by session completion, Stripe webhooks, and drip crons.
  churn constant text[] := ARRAY[
    'updated_at',
    'engine_current_day',
    'engine_months_unlocked',
    'engine_months_unlocked_last_at',
    'engine_subscription_status'
  ];
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - churn) = (to_jsonb(OLD) - churn) THEN
    RETURN NEW;
  END IF;
  INSERT INTO athlete_profile_history (user_id, op, profile)
  VALUES (NEW.user_id, TG_OP, to_jsonb(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_athlete_profiles_history
  AFTER INSERT OR UPDATE ON athlete_profiles
  FOR EACH ROW EXECUTE FUNCTION log_athlete_profile_change();

-- Seed history with each athlete's current profile so the timeline starts at
-- deploy rather than at their next edit.
INSERT INTO athlete_profile_history (user_id, op, profile)
SELECT user_id, 'INSERT', to_jsonb(athlete_profiles)
FROM athlete_profiles;

COMMENT ON TABLE athlete_profile_history IS
  'Append-only snapshots of athlete_profiles, written by trigger on every meaningful change (engine bookkeeping churn is filtered). The source-level history behind future progress features; profile jsonb mirrors the athlete_profiles schema at write time.';
