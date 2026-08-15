-- Engine goal — the athlete's stated conditioning objective ("row a 10k
-- under 40:00", "sub-20 5k"). Optional, free text, 500-char cap enforced
-- client-side.
--
-- Deliberately separate from the Tier-3 `goal` column: engine-only athletes
-- cannot reach Tier 3 (locked behind the programming tier), and a conditioning
-- goal is a different question from a programming goal — an all-access athlete
-- may legitimately hold both.
--
-- Consumers: the Engine self-sequencer (run-resequence) weighs day-type and
-- intensity choices toward it, under the precedence rule "the program's intent
-- is the frame; the athlete's goal refines within it"; the chat athlete card
-- carries it so the AI Coach knows what the athlete is chasing. NULL/blank =
-- both consumers behave exactly as before the column existed.

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS engine_goal text;

COMMENT ON COLUMN athlete_profiles.engine_goal IS
  'Athlete-stated conditioning objective for the Engine (optional free text). Read by the self-sequencer and the chat athlete card; null means unset and changes nothing.';
