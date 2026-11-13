-- Weekly Programming PR 4: the weekly cron and the re-plan.
--  program_month_skeletons.written_weeks  the weeks already filled this month
--                                         (WeekPrescription[]), so a week job
--                                         progresses from them without
--                                         rebuilding them from block rows.
--  athlete_profiles.programming_weekly    now DEFAULT TRUE (founder: weekly is
--                                         the default for all new users).
--                                         Existing athletes flip too: their
--                                         current month finishes as written
--                                         (programs.weekly_mode is per program)
--                                         and their next month is weekly.
ALTER TABLE program_month_skeletons ADD COLUMN IF NOT EXISTS written_weeks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE program_month_skeletons ADD COLUMN IF NOT EXISTS last_fill_error text NULL;
ALTER TABLE program_month_skeletons ADD COLUMN IF NOT EXISTS last_fill_attempt_at timestamptz NULL;

ALTER TABLE athlete_profiles ALTER COLUMN programming_weekly SET DEFAULT true;
UPDATE athlete_profiles SET programming_weekly = true WHERE programming_weekly = false;
