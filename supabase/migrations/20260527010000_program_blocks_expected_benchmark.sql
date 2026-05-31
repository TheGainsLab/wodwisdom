-- expected_benchmark: cohort-derived median/excellent benchmark for a
-- metcon block, computed ONCE at generation time and stored so every
-- consumer (client display, Coach, audits, future analytics) reads the
-- same number without recomputing.
--
-- Replaces the per-load client-side compute-benchmarks call. Eliminates:
--   - 2× duplicate computation (generation + every client load)
--   - Drift between admin / athlete / Coach views
--   - The need for a client-side fallback math path
--
-- jsonb shape (populated by generate-program-v3 via computeBenchmarks()):
--   {
--     median_score:     "7:38",            -- formatted MM:SS or "rounds+reps"
--     median_seconds:   458,                -- numeric — what the audit reads
--     excellent_score:  "5:53" | null,
--     excellent_seconds: 353 | null,
--     joules:           74000,              -- upstream work-calc total
--     time_domain:      "short"|"medium"|"long",  -- derived bucket
--     cohort_anchors:   [{p:10,watts:..,score:..}, ... p99],
--     basis:            "open_p50_vs_qf_p50" | "open_p50_vs_open_p90_qf_missing" | ...,
--     compute_status:   "computed" | "fallback" | "failed"
--   }
--
-- Null on non-metcon blocks (strength / accessory / skills / warm-up etc.)
-- and on any metcon where computeBenchmarks returned null (upstream
-- unavailable / unresolved movement / missing cohort cell).

ALTER TABLE program_blocks_v2
  ADD COLUMN IF NOT EXISTS expected_benchmark jsonb;

COMMENT ON COLUMN program_blocks_v2.expected_benchmark IS
  'Cohort-derived expected benchmark for a metcon block, computed at generation time via computeBenchmarks(). Single source of truth — client + audit + Coach all read from here, never recompute.';
