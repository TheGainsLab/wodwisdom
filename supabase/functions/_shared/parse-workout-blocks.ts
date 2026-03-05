/**
 * Parse workout text into blocks (Warm-up, Skills, Strength, Metcon, Cool down).
 * Used by preprocess-program and sync-program-blocks.
 *
 * Handles common AI-generated label variations:
 *   - "Warmup:", "Warm Up:", "WARM-UP:" → Warm-up
 *   - "Skill:", "Skill Work:" → Skills
 *   - "WOD:", "Conditioning:", "Met-Con:" → Metcon
 *   - "Cooldown:", "Cool-down:", "COOL DOWN:" → Cool down
 */

interface BlockDef {
  canonical: string;
  type: string;
  patterns: RegExp[];
}

const BLOCK_DEFS: BlockDef[] = [
  {
    canonical: "Warm-up",
    type: "warm-up",
    patterns: [/warm[\s-]*up\s*:/i],
  },
  {
    canonical: "Skills",
    type: "skills",
    patterns: [/skills?\s*(?:work)?\s*:/i],
  },
  {
    canonical: "Strength",
    type: "strength",
    patterns: [/strength\s*(?:work)?\s*:/i],
  },
  {
    canonical: "Metcon",
    type: "metcon",
    patterns: [/met[\s-]*con\s*:/i, /wod\s*:/i, /conditioning\s*:/i],
  },
  {
    canonical: "Cool down",
    type: "cool-down",
    patterns: [/cool[\s-]*down\s*:/i],
  },
];

function findBlockStart(text: string, patterns: RegExp[], searchFrom: number): { index: number; matchLen: number } | null {
  let best: { index: number; matchLen: number } | null = null;
  for (const pat of patterns) {
    // Search from searchFrom position
    const sub = text.slice(searchFrom);
    const m = sub.match(pat);
    if (m && m.index != null) {
      const absIdx = searchFrom + m.index;
      if (!best || absIdx < best.index) {
        best = { index: absIdx, matchLen: m[0].length };
      }
    }
  }
  return best;
}

export function extractBlocksFromWorkoutText(
  text: string
): { block_type: string; block_order: number; block_text: string }[] {
  if (!text?.trim()) return [];
  const blocks: { block_type: string; block_order: number; block_text: string }[] = [];

  // Find all block positions
  const found: { def: BlockDef; start: number; contentStart: number }[] = [];
  for (const def of BLOCK_DEFS) {
    const match = findBlockStart(text, def.patterns, 0);
    if (match) {
      found.push({ def, start: match.index, contentStart: match.index + match.matchLen });
    }
  }

  // Sort by position in text
  found.sort((a, b) => a.start - b.start);

  for (let i = 0; i < found.length; i++) {
    const { def, contentStart } = found[i];
    const end = i + 1 < found.length ? found[i + 1].start : text.length;
    const blockText = text.slice(contentStart, end).trim();
    blocks.push({ block_type: def.type, block_order: blocks.length + 1, block_text: blockText });
  }
  return blocks;
}
