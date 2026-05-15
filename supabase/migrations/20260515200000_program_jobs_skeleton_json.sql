-- v3 chained-generation: skeleton storage + program_version 'v3' tag.
--
-- v3 generates programs in stages — a skeleton call first (4-week
-- structural arc + per-day block/intent decisions), then per-week fill
-- calls that produce movement-level prescriptions. The skeleton needs
-- its own column on program_jobs so we can:
--   - persist it the moment the skeleton call returns (separately from
--     the final result_json),
--   - inspect it via the admin V3 panel,
--   - resume a job if a per-week fill fails (don't re-call the skeleton).
--
-- Also: extend programs.program_version CHECK to accept 'v3' so the
-- v3 save path can tag the program row correctly.

ALTER TABLE program_jobs
  ADD COLUMN IF NOT EXISTS skeleton_json jsonb;

COMMENT ON COLUMN program_jobs.skeleton_json IS
  'v3 only: the SkeletonOutput emitted by the skeleton-writer call (month_plan + 4 weeks of per-day block_types / primary_lift / metcon_focus / skill_focus). Populated after the skeleton call succeeds; read by subsequent per-week fill calls. Null on v1/v2 jobs.';

-- Extend programs.program_version CHECK to accept v3. The original
-- constraint from 20260514000000_v2_program_storage.sql was defined
-- inline (auto-named programs_program_version_check). Drop + re-add.
ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_program_version_check;
ALTER TABLE programs
  ADD CONSTRAINT programs_program_version_check
  CHECK (program_version IN ('v1', 'v2', 'v3'));
