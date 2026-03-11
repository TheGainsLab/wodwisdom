/**
 * Skill priority parsing from AI-generated hierarchy.
 *
 * The analysis step produces a SKILLS HIERARCHY with ranked priorities.
 * This module parses that hierarchy into a SkillPriority[] array
 * consumed by build-skill-schedule.ts.
 *
 * The deterministic scoring formula has been removed — the AI analysis
 * now makes the coaching decision about which skills matter most.
 */

// ── Display names for prompt injection ─────────────────────────

export const SKILL_DISPLAY_NAMES: Record<string, string> = {
  muscle_ups: "Ring Muscle-Ups",
  bar_muscle_ups: "Bar Muscle-Ups",
  strict_ring_muscle_ups: "Strict Ring Muscle-Ups",
  toes_to_bar: "Toes-to-Bar",
  strict_pull_ups: "Strict Pull-Ups",
  kipping_pull_ups: "Kipping Pull-Ups",
  butterfly_pull_ups: "Butterfly Pull-Ups",
  chest_to_bar_pull_ups: "Chest-to-Bar Pull-Ups",
  rope_climbs: "Rope Climbs",
  legless_rope_climbs: "Legless Rope Climbs",
  wall_facing_hspu: "Wall-Facing HSPU",
  hspu: "HSPU (kipping)",
  strict_hspu: "Strict HSPU",
  deficit_hspu: "Deficit HSPU",
  ring_dips: "Ring Dips",
  l_sit: "L-Sit",
  handstand_walk: "Handstand Walk",
  double_unders: "Double-Unders",
  pistols: "Pistols",
};

// Reverse lookup: display name (lowercased) → profile key
const DISPLAY_TO_KEY: Record<string, string> = {};
for (const [key, display] of Object.entries(SKILL_DISPLAY_NAMES)) {
  DISPLAY_TO_KEY[display.toLowerCase()] = key;
}
// Add common aliases the AI might use
DISPLAY_TO_KEY["muscle-ups"] = "muscle_ups";
DISPLAY_TO_KEY["muscle ups"] = "muscle_ups";
DISPLAY_TO_KEY["ring muscle-ups"] = "muscle_ups";
DISPLAY_TO_KEY["ring muscle ups"] = "muscle_ups";
DISPLAY_TO_KEY["bar muscle-ups"] = "bar_muscle_ups";
DISPLAY_TO_KEY["bar muscle ups"] = "bar_muscle_ups";
DISPLAY_TO_KEY["toes-to-bar"] = "toes_to_bar";
DISPLAY_TO_KEY["toes to bar"] = "toes_to_bar";
DISPLAY_TO_KEY["ttb"] = "toes_to_bar";
DISPLAY_TO_KEY["pull-ups"] = "strict_pull_ups";
DISPLAY_TO_KEY["strict pull-ups"] = "strict_pull_ups";
DISPLAY_TO_KEY["strict pull ups"] = "strict_pull_ups";
DISPLAY_TO_KEY["kipping pull-ups"] = "kipping_pull_ups";
DISPLAY_TO_KEY["kipping pull ups"] = "kipping_pull_ups";
DISPLAY_TO_KEY["butterfly pull-ups"] = "butterfly_pull_ups";
DISPLAY_TO_KEY["butterfly pull ups"] = "butterfly_pull_ups";
DISPLAY_TO_KEY["chest-to-bar pull-ups"] = "chest_to_bar_pull_ups";
DISPLAY_TO_KEY["chest-to-bar"] = "chest_to_bar_pull_ups";
DISPLAY_TO_KEY["c2b"] = "chest_to_bar_pull_ups";
DISPLAY_TO_KEY["rope climbs"] = "rope_climbs";
DISPLAY_TO_KEY["legless rope climbs"] = "legless_rope_climbs";
DISPLAY_TO_KEY["legless rope climb"] = "legless_rope_climbs";
DISPLAY_TO_KEY["wall-facing hspu"] = "wall_facing_hspu";
DISPLAY_TO_KEY["wall facing hspu"] = "wall_facing_hspu";
DISPLAY_TO_KEY["hspu"] = "hspu";
DISPLAY_TO_KEY["hspu (kipping)"] = "hspu";
DISPLAY_TO_KEY["kipping hspu"] = "hspu";
DISPLAY_TO_KEY["strict hspu"] = "strict_hspu";
DISPLAY_TO_KEY["deficit hspu"] = "deficit_hspu";
DISPLAY_TO_KEY["ring dips"] = "ring_dips";
DISPLAY_TO_KEY["l-sit"] = "l_sit";
DISPLAY_TO_KEY["l sit"] = "l_sit";
DISPLAY_TO_KEY["handstand walk"] = "handstand_walk";
DISPLAY_TO_KEY["handstand walks"] = "handstand_walk";
DISPLAY_TO_KEY["hs walk"] = "handstand_walk";
DISPLAY_TO_KEY["double-unders"] = "double_unders";
DISPLAY_TO_KEY["double unders"] = "double_unders";
DISPLAY_TO_KEY["dus"] = "double_unders";
DISPLAY_TO_KEY["pistols"] = "pistols";
DISPLAY_TO_KEY["pistol squats"] = "pistols";
DISPLAY_TO_KEY["pistol"] = "pistols";

// ── Main export ────────────────────────────────────────────────

export interface SkillPriority {
  skill: string;        // profile key (e.g. "toes_to_bar")
  displayName: string;  // prompt-friendly name
  level: string;        // current proficiency ("none" | "beginner" | ...)
  score: number;        // position in hierarchy (1 = highest)
  maxPerWeek: number;   // 2 for HIGH, 1 for MODERATE, 1 for LOW
}

/**
 * Parse a SKILLS HIERARCHY block from the AI analysis into SkillPriority[].
 *
 * Expected format:
 *   SKILLS HIERARCHY:
 *   1. Legless Rope Climbs — HIGH — reason text
 *   2. L-Sit — HIGH — reason text
 *   3. HSPU — MODERATE — reason text
 *   ...
 *
 * Falls back to a simple level-based ordering if parsing fails.
 */
export function parseSkillHierarchy(
  analysisText: string | null,
  skills: Record<string, string>,
): SkillPriority[] {
  if (!skills || Object.keys(skills).length === 0) return [];

  const parsed = tryParseHierarchy(analysisText, skills);
  if (parsed.length > 0) return parsed;

  // Fallback: simple level-based ordering (beginner > intermediate)
  console.warn("[skill-priorities] Failed to parse SKILLS HIERARCHY, using level-based fallback");
  return fallbackFromLevels(skills);
}

// Keep the old function name as an alias for backward compatibility
export const rankSkillPriorities = parseSkillHierarchy;

function tryParseHierarchy(
  analysisText: string | null,
  skills: Record<string, string>,
): SkillPriority[] {
  if (!analysisText) return [];

  // Extract the SKILLS HIERARCHY section
  const hierarchyMatch = analysisText.match(/SKILLS HIERARCHY:\s*\n([\s\S]*?)(?:\n\n|\z|$)/i);
  if (!hierarchyMatch) return [];

  const hierarchyBlock = hierarchyMatch[1];
  // Parse numbered lines: "1. Skill Name — HIGH — reason"
  const linePattern = /^\s*\d+\.\s*(.+?)\s*[—–-]\s*(HIGH|MODERATE|LOW)\s*[—–-]\s*(.*)$/gim;
  const entries: SkillPriority[] = [];
  const seen = new Set<string>();

  let match;
  let position = 0;
  while ((match = linePattern.exec(hierarchyBlock)) !== null) {
    position++;
    const rawName = match[1].trim();
    const priority = match[2].toUpperCase();

    // Resolve to profile key
    const skillKey = resolveSkillKey(rawName, skills);
    if (!skillKey || seen.has(skillKey)) continue;
    seen.add(skillKey);

    const level = skills[skillKey] ?? "beginner";
    const maxPerWeek = priority === "HIGH" ? 2 : 1;

    entries.push({
      skill: skillKey,
      displayName: SKILL_DISPLAY_NAMES[skillKey] ?? skillKey.replace(/_/g, " "),
      level,
      score: position,
      maxPerWeek,
    });
  }

  return entries;
}

/**
 * Resolve a free-text skill name from the AI to a profile key.
 * Tries exact match, then fuzzy matching against display names and aliases.
 */
function resolveSkillKey(
  rawName: string,
  skills: Record<string, string>,
): string | null {
  const lower = rawName.toLowerCase().trim();

  // Direct match on display-to-key map
  if (DISPLAY_TO_KEY[lower]) {
    const key = DISPLAY_TO_KEY[lower];
    if (key in skills) return key;
  }

  // Try as profile key directly (e.g. "l_sit")
  const asKey = lower.replace(/[\s-]+/g, "_");
  if (asKey in skills) return asKey;

  // Fuzzy: find the best matching display name
  let bestKey: string | null = null;
  let bestScore = 0;
  for (const [display, key] of Object.entries(DISPLAY_TO_KEY)) {
    if (!(key in skills)) continue;
    // Check if either contains the other
    if (lower.includes(display) || display.includes(lower)) {
      const score = Math.min(lower.length, display.length);
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
  }

  return bestKey;
}

/**
 * Fallback: rank by level (beginner first, then intermediate).
 * Used when AI hierarchy parsing fails.
 */
function fallbackFromLevels(skills: Record<string, string>): SkillPriority[] {
  const LEVEL_ORDER: Record<string, number> = {
    none: 0,
    beginner: 1,
    intermediate: 2,
    advanced: 3,
  };

  const entries: SkillPriority[] = [];
  for (const [key, level] of Object.entries(skills)) {
    const num = LEVEL_ORDER[level] ?? 0;
    if (num >= 3 || num === 0) continue; // skip advanced and none

    entries.push({
      skill: key,
      displayName: SKILL_DISPLAY_NAMES[key] ?? key.replace(/_/g, " "),
      level,
      score: num, // lower = higher priority (beginner=1 before intermediate=2)
      maxPerWeek: 2,
    });
  }

  // Sort: beginner first, then intermediate
  entries.sort((a, b) => a.score - b.score);

  // Top 2 get 2x/week, rest 1x/week
  for (let i = 0; i < entries.length; i++) {
    entries[i].maxPerWeek = i < 2 ? 2 : 1;
    entries[i].score = i + 1; // normalize to position
  }

  return entries;
}
