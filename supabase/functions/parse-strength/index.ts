/**
 * parse-strength: Parse a strength block text into individual structured movements.
 *
 * Input:  { block_text: string, block_id?: string }
 * Output: { movements: ParsedStrengthMovement[] }
 *
 * If block_id is provided, writes the result back to program_workout_blocks.parsed_tasks.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "../_shared/call-claude.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const SYSTEM_PROMPT = `You parse CrossFit/fitness strength block descriptions into individual movements.

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
- Use CANONICAL movement names. Normalize variations:
  - "Back Squat", "Back Squats", "BSQ" → "Back Squat"
  - "Deadlift", "Deadlifts", "DL" → "Deadlift"
  - "Bench Press", "Bench" → "Bench Press"
  - "Front Squat", "Front Squats", "FSQ" → "Front Squat"
  - "Strict Press", "Shoulder Press", "Press" → "Strict Press"
  - "Power Clean", "P. Clean", "PC" → "Power Clean"
  - Use title case for movement names.
- For sets×reps notation: "5×3" → sets: 5, reps: 3. "3x5" → sets: 3, reps: 5.
- For percentage prescriptions: "@80%" or "@ 80-85%" → percentage: 80 (use lowest value in range).
- For absolute weights: "225 lbs" or "(225/155)" → weight: 225, weight_unit: "lbs".
  - For slash notation like "225/155" (male/female), use the FIRST number as weight.
- For weight in parentheses after percentage like "@ 80% (315/225)" → percentage: 80, weight: 315.
- If both percentage and weight are present, include both.
- Put modifiers (tempo, pauses, deficit, from blocks, build to, etc.) in notes.
- Return ONE entry per unique movement.
- Do NOT include rest periods, coaching cues, or warm-up instructions as movements.
- Output valid JSON only, no markdown fences.`;

interface ParsedStrengthMovement {
  movement: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  weight_unit: "lbs" | "kg" | null;
  percentage: number | null;
  notes: string | null;
}

const VALID_WEIGHT_UNITS = ["lbs", "kg"];

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

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");

    // Allow service-role calls (from preprocess-program) without user validation
    if (token !== SUPABASE_SERVICE_KEY) {
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
    }

    const { block_text, block_id } = await req.json();

    if (!block_text || typeof block_text !== "string") {
      return new Response(
        JSON.stringify({ error: "block_text is required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY,
      system: SYSTEM_PROMPT,
      userContent: block_text,
      maxTokens: 1024,
    });

    // Parse and validate
    let movements: ParsedStrengthMovement[];
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      movements = JSON.parse(cleaned);
      if (!Array.isArray(movements)) throw new Error("Expected array");
    } catch {
      console.error("Failed to parse Claude response:", raw);
      return new Response(
        JSON.stringify({ error: "Failed to parse movements", raw }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Normalize and validate
    movements = movements
      .filter((m) => m.movement && typeof m.movement === "string")
      .map((m) => ({
        movement: m.movement.trim(),
        sets: typeof m.sets === "number" ? m.sets : null,
        reps: typeof m.reps === "number" ? m.reps : null,
        weight: typeof m.weight === "number" ? m.weight : null,
        weight_unit: typeof m.weight_unit === "string" && VALID_WEIGHT_UNITS.includes(m.weight_unit) ? m.weight_unit as "lbs" | "kg" : null,
        percentage: typeof m.percentage === "number" ? m.percentage : null,
        notes: typeof m.notes === "string" && m.notes.trim() ? m.notes.trim() : null,
      }));

    // Deduplicate: one row per unique movement
    const seen = new Map<string, number>();
    const deduped: typeof movements = [];
    for (const m of movements) {
      const key = m.movement.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, deduped.length);
        deduped.push({ ...m });
      }
    }
    movements = deduped;

    // Write back to DB if block_id provided
    if (block_id) {
      const { error: updateErr } = await supa
        .from("program_workout_blocks")
        .update({ parsed_tasks: movements })
        .eq("id", block_id);

      if (updateErr) {
        console.error("Failed to write parsed_tasks:", updateErr);
      }
    }

    return new Response(JSON.stringify({ movements }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-strength error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
