# Engine Program Switcher — Implementation Plan

## Current State

The 720-day Engine catalog has **4 program variants** already seeded in `engine_program_mapping`:

| Program ID | Days | Description |
|---|---|---|
| `main_5day` | 720 | Standard: catalog days 1→720 in order, 5 sessions/week |
| `main_3day` | 432 | Standard 3-day: subset of 720, same order, 3 sessions/week |
| `main_5day_varied` | 720 | All 720 days but in a **different order** (e.g. seq 50 → catalog day 130) |
| `main_3day_varied` | 432 | Subset of 720 in a different order, 3 sessions/week |

The mapping table already handles the indirection — `program_sequence_order` is what the user sees as "Day 1, Day 2, ..." and `engine_workout_day_number` is which catalog workout they actually do.

**What exists today:**
- Users pick `5-day` or `3-day` at signup via `ProgramSelection.tsx`
- Stored as `engine_program_version` in `athlete_profiles` (text: `'5-day'` or `'3-day'`)
- `getWorkoutsForProgram()` in `engineService.ts` resolves the version to the mapping table
- `engine_workout_sessions.program_version` is **hardcoded** to `'5-day'` when saving
- Dashboard shows "Day X of Y" and month grid based on the resolved workouts
- No UI exists to change program version after initial selection
- No awareness of the `_varied` program variants anywhere in the frontend

## Design Goals

1. Users can **choose** from all available program variants (not just 5-day/3-day)
2. Users can **switch** variants anytime from a settings area in their dashboard
3. **Analytics remain intact** — session history doesn't change, performance metrics are per day_type+modality (already program-agnostic)
4. Switching resets `engine_current_day` to 1 (since sequence position is different per variant) but completed sessions persist
5. Future variants (specialty programs) can be added by inserting rows into `engine_program_mapping` — no code changes needed

## The Month Problem

When a user switches programs, their `engine_current_day` must reset to 1 because sequence position 50 in `main_5day` is a completely different workout than position 50 in `main_5day_varied`. However:

- **Completed sessions are stored by `program_day_number`** (the *catalog* day number, not sequence position), so they survive switching
- **`engine_months_unlocked`** controls content access. Options on switch:
  - **Option A**: Reset to month 1 — simplest, but feels punitive if they've paid for 6 months
  - **Option B**: Keep current months_unlocked — user keeps access to all months they've paid for, just restarts from Day 1 within that window
  - **Recommended: Option B** — months_unlocked is a billing concern and shouldn't regress on variant switch. The user can pick up any available day from their unlocked months.

## Implementation Plan

### Phase 1: Database — Program Registry Table

Create a new `engine_programs` table to serve as the authoritative registry of available program variants. This replaces hardcoded strings with queryable metadata.

**New migration** (`engine_programs_registry.sql`):

```sql
CREATE TABLE engine_programs (
  id text PRIMARY KEY,              -- 'main_5day', 'main_3day', 'main_5day_varied', etc.
  name text NOT NULL,               -- 'Year of the Engine (5-Day)'
  description text,                 -- 'The full 720-day program...'
  days_per_week integer NOT NULL,   -- 5 or 3
  total_days integer NOT NULL,      -- 720 or 432
  sort_order integer DEFAULT 0,     -- display ordering
  is_active boolean DEFAULT true,   -- hide variants without deleting
  created_at timestamptz DEFAULT now()
);

-- Seed the 4 existing variants
INSERT INTO engine_programs (id, name, description, days_per_week, total_days, sort_order) VALUES
  ('main_5day',         'Year of the Engine',           'The full 720-day program — 5 sessions per week across 36 months.', 5, 720, 1),
  ('main_3day',         'Year of the Engine (3-Day)',    'Same program quality at 3 sessions per week — 432 training days.', 3, 432, 2),
  ('main_5day_varied',  'Engine: Varied Order',          'All 720 days in a shuffled sequence for returning athletes.',      5, 720, 3),
  ('main_3day_varied',  'Engine: Varied Order (3-Day)',  '432 days in a shuffled sequence at 3 sessions per week.',          3, 432, 4);

-- Public read access (reference data)
ALTER TABLE engine_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read programs" ON engine_programs FOR SELECT USING (true);
```

**Also**: Change `athlete_profiles.engine_program_version` to store the program ID (`'main_5day'`) instead of the display label (`'5-day'`). We'll handle backwards compatibility with a migration that converts existing values:

```sql
UPDATE athlete_profiles SET engine_program_version = 'main_5day' WHERE engine_program_version = '5-day';
UPDATE athlete_profiles SET engine_program_version = 'main_3day' WHERE engine_program_version = '3-day';
```

### Phase 2: Service Layer Updates (`engineService.ts`)

1. **Add `loadPrograms()`** — query `engine_programs` where `is_active = true`, ordered by `sort_order`
2. **Update `getWorkoutsForProgram()`** — remove hardcoded `'5-day'`/`'3-day'` logic. All variants go through the mapping table uniformly (including `main_5day`, which already has 720 mapping rows)
3. **Add `switchProgram(programId)`** — updates `engine_program_version` and resets `engine_current_day` to 1
4. **Fix `saveWorkoutSession()`** — the training day page currently hardcodes `program_version: '5-day'`. Change to pass the user's actual `engine_program_version`

### Phase 3: Update `ProgramSelection.tsx` → Dynamic Program Picker

Replace the current hardcoded 2-button UI with a dynamic list that queries `engine_programs`:

- Fetch all active programs on mount
- Display as cards with name, description, days_per_week, total_days
- Badge the recommended one (sort_order = 1)
- On select → call `saveProgramVersion(programId)` with the program ID
- Same component reused for both initial selection AND switching (see Phase 4)

### Phase 4: Program Switcher in Dashboard

Add a **settings/gear icon** to the Engine dashboard header that opens a program switcher:

- Shows current program with a "Change Program" button
- Opens the `ProgramSelection` component in a confirmation flow
- On switch: calls `switchProgram()`, warns user that current_day resets to 1
- Shows which months remain unlocked (months_unlocked does not reset)
- Reload dashboard data after switch

The flow:
1. User taps gear icon on Engine dashboard header
2. Sees current program info + "Switch Program" button
3. ProgramSelection appears showing all variants (current one highlighted)
4. User picks new variant → confirmation: "Your progress position will reset to Day 1. Your completed workouts and analytics are preserved. Continue?"
5. On confirm → `switchProgram()` → reload

### Phase 5: Fix Session Logging

In `EngineTrainingDayPage.tsx`, line 524:
- Change `program_version: '5-day'` to use the user's actual program version
- Load program version at the top of the component (already have `loadUserProgress()` available)
- Pass it through to `saveWorkoutSession()`

### Phase 6: Dashboard — Show Completed Days Correctly Across Variants

Currently `completedDays` is built from `program_day_number` (catalog day number). When switching variants, the same catalog day may appear at a different sequence position. The dashboard needs to:

- Map completed catalog day numbers back to the current variant's sequence positions
- Show them as completed regardless of which variant the user was on when they did the workout
- This actually already works because `getDayStatus()` checks `completedDays.has(dayNumber)` where `dayNumber` comes from the workout's `day_number` field (catalog number), and sessions store `program_day_number` (also catalog number). The mapping resolves correctly.

**No change needed here** — the current architecture handles this naturally.

### Phase 7: Specialty Programs (Future-Proofing)

Adding a new variant requires only:
1. Insert a row into `engine_programs` (name, description, days/week, total days)
2. Insert rows into `engine_program_mapping` (program_id, catalog day number, sequence order)
3. Set `is_active = true`

No frontend code changes. The dynamic program picker and mapping-based workout loading handle everything.

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/NEW_engine_programs.sql` | New `engine_programs` table + seed data + migrate existing version strings |
| `src/lib/engineService.ts` | Add `loadPrograms()`, `switchProgram()`, update `getWorkoutsForProgram()` |
| `src/components/engine/ProgramSelection.tsx` | Dynamic program list from DB, reusable for initial pick + switching |
| `src/pages/EngineDashboardPage.tsx` | Add gear icon → program switcher flow |
| `src/pages/EngineTrainingDayPage.tsx` | Fix hardcoded `program_version: '5-day'` to use actual version |

## What Does NOT Change

- **Analytics** — `engine_user_performance_metrics` is keyed on `(user_id, day_type, modality)`, completely program-agnostic
- **Time trials** — keyed on `(user_id, modality)`, no program reference
- **Session history** — persists across switches, stored by catalog day number
- **Modality preferences** — no program reference
- **Month unlocking** — stays as-is (billing concern, not variant concern)
- **Entitlements** — single `'engine'` feature covers all variants

## Summary

The database is already 90% ready — the mapping table and 4 variants exist. The main work is:
1. A small registry table so the frontend can discover variants dynamically
2. Updating `ProgramSelection` to be dynamic and reusable
3. Adding a switcher UI to the dashboard
4. Fixing the hardcoded `program_version` in session saves
5. Handling the `engine_current_day` reset on switch
