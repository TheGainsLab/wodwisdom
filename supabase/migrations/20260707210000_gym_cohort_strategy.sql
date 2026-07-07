-- Owner coaching strategy for gym cohort generation (the priority sliders).
--
-- The cohort envelope's coaching strategy was a hardcoded Engine-Class-era
-- constant (conditioning-forward, deprioritize olympic_lifting — see
-- build-gym-cohort-envelope.ts cohortTrainingDesign, DEBT #548). The first
-- real generation (2026-07-07) confirmed it steers a gym MAIN program wrong.
--
-- This adds the owner's input: a `strategy` jsonb on gym_cohort_configs.
-- Shape (validated in code, not here — the envelope builder is the one reader):
--   {
--     "sliders": { "<focus_area>": 0-10, ... },   -- owner emphasis per axis
--     "strength_emphasis": "technical|balanced|absolute_strength",  -- optional
--     "recovery_stance": "aggressive|standard|conservative"         -- optional
--   }
-- Slider keys are the Engine's FOCUS_AREAS (coach-state.ts): olympic_lifting,
-- powerlifting_strength, posterior_chain, upper_body_pressing,
-- gymnastics_pulling, gymnastics_pressing, midline, skill_coordination,
-- aerobic_capacity, anaerobic_capacity, mixed_modal_conditioning.
--
-- NULL strategy = the code's main-program default (no longer the Engine recipe).
-- Written today via SQL; the portal brief form (priority sliders UI) writes the
-- same column when it ships. Additive + idempotent + SQL-editor-ready.

BEGIN;

ALTER TABLE gym_cohort_configs ADD COLUMN IF NOT EXISTS strategy jsonb;

COMMENT ON COLUMN gym_cohort_configs.strategy IS
  'Owner coaching strategy: { sliders: {focus_area: 0-10}, strength_emphasis?, recovery_stance? }. NULL = main-program default in build-gym-cohort-envelope.ts.';

NOTIFY pgrst, 'reload schema';

COMMIT;
