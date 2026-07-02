# Competition History — Flip-the-Gate Audit

_Last updated: 2026-07-01. Grounded in a read of the competition-* edge functions, feature
flags, entitlement wiring, and the Competition History frontend in wodwisdom, then corrected
against the code after verification._

Question this audit originally asked: what stands between the admin-gated Competition History
feature and shipping it publicly? **Verification found the premise was stale — it already
shipped, free, for all authenticated users** (decision D5 in `STRATEGY.md`). So the framing
below is corrected: the "blockers" were resolved or moot; what remains is operational
(caching + rate-limit posture), and it is *more* urgent under free-to-all, not less.

## Status: shipped free (D5). What's left is operational.

`ATHLETEDATA_PUBLIC_TIER = true` in both `src/lib/featureFlags.ts` and
`supabase/functions/_shared/feature-flags.ts`. The view surface (nav link, `/athletedata`
page, `competition-catalog` / `search-competition-athletes` / `competition-workout-detail`)
is gated on authentication only. Logging + placement are free via `hasCompetitionLogAccess`,
which deliberately always grants (see its comment in `_shared/athletedata-access.ts`).

Free is also the intended **rights posture** (STRATEGY §7): no money changes hands for scraped
competition data, so there's no "selling someone else's results" exposure. The value is
retention, verified identity feeding programming (Tier-4 already consumes it as optional intake
enrichment), and shareable "how do I stack up" moments.

---

## Resolved / moot (the original "blockers")

### ~~B1 — decide free vs. paid~~ → RESOLVED
Decided and shipped before this doc existed: **free for all authenticated users** (D5).

### ~~B2 — entitlements not wired to Stripe~~ → MOOT (and the general claim was wrong)
`stripe-webhook`'s `PLAN_ENTITLEMENTS` correctly maps plans to `user_entitlements` grants —
`coach→ai_chat`, `nutrition→nutrition`, `engine→[engine,ai_chat,nutrition]`,
`programming→[programming,ai_chat,nutrition]`, `all_access→[ai_chat,programming,engine,nutrition]`.
The general entitlement wiring is healthy. Only `athletedata` / `competition_log` are absent
from the mapping — and that's **correct**, because the feature is free. Nothing to wire.

### ~~B3 — `hasAthleteDataAccess()` defined but never called~~ → RESOLVED (dead code removed)
It wasn't a missing gate; it was **leftover from the abandoned entitlement-gated design**.
Verified zero call sites. Removed in this pass (along with its unused `hasAccess` helper and
the stale `athletedata`/`competition_log` references) from `_shared/athletedata-access.ts`.
`hasCompetitionLogAccess` is kept as the always-true shim (its two callers —
`competition-placement`, `log-throwback` — are unchanged).

---

## Remaining work (operational — more urgent under free-to-all)

Free-to-all means maximum traffic funnels through one shared upstream key, so H1/H2 are the
real work now.

### H2 — cache the near-static competition catalog [DONE this pass]
`competition-catalog` (~340 rows, near-static) was fetched from the data service on every user
view. Under free-to-all that's every click of every authenticated user hitting the upstream.
Fixed by caching (see the implementation note in the commit / `competition-catalog`); the
catalog changes ~yearly, so a TTL cache collapses N user requests into ~1 upstream fetch per
window.

### H1 — shared `COMPETITION_SERVICE_KEY` rate-limit bucket [ASSESS after H2]
All wodwisdom users authenticate to the data service through one consumer key, and the data
service rate-limits per key — so every user shares one bucket; one hot user or bot can 429
everyone. **H2 removes the dominant source of that traffic (catalog).** After H2 lands,
re-measure: if the residual (search + workout-detail + placement) still crowds the bucket,
either add per-user throttling at the wodwisdom edge boundary or segment/raise the bucket in
the data service (a dedicated consumer key + higher `rate_limit_qps`, or splitting read vs.
write endpoints). Decide with real numbers, not preemptively.

---

## Lower-priority polish (unchanged)
- **Error disambiguation [S]:** the UI shows one generic "Could not load competition history"
  for a 404 (athlete never competed), a timeout, and a 500. Split 404 from transient errors.
  File: `components/competitionHistory/CompetitionHistoryExperience.tsx`.
- **Search rate limiting [S]:** `search-competition-athletes` clamps result count but has no
  per-user query-frequency limit (folds into H1's decision).
- **Linking-flow recovery [S]:** add retry / escape hatch if `verify-competition-athlete`
  times out.
- **Env var docs [S]:** `COMPETITION_SERVICE_BASE_URL`, `COMPETITION_SERVICE_KEY`,
  `WORK_CALC_SERVICE_KEY` are undocumented.
- Upstream health monitoring on competition-* outages.
