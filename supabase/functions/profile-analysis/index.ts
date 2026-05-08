/**
 * profile-analysis — async job pattern.
 *
 * On request: validates auth + tier gate, inserts a profile_evaluations
 * row with status='pending', kicks the RAG + Claude work into a
 * background task via EdgeRuntime.waitUntil, and returns the
 * evaluation_id immediately (~1s). The client polls
 * profile-analysis-status until status='complete' or 'failed'.
 *
 * This pattern is required because the full synchronous analysis runs
 * 15-30 seconds (OpenAI embeddings + vector search + Claude call), which
 * iOS Safari routinely aborts with a "TypeError: Load failed" error when
 * the device locks or the tab backgrounds.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  searchChunks,
  deduplicateChunks,
  formatChunksAsContext,
} from "../_shared/rag.ts";
import { fetchAndFormatRecentHistory } from "../_shared/training-history.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getTierStatus } from "../_shared/tier-status.ts";
import { deriveAthleteDiagnostic, type AthleteDiagnostic } from "../_shared/derive-athlete-diagnostic.ts";
import {
  formatActiveFlagRules,
  formatLiftFindings,
  formatSkillsFindings,
} from "../_shared/diagnostic-formatters.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const SYSTEM_PROMPT = `You are an expert CrossFit coach giving a direct, honest profile evaluation. Write like a coach talking to their athlete — clear, specific, no filler. Ground your advice in the reference material when relevant.`;

interface ProfileData {
  lifts?: Record<string, number> | null;
  skills?: Record<string, string> | null;
  conditioning?: Record<string, string | number> | null;
  bodyweight?: number | null;
  units?: string | null;
  age?: number | null;
  height?: number | null;
  gender?: string | null;
  equipment?: Record<string, boolean> | null;
  goal?: string | null;
  self_perception_level?: string | null;
  days_per_week?: number | null;
  session_length_minutes?: number | null;
  injuries_constraints?: string | null;
}

function formatProfile(profile: ProfileData, diagnostic: AthleteDiagnostic): string {
  const sections: string[] = [];
  const u = profile.units === "kg" ? "kg" : "lbs";

  // Basics (Tier 1) — short consecutive lines.
  const basics: string[] = [];
  if (profile.age != null && profile.age > 0) basics.push(`Age: ${profile.age}`);
  if (profile.height != null && profile.height > 0) basics.push(`Height: ${profile.height} ${profile.units === "kg" ? "cm" : "in"}`);
  if (profile.bodyweight && profile.bodyweight > 0) basics.push(`Bodyweight: ${profile.bodyweight} ${u}`);
  if (profile.gender) basics.push(`Gender: ${profile.gender}`);
  if (basics.length > 0) sections.push(basics.join("\n"));

  // Lifts findings — replaces the legacy "1RM Lifts —" prose line.
  if (diagnostic.meta.inputs_complete.lifts) {
    sections.push(formatLiftFindings(diagnostic));
  }

  // Skills findings — replaces the legacy "Skills —" prose line.
  if (diagnostic.meta.inputs_complete.skills) {
    sections.push(formatSkillsFindings(diagnostic));
  }

  // Conditioning — passthrough (Engine handles the conditioning diagnostic).
  if (profile.conditioning && Object.keys(profile.conditioning).length > 0) {
    const condStr = Object.entries(profile.conditioning)
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(", ");
    if (condStr) sections.push("Conditioning — " + condStr);
  }

  // Equipment unavailable (Tier 3) — mirrors program generator: only flag what's missing.
  if (profile.equipment) {
    const unavailable = Object.entries(profile.equipment)
      .filter(([, v]) => v === false)
      .map(([k]) => k.replace(/_/g, " "));
    if (unavailable.length > 0) sections.push("Equipment NOT available — " + unavailable.join(", "));
  }

  // Training context (Tier 3): goal, injuries, self-perception, schedule.
  const ctx: string[] = [];
  if (profile.goal && profile.goal.trim()) ctx.push(`Goal: ${profile.goal.trim()}`);
  const inj = profile.injuries_constraints?.trim();
  if (inj && !/^(none|n\/a|na)$/i.test(inj)) ctx.push(`Injuries/Constraints: ${inj}`);
  if (profile.self_perception_level && profile.self_perception_level !== "not_sure") {
    ctx.push(`Self-perceived level: ${profile.self_perception_level.replace(/_/g, " ")}`);
  }
  if (profile.days_per_week && profile.days_per_week > 0) ctx.push(`Training frequency: ${profile.days_per_week} days/week`);
  if (profile.session_length_minutes && profile.session_length_minutes > 0) ctx.push(`Session length: ${profile.session_length_minutes} min`);
  if (ctx.length > 0) sections.push("Training Context — " + ctx.join("; "));

  return sections.join("\n\n") || "No profile data.";
}

async function retrieveRAGContext(
  supa: ReturnType<typeof createClient>,
  profileData: ProfileData
): Promise<string> {
  if (!OPENAI_API_KEY) return "";

  try {
    const promises: Promise<import("../_shared/rag.ts").RAGChunk[]>[] = [];

    const liftNames = profileData.lifts
      ? Object.keys(profileData.lifts).map((k) => k.replace(/_/g, " ")).join(", ")
      : "";
    promises.push(
      searchChunks(supa, `strength training programming periodization ${liftNames}`, "journal", OPENAI_API_KEY, 4, 0.25)
    );
    promises.push(
      searchChunks(supa, liftNames ? `strength training periodization load prescription ${liftNames}` : "strength training periodization load prescription squat deadlift", "strength-science", OPENAI_API_KEY, 2, 0.25)
    );

    const skillNames = profileData.skills
      ? Object.entries(profileData.skills)
          .filter(([, v]) => v && v !== "none")
          .map(([k]) => k.replace(/_/g, " "))
          .join(", ")
      : "";
    promises.push(
      searchChunks(supa, `CrossFit gymnastics skill progression ${skillNames}`, "journal", OPENAI_API_KEY, 4, 0.25)
    );

    promises.push(
      searchChunks(supa, "CrossFit conditioning engine aerobic capacity work capacity rowing running", "journal", OPENAI_API_KEY, 4, 0.25)
    );

    const results = await Promise.all(promises);
    const allChunks = results.flat();
    const unique = deduplicateChunks(allChunks);
    if (unique.length === 0) return "";

    return "\n\nREFERENCE MATERIAL (Journal and Strength Science — use to ground your advice):\n" + formatChunksAsContext(unique, 10);
  } catch (err) {
    console.error("RAG retrieval error:", err);
    return "";
  }
}

function buildComparisonContext(
  previousEval: { profile_snapshot: ProfileData; created_at: string } | null,
  currentProfile: ProfileData
): string {
  if (!previousEval) return "";

  const prev = previousEval.profile_snapshot;
  const changes: string[] = [];
  const u = currentProfile.units === "kg" ? "kg" : "lbs";
  const date = new Date(previousEval.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (currentProfile.lifts && prev.lifts) {
    for (const [key, val] of Object.entries(currentProfile.lifts)) {
      const prevVal = prev.lifts[key];
      if (prevVal && val > 0 && prevVal > 0 && val !== prevVal) {
        const diff = val - prevVal;
        changes.push(`${key.replace(/_/g, " ")}: ${prevVal} → ${val} ${u} (${diff > 0 ? "+" : ""}${diff})`);
      }
    }
  }

  if (currentProfile.skills && prev.skills) {
    const levelOrder: Record<string, number> = { none: 0, beginner: 1, intermediate: 2, advanced: 3 };
    for (const [key, val] of Object.entries(currentProfile.skills)) {
      const prevVal = prev.skills[key];
      if (prevVal && val !== prevVal) {
        const direction = (levelOrder[val] || 0) > (levelOrder[prevVal] || 0) ? "↑" : "↓";
        changes.push(`${key.replace(/_/g, " ")}: ${prevVal} → ${val} ${direction}`);
      }
    }
  }

  if (currentProfile.conditioning && prev.conditioning) {
    for (const [key, val] of Object.entries(currentProfile.conditioning)) {
      const prevVal = prev.conditioning?.[key];
      if (prevVal != null && val != null && String(val) !== String(prevVal)) {
        changes.push(`${key.replace(/_/g, " ")}: ${prevVal} → ${val}`);
      }
    }
  }

  if (changes.length === 0) return "";

  return `\n\nCHANGES SINCE LAST EVALUATION (${date}):\n${changes.join("\n")}\n\nAcknowledge meaningful progress or regressions. Be specific about what improved.`;
}

/** Background task: does the heavy work and writes result back to the evaluation row. */
async function runAnalysis(
  supa: ReturnType<typeof createClient>,
  evalId: string,
  userId: string,
  profileData: ProfileData,
  monthNumber: number,
): Promise<void> {
  const start = Date.now();
  console.log(`[profile-analysis] Job ${evalId} start`);
  try {
    await supa
      .from("profile_evaluations")
      .update({ status: "processing" })
      .eq("id", evalId);

    const diagnostic = deriveAthleteDiagnostic(profileData);
    const profileStr = formatProfile(profileData, diagnostic);
    const isContinuation = monthNumber > 1;

    const { data: prevEval } = await supa
      .from("profile_evaluations")
      .select("profile_snapshot, created_at, analysis")
      .eq("user_id", userId)
      .neq("id", evalId)
      .eq("status", "complete")
      .not("analysis", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const trainingDays = isContinuation ? 35 : 14;
    const trainingMaxLines = isContinuation ? 60 : 30;

    const [ragContext, comparisonContext, recentTraining] = await Promise.all([
      retrieveRAGContext(supa, profileData),
      Promise.resolve(buildComparisonContext(prevEval, profileData)),
      fetchAndFormatRecentHistory(supa, userId, { days: trainingDays, maxLines: trainingMaxLines }),
    ]);
    const trainingBlock = recentTraining ? `\n\n${recentTraining}` : "";

    const userPrompt = `Here is an athlete's full profile:\n\n${profileStr}${trainingBlock}\n\nGive this athlete a comprehensive profile evaluation. Cover all domains they have data for — strength, skills, and conditioning — in a single cohesive assessment.\n\nYour evaluation should:\n- Identify their strongest areas and their biggest limiters\n- Ground your strength assessment in the structured ATHLETE LIFT FINDINGS section (per-lift levels, active flags, accessory pool). The math is already done — interpret it, don't redo it.\n- For skills, consider prerequisite chains (strict before kipping, kipping before butterfly) and competition frequency\n- For conditioning, assess work capacity and compare across modalities (run vs row vs bike)\n- Connect the dots across domains — how do their strengths and weaknesses in one area affect another?\n- If a Training Context section is present, weigh their stated goal, injuries/constraints, training frequency, session length, and any unavailable equipment when choosing priorities. Don't recommend movements blocked by their constraints, and skew priorities toward what serves their goal in the time and equipment they have. If their self-perceived level diverges from what their data shows, address that gap directly.\n- End with 2-3 clear priorities for improvement, ranked by impact and feasibility given their constraints, time available, and goal\n\nWrite like a coach talking to the athlete. Be direct, specific, and concise. No bullet-point tier lists — write in short paragraphs.${comparisonContext}`;

    const flagRules = formatActiveFlagRules(diagnostic);
    const systemPrompt = SYSTEM_PROMPT + (flagRules ? "\n\n" + flagRules : "") + ragContext;

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        stream: false,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error(`[profile-analysis] Job ${evalId} Claude error:`, err);
      throw new Error("Failed to generate analysis");
    }

    const data = await resp.json();
    const analysis = data.content?.[0]?.text?.trim() || "Unable to generate analysis.";

    await supa
      .from("profile_evaluations")
      .update({
        analysis,
        status: "complete",
        ready_at: new Date().toISOString(),
        diagnostic_snapshot: diagnostic,
      })
      .eq("id", evalId);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[profile-analysis] Job ${evalId} complete in ${elapsed}s (${analysis.length} chars)`);
  } catch (e) {
    const message = (e as Error).message || "Analysis failed";
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[profile-analysis] Job ${evalId} FAILED after ${elapsed}s:`, message);
    try {
      await supa
        .from("profile_evaluations")
        .update({
          status: "failed",
          error: message,
          ready_at: new Date().toISOString(),
        })
        .eq("id", evalId);
    } catch (cleanupErr) {
      console.error(`[profile-analysis] Job ${evalId} failed to mark failure:`, cleanupErr);
    }
  }
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

    const { data: athleteProfile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender, goal, self_perception_level, days_per_week, session_length_minutes, injuries_constraints")
      .eq("user_id", user.id)
      .maybeSingle();

    const tierStatus = getTierStatus(athleteProfile);
    if (!tierStatus.canRunEval) {
      const missing = [
        ...tierStatus.tier1.missing.map((f) => `basics.${f}`),
        ...tierStatus.tier2.missing.map((f) => `athletic.${f}`),
      ];
      return new Response(
        JSON.stringify({
          error: "TIER_INCOMPLETE",
          message: "Finish your Basics, Lifts, Skills, and Conditioning to run your free evaluation.",
          missing_fields: missing,
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const profileData: ProfileData = athleteProfile || {};

    let monthNumber = 1;
    let programId: string | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      monthNumber = body?.month_number ?? 1;
      programId = body?.program_id ?? null;
    } catch {
      // no body — defaults are fine
    }
    const isContinuation = monthNumber > 1;

    // Credit gate. Free users get one manual eval (month_number=1).
    // Admins bypass. Cron-driven continuations don't consume the pool —
    // those are bundled with the active subscription's monthly rollover.
    if (!isContinuation) {
      const { data: profile } = await supa
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      const isAdmin = profile?.role === "admin";

      if (!isAdmin) {
        const { data: remaining, error: creditErr } = await supa.rpc(
          "consume_eval_credit",
          { p_user_id: user.id }
        );
        if (creditErr) {
          console.error("consume_eval_credit failed:", creditErr);
          return new Response(
            JSON.stringify({ error: "Failed to start evaluation" }),
            { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }
        if (remaining == null || remaining < 0) {
          return new Response(
            JSON.stringify({
              error: "EVALUATION_LIMIT_REACHED",
              message: "You've used your free evaluation. Subscribers receive ongoing monthly analysis automatically.",
            }),
            { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Insert the job row with status='pending' and the profile snapshot.
    // Analysis is populated by the background task.
    const evalRow: Record<string, unknown> = {
      user_id: user.id,
      analysis: null,
      status: "pending",
      month_number: monthNumber,
      visible: isContinuation ? false : true,
      profile_snapshot: {
        lifts: profileData.lifts || {},
        skills: profileData.skills || {},
        conditioning: profileData.conditioning || {},
        equipment: profileData.equipment || {},
        bodyweight: profileData.bodyweight ?? null,
        units: profileData.units || "lbs",
        age: profileData.age ?? null,
        height: profileData.height ?? null,
        gender: profileData.gender ?? null,
        goal: profileData.goal ?? null,
        self_perception_level: profileData.self_perception_level ?? null,
        days_per_week: profileData.days_per_week ?? null,
        session_length_minutes: profileData.session_length_minutes ?? null,
        injuries_constraints: profileData.injuries_constraints ?? null,
      },
    };
    if (programId) evalRow.program_id = programId;

    const { data: savedEval, error: insertErr } = await supa
      .from("profile_evaluations")
      .insert(evalRow)
      .select("id, created_at")
      .single();

    if (insertErr || !savedEval) {
      console.error("Failed to create evaluation row:", insertErr);
      return new Response(
        JSON.stringify({ error: "Failed to start evaluation" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Fire the background task. Supabase's EdgeRuntime.waitUntil keeps the
    // request alive for the return below and the task continues after.
    EdgeRuntime.waitUntil(
      runAnalysis(supa, savedEval.id, user.id, profileData, monthNumber)
    );

    return new Response(
      JSON.stringify({
        evaluation_id: savedEval.id,
        status: "pending",
        created_at: savedEval.created_at,
      }),
      { status: 202, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
