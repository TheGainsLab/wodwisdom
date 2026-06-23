// Where each Engine day type sits on the slow→fast (oxidative→glycolytic) axis.
// Derived from the block prescription's paceRange (a fraction of the athlete's
// time-trial baseline; 1.00 = baseline) plus work/rest structure — NOT a
// hand-assigned guess. Axis: 0 = slowest (Z2 aerobic base), 100 = fastest
// (max-effort sprint).
//
//   lo/hi    = the highlighted span on the axis.
//   gradient = a "base + surge" day (flux / bursts / full-spectrum): anchored at
//              lo, reaching toward hi — rendered as a fade so it doesn't read as
//              a flat band sitting in the middle.

export interface DayTypeSpectrum { lo: number; hi: number; gradient?: boolean }

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

/** Short, position-derived caption (no fabricated coaching claims). */
export function spectrumCaption(s: DayTypeSpectrum): string {
  const span = s.hi - s.lo;
  if (span >= 55) return 'Full spectrum — slow base to max power';
  const mid = (s.lo + s.hi) / 2;
  if (mid < 24) return 'Aerobic base · slow, oxidative';
  if (mid < 42) return 'Aerobic · base to threshold';
  if (mid < 56) return 'Threshold · sustained hard';
  if (mid < 72) return 'Aerobic power · VO₂ effort';
  return 'Glycolytic · fast, max power';
}
