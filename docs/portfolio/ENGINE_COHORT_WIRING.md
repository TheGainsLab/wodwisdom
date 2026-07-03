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
+ an `athletes[]` roster (ENGINE_API_CONTRACT). **`buildGymCohortEnvelope(config, vocabulary, nowIso)`**
is the minimal gym-level payload builder that produces the envelope from a small
`GymCohortConfig` (days/week, session length, equipment, target level, do-not-program,
units). It:

- synthesizes a **reference class-target** athlete (reference bodyweight × per-lift
  strength-standard multipliers, scaled by `target_level` — a transparent, tunable
  method, not fabricated absolute numbers) and runs it through the **real**
  `buildAthleteModel`, so the shared program is generated from the exact same input
  shapes as retail (no parallel path that could drift);
- attaches a **fixed, deterministic coaching strategy** (conditioning-forward,
  balanced-strength — GYM_SKU_SPEC §1: the Engine Class is a shared cardio class,
  NOT individually adaptive), so **no LLM coach-state call** is needed for the target.

**`buildCohortRoster(members, nowIso)`** maps each active member's light intake
(`member_gym_links.engine_intake`) into the slim `AthleteInput` the cohort scaler
reads (`payload.lifts`, `basics.{units,gender}`, `do_not_program`). The rest of the
contract-required `WriterPayload`/`TrainingDesignInput` is cheap valid defaults — the
full per-member payload is contract debt the phase report flagged; a slim
`CohortMemberInput` is the #548 follow-up.

Both builders are **pure + DB-free + unit-tested** (`cohort-builders_test.ts`,
including an end-to-end deterministic-scaling assertion: 70 % × 300 lb → 210 lb,
a do-not-program movement → `needs_substitution`).

## The monthly cron

`gym-cohort-cron` (reuses the `monthly-generation-cron` pattern: `verify_jwt=false`,
service-role, pg_cron-triggered) picks the **most-due active gym** from
`gym_cohort_configs` (never-generated first; regenerate when null or 30 d+ old),
builds the envelope + roster, runs the Engine cohort pipeline in-process, persists
via `persistCohortResult`, and stamps `last_generated_at`.

- **Wall-clock:** cohort generation is ONE LLM program (~200 s) + N deterministic
  scalings. The cron does **one gym per invocation** to stay under the edge
  wall-clock; schedule it frequently (e.g. hourly) so a fleet drains over time. The
  resumable dispatcher (as `generate-program-v3` uses) is the scale path — not
  needed at pilot scale.
- An **empty roster still generates the shared program** (so F5's read-only view has
  a class workout to show before any seat is active).

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

- Apply migration `20260703200000` (SQL editor) + reload the PostgREST schema.
- Deploy `gym-cohort-cron` (+ `engine-generate`, which now imports the shared
  `persistCohortResult`).
- Schedule `gym-cohort-cron` via pg_cron (e.g. hourly).
- Seed / have the affiliate populate `gym_cohort_configs` for the pilot gym.
- (On-demand path only) set `ENGINE_CONSUMER_KEYS` on `engine-generate` per above.
