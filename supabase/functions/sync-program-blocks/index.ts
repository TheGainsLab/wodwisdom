/**
 * Sync program_workout_blocks for a program.
 * Deletes existing blocks and repopulates from workout_text.
 * Call after program_workouts are created/updated (e.g. from ProgramEditPage).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractBlocksFromWorkoutText } from "../_shared/parse-workout-blocks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { program_id } = await req.json().catch(() => ({}));
    if (!program_id) {
      return new Response(JSON.stringify({ error: "program_id required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: program, error: progErr } = await supa
      .from("programs")
      .select("id")
      .eq("id", program_id)
      .eq("user_id", user.id)
      .single();

    if (progErr || !program) {
      return new Response(JSON.stringify({ error: "Program not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: workouts, error: wErr } = await supa
      .from("program_workouts")
      .select("id, workout_text")
      .eq("program_id", program_id);

    if (wErr) {
      return new Response(JSON.stringify({ error: "Failed to fetch workouts" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const workoutIds = (workouts || []).map((w) => w.id);
    if (workoutIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, block_count: 0 }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { error: delErr } = await supa
      .from("program_workout_blocks")
      .delete()
      .in("program_workout_id", workoutIds);

    if (delErr) {
      return new Response(JSON.stringify({ error: "Failed to clear blocks" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const blockRows: { program_workout_id: string; block_type: string; block_order: number; block_text: string }[] = [];
    for (const w of workouts || []) {
      const blocks = extractBlocksFromWorkoutText(w.workout_text);
      for (const b of blocks) {
        blockRows.push({
          program_workout_id: w.id,
          block_type: b.block_type,
          block_order: b.block_order,
          block_text: b.block_text,
        });
      }
    }

    if (blockRows.length > 0) {
      const { error: insErr } = await supa.from("program_workout_blocks").insert(blockRows);
      if (insErr) {
        return new Response(JSON.stringify({ error: "Failed to insert blocks" }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, block_count: blockRows.length }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
