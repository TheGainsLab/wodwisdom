# Phase 2a — Status Board (SINGLE SOURCE OF TRUTH)

> **Protocol for both teams:** at the START of every session, `git pull origin
> main` on wodwisdom and READ this file. At the END of every session, update
> your section and push it (docs-only commit to main is fine). Decisions made
> in founder chat or PR comments get recorded HERE within the same session —
> if it isn't on this board, it isn't decided. Founder + reviewer (the
> strategy session) arbitrates conflicts.
>
> Last updated: 2026-07-04 (wodwisdom team — **Decision-9(i) DESIGN PROPOSAL posted → PR #574 (design-only, no code) + `ENGINE_CLASS_DISTRIBUTION_DESIGN.md`; awaiting reviewer sign-off before build**. Recon of the retail Engine access model done: it gates on a single `engine` feature read as a UNION across sources, so granting retail `engine` gym-scoped lights up /engine/* with retail code UNTOUCHED (1-line allowlist + affiliate flips activate_seat grant); day-1 start is free (engine_current_day DEFAULT 1 + ProgramSelection). Only real build = a grant-based months-drip cron (retail drip is Stripe-keyed → gym members sit at months_unlocked=0/fully locked; the lock is dashboard-only). Group surfaces (#560) parked, not deleted. 5 open Qs for the reviewer/founder. Prior line: 2026-07-04 (affiliate team — **PR #12 MERGED to affiliate main**
> (`acb5995`; branch deleted) — the seam-2 `get_active` endpoint + Decision-8 free-view
> grant + adjust contract note are now on main. Note: `get_active` routes on
> `body.action==='get_active'` (as documented in `F4_MODERATION_CONTRACT.md`); wodwisdom's
> **#566** adds that field to its `moderation-client` request (the reviewer's one finding) —
> the two are aligned, both ride the batched deploy. **Updated `affiliate docs/DEPLOY_RUNBOOK.md`
> (`8247a93`) for the founder's end-to-end run:** added `AFFILIATE_MODERATION_KEY` ([AFF]+[WOD],
> seam 2); noted `engine-enroll` now also grants free `engine_class_view` via `WODWISDOM_GRANTS`
> (best-effort, `free_view:'skipped'` if unset); fixed the seam-1 URL to `engine-class-entries`;
> rewrote §7 as the symmetric two-seam secret exchange (`WODWISDOM_LEADERBOARD_URL/KEY` ⇄
> `AFFILIATE_MODERATION_URL/KEY`, each side degrades gracefully → no ordering dependency).
> **Affiliate build for Phase 2a is COMPLETE; runbook is ready to execute** (once wodwisdom
> #560+#566 merge for the [WOD] functions). Prior line: wodwisdom team — **affiliate PR #12 cross-reviewed → APPROVED (conforms)**; verdict on #12. `get_active` shape/auth/tenant-scoping + the `engine_class_view` enroll grant all conform. ONE finding, wodwisdom-side: my #560 `moderation-client` omitted `action:'get_active'` → seam-2 would silently degrade to unmoderated; **fixed in wodwisdom PR #566** (rides the same batched deploy; both seams then light up on key exchange). This was the LAST wodwisdom build task — Phase 2a build complete once #566 + #12 merge. Prior line: 2026-07-04 (affiliate team — **F4 seam fix round BUILT → affiliate PR #12**
> (`claude/f4-seam2-decision8`; awaiting wodwisdom cross-review, then rides the batched
> deploy). Three items: **(a)** adjust/W·kg — per the reviewer's REVISED addendum, NO guard
> change (wodwisdom derives for_time / nulls other types; `wkg_score` = optional override) →
> contract doc note only in `F4_MODERATION_CONTRACT.md`, post-#7 guard stands *(this supersedes
> the prior header line below that said "adjust will REQUIRE wkg_score")*. **(b)** seam-2
> **`engine-moderation get_active`** — s2s `X-Service-Key` (`AFFILIATE_MODERATION_KEY`,
> digest-compare) → `{gym_id, class_id, moderations:[{result_ref, decision, adjustment|null}]}`,
> tenant-scoped, matches #560's `moderation-client` exactly. **(c)** Decision 8 half —
> `engine-enroll` grants the free `engine_class_view` at join (best-effort, `free_view` in the
> response; never billed, revoked with the gym's grants). New secret `AFFILIATE_MODERATION_KEY`
> (in `.env.example`); key exchange at deploy. deno check clean; billing tests green. Left #12
> OPEN for wodwisdom's cross-review (symmetry with my #560 review — Decision 4). Prior line:
> wodwisdom team — **#560 FIX ROUND PUSHED** (`5ffde54`) → reviewer re-verify. All 2🔴+6🟠+🟡 from the 8-angle review fixed; **Decision 8** (free `engine_class_view` VIEW gate + allowlist; log/leaderboard stay seat-only) and **JOINT-1** (raw-only for_time `adjust` recomputes W·kg from stored joules → `wkg_score` OPTIONAL, not required) folded in. deno check + 14 unit tests + tsc/vite/eslint clean; migration syntax-only (now +pgcrypto/mint RPC/digest+expiry). Seam addenda + JOINT-1 correction posted to affiliate issue #11 (wkg_score optional). Prior line: 2026-07-03 (affiliate team — **F4_MODERATION_CONTRACT conformance
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
9. **Engine Class content = THE CANONICAL RETAIL ENGINE PROGRAM, not per-gym AI
   generation** (2026-07-04, founder, at the acceptance-demo generation step —
   demo PAUSED here). Founder's words: "we can't have two different Engine
   programs — the reputation of the retail program is why people will buy this.
   The only new thing for Engine should be distribution. It works for the
   business because 5 easy sales at $6 = one hard retail sale at $30."
   Grounded in code: retail Engine is the canonical pre-authored 720-day library
   (`engine_workouts` + `engine_day_types` + `engine_program_mapping`, variants
   `main_5day`/`main_3day`/varied) — NOT per-user AI generation (the retail AI
   resequencer is a default-off, envelope-constrained overlay). The #551-built
   per-gym AI cohort generation (`gym-cohort-cron` → engine pipeline →
   `engine_cohort_programs`) is OFF TARGET for this SKU: it would create a second,
   different "Engine program" per gym. Consequences:
   (a) **The gym class serves the canonical catalog**: "today's workout" for a gym
   = a per-gym cursor over `engine_program_mapping` (program variant chosen from
   `days_per_week`: 5→`main_5day`, 3→`main_3day`), advancing on the same
   midnight-UTC calendar #560 fixed. No AI call, no per-gym generation, zero
   marginal content cost — pure distribution margin (the founder's 5×$6 math).
   (b) **The distribution stack is UNCHANGED and stays deployed**: seats, grants,
   enroll/join, free view gate, W·kg leaderboard + physics, TV tokens, moderation
   seams, billing. Only the CONTENT SOURCE of the gym surfaces changes
   (select-workout reads the catalog via the gym cursor instead of
   `engine_cohort_programs`; scored-block/score-type/physics mapping adapts to
   the catalog day shape — Engine days are erg/pace work, the physics sweet spot).
   (c) `gym-cohort-cron` + `engine_cohort_programs` + the cohort generation
   pipeline are NOT deleted — they are the foundation of the 2b AI Gym Programmer
   (SKU §3), where per-gym generation is the product. Park the cron (unschedule or
   leave with no eligible work), keep the code.
   (d) `gym_cohort_configs.equipment/goal_text/target_level` become dormant for
   Engine Class (they steer generation, which no longer runs for this SKU); keep
   for 2b. `days_per_week` remains live (variant selection).
   (e) GYM_SKU_SPEC §1 wording ("cohort-mode Engine program, auto-generated
   monthly") is superseded by this decision — update the spec docs in the rework
   PR.
   (f) **TV mode is LEADERBOARD-FIRST** (founder, same conversation): Engine is
   done by members individually / in small groups on their phones, whenever —
   the gym will rarely put the workout itself on a wall. The TV surface's job is
   the leaderboard (community/competition); today's-workout display is secondary
   (fine to keep as a panel, don't lead with it). A TV surface for AI Program
   generation is a 2b idea, noted, not scoped.
   (g) **Member experience = THE RETAIL ENGINE EXPERIENCE, per-member progression**
   (founder, same conversation): "in-class users should get a similar experience
   as retail users get… the engine users should get the engine program." A gym
   seat unlocks the retail Engine surfaces (Engine day pages, logging, trends,
   the embedded day coach) with the member progressing through the canonical
   catalog AT THEIR OWN PACE FROM DAY 1 — exactly like a retail Engine user —
   not a gym-shared workout-of-the-day. (Retail-only exclusions stand per SKU §1:
   no AI resequencer overlay, no full AI Coach.) Consequences: the gym
   leaderboard groups by PROGRAM DAY (`day_number` — "Day 47 board": every gym
   member who has logged Day 47, W·kg normalized, moderated), not by calendar
   date; "today at the gym" is an ACTIVITY VIEW (who trained, results, PRs),
   not one shared workout. No shared-day cursor needed at all.
   (h) **The screen (TV/portal display) is the gym's window, four jobs**
   (founder): 1. who has opted into Engine (roster/opt-in state, for the owner);
   2. summary data; 3. AI programming output IF the gym uses the 2b Programmer
   (later); 4. a member-facing resource ("what's going on today" — the activity
   feed + boards), on the wall or on their phones. All the built F4/TV plumbing
   (tokens, W·kg, moderation, seams) is REUSED over this content, not discarded.
   (i) **FINAL FORM — PURE DISTRIBUTION (founder, same conversation; supersedes
   the group-feature scope in (b)/(g)/(h) for Engine Class v1).** Founder's words:
   "Engine is not a group program, there are no meaningful group dynamics… the
   gym owner becomes a distributor… he pays $6/seat which he can resell for any
   price he wants… the user gets access to the Engine programs, chooses one and
   begins on day one. They get access to the breakdowns and history and
   everything else that a retail user gets. It's the exact same code… Nothing
   should be different. The only difference is the way they encounter the
   program." Meaning:
   — **Seat = the retail Engine standalone product, identical, same code, same
   surfaces.** Member picks a program variant, starts day 1, gets breakdowns/
   history/everything a retail Engine subscriber gets. No gym-specific member
   experience. (Differentiation vs retail is CHANNEL + PRICE, not features —
   this supersedes SKU §1's feature-differentiation framing for Engine Class.)
   — **What stays for Engine Class v1:** F1 onboarding, F2 class/roster/seats,
   F3 join (consent + link + activation), the grant unlock, F9 $6/active-seat
   billing. The encounter path IS the product.
   — **PARKED for Engine Class (kept as code, they are 2b Programmer assets
   where classes genuinely share workouts):** the gym leaderboard
   (engine-class-log/leaderboard/entries), TV mode + tokens, moderation seams
   1+2, gym-cohort-cron + cohort generation, GymClassPage/GymLeaderboardPage/
   GymTVPage, the per-program-day board concept from (g). The screen ideas in
   (h) are LATER possibilities, not v1 scope.
   — **Known wiring to design (the founder's "we'll get that sorted"):**
   1. feature-key mapping — the grant must unlock exactly what the retail
   Engine surfaces gate on (either grant the retail `engine` feature with
   `granted_by`-scoped revocation, or teach the Engine gates to accept
   `engine_cohort`; team proposes, reviewer checks the retail-untouched
   invariant); 2. the Engine months-unlock drip — retail unlocks program months
   by Stripe invoice count (`reconcile-engine-months` / `engine_months_unlocked`),
   which gym-granted members don't have — needs a grant-based equivalent
   (e.g. months from seat-activation date); 3. F5 free view reduces to a locked
   preview/upsell for joined-not-activated members (or defer entirely — founder
   call at design review).
   (j) **DEFERRED — owner aggregate visibility (founder, 2026-07-04):** the gym
   owner should eventually see some aggregate data on their members' Engine
   activity — a gym-scoped, read-only, limited-admin/COACH-TIER role over the
   gym's own members only. DELIBERATELY WAITING: the same permission primitive
   is required by the 2b AI Programmer's owner surfaces and the F10 intelligence
   feed — design it ONCE there, not twice. Do not build gym-scoped roles into
   the Decision-9(i) rework. v1 stopgap that needs no new rights: the portal
   roster's seat states + the F9 seat-lifecycle "last logged" signal (the 60-day
   auto-deactivate machinery needs it anyway) + the billing preview.

## State (2026-07-04)

**Merged & deployed:** Engine Phase 1 (#547) · Grants API (#549) · retail verified ·
**the ENTIRE wodwisdom deploy step (2026-07-04, founder):** migrations
`20260703100000` (member_gym_links — first-time-applied; preflight showed #550's
migration had never gone live) + `20260703200000` + `20260705000000`, all post-apply
checks green (`claim_due_gym_cohort` ✓, `mint_gym_tv_token` ✓, token digest/expiry
cols ✓, pgcrypto ✓, `engine_class_results` = own-row-SELECT-only ✓); the 8 functions
(`engine-class-{view,log,leaderboard,entries,tv}`, `wholesale-grants`, `engine-join`,
`gym-cohort-cron`) deployed off fresh main `e9a9fec` (upload lists verified incl.
`_shared/entitlements.ts` + the #566 `moderation-client`); new secrets
`WODWISDOM_LEADERBOARD_KEY` + `GYM_COHORT_CRON_KEY` set (physics pair
`COMPETITION_SERVICE_BASE_URL`/`WORK_CALC_SERVICE_KEY` confirmed present); pg_cron
job `gym-cohort-cron-hourly` (`7 * * * *`) active; smoke checks 401/401/403/401/
`{"message":"no gyms due"}` all as expected.
**AFFILIATE DEPLOY STEP COMPLETE (2026-07-04, founder):** the 6 affiliate migrations
applied to `gjkmxatyroyevezjzvyz` (base schema `communities`+3 pre-existed; feature
tables verified: `gym_consents`, `engine_classes`, `engine_class_seats`,
`engine_leaderboard_moderations`, `billing_snapshots`); the 6 functions
(`gym-onboard`, `engine-class`, `engine-enroll`, `engine-moderation`, `gym-billing`,
`dashboard-panels`) deployed off affiliate main `8247a93` (#12 code; both s2s fns
carry `service-key-auth.ts`). **Key exchange DONE — digest-verified matching on both
projects:** `ENGINE_ENROLL_KEY` ✓, `AFFILIATE_MODERATION_KEY` ✓ (seam-2 live),
`WODWISDOM_LEADERBOARD_KEY` ✓ (seam-1 live; one mismatch caught by digest compare and
fixed); `AFFILIATE_ENROLL_URL`/`AFFILIATE_MODERATION_URL` set on wodwisdom,
`WODWISDOM_LEADERBOARD_URL` + `BILLING_SNAPSHOT_KEY` set on affiliate. **Stripe
(sandbox/test mode, retail account):** `STRIPE_SECRET_KEY` (sk_test) +
`STRIPE_PRICE_ANALYTICS` ($49) + `STRIPE_PRICE_ENGINE_6` ($6) set on affiliate.
**Deliberately deferred (founder):** `STRIPE_PRICE_ENGINE_5` (one-price decision —
create the $5 band only if a gym nears 100 seats; code tolerates its absence),
`STRIPE_COUPON_FOUNDING` (billing sync for founding gyms refuses safely until set),
[WOD] `WHOLESALE_CONSUMER_KEYS` + [AFF] `WODWISDOM_GRANTS_URL/KEY` (need the demo
gym's `communities.id` — first demo step; until set, enroll returns
`free_view:'skipped'` and seat grants can't be issued), TV-token mint (same reason).
**Demo prep DONE (2026-07-04, founder):** demo gym = the pre-existing **CrossFit
Southie** community (`d18ff6cf-e6af-4b82-ac3b-85eb689048bf`; grandfathered
analytics gym, F1-marked complete, no payment method — fine for demo); flags set
(founding_partner ✓ expires 2027-01, analytics_enabled ✓); grants key bound
(`WODWISDOM_GRANTS_URL/KEY` [AFF] ⇄ `WHOLESALE_CONSUMER_KEYS` [WOD], digest
pattern verified); `gym_cohort_configs` row inserted; TV token minted (⚠️ pasted
into founder chat — REVOKE + RE-MINT before real members; SQL on the board);
portal frontend runs locally (`npm run dev`, `.env` = affiliate URL + anon key +
`VITE_MEMBER_APP_URL`); production PWA auto-deploys from main via Vercel (current);
TV token verified valid via direct curl (200, `workout:null` = correct empty state).
**ACCEPTANCE DEMO PAUSED at the generation step by Decision 9** (the per-gym AI
generation it would have exercised is off target for this SKU — see Decision 9).
**NEXT: wodwisdom team executes the Decision-9 rework → reviewer reviews → founder
deploys the delta → demo resumes** (everything already deployed/bound stays valid).

| Item | State | Blocker |
|---|---|---|
| wodwisdom **#550** (F3 join) | ✅ **MERGED** (36a9018 re-verified: all 8 findings fixed; Decision-2 contract documented; ONE PROFILE prefill in, write-through/lifts deferred to #551 round) | — |
| affiliate **#5** (enroll) | ✅ **MERGED** (affiliate `bb91848` → main; branch deleted) — re-verified against the 9 findings + C1/C2 | Fixes CONFIRMED IN CODE (`ad604b1` spot-check): #1 TOCTOU→atomic upsert; #2 null-clobber→non-null-only + checked write; #3 digest verifier (`_shared/service-key-auth.ts`, fingerprint); #4 masked-404→502; Decision-2 persist (`consent_required`) + gate (`activate_seat` 409 `consent_missing`); C1 `pii_synced_at`; C2 `action:'forget'`. Deferred hardening (all LOW/MED-LOW) **tracked as affiliate issues #8/#9/#10** (#6 PII-normalize/CSV, #7 audit-on-noop, #8 dead browser CORS + dual-key rotation) — wodwisdom-owned (grandfathered). Migration `20260703170000` (4 seat columns) rides the batched deploy |
| wodwisdom **#551** (cohort wiring) | ✅ **MERGED** (d20ce56 — reviewer re-verified e66ef8c in code: all findings confirmed fixed, incl. RAG wiring + ONE PROFILE roster + claim RPC + cron key). **Decision-3 chain COMPLETE → F5 UNBLOCKED** | All findings done: swallowed-read trio → error-check + abort-before-spend + reuse `fetchVocabulary`; **claim-first RPC `claim_due_gym_cohort` (FOR UPDATE SKIP LOCKED) + `X-Cron-Key` auth + checked stamp**; poison-gym backoff + `domain_pack` format CHECK + self-reinvoke drain + NULLS-FIRST index; **roster → `athlete_profiles` (Decision 1)** + F3 write-through of 2–3 key lifts in `engine-join` + `members_with_weights`; `buildRagContext` wired; **canonical reference lifts** (THRESHOLDS_V1, no 4th table/self-flag) + direct TDI literal + dead `tenant_id` removed, sport-strategy→pack **filed to #548**; continuity documented (v1 re-derive); cleanup (shared `validateEngineRequest`, dedup, `updated_at` trigger, full PG error logging, edge tests, stale auth doc). ⚠️ migration syntax-reviewed only (no local PG in session to live-apply). **⚠️ Deploy note for founder:** migration `20260703200000` (claim RPC + CHECK + NULLS-FIRST index + backoff cols) was syntax-verified only — apply in SQL editor at the wodwisdom deploy step and verify `select proname from pg_proc where proname='claim_due_gym_cohort';` returns a row. |
| affiliate **#6** (F9 billing) | ✅ **FIXED + MERGED** (affiliate `25ae6d8` → main; branch deleted) | 🔴 founding coupon: `syncStripe` now attaches `STRIPE_COUPON_FOUNDING` on create + reconciles it on update (apply/clear on founding change), and **refuses to sync a founding gym if the coupon is unconfigured** (returns `founding_coupon_unconfigured`) rather than full-charge — closes the 2× §11 divergence. 🟠 downgrade: generic pass now deletes any subscription item whose price left `desired` (Analytics-off / Engine→0 / band swap), after the adds so no last-item delete. 🟠 Analytics: new `communities.analytics_enabled` opt-in flag (migration `20260704010000`, default false) drives billing — **Decision 7**. Deferred 🟡s (sub-create idempotency lock, period-end proxy) NOT in this round — still open, low sev. New secret: `STRIPE_COUPON_FOUNDING` (add at deploy) |
| affiliate **#7** (F4-moderation + consent roster state) | ✅ **FIXED + MERGED** (affiliate `3c7d45c` → main; branch deleted) | 🟡 `moderated_by` now nullable (dropped `not null`) so `on delete set null` is satisfiable — GDPR/account deletion no longer aborts; matches the repo's documented onboarding pattern. 🟡 `adjust` now rejects a semantically-empty `{}` (requires a corrected `raw_score`/`wkg_score`). 🟡 "Resend invite = clipboard copy" left as-is (renders only for awaiting-consent seats, can't misfire — naming nit). Auth/RLS/check-constraint/graceful-degrade/Change-B consent mirror were verified clean. Cross-repo seams still wodwisdom-F4's to wire |
| affiliate #5 base retarget + branch cleanup | ✅ **DONE** (affiliate team) | #5 base retargeted to `main`; merged `claude/f1-gym-onboarding` + `claude/f2-engine-class` deleted (local + remote) |
| wodwisdom **#560** (F5 + F4 leaderboard/TV) | ✅ **MERGED** (`6df6b8a` — reviewer re-verified `5ffde54` in code: both 🔴 fixes, all 6🟠, the 🟡 batch, Decision 8's view-gate split (`hasSeat` vs view features via shared `entitlements.ts`), and JOINT-1's for_time recompute + `effectiveMetric` wkg→raw fallback all CONFIRMED). **Phase 2a build COMPLETE — deploy + demo remain.** _(W·kg derives watts + AMRAP cap + fully_computed gate + null-metric UNRANKED + wkg→raw fallback; midnight-UTC "today" + log TOCTOU 409; physics rx-only; parseScoreSort matches log encodings; loadEntries paginates+ordered, prefix index dropped; gate `engine_cohort`-only via shared `_shared/entitlements.ts`; TV token sha256 digest + `mint_gym_tv_token` RPC + expires_at + "First L." + consumer-auth ≥16 floor; RFT→for_time; 🟡 seam-1 workout_date/logged_at, TV mod flag, score_text cap, mmss, Nav cache, shared `formatMovement`; **Decision 8** `engine_class_view` allowlist+VIEW gate (free tier sees workout; log/leaderboard seat-only); **JOINT-1** raw-only for_time adjust recomputes W·kg else unranked, wkg_score optional. ⚠️ migration syntax-only, now +pgcrypto/mint RPC/digest+expiry cols.)_ | **2🔴 (historical):** (1) `avg_power_watts` is null for EVERY entry — upstream work-calc returns `watts:null` inline and `engine-class-log` never derives `total_joules/time`; AMRAP has no time divisor at all (`time_cap_seconds` never passed); + no raw fallback in `leaderboard.ts` → the default W·kg board renders arbitrary rank order. (2) "Today" flips at the program's `created_at` TIME-OF-DAY (UTC), not midnight — workout switches mid-afternoon, morning scores vanish, log TOCTOU. **6🟠:** physics uses Rx prescription loads, not member effort (scaled member tops W·kg board; fix = physics only for `rx:true` in v1); coach-`adjust` encoding mismatch (rounds_reps `"6+7"`→6 vs `rounds*1000+reps`; load kg vs lbs-normalized); `loadEntries` unbounded → silent 1000-row truncation (season + seam-1); gate admits `gym_programming` (cohort roster is `engine_cohort`-only; gate on that alone in v1 + share the constant); TV-token hardening (plaintext at rest, no entropy floor/expiry/rate-limit; names opt-out on an anonymous surface; `serviceKey` skips the ≥16-char floor; NO MINT PATH exists yet); `"5 RFT"` misclassified `rounds_reps` (finishers all tie, no time captured). Affiliate conformance review ✅ DONE in parallel — **both seams CONFORM, approve** (posted on #560). Seam addenda for issue #11 (review body + reviewer's JOINT-1 addendum comment): raw-only adjust → wodwisdom derives corrected watts for for_time (`total_joules/corrected_seconds`) or NULLs W·kg otherwise (`wkg_score` = optional override only, NOT required); seam-1 pagination; `workout_date` becomes real; R+r adjust format; tv-token mint owner. Migration still syntax-verified only |

## Next action per actor (in order)

**Wodwisdom team:** (1)–(4) DONE (see prior). (5) ~~build F5 + F4 leaderboard/TV +
launch kit~~ **DONE → PR #560** (self-reviewed + fixed; seam-1 exposed, seam-2 consumed).
**(6) ~~fix round on #560~~ DONE — re-verified in code + MERGED (`6df6b8a`).** All
2🔴+6🟠+🟡 + Decision 8 + JOINT-1 confirmed fixed (see #560 row). Then the batched
deploy + the acceptance demo (`ACCEPTANCE_DEMO.md`) close Phase 2a.
**(7) ~~cross-review affiliate PR #12~~ DONE — APPROVED (conforms; posted on #12).**
`get_active` response shape matches `moderation-client`; digest auth is fail-closed;
tenant-scoped (a class not owned by `gym_id` → empty, never another gym's rows); the
enroll grant sends exactly `engine_class_view` (best-effort / idempotent / never-billed).
**ONE finding, wodwisdom-side:** the #560 `moderation-client` POSTed `{gym_id, class_id}`
with **no `action`**, so the affiliate routed it to the Bearer staff path and seam-2
would silently degrade to unmoderated. **Fixed in wodwisdom PR #566 → reviewer verified
the diff (one-line body change + honest docs, nothing else) + MERGED (`4d009ac`).**
~~The wodwisdom side of Phase 2a is DONE~~ — superseded by **Decision 9**.
**(8) IN PROGRESS — Decision-9(i) rework. DESIGN SIGNED OFF → BUILD NOW.** PR #574
**APPROVED + MERGED** (`278f0fe`; reviewer re-verified the 4 load-bearing claims in code —
union gate, single `engine` feature, `no_stripe_customer` early-return, day-1 default).
**All 5 open Qs answered on the PR:** (1) grant `engine` ONLY; (2) DRIP (1mo at activation
+1/30d, only-raise, cap 36) — 9(i)-consistent, founder may veto on this board; (3) accept
`granted_at` reset on reactivation; (4) F5 free view DEFERRED for v1 — affiliate STOPS
granting `engine_class_view` at join (Decision 8 surface parked; key stays allowlisted;
mechanics revive verbatim when a free tier gets a surface) — founder may veto; (5) dual
member = later edge, skip-guard suffices. **Separate `gym-engine-months-cron` CONFIRMED
over a branch in the retail reconciler** (retail byte-identical wins); cron build notes on
the PR (fail-closed X-Cron-Key, idempotent only-raise, named dependency on the grant
timestamp column). Build per the plan → reviewer reviews the build PR → founder deploys the
delta (allowlist + cron + route removal + affiliate feature flip, deploy order: wodwisdom
allowlist BEFORE affiliate flip) → demo resumes. Original
brief: Original
brief: the
gym Engine Class is PURE DISTRIBUTION of the retail Engine standalone product —
"exact same code, nothing different; the only difference is how they encounter
the program." PROPOSE THE DESIGN FIRST (short doc or PR description), reviewer
sanity-checks it, then build. Scope:
(a) **Seat unlock = retail Engine, identical:** the gym grant unlocks exactly
what the retail Engine surfaces gate on — member picks a program variant, starts
day 1, existing Engine pages/logging/history/breakdowns, zero new member UI.
Design question 1: grant the retail `engine` feature (with `granted_by`-scoped
revocation) vs teach Engine gates to accept `engine_cohort` — propose one;
the retail-untouched invariant is the review bar.
(b) **Months-unlock wiring (Decision 9(i) known-wiring 2):** retail drips program
months by Stripe invoice count (`reconcile-engine-months` /
`engine_months_unlocked`) — gym-granted members need a grant-based equivalent
(e.g. months from seat-activation date). Propose in the design.
(c) **PARK the group surfaces** (Decision 9(i)): engine-class-log/leaderboard/
entries/tv, TV tokens, moderation seams, gym-cohort-cron + cohort generation,
the three Gym* pages. Keep the code (2b Programmer assets); remove/hide routes +
nav from the member PWA for v1; unschedule note for the founder (pg_cron job +
which secrets go dormant). F5 free view reduces to a locked preview/upsell for
joined-not-activated members (or defer — founder call at design review).
(d) **Unchanged:** F1/F2/F3 (onboard, class+roster+seats, join/consent/activate),
wholesale grants, $6/active-seat billing (F9). The affiliate side should need
little to nothing — flag anything that does.
(e) **Docs in the same PR:** GYM_SKU_SPEC §1 rewritten as distribution,
GYM_PORTAL_FLOWS F4/F5 (parked), GYM_F4_F5_SURFACES, ACCEPTANCE_DEMO (demo
becomes: join via QR → consent → activate seat → member picks Engine program →
sees Day 1 → logs it → history/breakdowns render → owner sees roster + billing
preview), launch kit copy (drop leaderboard promises for v1).
Then reviewer review → founder deploys the delta → demo resumes. Remaining founder
decision: whether to file the deferred v1 items (cohort continuity #548 — MOOT for
Engine Class under Decision 9; real class schedule — also moot for v1; F5
personalized-scaling view — superseded). Deferred
#5 hardening: affiliate #8/#9/#10. **Follow-ups (a)/(b) below still open** (GDPR
`forget` caller; owner-attested consent path).

> **⚠️ Deploy-order note (Decision 8, for the runbook):** affiliate `engine-enroll`
> now calls the wodwisdom Grants API with `engine_class_view`, but wodwisdom's
> allowlist accepts that key only after the #560 fix round deploys. Order at the
> batched deploy: **wodwisdom functions (incl. wholesale-grants allowlist) BEFORE
> affiliate `engine-enroll`** — the runbook already sequences wodwisdom first; this
> makes the dependency explicit. Joins during any gap get `free_view: failed`
> (join still succeeds); re-enroll backfills.

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
**Fix round ✅ MERGED — affiliate PR #12** (`acb5995` → main; branch deleted; cross-review
APPROVED, wodwisdom's one client-side finding fixed in #566). All three items shipped: **(a)** JOINT-1 —
per the reviewer's revised addendum, NO guard change (a coach can't produce W·kg;
wodwisdom derives for_time / nulls other types; `wkg_score` = optional override). Reduced
to a **contract doc note** in `F4_MODERATION_CONTRACT.md`; the post-#7 raw_score-OR-wkg_score
guard stands. *(Supersedes this session's earlier header line that said "adjust will REQUIRE
wkg_score" — the addendum overrode it.)* **(b)** seam-2 **`engine-moderation get_active`**
built: s2s `X-Service-Key` (`AFFILIATE_MODERATION_KEY`, digest-compare) → `{gym_id, class_id,
moderations:[{result_ref, decision, adjustment|null}]}`, tenant-scoped, runs before the
Bearer path; matches #560's `moderation-client` exactly. **(c)** Decision 8 half —
`engine-enroll` grants the free `engine_class_view` at join (best-effort, `free_view` in the
response). Open-items 1–3 marked resolved in the contract. deno check clean, billing tests
green. **Still to do (founder deploy):** wire both seams via the secret exchange
(`WODWISDOM_LEADERBOARD_URL/KEY` ⇄ `AFFILIATE_MODERATION_URL/KEY`); wodwisdom degrades
gracefully until then.
(7) ~~**Decision 8 (F5 free tier, Option A)** — affiliate half~~ **DONE (PR #12(c))** —
`engine-enroll` grants a FREE `engine_class_view` at member join (idempotent grants call,
best-effort); revoked with the gym's other grants; seat deactivation revokes ONLY
`engine_cohort` (member falls back to free view); billing counts `engine_cohort` only —
`engine_class_view` never bills.

**Founder:** relay = one line per team: *"Pull wodwisdom main, read
docs/portfolio/PHASE2A_STATUS.md, execute your section, update the board when
done."* **#560 is MERGED — the deploy gate is now: wodwisdom team's cross-review of
affiliate #12 → #12 merges → you execute both runbooks** (wodwisdom step first —
see the Decision-8 deploy-order note above — incl. the two syntax-only migrations
`20260703200000` + `20260705000000` with their post-apply verifies, the seam key
exchange, and a `mint_gym_tv_token` call per pilot gym) → acceptance demo
(`ACCEPTANCE_DEMO.md`). Parallel track: lawyer packet + pilot list.

**Reviewer session:** ~~re-verify affiliate #5 → merge~~ DONE. ~~Review affiliate #6
+ #7~~ DONE. ~~Re-verify + merge #551~~ DONE. ~~F4/F5 briefs~~ DONE (relayed).
~~Acceptance-demo checklist~~ **DONE — `docs/portfolio/ACCEPTANCE_DEMO.md` (#558,
merged):** preconditions, 11-step F1→F9 demo script (doubles as the pilot pitch
walkthrough), failure triage, pitch overlay. ~~Run the 8-angle review on #560~~
**DONE — posted on the PR** (2🔴 + 6🟠 inline + 🟡 list; all findings re-verified in
code before posting; Decision 4 held — no fixes pushed). ~~Re-verify the #560 fix
round → merge~~ **DONE — MERGED (`6df6b8a`)** after confirming every fix in code
(watts derivation + AMRAP divisor + fully_computed gate + unranked nulls + wkg→raw
fallback; midnight-UTC + 409; rx-only physics; per-type adjust parsing incl. kg→lb;
paginated `loadEntries`; seat/view gate split; digest tokens + mint RPC + ≥16 floor;
RFT→for_time; the 🟡 batch; Decision 8 + JOINT-1). **NEXT: sign off the Decision-9(i) DESIGN proposal** — wodwisdom team posted it as
**PR #574 (design-only, no code)** + `docs/portfolio/ENGINE_CLASS_DISTRIBUTION_DESIGN.md`.
Sanity-check the seat-unlock mapping (grant retail `engine` gym-scoped — union read, retail
untouched), the grant-based months-drip cron (from `granted_at`, Stripe drip byte-identical),
the parking plan, and the 5 open questions. On sign-off, wodwisdom builds the small delta.

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
content~~ — **✅ MERGED (#560, `6df6b8a`)**. The two F4 cross-repo seams: seam-1
(entries read) shipped in #560; seam-2 (affiliate `get_active`) is **built in affiliate
PR #12** — pending wodwisdom cross-review, then both seams light up at the deploy's
key exchange. Deploy inputs for #560 fold into the runbook (migration `20260705000000`
— now incl. pgcrypto + `mint_gym_tv_token` RPC + digest/expiry columns, syntax-only:
verify post-apply; 5 `engine-class-*` fns + `wholesale-grants`; `WODWISDOM_LEADERBOARD_KEY` /
`AFFILIATE_MODERATION_URL`+`KEY` / work-calc secrets; mint a TV token per pilot via the RPC).
F4-moderation (affiliate — ✅ FIXED + MERGED, #7 `3c7d45c`) · **combined affiliate
deploy — runbook READY: `affiliate docs/DEPLOY_RUNBOOK.md` (`18aab46`)** (execution
order for all migrations/functions/secrets across both projects incl.
WHOLESALE_CONSUMER_KEYS binding + ENGINE_ENROLL_KEY + STRIPE_COUPON_FOUNDING + the
hourly gym-cohort-cron schedule; founder runs it once F4/F5 merge) · the end-to-end
acceptance demo — **script READY: `docs/portfolio/ACCEPTANCE_DEMO.md` (#558)**
(preconditions checklist + 11-step F1→F9 walkthrough + failure triage + pilot
pitch overlay; executing it end-to-end is the Phase 2a exit criterion).
