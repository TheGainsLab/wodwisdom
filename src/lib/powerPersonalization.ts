/**
 * Body-weight power personalization for Tier 4 competition results.
 *
 * The programming-profile bundle ships work/power computed at a default body
 * mass (84 kg M / 64 kg F — `body_mass_basis: "default_84m_64w"`). Bundle
 * 1.10.0 added `joules_bodyweight_component`: the body-mass-dependent share of
 * total `joules`. The bodyweight share scales linearly with mass; the external
 * (barbell / erg) share does not — so we rescale to the viewer's actual weight:
 *
 *   joules_personal = joules + bodyweight_component * (userKg / defaultKg - 1)
 *   watts_personal  = avgPowerWatts * (joules_personal / joules)   // time is invariant
 *   wPerKg          = watts_personal / userKg
 *
 * The recompute is mathematically exact (the model's body terms are linear in
 * mass), not an approximation. Cohort percentiles are deliberately NOT
 * personalized — they stay the default-mass comparison baseline.
 */

export const DEFAULT_MASS_MALE_KG = 84;
export const DEFAULT_MASS_FEMALE_KG = 64;

/**
 * The default body mass the bundle used for a result, from its competition
 * division code (1 = Men, 2 = Women). This is the authoritative denominator
 * for the rescale ratio — it's the mass the bundle's `joules` was computed at.
 * Unknown/other divisions fall back to the men's default.
 */
export function defaultMassForDivision(division: number | null | undefined): number {
  return division === 2 ? DEFAULT_MASS_FEMALE_KG : DEFAULT_MASS_MALE_KG;
}

/** Convert a stored bodyweight to kilograms. `units` is the profile's unit pref. */
export function bodyMassKg(
  weight: number | null | undefined,
  units: string | null | undefined,
): number | null {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return null;
  return units === 'lbs' ? weight * 0.45359237 : weight;
}

export interface ResultPowerInputs {
  /** Total prescribed work at default mass. */
  joules: number | null | undefined;
  /** Body-mass-dependent share of `joules` (bundle 1.10.0+). */
  joulesBodyweightComponent: number | null | undefined;
  /** Average power at default mass. */
  avgPowerWatts: number | null | undefined;
  /** Watts per kg at default mass — used for the fallback when personalization isn't possible. */
  avgWPerKg: number | null | undefined;
}

export interface PersonalizedPower {
  /** Total work at the viewer's body weight, or the default-mass value on fallback. */
  joules: number | null;
  /** Average power at the viewer's body weight, or the default-mass value on fallback. */
  watts: number | null;
  /** Watts per kg — of the viewer's actual weight when personalized, default-mass otherwise. */
  wPerKg: number | null;
  /** True when the body-weight rescale was applied; false = default-mass passthrough. */
  personalized: boolean;
}

/**
 * Rescale a result's work/power to the viewer's body weight.
 *
 * Falls back to the default-mass numbers (`personalized: false`) when the
 * bodyweight component is missing (bundle < 1.10.0, or an unmodeled movement
 * left `joules` null) or the viewer's body weight is unknown. The fallback is
 * never wrong — it's just the un-personalized number, which the UI should
 * label accordingly.
 */
export function personalizePower(
  inputs: ResultPowerInputs,
  userKg: number | null | undefined,
  defaultMassKg: number,
): PersonalizedPower {
  const { joules, joulesBodyweightComponent: bw, avgPowerWatts, avgWPerKg } = inputs;

  const j = typeof joules === 'number' && Number.isFinite(joules) ? joules : null;
  const w = typeof avgPowerWatts === 'number' && Number.isFinite(avgPowerWatts) ? avgPowerWatts : null;
  const wpk = typeof avgWPerKg === 'number' && Number.isFinite(avgWPerKg) ? avgWPerKg : null;

  const canPersonalize =
    j != null && j > 0 &&
    typeof bw === 'number' && Number.isFinite(bw) &&
    typeof userKg === 'number' && Number.isFinite(userKg) && userKg > 0 &&
    defaultMassKg > 0;

  if (!canPersonalize) {
    return { joules: j, watts: w, wPerKg: wpk, personalized: false };
  }

  const ratio = userKg! / defaultMassKg;
  const joulesPersonal = j! + bw! * (ratio - 1);
  const wattsPersonal = w != null ? w * (joulesPersonal / j!) : null;
  const wPerKg = wattsPersonal != null ? wattsPersonal / userKg! : null;

  return { joules: joulesPersonal, watts: wattsPersonal, wPerKg, personalized: true };
}
