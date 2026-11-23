# Program audit: first worked example

One generated four-week program (20 metcons, five a week), audited with the
workout-vector model. Sheets in `sheets.json`, vectors in `vectors.json`,
raw drafts in `out_*`. First judge, three drafts each. No personal data.

## Measures and flags

| Measure | Flag when |
|---|---|
| Coverage: share on each axis and group | no workout puts an axis above 5 |
| Repetition: close pairs | a pair is under 15 apart |
| Spread: average distance between all workouts | below about 40 |
| Spacing: distance between consecutive workouts | similar workouts in the same week |

Reference: the 61 Open workouts average 43 to 48 apart and split
32% strength, 21% gymnastics and skill, 46% conditioning.

## Result

- Spread 32 (median 30); 6 of 190 pairs under 15, 19 under 20.
- Coverage 13% strength, 21% gymnastics and skill, 66% conditioning.
  Aerobic capacity 24 against the Open's 13; it is the top axis in 15 of 20.
- Powerlifting strength never exceeds 7 and Olympic lifting appears in 4 of
  20. The program does its heavy lifting off the clock, so this is by design
  and outside what the audit sees.
- Closest pairs: W1D5 and W3D4 (8), W3D4 and W4D4 (10), W1D1 and W3D1 (12).
- Weeks 1 to 3 average 34 to 37 between workouts; week 4, a deload, 22.
- All 20 run 10 to 22 minutes. Formats: 8 AMRAP, 5 intervals, 5 for time,
  2 EMOM.

## Gaps in the input found on the way

- Nine metcons list a bike with no amount.
- Sheets carry no intended effort, so a deload done easy looks the same as
  the same work done hard.
- One block's notes field (W2D5) holds the generator's working notes
  instead of athlete-facing text.
