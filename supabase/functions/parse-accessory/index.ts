/**
 * parse-accessory: Parse an accessory block text into individual structured movements.
 *
 * Accessory supports load-based (sets×reps×weight), isometric holds (sets×seconds),
 * and distance carries (sets×meters×weight).
 *
 * Input:  { block_text: string, block_id?: string }
 * Output: { movements: ParsedAccessoryMovement[] }
 *
 * If block_id is provided, writes the result back to program_workout_blocks.parsed_tasks.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "../_shared/call-claude.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const SYSTEM_PROMPT = `You parse CrossFit/fitness accessory block descriptions into individual movements.

Return ONLY a JSON array. Each element:
{
  "movement": "Clean, canonical movement name",
  "sets": <number or null>,
  "reps": <number or null>,
  "weight": <number or null>,
  "weight_unit": "lbs" | "kg" | null,
  "hold_seconds": <number or null>,
  "distance": <number or null>,
  "distance_unit": "m" | "ft" | null,
  "notes": "<any modifier like 'each side', 'tempo', 'paused', etc. or null>"
}

Accessory movements fall into three formats:
1. LOAD-BASED (sets × reps × weight): "3x12 DB hammer curls @ 25 lbs" → sets: 3, reps: 12, weight: 25, weight_unit: "lbs"
2. ISOMETRIC HOLD (sets × seconds): "3x30s hollow hold" → sets: 3, hold_seconds: 30
3. DISTANCE CARRY (sets × meters × weight): "3x40m farmer carry @ 50 lbs/hand" → sets: 3, distance: 40, distance_unit: "m", weight: 50, weight_unit: "lbs", notes: "per hand"

Rules:
- Use CANONICAL movement names. Normalize:
  - "DB curls", "Dumbbell Curls", "DB Bicep Curls" → "DB Curls"
  - "Plank", "Front Plank", "Planks" → "Plank"
  - "Hollow Hold", "Hollow Body Hold" → "Hollow Hold"
  - "Farmer Carry", "Farmers Carry", "Farmer Walk" → "Farmer Carry"
  - "Face Pulls", "Face Pull" → "Face Pulls"
  - "Pallof Press", "Pallof Holds" → "Pallof Press"
  - Use title case.
- For "3x30s" or "3 x 30 sec" → sets: 3, hold_seconds: 30.
- For "40m" or "40 meters" → distance: 40, distance_unit: "m". For "50 ft" or "50 feet" → distance: 50, distance_unit: "ft".
- For "@ 25 lbs" or "(25/15)" — slash notation is male/female; use the FIRST number for weight.
- For "per hand" / "each hand" / "/hand" — weight is per hand; add "per hand" to notes.
- For "per side" / "each side" — add "per side" to notes.
- Reps and hold_seconds are mutually exclusive: a movement is either rep-based OR time-based, not both. Weighted holds should use hold_seconds AND weight.
- Put modifiers (tempo, pauses, variations, coaching cues) in notes.
- Return ONE entry per unique movement. Do NOT include rest periods, sets of "rest", or coaching cues as movements.
- Output valid JSON only, no markdown fences.`;

interface ParsedAccessoryMovement {
  movement: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  weight_unit: "lbs" | "kg" | null;
  hold_seconds: number | null;
  distance: number | null;
  distance_unit: "m" | "ft" | null;
  notes: string | null;
}

const VALID_WEIGHT_UNITS = ["lbs", "kg"];
const VALID_DISTANCE_UNITS = ["m", "ft"];

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

    let movements: ParsedAccessoryMovement[];
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

    movements = movements
      .filter((m) => m.movement && typeof m.movement === "string")
      .map((m) => ({
        movement: m.movement.trim(),
        sets: typeof m.sets === "number" ? m.sets : null,
        reps: typeof m.reps === "number" ? m.reps : null,
        weight: typeof m.weight === "number" ? m.weight : null,
        weight_unit: typeof m.weight_unit === "string" && VALID_WEIGHT_UNITS.includes(m.weight_unit) ? m.weight_unit as "lbs" | "kg" : null,
        hold_seconds: typeof m.hold_seconds === "number" ? m.hold_seconds : null,
        distance: typeof m.distance === "number" ? m.distance : null,
        distance_unit: typeof m.distance_unit === "string" && VALID_DISTANCE_UNITS.includes(m.distance_unit) ? m.distance_unit as "m" | "ft" : null,
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
    console.error("parse-accessory error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
