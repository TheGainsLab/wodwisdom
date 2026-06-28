# Golden Athletes — deterministic Athlete Model regression suite

Each `<archetype>.json` is a **self-contained** golden snapshot:

```jsonc
{
  "name": "...",
  "description": "SYNTHETIC test fixture — NOT real athlete data.",
  "profile":        { /* raw athlete_profiles-shaped inputs */ },
  "competition":    { /* AthleteModelCompetitionInput slice */ } | null,
  "expected_model": { /* the AthleteModelContent buildAthleteModel produces */ }
}
```

## What this protects

The **deterministic** layer only: `profile (+ competition) → buildAthleteModel → expected_model`.
Because `buildAthleteModel` is a pure function, `expected_model` is asserted **exactly**.

Workflow when you change the Model builder or thresholds:

```
# see what changed (will fail with a diff)
deno test supabase/functions/_shared/golden-athletes_test.ts --allow-read

# review the diff; if the change is intended, regenerate the goldens:
UPDATE_GOLDENS=1 deno test supabase/functions/_shared/golden-athletes_test.ts --allow-read --allow-write
```

A `MODEL_BUILDER_VERSION` / `THRESHOLDS_VERSION` bump is expected to move these — the
point is to make the move **visible and reviewed**, never silent.

## What this does NOT do

It does **not** golden-snapshot CoachState / Training Design / Program. Those are
**non-deterministic** (LLM judgment) — exact snapshots would fail on normal variance.
Those layers are guarded by **invariants** (see the Checkpoint B audit suite) run against
these same athletes, plus human review via the Athlete Model inspector.
