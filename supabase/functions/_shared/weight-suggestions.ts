/**
 * Compute suggested weight for a movement from athlete profile and prescribed load.
 * Used by parse-workout to pre-fill Start Workout weight inputs.
 */

export interface AthleteProfileForWeights {
  lifts?: Record<string, number> | null;
  units?: string | null;
}

/** Movement canonical names that map to different profile lift keys */
const MOVEMENT_TO_PROFILE_LIFT: Record<string, string> = {
  strict_press: "press",
};

/**
 * Compute suggested weight in profile units from load string and 1RM.
 * Returns null if no suggestion can be made.
 */
export function suggestWeight(
  load: string,
  canonical: string,
  profile: AthleteProfileForWeights | null | undefined
): number | null {
  if (!profile?.lifts || Object.keys(profile.lifts).length === 0) return null;

  const profileKey = MOVEMENT_TO_PROFILE_LIFT[canonical] ?? canonical;
  const oneRm = profile.lifts[profileKey];
  if (!oneRm || oneRm <= 0) return null;

  const trimmed = load.trim();
  if (!trimmed || trimmed === "BW") return null;

  // Percentage: @80% or 80%
  const pctMatch = trimmed.match(/(\d+)\s*%/);
  if (pctMatch) {
    const pct = parseInt(pctMatch[1], 10);
    if (pct > 0 && pct <= 100) {
      return Math.round(oneRm * (pct / 100));
    }
  }

  // Prescribed weight: 135, 95, etc.
  const numMatch = trimmed.match(/^(\d+)(?:\/\d+)?$/);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }

  // Slash format 135/95 — use first (typically M)
  const slashMatch = trimmed.match(/^(\d+)\s*\/\s*\d+$/);
  if (slashMatch) {
    return parseInt(slashMatch[1], 10);
  }

  return null;
}
