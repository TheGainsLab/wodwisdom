# Engine Analytics Enhancement Plan

## Goal
Add 7 missing analytics views from the mobile app to the wodwisdom web Engine Analytics page. No DB changes needed — all data is already in `engine_workout_sessions` and `engine_time_trials`.

## Current State
`EngineAnalyticsPage.tsx` has 4 tabs: Overview, Performance, History, Baselines.
- Overview: stat cards + bar breakdowns by day type / equipment
- Performance: rolling metrics grouped by day type → modality
- History: flat chronological list (no filters, no charts)
- Baselines: flat table of current time trials

## New Architecture
Replace the 4-tab layout with a **menu-based navigation** (matching mobile app pattern). The Overview/Summary stays as the landing view with an analytics menu grid below it. Users drill into specific views from the menu.

### Views to Add (7 new views)

#### 1. Filtered History with Charts
- **Modality selector** (pill buttons from user's sessions)
- **Day Type selector** (filtered by chosen modality)
- **Metric toggle**: Output vs Pace
- **Horizontal bar chart** showing sessions sorted highest-to-lowest
- Source: `EngineHistoryView` in mobile

#### 2. Comparisons
- **Modality selector**
- **Multi-select day types** (toggle on/off)
- **Metric toggle**: Avg Output vs Avg Pace
- **Bar chart** comparing day types within a modality, with session counts
- Source: `EngineComparisonsView` in mobile

#### 3. Time Trial Charts
- **Modality selector**
- **Bar chart** of time trial outputs over time (newest first)
- Replaces current flat Baselines table
- Source: `EngineTimeTrialsView` in mobile

#### 4. Targets vs Actual
- **Modality selector** → **Day Type selector**
- Per-session cards with **dual bar** (blue=target, red=actual pace)
- Shows date and day number
- Source: `EngineTargetsView` in mobile

#### 5. Personal Records
- **Modality selector**
- **Bar chart** of best pace per day type for that modality
- Source: `EngineRecordsView` in mobile

#### 6. HR Analytics
- **Modality selector**
- **Metric selector**: Sessions, Avg HR, Avg Peak HR, Max Peak HR, HR Efficiency, Training Load
- **Bar chart** by day type for selected metric
- HR Efficiency = (pace / avgHR) × 1000
- Training Load = intensity³ × avgHR × √duration
- Source: `EngineHeartRateView` in mobile

#### 7. Work:Rest Ratio
- **Modality selector**
- **Multi-select work:rest ratios** (1:1, 2:1, 3:1, etc.)
- **Bar chart** comparing avg pace across selected ratios
- Source: `EngineWorkRestView` in mobile

### Enhancement to Summary/Overview
Add to existing overview:
- **Energy System Ratios** (per modality): glycolytic, aerobic, systems ratios
- **Peak & Average Pace** stats per modality

## Implementation Steps

### Step 1: Update service layer (`engineService.ts`)
- Add `loadAllTimeTrials()` function (fetch ALL time trials, not just `is_current=true`) — needed for time trial chart history
- No other service changes needed; existing `loadCompletedSessions()` returns all data

### Step 2: Create shared UI components
Add to `EngineAnalyticsPage.tsx` (inline, matching current pattern — no component library):
- `HorizontalBarChart` — reusable bar chart with labels, values, max scaling
- `PillSelector` — single-select pill/button group (modality, day type, metric)
- `PillMultiSelector` — multi-select pill/button group (comparisons, work:rest)

### Step 3: Add new view render functions
Each view is a `render*()` function inside the page component (matching existing `renderOverview`, `renderPerformance`, etc.):
- `renderHistory()` — replace current flat list with filtered + charted version
- `renderComparisons()` — new
- `renderTimeTrials()` — replace current Baselines tab
- `renderTargets()` — new
- `renderRecords()` — new
- `renderHeartRate()` — new
- `renderWorkRest()` — new

### Step 4: Update navigation
- Change from 4 fixed tabs to a **menu-based nav**
- Summary/Overview as default landing view with the analytics menu grid below it
- Analytics menu: grid of cards (title + description) linking to each view
- Back button to return to menu from any view
- Keep existing CSS class conventions (engine-card, engine-badge, etc.)

### Step 5: Enhance Overview
- Add modality selector to overview
- Add Energy System Ratios section (glycolytic, aerobic, systems)
- Add Peak & Average Pace stats

### Step 6: Add CSS
Add styles to `engine.css` for:
- Menu card grid
- Pill selector buttons (active/inactive states)
- Dual bar (targets vs actual)
- Any new layout needs

## Files Modified
1. `src/pages/EngineAnalyticsPage.tsx` — main changes (new views, nav, shared components)
2. `src/lib/engineService.ts` — add `loadAllTimeTrials()`
3. `src/engine.css` — new styles for pills, menu, dual bars

## Not Changing
- No new files created (keep everything in existing files)
- No database migrations
- No new dependencies
- Mobile app's Variability view is omitted (very niche, can add later)
