-- Enable RLS on the four tables the Supabase advisor flagged as exposed
-- (2026-09-11): engine_workouts, engine_program_mapping, movements,
-- claim_subscription_errors. Until now, anyone holding the app's public
-- anon key could read them directly — including the entire Year of the
-- Engine library.
--
-- Access model:
--   engine_workouts / engine_program_mapping — the paid product. Client
--     reads require a live 'engine' entitlement (all_access rows include
--     it) or admin role. No client writes, ever. Edge functions use the
--     service role and bypass RLS, so chat / generation / crons are
--     unaffected. Known visible change: churned Engine athletes lose
--     day-type labels on historical sessions in the Training Log (their
--     own session rows still render) — lapsed access behaving as lapsed.
--   movements — reference data. Any signed-in user may read (logging UI
--     and movement vocabulary need it); nobody writes from the client.
--   claim_subscription_errors — error log carrying user emails. RLS on,
--     NO policies: zero client access. Its writers are SECURITY DEFINER
--     functions running as table owner, which RLS does not restrict.
--
-- auth.uid() is wrapped as (select auth.uid()) so Postgres computes it
-- once per query instead of once per row (the standard Supabase policy
-- pattern). The entitlement probe hits idx_entitlements_user_feature.
--
-- Reversible: ALTER TABLE <t> DISABLE ROW LEVEL SECURITY restores the
-- previous behavior if anything surprises us.

ALTER TABLE engine_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE engine_program_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "engine entitled read" ON engine_workouts FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_entitlements ue
    WHERE ue.user_id = (select auth.uid())
      AND ue.feature = 'engine'
      AND (ue.expires_at IS NULL OR ue.expires_at > now())
  )
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = (select auth.uid()) AND p.role = 'admin'
  )
);

CREATE POLICY "engine entitled read" ON engine_program_mapping FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_entitlements ue
    WHERE ue.user_id = (select auth.uid())
      AND ue.feature = 'engine'
      AND (ue.expires_at IS NULL OR ue.expires_at > now())
  )
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = (select auth.uid()) AND p.role = 'admin'
  )
);

ALTER TABLE movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read" ON movements
  FOR SELECT TO authenticated USING (true);

ALTER TABLE claim_subscription_errors ENABLE ROW LEVEL SECURITY;
