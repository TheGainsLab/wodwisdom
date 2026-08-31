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
import {
  athleteTierFor,
  bandRange,
  loadClassForMovement,
  skillFatigueDefForMovement,
} from "./conditioning-definitions.ts";

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

// ── Development-axis movement mapping (athlete-match package) ──
// Which movements EXPRESS each strength/gymnastics focus axis under fatigue.
// Conditioning axes (aerobic/anaerobic/mixed) are deliberately absent — they
// express as time domains via the slots, not as movements.
const AXIS_MOVEMENT_KEYWORDS: Record<string, string[]> = {
  olympic_lifting: ["snatch", "clean", "jerk", "ground to overhead"],
  powerlifting_strength: ["deadlift", "back squat", "front squat", "bench press", "thruster"],
  posterior_chain: ["deadlift", "kettlebell swing", "good morning", "hip extension", "sumo deadlift"],
  upper_body_pressing: ["push press", "push jerk", "shoulder to overhead", "handstand push up", "hspu", "push up"],
  gymnastics_pulling: ["pull up", "chest to bar", "toes to bar", "muscle up", "rope climb"],
  gymnastics_pressing: ["handstand push up", "hspu", "ring dip", "wall walk", "handstand walk", "dip"],
  midline: ["ghd", "toes to bar", "v up", "l sit", "hollow"],
  skill_coordination: ["double under", "pistol", "handstand walk", "crossover"],
};

function movementExpressesAxis(movement: string, axis: string): boolean {
  const n = norm(movement);
  return (AXIS_MOVEMENT_KEYWORDS[axis] ?? []).some((kw) => n.includes(kw));
}

/** Best-effort per-round rep parse from a prescription string: the largest
 *  dash/slash-separated leading integer ("15" → 15, "21-15-9" → 21). Null when
 *  the prescription is calorie/distance/time-denominated or non-numeric. */
function parsePerRoundReps(prescription: string): number | null {
  const p = prescription.trim().toLowerCase();
  if (/\b(cal|cals|calories|m|meter|meters|km|ft|yd|sec|s|min)\b/.test(p)) return null;
  const m = p.match(/^(\d+(?:\s*[-\/]\s*\d+)*)/);
  if (!m) return null;
  const nums = m[1].split(/[-\/]/).map((x) => parseInt(x.trim(), 10)).filter((x) => Number.isFinite(x));
  return nums.length ? Math.max(...nums) : null;
}

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
    /** Typed development axes (strength/gymnastics; conditioning axes excluded)
     *  — drives the weekly-expression and fit rules. */
    developmentAxes?: string[];
    /** Athlete's skill tiers — drives the skill volume bands. */
    skills?: Record<string, string | null>;
    /** CoachState.loading_deemphasis (typed) — relaxes the barbell target.
     *  Reads the FLAG, never the prose (2026-08-31: the flag is how the
     *  2026-08-11 letter-owns-taste precedent became auditable — it quietly
     *  covers the injured-athlete case that motivated the demotion). */
    loadingDeemphasis?: boolean;
    /** Skill axes the letter keeps out of conditioning under fatigue. */
    fatigueSkillExclusions?: string[];
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
    // When the slot carries an exact allocation (session-budget phase), check
    // against it (±20%, min 3-minute slack) instead of the coarse bucket.
    const slotByKey = new Map(opts.slots.map((s) => [`W${s.week_num}D${s.day_num}`, s]));
    for (const m of pieces) {
      const slot = slotByKey.get(at(m));
      if (!slot) continue;
      const alloc = slot.allocated_minutes ?? null;
      if (alloc && alloc > 0) {
        const slack = Math.max(3, alloc * 0.2);
        if (Math.abs(m.stated_duration_minutes - alloc) > slack) {
          warnings.push(
            `${at(m)}: stated ${m.stated_duration_minutes} min vs allocated ${alloc} min — the allocation is the design decision; size the piece to it.`,
          );
        }
      } else if (!TIME_BUCKETS[slot.time_domain]?.(m.stated_duration_minutes)) {
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
    // 2026-08-31: the target rose from a floor of 2 (which the composer treated
    // as the target — exactly 2 pieces at 39% loads) to 4–6, and the exemption
    // now reads the TYPED loading_deemphasis flag rather than inferring from
    // prose. A time-domain/engine priority is NOT de-emphasis.
    const target = n >= 12 ? 4 : 2;
    if (opts.loadingDeemphasis !== true && barbellPieces.length < target) {
      warnings.push(
        `${barbellPieces.length} barbell-bearing piece(s) in ${n} for a barbell-capable athlete (target ${target}-6) with loading_deemphasis NOT set — a capable athlete's month normally cycles barbells; add barbell-bearing pieces at cycling loads.`,
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

  // ── Athlete-match rules (2026-08-31) — the objective's deterministic floor ──

  // 10. Typed load band present on every loaded barbell movement. Adjectives
  //     in prose without load_class/load_band regress the fill to guessing —
  //     that's how a 475-lb deadlifter got 185-lb "moderate" deadlifts.
  for (const m of pieces) {
    for (const mv of m.movements ?? []) {
      if (!isBarbellMetconMovement(mv?.movement ?? "")) continue;
      if (!mv.load_class || !mv.load_band) {
        violations.push(
          `${at(m)}: "${mv.movement}" is a loaded movement with no typed load_class/load_band — state the band from the shared table (adjectives alone are a defect).`,
        );
      } else if (bandRange(mv.load_class, mv.load_band) == null && loadClassForMovement(mv.movement) != null) {
        violations.push(
          `${at(m)}: "${mv.movement}" declares band "${mv.load_band}" which class "${mv.load_class}" doesn't define — pick a defined band.`,
        );
      }
    }
  }

  // 11. Skill volume within the athlete's tier band. Per-round reps only (round
  //     counts live in prose block_scheme and aren't reliably parseable).
  //     Above-band is allowed WITH a written justification — proxied as the
  //     stimulus_note mentioning the movement (deterministic audits can't judge
  //     justification quality; the proxy forces the composer to write one).
  if (opts.skills) {
    for (const m of pieces) {
      for (const mv of m.movements ?? []) {
        const def = skillFatigueDefForMovement(mv?.movement ?? "");
        if (!def) continue;
        const tier = athleteTierFor(def, opts.skills);
        if (tier == null) continue; // absence is neutral — no tier, no check
        const band = def.perRound[tier];
        if (band == null) {
          violations.push(
            `${at(m)}: "${mv.movement}" under fatigue for a ${tier}-tier athlete — this skill is not programmed under fatigue at that tier.`,
          );
          continue;
        }
        const reps = parsePerRoundReps(mv.prescription);
        if (reps != null && reps > band[1]) {
          const justified = norm(m.stimulus_note ?? "").includes(norm(mv.movement).split(" ")[0]);
          if (!justified) {
            violations.push(
              `${at(m)}: "${mv.movement}" at ${reps}/round exceeds the ${tier} band (${band[0]}-${band[1]}) with no justification in stimulus_note — bring it in band or justify it.`,
            );
          }
        }
      }
    }
  }

  // 12. Development-axis expression — each development axis appears in at least
  //     one piece per non-deload week (deload weeks detected from slot
  //     intensity). The prompt's target is weekly everywhere; this is the
  //     audited floor. Excluded axes are exempt.
  if (opts.developmentAxes?.length && opts.slots?.length) {
    const excluded = new Set(opts.fatigueSkillExclusions ?? []);
    const deloadWeeks = new Set(
      opts.slots.filter((s) => /deload/i.test(s.intensity)).map((s) => s.week_num),
    );
    const weeks = [...new Set(opts.slots.map((s) => s.week_num))].filter((w) => !deloadWeeks.has(w));
    for (const axis of opts.developmentAxes) {
      if (excluded.has(axis)) continue;
      if (!(axis in AXIS_MOVEMENT_KEYWORDS)) continue;
      for (const wk of weeks) {
        const expressed = pieces.some(
          (m) => m.week_num === wk && (m.movements ?? []).some((mv) => movementExpressesAxis(mv?.movement ?? "", axis)),
        );
        if (!expressed) {
          violations.push(
            `Week ${wk}: development axis "${axis}" appears in no metcon — what the athlete trains must be expressed under fatigue (add a piece carrying it, at tier-band volume).`,
          );
        }
      }
    }
  }

  // 13. Fit to athlete — ≥60% of pieces carry a movement from the athlete's
  //     development axes or barbell strength work. The floor under the
  //     objective: this rule alone would have flagged the generic month.
  if (opts.developmentAxes?.length) {
    const excluded = new Set(opts.fatigueSkillExclusions ?? []);
    const axes = opts.developmentAxes.filter((a) => !excluded.has(a) && a in AXIS_MOVEMENT_KEYWORDS);
    const fitPieces = pieces.filter((m) =>
      (m.movements ?? []).some(
        (mv) =>
          isBarbellMetconMovement(mv?.movement ?? "") ||
          axes.some((a) => movementExpressesAxis(mv?.movement ?? "", a)),
      )
    );
    const fitPct = Math.round((fitPieces.length / n) * 100);
    if (n >= 8 && fitPct < 60) {
      violations.push(
        `Only ${fitPieces.length}/${n} pieces (${fitPct}%) draw from this athlete's strength or development-skill work (floor 60%) — the month reads as written for nobody in particular. Recompose pieces to express what the athlete trains.`,
      );
    }
  }

  return { passed: violations.length === 0, violations, warnings };
}

export function formatMetconVarietyViolationsForRetry(violations: string[]): string {
  return [
    "Your previous month of metcons failed the variety audit. Re-emit the FULL month via emit_metcon_month, fixing these violations. Two kinds of violation, two obligations:",
    "- PIECE violations (named by WxDx): recompose THAT piece — change its movements, loads (typed load_class/load_band), volumes, and/or format. Re-labeling it, toggling its monostructural flag, or editing its stimulus_note does NOT fix a content violation. Keep pieces not named by any violation unchanged.",
    "- SET violations (a count across the month or week: format spread, movement-frequency caps, mono budget, a development axis missing from a week, the fit-to-athlete floor): no single piece is named — YOU choose which piece(s) to recompose, and you MUST change enough of them that the count is satisfied. Returning the month unchanged is a failure.",
    "",
    ...violations.map((v) => `  - ${v}`),
  ].join("\n");
}
