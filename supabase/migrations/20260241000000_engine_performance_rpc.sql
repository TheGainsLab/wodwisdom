-- RPC function to update engine performance metrics after a workout session.
-- Maintains a rolling average of the last 4 performance ratios per (user, day_type, modality).
-- Updates learned_max_pace when a new actual_pace exceeds the current max.

CREATE OR REPLACE FUNCTION update_engine_performance_metrics(
  p_user_id uuid,
  p_day_type text,
  p_modality text,
  p_performance_ratio numeric,
  p_actual_pace numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing record;
  v_ratios jsonb;
  v_new_avg numeric;
  v_new_count integer;
  v_new_max numeric;
BEGIN
  -- Get existing metrics row if any
  SELECT * INTO v_existing
  FROM engine_user_performance_metrics
  WHERE user_id = p_user_id
    AND day_type = p_day_type
    AND modality = p_modality;

  IF v_existing IS NULL THEN
    -- First session for this combination: insert new row
    INSERT INTO engine_user_performance_metrics (
      user_id, day_type, modality,
      learned_max_pace, rolling_avg_ratio, rolling_count, last_4_ratios
    ) VALUES (
      p_user_id, p_day_type, p_modality,
      p_actual_pace,
      p_performance_ratio,
      1,
      jsonb_build_array(p_performance_ratio)
    );
  ELSE
    -- Append to last_4_ratios, keeping only the most recent 4
    v_ratios := v_existing.last_4_ratios || to_jsonb(p_performance_ratio);
    IF jsonb_array_length(v_ratios) > 4 THEN
      v_ratios := (
        SELECT jsonb_agg(elem)
        FROM (
          SELECT elem
          FROM jsonb_array_elements(v_ratios) WITH ORDINALITY AS t(elem, ord)
          ORDER BY ord DESC
          LIMIT 4
        ) sub
      );
      -- Re-order ascending by original position
      v_ratios := (
        SELECT jsonb_agg(elem)
        FROM (
          SELECT elem
          FROM jsonb_array_elements(v_ratios) WITH ORDINALITY AS t(elem, ord)
          ORDER BY ord DESC
        ) sub
      );
    END IF;

    -- Calculate new rolling average from the ratios array
    SELECT AVG(elem::numeric) INTO v_new_avg
    FROM jsonb_array_elements_text(v_ratios) AS elem;

    v_new_count := jsonb_array_length(v_ratios);

    -- Update learned_max_pace if this session exceeded it
    v_new_max := GREATEST(COALESCE(v_existing.learned_max_pace, 0), p_actual_pace);

    UPDATE engine_user_performance_metrics
    SET learned_max_pace = v_new_max,
        rolling_avg_ratio = v_new_avg,
        rolling_count = v_new_count,
        last_4_ratios = v_ratios
    WHERE user_id = p_user_id
      AND day_type = p_day_type
      AND modality = p_modality;
  END IF;
END;
$$;
