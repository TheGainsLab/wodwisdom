-- max_effort: "as many reps/cals as possible in the remaining window" — a
-- finisher inside a bounded clock (interval window / EMOM / time cap). When
-- true the movement carries no volume fields: prescribed volume is honestly
-- unknown, and the logged result is where the number lives. Placement rules
-- (metcon-only, last movement, one per block, bounded clock, never AMRAP)
-- are enforced by auditMaxEffort at generation/edit time, not by the schema.
ALTER TABLE public.program_movements_v2
  ADD COLUMN IF NOT EXISTS max_effort boolean;
