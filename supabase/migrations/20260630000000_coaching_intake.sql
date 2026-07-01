-- Tier-3 qualitative coaching intake: the athlete's free-text / voice answers to
-- open-ended coaching questions, plus the LLM-extracted structured object.
--
--   coaching_intake_raw  — { question_key: "their words…" } (provenance; lets the
--                          Coach quote them + supports re-extraction later)
--   coaching_intake      — the structured object (coaching-intake.ts), tagged
--                          source "self_reported" when it reaches the coaching state
--   coaching_intake_version — builder/transform version stamp
--
-- Self-reported preferences / self-assessment / history / constraints. Fed into
-- CoachState (judgment), NOT treated as hard facts. Written by process-coaching-intake.

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS coaching_intake_raw jsonb,
  ADD COLUMN IF NOT EXISTS coaching_intake jsonb,
  ADD COLUMN IF NOT EXISTS coaching_intake_version text;
