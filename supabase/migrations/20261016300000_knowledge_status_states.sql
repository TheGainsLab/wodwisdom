-- Ingestion runs in the background (a synchronous request outlives the
-- gateway), so a row now exists from the moment of upload: 'drafting' while
-- the model works, 'failed' when drafting died (the validator_report carries
-- the reason). Both are invisible to the public, which reads only published.

ALTER TABLE knowledge_entries DROP CONSTRAINT knowledge_entries_status_check;
ALTER TABLE knowledge_entries ADD CONSTRAINT knowledge_entries_status_check
  CHECK (status IN ('drafting', 'draft', 'published', 'rejected', 'failed'));
