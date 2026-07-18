-- Capture list item B (2026-07-18): PWA install tracking.
-- (Acquisition capture needs no schema — it rides signup metadata into
-- auth.users.raw_user_meta_data.acquisition.)
--
-- pwa_installed_at: stamped once, first install wins. Written by the
-- mark_pwa_installed RPC, which authenticated clients may call for
-- THEMSELVES only (auth.uid() — no user id parameter to abuse). Fires from
-- the install prompt's accepted outcome and from standalone display-mode
-- detection (covers iOS manual add-to-home-screen).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pwa_installed_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_pwa_installed()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles
  SET pwa_installed_at = COALESCE(pwa_installed_at, now())
  WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.mark_pwa_installed() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_pwa_installed() TO authenticated;
