# Decision 12 — Identity Boundaries (founder, verbatim, 2026-07-12)

> **Retail stands alone to its customers; the member belongs to the gym; the
> affiliate platform never knows wodwisdom accounts exist — the bearer token is
> the only bridge and its resolution is wodwisdom's secret.**

Those three sentences are the decision. Everything below is consequence, not
addition. This document sits beside Decision 11 (PRODUCT_BOUNDARIES.md) and has
the same authority: a design that conflicts with it is wrong, not debatable.

## What each sentence binds

**"Retail stands alone to its customers."**
A retail user's experience, copy, consent language, profile, and data never
reference or depend on the gym channel. No gym can learn whether any person is
a retail customer, or touch a retail subscription, profile, or history.

**"The member belongs to the gym."**
A gym member's identity — name, contact, membership — lives on the affiliate
side, owned by the gym, born there (roster, import, manual add). It never needs
to cross anything: it starts where it belongs. Community and every future
member-facing affiliate surface is affiliate-native, keyed to the gym's own
member record, with affiliate-native auth. The wodwisdom account created at
seat claim is invisible service plumbing — it does not make the person a
"wodwisdom member." wodwisdom members are retail customers, full stop.

**"The affiliate platform never knows wodwisdom accounts exist."**
No wodwisdom user id, pseudonym, SSO assertion, federation callback, account
flag, or any other representation of a wodwisdom account may appear in the
affiliate platform's schema, APIs, logs, or vocabulary — in any form, ever.
The affiliate's world contains: its gyms, its members, its tokens, and seat
statuses (pending / claimed / expired / revoked + a consent flag). "Claimed"
is a fact about the gym's member ("your member activated their seat"), not a
reference to any account. The token→account mapping lives solely in
wodwisdom's private registry (`gym_seat_grants`). If two platforms must ever
hand a member across (e.g. gym app → service), the mechanism is a fresh
affiliate-minted bearer artifact that wodwisdom resolves privately —
possession is the handoff (IDENTITY_MODEL §5.1); identity is never exchanged.

## Explicitly rejected designs (proposed 2026-07-12, killed same day)

- Migrating the member's primary identity to the affiliate platform, with the
  wodwisdom account as a provisioned/SSO backend. (Breaks dormancy-not-
  orphaning, the retail funnel, and sentence three.)
- Federation of wodwisdom identity into affiliate surfaces — including
  pairwise-pseudonym variants. A pseudonym held by the affiliate is still a
  record that a wodwisdom account exists. (Breaks sentence three.)
- Any "one login across both platforms" built on identity exchange. The
  accepted cost is two logins (gym surfaces vs. the service app); the service
  app is the daily one.

## Standing consequences

- The one legitimate cross-boundary data flow remains SERVICE-GENERATED data
  (workouts, nutrition logs) shared gym-ward via explicit, versioned, revocable
  member consent recorded on the wodwisdom side (`member_consents`). Nothing
  else crosses.
- IDENTITY_MODEL §1.5 (affiliate repo) stands as written: gym members who need
  affiliate surfaces become affiliate-native users with their own auth — with
  no linkage of any kind to wodwisdom accounts.
- Affiliate member infrastructure (rosters, seat assignments, token lifecycle,
  imports, portal) is built entirely from affiliate-native objects; its only
  foreign artifact is the token it minted itself, and its only wodwisdom API
  surface is gym-seat-grant create / status / revoke.

---

# Decision 12a — The membership model (founder, 2026-07-12, later the same day)

> Think of it like a member of CrossFit Southie. You have a membership to the
> gym. You get the gym's program, and you can add on Engine or Nutrition and
> maybe future services. Why would you ever need an account elsewhere?
>
> You check your Southie app. From there you see the day's training and you see
> your access to Engine. You click through. You see your access to Nutrition.
> ALL of that happens on the Southie side.

That is the decision; the rest is consequence. It completes Decision 12 by
settling where the member EXPERIENCE lives, not just the identity.

## The rules

- **The member's one and only login is their gym membership** (affiliate-native
  auth). The design test for every future proposal: *would a Southie member
  need an account anywhere but their gym?* If yes, the design is wrong.
- **The wodwisdom PWA never serves affiliate members.** Not de-branded, not
  gym-shelled, not behind a neutral domain — gym members simply never arrive.
  The wodwisdom user base is retail customers, and now literally nothing else.
- **No wodwisdom account exists for a gym member.** Decision 12's third
  sentence stops being a policy and becomes physics: there is nothing for the
  affiliate to know about.
- **Delivery is headless B2B.** The affiliate platform calls tenant-keyed
  wodwisdom service APIs (the `engine-generate` pattern — tenant + explicit
  inputs in, results out) and renders everything inside the gym's member app.
- **Member service data lives affiliate-side.** Workout logs, nutrition logs —
  the gym's member's data, in the gym's platform. wodwisdom AI services are
  called statelessly per request and store nothing about gym members.
- **The gym's member app is also the delivery surface for the gym's own
  generated program** (Decision 11 product 3): the day's training a member sees
  IS the owner's program. Engine and Nutrition are add-on doors beside it.

## Accepted trade (taken knowingly)

A member who leaves their gym has no wodwisdom account to convert — retail
requires a fresh signup with no history carryover. Cleaner separation over
funnel continuity.

## Superseded by 12a (retire for gym-member use; wodwisdom-side sweep)

- `gym-seat-claim` + the `/claim/:token` page + claim-link delivery (the P2a
  account-binding flow — its seam discipline lives on in the B2B APIs).
- The gym shell (Decision 10(a) gym variant) and gym-member `gym_engine` /
  `nutrition` entitlements + the gym months-drip.
- The affiliate-side claim-link UX shipped in identity Phase 4 (the roster,
  seat model, and portal survive; the link-delivery mechanics retire).

Retirement is phased behind the affiliate member app — nothing is deleted
before the replacement delivery path works end to end.
