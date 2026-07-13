-- Phase C (Decision 12a) — retire the claim machinery's data. Gym members live
-- on their gym's member app (affiliate-side); no wodwisdom account, grant, or
-- consent row may represent one. All affected rows are test data
-- (founder-approved; every current affiliate is a test user).
--
--   * gym_seat_grants — the token seam's ledger (gym-seat-grant/claim deleted).
--   * member_gym_links — the account↔gym link (nothing may link them anymore).
--   * member_consents — the cross-seam consent machinery (retail keeps no
--     gym-related consent; coach visibility is a future affiliate-side setting).
--   * user_entitlements gym_grant rows — the entitlements those grants issued
--     (`gym_engine` / gym-scoped `engine` / `nutrition`); the features they lit
--     no longer exist for gym members on this side.
--
-- Idempotent + SQL-editor-ready. NOTIFY pgrst at the end.

begin;

delete from user_entitlements where source_kind = 'gym_grant';

drop table if exists gym_seat_grants;
drop table if exists member_gym_links;
drop table if exists member_consents;

notify pgrst, 'reload schema';

commit;
