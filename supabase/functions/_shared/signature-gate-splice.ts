// signature-gate-splice — the arithmetic that makes gated workouts
// scoreable (founder reframe, 2026-11-04): a real user never hits a wall,
// because they don't get tasks they cannot do. The engine predicts the
// POSSESSION-CONDITIONAL distribution (it assumes the athlete performs
// the movements); the worldwide field includes everyone parked at the
// wall. The two reconcile by splice, not by remodeling:
//
//   worldwide = wall_mass + (1 − wall_mass) × conditional
//
// Everyone below the wall is below the possessor by construction, so a
// possessor's conditional placement maps to worldwide by compressing it
// into the above-wall band. The wall mass is measured, not modeled: the
// gate catalog's pile (signature_gate_catalog) locates it on the
// observed percentile curve.
//
// Pure math, no data access — mirrors the fit module's discipline.

/** One point of an observed percentile curve: at field percentile `p`
 *  (0..100, 0 = worst), the score was `s`; `fin` says whether that score
 *  is a finisher time (seconds, lower = better) or a rep count (higher =
 *  better). null = the leaderboard had one score unit for everyone. */
export interface CurvePoint {
  p: number;
  s: number;
  fin: boolean | null;
}

/** Possession-conditional percentile → worldwide percentile (both 0..100).
 *  wallMass = fraction of the field at or below the wall (0..1). */
export function spliceGatedPercentile(conditionalPct: number, wallMass: number): number {
  const w = Math.min(Math.max(wallMass, 0), 1);
  const c = Math.min(Math.max(conditionalPct, 0), 100);
  return 100 * w + (1 - w) * c;
}

/** Inverse: worldwide percentile → possession-conditional percentile.
 *  Below the wall there is no conditional placement; returns 0 there. */
export function unspliceGatedPercentile(worldwidePct: number, wallMass: number): number {
  const w = Math.min(Math.max(wallMass, 0), 1);
  if (w >= 1) return 0;
  const p = Math.min(Math.max(worldwidePct, 0), 100);
  return Math.max(0, (p - 100 * w) / (1 - w));
}

/** Read the score at field percentile `target` off the observed grid, by
 *  linear interpolation between the bracketing points. Clamps to the
 *  grid's ends. Returns the score and the finisher flag of the NEAREST
 *  grid point (units don't interpolate). */
export function scoreAtPercentile(
  points: CurvePoint[],
  target: number,
): { s: number; fin: boolean | null } | null {
  if (!points || points.length === 0) return null;
  const pts = [...points].sort((a, b) => a.p - b.p);
  if (target <= pts[0].p) return { s: pts[0].s, fin: pts[0].fin };
  if (target >= pts[pts.length - 1].p) {
    const last = pts[pts.length - 1];
    return { s: last.s, fin: last.fin };
  }
  for (let i = 1; i < pts.length; i++) {
    if (target <= pts[i].p) {
      const a = pts[i - 1], b = pts[i];
      // units must match to interpolate; across a finisher boundary,
      // take the nearer point verbatim
      if (a.fin !== b.fin) {
        return target - a.p <= b.p - target ? { s: a.s, fin: a.fin } : { s: b.s, fin: b.fin };
      }
      const t = (target - a.p) / (b.p - a.p);
      return { s: a.s + t * (b.s - a.s), fin: a.fin };
    }
  }
  return null;
}

/** Locate the wall on the observed grid from the gate catalog's pile
 *  score: the wall mass is the highest field percentile still at or
 *  below the pile (rep-ranked curves ascend; a tie group shares the
 *  pile score, so the TOP of the tie is the wall's upper edge).
 *  Returns 0..1, or null when the grid never reaches the pile (no
 *  visible wall in this field). Only meaningful on rep-ranked segments
 *  (fin !== true). */
export function wallMassFromCurve(points: CurvePoint[], pileAtScore: number): number | null {
  const reps = points.filter((pt) => pt.fin !== true).sort((a, b) => a.p - b.p);
  if (reps.length === 0) return null;
  let mass: number | null = null;
  for (const pt of reps) {
    if (pt.s <= pileAtScore) mass = pt.p / 100;
  }
  return mass;
}

/** Where a score lands on the observed grid, as a field percentile —
 *  the inverse of scoreAtPercentile, restricted to grid points of the
 *  matching unit (wantTime: finisher seconds, descending with rank;
 *  otherwise rep counts, ascending). Clamps to the matching segment's
 *  ends. null when fewer than two matching points exist. */
export function percentileAtScore(
  points: CurvePoint[],
  score: number,
  wantTime: boolean,
): number | null {
  const seg = points
    .filter((pt) => (pt.fin === true) === wantTime)
    .sort((a, b) => a.p - b.p);
  if (seg.length < 2) return null;
  // better = higher percentile: reps ascend with p, times descend with p
  const better = (x: number, y: number) => (wantTime ? x < y : x > y);
  if (!better(score, seg[0].s) && score !== seg[0].s) return seg[0].p;
  const last = seg[seg.length - 1];
  if (better(score, last.s) || score === last.s) return last.p;
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i - 1], b = seg[i];
    const between = wantTime
      ? score <= a.s && score >= b.s
      : score >= a.s && score <= b.s;
    if (between && a.s !== b.s) {
      const t = (score - a.s) / (b.s - a.s);
      return a.p + t * (b.p - a.p);
    }
    if (between) return (a.p + b.p) / 2; // flat tie group
  }
  return null;
}

/** Conditional (above-wall) quartiles read off the whole-field grid:
 *  conditional pX lives at field percentile wall + (1−wall)·X. */
export function conditionalQuartiles(
  points: CurvePoint[],
  wallMass: number,
): { p25: CurvePoint | null; p50: CurvePoint | null; p75: CurvePoint | null } {
  const at = (x: number) => {
    const r = scoreAtPercentile(points, spliceGatedPercentile(x, wallMass));
    return r ? { p: x, s: r.s, fin: r.fin } : null;
  };
  return { p25: at(25), p50: at(50), p75: at(75) };
}
