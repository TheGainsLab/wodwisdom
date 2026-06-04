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
    let reqProgramId: string | null = body?.program_id ?? null;
    // SECURITY: never take the user id from the request body. Service callers
    // (cron / webhook / migration) are identified by the verified
    // x-webhook-user-id header (under the service key) above; frontend callers
    // by their JWT. Honoring body.user_id here would let any authenticated user
    // pass { user_id: <victim> } and drive another user's generation (IDOR).
    const authToken = userToken || `Bearer ${SUPABASE_SERVICE_KEY}`;

    // Server-to-server callers (cron/webhook) authenticate sub-calls with the
    // service key + x-webhook-user-id; a frontend caller forwards its user token.
    const serviceMode = !userToken;
    const subHeaders = (): Record<string, string> => {
      const h: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`,
      };
      if (serviceMode && userId) h["x-webhook-user-id"] = userId;
      return h;
    };

    // 1. Resolve the program to advance: an explicit program_id, else the user's
    //    latest generated program (any version), else none (a user who never
    //    generated — first-gen migration).
    let program:
      | { id: string; generated_months: number | null; source: string | null; program_version: string | null }
      | null = null;
    if (reqProgramId) {
      const { data, error } = await supa
        .from("programs")
        .select("id, generated_months, source, program_version")
        .eq("id", reqProgramId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) {
        return new Response(
          JSON.stringify({ error: "Program not found" }),
          { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      program = data;
    } else {
      const { data } = await supa
        .from("programs")
        .select("id, generated_months, source, program_version")
        .eq("user_id", userId)
        .eq("source", "generated")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      program = data ?? null;
      reqProgramId = program?.id ?? null;
    }

    if (program && program.source && program.source !== "generated") {
      return new Response(
        JSON.stringify({ error: "Can only generate next month for AI-generated programs" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Routing (v1/v2 retired as generators; v3 is the only generator):
    //   - v3 program   → APPEND the next month to it (normal continuation).
    //   - v1/v2 program → MIGRATE: generate a NEW v3 program at the next month
    //                     (N+1), preserving the counter; old program stays as history.
    //   - no program   → FIRST-GEN: new v3 program at month 1.
    // A null program_id to generate-program-v3 makes a NEW v3 program at the
    // requested month; a non-null program_id appends.
    const isV3 = program?.program_version === "v3";
    const targetMonth = program ? (program.generated_months || 1) + 1 : 1;
    const appendToProgramId = isV3 ? reqProgramId : null;
    const mode = !program ? "firstgen" : isV3 ? "append" : "migrate";
    console.log(`[generate-next-month] user=${userId} mode=${mode} targetMonth=${targetMonth} latestVersion=${program?.program_version ?? "none"}`);

    // 2. Rate limit — only for normal v3 APPEND (guards against the cron firing
    //    the same month twice). Migration/first-gen intentionally create a fresh
    //    v3 program + fresh eval, so they skip this.
    if (mode === "append") {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { count: recentEvalCount } = await supa
        .from("profile_evaluations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", thirtyDaysAgo.toISOString());

      if ((recentEvalCount ?? 0) > 0) {
        const { data: latestEval } = await supa
          .from("profile_evaluations")
          .select("month_number")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestEval && latestEval.month_number >= targetMonth) {
          return new Response(
            JSON.stringify({ error: "Evaluation already generated for this month" }),
            { status: 429, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // 3. Run profile analysis with month context.
    //    Continuation/migration evals are created visible=false (month >= 2) and
    //    flipped visible by generate-program-v3 on success.
    const evalUrl = `${SUPABASE_URL}/functions/v1/profile-analysis`;
    const evalResp = await fetch(evalUrl, {
      method: "POST",
      headers: subHeaders(),
      body: JSON.stringify({
        month_number: targetMonth,
        program_id: appendToProgramId,
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
    console.log(`[generate-next-month] Profile evaluation kicked off (month ${targetMonth}, id ${evaluationId})`);

    // profile-analysis is an async job. Poll the row DIRECTLY via the service
    // client (not profile-analysis-status, which only accepts user tokens) — the
    // rest of the pipeline expects a completed analysis before generation runs.
    if (evaluationId) {
      const maxWaitMs = 3 * 60 * 1000;
      const pollMs = 4000;
      const startWait = Date.now();
      let done = false;
      while (Date.now() - startWait < maxWaitMs) {
        await new Promise((r) => setTimeout(r, pollMs));
        const { data: s } = await supa
          .from("profile_evaluations")
          .select("status, error")
          .eq("id", evaluationId)
          .maybeSingle();
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

    // 4. Run training and nutrition analysis in parallel (best-effort).
    const analysisBody = JSON.stringify({ month_number: targetMonth, program_id: appendToProgramId });
    const [trainingResult, nutritionResult] = await Promise.allSettled([
      fetch(`${SUPABASE_URL}/functions/v1/training-analysis`, {
        method: "POST",
        headers: subHeaders(),
        body: analysisBody,
      }).then(r => r.json()),
      fetch(`${SUPABASE_URL}/functions/v1/nutrition-analysis`, {
        method: "POST",
        headers: subHeaders(),
        body: analysisBody,
      }).then(r => r.json()),
    ]);

    const trainingOk = trainingResult.status === "fulfilled" && trainingResult.value?.analysis;
    const nutritionOk = nutritionResult.status === "fulfilled" && nutritionResult.value?.analysis;
    console.log(`[generate-next-month] Training: ${trainingOk ? 'saved' : 'none'}, Nutrition: ${nutritionOk ? 'saved' : 'none'}`);

    // 5. Trigger program generation (v3) with month context.
    //    generate-program-v3 appends the month and, on completion, flips this
    //    month's evaluations visible=true. It reads the just-completed profile
    //    evaluation (and training evaluation) itself from the DB — no
    //    evaluation_id needed. When we're a server-to-server caller (cron /
    //    webhook) we authenticate with the service key + x-webhook-user-id;
    //    a frontend caller passes its own user token.
    //    A non-null program_id appends (v3 continuation); a null program_id makes
    //    a NEW v3 program at month_number (v1→v3 migration at N+1, or first-gen).
    const genUrl = `${SUPABASE_URL}/functions/v1/generate-program-v3`;
    const genResp = await fetch(genUrl, {
      method: "POST",
      headers: subHeaders(),
      body: JSON.stringify({
        month_number: targetMonth,
        ...(appendToProgramId ? { program_id: appendToProgramId } : {}),
      }),
    });

    if (!genResp.ok) {
      const err = await genResp.json().catch(() => ({}));
      console.error("[generate-next-month] Program generation failed:", err);
      // Clean up ALL of this month's evaluations (profile + training + nutrition,
      // all written above) so a retry doesn't leave orphans, create duplicates,
      // or trip the rate-limit on a phantom prior eval. Guarded on a defined
      // evaluationId (an undefined .eq("id", undefined) is a malformed delete).
      if (evaluationId) {
        await supa.from("profile_evaluations").delete().eq("id", evaluationId).then(() => {}, () => {});
      }
      await Promise.allSettled([
        supa.from("training_evaluations").delete().eq("user_id", userId).eq("month_number", targetMonth),
        supa.from("nutrition_evaluations").delete().eq("user_id", userId).eq("month_number", targetMonth),
      ]);
      return new Response(
        JSON.stringify({ error: "Failed to start program generation" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const genData = await genResp.json();
    console.log(`[generate-next-month] Generation started, mode=${mode} month=${targetMonth}`);

    return new Response(
      JSON.stringify({
        job_id: genData.job_id,
        month_number: targetMonth,
        mode,
        evaluation_id: evaluationId,
      }),
      { status: 202, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    // Log the real error server-side; return a generic message (no internal
    // detail / stack leaked to the client).
    console.error("generate-next-month error:", e);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
