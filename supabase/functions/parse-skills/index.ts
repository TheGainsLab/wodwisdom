/**
 * parse-skills: Parse a skills block text into individual structured movements.
 *
 * Input:  { block_text: string, block_id?: string }
 * Output: { skills: ParsedSkill[] }
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

const SYSTEM_PROMPT = `You parse CrossFit/fitness skill block descriptions into individual movements.

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
- Strip structure headers (EMOM, rounds, "for quality", minute markers) — they are not movements.
- Do NOT include rest periods, coaching cues, or tempo prescriptions as separate movements.
- Output valid JSON only, no markdown fences.`;

interface ParsedSkill {
  movement: string;
  sets: number | null;
  reps: number | null;
  hold_seconds: number | null;
  notes: string | null;
}

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
    let skills: ParsedSkill[];
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      skills = JSON.parse(cleaned);
      if (!Array.isArray(skills)) throw new Error("Expected array");
    } catch {
      console.error("Failed to parse Claude response:", raw);
      return new Response(
        JSON.stringify({ error: "Failed to parse skills", raw }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Normalize
    skills = skills
      .filter((s) => s.movement && typeof s.movement === "string")
      .map((s) => ({
        movement: s.movement.trim(),
        sets: typeof s.sets === "number" ? s.sets : null,
        reps: typeof s.reps === "number" ? s.reps : null,
        hold_seconds: typeof s.hold_seconds === "number" ? s.hold_seconds : null,
        notes: typeof s.notes === "string" && s.notes.trim() ? s.notes.trim() : null,
      }));

    // Write back to DB if block_id provided
    if (block_id) {
      const { error: updateErr } = await supa
        .from("program_workout_blocks")
        .update({ parsed_tasks: skills })
        .eq("id", block_id);

      if (updateErr) {
        console.error("Failed to write parsed_tasks:", updateErr);
      }
    }

    return new Response(JSON.stringify({ skills }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-skills error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
