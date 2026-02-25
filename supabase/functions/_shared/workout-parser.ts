/**
 * Splits workout text into typed blocks and extracts movements per block.
 * Used by parse-workout endpoint and Start Workout page pre-population.
 *
 * Block splitting: regex (deterministic, fast)
 * Movement extraction: AI first, regex fallback (matches analyze-program pattern)
 */

import { extractMovementsAI } from "./extract-movements-ai.ts";
import { analyzeWorkouts, type MovementsContext } from "./analyzer.ts";
import type { LibraryEntry } from "./extract-movements-ai.ts";

export type BlockType = "warm-up" | "strength" | "metcon" | "skills" | "accessory" | "cool-down" | "other";

export interface ParsedBlockMovement {
  canonical: string;
  modality: string;
  load: string;
}

export interface ParsedBlock {
  label: string;
  type: BlockType;
  text: string;
  movements: ParsedBlockMovement[];
}

export interface ParseWorkoutOptions {
  libraryEntries?: LibraryEntry[];
  movementsContext?: MovementsContext;
  apiKey?: string;
}

// Regex patterns for splitting workout into blocks
const BLOCK_PATTERNS = [
  // A), B), C) or single letter + paren
  /^([A-Z])\)\s*/m,
  // 1), 2), 3) numbered sections
  /^(\d+)\)\s*/m,
  // Labeled sections: Strength:, Metcon:, Accessory:, Skills:, Cool down:, etc.
  /^(Strength|Metcon|MetCon|Accessory|Warm-up|Warmup|Conditioning|Skills|Cool\s*down|Cool-down):\s*/im,
];

function splitIntoBlocks(workoutText: string): { label: string; text: string }[] {
  const trimmed = workoutText.trim();
  if (!trimmed) return [];

  const normalized = trimmed.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Try each pattern to find split points
  for (const pattern of BLOCK_PATTERNS) {
    const parts = normalized.split(pattern);
    if (parts.length > 1) {
      const blocks: { label: string; text: string }[] = [];
      const leading = parts[0].trim();
      let i = 1;
      while (i + 1 < parts.length) {
        const label = parts[i]?.trim() || "";
        const text = parts[i + 1]?.trim() || "";
        i += 2;
        if (label && text) {
          const blockText = blocks.length === 0 && leading ? leading + "\n" + text : text;
          blocks.push({ label, text: blockText });
        } else if (text) {
          const blockText = blocks.length === 0 && leading ? leading + "\n" + text : text;
          blocks.push({ label: String(blocks.length + 1), text: blockText });
        }
      }
      if (blocks.length > 0) return blocks;
    }
  }

  // No split found — treat whole text as single block
  return [{ label: "1", text: normalized }];
}

function classifyBlockType(label: string, text: string): BlockType {
  const labelLower = label.toLowerCase();
  if (/warm-up|warmup/.test(labelLower)) return "warm-up";
  if (/strength/.test(labelLower)) return "strength";
  if (/metcon|conditioning/.test(labelLower)) return "metcon";
  if (/^skills$/.test(labelLower)) return "skills";
  if (/cool[\s-]*down/.test(labelLower)) return "cool-down";
  if (/accessory/.test(labelLower)) return "accessory";

  const t = text.trim().toUpperCase();
  if (/AMRAP|AS MANY ROUNDS|FOR TIME|FORTIME|\d+\s*RFT|EMOM|E\d+MOM|DEATH\s+BY|TABATA|BUY\s+IN|CASH\s+OUT/.test(t)) {
    return "metcon";
  }
  if (/\d+X\d+|@\d+%/.test(t)) return "strength";
  return "other";
}

function extractMovementsRegex(
  text: string,
  movementsContext?: MovementsContext
): ParsedBlockMovement[] {
  const workouts = [{ week_num: 1, day_num: 1, workout_text: text }];
  const analysis = analyzeWorkouts(workouts, movementsContext);
  return analysis.movement_frequency.map((m) => ({
    canonical: m.name.replace(/\s+/g, "_").toLowerCase(),
    modality: /^[WGM]$/.test(String(m.modality)) ? m.modality : "W",
    load: m.loads?.[0] ?? "BW",
  }));
}

/**
 * Parse workout text into typed blocks with movements.
 * AI extraction first when libraryEntries + apiKey provided; regex fallback otherwise.
 */
export async function parseWorkout(
  workoutText: string,
  options?: ParseWorkoutOptions
): Promise<{ blocks: ParsedBlock[]; notices: string[] }> {
  const rawBlocks = splitIntoBlocks(workoutText);
  const notices: string[] = [];
  const { libraryEntries, movementsContext, apiKey } = options ?? {};

  // Prepare workouts for AI extraction (one per block)
  const workoutsForAI = rawBlocks.map((b, i) => ({
    id: `block-${i}`,
    workout_text: b.text,
  }));

  let movementsByBlock: ParsedBlockMovement[][];

  if (libraryEntries?.length && apiKey) {
    const extractionResult = await extractMovementsAI(
      workoutsForAI,
      libraryEntries,
      apiKey
    );
    if (extractionResult) {
      notices.push(...extractionResult.notices);
      movementsByBlock = extractionResult.movements.map((blockMoves) =>
        blockMoves.map((m) => ({ canonical: m.canonical, modality: m.modality, load: m.load }))
      );
    } else {
      notices.push("Movement extraction used fallback method. Some movements may be missed.");
      movementsByBlock = rawBlocks.map((b) =>
        extractMovementsRegex(b.text, movementsContext)
      );
    }
  } else {
    movementsByBlock = rawBlocks.map((b) =>
      extractMovementsRegex(b.text, movementsContext)
    );
  }

  const blocks: ParsedBlock[] = rawBlocks.map((b, i) => ({
    label: b.label,
    type: classifyBlockType(b.label, b.text),
    text: b.text,
    movements: movementsByBlock[i] ?? [],
  }));

  return { blocks, notices };
}
