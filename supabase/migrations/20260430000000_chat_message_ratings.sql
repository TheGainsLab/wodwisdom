-- Chat message ratings (step 1 of segmentation/analysis).
--
-- Each user can leave a single 👍 (1) or 👎 (-1) rating on any chat_messages
-- row they own. UNIQUE(message_id, user_id) enforces "one rating per answer";
-- toggling between thumbs UPDATEs the row, un-rating DELETEs it. No history
-- is retained — only the current state.
--
-- Admins read across all rows via the admin_list_rated_messages RPC
-- (separate migration), gated by is_current_user_admin().

-- ─── 1. Table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_message_ratings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating IN (1, -1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_message_ratings_message_user_unique UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_ratings_rating_created
  ON public.chat_message_ratings (rating, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_message_ratings_user_created
  ON public.chat_message_ratings (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_message_ratings_message
  ON public.chat_message_ratings (message_id);

-- ─── 2. updated_at trigger ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_message_ratings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_message_ratings_updated_at ON public.chat_message_ratings;
CREATE TRIGGER chat_message_ratings_updated_at
  BEFORE UPDATE ON public.chat_message_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_message_ratings_set_updated_at();

-- ─── 3. RLS ──────────────────────────────────────────────────────────
-- Users manage their own rating rows. Admins can SELECT all (so the
-- admin RPC can also be implemented as a view/direct query later if
-- preferred — today it goes through admin_list_rated_messages).

ALTER TABLE public.chat_message_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_message_ratings_select_own ON public.chat_message_ratings;
CREATE POLICY chat_message_ratings_select_own ON public.chat_message_ratings
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_current_user_admin());

DROP POLICY IF EXISTS chat_message_ratings_insert_own ON public.chat_message_ratings;
CREATE POLICY chat_message_ratings_insert_own ON public.chat_message_ratings
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS chat_message_ratings_update_own ON public.chat_message_ratings;
CREATE POLICY chat_message_ratings_update_own ON public.chat_message_ratings
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS chat_message_ratings_delete_own ON public.chat_message_ratings;
CREATE POLICY chat_message_ratings_delete_own ON public.chat_message_ratings
  FOR DELETE
  USING (user_id = auth.uid());
