-- Scoring reliability (founder review, 2026-11-03): every evidence row
-- carries its scoring state, so the denominator for monitoring is simply
-- "rows", a retry updates the row in place, and the reason codes are
-- product surface, not log lines. engine_version (code version + power
-- curve generation id) makes rows scored by a buggy or superseded engine
-- identifiable and re-scorable — the ledger is truth, profiles recompute,
-- so a fixed bug does not leave its damage behind.
--
-- Status vocabulary (open set; code defines values):
--   scored            percentile present and trusted at its noise
--   pending           scorable in principle, not yet scored (retry target)
--   skipped_<reason>  visibly unscored: skipped_scaled, skipped_capped,
--                     skipped_load_scored, skipped_implausible,
--                     skipped_<engine reason code>...
-- Principle: a solo score that can't be trusted is VISIBLY unscored,
-- never plausibly wrong.

alter table public.signature_evidence
  add column if not exists score_status text,
  add column if not exists engine_version text,
  add column if not exists scored_at timestamptz;

-- Backfill from what the rows already say about themselves. score_raw
-- carries rx/capped for logged_solo rows; Open/leaderboard rows with a
-- percentile are scored by definition (observed rank, not an estimate).
update public.signature_evidence
set score_status = case
  when percentile is not null then 'scored'
  when (score_raw ->> 'capped') = 'true' then 'skipped_capped'
  when (score_raw ->> 'rx') is distinct from 'true' then 'skipped_scaled'
  else 'pending'
end
where score_status is null;

create index if not exists signature_evidence_score_status_idx
  on public.signature_evidence (score_status);
