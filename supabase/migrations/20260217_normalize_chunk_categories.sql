-- Normalize all existing chunks to category 'journal' so the filtered
-- search RPC (match_chunks_filtered) returns consistent results.
-- Future physiology textbook uploads will use category = 'science'.
UPDATE chunks
SET category = 'journal'
WHERE category IS NULL
   OR category != 'science';
