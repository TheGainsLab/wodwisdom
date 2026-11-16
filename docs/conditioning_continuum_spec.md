# Conditioning continuum — two anchors, a ratchet, and a curve the sequencer reads

Status: DRAFT v2 for founder review (2026-11-16). Nothing here is built.
v2 replaces the v1 draft of the same day: position is no longer fitted
from a prescription's parameters; it is read from the pace the athlete
delivered, placed between two anchors the athlete cannot argue with.

Supersedes, once adopted, the parked signal changes from the 2026-11-15/16
review (pace-over-baseline headline, pooling per day type across machines,
anaerobic against own best, rolling multiplier on sequenced days).

## 1. The idea in one paragraph

An athlete's conditioning is a curve over one axis: **pace as a multiple
of their own 10-minute time trial**, on a log scale. Left is slow-twitch,
long steady work around 0.7×; right is fast-twitch, all-out work around
2.6× and beyond. Two anchors place everything: the **time trial** (1.0×)
sets the level, and the **max-effort anaerobic day** (30 s all-out, long
rest) sets the ceiling, which no day can be constructed to exceed. A
balanced athlete's 30-s ceiling sits at **2.2×** on Echo-bike calories
(the 2.6× peak-power figure belongs to a 15-s effort — re-anchored
2026-11-16, see the decisions log). Every
logged session lands on the axis at the pace it was actually ridden, and
its height is **how long the athlete sustained a bout at that pace**
against what a balanced athlete sustains there. Max efforts pin the
ceiling; sub-max days prove floors. The **ratchet** raises floors toward
ceilings by asking a little more each time. The resulting curve is what the
sequencer reads: where the athlete is above balanced, below it, or never
measured. The sequencer prescribes into the gaps and **probes** the
blanks. Day types, tags and the Analytics page stay exactly as the
athlete-facing vocabulary.

## 2. What it replaces, and what it keeps

Replaced (sequencer inputs only — nothing the athlete sees goes away):

- `rolling_avg_ratio` / `last_5_ratios` per (day_type, modality) as the
  headline signal. Kept in the table for analytics; demoted in the prompt.
- The per-day-type rolling multiplier on curated targets and its `gen:`
  exemption on sequenced days.
- The anaerobic "pace ÷ aerobic baseline" metric — replaced by the
  anaerobic day as the right-hand anchor.
- The ENGINE ANALYTICS dump in the sequencer prompt.
- Energy-system tags as the sequencer's evidence about the athlete.
- (v1 only) the fitted position formula and its coefficients — gone.

Kept, unchanged, because athletes and the product reference them:

- **Day types.** Names, coaching intent, envelopes, readiness
  prerequisites, the catalogue the sequencer picks from, the program
  mapping, every label on every screen. A day is still "Max Aerobic Power"
  to the athlete. The continuum reads what happened on it; it does not
  rename it.
- **Day-type tags** (`class`, `trains`, `prerequisites`): readiness gating
  and the Analytics page still read them. Not the sequencer's evidence.
- **The Analytics page** and `engine-analytics.ts`. The continuum view is
  added beside them.
- **Time trials** on day one of every month, per machine and unit.
- **The log screen.** One total per session. No per-block or per-interval
  logging is asked of anyone.

## 3. Definitions

### 3.1 The axis — pace as a multiple of the trial

```
r = delivered_pace / trial_pace(machine, units, current)
```

Plotted on a log scale. No fitted position; no coefficients. The
prescription's parameters (bout, rest, asked pace) do not decide where a
session sits — the athlete does, by the pace they delivered. Duration and
rest are consequences of intensity, not its definition: an athlete does
not go far above the asked pace "at a position"; they move right.

Landmarks on the axis (Echo bike, cal; other units have their own):

| r | meaning |
|---|---|
| ~0.70 | zone 2 — endurance, polarized, flux. Trained, never scored (§4) |
| 0.90–0.95 | threshold |
| **1.0** | **the time trial. Pinned: the level.** |
| 1.1–1.5 | aerobic power, hard intervals |
| 1.5–2.2 | glycolytic repeats, rocket races, hybrid anaerobic |
| **2.2** | **balanced 30-s max effort. The ceiling for a balanced athlete.** |
| 2.6 | balanced 15-s peak (research: peak power ≈ 2.6× VO2max power) |
| > 2.6 | fast-twitch stretch — the athlete's own ceiling is past balanced |

The two anchors are inarguable: the trial is a measured 10-minute best,
and the anaerobic day (30 s all-out, ~5:1 rest) is the hardest effort any
day in the program can construct. An athlete's own ceiling may sit above
or below 2.2; that single number is the fast-twitch / slow-twitch read —
and read the founder's way: a 30-s max well above the curve, relative to
the trial, is an aerobic side that lags the sprint, not a strong sprint.

### 3.2 The static curve — balanced duration at a pace

`D(r)`: the longest single bout a **balanced** athlete sustains at pace
`r×trial`. One curve per **machine and unit**. Authored v1 from the two
anchors plus the catalogue's envelope midpoints; refit from pooled
max-effort data later (§3.6).

Echo bike, calories, v1 (seconds at multiple of trial):
`2.8×→10 s · 2.6×→15 s · 2.5×→20 s · 2.2×→30 s · 1.95×→45 s · 1.75×→60 s · 1.35×→120 s ·
1.2×→180 s · 1.12×→240 s · 1.0×→600 s · 0.95×→900 s · 0.92×→1200 s ·
0.88×→1800 s · 0.82×→3600 s`. Interpolated on log-duration. (This is the
same curve as v1's `R(d)`, read the other way round.)

### 3.3 Height — how long the athlete sustained it

```
y = bout_seconds / D(r)
```

- `y ≈ 1.0`: the athlete sustained what a balanced athlete sustains at that
  pace — the session **reached the curve**. It pins the ceiling there.
- `y < 1.0` on a sub-max day: the athlete sustained *at least* this. A
  **floor**. It says nothing about the ceiling.
- `y > 1.0`: the athlete sustained **longer** than the balanced maximum at
  that pace. Only possible if the level is wrong → **the trial is low**
  (§6, diagnostic). Observed on this athlete 2 & 7 Oct 2026, confirmed by
  the 15 Oct retest (16.1 → 18.4).

A session is a **max effort** (ceiling evidence) when the day type is
max-effort by envelope, or when `y ≥ 0.85` on any day. Otherwise it is a
floor.

Multi-block days: one logged total, so one `r` and one bout length (the
longest work block, or the work-time-weighted mean, to decide). Honest
blend; no per-block logging.

Continuous-with-bursts days (polarized, flux): `r` from the whole session's
pace, which the base dominates → they land in zone 2, as intended. Their
contribution to fitness shows up as the trial rising, not on the curve.

### 3.4 The multiplier curve `M(r)` — what the sequencer reads

The athlete's estimated ceiling along the axis, as a fraction of balanced:
1.0 = balanced at this athlete's level. One per athlete, **shared across
machines** (the trial carries machine level; the shape is the athlete's —
decided 2026-11-16, §3.7 for units).

- Nodes on a log grid from 0.85× to 3.5× (e.g. every 0.05 in log10 → ~26
  nodes), each with a value, a confidence (effective session count,
  decaying) and a **measured / floor / blank** state.
- Initial: 1.0 everywhere, confidence 0, state blank.
- **Pinned**: `M(1.0) = 1.0`. The trial sets the level and never moves
  the curve. Drift near 1.0 between trials is evidence the level moved; it
  is resolved at the next retest (§3.5).
- Bounds `[0.7, 1.5]`.

### 3.5 Retest

When a new trial lands: `trial_pace` takes the new value; every session's
`r` is relative to the trial in force when it was logged, so the history
is not rewritten. Fold drift: `M[n] /= M[1.0]` for all nodes. The right
end is **re-anchored by its own next max-effort anaerobic day**, not by
the trial's jump; until that session lands, hold back half the level
change on nodes above ~1.8× (the damped retest). Confidence untouched.

### 3.6 Refitting the static curve

A refit of `D(r)` must **replay every athlete's curve** from their session
history; otherwise every target jumps for reasons no athlete caused. The
diagnostic that says a refit is due: the **average `M` across athletes at
each `r` should sit near 1.0**. Where it does not, the static curve is
wrong there. Report per machine/unit on the admin side.

### 3.7 Units — the Echo problem

The trial is per machine and unit; `M` is shared. A given multiple means a
different physical demand in rower metres (pace ∝ ∛power) than in Echo
calories (≈ linear in power with an offset). **Decided 2026-11-16:**
convert pace to a **watt-equivalent** before computing `r` and `y` on the
machines with published conversions (Echo bike, C2 rower, ski-erg,
bike-erg), and convert targets back to the athlete's unit for display.
Per-unit `D(r)` curves are the fallback for a machine with no conversion.
The athlete never sees watts unless they chose watts. The 2.6 is a
calories number; its watt-equivalent is what the shared curve carries.

## 4. The ratchet — asymmetric

A session's evidence depends on what it proved:

| Session outcome | Evidence | Effect on `M` near `r` |
|---|---|---|
| reached the curve (`y ≥ 0.85`, or max-effort day) | ceiling | set toward `y`, state **measured** |
| completed as asked or faster, `y < 0.85` | floor | **raise only**: `M = max(M, y)` if `y > M`; otherwise no change |
| fell short of the asked pace | miss | lower toward the delivered `r`/`y` |
| assess day (time trial, rocket B, infinity, afterburner, synthesis) | record only | no change (decided 2026-11-16) |
| zone 2 (`r < 0.85`) | dose | no change; logged for adherence (decided 2026-11-16: fixed cutoff) |

- Locality: a session at `r` touches nodes within about ±0.1 in log10
  (roughly the range `r/1.25 … r×1.25`), weight falling off Gaussian.
  Nodes every 0.05 log10, σ ≈ 0.1 log10 (decided 2026-11-16 as "5 and 8"
  on the old 0–100 scale; same width).
- Step clamp ±0.15 per session; node bounds §3.4.
- Confidence decays with a ~60-day half-life; `M` itself does not decay.
- **Why asymmetric.** Holding a sub-max pace proves you can; it never
  proves you can't go faster. Only a miss, or a max effort, carries
  information about the ceiling. This is what keeps the curve from being
  dragged down by ordinary compliant training (the v1 failure mode).

**The target the athlete sees** is still one number per block:

```
target_pace = trial_pace × r_asked × M(r_asked)
```

where `r_asked` is the day's prescribed multiple (today's envelope pace
fraction, unchanged in the catalogue). The ratchet moves `M(r_asked)`, so
a region the athlete keeps beating is asked for more next time — on every
training day, curated or sequenced (decided 2026-11-16; the `gen:`
exemption goes). "Max effort" days keep saying beat this.

## 5. What the sequencer receives

Replace the per-(type, machine) ratio table and the analytics dump with
the curve, by region:

```
ATHLETE CONDITIONING CURVE (pace as a multiple of the trial; M = ceiling vs balanced, 1.0 = balanced at your level)
r:        0.85–0.95  0.95–1.1  1.1–1.3  1.3–1.6  1.6–2.0  2.0–2.6  >2.6
M:        1.00       1.00*     —        —        0.95     0.98     1.15
state:    measured   pinned    blank    blank    measured measured measured
n (eff):  5          2         0        0        3        4        7
trend:    →          —         ?        ?        ↑        →        ↑
Trials (echo bike, cal): 16.1 (09-14) → 18.4 (10-15)   [last 6]
Flags: none   (possible: TRIAL LOW — sustained longer than balanced at ≥1.0×; AEROBIC SIDE BEHIND SPRINT / GLYCOLYTIC BELOW BALANCED; machine X uncalibrated)
Days since last session: 2.  Sessions: 11 in 28 d (cadence implies 12), 20 in 90 d.
```

Then, unchanged: the readiness-filtered catalogue with envelopes and
coaching intent, the previous block (variety), per-type caps, never-done
types, other training load, the programming week, coach notes.

The instruction: *prescribe into the lowest **measured** region without
letting the strong regions sag; where a region is **blank**, PROBE it —
place a max-effort day there before prescribing development into it;
choose the day's type and shape and let the ratchet set its intensity;
read a high right end together with the trial's level and progression
(high right + low or stalled trial = the aerobic side is the gap; high
right + strong trial = a fast-twitch athlete); act on the TRIAL LOW flag by
placing a retest early.*

Day types remain the vocabulary the model names a day with; the catalogue
tells it what shapes each type permits. The model decides type and shape;
the system reads where it landed.

## 6. Diagnostics the frame gives for free

- **Trial low.** Any session with `y > 1.0` at `r ≥ 1.0` (sustained longer
  than balanced at or above trial pace). Action: early retest. Proven on
  the exploration athlete two weeks before his scheduled retest.
- **Aerobic side behind sprint / glycolytic below balanced.** The
  athlete's own 30-s max effort relative to the curve's 2.2× (≥ 1.05 or
  ≤ 0.9). One number: which side of the continuum lags.
- **Hard day vs held back.** Two identical prescriptions land at different
  `r`; the one that reached the curve is the real effort. The
  prescription-based frame could not tell them apart.
- **Uncalibrated machine.** No trial → no `r` → session plotted nowhere.
  The day page offers a trial on that machine instead of the day (§7).

## 7. Calibration rules

- A session on a machine/unit with no current trial produces no `r`, no
  `y`, no ratchet update. The day page already warns; it should offer
  "do a time trial on this machine instead of today's session". (Parked
  change 3, kept.)
- A trial older than ~40 days on a machine still in use is flagged to the
  sequencer.
- The monthly day-one trial stays. Trial history shown to the sequencer:
  last 6 per machine/unit (parked change 1, kept).

## 8. Athlete-facing views

- **Training day:** the day's type, name and intent unchanged; one target
  pace per block, "beat this" on max-effort days.
- **Analytics page:** existing stats unchanged. Add the continuum chart
  (the exploration chart, 2026-11-16): x = multiple of trial on a log
  scale with the two anchors marked, y = sustain vs balanced, filled =
  ceiling, hollow = floor, zone 2 shaded, the ceiling envelope drawn
  through the filled dots. Raw-units toggle for pacing intuition.
- **Coach chat:** reads the same curve, speaks in day-type names.

## 9. Data model

New:

- `engine_pd_curves` — (modality, units, r, seconds): `D(r)`, authored v1.
- `athlete_profiles.engine_curve` (jsonb) — `M` nodes with value,
  confidence, state, updated_at.
- `engine_workout_sessions.r`, `.sustain` (= `y`), `.evidence`
  (`ceiling|floor|miss|record|zone2`) — computed at save; backfillable
  from `actual_pace`, `workout_data` and the trial history (done for one
  athlete in the 2026-11-16 exploration).

Unchanged: `engine_time_trials`, `engine_user_performance_metrics` (kept
for analytics), `engine_day_types`, `engine_workouts`,
`engine_program_mapping`.

## 10. Migration

1. Author `D(r)` for Echo bike cal, rower m, ski-erg m, bike-erg m (watt
   conversions per §3.7). Validate on the exploration athlete.
2. Backfill `r`, `sustain`, `evidence` for all sessions; initialise `M`
   per athlete by replaying the ratchet in date order.
3. Switch the target computation to §4 on the day page; remove the `gen:`
   exemption. The athlete sees the same screen.
4. Switch the sequencer prompt to §5, with "probe" in the instruction.
   Keep the old ratio table one cycle, labelled legacy, then drop it.
5. Add the continuum chart to Analytics.

## 11. Decisions log (2026-11-16)

- Position: **from delivered pace, two anchors, log axis in multiples of
  the trial.** No fitted coefficients (v1's formula retired).
- Height: **sustained bout vs balanced** (`D(r)`), not pace vs target.
- Ratchet: **asymmetric** — floors raise, misses lower, max efforts pin.
- Zone-2 cutoff: **fixed** (~0.85×).
- Assess days: **record only.**
- Shape shared across machines; level per machine; **watt-equivalent**
  conversion.
- Node spacing / locality: ~0.05 log10 nodes, σ ≈ 0.1 log10.
- Anaerobic day = the **glycolytic anchor**, 2.2× @ 30 s on Echo cal
  (2.6× is the 15-s peak), unit-specific.
- Read the right end **with the trial's level**; absolute norms out of
  scope — progress is what matters to the athlete.
- Day types and tags **stay** as the athlete-facing vocabulary.
- Echo bike watts: no published formula → **Echo stays on a per-calorie
  curve**; the watt conversion applies to the Concept2 machines (rower,
  ski-erg, bike-erg). Derive an Echo formula later from athletes who log
  both, if ever needed.
- Multi-block days: the bout used for sustain is the **longest work
  block** (what the athlete had to sustain).
- The admin continuum chart lives on a **new tab of the admin athlete
  page**.
- **Post first-run revisions (2026-11-16, production data):**
  - **No unit conversion.** The watt-converted Concept2 curves were wrong on
    the right (their 30-s ceiling sits near 1.95× watts, not 2.6×). Every
    machine/unit now has its own curve in its own native pace multiples;
    `comparablePace` is identity. Reference curves are machine-specific by
    nature; what is shared is the athlete's curve.
  - **The shared coordinate is EFFORT DURATION**, `D(r)`: the single bout a
    balanced athlete sustains at the pace the athlete delivered, on that
    machine's own curve. A 30-s-max effort is the same place whether it was
    1.33× pace on a rower or 2.6× calories on an Echo. The athlete's
    multiplier curve `M` is indexed by effort seconds (10 s … 60 min, log
    grid); the sequencer's regions are duration bands (≤30 s, 30–60 s,
    1–2 min, 2–4 min, 4–10 min, 10–20 min, 20–40 min); zone 2 = efforts a
    balanced athlete sustains 40 min+ (fixed). The chart's x-axis is effort
    duration, long on the left, short on the right — the founder's original
    duration ↔ fibre-type framing.
  - **Anchor placement (decided 2026-11-16, after the v2 run):** 2.6× is the
    research figure for *peak* power (≈ 2.6× VO2max power), a 10–15 s
    effort, so it sits at **15 s**; the **30-s point is 2.2×** — the
    glycolytic reference for CrossFit and this base's median 30-s max
    (2.27×). With 2.6× at 30 s the population's 30 s–2 min bands read 0.86,
    which was the curve, not the athletes. Concept2 curves are derived
    (metres = Echo^0.30 → ≈ 1.27× @ 30 s; calories ^0.73 → ≈ 1.78×). Ski
    and bike-erg are scaled copies until their own data refits them. The
    curve's shape 30 s → 10 min is unchanged, so middle-band results move
    little; sprint efforts now land at 13–25 s instead of 30–40 s.
  - Flags renamed to the founder's reading: a short max well above the
    curve is **AEROBIC_SIDE_BEHIND_SPRINT** (a trial that lags fast-twitch
    capacity), well below is **GLYCOLYTIC_BELOW_BALANCED**.
  - Stored per session: `continuum_effort_s`. Curve version 2.
  - **Running curve** (decided 2026-11-16): authored from the literature,
    not fitted — trained balanced runner ≈ 1.42× 10-min pace at 30 s, 0.89×
    at 60 min; one curve for every running modality and distance unit (a
    pace multiple is unit-free). **Echo bike in metres/miles stays without a
    curve** — uncommon, no published distance formula.
- Build order: Phase 0 data-only (curves, backfill, replay, admin chart,
  cross-athlete diagnostic) → founder checkpoint on the anchors / curve / 0.85 (done 2026-11-16: 0.85 kept, 2.6× moved to 15 s) →
  Phase 1 sequencer prompt → Phase 2 targets + calibrate-on-switch →
  Phase 3 athlete-facing chart and coach.

Open: `D(r)` values beyond the anchors (authored, to refit from pooled
max-effort data); damped-retest hold-back;
multi-block bout choice (longest vs weighted mean); the **0.85 "reached
the curve" threshold** (§3.3) — a working guess for "within 15 % of the
balanced max bout counts as maximal", not a founder number.

Chart convention (decided 2026-11-16): floors are drawn as **upward
stems** ("at least this"), ceilings as filled dots. A floor is a lower
bound and should look like one; a hollow dot below the line read as
"worse".

## 12. Parked list, reconciled

| Parked change | Under this spec |
|---|---|
| 1. Trial history to last 6 | Keep (§7). |
| 2. Pace over baseline headline | Absorbed: `r` is the axis. |
| 3. Calibrate on machine switch | Keep (§7). |
| 4. Pool per type across machines | Absorbed: `M` shared across machines. |
| 5. Drop PH tags; blend multi-block honestly | Tags stay as UI; blend handled by one `r` per session. |
| 6. Anaerobic vs own best | Absorbed: anaerobic is the right anchor. |
| 7. Shrink the prompt | §5. |
| 8. Ratchet on sequenced days | Absorbed: §4. |
| Catalogue "when to use" guidance into DB | Keep; independent. |
