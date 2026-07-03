# Gym Channel — Billing Mechanics Spec (v1)

> How money and access actually move. Companion to `GYM_SKU_SPEC.md` (prices,
> D8/D9) and `GYM_PORTAL_FLOWS.md` (F9 surfaces this). Design principle
> throughout: **v1 is deliberately dumb** — simple rules a gym owner can
> predict and a one-person team can operate. Sophistication is earned by
> revenue, not shipped ahead of it.

---

## 1. The shape of the problem

The gym pays in **affiliate-intelligence** (its own Stripe + tenancy schema).
Member access lives in **wodwisdom's `user_entitlements`** (separate Supabase
project; entitlement writes are server-side only). The two meet through a new
**Wholesale Grants API** on wodwisdom — same versioned, consumer-keyed,
rate-limited discipline as the data service's API (the pattern is already
proven; this is its second instance).

```
Gym owner ──Stripe──► affiliate-intelligence (gym subscription, seats)
                              │
                              │  POST /wholesale/v1/grants  (service key)
                              ▼
                      wodwisdom user_entitlements (member access)
```

## 2. One Stripe subscription per gym

A single monthly subscription on the gym, composed of line items:

| Line item | Stripe shape | Source of quantity |
|---|---|---|
| Gym Analytics | flat price $49 | on/off |
| AI Gym Programmer base | flat price $149 | on/off |
| Programmer roster | quantity × $3 (bands §4) | gym-reported roster (§6) |
| Engine Class seats | quantity × $6 (bands §4) | active-seat snapshot (§5) |
| Remote member seats | quantity × $30 | active remote seats |

Quantities are updated **once per period, the day before renewal**, from that
day's seat/roster counts. **No mid-month proration in v1**: activate a seat on
the 3rd or the 27th, it first appears on the next invoice. Simple, predictable,
slightly generous to the gym — acceptable COGS at these margins.

Known gaming vector (deactivate before snapshot, reactivate after): accepted
in v1, monitored (flag gyms whose seat count dips >30% in the 3 days before
snapshot, repeatedly). Fix only if it actually happens.

## 3. Seat state machine

```
INVITED ──owner activates──► ACTIVE ──owner deactivates──► DEACTIVATED
                               │  ▲                            │
                 60d zero-logging│  │reactivate                │
                 (nudge at 45d)  ▼  │                          │
                            AUTO-DEACTIVATED ◄─────────────────┘
```

- Billable = ACTIVE at snapshot. Access ends at period end on deactivation
  (member keeps what was paid for).
- Auto-deactivation (60 days zero logging, portal nudge at 45) keeps billing
  honest without the gym managing it — spec Q5 default.

## 4. Volume bands

Bands apply to the **whole count**, not marginally: 105 Engine seats bill
105 × $5 (not 100 × $6 + 5 × $5). Same for roster bands ($3 / $2.50 at 150+ /
$2.00 at 250+). Marginal banding is fairer and incomprehensible on an invoice;
whole-count is legible. Band boundaries evaluated at snapshot.

## 5. Minimums (Engine Class)

The 10-seat minimum arms when the class goes LIVE (first activated seat) and
takes effect after the 60-day grace: invoice quantity = `max(active, 10)`.
Portal shows "7 of 10 minimum" the whole time (F2) — no surprise invoices.
Founding partners: waived during pilot terms.

## 6. Programmer roster count

Gym-reported, editable in the portal, shown on every invoice preview.
**Trust first, verify by data:** if linked member accounts exceed the reported
roster for 2 consecutive snapshots, the portal prompts a true-up (auto-raise
with notice, never silent). We never audit their books; their own members'
signups are the reconciliation.

## 7. Wholesale Grants API (new, on wodwisdom — Phase 2a build item)

`POST /wholesale/v1/grants` · `DELETE /wholesale/v1/grants` — consumer-keyed
(the affiliate portal is the first consumer), versioned, rate-limited,
idempotent by `(user_id, gym_id, feature)`.

Schema change: `user_entitlements` gains `source` (`retail_stripe` |
`gym_grant` | `admin`) and `granted_by` (gym/tenant id, nullable). Existing
rows backfill `source = retail_stripe`/`admin`.

**Coexistence rules:**
- Access = **union** of active entitlements regardless of source. A member
  with retail all-access AND a gym seat simply has both; no dedup, no
  discount coupling in v1.
- Revocation touches only the matching source: member leaves gym → revoke
  `gym_grant` rows for that gym only; retail untouched. (Profile portability,
  STRATEGY §5.)
- Feature mapping per SKU: Engine Class seat → `engine_cohort` (+ gym context);
  Programmer roster → `gym_programming`; Remote seat → the retail all-access
  feature set with `source = gym_grant`. Exact feature keys to be finalized
  against the Phase 1 contract — flag mismatches, don't improvise.

## 8. Remote members — who bills whom

**v1: the gym collects from its member however it already bills members; we
bill the gym $30/seat.** The ≥$50 retail-price floor is **contractual** (in
the partner terms, affirmed in the portal when creating a remote membership),
not technically enforced — we don't process the member payment, so we can't
police it mechanically. v2 option (only if floor abuse appears or gyms ask):
member pays through our checkout with automatic split.

## 9. Payment failure & cancellation

- **Failed gym payment:** Stripe smart retries for 14 days; portal + email
  warnings to the owner. Day 14: seats SUSPENDED (grants paused, members see
  "ask your gym" messaging — soft, the member did nothing wrong). Payment
  restored → grants resume automatically.
- **Cancellation:** end-of-period. All gym-sourced grants expire then. Every
  affected member gets the portability path: convert to retail with history
  intact (the strategy's no-hostages rule — and a retention backstop for us).

## 10. Founding partners

A flag + expiry on the gym record driving: 50% off all line items (Stripe
coupon), minimums waived, badge in portal. On expiry: standard card with
30-day advance notice in portal + email. Terms tracked in the partner
agreement (separate doc).

## 11. Audit & observability

Every grant/revoke/suspend logged with actor and cause (owner action, snapshot
job, dunning, cancellation). Invoice preview in the portal at all times (F9):
current counts, band, minimum state, next invoice number. The rule: **the gym
owner should never see a number on a Stripe invoice they didn't already see
in the portal.**

## 12. Deliberately NOT in v1

Mid-month proration · marginal band pricing · annual plans · self-serve
refunds · processing member payments (except retail, unchanged) · split
payments · multi-gym franchise accounts · currency other than USD.

## Build notes

- Affiliate side: subscription composer + snapshot job + seat state machine +
  F9 surfaces (Phase 2a; state machine and grants integration are the meat).
- wodwisdom side: Wholesale Grants API + `user_entitlements` source/granted_by
  migration (small; additive; goes in the 2a brief, NOT Phase 1).
- Stripe: 5 prices + bands as separate prices swapped at snapshot (simplest)
  or tiered prices (if Stripe tiering matches whole-count semantics — verify).
