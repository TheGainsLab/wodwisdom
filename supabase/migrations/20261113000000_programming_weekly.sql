-- Programming week by week (PR 2) — founder decisions 2026-11-12/13:
-- week one is filled, weeks two to four exist as the skeleton's outline and
-- are filled one at a time as the athlete trains.
--
--  programs.weekly_mode            this program is written week by week
--  program_workouts.status         'written' (blocks exist) | 'outline' (skeleton only)
--  program_month_skeletons         the month's skeleton + composed metcons, kept
--                                  so later weeks can be filled (and re-planned)
--  athlete_profiles.programming_weekly  per-athlete opt-in while the model rolls
--                                  out; PR 5 flips the default.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS weekly_mode boolean NOT NULL DEFAULT false;

ALTER TABLE program_workouts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'written';
ALTER TABLE program_workouts DROP CONSTRAINT IF EXISTS program_workouts_status_check;
ALTER TABLE program_workouts ADD CONSTRAINT program_workouts_status_check CHECK (status IN ('written', 'outline'));

CREATE TABLE IF NOT EXISTS program_month_skeletons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  month_number integer NOT NULL,
  skeleton jsonb NOT NULL,
  composed_metcons jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  replanned_at timestamptz NULL,
  replan_count integer NOT NULL DEFAULT 0,
  UNIQUE (program_id, month_number)
);
ALTER TABLE program_month_skeletons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own skeletons select" ON program_month_skeletons FOR SELECT
  USING (EXISTS (SELECT 1 FROM programs p WHERE p.id = program_id AND p.user_id = auth.uid()));

ALTER TABLE athlete_profiles ADD COLUMN IF NOT EXISTS programming_weekly boolean NOT NULL DEFAULT false;
