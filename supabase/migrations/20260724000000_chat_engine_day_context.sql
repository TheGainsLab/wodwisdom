-- chat_messages: record Engine day scoping.
--
-- Day-scoped Engine conversations were persisted with NULL context —
-- context_id is a uuid, so a program day number had nowhere to live — which
-- made "which day was this question scoped to?" a three-query archaeology
-- exercise (the Dylan Hebert viewed-vs-current-day investigation, Jul 2026).
--
-- chat/index.ts now writes context_type='engine_day' + context_day=<the
-- engine_program_day the request scoped to> for every Engine day-scoped
-- question. AI-Programming workout chats keep using context_type='workout' +
-- context_id (the workout uuid), unchanged.

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS context_day integer;

COMMENT ON COLUMN chat_messages.context_day IS
  'For context_type=engine_day: the program day this question was scoped to (the day page the athlete had open). NULL otherwise.';
