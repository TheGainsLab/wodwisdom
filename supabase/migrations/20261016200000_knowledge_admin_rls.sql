-- The admin review screen reads drafts and publishes approved entries
-- directly (RLS-gated), so the editor loop needs no extra edge function.

CREATE POLICY ke_admin_select ON knowledge_entries FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY ke_admin_update ON knowledge_entries FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
