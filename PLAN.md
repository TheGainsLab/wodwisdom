# Plan: Fault Checkboxes on Workout Logging

## Summary

When logging a workout on `StartWorkoutPage`, fetch the cached coach review (via `source_id`) and display the `common_faults` from the review as checkboxes beneath each movement. Checked faults are persisted to `workout_log_entries` and surfaced in training history for downstream AI consumption.

---

## Step 1 — DB: add `faults_observed` column to `workout_log_entries`

New migration: `supabase/migrations/20260260000000_faults_observed.sql`

```sql
ALTER TABLE workout_log_entries
  ADD COLUMN faults_observed text[] DEFAULT NULL;
```

- `text[]` (Postgres native array) — simple, queryable, matches the `common_faults: string[]` shape from the review JSON.
- NULL when no review was run or no faults checked. Empty array `{}` means "review had faults but none observed."

---

## Step 2 — Frontend: fetch cached review on `StartWorkoutPage`

In `StartWorkoutPage.tsx`, inside the existing `useEffect` that loads blocks (line ~322):

- After fetching `program_workout_blocks`, also query `workout_reviews` for the matching `source_id`:
  ```ts
  const { data: reviewRow } = await supabase
    .from('workout_reviews')
    .select('review')
    .eq('source_id', sourceState.source_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  ```
- Parse the review JSON and build a per-entry fault lookup by matching movement names from the review's `cues_and_faults` to the parsed movements in each block.
- Store in state: `reviewFaults: Record<string, string[]>` — keyed by the same `${bi}-sk${si}` / `${bi}-m${mi}` / `${bi}-s0` entry keys used for other entry state.

---

## Step 3 — Frontend: render fault checkboxes in the logging UI

For each skill/metcon/strength entry that has matching faults from the review:

- Display fault strings as labeled checkboxes below the existing input row.
- Track checked faults in state: `checkedFaults: Record<string, string[]>` — same entry keys, value is array of checked fault strings.
- Style: compact, muted text, X icon matching the review page's fault styling.

Placement:
- **Skills blocks** (line ~784): after the existing input row (sets/reps/hold/quality/RPE).
- **Metcon blocks**: after each movement's inputs.
- **Strength blocks**: after the set rows for each movement.

Only shown when faults exist for that movement. If no review was cached, nothing renders — zero friction added.

---

## Step 4 — Frontend: include `faults_observed` in the finish payload

In `handleFinish` (line ~449), when constructing entry objects for each block type:

- Add `faults_observed: checkedFaults[key]?.length > 0 ? checkedFaults[key] : null` to each entry.
- NULL means no review or no faults available. Empty array not sent (avoids noise).

---

## Step 5 — Backend: persist `faults_observed` in `log-workout`

In `supabase/functions/log-workout/index.ts`:

- Add `faults_observed?: string[] | null` to the `LogEntry` interface.
- In the entry insert loop (line ~214), add:
  ```ts
  faults_observed: Array.isArray(entry.faults_observed) && entry.faults_observed.length > 0
    ? entry.faults_observed
    : null,
  ```

---

## Step 6 — Backend: include `faults_observed` in training history formatting

In `supabase/functions/_shared/training-history.ts`:

- Add `faults_observed: string[] | null` to `WorkoutLogEntryRow`.
- In `formatBlock` for skills entries, append observed faults: e.g. `faults: Elbows flaring, Short lockout`.
- In `fetchAndFormatRecentHistory`, add `faults_observed` to the select column list.

---

## Step 7 — Movement name matching

The review's `cues_and_faults[].movement` and the parsed entry's `movement` may differ (e.g. "Handstand Push-Up" vs "HSPU"). Matching strategy:

- Normalize both: lowercase, strip hyphens/spaces/punctuation.
- Fuzzy substring check as fallback (e.g. "hspu" matches "handstand push up").
- Unmatched movements simply don't show fault checkboxes — no friction.

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/20260260000000_faults_observed.sql` | New migration adding `faults_observed text[]` column |
| `src/pages/StartWorkoutPage.tsx` | Fetch review, render fault checkboxes, include in payload |
| `supabase/functions/log-workout/index.ts` | Accept + persist `faults_observed` |
| `supabase/functions/_shared/training-history.ts` | Include faults in formatted history output |
