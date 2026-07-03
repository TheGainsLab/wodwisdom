# Gym Channel — SKU Service Definitions (v1 draft)

> What each gym-channel SKU actually delivers, feature by feature. Companion to
> `STRATEGY.md` §5 and decisions D8/D9 (pricing decided 2026-07; this doc defines
> the promises behind the prices). Each feature carries a build status:
>
> - **EXISTS** — live today in retail wodwisdom or the data service
> - **ADAPT** — exists in retail form; needs gym-mode/portal work
> - **BUILD** — new construction
>
> Sales framing throughout: every SKU is a revenue-per-square-foot tool for the
> gym owner. We never touch the gym's pricing to its members (per-seat wholesale;
> see D8).

---

## 1. Engine Class — $6/active seat/mo · $0 setup · 10-seat minimum from launch

**The pitch:** "Add a cardio class your members do whenever they want. No
Saturday-9am scheduling problem. They log numbers; your gym gets a leaderboard.
You price it; you keep the margin."

**The gym owner gets:**

| Feature | Status |
|---|---|
| Class setup in the gym portal: name it, invite members (link/QR), roster view | BUILD (portal shell exists in affiliate-intelligence) |
| Cohort-mode Engine program: one shared progression path for the whole gym, auto-generated monthly | ADAPT (retail Engine + monthly cron EXIST; cohort flag is in the Engine API contract, Phase 1). **v1 caveat (#551): each month is an independent re-generation (`previous_cycle: null`) — no programmed progressive overload ACROSS months yet; cross-month continuity is tracked to #548. "Progression path" = within-month structure, not month-over-month periodization, at v1.** |
| Gym leaderboard per workout + season standings — divisions by **gender and modality only** (decided; no age/scaled divisions at launch) | BUILD |
| Physics-normalized rankings via the watts / W·kg model so a 60 kg member competes fairly with a 100 kg member — the differentiator no whiteboard app has | ADAPT (physics model EXISTS in data service; leaderboard surface is BUILD) |
| Seat management: activate/deactivate members; billing follows active seats | BUILD (wholesale grant path on the existing entitlements layer) |
| Launch kit: suggested retail guidance ($15–25/mo or bake into dues), member-facing copy, margin math one-pager | BUILD (content, not code) |

**The member gets:**

| Feature | Status |
|---|---|
| Engine workouts on their phone (installable PWA), any time | EXISTS |
| Light intake (key numbers, a few minutes) | ADAPT (subset of retail intake) |
| Individualized scaling — paces/loads personal to them while the *path* stays shared | ADAPT (cohort mode `ScalingResult`, Phase 1 contract) |
| Result logging + personal trend charts | EXISTS |
| Embedded AI coach on each training day (answers questions with the member's training as context) | EXISTS (already embedded in Engine/programmer days) |
| Leaderboard participation | BUILD |

**Explicitly NOT included** (differentiation guard vs. retail): adaptive
recalibration (retail Engine's embedded AI), individually designed programming,
full AI Coach. In-gym Engine is the shared-experience product; retail is the
individually-adaptive product.

---

## 2. Gym Analytics — $49/mo flat

**The pitch:** "See how your athletes stack up — against the sport, not just
each other — and what your gym's strengths and gaps are."

| Feature | Status |
|---|---|
| The 8 dashboard panels (competition-data benchmarking via the data service's versioned API) | EXISTS (data service RPCs + affiliate dashboard; cutover deployed) |
| Gym-vs-field percentiles from the competition dataset + physics model | EXISTS (data layer) / ADAPT (gym-level aggregation views) |
| v2 (once seats exist): member-training analytics — attendance-equivalent engagement, PR velocity, cohort progress | BUILD (the first-party data flywheel surface) |

Note: v1 analytics is competition-derived (internal derived-analytics posture
per §7 of STRATEGY.md). The seat-driven training data is what makes v2 both
richer and cleanly-provenanced.

---

## 3. AI Gym Programmer — $149/mo base + roster personalization (includes Gym Analytics)

**The pitch:** "Stop paying $100–300/mo for someone else's template, or burning
your Sundays writing programming. State your month's focus; the AI writes your
gym's programming in your style; press one more button and every member gets
their version."

**ALL-OR-NOTHING (decided):** when a gym runs the AI Programmer, *every*
member gets the personalized version — no per-member opt-in. Rationale: one
system on the class floor (a coach cannot run half the room on personalized
loads and half on whiteboard Rx), the shared-workout experience is preserved
(same blocks for everyone — cohort mode applied to the gym's own programming;
personalization is each member's loads/scaling, not a different workout), and
complete rosters mean complete data.

**Billing consequence:** roster-based, not active-seat — **$149/mo base +
$3/member/mo across the full roster** (decided; bands: $2.50 at 150+, $2.00 at
250+). The per-head rate is half the opt-in seat because penetration is 100%
and per-member COGS is low: scaling resolves `target_pct_1rm` against each
member's numbers *deterministically* (arithmetic + the audit pipeline); AI
spend is only substitutions/injury adaptations — cents per member-month, not
the ~$1 of full individual generation. 120-member gym: $149 + $360 = ~$509/mo,
every member covered.

**This is a switch sale.** The gym leaves its current programming subscription
and publishing habit. Sales mechanics: shadow-mode trial (generate privately
alongside current programming, compare for a month), style-match onboarding
(upload history), and the innovator's-dilemma tailwind (STRATEGY.md §6.3 —
their current provider cannot answer with AI without destroying its own
premise).

**The gym owner gets:**

| Feature | Status |
|---|---|
| Methodology intake A — "learns your style": upload past programming (the consented Replicate mechanism) | BUILD (foundations: preprocess-program, corpus tenant_id per INTAKE_SERVICE_SCOPING.md) |
| Methodology intake B — "find your voice": guided interview for gyms that have been outsourcing | BUILD |
| Monthly gym program generation: owner sets goals/focus → audited pipeline writes the month | ADAPT (generation pipeline EXISTS; gym-level archetypes/cohort output is Phase 1+) |
| Intent-steering review surface: approve / regenerate-with-a-note (never QA tooling) | BUILD (thin; pattern exists in admin grading tools) |
| Floor distribution on owned surfaces: member PWA (their version), TV mode (Rx), coach day sheet in the portal — no exports (see Question 4) | BUILD |
| Deterministic audit + safety review on everything generated (the moat, applied under the gym's brand) | EXISTS |
| **Member intelligence feed — the retention surface and the paradigm-breaker:** per-member trajectories (not snapshots), PRs as they happen, stall detection, quiet-member alerts before they become cancellations, and per-member coaching talking points the coach can deliver humanly. This is the owner's transparency into the thing members actually pay for. | BUILD (the flywheel surface; data exists the moment the loop runs — athlete-model/analyzer foundations EXIST in retail) |

**Prerequisite chain:** this SKU consumes the Engine API (Phase 1) + methodology
intake (Phase 2 scoping). It is the second-generation offer; Engine Class and
Analytics sell first.

---

## 4. Member AI Seat — $6/active member/mo ($5 at 100+, $4 at 200+)

The **opt-in** seat — it exists where the product is opt-in: Engine Class
participants (and future opt-in member products). Where the product is
whole-gym (the AI Programmer), personalization is roster-billed inside that
SKU instead (see §3) — a member can hold both (gym programming via roster +
an Engine Class seat) and the charges are for different products.

**The member gets (on top of Engine Class features):**

| Feature | Status |
|---|---|
| Full conversational intake (voice/text ramble → structured profile: goals, injuries, preferences, maxes, skills) | ADAPT (tier-3 intake EXISTS; generalization per INTAKE_SERVICE_SCOPING.md, ~60–65% extractable) |
| Personalized daily scaling of the gym's programming: their loads, substitutions for injuries/limitations, scaled versions | ADAPT (audit pipeline + load-sanity EXIST; batch per-roster generation is the `athletes[]` contract, Phase 1) |
| "Today's workout — your version" member view | BUILD |
| PRs, benchmarks, progress tracking | EXISTS |
| Profile portability: member leaves the gym → converts to retail with history intact; retail user joins → links | BUILD (decided in STRATEGY.md §5; profile lives in shared core) |

**Decided:** the seat includes the embedded, training-context-aware AI coach
that already ships on Engine/programmer days (EXISTS). The full open-ended
retail AI Coach stays retail-only. Nutrition arrives later as a **seat-tier
upsell**, not a new SKU: seat pricing is a ladder (base $6 → ~$9–12 with
nutrition when that service is ready) — upsells bump the tier on the same
seat, never add a second charge.

---

## 5. Remote Member Seat — $30/mo wholesale · gym retails at ≥$50/mo ($120/quarter floor)

**The pitch (to the gym):** "Members who moved away, travel for work, or train
at home — keep them as YOUR members. Revenue with zero square feet."

| Feature | Status |
|---|---|
| The full retail all-access bundle under the gym's membership: individual AI Programming + adaptive Engine + AI Coach + nutrition | EXISTS (this IS the retail product; wholesale grant path is BUILD) |
| Gym linkage: remote member appears on the gym leaderboard and roster; coach can see their training | BUILD |
| Retail-price floor enforcement ($50/mo) + wholesale billing to the gym | BUILD (billing rule) |
| Portability both directions (as above) | BUILD |

Differentiation is additive: remote-via-gym = retail product + human coach
relationship + community belonging. The floor guarantees the gym adds value on
top of retail rather than discounting it.

---

## Cross-cutting (all SKUs)

- **The gym portal (affiliate-intelligence) is the single storefront** — auth,
  tenancy, seats, billing for every SKU. Members use the wodwisdom PWA surface;
  the gym context rides on their profile.
- **First-party data consent** baked into gym + member terms from day one (the
  clean-provenance flywheel, STRATEGY.md §6.5).
- **Founding partners** (first 3–5 gyms): ~50% off for 6 months or free wedge,
  in exchange for data consent, case study, honest feedback. Minimums waived
  during pilot terms.

## Question log (settled 2026-07 unless marked open)

1. **AI Coach on gym seats — SETTLED:** the embedded, training-context-aware
   coach on Engine/programmer days is included (it already exists). The full
   open-ended retail AI Coach stays retail-only; a scoped version for gym
   seats can be revisited later.
2. **Nutrition on gym seats — SETTLED:** later; the service isn't ready.
   Mechanism when it is: seat-tier upsell (base $6 → ~$9–12 with nutrition),
   not a new SKU.
3. **Leaderboard divisions — SETTLED:** gender and modality only at launch.
   Physics-normalized (W·kg) rankings included as the differentiator.
4. **Programmer output surface — SETTLED: owned surfaces only, no exports.**
   The block format (archetype → blocks → movements with per-member
   `target_pct_1rm`, logging, benchmarks, embedded coach) IS the data/AI
   learning loop; flattening it severs the loop and cannot represent
   per-member personalization. Distribution: member PWA (full experience),
   free read-only gym view (for Engine-Class-only gyms — the seat-conversion
   funnel), TV mode on the gym wall, owner/coach portal views. No PDF/CSV
   export, no API integrations with incumbent gym software. Consequence
   embraced: the AI Programmer is a SWITCH sale (gym leaves its current
   programming + publishing stack), de-risked by **shadow mode** — the owner
   generates privately in the portal alongside their current programming for
   a month, compares, then flips the floor.
5. **Seat lifecycle — DEFAULT unless objection:** gym-activated = billable;
   auto-deactivate after 60 days of zero logging, portal nudge first.
   (Applies to opt-in Engine Class seats; Programmer gyms are roster-billed,
   see §3.)
