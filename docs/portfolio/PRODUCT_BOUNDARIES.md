# Decision 11 — Product Boundaries (founder, 2026-07-12)

Three products. One generator. Hard boundaries between them.

This decision SUPERSEDES the cross-surface scope of Decision 1 ("ONE PROFILE —
every surface reads it") and closes out the Engine Class framing that Decision
9(i) parked. Code comments citing those decisions as authority for gym-side
profile reads are superseded by this document.

## The three products

1. **Retail** — wodwisdom sold directly to an athlete. The athlete profile
   (`athlete_profiles`: lifts, bodyweight, equipment, avoid-list, goals, intake)
   belongs to THIS relationship and no other.

2. **Per-seat distribution (Engine, Nutrition)** — a gym buys seats through the
   affiliate service; a member claims a seat (P2a token flow) and consumes the
   RETAIL surfaces directly (`gym_engine` / `nutrition` entitlements, months
   drip). Distribution changes who PAYS, not what data anyone sees. A seat
   grants access; it does not grant the gym any view into the member's profile.

3. **Gym program generation** — the gym (affiliate member) generates a program
   for the gym using the wodwisdom generator. Inputs are GYM-LEVEL ONLY:
   `gym_cohort_configs` (days/week, session length, equipment, target level,
   gym do-not-program list, goal text, strategy). The generator generates; it
   does not source athlete data.

**Engine Class is not a product.** There is no class roster, no per-member
cohort scaling, no class leaderboard/TV, no class join flow.

## The rules

- **R1 — The retail profile is retail-only.** No gym-side code path
  (`gym-*`, `engine-class-*`, `_shared/cohort/`, `_shared/engine-class/`) reads
  `athlete_profiles` member attributes. The only permitted gym-adjacent write
  is the months-drip seeding `engine_months` (the member's OWN consumption
  state, never surfaced to the gym).
- **R2 — Gym generation takes gym-level inputs only.** Per-member scaling is
  REMOVED. If it returns, it returns when the affiliate side builds membership
  slots for the gym's members — and the member data arrives from the AFFILIATE
  side as explicit generation inputs. wodwisdom's involvement is generation
  only; it never backfills member attributes from retail profiles.
- **R3 — Retail surfaces carry no gym vocabulary.** Copy, consent language, and
  UI on retail surfaces must stand alone to retail customers (the #599 lesson).
  Gym-context copy renders only on gym surfaces. This extends Decision 10's
  shell separation from navigation to language.
- **R4 — The seam stays token-only.** Unchanged from P2a: the affiliate holds
  opaque seat tokens, never a wodwisdom user id; profile data never crosses in
  either direction.

## What this changed in code (first tranche)

- `_shared/cohort/start-gym-job.ts`: the roster block (entitlement→link→
  `athlete_profiles` reads and per-member `CohortMemberIntake` construction) is
  removed. `resume_state.roster` is always empty — already a legal, supported
  state end-to-end (the shared program generates; `persist-cohort-result`
  writes no `engine_member_scaling` rows). `members_scaled` /
  `members_with_weights` remain in the kickoff result as literal 0 for seam
  compatibility with the portal; remove them (both sides) in the class sweep.

## The class sweep (founder-confirmed DELETE; executed 2026-07-12)

Removed from the repo (git history is the archive):

- `engine-class-log/-leaderboard/-tv/-view/-entries` functions, the
  `_shared/engine-class/` module, and the parked pages (`GymClassPage`,
  `GymLeaderboardPage`, `GymTVPage`).
- `engine-join` + `JoinEnginePage`. `/join/engine/:token` keeps a dead-link
  stub ("this invite link has been replaced — ask your gym for a new invite")
  so outstanding invite links fail with a message, not a blank landing.
- `wholesale-grants` (the user-id grant path P2a replaced).
- `engine_cohort` / `engine_class_view` grant features +
  `ENGINE_CLASS_SEAT_FEATURES` / `ENGINE_CLASS_VIEW_FEATURES`.
- `buildCohortRoster` + its tests. `loadLatestProgram` was MOVED to
  `_shared/cohort/load-latest-program.ts` — it serves the gym program
  generation product (the portal review desk), not Engine Class.

Kept deliberately:

- `member_gym_links` — the product-agnostic membership link (P2a claim, gym
  branding). Only the class intake (`engine_intake`) lost its writers/readers;
  the column awaits a data-cleanup migration.
- Engine-core cohort mode (`_shared/engine/`) — generic generator contract;
  the gym program runs it with an empty roster.
- `gym-generate`'s scaling/persist plumbing — generic, no-ops on the empty
  roster; prune with the seam fields.

## Second tranche (executed 2026-07-12; all affiliates are test users, so no
## migration window was needed)

- Seam fields `members_scaled` / `members_with_weights` REMOVED from the
  kickoff result, portal response, cron log, and job result JSON — not kept
  as 0. The roster field left `GymResumeState`; `gym-generate` persists with
  empty scalings.
- Claim/revoke/poll transition logic extracted to the pure, unit-tested
  `_shared/seat-grant-state.ts` (19 tests) — both seat functions consume it.
  The status poll now filters implausible tokens and documents the POLL
  CONTRACT: `claimed` = the member owns the seat and the bind converges, NOT
  a guarantee the entitlement row exists at that instant.
- Data cleanup migration `20260712000000_decision11_class_cleanup.sql`
  (destructive, founder-approved): drops `engine_class_results` +
  `gym_tv_tokens`, drops `member_gym_links.engine_intake`, deletes stored
  `engine_cohort`/`engine_class_view` entitlement + seat-grant rows.
  **KEPT: `engine_member_scaling` and `engine_cohort_programs`** — they are
  the Engine API's output tables (`engine-generate`, where CALLERS supply
  athletes as explicit inputs — the R2-compliant path), not class machinery.
- Class-era portfolio docs carry SUPERSEDED banners pointing here.

## Still outside this repo

- Undeploy the dead Supabase functions (`wholesale-grants`, `engine-join`,
  `engine-class-*`) — safe immediately; all affiliates are test users.
- Run the cleanup migration (SQL-editor-ready) before the first production
  affiliate.
- Affiliate repo: switch to the gym-seat-grant token seam; drop its
  `members_scaled` read; retire its side of the class machinery.
