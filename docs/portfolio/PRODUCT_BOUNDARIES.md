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

## Slated for the class sweep (pending confirmation, not yet done)

- `engine-class-log/-leaderboard/-tv/-view/-entries` functions + parked pages
  (Decision 9(i) assets) — delete vs park: RECOMMEND DELETE (git history is the
  archive; parked-but-deployed code is how superseded doctrine propagates).
- `engine-join` + `/join/engine/:token` + `member_gym_links.engine_intake` —
  class-era join door; fold into the Phase 5 old-path retirement (live-traffic
  timing is the founder's call).
- `engine_cohort` / `engine_class_view` in `ALLOWED_GRANT_FEATURES`.
- `buildCohortRoster` / `engine_member_scaling` / roster plumbing in
  `gym-generate` once the seam fields go.
- Cross-repo: the affiliate portal's use of `members_scaled` (if any) and its
  side of the class machinery.

`member_gym_links` itself SURVIVES — it is the product-agnostic membership link
(P2a claim, gym branding) — only the class intake riding on it dies.
