-- F3 — member-join bridge, wodwisdom side (GYM_PORTAL_FLOWS §F3).
-- Records that a wodwisdom member joined a gym's Engine Class + their member-level
-- consent + a light Engine intake. The authoritative SEAT state (invited/active/…)
-- lives in the affiliate project's engine_class_seats; this side records the LINK
-- so the member's PWA gains gym context (F5 read-only view, F4 leaderboard) and so
-- consent is captured before any member data appears in owner surfaces.
--
-- IMPORTANT (F5 keys off entitlement AND link, per #550 review): a link ENDS when
-- the member leaves / the gym cancels (status='left', left_at). Because seat
-- deactivation is an affiliate-side event, ending the link is a cross-repo contract
-- item (the affiliate revoke path must also end the link) — until that lands, F5
-- MUST gate the read-only gym view on an ACTIVE engine_cohort entitlement AND a
-- 'joined' link, never the link alone, so ex-members never see gym programming.
--
-- Access to the class (engine_cohort) is granted separately, on seat activation,
-- via the Wholesale Grants API — this migration NEVER touches user_entitlements.
--
-- Additive + idempotent + SQL-editor-ready. Two new relations -> reload the
-- PostgREST schema cache after applying (NOTIFY at the end).

BEGIN;

-- =============================================================================
-- member_gym_links — one row per (member, gym) the member has joined.
-- =============================================================================
CREATE TABLE IF NOT EXISTS member_gym_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Affiliate community id (the gym's tenant id). Opaque cross-project id — the
  -- gym record lives in a separate Supabase project, so no FK. text to match the
  -- grant's granted_by / gym_id.
  gym_id text NOT NULL,
  gym_name text,
  class_name text,

  -- Light Engine intake (the Engine subset: key numbers). Shaped to feed cohort
  -- scaling (task #5): { gender, bodyweight, units, lifts, do_not_program }.
  engine_intake jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 'joined' = on the roster; 'left' = member left / gym cancelled (portability:
  -- history stays, gym context ends). left_at pins when.
  status text NOT NULL DEFAULT 'joined' CHECK (status IN ('joined', 'left')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,

  UNIQUE (user_id, gym_id)
);

-- The UNIQUE(user_id, gym_id) btree already serves user_id-prefix lookups, so no
-- separate user_id index. F4/F5 do gym-scoped reads ("everyone in gym X"), which
-- the composite can't serve prefix-wise — index gym_id.
CREATE INDEX IF NOT EXISTS idx_member_gym_links_gym ON member_gym_links(gym_id);

ALTER TABLE member_gym_links ENABLE ROW LEVEL SECURITY;

-- Members read their own gym links (drives PWA gym context). Writes go through the
-- engine-join edge function (service_role) — no authenticated write policy.
DROP POLICY IF EXISTS "member_gym_links_select_own" ON member_gym_links;
CREATE POLICY "member_gym_links_select_own" ON member_gym_links
  FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- member_consents — member-level consent captured at join (F3). Append-only via
-- service_role. `version` pins the accepted (LEGAL-TBD) copy. Always gym-attributed
-- (a dispute audit must answer "did they consent for gym X"). The UNIQUE lets the
-- writer ignore-duplicate on retry so a re-join / retry-spam can't pollute the log.
-- =============================================================================
CREATE TABLE IF NOT EXISTS member_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type text NOT NULL,          -- 'member_engine_data' (v1)
  version text NOT NULL,               -- e.g. 'v1-legal-tbd-2026-07'
  gym_id text NOT NULL,                -- the gym context consent was given in
  accepted_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, consent_type, version, gym_id)
);

CREATE INDEX IF NOT EXISTS idx_member_consents_user ON member_consents(user_id, accepted_at DESC);

ALTER TABLE member_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_consents_select_own" ON member_consents;
CREATE POLICY "member_consents_select_own" ON member_consents
  FOR SELECT USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
