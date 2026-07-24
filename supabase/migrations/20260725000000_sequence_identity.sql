-- SEQUENCE IDENTITY — position identity moves from catalog day numbers to
-- program-sequence positions, everywhere.
--
-- Background (July '26): engine_current_day, sessions' program_day_number,
-- override "sequence_position" values, and the /engine/training/:day route all
-- stored CATALOG day numbers, while a program's day order is its mapping's
-- program_sequence_order. The two spaces coincide only for plain main_5day;
-- every other program (subsets, varied reorders, vo2max/hyrox repeats) broke:
-- stranded pointers, wrong-day chat dossiers, un-varied varied programs, and
-- repeat-day ambiguity (one vo2max catalog day appears at 7 sequence
-- positions — catalog identity literally cannot address them).
--
-- After this migration + the paired app deploy:
--   engine_current_day            = the athlete's SEQUENCE position (1..N)
--   sessions.sequence_position    = the position a session was trained at
--   sessions.program_day_number   = unchanged (catalog content reference,
--                                   historical record)
--   overrides.sequence_position   = true sequence positions
--
-- DEPLOY ORDER: run this migration FIRST, then deploy functions + frontend.
-- The chat function reads the pointer as a sequence from its next deploy.

-- 1) Sessions: record the position trained. Backfill = earliest occurrence of
--    the session's catalog day in its program (exact for repeat-free programs;
--    for repeats it matches what the old catalog-keyed system credited).
--    Out-of-program sessions (trained on stranded-pointer days) stay NULL —
--    they have no position in the program.
ALTER TABLE engine_workout_sessions ADD COLUMN IF NOT EXISTS sequence_position integer;

WITH earliest AS (
  SELECT engine_program_id, engine_workout_day_number,
         MIN(program_sequence_order) AS seq
  FROM engine_program_mapping
  GROUP BY 1, 2
)
UPDATE engine_workout_sessions s
SET sequence_position = e.seq
FROM earliest e
WHERE s.sequence_position IS NULL
  AND s.program_version = e.engine_program_id
  AND s.program_day_number = e.engine_workout_day_number;

COMMENT ON COLUMN engine_workout_sessions.sequence_position IS
  'Program-sequence position this session was trained at (1..N in program order). NULL = trained outside the program''s mapping (stranded-pointer era) or program has no mapping.';

-- 2) Overrides: the column was NAMED sequence_position but the sequencer wrote
--    catalog day numbers into it. Convert (earliest occurrence; identity for
--    main_5day, where all current rows live).
WITH earliest AS (
  SELECT engine_program_id, engine_workout_day_number,
         MIN(program_sequence_order) AS seq
  FROM engine_program_mapping
  GROUP BY 1, 2
)
UPDATE engine_user_day_overrides o
SET sequence_position = e.seq
FROM earliest e
WHERE o.program_version = e.engine_program_id
  AND o.sequence_position = e.engine_workout_day_number
  AND o.sequence_position <> e.seq;

-- 3) Pointer conversion: engine_current_day catalog -> sequence.
--
--    Accounts WITH out-of-program completions (the stranded-pointer victims,
--    e.g. coachtravisscott's 12 off-program sessions): placement = furthest
--    in-program completed sequence + 1 (Option B — preserves their sense of
--    progress; skipped early positions stay as ordinary gaps). Clamped to the
--    program's last position; 1 if they have no in-program completions.
--
--    All other accounts: the sequence of their current (healed, valid) catalog
--    pointer — preserving every placement decision already made. Fallback to
--    furthest+1 if the pointer isn't in the mapping. main_5day flows through
--    with no numeric change (catalog == sequence there).
WITH prog_users AS (
  SELECT ap.user_id,
         ap.engine_program_version AS prog,
         ap.engine_current_day,
         NULLIF(ap.engine_restarts->>ap.engine_program_version, '')::timestamptz AS restart_at
  FROM athlete_profiles ap
  WHERE ap.engine_program_version IS NOT NULL
),
completed AS (
  SELECT u.user_id, u.prog, s.program_day_number, s.sequence_position
  FROM prog_users u
  JOIN engine_workout_sessions s
    ON s.user_id = u.user_id
   AND s.program_version = u.prog
   AND s.completed
   AND s.program_day_number IS NOT NULL
   AND (u.restart_at IS NULL OR s.created_at > u.restart_at)
),
dirty AS (
  SELECT DISTINCT c.user_id
  FROM completed c
  WHERE c.sequence_position IS NULL   -- backfill found no mapping row = out-of-program
),
prog_len AS (
  SELECT engine_program_id, MAX(program_sequence_order) AS len
  FROM engine_program_mapping
  GROUP BY 1
),
furthest AS (
  SELECT c.user_id, MAX(c.sequence_position) AS max_seq
  FROM completed c
  WHERE c.sequence_position IS NOT NULL
  GROUP BY c.user_id
),
target AS (
  SELECT u.user_id,
         CASE
           -- dirty OR pointer-not-in-mapping: furthest in-program + 1
           WHEN u.user_id IN (SELECT user_id FROM dirty)
             OR NOT EXISTS (
               SELECT 1 FROM engine_program_mapping m
               WHERE m.engine_program_id = u.prog
                 AND m.engine_workout_day_number = u.engine_current_day)
           THEN LEAST(COALESCE(f.max_seq, 0) + 1, pl.len)
           -- clean: sequence of the current catalog pointer (earliest occurrence)
           ELSE (
             SELECT MIN(m.program_sequence_order)
             FROM engine_program_mapping m
             WHERE m.engine_program_id = u.prog
               AND m.engine_workout_day_number = u.engine_current_day)
         END AS new_day
  FROM prog_users u
  JOIN prog_len pl ON pl.engine_program_id = u.prog
  LEFT JOIN furthest f ON f.user_id = u.user_id
)
UPDATE athlete_profiles ap
SET engine_current_day = t.new_day
FROM target t
WHERE ap.user_id = t.user_id
  AND t.new_day IS NOT NULL
  AND ap.engine_current_day <> t.new_day;

-- 4) Chip-answer cache: rows are keyed by the old catalog day values; sequence
--    keys of the same number can mean a different day. It's a cache — drop it.
TRUNCATE engine_coach_cache;
