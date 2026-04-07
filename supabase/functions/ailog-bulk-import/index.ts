/**
 * ailog-bulk-import edge function
 *
 * Takes messy free-text workout history (with results) and uses AI to parse it
 * into structured workout_logs, workout_log_blocks, and workout_log_entries.
 *
 * Handles inconsistent formatting, implicit workout names, mixed score formats, etc.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "../_shared/call-claude.ts";
import { checkEntitlement } from "../_shared/entitlements.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const PARSE_HISTORY_PROMPT = `You parse messy CrossFit/fitness training logs into structured data.

Users write their training history in all sorts of formats. Your job is to extract each workout day and its results.

Return ONLY a JSON array of workout entries:
[
  {
    "date": "YYYY-MM-DD" or null,
    "day_label": "Monday" or "Day 1" or null,
    "workout_type": "for_time" | "amrap" | "emom" | "strength" | "other",
    "workout_text": "The full workout description",
    "score": "6:45" or "8+15" or "225x5" or null,
    "rx": true | false | null,
    "blocks": [
      {
        "block_type": "strength" | "metcon" | "skills" | "other",
        "block_text": "The block description",
        "score": "score for this specific block" or null
      }
    ],
    "entries": [
      {
        "movement": "Clean, canonical movement name",
        "sets": null or number,
        "reps": null or number,
        "weight": null or number,
        "weight_unit": "lbs" | "kg" | null,
        "scaling_note": null or "scaled pull-ups to ring rows"
      }
    ]
  }
]

Rules:
- Separate distinct workout DAYS. If someone writes "Monday... Tuesday..." those are separate entries.
- "Rest" or "Rest day" should be skipped entirely.
- Extract scores where given: "3:45" (for time), "8+3" (AMRAP rounds+reps), "165 reps", etc.
- "Rx" or "RX" means rx: true. "Scaled" means rx: false.
- If they mention scaling ("subbed ring rows for muscle-ups"), capture it in scaling_note.
- Use canonical movement names (title case).
- If a date is mentioned ("3/15", "March 15"), parse it. If only day names, leave date null.
- If the text mentions a named workout ("Fran", "Helen", "Murph"), include the name in workout_text.
- Break each day into blocks when possible (strength vs metcon).
- Extract movement-level detail (weights, reps, sets) into entries.
- Output valid JSON only, no markdown fences.`;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const hasAccess = await checkEntitlement(supa, user.id, "ailog");
    if (!hasAccess) return json({ error: "AI Log subscription required" }, 403);

    const body = await req.json();
    const { text, program_id } = body;

    if (!text || typeof text !== "string" || text.trim().length < 10) {
      return json({ error: "Provide workout history text (at least 10 characters)" }, 400);
    }

    if (!ANTHROPIC_API_KEY) {
      return json({ error: "AI service unavailable" }, 503);
    }

    // Parse with Claude
    const raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY,
      system: PARSE_HISTORY_PROMPT,
      userContent: text.trim(),
      maxTokens: 8192,
    });

    const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    let parsed: Record<string, unknown>[];
    try {
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error("Not an array");
    } catch {
      return json({ error: "Failed to parse workout history", raw: cleaned }, 500);
    }

    // Insert each workout as a workout_log
    let inserted = 0;
    for (const workout of parsed) {
      const workoutDate = workout.date as string | null;
      const workoutText = workout.workout_text as string;
      if (!workoutText) continue;

      const workoutType = (workout.workout_type as string) || "other";
      const rx = workout.rx as boolean | null;

      const logRow: Record<string, unknown> = {
        user_id: user.id,
        workout_date: workoutDate || new Date().toISOString().slice(0, 10),
        workout_text: workoutText,
        workout_type: ["for_time", "amrap", "emom", "strength", "other"].includes(workoutType) ? workoutType : "other",
        source_type: "external",
        notes: workout.day_label ? `Imported: ${workout.day_label}` : "Imported via AI Log",
      };
      if (program_id) logRow.source_id = program_id;

      const { data: log, error: logErr } = await supa
        .from("workout_logs")
        .insert(logRow)
        .select("id")
        .single();

      if (logErr || !log) continue;
      inserted++;

      // Insert blocks
      const blocks = workout.blocks as Record<string, unknown>[] | null;
      if (blocks && Array.isArray(blocks)) {
        const blockRows = blocks
          .filter((b) => b.block_text)
          .map((b, i) => ({
            log_id: log.id,
            block_type: (b.block_type as string) || "other",
            block_text: String(b.block_text),
            score: (b.score as string) || null,
            rx: rx ?? false,
            sort_order: i,
          }));
        if (blockRows.length > 0) {
          await supa.from("workout_log_blocks").insert(blockRows);
        }
      }

      // Insert entries
      const entries = workout.entries as Record<string, unknown>[] | null;
      if (entries && Array.isArray(entries)) {
        const entryRows = entries
          .filter((e) => e.movement)
          .map((e, i) => ({
            log_id: log.id,
            movement: String(e.movement),
            sets: typeof e.sets === "number" ? e.sets : null,
            reps: typeof e.reps === "number" ? e.reps : null,
            weight: typeof e.weight === "number" ? e.weight : null,
            weight_unit: e.weight_unit === "kg" ? "kg" : e.weight_unit === "lbs" ? "lbs" : null,
            scaling_note: typeof e.scaling_note === "string" ? e.scaling_note : null,
            sort_order: i,
          }));
        if (entryRows.length > 0) {
          await supa.from("workout_log_entries").insert(entryRows);
        }
      }
    }

    return json({ imported: inserted, total_parsed: parsed.length });
  } catch (err) {
    console.error("ailog-bulk-import error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
