# Workout Logging & Start Workout — Implementation Plan

## Overview

This plan adds the missing link between "here's the workout" and "log your results." The new **Start Workout** page breaks a workout into typed blocks (strength / metcon / accessory), lets the athlete work through each with personalized weights and optional timers, and saves the log as a byproduct of doing the workout. A **Training Log** page provides history. Training data then feeds back into AI prompts (chat, profile analysis, workout review) and powers persistent profile update suggestions.

---

## Architecture Summary

**What exists today:**
- Athlete profiles with lifts/skills/conditioning (AthletePage → `athlete_profiles`)
- Movement library with ~90 canonical names + aliases (`movements` table, `analyzer.ts`)
- Workout text parsing: format detection (`detectWorkoutFormat`), time-domain inference (`time-domain.ts`), movement extraction (regex in `analyzer.ts` + AI in `extract-movements-ai.ts`)
- Accept/refuse review pattern (ProgramReviewPage: card-per-item, approve/reject, progress bar, finalize)
- AI context: `buildAthleteContext()` in `chat/index.ts`, `formatProfile()` in `profile-analysis/index.ts`
- RAG pipeline for chat, workout review, and program modifications

**What this plan adds:**
- 3 new DB tables (workout_logs, workout_blocks, workout_log_entries)
- 1 new shared utility (workout-parser.ts) + 1 new shared utility (training-history.ts)
- 2 new edge functions (log-workout, parse-workout)
- 2 new frontend pages (StartWorkoutPage, TrainingLogPage)
- Updates to 3 edge functions (workout-review, profile-analysis, chat)
- Updates to 4 frontend files (WorkoutReviewPage, ProgramDetailPage, AthletePage, Nav, App, supabase.ts)
- Profile suggestion system (deterministic tier 1 + AI tier 2)

---

## Layer 1: Database (Supabase Migrations)

### 1. `workout_logs` table

```
id              uuid PK default gen_random_uuid()
user_id         uuid FK → auth.users NOT NULL
workout_date    date NOT NULL
workout_text    text NOT NULL          -- the workout as written
workout_type    text                   -- for_time | amrap | emom | strength | other
score           text                   -- flexible: "4:48", "8+12", "225", null
rx              boolean default false
source_type     text                   -- 'review' | 'program' | 'manual'
source_id       uuid nullable          -- FK to workout_reviews.id or program_workouts.id
notes           text nullable
created_at      timestamptz default now()
```

- Index: `(user_id, workout_date DESC)` for fast recent-history queries
- RLS: users can SELECT/INSERT/UPDATE/DELETE their own rows only

### 2. `workout_blocks` table

```
id              uuid PK default gen_random_uuid()
log_id          uuid FK → workout_logs ON DELETE CASCADE NOT NULL
block_label     text                   -- "A", "B", "C" or "Strength", "Metcon"
block_type      text NOT NULL          -- strength | metcon | accessory | other
block_text      text NOT NULL          -- raw text for this section
score           text nullable          -- per-block score (time, rounds+reps)
sort_order      smallint NOT NULL
```

- Index: `(log_id)`
- RLS: via parent join (user owns the workout_log)

### 3. `workout_log_entries` table

```
id              uuid PK default gen_random_uuid()
block_id        uuid FK → workout_blocks ON DELETE CASCADE NOT NULL
movement        text NOT NULL          -- canonical name when matched, display text otherwise
sets            smallint nullable
reps            smallint nullable
weight          numeric nullable
weight_unit     text default 'lbs'     -- lbs | kg
rpe             smallint nullable      -- 1-10
scaling_note    text nullable          -- "banded", "jumping", "ring rows"
sort_order      smallint NOT NULL
created_at      timestamptz default now()
```

- Index: `(block_id)`
- RLS: via parent join chain (block → log → user)

**Design decision:** Entries FK to blocks (not directly to logs). This preserves the structure: a workout has blocks, each block has entries. Querying a full log is `workout_logs → workout_blocks → workout_log_entries` with two joins.

---

## Layer 2: Shared Backend Utilities

### 4. `_shared/workout-parser.ts` — Split workout text into typed blocks

**Input:** Raw workout text (e.g., `"A) 5x3 Back Squat @80%\nB) 3 RFT: 15 WB, 10 T2B..."`)

**Output:** `Array<{ label: string, type: 'strength'|'metcon'|'accessory'|'other', text: string, movements: ExtractedMovement[] }>`

**Logic (deterministic first, AI fallback for messy formats):**

1. Check for explicit section markers:
   - `A) ... B) ... C) ...` or `1) ... 2) ... 3) ...`
   - `Strength: ... Metcon: ... Accessory: ...`
   - Double-newline separated blocks
2. For each block, classify type:
   - Contains `@%`, `x3`, `5x5`, `EMOM` + lift name → `strength`
   - Contains `AMRAP`, `FOR TIME`, `RFT`, `rounds` → `metcon`
   - Contains `GHD`, `accessory`, `3x12`, and no barbell lifts → `accessory`
   - Fallback → `other`
3. Extract movements per block using existing `extractMovementsImpl()` from `analyzer.ts` (reuse the library + aliases)
4. Uses `detectWorkoutFormat()` from `analyzer.ts` and `inferTimeDomain()` from `time-domain.ts` for classification support
5. If text has no clear delimiters, treat entire workout as a single block and classify it

**Reuses:** `MOVEMENT_LIBRARY`, `DEFAULT_MOVEMENT_ALIASES`, `extractMovementsImpl()`, `detectWorkoutFormat()`, `inferTimeDomain()`

### 5. `_shared/training-history.ts` — Format recent logs for AI context

**Function:** `formatRecentHistory(logs, days=14) → string`

**Output format:**
```
RECENT TRAINING (last 14 days):
Mon Feb 10 — Strength: Back squat 5x3 @245 RPE 7
Tue Feb 11 — Metcon: Fran 4:48 Rx (thrusters 95, pull-ups Rx)
Wed Feb 12 — Rest
Thu Feb 13 — Metcon: 5 RFT 15 WB 10 T2B — 14:22 Rx
```

**Inputs:** Joins workout_logs + workout_blocks + workout_log_entries for a user, last N days. Returns compact text (fits in a prompt without token bloat).

**Called by:** workout-review, profile-analysis, and chat edge functions.

---

## Layer 3: Edge Functions

### 6. NEW: `log-workout/index.ts` — CRUD for workout logs

**POST** endpoint. Pure data persistence, no AI.

**Request body:**
```json
{
  "workout_date": "2026-02-23",
  "workout_text": "A) 5x3 Back Squat @80%...",
  "workout_type": "strength",
  "score": null,
  "rx": true,
  "source_type": "review",
  "source_id": "uuid-or-null",
  "notes": "Felt strong today",
  "blocks": [
    {
      "label": "A",
      "type": "strength",
      "text": "5x3 Back Squat @80%",
      "score": null,
      "entries": [
        { "movement": "back_squat", "sets": 5, "reps": 3, "weight": 245, "weight_unit": "lbs", "rpe": 7 }
      ]
    }
  ]
}
```

**Logic:**
1. Auth + validate
2. Insert `workout_logs` row
3. For each block: insert `workout_blocks` row with `sort_order`
4. For each entry in block: insert `workout_log_entries` row with `sort_order`
5. Return `{ log_id, created_at }`

### 7. NEW: `parse-workout/index.ts` — Parse workout text into blocks

**POST** endpoint. Lightweight, fast — called when user opens Start Workout page.

**Request body:**
```json
{
  "workout_text": "A) 5x3 Back Squat @80%\nB) 3 RFT: 15 WB, 10 T2B, 5 cleans 155/105",
  "include_scaling": true
}
```

**Logic:**
1. Auth
2. Call `workout-parser.ts` to split into blocks
3. If `include_scaling` is true: fetch athlete_profiles for user, compute personalized weights per movement:
   - Prescribed `155/105` for cleans → user's clean 1RM is 225 → male rx weight is 155, that's 69% of 1RM → suggest "155 (69% of your 1RM)" or adjust if too heavy
   - Uses same scaling logic that workout-review currently describes in prose (but now computed numerically)
4. Return blocks with movements and suggested weights

**Response:**
```json
{
  "blocks": [
    {
      "label": "A",
      "type": "strength",
      "text": "5x3 Back Squat @80%",
      "format": "Strength",
      "movements": [
        { "name": "back_squat", "display": "Back Squat", "suggested_weight": 220, "prescribed_pct": "80%", "note": "80% of your 1RM (275)" }
      ]
    },
    {
      "label": "B",
      "type": "metcon",
      "text": "3 RFT: 15 WB, 10 T2B, 5 cleans 155/105",
      "format": "Rounds For Time",
      "time_domain": "medium",
      "movements": [
        { "name": "wall_ball", "display": "Wall Ball", "suggested_weight": null, "note": null },
        { "name": "toes_to_bar", "display": "Toes to Bar", "suggested_weight": null, "note": null },
        { "name": "clean", "display": "Clean", "suggested_weight": 155, "prescribed_rx": "155/105", "note": "69% of your 1RM (225)" }
      ]
    }
  ]
}
```

### 8. UPDATE: `workout-review/index.ts`

**Change:** After generating the review, also return a `log_template` object.

**What changes (~20 lines):**
- After Claude returns the review JSON, call `workout-parser.ts` on the input text
- Fetch athlete_profiles for the user
- Attach `log_template` to the response: pre-parsed blocks with movements, suggested weights, and score type
- The "Start This Workout" button on the frontend uses this template to pre-populate StartWorkoutPage

**Response addition:**
```json
{
  "review": { ... },
  "log_template": {
    "blocks": [ ... ],
    "workout_type": "metcon"
  }
}
```

### 9. UPDATE: `profile-analysis/index.ts`

**Change:** Before building the AI prompt, query recent training history.

**What changes:**
- Query `workout_logs` + `workout_blocks` + `workout_log_entries` for user's last 14 days
- Format via `training-history.ts`
- Append to the system prompt alongside the profile text
- If training logs exist and `analysisType` is `full` or `lifts`: also compute **tier 2 profile suggestions** (see Layer 6) and include in response

**AI prompt gains:**
```
ATHLETE PROFILE:
[existing profile text]

RECENT TRAINING (last 14 days):
[formatted history]
```

### 10. UPDATE: `chat/index.ts`

**Change:** Same pattern as #9 — add recent training history to `buildAthleteContext()`.

**What changes:**
- When `include_profile` is true, also query recent workout_logs
- Format via `training-history.ts`
- Append after the `ATHLETE PROFILE` block in the system prompt
- If no logs exist, omit (same behavior as today — graceful degradation)

---

## Layer 4: Frontend — New Pages

### 11. `StartWorkoutPage.tsx` — The active workout screen

**Route:** `/workout/start`

**Entry points (via route state or query params):**
- From WorkoutReviewPage: carries `{ workout_text, log_template, source_type: 'review', source_id }`
- From ProgramDetailPage: carries `{ workout_text, source_type: 'program', source_id }`
- From TrainingLogPage: manual entry (blank, user types workout text)

**On mount:**
1. If route state includes `log_template`, use it directly
2. Otherwise, POST to `parse-workout` endpoint with workout text
3. Render blocks

**Per-block UI:**

| Block Type | Inputs | Score |
|-----------|--------|-------|
| **Strength** | Movement name, prescribed sets x reps, weight input (pre-filled from profile), RPE slider (1-10 or 3-tap: easy/moderate/hard) | Per-set or overall |
| **Metcon** | Workout text displayed, score input (MM:SS picker for for-time, rounds+reps for AMRAP), Rx toggle, per-movement scaling notes (tap movement → pick from short list) | Time or rounds+reps |
| **Accessory** | Simple sets x reps, done checkbox | Done/not-done |

**Optional per-block:** Timer button
- Count-up stopwatch (general)
- Countdown for AMRAP cap time
- Interval beep for EMOM

**"Finish Workout" button:**
1. Validate: at least one block has some data
2. POST to `log-workout` endpoint
3. Navigate to Training Log or show confirmation toast

**State management:** Local `useState` — no global store needed. Blocks array with entries array nested inside.

### 12. `TrainingLogPage.tsx` — View logged workout history

**Route:** `/training-log`

**UI:**
- Date-grouped list view (most recent first), or calendar strip at top
- Each logged workout card: date, workout type badge (strength/metcon/accessory), score, Rx indicator
- Tap to expand: shows blocks, movements, weights used, RPE, scaling notes
- Search/filter by movement name or date range
- "Log a Workout" button → navigates to `/workout/start` (manual entry mode)

**Data:** Queries `workout_logs` + `workout_blocks` + `workout_log_entries` for the current user, paginated or limited to last 30 days initially.

---

## Layer 5: Frontend — Modifications to Existing Pages

### 13. UPDATE: `WorkoutReviewPage.tsx`

**Change:** After review is displayed, add a "Start This Workout" button.

**What changes:**
- Store the `log_template` from the review response in state
- Below the "Review Another Workout" button, add:
  ```
  "Start This Workout" → navigate('/workout/start', { state: { workout_text, log_template, source_type: 'review', source_id: review_id } })
  ```
- Button styled as primary `auth-btn`

### 14. UPDATE: `ProgramDetailPage.tsx`

**Change:** Each workout row in the table gets an inline "Start" button.

**What changes:**
- Add a 4th column to the workout table (or an action cell)
- Small "Start" button per row
- On tap: `navigate('/workout/start', { state: { workout_text: w.workout_text, source_type: 'program', source_id: w.id } })`

### 15. UPDATE: `AthletePage.tsx` — Profile Suggestion Cards

**Change:** New section: "Suggested Updates" — persistent cards that appear when suggestions exist.

**Two tiers of suggestions (see Layer 6 for details):**

**Tier 1 (deterministic, on page load):**
- Query last 14 days of `workout_log_entries`
- Compare against current `athlete_profiles` values
- If logged weight > profile 1RM for a movement → suggestion
- If benchmark time improved → suggestion
- No AI call, no cost, fast

**Tier 2 (AI-powered, from profile analysis):**
- When user runs AI profile analysis (#9), and training logs exist, the response includes `suggestions[]`
- Stored in `profile_evaluations` alongside analysis text
- Persists between visits

**UI (reuses ProgramReviewPage accept/refuse pattern):**
- Card per suggestion: current value → suggested value + reason
- Accept → calls `saveProfile` upsert with updated value
- Dismiss → hides (localStorage flag for tier 1, dismissed column for tier 2)
- Batch model (same as ProgramReviewPage): review all visible, accept/dismiss each

**Implementation note:** The review card UI from ProgramReviewPage doesn't need to be extracted into a shared component for V1 — the pattern is simple enough to duplicate (card + two buttons + status). Extraction to a shared component is a V2 refinement once there are 3+ consumers.

### 16. UPDATE: `Nav.tsx`

**Change:** Add "Training Log" nav item.

- Position: between "Profile" and "History" (or after Profile)
- Icon: clipboard-check or dumbbell-style SVG
- Route: `/training-log`
- Active state: `location.pathname === '/training-log'`

### 17. UPDATE: `App.tsx`

**Change:** Add new routes.

```tsx
<Route path="/workout/start" element={<StartWorkoutPage session={session} />} />
<Route path="/training-log" element={<TrainingLogPage session={session} />} />
```

### 18. UPDATE: `src/lib/supabase.ts`

**Change:** Add endpoint constants.

```ts
export const LOG_WORKOUT_ENDPOINT = `${SUPABASE_URL}/functions/v1/log-workout`;
export const PARSE_WORKOUT_ENDPOINT = `${SUPABASE_URL}/functions/v1/parse-workout`;
```

---

## Layer 6: AI Context Integration & Profile Suggestions

### 19. Training history in AI prompts

All three AI-calling functions (chat, workout-review, profile-analysis) gain a new context block when training logs exist:

```
RECENT TRAINING (last 14 days):
Mon Feb 10 — Strength: Back squat 5x3 @245 RPE 7
Tue Feb 11 — Metcon: Fran 4:48 Rx (thrusters 95, pull-ups Rx)
Wed Feb 12 — Rest
Thu Feb 13 — Metcon: 5 RFT 15 WB 10 T2B — 14:22 Rx
```

Appended after `ATHLETE PROFILE`, before RAG context. If no logs exist, omitted entirely (graceful degradation — same behavior as today).

### 20. Profile suggestion generation

**Tier 1 — Deterministic (computed on AthletePage load, no AI):**

Runs on every visit to `/profile`. Fast Supabase query + client-side comparison.

| Check | Logic |
|-------|-------|
| Lift PR | `WHERE movement = X AND weight > profile.lifts[X]` across last 14 days |
| Benchmark improvement | Logged time < profile conditioning time for same benchmark |
| Skill upgrade | Logged N workouts with movement Rx (no scaling_note) → suggest intermediate/advanced |
| Bodyweight change | Consistent different bodyweight in recent logs |

**Tier 2 — AI-powered (generated during profile-analysis):**

When `profile-analysis` runs and training logs exist, the AI prompt includes training history. The response JSON gains a `suggestions[]` array:

```json
{
  "analysis": "...",
  "suggestions": [
    { "field": "lifts.back_squat", "current_value": 275, "suggested_value": 290, "reason": "You logged 290 on Feb 15, RPE 7" },
    { "field": "skills.muscle_ups", "current_value": "beginner", "suggested_value": "intermediate", "reason": "3 Rx sessions this month with increasing reps" }
  ]
}
```

Stored in `profile_evaluations` so they persist. Displayed on AthletePage in the suggestion cards.

### 21. Rolling summarization (FUTURE — not V1)

After 30+ days of logs, raw entries get too long for context. Add a scheduled function or on-read summarizer:

> "Weeks 1-4: 12 workouts, avg 4/week. Squat volume 3x/week avg 240lbs. Conditioning improved — Fran from 5:30 to 4:48. Most common movements: wall ball (8x), pull-up (7x), clean (6x)."

V1 ships with raw 14-day history. Summarization added when users accumulate enough data to warrant it.

---

## Build Order

Each phase is self-contained — you can ship after any phase and have a working increment.

### Phase 1: Foundation (DB + parser + CRUD)
1. **Migration:** Create `workout_logs`, `workout_blocks`, `workout_log_entries` tables with indexes + RLS
2. **`_shared/workout-parser.ts`:** Workout text → typed blocks. Reuses analyzer.ts
3. **`log-workout/index.ts`:** POST endpoint for saving workout logs (pure CRUD)
4. **`parse-workout/index.ts`:** POST endpoint for parsing workout text + personalized weights

### Phase 2: Core Frontend
5. **`StartWorkoutPage.tsx`:** The big build — block cards, per-type inputs, timers, finish button
6. **`TrainingLogPage.tsx`:** View logged history, expand details, search
7. **`supabase.ts`:** Add `LOG_WORKOUT_ENDPOINT`, `PARSE_WORKOUT_ENDPOINT`
8. **`App.tsx`:** Add routes for `/workout/start` and `/training-log`
9. **`Nav.tsx`:** Add "Training Log" nav item

### Phase 3: Entry Points
10. **`WorkoutReviewPage.tsx`:** "Start This Workout" button after review
11. **`workout-review/index.ts`:** Return `log_template` in response
12. **`ProgramDetailPage.tsx`:** Inline "Start" button per workout row

### Phase 4: AI Integration
13. **`_shared/training-history.ts`:** Format recent logs for prompts
14. **`profile-analysis/index.ts`:** Add training history to AI prompt + tier 2 suggestions
15. **`chat/index.ts`:** Add training history to `buildAthleteContext()`

### Phase 5: Profile Suggestions
16. **`AthletePage.tsx`:** Tier 1 deterministic suggestions (on page load) + tier 2 display from evaluations
17. **`profile-analysis/index.ts`:** Add `suggestions[]` to response JSON

### Phase 6: Future (not V1)
18. Rolling summarization for 30+ days of logs
19. Extract accept/refuse card into shared component (once 3+ consumers exist)

---

## Key Decisions & Tradeoffs

| Decision | Rationale |
|----------|-----------|
| Entries FK to blocks, not directly to logs | Preserves workout structure. A "Fran" is one block; "A/B/C day" is three blocks. Log → blocks → entries is the natural hierarchy. |
| Deterministic parser first, AI fallback later | Speed + cost. Most workout text follows common patterns (A/B/C, AMRAP/FOR TIME). AI parsing adds latency and token cost for edge cases — defer to V2. |
| No separate `suggest-profile-update` endpoint | Tier 1 is client-side math (no endpoint needed). Tier 2 piggybacks on existing `profile-analysis` (which already has profile + now has training history). Avoids a new function deployment. |
| Batch accept/refuse model (not persistent) for V1 | ProgramReviewPage pattern already exists and works. Persistent casual model (always-visible card, one-at-a-time) is better UX but more state management — V2. |
| 14-day training history window | Keeps prompt token count manageable. 14 days of logs ≈ 200-400 tokens. Longer windows handled by rolling summarization in V2. |
| `score` as text (not typed) | CrossFit scores vary wildly: "4:48", "8+12", "225", "3 rounds + 14 reps". Text is flexible. Frontend formats appropriately based on `workout_type`. |
| No real-time sync / offline support | YAGNI for V1. Start Workout page holds state locally, saves on "Finish." If the app crashes mid-workout, data is lost. Acceptable for MVP — auto-save to localStorage is a V2 addition. |

---

## Files Changed Summary

| File | Action | Layer |
|------|--------|-------|
| `supabase/migrations/YYYYMMDD_workout_logging.sql` | NEW | DB |
| `supabase/functions/_shared/workout-parser.ts` | NEW | Backend |
| `supabase/functions/_shared/training-history.ts` | NEW | Backend |
| `supabase/functions/log-workout/index.ts` | NEW | Backend |
| `supabase/functions/parse-workout/index.ts` | NEW | Backend |
| `supabase/functions/workout-review/index.ts` | UPDATE | Backend |
| `supabase/functions/profile-analysis/index.ts` | UPDATE | Backend |
| `supabase/functions/chat/index.ts` | UPDATE | Backend |
| `src/pages/StartWorkoutPage.tsx` | NEW | Frontend |
| `src/pages/TrainingLogPage.tsx` | NEW | Frontend |
| `src/pages/WorkoutReviewPage.tsx` | UPDATE | Frontend |
| `src/pages/ProgramDetailPage.tsx` | UPDATE | Frontend |
| `src/pages/AthletePage.tsx` | UPDATE | Frontend |
| `src/components/Nav.tsx` | UPDATE | Frontend |
| `src/App.tsx` | UPDATE | Frontend |
| `src/lib/supabase.ts` | UPDATE | Frontend |

**New files:** 7
**Modified files:** 9
**Total:** 16 files
