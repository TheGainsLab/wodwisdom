/**
 * parse-metcon: Parse a metcon block text into individual structured movements.
 *
 * Input:  { block_text: string, block_id?: string }
 * Output: { movements: ParsedMetconMovement[] }
 *
 * If block_id is provided, writes the result back to program_workout_blocks.parsed_tasks.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "../_shared/call-claude.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You parse CrossFit/fitness metcon (metabolic conditioning) workout descriptions into individual movements.

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
- Use CANONICAL movement names. Normalize variations:
  - "Toes To Bar", "Toes-To-Bar", "T2B", "TTB" → "Toes-to-Bar"
  - "Pull Up", "Pull-Up", "Pullup" → "Pull-Up"
  - "Box Jump", "Box Jumps" → "Box Jump"
  - "HSPU", "Handstand Push-Up", "Handstand Push Up" → "Handstand Push-Up"
  - "GHD Sit-Up", "GHD Sit Up" → "GHD Sit-Up"
  - "Muscle Up", "Muscle-Up", "MU" → "Muscle-Up"
  - "KB Swing", "Kettlebell Swing" → "KB Swing"
  - "DB Snatch", "Dumbbell Snatch" → "DB Snatch"
  - Use title case with hyphens for compound names.
- Category rules:
  - "weighted": movements using barbell, dumbbell, kettlebell, or external load (Thrusters, Deadlifts, Cleans, Snatches, Wall Ball, KB Swing, etc.)
  - "bodyweight": movements using only bodyweight (Pull-Up, Toes-to-Bar, Muscle-Up, Burpee, Air Squat, Pistol, HSPU, etc.)
  - "monostructural": cardio/engine movements (Row, Bike, Run, Ski, Swim, Jump Rope, Double-Under, etc.)
- For monostructural movements with distance (500m Row, 400m Run), set distance + distance_unit, reps = null.
- For calorie-based cardio (30 Cal Row), set reps = 30, distance = null, distance_unit = "cal".
- For weighted movements, extract the Rx weight (first number in slash notation like 95/65 → 95).
- Reps should be PER ROUND, not total. For "5 RFT: 15 Thrusters" → reps: 15.
- Strip format headers (AMRAP, RFT, EMOM, For Time, round counts, time caps) — they are not movements.
- Do NOT include rest periods, transitions, or coaching cues as movements.
- Output valid JSON only, no markdown fences.`;

interface ParsedMetconMovement {
  movement: string;
  category: "weighted" | "bodyweight" | "monostructural";
  reps: number | null;
  weight: number | null;
  weight_unit: "lbs" | "kg" | null;
  distance: number | null;
  distance_unit: "m" | "ft" | "cal" | null;
}

const VALID_CATEGORIES = ["weighted", "bodyweight", "monostructural"];
const VALID_WEIGHT_UNITS = ["lbs", "kg"];
const VALID_DISTANCE_UNITS = ["m", "ft", "cal"];

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

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
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
    let movements: ParsedMetconMovement[];
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
        category: VALID_CATEGORIES.includes(m.category) ? m.category : "bodyweight",
        reps: typeof m.reps === "number" ? m.reps : null,
        weight: typeof m.weight === "number" ? m.weight : null,
        weight_unit: typeof m.weight_unit === "string" && VALID_WEIGHT_UNITS.includes(m.weight_unit) ? m.weight_unit : null,
        distance: typeof m.distance === "number" ? m.distance : null,
        distance_unit: typeof m.distance_unit === "string" && VALID_DISTANCE_UNITS.includes(m.distance_unit) ? m.distance_unit : null,
      }));

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
    console.error("parse-metcon error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
