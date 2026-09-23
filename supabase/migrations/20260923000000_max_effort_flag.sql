-- max_effort: "as many reps/cals as possible in the remaining window" — a
-- finisher inside a bounded clock (interval window / EMOM / time cap). When
-- true the movement carries no volume fields: prescribed volume is honestly
-- unknown, and the logged result is where the number lives. Placement rules
-- (metcon-only, last movement, one per block, bounded clock, never AMRAP)
-- are enforced by auditMaxEffort at generation/edit time, not by the schema.
ALTER TABLE public.program_movements_v2
  ADD COLUMN IF NOT EXISTS max_effort boolean;

-- cal_scheme / distance_scheme: per-round breakdowns for calorie- and
-- distance-counted movements whose rounds VARY — the rep_scheme mirror that
-- was missing. "21-15-9 cal bike" → cal_scheme [21,15,9], calories = 45
-- (sum, derived in save-program-v3 like reps = sum(rep_scheme)). Descending
-- rows "500-400-300m" → distance_scheme [500,400,300] + distance_unit,
-- distance = 1200. Uniform rounds keep the #748 encoding (per-round scalar
-- + sets = rounds); schemes are only for varying rounds.
ALTER TABLE public.program_movements_v2
  ADD COLUMN IF NOT EXISTS cal_scheme integer[],
  ADD COLUMN IF NOT EXISTS distance_scheme integer[];
