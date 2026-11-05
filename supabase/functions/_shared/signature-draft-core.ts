/**
 * signature-draft-core — the signature drafting brain, extracted from
 * signature-workout so the generation-time autodraft hook (rev-61
 * automation chain, link 1) and the admin tool share ONE implementation:
 * one glossary, one system prompt, one validator, one hash rule.
 *
 * Nothing here persists; callers own storage. signature-workout keeps the
 * admin gate and the save/approve machinery; signature-autodraft adds the
 * hash-dedup + insert path for generated metcons.
 *
 * NAMING LAW: no output may contain the word "CrossFit" or imply a vendor
 * relationship.
 */

import { callClaude } from "./call-claude.ts";
import { FOCUS_AREAS } from "./coach-state.ts";
import type { ExpectedBenchmark } from "./compute-block-benchmark.ts";
import type { BlockPrescription } from "./v2-output-schema.ts";
import { hashWorkoutStructure, hashWorkoutText } from "./signature-hash.ts";

export const GATE_KINDS = ["skill", "load", "capacity"] as const;
export const SIG_FORMATS = ["amrap", "for_time", "intervals", "emom", "ladder"] as const;

// ============================================================
// Weight / gate validation
// ============================================================

export type Weights = Record<string, number>;

export function validateWeights(w: unknown, label: string): string[] {
  const errors: string[] = [];
  if (typeof w !== "object" || w === null || Array.isArray(w)) {
    return [`${label}: must be an object of {focus_area: percent}`];
  }
  let sum = 0;
  for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
    if (!(FOCUS_AREAS as readonly string[]).includes(k)) {
      errors.push(`${label}: "${k}" is not a focus area`);
      continue;
    }
    if (typeof v !== "number" || !Number.isInteger(v) || v < 5 || v > 100 || v % 5 !== 0) {
      errors.push(`${label}.${k}: must be an integer multiple of 5 between 5 and 100 (got ${v})`);
      continue;
    }
    sum += v;
  }
  if (errors.length === 0 && sum !== 100) {
    errors.push(`${label}: weights sum to ${sum}, must sum to exactly 100`);
  }
  return errors;
}

export function validateGates(g: unknown): string[] {
  if (g === undefined || g === null) return [];
  if (!Array.isArray(g)) return ["gates: must be an array"];
  const errors: string[] = [];
  g.forEach((gate, i) => {
    if (typeof gate !== "object" || gate === null) {
      errors.push(`gates[${i}]: must be an object`);
      return;
    }
    const { movement, kind } = gate as Record<string, unknown>;
    if (typeof movement !== "string" || !movement.trim()) {
      errors.push(`gates[${i}].movement: required string`);
    }
    if (!GATE_KINDS.includes(kind as typeof GATE_KINDS[number])) {
      errors.push(`gates[${i}].kind: must be one of ${GATE_KINDS.join("/")}`);
    }
  });
  return errors;
}

export interface SignatureDraft {
  demand: Weights;
  discrimination: Weights;
  stimulus: Weights;
  gates: Array<{ movement: string; kind: string; detail?: string }>;
  time_domain?: "short" | "medium" | "long";
  format?: string;
  archetype?: string;
  rationale?: string;
}

export function validateSignature(sig: Partial<SignatureDraft>, requireAll: boolean): string[] {
  const errors: string[] = [];
  if (sig.demand !== undefined || requireAll) {
    errors.push(...validateWeights(sig.demand, "demand"));
  }
  for (const key of ["discrimination", "stimulus"] as const) {
    if (sig[key] !== undefined && sig[key] !== null) {
      errors.push(...validateWeights(sig[key], key));
    } else if (requireAll) {
      errors.push(`${key}: required for approval`);
    }
  }
  errors.push(...validateGates(sig.gates));
  if (sig.time_domain !== undefined && sig.time_domain !== null &&
    !["short", "medium", "long"].includes(sig.time_domain)) {
    errors.push(`time_domain: must be short/medium/long`);
  }
  return errors;
}

// ============================================================
// Prompts
// ============================================================

export const AXES_GLOSSARY = `The ONLY allowed weight keys (the fixed training axes), with their boundaries — these are definitions of what the words mean:
- olympic_lifting — barbell snatch / clean & jerk technique: positions, timing, speed under the bar. OLY DEMAND FOLLOWS THE MOVEMENT FAMILY: any barbell snatch or clean variant carries a nonzero olympic_lifting DEMAND at any load — a power clean asks for the pull-and-catch whatever the bar weighs (a gym programming 145-lb power cleans weekly does NOT do 0% Olympic lifting). Whether technique DECIDES RANK is a separate, discrimination-side question — oly discrimination may be low when the field cycles the load on strength. Only dumbbell/kettlebell variants are reduced to a small overhead-receive residual (~5–10, scaled by load), with their pull in posterior_chain.
- powerlifting_strength — maximal force: heavy squat/press/deadlift, and any loaded work heavy enough that force production, not endurance, is what fails for the general field.
- posterior_chain — hinge pattern: deadlifts, swings, hip extension, incl. endurance at submax load; the pull of DB/KB ballistics lives here.
- upper_body_pressing — horizontal/overhead barbell+DB pressing strength.
- gymnastics_pulling — pull-ups, chest-to-bar, muscle-ups, toes-to-bar, rope climbs. MUSCLE-UP DECOMPOSITION: a ring muscle-up is a pull AND a press — count roughly two-thirds here, one-third gymnastics_pressing, a small skill_coordination share for the transition. A bar muscle-up is mostly pull and hip drive — count it here with a skill share for the turnover, no pressing unless the standard demands a locked-out dip. Under fatigue the ring version fails at the dip and the bar version at the turnover: put discrimination where the cohort's failure actually sits.
- gymnastics_pressing — HSPU, dips, wall walks, handstand holds (inverted work); the dip third of ring muscle-ups.
- midline — trunk under load/fatigue: GHD, L-sits, heavy carries.
- skill_coordination — double-unders, handstand walk, rhythm and precision skills.
- squat_cycling — high-rep squat capacity under fatigue: wall balls, lunges, step-ups, pistol volume, and squatting at loads the mid-pack athlete cycles unbroken ("light" means exactly that). Leg endurance, not force.
- aerobic_capacity — sustained-output engine, pacing over long continuous work. No machine required: mixed work at sustained pace IS aerobic.
- anaerobic_capacity — repeated high-power / ballistic output and surge tolerance.
- mixed_modal_conditioning — the transition/interference tax of switching implements under fatigue; never a mixed piece's whole engine.`;

export const DRAFT_SYSTEM = `You are an expert strength & conditioning coach tagging scoreable workouts with a SIGNATURE for a training-analysis system.

THE REFERENCE POPULATION — read everything below through this: the GENERAL Open field, everyone on the leaderboard, NOT competitive athletes. Mid-pack reality: skills you might assume universal stop 20–70% of real fields; moderate loads force many athletes into slow singles.

${AXES_GLOSSARY}

A signature has THREE weight vectors over those axes (each: integer percents, multiples of 5, SUM EXACTLY 100, omit zero-weight axes):

1. "demand" — what the workout REQUIRES of anyone who does it, cohort-independent. Draft this FIRST from where a mid-pack athlete's time AND effort actually go (a heavy single is seconds of time and a large share of demand; sustained output is demand that no single movement owns).
2. "discrimination" — what decides RANK in the reference population, conditional on the scoring structure: the cap, the score type, and where the field actually gets ranked shape what separates. A quality can be demanded yet decide nothing (everyone has it), or separate strongly with no visible wall.
3. "stimulus" — what adaptation PERFORMING it produces. Derive it from demand by reducing the axes the workout tests without developing (skill under fatigue, max-effort expressions) and leaving the rest.

"gates" — a gate is a wall that ONE ACQUISITION unlocks: land your first bar muscle-up and the round opens. Strength is never a gate — no single fix unlocks a heavy bar; load difficulty lives in the weights and may dominate discrimination instead. A cliff in the data is evidence; a gate is a mechanism. Record only the binding wall, only for movements a meaningful share of the general field cannot do AT ALL (possession, not speed). Format: [{"movement": "...", "kind": "skill", "detail": "what it blocks"}]. Most workouts have NO gates; an empty array is the common, correct answer.

FOUNDER RULINGS (case law, not statute — extend each by analogy; where a workout falls outside a precedent's reasoning, your judgment governs):
- 22.1: the 50 lb DB snatch decided nothing — real demand, universally cycled, near-zero discrimination. A demanded quality everyone possesses does not separate.
- 22.1: box jump-overs carry anaerobic demand (~10) — much of the field downshifts to slow step-overs, an anaerobic deficit expressing itself. Extend to other ballistic movements by analogy.
- 22.1: wall walks govern the pace, so the engine cannot be cashed in — when a movement bottleneck sets cycle speed, aerobic discrimination sits BELOW its demand and the bottleneck's axis takes the difference.
- 22.3: a 12:00 cap with the field median at 11:16 ranked half the field by reps inside round 3 — discrimination concentrates where the clock bites.
- 22.3: 15 thrusters at 135, deep in fatigue, is strength expression for the general field even at reps — load trumps reps, and volume at 95/65 is already a meaningful strength test mid-pack.
- Degradation discriminates: jump→step, unbroken→singles, kip→strict grind — a steady pace tax on part of the field, with no wall in the distribution.

Also emit:
- "time_domain": "short" (<8 min) | "medium" (8–15) | "long" (>15). When MEASURED CONTEXT gives an expected duration, CONFIRM against it rather than concluding from the movement list; otherwise judge from structure for a mid-pack athlete.
- "format": one of ${SIG_FORMATS.join("/")}.
- "archetype": a 2–5 word label for the recurring test design this matches (e.g. "couplet sprint", "gymnastics ladder with cap", "long grind triplet").
- "rationale": 2–4 sentences — the structural reading, what separates and why, which degradation modes you relied on, why any gate.

Output STRICT JSON only — one object with keys IN THIS ORDER: archetype, rationale, time_domain, format, demand, discrimination, stimulus, gates. Commit to the structural reading (archetype, rationale) first; the numbers follow from it. No markdown fences, no commentary.
Never use the word "CrossFit" anywhere in your output.`;

// ============================================================
// Model call helpers
// ============================================================

export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("model returned no JSON object");
  }
  return JSON.parse(t.slice(start, end + 1));
}

/** Measured leaderboard context for a named (library) workout — null for
 *  generated structures, which have no leaderboard. */
export interface MeasuredLibrary {
  /** Fraction of the field that never finished; absent = <15% censored. */
  censoring?: {
    year: number;
    capped_frac: number;
    time_cap_seconds: number | null;
    n: number;
  };
  /** The score where the largest share of the field piled up (the wall). */
  pile?: { year: number; pile_at_score: number; pile_share: number; n_total: number };
  /** Typical relative spread (p75−p25)/p50 for this duration/scoring class. */
  expected_rel_iqr?: number;
}

/** One drafting call with one validation-driven repair attempt. */
export async function draftSignature(
  workout: BlockPrescription,
  library: MeasuredLibrary | null,
  measured: ExpectedBenchmark | null,
  apiKey: string,
): Promise<SignatureDraft> {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const workoutJson = JSON.stringify(workout, null, 2);
  // MEASURED CONTEXT rides EVERY draft that has it, library workout or not —
  // the judge confirms duration/pacing against computation instead of
  // inferring them from the movement list.
  const parts: string[] = [];
  if (measured) {
    parts.push(`Computed for this exact prescription (cohort power model): expected median ${
      measured.median_score
    }${measured.median_seconds ? ` (~${Math.round(measured.median_seconds)}s)` : ""}, time_domain ${
      measured.time_domain
    }, median cohort power ${measured.median_watts}W.`);
  }
  if (library) {
    parts.push(`Leaderboard facts (general Open population): ${
      JSON.stringify(library)
    } — capped_frac = share that never finished (ranked by reps where the clock bit); pile_at_score/pile_share = the measured wall (whether it is a gate is the mechanism call); expected_rel_iqr = typical relative spread for this duration and scoring class.`);
  }
  const measuredBlock = parts.length
    ? `\n\nMEASURED CONTEXT (condition your judgments on these — they outrank your priors):\n${parts.join("\n")}`
    : "";
  const ask = `Tag this workout:\n\n${workoutJson}${measuredBlock}`;

  let raw = await callClaude({
    apiKey,
    system: DRAFT_SYSTEM,
    userContent: ask,
    maxTokens: 2000,
    fallbackToHaiku: false, // judgment seat — a degraded draft is worse than none
  });
  let sig = extractJson(raw) as SignatureDraft;
  let errors = validateSignature(sig, true);

  if (errors.length > 0) {
    raw = await callClaude({
      apiKey,
      system: DRAFT_SYSTEM,
      userContent:
        `${ask}\n\nYour previous attempt failed validation:\n${JSON.stringify(sig)}\n\nErrors:\n- ${
          errors.join("\n- ")
        }\n\nEmit corrected strict JSON.`,
      maxTokens: 2000,
      fallbackToHaiku: false,
    });
    sig = extractJson(raw) as SignatureDraft;
    errors = validateSignature(sig, true);
    if (errors.length > 0) {
      throw new Error(`draft failed validation after repair: ${errors.join("; ")}`);
    }
  }
  sig.gates = Array.isArray(sig.gates) ? sig.gates : [];
  return sig;
}

// ============================================================
// Provenance + workout identity (server-managed)
// ============================================================

/** Default v1 provenance: every vector is editorial judgment; discrimination
 *  is derived from demand by cohort adjustment. 'empirical' provenance
 *  (cohort, n, fitted_at, fit_quality) arrives only when the regression
 *  layer exists — never from this function's clients. */
export const DEFAULT_PROVENANCE = {
  demand: { kind: "editorial" },
  discrimination: { kind: "derived_from_demand" },
  stimulus: { kind: "editorial" },
};

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" +
      Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") +
      "}";
  }
  return JSON.stringify(v) ?? "null";
}

/** The workout's identity: a hash of its canonical structure, distinct from
 *  the signature's version. Empirical provenance is pinned to this hash. */
export async function hashWorkout(workout: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(workout)),
  );
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The lenient join keys this signature claims in the wsh1_ address space
 *  (identity stays strict via workout_hash; JOINING is lenient by design).
 *  Structure hash always; text hash too when the admin pasted source text. */
export async function evidenceHashesFor(
  workout: BlockPrescription,
  sourceText?: string,
  openName?: string,
): Promise<string[]> {
  const hashes: string[] = [];
  // Open signatures also claim the deterministic name key, so Open-history
  // ingestion rows written before (or without) a structure hash stay
  // claimable (review item 2, 2026-11-02).
  if (openName?.trim()) hashes.push(`open_name_${openName.trim().toLowerCase()}`);
  try {
    const movements = (workout.movements ?? []).map((m) => ({
      movement: m.movement ?? "",
      reps: (m as { rep_scheme?: number[] }).rep_scheme ?? m.reps ?? null,
      load: m.weight != null ? `${m.weight}${m.weight_unit ?? "lbs"}` : null,
    }));
    hashes.push(await hashWorkoutStructure({
      block_scheme: workout.block_scheme ?? null,
      time_cap_seconds: workout.time_cap_seconds ?? null,
      movements,
    }));
  } catch (_) { /* a structure the hasher can't read claims nothing */ }
  if (sourceText?.trim()) {
    hashes.push(await hashWorkoutText(
      sourceText,
      workout.block_scheme ?? null,
      workout.time_cap_seconds ?? null,
    ));
  }
  return hashes;
}

/** Retroactive join: point waiting unsigned ledger rows at this signature.
 *  Best-effort — a failed claim never fails the save. */
/** Minimal structural supabase-js client type: any client instance fits,
 *  whatever its generics — the cross-module generic mismatch is noise here. */
// deno-lint-ignore no-explicit-any
export type SupaLike = { from: (table: string) => any };

export async function claimEvidence(
  supa: SupaLike,
  signatureId: string,
  hashes: string[],
): Promise<number> {
  if (hashes.length === 0) return 0;
  const { data, error } = await supa
    .from("signature_evidence")
    .update({ workout_signature_id: signatureId })
    .in("workout_hash", hashes)
    .is("workout_signature_id", null)
    .select("id");
  if (error) {
    console.warn("[signature-draft-core] evidence claim failed:", error.message);
    return 0;
  }
  return (data ?? []).length;
}
