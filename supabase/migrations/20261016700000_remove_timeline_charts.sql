-- The timeline chart template is out of the catalog: its content was lab
-- logistics (test and biopsy scheduling), not findings, and those facts
-- already live in each entry's lede / About prose. Remove the two timeline
-- charts the founding entries carried; the repo JSON archive is updated in
-- the same commit.
UPDATE knowledge_entries
SET entry = jsonb_set(
  entry, '{charts}',
  COALESCE((
    SELECT jsonb_agg(c)
    FROM jsonb_array_elements(entry->'charts') AS c
    WHERE c->>'template' <> 'timeline'
  ), '[]'::jsonb)
)
WHERE slug IN ('gillen-2016', 'malisoux-2006')
  AND entry->'charts' @> '[{"template":"timeline"}]';
