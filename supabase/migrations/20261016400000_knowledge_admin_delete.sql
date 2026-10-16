-- Admins can remove entries (any status) and their source PDFs.

CREATE POLICY ke_admin_delete ON knowledge_entries FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "knowledge pdfs: admin delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'knowledge-pdfs'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
