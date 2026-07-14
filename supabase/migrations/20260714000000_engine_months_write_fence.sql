-- Engine entitlement write fence.
--
-- engine_months_unlocked IS the Engine paywall: it is raised only by the
-- payment system (stripe-webhook +1 per paid invoice, reconcile-engine-months,
-- monthly-generation-cron's quarterly drip, the gym-grant drip, admin
-- overrides) — every one of those writers runs with the service role, and no
-- client code writes the column. But the "update own" RLS policy on
-- athlete_profiles (20260219) has no column restriction, so any authenticated
-- user could raise their own value from the browser console and unlock the
-- full 36-month catalog without paying.
--
-- WHY A TRIGGER AND NOT COLUMN PRIVILEGES: Supabase grants table-level UPDATE
-- on public tables to authenticated/anon, and a table-level grant covers every
-- column no matter what column-level REVOKEs exist — `REVOKE UPDATE (col)` here
-- is a silent no-op. The working alternative (revoke table UPDATE, re-grant a
-- column list) would need every client-writable column enumerated and a new
-- GRANT on every future ADD COLUMN, silently breaking profile saves when
-- forgotten. The trigger needs no such list and fails loud.
--
-- Role check: current_user reflects the role PostgREST executes as —
-- 'authenticated'/'anon' for end-user requests, 'service_role' for the edge
-- functions, 'postgres' for migrations/SQL editor, and the function owner
-- inside SECURITY DEFINER admin RPCs. Only the end-user roles are fenced.
CREATE OR REPLACE FUNCTION public.protect_engine_entitlement_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.engine_months_unlocked IS DISTINCT FROM OLD.engine_months_unlocked
         OR NEW.engine_months_unlocked_last_at IS DISTINCT FROM OLD.engine_months_unlocked_last_at THEN
        RAISE EXCEPTION 'engine_months_unlocked is managed by the payment system'
          USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      -- A fresh row must carry the defaults (0 / NULL). Legit client
      -- inserts/upserts never send these columns, so they inherit the
      -- defaults and pass; a crafted insert pre-loading entitlement fails.
      IF COALESCE(NEW.engine_months_unlocked, 0) <> 0
         OR NEW.engine_months_unlocked_last_at IS NOT NULL THEN
        RAISE EXCEPTION 'engine_months_unlocked is managed by the payment system'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_engine_entitlement ON athlete_profiles;
CREATE TRIGGER trg_protect_engine_entitlement
  BEFORE INSERT OR UPDATE ON athlete_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_engine_entitlement_columns();
