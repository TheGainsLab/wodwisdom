-- Add TDEE override column to athlete_profiles
ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS tdee_override numeric;

COMMENT ON COLUMN athlete_profiles.tdee_override IS 'User-provided TDEE override. When set, this value is used instead of the calculated TDEE.';

-- Update the daily_nutrition trigger to compute BMR, TDEE, and surplus/deficit
-- by reading from the athlete_profiles table.
CREATE OR REPLACE FUNCTION update_daily_nutrition()
RETURNS trigger AS $$
DECLARE
  entry_date date;
  target_user_id uuid;
  v_bodyweight numeric;
  v_height numeric;
  v_age numeric;
  v_gender text;
  v_units text;
  v_tdee_override numeric;
  v_bmr numeric;
  v_tdee numeric;
  v_weight_kg numeric;
  v_height_cm numeric;
  v_total_cal numeric;
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

  -- Fetch athlete profile for BMR/TDEE calculation
  SELECT bodyweight, height, age, gender, units, tdee_override
  INTO v_bodyweight, v_height, v_age, v_gender, v_units, v_tdee_override
  FROM athlete_profiles
  WHERE user_id = target_user_id;

  -- Calculate BMR using Mifflin-St Jeor if we have all required fields
  v_bmr := NULL;
  v_tdee := NULL;

  IF v_bodyweight IS NOT NULL AND v_height IS NOT NULL AND v_age IS NOT NULL AND v_gender IS NOT NULL THEN
    -- Convert to metric if needed
    IF v_units = 'lbs' THEN
      v_weight_kg := v_bodyweight * 0.453592;
      v_height_cm := v_height * 2.54;
    ELSE
      v_weight_kg := v_bodyweight;
      v_height_cm := v_height;
    END IF;

    -- Mifflin-St Jeor formula
    IF v_gender = 'male' THEN
      v_bmr := (10 * v_weight_kg) + (6.25 * v_height_cm) - (5 * v_age) + 5;
    ELSE
      v_bmr := (10 * v_weight_kg) + (6.25 * v_height_cm) - (5 * v_age) - 161;
    END IF;

    -- TDEE = BMR * 1.6 (active multiplier), unless user has an override
    IF v_tdee_override IS NOT NULL THEN
      v_tdee := v_tdee_override;
    ELSE
      v_tdee := ROUND(v_bmr * 1.6);
    END IF;

    v_bmr := ROUND(v_bmr);
  END IF;

  -- If user has a TDEE override but no full profile, still use it
  IF v_tdee IS NULL AND v_tdee_override IS NOT NULL THEN
    v_tdee := v_tdee_override;
  END IF;

  -- Calculate total calories for surplus/deficit
  SELECT coalesce(sum(calories), 0) INTO v_total_cal
  FROM food_entries
  WHERE user_id = target_user_id AND date(logged_at) = entry_date;

  UPDATE daily_nutrition
  SET
    total_calories = v_total_cal,
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
    bmr_estimate = v_bmr,
    tdee_estimate = v_tdee,
    surplus_deficit = CASE WHEN v_tdee IS NOT NULL THEN v_total_cal - v_tdee ELSE NULL END,
    updated_at = now()
  WHERE user_id = target_user_id AND date = entry_date;

  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
