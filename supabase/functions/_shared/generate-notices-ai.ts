// AI-powered notices for program analysis.
// Takes analysis JSON, returns 5–8 specific observations.

import type { AnalysisOutput } from "./analyzer.ts";

const SYSTEM_PROMPT = `You are a CrossFit programming analyst reviewing a training program.
Your job is to identify the 5-8 most notable patterns in the data.
Be specific — reference actual numbers, movements, weeks, and days.
Be factual — state what the data shows, not what the coach should do.
Coach-to-coach voice. No fluff.
Return JSON only: a string array. No preamble, no markdown.`;

const USER_PROMPT_TEMPLATE = `Here is a program analysis:

{analysisJSON}

Produce 5–8 specific observations. Examples:
- "Modal balance skews toward Gymnastics (22 vs 13 Monostructural)."
- "No workouts exceed 15 minutes across the program."
- "Week 4 programs rowing on 3 consecutive days (Wed, Thu, Fri)."
- "18 of 20 workouts are triplets."

Return a JSON array of strings: ["observation 1", "observation 2", ...]`;

const FALLBACK_NOTICES: string[] = [
  "Review your program for modal balance and time-domain variety.",
  "Consider recovery between similar movement patterns on consecutive days.",
];

/**
 * Generate 5–8 coaching notices from program analysis via Claude.
 * Returns fallback generic notices on API failure or parse error.
 */
export async function generateNoticesAI(
  analysis: AnalysisOutput,
  apiKey: string
): Promise<string[]> {
  const userPrompt = USER_PROMPT_TEMPLATE.replace(
    "{analysisJSON}",
    JSON.stringify(analysis, null, 0)
  );

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      stream: false,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error("generateNoticesAI API error:", err);
    return FALLBACK_NOTICES;
  }

  const data = await resp.json();
  const rawText =
    data.content?.[0]?.text?.trim() || data.content?.[0]?.input?.trim() || "";

  try {
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return FALLBACK_NOTICES;
    const notices = parsed.filter((x): x is string => typeof x === "string");
    return notices.length > 0 ? notices : FALLBACK_NOTICES;
  } catch (e) {
    console.error("generateNoticesAI parse error:", e);
    return FALLBACK_NOTICES;
  }
}
