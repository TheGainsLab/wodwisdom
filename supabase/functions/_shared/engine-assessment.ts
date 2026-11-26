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
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildConditioningState } from "./conditioning-state.ts";
import { REGIONS } from "./engine-continuum.ts";
import { MODELS } from "./model-profiles.ts";

export const ENGINE_ASSESSMENT_BUILDER_VERSION = "v1.0";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = MODELS.fable;

/** The effort-duration bands of the conditioning curve, plus the two things a
 *  priority can be about that are not a band. The AI picks from these. */
export const ASSESSMENT_FOCUSES: readonly string[] = [...REGIONS.map((r) => r[2]), "calibration", "consistency"];

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
  - FLAGS on the curve: AEROBIC_SIDE_BEHIND_SPRINT (short max efforts sit above the curve relative to the trial; read it with the trial history: a low or stalled trial means the aerobic side is the gap, a rising trial means a fast athlete whose level is catching up). GLYCOLYTIC_BELOW_BALANCED (short hard work is the gap). TRIAL_LOW (they sustained longer than balanced at trial pace: the baseline is stale and understates them). TRIAL_STALE:<machine> (that trial is over 40 days old and still in use). UNCALIBRATED:<machine> (no trial on that machine: its targets are not personal). AWAITING_RIGHT_ANCHOR (a recent retest: the sprint bands are provisional).

HOW TO READ
  - Weight the four middle bands, 30 seconds to 10 minutes, most: that is where mixed workouts live. A gap at 1–4 minutes outranks a gap at ≤30 s.
  - A band is a weakness only when it is MEASURED and below balanced. "floor" and "blank" are things you do not know yet: say so, and where it matters make finding out the priority.
  - Thin evidence (small n, one or two sessions) supports a tentative read at most. Do not build a priority on one session.
  - Each ratio series steps when the athlete retests, because the ruler changed. Read trends between retests.
  - Machines are separate rulers. Do not compare a pace on one machine, or in one unit, with a pace on another.
  - Sparse or absent training is neutral: never scold, never infer decline from sessions that were not logged.
  - The Engine does not train sprint power of a few seconds. Do not infer it.

WHAT TO WRITE
  - headline: one sentence a coach would say to this athlete about where their conditioning stands.
  - strengths: up to two, each tied to a band or to consistency, with the reason in a sentence.
  - priorities: one to three, ranked. For each: the focus (a band, "calibration" when the baseline itself is the problem, or "consistency" when there is too little recent training to judge anything else), the evidence (the specific figures from the facts that support it, quoted as given), why it matters for this athlete (connect to their stated goal when they gave one), and the action (what kind of work or step addresses it, in plain words; no session prescriptions, no paces, no targets).
  - retest: name a machine only when a flag or the trial's age justifies it, with the reason. Otherwise null.
  - confidence: high only when measured bands with solid evidence agree; medium when the picture is mixed or partly unmeasured; low when it rests on little data.
  - unknowns: one sentence on what the read cannot yet tell, or empty.

Write to be read by another coach: plain words, no analyst vocabulary in "headline", "why" or "action" (no "M", "n=", "ratio", "band state"). The figures belong in "evidence".`;

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
          properties: { focus: { type: "string", enum: [...ASSESSMENT_FOCUSES] }, note: { type: "string", minLength: 5, maxLength: 300 } },
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
  const strengths = (Array.isArray(a.strengths) ? a.strengths : []).filter((s) => s && ok(s.focus) && typeof s.note === "string").slice(0, 2);
  const retest = a.retest && typeof a.retest.machine === "string" && typeof a.retest.reason === "string" ? { machine: a.retest.machine, reason: a.retest.reason } : null;
  const confidence = a.confidence === "high" || a.confidence === "medium" || a.confidence === "low" ? a.confidence : "low";
  return { headline: a.headline.trim(), strengths, priorities, retest, confidence, unknowns: typeof a.unknowns === "string" ? a.unknowns.trim() : "" };
}

/** The facts the assessment is written from, as one text block, or "" when the
 *  athlete has no Engine data to read. */
export async function buildEngineAssessmentInputs(supa: SupabaseClient, userId: string): Promise<string> {
  const { data: prof } = await supa
    .from("athlete_profiles")
    .select("age, engine_program_version, engine_goal, engine_current_day, engine_ai_sequencing")
    .eq("user_id", userId)
    .maybeSingle();
  const p = (prof ?? {}) as { age?: number | null; engine_program_version?: string | null; engine_goal?: string | null; engine_current_day?: number | null; engine_ai_sequencing?: boolean | null };
  if (!p.engine_program_version) return "";
  const { data: program } = await supa.from("engine_programs").select("name, days_per_week").eq("id", p.engine_program_version).maybeSingle();
  const pr = (program ?? {}) as { name?: string | null; days_per_week?: number | null };
  const conditioning = await buildConditioningState(supa, userId, { daysPerWeek: pr.days_per_week ?? null });
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
