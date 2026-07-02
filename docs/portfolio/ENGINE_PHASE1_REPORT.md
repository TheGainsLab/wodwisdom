# Engine Phase 1 — Implementation Report

_2026-07-02. Branch `claude/engine-phase1`. Companion to ENGINE_EXTRACTION.md,
ENGINE_API_CONTRACT.md. Docs-follow-reality: divergences from the plan are flagged
here rather than silently "fixed"._

## What shipped

| Task | Status | Where |
|---|---|---|
| Engine entrypoint (contract) | **Built** | `engine-generate/` + `_shared/engine/{contract,run-engine}.ts` |
| Pipeline extraction (wodwisdom consumes it) | **Built, behavior-preserving** | `_shared/engine/pipeline.ts`; `generate-program-v3` imports it (1163→688 lines) |
| CrossFit domain pack v1 | **Built** | `_shared/domain-packs/{types,registry,crossfit}` — engine imports the pack, never the sport (type-only sport imports, erased) |
| Cohort mode (deterministic scaling) | **Built** | `_shared/engine/cohort.ts` + `ScalingResult` |
| Scaling persistence (F10 raw material) | **Built** | migration `20260702000000_engine_cohort_scaling.sql` |
| Model migration (remaining hardcoded ids) | **Built — full coverage** | 16 files onto `MODELS.*` (task said ~14; true count 16) |

`deno check` clean on every new/edited `_shared` + `engine` + `domain-packs` module.
Edge-function `index.ts` files can't be checked in this env (the Supabase
`edge-runtime.d.ts` → `npm:openai` resolution fails locally, pre-existing); they were
verified by dangling-reference scans + the fact that call sites are unchanged.

## Divergences from the plan (flagged, not improvised)

1. **Engine core starts at the skeleton, not raw payload.** The task's pipeline
   description ("payload → skeleton → …") skips coach-state, and coach-state
   generation is DB-coupled (reuse-cache + persist to `coach_states`). So the
   coaching-strategy layer (coach-state → `TrainingDesignInput`) stays surface-side
   and each `AthleteInput` carries a `training_design_input`. This matches the locked
   coaching-state architecture (strategy is a persisted object; the Engine is the
   Training-Design/execution layer). ENGINE_API_CONTRACT.md updated to match.
2. **`engine-generate` is synchronous with a single `ENGINE_SERVICE_KEY`.** The
   contract's 202 + async job model and per-consumer keys are **not** built here —
   wodwisdom's heavy resumable path already lives in `generate-program-v3`'s
   dispatcher; the standalone async job model + consumer-key auth are Phase 4. Heavy
   *adaptive* batch (many independent programs) can approach the edge wall-clock in
   v1. Cohort batch does NOT (one generation + N deterministic scalings).
3. **`corpus_scope` + `model_profile` are accepted but not yet threaded** into the
   pipeline. RAG is baked into the payload upstream (surface-side `buildRagContext`,
   which already accepts `corpusTenants` from the Phase-1 corpus migration), and the
   pipeline uses the default model profile. The fields are reserved so callers don't
   change later. See the F7 note below.
4. **Cohort substitutions are flagged, not resolved.** The deterministic scaling is
   complete and LLM-free (the requirement). Movements in a member's `do_not_program`
   are flagged `needs_substitution`; the AI substitution pass (per-member injury
   adaptation) is the documented next step, not built in v1.
5. **Domain-pack residual.** The pack covers writer prompts/tools, audits, recovery,
   and safety. The *coaching-strategy* content (FocusAreas, coach-state prompt, tdi
   projection) and the competition/physics benchmark data are still outside the pack
   (surface-side / data-service). This matters for a new sport — see (a) below.

---

## (a) Hyrox domain pack — concrete gap list

The `DomainPack` interface is **necessary but not sufficient** for Hyrox. To ship
`hyrox@1`, in rough dependency order:

1. **Skeleton + week-fill prompts** — rewrite for Hyrox periodization (run volume,
   station strength-endurance, compromised running, transitions, taper). New pack
   `writer.skeletonSystemPrompt` / `weekFillSystemPrompt`. *(pack-covered)*
2. **Block-type vocabulary + tool schemas** — the emit_skeleton/emit_week tools and
   `SkeletonOutput` block types are CrossFit-shaped (strength/metcon/skills/accessory).
   Hyrox needs run-interval / station-work / compromised-run block types. New
   `buildSkeletonTool` / `buildWeekTool` in the pack + a Hyrox output schema. *(pack-covered, but the schema is shared code today — see risk)*
3. **Skeleton audits** — `v3-skeleton-audits` hardcodes "every day has strength +
   accessory + metcon" (CrossFit). Hyrox needs its own coverage/sequence audits.
   *(pack-covered via `audits.runSkeleton`)*
4. **Hard/recovery audits** — the metcon rules (`metcon_one_piece`,
   `metcon_monostructural`, `metcon_barbell_loads`) don't apply; Hyrox needs
   station-pacing / compromised-run rules. *(pack-covered via `audits.runHard` +
   `recovery.surgicallyRewriteBlock`)*
5. **Coaching-strategy layer (NOT pack-covered today)** — FocusAreas
   (`olympic_lifting`, `gymnastics_*`) and the coach-state prompt are CrossFit. Hyrox
   focus areas are running economy, station strength-endurance, transitions. This
   lives surface-side (coach-state → tdi), *upstream* of the pack. **Gap: the pack
   interface must extend to the coaching-strategy layer, or Hyrox needs a parallel
   surface-side strategy builder.** This is the biggest structural gap.
6. **Benchmark data (data-service dependency)** — `attachBenchmarks` reads CrossFit
   competition percentiles/physics. Hyrox benchmarking needs a Hyrox results dataset
   ingested into the data service. The joules/watts physics model transfers (sled
   push = force × distance); the *cohort reference data* does not. **Gap: upstream
   data ingestion.**
7. **Movement vocabulary** — sled push/pull, sandbag lunges, farmers carry, wall
   balls, run — partial overlap with CrossFit vocab; needs a Hyrox vocab set (loads,
   distances). Consumed at payload-build (surface-side) + audits.

**Verdict:** the pack seam handles ~4 of 7 (prompts, tools, audits, recovery). The
two hardest — the coaching-strategy layer and benchmark data — are *outside* the
current pack boundary. The extraction is real but incomplete for "new sport = pure
content"; extending the pack to the coaching-strategy layer is the priority follow-up.

### Pack-seam holes (Engine core still sport-coupled)

Beyond the seven above, the Engine *core* still hardcodes CrossFit content that a
Hyrox pack could not override without touching core files. Tracked for the seam
follow-up (see the follow-up issue):

- **`ruleRecap` strings** — the skeleton + week-fill user messages (`pipeline.ts`)
  embed CrossFit programming-rule recaps inline. Hyrox needs different rules; these
  belong in the pack (e.g. `writer.ruleRecap`), not the core message builder.
- **Hardcoded `emit_skeleton` / `emit_week` tool names** — `pipeline.ts` names the
  tools and matches the `tool_use` block by literal name. The pack supplies the tool
  *schema* but not its *name*; a pack with differently-named tools breaks. Move the
  tool name onto the pack alongside `buildSkeletonTool` / `buildWeekTool`.
- **Slim cohort member shape** — cohort scaling only reads `lifts`, `basics`, and
  `injuries_structured.do_not_program`, but `AthleteInput` carries the full
  `WriterPayload` + `TrainingDesignInput` per roster member. A slim `CohortMemberInput`
  would shrink the F7 request and clarify the contract.
- **Recovery-loop drift** — `run-engine.ts` re-implements v3's recovery-loop *policy*
  (already subtly diverged). Extract one shared loop so the standalone Engine and the
  wodwisdom dispatcher can't drift.

*Closed by the cohort-correctness fix (PR #547):* the `ALL_LIFT_KEYS` runtime sport
import and the hardcoded plate increments are now pack content (`scaling.displayToLiftKey`
/ `scaling.loadIncrement`); the cohort scaler imports no sport module.

---

## (b) Portal Phase-1 dependency coverage

Per GYM_PORTAL_FLOWS.md "Dependencies on Phase 1":

**F2/F3 — cohort `ScalingResult`: COVERED.**
`computeCohortScaling` produces the per-member `ScalingResult` (deterministic
`round(target_pct_1rm × member 1RM)`, `needs_substitution` flags, gender tier),
persisted queryably to `engine_member_scaling`. Caveats: (i) substitutions are
flagged, not AI-resolved (v1); (ii) leaderboard tier is gender only here — modality
is per-workout and set at leaderboard time (F4), not per-member.

**F7 — `athletes[]` batch + `tenant_id` corpus: COVERED with one flagged seam.**
- `athletes[]`-always-array + `tenant_id`: **covered** in the contract. The gym
  Programmer's all-or-nothing roster personalize (F7) is **cohort mode** — one shared
  gym program + N deterministic scalings — which is the cheap path (not N adaptive
  generations). Good fit; no wall-clock concern.
- **tenant corpus — flagged seam:** the Phase-1 `corpus_tenant_scope` migration +
  `buildRagContext(corpusTenants)` make tenant-scoped RAG possible, but that happens
  at **payload build (surface-side)**, not inside the Engine. The Engine request
  carries `corpus_scope` for a future direct-RAG Engine, but in v1 the surface must
  build each payload with the gym's `tenant_id` corpus scope. **Not a defect — a
  boundary:** whoever builds the gym's `WriterPayload` (the F6/F7 methodology path)
  must pass the gym `tenant_id` into `buildRagContext`. Flagging so F7's build wires
  it rather than assuming the Engine does.

**F10 — per-member scaling/logging persisted queryably: COVERED.**
`engine_member_scaling` is a real table (not a rendered artifact): per-member
`scaled_movements` jsonb + `substitutions_pending` + `tier`, indexed by
`(tenant_id, athlete_ref)`. Linkage to logged results is the `athlete_ref` → 
`workout_logs` join (documented on the table; no FK, since athlete_ref is an opaque
cross-surface id). The F10 feed (PR / stall / quiet-member) builds on this in 2b.

**No mismatch requiring an improvised fix.** The one thing to carry into 2b: F7's
payload build must pass the gym `tenant_id` as the corpus scope (the seam above).
