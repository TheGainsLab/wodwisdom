/**
 * ailog-gap-analysis edge function
 *
 * Takes a program_id (external program), runs analyze-program's block analysis,
 * then cross-references against the athlete profile to produce personalized gap findings.
 *
 * Returns: { analysis, gaps }
 *   - analysis: standard program analysis (modal_balance, time_domains, etc.)
 *   - gaps: personalized gap findings (modality, time_domain, skills, strength, movements)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeBlocks, type BlockInput } from "../_shared/analyzer.ts";
import {
  buildMovementsContext,
  type MovementsRow,
} from "../_shared/build-movements-context.ts";
import { checkEntitlement } from "../_shared/entitlements.ts";
import { callClaude } from "../_shared/call-claude.ts";
import { searchChunks, deduplicateChunks, formatChunksAsContext } from "../_shared/rag.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface AthleteProfile {
  lifts: Record<string, number>;
  skills: Record<string, string>;
  conditioning: Record<string, string>;
  bodyweight: number | null;
  gender: string | null;
  squat_level: string | null;
  bench_level: string | null;
  deadlift_level: string | null;
  snatch_level: string | null;
  clean_jerk_level: string | null;
}

interface GapFinding {
  category: "modality" | "time_domain" | "skill" | "strength" | "movement" | "conditioning";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

const GAP_ANALYSIS_PROMPT = `You are an expert CrossFit coach analyzing a training program for a specific athlete. Given the program analysis data and the athlete's profile, identify gaps in the programming that are relevant to THIS person.

Return ONLY a JSON object:
{
  "gaps": [
    {
      "category": "modality" | "time_domain" | "skill" | "strength" | "movement" | "conditioning",
      "severity": "high" | "medium" | "low",
      "title": "Short gap title",
      "detail": "1-2 sentence explanation of why this matters for this specific athlete"
    }
  ],
  "summary": "2-3 sentence overall assessment of the biggest issues and what to prioritize"
}

Rules:
- Personalize everything to the athlete. A weak squat matters more if the athlete's squat level is C. A missing skill matters more if it's listed as "developing" in their profile.
- Consider the athlete's age, gender, and training history when assessing severity.
- Don't flag something as a gap if it's appropriate for the athlete's level or goals.
- Be specific and actionable. "No long workouts" is better than "time domain imbalance."
- Limit to the most important 3-7 gaps. Don't list everything that could theoretically be better.
- Sort by severity in the gaps array (high first).
- Output valid JSON only, no markdown fences.`;

async function computeGapsAI(
  analysis: ReturnType<typeof analyzeBlocks>,
  profile: AthleteProfile,
  apiKey: string,
  ragContext?: string,
): Promise<{ gaps: GapFinding[]; summary: string | null }> {
  const profileParts: string[] = [];
  if (profile.gender) profileParts.push(`Gender: ${profile.gender}`);
  if (profile.bodyweight) profileParts.push(`Bodyweight: ${profile.bodyweight}`);
  if (profile.lifts && Object.keys(profile.lifts).length > 0) {
    profileParts.push("Lifts: " + Object.entries(profile.lifts).filter(([, v]) => v > 0).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', '));
  }
  const liftLevels = [
    profile.squat_level && `squat: ${profile.squat_level}`,
    profile.bench_level && `bench: ${profile.bench_level}`,
    profile.deadlift_level && `deadlift: ${profile.deadlift_level}`,
    profile.snatch_level && `snatch: ${profile.snatch_level}`,
    profile.clean_jerk_level && `clean & jerk: ${profile.clean_jerk_level}`,
  ].filter(Boolean);
  if (liftLevels.length > 0) profileParts.push("Lift levels (A=needs development, B=moderate, C=advanced): " + liftLevels.join(', '));
  if (profile.skills && Object.keys(profile.skills).length > 0) {
    profileParts.push("Skills: " + Object.entries(profile.skills).filter(([, v]) => v && v !== 'none').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', '));
  }
  if (profile.conditioning && Object.keys(profile.conditioning).length > 0) {
    profileParts.push("Conditioning benchmarks: " + Object.entries(profile.conditioning).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', '));
  }

  const userContent = `PROGRAM ANALYSIS:
Modal balance: ${JSON.stringify(analysis.modal_balance)}
Time domains: ${JSON.stringify(analysis.time_domains)}
Workout formats: ${JSON.stringify(analysis.workout_formats)}
Movement frequency (top 15): ${JSON.stringify(analysis.movement_frequency.slice(0, 15).map(m => ({ name: m.name, count: m.count, modality: m.modality })))}
Not programmed: ${JSON.stringify(analysis.not_programmed)}
Loading ratio: ${JSON.stringify(analysis.loading_ratio)}

ATHLETE PROFILE:
${profileParts.length > 0 ? profileParts.join('\n') : 'No profile data available.'}`;

  try {
    const systemPrompt = ragContext
      ? GAP_ANALYSIS_PROMPT + "\n\nREFERENCE MATERIAL (use to inform your analysis):\n" + ragContext
      : GAP_ANALYSIS_PROMPT;

    const raw = await callClaude({
      apiKey,
      system: systemPrompt,
      userContent,
      maxTokens: 2048,
    });
    const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned);
    const gaps: GapFinding[] = (parsed.gaps || [])
      .filter((g: Record<string, unknown>) => g.title && g.detail && g.severity)
      .map((g: Record<string, unknown>) => ({
        category: String(g.category || "other"),
        severity: ["high", "medium", "low"].includes(g.severity as string) ? g.severity as "high" | "medium" | "low" : "medium",
        title: String(g.title),
        detail: String(g.detail),
      }));
    return { gaps, summary: parsed.summary || null };
  } catch (e) {
    console.error("[ailog-gap-analysis] computeGapsAI error:", e);
    return { gaps: [], summary: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Check AI Log entitlement
    const hasAccess = await checkEntitlement(supa, user.id, "ailog");
    if (!hasAccess) return json({ error: "AI Log subscription required" }, 403);

    const body = await req.json();
    const { program_id } = body;
    if (!program_id) return json({ error: "program_id required" }, 400);

    // Verify ownership and external source
    const { data: program } = await supa
      .from("programs")
      .select("id, user_id, source")
      .eq("id", program_id)
      .single();

    if (!program || program.user_id !== user.id) return json({ error: "Not found" }, 404);

    // Fetch workouts, blocks, movements, and profile in parallel
    const [workoutsRes, movementsRes, profileRes] = await Promise.all([
      supa
        .from("program_workouts")
        .select("id, week_num, day_num, sort_order")
        .eq("program_id", program_id)
        .order("sort_order"),
      supa
        .from("movements")
        .select("canonical_name, display_name, modality, category, aliases, competition_count"),
      supa
        .from("athlete_profiles")
        .select("lifts, skills, conditioning, bodyweight, gender, squat_level, bench_level, deadlift_level, snatch_level, clean_jerk_level")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const workouts = workoutsRes.data;
    if (!workouts?.length) return json({ error: "No workouts found" }, 404);

    const workoutIds = workouts.map((w: { id: string }) => w.id);
    const { data: blocks } = await supa
      .from("program_workout_blocks")
      .select("id, program_workout_id, block_type, block_order, block_text, parsed_tasks")
      .in("program_workout_id", workoutIds)
      .order("block_order");

    if (!blocks?.length) return json({ error: "No workout blocks found" }, 404);

    // Build analysis inputs
    const rows: MovementsRow[] = (movementsRes.data || []) as MovementsRow[];
    const movementsContext = buildMovementsContext(rows);

    const workoutLookup = new Map(
      workouts.map((w: { id: string; sort_order: number; week_num: number; day_num: number }) => [
        w.id,
        { sort_order: w.sort_order, week_num: w.week_num, day_num: w.day_num },
      ])
    );

    const blockInputs: BlockInput[] = blocks.map((b) => {
      const parent = workoutLookup.get(b.program_workout_id);
      return {
        block_type: b.block_type,
        block_text: b.block_text,
        parsed_tasks: b.parsed_tasks as Record<string, unknown>[] | null,
        sort_order: parent?.sort_order ?? 0,
        week_num: parent?.week_num,
        day_num: parent?.day_num,
      };
    });

    // Run standard analysis
    const gender = profileRes.data?.gender as string | null;
    const analysis = analyzeBlocks(blockInputs, movementsContext, gender);

    // Compute personalized gaps
    const profile: AthleteProfile = {
      lifts: (profileRes.data?.lifts as Record<string, number>) || {},
      skills: (profileRes.data?.skills as Record<string, string>) || {},
      conditioning: (profileRes.data?.conditioning as Record<string, string>) || {},
      bodyweight: profileRes.data?.bodyweight as number | null,
      gender,
      squat_level: profileRes.data?.squat_level as string | null,
      bench_level: profileRes.data?.bench_level as string | null,
      deadlift_level: profileRes.data?.deadlift_level as string | null,
      snatch_level: profileRes.data?.snatch_level as string | null,
      clean_jerk_level: profileRes.data?.clean_jerk_level as string | null,
    };

    // RAG: search for relevant training science context
    let ragContext = "";
    if (OPENAI_API_KEY) {
      try {
        const profileSummary = [
          profile.gender, profile.bodyweight ? `${profile.bodyweight}lbs` : null,
          Object.keys(profile.lifts || {}).length > 0 ? "has lift data" : null,
          Object.keys(profile.skills || {}).length > 0 ? "has skills" : null,
        ].filter(Boolean).join(", ");
        const searchQuery = `CrossFit programming gaps training analysis ${profileSummary}`;

        const [journalChunks, strengthChunks] = await Promise.all([
          searchChunks(supa, searchQuery, "journal", OPENAI_API_KEY, 3, 0.25),
          searchChunks(supa, searchQuery, "strength-science", OPENAI_API_KEY, 3, 0.25),
        ]);

        const allChunks = deduplicateChunks([...journalChunks, ...strengthChunks]);
        if (allChunks.length > 0) {
          ragContext = formatChunksAsContext(allChunks, 4);
        }
      } catch (e) {
        console.error("[ailog-gap-analysis] RAG search error:", e);
      }
    }

    // AI-driven gap analysis: send program data + athlete profile + RAG context to Claude
    let gaps: GapFinding[] = [];
    let summary: string | null = null;
    if (ANTHROPIC_API_KEY) {
      const result = await computeGapsAI(analysis, profile, ANTHROPIC_API_KEY, ragContext || undefined);
      gaps = result.gaps;
      summary = result.summary;
    }

    // Upsert analysis with gaps and summary
    await supa
      .from("program_analyses")
      .upsert(
        {
          program_id,
          modal_balance: analysis.modal_balance,
          time_domains: analysis.time_domains,
          workout_structure: analysis.workout_structure,
          workout_formats: analysis.workout_formats,
          movement_frequency: analysis.movement_frequency,
          notices: analysis.notices,
          not_programmed: analysis.not_programmed,
          consecutive_overlaps: analysis.consecutive_overlaps,
          loading_ratio: analysis.loading_ratio,
          distinct_loads: analysis.distinct_loads,
          load_bands: analysis.load_bands,
          gaps,
          gap_summary: summary,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "program_id" }
      );

    return json({ analysis, gaps, summary });
  } catch (err) {
    console.error("ailog-gap-analysis error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
