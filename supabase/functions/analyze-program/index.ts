/**
 * analyze-program edge function
 * Orchestrates: AI extraction → deterministic counting → AI notices → upsert
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractMovementsAI } from "../_shared/extract-movements-ai.ts";
import { analyzeWorkouts } from "../_shared/analyzer.ts";
import { generateNoticesAI } from "../_shared/generate-notices-ai.ts";
import {
  buildMovementsContext,
  buildLibraryEntries,
  type MovementsRow,
} from "../_shared/build-movements-context.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);

    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { program_id } = await req.json();

    if (!program_id) {
      return new Response(
        JSON.stringify({ error: "program_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: program, error: pErr } = await supa
      .from("programs")
      .select("id, user_id")
      .eq("id", program_id)
      .single();

    if (pErr || !program || program.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Program not found or not authorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: workouts, error: wErr } = await supa
      .from("program_workouts")
      .select("id, week_num, day_num, workout_text, sort_order")
      .eq("program_id", program_id)
      .order("sort_order");

    if (wErr || !workouts?.length) {
      return new Response(
        JSON.stringify({ error: "No workouts found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: movementsData } = await supa
      .from("movements")
      .select("canonical_name, display_name, modality, category, aliases, competition_count");

    const rows: MovementsRow[] = (movementsData || []) as MovementsRow[];
    const movementsContext = rows.length > 0 ? buildMovementsContext(rows) : undefined;
    const libraryEntries = rows.length > 0 ? buildLibraryEntries(rows) : [];

    let analysis;
    let extractionNotices: string[] = [];

    if (libraryEntries.length > 0 && ANTHROPIC_API_KEY) {
      const extractionResult = await extractMovementsAI(
        workouts.map((w) => ({ id: w.id, workout_text: w.workout_text })),
        libraryEntries,
        ANTHROPIC_API_KEY
      );

      if (extractionResult) {
        extractionNotices = extractionResult.notices;
        analysis = analyzeWorkouts(workouts, movementsContext, extractionResult.movements);
      } else {
        console.warn("AI extraction failed, falling back to regex");
        extractionNotices = ["Movement extraction used fallback method. Some movements may be missed."];
        analysis = analyzeWorkouts(workouts, movementsContext);
      }
    } else {
      analysis = analyzeWorkouts(workouts, movementsContext);
    }

    if (ANTHROPIC_API_KEY) {
      const notices = await generateNoticesAI(analysis, ANTHROPIC_API_KEY);
      analysis.notices = [...extractionNotices, ...analysis.notices, ...notices];
    } else {
      analysis.notices = [...extractionNotices, ...analysis.notices];
    }

    const { error: upsertErr } = await supa
      .from("program_analyses")
      .upsert(
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
      return new Response(
        JSON.stringify({ error: "Failed to save analysis" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ analysis }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("analyze-program error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
