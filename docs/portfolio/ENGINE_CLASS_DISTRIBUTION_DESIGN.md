# Engine Class = pure distribution of retail Engine — DESIGN + BUILD

> **STATUS: reviewer-approved (PR #574) → BUILT + build-review fix (PR #577).** All 5 open
> questions answered (grant `engine` only; drip; **Q3 revised — deactivate expires, not
> deletes**; defer F5; skip-guard for dual members). Build: `engine` allowlisted; new
> `gym-engine-months-cron`; `#560` group surfaces parked (routes/nav removed, code kept);
> `grant-row.ts` + `engine-months-drip.ts` extracted + unit-tested.
> **Build-review 🟠 fix:** the `engine` grant now SEEDS `engine_months_unlocked` at activation
> (only-raise, via the shared `raiseEngineMonthsFromGrant` the cron also uses) so a fresh seat
> shows Month 1 immediately — no fully-locked dashboard until the cron runs; cron scheduled
> **HOURLY**. Affiliate delta (grant `engine`, deactivate→`expires_at`, stop granting
> `engine_class_view`) coordinated via affiliate issue #13.


_2026-07-04. Decision 9(i): "the gym owner becomes a distributor… the user gets access
to the Engine programs, chooses one and begins on day one… the exact same code. Nothing
should be different. The only difference is the way they encounter the program."_

**This is a design proposal for reviewer sign-off BEFORE any build** (per board next-action
8). It maps the recon of the retail Engine access model to the smallest change that makes a
gym seat = the retail Engine standalone product, with the **retail-untouched invariant** as
the review bar. Code refs are to `origin/main` as of `f4f9fdd`.

## TL;DR

A gym seat should **grant the retail `engine` feature, gym-scoped**. Because every retail
Engine surface gates on `hasFeature('engine')` and entitlements are read as a **union across
sources**, a `gym_grant` row for `engine` lights up the entire retail Engine experience with
**zero changes to retail code**. Two pieces of new wiring: (1) add `engine` to the grant
allowlist (1 line, wodwisdom) + the affiliate grants `engine` on seat activation (1 line,
affiliate); (2) a **grant-based months drip** (new isolated cron) because the retail drip is
hard-keyed to Stripe, which gym members don't have. Everything else is deletion/parking of
the #560 group surfaces.

---

## Why the gate "just works" (the load-bearing fact)

- Retail Engine gates on a **single feature string, `engine`** — `EngineDashboardPage:110`,
  `EngineTrainingDayPage:400`, `EngineAnalyticsPage:211`, `EngineTaxonomyPage:97`, plus
  HomePage/nav. There is no `engine_workouts`/`engine_months` feature; month/variant/day are
  data columns on `athlete_profiles`, not entitlements.
- `useEntitlements` reads `user_entitlements` filtered only by `user_id` + active expiry —
  **no source/source_kind filter** (`useEntitlements.ts:25-29`). So a `gym_grant` `engine`
  row is indistinguishable from a `retail_stripe` one at the gate.
- The two paid-subscriber classifiers already **exclude** `source_kind='gym_grant'`
  (`20260702120000:179,232`), so granting `engine` to gym members does **not** inflate
  retail paid counts / paywall logic.

## Design question 1 — seat-unlock mapping → **grant retail `engine`, gym-scoped**

| Option | What it means | Retail-untouched? |
|---|---|---|
| **A (RECOMMEND) — grant `engine`** | Affiliate `engine-class:activate_seat` grants `feature:'engine'` (today it grants `engine_cohort`); wodwisdom adds `engine` to `ALLOWED_GRANT_FEATURES`. The union lights up all `/engine/*` surfaces. | ✅ retail Engine code unchanged |
| B — teach Engine gates to accept `engine_cohort` | Edit every `hasFeature('engine')` on the retail path to also accept `engine_cohort`. | ❌ edits retail Engine gates — fails the invariant |

**Recommendation: Option A.** It is strictly less code, and it is the literal reading of
"exact same code, nothing different" — the member holds the same entitlement a retail
subscriber holds; only its *source* differs.

Mechanics (all already exist):
- **Grant:** `wholesale-grants` writes `{feature:'engine', source:'gym_'+gymId,
  source_kind:'gym_grant', granted_by:gymId, expires_at:null}`, idempotent on
  `(user_id, feature, granted_by)`. The ONLY wodwisdom change is adding `"engine"` to
  `_shared/entitlements.ts ALLOWED_GRANT_FEATURES` (currently
  `["engine_cohort","gym_programming","engine_class_view"]`).
- **Revoke** (seat deactivate / gym cancel / member removal): already `granted_by`-scoped —
  DELETE (or expire-at-period-end) only the `source_kind='gym_grant' AND granted_by=gymId`
  row. A member who is ALSO a retail subscriber keeps their `retail_stripe` `engine` row
  untouched (union → still has access). ✅
- **Start at day 1 is free:** `athlete_profiles.engine_current_day DEFAULT 1` +
  `engine_program_version` chosen via the existing `ProgramSelection` component
  (`EngineDashboardPage:142`). `engine-join` already creates the `athlete_profiles` row
  (`engine-join:115`). So a seated member visits `/engine` → picks a variant → is on Day 1,
  identical to a retail user. **No new member UI.**

> **Open Q1 (reviewer/founder):** grant `engine` ONLY, or `engine` + `engine_cohort`?
> Recommend **`engine` only** — the cohort roster/leaderboard is being parked, so
> `engine_cohort` buys nothing for Engine Class v1. `engine_cohort` stays an allowlisted
> feature for the 2b Programmer. (Affiliate flips one constant either way.)

## Design question 2 — the months drip (the only real build) → **grant-based drip cron**

**The problem (crux):** the retail month drip is hard-keyed to Stripe. `reconcile-engine-
months` returns `no_stripe_customer` and writes nothing without `stripe_customer_id`
(`:113-115`); the monthly increment lives only in `stripe-webhook`'s `invoice.payment_
succeeded` (`:344`); the quarterly drip is in `monthly-generation-cron` (requires Stripe).
A gym member has no Stripe → `engine_months_unlocked` stays at its **DEFAULT 0**
(`20260418000000:12`) → `EngineDashboardPage.getDayStatus` locks **every** day and the month
grid is empty (`:62,194`). Their seat "works" (feature present) but all content is locked —
the opposite of the intent.

**Mitigating fact:** the lock is a **dashboard-only, client-side fence**. `EngineTrainingDay
Page` has no month gate (`:400` only checks `hasFeature`), and `saveWorkoutSession` is a
direct client insert with no server/RLS month check (`engineService:524`). Deep-linking
`/engine/training/N` already bypasses the lock for retail too. So the drip is presentational
value-metering, not a security boundary.

**Proposal — a new isolated cron `gym-engine-months-cron`** (mirrors the retail monthly
increment, keyed on the grant instead of Stripe):
- For each active `user_entitlements` row with `feature='engine' AND source_kind='gym_grant'`
  (join `athlete_profiles` by user_id), set
  `engine_months_unlocked = min(36, floor((now − granted_at) / 30d) + 1)` and
  `engine_months_unlocked_last_at = now()`, **only-raise-never-lower** (exactly the retail
  invariant, `reconcile-engine-months:182`). 1 month at activation, +1 per 30 days — mirrors
  the retail $6/month → 1 month cadence, so a gym member's drip matches a retail member's.
- **Skip guard:** if the member ALSO holds a `retail_stripe` `engine` row, do NOT touch their
  months (let Stripe drive) — avoids a dual member unlocking faster than they paid retail.
- **Seed at grant time (build-review fix):** the `wholesale-grants` `engine` grant calls the
  SAME only-raise write (`raiseEngineMonthsFromGrant`) right after activation, so Month 1 is
  present immediately — the QR-at-the-front-desk moment never shows a fully-locked dashboard.
  Best-effort (a seed failure never fails the grant; the cron heals it).
- Schedule: **HOURLY** via pg_cron (fail-closed `X-Cron-Key`). Only advances the ongoing drip
  now that Month 1 is seeded at grant; hourly keeps every subsequent edge tight and cheap.
- **Retail-untouched:** this is a NEW function that writes only gym-granted members' rows and
  leaves all three Stripe drip paths byte-identical. It does not edit `reconcile-engine-
  months` (keeping the review bar clean).

> **Open Q2 (founder):** confirm the drip cadence (1 month / 30 days from activation) vs
> unlock-all-at-grant. Recommend the drip — "same experience as retail" ⇒ retail drips ⇒ gym
> drips; unlock-all would let a $6 member binge 2 years of content.
> **Q3 — RESOLVED (reviewer + affiliate, revised): deactivate EXPIRES the grant, it does
> NOT delete it.** The affiliate review caught that "accept the reset" is wrong: because the
> drip is only-raise, a reset `granted_at` doesn't snap a returning member back — it STALLS
> them (seated 8 months → deactivate → reactivate → stored months stay 8, fresh clock says
> 1,2,3… so they unlock nothing new for ~7 more months of paid seat). Fix (free, uses the
> `expires_at` semantics wholesale-grants already ships):
> - **deactivate** → POST `expires_at = <period end>` (not DELETE) — access ends on schedule
>   (matches BILLING §9 "immediate for billing, end-of-period for access"); the row + its
>   ORIGINAL `granted_at` survive.
> - **reactivate** → POST `expires_at: null` — same row, original timestamp, drip resumes.
> - **terminal** (member removed / gym cancelled) → DELETE as today.
> - **cron** (this build): drips ONLY currently-active rows (`expires_at IS NULL OR > now`),
>   keyed on the row's original `granted_at`. The deactivated gap counts toward unlocked
>   months (a returning member comes back a bit ahead — accepted; content metering, not
>   billing, and only-raise tolerates it). **The grant upsert must not clobber `granted_at`
>   on re-grant — asserted by `grant-row_test.ts`** (the payload omits it, so ON CONFLICT DO
>   UPDATE can't touch it). Affiliate owns the deactivate `expires_at`-instead-of-DELETE flip.

## Design question 3 — park the group surfaces (deletion, not new code)

Decision 9(i) parks the #560 leaderboard/TV/cohort surfaces (kept as **2b Programmer assets**
where classes genuinely share workouts). For Engine Class v1:
- **Remove member PWA routes + nav:** delete the `/gym`, `/gym/leaderboard`, `/tv/:token`
  route registrations (`App.tsx`) and the "Gym Class" nav group (`Nav.tsx`). A seated member
  now just sees the normal **Engine** nav (it lights up because they hold `engine`) — no
  gym-specific member UI, which IS "same code, same surfaces."
- **Keep the code:** `GymClassPage`/`GymLeaderboardPage`/`GymTVPage`, the `engine-class-*`
  edge functions, `_shared/engine-class/*`, `gym-cohort-cron`, `engine_cohort_programs`,
  moderation seams — all retained (2b assets), just unrouted.
- **Unschedule for the founder:** `gym-cohort-cron` pg_cron job unscheduled (no eligible work
  anyway once seats grant `engine` not `engine_cohort`). Dormant secrets:
  `GYM_COHORT_CRON_KEY`, `AFFILIATE_MODERATION_URL/KEY`, `WODWISDOM_LEADERBOARD_KEY`
  (seam keys). **Keep** `COMPETITION_SERVICE_BASE_URL`/`WORK_CALC_SERVICE_KEY` — retail uses
  work-calc too.
- **F5 free view:** `engine-class-view` + `/gym` are parked. The Decision-8 `engine_class_view`
  grant at join has no surface now.

> **Open Q4 (founder call at review):** F5 free view for joined-not-activated members —
> **defer entirely for v1** (recommend: the encounter path is join → activate → Engine; no
> free-view surface needed; the affiliate can stop granting `engine_class_view` at join) OR a
> minimal locked-preview/upsell page. Recommend **defer**.

## Design question 4 — unchanged + affiliate delta

- **Unchanged (wodwisdom):** F1/F2/F3 onboarding, `wholesale-grants`, `engine-join` (consent +
  link + `athlete_profiles` write-through), $6/active-seat billing (F9), the whole retail
  Engine surface.
- **Affiliate delta (small, they own it):** `engine-class:activate_seat` grants `feature:'engine'`
  instead of `'engine_cohort'` (one constant, `engine-class:43`); deactivate/reactivate swap the
  same feature. Optionally stop granting `engine_class_view` at join (Open Q4). **Deploy order:**
  wodwisdom allowlist (`engine`) must deploy BEFORE the affiliate flips the grant feature, else
  activation 400s — same ordering note already in the runbook for Decision 8.

## Retail-untouched invariant — how each piece meets the bar

| Change | Touches retail Engine code? |
|---|---|
| `engine` in `ALLOWED_GRANT_FEATURES` | No — grants-API allowlist only |
| `gym-engine-months-cron` (new fn) | No — writes only gym-granted rows; Stripe drip paths byte-identical |
| Remove `/gym`,`/tv` routes + nav | No — deletes #560 gym code, not retail |
| Affiliate grants `engine` | No — affiliate repo |

The retail Engine pages, `engineService`, the Stripe drip, and `stripe-webhook` are all
**unmodified**. The only wodwisdom code that runs for a gym member is the union-read gate
(already source-agnostic) + the new months cron.

## Docs to rewrite in the build PR (Decision 9(e))

`GYM_SKU_SPEC §1` (distribution framing, drop auto-generated-monthly + feature-differentiation),
`GYM_PORTAL_FLOWS F4/F5` (parked), `GYM_F4_F5_SURFACES` (parked note), `ACCEPTANCE_DEMO`
(new path: join via QR → consent → activate seat → member picks Engine program → Day 1 → logs
it → history/breakdowns render → owner sees roster + billing preview), launch kit (drop
leaderboard promises for v1; the pitch is "distribute the proven retail Engine at your price").

## Build plan (after sign-off) — small

1. wodwisdom: `engine` → `ALLOWED_GRANT_FEATURES` (+ a note the gym-grant `engine` is a
   distribution grant, never a paid-count).
2. wodwisdom: `gym-engine-months-cron` + its `X-Cron-Key` config + a pg_cron schedule note.
3. wodwisdom: remove `/gym`,`/gym/leaderboard`,`/tv/:token` routes + the Gym Class nav group;
   keep the parked code.
4. Docs (above).
5. Coordinate the affiliate one-line grant-feature flip (their PR) + the deploy-order note.
6. Verify: a gym-granted member (no Stripe) sees `/engine` unlocked, Day 1 available, months
   drip from activation; a retail-only member is unaffected (Stripe drip untouched).

## Open questions consolidated (for the reviewer/founder)

1. Grant `engine` only vs `engine` + `engine_cohort`? (Recommend `engine` only.)
2. Months drip cadence 1/30d from activation vs unlock-all? (Recommend drip.)
3. `granted_at` reset on reactivation — accept vs persist earliest? (Recommend accept.)
4. F5 free view — defer for v1 vs minimal upsell? (Recommend defer.)
5. Is a gym member who is ALSO a retail subscriber a real case to design for now, or a later
   edge? (Handled by the skip-guard either way.)
