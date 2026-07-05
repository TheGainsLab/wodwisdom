# Gym shell + `gym_engine` entitlement — DESIGN PROPOSAL

_2026-07-05. Decision 10: "same Engine, different SHELL." A gym-sourced member gets the FULL
Engine program experience but NONE of the retail surround (no cross-sell, no standalone AI
Coach, no athlete-data/competition tooling), because the surround competes with the gym's
business. **This is a design proposal for reviewer sign-off BEFORE build** (board item 9, the
#574 pattern). Companion: `GYM_TOOL_INVENTORY.md` (Decision 10(e)). Code refs are `origin/main`._

## TL;DR

Mint a distinct **`gym_engine`** feature (Decision 10(a): a feature, NOT source-sniffing).
The affiliate grants `gym_engine` instead of `engine`. Then:
1. **One shared Engine gate helper** `hasEngineAccess = hasFeature('engine') || hasFeature('gym_engine')`, swapped in at the ~5 Engine gate sites — the single principled retail edit for access.
2. **One derived `isGymShell` flag** in `useEntitlements` — true when the member holds `gym_engine` and NONE of the retail shell features. Three chrome components branch on it (HomePage, Nav, BottomTabBar) to render an Engine-only, gym-branded shell with zero cross-sell.
3. **One server edit** so the embedded Engine day-coach (which Decision 10(b) keeps IN) isn't throttled for `gym_engine` members.
4. Generalize the months drip + Month-1 seed to `gym_engine`; allowlist `gym_engine`; migrate the one test grant.

Retail members are untouched (feature-only union; a dual holder keeps the full retail shell).

## Mechanism — why a distinct feature (not source_kind)

Today a gym seat grants the retail `engine` feature (Decision 9(i)), so a gym member is
**indistinguishable at the feature level from a retail Engine subscriber** — that's why the
E2E run leaked retail upsell tiles. `useEntitlements` selects only `feature`
(`useEntitlements.ts:25-28`), so nothing downstream can tell them apart. Per Decision 10(a) we
introduce a **distinct `gym_engine` feature**: the shell test becomes pure feature-set logic
(no source-sniffing), and the Engine gates accept either feature via the shared helper. A
member who ALSO holds retail `engine`/`programming`/etc. is NOT gym-only → full retail shell
(union; retail wins).

```
isGymShell = hasFeature('gym_engine')
          && !hasFeature('engine') && !hasFeature('programming')
          && !hasFeature('nutrition') && !hasFeature('ai_chat')
          && !isAdmin
```

## (a) The shared Engine gate helper — the ONE principled access edit

Add `hasEngineAccess()` (in `useEntitlements` / a tiny `engineAccess.ts`) =
`hasFeature('engine') || hasFeature('gym_engine')`. Swap it in at every place that gates an
ENGINE surface on `hasFeature('engine')` — a mechanical change, one helper:

| file:line | today | → helper |
|---|---|---|
| `EngineDashboardPage.tsx:110` | `hasFeature('engine')` | `hasEngineAccess()` |
| `EngineTrainingDayPage.tsx:400` | `hasFeature('engine')` | `hasEngineAccess()` |
| `EngineAnalyticsPage.tsx:211` | `hasFeature('engine')` | `hasEngineAccess()` |
| `EngineTaxonomyPage.tsx:97` | `hasFeature('engine')` | `hasEngineAccess()` |
| `TrainingLogPage.tsx:459,742,1748` | `... || hasFeature('engine')` | `... || hasEngineAccess()` (Engine tab of the log — the member's own Engine calendar/history, IN; the programming tab stays gated on `programming`) |

`/engine/leaderboard` has no entitlement gate (RLS-gated RPCs) — no change. `EnginePaywall`
only renders to non-holders, so no cross-sell leaks into the Engine pages themselves.

## (b) IN / OUT surface list for a `gym_engine`-only member

**IN — the full Engine program experience:**
| Surface | Route / component | Note |
|---|---|---|
| Engine dashboard + **program picker (all variants)** | `/engine`, `/engine/dashboard` | ProgramSelection is here |
| Day pages + **logging** | `/engine/training/:d` | |
| Day review + **embedded day-coach** | `/engine/training/:d/review` | IN per 10(b) — needs the server fix below |
| Own **trends / breakdowns / history** | `/engine/analytics`; Engine tab of `/training-log` | the member's OWN Engine training |
| Engine leaderboard, taxonomy | `/engine/leaderboard`, `/engine/taxonomy` | |
| Settings (account/billing) | `/settings` | keep |

**OUT — the retail surround (competes with the gym):**
| Surface | Route(s) | Why OUT |
|---|---|---|
| Standalone AI Coach + history/bookmarks | `/chat`, `/history`, `/bookmarks` | `ai_chat` product — à-la-carte |
| Athlete Data / competition history | `/athletedata` | Decision 10(b): "Athlete Data" = competition-history feature, OUT |
| AI Programming | `/programs/*`, `/workout*`, `/day/:id`, `/workout-review` | `programming` product |
| Nutrition | `/nutrition/*` | `nutrition` product — à-la-carte |
| AI Log | `/ailog/*` | admin/internal |
| Retail checkout / All-Access upsell | `/checkout` + the All-Access CTA | never market past the gym |
| Cross-sell tiles/cards/nav | HomePage `coach`/`training`/`nutrition`/`athletedata` tiles, the "make your AI Coach personal" card, All-Access CTA; Nav Coach/Training/Nutrition/Profile groups; BottomTabBar Coach/Training/Nutrition tabs | the leak surfaces (see (c)) |

**⚠️ Ambiguous surfaces — flagged for the design review, NOT decided here:**
1. **`/profile` (AthletePage).** It's OUT as competition-linking + profile-evaluation tooling —
   but it's also where a member edits **bodyweight / 1RM lifts**, which Engine scaling reads. A
   `gym_engine` member's lifts come from F3 intake (`engine-join` write-through), so they can
   train without it — but if they want to update a lift, they have no surface. **Options:** (i)
   OUT entirely for v1 (lifts only via re-running F3 intake / the gym); (ii) expose a
   lightweight lifts/bodyweight editor inside the Engine shell, keeping the competition/eval
   parts OUT. Recommend (i) for v1, flag (ii) as a fast-follow. **Reviewer/founder call.**
2. **The Engine day-coach server tier (below)** — is the day-coach a first-class Engine feature
   for gym members (recommended, per 10(b)) or acceptable-as-throttled? Needs the server edit if
   first-class.
3. **`/training-log` programming tab** — a `gym_engine` member reaches the log for their Engine
   tab; confirm the programming/nutrition tabs are hidden (not just empty) for them.

## (c) The gym-variant home / nav / tab bar

The leaks come from exactly four feature-blind spots. `useEntitlements` is the one choke point
(every consumer already calls it) — add `isGymShell` there, then branch three chrome components:

- **`HomePage.tsx`** — when `isGymShell`: render an Engine-focused, gym-branded home (Engine
  entry + the member's gym name from `member_gym_links.gym_name` + Settings) and SUPPRESS: the
  `coach`/`training`/`nutrition`/`athletedata` tiles (`:90-98`), the "make your AI Coach personal"
  card (`:130-152`), and the **All-Access CTA** (`:172-182` — the tile that leaked).
- **`Nav.tsx`** — when `isGymShell`: show Home + Engine + Settings only; hide the (ungated)
  Coach group (`:71-90`), Profile (`:172-175`), and the Training/Nutrition upsell headers
  (`:119-170`).
- **`BottomTabBar.tsx`** — currently hardcoded + ungated (`:3-70`, Home/Coach/Engine/Training/
  Nutrition). Thread `isGymShell` in and render Home + Engine + Settings only (drop Coach/
  Training/Nutrition). `App.tsx:148 HIDE_TAB_BAR_ROUTES` is the precedent for conditional chrome.

"Gym-branded" v1 = the gym name in the home header (from the member's `member_gym_links` row);
a full logo/theme is a later polish — flag if the founder wants more for the pilot.

## Server caveat — the embedded day-coach must not be throttled (a second principled edit)

Decision 10(b) keeps the **embedded Engine day-coach IN**. But it hits the same `chat` edge fn
as the standalone AI Coach, and that fn computes `isFreeTier = !isAdmin && !features.has('ai_chat')`
(`chat/index.ts:359-360`) → a `gym_engine` member (no `ai_chat`) is capped at the 3-lifetime
free limit. So the day-coach would silently stop working for gym members. **Fix:** in the `chat`
fn, treat the **day-coach path** (requests carrying `engine_program_day`) as a paid tier for
`engine`/`gym_engine` holders — i.e. the Engine day-coach is gated by Engine access, not
`ai_chat`. This is a small, principled server edit (the day-coach is part of the Engine product
per SKU §1), and it does NOT open the standalone `/chat` to gym members. Flag for review.

## (d) Generalize the months drip + Month-1 seed to `gym_engine`

Both the grant-time seed and the cron key on the literal `"engine"`; add `gym_engine`:
- `wholesale-grants:197` seed guard → `if (feature === 'engine' || feature === 'gym_engine')`.
- `gym-engine-months-cron` active-grant filter (`:44`) → `.in('feature', ['engine','gym_engine'])`
  (both are gym-grant drip-eligible). The Stripe-driven skip-guard stays on `retail_stripe engine`
  (retail never has `gym_engine`). Factor `['engine','gym_engine']` into a shared constant so the
  two callers can't drift. The shared write `raiseEngineMonthsFromGrant` is feature-agnostic — no
  change. The retail Stripe drip paths stay byte-identical.

## (e) Allowlist + migration + deploy order

- Add `gym_engine` to `ALLOWED_GRANT_FEATURES` (`_shared/entitlements.ts`).
- **Affiliate delta:** flip the grant const `engine` → `gym_engine` in `engine-class`
  (one constant, flows through the single `callGrant` — same shape as Decision 9(i)/#14).
- **Deploy order** (same as prior seams): wodwisdom deploys the allowlist + gate helper + shell
  FIRST; then the affiliate flips the grant const; else new activations grant an un-allowlisted
  feature and 400. Migrate the **one existing test member's** grant `engine` → `gym_engine` with
  a feature UPDATE (preserves `granted_at` and the already-seeded `engine_months_unlocked`; do
  NOT delete+recreate). Until migrated, that member still holds `engine` → full retail shell.
- No new migration/table; `gym_engine` is just a feature string.

## (f) Tool inventory

Companion doc **`GYM_TOOL_INVENTORY.md`** — every product tool/feature, its current entitlement,
and its `gym_engine` disposition (IN / OUT / à-la-carte candidate), as the à-la-carte-menu
foundation (Decision 10(e)).

## Retail-untouched framing (the sanctioned softening)

Decision 10(a) explicitly softens the retail-untouched bar for this — "minimal, principled
edit." The edits are: (1) one gate helper swapped at ~5 sites; (2) `isGymShell` in one hook +
three chrome branches; (3) one `chat`-fn day-coach tier condition; (4) two months-caller feature
lists. The retail Engine pages' behavior for retail members is unchanged (the helper is a strict
superset of `hasFeature('engine')`), and `stripe-webhook` / `reconcile-engine-months` /
`engineService` are untouched.

## Build plan (after sign-off)

1. `gym_engine` → `ALLOWED_GRANT_FEATURES`; shared `DRIP_FEATURES = ['engine','gym_engine']`;
   generalize the seed + cron.
2. `hasEngineAccess` helper + swap the ~5 Engine gate sites.
3. `isGymShell` in `useEntitlements`; branch HomePage / Nav / BottomTabBar.
4. `chat`-fn day-coach tier fix.
5. Docs (SKU §1 note, this doc → built, tool inventory).
6. Coordinate the affiliate const flip + the test-grant migration + deploy order.
7. Re-run the E2E: a `gym_engine`-only member sees the Engine-only gym shell (no cross-sell, no
   `/chat`, no athlete-data); a retail member is unchanged; the day-coach works for both.

## Open questions (reviewer / founder)

1. `/profile` — OUT entirely for v1, or a lightweight lifts/bodyweight editor in the Engine shell? (Recommend OUT v1 + fast-follow.)
2. Day-coach server tier — make it a first-class Engine feature (recommended) vs accept throttling?
3. Gym branding depth for v1 — just the gym name, or logo/theme?
4. `isGymShell` definition — is "holds `gym_engine` and none of {engine, programming, nutrition, ai_chat}" the right exclusion set? (Confirm `all_access`/`coach` plan-derived features are covered — they expand to these four.)
5. Confirm the parked `engine_cohort`/`engine_class_view`/`gym_programming` grants don't need shell treatment (they're not held by Engine-Class v1 members).
