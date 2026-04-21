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
  "crossfit_competitor",
  "hybrid",
  "general_fitness",
  "strength_focused",
  "conditioning_focused",
  "sport_specific",
  "body_composition",
  "health",
] as const;

const EMPHASIS_BLOCKS = ["strength", "skills", "metcon", "accessory", "aerobic"] as const;

const SYSTEM_PROMPT = `You parse a CrossFit/fitness athlete's free-text training goal into structured JSON.

Return ONLY a JSON object with this shape:
{
  "primary_goal": one of [${PRIMARY_GOALS.join(", ")}],
  "secondary_goals": array of the same enum, excluding the primary (empty array if none),
  "time_horizon": string or null — brief description like "8 weeks", "next year", "ongoing",
  "named_event": string or null — specific event like "CrossFit Open", "Murph", "Hyrox", "Boston Marathon",
  "emphasis": array of [${EMPHASIS_BLOCKS.join(", ")}] — which block types to prioritize (order matters, most important first)
}

Guidance:
- crossfit_competitor: preparing for Open / Quarterfinals / Semifinals / Games level competition
- hybrid: balanced CrossFit-style athlete, no specialty, wants to be good at everything
- general_fitness: healthspan, look and feel better, no competitive goal
- strength_focused: prioritize the big lifts, conditioning is maintenance
- conditioning_focused: prioritize engine work, strength is maintenance
- sport_specific: Hyrox, obstacle racing, trail running, triathlon, field sport prep
- body_composition: weight loss, fat loss, muscle gain — physical appearance goals
- health: blood pressure, blood sugar, longevity, rehab

Examples:
Input: "Prep for the Open next year and add 20 lbs to my deadlift"
Output: { "primary_goal": "crossfit_competitor", "secondary_goals": ["strength_focused"], "time_horizon": "next year", "named_event": "CrossFit Open", "emphasis": ["metcon", "strength", "skills"] }

Input: "I just want to feel good and lose some belly fat"
Output: { "primary_goal": "body_composition", "secondary_goals": ["general_fitness"], "time_horizon": null, "named_event": null, "emphasis": ["metcon", "strength", "accessory"] }

Input: "Train for Murph in May, then just stay in shape"
Output: { "primary_goal": "sport_specific", "secondary_goals": ["general_fitness"], "time_horizon": "until May", "named_event": "Murph", "emphasis": ["aerobic", "metcon", "skills"] }

Input: "Be strong and conditioned for whatever life throws at me, maybe some Hyrox"
Output: { "primary_goal": "hybrid", "secondary_goals": ["sport_specific"], "time_horizon": "ongoing", "named_event": "Hyrox", "emphasis": ["metcon", "strength", "aerobic"] }

If the goal is empty or unclear, default to primary_goal "general_fitness" with emphasis ["metcon", "strength", "skills"].

Output valid JSON only, no markdown fences.`;

interface ParsedGoal {
  primary_goal: typeof PRIMARY_GOALS[number];
  secondary_goals: typeof PRIMARY_GOALS[number][];
  time_horizon: string | null;
  named_event: string | null;
  emphasis: typeof EMPHASIS_BLOCKS[number][];
}

function validateGoal(raw: unknown): ParsedGoal {
  const g = raw as Partial<ParsedGoal>;
  const primary = typeof g.primary_goal === "string" && PRIMARY_GOALS.includes(g.primary_goal as typeof PRIMARY_GOALS[number])
    ? g.primary_goal as typeof PRIMARY_GOALS[number]
    : "general_fitness";
  const secondary = Array.isArray(g.secondary_goals)
    ? g.secondary_goals.filter((x): x is typeof PRIMARY_GOALS[number] =>
        typeof x === "string" && PRIMARY_GOALS.includes(x as typeof PRIMARY_GOALS[number]) && x !== primary)
    : [];
  const emphasis = Array.isArray(g.emphasis)
    ? g.emphasis.filter((x): x is typeof EMPHASIS_BLOCKS[number] =>
        typeof x === "string" && EMPHASIS_BLOCKS.includes(x as typeof EMPHASIS_BLOCKS[number]))
    : ["metcon", "strength", "skills"];
  return {
    primary_goal: primary,
    secondary_goals: secondary,
    time_horizon: typeof g.time_horizon === "string" && g.time_horizon.trim() ? g.time_horizon.trim() : null,
    named_event: typeof g.named_event === "string" && g.named_event.trim() ? g.named_event.trim() : null,
    emphasis,
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
