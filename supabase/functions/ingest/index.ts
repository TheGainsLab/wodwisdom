import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const INGEST_SECRET = Deno.env.get("INGEST_SECRET");

// Chunking parameters (in characters; ~500 tokens ≈ 2000 chars)
const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 80);
}

/** Approximate token count (1 token ≈ 4 characters for English text). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks of ~CHUNK_SIZE chars with CHUNK_OVERLAP overlap.
 * Prefers splitting on paragraph boundaries, then sentence boundaries.
 */
function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // If adding this paragraph would exceed the limit, finalize current chunk
    if (current.length > 0 && current.length + trimmed.length + 2 > CHUNK_SIZE) {
      chunks.push(current.trim());
      // Start next chunk with overlap from end of previous
      const overlap = current.slice(-CHUNK_OVERLAP);
      current = overlap + "\n\n" + trimmed;
    } else {
      current += (current ? "\n\n" : "") + trimmed;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  // Handle edge case: if a single paragraph is bigger than CHUNK_SIZE,
  // split it by sentences
  const final: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= CHUNK_SIZE * 1.5) {
      final.push(chunk);
      continue;
    }
    // Split oversized chunk by sentences
    const sentences = chunk.match(/[^.!?]+[.!?]+\s*/g) || [chunk];
    let sub = "";
    for (const sentence of sentences) {
      if (sub.length + sentence.length > CHUNK_SIZE && sub.length > 0) {
        final.push(sub.trim());
        const overlap = sub.slice(-CHUNK_OVERLAP);
        sub = overlap + sentence;
      } else {
        sub += sentence;
      }
    }
    if (sub.trim()) final.push(sub.trim());
  }

  return final;
}

/**
 * Generate embeddings for an array of texts in a single OpenAI API call.
 */
async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error("OpenAI embedding error: " + err);
  }

  const data = await resp.json();
  return data.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((d: any) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Auth: require INGEST_SECRET via Authorization header
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (!INGEST_SECRET || token !== INGEST_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { title, author, category, source, source_url, content } = body;

    if (!title || !content) {
      return new Response(
        JSON.stringify({ error: "title and content are required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const slug = slugify(title);
    const chunks = chunkText(content);
    const totalChunks = chunks.length;

    // Generate all embeddings in one batch call
    const embeddings = await generateEmbeddings(chunks);

    // Build rows for insert
    const rows = chunks.map((text, i) => ({
      id: `${slug}-chunk-${i}`,
      title,
      author: author || null,
      category: category || null,
      source: source || null,
      source_url: source_url || null,
      chunk_index: i,
      total_chunks: totalChunks,
      content: text,
      embedding: JSON.stringify(embeddings[i]),
      token_count: estimateTokens(text),
    }));

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Upsert so re-ingesting the same article replaces old chunks
    const { error: insertErr } = await supa
      .from("chunks")
      .upsert(rows, { onConflict: "id" });

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: "DB insert failed", details: insertErr.message }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // If the article previously had more chunks, clean up stale ones
    const { error: cleanupErr } = await supa
      .from("chunks")
      .delete()
      .like("id", `${slug}-chunk-%`)
      .gte("chunk_index", totalChunks);

    if (cleanupErr) {
      console.error("Cleanup warning:", cleanupErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        title,
        chunks_ingested: totalChunks,
        total_tokens: rows.reduce((sum, r) => sum + r.token_count, 0),
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Ingest error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
