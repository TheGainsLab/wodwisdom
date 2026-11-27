/**
 * metcon-variety-audits.ts
 *
 * What code COUNTS about the composed metcons (rebuilt 2026-11-27 on the
 * founder's decisions). Every count reads a field the composer itself set —
 * the format, the monostructural flag, the machine field, the load class and
 * band — and never a movement's name. A miss goes back to the composer once;
 * what comes back ships.
 *
 * Counted, across the month so far:
 *   - one piece per slot
 *   - format spread: at least 3 formats, none over half
 *   - monostructural-only pieces: at most 2 (0 for an Engine athlete)
 *   - named benchmarks: at most 2
 *   - one machine per round-based piece
 *   - a barbell load class carries a band that class defines
 *
 * NOT counted any more (instruction only, the composer's judgment): every
 * piece distinct, no repeat from last month, no movement in more than a third
 * of pieces, barbell presence. REMOVED: "every development axis in a metcon
 * each week" and "60% of pieces fit the athlete" — both matched movement
 * names against keyword lists and sent the month back on 47 of 48 logged
 * runs.
 *
 * Pure functions, no IO.
 */

import type {
  ComposedMetcon,
  MetconComposerOutput,
  MetconSlot,
} from "./metcon-composer.ts";
import { bandRange, TIME_DOMAINS } from "./conditioning-definitions.ts";

export interface MetconVarietyAuditResult {
  passed: boolean;
  violations: string[];
  /** Logged, never sent back. */
  warnings: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The barbell classes of the shared cycling-load table. */
const BARBELL_LOAD_CLASSES = new Set(["deadlift", "clean", "snatch", "thruster", "shoulder_to_overhead", "back_squat"]);

/**
 * Strip structural "Rest" rows the composer sometimes emits when making
 * interval arithmetic explicit (observed 2026-08-31: a "Rest" movement row
 * hard-failed legality — correctly, since rest is not a movement). Rest
 * belongs in block_scheme prose; removing the row is a FACT patch, not a
 * judgment. Mutates and returns the output; logs nothing — callers report.
 * Returns the number of rows stripped.
 */
export function stripStructuralRestRows(output: MetconComposerOutput): number {
  let stripped = 0;
  for (const m of output.metcons ?? []) {
    const rows = Array.isArray(m.movements) ? m.movements : [];
    const kept = rows.filter((mv) => {
      const n = norm(mv?.movement ?? "");
      return n !== "rest" && !n.startsWith("rest ");
    });
    stripped += rows.length - kept.length;
    m.movements = kept;
  }
  return stripped;
}

/**
 * Normalize a raw composer emission into the audited shape. Anthropic's
 * tool-schema enforcement is imperfect (same class as the skeleton's
 * stringified month_plan, repaired in repairSkeletonEmission) — observed
 * 2026-08-31: a retry emission carried a piece with NO movements array, which
 * crashed the metcons stage. A malformed piece must surface as an AUDIT
 * FINDING (its slot reads "no composed metcon" → the existing retry/residual
 * machinery handles it), never as a stage crash.
 *
 * Repairs: missing/invalid metcons array → empty; non-object pieces dropped;
 * pieces with a missing/empty movements array dropped; malformed movement
 * rows dropped; missing prescription/stimulus_note defaulted. Returns the
 * repaired output plus human-readable repair notes for the log.
 */
export function repairComposerEmission(
  raw: unknown,
): { output: MetconComposerOutput; repairs: string[] } {
  const repairs: string[] = [];
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawPieces = Array.isArray(root.metcons) ? root.metcons : null;
  if (!rawPieces) {
    repairs.push("metcons array missing from emission — treated as empty (every slot will flag)");
    return { output: { metcons: [] }, repairs };
  }
  const pieces: ComposedMetcon[] = [];
  for (const p of rawPieces) {
    if (!p || typeof p !== "object") {
      repairs.push("non-object piece dropped");
      continue;
    }
    const piece = p as Record<string, unknown>;
    const loc = `W${piece.week_num}D${piece.day_num}`;
    if (!Array.isArray(piece.movements) || piece.movements.length === 0) {
      repairs.push(`${loc}: movements array missing/empty — piece dropped (slot coverage will flag it)`);
      continue;
    }
    const movements = (piece.movements as unknown[])
      .filter((mv) => {
        const ok = !!mv && typeof mv === "object" &&
          typeof (mv as { movement?: unknown }).movement === "string";
        if (!ok) repairs.push(`${loc}: malformed movement row dropped`);
        return ok;
      })
      .map((mv) => ({ prescription: "", ...(mv as object) })) as ComposedMetcon["movements"];
    if (movements.length === 0) {
      repairs.push(`${loc}: no valid movement rows — piece dropped (slot coverage will flag it)`);
      continue;
    }
    pieces.push({
      week_num: typeof piece.week_num === "number" ? piece.week_num : 0,
      day_num: typeof piece.day_num === "number" ? piece.day_num : 0,
      format: (typeof piece.format === "string" ? piece.format : "amrap") as ComposedMetcon["format"],
      block_scheme: typeof piece.block_scheme === "string" ? piece.block_scheme : "",
      stated_duration_minutes: typeof piece.stated_duration_minutes === "number" ? piece.stated_duration_minutes : 0,
      stimulus_note: typeof piece.stimulus_note === "string" ? piece.stimulus_note : "",
      monostructural: piece.monostructural === true,
      movements,
    });
  }
  return { output: { metcons: pieces }, repairs };
}

const at = (m: ComposedMetcon) => `W${m.week_num}D${m.day_num}`;

// From the one definition (conditioning-definitions.ts TIME_DOMAINS).
const TIME_BUCKETS: Record<string, (min: number) => boolean> = {
  short: (min) => min <= TIME_DOMAINS.short.maxMinutes,
  medium: (min) => min >= TIME_DOMAINS.medium.minMinutes && min <= TIME_DOMAINS.medium.maxMinutes,
  long: (min) => min >= TIME_DOMAINS.long.minMinutes && min <= TIME_DOMAINS.long.maxMinutes,
};

export function auditMetconVariety(
  output: MetconComposerOutput,
  opts: {
    /** Every slot the pieces answer: earlier weeks' and the ones just written. */
    slots?: MetconSlot[];
    /** True when the athlete has completed Engine sessions: the
     *  monostructural-only budget is 0 (Engine is that work). */
    engineActive?: boolean;
  } = {},
): MetconVarietyAuditResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const pieces = output.metcons ?? [];
  const n = pieces.length;
  if (n === 0) {
    return { passed: false, violations: ["No metcons emitted."], warnings };
  }

  // Slot coverage: exactly one piece per slot.
  if (opts.slots) {
    const want = new Set(opts.slots.map((s) => `W${s.week_num}D${s.day_num}`));
    const got = new Map<string, number>();
    for (const m of pieces) got.set(at(m), (got.get(at(m)) ?? 0) + 1);
    for (const key of want) {
      const c = got.get(key) ?? 0;
      if (c === 0) violations.push(`${key}: slot has no composed metcon.`);
      if (c > 1) violations.push(`${key}: ${c} metcons composed for one slot.`);
    }
    for (const key of got.keys()) {
      if (!want.has(key)) violations.push(`${key}: metcon composed for a slot that doesn't exist.`);
    }
    // Stated length against the slot's time domain: logged, never sent back.
    const slotByKey = new Map(opts.slots.map((s) => [`W${s.week_num}D${s.day_num}`, s]));
    for (const m of pieces) {
      const slot = slotByKey.get(at(m));
      if (!slot) continue;
      if (!TIME_BUCKETS[slot.time_domain]?.(m.stated_duration_minutes)) {
        warnings.push(`${at(m)}: stated ${m.stated_duration_minutes} min vs slot time domain "${slot.time_domain}".`);
      }
    }
  }

  // Rule 4: format spread — at least 3 distinct; none over half.
  const formats = new Map<string, number>();
  for (const m of pieces) formats.set(m.format, (formats.get(m.format) ?? 0) + 1);
  if (n >= 6 && formats.size < 3) {
    violations.push(`Only ${formats.size} distinct format(s) across ${n} pieces — the month needs at least 3.`);
  }
  for (const [f, count] of formats) {
    if (count > Math.ceil(n / 2)) {
      violations.push(`Format "${f}" carries ${count}/${n} pieces — no format may exceed half the month.`);
    }
  }

  // Rule 6: monostructural-only pieces, by the composer's own flag.
  const monoBudget = opts.engineActive ? 0 : 2;
  const monoPieces = pieces.filter((m) => m.monostructural === true);
  if (monoPieces.length > monoBudget) {
    violations.push(
      opts.engineActive
        ? `${monoPieces.length} monostructural-only piece(s) (${monoPieces.map(at).join(", ")}) — this athlete trains Engine, so the budget is 0: recompose as mixed pieces (machines inside mixed work are fine).`
        : `${monoPieces.length} monostructural-only pieces (${monoPieces.map(at).join(", ")}) — the budget is 2 for the month.`,
    );
  }

  // Rule 7: named benchmarks — at most 2.
  const named = pieces.filter((m) => m.format === "named");
  if (named.length > 2) {
    violations.push(`${named.length} named benchmark pieces — at most 2 in the month.`);
  }

  // Rule 8: one machine per round-based piece, by the composer's machine
  // field. A single-pass chipper may touch two.
  for (const m of pieces) {
    if (m.format === "chipper") continue;
    const machines = new Set((m.movements ?? []).map((mv) => mv?.machine).filter((x): x is NonNullable<typeof x> => !!x));
    if (machines.size > 1) {
      violations.push(
        `${at(m)}: ${machines.size} machines (${[...machines].join(", ")}) in a ${m.format} — one machine per round-based piece (only a single-pass chipper may use two).`,
      );
    }
  }

  // A barbell load class carries a band that class defines.
  for (const m of pieces) {
    for (const mv of m.movements ?? []) {
      const cls = mv?.load_class ?? "";
      if (!BARBELL_LOAD_CLASSES.has(cls)) continue;
      if (!mv.load_band) {
        violations.push(`${at(m)}: "${mv.movement}" has load_class "${cls}" and no load_band — state the band from the shared table.`);
      } else if (bandRange(cls, mv.load_band) == null) {
        violations.push(`${at(m)}: "${mv.movement}" declares band "${mv.load_band}", which class "${cls}" does not define — pick a defined band.`);
      }
    }
  }

  return { passed: violations.length === 0, violations, warnings };
}

export function formatMetconVarietyViolationsForRetry(violations: string[]): string {
  return [
    "The metcons you wrote missed the counts below. Re-emit every slot you were asked to write via emit_metcon_month, with these fixed.",
    "- A line naming a slot (WxDx): rewrite THAT piece. Keep pieces no line names unchanged.",
    "- A line about the month (formats, monostructural-only pieces, named benchmarks): choose which of the pieces you are writing now to change, and change enough of them that the count is met. Pieces already written this month cannot be changed.",
    "",
    ...violations.map((v) => `  - ${v}`),
  ].join("\n");
}
