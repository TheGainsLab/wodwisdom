/**
 * Update or delete a single workout_log_entry.
 * Verifies ownership via the parent workout_logs row.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WEIGHT_UNITS = ["lbs", "kg"] as const;
const QUALITY_GRADES = ["A", "B", "C", "D"] as const;
const DISTANCE_UNITS = ["ft", "m"] as const;

interface UpdateBody {
  entry_id: string;
  /** Set to true to delete this entry instead of updating */
  delete?: boolean;
  fields?: {
    weight?: number | null;
    weight_unit?: "lbs" | "kg";
    reps?: number | null;
    rpe?: number | null;
    sets?: number | null;
    reps_completed?: number | null;
    hold_seconds?: number | null;
    distance?: number | null;
    distance_unit?: "ft" | "m" | null;
    quality?: "A" | "B" | "C" | "D" | null;
    scaling_note?: string | null;
    variation?: string | null;
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

    const body = (await req.json()) as UpdateBody;

    if (!body.entry_id) {
      return new Response(JSON.stringify({ error: "Missing entry_id" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Verify ownership: entry → workout_log → user
    const { data: entry } = await supa
      .from("workout_log_entries")
      .select("id, log_id")
      .eq("id", body.entry_id)
      .single();

    if (!entry) {
      return new Response(JSON.stringify({ error: "Entry not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: log } = await supa
      .from("workout_logs")
      .select("id")
      .eq("id", entry.log_id)
      .eq("user_id", user.id)
      .single();

    if (!log) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── Delete mode ──
    if (body.delete) {
      const { error: delErr } = await supa
        .from("workout_log_entries")
        .delete()
        .eq("id", body.entry_id);

      if (delErr) {
        return new Response(JSON.stringify({ error: "Failed to delete" }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ deleted: true }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // ── Update mode ──
    if (!body.fields || Object.keys(body.fields).length === 0) {
      return new Response(JSON.stringify({ error: "No fields to update" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Build sanitized update payload
    const update: Record<string, unknown> = {};
    const f = body.fields;

    if (f.weight !== undefined) {
      update.weight = f.weight != null && f.weight > 0 ? f.weight : null;
    }
    if (f.weight_unit !== undefined) {
      update.weight_unit = WEIGHT_UNITS.includes(
        f.weight_unit as (typeof WEIGHT_UNITS)[number]
      )
        ? f.weight_unit
        : "lbs";
    }
    if (f.reps !== undefined) {
      update.reps = f.reps != null && f.reps > 0 ? f.reps : null;
    }
    if (f.rpe !== undefined) {
      update.rpe =
        f.rpe != null && f.rpe >= 1 && f.rpe <= 10 ? f.rpe : null;
    }
    if (f.sets !== undefined) {
      update.sets = f.sets != null && f.sets > 0 ? f.sets : null;
    }
    if (f.reps_completed !== undefined) {
      update.reps_completed =
        f.reps_completed != null && f.reps_completed >= 0
          ? f.reps_completed
          : null;
    }
    if (f.hold_seconds !== undefined) {
      update.hold_seconds =
        f.hold_seconds != null && f.hold_seconds > 0 ? f.hold_seconds : null;
    }
    if (f.distance !== undefined) {
      update.distance =
        f.distance != null && f.distance > 0 ? f.distance : null;
    }
    if (f.distance_unit !== undefined) {
      update.distance_unit = DISTANCE_UNITS.includes(
        (f.distance_unit ?? "") as (typeof DISTANCE_UNITS)[number]
      )
        ? f.distance_unit
        : null;
    }
    if (f.quality !== undefined) {
      update.quality = QUALITY_GRADES.includes(
        (f.quality ?? "") as (typeof QUALITY_GRADES)[number]
      )
        ? f.quality
        : null;
    }
    if (f.scaling_note !== undefined) {
      update.scaling_note = f.scaling_note?.trim() || null;
    }
    if (f.variation !== undefined) {
      update.variation = f.variation?.trim() || null;
    }

    if (Object.keys(update).length === 0) {
      return new Response(JSON.stringify({ error: "No valid fields" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: updated, error: updErr } = await supa
      .from("workout_log_entries")
      .update(update)
      .eq("id", body.entry_id)
      .select()
      .single();

    if (updErr) {
      console.error("update-workout-entry: update error", updErr);
      return new Response(JSON.stringify({ error: "Failed to update" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ entry: updated }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("update-workout-entry error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
