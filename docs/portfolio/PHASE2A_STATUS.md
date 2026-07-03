# Phase 2a — Status Board (SINGLE SOURCE OF TRUTH)

> **Protocol for both teams:** at the START of every session, `git pull origin
> main` on wodwisdom and READ this file. At the END of every session, update
> your section and push it (docs-only commit to main is fine). Decisions made
> in founder chat or PR comments get recorded HERE within the same session —
> if it isn't on this board, it isn't decided. Founder + reviewer (the
> strategy session) arbitrates conflicts.
>
> Last updated: 2026-07-03 (affiliate team — **#6 + #7 cross-review fixes MERGED
> to affiliate main**. **#6** (F9 billing): 🔴 founding 50% coupon now applied in
> `syncStripe` (create + update reconcile) with a refuse-to-sync guard when the
> coupon is unconfigured (never full-charge a founding gym); 🟠 stale subscription
> items now removed on downgrade (Analytics-off / Engine→0 / band swap); 🟠 new
> `communities.analytics_enabled` opt-in flag replaces `!!affiliate_key` billing
> (**Decision 7** — default false, no true-backfill). **#7** (F4-moderation): 🟡
> `moderated_by` FK made nullable so `on delete set null` no longer aborts GDPR
> deletion; `adjust` now rejects a semantically-empty `{}`. Both squash-merged
> (#7→`3c7d45c`, #6→`25ae6d8`), branches deleted; `deno check` + billing tests
> (10) green; conflict merge (env/App/config) was additive-only. #6-#3's "Resend
> invite is a clipboard copy" nit left as-is (renders only for awaiting-consent
> seats, can't misfire). Prior line: wodwisdom team — **#551 fix round PUSHED** (`e66ef8c` on `claude/cohort-wiring`) → re-verification requested; merged main in first so the #550 schema dep is satisfied. All 2🔴+4🟠+2🟡 addressed (see #551 row). **Cross-reviewed affiliate #6 + #7** and posted findings: #6 has a 🔴 (founding 50% coupon computed but never applied to Stripe → 2× charge) + 2🟠; #7 is clean bar one 🟡 FK contradiction (both verified in code). Prior line: affiliate team — #5 re-verified + MERGED (`bb91848`); Decision-3 chain #550✅→#5✅→#551 complete; F4-moderation → affiliate #7 also carries the consent-gated "awaiting consent — resend invite" roster state (follow-up (b)).

## Workspace conventions (Decision 6, 2026-07-03)

All repos live under one parent folder (`gainslab/`). Rules:
(a) each team session LAUNCHES FROM ITS OWN REPO folder — session cwd = the
one repo it may write (Decision 4 as geography); (b) cross-repo READS go via
sibling paths (e.g. `../wodwisdom/docs/portfolio/`); docs-only board updates
to wodwisdom main remain allowed for both teams; (c) two agents in one repo →
each in its OWN git worktree, always — the clone's checked-out branch belongs
to nobody; (d) parent-folder sessions are reserved for one-off cross-repo
supervision, never a team's daily driver; (e) EVERY session report starts
with its team tag: `[wodwisdom]` or `[affiliate]`; (f) ONE clone per repo per
machine — consolidate/delete stray clones outside `gainslab/` (a repo cloned
twice on one laptop is the shared-state problem again), and `git pull` main
before launching. Launch pattern:
`cd gainslab/wodwisdom` → this terminal IS the wodwisdom team;
`cd gainslab/affiliate-intelligence` → this terminal IS the affiliate team.

## Decisions in force (recorded since the last doc merge)

1. **ONE PROFILE** (GYM_PORTAL_FLOWS Cross-cutting): athlete attributes live
   only in wodwisdom `athlete_profiles`; every surface reads it and writes
   through to it. Applies to F3 intake (write-through + 2–3 optional key
   lifts) and #551's roster builder (source from profile, not `engine_intake`).
2. **Consent seam: the ASSERTION design is accepted** (supersedes the earlier
   preflight idea). Enroll-first resolves gym_id; the enroll call carries a
   `consent_version` assertion; affiliate persists it and GATES ACTIVATION on
   it; wodwisdom records the consent row checked + gym-attributed + deduped
   after enroll. The enroll contract (request/response incl. consent_version,
   re-enroll semantics = returns existing seat unchanged, ENGINE_ENROLL_KEY
   rotation procedure) must be documented in GYM_PORTAL_FLOWS F3 as part of
   the #550 fix round.
3. **Merge order: wodwisdom #550 → affiliate #5 → wodwisdom #551.** F5 starts
   only after all three merge.
4. **Repo ownership** (unchanged): wodwisdom team writes only wodwisdom;
   affiliate team writes only affiliate; reviews cross teams; the reviewer
   never pushes fixes to a branch it reviewed. Cross-repo PRs #5/#550 are
   grandfathered to the wodwisdom team for fixes.
5. **"Done" means PUSHED.** A fix round is complete when the commit is on
   GitHub and this board is updated — not when it exists locally.
7. **Gym Analytics billing is opt-in, not inferred** (2026-07-03, founder, #6
   review): the $49/mo Analytics line bills on an explicit
   `communities.analytics_enabled` flag, NOT on `affiliate_key` presence. Default
   false, no true-backfill — "you're billed for what you clicked subscribe on,"
   which is the simplest billing rule (v1-dumb = simple rules, not auto-billing
   every affiliate gym). Founders flip specific pilot gyms true when they
   actually subscribe. (Numbered 7 because Decision 6 = the workspace conventions
   below.)

## State (2026-07-03)

**Merged & deployed:** Engine Phase 1 (#547) · Grants API (#549) + its
migration/secrets/functions · retail verified · all portfolio docs current on
main. **Affiliate merged, NOT deployed (batched):** F1 (#2), F2 (#3), F3 (#5), F4-moderation
(#7), F9-minimal billing (#6). **New deploy inputs for the batched affiliate deploy:**
migrations `20260703200000` (moderation) + `20260704000000`/`20260704010000` (billing
snapshots + `analytics_enabled`); secrets `BILLING_SNAPSHOT_KEY` and, for founding gyms,
`STRIPE_COUPON_FOUNDING` (a percent_off=50 coupon — without it a founding gym's snapshot
returns `founding_coupon_unconfigured` and won't sync to Stripe, by design).

| Item | State | Blocker |
|---|---|---|
| wodwisdom **#550** (F3 join) | ✅ **MERGED** (36a9018 re-verified: all 8 findings fixed; Decision-2 contract documented; ONE PROFILE prefill in, write-through/lifts deferred to #551 round) | — |
| affiliate **#5** (enroll) | ✅ **MERGED** (affiliate `bb91848` → main; branch deleted) — re-verified against the 9 findings + C1/C2 | Fixes CONFIRMED IN CODE (`ad604b1` spot-check): #1 TOCTOU→atomic upsert; #2 null-clobber→non-null-only + checked write; #3 digest verifier (`_shared/service-key-auth.ts`, fingerprint); #4 masked-404→502; Decision-2 persist (`consent_required`) + gate (`activate_seat` 409 `consent_missing`); C1 `pii_synced_at`; C2 `action:'forget'`. Deferred hardening (all LOW/MED-LOW) **tracked as affiliate issues #8/#9/#10** (#6 PII-normalize/CSV, #7 audit-on-noop, #8 dead browser CORS + dual-key rotation) — wodwisdom-owned (grandfathered). Migration `20260703170000` (4 seat columns) rides the batched deploy |
| wodwisdom **#551** (cohort wiring) | ✅ **MERGED** (d20ce56 — reviewer re-verified e66ef8c in code: all findings confirmed fixed, incl. RAG wiring + ONE PROFILE roster + claim RPC + cron key). **Decision-3 chain COMPLETE → F5 UNBLOCKED** | All findings done: swallowed-read trio → error-check + abort-before-spend + reuse `fetchVocabulary`; **claim-first RPC `claim_due_gym_cohort` (FOR UPDATE SKIP LOCKED) + `X-Cron-Key` auth + checked stamp**; poison-gym backoff + `domain_pack` format CHECK + self-reinvoke drain + NULLS-FIRST index; **roster → `athlete_profiles` (Decision 1)** + F3 write-through of 2–3 key lifts in `engine-join` + `members_with_weights`; `buildRagContext` wired; **canonical reference lifts** (THRESHOLDS_V1, no 4th table/self-flag) + direct TDI literal + dead `tenant_id` removed, sport-strategy→pack **filed to #548**; continuity documented (v1 re-derive); cleanup (shared `validateEngineRequest`, dedup, `updated_at` trigger, full PG error logging, edge tests, stale auth doc). ⚠️ migration syntax-reviewed only (no local PG in session to live-apply). **⚠️ Deploy note for founder:** migration `20260703200000` (claim RPC + CHECK + NULLS-FIRST index + backoff cols) was syntax-verified only — apply in SQL editor at the wodwisdom deploy step and verify `select proname from pg_proc where proname='claim_due_gym_cohort';` returns a row. |
| affiliate **#6** (F9 billing) | ✅ **FIXED + MERGED** (affiliate `25ae6d8` → main; branch deleted) | 🔴 founding coupon: `syncStripe` now attaches `STRIPE_COUPON_FOUNDING` on create + reconciles it on update (apply/clear on founding change), and **refuses to sync a founding gym if the coupon is unconfigured** (returns `founding_coupon_unconfigured`) rather than full-charge — closes the 2× §11 divergence. 🟠 downgrade: generic pass now deletes any subscription item whose price left `desired` (Analytics-off / Engine→0 / band swap), after the adds so no last-item delete. 🟠 Analytics: new `communities.analytics_enabled` opt-in flag (migration `20260704010000`, default false) drives billing — **Decision 7**. Deferred 🟡s (sub-create idempotency lock, period-end proxy) NOT in this round — still open, low sev. New secret: `STRIPE_COUPON_FOUNDING` (add at deploy) |
| affiliate **#7** (F4-moderation + consent roster state) | ✅ **FIXED + MERGED** (affiliate `3c7d45c` → main; branch deleted) | 🟡 `moderated_by` now nullable (dropped `not null`) so `on delete set null` is satisfiable — GDPR/account deletion no longer aborts; matches the repo's documented onboarding pattern. 🟡 `adjust` now rejects a semantically-empty `{}` (requires a corrected `raw_score`/`wkg_score`). 🟡 "Resend invite = clipboard copy" left as-is (renders only for awaiting-consent seats, can't misfire — naming nit). Auth/RLS/check-constraint/graceful-degrade/Change-B consent mirror were verified clean. Cross-repo seams still wodwisdom-F4's to wire |
| affiliate #5 base retarget + branch cleanup | ✅ **DONE** (affiliate team) | #5 base retargeted to `main`; merged `claude/f1-gym-onboarding` + `claude/f2-engine-class` deleted (local + remote) |

## Next action per actor (in order)

**Wodwisdom team:** (1) ~~#550~~ DONE. (2) ~~Fix affiliate #5~~ DONE/MERGED. (3)
~~Fix #551~~ **DONE — pushed (`e66ef8c`), re-verification requested.** (4) ~~Review
affiliate #6 + #7~~ **DONE — findings posted on both PRs.** **(5) NEXT: on #551
re-verify → merge #551** (Decision 3 order complete). Then **build F5** (read-only
gym view) **+ F4 leaderboard/TV** — F4 must (a) expose the entries-read endpoint and
(b) consume the affiliate moderation ledger (drop hide / badge flag / apply adjust)
per `affiliate docs/F4_MODERATION_CONTRACT.md` — the two cross-repo seams. Then launch
kit. Deferred #5 hardening: affiliate issues #8/#9/#10 (wodwisdom-owned). **Follow-ups
(a)/(b) below still open** (GDPR `forget` caller; owner-attested consent path).

**Affiliate team:** (1)–(3) DONE (see prior). (4) ~~address the cross-team review
findings on #6 + #7~~ **DONE — both FIXED + MERGED** (#6 `25ae6d8`, #7 `3c7d45c`):
🔴 founding coupon applied in `syncStripe` + refuse-to-sync guard; 🟠 dropped-item
removal on downgrade; 🟠 Analytics now on the `analytics_enabled` opt-in flag
(Decision 7); #7 🟡 `moderated_by` nullable + empty-`{}` adjust rejected. Deferred:
#6's 2🟡 (sub-create idempotency lock, period-end proxy) — low sev, not yet filed.
(5) **NEXT: wire the two F4 cross-repo seams** jointly with wodwisdom's F4 build.

**Founder:** relay = one line per team: *"Pull wodwisdom main, read
docs/portfolio/PHASE2A_STATUS.md, execute your section, update the board when
done."* Deploys stay batched with you (nothing new to deploy until the fix
rounds merge). Parallel track: lawyer packet + pilot list.

**Reviewer session:** ~~re-verify affiliate #5 → merge~~ DONE. ~~Review affiliate #6
+ #7~~ **DONE this session** (wodwisdom team cross-reviewed both; findings on the PRs;
Decision 4 preserved — review only, no fixes pushed). Remaining: **re-verify wodwisdom
#551** (`e66ef8c`) → merge (completes the #550✅→#5✅→#551 chain) → F4/F5 briefs →
acceptance-demo checklist.

> **Follow-ups opened by the #5 fix round (record before they're lost):**
> **(a) Wire the GDPR `forget` caller.** The affiliate now RECEIVES
> `engine-enroll {action:'forget', wodwisdom_user_id}` (nulls cached seat PII,
> tombstones `pii_forgotten_at`). Wodwisdom must CALL it from its account-deletion
> path so erasure actually propagates — the receiving half exists, the trigger
> does not. Sibling of the link-ending writer already noted in GYM_PORTAL_FLOWS §F3.
> **(b) Manual-add activation now gated.** `activate_seat` returns 409
> `consent_missing` for any seat with no `consent_version` — including seats added
> via F2 `add_seat` (owner manual roster). This is the intended consent-before-data
> rule, but it means the F2 manual-add→activate path now requires the member to
> have joined+consented via F3 first. Confirm this matches the F2 UX (or add an
> owner-attested consent path) when #551's roster builder lands.
> **Partly addressed (affiliate PR #7):** the F2 roster now renders these seats as
> "Awaiting consent" with a "Resend invite" action instead of a failing Activate
> button — the UX confusion is handled. STILL OPEN: whether owners get an
> owner-attested consent path for manual adds (decide with #551's roster builder).
>
> **Repo-hygiene note (observed this session):** the affiliate clone at
> `~/Desktop/affiliate-intelligence` was being branch-switched live (f4-moderation)
> while #5 was open, wiping an in-progress checkout. The #5 fixes were done in an
> isolated `git worktree` off `origin/claude/f3-member-enroll` to avoid the
> collision. Teams sharing one clone should use worktrees per Decision 4.
> **Affiliate-team follow-up (confirmed):** nothing was lost — the affiliate
> session preserved the uncommitted #5 WIP (stashed with `-u`, parked back onto
> `claude/f3-member-enroll`) before building F4, and has now confirmed it is fully
> captured in `ad604b1` (same 4 files) and dropped the redundant backup stash.
> Affiliate team will use a `git worktree` for parallel branches going forward.

## Remaining to close Phase 2a (after the table above clears)

F5 read-only view (wodwisdom) · F4 leaderboard+TV (wodwisdom — must consume the
affiliate moderation ledger per `docs/F4_MODERATION_CONTRACT.md`) +
F4-moderation (affiliate — ✅ BUILT, PR #7; pending review + the two cross-repo
seams) · launch kit content · combined affiliate deploy
(F1+F2+F3+F9 migrations/functions/secrets incl. WHOLESALE_CONSUMER_KEYS +
ENGINE_ENROLL_KEY) · the end-to-end acceptance demo (GYM_PORTAL_FLOWS bottom).
