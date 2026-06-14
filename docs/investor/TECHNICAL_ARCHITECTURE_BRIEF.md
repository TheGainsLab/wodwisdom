# The Gains Lab — Technical Architecture Brief

> Prepared for technical diligence. This document describes the system as built.
> Business/traction figures are marked **[FILL IN]** for you to complete.

---

## 1. Executive Summary

The Gains Lab is an **AI-native coaching platform** for functional-fitness and
CrossFit athletes. It is not a single feature but **five products on shared
infrastructure**: AI Coach (conversational coaching), AI Programming (automated
program generation), Year of the Engine (adaptive conditioning), AI Nutrition,
and Competition History.

The core technical thesis: **AI output in fitness is only valuable if it can be
trusted.** The platform's defensible asset is a multi-stage, *deterministically
audited* AI generation pipeline that verifies machine-written training programs
against hard domain rules — including the athlete's actual strength numbers —
before an athlete ever sees them.

**Scale of the codebase as built:**

| Metric | Value |
|---|---|
| Application code | ~68,000 lines TypeScript / React |
| Backend functions | 68 serverless edge functions |
| Database tables | 54 |
| Row-level-security policies | 131 |
| Schema migrations | 150 |
| Live customers | **[FILL IN]** |
| MRR / ARR | **[FILL IN]** |

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────┐
│  CLIENT — React 19 + TypeScript, installable PWA           │
│  Mobile-first, offline sync, barcode scanning, charts      │
└───────────────┬───────────────────────────────────────────┘
                │ HTTPS / Supabase client (JWT auth)
┌───────────────▼───────────────────────────────────────────┐
│  EDGE LAYER — 68 Deno serverless functions                 │
│  AI orchestration · parsing · billing · analytics · admin  │
└───────┬───────────────────────┬───────────────┬───────────┘
        │                       │               │
┌───────▼────────┐   ┌──────────▼──────┐  ┌──────▼─────────┐
│ Postgres       │   │ Anthropic Claude│  │ Stripe         │
│ + pgvector RAG │   │ Sonnet 4 /      │  │ billing +      │
│ 54 tables,     │   │ Haiku 4.5       │  │ entitlements   │
│ 131 RLS policies│  │ + OpenAI embeds │  │ webhooks       │
└────────────────┘   └─────────────────┘  └────────────────┘
```

**Stack rationale (capital-efficiency angle):**

- **Serverless edge functions + managed Postgres (Supabase).** Scales
  horizontally with usage; near-zero fixed infrastructure cost. No idle
  servers to pay for.
- **PWA, not native apps.** Installable on phones with offline support —
  reaches mobile users **without app-store gatekeeping or 15–30% platform
  fees**, and ships updates instantly.
- **Stripe + a decoupled entitlements layer.** "What a user can do" is
  separated from "what they're billed for," so products can be bundled,
  trialed, comped, or sold independently without touching billing code.

---

## 3. The AI Pipeline — the core moat

Most AI fitness products are a single prompt to an LLM. The risk: an LLM will
confidently prescribe unsafe or incoherent training. This platform treats
generation as an **engineered, self-correcting pipeline** with deterministic
verification.

### Program generation (`generate-program-v2` / `v3`)

1. **Build writer payload** — assemble the athlete's structured profile
   (1RM lifts, skills, conditioning, injuries/constraints, goals).
2. **Skeleton writer** — Claude drafts a 4-week structural skeleton.
3. **Skeleton audits** — deterministic checks; violations are fed back and the
   skeleton is regenerated (up to N attempts) until it passes.
4. **Full program writer** — Claude fills the skeleton to movement level.
5. **Deterministic audit suite (7 pure-function rules)** — including:
   - Block-type validity
   - One-primary-lift-per-strength-block
   - Required-field existence
   - Day-count / structural integrity (no duplicates)
   - **Load sanity — prescribed weight ≤ athlete's actual 1RM**
   - **Movement-vocabulary compliance** (only known, catalogued movements)
6. **LLM-mediated safety review** — an 8th, async review pass.
7. **Recovery loop** — programmatic fixes first, then *surgical block rewrites*
   feed specific violations back to the model rather than regenerating the
   whole program.
8. **Persist** versioned output to the program tables.

The significance: **bad machine output is caught by code, not by hope.** This
is hard to replicate, improves with every rule added, and directly answers the
"is AI-generated training safe?" diligence question.

### Conversational coaching (`chat`) — grounded RAG

- Queries are embedded (OpenAI `text-embedding-3-small`) and matched against a
  **proprietary methodology corpus** stored as vectors in pgvector.
- Retrieved passages are woven into answers **with attribution**; when
  retrieval is weak, the model answers from methodology without fabricating
  sources. Strict anti-hallucination and in-character constraints are enforced
  in the system prompt.
- Personalized with the athlete's own profile and recent training history.

### Cost engineering (unit-economics discipline)

- **Haiku 4.5 fallback** under load / for cheaper tasks; Sonnet 4 for
  high-stakes generation.
- Embedding reuse, budget-aware prompts, request timeouts, exponential-backoff
  retry, and graceful degradation (RAG returns empty rather than failing).
- **Async job architecture** (`program_jobs` + polling + cron-driven monthly
  regeneration) so long generations never block the UI and can be rate-managed.

---

## 4. The Data Moat — a structured domain model

The AI is not asked to "know fitness." The domain is **encoded**:

- A **movements library** with modality, category, aliases, and work-rates.
- **Time-domain inference**, load bands, and **per-athlete benchmark
  computation**.
- A curated **methodology knowledge base** (vectorized for RAG).
- Structured athlete profiles: 1RMs, skills, conditioning, structured
  injuries/constraints, goals.

This structured layer is what makes the audits possible and the coaching
specific. It compounds in value and is slow for a generic competitor to
reproduce.

---

## 5. The Data Flywheel

```
Athlete logs workout
        │
        ▼
Analytics + performance metrics  ──►  Profile re-evaluation
        │                                     │
        ▼                                     ▼
Adaptive targets (e.g. Year of the    Better personalized
Engine recalibrates pace to recent    programming + coaching
performance)                                  │
        │                                     │
        └──────────────►  Retention  ◄────────┘
                              │
                   More usage → more data → better output
```

A human-in-the-loop **admin evaluation/rating system** lets the team grade AI
output and improve quality over time — an RLHF-style quality loop on top of the
automated audits.

---

## 6. Security, Multi-Tenancy & Trust

- **131 row-level-security policies** enforce per-user data isolation at the
  database layer (not just the app layer).
- **Entitlement writes are server-side only** — clients can read their access
  but cannot grant themselves features.
- **Cloudflare Turnstile CAPTCHA + spam-signup detection** already shipped to
  defend signup/auth flows.
- Stripe webhooks reconcile billing state to entitlements server-side.

---

## 7. Scalability & Operational Maturity

- **Horizontal scaling** via stateless edge functions + managed Postgres.
- **150 migrations** evidence disciplined, continuous schema evolution — a
  proxy for execution velocity from a small team.
- **Feature flags** and entitlements allow staged rollouts.
- **Cron-driven monthly program regeneration** runs the platform's heaviest
  workload off the critical path.
- Versioned generation pipeline (v2 → v3) shows the team can evolve the core AI
  system without disrupting existing users.

---

## 8. Key Technical Risks & Mitigations (proactive)

| Risk | Current mitigation | Notes for investors |
|---|---|---|
| LLM provider dependency (Anthropic/OpenAI) | Model abstraction + Haiku fallback already in place | Multi-provider abstraction is a tractable next step |
| Per-user AI cost at scale | Model tiering, caching, budget-aware prompts | Margins improve as cheaper models absorb more tasks |
| AI output safety | Deterministic audit suite + safety review | The platform's strongest differentiator |
| Single-engineer / key-person risk | **[FILL IN — team plan]** | Codebase is well-structured and migration-disciplined |

---

## 9. Where Capital Accelerates the Technology

**[FILL IN — tailor to your raise.] Candidate technical use-of-funds:**

- Multi-provider model abstraction + further unit-cost reduction.
- Expand the audited-generation approach to more products / sports.
- Deepen the data flywheel (automated quality scoring, personalization models).
- Mobile-native wrappers if app-store distribution becomes worthwhile.
- Engineering hires to reduce key-person risk and increase velocity.
