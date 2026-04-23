/**
 * profile-analysis-status — lightweight poller for the async
 * profile-analysis job.
 *
 * Input:  { evaluation_id: string }
 * Output: { status, analysis?, evaluation_id, error?, created_at, ready_at }
 *
 * The client polls this after kicking off profile-analysis. Each poll
 * is a small, fast request iOS Safari is happy to complete even when
 * the device locks or the tab backgrounds. The heavy work happens
 * in the background inside profile-analysis's EdgeRuntime.waitUntil
 * task and updates the row when done.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
    const evaluationId = body?.evaluation_id;

    if (!evaluationId || typeof evaluationId !== "string") {
      return new Response(
        JSON.stringify({ error: "evaluation_id is required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Scope to the requesting user's own evaluations. If the id belongs
    // to someone else, return 404 rather than leaking existence.
    const { data: row, error } = await supa
      .from("profile_evaluations")
      .select("id, status, analysis, error, created_at, ready_at")
      .eq("id", evaluationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !row) {
      return new Response(
        JSON.stringify({ error: "Evaluation not found" }),
        { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        evaluation_id: row.id,
        status: row.status,
        analysis: row.analysis ?? null,
        error: row.error ?? null,
        created_at: row.created_at,
        ready_at: row.ready_at,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
