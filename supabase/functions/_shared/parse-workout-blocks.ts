/**
 * Parse workout text into blocks (Warm-up, Skills, Strength, Metcon, Cool down).
 * Used by preprocess-program and sync-program-blocks.
 */

const BLOCK_LABELS = ["Warm-up", "Skills", "Strength", "Metcon", "Cool down"] as const;
const BLOCK_TYPE_MAP: Record<string, string> = {
  "warm-up": "warm-up",
  "skills": "skills",
  "strength": "strength",
  "metcon": "metcon",
  "cool down": "cool-down",
};

export function extractBlocksFromWorkoutText(
  text: string
): { block_type: string; block_order: number; block_text: string }[] {
  if (!text?.trim()) return [];
  const lower = text.toLowerCase();
  const blocks: { block_type: string; block_order: number; block_text: string }[] = [];
  const labelsToFind = BLOCK_LABELS.map((l) => ({ label: l, needle: (l + ":").toLowerCase() }));

  for (let i = 0; i < labelsToFind.length; i++) {
    const { label, needle } = labelsToFind[i];
    const start = lower.indexOf(needle);
    if (start < 0) continue;
    const contentStart = start + needle.length;
    const next = labelsToFind.slice(i + 1).find((x) => lower.indexOf(x.needle, contentStart) >= 0);
    const end = next ? lower.indexOf(next.needle, contentStart) : text.length;
    const blockText = text.slice(contentStart, end).trim();
    const blockType = BLOCK_TYPE_MAP[label.toLowerCase()] ?? "other";
    blocks.push({ block_type: blockType, block_order: blocks.length + 1, block_text: blockText });
  }
  return blocks;
}
