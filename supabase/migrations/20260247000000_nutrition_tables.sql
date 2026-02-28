-- Nutrition tracking tables
-- Migrated from crossfit-training-app with uuid user_id matching wodwisdom's auth pattern

-- ============================================
-- UTILITY FUNCTION
-- ============================================

-- Generic updated_at trigger function (reusable across tables)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ENUM
-- ============================================

CREATE TYPE meal_type_enum AS ENUM (
  'breakfast', 'lunch', 'dinner', 'snack', 'other',
  'pre_workout', 'post_workout'
);

-- ============================================
-- 1. CACHED FOODS (shared cache, not per-user)
-- ============================================

CREATE TABLE cached_foods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fatsecret_id text UNIQUE NOT NULL,
  name text NOT NULL,
  brand_name text,
  food_type text,
  nutrition_data jsonb NOT NULL,
  last_accessed_at timestamptz DEFAULT now(),
  access_count int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cached_foods_fatsecret_id ON cached_foods(fatsecret_id);
CREATE INDEX idx_cached_foods_name_search ON cached_foods USING gin(to_tsvector('english', name));
CREATE INDEX idx_cached_foods_last_accessed ON cached_foods(last_accessed_at DESC);

CREATE TRIGGER trg_cached_foods_updated_at
  BEFORE UPDATE ON cached_foods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Edge Functions use service_role for cache writes; no user-scoped RLS needed
-- but enable RLS so reads require at least authenticated
ALTER TABLE cached_foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cached foods" ON cached_foods
  FOR SELECT TO authenticated USING (true);

-- ============================================
-- 2. FOOD ENTRIES (individual food log entries)
-- ============================================

CREATE TABLE food_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id text NOT NULL,
  cached_food_id uuid REFERENCES cached_foods(id) ON DELETE SET NULL,
  food_name text NOT NULL,
  serving_id text NOT NULL,
  serving_description text,
  number_of_units numeric(6,2) NOT NULL DEFAULT 1,
  calories numeric(8,2),
  protein numeric(6,2),
  carbohydrate numeric(6,2),
  fat numeric(6,2),
  fiber numeric(6,2),
  sugar numeric(6,2),
  sodium numeric(8,2),
  meal_type meal_type_enum,
  notes text,
  logged_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_positive_nutrition CHECK (
    calories >= 0 AND
    protein >= 0 AND
    carbohydrate >= 0 AND
    fat >= 0 AND
    number_of_units > 0
  )
);

CREATE INDEX idx_food_entries_user_id ON food_entries(user_id);
CREATE INDEX idx_food_entries_logged_at ON food_entries(user_id, logged_at DESC);
CREATE INDEX idx_food_entries_cached_food ON food_entries(cached_food_id) WHERE cached_food_id IS NOT NULL;

CREATE TRIGGER trg_food_entries_updated_at
  BEFORE UPDATE ON food_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE food_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own food entries" ON food_entries
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own food entries" ON food_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own food entries" ON food_entries
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own food entries" ON food_entries
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 3. DAILY NUTRITION (aggregated daily totals)
-- ============================================

CREATE TABLE daily_nutrition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  total_calories numeric(8,2) DEFAULT 0,
  total_protein numeric(6,2) DEFAULT 0,
  total_carbohydrate numeric(6,2) DEFAULT 0,
  total_fat numeric(6,2) DEFAULT 0,
  total_fiber numeric(6,2) DEFAULT 0,
  total_sugar numeric(6,2) DEFAULT 0,
  total_sodium numeric(8,2) DEFAULT 0,
  tdee_estimate numeric(8,2),
  bmr_estimate numeric(8,2),
  surplus_deficit numeric(8,2),
  exercise_calories_burned numeric(8,2) DEFAULT 0,
  adjusted_tdee numeric(8,2),
  net_calories numeric(8,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_nutrition_user_id ON daily_nutrition(user_id);
CREATE INDEX idx_daily_nutrition_date ON daily_nutrition(user_id, date DESC);

CREATE TRIGGER trg_daily_nutrition_updated_at
  BEFORE UPDATE ON daily_nutrition
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE daily_nutrition ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own daily nutrition" ON daily_nutrition
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own daily nutrition" ON daily_nutrition
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own daily nutrition" ON daily_nutrition
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own daily nutrition" ON daily_nutrition
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 4. FOOD FAVORITES
-- ============================================

CREATE TABLE food_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id text NOT NULL,
  food_name text NOT NULL,
  food_type text DEFAULT 'generic',
  brand_name text,
  serving_id text,
  serving_description text,
  default_amount numeric(8,2) DEFAULT 1,
  default_unit text DEFAULT 'serving',
  calories_per_gram numeric(8,4),
  protein_per_gram numeric(8,4),
  carbs_per_gram numeric(8,4),
  fat_per_gram numeric(8,4),
  fiber_per_gram numeric(8,4),
  sodium_per_gram numeric(8,4),
  raw_serving_calories numeric(8,2),
  raw_serving_protein numeric(6,2),
  raw_serving_carbs numeric(6,2),
  raw_serving_fat numeric(6,2),
  is_auto_favorite boolean NOT NULL DEFAULT false,
  log_count int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, food_id)
);

CREATE INDEX idx_food_favorites_user_id ON food_favorites(user_id);
CREATE INDEX idx_food_favorites_user_created ON food_favorites(user_id, created_at DESC);
CREATE INDEX idx_food_favorites_auto ON food_favorites(user_id, is_auto_favorite) WHERE is_auto_favorite = true;

CREATE TRIGGER trg_food_favorites_updated_at
  BEFORE UPDATE ON food_favorites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE food_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own food favorites" ON food_favorites
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own food favorites" ON food_favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own food favorites" ON food_favorites
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own food favorites" ON food_favorites
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 5. FAVORITE / HIDDEN RESTAURANTS & BRANDS
-- ============================================

CREATE TABLE favorite_restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_name text NOT NULL,
  fatsecret_brand_filter text,
  last_accessed_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_favorite_restaurants_user ON favorite_restaurants(user_id);

ALTER TABLE favorite_restaurants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own favorite restaurants" ON favorite_restaurants
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own favorite restaurants" ON favorite_restaurants
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own favorite restaurants" ON favorite_restaurants
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE hidden_restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, restaurant_name)
);

CREATE INDEX idx_hidden_restaurants_user ON hidden_restaurants(user_id);

ALTER TABLE hidden_restaurants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own hidden restaurants" ON hidden_restaurants
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own hidden restaurants" ON hidden_restaurants
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own hidden restaurants" ON hidden_restaurants
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE favorite_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  fatsecret_brand_filter text,
  last_accessed_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_favorite_brands_user ON favorite_brands(user_id);

ALTER TABLE favorite_brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own favorite brands" ON favorite_brands
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own favorite brands" ON favorite_brands
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own favorite brands" ON favorite_brands
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE hidden_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, brand_name)
);

CREATE INDEX idx_hidden_brands_user ON hidden_brands(user_id);

ALTER TABLE hidden_brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own hidden brands" ON hidden_brands
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own hidden brands" ON hidden_brands
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own hidden brands" ON hidden_brands
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 6. MEAL TEMPLATES
-- ============================================

CREATE TABLE meal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  meal_type meal_type_enum,
  total_calories numeric(8,2) DEFAULT 0,
  total_protein numeric(6,2) DEFAULT 0,
  total_carbohydrate numeric(6,2) DEFAULT 0,
  total_fat numeric(6,2) DEFAULT 0,
  total_fiber numeric(6,2) DEFAULT 0,
  total_sugar numeric(6,2) DEFAULT 0,
  total_sodium numeric(8,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_logged_at timestamptz,
  log_count int DEFAULT 0,
  UNIQUE(user_id, template_name)
);

CREATE INDEX idx_meal_templates_user_id ON meal_templates(user_id);
CREATE INDEX idx_meal_templates_meal_type ON meal_templates(user_id, meal_type);
CREATE INDEX idx_meal_templates_last_logged ON meal_templates(user_id, last_logged_at DESC);

CREATE TRIGGER trg_meal_templates_updated_at
  BEFORE UPDATE ON meal_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE meal_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own meal templates" ON meal_templates
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own meal templates" ON meal_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own meal templates" ON meal_templates
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own meal templates" ON meal_templates
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE meal_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_template_id uuid NOT NULL REFERENCES meal_templates(id) ON DELETE CASCADE,
  food_id text NOT NULL,
  food_name text NOT NULL,
  serving_id text,
  serving_description text,
  number_of_units numeric(8,2) NOT NULL DEFAULT 1,
  calories numeric(8,2) DEFAULT 0,
  protein numeric(6,2) DEFAULT 0,
  carbohydrate numeric(6,2) DEFAULT 0,
  fat numeric(6,2) DEFAULT 0,
  fiber numeric(6,2) DEFAULT 0,
  sugar numeric(6,2) DEFAULT 0,
  sodium numeric(8,2) DEFAULT 0,
  sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_meal_template_items_template ON meal_template_items(meal_template_id, sort_order);
CREATE INDEX idx_meal_template_items_food_id ON meal_template_items(food_id);

ALTER TABLE meal_template_items ENABLE ROW LEVEL SECURITY;

-- RLS via parent table ownership
CREATE POLICY "Users can select own template items" ON meal_template_items
  FOR SELECT USING (
    meal_template_id IN (SELECT id FROM meal_templates WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can insert own template items" ON meal_template_items
  FOR INSERT WITH CHECK (
    meal_template_id IN (SELECT id FROM meal_templates WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can update own template items" ON meal_template_items
  FOR UPDATE USING (
    meal_template_id IN (SELECT id FROM meal_templates WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can delete own template items" ON meal_template_items
  FOR DELETE USING (
    meal_template_id IN (SELECT id FROM meal_templates WHERE user_id = auth.uid())
  );

-- ============================================
-- 7. DEFAULT LOOKUP TABLES (admin-managed)
-- ============================================

CREATE TABLE default_ingredients (
  id serial PRIMARY KEY,
  name text NOT NULL,
  emoji text,
  search_term text NOT NULL,
  category text NOT NULL,
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  usage_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_default_ingredients_active ON default_ingredients(is_active) WHERE is_active = true;
CREATE INDEX idx_default_ingredients_category ON default_ingredients(category);

ALTER TABLE default_ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read default ingredients" ON default_ingredients
  FOR SELECT USING (true);

CREATE TABLE default_restaurants (
  id serial PRIMARY KEY,
  name text NOT NULL,
  emoji text,
  fatsecret_name text NOT NULL,
  aliases text[],
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  usage_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_default_restaurants_active ON default_restaurants(is_active) WHERE is_active = true;

ALTER TABLE default_restaurants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read default restaurants" ON default_restaurants
  FOR SELECT USING (true);

CREATE TABLE default_brands (
  id serial PRIMARY KEY,
  name text NOT NULL,
  emoji text,
  fatsecret_name text NOT NULL,
  aliases text[],
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  usage_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_default_brands_active ON default_brands(is_active) WHERE is_active = true;

ALTER TABLE default_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read default brands" ON default_brands
  FOR SELECT USING (true);

-- ============================================
-- 8. TRIGGER FUNCTIONS
-- ============================================

-- Track cache hits when food entries reference cached foods
CREATE OR REPLACE FUNCTION update_cached_food_access()
RETURNS trigger AS $$
BEGIN
  UPDATE cached_foods
  SET last_accessed_at = now(),
      access_count = access_count + 1
  WHERE id = NEW.cached_food_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_food_entries_cache_access
  AFTER INSERT ON food_entries
  FOR EACH ROW
  WHEN (NEW.cached_food_id IS NOT NULL)
  EXECUTE FUNCTION update_cached_food_access();

-- Auto-recalculate daily_nutrition when food_entries change
CREATE OR REPLACE FUNCTION update_daily_nutrition()
RETURNS trigger AS $$
DECLARE
  entry_date date;
  target_user_id uuid;
BEGIN
  IF tg_op = 'DELETE' THEN
    entry_date := date(OLD.logged_at);
    target_user_id := OLD.user_id;
  ELSE
    entry_date := date(NEW.logged_at);
    target_user_id := NEW.user_id;
  END IF;

  IF tg_op = 'INSERT' THEN
    INSERT INTO daily_nutrition (user_id, date)
    VALUES (target_user_id, entry_date)
    ON CONFLICT (user_id, date) DO NOTHING;
  END IF;

  UPDATE daily_nutrition
  SET
    total_calories = (
      SELECT coalesce(sum(calories), 0) FROM food_entries
      WHERE user_id = target_user_id AND date(logged_at) = entry_date
    ),
    total_protein = (
      SELECT coalesce(sum(protein), 0) FROM food_entries
      WHERE user_id = target_user_id AND date(logged_at) = entry_date
    ),
    total_carbohydrate = (
      SELECT coalesce(sum(carbohydrate), 0) FROM food_entries
      WHERE user_id = target_user_id AND date(logged_at) = entry_date
    ),
    total_fat = (
      SELECT coalesce(sum(fat), 0) FROM food_entries
      WHERE user_id = target_user_id AND date(logged_at) = entry_date
    ),
    total_fiber = (
      SELECT coalesce(sum(fiber), 0) FROM food_entries
      WHERE user_id = target_user_id AND date(logged_at) = entry_date
    ),
    total_sugar = (
      SELECT coalesce(sum(sugar), 0) FROM food_entries
      WHERE user_id = target_user_id AND date(logged_at) = entry_date
    ),
    total_sodium = (
      SELECT coalesce(sum(sodium), 0) FROM food_entries
      WHERE user_id = target_user_id AND date(logged_at) = entry_date
    ),
    updated_at = now()
  WHERE user_id = target_user_id AND date = entry_date;

  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_food_entries_update_daily
  AFTER INSERT OR UPDATE OR DELETE ON food_entries
  FOR EACH ROW EXECUTE FUNCTION update_daily_nutrition();

-- Auto-add food to favorites when logged 2+ times in 5 days
CREATE OR REPLACE FUNCTION auto_add_food_favorite()
RETURNS trigger AS $$
DECLARE
  recent_count int;
BEGIN
  SELECT count(*) INTO recent_count
  FROM food_entries
  WHERE user_id = NEW.user_id
    AND food_id = NEW.food_id
    AND logged_at >= now() - interval '5 days';

  IF recent_count >= 2 THEN
    INSERT INTO food_favorites (
      user_id, food_id, food_name, serving_id, serving_description, is_auto_favorite
    )
    VALUES (
      NEW.user_id, NEW.food_id, NEW.food_name, NEW.serving_id, NEW.serving_description, true
    )
    ON CONFLICT (user_id, food_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_food_entries_auto_favorite
  AFTER INSERT ON food_entries
  FOR EACH ROW EXECUTE FUNCTION auto_add_food_favorite();
