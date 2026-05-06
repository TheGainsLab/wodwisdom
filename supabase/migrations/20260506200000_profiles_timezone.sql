-- Step 1 of timezone fix: store each user's IANA timezone on their profile.
--
-- The default 'UTC' preserves current (broken) behavior for existing rows
-- until the client backfills the real value on next login. Subsequent
-- migrations rely on this column to compute "today" boundaries in the
-- user's local time instead of server UTC.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
