/**
 * engine-assessment.ts — the standing read of an Engine member's conditioning.
 *
 * WHY (2026-11-26): the Engine facts (signals, analytics, the conditioning
 * curve) are handed to the chat coach headed "raw — interpret yourself", and
 * separately to the sequencer. Each forms its own view, fresh, every time, so
 * two conversations a week apart can reach different conclusions from the same
 * numbers. Programming members have a coach state: one written judgment the
 * coach works from. Engine members had no equivalent.
 *
 * This is that judgment for the Engine: ONE AI read of the facts code already
 * computes, written down, with two or three priorities. It decides nothing
 * about which days are trained (the program and the sequencer do that) and it
 * states no targets (the day page computes those).
 *
 * Coach only to start (founder, 2026-11-26): no member-facing screen shows it.
 *
 * STAGE 2 (2026-11-26): the read is STORED (engine_assessments, append-only)
 * and REUSED until what it was written from has moved on: five more sessions,
 * a new time trial, a changed goal or program, an Engine reset, or new
 * instructions. On a rewrite the AI is shown its previous read and keeps each
 * part of it unless the facts have changed enough to change it, so a priority
 * does not flip for no reason. The chat coach, the workout review and the
 * sequencer are all given the stored read.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildConditioningState } from "./conditioning-state.ts";
import { flagGuide, REGIONS } from "./engine-continuum.ts";
import { MODELS } from "./model-profiles.ts";

export const ENGINE_ASSESSMENT_BUILDER_VERSION = "v1.3";

/** A stored read is rewritten once this many sessions have been logged since
 *  it was written (founder, 2026-11-26). Change it here. */
export const REWRITE_AFTER_SESSIONS = 5;

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = MODELS.fable;

/** The effort-duration bands of the conditioning curve, plus the two things a
 *  priority can be about that are not a band. The AI picks from these. */
export const ASSESSMENT_FOCUSES: readonly string[] = [...REGIONS.map((r) => r[2]), "calibration", "consistency"];
/** A strength is a band or consistency. "calibration" is a priority only: a
 *  fresh baseline is not something the athlete is good at (the first batch used
 *  it for "paced work is landing where it should", which is execution). */
export const STRENGTH_FOCUSES: readonly string[] = [...REGIONS.map((r) => r[2]), "consistency"];

export interface EngineAssessment {
  /** One sentence: the read of this athlete's conditioning. */
  headline: string;
  /** Where they are strong, in a sentence each (0-2). */
  strengths: Array<{ focus: string; note: string }>;
  /** What to work on, ranked (1-3). */
  priorities: Array<{ rank: number; focus: string; evidence: string; why: string; action: string }>;
  /** A retest worth doing, or null. */
  retest: { machine: string; reason: string } | null;
  /** How firmly the facts support the read. */
  confidence: "low" | "medium" | "high";
  /** What the read is NOT sure of, in a sentence, or "". */
  unknowns: string;
}

export const ENGINE_ASSESSMENT_SYSTEM = `You are an expert conditioning coach writing your STANDING READ of one athlete on the Engine, a machine- and running-based conditioning program. Other coaches (the chat coach, the session sequencer) will work from what you write, so it must be a judgment they can act on, grounded in the numbers you are given. You output a read, not workouts.

YOU ARE GIVEN FACTS. They are computed by the app from the athlete's own sessions and time trials. Do not recompute them and do not invent numbers.
  - ENGINE CONDITIONING SIGNALS: days since the last session; adherence; for each day type and machine the rolling ratio of actual pace to target pace over the last five sessions (1.0 = on target; a max-effort type is measured against the time-trial baseline instead and sits well above 1.0); and the age and history of each machine's time trial, which every target is derived from.
  - ENGINE ANALYTICS: the figures on the athlete's own Analytics page (paces against the time trial, the anaerobic-to-max-aerobic ratio, targets against actual by day type, records, pace by work-to-rest ratio, heart rate when logged).
  - ATHLETE CONDITIONING CURVE: seven bands of EFFORT DURATION, from 20–40 min on the left to ≤30 s on the right. M is this athlete against a balanced athlete at their own time-trial level: 1.0 = balanced, below = that band lags, above = that band is ahead of their trial. state: "measured" = a max effort proved it; "floor" = only sub-maximal days have landed there, so M is a lower bound, not a weakness; "blank" = nothing has landed there, which is an unknown, not a weakness. n = how much evidence. Efforts of 40 minutes or more are zone 2 and are not scored.
  - FLAGS on the curve, and what each means:
${flagGuide()}

POSITIONS ARE GIVEN, NOT YOURS TO DECIDE. The curve carries a "position" line: for each MEASURED band, where it stands against balanced, worked out by the app from fixed lines: "ahead", "balanced", "slightly behind" or "behind". A band shown as "—" is not measured and has no position.
  - "ahead": you may name it as a strength. Never a weakness.
  - "balanced": neither a strength nor a weakness on its own. Do not present it as a gap, and do not present it as a standout strength.
  - "slightly behind": a mild gap. It may be a priority, usually a lower one. NEVER a strength.
  - "behind": a real gap. Make it a priority unless something else clearly outranks it (say what).
  Use these words for where a band stands. Do not re-judge the number yourself: the same number must always read the same way.

HOW TO READ
  - Weight the four middle bands, 30 seconds to 10 minutes, most: that is where mixed workouts live. A gap at 1–4 minutes outranks a gap at ≤30 s.
  - A band is a weakness only when it is MEASURED and its position is "slightly behind" or "behind". "floor" and "blank" are things you do not know yet: say so, and where it matters make finding out the priority.
  - A strength must be a band whose position is "ahead", or consistency, or a band where the athlete is reliably at or above target on real evidence and whose position is not "slightly behind" or "behind".
  - Thin evidence (small n, one or two sessions) supports a tentative read at most. Do not build a priority on one session.
  - Each ratio series steps when the athlete retests, because the ruler changed. Read trends between retests.
  - Machines are separate rulers. Do not compare a pace on one machine, or in one unit, with a pace on another.
  - Sparse or absent training is neutral: never scold, never infer decline from sessions that were not logged.
  - The Engine does not train sprint power of a few seconds. Do not infer it.

WHAT TO WRITE
  - headline: one sentence about where their conditioning stands.
  - strengths: up to two, each tied to a band or to consistency (never "calibration": a fresh baseline is not a strength), with the reason in a sentence.
  - priorities: one to three, ranked. For each: the focus (a band, "calibration" when the baseline itself is the problem, or "consistency" when there is too little recent training to judge anything else), the evidence (the specific figures from the facts that support it, quoted as given), why it matters for them (connect to their stated goal when they gave one), and the action (what kind of work or step addresses it, in plain words; no session prescriptions, no paces, no targets).
  - retest: name a machine only when a flag or the trial's age justifies it, with the reason. Otherwise null.
  - confidence: high only when measured bands with solid evidence agree; medium when the picture is mixed or partly unmeasured; low when it rests on little data.
  - unknowns: one sentence on what the read cannot yet tell, or empty.

WHEN YOU ARE SHOWN YOUR PREVIOUS READ. It is what this athlete's coaches have been working from. Keep each priority, its rank, each strength and the headline's substance UNLESS the facts now in front of you have changed enough to change it: a position label that moved, a new time trial, a range that has since been measured, a clear change in how often they train. Do not reword for its own sake and do not reorder priorities that are still equally supported. Where you do change something, the evidence for that item must say what changed. If nothing material has changed, return the previous read with its figures brought up to date.

VOICE: write every field TO THE ATHLETE, in the second person ("you", "your"), as their coach speaking to them. Never "the athlete" or "this athlete". Plain words, no analyst vocabulary in "headline", "note", "why", "action", "reason" or "unknowns" (no "M", "n=", "ratio", "band state", no flag names). The figures belong in "evidence", which is the one field written for the record rather than to the athlete.`;

export const ENGINE_ASSESSMENT_TOOL = {
  name: "emit_engine_assessment",
  description: "Write the standing read of this athlete's conditioning.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", minLength: 10, maxLength: 240 },
      strengths: {
        type: "array", maxItems: 2,
        items: {
          type: "object",
          properties: { focus: { type: "string", enum: [...STRENGTH_FOCUSES] }, note: { type: "string", minLength: 5, maxLength: 300 } },
          required: ["focus", "note"], additionalProperties: false,
        },
      },
      priorities: {
        type: "array", minItems: 1, maxItems: 3,
        items: {
          type: "object",
          properties: {
            rank: { type: "integer", minimum: 1, maximum: 3 },
            focus: { type: "string", enum: [...ASSESSMENT_FOCUSES] },
            evidence: { type: "string", minLength: 5, maxLength: 400, description: "The figures from the facts that support this, quoted as given." },
            why: { type: "string", minLength: 10, maxLength: 400 },
            action: { type: "string", minLength: 10, maxLength: 400, description: "The kind of work or step. No session prescriptions, paces or targets." },
          },
          required: ["rank", "focus", "evidence", "why", "action"], additionalProperties: false,
        },
      },
      retest: {
        anyOf: [
          { type: "null" },
          { type: "object", properties: { machine: { type: "string", maxLength: 60 }, reason: { type: "string", maxLength: 300 } }, required: ["machine", "reason"], additionalProperties: false },
        ],
      },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      unknowns: { type: "string", maxLength: 300 },
    },
    required: ["headline", "strengths", "priorities", "retest", "confidence", "unknowns"],
    additionalProperties: false,
  },
};

/** What the tool returned, checked for shape. Null when it cannot be used. */
export function parseEngineAssessment(input: unknown): EngineAssessment | null {
  const a = input as Partial<EngineAssessment> | null;
  if (!a || typeof a.headline !== "string" || !Array.isArray(a.priorities) || a.priorities.length === 0) return null;
  const ok = (f: unknown) => typeof f === "string" && ASSESSMENT_FOCUSES.includes(f);
  const priorities = a.priorities
    .filter((p) => p && ok(p.focus) && typeof p.why === "string" && typeof p.action === "string")
    .map((p, i) => ({ rank: Number.isInteger(p.rank) ? p.rank : i + 1, focus: p.focus, evidence: String(p.evidence ?? ""), why: p.why, action: p.action }))
    .sort((x, y) => x.rank - y.rank)
    .slice(0, 3)
    .map((p, i) => ({ ...p, rank: i + 1 }));
  if (priorities.length === 0) return null;
  const strengths = (Array.isArray(a.strengths) ? a.strengths : []).filter((s) => s && typeof s.focus === "string" && STRENGTH_FOCUSES.includes(s.focus) && typeof s.note === "string").slice(0, 2);
  const retest = a.retest && typeof a.retest.machine === "string" && typeof a.retest.reason === "string" ? { machine: a.retest.machine, reason: a.retest.reason } : null;
  const confidence = a.confidence === "high" || a.confidence === "medium" || a.confidence === "low" ? a.confidence : "low";
  return { headline: a.headline.trim(), strengths, priorities, retest, confidence, unknowns: typeof a.unknowns === "string" ? a.unknowns.trim() : "" };
}

/** The facts the assessment is written from, as one text block, or "" when the
 *  athlete has no Engine data to read. */
export async function buildEngineAssessmentInputs(supa: SupabaseClient, userId: string, opts: { curve?: "fresh" | "fresh_unsaved" } = {}): Promise<string> {
  const { data: prof } = await supa
    .from("athlete_profiles")
    .select("age, engine_program_version, engine_goal, engine_current_day, engine_ai_sequencing")
    .eq("user_id", userId)
    .maybeSingle();
  const p = (prof ?? {}) as { age?: number | null; engine_program_version?: string | null; engine_goal?: string | null; engine_current_day?: number | null; engine_ai_sequencing?: boolean | null };
  if (!p.engine_program_version) return "";
  const { data: program } = await supa.from("engine_programs").select("name, days_per_week").eq("id", p.engine_program_version).maybeSingle();
  const pr = (program ?? {}) as { name?: string | null; days_per_week?: number | null };
  // The curve is recomputed now, so a session or time trial from this morning
  // is in the facts (the stored copy can be a day behind). A dry run computes
  // it without storing it.
  const conditioning = await buildConditioningState(supa, userId, { daysPerWeek: pr.days_per_week ?? null, curve: opts.curve ?? "fresh", forAssessment: true });
  if (!conditioning.trim()) return "";
  const header = [
    `ATHLETE: ${p.age ? `age ${p.age}` : "age not given"}.`,
    `PROGRAM: ${pr.name ?? p.engine_program_version}${pr.days_per_week ? `, ${pr.days_per_week} days a week` : ""}. Next session: Day ${p.engine_current_day ?? 1}.`,
    p.engine_goal && p.engine_goal.trim() ? `STATED GOAL (their words): "${p.engine_goal.trim().slice(0, 600)}"` : "STATED GOAL: none given.",
  ].join("\n");
  return `${header}\n\n${conditioning}`;
}

/** Ask the AI for the assessment. Null when it could not be reached or its
 *  answer could not be used (one retry). Never throws. */
export async function writeEngineAssessment(inputs: string): Promise<EngineAssessment | null> {
  if (!ANTHROPIC_API_KEY || !inputs.trim()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2500,
          stream: false,
          system: ENGINE_ASSESSMENT_SYSTEM,
          tools: [ENGINE_ASSESSMENT_TOOL],
          tool_choice: { type: "tool", name: ENGINE_ASSESSMENT_TOOL.name },
          messages: [{ role: "user", content: inputs }],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) {
        console.error(`[engine-assessment] AI HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
        continue;
      }
      const data = await resp.json();
      const tool = (data.content ?? []).find((b: { type?: string; name?: string }) => b.type === "tool_use" && b.name === ENGINE_ASSESSMENT_TOOL.name);
      const parsed = parseEngineAssessment(tool?.input);
      if (parsed) return parsed;
      console.error("[engine-assessment] answer unusable:", JSON.stringify(data).slice(0, 300));
    } catch (e) {
      console.error("[engine-assessment] AI call failed:", e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

/** The assessment as the short block a coach reads. */
export function renderEngineAssessment(a: EngineAssessment): string {
  const lines = [
    "ENGINE ASSESSMENT (the standing read of this athlete's conditioning — work from it; do not re-derive a different read from the raw numbers):",
    `Headline: ${a.headline}`,
    "Priorities (ranked):",
    ...a.priorities.map((p) => `  ${p.rank}. ${p.focus} — ${p.why} Action: ${p.action}`),
  ];
  if (a.strengths.length) lines.push(`Strengths: ${a.strengths.map((s) => `${s.focus} — ${s.note}`).join(" | ")}`);
  if (a.retest) lines.push(`Retest: ${a.retest.machine} — ${a.retest.reason}`);
  lines.push(`Confidence: ${a.confidence}.${a.unknowns ? ` Not yet known: ${a.unknowns}` : ""}`);
  return lines.join("\n");
}


// ─── Stage 2: stored, reused, rewritten when its basis moves on ─────────────

/** What a read was written from. Compared, never interpreted. */
export interface AssessmentBasis {
  /** Completed Engine sessions on record when it was written. */
  sessions: number;
  /** created_at of the athlete's newest time trial, or null. */
  latest_trial_at: string | null;
  goal: string;
  program: string;
  /** The Engine reset marker, or "" when the athlete never reset. */
  reset_at: string;
  builder_version: string;
}

export interface StoredAssessment {
  assessment: EngineAssessment;
  basis: AssessmentBasis;
  created_at: string;
}

/** True while the stored read still stands for the athlete as they are now. */
export function assessmentIsCurrent(stored: AssessmentBasis | null | undefined, now: AssessmentBasis): boolean {
  if (!stored) return false;
  return stored.builder_version === now.builder_version &&
    stored.program === now.program &&
    stored.goal === now.goal &&
    stored.reset_at === now.reset_at &&
    (stored.latest_trial_at ?? null) === (now.latest_trial_at ?? null) &&
    now.sessions - stored.sessions < REWRITE_AFTER_SESSIONS &&
    now.sessions >= stored.sessions; // fewer sessions than when it was written: something was removed, read again
}

/** The athlete's basis as of now, or null when they have no Engine program. */
export async function currentBasis(supa: SupabaseClient, userId: string): Promise<AssessmentBasis | null> {
  const { data: prof } = await supa
    .from("athlete_profiles").select("engine_program_version, engine_goal, engine_reset_at").eq("user_id", userId).maybeSingle();
  const p = (prof ?? {}) as { engine_program_version?: string | null; engine_goal?: string | null; engine_reset_at?: unknown };
  if (!p.engine_program_version) return null;
  const [{ count }, { data: trial }] = await Promise.all([
    supa.from("engine_workout_sessions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("completed", true),
    supa.from("engine_time_trials").select("created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    sessions: count ?? 0,
    latest_trial_at: (trial as { created_at?: string | null } | null)?.created_at ?? null,
    goal: (p.engine_goal ?? "").trim(),
    program: p.engine_program_version,
    reset_at: p.engine_reset_at == null ? "" : typeof p.engine_reset_at === "string" ? p.engine_reset_at : JSON.stringify(p.engine_reset_at),
    builder_version: ENGINE_ASSESSMENT_BUILDER_VERSION,
  };
}

/** The athlete's latest stored read, or null. Never throws (a missing table,
 *  before the migration, reads as "none"). */
export async function loadStoredAssessment(supa: SupabaseClient, userId: string): Promise<StoredAssessment | null> {
  try {
    const { data, error } = await supa
      .from("engine_assessments").select("assessment, basis, created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return null;
    const assessment = parseEngineAssessment((data as { assessment: unknown }).assessment);
    if (!assessment) return null;
    return { assessment, basis: (data as { basis: AssessmentBasis }).basis, created_at: (data as { created_at: string }).created_at };
  } catch {
    return null;
  }
}

/** What the AI is shown of its previous read on a rewrite. */
export function previousReadBlock(prev: StoredAssessment, now: AssessmentBasis): string {
  const since = Math.max(0, now.sessions - prev.basis.sessions);
  const trial = (prev.basis.latest_trial_at ?? null) !== (now.latest_trial_at ?? null) ? " A new time trial has been logged since." : "";
  return (
    `YOUR PREVIOUS READ (written ${prev.created_at.slice(0, 10)}; ${since} session${since === 1 ? "" : "s"} logged since.${trial}) — ` +
    `keep it unless the facts above have changed enough to change it:\n` +
    JSON.stringify(prev.assessment, null, 1)
  );
}

export interface EnsuredAssessment {
  assessment: EngineAssessment;
  created_at: string;
  /** "stored" = reused; "written" = a new read was written and stored;
   *  "stale" = a rewrite was due but could not be written, the last one is used. */
  source: "stored" | "written" | "stale";
}

/**
 * The athlete's read, written now if there is none or its basis has moved on.
 * Returns null when they have no Engine program or data, or no read could be
 * written and none is stored. Never throws.
 */
export async function ensureEngineAssessment(supa: SupabaseClient, userId: string): Promise<EnsuredAssessment | null> {
  try {
    const now = await currentBasis(supa, userId);
    if (!now) return null;
    const stored = await loadStoredAssessment(supa, userId);
    if (stored && assessmentIsCurrent(stored.basis, now)) return { assessment: stored.assessment, created_at: stored.created_at, source: "stored" };
    const facts = await buildEngineAssessmentInputs(supa, userId, { curve: "fresh" });
    if (!facts) return stored ? { assessment: stored.assessment, created_at: stored.created_at, source: "stale" } : null;
    const written = await writeEngineAssessment(stored ? `${facts}\n\n${previousReadBlock(stored, now)}` : facts);
    if (!written) return stored ? { assessment: stored.assessment, created_at: stored.created_at, source: "stale" } : null;
    // Two requests can find it due at the same moment (a chat and a completed
    // session). If the other one has stored its read already, use that one.
    const again = await loadStoredAssessment(supa, userId);
    if (again && again.created_at !== stored?.created_at && assessmentIsCurrent(again.basis, now)) return { assessment: again.assessment, created_at: again.created_at, source: "stored" };
    const created_at = new Date().toISOString();
    const { error } = await supa.from("engine_assessments").insert({ user_id: userId, assessment: written, basis: now, builder_version: ENGINE_ASSESSMENT_BUILDER_VERSION, created_at });
    if (error) console.error(`[engine-assessment] store failed for ${userId}: ${error.message}`);
    return { assessment: written, created_at, source: "written" };
  } catch (e) {
    console.error(`[engine-assessment] ensure failed for ${userId}:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * For a reader that must not wait (the chat coach): the STORED read as a
 * prompt block, and whether a rewrite is due. Reads only. `text` is "" when
 * there is none; the caller then gives the coach what it gave before.
 */
export async function storedAssessmentForCoach(supa: SupabaseClient, userId: string): Promise<{ text: string; due: boolean }> {
  try {
    const [stored, now] = await Promise.all([loadStoredAssessment(supa, userId), currentBasis(supa, userId)]);
    if (!now) return { text: "", due: false };
    return { text: stored ? renderEngineAssessment(stored.assessment) : "", due: !stored || !assessmentIsCurrent(stored.basis, now) };
  } catch {
    return { text: "", due: false };
  }
}

/** Write the read in the background when it is due, without making the
 *  caller wait. Safe to call on every request: it does nothing unless due. */
export function refreshAssessmentInBackground(supa: SupabaseClient, userId: string): void {
  const work = ensureEngineAssessment(supa, userId).then(() => {}, () => {});
  // deno-lint-ignore no-explicit-any
  const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil as ((p: Promise<unknown>) => void) | undefined;
  if (waitUntil) waitUntil(work);
}

/**
 * What the chat coach and the workout review are given about an Engine
 * member's conditioning: the stored assessment first, then the numbers as the
 * detail behind it. With no stored assessment it is exactly what they were
 * given before. Never waits on the AI: a missing or out-of-date read is
 * written in the background for next time. Throws only what
 * buildConditioningState throws (its callers already catch).
 */
export async function conditioningForCoach(supa: SupabaseClient, userId: string): Promise<string> {
  const { text, due } = await storedAssessmentForCoach(supa, userId);
  const signals = await buildConditioningState(supa, userId, { underAssessment: !!text });
  if (due && signals) refreshAssessmentInBackground(supa, userId);
  if (!signals) return "";
  return text ? `\n\n${text}${signals}` : signals;
}
