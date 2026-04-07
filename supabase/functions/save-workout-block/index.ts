/**
 * Save a single workout block for an in-progress workout.
 * Creates the parent workout_logs row (status=in_progress) if it doesn't exist yet.
 * Upserts the block + its entries so the user can save repeatedly.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { inferTimeDomain } from "../_shared/time-domain.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BLOCK_TYPES = [
  "warm-up",
  "skills",
  "strength",
  "metcon",
  "cool-down",
  "accessory",
  "other",
] as const;
const WEIGHT_UNITS = ["lbs", "kg"] as const;
const QUALITY_GRADES = ["A", "B", "C", "D"] as const;
const DISTANCE_UNITS = ["ft", "m"] as const;
const WORKOUT_TYPES = [
  "for_time",
  "amrap",
  "emom",
  "strength",
  "other",
] as const;

interface Entry {
  movement: string;
  sets?: number | null;
  reps?: number | null;
  weight?: number | null;
  weight_unit?: "lbs" | "kg";
  rpe?: number | null;
  scaling_note?: string | null;
  set_number?: number | null;
  reps_completed?: number | null;
  hold_seconds?: number | null;
  distance?: number | null;
  distance_unit?: "ft" | "m";
  quality?: "A" | "B" | "C" | "D" | null;
  variation?: string | null;
  faults_observed?: string[] | null;
}

interface SaveBlockBody {
  /** Existing in-progress log id (null on first block save for a day) */
  log_id?: string | null;
  /** Required when creating the log row for the first time */
  source_id?: string | null;
  workout_date: string;
  workout_text: string;
  workout_type: string;
  /** The block data */
  block: {
    label?: string;
    type?: string;
    text?: string;
    score?: string | null;
    rx?: boolean;
    notes?: string | null;
    sort_order: number;
    entries?: Entry[];
    percentile?: number | null;
    performance_tier?: string | null;
    median_benchmark?: string | null;
    excellent_benchmark?: string | null;
  };
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

    const body = (await req.json()) as SaveBlockBody;
    const { block } = body;

    if (!block || block.sort_order == null) {
      return new Response(JSON.stringify({ error: "Missing block data" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const dateStr = new Date(body.workout_date).toISOString().slice(0, 10);
    if (isNaN(new Date(body.workout_date).getTime())) {
      return new Response(JSON.stringify({ error: "Invalid workout_date" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── 1. Ensure parent workout_logs row exists ──────────────────
    let logId = body.log_id ?? null;

    if (logId) {
      // Verify ownership
      const { data: existing } = await supa
        .from("workout_logs")
        .select("id")
        .eq("id", logId)
        .eq("user_id", user.id)
        .eq("status", "in_progress")
        .single();
      if (!existing) {
        return new Response(
          JSON.stringify({ error: "In-progress workout not found" }),
          { status: 404, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Create a new in-progress log
      const workoutText = body.workout_text?.trim() || "";
      const workoutType = WORKOUT_TYPES.includes(
        (body.workout_type ?? "other") as (typeof WORKOUT_TYPES)[number]
      )
        ? body.workout_type
        : "other";

      const { data: newLog, error: logErr } = await supa
        .from("workout_logs")
        .insert({
          user_id: user.id,
          workout_date: dateStr,
          workout_text: workoutText,
          workout_type: workoutType,
          source_id: body.source_id ?? null,
          notes: null,
          status: "in_progress",
        })
        .select("id")
        .single();

      if (logErr || !newLog) {
        console.error("save-workout-block: log insert error", logErr);
        return new Response(
          JSON.stringify({ error: "Failed to create workout log" }),
          { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }
      logId = newLog.id;
    }

    // ── 2. Delete any existing block at this sort_order, then insert ──
    // (This acts as an upsert keyed on log_id + sort_order)
    await supa
      .from("workout_log_blocks")
      .delete()
      .eq("log_id", logId)
      .eq("sort_order", block.sort_order);

    const blockType = BLOCK_TYPES.includes(
      (block.type ?? "other") as (typeof BLOCK_TYPES)[number]
    )
      ? (block.type ?? "other")
      : "other";
    const blockText = block.text?.trim() || "";

    const { data: insertedBlock, error: blockErr } = await supa
      .from("workout_log_blocks")
      .insert({
        log_id: logId,
        block_type: blockType,
        block_label: block.label?.trim() || null,
        block_text: blockText,
        score: block.score?.trim() || null,
        rx: block.rx ?? false,
        notes: block.notes?.trim() || null,
        sort_order: block.sort_order,
        percentile:
          block.percentile != null && block.percentile >= 1 && block.percentile <= 99
            ? block.percentile
            : null,
        performance_tier: block.performance_tier?.trim() || null,
        median_benchmark: block.median_benchmark?.trim() || null,
        excellent_benchmark: block.excellent_benchmark?.trim() || null,
        time_domain:
          block.time_domain && ["short", "medium", "long"].includes(block.time_domain)
            ? block.time_domain
            : blockType === "metcon" && blockText ? inferTimeDomain(blockText) : null,
      })
      .select("id")
      .single();

    if (blockErr) {
      console.error("save-workout-block: block insert error", blockErr);
      return new Response(
        JSON.stringify({ error: "Failed to save block" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Delete old entries for this block, insert new ones ─────
    // First delete any entries that had the old block at this sort_order
    // We need to delete by block_id if the old block existed
    if (insertedBlock) {
      // Delete entries that reference blocks at this sort_order for this log
      // Since we already deleted the old block, cascade should handle this,
      // but let's also clean up any orphaned entries for this log + block_label
      const blockLabel = block.label?.trim() || null;
      if (blockLabel) {
        await supa
          .from("workout_log_entries")
          .delete()
          .eq("log_id", logId)
          .eq("block_label", blockLabel);
      }
    }

    const entries = (block.entries ?? [])
      .filter((e) => e.movement?.trim())
      .map((entry, i) => ({
        log_id: logId,
        movement: entry.movement.trim(),
        sets: entry.sets ?? null,
        reps: entry.reps ?? null,
        weight: entry.weight ?? null,
        weight_unit: WEIGHT_UNITS.includes(
          (entry.weight_unit ?? "lbs") as (typeof WEIGHT_UNITS)[number]
        )
          ? (entry.weight_unit ?? "lbs")
          : "lbs",
        rpe:
          entry.rpe != null && entry.rpe >= 1 && entry.rpe <= 10
            ? entry.rpe
            : null,
        scaling_note: entry.scaling_note?.trim() || null,
        sort_order: i,
        block_label: block.label?.trim() || null,
        block_id: insertedBlock?.id ?? null,
        set_number:
          entry.set_number != null && entry.set_number > 0
            ? entry.set_number
            : null,
        reps_completed:
          entry.reps_completed != null && entry.reps_completed >= 0
            ? entry.reps_completed
            : null,
        hold_seconds:
          entry.hold_seconds != null && entry.hold_seconds > 0
            ? entry.hold_seconds
            : null,
        distance:
          entry.distance != null && entry.distance > 0 ? entry.distance : null,
        distance_unit: DISTANCE_UNITS.includes(
          (entry.distance_unit ?? "") as (typeof DISTANCE_UNITS)[number]
        )
          ? entry.distance_unit!
          : null,
        quality: QUALITY_GRADES.includes(
          (entry.quality ?? "") as (typeof QUALITY_GRADES)[number]
        )
          ? entry.quality!
          : null,
        variation: entry.variation?.trim() || null,
        faults_observed:
          Array.isArray(entry.faults_observed) && entry.faults_observed.length > 0
            ? entry.faults_observed.map((f) => String(f).trim()).filter(Boolean)
            : null,
      }));

    if (entries.length > 0) {
      const { error: entriesErr } = await supa
        .from("workout_log_entries")
        .insert(entries);
      if (entriesErr) {
        console.error("save-workout-block: entries insert error", entriesErr);
      }
    }

    // ── 4. Auto-complete: if all loggable blocks are saved, mark completed ──
    let autoCompleted = false;
    const sourceId = body.source_id ?? null;
    if (sourceId) {
      // Count saved blocks for this log (exclude warm-up/cool-down)
      const { count: savedCount } = await supa
        .from("workout_log_blocks")
        .select("id", { count: "exact", head: true })
        .eq("log_id", logId)
        .not("block_type", "in", '("warm-up","cool-down")');

      // Count total program blocks for this workout (exclude warm-up/cool-down)
      const { count: totalCount } = await supa
        .from("program_workout_blocks")
        .select("id", { count: "exact", head: true })
        .eq("program_workout_id", sourceId)
        .not("block_type", "in", '("warm-up","cool-down")');

      if (
        savedCount != null &&
        totalCount != null &&
        totalCount > 0 &&
        savedCount >= totalCount
      ) {
        await supa
          .from("workout_logs")
          .update({ status: "completed" })
          .eq("id", logId);
        autoCompleted = true;
      }
    }

    return new Response(
      JSON.stringify({
        log_id: logId,
        block_id: insertedBlock?.id ?? null,
        auto_completed: autoCompleted,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("save-workout-block error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
