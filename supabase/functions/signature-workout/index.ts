/**
 * signature-workout — Workout Signatures, phase 2 (ADMIN-ONLY tool).
 *
 * The one reusable brain of the signature system: every consumer (admin
 * review queue, what-if editor, later program audits and the composer)
 * calls this same function.
 *
 * Input is always the canonical structured workout (BlockPrescription —
 * the shape the generator writes and preprocess-program parses into).
 * Raw text enters only through the `parse` action.
 *
 * Actions:
 *   { action: "parse", text }        → one Sonnet call: workout text →
 *                                      BlockPrescription. Nothing stored.
 *   { action: "draft", workout, gender? }
 *                                    → one Sonnet call drafts the editorial
 *                                      judgments (demand / discrimination /
 *                                      stimulus weights over FOCUS_AREAS,
 *                                      gates, archetype, rationale), then the
 *                                      deterministic measured layer runs.
 *                                      Nothing stored.
 *   { action: "measure", workout, gender? }
 *                                    → deterministic layer only (expected
 *                                      benchmark / time domain / anchors).
 *                                      Zero tokens — this is what makes
 *                                      load/rep edits feel instant.
 *   { action: "save", row }          → insert or update a draft row.
 *   { action: "approve", id, row? }  → final weight edits + status approved.
 *   { action: "reject", id }         → status rejected (row kept).
 *   { action: "list", status? }      → the review queue.
 *   { action: "delete", id }         → remove a row.
 *   { action: "selftest" }           → version + env checks.
 *
 * Weight rules (validated server-side, both on draft and save):
 *   keys ⊆ FOCUS_AREAS, integer percents in 5% steps, sum exactly 100.
 *
 * The function never persists on draft/parse/measure — persistence happens
 * only through save/approve, so the editorial gate stays real (same
 * principle as score-program's parse/ratify split).
 *
 * NAMING LAW: no output of this function may contain the word "CrossFit"
 * or imply a vendor relationship.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { callClaude } from "../_shared/call-claude.ts";
import { FOCUS_AREAS } from "../_shared/coach-state.ts";
import {
  composeEngineVersion,
  computeBlockBenchmarkExplained,
  measurableSignatureWorkout,
  type ExpectedBenchmark,
} from "../_shared/compute-block-benchmark.ts";
import { __clearWorkCalcMemo } from "../_shared/compute-benchmarks.ts";
import {
  percentileAtScore,
  scoreAtPercentile,
  spliceGatedPercentile,
  unspliceGatedPercentile,
  wallMassFromCurve,
} from "../_shared/signature-gate-splice.ts";
import type { BlockPrescription } from "../_shared/v2-output-schema.ts";
import type { Gender } from "../_shared/compute-benchmarks.ts";
import {
  LOAD_SCORED,
  OPEN_OBSERVED_MEDIANS,
  SECONDS_UNTRUSTED,
  type ObservedMedianRow,
} from "../_shared/fixtures/open-observed-medians.ts";
import {
  hashWorkoutStructure,
  hashWorkoutText,
} from "../_shared/signature-hash.ts";

const FUNCTION_VERSION = "2026-11-02.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ??
  Deno.env.get("ANTHROPIC_API_KEY");

const MAX_TEXT_CHARS = 8_000;
const GATE_KINDS = ["skill", "load", "capacity"] as const;
const SIG_FORMATS = ["amrap", "for_time", "intervals", "emom", "ladder"] as const;

// ============================================================
// Weight / gate validation
// ============================================================

type Weights = Record<string, number>;

function validateWeights(w: unknown, label: string): string[] {
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

function validateGates(g: unknown): string[] {
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

interface SignatureDraft {
  demand: Weights;
  discrimination: Weights;
  stimulus: Weights;
  gates: Array<{ movement: string; kind: string; detail?: string }>;
  time_domain?: "short" | "medium" | "long";
  format?: string;
  archetype?: string;
  rationale?: string;
}

function validateSignature(sig: Partial<SignatureDraft>, requireAll: boolean): string[] {
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

const AXES_GLOSSARY = `The ONLY allowed weight keys (the fixed training axes), with their boundaries — these are definitions of what the words mean:
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

const DRAFT_SYSTEM = `You are an expert strength & conditioning coach tagging scoreable workouts with a SIGNATURE for a training-analysis system.

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

const PARSE_SYSTEM = `You parse ONE workout from raw text into a strict JSON structure. Output JSON only — no fences, no commentary.

Shape:
{
  "block_type": "metcon" | "strength" | "skills" | "cardio" | "accessory",
  "block_scheme": string,          // the rendered header, e.g. "21-15-9 for time (12-min cap)" or "AMRAP 15"
  "time_cap_seconds": number|null, // stated cap OR fixed clock (AMRAP 15 → 900); null if uncapped
  "movements": [{
    "movement": string,            // canonical movement name, e.g. "Dumbbell Snatch"
    "rep_scheme": number[]|null,   // per-round reps: "21-15-9" → [21,15,9]; 3 RFT of 15 → [15,15,15]; AMRAP round of 10 → [10]; 100 straight → [100]
    "cal_scheme": number[]|null,   // per-round calories when they vary; uniform rounds use "calories" instead
    "distance_scheme": number[]|null, // per-round meters when they vary
    "calories": number|null,       // per-round calories (uniform)
    "distance": number|null,       // per-round distance (uniform)
    "distance_unit": "m"|"ft"|null,
    "weight": number|null,         // RX men's load when stated
    "weight_unit": "lbs"|"kg"|null,
    "time_seconds": number|null    // duration prescriptions ("row 5 min" → 300)
  }]
}

Rules: movements in performed order. Every movement needs at least one volume field. Use the men's RX load when two are given ("50/35" → 50, "♀ 85 lb / ♂ 135 lb" → 135). VARYING LOADS SPLIT THE MOVEMENT: when the same movement appears at different loads across a ladder or sections, emit ONE ENTRY PER LOAD with its own reps (15 squat cleans at 135, then 13 at 185 → two entries) — never a single collapsed entry with the load dropped; the loads are the workout's defining feature. Do arithmetic for schemes ("5 rounds: 12 snatches" → rep_scheme [12,12,12,12,12]). Default block_type "metcon" for scored mixed work. Never use the word "CrossFit" in output.`;

// ============================================================
// Model call helpers
// ============================================================

function extractJson(text: string): unknown {
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

/** One drafting call with one validation-driven repair attempt. */
async function draftSignature(
  workout: BlockPrescription,
  library: MeasuredLibrary | null,
  measured: ExpectedBenchmark | null,
): Promise<SignatureDraft> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
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
    apiKey: ANTHROPIC_API_KEY,
    system: DRAFT_SYSTEM,
    userContent: ask,
    maxTokens: 2000,
    fallbackToHaiku: false, // judgment seat — a degraded draft is worse than none
  });
  let sig = extractJson(raw) as SignatureDraft;
  let errors = validateSignature(sig, true);

  if (errors.length > 0) {
    raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY,
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

async function parseWorkout(text: string): Promise<BlockPrescription> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const raw = await callClaude({
    apiKey: ANTHROPIC_API_KEY,
    system: PARSE_SYSTEM,
    userContent: text,
    maxTokens: 2000,
    fallbackToHaiku: false,
  });
  const parsed = extractJson(raw) as Record<string, unknown>;
  if (!Array.isArray(parsed.movements) || parsed.movements.length === 0) {
    throw new Error("parse produced no movements");
  }
  // Strip nulls so the object matches the optional-field BlockPrescription shape.
  const clean = (o: Record<string, unknown>) => {
    for (const k of Object.keys(o)) if (o[k] === null) delete o[k];
    return o;
  };
  clean(parsed);
  parsed.movements = (parsed.movements as Record<string, unknown>[]).map(clean);
  return parsed as unknown as BlockPrescription;
}

/** Deterministic layer — zero tokens. Null when the structure has no
 *  resolvable benchmark (non-metcon, unresolved movement). The reason is
 *  always carried: silent nulls are how twelve absurd numbers nearly
 *  became the acceptance verdict (audit run 1, 2026-11-03). */
async function measure(
  workout: BlockPrescription,
  gender: Gender,
): Promise<{ bench: ExpectedBenchmark | null; reason: string | null }> {
  try {
    return await computeBlockBenchmarkExplained(workout, gender);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[signature-workout] measure failed: ${msg}`);
    return { bench: null, reason: `measure_threw:${msg.slice(0, 80)}` };
  }
}

// ============================================================
// The measured layer (phase-1 sweep outputs, seeded by migration)
// ============================================================

interface MeasuredLibrary {
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

/** Look up what the leaderboards measured for a named workout + duration
 *  class. Judgment-free context for drafting and adjudication. */
async function fetchMeasuredLibrary(
  supa: ReturnType<typeof createClient>,
  name: string,
  gender: Gender,
  workout: BlockPrescription,
  medianSeconds: number | null,
): Promise<MeasuredLibrary | null> {
  const g = gender === "women" ? "F" : "M";
  const lib: MeasuredLibrary = {};

  if (name) {
    const [{ data: cens }, { data: pile }] = await Promise.all([
      supa.from("signature_censoring")
        .select("year, capped_frac, time_cap_seconds, n")
        .eq("workout_name", name).eq("gender", g)
        .order("year", { ascending: false }).limit(1).maybeSingle(),
      supa.from("signature_gate_catalog")
        .select("year, pile_at_score, pile_share, n_total")
        .eq("workout_name", name).eq("gender", g)
        .order("year", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (cens) lib.censoring = cens as MeasuredLibrary["censoring"];
    if (pile) lib.pile = pile as MeasuredLibrary["pile"];
  }

  // Expected spread by duration class: nearest bin midpoint, matching scoring type.
  const basisSeconds = medianSeconds ?? workout.time_cap_seconds ?? null;
  if (basisSeconds && basisSeconds > 0) {
    const repScored = /\bamrap\b|\bemom\b/i.test(workout.block_scheme ?? "");
    const { data: bins } = await supa.from("signature_duration_curve")
      .select("bin_min_s, bin_max_s, median_rel_iqr")
      .eq("competition_type", "open").eq("rep_scored", repScored);
    if (bins && bins.length > 0) {
      const nearest = (bins as Array<{ bin_min_s: number; bin_max_s: number; median_rel_iqr: number }>)
        .map((b) => ({ b, d: Math.abs((b.bin_min_s + b.bin_max_s) / 2 - basisSeconds) }))
        .sort((a, z) => a.d - z.d)[0];
      lib.expected_rel_iqr = Number(nearest.b.median_rel_iqr);
    }
  }

  return (lib.censoring || lib.pile || lib.expected_rel_iqr != null) ? lib : null;
}

// ============================================================
// Provenance + workout identity (server-managed)
// ============================================================

/** Default v1 provenance: every vector is editorial judgment; discrimination
 *  is derived from demand by cohort adjustment. 'empirical' provenance
 *  (cohort, n, fitted_at, fit_quality) arrives only when the regression
 *  layer exists — never from this function's clients. */
const DEFAULT_PROVENANCE = {
  demand: { kind: "editorial" },
  discrimination: { kind: "derived_from_demand" },
  stimulus: { kind: "editorial" },
};

function canonicalJson(v: unknown): string {
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
async function hashWorkout(workout: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(workout)),
  );
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The lenient join keys this signature claims in the wsh1_ address space
 *  (identity stays strict via workout_hash; JOINING is lenient by design).
 *  Structure hash always; text hash too when the admin pasted source text. */
async function evidenceHashesFor(
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

/** Release rows this signature claimed under hashes it no longer carries —
 *  the evidence-level mirror of staleMarkProvenance: a profile's training
 *  rows must not follow a signature whose structure changed from under
 *  them. Released rows return to waiting and the right signature (or a
 *  reclaim pass) picks them up. Best-effort like the claim. */
async function releaseStaleEvidence(
  supa: ReturnType<typeof createClient>,
  signatureId: string,
  keepHashes: string[],
): Promise<number> {
  let q = supa
    .from("signature_evidence")
    .update({ workout_signature_id: null })
    .eq("workout_signature_id", signatureId);
  if (keepHashes.length > 0) {
    q = q.not("workout_hash", "in", `(${keepHashes.map((h) => `"${h}"`).join(",")})`);
  }
  const { data, error } = await q.select("id");
  if (error) {
    console.warn("[signature-workout] evidence release failed:", error.message);
    return 0;
  }
  return (data ?? []).length;
}

/** Signatures other than this one that list any of the same join keys —
 *  duplicate-structure detection, surfaced so the admin sees which
 *  signature owns the evidence (first claim wins until merged). */
async function findHashConflicts(
  supa: ReturnType<typeof createClient>,
  signatureId: string,
  hashes: string[],
): Promise<Array<{ id: string; name: string; status: string }>> {
  if (hashes.length === 0) return [];
  const { data, error } = await supa
    .from("workout_signatures")
    .select("id, name, status")
    .neq("id", signatureId)
    .overlaps("evidence_hashes", hashes);
  if (error) return [];
  return (data ?? []) as Array<{ id: string; name: string; status: string }>;
}

/** Retroactive join: point waiting unsigned ledger rows at this signature.
 *  Best-effort — a failed claim never fails the save. */
async function claimEvidence(
  supa: ReturnType<typeof createClient>,
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
    console.warn("[signature-workout] evidence claim failed:", error.message);
    return 0;
  }
  return (data ?? []).length;
}

/** Stale-mark any empirical vector when the workout structure changed —
 *  a regression fitted on one structure must not describe another. */
function staleMarkProvenance(
  prov: Record<string, { kind?: string } & Record<string, unknown>>,
  hashChanged: boolean,
): Record<string, unknown> {
  if (!hashChanged) return prov;
  const out: Record<string, unknown> = { ...prov };
  for (const key of ["demand", "discrimination", "stimulus"]) {
    const p = prov[key];
    if (p?.kind === "empirical") {
      out[key] = {
        ...p,
        kind: "stale_empirical",
        invalidated_at: new Date().toISOString(),
        invalidated_by: "workout_edit",
      };
    }
  }
  return out;
}

// ============================================================
// Row shaping
// ============================================================

const ROW_FIELDS = [
  "source",
  "competition_workout_id",
  "name",
  "workout",
  "demand",
  "discrimination",
  "stimulus",
  "gates",
  "time_domain",
  "format",
  "archetype",
  "rationale",
  "measured",
  "drafted_model",
] as const;

function pickRowFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of ROW_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

// ============================================================
// Handler
// ============================================================

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    // ── Auth: admin only while this is a review tool ─────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "UNAUTHORIZED" }, 401);
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "UNAUTHORIZED" }, 401);
    const { data: profile } = await supa
      .from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "FORBIDDEN" }, 403);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const gender: Gender = body.gender === "women" ? "women" : "men";

    if (action === "selftest") {
      return json({
        ok: true,
        version: FUNCTION_VERSION,
        anthropic_key: !!ANTHROPIC_API_KEY,
        focus_areas: FOCUS_AREAS,
      });
    }

    if (action === "parse") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json({ error: "MISSING_TEXT" }, 400);
      if (text.length > MAX_TEXT_CHARS) return json({ error: "TEXT_TOO_LONG" }, 400);
      const workout = await parseWorkout(text);
      return json({ workout });
    }

    if (action === "draft" || action === "measure") {
      let workout = body.workout as BlockPrescription | undefined;
      let loadsWomenInvalid: number[] | null = null;
      // A stored signature is measured THROUGH ITS ROW (chokepoint), not
      // through a client-posted copy of its jsonb — the client copy
      // lacks loads_women and would quietly model women at men's bars
      // (review 2026-11-04). Pass signature_id to measure a saved row.
      if (typeof body.signature_id === "string") {
        const { data: sigRow } = await supa
          .from("workout_signatures")
          .select("workout, loads_women")
          .eq("id", body.signature_id)
          .maybeSingle();
        if (!sigRow) return json({ error: "NOT_FOUND" }, 404);
        const row = sigRow as { workout: BlockPrescription; loads_women: Record<string, number> | null };
        // What-if flow (review 2026-11-04): the editor may post an EDITED
        // copy of the jsonb alongside signature_id to re-measure a change.
        // Merge the ROW's women's loads onto the posted copy through the
        // chokepoint: a load-only edit keeps indices valid and merges
        // cleanly; a reorder (or an edit that drops men's load at or
        // below the women's) is refused by the guard and surfaced in
        // loads_women_invalid rather than silently measuring women at
        // men's bars. No signature_id + no row = a genuinely new
        // structure, where having no women's loads is correct.
        const merged = measurableSignatureWorkout({
          workout: workout ?? row.workout,
          loads_women: row.loads_women,
        });
        workout = merged.workout;
        loadsWomenInvalid = merged.invalid.length > 0 ? merged.invalid : null;
      }
      if (!workout || !Array.isArray(workout.movements) || workout.movements.length === 0) {
        return json({ error: "MISSING_WORKOUT" }, 400);
      }
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const { bench: measured, reason: measureReason } = await measure(workout, gender);
      const library = await fetchMeasuredLibrary(
        supa, name, gender, workout, measured?.median_seconds ?? null,
      );
      if (action === "measure") {
        return json({
          measured,
          measure_reason: measureReason,
          measured_library: library,
          loads_women_invalid: loadsWomenInvalid,
        });
      }
      const signature = await draftSignature(workout, library, measured);
      return json({
        signature, measured, measured_library: library,
        drafted_model: "sonnet", loads_women_invalid: loadsWomenInvalid,
      });
    }

    if (action === "save") {
      const fields = pickRowFields(body);
      const sigErrors = validateSignature(fields as Partial<SignatureDraft>, false);
      if (sigErrors.length > 0) return json({ error: sigErrors.join("; ") }, 422);
      const id = typeof body.id === "string" ? body.id : null;
      let existingRow: { workout_hash: string | null; provenance: unknown; source: string; name: string } | null = null;
      if (id) {
        const { data } = await supa
          .from("workout_signatures")
          .select("workout_hash, provenance, source, name")
          .eq("id", id).maybeSingle();
        existingRow = data as typeof existingRow;
      }
      if (fields.workout) {
        fields.workout_hash = await hashWorkout(fields.workout);
        const source = (fields.source ?? existingRow?.source) as string | undefined;
        const name = (fields.name ?? existingRow?.name) as string | undefined;
        fields.evidence_hashes = await evidenceHashesFor(
          fields.workout as BlockPrescription,
          typeof body.source_text === "string" ? body.source_text : undefined,
          source === "open" ? name : undefined,
        );
      }
      if (id) {
        const existing = existingRow;
        if (!existing) return json({ error: "NOT_FOUND" }, 404);
        const hashChanged = !!fields.workout_hash && !!existing.workout_hash &&
          fields.workout_hash !== existing.workout_hash;
        fields.provenance = staleMarkProvenance(
          (existing.provenance ?? DEFAULT_PROVENANCE) as Record<string, { kind?: string }>,
          hashChanged,
        );
        const { data, error } = await supa
          .from("workout_signatures")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", id).select().single();
        if (error) return json({ error: error.message }, 500);
        const hashes = (data.evidence_hashes ?? []) as string[];
        const released = await releaseStaleEvidence(supa, data.id, hashes);
        const claimed = await claimEvidence(supa, data.id, hashes);
        const conflicts = await findHashConflicts(supa, data.id, hashes);
        return json({
          row: data,
          evidence_claimed: claimed,
          evidence_released: released,
          hash_conflicts: conflicts,
        });
      }
      if (!fields.name || !fields.workout || !fields.demand) {
        return json({ error: "MISSING_FIELDS (name, workout, demand required)" }, 400);
      }
      // A nameless save re-run (bulk re-paste after a parse fix) overwrites an
      // existing DRAFT of the same name — never an approved/rejected row, which
      // is ratified editorial work.
      const { data: existing } = await supa
        .from("workout_signatures").select("id, status")
        .eq("source", fields.source ?? "adhoc").ilike("name", fields.name as string)
        .maybeSingle();
      if (existing) {
        if (existing.status !== "draft") {
          return json({ error: `"${fields.name}" is already ${existing.status} — not overwritten` }, 409);
        }
        const { data, error } = await supa
          .from("workout_signatures")
          .update({ ...fields, provenance: DEFAULT_PROVENANCE, updated_at: new Date().toISOString() })
          .eq("id", existing.id).select().single();
        if (error) return json({ error: error.message }, 500);
        const hashes = (data.evidence_hashes ?? []) as string[];
        const released = await releaseStaleEvidence(supa, data.id, hashes);
        const claimed = await claimEvidence(supa, data.id, hashes);
        const conflicts = await findHashConflicts(supa, data.id, hashes);
        return json({
          row: data,
          evidence_claimed: claimed,
          evidence_released: released,
          hash_conflicts: conflicts,
        });
      }
      const { data, error } = await supa
        .from("workout_signatures")
        .insert({ ...fields, status: "draft", provenance: DEFAULT_PROVENANCE })
        .select().single();
      if (error) return json({ error: error.message }, 500);
      const newHashes = (data.evidence_hashes ?? []) as string[];
      const claimed = await claimEvidence(supa, data.id, newHashes);
      const conflicts = await findHashConflicts(supa, data.id, newHashes);
      return json({ row: data, evidence_claimed: claimed, hash_conflicts: conflicts });
    }

    if (action === "approve" || action === "reject") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return json({ error: "MISSING_ID" }, 400);
      const update: Record<string, unknown> = {
        status: action === "approve" ? "approved" : "rejected",
        updated_at: new Date().toISOString(),
      };
      if (action === "approve") {
        // Final weight edits may ride the approval; the approved row must
        // carry all three valid vectors.
        const fields = pickRowFields(body);
        const { data: existing } = await supa
          .from("workout_signatures").select("*").eq("id", id).single();
        if (!existing) return json({ error: "NOT_FOUND" }, 404);
        const merged = { ...existing, ...fields };
        const sigErrors = validateSignature(merged as Partial<SignatureDraft>, true);
        if (sigErrors.length > 0) return json({ error: sigErrors.join("; ") }, 422);
        if (fields.workout) {
          fields.workout_hash = await hashWorkout(fields.workout);
          const src = (fields.source ?? existing.source) as string | undefined;
          const nm = (fields.name ?? existing.name) as string | undefined;
          fields.evidence_hashes = await evidenceHashesFor(
            fields.workout as BlockPrescription,
            typeof body.source_text === "string" ? body.source_text : undefined,
            src === "open" ? nm : undefined,
          );
          fields.provenance = staleMarkProvenance(
            (existing.provenance ?? DEFAULT_PROVENANCE) as Record<string, { kind?: string }>,
            !!existing.workout_hash && fields.workout_hash !== existing.workout_hash,
          );
        }
        Object.assign(update, fields, { approved_at: new Date().toISOString() });
      }
      const { data, error } = await supa
        .from("workout_signatures").update(update).eq("id", id).select().single();
      if (error) return json({ error: error.message }, 500);
      let claimed = 0;
      if (action === "approve") {
        const hashes = (data.evidence_hashes ?? []) as string[];
        await releaseStaleEvidence(supa, data.id, hashes);
        claimed = await claimEvidence(supa, data.id, hashes);
      }
      return json({ row: data, evidence_claimed: claimed });
    }

    if (action === "scorescale_acceptance") {
      // The score-scale acceptance protocol (design doc, 2026-11-02):
      // predict every ratified Open workout's median from STRUCTURE ALONE
      // (the deterministic measure() path — zero tokens, zero judgment) and
      // score it against the leaderboard's observed medians. The
      // percentile_error summary is the number that seeds obs_noise_var for
      // structure-scored evidence (percentile units, no hand conversion).
      //
      // IN-SAMPLE CAVEAT (review item 3, 2026-11-02): the fixture is
      // independent of the predictor, but the predictor is not independent
      // of the fixture — the stage power curve and cohort anchors were fit
      // on leaderboards that include these workouts. This error is a FLOOR,
      // not an estimate; the honest leave-one-out version needs per-workout
      // curve refits upstream (competition-service job, queued). When this
      // number seeds params, apply a conservative multiplier and say so.
      if (OPEN_OBSERVED_MEDIANS.length === 0) {
        return json({
          error: "NEEDS_FIXTURE",
          detail: "Seed _shared/fixtures/open-observed-medians.ts from the SQL in its header, then redeploy.",
        }, 400);
      }
      const { data: sigRowsRaw, error: sigErr } = await supa
        .from("workout_signatures")
        .select("name, workout, loads_women")
        .eq("source", "open").eq("status", "approved");
      if (sigErr) return json({ error: sigErr.message }, 500);
      // Stable order so slices are reproducible across calls.
      // Merge women's loads (sibling column — never the workout jsonb,
      // whose canonical hash is identity) into in-memory prescriptions:
      // movement index -> lbs lands as weight_women on that movement.
      const loadsWomenWarnings: Array<{ name: string; invalid_indices: number[] }> = [];
      const allSigs = ((sigRowsRaw ?? []) as Array<
        { name: string; workout: BlockPrescription; loads_women: Record<string, number> | null }
      >)
        .map((r) => {
          const merged = measurableSignatureWorkout(r);
          if (merged.invalid.length > 0) {
            loadsWomenWarnings.push({ name: r.name, invalid_indices: merged.invalid });
          }
          return { name: r.name, workout: merged.workout };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      // Batching ({"offset": 0, "limit": 20}): the full polite run (146
      // throttled, retried service calls) exceeds the edge function's
      // 150 s wall clock, so the audit runs in slices and the caller
      // stitches per_workout rows; the summary blocks on a sliced
      // response cover THAT SLICE ONLY (slice.next_offset says where to
      // continue; final figures are computed over the stitched rows).
      const offset = typeof body.offset === "number" && body.offset > 0
        ? Math.floor(body.offset)
        : 0;
      const limit = typeof body.limit === "number" && body.limit > 0
        ? Math.min(Math.floor(body.limit), 200)
        : null;
      const sigRows = limit !== null ? allSigs.slice(offset, offset + limit) : allSigs;
      const slice = limit !== null
        ? {
          offset,
          count: sigRows.length,
          total: allSigs.length,
          next_offset: offset + limit < allSigs.length ? offset + limit : null,
        }
        : null;

      const observed = new Map<string, ObservedMedianRow>();
      for (const r of OPEN_OBSERVED_MEDIANS) {
        observed.set(`${r.workout_name.toLowerCase()}|${r.gender}`, r);
      }
      // Gate piles (signature_gate_catalog): the measured wall per
      // workout x gender, for conditional grading — the engine predicts
      // the possession-conditional distribution, so on gated pieces it
      // is graded against the above-wall segment, the population real
      // users belong to (founder reframe 2026-11-04).
      const { data: pileRows } = await supa
        .from("signature_gate_catalog")
        .select("workout_name, gender, pile_at_score");
      const pileMap = new Map<string, number>();
      for (const pr of (pileRows ?? []) as Array<{ workout_name: string; gender: string; pile_at_score: number }>) {
        pileMap.set(`${pr.workout_name.toLowerCase()}|${pr.gender}`, Number(pr.pile_at_score));
      }

      // Determinism check ({"action":"scorescale_acceptance","determinism":true}):
      // the protocol split (review 2026-11-03) certifies the harness as
      // formula-only, but work-calc runs a server-side AI name resolver, so
      // determinism is checked, not assumed: a dozen workouts, three fresh
      // runs each (memo cleared between runs — otherwise the check is a
      // tautology), byte-identical outputs required. If outputs vary, the
      // repeat variance is a fourth acceptance figure, and the engine
      // version must key the parse cache.
      if (body.determinism === true) {
        const picks = allSigs.slice(0, 12); // always the first 12 by name, unaffected by slicing
        const mismatched: Array<{ name: string; outputs: string[] }> = [];
        let measured = 0;
        for (const s of picks) {
          const outs: string[] = [];
          for (let i = 0; i < 3; i++) {
            __clearWorkCalcMemo();
            const { bench } = await measure(s.workout, "men");
            outs.push(JSON.stringify(bench));
          }
          if (outs[0] !== "null") measured++;
          if (!(outs[0] === outs[1] && outs[1] === outs[2])) {
            mismatched.push({ name: s.name, outputs: outs.map((o) => o.slice(0, 120)) });
          }
        }
        return json({
          determinism: {
            workouts: picks.length,
            measured,
            runs_each: 3,
            deterministic: mismatched.length === 0,
            mismatched,
          },
        });
      }

      // Where the predicted median falls in the observed distribution,
      // via piecewise-linear interpolation through the score-space
      // quartiles (direction auto-detected: seconds descend with
      // percentile, reps ascend). Clamped to [2, 98] outside the range.
      const interpPercentile = (
        pred: number,
        p25: number,
        p50: number,
        p75: number,
      ): number | null => {
        const ascending = p75 > p25;
        if (!ascending && !(p25 > p75)) return null; // degenerate quartiles
        const pts = ascending
          ? [[p25, 25], [p50, 50], [p75, 75]]
          : [[p75, 75], [p50, 50], [p25, 25]]; // sort by score ascending
        if (pts[0][0] >= pts[1][0] || pts[1][0] >= pts[2][0]) return null; // non-monotone
        const seg = pred <= pts[1][0] ? [pts[0], pts[1]] : [pts[1], pts[2]];
        const t = (pred - seg[0][0]) / (seg[1][0] - seg[0][0]);
        return Math.min(98, Math.max(2, seg[0][1] + t * (seg[1][1] - seg[0][1])));
      };

      // "9+14" → total reps, using the structure's reps-per-round.
      const amrapTotalReps = (scoreText: string, workout: BlockPrescription): number | null => {
        const perRound = (workout.movements ?? []).reduce((acc, m) => {
          const scheme = (m as { rep_scheme?: number[] }).rep_scheme;
          if (Array.isArray(scheme) && scheme.length > 0) {
            return acc + scheme.reduce((a, b) => a + b, 0);
          }
          return acc + (typeof m.reps === "number" ? m.reps : 0);
        }, 0);
        const rr = String(scoreText).match(/(\d+)\s*\+\s*(\d+)/);
        if (rr) {
          if (perRound <= 0) return null; // can't convert rounds without a round length
          return Number(rr[1]) * perRound + Number(rr[2]);
        }
        const plain = String(scoreText).match(/^\s*(\d+)\s*(reps?)?\s*$/i);
        return plain ? Number(plain[1]) : null;
      };

      const perWorkout: Array<Record<string, unknown>> = [];
      const relErrsTime: number[] = [];
      const relErrsReps: number[] = [];
      const pctErrs: number[] = [];
      for (const s of sigRows) {
        for (const g of ["men", "women"] as Gender[]) {
          const key = `${s.name.toLowerCase()}|${g === "women" ? "F" : "M"}`;
          const truth = observed.get(key);
          if (!truth) continue;
          // Max-lift pieces are scored in pounds — neither channel applies,
          // and the label comes BEFORE the measure call so the denominator
          // reads honestly (run-1 flaw: these surfaced as no_prediction).
          if (LOAD_SCORED.has(s.name)) {
            perWorkout.push({ name: s.name, gender: g, status: "skipped_load_scored" });
            continue;
          }
          const { bench, reason } = await measure(s.workout, g);
          if (!bench) {
            perWorkout.push({ name: s.name, gender: g, status: `no_prediction:${reason ?? "unknown"}` });
            continue;
          }
          // ── v3 grading (fixture carries the observed grid) ──────────
          if (truth.points && truth.points.length >= 5) {
            const pts = truth.points;
            const isRepScored = bench.median_seconds === null;
            const predVal = isRepScored
              ? amrapTotalReps(String(bench.median_score), s.workout)
              : bench.median_seconds;
            if (predVal === null) {
              perWorkout.push({ name: s.name, gender: g, status: "unparseable_prediction" });
              continue;
            }
            const capS3 = truth.time_cap_seconds ?? null;
            if (isRepScored ? (predVal < 1 || (capS3 !== null && predVal / capS3 > 2.5)) : predVal <= 0) {
              perWorkout.push({
                name: s.name, gender: g, status: "skipped_implausible",
                predicted: Math.round(predVal), kind: isRepScored ? "reps" : "time",
              });
              continue;
            }
            const pile = pileMap.get(key);
            const wRaw = pile !== undefined ? wallMassFromCurve(pts, pile) : null;
            // a wall under 15% barely censors; over 97% leaves no segment
            const gatedW = wRaw !== null && wRaw >= 0.15 && wRaw <= 0.97 ? wRaw : null;
            const fieldPct = percentileAtScore(pts, predVal, !isRepScored);
            const obsField = scoreAtPercentile(pts, 50);
            const headlineObs = gatedW !== null
              ? scoreAtPercentile(pts, spliceGatedPercentile(50, gatedW))
              : obsField;
            const unitOk = (pt: { fin: boolean | null } | null) =>
              pt !== null && (pt.fin === true) === !isRepScored;
            const row: Record<string, unknown> = {
              name: s.name, gender: g, kind: isRepScored ? "reps" : "time",
              predicted: Math.round(predVal),
              gated_wall: gatedW !== null ? Number(gatedW.toFixed(3)) : null,
              // review caveat 2026-11-04: at-or-below counts slow
              // possessors who ran out of clock as walled, so the
              // above-wall segment reads slightly strong; tie-group
              // bottom lands with the grid fixture, then this flips
              gated_wall_method: gatedW !== null ? "at_or_below" : null,
              engine_version: composeEngineVersion(bench.calc_version),
              basis: bench.basis,
            };
            if (unitOk(obsField)) {
              row.observed_field_p50 = Math.round(obsField!.s);
              row.rel_error_field = Number(((predVal - obsField!.s) / obsField!.s).toFixed(3));
            }
            if (fieldPct !== null) row.percentile_in_field = Number(fieldPct.toFixed(1));
            if (!unitOk(headlineObs)) {
              row.status = "skipped_scoring_mismatch";
              perWorkout.push(row);
              continue;
            }
            // headline = the population users belong to: above-wall when gated
            const relC = (predVal - headlineObs!.s) / headlineObs!.s;
            row.observed = Math.round(headlineObs!.s);
            row.rel_error = Number(relC.toFixed(3));
            (isRepScored ? relErrsReps : relErrsTime).push(Math.abs(relC));
            if (fieldPct !== null) {
              const pe = gatedW !== null
                ? unspliceGatedPercentile(fieldPct, gatedW) - 50
                : fieldPct - 50;
              row.percentile_error = Number(pe.toFixed(1));
              pctErrs.push(pe);
            }
            perWorkout.push(row);
            continue;
          }

          // measure() knows which scoring it produced — key on that alone.
          const isRepScored = bench.median_seconds === null;
          const q25 = truth.p25_score != null ? Number(truth.p25_score) : null;
          const q50 = truth.p50_score != null ? Number(truth.p50_score) : null;
          const q75 = truth.p75_score != null ? Number(truth.p75_score) : null;
          const quartilesDescend = q25 != null && q75 != null && q25 > q75;
          const quartilesAscend = q25 != null && q75 != null && q25 < q75;
          // ONE source for the observed duration (seed review 2026-11-03):
          // when the field is finisher-ranked (descending quartiles) the
          // score-space median IS the median duration — prefer it over the
          // features table, whose duration field defaulted to the cap on
          // 18.2 M and disagrees by ~a minute on 24.1. Rows whose upstream
          // time_domain is known-wrong (the 2017 season: 17.2/17.3/17.4)
          // never contribute a features-table duration at all.
          const obsDuration = quartilesDescend && q50 != null
            ? q50
            : SECONDS_UNTRUSTED.has(s.name)
            ? null
            : truth.observed_median_s;
          // Capped-median guard: when the observed median sits at the cap,
          // half the field never finished and a seconds comparison is
          // invalid (22.3, 19.2) — rep-space or nothing.
          const observedAtCap = truth.time_cap_seconds != null &&
            obsDuration != null &&
            obsDuration >= truth.time_cap_seconds * 0.98;
          // Scoring-direction cross-check (23.3-style encoding ambiguity):
          // a seconds prediction against a rep-ranked field whose median
          // supposedly finished is two sources contradicting each other
          // about the workout's structure — skip visibly, don't guess.
          if (!isRepScored && !observedAtCap && quartilesAscend && obsDuration) {
            perWorkout.push({ name: s.name, gender: g, status: "skipped_scoring_mismatch" });
            continue;
          }

          let pred: number | null = null;
          let obs: number | null = null;
          let kind = "";
          if (!isRepScored && !observedAtCap && obsDuration) {
            pred = bench.median_seconds;
            obs = obsDuration;
            kind = "time";
          } else if ((isRepScored || observedAtCap) && truth.p50_score) {
            pred = isRepScored
              ? amrapTotalReps(String(bench.median_score), s.workout)
              : null; // capped for_time: measure() has no rep-space median yet
            obs = Number(truth.p50_score);
            kind = "reps";
            if (pred === null) {
              perWorkout.push({
                name: s.name, gender: g,
                status: observedAtCap ? "skipped_capped_median" : "unparseable_prediction",
              });
              continue;
            }
          } else {
            perWorkout.push({ name: s.name, gender: g, status: "skipped_no_basis" });
            continue;
          }

          // Plausibility bounds (review 2026-11-03): crude physics checks
          // run BEFORE any value enters the error statistics, and fail as
          // named statuses with the value attached. Bounds catch the next
          // reading error the audit has no twin for. 2.5 reps/s sustained
          // is beyond any mixed workout (pure double-under pieces peak
          // ~1.1 over a full cap).
          const capS = truth.time_cap_seconds ?? null;
          const implausible = kind === "reps"
            ? (pred! < 1 || (capS !== null && pred! / capS > 2.5))
            : pred! <= 0;
          if (implausible) {
            perWorkout.push({
              name: s.name, gender: g,
              status: "skipped_implausible",
              predicted: Math.round(pred!), observed: Math.round(obs!), kind,
            });
            continue;
          }

          const rel = (pred! - obs!) / obs!;
          (kind === "time" ? relErrsTime : relErrsReps).push(Math.abs(rel));
          const pctAt = (truth.p25_score != null && truth.p50_score != null && truth.p75_score != null)
            ? interpPercentile(pred!, Number(truth.p25_score), Number(truth.p50_score), Number(truth.p75_score))
            : null;
          // quartiles must live in the same score space as the comparison:
          // for time rows require descending seconds through the quartiles.
          const pctErr = pctAt !== null &&
              (kind === "reps" || Number(truth.p25_score) > Number(truth.p75_score))
            ? pctAt - 50
            : null;
          if (pctErr !== null) pctErrs.push(pctErr);
          perWorkout.push({
            name: s.name, gender: g, kind,
            predicted: Math.round(pred!),
            observed: Math.round(obs!),
            rel_error: Number(rel.toFixed(3)),
            percentile_error: pctErr !== null ? Number(pctErr.toFixed(1)) : null,
            // a result you can't tie to the code and curve that produced
            // it isn't evidence (review 2026-11-04)
            engine_version: composeEngineVersion(bench.calc_version),
            basis: bench.basis,
          });
        }
      }
      const summarize = (xs: number[]) =>
        xs.length === 0 ? null : {
          n: xs.length,
          median_abs_rel_error: Number(
            xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(3),
          ),
          mean_abs_rel_error: Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)),
        };
      const pctMean = pctErrs.length ? pctErrs.reduce((a, b) => a + b, 0) / pctErrs.length : null;
      const pctVar = pctErrs.length > 1 && pctMean !== null
        ? pctErrs.reduce((a, b) => a + (b - pctMean) ** 2, 0) / (pctErrs.length - 1)
        : null;
      return json({
        in_sample: true,
        slice,
        // non-empty = seeded loads no longer match the prescriptions the
        // migration author saw — fix the row, never ship the mismatch
        loads_women_warnings: loadsWomenWarnings,
        time_scored: summarize(relErrsTime),
        rep_scored: summarize(relErrsReps),
        // THE number for params: variance of where predicted medians land
        // in the observed distributions, percentile² — plus the bias,
        // which should be ~0 if the watts layer is honest.
        percentile_error: pctErrs.length
          ? {
            n: pctErrs.length,
            bias: Number(pctMean!.toFixed(2)),
            sd: Number(Math.sqrt(pctVar ?? 0).toFixed(2)),
            var_for_obs_noise: Number((pctVar ?? 0).toFixed(1)),
          }
          : null,
        per_workout: perWorkout.sort((a, b) =>
          Math.abs((b.rel_error as number) ?? 0) - Math.abs((a.rel_error as number) ?? 0)
        ),
      });
    }

    if (action === "reclaim_evidence") {
      // Reconciliation: the per-save claim is best-effort, so a transient
      // failure can orphan unsigned rows. This re-runs the claim for every
      // signature. Ownership priority when hashes collide (duplicate
      // structures): approved before draft, then oldest — deterministic,
      // and the same signature wins every run.
      const { data: sigRows, error: sigErr } = await supa
        .from("workout_signatures")
        .select("id, status, created_at, evidence_hashes")
        .neq("evidence_hashes", "{}");
      if (sigErr) return json({ error: sigErr.message }, 500);
      const sorted = ((sigRows ?? []) as Array<
        { id: string; status: string; created_at: string; evidence_hashes: string[] | null }
      >).sort((a, b) =>
        (a.status === "approved" ? 0 : 1) - (b.status === "approved" ? 0 : 1) ||
        a.created_at.localeCompare(b.created_at)
      );
      const owner = new Map<string, string>();
      for (const sig of sorted) {
        for (const h of sig.evidence_hashes ?? []) {
          if (!owner.has(h)) owner.set(h, sig.id);
        }
      }
      const byOwner = new Map<string, string[]>();
      for (const [h, sigId] of owner) {
        byOwner.set(sigId, [...(byOwner.get(sigId) ?? []), h]);
      }
      let totalClaimed = 0;
      for (const [sigId, hashes] of byOwner) {
        totalClaimed += await claimEvidence(supa, sigId, hashes);
      }
      return json({ claimed: totalClaimed, signatures_checked: byOwner.size });
    }

    if (action === "list") {
      let q = supa.from("workout_signatures").select("*")
        .order("created_at", { ascending: false }).limit(200);
      if (typeof body.status === "string" && body.status) q = q.eq("status", body.status);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ rows: data ?? [] });
    }

    if (action === "delete") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return json({ error: "MISSING_ID" }, 400);
      const { error } = await supa.from("workout_signatures").delete().eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: `UNKNOWN_ACTION: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[signature-workout] ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
