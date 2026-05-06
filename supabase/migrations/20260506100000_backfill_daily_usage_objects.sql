-- Step 0 of timezone fix: bring the prod-only daily_usage objects into
-- version control with NO logic changes.
--
-- These objects (table + RPCs) currently live only in the prod database;
-- they were never committed as a migration. This file recreates them
-- exactly as they exist in prod so future schema resets don't lose them
-- and so subsequent migrations can modify them safely.
--
-- The known timezone bug (current_date evaluated in UTC) is intentionally
-- preserved here. It will be fixed in a later step once profiles.timezone
-- exists.

CREATE TABLE IF NOT EXISTS public.daily_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  date date DEFAULT CURRENT_DATE,
  question_count integer DEFAULT 0,
  total_input_tokens integer DEFAULT 0,
  total_output_tokens integer DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_usage_user_id_date_key
  ON public.daily_usage (user_id, date);

CREATE OR REPLACE FUNCTION public.get_daily_usage(check_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(question_count, 0)
  FROM public.daily_usage
  WHERE user_id = check_user_id
    AND date = current_date;
$function$;

CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id uuid,
  p_input_tokens integer DEFAULT 0,
  p_output_tokens integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.daily_usage (user_id, date, question_count, total_input_tokens, total_output_tokens)
  VALUES (p_user_id, current_date, 1, p_input_tokens, p_output_tokens)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    question_count = daily_usage.question_count + 1,
    total_input_tokens = daily_usage.total_input_tokens + p_input_tokens,
    total_output_tokens = daily_usage.total_output_tokens + p_output_tokens;
END;
$function$;
