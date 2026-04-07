/**
 * Persist a completed workout to workout_logs, workout_log_blocks, and workout_log_entries.
 * Called by Start Workout page when user taps "Finish Workout".
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { inferTimeDomain } from "../_shared/time-domain.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WORKOUT_TYPES = ["for_time", "amrap", "emom", "strength", "other"] as const;
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
  set_number?: number | null;
  // Skills-specific fields
  reps_completed?: number | null;
  hold_seconds?: number | null;
  distance?: number | null;
  distance_unit?: "ft" | "m";
  quality?: "A" | "B" | "C" | "D" | null;
  variation?: string | null;
  faults_observed?: string[] | null;
}

interface LogBlock {
  label?: string;
  type?: string;
  text?: string;
  score?: string | null;
  rx?: boolean;
  notes?: string | null;
  entries?: LogEntry[];
  // Scoring fields (metcon blocks only)
  percentile?: number | null;
  performance_tier?: string | null;
  median_benchmark?: string | null;
  excellent_benchmark?: string | null;
}

interface LogWorkoutBody {
  workout_date: string;
  workout_text: string;
  workout_type: string;
  source_id?: string | null;
  notes?: string | null;
  blocks?: LogBlock[];
  status?: "in_progress" | "completed";
  /** When resuming an in-progress workout, pass the existing log id */
  existing_log_id?: string | null;
}

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
    const source_id = body.source_id ?? null;
    const notes = body.notes ?? null;
    const blocks = body.blocks ?? [];
    const status = body.status === "in_progress" ? "in_progress" : "completed";
    const existingLogId = body.existing_log_id ?? null;

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
    const dateStr = new Date(workout_date).toISOString().slice(0, 10);
    if (isNaN(new Date(workout_date).getTime())) {
      return new Response(JSON.stringify({ error: "Invalid workout_date" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 1. Create or update the workout_logs row
    let log: { id: string };

    if (existingLogId) {
      // Resuming an in-progress workout — update it and wipe old blocks/entries
      const { data: existing, error: fetchErr } = await supa
        .from("workout_logs")
        .select("id")
        .eq("id", existingLogId)
        .eq("user_id", user.id)
        .single();

      if (fetchErr || !existing) {
        return new Response(JSON.stringify({ error: "In-progress workout not found" }), {
          status: 404,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const { error: updErr } = await supa
        .from("workout_logs")
        .update({ workout_date: dateStr, workout_text, workout_type, notes, status })
        .eq("id", existingLogId);
      if (updErr) {
        console.error("log-workout update error:", updErr);
        return new Response(JSON.stringify({ error: "Failed to update workout" }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      // Delete old child rows — they'll be re-inserted below
      await supa.from("workout_log_entries").delete().eq("log_id", existingLogId);
      await supa.from("workout_log_blocks").delete().eq("log_id", existingLogId);

      log = { id: existingLogId };
    } else {
      const { data: newLog, error: logErr } = await supa
        .from("workout_logs")
        .insert({
          user_id: user.id,
          workout_date: dateStr,
          workout_text,
          workout_type,
          source_id,
          notes,
          status,
        })
        .select("id")
        .single();

      if (logErr || !newLog) {
        console.error("log-workout insert error:", logErr);
        return new Response(JSON.stringify({ error: "Failed to save workout" }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      log = newLog;
    }

    // 2. Insert workout_log_blocks rows and get back their IDs
    let insertedBlocks: { id: string }[] = [];
    if (blocks.length > 0) {
      const blockRows = blocks.map((b, i) => {
        const blockType = BLOCK_TYPES.includes((b.type ?? "other") as (typeof BLOCK_TYPES)[number])
          ? (b.type ?? "other")
          : "other";
        const blockText = b.text?.trim() || "";
        return {
          log_id: log.id,
          block_type: blockType,
          block_label: b.label?.trim() || null,
          block_text: blockText,
          score: b.score?.trim() || null,
          rx: b.rx ?? false,
          notes: b.notes?.trim() || null,
          sort_order: i,
          percentile: b.percentile != null && b.percentile >= 1 && b.percentile <= 99
            ? b.percentile
            : null,
          performance_tier: b.performance_tier?.trim() || null,
          median_benchmark: b.median_benchmark?.trim() || null,
          excellent_benchmark: b.excellent_benchmark?.trim() || null,
          time_domain: blockType === "metcon" && blockText ? inferTimeDomain(blockText) : null,
        };
      });

      const { data: blockData, error: blocksErr } = await supa
        .from("workout_log_blocks")
        .insert(blockRows)
        .select("id");
      if (blocksErr) {
        console.error("log-workout blocks insert error:", blocksErr);
      }
      insertedBlocks = (blockData as { id: string }[]) || [];
    }

    // 3. Insert workout_log_entries rows with block_id FK
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
      block_id: string | null;
      set_number: number | null;
      reps_completed: number | null;
      hold_seconds: number | null;
      distance: number | null;
      distance_unit: string | null;
      quality: string | null;
      variation: string | null;
      faults_observed: string[] | null;
    }[] = [];
    let sortOrder = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const blockLabel = block.label ?? null;
      const blockId = insertedBlocks[bi]?.id ?? null;
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
          block_id: blockId,
          set_number: entry.set_number != null && entry.set_number > 0 ? entry.set_number : null,
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
          faults_observed: Array.isArray(entry.faults_observed) && entry.faults_observed.length > 0
            ? entry.faults_observed.map((f) => String(f).trim()).filter(Boolean)
            : null,
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
