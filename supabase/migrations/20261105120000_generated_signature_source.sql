-- Generation-time signature autodraft (rev-61 automation chain, link 1).
--
-- 1. 'generated' joins the source vocabulary: rows the generation hook
--    drafts automatically for every novel metcon structure the writer
--    emits. They enter at status='draft' (draft noise x3 — they inform,
--    never dominate) with editorial provenance, exactly like admin drafts.
--
-- 2. Race safety for the hash dedup: two concurrent generations drafting
--    the same novel structure must collapse to one row. The partial unique
--    index makes the second insert fail 23505, which the hook counts as a
--    successful dedup. Scoped to source='generated' so the existing
--    open/adhoc rows (where duplicate structures are surfaced to the admin
--    as hash_conflicts instead) are untouched.

alter table public.workout_signatures
  drop constraint if exists workout_signatures_source_check;

alter table public.workout_signatures
  add constraint workout_signatures_source_check
  check (source in ('open', 'quarterfinals', 'adhoc', 'generated'));

create unique index if not exists workout_signatures_generated_hash_key
  on public.workout_signatures (workout_hash)
  where source = 'generated';
