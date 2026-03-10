/**
 * Clean a FatSecret serving description for display in summary lines.
 * - Strips parenthetical noise like "(2-1/4" to 3" dia, raw)"
 * - Combines number_of_units + serving_description without doubling the quantity
 */
export function cleanServing(
  numberOfUnits: number,
  servingDescription: string | null
): string {
  const desc = (servingDescription || 'serving').trim();

  // Strip parentheticals: "1 medium (2-1/4" to 3" dia, raw)" → "1 medium"
  const cleaned = desc.replace(/\s*\(.*?\)\s*/g, '').trim();

  // Check if the description already starts with a number (e.g. "1 medium", "1100 g")
  const startsWithNumber = /^\d/.test(cleaned);

  if (startsWithNumber) {
    // Description already has a quantity — use units as a multiplier only if != 1
    if (numberOfUnits === 1 || numberOfUnits === 0) {
      return cleaned;
    }
    return `${numberOfUnits} x ${cleaned}`;
  }

  // Description has no leading number (e.g. "serving", "cup") — prepend the amount
  return `${numberOfUnits} ${cleaned}`;
}
