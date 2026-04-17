import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_Q_CHARS = 2000;
const MAX_A_CHARS = 6000;

type ProfileSection = "lifts" | "skills" | "conditioning" | "equipment";
const ALL_SECTIONS: ProfileSection[] = ["lifts", "skills", "conditioning", "equipment"];

type ProfileRow = {
  lifts: Record<string, number> | null;
  skills: Record<string, string> | null;
  conditioning: Record<string, string | number> | null;
  equipment: Record<string, boolean> | null;
};

function emptySections(profile: ProfileRow | null): ProfileSection[] {
  if (!profile) return [...ALL_SECTIONS];
  const missing: ProfileSection[] = [];

  const liftsPresent =
    !!profile.lifts &&
    Object.values(profile.lifts).some((v) => typeof v === "number" && v > 0);
  if (!liftsPresent) missing.push("lifts");

  const skillsPresent =
    !!profile.skills &&
    Object.values(profile.skills).some((v) => v != null && String(v).trim() !== "");
  if (!skillsPresent) missing.push("skills");

  const conditioningPresent =
    !!profile.conditioning &&
    Object.values(profile.conditioning).some((v) => v != null && String(v).trim() !== "");
  if (!conditioningPresent) missing.push("conditioning");

  const equipmentPresent =
    !!profile.equipment && Object.keys(profile.equipment).length > 0;
  if (!equipmentPresent) missing.push("equipment");

  return missing;
}

const CLASSIFIER_SYSTEM = `You are a classifier that decides whether a fitness coaching answer would have been MATERIALLY better with specific missing user profile data.

Profile sections that may be empty:
- lifts: 1RM strength numbers (back squat, bench press, deadlift, clean, snatch, etc.)
- skills: proficiency on gymnastics/olympic skills (muscle-ups, handstand walk, double-unders, rope climbs, etc.)
- conditioning: benchmark workout times or capacity (Fran, 5K row, mile run, max HR, etc.)
- equipment: what equipment the athlete has access to

You will be given:
- EMPTY SECTIONS: the subset of {lifts, skills, conditioning, equipment} the user has not filled in.
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
Only include sections from the EMPTY SECTIONS list.`;

function parseClassifierJSON(raw: string): ProfileSection[] {
  if (!raw) return [];
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { missing_relevant_sections?: unknown };
    if (!Array.isArray(parsed.missing_relevant_sections)) return [];
    const valid = new Set(ALL_SECTIONS);
    return parsed.missing_relevant_sections.filter(
      (s: unknown): s is ProfileSection => typeof s === "string" && valid.has(s as ProfileSection)
    );
  } catch {
    return [];
  }
}

async function callHaikuClassifier(
  emptyList: ProfileSection[],
  question: string,
  answer: string
): Promise<ProfileSection[]> {
  if (!ANTHROPIC_API_KEY) return [];

  const q = question.slice(0, MAX_Q_CHARS);
  const a = answer.slice(0, MAX_A_CHARS);

  const userContent = `EMPTY SECTIONS: ${emptyList.join(", ")}

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
  const relevant = parseClassifierJSON(raw);

  // Ensure we never return a section that wasn't in the empty list.
  const emptySet = new Set(emptyList);
  return relevant.filter((s) => emptySet.has(s));
}

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

    if (!question || !answer) {
      return new Response(
        JSON.stringify({ should_nudge: false, missing_relevant_sections: [] }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Paid users get no nudge (per product decision — revisit later).
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

    if (isPaid) {
      return new Response(
        JSON.stringify({ should_nudge: false, missing_relevant_sections: [] }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const { data: athleteProfile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, equipment")
      .eq("user_id", user.id)
      .maybeSingle();

    const missing = emptySections(athleteProfile as ProfileRow | null);
    if (missing.length === 0) {
      return new Response(
        JSON.stringify({ should_nudge: false, missing_relevant_sections: [] }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const relevant = await callHaikuClassifier(missing, question, answer);

    return new Response(
      JSON.stringify({
        should_nudge: relevant.length > 0,
        missing_relevant_sections: relevant,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("chat-nudge-classify error:", err);
    return new Response(
      JSON.stringify({ should_nudge: false, missing_relevant_sections: [] }),
      { status: 200, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
