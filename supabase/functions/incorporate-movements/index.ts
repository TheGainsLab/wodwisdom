/**
 * incorporate-movements edge function
 * Orchestrates: RAG retrieval → Claude modifications → save → re-analysis
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  searchChunks,
  deduplicateChunks,
  formatChunksAsContext,
  type RAGChunk,
} from "../_shared/rag.ts";
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
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert CrossFit programming consultant. A coach has uploaded their training program and wants to incorporate specific movements that are currently missing.

Your job is to modify existing workouts to incorporate the requested movements. You have access to CrossFit methodology and strength science literature to guide your decisions.

Rules:
- Modify existing workouts only. Do not add new workouts.
- Preserve the original workout's intent (time domain, stimulus, format).
- You may substitute a movement, prepend a strength piece, or adjust a workout's structure.
- Consider recovery. Do not place heavy squats the day after heavy pulls. Do not repeat the same movement pattern on consecutive days.
- Progress loading across weeks when adding strength work (e.g., 75% → 78% → 80% → 82%).
- Distribute new movements across the cycle. Do not cluster them all in one week.
- If a movement cannot be incorporated without compromising the program, omit it and explain why in the rationale.
- Only modify workouts that need to change. If a workout is fine as-is, leave it out of the response.

Return JSON only. No preamble, no markdown, no explanation outside the JSON structure.

Format:
[
  {
    "workout_id": "uuid of the original workout",
    "week_num": 1,
    "day_num": 1,
    "original_text": "the original workout text",
    "modified_text": "the modified workout text",
    "change_summary": "short description e.g. Pushups → HSPU",
    "rationale": "1-2 sentences explaining why, referencing programming principles"
  }
]`;

interface SelectedMovement {
  canonical_name: string;
  display_name: string;
  modality: string;
  category?: string;
}

async function retrieveContext(
  supa: ReturnType<typeof createClient>,
  movements: SelectedMovement[]
): Promise<string> {
  const allChunks: RAGChunk[] = [];

  for (const m of movements) {
    const journalChunks = await searchChunks(
      supa,
      `programming ${m.display_name} in CrossFit training`,
      "journal",
      OPENAI_API_KEY,
      4
    );
    allChunks.push(...journalChunks);
  }

  const generalJournal = await searchChunks(
    supa,
    "CrossFit programming principles workout variety modal balance",
    "journal",
    OPENAI_API_KEY,
    4
  );
  allChunks.push(...generalJournal);

  const unique = deduplicateChunks(allChunks);
  return formatChunksAsContext(unique, 20);
}

interface Workout {
  id: string;
  week_num: number;
  day_num: number;
  workout_text: string;
  sort_order?: number;
}

interface Modification {
  workout_id: string;
  week_num: number;
  day_num: number;
  original_text: string;
  modified_text: string;
  change_summary: string;
  rationale: string;
}

async function callClaude(
  workouts: Workout[],
  movements: SelectedMovement[],
  context: string
): Promise<Modification[]> {
  const userPrompt = `## Program
${JSON.stringify(
  workouts.map((w) => ({
    id: w.id,
    week_num: w.week_num,
    day_num: w.day_num,
    workout_text: w.workout_text,
  }))
)}

## Movements to Incorporate
${JSON.stringify(
  movements.map((m) => ({
    canonical_name: m.canonical_name,
    display_name: m.display_name,
    modality: m.modality,
  }))
)}

## Programming Reference Material
${context}

Generate modifications to incorporate the requested movements into this program. Return JSON only.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      stream: false,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error("Claude API error:", err);
    throw new Error("Claude API call failed");
  }

  const data = await resp.json();
  const rawText =
    data.content?.[0]?.text?.trim() ||
    data.content?.[0]?.input?.trim() ||
    "";

  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
  const parsed = JSON.parse(jsonStr);

  if (!Array.isArray(parsed)) throw new Error("Response is not an array");

  return parsed as Modification[];
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

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);

    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { program_id, selected_movements } = await req.json();

    if (!program_id || !selected_movements?.length) {
      return new Response(
        JSON.stringify({
          error: "program_id and selected_movements required",
        }),
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
      .order("week_num")
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

    const selectedMovementDetails: SelectedMovement[] = rows
      .filter((m) => selected_movements.includes(m.canonical_name))
      .map((m) => ({
        canonical_name: m.canonical_name,
        display_name: m.display_name,
        modality: m.modality,
        category: m.category,
      }));

    if (selectedMovementDetails.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid movements found for selected_movements" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const context = await retrieveContext(supa, selectedMovementDetails);

    const modifications = await callClaude(
      workouts as Workout[],
      selectedMovementDetails,
      context
    );

    const { data: modRecord, error: modErr } = await supa
      .from("program_modifications")
      .insert({
        program_id,
        selected_movements: selected_movements,
        status: "draft",
      })
      .select("id")
      .single();

    if (modErr || !modRecord) {
      throw new Error("Failed to create modification record");
    }

    const workoutById = new Map<string, Workout>();
    for (const w of workouts as Workout[]) {
      workoutById.set(w.id, w);
    }

    const modifiedRows = modifications
      .filter((m) => workoutById.has(m.workout_id))
      .map((m) => ({
        modification_id: modRecord.id,
        original_workout_id: m.workout_id,
        modified_text: m.modified_text,
        change_summary: m.change_summary,
        rationale: m.rationale,
        status: "pending" as const,
      }));

    if (modifiedRows.length > 0) {
      const { error: insertErr } = await supa
        .from("modified_workouts")
        .insert(modifiedRows);

      if (insertErr) {
        throw new Error("Failed to insert modified workouts");
      }
    }

    const hypothetical: Workout[] = workouts.map((w) => {
      const mod = modifications.find((m) => m.workout_id === w.id);
      return {
        ...w,
        workout_text: mod ? mod.modified_text : w.workout_text,
      };
    });

    let modifiedAnalysis;

    if (libraryEntries.length > 0 && ANTHROPIC_API_KEY) {
      const extractionResult = await extractMovementsAI(
        hypothetical.map((w) => ({ id: w.id, workout_text: w.workout_text })),
        libraryEntries,
        ANTHROPIC_API_KEY
      );

      if (extractionResult) {
        const analysis = analyzeWorkouts(
          hypothetical,
          movementsContext,
          extractionResult.movements
        );
        const notices = await generateNoticesAI(analysis, ANTHROPIC_API_KEY);
        analysis.notices = [...extractionResult.notices, ...notices];
        modifiedAnalysis = analysis;
      } else {
        console.warn("AI extraction failed for hypothetical, falling back to regex");
        const analysis = analyzeWorkouts(hypothetical, movementsContext);
        const notices = await generateNoticesAI(analysis, ANTHROPIC_API_KEY);
        analysis.notices = [
          "Modified program analysis used fallback extraction. Some movements may be missed.",
          ...analysis.notices,
          ...notices,
        ];
        modifiedAnalysis = analysis;
      }
    } else {
      const analysis = analyzeWorkouts(hypothetical, movementsContext);
      if (ANTHROPIC_API_KEY) {
        const notices = await generateNoticesAI(analysis, ANTHROPIC_API_KEY);
        analysis.notices = [...analysis.notices, ...notices];
      }
      modifiedAnalysis = analysis;
    }

    await supa
      .from("program_modifications")
      .update({
        modified_analysis: modifiedAnalysis,
        status: "reviewing",
      })
      .eq("id", modRecord.id);

    return new Response(
      JSON.stringify({
        modification_id: modRecord.id,
        modifications,
        modified_analysis: modifiedAnalysis,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("incorporate-movements error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
