# Gym Portal — Flow Spec (v1)

> The build blueprint for rebuilding `affiliate-intelligence` as the gym
> storefront. Companion to `GYM_SKU_SPEC.md` (what each SKU promises) and
> `ENGINE_API_CONTRACT.md` (what the Engine supplies). Flows, screens, and
> states — not pixels.
>
> **Personas:** OWNER (buys, configures, sells to members), COACH (runs the
> floor; subset of owner permissions), MEMBER (never uses the portal — members
> live in the wodwisdom PWA; the portal is B2B-only).
>
> **Phasing:** 2a = Engine Class launch package (minimum sellable product).
> 2b = Programmer package. Flows are tagged. Phase 1 (Engine API: cohort mode,
> `athletes[]`, batch scaling) is a prerequisite for both.

---

## F1 — Gym onboarding [2a]

Signup → gym profile (name, location, member-count band, equipment inventory)
→ Stripe payment method → terms incl. **first-party data consent** (gym-level;
member-level consent is collected in the member join flow) → lands on Home.

- Existing affiliate auth/tenancy/Stripe schema is the foundation.
- Founding-partner state: a flag on the gym record driving discounts and
  waived minimums (F9), set by admin, with an expiry date.
- Equipment inventory feeds generation constraints (2b) and Engine scaling.

## F2 — Engine Class setup [2a]

Create class (name, optional schedule label) → see pricing guidance panel
(suggested member pricing $15–25/mo + margin math, informational only — we
never touch their member pricing) → get invite link + QR poster (printable) →
launch checklist (invite members, hang poster, announce).

- States: DRAFT (no members) → LIVE (first activated seat; starts the 10-seat
  minimum clock per D8, 60-day grace) — badge shows seats vs. minimum.
- Roster tab: members with seat status (invited / active / deactivated),
  activate & deactivate per member. Deactivation is immediate for billing,
  end-of-period for the member's access.

## F3 — Member join (bridges portal ↔ PWA) [2a]

Member scans QR / taps link → wodwisdom signup or sign-in (existing account
links; profile portability per STRATEGY §5) → member-level data consent →
light intake (the Engine subset: key numbers, few minutes) → appears on gym
roster as INVITED → owner (or auto-approve setting) activates the seat →
member's PWA gains the gym context: Engine class workouts, gym leaderboard.

- Edge: member already has retail wodwisdom → account links, retail
  subscription untouched; gym context is additive.
- Edge: member leaves gym / seat deactivated → PWA reverts to whatever they
  hold personally; history stays with the member (portability decision).

## F4 — Leaderboard & TV mode [2a]

- Leaderboard per workout + season standings. Divisions: **gender and
  modality only** (decided). Toggle raw score / **W·kg physics-normalized**
  (default normalized — the differentiator).
- TV mode: full-screen browser page for the gym wall — today's Engine workout
  (Rx form) + rolling leaderboard. Tokenized URL, no login on the TV device.
- Coach view: today's roster of loggers, flag suspicious scores (edit/remove —
  gym owns its leaderboard integrity).

## F5 — Free read-only gym view (PWA) [2a]

Any member of a participating gym (joined via F3 but without an active seat)
sees today's workout read-only in the PWA — block-formatted, logging and
personalization visibly locked ("Ask the front desk for your version").
The in-gym conversion funnel; zero AI cost.

## F6 — Programmer onboarding: style intake [2b]

Two paths, per GYM_SKU_SPEC §3:

- **A — "Learns your style":** upload past programming (docs/CSV/text; the
  consented Replicate mechanism) → parse → owner reviews the extracted style
  summary ("here's what we learned: your week shape, movement mix, intensity
  pattern") → confirm/correct.
- **B — "Find your voice":** guided interview (voice/text; the methodology
  flavor of the intake service) → same reviewable style summary.

Output: the gym's methodology corpus, stored under the gym's `tenant_id`
(the corpus tenancy shipped in Phase 1). Plus goals/constraints defaults.

## F7 — Monthly programming cycle [2b]

Intent (typed or spoken: focus, events, constraints — "heavy squat cycle,
lost a rower, Murph on the 29th") → **Generate** → audited pipeline writes the
month → review at month/week/day zoom → per-day actions: **Approve** ·
**Regenerate with a note** (the entire quality interface — intent-steering,
never QA tooling) → **Publish** (sets the go-live date; members see nothing
until publish) → **Personalize** runs roster-wide (all-or-nothing per D8;
batch `athletes[]` call).

- SHADOW MODE: identical cycle with publish disabled and a compare banner —
  the switch-sale trial. Exiting shadow = first publish.
- Mid-month: regenerate a single day ("rower still broken") without touching
  the rest; republish that day.
- Failure states: generation job status surfaced (async job pattern EXISTS);
  audit failures auto-recover per pipeline; hard failures → "we're on it,"
  never raw errors.

## F8 — Floor surfaces [2b]

- Coach day sheet (portal): today's blocks, the roster's scaling range
  ("squats: 95–225 lb across the room"), per-member flags (injury subs).
- TV mode extends to gym programming (Rx of the day).
- Members: "today's workout — your version" in the PWA (the seat experience).

## F9 — Billing & seats [2a minimal, 2b adds roster]

One Stripe subscription per gym, composed of: Analytics flat / Programmer
base + roster count / Engine Class active-seat count. Seat/roster changes
adjust the next invoice (no mid-month proration in v1 — keep it simple).

- Portal shows: current plan lines, seat counts vs. minimums, next invoice
  preview, founding-partner discount state + expiry.
- Roster count for Programmer billing = gym-reported active membership,
  reconciled against joined members over time (trust first, verify by data).
- Seat lifecycle default per spec Q5: gym-activated = billable;
  auto-deactivate after 60 days of zero logging (nudge at 45).

## F10 — Member intelligence feed [2b]

The owner's daily/weekly digest. v1 = exactly three signal types, done well:

1. **PR feed** — celebrate-worthy events, batched.
2. **Stall detection** — member trajectory flat/declining on a tracked
   pattern for N weeks (thresholds from the athlete-model foundations).
3. **Quiet-member alert** — logging frequency drop vs. their own baseline;
   the pre-cancellation signal.

Each signal renders as a **coaching moment card**: member, what happened
(one sentence), suggested human conversation (two sentences) → owner marks
DONE / SNOOZE / NOT RELEVANT (feedback that tunes thresholds). Delivery:
portal home + optional weekly email digest. Hard rule per STRATEGY §5: the
insight goes to the owner/coach and is delivered by the human — never pushed
to the member.

## F11 — Remote members [2b, after core]

Invite flow mirrors F3 with a remote flag → member gets the full retail
bundle under the gym's membership (wholesale $30, gym charges ≥ $50 retail
floor — the ONE place we enforce price) → appears on roster + leaderboard
with remote badge → coach sees their training like any member's.

---

## Cross-cutting

- **Roles:** OWNER (all), COACH (floor surfaces, leaderboard moderation,
  intelligence feed; no billing/config). Invite via email.
- **Tenancy:** everything keyed to the gym (affiliate's existing
  communities schema); members are wodwisdom identities linked to gyms —
  the profile lives in the shared core (portability).
- **Consent:** gym-level at F1, member-level at F3; both required before any
  member data appears in owner surfaces.
- **The portal never renders program content for export** — owned surfaces
  only (spec Q4). No print/download of programming anywhere.

## Build order within phases

- **2a (minimum sellable):** F1 → F2 → F3 → F4 → F9-minimal → F5.
- **2b:** F6 → F7 → F8 → F9-roster → F10 → F11.
- Dependencies on Phase 1: F2/F3 scaling needs cohort `ScalingResult`;
  F7 needs `athletes[]` batch + `tenant_id` corpus; F10 needs per-member
  scaling/logging persisted queryably (flag this in the extraction brief).
