-- Competition workout results — lock down client inserts (Phase 2 step 5).
--
-- Throwbacks are now written exclusively by the log-throwback edge function,
-- which (a) enforces the competition_log paid gate via hasCompetitionLogAccess
-- and (b) computes + stores the power columns. It writes with the service
-- role, so it bypasses RLS.
--
-- The original "insert own" policy let ANY authenticated user insert a row
-- directly via the client — RLS only checked auth.uid() = user_id, with no
-- paid gate. Dropping it closes that paywall bypass: the edge function becomes
-- the sole insert path.
--
-- The select / update / delete "own" policies are kept — a user reading or
-- managing their own existing rows is fine, and neither is a paywall bypass
-- (you can't update or delete a row you were never able to insert).

DROP POLICY IF EXISTS "insert own" ON public.competition_workout_results;
