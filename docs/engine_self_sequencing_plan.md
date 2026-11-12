# Engine Self-Sequencing — Plan & Sequencing Decision

## Decision: build Engine self-sequencing BEFORE combining with AI programming

The Engine gaining the ability to adapt its own sequence ("self-aware") comes **first**; the all-access
combining work (unified coordination, generation awareness) comes **after**.

Why:
- **Self-sequencing redefines "the Engine's next session"** — the exact thing every combining feature
  points at. Building integration on a mid-flux sequence definition means rework.
- **It stands alone** — it improves the experience for the *entire* Engine user base, not just the
  all-access subset. Bigger, more differentiated win, and it's the original "use the deep conditioning
  data" opportunity.
- **Risk containment** — self-sequencing is sensitive on its own (mutable per-user sequence, authored-arc
  integrity, Lever B/C guardrails). Don't layer all-access coordination on top simultaneously.

## Two compatibility constraints (carry these through the Engine build)

These keep the later combining work nearly free instead of forcing a re-bridge:

1. **Build on the shared diagnosis.** The sequencer's decision input is
   `computeConditioningDiagnosis()` (calibration gate + AB/AP/LT/GL roll-up + weak roots + trends, from
   `conditioning-state.ts`). It is *also* the integration's brain. Building it here (for the more
   demanding consumer) makes it robust for the prompt-awareness consumer for free. Not "starting the
   combining project" — it's the Engine's own decision layer.
2. **Persist the adapted sequence to `training_schedule`.** That table is already per-user, mutable, and
   dual-program (`program_workout_id` XOR `engine_workout_id`, same-date coexistence allowed; `engine_
   schedule_once` enforces once-per-engine-day). If the self-aware Engine expresses its adapted order as
   engine rows there, the unified all-access calendar **falls out automatically**. Sequence onto a
   private table instead and you'll have to re-bridge later.

The shipped read layer (conditioning-state in chat / training-analysis / profile-analysis / workout-
review) stays as-is — independent and harmless; all-access users already get cross-aware *analysis*.

---

## Current state (what exists today)

- **Sequence authority = static.** "Next Engine day" is the `engine_current_day` pointer walked against
  the fixed `engine_program_mapping` (`src/lib/engineService.ts` → `getWorkoutsForProgram`,
  `advanceCurrentDay`). No adaptation.
- **`training_schedule`** — per-user dual-program dating overlay, written from the frontend
  (`src/lib/trainingSchedule.ts`); NOT yet the sequence authority. `engine_schedule_once` = one row per
  engine day per user.
- **Diagnosis read layer** — `_shared/conditioning-state.ts`: calibration, energy-system roll-up, weak
  roots, fatigue. Currently formats a prompt block only (no structured export yet).
- **Competency model** — TS constant in `conditioning-state.ts` + `docs/engine_competency_graph.md`:
  tiers, energy-system tags, dev/assess class, prerequisite edges, and (per day-type) the
  `block_N_params` envelopes that bound Lever C.

## Build plan

1. **Extract `computeConditioningDiagnosis()`** — refactor `conditioning-state.ts` so the structured
   diagnosis is a typed object (current text block becomes one formatter over it). Single source for
   sequencer + integration + read layer.
2. **Encode the competency graph as a queryable decision model** — tiers, prerequisite edges, dev/assess
   class, and each day-type's `block_N_params` envelope, so the sequencer reasons over data not prose.
3. **Lock the re-sequencing policy (needs 3 decisions — see below).**
4. **Build the sequencer** — input: diagnosis + graph + current position. Output: next action within the
   guardrails — keep default next / substitute same-tier variant / insert weak-root exposure / hold or
   advance phase (Lever B); later, tune params within envelope (Lever C). Deterministic and explainable.
5. **Make `training_schedule` the "next" authority** — sequencer writes engine rows; runner/dashboard
   resolve "next" from the adapted schedule (fall back to mapping), preserving once-and-done + months
   gating. Touches `engineService.ts` next-day resolution + `advanceCurrentDay`.
6. **Guardrails** — validity gating (don't adapt on stale time trials / `rolling_count < 2`), respect
   `engine_months_unlocked`, never exceed a day-type envelope or break authored-arc coherence.
7. **Explainability** — "why did the Engine change this?" from `coaching_intent` + the diagnosis
   ("inserted an extra threshold exposure — your LT is lagging").
8. **Tests + runtime verification** (pure decision-policy tests + one end-to-end fixture).

## Locked decisions (the architecture)

The flow:

```
completed engine_workout_sessions
        ↓
computeConditioningDiagnosis()   ← our model (calibration + AB/AP/LT/GL roll-up + weak roots + fatigue)
        ↓                          (built: supabase/functions/_shared/conditioning-state.ts)
AI sequencer  +  day-type catalogue (engine_day_types: coaching_intent, block_N_params envelope;
        ↓                            competency graph: tiers + prerequisite edges)
generated days saved as engine_workouts rows; engine_user_day_overrides maps the user's
upcoming positions (current_day, +1, ...) → those generated workouts
```

The Engine queue is **position-based** (`engine_current_day` = highest completed + 1; the dashboard /
runner resolve a day by position). Month-unlock is the access/billing unit (12-20 days); the operating
unit is **sequential weekly completion** (athletes are counseled to it — jumping breaks the AI). The
sequencer overrides only the **content** at the next week's positions; progression, access gating and the
UI are untouched. Positions beyond the generated week fall back to the static catalog until the user
finishes the week and the next run fills them. Trigger is **completion-driven** (finish the generated
week → generate the next), gated on >= 10 completed days.

- **Build location:** here (no existing WIP — only the manual scheduling rails + the diagnosis brain).
- **Trigger:** **weekly, starting after the athlete completes 10 Engine days** (those first 10 build the
  baseline — sessions + time trials — needed for a valid diagnosis; the loop no-ops before then).
- **Authority:** **all AI.** The AI makes the re-sequencing decision from the diagnosis + catalogue.
  (Not deterministic rules.) A deterministic **validation** layer still enforces the guardrails on the
  AI's output.
- **Guardrail scope:** **taxonomy + parameter envelope only** (settled). Substitute same-tier day-types,
  insert weak-root exposures, hold/advance phase, tune params within each day-type's `block_N_params`
  ranges. Never author novel day-types/structures.

### Generative, not selective

The 22 day-types are a **generative grammar**, not a 720-day list to pick from. Picking a pre-authored
catalog day is deterministic and needs no AI — **generation within the envelope is the whole reason to
use AI.** The AI generates a concrete day by choosing values inside a day_type's `block_N_params`
envelope (Lever B = which day_type, Lever C = the params, together). A generated day has the **same
`block_params` shape as a catalog day**, so the Engine runner executes it unchanged: persist the
generated workout as an `engine_workout` row, then schedule it in `training_schedule`. The catalogue is
effectively unlimited; the validator guarantees every generated value stays inside the authored bounds.

## Remaining build (revised)

1. ✅ **`computeConditioningDiagnosis()`** — structured single-source diagnosis (done;
   `conditioning-state.ts`). The AI's input.
2. **Catalogue payload** — expose the day-type taxonomy (coaching_intent + `block_N_params` envelopes)
   and competency graph (tiers + prerequisite edges) as the AI's option space. *Re-add prerequisite edges
   to code (removed in the position-free cleanup).*
3. ✅ **AI sequencer edge function** (`engine-resequence`) — gate (>=10 completed days) → diagnosis +
   catalogue + current phase → `callClaude` → `parseProposal` → `validateProposal` → persist accepted
   days as `engine_workouts` rows + schedule in `training_schedule`. `dry_run` supported.
4. ✅ **Guardrail validation** — `validateProposal` deterministically rejects any AI output outside the
   taxonomy or a day-type's envelope before persistence.
5. ✅ **Per-user position override** — `engine_user_day_overrides` (migration) maps a user's
   `sequence_position` → a generated `engine_workout`. `engine-resequence` writes overrides at positions
   `current_day..+N-1` (not `training_schedule`). `getWorkoutsForProgram` + `loadWorkoutForDay` swap the
   generated content in at overridden positions and fall back to the catalog elsewhere. Pure content
   swap; dashboard/runner/logging/access-gating unchanged.
6. ✅ **Intensity ownership (#4)** — on AI days (`program_type 'gen:'`) the runtime target drops the
   rolling multiplier (`effectiveRollingMult` in `EngineTrainingDayPage`); the AI's paceRange IS the
   target, rolling becomes a read-only sensor. No-op for catalog days.
7. ✅ **Automatic trigger (#5)** — server-side cron (`engine-resequence-cron`) runs the shared
   `runResequence()` core for opt-in athletes (`athlete_profiles.engine_ai_sequencing`, default false)
   whose current block is consumed (`current_day` past their highest override). No client involvement,
   self-healing, test-user-gated. `engine-resequence` (HTTP) is now a thin wrapper over the same core for
   admin dry-run preview.

### Rollout / ops
- Apply migration `20260620100000_engine_ai_sequencing_flag.sql`.
- Deploy `engine-resequence` + `engine-resequence-cron` (the latter is `verify_jwt=false`).
- Schedule the cron via pg_cron (e.g. every 15 min).
- Enable test athletes: `UPDATE athlete_profiles SET engine_ai_sequencing = true WHERE user_id = '…'`.
- Widen by bulk-enabling / flipping the default once validated. The flag is also a per-user kill-switch.

---

## Addendum (2026-11-10): assessment month, intake, and tracks → settings

Founder decisions from the retention review (the Luke Manchester case and the
subscriber funnel: of 59 retail Engine subscribers, 21 have reached the 10-day
sequencer gate; 8 of the 12 who cancelled had completed four days or fewer).
The sequencer cannot help anyone who leaves before it starts, and the tracks
were the pre-sequencer way of offering variety. With a sequencer, both give
way to one curriculum plus a small set of athlete settings.

### The thesis, stated once

Give the AI the information it needs and it makes better sequencing judgments
than a hand-authored easy-to-hard list. Every existing track is already an
instance of that thesis done by hand (Hyrox opens with towers, VO2 opens with
devour — month-25 and month-19 types in the main curriculum). The sequencer is
the same act, per athlete, live.

One rule stays outside the AI because it is a product decision, not a
training judgment: **the reveal rate** — how fast new stimulus types are
introduced over the life of the subscription (the "novelty budget"). The AI
has full freedom inside it.

### Intake (new subscribers)

Two required choices and two context questions. No track picker.

1. **Days per week: 3, 4 or 5.** The one structural commitment. Sets the
   month length (12 / 16 / 20 positions) for the program's life; the sequencer
   never changes day count.
2. **Goal.** Presets that carry the old track names (General engine, VO2 max,
   Race prep / Hyrox) plus a free-text line. Writes `engine_goal`; later shapes
   emphasis and reveal rate from month two.
3. **What else do you train each week?** Feeds the sequencer's other-load
   awareness (already supported).
4. **Which machines will you use?** Steers time trials to the modalities the
   athlete will actually rotate, and sizes expectations about per-modality
   data (see diagnosis roll-up below).

### Month one is an assessment month — the same for every goal

Any serious protocol tests before it prescribes. Month one is the test, and
the product says so ("Month one is your assessment: the Engine is learning
how you respond to each kind of work"). Goal shaping begins in month two.

| Cadence | Month-one types | Positions | Exposures per type |
|---|---|---|---|
| 3-day | anaerobic, max aerobic power, endurance | 12 | 4 / 4 / 3 |
| 4-day | anaerobic, max aerobic power, threshold, endurance | 16 | 4 / 4 / 3 / 4 |
| 5-day | the written 5-day month one | 20 | 4 / 4 / 4 / 3 / 4 |

The 4-day month swaps interval (close to max aerobic power in what it
measures) for threshold (a distinct system). Proposed layout, derived from
the written 5-day month by dropping its four interval days and keeping the
pinned time trial:

```
 1 TT   2 ana   3 end   4 MAP   5 ana   6 end   7 MAP   8 thr
 9 end 10 MAP  11 thr  12 ana  13 MAP  14 thr  15 ana  16 end
```

**Time trials are unchanged:** day one of every month, pinned, the monthly
recalibration. The month-two time trial is simply the first retest; the
sequencer's first generated block follows it.

### Sequencer gate: the assessment month is complete

(Corrected — an earlier draft of this section proposed "two scored sessions
per type, capped at 10 days", which would have started the sequencer inside
month one and contradicted the assessment-month decision.)

The sequencer's first generated block is the **first block of month two**,
right after the month-two time trial. The gate is positional: the next
position to generate lies in month 2 or later. Nothing is generated inside
month one, for anyone, whatever their data looks like. By construction every
assessment month yields two or more scored sessions of each of its types,
which is what readiness needs; the per-type counts are logged as an
informational thin-data note after the gate, never as a condition of it.

The gate runs after four cheap reads (profile, program, sessions, mapping)
and before the diagnosis, so a month-one athlete costs nothing more per cron
tick. A profile whose program has no mapping rows is a data error (every
athlete starts on month 1 of a mapped program, founder ruling 2026-11-11):
the gate closes and says so rather than guessing.

### Diagnosis: roll ratios up across modalities per type

Ratios are tracked per (day type, modality). An athlete rotating four
machines feeds each cell a quarter of the data and starves the diagnosis for
months. Keep modality for **pacing** (per-modality baselines are correct);
roll ratios up **per type** for the sequencer's judgment.

### Show the judgment on every day

The sequencer writes a "why today" line on generated days. Give static
catalog days one too, from the day type's `coaching_intent`. A fixed
assessment month then reads as authored, not arbitrary — the cheapest
retention lever in this document.

### Tracks → settings (migration)

Each track is cadence + emphasis + reveal rate. Existing subscribers receive
the settings their track implies; their position carries over; the authored
mappings stay in the database as the fallback plan and the novelty budget.
Track names survive as goal presets.

| Track | Days/wk | Goal preset | Reveal | Subscribers (2026-11-10) |
|---|---|---|---|---|
| main_5day | 5 | General | 36-month | 22 |
| main_3day | 3 | General | 36-month | 19 |
| vo2max_4day | 4 | VO2 max | 12-month | 8 |
| vo2max_3day | 3 | VO2 max | 12-month | 3 |
| main_3day_varied | 3 | General | 12-month | 3 |
| hyrox_3day | 3 | Race prep | 12-month | 2 |
| main_5day_varied | 5 | General | 12-month | 1 |
| hyrox_5day | 5 | Race prep | 12-month | 1 |

The Mini Cycle tracks are the sequencer's job by definition (same material,
reordered) and retire first. The VO2 tracks are the most engaged cohort
(median 8 days done); whatever replaces them must still produce a month two
that opens with devour and infinity for a VO2 goal — test the sequencer
against those athletes' actual months before retiring the mapping.

### Coach: tell the truth about adaptation

The Coach must describe both mechanisms in one answer: pace targets adapt
from the first sessions (rolling multiplier, live for everyone); the
sequence of sessions adapts after the assessment month (sequencer). It must
never deny the sequencer exists, and never pitch a paid tier to a paying
subscriber unless asked. (Separate PR to the chat prompt.)

### Metric

Share of new subscribers who complete **five Engine days in their first
three weeks**. Secondary: share reaching ten. Compare the first sequencer
cohort against the 21 static-sequence athletes past day ten on day-five
retention and ratio improvement.

### Order of work

1. Gate: assessment month complete (next block in month 2+) — `run-resequence.ts`. ✅
2. "Why today" on static days — day page + `coaching_intent`.
3. Diagnosis roll-up across modalities — `conditioning-state.ts`.
4. Intake questions and `engine_goal` presets — onboarding + Engine dashboard.
5. Author the 4-day general month one (16-row mapping) once the layout above is approved.
6. Tracks → settings migration; hide the track picker for new subscribers.
7. Novelty budget as an explicit rule in the sequencer's pool computation.

### All Access: one goal, shared plans, one leader (decided 2026-11-10)

1. **One goal.** Intake asks it once. For All Access the Engine setup
   pre-fills from the profile goal and lets the athlete refine it for
   conditioning; both generators read the same text with the Engine addition
   appended. Two goal boxes for one person is a latent inconsistency.
2. **The sequencer sees Programming's upcoming week.** Today it reads
   Programming's *logged* load (workout_log blocks/entries + external
   activities). Add the next seven days of generated strength and metcon
   blocks so it can place a hard anaerobic day away from a heavy squat day
   instead of discovering the collision in the log. This mirrors what
   Programming already receives from the Engine (trailing 28-day zone
   minutes + projected 4 weeks).
3. **Direction of authority unchanged.** Programming flexes around the
   Engine's plan (the existing Engine-awareness contract). The Engine knows
   Programming's plan and avoids collisions, but never rewrites its
   curriculum because a strength block is heavy. Two mutually adapting
   systems oscillate; one leads, one follows, and the Engine's deterministic
   grammar makes it the natural leader.

### New-subscriber sequence (decided 2026-11-10)

Checkout complete → **Engine setup** (days per week: 3 or 5 until a 4-day
month exists; one free-text goal/week-context box, pre-filled from the
profile goal for All Access) → **assessment-month briefing** (Day 1 time
trial, the month's type counts for the chosen cadence, the retest day, two
lines on how adaptation works) → **Start Day 1**. The track picker stays
behind Switch Program for existing subscribers until the tracks → settings
migration. The Coach prompt carries the same assessment-month sentence.

### Readiness gating decisions (2026-11-10)

- **Prerequisites are the only reveal control.** The novelty budget is
  DROPPED. Prerequisites limit depth (chains), not breadth: after the
  assessment month roughly six types become eligible at once, and the whole
  catalog opens over four to six months rather than thirty-six. Founder
  ruling: that pace is fine ("if everyone stayed six months we'd be
  thrilled"). Availability is not use — the sequencer still chooses what
  serves the athlete.
- **Readiness** = a prerequisite type completed twice (any ratio), rolled up
  across modalities. Data: `engine_day_types.class / trains / prerequisites`
  (migration 20261110000000).
- **Time trial** pinned to day one of every month, never moved or replaced.
- **Rocket Races A/B** pair in the same week; B inherits A's intervals, only
  rest changes (validator rule to add).
- Other assess types: at most one per month, only when fully ready.

### Sequencer default (decided 2026-11-11)

- **New subscribers: ON.** Engine setup writes `engine_ai_sequencing = true`
  with the program choice. The assessment month is fixed regardless; the
  sequencer begins with month two.
- **Opt-out exists:** the Settings page "AI sequencing" toggle writes the
  flag directly (finish-your-block semantics).
- **Existing subscribers:** flipped by the admin in cohorts via SQL (no admin
  UI control yet): main-track athletes past month one first, then Mini Cycle
  (moved to the main program at their cadence), then VO2 / Hyrox once the
  readiness clause below is in.
- **Readiness clause (to add):** a type the athlete has already completed
  twice is ready whatever its prerequisites — demonstrated directly beats
  demonstrated by proxy. Without it a VO2 athlete who has done devour five
  times is "not ready" for devour because they never did anaerobic twice.

### Sequencer signals — decisions (2026-11-11)

- **Everything is relative to the athlete.** Ratios are against their own
  targets, anaerobic against their own time-trial baseline, trend against
  their own last five. Population norms are deliberately OUT OF SCOPE for
  sequencing: a 40-year-old woman is compared to her own data, not to a
  24-year-old man. "Is she fit" is not the sequencer's question.
- **Anaerobic (max-effort) days now write metrics**: output ÷ time-trial
  baseline pace, marked "vs baseline" in the diagnosis. Before this the
  glycolytic root was invisible to the sequencer.
- **Added: time-trial history** (last three trials per modality+units) —
  whether the ruler itself moved — and **adherence** (sessions in the last
  28 / 90 days vs the cadence's expectation).
- **Not added, by decision:** per-interval fade (few athletes log intervals
  mid-session; with pacing coaching they rarely collapse, so it carries
  little signal); threshold in the 3-day assessment month (anaerobic / max
  aerobic power / endurance is the best 3-day mix; adding threshold would
  degrade the stimulus — the gap closes at month two's first threshold day).
- Still on the list: roll ratios up across modalities per type; Programming's
  upcoming week as other load; work:rest tolerance; HR when logged.

### One calculation: analytics = what the sequencer sees (decided 2026-11-11)

The Analytics page's formulas moved verbatim into
`supabase/functions/_shared/engine-analytics.ts` (pure, no I/O). The page
imports it; `conditioning-state.ts` computes the same summary and appends it
to the diagnosis as an ENGINE ANALYTICS block. Overview, sessions by type and
equipment, energy-system paces (anaerobic÷trial, max aerobic÷trial,
anaerobic÷max aerobic, peak/avg), per-type averages, all-time targets vs
actual, personal records, pace by work:rest bucket, and heart-rate stats when
logged — per machine. Change a formula once and both consumers change.


### Sequencer model: Sonnet 5.5 (decided 2026-11-11)

The sequencer runs on the current Sonnet (`MODELS.sonnet5`, default
`claude-sonnet-5-5`, env `MODEL_SONNET5`), no Haiku fallback. The rest of the
app keeps its tiering by design: Fable 5 for the CoachState eval, the
Programming skeleton and the v3 composer; Opus for paper ingestion; Sonnet 4.6
for the week fill, adjustments, safety review, chat and the parse family;
Haiku 4.5 for routing and as the fallback. `MODELS.sonnet` was NOT moved:
Sonnet 5.5 rejects forced `tool_choice` and non-default `temperature`, which
thirteen Sonnet seats still send. Moving those is its own migration.

### Cron shape and the lost first tick (fixed 2026-11-11)

The first real month-two athlete (the seeded test athlete) exposed three
things in `engine-resequence-cron`, found by reading `net._http_response`:

1. **The per-tick cap counted athletes looked at, not generations.** Two
   month-one athletes ahead in the list spent both slots on gate skips every
   tick; every eligible athlete after them was "deferred" forever. Now only a
   run that reached the AI counts.
2. **pg_net gives up after ~5s.** A tick that generates takes minutes. The
   handler now acks 202 at once and runs the tick in `EdgeRuntime.waitUntil`;
   the per-athlete outcomes are one JSON line in the function log.
3. **The endpoint was open.** It now requires `X-Cron-Key = LIFECYCLE_CRON_KEY`
   (the shared gate), fail-closed.

pg_cron job (jobid 4, `*/15 * * * *`) must send the header. Replace its
command with (key from the lifecycle-nudges job's command):

    select net.http_post(
      url     := 'https://hsiqzmbfulmfxbvbsdwz.supabase.co/functions/v1/engine-resequence-cron',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Key', '<LIFECYCLE_CRON_KEY>'),
      body    := '{}'::jsonb,
      timeout_milliseconds := 15000
    );

Six accounts hold the flag today (not zero as assumed): one parked on an
August block at day 123, two in month one, one real subscriber at day 31 of
the 5-day program (month two — the first cohort), one at day 5, and the test
athlete. After the fix the day-31 subscriber and the test athlete generate
on the next tick.

### Variety rules (decided 2026-11-11, after the first real blocks)

The first two generated blocks for the test athlete repeated the same
anaerobic prescription (6 × 30 s / 2:30) and leaned on the same two types.
Founder: "I don't want every day to turn into VO2 max work" — the breadth of
the catalogue is the product. Holding the curated shape was rejected as
defeating the sequencer's purpose; the sequencer chooses the day. What keeps
the balance is coverage, enforced in `engine-readiness.ts`:

1. **Distinct types within a block** — three in a 3-day block, at least four
   in a 5-day block (one fewer than days for 4+).
2. **Never the same prescription twice** — type + generated blocks — within a
   block or against the previous block (the sequencer is shown it).
3. **Share cap** — no type more often per block than its share of the curated
   month, scaled to the block, never below 1. time_trial and rocket_races_b
   exempt.

Plus a prompt instruction, not validated: a ready type the athlete has never
done appears within two blocks (the prompt lists READY BUT NEVER DONE). The
curated plan is now presented as the month's intent and balance, a
reference, not a lock. A rejected block leaves the curated days in place and
the next tick tries again.

### Changing days per week mid-program (decided and built 2026-11-12)

The three cadences are separate programs, so Switch Program today lands a
3-day athlete who wants 4 days at day 1 of the 4-day program — back into
the assessment month. Founder: a user should be able to switch within a
week and "pick up on week three of month two, and it would be four days."

Rule: the switch takes effect at the NEXT WEEK BOUNDARY. The current week
finishes at the old cadence. The following week starts at the new
program's same month and week (`engine_program_mapping.month` /
`week_number` → first position of week+1, or next month's week 1 at a
month end), and the sequencer's next block is at the new cadence.

Build:
1. `switchProgram` translates (month, week) from the furthest completed
   position in the old program to the new program's first position of the
   following week; sets `engine_current_day` there; earlier months are
   credited, not redone.
2. `run-resequence` and the cron start from max(furthest completed
   position + 1, `engine_current_day`) so a switched athlete is not sent
   back to the gate by having no sessions in the new program.
3. Month view shows carried-over months as credited rather than unfinished.
4. Switching down (5 → 3) works the same; extra days done stay as history.
5. Tests for the week-boundary translation across all six direction pairs.

Built: `engine-switch.ts` (pure `translateSwitchPosition`, 7 tests),
`switchProgram` translates by week, `run-resequence` uses the pointer as a
floor, the dashboard marks carried-over months, the switch confirmation
says what happens. Migration `20261112000000_main_4day_week_numbers.sql`
gives the 4-day mapping the week numbers it was created without.

### Longer term: Programming generates a week at a time (direction, 2026-11-12)

Founder: the same weekly change should come to the program generator. The
v3 pipeline already separates the monthly skeleton (intent) from the week
fill; the change is to run the fill one week at a time, when the previous
week is consumed, with the athlete's logs and their Engine week in view —
the Engine cron pattern applied to Programming. The skeleton stays monthly.
Gains: goal and cadence changes take effect the next week; Engine and
Programming flex around each other week by week (the All Access promise).
Not designed in detail yet; after the cadence-switch work.

### Readiness clause (decided and built 2026-11-12)

"If they did it they are ready." A type the athlete has completed at least
twice is ready regardless of its prerequisites. The chain reveals new
types; it never takes away one already trained. Unblocks the VO2 and Hyrox
cohorts, whose curated histories include advanced days without the
main-program chain.

### Setup: no briefing screen (decided 2026-11-12)

The assessment-month briefing (step two of setup) is removed. "They see
month 1 and then they see month 2 — this is just confusion." Setup is one
screen: days per week, goal, Start Day 1. Pace targets adapt from day one;
the curated-vs-sequenced distinction is internal. The Coach explains the
assessment month if asked.

### Programming week by week — design (decided 2026-11-12, NOT BUILT)

Both products work the same way: an ordered sequence consumed by LOGGING.
The calendar is a reference some athletes use and others ignore; nothing
is keyed to dates ("users will do the workouts when they want").

Cycle: Build → skeleton for the month (intent, arc, each week's focus and
day types) → metcons COMPOSED FOR THE MONTH (variety audit stays monthly;
movements and schemes fixed, loads not) → week 1 filled, audited, saved →
weeks 2–4 shown as the skeleton's OUTLINE (day types + focus, no loads, no
Start, "written when you finish week 1, from what you lift this week").

Weekly fill: when a week is consumed (its last day logged, or logged past),
the cron fills the next week from the skeleton's focus, the composed
metcons, the ACTUAL logs of prior weeks (loads from what was lifted,
skipped days not progressed from), the current goal, the week note, and
for All Access the Engine's current block. Audits + safety, append. A
failed fill leaves the outline; next tick retries. Month end as today.

The skeleton never changes within the month (first version). Escape hatch
to build: an explicit "re-plan the rest of this month" that rewrites the
outline for the remaining weeks from new facts. Letting the skeleton
writer revisit its plan each week: decide after real months of fills.

What changes week to week: loads, volume, metcon loads/targets, skill
progressions, skipped-day handling, Engine-aware placement, goal emphasis.
What doesn't: day types, metcon movements/schemes, the month's arc.

A filled week is DONE: only the existing day tools (AI edit, swap, scale,
Coach) touch it. Levers on unwritten weeks:
- WEEK NOTE on each outline page ("Anything the coach should know about
  this week?"): read by the fill, the Coach, shown on the filled week.
  Handles "hotel gym next week", "more gymnastics", "longer metcons".
- GOAL (profile): emphasis across weeks within the month's arc.
- DAYS PER WEEK: TWO numbers, both on the profile — Programming days and
  Engine days (founder, 2026-11-12: "a person can do 4 days programming
  and 3 days engine, that is how a lot of people train"). Each product
  reads its own; the next fill / next block at the new count. Engine setup
  keeps its cadence question and the gear menu keeps 3/4/5; the profile
  shows both for All Access so the weekly total is visible.
- Loads: logging handles it ("lift heavier" = log honestly).
- Anything that changes the month's shape: re-plan.

All Access order within a week: Programming's week FIRST (carries the
skeleton's intent), then the Engine block around it. Each side balances its
next block against the other's as a WHOLE (load, hard days, systems) — no
day-by-day interleaving, since neither side owns dates.

Also: Programming's projection of the Engine (upcoming_4_weeks from the
fixed catalog) is wrong for sequenced athletes past the current block —
replace with the current AI block + "sequenced from here".

Order of work: (1) Engine sees Programming's next unlogged week + fix the
projection (own PR, ~a day); (2) weekly Programming cron, outline UI, week
note, profile days-per-week unification, re-plan action.

### "Tell your coach" notes — low-friction adjustments (decided and built 2026-11-12)

Founder: modifying the profile for every change is not user-friendly, and
AI interaction is still high friction; athletes reach for the lowest-
friction tool. The profile is for STRUCTURAL facts (gym/equipment,
injuries, numbers, goal, days per week). For "I want more chest-to-bar"
there is a note.

- ONE box on the program page, between the week tabs and the days (and
  the Engine dashboard for All Access): "Tell your coach — what you want
  more or less of. Read before every week is written." Plain text, Save.
  Saved notes listed under it, each with its horizon and a delete.
- Horizon: ONE WEEK by default (the next fill), then expires. Words set it
  ("next week", "for two weeks"); "until removed" is one tap away. A
  standing preference belongs in the GOAL on the profile (permanent). The
  Coach offers the promotion when a note recurs ("three weeks running —
  make it part of your goal?").
- A filled week is done: the box offers "Add it to this week's days",
  which opens the existing day AI-edit on the days where it fits.
- The Coach is the second front door: it recognises a note the way it
  recognises a profile update today and offers a card ("Note for your
  coach: … Save"), plus "Add to this week's days". One list behind both.
- Read by: every weekly fill (Programming), every Engine block, the Coach.

Built: `coach_notes` table (RLS, per-product consumption, 21-day expiry
for next_week); `_shared/coach-notes.ts` (active/format/recurring, tested);
the sequencer reads and spends them; `build-writer-payload` carries them as
`training_context.coach_notes` (coach-state prompt + week fill honour
them; generate-program-v3 spends them on save); the Coach sees them, gets
RECURRING NOTE context, and drafts one with `propose_coach_note` → a Save /
Not now card; the program page has the box under each expanded week, a
"n notes" marker on the collapsed row, and a summary line up top. Final
placement (founder): under the week's days, not a box at the top, not on
the Engine dashboard.

### Built 2026-11-12: Engine sees Programming's next week; Programming's view of the Engine corrected

`programming-week.ts`: the athlete's next unlogged week of AI Programming
(week containing the first day after the furthest logged one), each day
summarised to its strength prescription and metcon header, injected into
the sequencer prompt as UPCOMING AI-PROGRAMMING WEEK with the rule:
balance the block against it as a whole, never day by day, never the day
count. Engine-only athletes: nothing added.

`build-writer-payload.ts`: for a sequenced athlete `upcoming_4_weeks` is
now ONLY the current generated block, flagged `sequenced: true`; the
coach-state prompt and the metcon composer read the flag and assume the
observed cadence and mix continue, planning this program on its own merits
and treating the known block as load. Fixed-catalog athletes unchanged.

### Track switches keep month and week (decided 2026-11-12)

"If a user is in month 3, week 2, and they switch off into a regular
track, they should want to stay in month 3, week 2." Migration
`20261112100000_track_week_numbers.sql` gives every track mapping (Mini
Cycle, VO2, Hyrox) week numbers — four weeks a month at the program's own
cadence — so the existing week-boundary translation applies to every
switch, sequencer on or off. A 12-month track has 48 weeks; from beyond
that the athlete lands on its last day.
