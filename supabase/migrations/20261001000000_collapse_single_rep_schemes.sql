-- Collapse the degenerate one-element rep_scheme (founder report,
-- 2026-10-01): the writer routinely emitted rep_scheme=[n] alongside a
-- real set count ("4 sets, scheme [3]"), and the row logger planned ONE
-- set from it — a 4×3 row Rx-logged a quarter of the work. 2,059 rows
-- carried the shape.
--
-- Scope is deliberately narrow:
--   * sets > 1               — the contradiction. A lone element WITHOUT
--                              sets is the metcon convention ([10] = one
--                              AMRAP round, [100] = single pass): untouched.
--   * reps = rep_scheme[1]   — only rows where reconcileReps already set
--                              reps to the lone element, so nulling the
--                              scheme deletes a redundant copy, never data.
--   * block_type <> 'metcon' — belt and suspenders for the convention.
--
-- reconcileReps (save-program-v3, block-edit, and the frontend mirror)
-- now collapses the shape at write time, so this backfill is the last of it.

UPDATE program_movements_v2 pm
SET rep_scheme = NULL
FROM program_blocks_v2 pb
WHERE pb.id = pm.block_id
  AND pb.block_type <> 'metcon'
  AND array_length(pm.rep_scheme, 1) = 1
  AND pm.sets > 1
  AND pm.reps = pm.rep_scheme[1];
