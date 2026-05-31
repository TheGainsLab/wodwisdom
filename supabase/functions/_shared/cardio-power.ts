/**
 * cardio-power.ts — power for a logged standalone cardio block.
 *
 * Cardio machines (Concept2 Row/Bike/Ski ergs, Echo/Assault fan bikes) display
 * average watts directly — a device-MEASURED number. We never send cardio to
 * work-calc; the athlete logs the machine's avg watts (+ the work time when
 * known) and the rest is arithmetic:
 *
 *   avg_power_watts = the logged watts
 *   joules          = avg_watts × work_seconds   (null without a time)
 *   avg_w_per_kg    = avg_watts ÷ body_mass_kg   (null without a bodyweight)
 *
 * Watts alone is enough to store — it is the headline number. Time only adds
 * joules; bodyweight only adds w/kg. Missing watts → null (nothing to store).
 */

const LBS_PER_KG = 0.45359237;

export interface CardioPowerResult {
  /** avg_watts × work_seconds, or null when no work time was logged. */
  joules: number | null;
  avg_power_watts: number;
  /** avg_watts ÷ body mass, or null when bodyweight is unknown. */
  avg_w_per_kg: number | null;
  body_mass_kg: number | null;
  /** The logged work duration in seconds, or null when none was logged. */
  work_seconds: number | null;
}

/** Stored bodyweight → kilograms. Null when unusable. */
function bodyweightToKg(weight: unknown, units: unknown): number | null {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) return null;
  return units === "lbs" ? weight * LBS_PER_KG : weight;
}

/**
 * Compute the power columns for a logged cardio block from the machine-displayed
 * average watts + the work duration. Returns null when no usable watts were
 * logged — there is nothing to store. Time and bodyweight are optional: they
 * only add joules / w_per_kg respectively.
 */
export function computeCardioPower(
  avgWatts: number | null | undefined,
  workSeconds: number | null | undefined,
  bodyweight: number | null,
  units: string | null,
): CardioPowerResult | null {
  if (typeof avgWatts !== "number" || !Number.isFinite(avgWatts) || avgWatts <= 0) {
    return null;
  }
  const watts = Math.round(avgWatts * 10) / 10;
  const bodyMassKg = bodyweightToKg(bodyweight, units);
  const hasTime =
    typeof workSeconds === "number" && Number.isFinite(workSeconds) && workSeconds > 0;
  const seconds = hasTime ? Math.round(workSeconds as number) : null;

  return {
    joules: seconds != null ? Math.round(watts * seconds) : null,
    avg_power_watts: watts,
    avg_w_per_kg:
      bodyMassKg != null && bodyMassKg > 0
        ? Math.round((watts / bodyMassKg) * 100) / 100
        : null,
    body_mass_kg: bodyMassKg,
    work_seconds: seconds,
  };
}
