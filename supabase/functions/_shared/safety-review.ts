/**
 * safety-review.ts
 *
 * The 8th audit — LLM-mediated. A focused Claude call that reads the
 * generated WriterOutput alongside the athlete's raw goal text and
 * raw injuries text, and reports whether the program contains any
 * movements that conflict with stated injury constraints.
 *
 * Why an LLM and not a deterministic check: we explicitly chose NOT
 * to parse injuries into structured `prohibited_movements[]` /
 * `caution_movements[]` arrays for the rewrite (parse-injuries dropped
 * from the program-gen path). That leaves us with free-text injury
 * descriptions that need natural-language reasoning to map onto
 * prescribed movements. LLM is the right tool; the safety domain
 * justifies the extra call.
 *
 * Architecture is built to be extensible: future LLM-mediated audits
 * (programming-quality review, variety check, balance check) can
 * follow the same shape.
 *
 * Failure mode: if the safety LLM call errors out (network, API
 * outage), we log the failure and return safe=true with a warning
 * violation. This is permissive — Phase 1 admin testing surfaces the
 * issue; production may want stricter handling later.
 */

import type { WriterOutput } from "./v2-output-schema.ts";
import { MODELS } from "./model-profiles.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = MODELS.sonnet;

export interface SafetyReviewResult {
  safe: boolean;
  /**
   * Specific violations. Empty when safe. Each violation names what
   * was programmed (movement + day(s)) and the stated injury
   * constraint it conflicts with.
   */
  violations: string[];
  /** Brief reasoning for the decision (one paragraph). */
  reasoning: string;
  /** True when the call itself failed and we defaulted to safe. */
  errored?: boolean;
}

const SAFETY_REVIEW_SYSTEM_PROMPT = `You are a safety reviewer for AI-generated CrossFit training programs. Your single job: identify movements in the generated program that conflict with the athlete's stated injuries or medical constraints.

You will receive:
  - The generated 4-week program as structured JSON.
  - The athlete's stated goal (free text).
  - The athlete's stated injuries / constraints (free text).

What to flag:
  - Direct contradictions: athlete says "no overhead pressing" and the program includes snatch, jerk, push press, HSPU, or other overhead movements.
  - Direct contradictions: athlete says "torn meniscus, no jumping" and the program includes box jumps, burpee box jump-overs, double-unders.
  - Direct contradictions: athlete says "lower back issues, no deadlifts" and the program includes deadlifts.
  - High-load risk for stated conditions: athlete mentions a recent surgery / acute condition and the program prescribes heavy compound movements that load the affected area.

What NOT to flag:
  - General coaching judgment (variety, balance, progression) — that's a different review.
  - Movements that are CLOSE to a constraint but not contraindicated (e.g., kettlebell swing for an athlete with "tight hamstrings" is fine).
  - Cosmetic concerns ("the program is boring", "too much running") — out of scope.

Be conservative but not paranoid. The athlete's stated constraints are the ground truth. If they didn't mention an issue, don't invent one. If they did mention an issue, take it seriously and flag anything that plausibly contradicts.

Use the report_safety tool to emit your decision:
  - safe: true if the program respects all stated constraints; false if any constraint is violated.
  - violations: specific list of conflicts. Each violation should name (a) the movement, (b) which day(s) it appears on, (c) which stated constraint it conflicts with.
  - reasoning: one paragraph explaining your decision.
`;

const REPORT_SAFETY_TOOL = {
  name: "report_safety",
  description:
    "Report whether the generated program is safe given the athlete's stated injury / constraint text. Flag movements that directly contradict stated constraints.",
  input_schema: {
    type: "object",
    properties: {
      safe: {
        type: "boolean",
        description: "True if the program respects all stated constraints; false if any constraint is violated.",
      },
      violations: {
        type: "array",
        items: { type: "string", minLength: 10, maxLength: 500 },
        description: "Specific violations — empty array when safe.",
      },
      reasoning: {
        type: "string",
        minLength: 30,
        maxLength: 1500,
        description: "One paragraph explaining the decision.",
      },
    },
    required: ["safe", "violations", "reasoning"],
    additionalProperties: false,
  },
};

/**
 * Format the program + athlete context as the user message for the
 * safety reviewer.
 */
function buildUserMessage(
  output: WriterOutput,
  goalText: string | null,
  injuriesText: string | null,
): string {
  const goal = goalText && goalText.trim() !== "" ? goalText.trim() : "(not provided)";
  const injuries = injuriesText && injuriesText.trim() !== "" ? injuriesText.trim() : "(none stated)";
  return `ATHLETE GOAL (raw):
${goal}

ATHLETE INJURIES / CONSTRAINTS (raw):
${injuries}

GENERATED PROGRAM (JSON):
${JSON.stringify(output, null, 2)}

Review the program for movements that conflict with the stated constraints. Emit your decision via the report_safety tool.`;
}

/**
 * Run the safety review. Returns SafetyReviewResult; on call failure
 * returns errored=true + safe=true (permissive default — log surfaces
 * the issue without blocking gen).
 */
export async function reviewSafety(
  output: WriterOutput,
  goalText: string | null,
  injuriesText: string | null,
): Promise<SafetyReviewResult> {
  if (!ANTHROPIC_API_KEY) {
    console.warn("[safety-review] missing ANTHROPIC_API_KEY; defaulting to safe=true.");
    return {
      safe: true,
      violations: [],
      reasoning: "Safety review skipped: ANTHROPIC_API_KEY not configured.",
      errored: true,
    };
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        stream: false,
        system: SAFETY_REVIEW_SYSTEM_PROMPT,
        tools: [REPORT_SAFETY_TOOL],
        tool_choice: { type: "tool", name: "report_safety" },
        messages: [
          {
            role: "user",
            content: buildUserMessage(output, goalText, injuriesText),
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(`[safety-review] HTTP ${resp.status}: ${body}`);
      return {
        safe: true,
        violations: [],
        reasoning: `Safety review skipped: HTTP ${resp.status}.`,
        errored: true,
      };
    }

    const data = await resp.json();
    // Find the tool_use block in the response.
    const toolUse = (data.content ?? []).find(
      (b: { type?: string; name?: string }) =>
        b.type === "tool_use" && b.name === "report_safety",
    );
    if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
      console.error("[safety-review] response missing report_safety tool_use:", JSON.stringify(data).slice(0, 500));
      return {
        safe: true,
        violations: [],
        reasoning: "Safety review skipped: malformed response.",
        errored: true,
      };
    }

    const input = toolUse.input as {
      safe?: unknown;
      violations?: unknown;
      reasoning?: unknown;
    };

    const safe = input.safe === true;
    const violations = Array.isArray(input.violations)
      ? (input.violations as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    const reasoning = typeof input.reasoning === "string" ? input.reasoning : "";

    return { safe, violations, reasoning };
  } catch (err) {
    console.error("[safety-review] call failed:", err);
    return {
      safe: true,
      violations: [],
      reasoning: `Safety review skipped: ${err instanceof Error ? err.message : "unknown error"}.`,
      errored: true,
    };
  }
}
