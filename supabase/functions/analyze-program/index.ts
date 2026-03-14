/**
 * analyze-program edge function
 * Orchestrates: populate parsed_tasks if needed → block-level analysis → AI notices → upsert
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeBlocks, type BlockInput } from "../_shared/analyzer.ts";
import { generateNoticesAI } from "../_shared/generate-notices-ai.ts";
import { callClaude } from "../_shared/call-claude.ts";
import {
  buildMovementsContext,
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

// ─── Block parsing prompts (same as preprocess-program) ──────────────────────

const METCON_PROMPT = `You parse CrossFit/fitness metcon (metabolic conditioning) workout descriptions into individual movements.
Return ONLY a JSON array. Each element:
{
  "movement": "Clean, canonical movement name",
  "category": "weighted" | "bodyweight" | "monostructural",
  "reps": <number or null>,
  "weight": <number or null>,
  "weight_unit": "lbs" | "kg" | null,
  "distance": <number or null>,
  "distance_unit": "m" | "ft" | "cal" | null
}
Rules:
- Extract each distinct movement from the workout description.
- Use CANONICAL movement names (title case with hyphens for compound names).
- Category: "weighted" = external load, "bodyweight" = bodyweight only, "monostructural" = cardio/engine.
- For distance-based movements (500m Row, 400m Run), set distance + distance_unit, reps = null.
- For calorie-based cardio (30 Cal Row), set reps = 30, distance = null, distance_unit = "cal".
- For weighted movements, extract the Rx weight (first number in slash notation like 95/65 → 95).
- Return ONE entry per unique movement, not one per round.
- Always report reps PER ROUND, never totaled across rounds.
- For rep-scheme workouts (21-15-9), report reps as the FIRST round only.
- For rounds-based workouts (5 RFT), report PER-ROUND reps.
- For AMRAP workouts, report reps PER ROUND.
- Strip format headers. Do NOT include rest periods or coaching cues.
- Output valid JSON only, no markdown fences.`;

const SKILLS_PROMPT = `You parse CrossFit/fitness skill block descriptions into individual movements.
Return ONLY a JSON array. Each element:
{
  "movement": "Clean, capitalized movement name",
  "sets": <number or null>,
  "reps": <number or null>,
  "hold_seconds": <number or null>,
  "notes": "<any modifier like 'from 10ft', 'deficit', 'strict', etc. or null>"
}
Rules:
- Split compound entries (joined by +, &, commas, newlines) into SEPARATE objects.
- "4x5 Kipping Pull-Ups" → sets: 4, reps: 5.
- "3 legless rope climb descents from 10ft" → sets: null, reps: 3, notes: "from 10ft".
- ":30 L-sit hold" → hold_seconds: 30, sets: null, reps: null.
- Strip structure headers (EMOM, rounds, "for quality", minute markers).
- Do NOT include rest periods, coaching cues, or tempo prescriptions as separate movements.
- Output valid JSON only, no markdown fences.`;

const STRENGTH_PROMPT = `You parse CrossFit/fitness strength block descriptions into individual movements.
Return ONLY a JSON array. Each element:
{
  "movement": "Clean, canonical movement name",
  "sets": <number or null>,
  "reps": <number or null>,
  "weight": <number or null>,
  "weight_unit": "lbs" | "kg" | null,
  "percentage": <number or null>,
  "notes": "<any modifier like 'tempo 3010', 'from blocks', 'paused', etc. or null>"
}
Rules:
- Extract each distinct movement from the strength block.
- Use CANONICAL movement names (title case).
- For sets×reps: "5×3" → sets: 5, reps: 3.
- For percentage: "@80%" or "@ 80-85%" → percentage: 80 (lowest value in range).
- For absolute weights: "225 lbs" or "(225/155)" → weight: 225, weight_unit: "lbs" (first number in slash).
- If both percentage and weight are present, include both.
- Put modifiers (tempo, pauses, deficit, from blocks, build to) in notes.
- Return ONE entry per unique movement.
- Do NOT include rest periods, coaching cues, or warm-up instructions.
- Output valid JSON only, no markdown fences.`;

const BLOCK_PROMPTS: Record<string, string> = {
  metcon: METCON_PROMPT,
  skills: SKILLS_PROMPT,
  strength: STRENGTH_PROMPT,
};

const VALID_CATEGORIES = ["weighted", "bodyweight", "monostructural"];
const VALID_WEIGHT_UNITS = ["lbs", "kg"];
const VALID_DISTANCE_UNITS = ["m", "ft", "cal"];

/** Parse a batch of block texts for one block type. Returns array of parsed results aligned to input. */
async function parseBatchedBlocks(
  blockType: string,
  blockTexts: string[],
  apiKey: string,
): Promise<(Record<string, unknown>[] | null)[]> {
  const prompt = BLOCK_PROMPTS[blockType];
  if (!prompt) return blockTexts.map(() => null);

  // Combine all blocks into one prompt with numbered markers
  const combined = blockTexts
    .map((text, i) => `--- BLOCK ${i + 1} ---\n${text}`)
    .join("\n\n");

  const systemPrompt = `${prompt}

IMPORTANT: You are given multiple blocks separated by "--- BLOCK N ---" markers.
Return a JSON object where keys are block numbers (as strings) and values are the arrays for each block.
Example: {"1": [...], "2": [...], "3": [...]}
Output valid JSON only, no markdown fences.`;

  const raw = await callClaude({
    apiKey,
    system: systemPrompt,
    userContent: combined,
    maxTokens: 4096,
  });

  const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) return blockTexts.map(() => null);

    return blockTexts.map((_, i) => {
      const key = String(i + 1);
      const items = parsed[key];
      if (!Array.isArray(items)) return null;

      // Filter and normalize
      let filtered = items.filter(
        (m: Record<string, unknown>) => m.movement && typeof m.movement === "string"
      );

      if (blockType === "metcon") {
        filtered = filtered.map((m: Record<string, unknown>) => ({
          movement: (m.movement as string).trim(),
          category: VALID_CATEGORIES.includes(m.category as string) ? m.category : "bodyweight",
          reps: typeof m.reps === "number" ? m.reps : null,
          weight: typeof m.weight === "number" ? m.weight : null,
          weight_unit: typeof m.weight_unit === "string" && VALID_WEIGHT_UNITS.includes(m.weight_unit) ? m.weight_unit : null,
          distance: typeof m.distance === "number" ? m.distance : null,
          distance_unit: typeof m.distance_unit === "string" && VALID_DISTANCE_UNITS.includes(m.distance_unit) ? m.distance_unit : null,
        }));
      } else if (blockType === "skills") {
        filtered = filtered.map((m: Record<string, unknown>) => ({
          movement: (m.movement as string).trim(),
          sets: typeof m.sets === "number" ? m.sets : null,
          reps: typeof m.reps === "number" ? m.reps : null,
          hold_seconds: typeof m.hold_seconds === "number" ? m.hold_seconds : null,
          notes: typeof m.notes === "string" && (m.notes as string).trim() ? (m.notes as string).trim() : null,
        }));
      } else {
        // strength
        filtered = filtered.map((m: Record<string, unknown>) => ({
          movement: (m.movement as string).trim(),
          sets: typeof m.sets === "number" ? m.sets : null,
          reps: typeof m.reps === "number" ? m.reps : null,
          weight: typeof m.weight === "number" ? m.weight : null,
          weight_unit: typeof m.weight_unit === "string" && VALID_WEIGHT_UNITS.includes(m.weight_unit as string) ? m.weight_unit : null,
          percentage: typeof m.percentage === "number" ? m.percentage : null,
          notes: typeof m.notes === "string" && (m.notes as string).trim() ? (m.notes as string).trim() : null,
        }));
      }

      // Deduplicate by movement name
      const seen = new Set<string>();
      const deduped: typeof filtered = [];
      for (const m of filtered) {
        const key = (m.movement as string).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(m);
        }
      }

      return deduped;
    });
  } catch (e) {
    console.error(`[analyze-program] parseBatchedBlocks ${blockType} parse error:`, e);
    return blockTexts.map(() => null);
  }
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

    // Fetch workouts (for sort_order/week/day) and movements in parallel
    const [workoutsResult, movementsResult] = await Promise.all([
      supa
        .from("program_workouts")
        .select("id, week_num, day_num, sort_order")
        .eq("program_id", program_id)
        .order("sort_order"),
      supa
        .from("movements")
        .select("canonical_name, display_name, modality, category, aliases, competition_count"),
    ]);

    const { data: workouts, error: wErr } = workoutsResult;
    const { data: movementsData } = movementsResult;

    if (wErr || !workouts?.length) {
      return new Response(
        JSON.stringify({ error: "No workouts found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch blocks for these workouts
    const workoutIds = workouts.map((w: { id: string }) => w.id);
    const { data: blocks, error: bErr } = await supa
      .from("program_workout_blocks")
      .select("id, program_workout_id, block_type, block_order, block_text, parsed_tasks")
      .in("program_workout_id", workoutIds)
      .order("block_order");

    if (bErr || !blocks?.length) {
      return new Response(
        JSON.stringify({ error: "No workout blocks found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rows: MovementsRow[] = (movementsData || []) as MovementsRow[];
    const movementsContext = buildMovementsContext(rows);

    // ─── Populate parsed_tasks if NULL ───────────────────────────────────
    const PARSEABLE_TYPES = ["metcon", "skills", "strength"];
    const unparsedBlocks = blocks.filter(
      (b) => PARSEABLE_TYPES.includes(b.block_type) && b.parsed_tasks == null
    );

    if (unparsedBlocks.length > 0 && ANTHROPIC_API_KEY) {
      // Group by block type
      const byType = new Map<string, typeof unparsedBlocks>();
      for (const b of unparsedBlocks) {
        const group = byType.get(b.block_type) ?? [];
        group.push(b);
        byType.set(b.block_type, group);
      }

      // Parse all types in parallel (3 calls max)
      const parsePromises = [...byType.entries()].map(async ([blockType, typeBlocks]) => {
        const texts = typeBlocks.map((b) => b.block_text);
        const results = await parseBatchedBlocks(blockType, texts, ANTHROPIC_API_KEY);

        // Write results back to DB and update local block objects
        for (let i = 0; i < typeBlocks.length; i++) {
          const parsed = results[i];
          if (parsed) {
            typeBlocks[i].parsed_tasks = parsed;
            await supa
              .from("program_workout_blocks")
              .update({ parsed_tasks: parsed })
              .eq("id", typeBlocks[i].id);
          }
        }
      });

      await Promise.all(parsePromises);
    }

    // ─── Build BlockInput array for analyzer ─────────────────────────────
    const workoutLookup = new Map(
      workouts.map((w: { id: string; sort_order: number; week_num: number; day_num: number }) => [
        w.id,
        { sort_order: w.sort_order, week_num: w.week_num, day_num: w.day_num },
      ])
    );

    const blockInputs: BlockInput[] = blocks.map((b) => {
      const parent = workoutLookup.get(b.program_workout_id);
      return {
        block_type: b.block_type,
        block_text: b.block_text,
        parsed_tasks: b.parsed_tasks as Record<string, unknown>[] | null,
        sort_order: parent?.sort_order ?? 0,
        week_num: parent?.week_num,
        day_num: parent?.day_num,
      };
    });

    // ─── Run block-level analysis ────────────────────────────────────────
    const analysis = analyzeBlocks(blockInputs, movementsContext);

    // ─── AI notices ──────────────────────────────────────────────────────
    if (ANTHROPIC_API_KEY) {
      const notices = await generateNoticesAI(analysis, ANTHROPIC_API_KEY);
      analysis.notices = [...analysis.notices, ...notices];
    }

    // ─── Upsert results ──────────────────────────────────────────────────
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
