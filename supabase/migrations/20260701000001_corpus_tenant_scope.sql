-- Corpus tenant scoping — the cheap-now/brutal-later half of Engine extraction.
--
-- The RAG methodology corpus (`chunks`) is global today: retrieval filters by
-- `category` only, with no per-tenant boundary. White-label / per-brand
-- methodology corpora (STRATEGY.md §3 Intake/Profile, ENGINE_EXTRACTION.md
-- "corpus tenancy") require a tenant boundary. Adding it now — while every row
-- is baseline and every caller is untenanted — is additive; bolting it on after
-- white-label ships is a migration + RPC rewrite + every call site.
--
-- Model:
--   chunks.tenant_id = NULL  -> shared baseline corpus (all tenants see it)
--   chunks.tenant_id = 'x'   -> tenant x's private methodology corpus
-- Retrieval returns baseline + the requested tenant(s). A new
-- `filter_tenants text[] DEFAULT NULL` param on the match functions carries the
-- scope.
--
-- IMPORTANT: adding the param CHANGES the function argument list, so
-- CREATE OR REPLACE alone would create a SECOND overload alongside the original
-- 4-arg functions (Postgres function identity = name + arg types). PostgREST
-- would then see two candidates for the existing 4-named-arg .rpc() calls and
-- fail every RAG query with PGRST203 ("could not choose the best candidate
-- function") — silently, since searchChunks swallows the error and returns [].
-- So we DROP every existing overload of both functions first, then create the
-- new signature as the sole definition. Callers that omit filter_tenants get
-- the DEFAULT NULL (baseline only = today's behavior).
--
-- Idempotent; apply by pasting into the Supabase SQL editor.

BEGIN;

-- 1. Tenant column (nullable = baseline) + lookup index --------------------
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tenant_id text;

CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON chunks (tenant_id);

COMMENT ON COLUMN chunks.tenant_id IS
  'NULL = shared baseline methodology corpus (visible to all tenants). '
  'Non-null = a single tenant''s private corpus (white-label). Retrieval '
  'includes baseline + the requested tenant(s); see match_chunks_filtered / '
  'match_chunks_multi filter_tenants param.';

-- 2. Drop ALL existing overloads of both match functions ------------------
-- Robust against whichever signatures currently exist (the original 4-arg
-- versions, and/or a 5-arg version from a prior run of this migration).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname IN ('match_chunks_filtered', 'match_chunks_multi')
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

-- 3. Category-filtered match, tenant-aware (sole definition) --------------
-- filter_tenants NULL/empty -> baseline only (today's behavior).
-- filter_tenants [...]       -> baseline + those tenants.
CREATE FUNCTION match_chunks_filtered(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_category text,
  filter_tenants text[] DEFAULT NULL
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
    AND (
      c.tenant_id IS NULL
      OR c.tenant_id = ANY(COALESCE(filter_tenants, ARRAY[]::text[]))
    )
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 4. Multi-category match, tenant-aware (sole definition) -----------------
CREATE FUNCTION match_chunks_multi(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_categories text[],
  filter_tenants text[] DEFAULT NULL
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
    c.category = ANY(filter_categories)
    AND (
      c.tenant_id IS NULL
      OR c.tenant_id = ANY(COALESCE(filter_tenants, ARRAY[]::text[]))
    )
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMIT;
