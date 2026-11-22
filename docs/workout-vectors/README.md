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
