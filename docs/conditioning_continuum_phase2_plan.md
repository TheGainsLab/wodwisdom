# Continuum — Phase 2 design (targets from the curve, calibrate on switch)

Status: DESIGN for founder approval (2026-11-17). Spec: `conditioning_continuum_spec.md` §4, §7.
Phase 0 (measure) and Phase 1 (the sequencer reads the curve) are live.

Phase 2 is where the curve changes what the athlete is asked to do.

## Decisions needed (read these first)

1. **The intensity shares** (§3, table). Approve the first-pass values or edit them.
2. **One share per type, or rest-aware** (§3.2). Recommended: one number per type to start; refine from landings.
3. **How far a target may move per week** (§4). Recommended: ±5 % per band per 7 days.
4. **Rollout** (§8). Recommended: computed-but-hidden for a week, then a per-athlete switch, then everyone.

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
p_asked    = p_balanced × share_type            how close to that max this kind of day asks for
target     = trial_pace × p_asked × M_athlete(D(p_asked))
```

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
| Assess: time trial, rocket races B, infinity, synthesis | their paced blocks are TARGETED like any other (the athlete needs a number); their sessions are recorded and never move the curve |
| A machine/unit with no reference curve (Echo in metres/miles) | today's formula |

**Worked example.** MAP, 4 × 4 min, Echo, trial 18.4 cal/min, athlete's M at 4–10 min = 0.90.
`R(240 s) = 1.12` → `p_asked = 1.12 × 0.80 = 0.90` → `target = 18.4 × 0.90 × 0.90 = 14.9 cal/min`.
Same day on the rower, trial 2:05/500 m: `R(240 s) = 1.035` → `p_asked = 0.83` → 0.83 × trial pace × M. Today both machines get 0.95–1.05 × trial.

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

- **New edge function `engine-day-targets`**: given the athlete, the day (catalogue or override) and the machine/unit, returns per-block `{ target_pace, p_balanced, share, m, band, trial: { id, pace, date }, basis }`. `basis` says which rule produced the number: `curve` (the Phase 2 formula), `legacy` (today's formula, for athletes not yet switched — §8), `authored` (zone 2, flux lifts), `max_effort`, `no_curve` (machine/unit without a reference curve), `no_trial` (no current trial on this machine/unit — no number). Called with the athlete's JWT for their own days; an admin JWT may pass `target_user_id` for the rollout view (same pattern as `engine-resequence`).
- **Frozen at session start.** Targets are computed once, when the athlete starts the session (or on a time-trial save that creates the baseline), and stored on the session as a snapshot; every block save records against that snapshot. Nothing mid-session re-fetches or recomputes, so what was displayed is what is recorded, by construction.
- **Refresh on completion only.** `log-workout` (session completion) calls `computeAthleteContinuum` for that athlete through the Phase 1 shared module (`engine-continuum-io.ts`, change-only writes). Per-block saves do not refresh. The daily tick stays as the safety net.
- **`rolling_avg_ratio`** stops being an actuator for switched athletes. It is still written (analytics, legacy). The `gen:` exemption goes with it for switched athletes — curated and sequenced days are computed the same way (decided 2026-11-16). Athletes not yet switched keep today's formula exactly, rolling ratio and `gen:` exemption included (§8).

## 6. Calibrate on switch

- **No current trial on the selected machine/unit:** today the day page warns "complete a time trial to see pace targets" and lets the athlete start anyway. Phase 2: the warning becomes an offer — *"No baseline on the rower yet. Do a 10-minute time trial on it instead of today's session?"* Accepting opens the time-trial flow for that machine; the scheduled day is not consumed (it is next up when they return). Declining keeps today's behaviour: the day runs untargeted and the session reads `no_trial`.
- **Stale trial:** a current trial older than **40 days** on a machine with sessions in the last 28 days adds `TRIAL_STALE:<machine>` to the curve's flags, which the sequencer already reads; the system prompt tells it to treat the flag like TRIAL_LOW (an early retest is justified). The monthly day-one trial stays.
- **Unit switch on the same machine** (cal ↔ watts ↔ metres) is a different ruler: it is a "no current trial" case for that unit, as today.

## 7. Files

| Change | Where |
|---|---|
| Pure target math: `targetForBlock(block, machineCurve, athleteCurve, trial, share, opts)` + the weekly cap + the exception rules; tests on the exploration athlete's days on the Echo, the same days on a C2 rower and an outdoor run, and a watts session (no curve → `no_curve`) | `_shared/engine-targets.ts`, `engine-targets_test.ts` |
| `balancedPaceMultiple` already exists; add `effortBandOf(seconds)` export | `_shared/engine-continuum.ts` |
| Edge function `engine-day-targets` (athlete JWT) | `supabase/functions/engine-day-targets/` |
| Day page: call the function; drop `calculateIntervalGoal`'s fraction × rolling math; record the returned target on save; calibrate-on-switch offer | `src/pages/EngineTrainingDayPage.tsx` |
| Save path triggers the athlete's continuum refresh | `supabase/functions/save-workout-block`, `log-workout` (via `engine-continuum-io.ts`) |
| Migration: `intensityShare` on the 15 paced blocks' params; `engine_workout_sessions.targets` jsonb snapshot (per block: target_pace, p_balanced, share, m, band, basis, trial id/pace/date, formula version) — enough to reproduce every number | `supabase/migrations/2026111800xxxx_engine_targets_v2.sql` |
| Sequencer (rollout stage 3 only): legend + validator accept `intensityShare` choices; `can reach` lines in share terms; `TRIAL_STALE` in the prompt. Until then the sequencer keeps emitting `paceRange`, and for a switched athlete a sequenced block's share is the model's position within its `paceRange` envelope mapped linearly onto the block's `intensityShare` range | `_shared/engine-catalogue.ts`, `engine-sequence.ts`, `engine-continuum-reaches.ts`, `run-resequence.ts` |
| Admin: upcoming day's old vs new target per athlete (the rollout view, §8) | `src/pages/AdminContinuumPage.tsx` |
| Spec §4 / §7 / §8 updated; decisions log | `docs/conditioning_continuum_spec.md` |

Size: one new edge function, one new shared module, one migration, a day-page change, admin view. Roughly the size of Phase 0.

## 8. Rollout — targets athletes see change

The function always computes both formulas; `athlete_profiles.engine_targets_v2` decides which one the athlete's day page shows and the save records (`basis: curve` or `legacy`). Unswitched athletes are byte-for-byte on today's behaviour.

1. **Computed but hidden (one week).** Nobody is switched. The admin continuum page shows, for each athlete's next scheduled day, legacy target vs curve target with the basis, via the admin path of the function. The founder reads a dozen athletes: are the new numbers where a coach would put them? Shares and the weekly cap can be edited here without any athlete noticing.
2. **Per-athlete switch.** Flip the exploration athlete and two or three others who train on different machines. One cycle. The sequencer still emits `paceRange` for everyone (mapped to a share for switched athletes, §7).
3. **Everyone.** Default on; the sequencer switches to `intensityShare` choices; the per-athlete flag stays as an escape hatch for a month, then goes.

At every stage the save path records which basis produced the target, so landings can be read by rule.

## 9. Out of scope (Phase 3)

The athlete-facing continuum chart on Analytics, the Coach speaking in bands, a rest-aware share, refitting the reference curves from pooled max-effort data, and any change to the catalogue's shapes or to readiness.
