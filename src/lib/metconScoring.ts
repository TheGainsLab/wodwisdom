/**
 * Metcon Scoring Engine
 *
 * Calculates p50 (median) and p90 (excellent) benchmarks from structured
 * movement entries + work rates, then scores a user's result as a percentile.
 *
 * Ported from the mobile app's BTN scoring system.
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface MovementWorkRate {
  canonical_name: string;
  display_name: string;
  work_rate: number | null;           // reps per minute at median pace
  weight_degradation_rate: number | null; // 0.7–1.0
  modality: string;                   // W, G, M
}

export interface MetconEntry {
  movement: string;
  reps?: number | null;
  weight?: number | null;
  weight_unit?: string;
  distance?: number | null;
  distance_unit?: string | null;
}

export interface BenchmarkResult {
  medianScore: string;
  excellentScore: string;
}

export interface ScoringResult {
  percentile: number;          // 1–99
  performanceTier: string;     // Elite, Advanced, Good, Average, Below Average, Needs Improvement
  medianBenchmark: string;     // e.g. "6:30" or "8+15"
  excellentBenchmark: string;  // e.g. "4:15" or "11+3"
}

// ─── Constants ────────────────────────────────────────────────────────

const PERFORMANCE_FACTORS = {
  median: 1.00,
  excellent: 1.30,
};

const DEFAULT_WORK_RATE = 12.0; // fallback reps/min for unknown movements

// Barbell exercises that get weight degradation applied
const BARBELL_MOVEMENTS = new Set([
  'snatch', 'power_snatch', 'squat_snatch', 'hang_power_snatch', 'hang_squat_snatch',
  'clean', 'power_clean', 'squat_clean', 'hang_power_clean', 'hang_squat_clean',
  'clean_and_jerk', 'squat_clean_and_jerk',
  'deadlift', 'sumo_deadlift',
  'thruster', 'overhead_squat',
  'push_press', 'push_jerk', 'split_jerk', 'jerk',
  'shoulder_to_overhead', 'ground_to_overhead',
  'back_squat', 'front_squat',
  'press', 'strict_press', 'bench_press',
]);

// ─── Work rate lookup ─────────────────────────────────────────────────

/**
 * Look up work rate for a movement by matching display_name (case-insensitive).
 * Falls back to DEFAULT_WORK_RATE if no match found.
 */
function findWorkRate(
  movementName: string,
  workRates: MovementWorkRate[]
): MovementWorkRate | null {
  const normalized = movementName.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const wr of workRates) {
    // Match on display_name (case-insensitive, stripped)
    const displayNorm = wr.display_name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (displayNorm === normalized) return wr;

    // Match on canonical_name (underscores → stripped)
    const canonNorm = wr.canonical_name.replace(/_/g, '');
    if (canonNorm === normalized) return wr;
  }

  return null;
}

/**
 * Get adjusted work rate factoring in weight degradation and workout duration.
 */
function getAdjustedRate(
  entry: MetconEntry,
  workRates: MovementWorkRate[],
  estimatedDurationMin: number
): number {
  const match = findWorkRate(entry.movement, workRates);
  const baseRate = match?.work_rate ?? DEFAULT_WORK_RATE;

  // Weight degradation (barbell movements only)
  let weightMultiplier = 1.0;
  if (match && entry.weight && match.weight_degradation_rate != null) {
    const isBarbell = BARBELL_MOVEMENTS.has(match.canonical_name);
    if (isBarbell && entry.weight > 0) {
      // Simplified degradation: heavier weight = slower.
      // Without 1RM data, use weight / 225 as rough intensity proxy.
      const intensityProxy = Math.min(entry.weight / 225, 1.0);
      if (intensityProxy > 0.5) {
        weightMultiplier = 1.0 - ((intensityProxy - 0.5) * match.weight_degradation_rate);
      }
    }
  }

  // Time-domain pacing factor (longer workouts = slower pace)
  let repFactor = 1.0;
  if (estimatedDurationMin <= 5) repFactor = 1.0;
  else if (estimatedDurationMin <= 10) repFactor = 0.85;
  else if (estimatedDurationMin <= 15) repFactor = 0.75;
  else if (estimatedDurationMin <= 20) repFactor = 0.65;
  else repFactor = 0.55;

  return baseRate * weightMultiplier * repFactor;
}

/**
 * Convert a MetconEntry to "time in minutes" for one occurrence of that movement.
 * Handles both rep-based and distance-based movements.
 */
function entryTimeMinutes(
  entry: MetconEntry,
  workRates: MovementWorkRate[],
  estimatedDurationMin: number,
  paceFactor: number
): number {
  const match = findWorkRate(entry.movement, workRates);
  const adjustedRate = getAdjustedRate(entry, workRates, estimatedDurationMin) * paceFactor;

  if (adjustedRate <= 0) return 0;

  // Distance-based movement (e.g., 200m run, 500m row)
  if (entry.distance && entry.distance > 0) {
    const meterRate = match?.work_rate ?? 267; // default to run pace (m/min)
    // Apply time-domain pacing factor (longer workouts = slower pace)
    let repFactor = 1.0;
    if (estimatedDurationMin <= 5) repFactor = 1.0;
    else if (estimatedDurationMin <= 10) repFactor = 0.85;
    else if (estimatedDurationMin <= 15) repFactor = 0.75;
    else if (estimatedDurationMin <= 20) repFactor = 0.65;
    else repFactor = 0.55;
    const adjustedMeterRate = meterRate * paceFactor * repFactor;
    // Convert distance_unit to meters if needed
    let meters = entry.distance;
    if (entry.distance_unit === 'ft') meters = entry.distance * 0.3048;
    return meters / adjustedMeterRate;
  }

  // Rep-based movement
  const reps = entry.reps ?? 0;
  if (reps <= 0) return 0;
  return reps / adjustedRate;
}

// ─── Benchmark calculation ────────────────────────────────────────────

/**
 * Estimate the workout duration in minutes from entries at median pace.
 * Used to determine the pacing rep-factor.
 */
function estimateDuration(entries: MetconEntry[], workRates: MovementWorkRate[]): number {
  let totalMinutes = 0;
  for (const entry of entries) {
    const match = findWorkRate(entry.movement, workRates);
    const baseRate = match?.work_rate ?? DEFAULT_WORK_RATE;

    if (entry.distance && entry.distance > 0) {
      let meters = entry.distance;
      if (entry.distance_unit === 'ft') meters = entry.distance * 0.3048;
      totalMinutes += meters / (match?.work_rate ?? 267);
    } else {
      const reps = entry.reps ?? 0;
      if (reps > 0 && baseRate > 0) totalMinutes += reps / baseRate;
    }
  }
  return Math.max(totalMinutes, 1);
}

/**
 * Calculate AMRAP benchmarks: expected rounds+reps at median and excellent pace.
 */
function calculateAMRAPBenchmarks(
  entries: MetconEntry[],
  timeCap: number,
  workRates: MovementWorkRate[]
): BenchmarkResult {
  if (entries.length === 0) return { medianScore: '--', excellentScore: '--' };

  const estDur = timeCap;

  const calcRoundsReps = (paceFactor: number): string => {
    // Time per round
    let timePerRound = 0;
    for (const entry of entries) {
      timePerRound += entryTimeMinutes(entry, workRates, estDur, paceFactor);
    }
    if (timePerRound <= 0) return '0+0';

    const fullRounds = Math.floor(timeCap / timePerRound);
    const remaining = timeCap - fullRounds * timePerRound;

    // Partial reps in the next round
    let partialReps = 0;
    let timeLeft = remaining;
    for (const entry of entries) {
      const timeForEntry = entryTimeMinutes(entry, workRates, estDur, paceFactor);
      if (timeLeft >= timeForEntry) {
        partialReps += entry.reps ?? 0;
        timeLeft -= timeForEntry;
      } else {
        const rate = (entry.reps ?? 0) / (timeForEntry || 1);
        partialReps += Math.floor(rate * timeLeft);
        break;
      }
    }

    return `${fullRounds}+${partialReps}`;
  };

  return {
    medianScore: calcRoundsReps(PERFORMANCE_FACTORS.median),
    excellentScore: calcRoundsReps(PERFORMANCE_FACTORS.excellent),
  };
}

/**
 * Calculate For Time benchmarks: expected completion time at median and excellent pace.
 */
function calculateForTimeBenchmarks(
  entries: MetconEntry[],
  workRates: MovementWorkRate[],
  rounds: number = 1
): BenchmarkResult {
  if (entries.length === 0) return { medianScore: '--', excellentScore: '--' };

  const estDur = estimateDuration(entries, workRates) * rounds;

  const calcTime = (paceFactor: number): string => {
    let total = 0;
    for (const entry of entries) {
      total += entryTimeMinutes(entry, workRates, estDur, paceFactor);
    }
    return formatMinutesAsTime(total * rounds);
  };

  return {
    medianScore: calcTime(PERFORMANCE_FACTORS.median),
    excellentScore: calcTime(PERFORMANCE_FACTORS.excellent),
  };
}

/**
 * Calculate benchmarks for a metcon block.
 *
 * @param entries  - Structured movement entries for the metcon
 * @param workoutType - 'amrap', 'for_time', or 'emom'
 * @param blockText - Raw block text (used to extract AMRAP time cap)
 * @param workRates - Movement work rate data from the movements table
 */
export function calculateBenchmarks(
  entries: MetconEntry[],
  workoutType: string,
  blockText: string,
  workRates: MovementWorkRate[]
): BenchmarkResult {
  if (entries.length === 0) return { medianScore: '--', excellentScore: '--' };

  if (workoutType === 'amrap') {
    const timeCap = extractTimeCap(blockText);
    if (!timeCap) return { medianScore: '--', excellentScore: '--' };
    return calculateAMRAPBenchmarks(entries, timeCap, workRates);
  }

  if (workoutType === 'for_time') {
    const rounds = extractRoundCount(blockText);
    return calculateForTimeBenchmarks(entries, workRates, rounds);
  }

  // EMOM and other formats: no scoring for now
  return { medianScore: '--', excellentScore: '--' };
}

// ─── Percentile calculation ───────────────────────────────────────────

/**
 * Normal CDF approximation (Abramowitz & Stegun).
 */
function normalCDF(z: number): number {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2.0);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  if (z > 0) prob = 1.0 - prob;
  return prob;
}

/**
 * Calculate percentile from user score vs. benchmarks.
 *
 * @param userScore   - Parsed numeric score
 * @param medianScore - Parsed p50 numeric score
 * @param excellentScore - Parsed p90 numeric score
 * @param lowerIsBetter - true for For Time (lower = faster = better)
 */
function calculatePercentileFromScores(
  userScore: number,
  medianScore: number,
  excellentScore: number,
  lowerIsBetter: boolean
): number {
  const stdDev = Math.abs(excellentScore - medianScore) / 1.28;
  if (stdDev === 0) return 50;

  const zScore = (userScore - medianScore) / stdDev;
  const adjustedZ = lowerIsBetter ? -zScore : zScore;
  const pct = normalCDF(adjustedZ) * 100;

  return Math.max(1, Math.min(99, Math.round(pct)));
}

/**
 * Determine performance tier from percentile.
 */
export function getPerformanceTier(percentile: number): string {
  if (percentile >= 90) return 'Elite';
  if (percentile >= 75) return 'Advanced';
  if (percentile >= 60) return 'Good';
  if (percentile >= 40) return 'Average';
  if (percentile >= 25) return 'Below Average';
  return 'Needs Improvement';
}

/**
 * Full scoring pipeline: user score string + benchmarks → percentile + tier.
 */
export function scoreMetcon(
  userScoreStr: string,
  workoutType: string,
  benchmarks: BenchmarkResult
): { percentile: number; performanceTier: string } | null {
  if (benchmarks.medianScore === '--' || benchmarks.excellentScore === '--') return null;
  if (!userScoreStr.trim()) return null;

  const lowerIsBetter = workoutType === 'for_time';

  const userScore = parseScore(userScoreStr, workoutType);
  const medianScore = parseScore(benchmarks.medianScore, workoutType);
  const excellentScore = parseScore(benchmarks.excellentScore, workoutType);

  if (userScore === 0 || medianScore === 0 || excellentScore === 0) return null;

  const percentile = calculatePercentileFromScores(userScore, medianScore, excellentScore, lowerIsBetter);
  return { percentile, performanceTier: getPerformanceTier(percentile) };
}

// ─── Score parsing helpers ────────────────────────────────────────────

/**
 * Parse a score string to a numeric value for comparison.
 * - For Time: "6:45" → 405 (seconds)
 * - AMRAP: "8+15" → 8015 (rounds × 1000 + reps)
 */
export function parseScore(score: string, workoutType: string): number {
  const cleaned = score.trim();

  // AMRAP: "8+15" or "8 rounds + 15"
  if (workoutType === 'amrap') {
    const match = cleaned.match(/(\d+)\s*\+\s*(\d+)/);
    if (match) return parseInt(match[1]) * 1000 + parseInt(match[2]);
    // Bare number = total reps
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  // Time format: "6:45" or "1:23:45"
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':').map(p => parseInt(p));
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }

  return parseFloat(cleaned) || 0;
}

/**
 * Format minutes as MM:SS string.
 */
function formatMinutesAsTime(totalMinutes: number): string {
  const minutes = Math.floor(totalMinutes);
  const seconds = Math.round((totalMinutes - minutes) * 60);
  // Handle case where rounding gives 60 seconds
  if (seconds >= 60) return `${minutes + 1}:00`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Extract AMRAP time cap from block text (e.g., "AMRAP 12" → 12).
 */
function extractTimeCap(text: string): number | null {
  const match = text.match(/AMRAP\s+(\d+)/i);
  if (match) return parseInt(match[1]);
  // Also try "As Many Rounds As Possible in N minutes"
  const match2 = text.match(/(\d+)\s*min/i);
  if (match2) return parseInt(match2[1]);
  return null;
}

/**
 * Extract round count from For Time block text.
 * e.g. "2 Rounds For Time", "3 RFT", "4 rounds of:", "5 rounds:"
 * Returns 1 if no round count found.
 */
function extractRoundCount(text: string): number {
  const match = text.match(/(\d+)\s+(?:RFT|rounds?\s+for\s+time|rounds?\s+of\b|rounds?\s*[:\n])/i);
  if (match) return parseInt(match[1]);
  return 1;
}
