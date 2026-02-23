/**
 * Shared RAG retrieval functions.
 * Used by both chat/index.ts and incorporate-movements/index.ts.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RAGChunk {
  id: string;
  title: string;
  author?: string;
  source?: string;
  content: string;
  similarity: number;
}

/**
 * Embed a query string using OpenAI text-embedding-3-small.
 * Throws on failure — callers should catch or let searchChunks handle it.
 */
export async function embedQuery(
  query: string,
  openaiApiKey: string
): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: query.substring(0, 2000),
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error("OpenAI embedding error:", err);
    throw new Error("Embedding API call failed");
  }

  const data = await resp.json();

  if (!data.data?.length) {
    throw new Error("No embedding returned from OpenAI");
  }

  return data.data[0].embedding;
}

/**
 * Search chunks by embedding similarity within a category.
 * Returns [] on any failure (embedding, RPC, parse) so callers
 * can continue with reduced context rather than failing entirely.
 */
export async function searchChunks(
  supa: SupabaseClient,
  query: string,
  category: string,
  openaiApiKey: string,
  matchCount: number = 4,
  matchThreshold: number = 0.25
): Promise<RAGChunk[]> {
  try {
    const embedding = await embedQuery(query, openaiApiKey);

    const { data, error } = await supa.rpc("match_chunks_filtered", {
      query_embedding: embedding,
      match_threshold: matchThreshold,
      match_count: matchCount,
      filter_category: category,
    });

    if (error) {
      console.error("RAG search error:", error);
      return [];
    }

    return (data as RAGChunk[]) || [];
  } catch (err) {
    console.error("searchChunks error:", err);
    return [];
  }
}

/**
 * Deduplicate chunks by id, keeping the highest similarity score.
 */
export function deduplicateChunks(chunks: RAGChunk[]): RAGChunk[] {
  const byId = new Map<string, RAGChunk>();
  for (const chunk of chunks) {
    const existing = byId.get(chunk.id);
    if (!existing || chunk.similarity > existing.similarity) {
      byId.set(chunk.id, chunk);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => b.similarity - a.similarity
  );
}

/**
 * Format chunks into a context string for inclusion in a prompt.
 */
export function formatChunksAsContext(
  chunks: RAGChunk[],
  maxChunks: number = 20
): string {
  return chunks
    .slice(0, maxChunks)
    .map(
      (c) =>
        `[${c.title}${c.author ? ` — ${c.author}` : ""}]\n${c.content}`
    )
    .join("\n\n---\n\n");
}
