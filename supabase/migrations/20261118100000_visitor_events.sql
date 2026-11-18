-- visitor_events (2026-11-18): usage of the PUBLIC pages — the calculators
-- (/calculators) and the library (/qa, /knowledge) — which app_events cannot
-- see: app_events is signed-in only (user_id NOT NULL, insert-own policy),
-- and these pages are read mostly by people with no account.
--
-- Anonymous by design: no user id, no IP, no free text. `visit_id` is a
-- random id held in the browser's sessionStorage, so it groups one tab's
-- visit and is gone when the tab closes — it counts visits, not people.
--
-- Vocabulary (fixed by the CHECK; add a value here and in
-- src/lib/visitorEvents.ts together):
--   page_view        { path }                 which public pages get read
--   calculator_used  { calculator, result }   which calculators get used,
--                                             and what they tell people
--
-- Anyone can INSERT (that is the point), nobody can read from a client. The
-- CHECKs keep an open insert from becoming a dumping ground: fixed events,
-- a small props object, a well-formed visit id.

CREATE TABLE visitor_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id text NOT NULL CHECK (visit_id ~ '^[0-9a-f-]{36}$'),
  event text NOT NULL CHECK (event IN ('page_view', 'calculator_used')),
  props jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(props) = 'object' AND pg_column_size(props) <= 400),
  signed_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_visitor_events_event ON visitor_events(event, created_at DESC);

ALTER TABLE visitor_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone may insert visitor events" ON visitor_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

GRANT INSERT ON visitor_events TO anon, authenticated;

COMMENT ON TABLE visitor_events IS
  'Anonymous usage of public pages (calculators, library): page_view {path}, calculator_used {calculator, result}. Insert-only from clients (anon + authenticated); no client reads. visit_id is a per-tab random id, not a person.';
