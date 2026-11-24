-- A fresh evaluation when Programming access is granted (2026-11-24).
--
-- Every athlete gets ONE evaluation credit. Someone who spent it as a free
-- user — often on a profile filled in quickly — and later pays for
-- Programming could not run another before their first build, so their first
-- program was built from the old evaluation.
--
-- Rule (founder, 2026-11-24): when Programming access is granted and the
-- athlete has no program yet, their evaluation count is SET TO ONE. Used it:
-- they get one back. Never used it: they still have one, never two. It is one
-- evaluation, not unlimited — evaluations are costly.
--
-- Done as a trigger on user_entitlements so every route that grants access is
-- covered by one rule: a new subscription, an upgrade to All Access, an
-- admin grant, a claimed pending subscription, a wholesale grant. A renewal
-- inserts no row (the payment handler leaves existing rows untouched), so it
-- never fires on a renewal.
--
-- An athlete who already has a live program is left alone: their evaluations
-- run automatically with each new month.
--
-- Safe to run twice.

CREATE OR REPLACE FUNCTION reset_evaluation_on_programming_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM programs
    WHERE user_id = NEW.user_id
      AND source = 'generated'
      AND archived_at IS NULL
  ) THEN
    UPDATE athlete_profiles
    SET eval_credits_remaining = GREATEST(COALESCE(eval_credits_remaining, 0), 1)
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_evaluation_on_programming_grant ON user_entitlements;
CREATE TRIGGER trg_reset_evaluation_on_programming_grant
  AFTER INSERT ON user_entitlements
  FOR EACH ROW
  WHEN (NEW.feature = 'programming')
  EXECUTE FUNCTION reset_evaluation_on_programming_grant();
