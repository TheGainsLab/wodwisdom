# Engine Integration Plan — wodwisdom

## Context

Port the "Year of the Engine" conditioning program from crossfit-training-app (Next.js) into wodwisdom (React/Vite/Supabase). The Engine is a 720-day structured conditioning program with 20+ distinct workout frameworks, personalized pacing from time trial baselines, interval timers, and performance analytics.

**Skip in v1**: `ml_confidence`, `ml_predicted_pace`, `prediction_type`, `getDayTypePatterns` (ML feature extraction). Formula-based targets only.

---

## Phase 1: Database Schema (Migrations) ✅ COMPLETE

Create 2 new migration files in `supabase/migrations/`:

### Migration 1: `20260238000000_engine_tables.sql`

**Tables to create:**

1. **`engine_workouts`** — The 720 training days
   - `id` (uuid PK)
   - `day_number` (integer, 1-720, UNIQUE, CHECK 1-720)
   - `day_type` (text) — endurance, anaerobic, threshold, polarized, flux, time_trial, etc.
   - `phase` (integer) — training phase
   - `block_count` (integer)
   - `program_type` (text, default 'main_5day')
   - `block_1_params` (jsonb), `block_2_params`, `block_3_params`, `block_4_params`
   - `total_duration_minutes` (integer)
   - `base_intensity_percent` (numeric)
   - `month` (integer)
   - `avg_work_rest_ratio` (numeric)
   - Indexes: `idx_engine_workouts_day_number`, `idx_engine_workouts_phase`, `idx_engine_workouts_month`

2. **`engine_day_types`** — Workout type definitions
   - `id` (uuid PK)
   - `name` (text, UNIQUE)
   - `phase_requirement` (integer)
   - `block_count` (integer)
   - `set_rest_seconds` (integer)
   - `block_1_params` through `block_4_params` (jsonb)
   - `max_duration_minutes` (integer)
   - `is_support_day` (boolean)

3. **`engine_workout_sessions`** — User completed workouts
   - `id` (uuid PK)
   - `user_id` (uuid FK → auth.users)
   - `date` (date)
   - `program_day` (integer)
   - `program_day_number` (integer)
   - `day_type` (text)
   - `modality` (text)
   - `units` (text)
   - `target_pace` (numeric)
   - `actual_pace` (numeric)
   - `total_output` (numeric)
   - `performance_ratio` (numeric)
   - `calculated_rpm` (numeric)
   - `average_heart_rate` (integer)
   - `peak_heart_rate` (integer)
   - `perceived_exertion` (integer)
   - `workout_data` (jsonb) — full interval-level data
   - `completed` (boolean, default true)
   - `program_version` (text, default '5-day')
   - `created_at` (timestamptz)
   - RLS: users can only CRUD their own rows

4. **`engine_time_trials`** — Baseline measurements
   - `id` (uuid PK)
   - `user_id` (uuid FK → auth.users)
   - `modality` (text)
   - `date` (date)
   - `total_output` (numeric)
   - `calculated_rpm` (numeric)
   - `units` (text)
   - `is_current` (boolean, default true)
   - `created_at` (timestamptz)
   - RLS: user-scoped

5. **`engine_user_modality_preferences`** — Unit preferences per equipment
   - `id` (uuid PK)
   - `user_id` (uuid FK → auth.users)
   - `modality` (text)
   - `primary_unit` (text)
   - `secondary_unit` (text)
   - UNIQUE(user_id, modality)

6. **`engine_user_performance_metrics`** — Rolling averages
   - `id` (uuid PK)
   - `user_id` (uuid FK → auth.users)
   - `day_type` (text)
   - `modality` (text)
   - `learned_max_pace` (numeric)
   - `rolling_avg_ratio` (numeric)
   - `rolling_count` (integer)
   - `last_5_ratios` (jsonb)
   - UNIQUE(user_id, day_type, modality)

7. **`engine_program_mapping`** — Maps 5-day→3-day
   - `id` (uuid PK)
   - `program_type` (text) — 'main_3day', etc.
   - `user_id` (uuid, nullable) — null = global mapping
   - `program_day_number` (integer)
   - `source_day_number` (integer)
   - `month_number` (integer)
   - `week_number` (integer)

### Migration 2: `20260239000000_engine_profile_fields.sql`

Add Engine fields to `profiles` table:
- `engine_program_version` (text) — '5-day' or '3-day'
- `engine_current_day` (integer, default 1)
- `engine_months_unlocked` (integer, default 1)
- `engine_subscription_status` (text) — 'trial', 'active', 'inactive'

### Migration 3: `20260240000000_engine_performance_rpc.sql`

Create `update_engine_performance_metrics` RPC function:
- Takes: user_id, day_type, modality, performance_ratio, actual_pace
- Upserts into `engine_user_performance_metrics`
- Maintains rolling_avg_ratio (last 5 sessions)
- Updates learned_max_pace when ratio > 1.0

---

## Phase 2: Data Migration ✅ COMPLETE

### Extract 720 workouts from production Supabase

**Option A (recommended): SQL dump**
```
pg_dump --data-only --table=workouts --table=day_types > engine_seed_data.sql
```
Then adapt INSERT statements to use `engine_workouts` / `engine_day_types` table names.

**Option B: Supabase REST export**
Use `supabase` CLI or REST API to export as JSON, then write a migration INSERT.

### Extract program_mapping data
Same approach — dump the `program_mapping` table for the 3-day mappings.

**Deliverable**: A seed migration file `20260241000000_engine_seed_data.sql` with all 720 workouts, day types, and program mappings.

---

## Phase 3: Service Layer ✅ COMPLETE

### Create `src/lib/engineService.ts`

Port from `crossfit-training-app/lib/engine/databaseService.ts` (850 lines), adapting:

- **Auth pattern**: Use wodwisdom's `supabase` client from `./lib/supabase` (session-based auth with `auth.users.id` directly — no separate `users` table lookup)
- **Table names**: Prefix all with `engine_` (engine_workouts, engine_workout_sessions, etc.)
- **Remove ML methods**: Skip `getDayTypePatterns`

Methods to port:
| Method | Source lines | Notes |
|--------|-------------|-------|
| `initialize()` | 14-34 | Simplify — use auth.users.id directly |
| `loadWorkouts()` | 226-245 | Rename table |
| `loadWorkoutForDay(dayNumber)` | 248-268 | Rename table |
| `getWorkoutsForProgram(version)` | 171-201 | Rename table |
| `getProgramMapping(type)` | 127-168 | Rename table |
| `loadCompletedSessions()` | 271-296 | user_id = auth.users.id |
| `getWorkoutSessionByDay()` | 299-337 | Rename table |
| `saveWorkoutSession(data)` | 560-589 | Rename table |
| `loadTimeTrialBaselines(modality)` | 340-374 | Rename table |
| `saveTimeTrial(data)` | 425-456 | Rename table |
| `loadUnitPreferenceForModality()` | 459-485 | Rename table |
| `saveUnitPreferenceForModality()` | 488-529 | Rename table |
| `updatePerformanceMetrics()` | 592-630 | RPC call |
| `getPerformanceMetrics()` | 633-658 | Rename table |
| `loadUserProgress()` | 661-677 | Adapt to profiles table |
| `saveProgramVersion()` | 70-89 | Save to profiles.engine_program_version |
| `loadProgramVersion()` | 92-124 | Read from profiles.engine_program_version |

---

## Phase 4: Components (Port Order)

All components go in `src/pages/engine/` and `src/components/engine/`.

### 4a. Engine Landing Page (`src/pages/EngineLandingPage.tsx`)
- Port from `crossfit-training-app/app/engine/page.tsx` (194 lines)
- Marketing/info page — straightforward HTML adaptation
- Update app store links, adapt styling to wodwisdom CSS variables

### 4b. Program Selection (`src/components/engine/ProgramSelection.tsx`)
- Port from source (90 lines)
- Minimal — two buttons (5-day / 3-day), calls `engineService.saveProgramVersion()`
- Adapt styling to wodwisdom dark theme

### 4c. Engine Dashboard (`src/pages/EngineDashboardPage.tsx`)
- Port from source Dashboard.tsx (513 lines)
- Three views: main overview → month grid → week/day grid
- Shows progress (current month, days completed, %)
- Day cards with completion status (locked/available/current/completed)
- Calls: `loadUserProgress()`, `getWorkoutsForProgram()`, `loadCompletedSessions()`

### 4d. Training Day Component (`src/pages/EngineTrainingDayPage.tsx`)
- Port from source TrainingDayComponent.tsx (**7,385 lines** — largest component)
- This is the core workout execution experience

**Three-stage flow:**
1. **Equipment Selection** — Pick modality (rower, bike, ski, run) + show unit preference + previous baselines
2. **Workout Preview** — Show intervals, target paces, block breakdown, workout history for this day_type
3. **Active Workout** — Countdown timer with:
   - Work/rest phase tracking
   - Interval progression
   - Burst tracking (polarized days — periodic high-intensity bursts)
   - Flux tracking (flux days — alternating base/flux intensity periods)
   - Real-time pace targets per interval
   - Audio/visual cues for phase transitions

**Post-workout logging:**
- Total output, average pace
- Heart rate (avg + peak)
- RPE slider
- Performance ratio calculation (actual vs target)
- Save session → update performance metrics

**Time trial handling:**
- Special flow for `day_type === 'time_trial'`
- Score entry with unit selection
- Baseline calculation
- Save to `engine_time_trials`

**Porting approach**:
- Remove `'use client'` Next.js directive
- Replace `engineDatabaseService` import with wodwisdom's `engineService`
- Replace `lucide-react` icons with same library (already available or add to package.json)
- Adapt Tailwind-style classes to wodwisdom's CSS approach or add Tailwind
- Keep all timer logic, burst/flux calculations, pace calculation intact

### 4e. Analytics Page (`src/pages/EngineAnalyticsPage.tsx`)
- Port from source Analytics.tsx (**7,077 lines**)
- Performance charts, trend analysis
- Per-modality and per-day-type breakdowns
- Historical session data visualization
- Time trial progression tracking

### 4f. Engine Taxonomy (`src/pages/EngineTaxonomyPage.tsx`)
- Reference page showing all 20+ day types and their descriptions
- Port from source taxonomy/page.tsx

---

## Phase 5: Routing & Navigation

### Add routes to `src/App.tsx`:
```tsx
<Route path="/engine" element={<EngineLandingPage />} />
<Route path="/engine/dashboard" element={<EngineDashboardPage session={session} />} />
<Route path="/engine/training/:dayNumber" element={<EngineTrainingDayPage session={session} />} />
<Route path="/engine/analytics" element={<EngineAnalyticsPage session={session} />} />
<Route path="/engine/taxonomy" element={<EngineTaxonomyPage session={session} />} />
```

### Add to navigation sidebar:
- "Engine" nav item under existing nav structure
- Conditionally show based on Engine subscription status

---

## Phase 6: Subscription & Access Control

### Option A: Extend existing Stripe setup
- Add "Engine" plan ($X/mo) alongside existing Coach/Gym plans
- Add `engine` entitlement check
- Modify `create-checkout` function to support Engine plan

### Option B: RevenueCat (existing in crossfit-training-app)
- If mobile app is planned, keep RevenueCat for cross-platform
- Web-only = Stripe is simpler

**Access control in components:**
- Check `profiles.engine_subscription_status` before loading Dashboard
- Trial users: month 1 only (days 1-20 for 5-day, days 1-12 for 3-day)
- Active users: progressive unlock based on `engine_current_day`
- Full unlock: `engine_months_unlocked >= 36`

---

## Phase 7: Styling Integration — DECIDED: Convert to wodwisdom CSS

No Tailwind. Convert all Engine components to wodwisdom's existing CSS variable system as we port.

### Approach
- Each Engine component gets CSS classes in `src/engine.css` (single file for all Engine styles)
- All classes prefixed with `.engine-` to keep them scoped
- Use existing CSS variables (`--accent`, `--surface`, `--bg`, `--text`, `--text-dim`, etc.)
- Match wodwisdom's existing patterns: dark theme, border styles, border-radius, font weights
- No new dependencies needed

### Reusable base classes to define
- `.engine-page` — page container with scroll
- `.engine-card` — surface card with border (matches existing `.auth-card` pattern)
- `.engine-stat` — stat display (value + label)
- `.engine-btn` / `.engine-btn-primary` — buttons matching existing `.auth-btn`
- `.engine-grid` — responsive grid layout
- `.engine-section` — content section with spacing
- `.engine-header` — section headers
- `.engine-badge` — status badges (locked/available/complete)
- `.engine-timer` — workout timer display
- `.engine-progress` — progress bars

### Why this works
- The 14k lines of Tailwind are mostly repetitive layout/spacing/color patterns
- A small set of reusable `.engine-*` classes replaces thousands of inline Tailwind classes
- Result looks native to wodwisdom from day one
- No two-styling-system maintenance burden

---

## Implementation Order

| Step | What | Est. Lines | Actual Lines | Dependencies | Status |
|------|------|-----------|-------------|-------------|--------|
| 1 | Database migrations (4 files) | ~300 | ~300 | None | ✅ Done |
| 2 | Seed data (22 + 720 + 2592 rows) | ~3,300 | ~3,300 | Step 1 | ✅ Done |
| 3 | `engineService.ts` | ~450 | ~450 | Step 1 | ✅ Done |
| 4 | Create `engine.css` with base classes | ~150 | 108 | None | ✅ Done |
| 5 | Add `lucide-react` + ProgramSelection | ~90 | 68 | Step 3 | ✅ Done |
| 6 | Routing + Navigation | ~30 | ~30 | Steps 5 | ✅ Done |
| 7 | Engine Dashboard | ~500 | 335 | Step 3 | ✅ Done |
| 8 | Training Day Component | ~7,000 | ~530 | Step 3 | ✅ Done |
| 9 | Analytics Page | ~7,000 | ~320 | Step 3, Step 8 | ✅ Done |
| 10 | Nav upgrades (Engine sub-group) | ~10 | ~10 | Steps 6-9 | ✅ Done |
| 11 | Subscription integration (paywall) | ~200 | ~120 | Step 10 | ✅ Done |
| 12 | Taxonomy page | ~400 | ~160 | Step 10 | ✅ Done |

**Critical path**: Steps 4→5→8 (CSS → deps → training day). Everything else can parallelize after Step 5.

---

## Open Questions

1. ~~**Workout data extraction**~~ — ✅ Resolved. Data extracted and seeded.
2. ~~**Styling approach**~~ — ✅ Resolved. Convert to wodwisdom CSS. No Tailwind. Single `engine.css` file with `.engine-*` prefixed classes using existing CSS variables.
3. **Engine pricing** — What's the Engine subscription price? Separate plan or bundle with existing tiers?
4. **Day advancement** — In the original app, how does `engine_current_day` advance? Automatically after completing a day, or manually?
