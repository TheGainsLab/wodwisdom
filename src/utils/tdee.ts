const ACTIVITY_MULTIPLIER = 1.6;

/**
 * Calculate BMR using Mifflin-St Jeor equation.
 * Weight in kg, height in cm, age in years.
 */
export function calculateBMR(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: 'male' | 'female',
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === 'male' ? base + 5 : base - 161;
}

/**
 * Calculate TDEE from profile data.
 * Handles unit conversion (lbs→kg, in→cm) automatically.
 * Returns { bmr, tdee } or null if insufficient data.
 */
export function calculateTDEE(profile: {
  bodyweight?: number | null;
  height?: number | null;
  age?: number | null;
  gender?: string | null;
  units?: string;
}): { bmr: number; tdee: number } | null {
  const { bodyweight, height, age, gender, units } = profile;
  if (!bodyweight || !height || !age || !gender) return null;
  if (gender !== 'male' && gender !== 'female') return null;

  const weightKg = units === 'lbs' ? bodyweight * 0.453592 : bodyweight;
  const heightCm = units === 'lbs' ? height * 2.54 : height;

  const bmr = calculateBMR(weightKg, heightCm, age, gender);
  const tdee = Math.round(bmr * ACTIVITY_MULTIPLIER);

  return { bmr: Math.round(bmr), tdee };
}
