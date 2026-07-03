# Gym Cohort Program Wiring (task #5)

_2026-07-03. How a gym's Engine Class program is generated monthly. Wodwisdom-side
wiring on top of the Phase-1 Engine (cohort mode) + the F2/F3 roster. Companion to
ENGINE_API_CONTRACT.md and ENGINE_PHASE1_REPORT.md §b (F2/F3/F7 coverage)._

## The pieces (all wodwisdom-side)

| Piece | Where |
|---|---|
| Gym cohort payload builder | `_shared/cohort/build-gym-cohort-envelope.ts` |
| Cohort roster builder | `_shared/cohort/build-cohort-roster.ts` |
| Cohort persistence (shared) | `_shared/cohort/persist-cohort-result.ts` (also used by `engine-generate`) |
| Per-gym config | `gym_cohort_configs` table (migration `20260703200000`) |
| Monthly regeneration | `gym-cohort-cron` edge fn |

## The cohort envelope

`engine-generate` (mode `cohort`) consumes `{ shared_payload, shared_training_design_input }`
+ an `athletes[]` roster (ENGINE_API_CONTRACT). **`buildGymCohortEnvelope(config, vocabulary, nowIso, { rag })`**
is the minimal gym-level payload builder that produces the envelope from a small
`GymCohortConfig` (days/week, session length, equipment, target level, do-not-program,
units). It:

- synthesizes a **reference class-target** athlete whose 1RMs derive from the
  **canonical strength tables** (`THRESHOLDS_V1` in `athlete-model.ts`) scaled by
  `target_level` — anchored on the back-squat relative-strength bar, with the
  squat/oly family derived from the canonical inter-lift ratios — so the reference
  athlete is **self-consistent** (it never ratio-flags itself) and there is no fourth,
  conflicting standards table. It runs through the **real** `buildAthleteModel`, so the
  shared program is generated from the exact same input shapes as retail;
- attaches a **fixed, deterministic coaching strategy** as the `TrainingDesignInput`
  directly (conditioning-forward, balanced-strength — GYM_SKU_SPEC §1: the Engine
  Class is a shared cardio class, NOT individually adaptive), so **no LLM coach-state
  call** is needed for the target;
- attaches the **RAG methodology block** (`buildRagContext`, built by the cron from the
  same reference lifts) so the gym channel's flagship program is grounded in the same
  corpus every retail program gets — not `rag: ""`.

  > **Debt (#548):** the shared-class strategy is CrossFit coaching judgment living in
  > the Engine-side surface (same altitude problem as the #547 `ruleRecap` finding).
  > When `domain_pack` becomes genuinely multi-sport it belongs ON the pack (a
  > `cohortStrategy` seam), filed to #548 with the ruleRecap items.

**`buildCohortRoster(members, nowIso)`** maps each active member into the slim
`AthleteInput` the cohort scaler reads (`payload.lifts`, `basics.{units,gender}`,
`do_not_program`), reusing retail's `asLiftValue` coercion so a member's resolved
weights follow the exact same rule, and **dedupes by `athlete_ref`** (first wins) so a
duplicate can't collide on `engine_member_scaling`'s UNIQUE after a paid generation.
Member attributes are sourced from the **ONE PROFILE** — see next section.

Both builders are **pure + DB-free + unit-tested** (`cohort-builders_test.ts`:
end-to-end deterministic scaling 70 % × 300 lb → 210 lb; empty roster; zero/negative/
non-finite lift coercion; dedup; canonical-ratio self-consistency).

## ONE PROFILE — where member attributes come from (Decision 1)

Athlete attributes live **only** in wodwisdom `athlete_profiles`; every surface reads
it and writes through to it. Two consequences here:

- **F3 intake writes through** (`engine-join`): a joining member's `bodyweight/gender/
  units` and any captured **key lifts** (2–3 optional canonical lifts — back_squat /
  deadlift / press cover most cohort prescriptions) are merged into `athlete_profiles`
  (never regressing a fuller retail profile). `member_gym_links.engine_intake` is a raw
  capture snapshot only — it is **not** the scaling source.
- **The roster sources the profile, not a per-surface copy**: the cron reads
  `athlete_profiles` (lifts, bodyweight, gender, units, `injuries_structured.
  do_not_program`) for the joined+entitled members and passes those to
  `buildCohortRoster`. A member with no captured lifts scales to bare percentages; the
  cron response reports `members_with_weights` so silent degradation of the flagship
  feature is visible.

## The cron

`gym-cohort-cron` (`verify_jwt=false`; **gated on an `X-Cron-Key` header** against
`GYM_COHORT_CRON_KEY` — a stray POST here is a paid LLM run + a duplicate program, so
unlike `job-reaper` the endpoint is **not** open) runs the flow for **one gym per
invocation** and drains a fleet across ticks:

- **Atomic claim:** `claim_due_gym_cohort()` (the repo's `claim_program_stage` idiom —
  `FOR UPDATE SKIP LOCKED` + stamp `last_attempt_at`) hands back the most-due eligible
  gym, so an overlapping invocation (pg_cron double-fire, retry, manual trigger during
  the ~200 s run) can't select and double-generate the same gym.
- **Reads abort before spend:** every DB read (vocabulary, entitlements, links,
  profiles) is error-checked; a real read error records a backoff and returns 500
  **before** the LLM run — a failed read costs one retry, never a broken program
  stamped success and locked 30 days.
- **Poison-gym backoff:** on failure the gym gets `next_attempt_at = now + backoff`
  (30 m → 24 h, exponential) so a persistently-failing gym (e.g. an unregistered
  `domain_pack`) rotates to the back of the queue instead of starving the fleet
  head-of-line every tick. `domain_pack` also has a **format CHECK** so a malformed id
  can't be written.
- **Drain:** after a successful run it **fire-and-forget self-reinvokes** (same
  `X-Cron-Key`) so a burst of due gyms drains within a tick while each run keeps the
  one-gym wall-clock budget. Schedule the cron **hourly** (drain frequency); the
  **per-gym cadence is monthly** (regenerate when `last_generated_at` is null or 30 d+).
- An **empty roster still generates the shared program** (F5's read-only view needs a
  class workout before any seat is active) — the empty-roster rule is enforced in ONE
  place (`validateEngineRequest`, shared by the HTTP door and the cron).

## Continuity (v1 limitation — KNOWN, not silent)

The cron sends `previous_cycle: null` every month: each month is an **independent
re-generation** from byte-identical deterministic inputs, so the only cross-month
variation is LLM sampling. **v1 has no programmed progressive overload across months.**
This resolves ENGINE_API_CONTRACT open question #3 (re-derive), and is a planned
feature — wiring the prior month's summary into the cohort envelope is tracked to #548,
not a surprise redesign. GYM_SKU_SPEC §1 carries the same caveat so the spec stops
promising what the code doesn't yet do.

## `gym_cohort_configs` — who populates it

The **affiliate portal** owns the gym's class config (equipment inventory, class
days/length, target level). Populating `gym_cohort_configs` is the **affiliate-team
half** of this wiring: when a class goes LIVE, the portal upserts the row via a
consumer-keyed wodwisdom endpoint (to be built affiliate-side). For the pilot it can
be seeded directly. `gym_id` is the affiliate community id (the tenant).

## ENGINE_CONSUMER_KEYS — issuing the first consumer key

The Engine's `engine-generate` auth (`_shared/consumer-auth.ts`) supports an
`ENGINE_CONSUMER_KEYS` env map — `{ "<key>": "<tenant>" | ["<t1>", …] }` — where a
consumer key may write ONLY its bound tenant(s). The gym channel is the Engine's
**first external consumer**. To issue the pilot's key:

1. Generate a strong key (≥16 chars; e.g. `openssl rand -hex 24`).
2. On the `engine-generate` function, set:
   ```
   ENGINE_CONSUMER_KEYS = {"<generated-key>": "<pilot gym community id>"}
   ```
   (JSON object; keys shorter than 16 chars are rejected as misconfig. Multiple
   gyms → bind the key to an array of their community ids, or issue one key per gym.)
3. The portal calls `POST engine-generate` with `X-Service-Key: <generated-key>` and
   `tenant_id = <pilot gym community id>`; a mismatched tenant → 403.

**v1 note:** the monthly cron generates **in-process** (wodwisdom → wodwisdom Engine
pipeline), so it needs **no** consumer key. `ENGINE_CONSUMER_KEYS` is only for the
portal-triggered **on-demand** HTTP path (e.g. a "regenerate this month" button).
When the portal uses that path, it must send the full cohort envelope — or wodwisdom
exposes a spec-based endpoint that runs `buildGymCohortEnvelope` server-side (the
cleaner long-term shape, so the portal stays thin). Deferred until the portal needs
on-demand generation; the cron covers the monthly cadence today.

## Deploy checklist (founder)

- Apply migration `20260703200000` (SQL editor) + reload the PostgREST schema. It adds
  the backoff columns (`last_attempt_at/attempt_count/next_attempt_at`), the
  `domain_pack` format CHECK, the NULLS-FIRST partial index, the `updated_at` trigger,
  and the `claim_due_gym_cohort()` function.
- **Set `GYM_COHORT_CRON_KEY`** (a strong secret; e.g. `openssl rand -hex 24`) on the
  `gym-cohort-cron` function. The cron **fails closed** without it (500 `config_missing`).
- Deploy `gym-cohort-cron` (+ `engine-generate`, which now imports the shared
  `persistCohortResult`).
- Schedule `gym-cohort-cron` via pg_cron **hourly**, passing the header, e.g.:
  ```sql
  select cron.schedule('gym-cohort-regen', '0 * * * *', $$
    select net.http_post(
      url    := '<project>.supabase.co/functions/v1/gym-cohort-cron',
      headers:= jsonb_build_object('X-Cron-Key', '<GYM_COHORT_CRON_KEY>', 'Content-Type', 'application/json'),
      body   := '{}'::jsonb
    );
  $$);
  ```
- Seed / have the affiliate populate `gym_cohort_configs` for the pilot gym.
- (On-demand path only) set `ENGINE_CONSUMER_KEYS` on `engine-generate` per above.
