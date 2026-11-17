# Continuum — Phase 2 design (targets from the curve, calibrate on switch)

Status: APPROVED 2026-11-17 (all four decisions, below); building. Spec: `conditioning_continuum_spec.md` §4, §7.
Phase 0 (measure) and Phase 1 (the sequencer reads the curve) are live.

Phase 2 is where the curve changes what the athlete is asked to do.

## Decisions (founder, 2026-11-17)

1. **The intensity shares**: start with the derived values (§3); the hidden week is the review.
2. **One share per block** to start; rest-aware later, fitted from landings.
3. **Weekly cap ±5 %** per band; retests exempt.
4. **Rollout** computed-but-hidden → per-athlete switch → everyone; stage 2 may be short if the first reviews are clean.
5. (From review) the share is a share of **effort**; each machine's exponent converts it to pace.

Everything else below is mechanics that follow from §2.

---

## 1. Goals

1. **Targets move with the athlete's curve.** A band they keep beating asks for more; a band they miss in eases. Every training day, curated or sequenced. Max-effort days keep "beat this".
2. **Machine-aware pace.** The same catalogue entry produces the right pace on a rower and on an Echo, and paced work above today's 1.3× ceiling exists where the curve says a balanced athlete holds it.
3. **Compute at save.** The session's continuum values and the athlete's curve update when the session is logged, so tomorrow's target reflects today. The daily tick becomes the safety net.
4. **Calibrate on switch.** No target is shown from a missing trial; the day page offers a trial on that machine instead. A stale trial on a machine in use is flagged to the sequencer.

## 2. The target

Today (`EngineTrainingDayPage.tsx`, `calculateIntervalGoal`):

```
target = trial_pace × centre(paceRange) × rolling_avg_ratio        (catalogue days)
target = trial_pace × centre(paceRange)                            (sequenced days)
```

The fraction is machine-blind, and the rolling ratio is a per-type smoother that moves the target toward wherever the athlete has been landing (v1's failure mode: compliant training drags it).

Phase 2:

```
p_balanced = R_machine(work_seconds)            the pace a balanced athlete holds for this bout, on this machine's curve
p_asked    = p_balanced × share_type ^ k_machine  how close to that max this kind of day asks for — a share of EFFORT, converted to this machine's pace
target     = trial_pace × p_asked × M_athlete(D(p_asked))
```

**The share is a share of effort, not of pace.** On the Echo, calories track power, so a share of effort is a share of pace (`k = 1`). On a rower, power ∝ pace³, so 73 % of the effort is 90 % of the pace: `k = 0.30`, the same exponent Phase 0 used to derive the rower's curve from the Echo's. C2 calories `k = 0.73`, running ≈ `0.45` (the exponent relating the authored running curve to the Echo's at 30 s). Applied to pace directly, the rower's hybrid-anaerobic ask would come out at 0.83× — slower than threshold — which is why the exponent is there. `k` lives beside each reference curve in `engine_pd_curves` (one column), so a new machine brings its own.

- `R_machine` is the inverse of the reference curve already in `engine_pd_curves` (`balancedPaceMultiple`, built in Phase 0).
- `share_type` is one number per paced block (§3): the fraction of the balanced max this kind of work asks for. It is not a fourth term — it replaces today's pace fraction. The spec's `r_asked` (§4 of the spec) is now `R_machine(work) × share` instead of an authored fraction of trial.
- `M_athlete` is the athlete's curve, read at the effort band the asked pace lands in. 1.0 = balanced; above = they have shown more there, ask more; below = ask less.
- `work_seconds` is the block's longest work segment, as the continuum judges a session (decided 2026-11-16). Progressions (ascending's `paceIncrement`, devour's growing rounds) keep their shape: per-round offsets apply around the derived centre exactly as they apply around today's centre.

**Exceptions, unchanged from today**

| Family | Target |
|---|---|
| Zone 2: endurance, polarized base, flux and flux-stages base, towers' continuous blocks | fixed authored fraction (0.7×, 0.75–0.9× for towers) — a dose, not a max |
| Flux lifts (`fluxPaceRange`) | fixed authored fraction — deliberately sub-max and repeatable |
| Max effort: anaerobic, afterburner sprints, atomic / synthesis sprint blocks, polarized bursts | none — "beat this" |
| Assess: time trial, rocket races B, infinity, synthesis | their paced blocks are TARGETED like any other (the athlete needs a number; the basis is whatever rule produced it — there is no `assess` basis); "assess" is a day-type property: the session is recorded and never moves the curve |
| A machine/unit with no reference curve (Echo in metres/miles, any machine in watts) | today's formula, basis `no_curve` — it still needs a trial |

**Worked example.** MAP, 4 × 4 min, Echo, trial 18.4 cal/min, athlete's M at 4–10 min = 0.90.
`R(240 s) = 1.12` → `p_asked = 1.12 × 0.80 = 0.90` → `target = 18.4 × 0.90 × 0.90 = 14.9 cal/min`.
Same day on the rower, trial 2:05/500 m: `R(240 s) = 1.035`, `0.80^0.30 = 0.935` → `p_asked = 0.97` → 0.97 × trial pace × M. Today both machines get 0.95–1.05 × trial.

The same share across machines (before the athlete's M):

| Block | Echo cal | C2 rower, metres | C2 calories | Running |
|---|---|---|---|---|
| hybrid anaerobic, 85 s, share 0.73 | 1.13× | 1.04× | 1.09× | ≈ 1.09× |
| MAP, 240 s, share 0.80 | 0.90× | 0.97× | 0.92× | ≈ 0.93× |
| threshold, 600 s, share 0.92 | 0.92× | 0.98× | 0.94× | ≈ 0.96× |
| interval, 90 s, share 0.61 | 0.92× | 0.98× | 0.94× | ≈ 0.95× |

Rowing and running are not special cases: the same 15 shares apply, and each machine's curve and exponent turn them into that machine's pace. Today's rower asks for hybrid anaerobic (1.05–1.2×, ≈ 99 % of a balanced rower's 1-min max pace, repeated) come down to 1.04×; its MAP asks go up slightly.

## 3. The intensity shares

### 3.1 First pass, derived from today's Echo fractions

For each paced type: today's centre fraction ÷ the balanced pace for the type's mid work length, on the Echo curve (most of the base trains on fan bikes). `share` is the centre; the envelope range is ±0.05 around it unless noted.

| Type | Work (envelope) | Today's ask | Balanced pace, Echo | **share** | Note |
|---|---|---|---|---|---|
| threshold | 8–18 min | 0.85–0.95 | 0.98 | **0.92** | sustained, near max |
| devour | 3–6 min, growing | 0.85–1.0 | 1.11 | **0.83** | |
| rocket_races_a | 1.5–5 min | 0.95–1.1 | 1.23 | **0.83** | B inherits |
| descending_devour | 3 min | 0.9–1.05 | 1.20 | **0.81** | |
| max_aerobic_power | 1.5–5 min | 0.85–1.05 | 1.23 | **0.80** | 0.77 measured; rounded to the devour family |
| hybrid_aerobic | 1.5–4 min | 0.9–1.05 | 1.27 | **0.76** | |
| ascending_devour | 1–5 min | 0.9–1.05 | 1.31 | **0.75** | |
| hybrid_anaerobic | 1–2 min | 1.05–1.2 | 1.55 | **0.73** | on the rower today this is 0.99 — a max effort repeated |
| infinity | 1–4 min | 0.85–1.0 | 1.35 | **0.69** | assess: recorded, never moved |
| interval | 30 s–4 min | 0.8–1.1 | 1.55 | **0.61** | rest ⅓ of work; wide envelope → range 0.55–0.75 |
| towers (interval block) | 2 min | 0.8–1.05 | 1.35 | **0.68** | continuous blocks stay authored |
| ascending | 30–90 s | 0.9 → 1.3 | 1.85 | **0.59 → 0.75** | progression: start share → end share |

Shares attach to BLOCKS (the key sits in each block's params), so the count is of paced blocks, not types: the 12 types above plus the paced blocks inside the composite days — afterburner (blocks 2–3), atomic (block 2), synthesis (blocks 2 and 4) — 15 share entries, derived the same way. The remaining types carry no share: the zone 2 family (endurance, polarized, flux, flux_stages), pure max effort (anaerobic), time_trial, and rocket_races_b (inherits A's). The table is yours to edit. Two readings of it:

- Long work is asked near the balanced max on both machines (threshold 0.92). Short work is asked far below it on the Echo and near the max on the rower — the machine-blind problem in numbers. After Phase 2 the share is the same everywhere and the machine's curve does the conversion.
- The shares fall as work shortens and rest tightens, which is the repeat discount (§3.2) already baked into the authored fractions.

### 3.2 One share per type, or rest-aware?

**Recommended: one share per type**, as above. It is what the catalogue already encodes, it is fourteen editable numbers, and the landings will show where it is wrong (a type whose sessions keep reading as misses or as easy ceilings).

In Phase 2 the work:rest ratio therefore affects the target only through the type's share, which was derived from fractions that already encode each type's rest structure. Choosing a longer or shorter rest within one type's envelope does not move its target.

Alternative, later: `share = f(rounds, rest_ratio)` — a balanced athlete repeating a bout with equal rest holds less than their single-bout max; with 3× rest, almost all of it. `rest_ratio` is already stored per session, so this can be fitted from data once there is a cycle of Phase 2 landings. Not authored now.

### 3.3 Where the shares live

A new key in each block's params JSON on `engine_day_types`: `intensityShare: [min, max]`, beside `paceRange`. `paceRange` stays for the exceptions (zone 2, flux lifts, machines without a curve) and as the validator's fallback. One data migration writes the fourteen rows; the catalogue legend tells the sequencer to choose `intensityShare` within its range where present.

The sequencer's choice becomes a share, not a fraction of trial: "0.75" means three-quarters of the balanced max for whatever bout it sets. Its `can reach` lines (Phase 1) are recomputed in share terms.

## 4. How targets move

- **Per session**, the curve already moves by the asymmetric ratchet (ceilings set, floors raise only, misses lower only when the ask was sub-max; step clamp ±0.15; M within 0.7–1.5). Nothing new.
- **Per week, a cap on the displayed target**: the target for a band may move at most **±5 %** against the target shown 7 days earlier. The curve can know more than the athlete is asked to absorb; a brilliant day raises M, the target follows over two or three sessions rather than at once. (Recommended value; 3 % is conservative, 8 % is aggressive.)
- **After a retest**, the trial changes and every target changes with it — that is the point of a retest. The cap does not apply across a retest. M at 600 s is already folded to 1.0 and the sprint bands held provisional (`awaiting_right_anchor`) until the next max effort re-anchors them.
- **A miss** lowers M only when the ask was comfortably sub-max for a balanced athlete (today's rule), so one bad day on a hard ask does not ease the target.
- **What lowers M**, and so a target: a miss when the ask was sub-max; a retest (M at 600 s folds to 1.0 and nodes under 60 s are damped toward 1.0 until the next max effort re-anchors them). **What never lowers M**: a floor — completing a sub-max day at pace proves the floor and says nothing about the ceiling.

## 5. One calculation, computed at save

Today the day page computes the target in the browser and records it on save. Phase 2 moves the target into one place both sides use:

- **New edge function `engine-day-targets`**: given the athlete, the day (catalogue or override) and the machine/unit, returns per-block `{ target_pace, p_balanced, share, m, band, trial: { id, pace, date }, basis }`. `basis` says which rule produced the number, decided in this order: `no_trial` (no current trial on this machine/unit — no number, whatever the curve situation), then `max_effort` / `authored` (block rule), then `no_curve` (a trial but no reference curve for this machine/unit — today's formula), then `legacy` (athlete not switched, §8) or `curve` (the Phase 2 formula). Reference curves exist for the fan bikes, the Concept2-class ergs, the Rogue rower and every running modality in metres/miles/km/cal; watts and Echo distance have none. Called with the athlete's JWT for their own days; an admin JWT may pass `target_user_id` for the rollout view (same pattern as `engine-resequence`).
- **Frozen at session start.** The day page shows a preview before Start (same inputs, so normally the same numbers; it can differ only if a session completed in between). When the athlete presses Start, the page calls the function with `start: true`; the function computes the targets and returns them with a signed snapshot, which the page stores on the session row it creates (`engine_workout_sessions.targets`). The session is scored against that snapshot. Nothing after Start re-fetches or recomputes, so from Start onward what was displayed is what is recorded. A time trial has no target and no snapshot.
- **Refresh on completion.** Engine sessions are written by the browser today (`saveWorkoutSession`, a direct insert; no edge function sees the save). After a successful completion save the page calls `engine-continuum-backfill` for the athlete's own id — the function gains a third auth path: an athlete's JWT for their own `user_id` only — which runs `computeAthleteContinuum` (Phase 1 shared module, change-only writes). Fire-and-forget; the daily tick stays as the safety net. Legacy parity note: today the rolling ratio is updated once, at the completion save, so freezing at Start changes nothing for unswitched athletes.
- **`rolling_avg_ratio`** stops being an actuator for switched athletes. It is still written (analytics, legacy). The `gen:` exemption goes with it for switched athletes — curated and sequenced days are computed the same way (decided 2026-11-16). Athletes not yet switched keep today's formula exactly, rolling ratio and `gen:` exemption included (§8).

## 6. Calibrate on switch

- **No current trial on the selected machine/unit:** today the day page warns "complete a time trial to see pace targets" and lets the athlete start anyway. Phase 2: the warning becomes an offer — *"No baseline on the rower yet. Do a 10-minute time trial on it instead of today's session?"* Accepting opens the time-trial flow for that machine; the scheduled day is not consumed (it is next up when they return). Declining keeps today's behaviour: the day runs untargeted and the session reads `no_trial`. The offer is made whether or not the machine/unit has a reference curve: with a trial, a machine without a curve still gets today's formula (`no_curve`), so the trial is never wasted.
- **Stale trial:** a current trial older than **40 days** on a machine with sessions in the last 28 days adds `TRIAL_STALE:<machine>` to the curve's flags. The one-sentence explanation in the sequencer's system prompt (treat it like TRIAL_LOW: an early retest is justified) ships in the same PR as the flag, not at rollout stage 3. The monthly day-one trial stays.
- **Unit switch on the same machine** (cal ↔ watts ↔ metres) is a different ruler: it is a "no current trial" case for that unit, as today.

## 7. Files

| Change | Where |
|---|---|
| Pure target math: `targetForBlock(block, machineCurve, athleteCurve, trial, share, opts)` + the weekly cap + the exception rules + the legacy formula; tests on the exploration athlete's days on the Echo, the same days on a C2 rower and an outdoor run (both have reference curves), a watts session (`no_curve`), a machine with no trial (`no_trial`), and the legacy parity fixture | `_shared/engine-targets.ts`, `engine-targets_test.ts` |
| `balancedPaceMultiple` already exists; add `effortBandOf(seconds)` export | `_shared/engine-continuum.ts` |
| Edge function `engine-day-targets` (athlete JWT for own days; admin JWT + `target_user_id` for the rollout view; `start: true` writes the snapshot) | `supabase/functions/engine-day-targets/` |
| Day page: preview + Start call the function; store the snapshot on the session; score against it; calibrate-on-switch offer; after a completion save, kick the athlete's continuum refresh. `calculateIntervalGoal` is dropped only after a **parity test**: the function's `legacy` basis reproduces its numbers for every (day, machine, unit, rolling ratio) in a fixture of real sessions | `src/pages/EngineTrainingDayPage.tsx` |
| Backfill accepts an athlete's JWT for their own id (the completion refresh) | `supabase/functions/engine-continuum-backfill/index.ts` |
| Migration: `intensityShare` on the 15 paced blocks' params; `engine_pd_curves.k_effort` (1 fan bikes, 0.30 C2 metres, 0.73 C2 cal, 0.45 running); `engine_workout_sessions.targets` jsonb snapshot (per block: target_pace, p_balanced, share, m, band, basis, trial id/pace/date, formula version) — enough to reproduce every number | `supabase/migrations/2026111800xxxx_engine_targets_v2.sql` |
| Sequencer, Phase 2 PR: `TRIAL_STALE` sentence in the prompt. Sequencer, rollout stage 3: legend + validator accept `intensityShare` choices; `can reach` lines in share terms. The two representations are linear maps of each other within a block's envelope (position in `paceRange` ↔ position in `intensityShare`), so the fill step always writes BOTH keys on a generated block, whichever the model chose: a switched athlete reads the share, an unswitched or flipped-back athlete reads the fraction. The escape hatch therefore has its input in both directions | `_shared/engine-catalogue.ts`, `engine-sequence.ts`, `engine-continuum-reaches.ts`, `run-resequence.ts` |
| Admin: upcoming day's old vs new target per athlete (the rollout view, §8) | `src/pages/AdminContinuumPage.tsx` |
| Spec §4 / §7 / §8 updated; decisions log | `docs/conditioning_continuum_spec.md` |

Size: one new edge function, one new shared module, one migration, a day-page change, admin view. Roughly the size of Phase 0.

## 8. Rollout — targets athletes see change

The function always computes both formulas; `athlete_profiles.engine_targets_v2` decides which one the athlete's day page shows and the save records (`basis: curve` or `legacy`). Unswitched athletes are byte-for-byte on today's behaviour.

1. **Computed but hidden (one week).** Nobody is switched. The admin continuum page shows, for each athlete's next scheduled day, legacy target vs curve target with the basis, via the admin path of the function. The founder reads a dozen athletes: are the new numbers where a coach would put them? Shares and the weekly cap can be edited here without any athlete noticing.
2. **Per-athlete switch.** Flip the exploration athlete and two or three others who train on different machines. One cycle. The sequencer still chooses `paceRange`; the fill step writes the matching share as well (§7).
3. **Everyone.** Default on; the sequencer chooses `intensityShare`; the fill step writes the matching `paceRange` as well, so an athlete flipped back to legacy during the escape-hatch month still has a fraction to read. After the month the flag goes and the fill stops writing `paceRange` for curve-targeted blocks.

At every stage the save path records which basis produced the target, so landings can be read by rule.

## 9. Out of scope (Phase 3)

The athlete-facing continuum chart on Analytics, the Coach speaking in bands, a rest-aware share, refitting the reference curves from pooled max-effort data, and any change to the catalogue's shapes or to readiness.

## Built (2026-11-17) — steps 1–4, the hidden week

| Piece | Where |
|---|---|
| Pure target math (both formulas, exceptions, weekly cap, whole-day assembler, snapshot reader); 17 tests | `_shared/engine-targets.ts`, `engine-targets_test.ts`; `effortBandOf` / `mAtEffort` in `engine-continuum.ts` |
| Migration: `k_effort` on curves; `intensityShare` on **23** paced blocks (the plan's 15 was an undercount — hybrid aerobic, hybrid anaerobic, infinity, towers, afterburner and synthesis have several paced blocks each; derived mechanically, listed in the migration); `targets` snapshot column; `engine_targets_v2` flag | `20261118000000_engine_targets_v2.sql` (linted on local Postgres against the live catalogue) |
| `engine-day-targets` function: both formulas per work segment, the athlete's mode, the snapshot; admin may pass `target_user_id`; machine defaults to the latest current trial | `supabase/functions/engine-day-targets/` (`config.toml`: verify_jwt=true) |
| Backfill accepts an athlete's own JWT (the completion refresh, used by step 5) | `engine-continuum-backfill/index.ts` |
| Admin rollout view: "Next day — targets" on the continuum page, legacy vs curve per segment with Δ, basis, share, balanced pace, M, band | `src/pages/AdminContinuumPage.tsx` |

Nobody is switched: no athlete's day page changes. Deploy: `supabase db push`,
`supabase functions deploy engine-day-targets engine-continuum-backfill`, frontend.

Still to build: step 5 (day page — preview, Start snapshot, calibrate-on-switch
offer, completion refresh; the legacy parity fixture before the browser math
goes) and step 6 (sequencer: `TRIAL_STALE` now; share choices at stage 3).
