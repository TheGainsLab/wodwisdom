-- Usage signals for the research library: which papers get read, which
-- charts and glossary terms get touched, who clicks Discuss. This is the
-- data that steers what gets ingested next and whether the library earns
-- its keep. Anyone may write (signed-out visitors included); only admins read.

CREATE TABLE knowledge_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  slug text,
  meta jsonb,
  user_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_events_type_time ON knowledge_events (event_type, created_at);
CREATE INDEX knowledge_events_slug ON knowledge_events (slug) WHERE slug IS NOT NULL;

ALTER TABLE knowledge_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY kev_insert_any ON knowledge_events FOR INSERT WITH CHECK (true);
CREATE POLICY kev_admin_select ON knowledge_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
