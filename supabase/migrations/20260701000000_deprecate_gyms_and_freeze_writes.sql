-- Freeze the relic gym product tables (gyms, gym_members).
--
-- These are vestigial from the old in-app coach/gym product. The gym /
-- affiliate surface now lives in the separate affiliate-intelligence product,
-- so these tables must stop growing: mark them deprecated and block all new
-- writes, while KEEPING reads (the admin dashboard's get_gyms / get_gym_members
-- in the admin-data edge function still SELECT from them).
--
-- Verified before writing this migration:
--   * No code writes to either table anywhere (edge functions, frontend,
--     migrations, triggers). invite-coach only uses gym_name for email text.
--   * Reads are admin-only (admin-data edge function).
--   * No foreign keys reference these tables. programs.gym_name is a bare TEXT
--     column, not an FK. So freezing writes orphans nothing.
--
-- Two layers of write-block, because they cover different roles:
--   1. DROP the write RLS policies  -> stops anon/authenticated (PostgREST) writes.
--   2. REVOKE write grants          -> stops service_role too. RLS does NOT gate
--      service_role (it bypasses RLS), and the only reader (admin-data) uses the
--      service role, so revoking INSERT/UPDATE/DELETE is what actually guarantees
--      "no new writes." SELECT grants are left intact so reads keep working.
--
-- Idempotent: safe to run more than once. Apply by pasting into the Supabase
-- SQL editor.

BEGIN;

-- 1. Deprecation markers -------------------------------------------------------
COMMENT ON TABLE public.gyms IS
  'DEPRECATED 2026-07-01: relic of the old in-app gym product. Gym/affiliate '
  'features now live in the affiliate-intelligence product. Reads only; writes '
  'are frozen (see migration 20260701000000). Do not add new writers.';

COMMENT ON TABLE public.gym_members IS
  'DEPRECATED 2026-07-01: relic of the old in-app gym product. Gym/affiliate '
  'features now live in the affiliate-intelligence product. Reads only; writes '
  'are frozen (see migration 20260701000000). Do not add new writers.';

-- 2. Drop write RLS policies (anon / authenticated paths) ----------------------
DROP POLICY IF EXISTS "Gym owners can insert members" ON public.gym_members;
DROP POLICY IF EXISTS "Gym owners can update members" ON public.gym_members;
DROP POLICY IF EXISTS "Members can update own rows"   ON public.gym_members;
-- SELECT policies intentionally retained:
--   "Gym owners can select members", "Members can view own rows"

-- 3. Revoke write grants (covers service_role, which bypasses RLS) -------------
REVOKE INSERT, UPDATE, DELETE ON public.gyms         FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.gym_members  FROM anon, authenticated, service_role;
-- SELECT grants left untouched so admin-data reads keep working.

-- 4. Loud backstop: a write trigger that raises -------------------------------
-- REVOKE + dropped RLS policies are the freeze, but both are SILENT if bypassed:
-- a future blanket `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role`
-- (a common Supabase idiom) re-opens writes with no signal, and the table owner
-- bypasses REVOKE entirely. A BEFORE-write trigger fires for EVERY role incl.
-- the owner, so any regrowth of the frozen gym fork (D2) fails loudly instead of
-- silently. To intentionally thaw: DROP the triggers below.
CREATE OR REPLACE FUNCTION public.reject_frozen_gym_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'gyms/gym_members are frozen (deprecated 2026-07-01, no new writes). '
    'Gym features live in affiliate-intelligence. See migration 20260701000000.';
END;
$$;

DROP TRIGGER IF EXISTS freeze_writes ON public.gyms;
CREATE TRIGGER freeze_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.gyms
  FOR EACH ROW EXECUTE FUNCTION public.reject_frozen_gym_write();

DROP TRIGGER IF EXISTS freeze_writes ON public.gym_members;
CREATE TRIGGER freeze_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.gym_members
  FOR EACH ROW EXECUTE FUNCTION public.reject_frozen_gym_write();

-- TRUNCATE bypasses row-level triggers, so cover it with statement-level ones.
DROP TRIGGER IF EXISTS freeze_truncate ON public.gyms;
CREATE TRIGGER freeze_truncate
  BEFORE TRUNCATE ON public.gyms
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_frozen_gym_write();

DROP TRIGGER IF EXISTS freeze_truncate ON public.gym_members;
CREATE TRIGGER freeze_truncate
  BEFORE TRUNCATE ON public.gym_members
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_frozen_gym_write();

COMMIT;
