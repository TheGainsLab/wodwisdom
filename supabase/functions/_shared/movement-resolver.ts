/**
 * movement-resolver.ts
 *
 * Maps the v3 writer's free-text movement names ("Power Snatch", "Pushup",
 * "Wall-Ball Shot") to upstream's canonical catalog names. Three-stage
 * deterministic cascade:
 *
 *   1. Exact match (case-insensitive) against display_name or canonical_name
 *   2. Olympic-variant alias fast-path (Power Snatch → Snatch, etc.)
 *   3. Trigram-similarity fuzzy match, threshold 0.85
 *
 * Returns the canonical display_name to send to work-calc, or null when
 * no confident match exists. Caller (compute-benchmarks) treats null as
 * "this workout can't be benchmarked" and falls back to PERFORMANCE_FACTORS
 * for that block.
 *
 * Filters to modeled=true movements only — un-modeled catalog entries
 * exist (~30%) but work-calc can't compute joules for them, so resolving
 * to an un-modeled name would just shift the failure downstream.
 */

import type { MovementInfo } from "./work-calc-movements-cache.ts";

/** Olympic-variant aliases. Upstream collapses these variants into single
 *  canonical rows because start/end positions match — work formula is
 *  identical. Distinct rows (Back/Front/Overhead Squat, Push/Shoulder/
 *  Bench Press) are NOT aliased — they have different work. */
const OLYMPIC_VARIANT_ALIASES: Record<string, string> = {
  // Snatch variants
  "power snatch": "Snatch",
  "squat snatch": "Snatch",
  "hang power snatch": "Snatch",
  "hang squat snatch": "Snatch",
  "hang snatch": "Snatch",
  "muscle snatch": "Snatch",
  // Clean variants
  "power clean": "Clean",
  "squat clean": "Clean",
  "hang power clean": "Clean",
  "hang squat clean": "Clean",
  "hang clean": "Clean",
  // Jerk variants
  "push jerk": "Jerk",
  "split jerk": "Jerk",
  "squat jerk": "Jerk",
};

const FUZZY_THRESHOLD = 0.85;

/** Padded character-trigrams (Jaccard-similarity-friendly representation). */
function trigrams(s: string): Set<string> {
  const padded = `  ${s.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ")}  `;
  const result = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

/** Jaccard similarity on character trigrams. Returns 0-1.
 *  Deterministic, no network. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface ResolutionResult {
  canonical: string; // display_name to send to work-calc
  similarity: number; // 1.0 for exact / alias; <1.0 for fuzzy
  via: "exact" | "alias" | "fuzzy";
}

/**
 * Resolve a free-text movement name against the canonical catalog.
 * Returns null when no match meets the FUZZY_THRESHOLD bar.
 */
export function resolveMovementName(
  inputName: string,
  movements: MovementInfo[],
): ResolutionResult | null {
  const trimmed = inputName.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9]/g, "");

  // Only resolve to modeled movements — un-modeled rows would fail joules
  // computation downstream.
  const modeled = movements.filter((m) => m.modeled);
  if (modeled.length === 0) return null;

  // Stage 1a: exact match against display_name or canonical_name (case-insensitive).
  for (const m of modeled) {
    if (m.display_name.toLowerCase() === lower || m.canonical_name.toLowerCase() === lower) {
      return { canonical: m.display_name, similarity: 1.0, via: "exact" };
    }
  }

  // Stage 1b: exact match after stripping non-alphanumerics. Handles hyphen/
  // space/capitalization variations cheaply: "Pushup" ↔ "Push-up",
  // "Wall Ball Shot" ↔ "Wall-Ball Shot", "DBSnatch" ↔ "DB Snatch".
  if (stripped.length > 0) {
    for (const m of modeled) {
      const dispStripped = m.display_name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const canonStripped = m.canonical_name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (stripped === dispStripped || stripped === canonStripped) {
        return { canonical: m.display_name, similarity: 1.0, via: "exact" };
      }
    }
  }

  // Stage 2: Olympic-variant alias fast-path.
  const aliased = OLYMPIC_VARIANT_ALIASES[lower];
  if (aliased) {
    // Confirm the alias target is actually in the modeled catalog (defensive).
    const aliasMatch = modeled.find(
      (m) => m.display_name === aliased || m.canonical_name.toLowerCase() === aliased.toLowerCase(),
    );
    if (aliasMatch) {
      return { canonical: aliasMatch.display_name, similarity: 1.0, via: "alias" };
    }
  }

  // Stage 3: trigram fuzzy match, threshold gate.
  let bestSim = 0;
  let bestMatch: MovementInfo | null = null;
  for (const m of modeled) {
    const sim = Math.max(
      trigramSimilarity(lower, m.display_name),
      trigramSimilarity(lower, m.canonical_name),
    );
    if (sim > bestSim) {
      bestSim = sim;
      bestMatch = m;
    }
  }
  if (bestMatch && bestSim >= FUZZY_THRESHOLD) {
    return { canonical: bestMatch.display_name, similarity: bestSim, via: "fuzzy" };
  }

  return null;
}
