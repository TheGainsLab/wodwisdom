-- Gym cohort generation defaults to the GROUP CLASS domain pack.
--
-- crossfit_class@1 (domain-packs/crossfit-class) is the 60-minute class
-- variant of crossfit@3: warm-up daily, ONE focus block (strength OR skills,
-- owner's weekly split), metcon daily (monostructural welcome), cool-down
-- present but off the clock. The base pack's personal-training day template
-- (strength + accessory + metcon every day) cannot fit a 60-minute class —
-- proven by the 2026-07-07 shakedown runs.
--
-- New gym configs get the class pack by default; existing rows keep their
-- explicit value (switch the pilot gym with the deploy-notes update).
-- Additive + idempotent + SQL-editor-ready.

BEGIN;

ALTER TABLE gym_cohort_configs ALTER COLUMN domain_pack SET DEFAULT 'crossfit_class@1';

COMMENT ON COLUMN gym_cohort_configs.domain_pack IS
  'Versioned Engine domain pack. crossfit_class@1 = 60-min group class template (gym main programs); crossfit@3 = the personal-training template (retail parity).';

COMMIT;
