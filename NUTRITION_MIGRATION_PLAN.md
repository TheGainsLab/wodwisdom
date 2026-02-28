# Nutrition Features Migration Plan — crossfit-training-app → wodwisdom

## Overview

Migrate all nutrition features from the Expo/React Native mobile app (`crossfit-training-app/fitness-mobile/`) into the wodwisdom React/Vite web app. This follows the same migration pattern successfully used for the Engine conditioning program.

**Source**: `crossfit-training-app/fitness-mobile/components/nutrition/` (19 components) + 6 Supabase Edge Functions + 4 SQL migrations
**Target**: `wodwisdom/src/` (new pages, components, service layer, migrations)

---

## Feature Inventory

### What exists in the mobile app

| Feature | Mobile Components | Edge Functions | DB Tables |
|---------|-------------------|----------------|-----------|
| **Daily Food Log** | NutritionPage.tsx (1,500+ lines) | food-log | food_entries, daily_nutrition |
| **Food Search** | FoodSearchView.tsx, FoodSelectionView.tsx | nutrition-search | cached_foods |
| **Barcode Scanning** | CameraView (expo-camera) | nutrition-barcode | cached_foods |
| **AI Photo Recognition** | ImagePicker (expo-image-picker), PhotoResultSlider.tsx | nutrition-image-complete | — |
| **Food Detail/Portions** | FoodSelectionView.tsx, PortionAdjustInput.tsx | nutrition-food | — |
| **Favorites** | FrequentFoodsScreen.tsx, AddToFavoritesView.tsx | favorites-manage | food_favorites |
| **Meal Templates** | MealManager.tsx, MealBuilderScreen.tsx, MealBuilder.tsx, MealBuilderView.tsx | favorites-manage | meal_templates, meal_template_items |
| **Restaurant/Brand Browse** | RestaurantMenuBrowser.tsx, BrandMenuBrowser.tsx | nutrition-search | default_restaurants, default_brands, favorite_restaurants, favorite_brands, hidden_restaurants, hidden_brands |
| **Default Ingredients** | ModeSelector.tsx | — | default_ingredients |
| **Daily Macro Summary** | NutritionPage.tsx (inline) | — | daily_nutrition (auto-trigger) |

### External Dependencies

| Service | Purpose | API Key Location |
|---------|---------|-----------------|
| **FatSecret API** | Food database (search, barcode lookup, nutrition data) | Via proxy at `104.236.49.96:3000` (IP-whitelisted) |
| **Claude Vision API** | AI food identification from photos | `CLAUDE_API_KEY` env var in Supabase |

---

## Migration Feasibility

**Verdict: All features are fully feasible for web. Backend needs zero changes.**

The existing Supabase Edge Functions accept JSON over HTTP and are platform-agnostic. The only mobile-specific code is in the UI layer:

| Mobile Library | Web Replacement | Effort |
|---------------|-----------------|--------|
| `expo-camera` (barcode) | `html5-qrcode` or `@nicholasgasior/zxing-js` | Medium |
| `expo-image-picker` (photo) | `<input type="file" accept="image/*" capture="camera">` | Low |
| React Native `View/Text/TouchableOpacity` | HTML `div/span/button` with wodwisdom CSS | Low (per component) |
| React Native `StyleSheet` | wodwisdom CSS classes (`nutrition-*` prefix) | Low (per component) |
| React Native `Modal` | CSS modal/overlay (wodwisdom pattern) | Low |
| React Native `Alert` | `window.confirm()` or custom toast | Low |
| `@expo/vector-icons` (Ionicons) | `lucide-react` (already in wodwisdom) | Low |
| `expo-router` navigation | React Router (already in wodwisdom) | Low |

---

## Architecture Decisions

### 1. Auth Model Adaptation

The mobile app uses a `users` table with `auth_id` FK to `auth.users`. The wodwisdom web app uses `auth.users.id` directly (no separate `users` table). All Edge Functions currently do:

```ts
const { data: userData } = await supabase.from('users').select('id').eq('auth_id', user.id).single()
```

**Decision**: We need to either:
- **(A)** Adapt the Edge Functions to use `auth.uid()` directly (requires updating 6 functions)
- **(B)** Create the nutrition tables with `user_id uuid` referencing `auth.users(id)` instead of `bigint` referencing `users(id)`

**Recommendation: Option B** — Create tables referencing `auth.users(id)` with uuid user_id, matching wodwisdom's pattern. Then either update the Edge Functions to skip the `users` table lookup, OR deploy new versions alongside the originals.

### 2. Edge Function Strategy

**Option A: Deploy new copies** — Copy the 6 edge functions into wodwisdom's `supabase/functions/`, remove the `users` table lookup, use `auth.uid()` directly. This keeps the mobile and web apps independent.

**Option B: Share edge functions** — Both apps point to the same Supabase project. Functions work for both.

**Recommendation: Option A** — Deploy into wodwisdom's Supabase project so the apps stay decoupled. The functions are small (100-500 lines each) and the only change is the auth pattern.

### 3. Styling Approach

Same as Engine migration: Convert all React Native StyleSheet to wodwisdom CSS classes in `src/nutrition.css`, prefixed with `.nutrition-*`. Use existing CSS variables (`--accent`, `--surface`, `--bg`, `--text`, etc.).

### 4. New npm Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `html5-qrcode` | Barcode scanning via webcam | ~200KB |

That's it. Everything else uses wodwisdom's existing dependencies (React, Supabase, Lucide, etc.).

---

## Phase 1: Database Schema

Create migration files in `supabase/migrations/`:

### Migration 1: `YYYYMMDD000001_nutrition_tables.sql`

Tables to create (adapted from mobile, using `uuid` user_id referencing `auth.users`):

1. **`nutrition_cached_foods`** — Reduce FatSecret API calls
   - `id` uuid PK
   - `fatsecret_id` text UNIQUE NOT NULL
   - `name` text NOT NULL
   - `brand_name` text
   - `food_type` text
   - `nutrition_data` jsonb NOT NULL
   - `last_accessed_at` timestamptz
   - `access_count` int default 0
   - `created_at`, `updated_at` timestamptz

2. **`nutrition_food_entries`** — Individual food log entries
   - `id` uuid PK
   - `user_id` uuid FK → auth.users NOT NULL
   - `food_id` text NOT NULL (FatSecret ID)
   - `cached_food_id` uuid FK → nutrition_cached_foods
   - `food_name` text NOT NULL
   - `serving_id` text NOT NULL
   - `serving_description` text
   - `number_of_units` numeric(6,2) default 1
   - `calories`, `protein`, `carbohydrate`, `fat`, `fiber`, `sugar` numeric
   - `sodium` numeric
   - `meal_type` text (breakfast/lunch/dinner/snack/pre_workout/post_workout/other)
   - `source` text default 'manual' (manual/barcode/photo/template)
   - `notes` text
   - `logged_at` timestamptz NOT NULL default now()
   - `created_at`, `updated_at` timestamptz
   - RLS: users CRUD own rows only

3. **`nutrition_daily_summary`** — Aggregated daily totals (auto-updated by trigger)
   - `id` uuid PK
   - `user_id` uuid FK → auth.users NOT NULL
   - `date` date NOT NULL
   - `total_calories`, `total_protein`, `total_carbohydrate`, `total_fat`, `total_fiber`, `total_sugar`, `total_sodium` numeric
   - UNIQUE(user_id, date)
   - RLS: users read own rows only

4. **`nutrition_food_favorites`** — Saved favorite foods
   - `id` uuid PK
   - `user_id` uuid FK → auth.users NOT NULL
   - `food_id` text NOT NULL
   - `food_name` text NOT NULL
   - `serving_id` text
   - `serving_description` text
   - `is_auto_favorite` boolean default false
   - `log_count` int default 0
   - `last_logged_at` timestamptz
   - UNIQUE(user_id, food_id)
   - RLS: users CRUD own rows

5. **`nutrition_meal_templates`** — Saved meal presets
   - `id` uuid PK
   - `user_id` uuid FK → auth.users NOT NULL
   - `template_name` text NOT NULL
   - `meal_type` text
   - `total_calories`, `total_protein`, `total_carbohydrate`, `total_fat` numeric
   - `log_count` int default 0
   - `last_logged_at` timestamptz
   - UNIQUE(user_id, template_name)
   - RLS: users CRUD own rows

6. **`nutrition_meal_template_items`** — Items within a meal template
   - `id` uuid PK
   - `meal_template_id` uuid FK → nutrition_meal_templates ON DELETE CASCADE
   - `food_id` text NOT NULL
   - `food_name` text NOT NULL
   - `serving_id` text
   - `serving_description` text
   - `number_of_units` numeric(8,2) default 1
   - `calories`, `protein`, `carbohydrate`, `fat`, `fiber`, `sugar`, `sodium` numeric
   - `sort_order` int default 0
   - RLS: via parent template ownership

### Migration 2: `YYYYMMDD000002_nutrition_defaults.sql`

7. **`nutrition_default_ingredients`** — Curated ingredient list for meal builder
8. **`nutrition_default_restaurants`** — Popular restaurant names
9. **`nutrition_default_brands`** — Popular brand names

Plus seed data (same as mobile: 44 ingredients, 25 restaurants, 20 brands).

### Migration 3: `YYYYMMDD000003_nutrition_favorites_extended.sql`

10. **`nutrition_favorite_restaurants`** — User's saved restaurants
11. **`nutrition_favorite_brands`** — User's saved brands
12. **`nutrition_hidden_restaurants`** — User's hidden restaurants
13. **`nutrition_hidden_brands`** — User's hidden brands

### Migration 4: `YYYYMMDD000004_nutrition_triggers.sql`

- Auto-update `nutrition_daily_summary` when food_entries change (INSERT/UPDATE/DELETE)
- Auto-add to favorites after 2 logs in 5 days
- Track cached food access counts
- `updated_at` trigger for all tables

---

## Phase 2: Edge Functions

Deploy 6 Supabase Edge Functions into `wodwisdom/supabase/functions/`:

| Function | Source | Lines | Changes Needed |
|----------|--------|-------|----------------|
| `nutrition-search` | Same | ~230 | Remove `users` table lookup; use `auth.uid()` directly |
| `nutrition-barcode` | Same | ~310 | Same auth change + table name prefix |
| `nutrition-image-complete` | Same | ~540 | Same auth change; consider upgrading Claude model |
| `nutrition-food` | Same | ~210 | Same auth change |
| `food-log` | Same | ~150 | Same auth change + table name prefix |
| `favorites-manage` | Same | ~580 | Same auth change + table name prefix |

**Total: ~2,020 lines** — mostly copy with search-and-replace for auth pattern and table names.

---

## Phase 3: Service Layer

### Create `src/lib/nutritionService.ts`

Port from `fitness-mobile/lib/api/mealTemplates.ts` + `defaultFoodSources.ts` + inline Supabase calls in NutritionPage.tsx.

**Methods to implement:**

| Method | Purpose |
|--------|---------|
| `loadTodayEntries(date?)` | Fetch food_entries for a date |
| `deleteEntry(id)` | Remove a food entry |
| `loadDailySummary(date?)` | Fetch daily nutrition totals |
| `searchFoods(query, filterType?)` | Invoke nutrition-search function |
| `getFoodDetails(foodId)` | Invoke nutrition-food function |
| `scanBarcode(barcode, type?)` | Invoke nutrition-barcode function |
| `recognizePhoto(base64, type?)` | Invoke nutrition-image-complete function |
| `logFood(entry)` | Invoke food-log function |
| `getFavorites()` | Invoke favorites-manage (get_all) |
| `addFavorite(food)` | Invoke favorites-manage (add_food) |
| `removeFavorite(id)` | Invoke favorites-manage (delete_food) |
| `getMealTemplates()` | Query nutrition_meal_templates |
| `getMealTemplateWithItems(id)` | Query with items joined |
| `createMealTemplate(name, items)` | Insert template + items |
| `logMealTemplate(id, mealType)` | Create food_entries from template items |
| `deleteMealTemplate(id)` | Remove template |
| `getDefaultIngredients()` | Query nutrition_default_ingredients |
| `getDefaultRestaurants()` | Query nutrition_default_restaurants |
| `getDefaultBrands()` | Query nutrition_default_brands |

**Estimated: ~400 lines**

---

## Phase 4: CSS Styles

### Create `src/nutrition.css`

Following the Engine pattern — single CSS file with `.nutrition-*` prefixed classes:

**Base classes:**
- `.nutrition-page` — page container
- `.nutrition-card` — surface card
- `.nutrition-summary` — daily macro display (cal/protein/carbs/fat)
- `.nutrition-entry` — food entry row
- `.nutrition-search` — search input + results
- `.nutrition-modal` — fullscreen overlay
- `.nutrition-slider` — portion adjustment slider (from PhotoResultSlider)
- `.nutrition-tabs` — meal type tabs (breakfast/lunch/dinner/snack)
- `.nutrition-badge` — meal type indicator
- `.nutrition-btn` / `.nutrition-btn-primary` — action buttons
- `.nutrition-macro-bar` — macro progress bar
- `.nutrition-photo-result` — AI photo result card with confidence indicators
- `.nutrition-barcode` — camera viewfinder overlay

**Estimated: ~200 lines**

---

## Phase 5: Components (Port Order)

### 5a. Nutrition Page (`src/pages/NutritionPage.tsx`) — Main hub

Port from `fitness-mobile/components/nutrition/NutritionPage.tsx` (~1,500 lines).

**Sections:**
1. **Daily Summary** — Calories + protein/carbs/fat totals for today
2. **Today's Entries** — List of logged foods grouped by meal type
3. **Quick Actions** — Buttons: Search Food, Scan Barcode, Take Photo, Meal Builder
4. **Favorites** — Quick-access favorite foods
5. **Meal Templates** — Saved meals for one-tap logging
6. **Date Navigation** — Browse previous days

**Key adaptations:**
- Replace `expo-camera` CameraView with `html5-qrcode` scanner component
- Replace `expo-image-picker` with `<input type="file" accept="image/*">`
- Replace React Native `Modal` with CSS overlay
- Replace `Alert.alert()` with `window.confirm()` or inline toast
- Replace Ionicons with Lucide React icons
- Remove `SafeAreaView`, `useFocusEffect`, `useLocalSearchParams` (Expo-specific)

### 5b. Food Search Component (`src/components/nutrition/FoodSearch.tsx`)

Port from `FoodSearchView.tsx` (335 lines). Straightforward — search input + results list. Replace RN TextInput/TouchableOpacity with HTML input/button.

### 5c. Food Selection/Detail (`src/components/nutrition/FoodSelection.tsx`)

Port from `FoodSelectionView.tsx`. Shows food nutrition details, serving selector, portion adjustment. Replace RN slider with HTML range input.

### 5d. Barcode Scanner (`src/components/nutrition/BarcodeScanner.tsx`)

**New component** using `html5-qrcode`:
- Request camera permission via `getUserMedia`
- Show viewfinder with barcode overlay
- On scan → call `nutrition-barcode` edge function
- Display result or "not found" message
- HTTPS required in production

### 5e. Photo Recognition (`src/components/nutrition/PhotoCapture.tsx`)

Port from NutritionPage photo logic:
- `<input type="file" accept="image/*" capture="camera">` for mobile browsers (opens camera)
- `FileReader.readAsDataURL()` for base64 conversion
- Call `nutrition-image-complete` edge function
- Show loading state during AI processing

### 5f. Photo Result Slider (`src/components/nutrition/PhotoResultSlider.tsx`)

Port from `PhotoResultSlider.tsx` (850 lines). Portion adjustment UI after AI identifies food:
- Food cards with confidence indicators (high/medium/low)
- Portion size slider (oz/g toggle)
- Live calorie/macro updates
- Retake / Cancel / Log Meal actions
- Tap food name to search for replacement

### 5g. Meal Builder (`src/components/nutrition/MealBuilder.tsx`)

Port from `MealBuilder.tsx` + `MealBuilderScreen.tsx` + `MealBuilderView.tsx`:
- Pick ingredients from defaults (protein/carb/vegetable/fat categories)
- Browse restaurants or brands
- Search within a restaurant/brand menu
- Assemble meal with multiple items
- Save as template or log immediately

### 5h. Favorites & Frequent Foods (`src/components/nutrition/Favorites.tsx`)

Port from `FrequentFoodsScreen.tsx` + `AddToFavoritesView.tsx`:
- Show favorite foods sorted by usage
- One-tap re-log a favorite
- Add/remove favorites
- Auto-favorites (foods logged 2+ times in 5 days)

### 5i. Meal Templates Manager (`src/components/nutrition/MealTemplates.tsx`)

Port from `MealManager.tsx`:
- List saved templates with totals
- One-tap log all items in a template
- Edit/delete templates
- Create new templates from current meal

---

## Phase 6: Routing & Navigation

### Add routes to `src/App.tsx`:

```tsx
<Route path="/nutrition" element={<NutritionPage session={session} />} />
```

The NutritionPage will handle all sub-views internally (search, barcode, photo, meal builder) using component state — same as the mobile app pattern (swap-out screens, not separate routes).

### Add to navigation sidebar (`Nav.tsx`):

- "Nutrition" nav item with Apple icon (Lucide `Apple`) under a new "Nutrition" nav group
- Conditionally show based on entitlement (if behind paywall) or always visible

---

## Phase 7: Entitlements

**Decision needed**: Is nutrition a free feature or behind the paywall?

Options:
- **Free for all users** — No entitlement check needed
- **Part of existing subscription** — Add `nutrition` to entitlement check
- **Separate nutrition plan** — New Stripe price + entitlement

---

## Implementation Order

| Step | What | Est. Lines | Dependencies | Priority |
|------|------|-----------|-------------|----------|
| 1 | Database migrations (4 files) | ~500 | None | P0 |
| 2 | Edge Functions (6 functions) | ~2,000 | Step 1 | P0 |
| 3 | `nutritionService.ts` | ~400 | Step 1 | P0 |
| 4 | `nutrition.css` | ~200 | None | P0 |
| 5 | Food Search component | ~200 | Step 3 | P0 |
| 6 | Food Selection/Detail component | ~300 | Step 5 | P0 |
| 7 | NutritionPage (main hub + daily log) | ~600 | Steps 3-6 | P0 |
| 8 | Routing + Nav entry | ~20 | Step 7 | P0 |
| 9 | Barcode Scanner component | ~200 | Steps 3, 7 | P1 |
| 10 | Photo Capture + PhotoResultSlider | ~500 | Steps 3, 7 | P1 |
| 11 | Meal Builder + Defaults | ~400 | Steps 3, 7 | P1 |
| 12 | Favorites/Frequent Foods | ~250 | Steps 3, 7 | P1 |
| 13 | Meal Templates Manager | ~300 | Steps 3, 7 | P2 |
| 14 | Restaurant/Brand Browser | ~300 | Steps 3, 11 | P2 |

**Critical path**: Steps 1→3→5→6→7→8 (schema → service → search → selection → main page → routing)

**Total estimated new code**: ~5,200 lines (frontend) + ~2,000 lines (edge functions) + ~500 lines (SQL)

---

## Key Differences from Mobile

| Aspect | Mobile (Expo) | Web (wodwisdom) |
|--------|--------------|-----------------|
| Barcode scanning | `expo-camera` native | `html5-qrcode` WebRTC |
| Photo capture | `expo-image-picker` | `<input type="file" accept="image/*">` |
| Navigation | React Navigation + modals | React Router + CSS overlays |
| Styling | RN StyleSheet | CSS classes (`.nutrition-*`) |
| Icons | Ionicons (`@expo/vector-icons`) | Lucide React |
| Alerts | `Alert.alert()` | `window.confirm()` or toast |
| Auth | `users.auth_id` → `users.id` | `auth.users.id` directly |
| State | Same (React hooks) | Same (React hooks) |
| Supabase client | Same (`@supabase/supabase-js`) | Same |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Barcode scanner quality on web | Medium | Low | html5-qrcode is mature; fallback to manual barcode entry |
| Camera permission denied | Medium | Low | Graceful fallback to file picker; clear permission prompt |
| FatSecret API proxy (shared IP) | Low | High | Same proxy serves both apps; no additional load concern |
| Large NutritionPage component | Low | Medium | Break into subcomponents early (already planned) |
| Claude Vision API cost | Low | Medium | Same usage pattern as mobile; consider rate limiting |

---

## Open Questions

1. **Entitlements** — Is nutrition free, part of existing subscription, or a separate plan?
2. **Shared Supabase project** — Are wodwisdom and crossfit-training-app on the same Supabase project, or separate? This affects whether we can share the Edge Functions and FatSecret proxy.
3. **Data migration** — Do existing mobile users need their nutrition data available on web? If so, we need to handle the `users.id` (bigint) → `auth.users.id` (uuid) mapping.
