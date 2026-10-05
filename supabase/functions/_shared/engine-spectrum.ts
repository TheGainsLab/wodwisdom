/**
 * engine-spectrum.ts
 *
 * Where each Engine day type sits on the slow→fast (oxidative→glycolytic)
 * axis, and the reduction of Engine training into minutes-in-zone. Server
 * mirror of src/lib/dayTypeSpectrum.ts (same table, same derivation — keep
 * them in sync), extended with the zone arithmetic the program generator
 * consumes.
 *
 * The axis is 0–100, derived from each day type's block prescription:
 * paceRange as a fraction of the athlete's 10-minute time-trial baseline
 * (1.00 = baseline) plus work/rest structure. NOT hand-assigned vibes.
 *
 * ZONES — four named intensity bands, anchored to pace fractions of the
 * time trial and mapped onto the axis through the same calibration points
 * the spectrum table itself encodes (0.70 ≈ 8–16, 0.75 ≈ 18, 0.85–0.95 ≈
 * 42–50, 0.95 ≈ 50–56, 1.05 ≈ 70, max ≈ 86–96):
 *   base          pace < 0.75×TT   → axis [0, 18)
 *   tempo         0.75–0.95×TT     → axis [18, 53)
 *   aerobic_power 0.95–1.10×TT     → axis [53, 70)
 *   anaerobic     above 1.10×TT    → axis [70, 100]
 *
 * TIME-IN-ZONE is minutes-weighted and overlap-proportional: a day's
 * minutes spread across every zone its span overlaps, in proportion to the
 * overlap. Gradient ("base + surge") days do NOT spread uniformly — a
 * polarized 8–92 day is Z2 work punctured by max bursts, and a uniform
 * spread would invent tempo minutes that never happen. Instead their mass
 * splits toward the span's two ends (70% into a 10-point band at the
 * anchor end, 30% into a 10-point band at the surge end), which is honest
 * about the bimodal structure while staying deterministic and
 * assumption-light.
 */

export interface DayTypeSpectrum {
  lo: number;
  hi: number;
  /** base + surge / full-spectrum day: mass sits at the ends, not the middle. */
  gradient?: boolean;
}

export const DAY_TYPE_SPECTRUM: Record<string, DayTypeSpectrum> = {
  // Single-intensity points
  endurance:         { lo: 8,  hi: 16 },             // 0.70 base, 20–60 min continuous
  threshold:         { lo: 42, hi: 50 },             // 0.85–0.95, 8–18 min continuous
  anaerobic:         { lo: 86, hi: 96 },             // max effort, 5× rest sprints
  time_trial:        { lo: 56, hi: 66 },             // 10-min max effort = aerobic power

  // Contiguous bands
  devour:            { lo: 42, hi: 56 },             // 0.85–1.00, 3–6 min work
  descending_devour: { lo: 44, hi: 56 },             // 0.90–1.05, decreasing rest
  ascending_devour:  { lo: 46, hi: 64 },             // 0.90–1.05, increasing pace
  towers:            { lo: 18, hi: 62 },             // 0.75–1.05 aerobic blocks
  max_aerobic_power: { lo: 50, hi: 64 },             // 0.85–1.05 VO2 intervals
  hybrid_aerobic:    { lo: 52, hi: 64 },             // 0.90–1.05
  rocket_races_a:    { lo: 56, hi: 68 },             // 0.95–1.10, long rest
  rocket_races_b:    { lo: 56, hi: 68 },             // inherits part A
  interval:          { lo: 40, hi: 80 },             // 0.80–1.10, broad
  ascending:         { lo: 56, hi: 86 },             // 0.90–1.30, climbing
  atomic:            { lo: 70, hi: 88 },             // max-effort short bursts
  hybrid_anaerobic:  { lo: 70, hi: 84 },             // 1.05–1.20, above baseline

  // Base + surge / full spectrum (gradient)
  flux:              { lo: 10, hi: 45, gradient: true }, // 0.70 base + 0.75–0.95 surges
  flux_stages:       { lo: 10, hi: 52, gradient: true }, // base + climbing surges
  polarized:         { lo: 8,  hi: 92, gradient: true }, // Z2 + 7-sec max bursts
  infinity:          { lo: 46, hi: 82, gradient: true }, // escalating 0.85→1.20
  afterburner:       { lo: 40, hi: 92, gradient: true }, // aerobic + max sprints
  synthesis:         { lo: 12, hi: 96, gradient: true }, // max sprints + aerobic
};

export type EngineZone = "base" | "tempo" | "aerobic_power" | "anaerobic";

export const ENGINE_ZONES: ReadonlyArray<{ zone: EngineZone; lo: number; hi: number }> = [
  { zone: "base", lo: 0, hi: 18 },
  { zone: "tempo", lo: 18, hi: 53 },
  { zone: "aerobic_power", lo: 53, hi: 70 },
  { zone: "anaerobic", lo: 70, hi: 100 },
];

export type ZoneMinutes = Record<EngineZone, number>;

export function emptyZoneMinutes(): ZoneMinutes {
  return { base: 0, tempo: 0, aerobic_power: 0, anaerobic: 0 };
}

/** Distribute one contiguous span's minutes across the zones it overlaps,
 *  proportionally to the overlap. A zero-width span (lo === hi) is a point:
 *  all minutes land in the zone containing it. */
function spreadSpan(out: ZoneMinutes, lo: number, hi: number, minutes: number): void {
  const width = hi - lo;
  if (width <= 0) {
    const z = ENGINE_ZONES.find((b) => lo < b.hi) ?? ENGINE_ZONES[ENGINE_ZONES.length - 1];
    out[z.zone] += minutes;
    return;
  }
  for (const b of ENGINE_ZONES) {
    const overlap = Math.min(hi, b.hi) - Math.max(lo, b.lo);
    if (overlap > 0) out[b.zone] += minutes * (overlap / width);
  }
}

/** Minutes-in-zone for one day type. Gradient days split 70/30 into
 *  10-point bands at the two ends of their span (see the module header).
 *  Unknown day types return null — the caller decides whether to drop or
 *  count them. */
export function dayTypeZoneMinutes(dayType: string, minutes: number): ZoneMinutes | null {
  const s = DAY_TYPE_SPECTRUM[dayType];
  if (!s || !Number.isFinite(minutes) || minutes <= 0) return null;
  const out = emptyZoneMinutes();
  if (s.gradient) {
    const end = Math.min(10, (s.hi - s.lo) / 2);
    spreadSpan(out, s.lo, s.lo + end, minutes * 0.7);
    spreadSpan(out, s.hi - end, s.hi, minutes * 0.3);
  } else {
    spreadSpan(out, s.lo, s.hi, minutes);
  }
  return out;
}

/** Reduce a set of (day type, minutes) observations — completed sessions or
 *  upcoming catalog days — to total minutes-in-zone. Days with an unknown
 *  day type or no minutes are skipped (and tallied) rather than guessed. */
export function computeTimeInZone(
  days: Array<{ dayType: string | null; minutes: number | null }>,
): { zones: ZoneMinutes; minutesCounted: number; daysSkipped: number } {
  const zones = emptyZoneMinutes();
  let minutesCounted = 0;
  let daysSkipped = 0;
  for (const d of days) {
    const z = d.dayType != null && d.minutes != null
      ? dayTypeZoneMinutes(d.dayType, d.minutes)
      : null;
    if (!z) {
      daysSkipped++;
      continue;
    }
    for (const b of ENGINE_ZONES) zones[b.zone] += z[b.zone];
    minutesCounted += d.minutes as number;
  }
  for (const b of ENGINE_ZONES) zones[b.zone] = Math.round(zones[b.zone]);
  return { zones, minutesCounted, daysSkipped };
}

/** The zones a day type's span touches, in axis order — a compact label for
 *  listing upcoming catalog days without pretending to minute precision. */
export function zonesTouched(dayType: string): EngineZone[] {
  const z = dayTypeZoneMinutes(dayType, 60);
  if (!z) return [];
  return ENGINE_ZONES.filter((b) => z[b.zone] > 0).map((b) => b.zone);
}
