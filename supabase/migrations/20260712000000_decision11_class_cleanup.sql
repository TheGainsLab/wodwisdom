-- Decision 11 class cleanup — DESTRUCTIVE (founder-approved 2026-07-12).
-- See docs/portfolio/PRODUCT_BOUNDARIES.md. All affiliates are test users, so the
-- rows destroyed here are test data; run BEFORE the first production affiliate.
--
-- Removes the Engine Class data surface:
--   * engine_class_results — class workout logs (F4 leaderboard raw material).
--   * gym_tv_tokens        — TV-mode capability tokens.
--   * member_gym_links.engine_intake — the class join intake blob. The LINK rows
--     survive (product-agnostic membership: P2a claim, gym branding).
--   * entitlement rows for the removed class features (engine_cohort /
--     engine_class_view) + any seat-grant rows minted for them.
--
-- KEPT deliberately:
--   * engine_cohort_programs — the gym program generation product's output.
--   * engine_member_scaling  — the Engine API's per-athlete scaling output
--     (engine-generate; callers supply athletes as explicit inputs, Decision 11
--     R2-compliant). NOT class machinery.
--   * member_consents — audit log, append-only, never destroyed.
--
-- Idempotent + SQL-editor-ready. NOTIFY pgrst at the end.

begin;

drop table if exists public.engine_class_results;
drop table if exists public.gym_tv_tokens;

alter table public.member_gym_links drop column if exists engine_intake;

-- Class-feature entitlements (test data; the features are no longer grantable —
-- ALLOWED_GRANT_FEATURES dropped them in the Decision 11 sweep).
delete from public.user_entitlements
  where feature in ('engine_cohort', 'engine_class_view');

-- Seat-grant rows minted for class features while they were allowlisted: a claim
-- against one would bind a feature nothing reads. Test data — remove.
delete from public.gym_seat_grants
  where feature in ('engine_cohort', 'engine_class_view');

notify pgrst, 'reload schema';

commit;
