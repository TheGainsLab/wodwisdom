/**
 * restriction-text.ts — the restriction check for training the AI rewrites as
 * PROSE (the "analyze my program" route for an athlete's own uploaded
 * program, where a workout is a block of text, not typed movements).
 *
 * Same order of authority as restriction-gate.ts:
 *   1. An AI reads each rewritten workout against everything the athlete has
 *      said about their body and their avoid list, and returns a corrected
 *      text for any that conflicts.
 *   2. Code applies the correction, then takes a last look by name: a rewrite
 *      that still ADDS an avoid-list movement the original did not have is
 *      DROPPED, so the athlete keeps their own original workout. Dropping an
 *      AI change is always safe; nothing is ever withheld from the athlete.
 * Never throws.
 */

import { MODELS } from "./model-profiles.ts";
import { plainName, type Restrictions, restrictionsForPrompt } from "./restriction-gate.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY_PIPELINE") ?? Deno.env.get("ANTHROPIC_API_KEY");

export interface TextChange {
  id: string;
  original_text: string;
  modified_text: string;
}

export interface TextCorrection {
  id: string;
  reason: string;
  corrected_text: string;
}

export type TextJudge = (changes: TextChange[], r: Restrictions) => Promise<TextCorrection[] | null>;

const SYSTEM = `You check AI-rewritten workouts against ONE athlete's physical restrictions. Nothing else is your job.

You receive the athlete's restrictions (what they wrote under injuries, what they said elsewhere, and movements never to program) and a list of workouts, each with its original text and its rewritten text.

For each REWRITTEN workout, decide whether it contains anything that goes against the restrictions: a movement on the never-program list under any name, distance, load or variation, or a movement the athlete's own words rule out, in any part of the workout including warm-up and cool-down. An easy version is still a version.

For every rewritten workout that conflicts, return a corrected text: the rewritten workout with each conflicting movement replaced by one the athlete can do that keeps the piece's purpose, and nothing else changed. Do not return workouts that are fine. Their words are the ground truth; do not invent restrictions.`;

const TOOL = {
  name: "report_text_check",
  description: "Return a corrected text for each rewritten workout that goes against the athlete's restrictions. Empty when all are fine.",
  input_schema: {
    type: "object",
    properties: {
      corrections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            reason: { type: "string", maxLength: 300 },
            corrected_text: { type: "string", minLength: 1 },
          },
          required: ["id", "reason", "corrected_text"],
          additionalProperties: false,
        },
      },
    },
    required: ["corrections"],
    additionalProperties: false,
  },
};

export function textJudgeMessage(changes: TextChange[], r: Restrictions): string {
  return [
    restrictionsForPrompt(r.injuriesText, r.doNotProgram, r.otherWords) || "ABSOLUTE RESTRICTIONS: the athlete has stated no injury, pain or physical limit anywhere, and has no avoid list.",
    "",
    "WORKOUTS:",
    JSON.stringify(changes.map((c) => ({ id: c.id, original: c.original_text, rewritten: c.modified_text }))),
    "",
    "Check every rewritten workout and report through the tool.",
  ].join("\n");
}

export const askTextJudge: TextJudge = async (changes, r) => {
  if (!ANTHROPIC_API_KEY) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODELS.sonnet,
          max_tokens: 8192,
          stream: false,
          system: SYSTEM,
          tools: [TOOL],
          tool_choice: { type: "tool", name: TOOL.name },
          messages: [{ role: "user", content: textJudgeMessage(changes, r) }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) { console.error(`[restriction-text] judge HTTP ${resp.status}`); continue; }
      const data = await resp.json();
      const tool = (data.content ?? []).find((b: { type?: string; name?: string }) => b.type === "tool_use" && b.name === TOOL.name);
      const list = (tool?.input as { corrections?: unknown } | undefined)?.corrections;
      if (!Array.isArray(list)) continue;
      return list.filter((c): c is TextCorrection =>
        !!c && typeof c === "object" && typeof (c as TextCorrection).id === "string" && typeof (c as TextCorrection).corrected_text === "string");
    } catch (e) {
      console.error("[restriction-text] judge call failed:", e instanceof Error ? e.message : String(e));
    }
  }
  return null;
};

/** Avoid-list names (plain form) that appear as whole words in `text`. */
export function avoidNamesIn(text: string, doNotProgram: string[]): string[] {
  const hay = ` ${plainName(text ?? "")} `;
  const found: string[] = [];
  for (const m of doNotProgram ?? []) {
    const p = plainName(m ?? "");
    if (p && hay.includes(` ${p} `) && !found.includes(p)) found.push(p);
  }
  return found;
}

export interface TextReviewResult<T> {
  /** The changes that may be saved (corrected where needed). */
  kept: T[];
  /** What was corrected or dropped, for the log. */
  actions: string[];
  judgeUnavailable: boolean;
}

/**
 * Review a batch of rewritten workouts. Generic over the caller's row type:
 * only id / original_text / modified_text are read, and modified_text is the
 * only field ever changed.
 */
export async function reviewTextChanges<T extends TextChange>(
  changes: T[],
  r: Restrictions,
  opts: { judge?: TextJudge } = {},
): Promise<TextReviewResult<T>> {
  const out: TextReviewResult<T> = { kept: [], actions: [], judgeUnavailable: false };
  let working = changes.map((c) => ({ ...c }));
  if (working.length === 0) return out;

  try {
    const corrections = await (opts.judge ?? askTextJudge)(working, r);
    if (corrections == null) out.judgeUnavailable = true;
    else {
      const byId = new Map(corrections.map((c) => [c.id, c]));
      working = working.map((c) => {
        const fix = byId.get(c.id);
        if (!fix || !fix.corrected_text.trim()) return c;
        out.actions.push(`${c.id}: rewritten to respect the athlete's restrictions — ${fix.reason}`);
        return { ...c, modified_text: fix.corrected_text };
      });
    }
  } catch (e) {
    out.judgeUnavailable = true;
    console.error("[restriction-text] judge path failed:", e instanceof Error ? e.message : String(e));
  }

  // Last look, by name: a rewrite that ADDS an avoid-list movement is dropped
  // and the athlete keeps their own original workout.
  for (const c of working) {
    const added = avoidNamesIn(c.modified_text, r.doNotProgram).filter((n) => !avoidNamesIn(c.original_text, r.doNotProgram).includes(n));
    if (added.length > 0) {
      out.actions.push(`${c.id}: AI change dropped (it added ${added.join(", ")}, which is on the avoid list); the original workout is kept`);
      continue;
    }
    out.kept.push(c);
  }
  return out;
}
