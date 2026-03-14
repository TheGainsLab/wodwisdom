/**
 * analyze-program edge function
 * Orchestrates: block-level extraction → deterministic counting → AI notices → upsert
 *
 * Uses program_workout_blocks (strength/metcon/skills) instead of workout_text.
 * Blocks with pre-parsed parsed_tasks skip AI extraction entirely.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeWorkouts, type ExtractedMovementForAnalysis } from "../_shared/analyzer.ts";
import { generateNoticesAI } from "../_shared/generate-notices-ai.ts";
import {
  buildMovementsContext,
  buildLibraryEntries,
  type MovementsRow,
} from "../_shared/build-movements-context.ts";
import type { LibraryEntry } from "../_shared/extract-movements-ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Block types relevant for analysis (excludes warm-up, cool-down, other) */
const ANALYSIS_BLOCK_TYPES = ["strength", "metcon", "skills"];

interface BlockRow {
  id: string;
  program_workout_id: string;
  block_type: string;
  block_order: number;
  block_text: string;
  parsed_tasks: unknown[] | null;
}

/**
 * Resolve the acting user ID.
 * If the bearer token is the service-role key AND user_id is in the body, trust it
 * (internal service-to-service call). Otherwise validate the JWT as a normal user token.
 */
async function resolveUserId(
  authHeader: string,
  body: Record<string, unknown>,
  supa: ReturnType<typeof createClient>
): Promise<{ userId: string; error?: never } | { userId?: never; error: string }> {
  const token = authHeader.replace("Bearer ", "");
  if (token === SUPABASE_KEY && typeof body.user_id === "string" && body.user_id) {
    return { userId: body.user_id };
  }
  const { data: { user }, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !user) return { error: "Invalid token" };
  return { userId: user.id };
}

/**
 * Convert parsed_tasks from a metcon block into ExtractedMovementForAnalysis[].
 * Metcon parsed_tasks have: { movement, category, weight, weight_unit }
 */
function convertMetconTasks(
  tasks: Record<string, unknown>[],
  libraryEntries: LibraryEntry[]
): ExtractedMovementForAnalysis[] {
  const results: ExtractedMovementForAnalysis[] = [];
  for (const task of tasks) {
    const movementName = task.movement as string;
    if (!movementName) continue;

    const match = resolveToLibrary(movementName, libraryEntries);
    const canonical = match?.canonical_name ?? toSnakeCase(movementName);
    const modality = match?.modality ?? categoryToModality(task.category as string);

    let load = "BW";
    if (task.weight != null && typeof task.weight === "number" && task.weight > 0) {
      load = String(task.weight);
    }

    results.push({ canonical, modality, load, block_type: "metcon" });
  }
  return results;
}

/**
 * Convert parsed_tasks from a skills block into ExtractedMovementForAnalysis[].
 * Skills parsed_tasks have: { movement, sets, reps, hold_seconds, notes }
 */
function convertSkillsTasks(
  tasks: Record<string, unknown>[],
  libraryEntries: LibraryEntry[]
): ExtractedMovementForAnalysis[] {
  const results: ExtractedMovementForAnalysis[] = [];
  for (const task of tasks) {
    const movementName = task.movement as string;
    if (!movementName) continue;

    const match = resolveToLibrary(movementName, libraryEntries);
    const canonical = match?.canonical_name ?? toSnakeCase(movementName);
    const modality = match?.modality ?? "G";

    results.push({ canonical, modality, load: "BW", block_type: "skills" });
  }
  return results;
}

/**
 * Convert parsed_tasks from a strength block into ExtractedMovementForAnalysis[].
 * Strength parsed_tasks have: { movement, sets, reps, weight, weight_unit, percentage, notes }
 */
function convertStrengthTasks(
  tasks: Record<string, unknown>[],
  _blockText: string,
  libraryEntries: LibraryEntry[]
): ExtractedMovementForAnalysis[] {
  const results: ExtractedMovementForAnalysis[] = [];

  for (const task of tasks) {
    const movementName = task.movement as string;
    if (!movementName) continue;

    const match = resolveToLibrary(movementName, libraryEntries);
    const canonical = match?.canonical_name ?? toSnakeCase(movementName);
    const modality = match?.modality ?? "W";

    let load = "BW";
    const percentage = task.percentage as number | null;
    const weight = task.weight as number | null;

    if (percentage != null && percentage > 0) {
      load = `${percentage}%`;
    } else if (weight != null && weight > 0) {
      load = String(weight);
    }

    results.push({ canonical, modality, load, block_type: "strength" });
  }
  return results;
}

/** Map a display movement name to a library entry via display_name, canonical_name, or aliases. */
function resolveToLibrary(
  movementName: string,
  libraryEntries: LibraryEntry[]
): LibraryEntry | undefined {
  const lower = movementName.toLowerCase().trim();
  const snake = toSnakeCase(movementName);

  for (const entry of libraryEntries) {
    if (entry.canonical_name === snake) return entry;
    if (entry.display_name.toLowerCase() === lower) return entry;
    if (entry.aliases.some((a) => a.toLowerCase() === lower)) return entry;
  }
  return undefined;
}

function toSnakeCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function categoryToModality(category: string | undefined): string {
  if (category === "weighted") return "W";
  if (category === "monostructural") return "M";
  return "G";
}

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

    const body = await req.json();
    const resolved = await resolveUserId(authHeader, body, supa);

    if (resolved.error) {
      return new Response(
        JSON.stringify({ error: resolved.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = resolved.userId;
    const { program_id } = body;

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

    if (pErr || !program || program.user_id !== userId) {
      return new Response(
        JSON.stringify({ error: "Program not found or not authorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch workouts with their blocks (filtered to analysis-relevant types)
    const { data: workouts, error: wErr } = await supa
      .from("program_workouts")
      .select("id, week_num, day_num, sort_order, program_workout_blocks(id, program_workout_id, block_type, block_order, block_text, parsed_tasks)")
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

    // For each workout, separate blocks into pre-parsed and needs-AI
    // Also build workout_text from relevant block texts for format/time-domain detection
    const workoutsForAnalyzer: { week_num?: number; day_num?: number; workout_text: string; sort_order?: number; id?: string; metcon_text?: string; block_types?: string[] }[] = [];
    const preParsedByWorkout: ExtractedMovementForAnalysis[][] = [];

    for (const w of workouts) {
      const allBlocks: BlockRow[] = (
        (w.program_workout_blocks as BlockRow[] | null) ?? []
      ).sort((a, b) => a.block_order - b.block_order);

      const relevantBlocks = allBlocks.filter((b) =>
        ANALYSIS_BLOCK_TYPES.includes(b.block_type)
      );

      // Build workout_text from relevant block texts (for detectWorkoutFormat / inferTimeDomain)
      const workoutText = relevantBlocks.map((b) => b.block_text).join("\n");
      const metconBlocks = relevantBlocks.filter((b) => b.block_type === "metcon");
      const metconText = metconBlocks.map((b) => b.block_text).join("\n");
      const blockTypes = [...new Set(relevantBlocks.map((b) => b.block_type))];

      workoutsForAnalyzer.push({
        id: w.id,
        week_num: w.week_num,
        day_num: w.day_num,
        sort_order: w.sort_order,
        workout_text: workoutText,
        metcon_text: metconText || undefined,
        block_types: blockTypes,
      });

      // Convert all parsed blocks; unparsed blocks fall through to regex in analyzer
      const movements: ExtractedMovementForAnalysis[] = [];
      let hasUnparsed = false;

      for (const block of relevantBlocks) {
        if (Array.isArray(block.parsed_tasks) && block.parsed_tasks.length > 0) {
          const tasks = block.parsed_tasks as Record<string, unknown>[];
          if (block.block_type === "metcon") {
            movements.push(...convertMetconTasks(tasks, libraryEntries));
          } else if (block.block_type === "skills") {
            movements.push(...convertSkillsTasks(tasks, libraryEntries));
          } else if (block.block_type === "strength") {
            movements.push(...convertStrengthTasks(tasks, block.block_text, libraryEntries));
          }
        } else {
          hasUnparsed = true;
        }
      }

      if (hasUnparsed && movements.length === 0) {
        // No parsed data at all — let analyzer use regex fallback for this workout
        preParsedByWorkout.push(null as unknown as ExtractedMovementForAnalysis[]);
      } else {
        preParsedByWorkout.push(movements);
      }
    }

    // If any workouts have null (fully unparsed), pass undefined to let analyzer use regex
    const hasNulls = preParsedByWorkout.some((v) => v === null);
    const extractedArg = hasNulls ? undefined : preParsedByWorkout;

    const analysis = analyzeWorkouts(
      workoutsForAnalyzer,
      movementsContext,
      extractedArg
    );

    if (ANTHROPIC_API_KEY) {
      const notices = await generateNoticesAI(analysis, ANTHROPIC_API_KEY);
      analysis.notices = [...analysis.notices, ...notices];
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
