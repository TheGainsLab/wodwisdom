/**
 * Shared helper to build MovementsContext and LibraryEntry[]
 * from raw movements table rows.
 *
 * Used by analyze-program and incorporate-movements to ensure
 * consistent data shapes for the analyzer and AI extraction.
 */

import type { MovementsContext } from "./analyzer.ts";
import type { LibraryEntry } from "./extract-movements-ai.ts";

export interface MovementsRow {
  canonical_name: string;
  display_name: string;
  modality: string;
  category?: string;
  aliases?: string[] | null;
  competition_count?: number | null;
}

/**
 * Build MovementsContext for the analyzer from raw movements rows.
 */
export function buildMovementsContext(rows: MovementsRow[]): MovementsContext {
  const library: Record<string, { modality: "W" | "G" | "M"; category: string }> = {};
  const aliases: Record<string, string> = {};
  const essentialCanonicals = new Set<string>();

  for (const row of rows) {
    library[row.canonical_name] = {
      modality: row.modality as "W" | "G" | "M",
      category: row.category || "other",
    };

    if (Array.isArray(row.aliases)) {
      for (const alias of row.aliases) {
        aliases[alias.toLowerCase().trim()] = row.canonical_name;
      }
    }
    const displaySpaced = row.display_name?.replace(/_/g, " ").toLowerCase();
    if (displaySpaced && displaySpaced !== row.canonical_name) {
      aliases[displaySpaced] = row.canonical_name;
    }

    if ((row.competition_count ?? 0) > 0) {
      essentialCanonicals.add(row.canonical_name);
    }
  }

  return { library, aliases, essentialCanonicals };
}

/**
 * Build LibraryEntry[] for extractMovementsAI from raw movements rows.
 * Merges default aliases with DB-stored aliases.
 */
export function buildLibraryEntries(rows: MovementsRow[]): LibraryEntry[] {
  return rows.map((row) => {
    const dbAliases = Array.isArray(row.aliases) ? row.aliases : [];
    const allAliases = dbAliases
      .map((a) => a.toLowerCase().trim())
      .filter(Boolean);

    return {
      canonical_name: row.canonical_name,
      display_name: row.display_name,
      modality: row.modality,
      aliases: allAliases,
    };
  });
}
