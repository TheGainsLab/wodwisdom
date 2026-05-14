/**
 * build-rag-context.ts
 *
 * Shared RAG context builder. Extracted from generate-program/index.ts's
 * `retrieveRAGContext` (v1, lines 355-427). Same shape, same queries, same
 * formatting — just generalized to take hydrated `lifts` + `skills` maps
 * directly so both `generate-program`-v2 and `profile-analysis`-v2 can
 * call it through `build-writer-payload.ts`.
 *
 * Behavior matches v1 exactly:
 *   - Parallel searchChunks across journal + strength-science + mainsite scopes.
 *   - Filters: liftNames = entered lifts; skillNames = rated non-"none" skills;
 *     profSkills = "intermediate" or "advanced" skills only (for metcon scope).
 *   - Dedup + format-with-context. Returns the same "REFERENCE (use to
 *     guide all programming decisions):\n..." prefix v1 emits.
 *   - Soft-fails to "" on any error or missing OPENAI_API_KEY.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  searchChunks,
  deduplicateChunks,
  formatChunksAsContext,
  type RAGChunk,
} from "./rag.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

/**
 * Build the RAG context block. `lifts` and `skills` are the hydrated maps
 * from the writer payload (every canonical key present; null when absent
 * for lifts, null or "none" when absent/incapable for skills).
 */
export async function buildRagContext(
  supa: SupabaseClient,
  lifts: Record<string, number | null>,
  skills: Record<string, string | null>,
): Promise<string> {
  if (!OPENAI_API_KEY) return "";

  try {
    const liftNames = Object.entries(lifts)
      .filter(([, v]) => typeof v === "number" && v > 0)
      .map(([k]) => k.replace(/_/g, " "))
      .join(", ");

    const skillNames = Object.entries(skills)
      .filter(([, v]) => v != null && v !== "none")
      .map(([k]) => k.replace(/_/g, " "))
      .join(", ");

    const profSkills = Object.entries(skills)
      .filter(([, v]) => v === "intermediate" || v === "advanced")
      .map(([k]) => k.replace(/_/g, " "))
      .join(", ");

    console.log(`[RAG] Searching with lifts="${liftNames}", skills="${skillNames}"`);

    const queries: Promise<RAGChunk[]>[] = [];
    if (liftNames) {
      queries.push(
        searchChunks(
          supa,
          `strength training programming periodization ${liftNames}`,
          "journal",
          OPENAI_API_KEY,
          3,
          0.25,
        ),
      );
    }
    if (skillNames) {
      queries.push(
        searchChunks(
          supa,
          `CrossFit gymnastics skill progression ${skillNames}`,
          "journal",
          OPENAI_API_KEY,
          3,
          0.25,
        ),
      );
    }
    queries.push(
      searchChunks(
        supa,
        "CrossFit conditioning engine metcon programming",
        "journal",
        OPENAI_API_KEY,
        3,
        0.25,
      ),
    );
    queries.push(
      searchChunks(
        supa,
        liftNames
          ? `strength programming periodization load prescription ${liftNames}`
          : "strength programming periodization load prescription squat deadlift",
        "strength-science",
        OPENAI_API_KEY,
        2,
        0.25,
      ),
    );
    if (profSkills) {
      queries.push(
        searchChunks(
          supa,
          `CrossFit metcon workout ${profSkills}`,
          "mainsite",
          OPENAI_API_KEY,
          5,
          0.3,
        ),
      );
    }

    const results = await Promise.all(queries);
    const allChunks = results.flat();

    let i = 0;
    if (liftNames) console.log(`[RAG] journal/strength: ${results[i++].length} chunks`);
    if (skillNames) console.log(`[RAG] journal/skills: ${results[i++].length} chunks`);
    console.log(`[RAG] journal/conditioning: ${results[i++].length} chunks`);
    console.log(`[RAG] strength-science: ${results[i++].length} chunks`);
    if (profSkills) console.log(`[RAG] mainsite/metcon: ${results[i++].length} chunks`);

    const unique = deduplicateChunks(allChunks);
    console.log(`[RAG] Total: ${allChunks.length} raw → ${unique.length} deduplicated`);

    if (unique.length === 0) return "";
    return "\n\nREFERENCE (use to guide all programming decisions):\n" + formatChunksAsContext(unique, 8);
  } catch (err) {
    console.error("[RAG] retrieval error:", err);
    return "";
  }
}
