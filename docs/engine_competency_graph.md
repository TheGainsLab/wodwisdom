# Engine Competency Graph

A structured model of the ~20 Engine day-types as a **curriculum of competencies**, derived
from `engine_day_types.coaching_intent` (see `supabase/migrations/20260416000000_engine_coaching_intent.sql`),
the day-type parameters, and the 720-day catalog sequence (`engine_catalog.txt`).

Purpose: serve as the backbone for (a) the conditioning-state model fed to the AI, and
(b) a *curriculum-aware* form of adaptivity that operates in the program's own vocabulary
without breaking the authored arc.

---

## 0. The reference substrate: `time_trial` → every target

`time_trial` is not really a peer competency — it is the **scale the entire target system is
computed on**. Every training day has a *personalized* target derived from it:

```
target_pace = time_trial_baseline_rpm                 # per modality/units, latest is_current trial
            × prescribed_intensity%(day_type)         # from the day-type block params / intent
            × rolling_avg_ratio(day_type, modality)   # the per-competency personal adaptation
```

(Exception: `rocket_races_b` targets the athlete's own prior `rocket_races_a` actual pace.)

Implications the AI must respect:

- **The time trial is the denominator of every mastery score.** `performance_ratio = actual / target`,
  and `target` is anchored to the baseline. So a **stale or invalid time trial is a global confound**:
  a too-low baseline makes every competency look green; a too-hot baseline deflates everything.
  No ratio can be read honestly without knowing each modality's time-trial **recency** and **validity**.
- **It is per-modality.** Cross-modality comparison (and the analytics' energy-system ratios) only hold
  when each modality has a current baseline. A modality with no recent time trial has *uncalibrated* targets.
- **It recurs ~every 20 days by design** — the cadence keeps the substrate fresh. Tracking baseline
  *progression* across trials is itself a top-line fitness signal (is the engine getting bigger?), separate
  from the per-day ratios.

Everything below sits on top of this substrate.

## 1. The two axes

Every day-type sits on two axes:

- **What it trains** — energy systems (physiological primitives) and/or qualities (skills layered on top).
- **What it is for** — `DEVELOPMENT` (drives an adaptation) vs `EXPRESSION/ASSESSMENT` (verifies
  integration; coaching_intent literally says *"Primary Adaptations: None"*).

The DEV-vs-ASSESSMENT split is critical for the AI: on assessment days you **read integration**,
you do not "push the target" the way you would on a development day.

### Energy systems (primitives)
| Code | System | Built primarily by |
|---|---|---|
| AB | Aerobic base (mitochondria, capillary, oxidative) | endurance, polarized |
| AP | Aerobic power / VO2max (stroke volume, O2 extraction) | max_aerobic_power, interval, atomic |
| LT | Lactate threshold / clearance | threshold, flux, flux_stages |
| GL | Glycolytic / anaerobic power | anaerobic, hybrid_anaerobic |
| PH | Phosphagen / PCr | polarized (bursts), atomic, afterburner (bursts) |

### Qualities (skills layered on the systems)
| Code | Quality |
|---|---|
| PAC | Pacing intelligence / output consistency |
| DUR | Durability / fatigue resistance |
| DEN | Density tolerance (clearance under incomplete recovery) |
| PSY | Psychological composure under sustained strain |
| INT | Whole-system integration / coordination |

---

## 2. The competency tiers (the curriculum layers)

The catalog introduces these in order. Each tier assumes the tiers below it are in place — that
is the prerequisite structure the AI can reason over.

### Tier 0 — Reference substrate (not a peer node — see §0)
| Type | Role | Class | First seen |
|---|---|---|---|
| `time_trial` | The scale every target is computed on (the denominator of every `performance_ratio`); per-modality; recurs ~every 20 days. | ASSESSMENT | Day 1 |

### Tier 1 — Foundation: energy-system primitives ("build the components")
| Type | Trains | Role | Class | First seen |
|---|---|---|---|---|
| `endurance` | AB | Aerobic foundation that *supports all other training* (the root) | DEV | Day 3 |
| `max_aerobic_power` | AP | Raises the aerobic ceiling all other work draws from | DEV | Day 4 |
| `threshold` | LT | Bridge between aerobic base and high-intensity work | DEV | Day 10 |
| `anaerobic` | GL | Raises anaerobic ceiling; used sparingly | DEV | Day 2 |
| `interval` | AP, LT, GL | Generalist workhorse; raises the ceiling of all systems | DEV | Day 5 |
| `polarized` | AB, PH | Base maintenance + neural readiness during high-volume phases | DEV | Day 62 |

### Tier 2 — Bridges: clearance, transition, pacing ("connect base to intensity")
| Type | Trains | Role | Class | First seen | Builds on |
|---|---|---|---|---|---|
| `flux` | LT, AB → DEN | Bridges base to threshold without breakdown | DEV | Day 182 | endurance, threshold |
| `flux_stages` | LT → DUR, PSY | Threshold durability under rising metabolic stress | DEV | Day 302 | flux, threshold |
| `ascending` | AP→GL → PAC | Aerobic→glycolytic transition control; anti-overpacing | DEV | Day 195 | interval, threshold |
| `rocket_races_a` | PAC (test) | Pacing intelligence under variable load (first exposure) | DEV/ASSESS | Day 122 | max_aerobic_power |
| `rocket_races_b` | PAC (re-test) | Re-race the same intervals at tighter rest — consistency | ASSESSMENT | Day 125 | rocket_races_a |

### Tier 3 — Integration / Durability ("combine systems, sustain under fatigue/density")
| Type | Trains | Role | Class | First seen | Builds on |
|---|---|---|---|---|---|
| `hybrid_aerobic` | AP → DUR, DEN | Aerobic power under density — *core CrossFit/HYROX builder* | DEV | Day 245 | max_aerobic_power, flux |
| `hybrid_anaerobic` | GL → DUR | Glycolytic repeatability under fatigue | DEV | Day 242 | anaerobic, threshold |
| `devour` | AB, LT → DUR | Aerobic durability / fatigue accumulation (quiet, high-payoff) | DEV | Day 362 | endurance, threshold |
| `ascending_devour` | AB+LT → DUR | Integrated aerobic-threshold robustness | DEV | Day 385 | devour, ascending |
| `descending_devour` | AB → DEN | Aerobic density tolerance (shrinking rest) | DEV | Day 405 | devour |

### Tier 4 — Expression / Assessment ("express the whole engine under chaos")
| Type | Trains | Role | Class | First seen | Builds on |
|---|---|---|---|---|---|
| `atomic` | PH→AP | Phosphagen priming into aerobic power — high-ROI builder (a *late builder*, not pure expression) | DEV | Day 602 | max_aerobic_power, polarized |
| `towers` | AB→AP → DUR | Aerobic durability into aerobic power under fatigue | DEV | Day 482 | devour, max_aerobic_power |
| `infinity` | INT, PAC, PSY | MetCon simulation / psychological rehearsal | EXPRESSION | Day 422 | durability + pacing tiers |
| `afterburner` | GL+AP → INT, PSY | Late-stage power expression under fatigue ("who has energy left?") | EXPRESSION | Day 542 | anaerobic, aerobic power, durability |
| `synthesis` | INT (all) | Final audit of conditioning completeness (verification, not development) | ASSESSMENT | Day 662 | everything |

---

## 3. The prerequisite graph (edges)

Directed edges: `A -> B` means "B assumes A is developed." Used for downstream-risk reasoning
("a weak foundation node predicts struggle in the advanced nodes that depend on it").

```
endurance ──┬─> flux ──> flux_stages
            ├─> devour ──┬─> ascending_devour
            │            └─> descending_devour
            └─> polarized

max_aerobic_power ──┬─> hybrid_aerobic
                    ├─> rocket_races_a ─> rocket_races_b
                    ├─> towers
                    └─> atomic

threshold ──┬─> flux
            ├─> ascending ─> ascending_devour
            ├─> hybrid_anaerobic
            └─> devour

anaerobic ──┬─> hybrid_anaerobic
            ├─> afterburner
            └─> ascending        # glycolytic-demand side of the transition

interval ──> ascending
hybrid_aerobic, devour, flux_stages ──> infinity
devour, max_aerobic_power ──> towers ──> afterburner
ALL ──> synthesis        # the capstone audit
```

Three structural facts the AI can exploit:
1. **`endurance`, `max_aerobic_power`, `threshold`, `anaerobic` are the load-bearing roots** —
   one per energy-system axis (AB, AP, LT, GL). Weakness in any propagates into many downstream
   competencies. `anaerobic` earns root status because its output is a *fairly direct measure of
   glycolytic power* (a near-readout of the GL system, much as `time_trial` is for the aerobic
   scale), and it underpins `hybrid_anaerobic`, `afterburner`, and the glycolytic side of `ascending`.
2. **Assessment nodes are checkpoints, not competencies:** `time_trial` (scale), `rocket_races_b`
   (consistency check), `infinity` / `afterburner` (expression), `synthesis` (final audit). Read
   these as *integration readouts*, not as targets to push.
3. **The curriculum is concentric:** the foundation/bridge tiers never stop recurring (interval,
   endurance, polarized, time_trial appear in every phase) while a new "hero" type is layered in
   roughly every 60 days.

---

## 4. Mapping to the existing data — the mastery model

The system already maintains, per `(day_type, modality)`:
- `rolling_avg_ratio` (mean of last 4 performance ratios) — **a crude per-competency mastery score**
- `learned_max_pace` — best output ever (ratchet)
- `last_4_ratios` — recent trend

So you effectively already track ~20 competency scores per modality. This graph adds the layer the
scalar lacks:

| Graph contributes | Enables |
|---|---|
| Tier + energy-system tags per node | Reason in the program's vocabulary ("your LT bridge is lagging your aerobic base") |
| DEV vs ASSESSMENT class | Treat exam days as readouts, not targets; don't "adapt" a diagnostic |
| Prerequisite edges | Predict downstream struggle from weak roots; explain *why* an upcoming hero type will be hard |
| Curriculum position (current_day → tier) | Always answer "where am I in the arc and what's coming" |

### Two products fall out of this graph
1. **Conditioning-state summary (#1):** roll the ~20 mastery scores up into energy-system balances
   + per-competency trend + "weak roots" + "next hero type and your readiness for it," in the
   program's own language. Pure read; fits the linear architecture.
2. **Curriculum-aware adaptivity (#4), safely:** moves expressed *within* the taxonomy — substitute a
   same-tier variant, insert an extra exposure of a weak root, hold/advance a phase — never invent a
   novel session. The day-type is the seam where AI reaches into the plan without corrupting the
   authored progression or the day-keyed analytics.

---

## 5. Intervention ladder (Stage 4 scope)

Three levers of personalization, escalating in power and risk. The governing rule: **the day-type
template is the guardrail; the AI is a dial inside it, never a blank page.**

| Lever | What it changes | Status / scope | Guardrail |
|---|---|---|---|
| **A — Intensity** | Target pace per day | **Live today** (rolling-ratio) | Derived from time-trial substrate |
| **B — Sequence** | Which day-type runs next (swap / insert / repeat / hold) | **Stage-4 core** | Only authored day-types; diagnose gap first |
| **C — Content** | Params *inside* a day (interval count, work/rest, volume, progression) | **Stage-4 extension** | **Strictly within each day-type's `block_N_params` ranges** |

**Why C is needed (not just B):** sometimes the right fix for a gap is *more dose of the same
stimulus*, not a different day — e.g. a lagging-LT athlete needs `flux` with more surges, not a
different day-type. Sequence moves can't express that; bounded content tuning can.

**The envelope principle:** every day-type's `block_N_params` already define legal ranges
(round-count, work/rest, pace). Tuning *within* those ranges = delivering the author's design,
personalized. `devour` sanctions ~4–8 rounds; picking 6 vs 8 is dialing, not inventing.

**Hard limit (never crossed):** invent novel structures, exceed a day-type's envelope, or change what
a day-type fundamentally *is*. That boundary protects the periodization and the "an expert built
this" guarantee. Crossing it = AI-generated programming, a different product with different risk.
