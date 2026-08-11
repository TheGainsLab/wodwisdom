/**
 * metcon-examples.ts
 *
 * Stratified example retrieval for the metcon composer — the anchoring input.
 * Rules alone get satisfied literally while the safe attractor holds (observed
 * twice, 2026-08); worked examples anchor composition breadth by demonstration.
 *
 * STRATIFIED, NOT SIMILAR — similarity retrieval against the month's slots
 * would fetch sixteen neighbors of "medium aerobic piece" and re-anchor the
 * attractor from the reference side. Instead: one targeted draw per format
 * family, so the example set covers the format/modality space by construction.
 *
 * FROZEN QUERY STRINGS (2026-08-11 spec): these are part of the frozen metcon
 * spec. Do not tune, "improve", or re-aim them without an explicit spec
 * ruling — drift back toward similarity is the failure mode this freeze
 * prevents.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { searchChunks, type RAGChunk } from "./rag.ts";

export const FROZEN_METCON_EXAMPLE_QUERIES = [
  "EMOM every minute on the minute conditioning workout",
  "barbell couplet metcon light moderate load fast cycling",
  "long chipper workout many movements for time",
  "interval conditioning rounds work rest pacing",
  "21-15-9 descending rep scheme couplet for time",
  "AMRAP triplet bodyweight dumbbell kettlebell workout",
] as const;

const PER_QUERY = 2;
const SCOPE = "mainsite";

/**
 * Build the composer's example block. Soft-fails to "" (no examples) on any
 * error or missing key — the composer must still run; examples are anchoring,
 * not a dependency.
 */
export async function buildStratifiedMetconExamples(
  supa: SupabaseClient,
  opts: { openaiApiKey?: string } = {},
): Promise<string> {
  const key = opts.openaiApiKey ?? Deno.env.get("OPENAI_API_KEY");
  if (!key) return "";
  try {
    const results = await Promise.all(
      FROZEN_METCON_EXAMPLE_QUERIES.map((q) => searchChunks(supa, q, SCOPE, key, PER_QUERY, 0.2)),
    );
    // Interleave one-per-stratum first so a cap never eats a whole format,
    // then dedupe by id.
    const seen = new Set<string>();
    const ordered: RAGChunk[] = [];
    for (let round = 0; round < PER_QUERY; round++) {
      for (const bucket of results) {
        const c = bucket[round];
        if (c && !seen.has(c.id)) {
          seen.add(c.id);
          ordered.push(c);
        }
      }
    }
    if (ordered.length === 0) return "";
    const lines = ordered.map((c) => `— ${c.title ?? "workout"}:\n${c.content.trim()}`);
    return (
      "EXAMPLE WORKOUTS (reference breadth — real pieces spanning formats. Use them as " +
      "anchors for variety and craft; NEVER copy one verbatim into the month):\n\n" +
      lines.join("\n\n")
    );
  } catch (err) {
    console.error("[metcon-examples] retrieval error (continuing without):", err);
    return "";
  }
}
