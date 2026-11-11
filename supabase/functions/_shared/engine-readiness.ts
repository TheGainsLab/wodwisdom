/**
 * engine-readiness — which day types an athlete is READY for, and the
 * week-level rules a generated block must satisfy. Pure functions, no I/O.
 *
 * Founder decisions, 2026-11-10 (docs/engine_day_type_guidance_draft.md and
 * the self-sequencing plan addendum):
 *  - Readiness replaces the calendar. A type is ready when every one of its
 *    prerequisites has been COMPLETED at least MIN_COMPLETIONS times, counted
 *    across all modalities, at any ratio. Types with no prerequisites are
 *    always ready. time_trial is always in the pool.
 *  - No novelty budget: prerequisites are the only reveal control.
 *  - Rocket Races A and B are a pair: any block containing A must contain B
 *    after it; B never appears without A before it in the same block. B's
 *    rounds/work/pace inherit from A via the envelope sentinels — only rest
 *    differs — so the pairing check is presence and order.
 *  - Other assess types (not time_trial, not rocket_races_b): at most one
 *    per block.
 */

export const MIN_COMPLETIONS = 2;

export interface ReadinessTypeRow {
  id: string;
  class: "develop" | "assess";
  prerequisites: string[];
}

/**
 * The set of day-type ids the athlete may be given, from completed-session
 * counts per type (all modalities together).
 */
export function computeReadyDayTypes(
  types: ReadinessTypeRow[],
  completedByType: Record<string, number>,
  minCompletions: number = MIN_COMPLETIONS,
): Set<string> {
  const ready = new Set<string>(["time_trial"]);
  for (const t of types) {
    const ok = (t.prerequisites ?? []).every((p) => (completedByType[p] ?? 0) >= minCompletions);
    if (ok) ready.add(t.id);
  }
  return ready;
}

/** Human-readable "why not" for a type that is not ready — for logs and the admin preview. */
export function missingPrerequisites(
  type: ReadinessTypeRow,
  completedByType: Record<string, number>,
  minCompletions: number = MIN_COMPLETIONS,
): string[] {
  return (type.prerequisites ?? []).filter((p) => (completedByType[p] ?? 0) < minCompletions)
    .map((p) => `${p} (${completedByType[p] ?? 0}/${minCompletions})`);
}

export interface WeekRuleDay {
  day_type: string;
}

/**
 * Block-level rules. Returns the errors; an empty array means the block is
 * acceptable as a whole. Callers reject the whole proposal on any error —
 * dropping a single day would silently break a pair.
 */
export function validateWeekRules(
  days: WeekRuleDay[],
  classById: Map<string, "develop" | "assess">,
): string[] {
  const errors: string[] = [];
  const idxA = days.findIndex((d) => d.day_type === "rocket_races_a");
  const idxB = days.findIndex((d) => d.day_type === "rocket_races_b");
  if (idxA >= 0 && idxB < 0) errors.push("rocket_races_a scheduled without rocket_races_b in the same block (pairing rule).");
  if (idxB >= 0 && idxA < 0) errors.push("rocket_races_b scheduled without rocket_races_a before it in the same block (pairing rule).");
  if (idxA >= 0 && idxB >= 0 && idxB < idxA) errors.push("rocket_races_b must come after rocket_races_a (pairing rule).");
  if (idxA >= 0 && idxB >= 0) {
    const aCount = days.filter((d) => d.day_type === "rocket_races_a").length;
    const bCount = days.filter((d) => d.day_type === "rocket_races_b").length;
    if (aCount !== bCount) errors.push(`rocket races A/B counts differ (${aCount} A, ${bCount} B).`);
  }

  const assessDays = days.filter((d) =>
    classById.get(d.day_type) === "assess" && d.day_type !== "time_trial" && d.day_type !== "rocket_races_b"
  );
  if (assessDays.length > 1) {
    errors.push(`${assessDays.length} assessment days in one block (${assessDays.map((d) => d.day_type).join(", ")}); at most one.`);
  }
  return errors;
}

export interface GateResult { ok: boolean; reason: string }

/**
 * When may the sequencer start? (founder decision 2026-11-10): only after the
 * ASSESSMENT MONTH. Month one is fixed and identical for every goal; the
 * sequencer's first generated block is the first block of month two, right
 * after the month-two time trial. So the gate is positional: the first
 * position to generate must lie in month 2 or later.
 *
 * `null` = the athlete's program has no mapping rows. Every user starts on
 * month 1 of a mapped program (founder ruling 2026-11-11), so this is a data
 * error, not an exemption: the gate closes and says so.
 */
export function sequencerGate(firstPositionMonth: number | null): GateResult {
  if (firstPositionMonth == null) {
    return { ok: false, reason: "program has no mapping rows (data error) — every athlete starts on month 1 of a mapped program; nothing to sequence" };
  }
  if (Number.isFinite(firstPositionMonth) && firstPositionMonth >= 2) {
    return { ok: true, reason: `assessment month complete; next block is month ${firstPositionMonth}` };
  }
  return { ok: false, reason: `assessment month in progress (next block is month ${firstPositionMonth}); the sequencer starts with month 2` };
}

/**
 * Informational only — never affects the gate. Names the month-one types the
 * athlete has fewer than `minPerType` scored sessions of, for the logs.
 */
export function thinDataNote(
  completedByType: Record<string, number>,
  monthOneTypes: Iterable<string>,
  minPerType: number = MIN_COMPLETIONS,
): string | null {
  const types = [...new Set(monthOneTypes)].filter((t) => t !== "time_trial");
  const short = types.filter((t) => (completedByType[t] ?? 0) < minPerType);
  return short.length ? `thin data: ${short.map((t) => `${t} ${completedByType[t] ?? 0}/${minPerType}`).join(", ")}` : null;
}
