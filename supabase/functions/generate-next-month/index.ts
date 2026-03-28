/**
 * Generate next month of a program.
 * Orchestrates: profile evaluation → program generation → atomic delivery.
 *
 * Input: { program_id: string }
 * Flow:
 *   1. Look up the program and determine the next month number
 *   2. Run profile-analysis with month context (eval saved as invisible)
 *   3. Trigger generate-program with month_number + program_id (appends workouts, makes eval visible)
 *   4. Return job_id for polling
 *
 * This will be triggered by payment webhooks in the future.
 * For now, it can be called manually for testing.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
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
    const programId: string | null = body?.program_id ?? null;

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
      .eq("user_id", user.id)
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
    console.log(`[generate-next-month] Program ${programId}: current months=${program.generated_months}, generating month ${nextMonth}`);

    // 2. Check rate limit — one evaluation per month
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { count: recentEvalCount } = await supa
      .from("profile_evaluations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", thirtyDaysAgo.toISOString());

    if ((recentEvalCount ?? 0) > 0) {
      // Check if the most recent eval is for the current month already
      const { data: latestEval } = await supa
        .from("profile_evaluations")
        .select("month_number")
        .eq("user_id", user.id)
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
        Authorization: `Bearer ${token}`,
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
    console.log(`[generate-next-month] Evaluation created: ${evaluationId} (month ${nextMonth}, visible=false)`);

    // 4. Trigger program generation with month context
    //    This will append 20 workouts and make the evaluation visible on completion
    const genUrl = `${SUPABASE_URL}/functions/v1/generate-program`;
    const genResp = await fetch(genUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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
    console.log(`[generate-next-month] Generation started: job_id=${genData.job_id}, month=${nextMonth}`);

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
