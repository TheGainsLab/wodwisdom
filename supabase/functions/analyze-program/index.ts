import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeWorkouts, DEFAULT_MOVEMENT_ALIASES, type MovementsContext, type WorkoutInput } from "../_shared/analyzer.ts";

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

    let movementsContext: MovementsContext | undefined;
    const { data: movementsRows } = await supa
      .from("movements")
      .select("canonical_name, display_name, modality, category, aliases, competition_count");
    if (movementsRows && movementsRows.length > 0) {
      const library: Record<string, { modality: "W" | "G" | "M"; category: string }> = {};
      const aliases: Record<string, string> = {};
      const essentialCanonicals = new Set<string>();
      for (const row of movementsRows as { canonical_name: string; display_name: string; modality: string; category: string; aliases: string[]; competition_count: number }[]) {
        const c = row.canonical_name;
        library[c] = {
          modality: row.modality as "W" | "G" | "M",
          category: row.category,
        };
        if (row.competition_count > 0) essentialCanonicals.add(c);
        const a = Array.isArray(row.aliases) ? row.aliases : [];
        for (const al of a) {
          if (al && typeof al === "string") aliases[al.toLowerCase().trim()] = c;
        }
        const displaySpaced = row.display_name?.replace(/_/g, " ").toLowerCase();
        if (displaySpaced && displaySpaced !== c) aliases[displaySpaced] = c;
      }
      for (const [alias, canonical] of Object.entries(DEFAULT_MOVEMENT_ALIASES)) {
        if (library[canonical] && !aliases[alias]) aliases[alias] = canonical;
      }
      movementsContext = { library, aliases, essentialCanonicals };
    }

    const analysis = analyzeWorkouts(workouts as WorkoutInput[], movementsContext);

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
