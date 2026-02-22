// ============================================================
// TIME DOMAIN INFERENCE
// ============================================================
// Strategy:
//   1. If explicit time cap exists (AMRAP, EMOM, etc), use it directly
//   2. If no cap (FOR TIME, RFT), estimate from rep volume + load
//   3. Apply fixed boundaries: <7min = short, 7-15min = medium, >15min = long

export type TimeDomain = "short" | "medium" | "long";

const TIME_BOUNDARIES = { short: 7, long: 15 }; // minutes

function classifyMinutes(minutes: number): TimeDomain {
  if (minutes < TIME_BOUNDARIES.short) return "short";
  if (minutes <= TIME_BOUNDARIES.long) return "medium";
  return "long";
}

/**
 * Extract all numbers from a rep scheme string like "21-15-9" or "3-6-9-12..."
 * Returns the concrete numbers (ignores "..." continuation patterns)
 */
function parseRepScheme(text: string): number[] {
  const nums: number[] = [];
  const matches = text.match(/\d+/g);
  if (matches) {
    for (const m of matches) {
      const n = parseInt(m, 10);
      if (!isNaN(n) && n < 1000) nums.push(n); // ignore weights (1000+), calorie counts, etc.
    }
  }
  return nums;
}

/**
 * Count total reps in a workout text.
 * Handles patterns like:
 *   "21-15-9: Thrusters, Pull-ups" → (21+15+9) * 2 movements = 90
 *   "5 RFT: 10 Cleans, 15 Burpees, 20 Cal Row" → 5 * (10+15+20) = 225
 *   "3 Squat Cleans, 6 Box Jump Overs, 9 T2B" → 3+6+9 = 18 (per round)
 */
function estimateTotalReps(text: string): number {
  const t = text.toLowerCase();

  // Pattern: descending/ascending scheme like "21-15-9" or "15-12-9-6-3"
  const schemeMatch = t.match(/(\d+(?:\s*[-–]\s*\d+){2,})/);
  if (schemeMatch) {
    const nums = parseRepScheme(schemeMatch[1]);
    const schemeEnd = t.indexOf(schemeMatch[0]) + schemeMatch[0].length;
    const afterScheme = text.slice(schemeEnd);
    const movementCount = Math.max(1, (afterScheme.match(/,/g) || []).length + 1);
    const totalPerMovement = nums.reduce((sum, n) => sum + n, 0);
    return totalPerMovement * movementCount;
  }

  // Pattern: "N RFT" or "N Rounds For Time" — multiply rounds by per-round reps
  const rftMatch = t.match(/(\d+)\s*(?:rft|rounds?\s*(?:for\s*time)?)/i);
  if (rftMatch) {
    const rounds = parseInt(rftMatch[1], 10);
    // Parse only the part after the colon to avoid counting round number as reps
    const colonIdx = t.indexOf(":");
    const workPart = colonIdx >= 0 ? t.slice(colonIdx + 1) : t;
    const repNums = workPart.match(/(\d+)\s+(?:[a-z])/gi) || [];
    let perRound = 0;
    for (const r of repNums) {
      const n = parseInt(r, 10);
      if (n > 0 && n < 200) perRound += n;
    }
    if (perRound > 0) return rounds * perRound;
    return rounds * 30; // rough average fallback
  }

  // Pattern: FOR TIME without explicit rounds — single pass
  const allNums = t.match(/(\d+)\s+(?:[a-z])/gi) || [];
  let total = 0;
  for (const r of allNums) {
    const n = parseInt(r, 10);
    if (n > 0 && n < 200) total += n;
  }

  return total > 0 ? total : 50; // default to medium-ish if can't parse
}

export function inferTimeDomain(text: string): TimeDomain {
  const t = text.toLowerCase();

  // ============================================================
  // EXPLICIT TIME CAPS — use the number directly
  // ============================================================

  // AMRAP N or "As many rounds as possible in N minutes"
  const amrapMatch = t.match(/amrap\s*(\d+)|as\s+many.*?(\d+)\s*min/i);
  if (amrapMatch) {
    const mins = parseInt(amrapMatch[1] || amrapMatch[2] || "10", 10);
    return classifyMinutes(mins);
  }

  // EMOM N (every minute on the minute for N minutes)
  const emomMatch = t.match(/emom\s*(\d+)/i);
  if (emomMatch) {
    const mins = parseInt(emomMatch[1], 10);
    return classifyMinutes(mins);
  }

  // E2MOM, E3MOM, etc. — "every N minutes for X minutes" or "every N min x Y sets"
  const enmomMatch = t.match(/e(\d+)mom\s*(?:x\s*)?(\d+)?/i);
  if (enmomMatch) {
    const interval = parseInt(enmomMatch[1], 10);
    const sets = enmomMatch[2] ? parseInt(enmomMatch[2], 10) : null;
    if (sets) {
      return classifyMinutes(interval * sets);
    }
    const totalMatch = t.match(/(\d+)\s*min/);
    if (totalMatch) return classifyMinutes(parseInt(totalMatch[1], 10));
    return "medium";
  }

  // "Every N minutes for X minutes"
  const everyMatch = t.match(/every\s+(\d+)\s*min.*?(?:for\s+)?(\d+)\s*min/i);
  if (everyMatch) {
    return classifyMinutes(parseInt(everyMatch[2], 10));
  }

  // Tabata — always 4 minutes per movement, but multi-movement tabata is longer
  if (/tabata/i.test(t)) {
    const commaCount = (t.match(/,/g) || []).length;
    const movements = commaCount + 1;
    return classifyMinutes(movements * 4);
  }

  // Death By — typically runs 8-15 minutes depending on movement
  if (/death\s*by/i.test(t)) {
    return "medium";
  }

  // ============================================================
  // NO EXPLICIT CAP — estimate from volume
  // ============================================================

  // Strength work (5x3, 3x5, @75%) — typically 10-15 min
  if (/\d+\s*x\s*\d+|@\d+%/i.test(t)) {
    const hasMetcon = /amrap|for\s+time|rft|rounds/i.test(t);
    if (hasMetcon) return "medium";
    return "medium";
  }

  // FOR TIME / Rounds For Time — estimate from rep volume
  const totalReps = estimateTotalReps(t);

  if (totalReps < 100) return "short";
  if (totalReps <= 300) return "medium";
  return "long";
}
