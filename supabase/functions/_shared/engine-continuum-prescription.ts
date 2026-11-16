/**
 * engine-continuum-prescription — the prescription behind a session, in the
 * shape the continuum module wants, derived from a catalog day through the
 * SAME expansion the day page uses (engine-block-resolve).
 *
 * One entry per block with the LONGEST work segment (decided 2026-11-16: the
 * bout the athlete had to sustain); continuous blocks (polarized / flux base)
 * as their whole work time; max-effort blocks flagged.
 */

import { type CatalogEngineDay, resolveSegments } from "./engine-block-resolve.ts";
import type { PrescriptionBlock } from "./engine-continuum.ts";

export function prescriptionFromCatalog(day: CatalogEngineDay | null): { blocks: PrescriptionBlock[] } | null {
  if (!day) return null;
  let segs;
  try {
    segs = resolveSegments(day);
  } catch {
    return null;
  }
  const byBlock = new Map<number, { longest: number; total: number; rest: number; pace: number | null; maxEffort: boolean; continuous: boolean }>();
  for (const s of segs) {
    const b = byBlock.get(s.block_index) ?? { longest: 0, total: 0, rest: 0, pace: null, maxEffort: false, continuous: false };
    if (s.type === "work") {
      b.total += s.duration_seconds;
      if (s.label === "Base" || s.label === "Flux" || s.label === "BURST") b.continuous = true;
      // A block is max effort when its LONGEST work segment is — a 7-second
      // burst inside 20 minutes of zone 2 (polarized) does not make the
      // block a max effort.
      const segMax = s.label === "Max Effort" || (s.pace_frac == null && s.intensity === "MAX");
      if (s.duration_seconds > b.longest) {
        b.longest = s.duration_seconds;
        b.pace = s.pace_frac;
        b.maxEffort = segMax;
      }
    } else {
      b.rest += s.duration_seconds;
    }
    byBlock.set(s.block_index, b);
  }
  const blocks: PrescriptionBlock[] = [...byBlock.values()].map((b) => ({
    work_seconds: b.continuous ? b.total : b.longest,
    rest_seconds: b.rest,
    pace_multiple: b.maxEffort ? null : b.pace,
    max_effort: b.maxEffort,
    continuous: b.continuous,
  }));
  return blocks.length ? { blocks } : null;
}
