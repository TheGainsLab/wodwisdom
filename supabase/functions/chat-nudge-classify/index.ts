import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { getTierStatus } from "../_shared/tier-status.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_Q_CHARS = 2000;
const MAX_A_CHARS = 6000;

// Section names the classifier and templates speak in. T3 sections (equipment,
// training context) are intentionally excluded — chat nudges are scoped to T1
// and T2 only. T3 lives on the profile page itself.
type NudgeSection = "basics" | "lifts" | "skills" | "conditioning";
const ALL_NUDGE_SECTIONS: NudgeSection[] = ["basics", "lifts", "skills", "conditioning"];

const SECTION_LABELS: Record<NudgeSection, string> = {
  basics: "the user's basic profile (age, weight, height, gender)",
  lifts: "1RM strength numbers (back squat, bench press, deadlift, snatch, clean & jerk)",
  skills: "proficiency on gymnastics/olympic skills (muscle-ups, handstand walk, double-unders, etc.)",
  conditioning: "benchmark workout times or capacity (Fran, 5K row, mile run, etc.)",
};

const CLASSIFIER_SYSTEM = `You are a classifier that decides whether a fitness coaching answer would have been MATERIALLY better with specific missing user profile data.

You will be given:
- EMPTY SECTIONS: the subset of profile sections the user has not filled in. Each section is described.
- QUESTION: the user's question.
- ANSWER: the coaching answer that was given.

Your job: return which of the EMPTY SECTIONS would have MATERIALLY changed the answer if they had been filled.

"Materially" means the answer would have been meaningfully more specific, precise, or tailored — not just "extra data would be nice."

Return nothing for:
- Pure methodology or education questions that don't depend on personal data.
- Questions where the answer didn't need the missing section even if it was missing.

Output format: return ONLY valid JSON, no prose, no code fences.
Shape: {"missing_relevant_sections": ["lifts"]}
If none apply: {"missing_relevant_sections": []}
Only include sections from the EMPTY SECTIONS list using the exact section keys.`;

function parseClassifierJSON(raw: string, allowed: Set<NudgeSection>): NudgeSection[] {
  if (!raw) return [];
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { missing_relevant_sections?: unknown };
    if (!Array.isArray(parsed.missing_relevant_sections)) return [];
    return parsed.missing_relevant_sections.filter(
      (s: unknown): s is NudgeSection =>
        typeof s === "string" && allowed.has(s as NudgeSection)
    );
  } catch {
    return [];
  }
}

async function callHaikuClassifier(
  candidates: NudgeSection[],
  question: string,
  answer: string
): Promise<NudgeSection[]> {
  if (!ANTHROPIC_API_KEY || candidates.length === 0) return [];

  const q = question.slice(0, MAX_Q_CHARS);
  const a = answer.slice(0, MAX_A_CHARS);

  const sectionLines = candidates.map((s) => `- ${s}: ${SECTION_LABELS[s]}`).join("\n");
  const userContent = `EMPTY SECTIONS:
${sectionLines}

QUESTION:
${q}

ANSWER:
${a}

Return JSON only.`;

  const resp = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 80,
        system: CLASSIFIER_SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }),
    },
    15_000
  );

  if (!resp.ok) {
    console.warn("Haiku classifier non-200:", resp.status);
    return [];
  }

  const data = await resp.json();
  const raw: string = data?.content?.[0]?.text ?? "";
  const allowed = new Set(candidates);
  return parseClassifierJSON(raw, allowed);
}

const SKIP_NUDGE = (cors: Record<string, string>) =>
  new Response(
    JSON.stringify({ should_nudge: false, missing_relevant_sections: [] }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
  );

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser(token);

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const question: string = typeof body?.question === "string" ? body.question : "";
    const answer: string = typeof body?.answer === "string" ? body.answer : "";

    if (!question || !answer) return SKIP_NUDGE(cors);

    // Paid users and admins get no nudge.
    const [{ data: profile }, { data: entitlements }] = await Promise.all([
      supa.from("profiles").select("role").eq("id", user.id).single(),
      supa
        .from("user_entitlements")
        .select("feature")
        .eq("user_id", user.id)
        .in("feature", ["ai_chat", "engine", "programming"])
        .or("expires_at.is.null,expires_at.gt." + new Date().toISOString()),
    ]);

    const isAdmin = profile?.role === "admin";
    const features = new Set((entitlements || []).map((e: { feature: string }) => e.feature));
    const isPaid = isAdmin || features.has("ai_chat") || features.has("engine") || features.has("programming");
    if (isPaid) return SKIP_NUDGE(cors);

    // Pull all profile fields needed for tier status (T1 + T2 + T3). We only
    // nudge based on T1 and T2, but getTierStatus needs the full picture to
    // know nextTier correctly.
    const { data: athleteProfile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender, days_per_week, session_length_minutes, gym_type, years_training, injuries_constraints, training_split")
      .eq("user_id", user.id)
      .maybeSingle();

    const tierStatus = getTierStatus(athleteProfile);

    // Lowest incomplete tier wins. Skip if T1 + T2 are both done — we don't
    // nudge T3 in chat (per product decision).
    let candidates: NudgeSection[] = [];
    if (!tierStatus.tier1.complete) {
      candidates = ["basics"];
    } else if (!tierStatus.tier2.complete) {
      // tier2.missing is a subset of {'lifts', 'skills', 'conditioning'}
      candidates = tierStatus.tier2.missing.filter(
        (s): s is NudgeSection => (ALL_NUDGE_SECTIONS as readonly string[]).includes(s)
      );
    } else {
      return SKIP_NUDGE(cors);
    }

    const relevant = await callHaikuClassifier(candidates, question, answer);

    return new Response(
      JSON.stringify({
        should_nudge: relevant.length > 0,
        missing_relevant_sections: relevant,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("chat-nudge-classify error:", err);
    return SKIP_NUDGE(getCorsHeaders(req));
  }
});
