/**
 * coaching-intake.ts
 *
 * The Tier-3 qualitative intake: free-text / voice answers the athlete gives to
 * a handful of open-ended coaching questions → a typed, structured object the
 * coaching state can consume.
 *
 * Everything here is SELF-REPORTED (opinion, not fact): preferences, self-
 * assessment, training history, goals, constraints. It's tagged source
 * "self_reported" downstream so CoachState weighs it accordingly — honor
 * preferences (selection/adherence), treat self-assessment as a hypothesis to
 * check against the hard data, use training age for the capacity estimate, and
 * treat injuries/constraints as hard avoidance.
 *
 * Extraction is LLM-based (the input is uncontrolled prose / voice transcripts,
 * so an LLM parse — not regex — is the right tool). The raw answers are kept
 * alongside the extracted object so the Coach can quote the athlete's own words
 * and we can re-extract with a better model later.
 */

export const COACHING_INTAKE_VERSION = "v1";

export type TimeDomain = "short" | "medium" | "long";
export type FitnessBucket = "strength" | "gymnastics" | "conditioning";

export interface CoachingIntake {
  coaching_intake_version: string;
  preferences: {
    loved: string[];
    disliked: string[];
    skill_goals: string[];
    avoid: string[];
  };
  self_assessment: {
    perceived_strengths: string[];
    perceived_weaknesses: string[];
    weak_time_domain: TimeDomain | null;
    weak_bucket: FitnessBucket | null;
  };
  history: {
    training_age: string | null;
    background: string | null;
    typical_week: string | null;
    past_worked: string | null;
    past_failed: string | null;
  };
  goals: {
    success_3_6mo: string | null;
    competes: boolean | null;
    events: string[];
  };
  constraints: {
    injuries: string[];
    schedule_equipment_notes: string | null;
  };
  response: {
    volume_tolerance: string | null;
    recovery_notes: string | null;
  };
  freeform_notes: string | null;
}

/** Raw answers keyed by question — stored as provenance + fed to the extractor. */
export type CoachingIntakeRaw = Record<string, string>;

export const COACHING_INTAKE_SYSTEM_PROMPT =
  "You extract a structured coaching-intake object from an athlete's free-text (often voice-dictated) answers to open-ended training questions. " +
  "Return ONLY the emit_coaching_intake tool call.\n\n" +
  "RULES:\n" +
  "- Extract only what the athlete actually said. NEVER invent, infer beyond the text, or fill gaps with assumptions. Leave a field null (or an empty array) when it isn't mentioned.\n" +
  "- Normalize movement names to common CrossFit names (e.g. 'c2b' → 'chest-to-bar pull-up', 'oly stuff' → keep as written if ambiguous).\n" +
  "- preferences.loved / .disliked: specific movements or workout types they enjoy / dislike. .avoid: things they're avoiding for a reason (pain, injury) — distinct from mere dislike. .skill_goals: skills or numbers they want to hit.\n" +
  "- self_assessment: THEIR OPINION of their strengths/weaknesses. weak_time_domain ∈ short|medium|long and weak_bucket ∈ strength|gymnastics|conditioning ONLY if they clearly indicate one; else null.\n" +
  "- history.training_age: how long they've trained consistently, in their words (e.g. '3 years', 'on and off since 2015'). Keep the other history fields as short verbatim-ish summaries.\n" +
  "- goals.competes: true/false ONLY if clear; else null. goals.events: named events/dates they're aiming for.\n" +
  "- constraints.injuries: each distinct injury/limitation as its own string, in their words (e.g. 'left shoulder pain on overhead'). schedule_equipment_notes: any schedule/equipment/life limits.\n" +
  "- freeform_notes: anything meaningful that doesn't fit the other fields (from the 'anything else' answer or asides).\n" +
  "- Preserve the athlete's voice — short, faithful phrasings, not paraphrases that change meaning.";

export const EMIT_COACHING_INTAKE_TOOL = {
  name: "emit_coaching_intake",
  description: "Emit the structured coaching intake extracted from the athlete's answers.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      preferences: {
        type: "object",
        additionalProperties: false,
        properties: {
          loved: { type: "array", items: { type: "string" } },
          disliked: { type: "array", items: { type: "string" } },
          skill_goals: { type: "array", items: { type: "string" } },
          avoid: { type: "array", items: { type: "string" } },
        },
        required: ["loved", "disliked", "skill_goals", "avoid"],
      },
      self_assessment: {
        type: "object",
        additionalProperties: false,
        properties: {
          perceived_strengths: { type: "array", items: { type: "string" } },
          perceived_weaknesses: { type: "array", items: { type: "string" } },
          weak_time_domain: { type: ["string", "null"], enum: ["short", "medium", "long", null] },
          weak_bucket: { type: ["string", "null"], enum: ["strength", "gymnastics", "conditioning", null] },
        },
        required: ["perceived_strengths", "perceived_weaknesses", "weak_time_domain", "weak_bucket"],
      },
      history: {
        type: "object",
        additionalProperties: false,
        properties: {
          training_age: { type: ["string", "null"] },
          background: { type: ["string", "null"] },
          typical_week: { type: ["string", "null"] },
          past_worked: { type: ["string", "null"] },
          past_failed: { type: ["string", "null"] },
        },
        required: ["training_age", "background", "typical_week", "past_worked", "past_failed"],
      },
      goals: {
        type: "object",
        additionalProperties: false,
        properties: {
          success_3_6mo: { type: ["string", "null"] },
          competes: { type: ["boolean", "null"] },
          events: { type: "array", items: { type: "string" } },
        },
        required: ["success_3_6mo", "competes", "events"],
      },
      constraints: {
        type: "object",
        additionalProperties: false,
        properties: {
          injuries: { type: "array", items: { type: "string" } },
          schedule_equipment_notes: { type: ["string", "null"] },
        },
        required: ["injuries", "schedule_equipment_notes"],
      },
      response: {
        type: "object",
        additionalProperties: false,
        properties: {
          volume_tolerance: { type: ["string", "null"] },
          recovery_notes: { type: ["string", "null"] },
        },
        required: ["volume_tolerance", "recovery_notes"],
      },
      freeform_notes: { type: ["string", "null"] },
    },
    required: ["preferences", "self_assessment", "history", "goals", "constraints", "response", "freeform_notes"],
  },
} as const;

interface ClaudeContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}
interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

/** LLM extraction: raw answers → typed CoachingIntake (version-stamped). */
export async function extractCoachingIntake(raw: CoachingIntakeRaw): Promise<CoachingIntake> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const answers = Object.entries(raw)
    .filter(([, v]) => typeof v === "string" && v.trim() !== "")
    .map(([k, v]) => `## ${k}\n${v.trim()}`)
    .join("\n\n");
  const userMessage = `ATHLETE'S ANSWERS:\n\n${answers || "(no answers provided)"}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      stream: false,
      system: COACHING_INTAKE_SYSTEM_PROMPT,
      tools: [EMIT_COACHING_INTAKE_TOOL],
      tool_choice: { type: "tool", name: "emit_coaching_intake" },
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }
  const data = (await resp.json()) as ClaudeResponse;
  const toolUse = (data.content ?? []).find(
    (b) => b.type === "tool_use" && b.name === "emit_coaching_intake",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    throw new Error(`Claude response missing emit_coaching_intake tool_use. stop_reason=${data.stop_reason}`);
  }
  console.log(
    `[coaching-intake] Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens}`,
  );
  return { ...(toolUse.input as Omit<CoachingIntake, "coaching_intake_version">), coaching_intake_version: COACHING_INTAKE_VERSION };
}
