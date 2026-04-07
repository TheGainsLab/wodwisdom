/**
 * Mark an in-progress workout as completed.
 * Flips workout_logs.status from 'in_progress' to 'completed'.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface CompleteBody {
  log_id: string;
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

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
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

    const body = (await req.json()) as CompleteBody;
    if (!body.log_id) {
      return new Response(JSON.stringify({ error: "Missing log_id" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: log, error: fetchErr } = await supa
      .from("workout_logs")
      .select("id, status")
      .eq("id", body.log_id)
      .eq("user_id", user.id)
      .single();

    if (fetchErr || !log) {
      return new Response(JSON.stringify({ error: "Workout not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (log.status === "completed") {
      return new Response(
        JSON.stringify({ id: log.id, status: "completed" }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const { error: updErr } = await supa
      .from("workout_logs")
      .update({ status: "completed" })
      .eq("id", body.log_id)
      .eq("user_id", user.id);

    if (updErr) {
      console.error("complete-workout update error:", updErr);
      return new Response(
        JSON.stringify({ error: "Failed to complete workout" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ id: body.log_id, status: "completed" }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("complete-workout error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
