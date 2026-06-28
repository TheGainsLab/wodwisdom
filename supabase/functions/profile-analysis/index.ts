/**
 * profile-analysis — async job pattern.
 *
 * On request: validates auth + tier gate, inserts a profile_evaluations
 * row with status='pending', kicks the Claude work into a background task
 * via EdgeRuntime.waitUntil, and returns the evaluation_id immediately
 * (~1s). The client polls profile-analysis-status until status='complete'
 * or 'failed'.
 *
 * This pattern is required because the full synchronous analysis runs
 * many seconds (payload build + Claude call), which iOS Safari routinely
 * aborts with a "TypeError: Load failed" error when the device locks or
 * the tab backgrounds.
 *
 * The evaluation BRAIN is the v2 evaluator: it consumes the same
 * structured buildWriterPayload the program generator uses (canonical
 * Tier 1–4 + competition/power + previous_cycle) and emits a structured
 * 5-section evaluation via the emit_evaluation tool. That structured
 * output is stored in structured_evaluation jsonb AND serialized into the
 * `analysis` text column — which is what v3 generation reads and the eval
 * UI renders today. (The old v1 prose pipeline — derive-athlete-diagnostic
 * + formatters + RAG + recent-history — was retired; the richer raw payload
 * produces a sharper, more data-grounded evaluation.)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildConditioningState } from "../_shared/conditioning-state.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getTierStatus } from "../_shared/tier-status.ts";
import { buildWriterPayload } from "../_shared/build-writer-payload.ts";
import { type EvaluationOutput } from "../_shared/v2-output-schema.ts";
import { generateAndPersistCoachState } from "../_shared/generate-coach-state.ts";
import { evaluationFromCoachState } from "../_shared/coach-state.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
  /** Tier 4 link — when set, the payload fetches a competition history bundle. */
  competition_athlete_id?: string | null;
}

interface ClaudeContentBlock {
  type?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

interface ClaudeResponse {
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Diff the current profile against the most-recent prior evaluation's snapshot —
 * lift/skill/conditioning changes since last eval. Returns "" when there's no
 * prior eval or nothing changed. Lets the evaluator acknowledge progress /
 * regression instead of treating every cycle as a cold read.
 */
function buildComparisonContext(
  previousEval: { profile_snapshot: ProfileData; created_at: string } | null,
  currentProfile: ProfileData,
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

  return `CHANGES SINCE LAST EVALUATION (${date}):\n${changes.join("\n")}`;
}

// (Step 4 cutover) The standalone evaluator was retired: the eval is now the
// CoachState projection (see runAnalysis) — same judgment as the program,
// training-aware via the synthesized Athlete Model. This also removed the
// hardcoded model pin; the CoachState path uses the current model.

/**
 * Flatten the structured evaluation into the markdown `analysis` text column —
 * what v3 generation reads (build-writer-payload's profile_evaluation) and the
 * eval UI renders today. The structured_evaluation jsonb is stored alongside it
 * for future section-card rendering.
 */
function serializeEvaluation(e: EvaluationOutput): string {
  const bullets = (xs: string[]) => (xs ?? []).map((x) => `- ${x}`).join("\n");
  return [
    e.headline_takeaway,
    `**Strengths**\n${bullets(e.strengths)}`,
    `**Weaknesses & Priorities**\n${bullets(e.weaknesses_and_priorities)}`,
    e.detailed_analysis,
    `**Recommendations**\n${bullets(e.recommendations)}`,
  ]
    .filter((s) => s && s.trim())
    .join("\n\n");
}

/** Background task: does the heavy work and writes result back to the evaluation row. */
async function runAnalysis(
  evalId: string,
  userId: string,
  monthNumber: number,
  profileData: ProfileData,
): Promise<void> {
  const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
  const start = Date.now();
  console.log(`[profile-analysis] Job ${evalId} start (month ${monthNumber})`);
  try {
    await supa
      .from("profile_evaluations")
      .update({ status: "processing" })
      .eq("id", evalId);

    // Step 4 cutover: the eval IS the CoachState projection — the SAME judgment
    // the program is built from (aligned by construction), and training-aware via
    // the synthesized Athlete Model that buildWriterPayload computes + persists
    // (capabilities revised from logged evidence). reuse-if-current keeps the
    // eval and the program on a single CoachState. The old standalone-evaluator
    // path (recent-training/comparison context fed to a separate prompt) is
    // retired — that awareness now lives in the Model itself.
    const payload = await buildWriterPayload(supa, userId);
    const { coach_state, version: csVersion, reused } = await generateAndPersistCoachState(
      supa,
      userId,
      payload,
    );
    console.log(`[profile-analysis] coach_state v${csVersion} (reused=${reused}, AM v${payload.athlete_model.version})`);
    const evaluation = evaluationFromCoachState(coach_state);
    const analysis = serializeEvaluation(evaluation);

    await supa
      .from("profile_evaluations")
      .update({
        analysis,
        structured_evaluation: evaluation,
        evaluation_version: "v2",
        status: "complete",
        ready_at: new Date().toISOString(),
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

    // Auth: internal server-to-server (generate-next-month / webhook / cron pass
    // x-webhook-user-id + the service-role key) OR a user JWT. Service calls
    // (continuation + v1→v3 migration) trust the header and skip the credit gate.
    const webhookUserId = req.headers.get("x-webhook-user-id");
    const isServiceCall = !!webhookUserId && token === SUPABASE_SERVICE_KEY;
    let userId: string;
    if (isServiceCall) {
      userId = webhookUserId!;
    } else {
      const { data: { user }, error: authErr } = await supa.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    const { data: athleteProfile } = await supa
      .from("athlete_profiles")
      .select("lifts, skills, conditioning, equipment, bodyweight, units, age, height, gender, goal, self_perception_level, days_per_week, session_length_minutes, injuries_constraints, competition_athlete_id")
      .eq("user_id", userId)
      .maybeSingle();

    // Tier-completeness gate is a USER-onboarding guard (don't run a first eval
    // on an unfinished profile). Service calls (continuation + v1→v3 migration)
    // are for established users with prior programs/evals — skip it; the payload
    // builder handles unrated fields gracefully.
    const tierStatus = getTierStatus(athleteProfile);
    if (!isServiceCall && !tierStatus.canRunEval) {
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
    // Admins bypass. Service calls (continuation + v1→v3 migration, run on the
    // user's behalf by the cron/webhook) don't consume the pool either — those
    // are bundled with the active subscription.
    if (!isContinuation && !isServiceCall) {
      const { data: profile } = await supa
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      const isAdmin = profile?.role === "admin";

      if (!isAdmin) {
        const { data: remaining, error: creditErr } = await supa.rpc(
          "consume_eval_credit",
          { p_user_id: userId }
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
      user_id: userId,
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
        competition_athlete_id: profileData.competition_athlete_id ?? null,
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
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(
      runAnalysis(savedEval.id, userId, monthNumber, profileData)
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
