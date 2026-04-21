/**
 * parse-goal: Parse a free-text training goal into structured signals.
 *
 * Input:  { goal_text: string }
 * Output: { goal: ParsedGoal }
 *
 * ParsedGoal drives downstream programming decisions:
 *   primary_goal   — single dominant intent
 *   secondary_goals — other things the athlete mentioned
 *   time_horizon   — rough timeline if stated (e.g. "12 weeks", "next year")
 *   named_event    — a specific event if mentioned (e.g. "CrossFit Open", "Murph", "Hyrox")
 *   emphasis       — which block types should be prioritized
 */

import { callClaude } from "../_shared/call-claude.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const PRIMARY_GOALS = [
  "fitness",
  "competitor",
  "strength_and_power",
] as const;

const SECONDARY_EMPHASIS = [
  "weight_loss",
  "muscle_gain",
  "health",
  "longevity",
  "mobility",
  "event_prep",
] as const;

const EMPHASIS_BLOCKS = ["strength", "skills", "metcon", "accessory"] as const;

const SYSTEM_PROMPT = `You parse a CrossFit/fitness athlete's free-text training goal into structured JSON.

Return ONLY a JSON object with this shape:
{
  "primary_goal": one of [${PRIMARY_GOALS.join(", ")}],
  "secondary_emphasis": array of [${SECONDARY_EMPHASIS.join(", ")}] (empty array if none),
  "time_horizon": string or null — brief description like "8 weeks", "next year", "ongoing",
  "named_event": string or null — specific event like "CrossFit Open", "Murph", "Hyrox", "Boston Marathon",
  "emphasis_blocks": array of [${EMPHASIS_BLOCKS.join(", ")}] — which block types to prioritize (order matters, most important first)
}

Primary goal definitions:
- fitness: balanced general physical preparedness. The default when an athlete doesn't have a competitive or specialty focus. Wants to be strong, conditioned, and capable across movement domains. No competition pressure.
- competitor: training for CrossFit-style competition (Open, Quarterfinals, local throwdowns). Higher gymnastics / Olympic lifting volume, more metcon exposure, peaking around named events.
- strength_and_power: prioritize the big barbell lifts (squat, deadlift, press, Olympic). Conditioning is maintenance. More accessory volume for hypertrophy and weak-point work.

Secondary emphasis (independent of primary goal — captures lifestyle / aesthetic / health goals):
- weight_loss: lose body fat
- muscle_gain: add lean mass
- health: blood pressure, blood sugar, cardiovascular markers
- longevity: healthspan, mobility through aging
- mobility: improve range of motion, address imbalances
- event_prep: training for a specific named event (use when "named_event" is set)

Examples:
Input: "Prep for the Open next year and add 20 lbs to my deadlift"
Output: { "primary_goal": "competitor", "secondary_emphasis": ["event_prep", "muscle_gain"], "time_horizon": "next year", "named_event": "CrossFit Open", "emphasis_blocks": ["metcon", "strength", "skills"] }

Input: "I just want to feel good and lose some belly fat"
Output: { "primary_goal": "fitness", "secondary_emphasis": ["weight_loss"], "time_horizon": null, "named_event": null, "emphasis_blocks": ["metcon", "strength", "accessory"] }

Input: "Train for Murph in May, then just stay in shape"
Output: { "primary_goal": "fitness", "secondary_emphasis": ["event_prep"], "time_horizon": "until May", "named_event": "Murph", "emphasis_blocks": ["metcon", "skills", "strength"] }

Input: "I want a big squat and deadlift, look strong, conditioning is whatever"
Output: { "primary_goal": "strength_and_power", "secondary_emphasis": ["muscle_gain"], "time_horizon": "ongoing", "named_event": null, "emphasis_blocks": ["strength", "accessory", "metcon"] }

Input: "Be strong and conditioned for whatever life throws at me"
Output: { "primary_goal": "fitness", "secondary_emphasis": [], "time_horizon": "ongoing", "named_event": null, "emphasis_blocks": ["metcon", "strength", "skills"] }

If the goal is empty or unclear, default to primary_goal "fitness" with emphasis_blocks ["metcon", "strength", "skills"] and empty secondary_emphasis.

Output valid JSON only, no markdown fences.`;

interface ParsedGoal {
  primary_goal: typeof PRIMARY_GOALS[number];
  secondary_emphasis: typeof SECONDARY_EMPHASIS[number][];
  time_horizon: string | null;
  named_event: string | null;
  emphasis_blocks: typeof EMPHASIS_BLOCKS[number][];
}

function validateGoal(raw: unknown): ParsedGoal {
  const g = raw as Partial<ParsedGoal> & Record<string, unknown>;
  const primary = typeof g.primary_goal === "string" && PRIMARY_GOALS.includes(g.primary_goal as typeof PRIMARY_GOALS[number])
    ? g.primary_goal as typeof PRIMARY_GOALS[number]
    : "fitness";
  // Accept either secondary_emphasis (new shape) or secondary_goals (legacy callers)
  const rawSecondary = Array.isArray(g.secondary_emphasis)
    ? g.secondary_emphasis
    : Array.isArray(g.secondary_goals)
      ? g.secondary_goals
      : [];
  const secondary_emphasis = rawSecondary.filter((x: unknown): x is typeof SECONDARY_EMPHASIS[number] =>
    typeof x === "string" && SECONDARY_EMPHASIS.includes(x as typeof SECONDARY_EMPHASIS[number]));
  const rawEmphasis = Array.isArray(g.emphasis_blocks)
    ? g.emphasis_blocks
    : Array.isArray(g.emphasis)
      ? g.emphasis
      : ["metcon", "strength", "skills"];
  const emphasis_blocks = rawEmphasis.filter((x: unknown): x is typeof EMPHASIS_BLOCKS[number] =>
    typeof x === "string" && EMPHASIS_BLOCKS.includes(x as typeof EMPHASIS_BLOCKS[number]));
  return {
    primary_goal: primary,
    secondary_emphasis,
    time_horizon: typeof g.time_horizon === "string" && g.time_horizon.trim() ? g.time_horizon.trim() : null,
    named_event: typeof g.named_event === "string" && g.named_event.trim() ? g.named_event.trim() : null,
    emphasis_blocks,
  };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { goal_text } = await req.json();

    if (!goal_text || typeof goal_text !== "string") {
      return new Response(
        JSON.stringify({ error: "goal_text is required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY,
      system: SYSTEM_PROMPT,
      userContent: goal_text,
      maxTokens: 512,
    });

    let parsed: ParsedGoal;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      parsed = validateGoal(JSON.parse(cleaned));
    } catch {
      console.error("Failed to parse Claude response:", raw);
      return new Response(
        JSON.stringify({ error: "Failed to parse goal", raw }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ goal: parsed }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-goal error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
