/**
 * classify-day-type: Given one day's workout text, classify it into one of the
 * five archetypes. Used in shadow mode (Phase 2b validation) to build a
 * dataset of classifier accuracy against the generator's requested day_type.
 *
 * Input:  { day_text: string, expected_archetype?: string }
 * Output: { actual_archetype: string, confidence: number, reasoning: string }
 *
 * expected_archetype is optional; when present the classifier is told what
 * was requested so it can anchor its judgment, but the classification is
 * still independent — the classifier is free to disagree.
 */

import { callClaude } from "../_shared/call-claude.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const ARCHETYPES = ["strength", "metcon", "fitness", "skill", "recovery", "unclassifiable"] as const;

const SYSTEM_PROMPT = `You classify a single day's training session into one of five archetypes based on its block composition and content.

Return ONLY a JSON object with this shape:
{
  "actual_archetype": one of [${ARCHETYPES.join(", ")}],
  "confidence": 0.0 to 1.0,
  "reasoning": "one-sentence explanation of the classification"
}

The five archetypes and their signature block compositions:

STRENGTH DAY
- Contains: Warm-up & Mobility, Strength, Accessory, Cool down
- Does NOT contain: Skills, Metcon
- Strength block is the main event (heavy % work, extended time, compound lifts)
- Accessory is higher volume than on other days (hypertrophy + midline)

METCON DAY
- Contains: Warm-up & Mobility, Skills (brief primer), Metcon, Cool down
- Does NOT contain: Strength, Accessory
- Metcon is the main event (the entire metabolic stimulus for the day)
- Skills block is a short primer (5-8 min), NOT progression work

FITNESS DAY
- Contains: all six blocks (Warm-up & Mobility, Skills, Strength, Accessory, Metcon, Cool down)
- Balanced moderate volume per block — nothing is dramatically dominant
- The "all-in-one" archetype; used in Fitness goal patterns

SKILL DAY
- Contains: Warm-up & Mobility, Skills (extended), Strength (secondary), Cool down
- Does NOT contain: Metcon, Accessory
- Skills block is the main event (25-30 min with progression work + test sets)
- Strength is present but secondary (supports skill work, moderate volume at 70-80%)

RECOVERY DAY
- Contains: Warm-up & Mobility, Active Recovery, Cool down
- Does NOT contain: Skills, Strength, Accessory, Metcon
- Active Recovery is easy movement (walk, easy bike, yoga flow, mobility circuit) at conversational pace
- NOT aerobic training — purpose is blood flow and parasympathetic recovery

UNCLASSIFIABLE
- Use only when the day's block composition doesn't match any archetype cleanly (e.g., has both Strength and Metcon as main events, or has a malformed/truncated output)

Classification rules:
1. LOOK AT BLOCK HEADERS FIRST. Block presence/absence is the strongest signal. A day with Strength + Accessory + no Skills + no Metcon is a Strength Day — confidence should be high.
2. LOOK AT BLOCK CONTENT SECOND. On a Metcon Day, the Skills block should be a short primer (one movement, 5-8 min). If it's a full progression block (multiple skills, 25+ min), that's a Skill Day, not Metcon.
3. CONFIDENCE SCORING:
   - 0.9-1.0: Block composition cleanly matches one archetype
   - 0.7-0.9: Matches one archetype but with minor deviations (e.g., a little too much Skills volume for Metcon Day)
   - 0.5-0.7: Ambiguous, leaning one way
   - Below 0.5: Return "unclassifiable"
4. Do NOT let the expected_archetype bias you — if the generator produced something that doesn't match what was asked for, report what's actually there.
5. Keep reasoning to ONE sentence, mentioning the decisive blocks.

Output valid JSON only, no markdown fences.`;

interface ClassifyResult {
  actual_archetype: typeof ARCHETYPES[number];
  confidence: number;
  reasoning: string;
}

function validate(raw: unknown): ClassifyResult {
  const r = raw as Partial<ClassifyResult>;
  const archetype = typeof r.actual_archetype === "string" && ARCHETYPES.includes(r.actual_archetype as typeof ARCHETYPES[number])
    ? r.actual_archetype as typeof ARCHETYPES[number]
    : "unclassifiable";
  let confidence = typeof r.confidence === "number" ? r.confidence : 0.5;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;
  const reasoning = typeof r.reasoning === "string" && r.reasoning.trim() ? r.reasoning.trim() : "";
  return { actual_archetype: archetype, confidence, reasoning };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { day_text, expected_archetype } = await req.json();

    if (!day_text || typeof day_text !== "string") {
      return new Response(
        JSON.stringify({ error: "day_text is required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const userContent = expected_archetype
      ? `EXPECTED: ${expected_archetype}\n\nDAY TEXT:\n${day_text}`
      : `DAY TEXT:\n${day_text}`;

    const raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY,
      system: SYSTEM_PROMPT,
      userContent,
      maxTokens: 256,
    });

    let result: ClassifyResult;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      result = validate(JSON.parse(cleaned));
    } catch {
      console.error("Failed to parse Claude response:", raw);
      return new Response(
        JSON.stringify({ error: "Failed to parse classification", raw }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("classify-day-type error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
