-- Admin drill-down foundation: access log + helpers.
--
-- This migration establishes two primitives that every admin drill-down RPC
-- will use:
--
--   1. is_current_user_admin() — a lightweight authorization check. Every
--      admin-scoped function should call this at the top and raise otherwise.
--      Existing admin_* RPCs predate this helper; they should be updated to
--      use it when we harden authorization on the admin surface.
--
--   2. log_admin_access(target_user_id, resource, metadata) — records every
--      time an admin views a user's private data (chat, nutrition, etc.).
--      Provides an audit trail for accountability.
--
-- These are idempotent (CREATE OR REPLACE, CREATE TABLE IF NOT EXISTS).

-- ─── 1. Audit log table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_access_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  resource text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_access_log_admin
  ON public.admin_access_log (admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_access_log_target
  ON public.admin_access_log (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_access_log_created
  ON public.admin_access_log (created_at DESC);

-- ─── 2. Admin authorization helper ───────────────────────────────────
-- Returns true iff the current auth.uid() belongs to a profile with role
-- 'admin'. Safe to call from any SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  admin_role text;
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;
  SELECT role INTO admin_role FROM profiles WHERE id = uid;
  RETURN admin_role = 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.is_current_user_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

-- ─── 3. Access log helper ────────────────────────────────────────────
-- Inserts an admin access event. Called from within admin drill-down RPCs
-- after authorization is confirmed. Silently no-ops if auth.uid() is null
-- (should never happen in practice, but defensive).

CREATE OR REPLACE FUNCTION public.log_admin_access(
  p_target_user_id uuid,
  p_resource text,
  p_metadata jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  INSERT INTO admin_access_log (admin_user_id, target_user_id, resource, metadata)
  VALUES (uid, p_target_user_id, p_resource, p_metadata);
EXCEPTION
  WHEN OTHERS THEN
    -- Audit log must never block the actual admin action.
    NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_access(uuid, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.log_admin_access(uuid, text, jsonb) TO authenticated;

-- ─── 4. RLS on the audit log ─────────────────────────────────────────
-- The table is written via SECURITY DEFINER helpers so service-role writes
-- always work. We add RLS to ensure direct queries (e.g. from the dashboard
-- or future admin UI) only return rows to admins.

ALTER TABLE public.admin_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_access_log_select_admin ON public.admin_access_log;
CREATE POLICY admin_access_log_select_admin ON public.admin_access_log
  FOR SELECT
  USING (public.is_current_user_admin());
