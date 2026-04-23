/**
 * Generate next month of a program.
 * Orchestrates: profile + training + nutrition evaluation → program generation → atomic delivery.
 *
 * Input: { program_id: string }
 * Flow:
 *   1. Look up the program and determine the next month number
 *   2. Run profile-analysis with month context (eval saved as invisible)
 *   3. Run training-analysis and nutrition-analysis in parallel (results appended to evaluation)
 *   4. Trigger generate-program with month_number + program_id (appends workouts, makes eval visible)
 *   5. Return job_id for polling
 *
 * Triggered by: payment webhooks, quarterly cron, or admin manual button.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");

    // Support server-to-server calls from webhook (user_id in body or header)
    let userId: string | null = null;
    let userToken: string | null = null;
    const webhookUserId = req.headers.get("x-webhook-user-id");

    if (webhookUserId && token === SUPABASE_SERVICE_KEY) {
      // Called from webhook with service role key — trust the user_id
      userId = webhookUserId;
    } else {
      // Called from frontend with user token
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
      userId = user.id;
      userToken = token;
    }

    const body = await req.json().catch(() => ({}));
    const programId: string | null = body?.program_id ?? null;
    // If user_id provided in body (from webhook), use it
    if (body?.user_id && !webhookUserId) userId = body.user_id;
    const authToken = userToken || `Bearer ${SUPABASE_SERVICE_KEY}`;

    if (!programId) {
      return new Response(
        JSON.stringify({ error: "program_id is required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // 1. Look up program and determine next month
    const { data: program, error: progErr } = await supa
      .from("programs")
      .select("id, user_id, generated_months, source")
      .eq("id", programId)
      .eq("user_id", userId)
      .maybeSingle();

    if (progErr || !program) {
      return new Response(
        JSON.stringify({ error: "Program not found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (program.source && program.source !== "generated") {
      return new Response(
        JSON.stringify({ error: "Can only generate next month for AI-generated programs" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const nextMonth = (program.generated_months || 1) + 1;
    console.log(`[generate-next-month] current months=${program.generated_months}, generating month ${nextMonth}`);

    // 2. Check rate limit — one evaluation per month
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { count: recentEvalCount } = await supa
      .from("profile_evaluations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", thirtyDaysAgo.toISOString());

    if ((recentEvalCount ?? 0) > 0) {
      // Check if the most recent eval is for the current month already
      const { data: latestEval } = await supa
        .from("profile_evaluations")
        .select("month_number")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestEval && latestEval.month_number >= nextMonth) {
        return new Response(
          JSON.stringify({ error: "Evaluation already generated for this month" }),
          { status: 429, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    }

    // 3. Run profile analysis with month context
    //    This creates a new evaluation with visible=false
    const evalUrl = `${SUPABASE_URL}/functions/v1/profile-analysis`;
    const evalResp = await fetch(evalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        month_number: nextMonth,
        program_id: programId,
      }),
    });

    if (!evalResp.ok) {
      const err = await evalResp.json().catch(() => ({}));
      console.error("[generate-next-month] Profile analysis failed:", err);
      return new Response(
        JSON.stringify({ error: "Failed to generate monthly evaluation" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const evalData = await evalResp.json();
    const evaluationId = evalData.evaluation_id;
    console.log(`[generate-next-month] Profile evaluation kicked off (month ${nextMonth}, id ${evaluationId})`);

    // profile-analysis is now an async job (to survive iOS Safari client
    // timeouts). Poll its status endpoint until it's complete before
    // continuing — the rest of the pipeline expects a completed analysis
    // to exist when generate-program runs.
    if (evaluationId) {
      const statusUrl = `${SUPABASE_URL}/functions/v1/profile-analysis-status`;
      const statusAuthHeader = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
      const maxWaitMs = 3 * 60 * 1000;
      const pollMs = 4000;
      const startWait = Date.now();
      let done = false;
      while (Date.now() - startWait < maxWaitMs) {
        await new Promise((r) => setTimeout(r, pollMs));
        const statusResp = await fetch(statusUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: statusAuthHeader },
          body: JSON.stringify({ evaluation_id: evaluationId }),
        });
        if (!statusResp.ok) continue;
        const s = await statusResp.json().catch(() => ({}));
        if (s?.status === "complete") { done = true; break; }
        if (s?.status === "failed") {
          console.error(`[generate-next-month] Profile analysis failed: ${s.error}`);
          return new Response(
            JSON.stringify({ error: "Profile evaluation failed", detail: s.error }),
            { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }
      }
      if (!done) {
        console.error(`[generate-next-month] Profile analysis timed out after ${maxWaitMs}ms`);
        return new Response(
          JSON.stringify({ error: "Profile evaluation timed out" }),
          { status: 504, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      console.log(`[generate-next-month] Profile evaluation complete`);
    }

    // 4. Run training and nutrition analysis in parallel
    //    Each saves to its own table (training_evaluations, nutrition_evaluations)
    //    tagged with the same month_number and program_id — UI groups them by month.
    const analysisAuthHeader = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
    const analysisBody = JSON.stringify({ month_number: nextMonth, program_id: programId });
    const [trainingResult, nutritionResult] = await Promise.allSettled([
      fetch(`${SUPABASE_URL}/functions/v1/training-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: analysisAuthHeader },
        body: analysisBody,
      }).then(r => r.json()),
      fetch(`${SUPABASE_URL}/functions/v1/nutrition-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: analysisAuthHeader },
        body: analysisBody,
      }).then(r => r.json()),
    ]);

    const trainingOk = trainingResult.status === "fulfilled" && trainingResult.value?.analysis;
    const nutritionOk = nutritionResult.status === "fulfilled" && nutritionResult.value?.analysis;
    console.log(`[generate-next-month] Training: ${trainingOk ? 'saved' : 'none'}, Nutrition: ${nutritionOk ? 'saved' : 'none'}`);

    // 5. Trigger program generation with month context
    //    This will append 20 workouts and make the evaluation visible on completion
    const genUrl = `${SUPABASE_URL}/functions/v1/generate-program`;
    const genResp = await fetch(genUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        evaluation_id: evaluationId,
        month_number: nextMonth,
        program_id: programId,
      }),
    });

    if (!genResp.ok) {
      const err = await genResp.json().catch(() => ({}));
      console.error("[generate-next-month] Program generation failed:", err);
      // Clean up the invisible evaluation
      await supa
        .from("profile_evaluations")
        .delete()
        .eq("id", evaluationId);
      return new Response(
        JSON.stringify({ error: "Failed to start program generation" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const genData = await genResp.json();
    console.log(`[generate-next-month] Generation started, month=${nextMonth}`);

    return new Response(
      JSON.stringify({
        job_id: genData.job_id,
        month_number: nextMonth,
        evaluation_id: evaluationId,
      }),
      { status: 202, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-next-month error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
