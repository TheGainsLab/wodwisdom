-- Discuss this paper: saved conversations, one thread per member per paper.
-- messages is an append-only jsonb array of {role, content, at}. All writes
-- go through the discuss-paper function (service role); members read their
-- own threads, admins read all (the questions are the ingestion signal).
-- question_count is the billing meter: the free tier is a lifetime total of
-- 3 questions across the whole library (summed over a user's rows).

CREATE TABLE IF NOT EXISTS knowledge_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  question_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS knowledge_conversations_user_idx
  ON knowledge_conversations (user_id, updated_at DESC);

ALTER TABLE knowledge_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_conversations_owner_read ON knowledge_conversations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY knowledge_conversations_admin_read ON knowledge_conversations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );
