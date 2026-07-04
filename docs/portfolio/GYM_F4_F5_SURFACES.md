# F4 (leaderboard + TV) + F5 (read-only gym view) — wodwisdom build

_2026-07-03. The wodwisdom half of GYM_PORTAL_FLOWS §F4/§F5, built on the merged
cohort program (#551) + the F2/F3 roster. Companion to the affiliate
`docs/F4_MODERATION_CONTRACT.md` (the two cross-repo seams)._

## Surfaces

| Surface | Where | Auth |
|---|---|---|
| F5 read-only gym view + seat logging | `engine-class-view`, `engine-class-log` edge fns; `/gym` (GymClassPage) | member JWT (verify_jwt=true) |
| F4 member/coach leaderboard | `engine-class-leaderboard` edge fn; `/gym/leaderboard` (GymLeaderboardPage) | member JWT |
| F4 TV mode (gym wall) | `engine-class-tv` edge fn; `/tv/:token` (GymTVPage, public) | tokenized (gym_tv_tokens) |
| Seam 1: entries read (for affiliate moderation) | `engine-class-entries` edge fn | s2s `X-Service-Key` (WODWISDOM_LEADERBOARD_KEY) |
| Storage | `engine_class_results` (entries) + `gym_tv_tokens` (migration `20260705000000`) | — |
| Pure logic (unit-tested) | `_shared/engine-class/{select-workout,leaderboard,physics,gate,queries,moderation-client}.ts` | — |

## The gate (F5, decided in the #550 review)

`resolveMemberGym` (gate.ts): a member sees a gym's Engine Class surfaces ONLY with a
`member_gym_links` row `status='joined'` **AND** an active `engine_cohort`-family
entitlement (`engine_cohort` | `gym_programming`) `granted_by` that gym — **never the
link alone** (ex-members / cancelled gyms would otherwise see programming forever,
since the link-ending writer is a cross-repo follow-up). A member who does NOT pass
gets a leak-safe teaser (no programming content) — the "ask the front desk" state.

> **⚠️ FLAGGED PRODUCT QUESTION (founder).** The gate as specified makes the
> `engine_cohort` entitlement (granted on seat activation) the key for BOTH the free
> read-only view and the paid seat. In the current data model there is **no distinct
> free-tier population** — the cron scales exactly the granted+joined members, so
> everyone who passes the gate is effectively a seat member. Consequence: the F5
> "free view for non-seat members" funnel shows *programming content* only to entitled
> members; non-entitled joined members see the teaser, not today's workout. Two ways
> to resolve (pick one, record on the board):
> **(a)** grant a free/base `engine_cohort` entitlement at F3 join (enroll side) so the
> funnel audience can see the workout (this is the funnel GYM_SKU §1 describes); or
> **(b)** accept that the workout is seat-only and the teaser is the funnel. This build
> implements the gate EXACTLY as documented and does not silently pick — it renders the
> teaser for non-gated members and the workout for gated ones.

## "Today's workout" mapping (gap: cohort programs have no calendar anchor)

`selectTodaysWorkout` (pure): flatten the cohort `WriterOutput` weeks→days into an
ordered workout list; `dayOfCycle = whole days since the program's created_at`; pick
`min(dayOfCycle, lastIndex)` — one workout per calendar day, HOLDING on the last until
the monthly cron regenerates. Gives the whole gym ONE shared "today's workout" so the
per-workout leaderboard is well-defined. **v1 limitation:** a real per-gym class
schedule (which weekdays the class runs) is a follow-up; today it advances daily.

## Leaderboard (F4)

- **Divisions:** gender (from `athlete_profiles`, read-time) + the workout's modality.
  Per-workout board: modality is constant → gender divisions. Season: gender only
  (modality varies across the season), points = Σ over workouts of `(participants −
  rank + 1)`.
- **W·kg (default) + raw toggle.** W·kg = `avg_power_watts / live bodyweight` — watts
  computed once at LOG time via the data-service work-calc; the **per-kg divisor is the
  profile's current bodyweight at READ time** (ONE PROFILE corollary a — nothing caches
  bodyweight as a second write target). Physics failure-soft: null watts → the entry
  ranks on raw score only.
- **Privacy:** output is rank + display name + metric + division only — never email /
  user_id / raw rows. Opted-out (`profiles.leaderboard_anonymous`) → "Anonymous
  Athlete"; admins + `leaderboard_excluded` never appear (mirrors the retail RPCs).

## Moderation seams (F4_MODERATION_CONTRACT)

- **Seam 1 (exposed): `engine-class-entries`.** The affiliate reads a gym's entries to
  moderate. `POST { gym_id, class_id? }` + `X-Service-Key` → `{ entries: [{ result_ref,
  wodwisdom_user_id, member_name, workout_label, raw_score, wkg_score, division }] }`.
  wodwisdom keys on `gym_id` (its cohort program's tenant); `class_id` is echoed (the
  affiliate's ledger key; one Engine Class per gym at v1). `result_ref` =
  `engine_class_results.id`. Moderation is NOT anonymized (gym staff own integrity).
- **Seam 2 (consumed): `moderation-client.fetchModerations`.** The leaderboard + TV
  ENFORCE the affiliate ledger — drop `hide`, badge `flag`, substitute `adjust` — applied
  BEFORE ranking. `POST AFFILIATE_MODERATION_URL { gym_id, class_id? }` +
  `X-Service-Key AFFILIATE_MODERATION_KEY` → `{ moderations: [{ result_ref, decision,
  adjustment|null }] }`. **Graceful degrade:** unconfigured/unreachable → render
  unmoderated (never fatal), mirroring the affiliate's own ledger-only fallback.

> **Coordinate with the affiliate team (their next-action 5):** seam-2's affiliate read
> endpoint isn't built yet — this build is the real caller, so the shape above is the
> one to implement (contract seam 2, option B). Once it exists + `AFFILIATE_MODERATION_URL`
> is set, the board goes from unmoderated to enforcing the ledger with no wodwisdom change.
> Also give the affiliate `WODWISDOM_LEADERBOARD_URL` = the `engine-class-entries` URL +
> `WODWISDOM_LEADERBOARD_KEY` so seam 1 lights up.

## TV mode

`gym_tv_tokens(gym_id, token, revoked_at)` — a high-entropy token is the capability.
`/tv/:token` (public route, no login) polls `engine-class-tv` every 30s: today's Rx +
the rolling W·kg board (moderation applied). Mint a token per gym (SQL insert / a future
admin/portal action); revoke by setting `revoked_at`.

## Deploy (founder — batched)

- Apply migration `20260705000000_engine_class_leaderboard.sql` (SQL editor) + reload
  PostgREST. Adds `engine_class_results` + `gym_tv_tokens`.
- Deploy edge fns: `engine-class-view`, `engine-class-log`, `engine-class-leaderboard`,
  `engine-class-entries`, `engine-class-tv`.
- **Secrets:**
  - `WODWISDOM_LEADERBOARD_KEY` (≥16 chars) on `engine-class-entries` — the s2s key the
    affiliate presents for seam 1. Share the value + the function URL with the affiliate.
  - `AFFILIATE_MODERATION_URL` + `AFFILIATE_MODERATION_KEY` on `engine-class-leaderboard`
    + `engine-class-tv` — seam 2 (set once the affiliate exposes its read endpoint;
    until then the board degrades to unmoderated, no error).
  - `COMPETITION_SERVICE_BASE_URL` + `WORK_CALC_SERVICE_KEY` on `engine-class-log` — the
    physics API for W·kg (already used elsewhere; reuse the same values).
- Mint a `gym_tv_tokens` row per pilot gym for the wall URL.

## Checks

`deno check` clean on all 5 edge fns + shared modules; **9 unit tests** pass
(`engine-class_test.ts`: workout selection incl. cycle-hold + empty; W·kg read-time
bodyweight; divisions; moderation hide/flag/adjust-rerank; season points; score parse).
`tsc -b` + `vite build` + `eslint` clean on all new frontend files. Migration
syntax-reviewed (no local Postgres in session to live-apply — verify at deploy).
