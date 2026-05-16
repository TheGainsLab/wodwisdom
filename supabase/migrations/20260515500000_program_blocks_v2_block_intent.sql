-- Step 17 of the v3 UX roadmap: block_intent jsonb on program_blocks_v2.
--
-- The v3 generator runs in two LLM calls — a skeleton call (decides the
-- 4-week arc + per-day structure) and a fill call (emits movements).
-- Today the skeleton's reasoning (day_intent, primary_lift,
-- strength_scheme, metcon_focus, skill_focus) survives only in
-- program_jobs.skeleton_json, a transient debugging artifact. After the
-- program is saved, read-side code has to infer intent from the
-- prescription.
--
-- block_intent attaches the relevant skeleton fragment to the block it
-- shaped, so:
--   - Coach reads the writer's actual intent rather than re-deriving from
--     movements (sharper, more consistent Training Intent output).
--   - Adherence dashboards (Step 21) can group skip counts by intent zone
--     ("athlete misses 75% of posterior-chain accessory days").
--   - Carry-forward writer (Step 27) ingests structured intent + adherence
--     across cycles to drive intelligent progression.
--   - Cohort comparison (Step 25) can slice by intent.
--
-- Shape (jsonb, no enforced schema — flexible across block types):
--   strength block: { day_intent, focus: primary_lift, scheme: strength_scheme }
--   metcon block:   { day_intent, focus: metcon_focus }
--   skills block:   { day_intent, focus: skill_focus }
--   accessory / warm-up / cool-down / mobility / active-recovery:
--                   { day_intent }
--
-- Nullable. Pre-Step-17 blocks have null block_intent and all read paths
-- handle null gracefully.

ALTER TABLE program_blocks_v2
  ADD COLUMN block_intent jsonb;

COMMENT ON COLUMN program_blocks_v2.block_intent IS
  'Writer-intent metadata from the v3 skeleton, attached to the block it shaped. Shape varies by block_type — see migration header.';
