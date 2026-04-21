/**
 * parse-injuries: Parse free-text injury/constraint notes into a structured
 * blacklist and caution list.
 *
 * Input:  { injuries_text: string }
 * Output: { constraints: ParsedInjury[], summary: string }
 *
 * If injuries_text is "none" (case-insensitive, whitespace-stripped), returns an
 * empty list with summary "none".
 *
 * The generator uses `prohibited_movements` as a hard blacklist and
 * `caution_movements` as a soft signal for accessory / scaling decisions.
 */

import { callClaude } from "../_shared/call-claude.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const SEVERITY = ["minor", "moderate", "severe"] as const;

const SYSTEM_PROMPT = `You parse a CrossFit/fitness athlete's injury or movement constraint notes into structured JSON.

Return ONLY a JSON object with this shape:
{
  "constraints": [
    {
      "region": string — body area ("shoulder", "knee", "low back", "wrist", "elbow", etc.),
      "side": "left" | "right" | "bilateral" | null,
      "severity": one of [${SEVERITY.join(", ")}],
      "description": string — brief note (5-15 words) describing the issue,
      "prohibited_movements": array of movement names or patterns that must NOT be programmed,
      "caution_movements": array of movement names or patterns to program carefully, with reduced load or alternative variations
    }
  ],
  "summary": string — one-sentence summary of all constraints for the generator to read
}

Movement naming:
- Use canonical CrossFit/fitness names: "Back Squat", "Overhead Squat", "Press", "Deadlift", "Snatch", "Clean & Jerk", "Strict Press", "Push Press", "Pull-ups", "Muscle-ups", "HSPU", "Toes to Bar", "Ring Dips", "Box Jumps", "Double Unders", "Running", "Rowing", "Bike", "Rope Climb"
- Use movement PATTERNS for broader restrictions: "Overhead Pressing", "Heavy Squatting", "Ballistic Hinging", "Impact Plyometrics", "Unilateral Loading"
- Prefer patterns for vague constraints ("no overhead" → "Overhead Pressing", "Overhead Squat", "Push Press", "Push Jerk")

Severity guidance:
- minor: annoying but trainable around (e.g. "knee tender on deep squats")
- moderate: actively managed, limits certain movements (e.g. "shoulder impingement, no overhead pressing")
- severe: recent injury or diagnosis, avoid entirely (e.g. "torn meniscus, no running")

Examples:
Input: "right shoulder — no overhead pressing"
Output: {
  "constraints": [{
    "region": "shoulder",
    "side": "right",
    "severity": "moderate",
    "description": "Right shoulder issue limiting overhead pressing",
    "prohibited_movements": ["Overhead Pressing", "Strict Press", "Push Press", "Push Jerk", "Overhead Squat", "Snatch"],
    "caution_movements": ["Pull-ups", "HSPU", "Thrusters"]
  }],
  "summary": "Right shoulder limits overhead work; avoid all overhead pressing and Olympic lifts that end overhead."
}

Input: "low back tweaky, also left knee sometimes hurts"
Output: {
  "constraints": [
    {
      "region": "low back",
      "side": "bilateral",
      "severity": "minor",
      "description": "Low back tweak, keep hinging controlled",
      "prohibited_movements": [],
      "caution_movements": ["Deadlift", "Good Morning", "Kettlebell Swing", "Back Squat"]
    },
    {
      "region": "knee",
      "side": "left",
      "severity": "minor",
      "description": "Left knee occasional discomfort",
      "prohibited_movements": [],
      "caution_movements": ["Pistols", "Box Jumps", "Running", "Lunges"]
    }
  ],
  "summary": "Minor low back and left knee sensitivity; use caution on heavy hinging and impact."
}

Input: "none"
Output: { "constraints": [], "summary": "No reported injuries or constraints." }

Input: "torn rotator cuff last year, surgery done, cleared for training"
Output: {
  "constraints": [{
    "region": "shoulder",
    "side": null,
    "severity": "moderate",
    "description": "Post-surgical rotator cuff, cleared for training",
    "prohibited_movements": ["Kipping Pull-ups", "Kipping HSPU", "Ring Muscle-ups", "Bar Muscle-ups"],
    "caution_movements": ["Strict Pull-ups", "Strict Press", "Overhead Squat", "Snatch"]
  }],
  "summary": "Post-surgical shoulder; avoid ballistic overhead and kipping, progress strict overhead cautiously."
}

Output valid JSON only, no markdown fences.`;

interface ParsedInjury {
  region: string;
  side: "left" | "right" | "bilateral" | null;
  severity: typeof SEVERITY[number];
  description: string;
  prohibited_movements: string[];
  caution_movements: string[];
}

interface ParsedInjuryResult {
  constraints: ParsedInjury[];
  summary: string;
}

function validateResult(raw: unknown): ParsedInjuryResult {
  const r = raw as Partial<ParsedInjuryResult>;
  const constraints = Array.isArray(r.constraints)
    ? r.constraints.map((c): ParsedInjury => {
        const cc = c as Partial<ParsedInjury>;
        return {
          region: typeof cc.region === "string" ? cc.region.trim() : "unspecified",
          side: cc.side === "left" || cc.side === "right" || cc.side === "bilateral" ? cc.side : null,
          severity: typeof cc.severity === "string" && SEVERITY.includes(cc.severity as typeof SEVERITY[number])
            ? cc.severity as typeof SEVERITY[number]
            : "moderate",
          description: typeof cc.description === "string" ? cc.description.trim() : "",
          prohibited_movements: Array.isArray(cc.prohibited_movements)
            ? cc.prohibited_movements.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
            : [],
          caution_movements: Array.isArray(cc.caution_movements)
            ? cc.caution_movements.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
            : [],
        };
      })
    : [];
  const summary = typeof r.summary === "string" && r.summary.trim() ? r.summary.trim() : "No structured injury data.";
  return { constraints, summary };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { injuries_text } = await req.json();

    if (typeof injuries_text !== "string") {
      return new Response(
        JSON.stringify({ error: "injuries_text is required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const trimmed = injuries_text.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "none") {
      return new Response(
        JSON.stringify({ constraints: [], summary: "No reported injuries or constraints." }),
        { headers: { ...cors, "Content-Type": "application/json" } },
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
      userContent: trimmed,
      maxTokens: 1024,
    });

    let result: ParsedInjuryResult;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      result = validateResult(JSON.parse(cleaned));
    } catch {
      console.error("Failed to parse Claude response:", raw);
      return new Response(
        JSON.stringify({ error: "Failed to parse injuries", raw }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-injuries error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
