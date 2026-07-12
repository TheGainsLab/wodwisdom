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
