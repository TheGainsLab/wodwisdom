/**
 * Persist a completed workout to workout_logs, workout_log_blocks, and workout_log_entries.
 * Called by Start Workout page when user taps "Finish Workout".
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WORKOUT_TYPES = ["for_time", "amrap", "emom", "strength", "other"] as const;
const SOURCE_TYPES = ["review", "program", "manual"] as const;
const WEIGHT_UNITS = ["lbs", "kg"] as const;
const BLOCK_TYPES = ["warm-up", "skills", "strength", "metcon", "cool-down", "accessory", "other"] as const;

const QUALITY_GRADES = ["A", "B", "C", "D"] as const;
const DISTANCE_UNITS = ["ft", "m"] as const;

interface LogEntry {
  movement: string;
  sets?: number | null;
  reps?: number | null;
  weight?: number | null;
  weight_unit?: "lbs" | "kg";
  rpe?: number | null;
  scaling_note?: string | null;
  sort_order?: number;
  // Skills-specific fields
  reps_completed?: number | null;
  hold_seconds?: number | null;
  distance?: number | null;
  distance_unit?: "ft" | "m";
  quality?: "A" | "B" | "C" | "D" | null;
  variation?: string | null;
}

interface LogBlock {
  label?: string;
  type?: string;
  text?: string;
  score?: string | null;
  rx?: boolean;
  entries?: LogEntry[];
}

interface LogWorkoutBody {
  workout_date: string;
  workout_text: string;
  workout_type: string;
  source_type: string;
  source_id?: string | null;
  notes?: string | null;
  blocks?: LogBlock[];
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

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
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

    const body = (await req.json()) as LogWorkoutBody;

    const workout_date = body.workout_date;
    const workout_text = body.workout_text?.trim();
    const workout_type = body.workout_type;
    const source_type = body.source_type;
    const source_id = body.source_id ?? null;
    const notes = body.notes ?? null;
    const blocks = body.blocks ?? [];

    if (!workout_date || typeof workout_date !== "string") {
      return new Response(JSON.stringify({ error: "Missing workout_date" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!workout_text || workout_text.length < 1) {
      return new Response(JSON.stringify({ error: "Missing workout_text" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!WORKOUT_TYPES.includes(workout_type as (typeof WORKOUT_TYPES)[number])) {
      return new Response(JSON.stringify({ error: "Invalid workout_type" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!SOURCE_TYPES.includes(source_type as (typeof SOURCE_TYPES)[number])) {
      return new Response(JSON.stringify({ error: "Invalid source_type" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const dateStr = new Date(workout_date).toISOString().slice(0, 10);
    if (isNaN(new Date(workout_date).getTime())) {
      return new Response(JSON.stringify({ error: "Invalid workout_date" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 1. Insert workout_logs row (no score/rx/blocks — those live in workout_log_blocks now)
    const { data: log, error: logErr } = await supa
      .from("workout_logs")
      .insert({
        user_id: user.id,
        workout_date: dateStr,
        workout_text,
        workout_type,
        source_type,
        source_id,
        notes,
      })
      .select("id")
      .single();

    if (logErr) {
      console.error("log-workout insert error:", logErr);
      return new Response(JSON.stringify({ error: "Failed to save workout" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 2. Insert workout_log_blocks rows
    if (blocks.length > 0) {
      const blockRows = blocks.map((b, i) => ({
        log_id: log.id,
        block_type: BLOCK_TYPES.includes((b.type ?? "other") as (typeof BLOCK_TYPES)[number])
          ? (b.type ?? "other")
          : "other",
        block_label: b.label?.trim() || null,
        block_text: b.text?.trim() || "",
        score: b.score?.trim() || null,
        rx: b.rx ?? false,
        sort_order: i,
      }));

      const { error: blocksErr } = await supa.from("workout_log_blocks").insert(blockRows);
      if (blocksErr) {
        console.error("log-workout blocks insert error:", blocksErr);
      }
    }

    // 3. Insert workout_log_entries rows
    const entries: {
      log_id: string;
      movement: string;
      sets: number | null;
      reps: number | null;
      weight: number | null;
      weight_unit: string;
      rpe: number | null;
      scaling_note: string | null;
      sort_order: number;
      block_label: string | null;
      reps_completed: number | null;
      hold_seconds: number | null;
      distance: number | null;
      distance_unit: string | null;
      quality: string | null;
      variation: string | null;
    }[] = [];
    let sortOrder = 0;
    for (const block of blocks) {
      const blockLabel = block.label ?? null;
      for (const entry of block.entries ?? []) {
        if (!entry.movement?.trim()) continue;
        entries.push({
          log_id: log.id,
          movement: entry.movement.trim(),
          sets: entry.sets ?? null,
          reps: entry.reps ?? null,
          weight: entry.weight ?? null,
          weight_unit: WEIGHT_UNITS.includes((entry.weight_unit ?? "lbs") as (typeof WEIGHT_UNITS)[number])
            ? (entry.weight_unit ?? "lbs")
            : "lbs",
          rpe: entry.rpe != null && entry.rpe >= 1 && entry.rpe <= 10 ? entry.rpe : null,
          scaling_note: entry.scaling_note?.trim() || null,
          sort_order: sortOrder++,
          block_label: blockLabel,
          // Skills-specific fields
          reps_completed: entry.reps_completed != null && entry.reps_completed >= 0
            ? entry.reps_completed
            : null,
          hold_seconds: entry.hold_seconds != null && entry.hold_seconds > 0
            ? entry.hold_seconds
            : null,
          distance: entry.distance != null && entry.distance > 0
            ? entry.distance
            : null,
          distance_unit: DISTANCE_UNITS.includes((entry.distance_unit ?? "") as (typeof DISTANCE_UNITS)[number])
            ? entry.distance_unit!
            : null,
          quality: QUALITY_GRADES.includes((entry.quality ?? "") as (typeof QUALITY_GRADES)[number])
            ? entry.quality!
            : null,
          variation: entry.variation?.trim() || null,
        });
      }
    }

    if (entries.length > 0) {
      const { error: entriesErr } = await supa.from("workout_log_entries").insert(entries);
      if (entriesErr) {
        console.error("log-workout entries insert error:", entriesErr);
      }
    }

    return new Response(
      JSON.stringify({
        id: log.id,
        workout_date: dateStr,
      }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("log-workout error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  }
});
