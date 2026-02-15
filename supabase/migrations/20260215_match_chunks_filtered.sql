-- Add a category-filtered variant of match_chunks for source filtering
CREATE OR REPLACE FUNCTION match_chunks_filtered(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_category text
)
RETURNS TABLE (
  id text,
  title text,
  author text,
  source text,
  content text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.title,
    c.author,
    c.source,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  WHERE
    c.category = filter_category
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
