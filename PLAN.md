# Training Log: Strength & Skills Tabs

## Goal

Replace the PersonalRecords component on the Training Log Overview tab with two dedicated tabs — **Strength** and **Skills** — that provide sortable, filterable views of logged data.

---

## Current State

- **TrainingLogPage** has 2 tabs: Overview | History
- Overview shows: WorkoutCalendar + PersonalRecords (top 8 heaviest lifts, top 6 metcon scores)
- History shows: full workout cards with block-type filter buttons (All | Strength | Skills | Metcon | Accessory)
- Data already loaded: `allEntries` (flat list of all WorkoutLogEntry with workout_date), `blocksByLog`, `entriesByLog`

## Target State

4 tabs: **Overview | Strength | Skills | History**

---

## Changes

### Step 1: Remove PersonalRecords from Overview

**File: `src/pages/TrainingLogPage.tsx`**
- Remove `import PersonalRecords`
- Remove `strengthRecords` and `metconRecords` useMemo hooks
- Remove `<PersonalRecords ... />` from Overview tab render
- Keep `allEntries` state — reused by Strength/Skills tabs

**File: `src/components/PersonalRecords.tsx`**
- Delete the file

**File: `src/index.css`**
- Remove `.pr-container`, `.pr-title`, `.pr-section`, `.pr-section-label`, `.pr-cards`, `.pr-card`, `.pr-card-movement`, `.pr-card-value`, `.pr-card-reps`, `.pr-card-date` classes and their media query

### Step 2: Add Strength Tab

**File: `src/pages/TrainingLogPage.tsx`**

- Update `tab` state type: `'overview' | 'strength' | 'skills' | 'history'`
- Add tab buttons for all 4 tabs in the `.tl-tabs` bar

**Strength tab content** — a movement-centric view of all strength entries:

1. **Data derivation** (useMemo):
   - Filter `allEntries` to only those whose `block_label` maps to a strength block (join via `block_id` to blocks with `block_type === 'strength'`)
   - Group by `movement`
   - For each movement: collect all sets with weight, reps, date, RPE
   - Calculate per-movement best (heaviest weight)

2. **UI**:
   - **Search input** at top to filter movements by name
   - **Sort toggle**: "By Weight" (heaviest first) | "By Date" (most recent first) — default "By Weight"
   - **Movement cards**: one per movement, sorted per toggle
     - Movement name as header
     - Best lift highlighted (e.g. "PR: 315 lb x 3")
     - Recent sets listed below (last 5-8), each showing: date, weight x reps, RPE if present
   - Empty state if no strength entries logged

### Step 3: Add Skills Tab

**File: `src/pages/TrainingLogPage.tsx`**

Similar structure to Strength:

1. **Data derivation** (useMemo):
   - Filter `allEntries` to those whose block has `block_type === 'skills'`
   - Group by `movement`
   - Collect: reps_completed, sets, quality, scaling_note, date

2. **UI**:
   - **Search input** to filter movements
   - **Sort toggle**: "By Date" (most recent first) | "By Name" (alphabetical) — default "By Date"
   - **Movement cards**: one per movement
     - Movement name as header
     - Total sessions count
     - Recent entries (last 5-8): date, sets x reps, quality/scaling notes
   - Empty state if no skills entries logged

### Step 4: CSS

**File: `src/index.css`**

Add classes for the new tab content (prefixed `.tl-` to match existing training log styles):
- `.tl-search` — search input styling
- `.tl-sort-toggle` — sort button group
- `.tl-movement-card` — movement card container
- `.tl-movement-header` — movement name + PR badge
- `.tl-set-row` — individual set/entry row
- `.tl-pr-badge` — small "PR" indicator
- `.tl-empty` — empty state styling

---

## Files Touched

| File | Action |
|------|--------|
| `src/pages/TrainingLogPage.tsx` | Edit: remove PRs, add 2 tabs + render functions |
| `src/components/PersonalRecords.tsx` | Delete |
| `src/index.css` | Edit: remove PR classes, add new `.tl-*` classes |

## Data Linking Note

To correctly associate entries with block types, we need block info. Currently `allEntries` has `block_id` and `block_label` but not `block_type`. We'll cross-reference with `blocksByLog` — build a `blockTypeMap: Map<string, string>` (block_id → block_type) once during data load, then use it to filter entries by block type.
