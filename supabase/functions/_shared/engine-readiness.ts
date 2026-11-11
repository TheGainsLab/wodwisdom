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
 *
 * Variety rules (founder, 2026-11-11 — "I don't want every day to turn into
 * VO2 max work"; the breadth of the catalogue IS the product):
 *  - DISTINCT TYPES within a block: a 3-day block is three different types;
 *    4- and 5-day blocks have at least one fewer distinct type than days.
 *    (time_trial positions are pinned, not generated, and don't count.)
 *  - NEVER THE SAME PRESCRIPTION TWICE: a prescription is the type plus its
 *    generated blocks (rounds, work, rest, pace...). No two days may share
 *    one within a block, nor between a block and the block before it. The
 *    type may return; the session may not.
 *  - SHARE CAP: no type may appear in a block more often than its share of
 *    the curated month allows (ceil(curated count ÷ curated training days ×
 *    block days), never below 1). Keeps one favourite from crowding the rest
 *    out. time_trial and rocket_races_b are exempt.
 * The "introduce what is newly ready within two blocks" rule is a prompt
 * instruction, not a validator check — the log shows whether it is honoured.
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
  /** The generated blocks (same keys as block_N_params). Needed for the
   *  repeat check; a day without blocks is compared on type alone. */
  blocks?: Record<string, unknown>[];
}

export interface WeekRuleOpts {
  /** The block generated just before this one — its prescriptions may not recur. */
  previousBlock?: WeekRuleDay[];
  /** Per-type maximum for this block (typeCapsForBlock). Absent types are uncapped. */
  typeCap?: Map<string, number>;
}

/** Canonical JSON with sorted keys, so two equal prescriptions stringify alike. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** A prescription's identity: the type plus every generated parameter. */
export function prescriptionSignature(d: WeekRuleDay): string {
  return `${d.day_type}|${canon(d.blocks ?? [])}`;
}

/** How many distinct types a block of n generated days must contain. */
export function minDistinctTypes(n: number): number {
  return n <= 3 ? n : n - 1;
}

/**
 * Per-type cap for a block, from the curated month: a type's share of the
 * curated training days (time trials excluded), scaled to the block, rounded
 * up, never below 1. A type the curated month never uses gets 1 — it may be
 * introduced, once per block.
 */
export function typeCapsForBlock(curatedMonthTypes: string[], blockDays: number): Map<string, number> {
  const train = curatedMonthTypes.filter((t) => t && t !== "time_trial");
  const counts = new Map<string, number>();
  for (const t of train) counts.set(t, (counts.get(t) ?? 0) + 1);
  const caps = new Map<string, number>();
  for (const [t, c] of counts) {
    caps.set(t, Math.max(1, Math.ceil((c / Math.max(1, train.length)) * blockDays)));
  }
  return caps;
}

/**
 * Block-level rules. Returns the errors; an empty array means the block is
 * acceptable as a whole. Callers reject the whole proposal on any error —
 * dropping a single day would silently break a pair.
 */
export function validateWeekRules(
  days: WeekRuleDay[],
  classById: Map<string, "develop" | "assess">,
  opts: WeekRuleOpts = {},
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

  // ── Variety ──────────────────────────────────────────────────────────────
  const train = days.filter((d) => d.day_type !== "time_trial");

  // Distinct types.
  const distinct = new Set(train.map((d) => d.day_type)).size;
  const need = minDistinctTypes(train.length);
  if (distinct < need) {
    errors.push(`only ${distinct} distinct day type${distinct === 1 ? "" : "s"} across ${train.length} days (${train.map((d) => d.day_type).join(", ")}); at least ${need} required.`);
  }

  // Never the same prescription twice — within the block, or against the previous one.
  const seen = new Map<string, string>();
  for (const d of train) {
    const sig = prescriptionSignature(d);
    if (seen.has(sig)) errors.push(`"${d.day_type}" repeats an identical prescription within the block.`);
    seen.set(sig, d.day_type);
  }
  if (opts.previousBlock?.length) {
    const prev = new Set(opts.previousBlock.map(prescriptionSignature));
    for (const d of train) {
      if (prev.has(prescriptionSignature(d))) {
        errors.push(`"${d.day_type}" repeats a prescription from the previous block (same rounds/work/rest); vary the session.`);
      }
    }
  }

  // Share cap.
  if (opts.typeCap?.size) {
    const counts = new Map<string, number>();
    for (const d of train) {
      if (d.day_type === "rocket_races_b") continue;
      counts.set(d.day_type, (counts.get(d.day_type) ?? 0) + 1);
    }
    for (const [t, c] of counts) {
      const cap = opts.typeCap.get(t) ?? 1;
      if (c > cap) errors.push(`"${t}" ${c}× in one block; its share of the curated month allows ${cap}.`);
    }
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
