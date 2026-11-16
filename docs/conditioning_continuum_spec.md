# Conditioning continuum — pace fraction + ratchet on the power-duration curve

Status: DRAFT for founder review (2026-11-16). Nothing here is built.

Supersedes, once adopted, the parked signal changes from the 2026-11-15/16
review: pace-over-baseline as the headline, pooling per day type across
machines, anaerobic against the athlete's own best, and the rolling
multiplier on sequenced days. All four become one design.

## 1. The idea in one paragraph

An athlete's conditioning is a curve over one axis, from long steady
slow-twitch work on the left to short all-out fast-twitch work on the
right. The time trial sets the athlete's **level**. A reference
**power-duration curve** says what a balanced athlete at that level holds at
every other duration. Every training day lands on the axis by its own
parameters, and its target is `trial pace × expected fraction at that
duration × the athlete's multiplier at that position`. Beat the target and
the multiplier there ratchets up; miss it and it ratchets down. The
multiplier curve is the athlete's shape: flat means balanced, a dip is the
missing piece the sequencer prescribes into. One rule on every training
day, curated or sequenced.

## 2. What it replaces, and what it keeps

Replaced (sequencer inputs only — nothing the athlete sees goes away):

- `rolling_avg_ratio` / `last_5_ratios` per (day_type, modality) as the
  headline signal. Kept in the table for analytics; demoted in the prompt.
- The per-day-type rolling multiplier that moves curated targets, and its
  `gen:` exemption on sequenced days.
- The anaerobic "pace ÷ aerobic baseline" metric.
- The ENGINE ANALYTICS dump in the sequencer prompt.
- Energy-system tags as the way the sequencer reasons about what a day
  trains.

Kept, unchanged, because athletes and the product reference them:

- **Day types.** Names, coaching intent, envelopes, readiness
  prerequisites, the catalogue the sequencer picks from, the program
  mapping, the day-type labels on every screen and in every email. A day
  is still "Max Aerobic Power" to the athlete. The continuum position is
  an additional computed property of a day, not a replacement for its
  type.
- **Day-type tags** (`class`, `trains`, `prerequisites`). Readiness gating
  and the Analytics page still read them. They stop being the sequencer's
  evidence about the athlete; they remain the catalogue's description of
  the day.
- **The Analytics page** and `engine-analytics.ts`. Per-type, per-machine
  statistics stay as they are. The continuum view is added beside them,
  not instead of them.
- **Time trials** on day one of every month, per machine and unit.

## 3. Definitions

### 3.1 Position — where a day sits on the axis

Computed per **block** from its prescription, then combined per day. Scale
0–100: 0 = roughly an hour of continuous work, 100 = a 10-second effort.

```
duration_score  = 100 × (1 − (log10(work_seconds_per_bout) − 1) / 2.56)   # 10 s → 100, 3600 s → 0
intensity_shift = 50 × (prescribed_fraction − 0.90)                        # 1.20 → +15, 0.70 → −10
rest_shift      = 4 × log2(rest_seconds / work_seconds)                    # 5:1 → +9, 1:3 → −6
position        = clamp(duration_score + intensity_shift + rest_shift, 0, 100)
```

- `prescribed_fraction` for a max-effort block is taken as 1.30 for the
  position calculation only (the target itself comes from §3.3).
- Continuous work with bursts (polarized): weight by time, so the base
  dominates and the bursts barely move the position.
- A multi-block day's position is the work-time-weighted mean of its
  blocks; its **spread** (max − min block position) is stored beside it.
  A blended day is placed honestly as a blend, with its uncertainty
  visible. No per-block logging is asked of the athlete.
- The three coefficients (2.56, 50, 4) are first guesses tuned against the
  founder's placement of the 22 day types (table in §9). They are
  constants to revisit, not physiology.

Day type does not enter the formula. Two Max Aerobic Power days at 90 s and
5 min land eleven points apart, and should.

### 3.2 Expected fraction — the power-duration curve

`R(d)`: for a work-bout duration `d` (seconds), the pace a **balanced**
athlete holds, as a fraction of their 10-minute time-trial pace. One curve
per **machine and unit** (Echo bike calories, rower metres, ski-erg metres
do not scale alike). `R(600) = 1.0` by definition.

- v1: authored, anchored to the envelope midpoints the catalogue already
  encodes (endurance 0.70, threshold ~0.90, max aerobic power ~0.95–1.05,
  short intervals 1.1–1.3) and to observed max-effort data on the right
  (this athlete: 20 s ≈ 3.0, 30 s ≈ 2.7, 45 s ≈ 2.3, 60 s ≈ 1.5 on Echo bike
  calories).
- v2: fitted from the pooled max-effort sessions of all athletes per
  machine/unit, once there are enough.
- Stored as a small table of (seconds, fraction) points, interpolated on
  log-duration.

### 3.3 Target — what the athlete is asked to hold

For every work block, on every day, curated or sequenced:

```
target_pace = trial_pace(machine, units, current) × R(d) × M(position)
```

- `trial_pace`: the athlete's current time trial on that machine and unit.
  No trial on the machine → no target (see §6, calibrate on switch).
- `M(position)`: the athlete's multiplier at that position (§3.4).
- "Max effort" days are not special: the target is computed the same way
  and shown as "beat this". The athlete still goes all out; the target is
  the ratchet's reference, not a cap.
- Sequencer-generated days use this target too. The `gen:` exemption in
  `effectiveRollingMult` is removed. The sequencer chooses the day's shape
  (and so its position); it does **not** set intensity to chase the
  athlete — that is the ratchet's job (§5).

### 3.4 The athlete's multiplier curve `M(x)`

The athlete's shape. Dimensionless, **shared across machines** (the trial
carries machine level; the multiplier carries fibre-type balance), one per
athlete.

- Representation: a fixed grid of nodes along the axis (e.g. every 5
  positions, 21 nodes), each holding a multiplier and a confidence
  (effective session count with decay).
- Initial value: 1.0 at every node, confidence 0, on the athlete's first
  time trial.
- Bounds: `[0.80, 1.40]` per node, so one bad day cannot sink a region.
- **Level lives in one place.** The trial position (~35 for a 10-minute
  effort) is pinned: `M(35) = 1.0`. Time-trial sessions set the level and
  **never** update `M`. Between trials, ordinary sessions near 35 may drift
  the node — that drift is evidence the level has moved since the trial,
  and it is resolved at the next retest, not fought in between.
- **Retest = renormalise, then damp the right.** When a new trial lands:
  1. `trial_pace` takes the new value.
  2. Fold the drift back into the level: `M[n] /= M[35]` for every node,
     so `M(35)` returns to 1.0 and the shape is preserved relative to the
     new anchor.
  3. **Damped retest for the fast-twitch end.** A trial gained through
     aerobic work does not transfer fully to 20-second efforts. For nodes
     right of ~70, hold back part of the level jump as a one-time
     adjustment: `M[n] *= (old_trial / new_trial) ^ β × ramp(n)`, with
     `β ≈ 0.5` and `ramp` rising from 0 at position 70 to 1 at 100. The
     next anaerobic sessions then ratchet those nodes to wherever the
     athlete really is. (This is not a new concept: it is the ordinary
     ratchet applied once at the moment the level changes.)
  4. Confidence is left alone; shape survives, level updates.

### 3.5 Delivered fraction and the normalised height

Per session (or per block where blocks are logged separately — the day
page only takes one total today, so per session):

```
delivered_fraction = actual_pace / trial_pace
normalised_height  = delivered_fraction / R(d)        # 1.0 = balanced at this position
ratio_vs_target    = actual_pace / target_pace        # = normalised_height / M(position)
```

`normalised_height` is the point plotted on the chart and the quantity
the ratchet moves `M` toward. `ratio_vs_target` is the athlete-facing
"hit / beat / missed" and stays as the in-session feedback.

### 3.6 Refitting the static curve

`R(d)` is static per machine/unit, but it will be refit as data
accumulates. A refit **must replay every athlete's multiplier**: rerun the
ratchet over each athlete's session history against the new `R(d)` and
replace their `M`. Changing the shape under unchanged multipliers would
move every target at once for reasons the athlete never caused.

The replay doubles as the diagnostic that says when a refit is due: the
**average `M` across athletes should sit near 1.0 at every position.**
Where it does not, the static curve is wrong there — the population is
systematically above or below "balanced" at that duration, which means the
curve, not the athletes, is off. Report that average per machine/unit on
the admin side.

### 3.7 One multiplier, several units — the Echo problem

The trial is per machine and unit; the multiplier is shared. A multiplier
of 1.05 learned on rower metres is then applied to Echo-bike calories,
where "5 % above balanced" is a different size of ask: rower pace scales
with roughly the cube root of power, Echo calories scale close to linearly
in power with an offset. The same `M` is a different physical demand on
each machine.

Options:

- **Convert to a power equivalent before the fraction math.** Where the
  machine publishes a conversion (Concept2: cal/hr = 4·W + 300; metres from
  pace via the 2.80/pace³ relation; Rogue's Echo table), compute
  `delivered_fraction`, `R(d)` and `M` in watt-equivalents, and convert the
  target back to the athlete's units for display. `M` is then shared in a
  common currency. Recommended where a conversion exists.
- **Per-machine `M` with a shared prior.** A new machine starts from the
  shared curve and diverges with its own sessions. Simpler, but the
  picture fragments again for rotating athletes, which is the problem the
  shared curve exists to solve.
- **Per-unit `R(d)` absorbing the non-linearity, shared `M`.** The v1
  proposal. Acceptable to start; wrong by a few percent on the Echo at the
  extremes.

**Decided 2026-11-16: the shape is shared; option 1.** Level stays per
machine (each machine keeps its own trial; nothing predicts one machine's
capacity from another). Shape — the multiplier — is a property of the
athlete and transfers. Watts are used only so a given percentage means the
same physical demand on every machine: convert pace → watt-equivalent
before the fraction math, convert the target back to the athlete's unit
for display. The athlete never sees watts unless they chose watts. Option
3 (per-unit curves) remains the fallback for a machine with no published
conversion.

## 4. The ratchet

After every scored session on a machine with a current trial:

```
err   = clamp(normalised_height − M(x), −0.15, +0.15)   # x = the day's position
for each node n:
    w = exp(−((n − x) / σ)²)          # σ ≈ 8 positions: neighbours move a little
    M[n] += k × w × err               # k ≈ 0.5
    conf[n] += w
```

- Direction symmetric: beat the target, the region rises; miss it, it
  falls. The athlete is always asked for a little more than last time
  until they stop beating it — the floor finds the ceiling.
- **Off below position ~20.** Zone-2 work is dose, not capacity. Endurance
  and polarized sessions log for adherence and are plotted as "trained",
  but do not move `M` and carry no target ratchet. Their `R(d)` fraction is
  the prescription, full stop.
- Multi-block days with spread > ~25 update with half weight, spread over
  the block positions rather than the mean.
- **Assess days never ratchet** (decided 2026-11-16). They are recorded and
  plotted; `M` is untouched. Rocket Races B in particular measures pacing
  repeatability against A's actual pace, not capacity against the curve.
- Decay: node confidence decays with a ~60-day half-life so an old region
  is weakly held; `M` itself does not decay (an old 1.2 is still the best
  estimate until contradicted).
- Clamp per step (±0.15) and per node (§3.4) bound the damage of a
  mis-logged session.

## 5. What the sequencer receives

Replace the per-(type, machine) ratio table and the analytics dump with:

```
ATHLETE CONDITIONING CURVE (multiplier vs balanced shape; 1.0 = balanced at your level)
position:  0-20 (zone 2, dose only) | 25   35   45   55   65   75   85   95
M:         —                         | 0.93 1.00 1.04 1.08 1.15 1.22 1.28 1.31
conf (n):  12 sessions, last 3 d ago | 4    3    6    5    2    3    4    7
trend 28d:                           | ↓    →    ↑    ↑    ?    →    ↑    ↑
Trials (echo bike, cal): 16.1 (09-14) → 18.4 (10-15)   [last 6 shown]
Days since last session: 3.  Sessions: 11 in 28 d (cadence implies 12), 20 in 90 d.
```

Then, unchanged: the readiness-filtered catalogue with envelopes and
coaching intent, the previous block (variety), per-type caps, never-done
types, other training load, the programming week, coach notes.

The prompt's instruction simplifies to: *prescribe into the lowest
well-measured region without letting the strong regions sag; probe a
region marked "?" with a day placed there; choose the day's shape and the
ratchet sets its intensity — do not chase the athlete with the pace
fraction.* The envelope's pace range becomes the band the ratchet may move
the target within, not a value the model picks.

Day types remain the vocabulary the model uses to name a day, exactly as
now; the catalogue tells it what shapes each type permits. The model
decides the type and the shape; the system computes position and target.

## 6. Calibration rules (unchanged in spirit, made explicit)

- A session on a machine/unit with no current trial produces **no target
  and no ratchet update**. The day page already warns; it should also
  offer "do a time trial on this machine instead of today's session", which
  sets the baseline and counts as the day. (Parked change 3.)
- A trial older than ~40 days on a machine the athlete still uses is
  flagged in the sequencer's block; the model may place a trial there.
- The monthly day-one trial stays.

## 7. Athlete-facing views

- **Training day:** target pace shown as today, with "beat this" on
  max-effort days. The day's type, name and coaching intent unchanged.
- **Analytics page:** existing per-type, per-machine stats unchanged. Add
  one chart: the continuum. Two toggles — *raw* (delivered pace vs the
  expected curve, in the athlete's units) for pacing intuition, and
  *balanced* (normalised height, flat 1.0 line) for strengths and gaps.
  Points are sessions; the fitted `M` curve is drawn through them; the
  zone-2 region is shaded "trained, not scored".
- **Coach chat:** reads the same `M` curve and speaks in day-type names.

## 8. Data model

New:

- `engine_pd_curves` — (modality, units, seconds, fraction). The reference
  curves, authored v1.
- `athlete_profiles.engine_curve` (jsonb) — `M` nodes + confidence +
  updated_at. One row per athlete; small; rewritten by the ratchet.
- `engine_workout_sessions.position`, `.position_spread`,
  `.delivered_fraction`, `.normalised_height` — computed at save (and
  backfillable from `workout_data` + `target_pace` + the trial history, as
  the 2026-11-16 exploration did for one athlete).

Unchanged: `engine_time_trials`, `engine_user_performance_metrics` (kept
for analytics; no longer the sequencer's headline), `engine_day_types`,
`engine_workouts`, `engine_program_mapping`.

## 9. Day-type placement (reference, not an input)

Positions a typical prescription of each type lands at under §3.1, for
tuning the coefficients and for the catalogue's own sanity. The system
never uses this table; it computes position from the day as written.

| Pos | Type | | Pos | Type |
|---|---|---|---|---|
| 5 | endurance | | 45 | hybrid_aerobic |
| 8 | polarized | | 55 | rocket_races_a / b |
| 18 | flux | | 65 | ascending |
| 20 | threshold | | 75 | hybrid_anaerobic |
| 22 | flux_stages | | 90 | anaerobic |
| 25 | devour | | 35 + 95 | atomic (spread) |
| 28 | towers | | 40–65 | infinity (assess) |
| 30 | ascending_devour / descending_devour | | 25 / 45 / 90 | afterburner (assess) |
| 35 | time_trial | | whole axis | synthesis (assess) |
| 40 | max_aerobic_power (3–5 min) | | | |

## 10. Migration

1. Author `R(d)` for Echo bike cal, rower m, ski-erg m, bike-erg m from
   envelope midpoints + observed max-effort data. Validate against the
   36-session exploration (`scratchpad` chart, 2026-11-16).
2. Backfill `position` and `normalised_height` for all sessions. Initialise
   `M` for each athlete by running the ratchet over their history in date
   order (so nobody starts from flat 1.0 except true newcomers).
3. Switch the target computation to §3.3 on the day page. Remove the
   `gen:` exemption. The athlete sees the same screen with slightly
   different numbers.
4. Switch the sequencer prompt to §5. Keep the old ratio table in the
   prompt for one cycle, labelled "legacy", then drop it.
5. Add the continuum chart to Analytics.

## 11. Open questions for the founder

- ~~Node spacing and `σ`~~ **Decided 2026-11-16: start at nodes every 5,
  σ = 8**, one width for the whole axis. Founder notes differences on the
  right are starker; split the width only if the fast-twitch end looks
  smeared in practice.
- ~~Should `M` be per machine after all?~~ **Decided 2026-11-16: shared
  shape, per-machine level** (§3.7).
- ~~The zone-2 cutoff (~20): fixed, or per athlete?~~ **Decided 2026-11-16:
  fixed.** Zone 2 is defined by intent, not by the athlete.
- ~~Should assess types ratchet, or only record?~~ **Decided 2026-11-16:
  record only.** Assess days (time trial, rocket_races_b, infinity,
  afterburner, synthesis) are plotted as points and never move `M`. The
  ratchet learns from develop days only.
- ~~Echo bike calories are non-linear in watts~~ **Decided 2026-11-16:
  watt-equivalent conversion** (§3.7).
- Damped retest: `β` and the 70→100 ramp (§3.4) are guesses.

## 12. Parked list, reconciled

| Parked change | Under this spec |
|---|---|
| 1. Trial history to last 6 | Keep. §5 shows last 6. |
| 2. Pace over baseline headline | Absorbed: §3.5 normalised height. |
| 3. Calibrate on machine switch | Keep. §6. |
| 4. Pool per type across machines | Absorbed: `M` is shared across machines. |
| 5. Drop PH tags; blend multi-block honestly | Keep tags as UI/catalogue (founder); §3.1 spread handles the blend. |
| 6. Anaerobic vs own best | Absorbed: max-effort days use the same target rule. |
| 7. Shrink the prompt | §5. |
| 8. Ratchet on sequenced days | Absorbed: §3.3, §4. |
| Catalogue "when to use" guidance into DB | Keep; independent of this spec. |
