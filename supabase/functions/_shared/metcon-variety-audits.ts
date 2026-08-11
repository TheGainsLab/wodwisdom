/**
 * metcon-variety-audits.ts
 *
 * The deterministic SET-LEVEL fence behind the metcon composer — the machine
 * rows of the 2026-08-11 frozen metcon spec. Every rule here mirrors a rule in
 * metcon-composer-prompt.ts; the two files must move together.
 *
 * Set-scoped by design: the row/wall-ball failure was invisible at day scope by
 * construction (the sixteenth row/wall-ball piece is locally unimpeachable).
 * Day-scoped audits catch day-scoped failures; set-scoped failures need a
 * set-scoped fence. The audit is the BACKSTOP, not the mechanism — the
 * composer owns the variety objective; this catches the misses (one retry).
 *
 * Pure functions, no IO.
 */

import type {
  ComposedMetcon,
  MetconComposerOutput,
  MetconSlot,
} from "./metcon-composer.ts";

export interface MetconVarietyAuditResult {
  passed: boolean;
  violations: string[];
  /** Non-blocking observations (logged, never retried). */
  warnings: string[];
}

// ── Movement normalization ──
const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Barbell-bearing movements at metcon loads (display-name space, normalized).
// Implement-prefixed variants (dumbbell/kettlebell) deliberately DON'T count —
// "dumbbell thruster" is not barbell conditioning.
const BARBELL_METCON_MOVEMENTS = new Set(
  [
    "Thruster",
    "Deadlift",
    "Sumo Deadlift",
    "Sumo Deadlift High Pull",
    "Power Clean",
    "Clean",
    "Squat Clean",
    "Hang Power Clean",
    "Clean And Jerk",
    "Power Snatch",
    "Snatch",
    "Hang Power Snatch",
    "Push Press",
    "Push Jerk",
    "Shoulder To Overhead",
    "Ground To Overhead",
    "Front Squat",
    "Back Squat",
    "Overhead Squat",
    "Front Rack Walking Lunge",
    "Overhead Walking Lunge",
    "Cluster",
    "Bar Facing Burpee", // barbell-adjacent but NOT load-bearing — excluded below
  ].map(norm),
);
BARBELL_METCON_MOVEMENTS.delete(norm("Bar Facing Burpee"));

const NON_BARBELL_PREFIXES = ["dumbbell", "kettlebell", "db ", "kb ", "single arm", "medicine ball"];

export function isBarbellMetconMovement(movement: string): boolean {
  const n = norm(movement);
  if (NON_BARBELL_PREFIXES.some((p) => n.startsWith(p))) return false;
  return BARBELL_METCON_MOVEMENTS.has(n);
}

// Monostructural detection (mirrors audits.ts semantics incl. the shuttle-run
// floor-movement exemption).
const MONO_KEYWORDS = ["row", "bike", "ski", "run", "swim"];
const MONO_EXEMPT = [
  "dumbbell row", "db row", "barbell row", "bent over row", "bent-over row",
  "ring row", "inverted row", "single arm row", "pendlay row", "seal row",
  "shuttle run", "crossover",
];
function isMonoMovement(movement: string): boolean {
  const n = norm(movement);
  if (MONO_EXEMPT.some((k) => n.includes(norm(k)))) return false;
  return MONO_KEYWORDS.some((k) => n.includes(k));
}

/** A piece's identity for distinctness: its normalized movement multiset. */
export function movementSignature(m: ComposedMetcon): string {
  return m.movements.map((mv) => norm(mv.movement)).sort().join(" | ");
}

const at = (m: ComposedMetcon) => `W${m.week_num}D${m.day_num}`;

const TIME_BUCKETS: Record<string, (min: number) => boolean> = {
  short: (min) => min <= 8,
  medium: (min) => min >= 8 && min <= 15,
  long: (min) => min >= 14,
};

/**
 * The full set-level audit. `slots` is optional — when given, coverage and
 * time-domain fit are checked too (the harness and pipeline pass it; unit
 * fixtures may not).
 */
/** Which equipment key owns each machine family (run needs none — policy:
 *  Run is always available; swim has no key and is vocabulary-gated only). */
const MACHINE_EQUIPMENT: Record<string, string | null> = {
  row: "rower",
  bike: "assault_bike",
  ski: "ski_erg",
  run: null,
  swim: null,
};

export function auditMetconVariety(
  output: MetconComposerOutput,
  opts: {
    slots?: MetconSlot[];
    /** Athlete has a barbell + at least one legal barbell movement. */
    barbellCapable?: boolean;
    /** Normalized signatures of last cycle's pieces (never re-serve). */
    previousCycleSignatures?: string[];
    /** Allowed movement display names — every composed movement must be one. */
    vocabulary?: string[];
    /** Hard bans — a banned movement anywhere is a violation. */
    doNotProgram?: string[];
    /** Equipment map — machine movements require the owning equipment. */
    equipment?: Record<string, boolean>;
  } = {},
): MetconVarietyAuditResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const pieces = output.metcons ?? [];
  const n = pieces.length;
  if (n === 0) {
    return { passed: false, violations: ["No metcons emitted."], warnings };
  }

  // 1. Slot coverage — exactly one piece per slot, no extras/orphans.
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
    // Time-domain fit (warning tier — duration honesty, not a defect class yet).
    const slotByKey = new Map(opts.slots.map((s) => [`W${s.week_num}D${s.day_num}`, s]));
    for (const m of pieces) {
      const slot = slotByKey.get(at(m));
      if (slot && !TIME_BUCKETS[slot.time_domain]?.(m.stated_duration_minutes)) {
        warnings.push(
          `${at(m)}: stated ${m.stated_duration_minutes} min vs slot time domain "${slot.time_domain}".`,
        );
      }
    }
  }

  // 2. Distinctness — no repeated movement-combination in the month…
  const seen = new Map<string, string>();
  for (const m of pieces) {
    const sig = movementSignature(m);
    const prior = seen.get(sig);
    if (prior) {
      violations.push(
        `${at(m)} repeats the movement combination of ${prior} (${sig}) — every piece in the month must be a distinct workout.`,
      );
    } else {
      seen.set(sig, at(m));
    }
  }
  // …and no re-serving last cycle.
  if (opts.previousCycleSignatures?.length) {
    const prev = new Set(opts.previousCycleSignatures);
    for (const m of pieces) {
      if (prev.has(movementSignature(m))) {
        violations.push(`${at(m)} re-serves a previous cycle's piece (${movementSignature(m)}).`);
      }
    }
  }

  // 3. Movement frequency — no movement in more than ~1/3 of pieces.
  const cap = Math.max(2, Math.ceil(n / 3));
  const freq = new Map<string, number>();
  for (const m of pieces) {
    for (const mv of new Set(m.movements.map((x) => norm(x.movement)))) {
      freq.set(mv, (freq.get(mv) ?? 0) + 1);
    }
  }
  for (const [mv, count] of freq) {
    if (count > cap) {
      violations.push(
        `"${mv}" appears in ${count}/${n} pieces (cap ${cap}) — spread the vocabulary across the month.`,
      );
    }
  }

  // 4. Format spread — ≥3 distinct; none over half.
  const formats = new Map<string, number>();
  for (const m of pieces) formats.set(m.format, (formats.get(m.format) ?? 0) + 1);
  if (n >= 6 && formats.size < 3) {
    violations.push(
      `Only ${formats.size} distinct format(s) across ${n} pieces — the month needs at least 3.`,
    );
  }
  for (const [f, count] of formats) {
    if (count > Math.ceil(n / 2)) {
      violations.push(`Format "${f}" carries ${count}/${n} pieces — no format may exceed half the month.`);
    }
  }

  // 5. Barbell floor — WARNING TIER (demoted 2026-08-11): a taste rule the
  //    letter can legitimately overrule. Nick's case proved it: no Olympic
  //    lifting, VO2 as the outcome, loading deliberately light — the composer
  //    followed the coach and the old hard rule called that a defect. Standing
  //    principle: audits enforce CONTRACTS (legality, slots, distinctness);
  //    the letter owns TASTE — a taste rule demotes when a letter explicitly
  //    argues for the pattern. Rules 3/4/6/7 stay violations: every one was
  //    born from the attractor (wall-ball saturation, machine months), which
  //    no letter has ever argued for.
  if (opts.barbellCapable) {
    const barbellPieces = pieces.filter((m) => m.movements.some((mv) => isBarbellMetconMovement(mv.movement)));
    const floor = n >= 12 ? 2 : 1;
    if (barbellPieces.length < floor) {
      warnings.push(
        `${barbellPieces.length} barbell-bearing piece(s) in ${n} for a barbell-capable athlete (typical floor ${floor}) — fine when the letter de-emphasizes loading; worth a look otherwise.`,
      );
    }
  }

  // 6. Monostructural budget — max 2, flag must agree with content.
  const monoPieces = pieces.filter((m) => m.movements.length > 0 && m.movements.every((mv) => isMonoMovement(mv.movement)));
  if (monoPieces.length > 2) {
    violations.push(
      `${monoPieces.length} monostructural-only pieces (${monoPieces.map(at).join(", ")}) — the budget is 2, always deliberate.`,
    );
  }
  for (const m of monoPieces) {
    if (!m.monostructural) {
      warnings.push(`${at(m)} is monostructural-only but not flagged monostructural.`);
    }
  }
  for (const m of pieces) {
    if (m.monostructural && !monoPieces.includes(m)) {
      warnings.push(`${at(m)} is flagged monostructural but contains mixed movements.`);
    }
  }

  // 7. Named benchmarks — infrequent (≤2).
  const named = pieces.filter((m) => m.format === "named");
  if (named.length > 2) {
    violations.push(`${named.length} named benchmark pieces — keep named WODs infrequent (at most 2).`);
  }

  // 8. One machine max per ROUND-BASED piece. Single-pass chippers may touch
  //    multiple machines (ruled 2026-08-11: each station used once is fine —
  //    the rule exists to prevent mid-round machine swapping). Equipment
  //    ownership is checked separately in rule 9 for every piece.
  for (const m of pieces) {
    if (m.format === "chipper") continue;
    const machines = new Set(
      m.movements.map((mv) => norm(mv.movement)).filter((x) => isMonoMovement(x)).map((x) => {
        for (const k of MONO_KEYWORDS) if (x.includes(k)) return k;
        return x;
      }),
    );
    if (machines.size > 1) {
      violations.push(
        `${at(m)}: ${machines.size} cardio modalities (${[...machines].join(", ")}) in a ${m.format} — one machine per round-based piece (only a single-pass chipper may use two).`,
      );
    }
  }

  // 9. Legality — every movement must be in the vocabulary, never banned, and
  //    machine movements require the owning equipment. Belt-and-braces with the
  //    prompt inputs: a banned or invented movement must never survive to the
  //    fill (found 2026-08-11: a composed month used Ski Erg unchecked).
  const vocab = opts.vocabulary?.length ? new Set(opts.vocabulary.map(norm)) : null;
  const bans = opts.doNotProgram?.length ? new Set(opts.doNotProgram.map(norm)) : null;
  for (const m of pieces) {
    for (const mv of m.movements) {
      const x = norm(mv.movement);
      if (bans?.has(x)) {
        violations.push(`${at(m)}: "${mv.movement}" is on this athlete's do-not-program list.`);
        continue;
      }
      if (vocab && !vocab.has(x)) {
        violations.push(`${at(m)}: "${mv.movement}" is not in this athlete's allowed vocabulary.`);
        continue;
      }
      if (opts.equipment && isMonoMovement(x)) {
        for (const k of MONO_KEYWORDS) {
          if (x.includes(k)) {
            const eq = MACHINE_EQUIPMENT[k];
            if (eq && !opts.equipment[eq]) {
              violations.push(`${at(m)}: "${mv.movement}" requires ${eq} the athlete doesn't have.`);
            }
            break;
          }
        }
      }
    }
  }

  return { passed: violations.length === 0, violations, warnings };
}

export function formatMetconVarietyViolationsForRetry(violations: string[]): string {
  return [
    "Your previous month of metcons failed the variety audit. Re-emit the FULL month via emit_metcon_month, fixing these violations. Two kinds of violation, two obligations:",
    "- PIECE violations (named by WxDx): recompose THAT piece — change its movements and/or format. Re-labeling it, toggling its monostructural flag, or editing its stimulus_note does NOT fix a content violation. Keep pieces not named by any violation unchanged.",
    "- SET violations (a count across the month: the barbell floor, format spread, movement-frequency caps, mono budget): no piece is named — YOU choose which piece(s) to recompose, and you MUST change enough of them that the count is satisfied. Returning the month unchanged is a failure.",
    "",
    ...violations.map((v) => `  - ${v}`),
  ].join("\n");
}
