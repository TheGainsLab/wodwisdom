-- Once-per-account welcome screen (founder spec, 2026-10-08): a brand-new
-- confirmed account's first authenticated load routes to /welcome — one
-- full-screen card explaining the three-step journey (profile → free
-- evaluation → AI Coach), each step acknowledged with a "Got it" before
-- the Start My Profile button unlocks. The flag lives on the ACCOUNT, not
-- the device (localStorage dies with the browser; this doesn't).
--
-- Written by the client on CTA tap, same own-row update path Settings
-- already uses for full_name / leaderboard_anonymous.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS welcome_seen_at timestamptz;

-- Backfill: every existing account has been using the app without a
-- welcome screen — greeting veterans like strangers would be noise. Only
-- accounts created after this migration ever see /welcome.
UPDATE profiles
   SET welcome_seen_at = now()
 WHERE welcome_seen_at IS NULL;
