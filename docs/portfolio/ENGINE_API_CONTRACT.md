# Engine API Contract — Draft

_Last updated: 2026-07-01. Companion to `ENGINE_EXTRACTION.md` (what moves) and
`STRATEGY.md` §3 (adaptive vs. cohort). Status: draft for review — the contract is being
designed before the seam is fully cut, so the shape is right when extraction lands._

This is the runtime HTTP contract for the extracted Engine — what a **surface** (wodwisdom
retail, the gym storefront, a future partner) calls to get audited training. Auth mirrors the
data service: per-consumer `X-Service-Key` against a `consumer_keys` registry, versioned,
rate-limited, request-logged.

Four things are baked in from day one because they are cheap now and brutal to retrofit:
**`athletes[]` always an array**, **`tenant_id` + `corpus_scope` on every request**, a
**versioned `domain_pack`**, and an explicit **`mode` (adaptive vs. cohort)**.

---

## Modes: adaptive vs. cohort

One flag, two native shapes of generation (STRATEGY §3):

- **`adaptive`** (retail) — per-athlete personalization ON. Each athlete in `athletes[]` gets
  an independent full generation; embedded AI recalibrates each continuously across months.
  This is today's wodwisdom behavior with `athletes.length === 1`.
- **`cohort`** (gym / team / class) — per-athlete personalization OFF at the *path* level, ON
  at the *scaling* level. One shared program (the class "path") is generated from a cohort
  target profile, then **individualized scaling** (loads, scaling notes, substitutions) is
  computed per athlete. Leaderboard-ready: everyone did the same workout, scaled to them. This
  same flag is the future bridge to team sports.

The mode changes what `athletes[]` *means* and what comes back — see below.

---

## `POST /v1/generate`

```jsonc
{
  "tenant_id": "wodwisdom",          // REQ. White-label boundary. Also scopes corpus + billing.
  "mode": "adaptive",                // REQ. "adaptive" | "cohort".
  "domain_pack": "crossfit@3",       // REQ. Sport pack id + version. New sport = new pack id.
  "model_profile": "default",        // OPT. "default" | "fast" | "quality" (see model-profiles.ts).
  "corpus_scope": {                  // OPT. White-label RAG. Omit = baseline only.
    "tenants": ["wodwisdom"],        //   private corpora to layer on the shared baseline
    "include_baseline": true         //   default true; false = pure white-label (future)
  },

  // ADAPTIVE: each entry -> one independent full generation.
  // COHORT:   the roster the shared program is scaled to.
  "athletes": [
    {
      "athlete_ref": "user_abc",     // opaque to Engine; echoed back for correlation
      "payload": { /* WriterPayload — surface-built, the existing input contract */ },
      "continuation": { "program_ref": "...", "month_number": 4 }   // OPT, append mode
    }
    // ... N athletes; 1 is the retail case, N is a gym roster
  ],

  // REQUIRED when mode == "cohort", ignored otherwise.
  "cohort": {
    "shared_profile": "derive_from_roster",  // or an explicit WriterPayload for the class target
    "days_per_week": 5,
    "constraints": { /* equipment floor, do_not_program, session length — class-level */ }
  }
}
```

Response is `202 Accepted` with a batch handle:

```jsonc
// adaptive
{ "batch_id": "...", "mode": "adaptive",
  "jobs": [ { "athlete_ref": "user_abc", "job_id": "..." } ] }

// cohort
{ "batch_id": "...", "mode": "cohort",
  "program_job_id": "...",                       // the ONE shared program being generated
  "scaling_jobs": [ { "athlete_ref": "user_abc", "job_id": "..." } ] }
```

Rationale, field by field:

- **`athletes` is always an array.** Retail passes 1; a gym passes its whole roster. Batch is
  a fan-out over one request, not a separate endpoint or a rewrite. (The blocker today is
  structural: `program_jobs.user_id` is singular and the cron loops one user at a time — see
  `ENGINE_EXTRACTION.md` §batch.)
- **`tenant_id` + `corpus_scope` on every request.** The corpus `tenant_id` column and the
  `filter_tenants` retrieval param already exist (migration `20260701000001_corpus_tenant_scope`);
  this contract is what carries the scope end-to-end. Baseline + requested tenants is the
  default; `include_baseline: false` is the pure-white-label escape hatch (not yet implemented
  server-side — the flag exists so callers don't have to change later).
- **`model_profile` not a model id.** Resolves via `_shared/model-profiles.ts` to concrete
  primary/fallback models. A tenant picks cost vs. quality; a model retirement is a config
  change, not a fleet redeploy.
- **`domain_pack` is versioned.** wodwisdom pins `crossfit@3`; Hyrox ships as `hyrox@1`; the
  control plane is untouched. This is the "new sport = content" property made contractual.
- **Engine is stateless about the surface DB.** Input is `WriterPayload` (surface-built),
  output is `WriterOutput` (surface-persisted). The Engine owns only its job + corpus tables.

---

## Job lifecycle

```
GET /v1/jobs/{job_id}
  -> { job_id, athlete_ref, kind: "program" | "scaling", status, stage,
       result?: WriterOutput | ScalingResult, violations?, error? }

GET /v1/batches/{batch_id}
  -> { batch_id, mode, jobs: [ { job_id, athlete_ref, kind, status, stage } ] }
```

`status`: `queued | running | complete | failed`. `stage` exposes the resumable pipeline
step (payload → coach_state → skeleton → fill → audit → surgical → safety → save) so a surface
can show progress. Results are pulled (not pushed) in v1; a `webhook_url` on the consumer key
is the future push path (the column already exists in the data service's registry).

**Cohort result shape.** `program_job_id` yields the one shared `WriterOutput`. Each
`scaling_jobs[].job_id` yields a `ScalingResult` — per-movement load/scaling/substitution deltas
keyed to the shared program's blocks, plus a `tier`/percentile for leaderboard grouping. The
surface renders "the class workout" once and each member's scaled numbers on top.

---

## Error model

Mirrors the data service: JSON `{ error, message, request_id }`, with `X-Api-Version`,
`X-Request-Id`, `X-Consumer`, `X-RateLimit-*` headers. Per-athlete failures in a batch do not
fail the batch — the failed job carries `status: "failed"` + `error`; siblings proceed. A whole
request fails only on auth / rate limit / malformed envelope.

---

## Open questions (resolve before build)

1. **Cohort scaling source of truth.** Is `ScalingResult` computed by the Engine (LLM +
   physics model) or partly by the surface? Leaning Engine, using the data service's work/power
   model for load anchoring.
2. **`derive_from_roster`.** What aggregate defines the class target — median, a nominated
   "reference athlete," or a coach-set level? Affects who the shared path is written for.
3. **Continuation in cohort mode.** Does month-N+1 re-derive the shared path, or carry the
   class forward with per-athlete adaptation creeping in? (Ties to D9 remote-membership packaging.)
4. **Idempotency keys** on `/v1/generate` so a retried batch doesn't double-generate.
5. **`include_baseline: false`** server implementation (pure white-label) — deferred until a
   tenant actually needs corpus isolation without the baseline.
