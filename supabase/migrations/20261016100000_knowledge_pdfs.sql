-- Private bucket for research-paper PDFs. The admin page uploads here; the
-- ingest-paper function reads from here; the public never touches it.

INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-pdfs', 'knowledge-pdfs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "knowledge pdfs: admin read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'knowledge-pdfs'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "knowledge pdfs: admin upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'knowledge-pdfs'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
