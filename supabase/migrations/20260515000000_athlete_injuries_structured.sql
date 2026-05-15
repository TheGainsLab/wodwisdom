-- Structured form of the free-text injuries_constraints field.
--
-- The v2 writer + safety review need a machine-readable list of movements
-- to avoid. Today they parse the prose every retry — inconsistent and
-- inefficient. The parse-injuries-constraints edge function takes the
-- text, calls Claude with a focused tool_use, and writes the result here.
-- Once parsed, the writer reads the structured list directly; safety
-- review uses it as the canonical filter.
--
-- The hash column lets the parser detect staleness — if the text changes,
-- the hash diverges and the next save triggers a re-parse.

ALTER TABLE athlete_profiles
  ADD COLUMN IF NOT EXISTS injuries_structured jsonb,
  ADD COLUMN IF NOT EXISTS injuries_constraints_hash text;

COMMENT ON COLUMN athlete_profiles.injuries_structured IS
  'Structured form of injuries_constraints text. Shape: { summary: text, do_not_program: text[], suggested_subs: [{instead_of, use}] }. Null when never parsed or text is empty.';

COMMENT ON COLUMN athlete_profiles.injuries_constraints_hash IS
  'SHA-256 hex of the injuries_constraints text that injuries_structured was parsed against. Used to detect staleness when the text changes.';
