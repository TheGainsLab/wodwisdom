# Engine Extraction — Design

_Last updated: 2026-07-01. Grounded in a full read of `wodwisdom/supabase/functions/_shared/` and `generate-program-v3`._

Goal: lift the reusable audited-generation + RAG pipeline out of wodwisdom into a
standalone, sport-agnostic **Engine** service with its own API — the same
"product A is a customer of product B" discipline the data service already proves.

**Two requirements this contract must anticipate from day one** (cheap now, painful to bolt on):
1. **Per-tenant methodology corpus (white-label RAG)** — each tenant/brand can have its own
   coaching knowledge base layered on a shared baseline.
2. **Multi-athlete batch generation (gym individualization)** — generate for a whole roster
   in one call, not one athlete at a time.

---

## The core seam: control plane vs. content vs. surface

The pipeline today is one blob in wodwisdom. Extraction splits it into three:

- **Engine (control plane)** — LLM I/O, RAG retrieval mechanics, the audit *runner*, the
  resumable stage dispatcher, job/lease/resume state, and generation orchestration. Owns its
  own job + corpus tables. **Knows nothing about CrossFit or about wodwisdom's DB.**
- **CrossFit Domain Pack (content)** — prompts, archetypes, movement vocabulary, audit
  *rules*, the block-type enum, normative thresholds, RAG corpus. Loaded by the Engine as a
  versioned, swappable plugin.
- **Surface (wodwisdom / gym / white-label)** — captures athlete data, builds the input
  payload from its own schema, calls the Engine, and persists the returned artifact to its
  own tables.

The critical realization from the code read: **wodwisdom-DB coupling and CrossFit-domain
coupling are two different problems.** `buildWriterPayload` / `saveProgramV3` are coupled to
wodwisdom's *schema* (they stay surface-side). `archetype-specs` / prompts / audit rules are
coupled to the *sport* (they become the Domain Pack). The Engine is what's left.

---

## What leaves `_shared/` → the Engine core (GENERIC)

Portable today, no CrossFit knowledge:

| File | Role in Engine |
|---|---|
| `call-claude.ts` | LLM I/O: retry, Haiku fallback, timeouts |
| `fetch-with-timeout.ts`, `cors.ts` | plumbing |
| `rag.ts` | embedding + `match_chunks_filtered` retrieval **mechanics** (not the corpus content) |
| `audit-runner.ts` | dispatch audits, classify failures, retry loop — **rule-agnostic** |
| `v3-dispatcher.ts` | resumable per-stage state machine, atomic lease/lock |
| `build-writer-payload.ts` / `build-rag-context.ts` | **orchestration shells** (the query/assembly flow; the *keys* they assemble are domain — see Pack) |
| `save-program-v3.ts` | persistence **orchestration** pattern (the target schema is surface-owned) |
| schema *structure* in `v2-output-schema.ts` / `v3-output-schema.ts` | the generic block→movement tree; the **block-type enum values** are domain |

The Engine also absorbs the generation control flow from `generate-program-v3/index.ts`:
payload-building → coach-state → skeleton (+audits) → per-week fill → benchmark audit →
surgical repair → safety review → save. That sequence is generic; every *string* it feeds
the LLM comes from the Pack.

## What stays behind as the CrossFit Domain Pack (DOMAIN)

| File(s) | Domain content |
|---|---|
| `archetype-specs.ts` | 5 day archetypes + block compositions + time allocations |
| `coach-state.ts` | 13 FocusAreas, 24 ReasonCodes, StrengthEmphasis, RecoveryStance |
| `coach-state-prompt.ts`, `v3-skeleton-prompt.ts`, `v2-system-prompt.ts`, `v2-profile-analysis-prompt.ts` | every generation prompt |
| `audits.ts` | the CrossFit rules: `metcon_one_piece`, `metcon_monostructural`, `metcon_barbell_loads`, `plate_math_safe`, block-type enum |
| `v3-skeleton-audits.ts` | allocation/coverage invariants ("every day has strength+accessory+metcon") |
| `tier-status.ts` | canonical lift/skill/conditioning/equipment keys (the vocabulary) |
| `time-domain.ts`, `metcon-workcalc.ts`, `compute-benchmarks.ts` | metcon scoring, time-domain buckets, cohort benchmarks |
| `athlete-model.ts` thresholds | gender-keyed strength ratios + relative-strength bars (architecture generic, numbers domain) |
| the RAG corpus rows | `journal` / `strength-science` / `mainsite` methodology content |

~2000+ lines of CrossFit-specific code across these files.

## What stays in the surface (wodwisdom), NOT the Engine

- `build-writer-payload.ts`'s **data fetching** (reads `athlete_profiles`, tier data, training
  history from wodwisdom's DB) — the surface builds the payload and POSTs it.
- `fetch-tier4-bundle.ts` — the surface attaches the competition payload (keeps the Engine
  free of competition-service coupling).
- `save-program-v3.ts`'s **writes** to `program_workouts` / `program_blocks_v2` /
  `program_movements_v2` — the Engine returns the artifact; the surface persists it.

---

## The Engine API contract

Two layers: the **runtime API** (HTTP, what surfaces call) and the **Domain-Pack SPI**
(what a sport pack must implement). Both bake in tenancy + batch from day one.

### Runtime API (HTTP, consumer-key auth like the data service)

```
POST /v1/generate
  Headers: X-Service-Key: <consumer key>
  Body:
  {
    "tenant_id": "wodwisdom",              // REQ — white-label boundary
    "domain_pack": "crossfit@3",           // REQ — pack id + version (new sport = new pack)
    "model_profile": "default",            // decouples hardcoded model ids; per-tenant override
    "corpus_scope": {                      // white-label RAG in from day one
      "tenants": ["wodwisdom"],            //   layered on the shared baseline
      "include_baseline": true
    },
    "athletes": [                          // ALWAYS an array — 1 today, N for a gym roster
      {
        "athlete_ref": "user_abc",         // opaque to Engine; echoed back for correlation
        "payload": { /* WriterPayload — the existing input contract, surface-built */ },
        "continuation": { "program_ref": "...", "month_number": 4 }   // optional (append mode)
      }
    ]
  }
  -> 202 { "batch_id": "...", "jobs": [ { "athlete_ref": "user_abc", "job_id": "..." } ] }

GET  /v1/jobs/{job_id}      -> { status, stage, result?: WriterOutput, violations?, error? }
GET  /v1/batches/{batch_id} -> { jobs: [ { athlete_ref, job_id, status, stage } ] }
```

Design-in-now decisions and *why*:

- **`athletes` is always an array.** Single-athlete is `length 1`; a gym roster is `length N`.
  The blocker today is structural (`program_jobs.user_id` is singular; `monthly-generation-cron`
  loops one user at a time). In the Engine, one `/v1/generate` fans out to N jobs under one
  `batch_id`. Batch becomes free instead of a rewrite. *(MEDIUM effort — application logic +
  a `batch_id` FK; no algorithmic change.)*
- **`tenant_id` + `corpus_scope` on every request.** Today the corpus (`chunks` table) has
  **no tenant column** — retrieval filters by `category` only. White-label requires a
  `tenant_id` column (nullable = shared baseline) and a retrieval predicate
  `tenant_id IS NULL OR tenant_id = ANY(:tenants)`. Threading `tenant_id` through the API now
  means the schema change is additive later instead of a contract break. *(HIGH effort if
  deferred — schema migration + RPC rewrite + every call site; near-zero if the field exists
  from the start.)*
- **`model_profile` not a model id.** Model ids are hardcoded in ~7 files today
  (`claude-sonnet-4-6` in `call-claude.ts`, `generate-program-v3`, `coaching-intake`,
  `generate-coach-state`, `safety-review`, `metcon-workcalc`, `surgical-block-fix`). The
  Engine resolves a named profile → concrete models, so a tenant can pick cost (Haiku) vs.
  quality (Opus) without a redeploy, and a model retirement is a config change. Fixes the
  known "one snapshot retires → 404s everywhere" failure mode.
- **`domain_pack` is versioned.** wodwisdom pins `crossfit@3`; a new sport is a new pack id,
  not an Engine change. This is the "new sport = content effort" property, made real.
- **Engine is stateless about the surface's DB.** Input is `WriterPayload` (surface-built),
  output is `WriterOutput` (surface-persisted). The Engine owns only its job + corpus tables.

### Domain-Pack SPI (what `crossfit@3` implements)

```
getSystemPrompt(stage, input)     // coach_state | skeleton | week_fill | profile_analysis
getToolSchema(stage)              // the emit_* tool schema incl. block-type enum
getAudits()                       // rule set consumed by the generic audit-runner
getArchetypes(), getVocabulary()  // day types + canonical movement keys
getCorpusPlan(payload)            // the RAG query set + categories
getThresholds()                   // normative strength ratios / benchmarks
```

The Engine calls these; it never hardcodes a CrossFit string. Porting to Hyrox/football =
implement this SPI + author a corpus, with the control plane untouched.

---

## Sequencing (hardest coupling first)

1. **Corpus tenancy** (HIGH) — add `tenant_id` to the corpus table + retrieval predicate,
   even before extraction. Unblocks white-label and is the most expensive to retrofit.
2. **Model-profile indirection** (MEDIUM, quick win) — collapse the ~7 hardcoded model ids to
   one resolver. Do this now regardless; it also fixes the retirement-404 fragility.
3. **Batch job model** (MEDIUM) — `batch_id` on jobs; fan-out in the handler; teach the cron
   to enqueue a roster. Turns single-athlete into N-athlete.
4. **Domain-Pack SPI** (MEDIUM) — define the interface, move prompts/archetypes/audit-rules
   behind it. This is the actual "extraction" — mechanical once 1–3 exist.
5. **Audit rule/enum decoupling** (LOW–MED) — the runner is already generic; only the rules
   and block-type enum need to move into the Pack.

Do 1 and 2 first — they're the two that are cheap today and brutal later, which is exactly the
requirement driving this doc.
