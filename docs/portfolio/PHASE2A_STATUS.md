# Phase 2a — Status Board (SINGLE SOURCE OF TRUTH)

> **Protocol for both teams:** at the START of every session, `git pull origin
> main` on wodwisdom and READ this file. At the END of every session, update
> your section and push it (docs-only commit to main is fine). Decisions made
> in founder chat or PR comments get recorded HERE within the same session —
> if it isn't on this board, it isn't decided. Founder + reviewer (the
> strategy session) arbitrates conflicts.
>
> Last updated: 2026-07-03 (affiliate team — **F4_MODERATION_CONTRACT conformance
> review of PR #560 POSTED** (comment on #560). **Verdict: both seams CONFORM — approve.**
> Seam-1 (entries read) round-trip-verified against the real affiliate caller
> (`engine-moderation` sends `{gym_id,class_id}`+`X-Service-Key`; `WODWISDOM_LEADERBOARD_KEY`
> name matches both sides; `result_ref = engine_class_results.id` resolves contract
> open-item 1). Seam-2 consumer (`moderation-client`) matches contract option B exactly;
> re-rank + hide-drop/flag-badge resolve open-items 2–3, privacy confirmed as owner-intended.
> **🟠 JOINT-1 (the issue-#11 headline):** wodwisdom re-ranks the **default W·kg board** by
> `adjustment.wkg_score` and falls back to the ORIGINAL power when it's absent — so an
> `adjust` carrying only `raw_score` is a **silent no-op on the W·kg wall**. Root cause is
> affiliate-side (my post-#7 guard accepts raw_score OR wkg_score); wodwisdom can't derive
> watts from a raw string. **Affiliate fix round (mine, committed): `adjust` will REQUIRE
> `wkg_score`** + contract note; also **build the seam-2 read endpoint** (`engine-moderation
> get_active`) so wodwisdom can consume the ledger. #560 needs no change to be correct
> (optional: badge a wkg-less adjust `under_review`). +2🟡 minor (seam-1 single-key tenancy;
> `workout_date:null`). Prior line: wodwisdom team — **F5 + F4 BUILT → wodwisdom PR #560**
> (`claude/f4-f5-gym-surfaces`). The last 2a build: F5 read-only gym view (`/gym`,
> `engine-class-view`) + F4 leaderboard/TV (`engine-class-{log,leaderboard,tv,entries}`,
> `/gym/leaderboard`, public `/tv/:token`) + both moderation seams. Migration
> `20260705000000` (`engine_class_results` + `gym_tv_tokens`). Self-adversarial-reviewed
> + fixed before requesting cross-review: **🔴 members could bypass the log fn to
> fabricate/cross-inject scores → writes now service-role only**; +3🟡 (gate ordering,
> season points, score parse). 10 unit tests pass; deno/tsc/vite/eslint clean; migration
> syntax-reviewed only. **Seam coordination: affiliate issue #11** carries the exact
> shapes — seam-1 (entries read) is ready now; seam-2 (affiliate exposes its ledger read)
> is theirs to build, wodwisdom degrades gracefully until then. ⚠️ **Flagged for founder:**
> the F5 gate (joined + active `engine_cohort` entitlement) means no distinct free-tier
> population exists today — decide base-grant-on-join vs seat-only funnel (see
> `GYM_F4_F5_SURFACES.md`). Launch kit: `GYM_ENGINE_CLASS_LAUNCH_KIT.md`. Prior line:
> affiliate team — **combined deploy runbook AUTHORED +
> PUSHED**: `affiliate docs/DEPLOY_RUNBOOK.md` (`18aab46`). It was assigned earlier
> but never actually written — now it is. Covers, in execution order: all unapplied
> affiliate migrations (F1 `20260702130000` → F2 `20260703000000` → F3
> `20260703170000` → F4-mod `20260703200000_leaderboard_moderation` → F9
> `20260704000000`/`20260704010000`), with a ⚠️ note that the wodwisdom-side
> `20260703200000_gym_cohort_configs` is a DIFFERENT file that rides the founder's
> wodwisdom step; every secret tagged by project ([AFF] vs [WOD] — `ENGINE_ENROLL_KEY`
> both sides, `WODWISDOM_GRANTS_KEY` bound via [WOD] `WHOLESALE_CONSUMER_KEYS` to the
> pilot `communities.id`, `GYM_COHORT_CRON_KEY`, `ENGINE_CONSUMER_KEYS`, `STRIPE_PRICE_*`
> + `STRIPE_COUPON_FOUNDING` incl. its refuse-to-sync note); function deploy lists for
> both projects; the hourly `gym-cohort-cron` pg_cron/pg_net schedule (#551 drain); and
> post-deploy verification incl. the `claim_due_gym_cohort` proc check. **F4 (wodwisdom)
> PR not yet open — standing by to run the `F4_MODERATION_CONTRACT.md` conformance review
> the moment it opens.** Prior line: affiliate team — **#6 + #7 cross-review fixes MERGED
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
8. **F5 free tier = base-grant-on-join (Option A)** (2026-07-04, founder, #560
   review). F3 join issues a FREE `engine_class_view` entitlement via the existing
   wholesale-grants call (idempotent, `granted_by` = gym). The decided F5 gate rule
   is UNCHANGED — content still requires an active gym-granted entitlement; this
   creates the free-tier population it gates. Mechanics: (a) wodwisdom adds
   `engine_class_view` to the grants-API allowlist AND to the F5 view gate's
   accepted list — VIEW gate only; log/leaderboard/TV stay `engine_cohort`
   (in the #560 fix round, which per the review narrows that family to
   `engine_cohort`-only otherwise); (b) affiliate grants it in the enroll path at
   join, revokes it with the gym's other grants (member removal / gym
   cancellation), and NEVER bills it (billing counts `engine_cohort` seats only);
   (c) seat DEACTIVATION revokes only `engine_cohort` — the member falls back to
   the free view (the re-conversion state), not out of the app; (d) the cohort
   roster (gym-cohort-cron) is unchanged: `engine_cohort` only.

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
| wodwisdom **#560** (F5 + F4 leaderboard/TV) | 🔴 **REVIEWED — FIX ROUND NEEDED** (reviewer 8-angle review posted on the PR: **2🔴 + 6🟠 inline + 🟡 list** in the review body). Architecture/spec/security verified GOOD (no IDOR, RLS correct, all decided items conformant, retail untouched) — the blockers are correctness | **2🔴:** (1) `avg_power_watts` is null for EVERY entry — upstream work-calc returns `watts:null` inline and `engine-class-log` never derives `total_joules/time`; AMRAP has no time divisor at all (`time_cap_seconds` never passed); + no raw fallback in `leaderboard.ts` → the default W·kg board renders arbitrary rank order. (2) "Today" flips at the program's `created_at` TIME-OF-DAY (UTC), not midnight — workout switches mid-afternoon, morning scores vanish, log TOCTOU. **6🟠:** physics uses Rx prescription loads, not member effort (scaled member tops W·kg board; fix = physics only for `rx:true` in v1); coach-`adjust` encoding mismatch (rounds_reps `"6+7"`→6 vs `rounds*1000+reps`; load kg vs lbs-normalized); `loadEntries` unbounded → silent 1000-row truncation (season + seam-1); gate admits `gym_programming` (cohort roster is `engine_cohort`-only; gate on that alone in v1 + share the constant); TV-token hardening (plaintext at rest, no entropy floor/expiry/rate-limit; names opt-out on an anonymous surface; `serviceKey` skips the ≥16-char floor; NO MINT PATH exists yet); `"5 RFT"` misclassified `rounds_reps` (finishers all tie, no time captured). Affiliate conformance review ✅ DONE in parallel — **both seams CONFORM, approve** (posted on #560). Seam addenda for issue #11 (review body + reviewer's JOINT-1 addendum comment): raw-only adjust → wodwisdom derives corrected watts for for_time (`total_joules/corrected_seconds`) or NULLs W·kg otherwise (`wkg_score` = optional override only, NOT required); seam-1 pagination; `workout_date` becomes real; R+r adjust format; tv-token mint owner. Migration still syntax-verified only |

## Next action per actor (in order)

**Wodwisdom team:** (1)–(4) DONE (see prior). (5) ~~build F5 + F4 leaderboard/TV +
launch kit~~ **DONE → PR #560** (self-reviewed + fixed; seam-1 exposed, seam-2 consumed).
**(6) NEXT: fix round on #560 — the reviewer's 8-angle review is POSTED on the PR
(2🔴 + 6🟠 inline + a 🟡 list in the review body; see the #560 row).** Fix, push,
report → reviewer re-verifies → merge (also fold in the affiliate's conformance
findings, running in parallel). Then the batched deploy + the acceptance demo
(`ACCEPTANCE_DEMO.md`) close Phase 2a. **Free-tier gate: DECIDED — Decision 8 (Option
A, base-grant `engine_class_view` at join); fold the wodwisdom half into this same fix
round** (allowlist + F5 view gate only). Remaining founder decision: whether to file
the deferred v1 items (cohort continuity #548, real class schedule, F5
personalized-scaling view). Deferred
#5 hardening: affiliate #8/#9/#10. **Follow-ups (a)/(b) below still open** (GDPR
`forget` caller; owner-attested consent path).

**Affiliate team:** (1)–(3) DONE (see prior). (4) ~~address the cross-team review
findings on #6 + #7~~ **DONE — both FIXED + MERGED** (#6 `25ae6d8`, #7 `3c7d45c`):
🔴 founding coupon applied in `syncStripe` + refuse-to-sync guard; 🟠 dropped-item
removal on downgrade; 🟠 Analytics now on the `analytics_enabled` opt-in flag
(Decision 7); #7 🟡 `moderated_by` nullable + empty-`{}` adjust rejected. Deferred:
#6's 2🟡 (sub-create idempotency lock, period-end proxy) — low sev, not yet filed.
(5) ~~author the combined deploy runbook~~ **DONE — `affiliate docs/DEPLOY_RUNBOOK.md`
(`18aab46`)**, linked below; the founder executes it once F4/F5 merge. (6) ~~run the `F4_MODERATION_CONTRACT.md` conformance review on #560~~ **DONE — posted on
#560; verdict BOTH SEAMS CONFORM, approve.** Seam-1 round-trip-verified; seam-2 consumer
matches option B; open-items 1–3 resolved; flagged, not silently adapted (Decision 4).
**Fix round now queued (affiliate-side, from the review):** (a) **JOINT-1 resolution
REVISED by the reviewer (comment on #560) — do NOT require `wkg_score`** (a coach cannot
produce a W·kg figure; requiring it just moves the silent no-op into the moderation UI).
Wodwisdom resolves raw-only adjusts in ITS fix round: for_time → derive corrected watts
= stored `total_joules / corrected_seconds`; amrap/load/rounds_reps → NULL the W·kg
metric (unranked + badge, never a stale rank). Affiliate (a) reduces to a **contract doc
note**: "raw-only adjust: wodwisdom derives (for_time) or nulls (other types) the W·kg
metric; send `wkg_score` only as an explicit override — it wins when present." Keep the
post-#7 raw_score-OR-wkg_score guard as-is. (b)
**build the seam-2 read endpoint** (`engine-moderation get_active` → `{result_ref, decision,
adjustment}` for `{gym_id, class_id?}`) so wodwisdom can consume the ledger. Then **wire both
seams** (seam-1: set `WODWISDOM_LEADERBOARD_URL/KEY`; seam-2: hand wodwisdom
`AFFILIATE_MODERATION_URL/KEY`). wodwisdom degrades gracefully until seam-2 lands.
(7) **NEW — Decision 8 (F5 free tier, Option A):** the enroll path grants a FREE
`engine_class_view` entitlement at member join (same idempotent grants call, new
feature key); revoke it with the gym's other grants; seat deactivation revokes ONLY
`engine_cohort` (member falls back to free view); billing counts `engine_cohort` only —
`engine_class_view` never bills.

**Founder:** relay = one line per team: *"Pull wodwisdom main, read
docs/portfolio/PHASE2A_STATUS.md, execute your section, update the board when
done."* Deploys stay batched with you (nothing new to deploy until the fix
rounds merge). Parallel track: lawyer packet + pilot list.

**Reviewer session:** ~~re-verify affiliate #5 → merge~~ DONE. ~~Review affiliate #6
+ #7~~ DONE. ~~Re-verify + merge #551~~ DONE. ~~F4/F5 briefs~~ DONE (relayed).
~~Acceptance-demo checklist~~ **DONE — `docs/portfolio/ACCEPTANCE_DEMO.md` (#558,
merged):** preconditions, 11-step F1→F9 demo script (doubles as the pilot pitch
walkthrough), failure triage, pitch overlay. ~~Run the 8-angle review on #560~~
**DONE — posted on the PR** (2🔴 + 6🟠 inline + 🟡 list; all findings re-verified in
code before posting; Decision 4 held — no fixes pushed). Remaining: **re-verify the
#560 fix round when the wodwisdom team pushes it → merge** (fold in the affiliate's
conformance verdict) → founder executes both runbooks → acceptance demo. That merge
is the last thing gating the demo.

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

~~F5 read-only view (wodwisdom)~~ · ~~F4 leaderboard+TV (wodwisdom)~~ · ~~launch kit
content~~ — **ALL BUILT → wodwisdom PR #560** (pending cross-team review → merge). The
two F4 cross-repo seams: seam-1 (entries read) is exposed; seam-2 (affiliate ledger
read) is the affiliate's to build per issue #11 — wodwisdom degrades gracefully until
then, so it does NOT block the #560 merge. Deploy inputs for #560 fold into the runbook
(migration `20260705000000`, 5 `engine-class-*` fns, `WODWISDOM_LEADERBOARD_KEY` /
`AFFILIATE_MODERATION_URL`+`KEY` / work-calc secrets, a `gym_tv_tokens` row per pilot).
F4-moderation (affiliate — ✅ FIXED + MERGED, #7 `3c7d45c`) · **combined affiliate
deploy — runbook READY: `affiliate docs/DEPLOY_RUNBOOK.md` (`18aab46`)** (execution
order for all migrations/functions/secrets across both projects incl.
WHOLESALE_CONSUMER_KEYS binding + ENGINE_ENROLL_KEY + STRIPE_COUPON_FOUNDING + the
hourly gym-cohort-cron schedule; founder runs it once F4/F5 merge) · the end-to-end
acceptance demo — **script READY: `docs/portfolio/ACCEPTANCE_DEMO.md` (#558)**
(preconditions checklist + 11-step F1→F9 walkthrough + failure triage + pilot
pitch overlay; executing it end-to-end is the Phase 2a exit criterion).
