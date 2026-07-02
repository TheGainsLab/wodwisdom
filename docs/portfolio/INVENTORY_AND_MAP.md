# TheGainsLab — Portfolio Inventory & Integration Map

_Last updated: 2026-07-01_

Backbone document for the portfolio/product strategy work. Three repos, cloned
side by side under `gainslab/`: `wodwisdom`, `crossfit-competition-service`,
`affiliate-intelligence`. Separate databases (three Supabase projects), one
owner, connected via service APIs.

Working model — three layers:
1. **Engine** — reusable audited-generation pipeline + structured domain model + RAG coaching.
2. **Domain Packs** — per-sport data/rules (CrossFit built; football/soccer/Hyrox/baseball candidates).
3. **Surfaces** — consumer app, gym/B2B, data services.

---

## The three repos at a glance

| | **wodwisdom** | **crossfit-competition-service** | **affiliate-intelligence** |
|---|---|---|---|
| Product name | The Gains Lab (B2C) | GAINS Data Service | Affiliate Intelligence (B2B) |
| What it is | AI coaching PWA for athletes | CrossFit competition data API | Gym-owner analytics dashboard |
| Stack | React 19 / Vite PWA + 68 Deno edge fns | Deno edge fns + SQL + Python (predictor/scraper) | React 19 / Vite + 1 Deno edge fn |
| DB | Postgres + pgvector, 54 tables | Postgres, `crossfit.*` schema | Postgres, tenancy schema |
| Supabase project | (its own) | `mtixkxugngwaculsihbl` | `gjkmxatyroyevezjzvyz` |
| Scale | 1811 commits, live | 182 commits; ~3.8M result rows, 85 comps, 2011–26 | 6 commits, v0.0.0 |
| LLM | Claude Sonnet 4.6 (+Haiku fallback), OpenAI embeddings | Claude (Tier-3 movement resolution only) | None |
| Maturity | **Live** (v1/v2 prod, v3 admin-testing) | **Live** for wodwisdom; dashboard RPCs WIP | **WIP** (v0 feature-complete, not wired to prod data) |

---

## Layer slotting

**Engine** (reusable generation/audit/RAG) — lives **only inside wodwisdom**, not extracted:
- Generic & portable: `_shared/rag.ts` (pgvector), `call-claude.ts` (retry/fallback),
  `audit-runner.ts` + `audits.ts` (structural verification),
  `build-writer-payload.ts` / `build-rag-context.ts` (orchestration).
- **CrossFit-locked:** `archetype-specs.ts` (5 hardcoded day types), `movementVocab.ts`,
  `metconScoring.ts`, coaching prompts full of CrossFit terminology.
- Verdict: pipeline is generic, domain model is 100% CrossFit-coupled. A new sport is
  not a config flip today — it's new archetypes + movement library + re-curated RAG corpus.

**Domain Pack (CrossFit)** — **split across two repos**:
- wodwisdom owns: training archetypes, programming movement vocab, coaching heuristics.
- data service owns: competition results, movement biomechanics, work/power physics,
  percentile curves, canonical movement vocabulary.

**Surfaces:**
- wodwisdom PWA (B2C athlete) — live.
- affiliate-intelligence (B2B gym owner) — WIP.
- Competition dashboard for athletes/coaches — planned; backend endpoints exist in the
  data service, no frontend repo yet.

**Data layer:** crossfit-competition-service is the genuine shared backbone.

---

## Hypotheses — both CONFIRMED

**H1: the competition service is a data service wodwisdom's Competition History consumes.** ✅
wodwisdom proxies it via `COMPETITION_SERVICE_BASE_URL` + `X-Service-Key` through
`competition-catalog`, `search-competition-athletes`, `verify-competition-athlete`,
`competition-placement`, `log-throwback`, `compute-benchmarks`, `stage-power-curve-cache`.
`programming-profile/{id}` feeds competition history into program generation (Tier-4).
Caveat: still **admin-gated** in wodwisdom (`ATHLETEDATA_PUBLIC_TIER` not flipped).

**H2: affiliate-intelligence is a gym-facing B2B/data product.** ✅
A $49/mo gym-owner portal whose single edge fn fans out to **8 dashboard RPCs that live
in the data service** (`dashboard_panel_1a…5`). Owns its own auth/tenancy/Stripe schema;
zero LLM; pure analytics surface.

---

## Who-consumes-whom

```
                    ┌───────────────────────────────┐
                    │  crossfit-competition-service  │  ← shared data backbone
                    │  (GAINS Data Service)          │
                    └───────┬───────────────┬────────┘
        HTTP API +          │               │   service-role RPCs
        X-Service-Key       │               │   (dashboard_panel_1a…5)
                            ▼               ▼
              ┌──────────────────┐   ┌────────────────────────┐
              │    wodwisdom     │   │  affiliate-intelligence │
              │  (B2C athlete)   │   │    (B2B gym owner)      │
              └──────────────────┘   └────────────────────────┘
                    ▲
                    │  Engine (gen/audit/RAG) is TRAPPED in here —
                    │  no external consumers, not a service
```

1. **The data service is already a real shared service** — versioned headers
   (`X-Api-Version`), a `consumer_keys` registry (SHA-256 + salt), per-consumer rate
   limits. This is the "product A is a customer of product B" discipline, already
   implemented for the data layer. It is the template for exposing the Engine.
2. **Two integration styles into the same service:** wodwisdom uses the versioned HTTP
   API; affiliate uses direct service-role RPCs. Same backend, two contracts. Being
   unified (see migration workstream).

---

## Overlaps & duplication (consolidation targets)

- **Movement vocabulary exists twice** — wodwisdom's `movements` table + `movementVocab.ts`
  and the data service's canonical `movements`/`movement_biomechanics`. Drift risk;
  should be one source of truth.
- **Work/power & benchmarks partially duplicated** — data service owns `work-calc` +
  `stage_power_curve`; wodwisdom's `compute-benchmarks` proxies it, but `PERFORMANCE_FACTORS`
  (hardcoded 30% guess in `metconScoring.ts`) is still a local fallback. One physics/benchmark
  authority should win.
- **Customer/billing/tenancy plumbing built 2–3 times** — wodwisdom (Stripe + `user_entitlements`),
  affiliate (Stripe + `communities`/`community_members`), plus wodwisdom's embryonic
  `gyms`/`gym_members`. "Who owns gym-as-customer" is unresolved. Decision: affiliate is
  the gym home; wodwisdom's gym tables are being frozen (see workstream).
- **The Engine has no seam at all** — the one layer with no service boundary.

---

## Integration seams (state of each)

| Seam | Status | Contract |
|---|---|---|
| wodwisdom → data service | Live (public tier admin-gated) | HTTP + `X-Service-Key`, versioned |
| affiliate → data service | Wired, awaiting prod creds | service-role RPCs → **migrating to versioned HTTP** |
| affiliate → Engine (programming) | Not built | roadmap M3+ |
| Engine → any consumer | **Does not exist** | Engine internal to wodwisdom |
| gym/tenancy (wodwisdom ↔ affiliate) | Overlapping → **freezing wodwisdom side** | affiliate becomes gym home |

---

## Implications for the strategy phase

The map validates the **one-company, layered (data → engine → surfaces) with clean
service APIs** thesis, with three refinements:

1. **The data layer already proves the model** — the `consumer_keys`/versioned-API
   discipline is the pattern to replicate, not invent. Extend what works to the Engine.
2. **"Extract the Engine" is two moves:** (a) lift generation/audit/RAG out of wodwisdom
   as a sport-agnostic core with its own API, and (b) resolve the CrossFit Domain Pack
   currently split between wodwisdom and the data service. A clean Domain Pack is the
   precondition for "new sport = content effort."
3. **Decide where "gym" lives** before it forks further — resolved: affiliate is the gym
   home; wodwisdom gym tables frozen.

---

## Active consolidation workstreams (kicked off 2026-07-01)

- **Engine extraction** — design doc: `ENGINE_EXTRACTION.md`. Contract must anticipate
  per-tenant methodology corpus (white-label RAG) and multi-athlete batch generation
  (gym individualization).
- **Affiliate → data-service versioned API** — replace 8 service-role RPCs with versioned
  HTTP endpoints (one contract, N consumers).
- **Freeze wodwisdom gym tables** — mark deprecated, no new writes; affiliate becomes the
  gym home.
- **Competition History flip-the-gate audit** — what stands between `ATHLETEDATA_PUBLIC_TIER`
  and shipping publicly. See `FLIP_THE_GATE_AUDIT.md`.
