import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeWorkouts, type WorkoutInput } from "../_shared/analyzer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { program_id } = await req.json();
    if (!program_id) {
      return new Response(JSON.stringify({ error: "Missing program_id" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: prog, error: progErr } = await supa
      .from("programs")
      .select("id")
      .eq("id", program_id)
      .eq("user_id", user.id)
      .single();

    if (progErr || !prog) {
      return new Response(JSON.stringify({ error: "Program not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: workouts, error: wkErr } = await supa
      .from("program_workouts")
      .select("week_num, day_num, workout_text, sort_order")
      .eq("program_id", program_id)
      .order("sort_order");

    if (wkErr) {
      return new Response(JSON.stringify({ error: "Failed to load workouts" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!workouts || workouts.length === 0) {
      return new Response(JSON.stringify({ error: "No workouts in program" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const analysis = analyzeWorkouts(workouts as WorkoutInput[]);

    const { error: upsertErr } = await supa.from("program_analyses").upsert(
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "program_id" }
    );

    if (upsertErr) {
      console.error("Upsert error:", upsertErr);
      return new Response(JSON.stringify({ error: "Failed to save analysis" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ analysis }), {
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
