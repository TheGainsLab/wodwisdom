# Product tool inventory — entitlements + gym-shell disposition

_2026-07-05. Companion to `GYM_SHELL_DESIGN.md` (Decision 10(e)). Every product tool/feature in
the app, its current entitlement gate, and its disposition for a `gym_engine`-only member
(IN = part of the gym Engine shell / OUT = retail surround, hidden / À-LA-CARTE = an OUT tool
that is a candidate paid add-on — the menu the founder prices). Source: full gate recon of
`src/` + `supabase/functions/` (2026-07-05)._

## Feature strings in the entitlement system

| Feature | What it unlocks | Written by |
|---|---|---|
| `engine` | Retail Engine (Year of the Engine). Also what gym seats grant TODAY (→ `gym_engine` after Decision 10). | Stripe webhook; wholesale-grants (gym) |
| `gym_engine` | **NEW (Decision 10):** the gym Engine shell — Engine program only, no surround. | wholesale-grants (gym) |
| `programming` | AI Programming (generate/adapt/review personalized programs). | Stripe webhook |
| `nutrition` | Nutrition (food log, barcode/photo, calendar). | Stripe webhook |
| `ai_chat` | Standalone AI Coach (full knowledge base). | Stripe webhook |
| `ailog` | AI Log (bulk import / gap analysis / supplement gen). | (admin/internal) |
| `competition_log` | Athlete-data "try-it" logging. | (athlete-data) |
| `engine_cohort` | Parked cohort-class seat (2b Programmer asset). | wholesale-grants |
| `engine_class_view` | Deferred F5 free-view tier. | (deferred) |
| `gym_programming` | 2b Programmer roster. | (allowlist only) |
| plan keys `coach`/`nutrition`/`coach_nutrition`/`programming`/`engine`/`all_access` | Checkout PLANS that expand to feature sets — NOT entitlements themselves. | CheckoutPage `PLAN_FEATURES` |

> Note: the retail `engine` PLAN bundles `ai_chat`+`nutrition`; a **gym grant issues only the
> single feature** (`engine`, → `gym_engine`). That single-feature grant is exactly what makes
> the surround render as upsell rather than owned — which the shell then suppresses.

## Tool inventory

| Tool / surface | What it is | Entitlement (gate) | Routes / fns | gym_engine |
|---|---|---|---|---|
| **Engine — dashboard + program picker** | Pick a variant (`main_5day`/`main_3day`/varied), Day-1 start, month grid | `engine` (`EngineDashboardPage:110`) | `/engine`, `/engine/dashboard` | **IN** |
| **Engine — training day + logging** | Day workout, timer, session log | `engine` (`EngineTrainingDayPage:400`) | `/engine/training/:d` | **IN** |
| **Engine — day review + embedded day-coach** | Post-day breakdown + context-aware `CoachChat` | none on page; server `chat` fn tiers on `ai_chat` | `/engine/training/:d/review` → `chat` fn | **IN** (per Decision 10(b); needs the `chat`-fn day-coach tier fix — see design doc) |
| **Engine — analytics / trends / breakdowns** | The member's own Engine history + ratios | `engine` (`EngineAnalyticsPage:211`) | `/engine/analytics` | **IN** |
| **Engine — taxonomy, leaderboard** | Day-type taxonomy; global Engine leaderboard | `engine` (taxonomy `:97`); leaderboard ungated (RLS) | `/engine/taxonomy`, `/engine/leaderboard` | **IN** |
| **Training log — Engine tab** | The member's Engine calendar/history | `programming || engine` (`TrainingLogPage:459,742,1748`) | `/training-log` | **IN** (Engine tab only; programming tab OUT) |
| **AI Coach (standalone)** | Full-knowledge chat + history + bookmarks | `ai_chat` (`ChatPage:96`) | `/chat`,`/history`,`/bookmarks`; `chat`, `chat-nudge-classify` | **OUT · À-LA-CARTE** |
| **AI Programming** | Generate/adapt/review personalized programs | `programming` (`ProgramsListPage:27`, `workout-review:770`) | `/programs/*`,`/workout*`,`/day/:id`,`/workout-review`; `generate-program*`, `analyze-program` | **OUT** (2b via the gym, not sold to the member) |
| **Nutrition** | Food log, barcode, photo recognition, calendar | `nutrition` (`NutritionDashboardPage:204`) | `/nutrition/*`; `nutrition-*`, `food-log` | **OUT · À-LA-CARTE** |
| **Athlete Data / Competition history** | Competition catalog, athlete search/verify/link, try-it log, percentiles | `isAdmin`/`ATHLETEDATA_PUBLIC_TIER`; `competition_log` | `/athletedata`; `search-competition-athletes`, `competition-*`, `verify-competition-athlete` | **OUT · À-LA-CARTE** (Decision 10(b): this = "Athlete Data") |
| **Profile + evaluation** | Athlete profile edit + AI profile evaluation → program unlock | ungated page; program-gen needs `programming` | `/profile`; `profile-analysis*`, `parse-*`, `process-coaching-intake` | **OUT** — ⚠️ but lifts/bodyweight edit is Engine-relevant (design-doc open Q1) |
| **AI Log** | Bulk import / gap analysis / supplement gen | `ailog` (+ `isAdmin` pages) | `/ailog/*`; `ailog-*` | **OUT** (admin/internal) |
| **All Access bundle** | Everything (retail upsell) | plan `all_access` | `/checkout?plan=all_access`; the Home CTA | **OUT — never upsell to a gym member** |
| **Admin console** | User/data admin | `isAdmin` | `/admin/*`; `admin-*` | **OUT** |
| **Engine Class seat/view (parked)** | Gym cohort log/leaderboard/TV; free view | `engine_cohort`, `engine_class_view` | `engine-class-*`, `gym-cohort-cron` | parked (2b) |
| **Gym Programming roster (parked)** | 2b Programmer roster | `gym_programming` | allowlist only | parked (2b) |

## À-la-carte add-on candidates (the menu, for founder pricing)

These are OUT of base `gym_engine` but are the natural paid add-ons — "everything the AI knows
flows to the member THROUGH the gym" (Decision 10(d)), so pricing/packaging is an owner-facing
conversation, not a direct-to-member upsell:

1. **AI Coach** (`ai_chat`) — the standalone full-knowledge chat.
2. **Nutrition** (`nutrition`).
3. **Athlete Data / Competition** (competition history, percentiles, profile evaluation).
4. (2b) **AI Gym Programmer** (`gym_programming`) — already its own SKU (§3).

Not add-ons (structural): AI Programming retail (`programming`) is the gym's own 2b product;
AI Log + Admin are internal.
