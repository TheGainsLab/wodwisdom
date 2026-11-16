# Continuum — Phase 0 build plan (data only, nothing athlete-facing)

Status: PLAN for founder approval (2026-11-16). Spec: `conditioning_continuum_spec.md` v2.

Goal: compute the continuum for every Engine athlete from existing data,
show it to the admin, and produce the cross-athlete diagnostic — so the
founder can judge the 2.6, the curve values and the 0.85 on real charts
before anything the athlete sees changes. No change to targets, the
sequencer, the log screen or Analytics in this phase.

## Deliverables

1. **Reference curves** — `engine_pd_curves` table + seed.
2. **Pure compute module** — `_shared/engine-continuum.ts`, unit-tested
   against the exploration athlete.
3. **Per-session columns + per-athlete curve** — migration + backfill
   function, kept fresh by the existing daily cron.
4. **Admin page** — `/admin/users/:id/continuum`, the chart as built on
   2026-11-16, plus a population diagnostic on the admin overview.

Estimated size: ~4 files new, ~4 touched, one migration. No frontend
change visible to athletes.

---

## 1. Reference curves — `engine_pd_curves`

```sql
CREATE TABLE engine_pd_curves (
  modality text NOT NULL,          -- 'echo_bike', 'c2_row_erg', ...
  units    text NOT NULL,          -- 'cal', 'meters', 'watts'
  r        numeric NOT NULL,       -- multiple of the 10-min trial pace
  seconds  integer NOT NULL,       -- balanced max single bout at that pace
  PRIMARY KEY (modality, units, r)
);
```

Seed v1 (founder anchors + envelope midpoints), per §3.2 of the spec:

- `echo_bike / cal`: 3.2→10, 2.9→20, **2.6→30**, 2.2→45, 1.8→60, 1.35→120,
  1.2→180, 1.12→240, **1.0→600**, 0.95→900, 0.92→1200, 0.88→1800, 0.82→3600.
- `c2_row_erg / meters`, `c2_ski_erg / meters`, `c2_bike_erg / meters`:
  the Echo curve expressed in watts and converted back to pace per unit
  (see §2 conversions) — a first pass; refit from each machine's own
  max-effort data at the Phase 0 checkpoint.
- Any (modality, units) without a row → the athlete's sessions on it are
  computed with `evidence = 'no_curve'` and shown greyed; nothing is
  guessed.

Interpolation on log-duration between rows; clamp outside the range.

## 2. Pure compute module — `supabase/functions/_shared/engine-continuum.ts`

All pure functions, no I/O, `engine-continuum_test.ts` beside it.

```ts
// Unit → watt-equivalent, Concept2 published relations; Echo cal = identity (decided).
wattsFromPace(modality, units, pacePerMin): number | null
paceFromWatts(modality, units, watts): number | null
//   c2 meters: watts = 2.80 / (secondsPerMeter)^3 ; c2 cal: watts = (cal/hr − 300) / 4 ; watts: identity ; echo cal: identity (per-cal curve)

// Static curve
balancedBout(curve, r): number            // D(r), log-interp
balancedPaceMultiple(curve, seconds): number // R(d), inverse (for the targets in Phase 2)

// Per session
sessionContinuum(session, trialInForce, prescription, curve): {
  r: number,                 // delivered_pace / trial_pace (watt-equivalent where converted)
  bout_seconds: number,      // LONGEST work block from the prescription (decided); continuous days: total work; fallback: total_work_time / total_intervals
  sustain: number,           // bout_seconds / balancedBout(r)   (uncapped in storage; chart caps at 1.3)
  evidence: 'ceiling' | 'floor' | 'miss' | 'record' | 'zone2' | 'no_trial' | 'no_curve',
  rest_ratio: number | null,
}
//   ceiling: max-effort day by envelope, or sustain >= 0.85 (open threshold, spec §11)
//   floor:   completed at/above asked pace, sustain < 0.85
//   miss:    delivered < asked pace (target_pace stored on the session)
//   record:  assess day types (time_trial, rocket_races_b, infinity, afterburner, synthesis)
//   zone2:   r < 0.85
//   no_trial / no_curve: not computable

// The athlete's curve
replayCurve(sessionsInDateOrder, trials): EngineCurve
//   nodes: log10 grid 0.85×..3.5× step 0.05; each { r, m, conf, state: 'measured'|'floor'|'blank' }
//   asymmetric ratchet per spec §4: ceiling → set toward sustain; floor → raise only; miss → lower; record/zone2 → none
//   σ = 0.1 log10, step clamp ±0.15, bounds [0.7, 1.5], conf half-life 60 d
//   pinned M(1.0) = 1.0; retest: fold drift (divide by M(1.0)), hold back half the level change above 1.8× until the next ceiling-evidence anaerobic session
summarizeCurve(curve): RegionSummary[]   // the 7 regions of spec §5 with M, state, n, trend, flags (TRIAL_LOW, CEILING_ABOVE_BALANCED, UNCALIBRATED machines)
```

Tests (fixture = the 38 sessions + 2 trials of the exploration athlete,
copied into `_shared/fixtures/continuum_athlete.json`):

- anaerobic 2026-09-15 → r 2.63, sustain ≈ 1.04, evidence ceiling
- threshold 2026-10-02 → r 1.06, sustain > 1.0 → TRIAL_LOW flag on the curve
- max_aerobic_power 2026-10-28 → r 1.00, sustain ≈ 0.51, evidence floor
- interval 2026-10-30 → r 1.36, evidence floor; interval 2026-10-02 → r 1.73, ceiling
- endurance → zone2, no ratchet effect
- replay: curve has `blank` between 1.1× and 1.7×; measured at 0.9–1.1× and ≥ 1.7×; CEILING_ABOVE_BALANCED true
- retest on 2026-10-15 folds M(1.0) to 1.0 and leaves confidence
- a session on a machine with no trial → no_trial, no effect
- multi-block fixture (atomic-shaped) → bout = longest block

## 3. Storage + backfill

Migration `2026111500000_engine_continuum.sql`:

```sql
ALTER TABLE engine_workout_sessions
  ADD COLUMN continuum_r        numeric NULL,
  ADD COLUMN continuum_bout_s   integer NULL,
  ADD COLUMN continuum_sustain  numeric NULL,
  ADD COLUMN continuum_evidence text    NULL;   -- CHECK IN ('ceiling','floor','miss','record','zone2','no_trial','no_curve')
ALTER TABLE athlete_profiles
  ADD COLUMN engine_curve jsonb NULL;            -- { nodes:[...], flags:[...], computed_at, version }
-- engine_pd_curves as in §1, seeded
-- admin RPCs (SECURITY DEFINER, admin-gated like admin_list_engine_sessions):
--   admin_engine_continuum(target_user_id)  → sessions (date, day_type, modality, units, actual_pace, continuum_*), trials, engine_curve
--   admin_continuum_population()            → per (modality, units, region): avg M, n athletes   -- the "average near 1.0" diagnostic
```

Backfill function `engine-continuum-backfill` (service/admin auth,
ack-then-work like the crons): for each athlete with Engine sessions,
load sessions + trials + curves, compute per-session values, write them,
replay the curve, write `engine_curve`. Idempotent; a flag on the
athlete's curve records the module version so a changed `D(r)` or
threshold triggers recompute (spec §3.6: a refit replays everyone).

Keeping it fresh in Phase 0: add one call to the existing daily
`reconcile-engine-months` / lifecycle cron tick (whichever runs daily)
that recomputes athletes with sessions newer than their curve's
`computed_at`. Live compute at save belongs to Phase 2 with the targets.

## 4. Admin page

- Route `/admin/users/:id/continuum` → `AdminContinuumPage.tsx`, using
  `AdminSubPageLayout` like the other sub-pages; a button on
  `AdminUserDetailPage` next to "Engine sessions".
- Data via `supabase.rpc('admin_engine_continuum', { target_user_id })`.
- The chart exactly as built on 2026-11-16 (log x in multiples of the
  trial, two anchor lines, zone 2 shaded, filled dots = ceiling, upward
  stems = floor, grey = zone 2, envelope through ceilings), plus the
  7-region summary table the sequencer would receive (spec §5), the flags,
  and the trial history. Hover shows the session's numbers.
- A per-machine selector when the athlete has more than one machine.
- Admin overview (`AdminPage`): one small table from
  `admin_continuum_population` — average M per region per machine/unit,
  athletes counted — the spec §3.6 diagnostic.

## 5. Checkpoint (founder, before Phase 1)

Look at 5–6 athletes' pages (the exploration athlete, a rower, a
multi-machine athlete, a new 3-day athlete, a long-tenured one) and decide:

- Does 2.6× hold as the balanced 30-s ceiling on Echo cal? (first athlete:
  3.0–3.2, a stretch; need more)
- Do the curve values between the anchors look right — are threshold days
  landing at 0.90–0.95× with sustain near 1.0?
- Is 0.85 the right "reached the curve" line, or is it catching too much /
  too little?
- Do the TRIAL_LOW flags correspond to athletes who later retested up?
- Does the population diagnostic sit near 1.0 by region, and where not, is
  it the curve or the athletes?

Decisions from the checkpoint go into the spec's decisions log; a changed
curve or threshold reruns the backfill.

## Built (2026-11-16) and how to deploy

| Piece | Where |
|---|---|
| Pure module + 18 tests | `supabase/functions/_shared/engine-continuum.ts`, `engine-continuum_test.ts`, fixture `fixtures/continuum_athlete.json` |
| Prescription expander | `supabase/functions/_shared/engine-continuum-prescription.ts` (longest work block via `engine-block-resolve`) |
| Migration | `supabase/migrations/20261116000000_engine_continuum.sql` — linted on a local Postgres 16, idempotent |
| Backfill function | `supabase/functions/engine-continuum-backfill/` (`config.toml`: verify_jwt=false; gates itself) |
| Daily refresh | `lifecycle-nudges` kicks `{ all: true, stale_only: true }` at the start of its tick |
| Admin page | `/admin/users/:id/continuum` (`src/pages/AdminContinuumPage.tsx`), linked from the athlete page's Engine section |
| Population diagnostic | "Continuum · population" table on the admin overview |

Deploy, in order:

1. `supabase db push` (the migration seeds `engine_pd_curves`; no data is
   recomputed yet).
2. `supabase functions deploy engine-continuum-backfill --no-verify-jwt`
   and `supabase functions deploy lifecycle-nudges --no-verify-jwt`.
3. Frontend deploy.
4. First full backfill, once, from an admin session or with the cron key:
   `POST /functions/v1/engine-continuum-backfill` body `{ "all": true, "stale_only": false }`
   (acks 202; per-athlete lines in the function log). From then on the
   daily tick keeps curves fresh; the admin page's button recomputes one
   athlete on demand.
5. Open a few athletes' continuum pages and the overview's population
   table — that is the checkpoint (§5).

## v2 (2026-11-16, after the first production run)

- `20261116200000_engine_continuum_v2_native_curves.sql`: adds
  `continuum_effort_s`; replaces the Concept2 curves with native pace
  multiples (metres 1.33× @ 30 s, calories ≈ 2.0×).
- Module v2: no unit conversion; the athlete's curve is indexed by effort
  seconds; regions are duration bands; flags computed against each
  machine's own curve.
- Admin chart: x = effort duration (60 min on the left … 10 s on the right),
  anchors at 10 min and 30 s, zone 2 shaded at 40 min+.
- Deploy: `supabase db push`, redeploy `engine-continuum-backfill`, frontend,
  then a full run `{ all: true, stale_only: false }` (curve version changed;
  every athlete replays).

## Checkpoint outcome (2026-11-16)

- 0.85 "reached the curve" line: kept.
- Anchors: 2.6× is peak power (≈ 2.6× VO2max power), a 10–15 s effort, so it
  moves to **15 s**; the **30-s point is 2.2×**, the glycolytic reference and
  this base's median. The population bands 30 s–2 min had read 0.86 with
  2.6× at 30 s — the curve, not the athletes. Concept2 curves follow
  (metres ≈ 1.27× @ 30 s, calories ≈ 1.78×); the running curve is unchanged.
  Migration `20261116600000_engine_continuum_anchor_15s.sql`.
- Flags renamed: `AEROBIC_SIDE_BEHIND_SPRINT` (was CEILING_ABOVE_BALANCED —
  a high sprint ratio is an aerobic weakness, not a strong sprint) and
  `GLYCOLYTIC_BELOW_BALANCED`.
- Running curve authored for all running modalities and units
  (`20261116500000`); Echo metres/miles left without a curve.
- Deploy: `supabase db push`, redeploy `engine-continuum-backfill`, then a
  full run `{ all: true, stale_only: false }`. Then Phase 1.

## Out of scope for Phase 0

Targets, the ratchet affecting what athletes are asked, the sequencer
prompt, the athlete-facing chart, calibrate-on-switch, the catalogue
guidance column, trial history to 6 in the sequencer block (that one is a
one-line change and can ride along if wanted).
