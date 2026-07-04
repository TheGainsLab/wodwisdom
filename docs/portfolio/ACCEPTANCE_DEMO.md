# Phase 2a — Acceptance Demo (checklist + pilot pitch script)

> The end-to-end walkthrough that CLOSES Phase 2a — and, run in front of a gym
> owner, IS the pilot pitch. Every step names what it proves. If every box
> checks, the Engine Class is sellable.

> **⚠️ REVISED for Decision 9(i) (2026-07-04) — the demo PAUSED at the old generation
> step; the SKU is now pure distribution of the retail Engine.** The v1 demo path is:
> **join via QR → consent → owner activates the seat (grants the retail `engine` feature) →
> member opens the app → picks an Engine program variant → sees Day 1 → logs it → history +
> breakdowns render → owner sees the roster + billing preview.** No per-gym AI generation,
> no gym leaderboard/TV (parked). Preconditions change: instead of the cohort cron + seam
> keys, verify the `engine` grant allowlist is deployed and `gym-engine-months-cron` is
> scheduled (a fresh seat shows Month 1 unlocked, more unlocking on the 30-day drip). The
> step-by-step below still exercises F1→F3 + F9 verbatim; the F4/leaderboard steps are
> dropped for v1, and the "generate the class program" step is replaced by "member picks a
> retail Engine variant and starts Day 1."

## 0. Preconditions (once)

- [ ] Both deploy runbooks executed: affiliate `docs/DEPLOY_RUNBOOK.md` +
      the wodwisdom-side steps it references (incl. migration
      `20260703200000_gym_cohort_configs` → verify
      `select proname from pg_proc where proname='claim_due_gym_cohort';`).
- [ ] F4/F5 merged and deployed (this doc assumes the final build round landed).
- [ ] Demo gym created via F1 onboarding with the **founding-partner flag** set
      (admin) and `analytics_enabled` as desired (Decision 7: explicit opt-in).
- [ ] `WHOLESALE_CONSUMER_KEYS` + `ENGINE_CONSUMER_KEYS` entries bound to the
      demo gym's `communities.id`; `STRIPE_COUPON_FOUNDING` configured (billing
      sync refuses without it — by design).
- [ ] `gym_cohort_configs` row for the demo gym (days/week, level, units).
- [ ] Two test phones (or browser profiles): MEMBER-A (will get a seat),
      MEMBER-B (joins, no seat — the F5 funnel).
- [ ] A screen for TV mode.

## The demo script

| # | Step | Proves |
|---|---|---|
| 1 | Owner logs into the portal → creates **Engine Class** → prints/shows the QR + pricing-guidance panel | F1+F2; "a new class in five minutes" |
| 2 | MEMBER-A scans QR → signup (Turnstile) → **consent screen** → light intake incl. 1–3 key lifts → "you're on the roster" | F3; consent structural + attributed; ONE PROFILE write-through |
| 3 | Portal roster shows MEMBER-A **awaiting-consent→INVITED**; owner taps **Activate** | F2 seat lifecycle; consent gate (activation possible only because consent exists) |
| 4 | Trigger cohort generation (cron invoke with `X-Cron-Key`, or wait for the tick) → response shows `members_scaled ≥ 1`, `members_with_weights ≥ 1` | #551: claim RPC, envelope, RAG, deterministic scaling |
| 5 | MEMBER-A opens the PWA → **today's class workout with THEIR weights** (from their lifts) + the embedded day coach | The core promise: "the class, scaled to you" |
| 6 | MEMBER-A logs a result → appears on the **gym leaderboard** (W·kg-normalized default; toggle raw; gender+modality divisions) | F4; physics normalization — the differentiator |
| 7 | **TV mode** URL on the wall screen: today's Rx + rolling leaderboard, no login | F4; the whiteboard replaced |
| 8 | Coach opens moderation page → flags/hides the score → leaderboard reflects it | F4 seams live end-to-end (ledger → wodwisdom render) |
| 9 | MEMBER-B joins via QR but gets **no seat** → PWA shows today's workout **read-only, locked**, "ask the front desk" | F5; the conversion funnel; entitlement-AND-link gate |
| 10 | Owner opens **/billing** → invoice preview: seat count, "N of 10 minimum", **founding 50% visible** — and Stripe test-mode sub matches the preview exactly | F9; §11 "never a number they didn't see"; the #6 🔴 fix |
| 11 | Owner deactivates MEMBER-A's seat → access ends per period rules; roster + preview update | Seat lifecycle + grants revoke path |

## Failure triage pointers

Step 4 fails → cron logs (claim/reads abort loudly by design) + the board's
proname check. Step 5 has no weights → member's `athlete_profiles.lifts`
(canonical keys). Step 10 shows full price → `STRIPE_COUPON_FOUNDING` (sync
refuses, check `founding_coupon_unconfigured` in logs). Nothing here should
fail silently — that was the point of the review rounds.

## The pitch overlay (same steps, owner-facing words)

1–2: "Your members scan a poster. That's the whole onboarding."
5: "Every member gets the class scaled to THEIR numbers — automatically."
6–7: "Fair leaderboard — watts per kilo, so your 130-lb member competes with
your 220-lb member honestly. On your wall TV, all day."
10: "You pay $6 a seat. Twenty members at $20/mo is $400 of new revenue
against $120 — and as a founding partner, half that for six months."
