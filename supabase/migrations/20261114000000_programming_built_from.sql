-- Weekly Programming: what the month's skeleton was built from (founder,
-- 2026-11-14). A profile change during the month — days per week, goal,
-- session length — triggers the same re-plan a coach note does, so the
-- week job needs the values the skeleton assumed.
ALTER TABLE program_month_skeletons ADD COLUMN IF NOT EXISTS built_from jsonb NULL;
