# Phase 2a — Status Board (SINGLE SOURCE OF TRUTH)

> **Protocol for both teams:** at the START of every session, `git pull origin
> main` on wodwisdom and READ this file. At the END of every session, update
> your section and push it (docs-only commit to main is fine). Decisions made
> in founder chat or PR comments get recorded HERE within the same session —
> if it isn't on this board, it isn't decided. Founder + reviewer (the
> strategy session) arbitrates conflicts.
>
> Last updated: 2026-07-03 (affiliate team — #5 retargeted to `main` + merged f1/f2 branches deleted; ONE PROFILE cache findings appended to #5; F4-moderation BUILT → affiliate **PR #7**. Prior same day: wodwisdom team — #5 fix round PUSHED (`ad604b1`), awaiting reviewer re-verify + merge per Decision 3).

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

## State (2026-07-03)

**Merged & deployed:** Engine Phase 1 (#547) · Grants API (#549) + its
migration/secrets/functions · retail verified · all portfolio docs current on
main. **Affiliate merged, NOT deployed (batched):** F1 (#2), F2 (#3).

| Item | State | Blocker |
|---|---|---|
| wodwisdom **#550** (F3 join) | ✅ **MERGED** (36a9018 re-verified: all 8 findings fixed; Decision-2 contract documented; ONE PROFILE prefill in, write-through/lifts deferred to #551 round) | — |
| affiliate **#5** (enroll) | ✅ **FIXES PUSHED** (affiliate `ad604b1`, on `claude/f3-member-enroll`) — awaiting reviewer re-verify + merge | All 5 assigned items done: TOCTOU→atomic upsert; PII null-clobber→non-null-only refresh + checked write; digest verifier (new `_shared/service-key-auth.ts`, fingerprint logs); Decision-2 persist+gate (enroll REQUIRES/persists `consent_version`, `activate_seat` 409s `consent_missing`); PII-cache `pii_synced_at` + GDPR `action:'forget'`. Folded in #4 (masked-404→502). Migration `20260703170000` adds 4 seat columns. Deferred: #6/#7/#8 hardening + dual-key rotation |
| wodwisdom **#551** (cohort wiring) | Reviewed (2🔴+4🟠). Fixes not started | After #550: swallowed-error trio, claim-first+auth on cron, poison-gym backoff, **roster → athlete_profiles (Decision 1)**, rag context, strategy-table→pack (or file to #548), continuity documented |
| affiliate **#6** (F9 billing) | Built, checks clean | Awaiting CROSS-TEAM review by wodwisdom team (after its fix rounds) |
| affiliate **#7** (F4-moderation) | ✅ **BUILT / PR open** (affiliate team) — tsc+vite+deno+eslint clean | Awaiting CROSS-TEAM review by wodwisdom team. Self-contained affiliate build (ledger + edge fn + coach page); cross-repo seams flagged in `docs/F4_MODERATION_CONTRACT.md` — needs wodwisdom F4 leaderboard to (1) expose an entries-read endpoint and (2) consume the moderation ledger (drop hide / badge flag / apply adjust) |
| affiliate #5 base retarget + branch cleanup | ✅ **DONE** (affiliate team) | #5 base retargeted to `main`; merged `claude/f1-gym-onboarding` + `claude/f2-engine-class` deleted (local + remote) |

## Next action per actor (in order)

**Wodwisdom team:** (1) ~~#550~~ DONE/merged. (2) ~~Fix affiliate #5 findings~~
DONE/pushed (affiliate `ad604b1`). **(3) NEXT: Fix #551** (incl. Decision-1
roster change + write-through + lifts capture). (4) Review affiliate #6. Then
F5 + F4-PWA/TV + launch kit. **Two follow-ups opened by the #5 fix (below).**

**Affiliate team:** (1) ~~Retarget #5 to main; delete merged branches~~ DONE.
(2) ~~Confirm ONE PROFILE cache findings in the #5 review~~ DONE — appended C1
(name/email staleness) + C2 (GDPR deletion-propagation) to #5; the `ad604b1` fix
already implements both (`pii_synced_at` + `action:'forget'`), so they're covered,
now recorded. (3) ~~Build F4-moderation~~ DONE → affiliate **PR #7** (checks clean).
(4) NEXT: stand by for #6 **and** #7 cross-team review; once #7 is reviewed, wire
the two F4 cross-repo seams jointly with the wodwisdom F4 leaderboard build.

**Founder:** relay = one line per team: *"Pull wodwisdom main, read
docs/portfolio/PHASE2A_STATUS.md, execute your section, update the board when
done."* Deploys stay batched with you (nothing new to deploy until the fix
rounds merge). Parallel track: lawyer packet + pilot list.

**Reviewer session:** re-verify **affiliate #5 fixes** (`ad604b1`) → merge chain
per Decision 3 (#5 → #551) → review #6 findings cross-check → F4/F5 briefs →
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
