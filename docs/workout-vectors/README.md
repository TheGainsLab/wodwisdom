# Workout vectors

A model that describes any metcon as a vector across 12 axes and measures
the distance between two workouts. Standalone: it does not depend on the
signature tables, the generator, the competition service or any athlete data.

Status (2026-11-22): works, reads sensibly, not yet validated against
anything outside itself.

## The two parts

1. **Decompose.** A workout is written as a fact sheet: format, duration or
   cap, rest, and each movement with its amount and load, as prescribed. The
   AI reads the sheet against the fixed axis definitions and assigns a share
   to each of the 12 axes, summing to 100. The sheet carries no workout name.
2. **Measure.** Distance between two vectors is half the sum of the absolute
   differences, on a 0 to 100 scale.

## Rules agreed

- The AI uses judgment; no formula decides the vector.
- No human is asked for an opinion at any step.
- No athlete data goes into building a vector.
- Anything that can be written down can be added. A sheet states whatever
  the workout prescribes, in whatever form (`reps_pattern` covers ladders
  and max-rep sections). No movement table, work figure or pace is needed.
- Metcons only.
- Every vector records the model that judged it. Vectors from different
  models are not compared with each other.

## Files

| File | What it is |
|---|---|
| `axis-definitions.md` | The judge's fixed instructions and the 12 axis definitions (the version in use) |
| `axis-definitions-no-examples.md` | Same without named movements (trial variant, not in use) |
| `make_fact_sheets.py` | Writes the fact sheets |
| `fact-sheets.json` | 48 distinct sheets (first batch) |
| `fact-sheet-repeats.json` | Workouts that repeat one of the 48 |
| `runner.py` | Repeatable runner: fixed prompt, fixed model, 5 independent drafts averaged, provenance and cache. Tested with a stand-in judge only; never yet run against the real model |
| `vectors.json` | Vectors from the first judge (three drafts each) |
| `vectors-sonnet.json` | Vectors from the cheaper judge (three drafts each) |
| `drafts-opus/`, `drafts-sonnet/` | Raw drafts. `in_*` are the shuffled unnamed batches, `key.json` maps codes to workouts |

## First results (48 workouts, 1,128 pairs)

| | First judge | Cheaper judge |
|---|---|---|
| Spread between drafts of one workout | 7.2 | 9.8 |
| Median distance between different workouts | 43 | 42 |
| Closest / farthest pair | 8 / 77 | 6 / 75 |

- Only 18 of 1,128 pairs sit below 15, so different workouts are clearly
  separated from draft noise.
- The two judges' pair distances correlate at 0.93: the same signal.
- The cheaper judge gives slightly more to mixed-modal conditioning (+2.2)
  and less to powerlifting strength (-1.6) and Olympic lifting (-1.1).
- Closest pair: muscle-ups, wall balls and double-unders against muscle-ups,
  rowing and wall balls. Farthest: a heavy snatch ladder against wall balls
  and rowing.

How these were run: independent agents each judged six unnamed sheets,
shuffled differently per draft, told to judge each sheet alone. That differs
from the runner's one-sheet-per-call design, so the spread may include some
batch effect.

## What can be measured on a collection (week, month, cycle)

Coverage
- Average vector of the collection; share on each axis
- Axes never or barely touched
- Balance across the three groups (strength, gymnastics and skill, conditioning)
- Coverage by duration and by format

Spread
- Average, smallest and largest distance between pairs
- Number of near-duplicates
- Each workout's nearest neighbour
- The most unusual workout

Order
- Distance between consecutive workouts
- Whether similar workouts are bunched or spaced
- Days before a similar workout returns
- Longest run without a given axis
- Actual order against a random order of the same workouts

Change over time
- Week-to-week shift in the average vector
- Drift across a month or cycle
- Whether variation is rising or falling
- Whether weeks repeat a pattern

Comparisons
- One program against another
- A program against its stated emphasis or a reference set
- One coach's or generator setting's output against another's

For a single new workout
- Distance from everything already in the collection
- Which axis gap it fills
- Which workout it most duplicates

## Open

- Not validated against any outside measure.
- The runner has not been run against the real model.
- The distance measure treats related axes (for example Olympic lifting and
  powerlifting strength) as fully different. Alternatives not yet compared.
- Model and number of drafts are not fixed. The cheaper judge needs about
  five drafts to match the first judge's noise at three.
- Fact sheets do not yet state a "partition any way" rule where a workout
  has one.

## Self-checks (no outside data)

Raw sheets, drafts and vectors for each check are in the `test-*` folders.

### Known edits and dose response (`test-edits/`, first judge, three drafts)

One change was made to each of six workouts; the base and the edit were never
shown to the same judge. Pass mark set beforehand: the named axis moves the
expected way by more than 3 points.

| Edit | What moved | Result |
|---|---|---|
| Deadlift 185 to 275 lb | Strength +7, aerobic -4 | Pass |
| 8 min to 16 min | Aerobic +8, anaerobic -10 | Pass |
| 10 min to 5 min | Anaerobic +17, aerobic -12 | Pass |
| 3 minutes' rest added | Anaerobic +7 | Pass |
| Rowing swapped for pull-ups | Gymnastics pulling +18, aerobic -7 | Pass |
| Burpees added to a wall-ball-only workout | Mixed-modal +15, squat cycling -10 | Pass |

Stepped series: clean load 75 to 255 lb moved powerlifting strength
0, 4, 8, 17, 19 and aerobic 19, 15, 12, 7, 8. Duration 4 to 30 minutes moved
aerobic 6, 18, 22, 28, 29 and anaerobic 29, 16, 9, 6, 6, with every other
axis flat within 3 points. Both flatten at the top end.

Fourteen workouts from the first batch were mixed in as padding and landed
5.2 from their first-run vectors on average (worst 7.0).

Limit: the edits and expected directions were chosen by the same kind of
model that does the judging. This shows consistent response to load,
duration, rest and movement changes, not that the size of each response is
right.

### Repeat run, rewording, one sheet per call (`test-repeat/`, `test-single/`)

Pass mark set beforehand: within 10 of the original vector.

- **Repeat run.** All 48 workouts re-judged with fresh judges and new
  shuffles. Each landed 4.9 from its first vector on average, worst 7.3;
  none over 10. The 1,128 pair distances correlate at 0.98 between the two
  runs and differ by 2.5 on average. This also serves as the identical-twin
  check: the same sheet under a new code gives the same vector.
- **Rewording.** Six sheets rewritten with the same content: round order
  rotated (2), movement names changed (2), kilograms and minutes instead of
  pounds and seconds (2). Distances to the originals 2.0 to 8.0; all pass.
- **One sheet per call.** Eight workouts judged alone, three drafts each.
  They landed 5.7 from the batched vectors on average (worst 7.3), with no
  axis leaning more than 1 point. Judged alone the drafts agree a little
  more closely (spread 5.1 against 7.3), so batching added some noise but
  no bias.

## Second batch of sheets (`extra-sheets/`)

Thirteen more workouts, written from the official prescriptions so that
every men's Open workout from 2011 to 2026 has a vector: a timed-window
ladder, four max-lift tests, and eight that the first batch had held back.
Some use fields the definitions do not describe (`structure`,
`preceded_by`, `time_window_seconds`, a `format` of `max_lift` or
`timed_windows`); the judges were told to read them as plain statements of
fact. Judged the same way as the first batch, after the validation plan was
written but without the judges seeing any athlete results.

## External validation: Open rankings (`validation/`)

Plan in `validation/plan.md`, written before any athlete results were seen.
Results pasted from the competition service are in `validation/results.py`;
`python3 analyse.py` (run inside `validation/`) reproduces every figure.

Data: men's RX, 2011 to 2026, athletes with a valid result on every workout
of their year (8,600 to 107,000 per year). 139 same-year pairs of workouts.

| Measure | Correlation with ranking similarity |
|---|---|
| Vector distance (primary) | -0.39 |
| Movement overlap (baseline) | +0.09 |
| Euclidean / cosine / Jensen-Shannon | -0.41 / -0.37 / -0.40 |
| Second (cheaper) judge, 91 pairs | -0.35 (first judge on the same pairs: -0.33) |

- Shuffling vectors among workouts within each year never matched the
  observed figure in 5,000 tries.
- Mean ranking similarity by distance quarter: -0.20, -0.24, -0.26, -0.32
  (closest to farthest).
- Same-year Open workouts almost never share a movement, so movement overlap
  cannot tell pairs apart.
- Varies by year: about -0.7 to -0.9 in 2013, 2014, 2016, 2021 and 2023;
  nothing in 2011 and 2017.
- Without the four max-lift tests: -0.35. With first-batch vectors only: -0.33.

Reading: the vectors carry real information about which workouts suit the
same athletes, and far more than movement overlap, but the relationship is
moderate. Distance explains roughly 15% of the variation in ranking
similarity.

Largest misses: a max clean and jerk against row-and-thrusters (15.1a and
15.5, distance 78, among the most similar rankings) and 11.3 against 11.4.
Both suggest a size-and-strength factor that the 12 axes split across
several axes.

Departure from the plan: 13 vectors were judged after the first year of
results had been seen (the judges did not see them).

## Refinement process

Agreed 2026-11-23: refinements come from outside data, change the
definitions (never an individual vector), are proposed from the odd years
only and tested on the even years, and need a plain coaching reason. The
women's Open stays untouched as a final check. Baselines for the current
definitions: odd years -0.34, even years -0.47 (139 pairs: 75 odd, 64 even).

### Tested, not adopted: thrusters and overhead squats as Olympic-lift derivatives (`v2-thruster-ohs/`)

Odd-year evidence: thruster or overhead-squat workouts ranked more like
snatch, clean and jerk workouts than predicted (+0.06 over 23 pairs, 15 of
23 leaning that way); wall balls and deadlifts did not.

Change: one sentence added to `olympic_lifting` saying barbell thrusters and
overhead squats carry part of that axis's share, more as load rises. All 61
workouts re-judged, three drafts each.

| Definitions | Odd | Even (test) | All |
|---|---|---|---|
| Current, three drafts | -0.34 | -0.49 | -0.40 |
| Version 2, three drafts | -0.38 | -0.48 | -0.42 |

The change did what it said: Olympic lifting rose by about 9 points on the
14 thruster and overhead-squat workouts and nothing else moved. But it did
not improve the even years, so it is not adopted. Nine points on one axis
moves a distance by at most nine, and the pairs that prompted the idea are
70 or more apart (15.1a and 15.5 went from 78 to 77).
