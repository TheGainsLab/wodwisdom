/**
 * Persist a completed workout to workout_logs, workout_log_blocks, and workout_log_entries.
 * Called by Start Workout page when user taps "Finish Workout".
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { inferTimeDomain } from "../_shared/time-domain.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { computeMetconPower, type MetconBlockInput } from "../_shared/metcon-workcalc.ts";
import { computeCardioPower } from "../_shared/cardio-power.ts";
import { hashWorkoutText } from "../_shared/signature-hash.ts";
import { SCORE_ENGINE_CODE_VERSION } from "../_shared/compute-block-benchmark.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const WORKOUT_TYPES = ["for_time", "amrap", "emom", "strength", "other"] as const;
const WEIGHT_UNITS = ["lbs", "kg"] as const;
const BLOCK_TYPES = ["warm-up", "mobility", "skills", "strength", "metcon", "cardio", "accessory", "active-recovery", "cool-down", "other"] as const;

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
  // Per-movement skip tracking (Step 10 of v3 UX roadmap)
  completed?: boolean | null;
  skip_reason?: string | null;
  // Prescription snapshot (Step 18 of v3 UX roadmap)
  prescribed_weight?: number | null;
  prescribed_reps?: number | null;
  prescribed_hold_seconds?: number | null;
  prescribed_rpe?: number | null;
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
  capped?: boolean | null;
  capped_reps?: number | null;
  percentile?: number | null;
  performance_tier?: string | null;
  median_benchmark?: string | null;
  excellent_benchmark?: string | null;
  block_scheme?: string | null;
  time_cap_seconds?: number | null;
  // Cardio blocks only — machine-displayed average watts + work time.
  cardio_avg_watts?: number | null;
  cardio_work_seconds?: number | null;
  cardio_modality?: string | null;
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

    // Preserve each block's performed_date across the destructive rewrite below,
    // so a day logged across multiple calendar dates keeps its real per-block
    // dates. New blocks (no prior) fall back to the workout's date.
    const priorPerformedBySort = new Map<number, string>();

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

      // Snapshot existing per-block performed dates before wiping, keyed by
      // sort_order (the stable block identity), so the reinsert can keep them.
      const { data: priorBlocks } = await supa
        .from("workout_log_blocks")
        .select("sort_order, performed_date")
        .eq("log_id", existingLogId);
      for (const pb of (priorBlocks as { sort_order: number; performed_date: string | null }[] | null) ?? []) {
        if (pb.performed_date) priorPerformedBySort.set(pb.sort_order, pb.performed_date);
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

    // Athlete profile — body mass for cardio power, and reused by the metcon
    // power pass below. One fetch serves both.
    const { data: apRow } = await supa
      .from("athlete_profiles")
      .select("bodyweight, units, gender")
      .eq("user_id", user.id)
      .maybeSingle();
    const apr = apRow as { bodyweight?: number; units?: string; gender?: string } | null;
    const athlete = {
      bodyweight: apr?.bodyweight ?? null,
      units: apr?.units ?? null,
      gender: apr?.gender ?? null,
    };

    // 2. Insert workout_log_blocks rows and get back their IDs
    let insertedBlocks: { id: string }[] = [];
    if (blocks.length > 0) {
      const blockRows = blocks.map((b, i) => {
        const blockType = BLOCK_TYPES.includes((b.type ?? "other") as (typeof BLOCK_TYPES)[number])
          ? (b.type ?? "other")
          : "other";
        const blockText = b.text?.trim() || "";
        const isCapped = b.capped === true;
        const cappedReps =
          isCapped && typeof b.capped_reps === "number" && Number.isFinite(b.capped_reps)
            ? Math.max(0, Math.floor(b.capped_reps))
            : null;
        // Cardio power is pure arithmetic (machine watts × time) — computed
        // inline here, not via the async metcon pass. Null for non-cardio.
        const cardioPower =
          blockType === "cardio"
            ? computeCardioPower(b.cardio_avg_watts, b.cardio_work_seconds, athlete.bodyweight, athlete.units)
            : null;
        return {
          log_id: log.id,
          block_type: blockType,
          block_label: b.label?.trim() || null,
          block_text: blockText,
          score: isCapped ? null : (b.score?.trim() || null),
          rx: b.rx ?? false,
          notes: b.notes?.trim().slice(0, 1000) || null,
          sort_order: i,
          // Keep the block's original performed date; new blocks default to the
          // workout's date (Phase 1 training journal).
          performed_date: priorPerformedBySort.get(i) ?? dateStr,
          capped: isCapped,
          capped_reps: cappedReps,
          percentile: !isCapped && b.percentile != null && b.percentile >= 1 && b.percentile <= 99
            ? b.percentile
            : null,
          performance_tier: isCapped ? null : (b.performance_tier?.trim() || null),
          median_benchmark: b.median_benchmark?.trim() || null,
          excellent_benchmark: b.excellent_benchmark?.trim() || null,
          time_domain: blockType === "metcon" && blockText ? inferTimeDomain(blockText) : null,
          block_scheme: b.block_scheme?.trim() || null,
          time_cap_seconds:
            typeof b.time_cap_seconds === "number" && b.time_cap_seconds > 0 ? b.time_cap_seconds : null,
          // Cardio power columns — populated inline for cardio blocks; null
          // otherwise. (Metcon power is filled by the async pass below.)
          cardio_modality: blockType === "cardio" ? (b.cardio_modality?.trim() || null) : null,
          work_seconds: cardioPower?.work_seconds ?? null,
          joules: cardioPower?.joules ?? null,
          avg_power_watts: cardioPower?.avg_power_watts ?? null,
          avg_w_per_kg: cardioPower?.avg_w_per_kg ?? null,
          body_mass_kg: cardioPower?.body_mass_kg ?? null,
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
      completed: boolean;
      skip_reason: string | null;
      prescribed_weight: number | null;
      prescribed_reps: number | null;
      prescribed_hold_seconds: number | null;
      prescribed_rpe: number | null;
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
          completed: entry.completed === false ? false : true,
          skip_reason: entry.completed === false ? (entry.skip_reason?.trim() || null) : null,
          prescribed_weight: typeof entry.prescribed_weight === "number" ? entry.prescribed_weight : null,
          prescribed_reps: typeof entry.prescribed_reps === "number" ? entry.prescribed_reps : null,
          prescribed_hold_seconds: typeof entry.prescribed_hold_seconds === "number" ? entry.prescribed_hold_seconds : null,
          prescribed_rpe: typeof entry.prescribed_rpe === "number" ? entry.prescribed_rpe : null,
        });
      }
    }

    if (entries.length > 0) {
      const { error: entriesErr } = await supa.from("workout_log_entries").insert(entries);
      if (entriesErr) {
        console.error("log-workout entries insert error:", entriesErr);
      }
    }

    // 3b. Evidence ingestion (Workout Signatures athlete layer): every scored
    // metcon block becomes a signature_evidence row keyed by the workout's
    // text-hash — the universal join key.
    // NOTE for the hash-joined scoring path (queue worker / rescore job):
    // when server-side scoring of these rows against a stored signature
    // lands, the prescription MUST come through
    // measurableSignatureWorkout() (compute-block-benchmark) — the one
    // door that merges loads_women — never from the row's workout jsonb
    // directly, or women are modeled at men's bars again (2026-11-04). Unsigned today; when the judge signs
    // the same structure these rows join its signature retroactively, and the
    // next profile refit consumes them. Idempotent across the destructive
    // re-log path via (user_id, source_ref). Best-effort: never blocks logging.
    try {
      const evidenceRows: Record<string, unknown>[] = [];
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (b.type !== "metcon") continue;
        const scored = Boolean(b.score?.trim()) || b.capped === true;
        if (!scored || !b.text?.trim()) continue;
        const hash = await hashWorkoutText(
          b.text,
          b.block_scheme ?? null,
          b.time_cap_seconds ?? null,
        );
        evidenceRows.push({
          user_id: user.id,
          workout_hash: hash,
          score_raw: {
            score: b.score ?? null,
            capped: b.capped ?? null,
            capped_reps: b.capped_reps ?? null,
            block_scheme: b.block_scheme ?? null,
            time_cap_seconds: b.time_cap_seconds ?? null,
            rx: b.rx ?? null,
          },
          // Percentile enters the fit ONLY for RX performances: the client
          // computes it against RX cohort anchors, and the model params are
          // fitted on the RX general field — a scaled score on the RX scale
          // is the same cohort mismatch Open ingestion filters out. Scaled
          // (and unknown-rx) rows keep their hash and score_raw; their
          // percentile joins when scaled cohorts exist. A capped result is
          // interval information ("below the cap's percentile") — the
          // interval-censored observation lands with the gate-aware model.
          percentile: b.rx === true && !b.capped && b.percentile != null &&
              b.percentile >= 1 && b.percentile <= 99
            ? b.percentile
            : null,
          // Structure-derived percentile → provisional noise sd ≈ 20
          // (var 400) until the scorescale_acceptance protocol measures the
          // real error (design doc 2026-11-02: that error feeds calibration).
          obs_noise_var: 400,
          source: "logged_solo",
          performed_at: priorPerformedBySort.get(bi) ?? dateStr,
          source_ref: `log:${log.id}:${bi}`,
          // Scoring reliability (review 2026-11-03): every row carries its
          // scoring state and engine version, so "what fraction of rows is
          // in each status" is one GROUP BY, and a fixed engine bug makes
          // its old rows identifiable and re-scorable. A row that can't be
          // trusted is VISIBLY unscored, never plausibly wrong.
          ...(b.rx === true && !b.capped && b.percentile != null &&
              b.percentile >= 1 && b.percentile <= 99
            ? {
              score_status: "scored",
              scored_at: new Date().toISOString(),
              // percentile computed client-side against served anchors;
              // curve generation unknown at this hop — 'client' marks it
              engine_version: `${SCORE_ENGINE_CODE_VERSION}+calc:client`,
            }
            : {
              score_status: b.capped === true
                ? "skipped_capped" // interval info; lands with the gate-aware model
                : b.rx === false
                ? "skipped_scaled" // athlete DECLARED scaled; RX scale only until scaled cohorts exist
                : b.rx == null
                // rx never stated (non-UI caller; the app always sends a
                // boolean) — not a scaled declaration, its own status
                ? "pending_rx_unknown"
                : "pending", // RX, uncapped, but no percentile resolved
              scored_at: null,
              engine_version: null,
            }),
        });
      }
      // Replace, don't merge: a re-log with fewer or reordered blocks must
      // not leave stale log:<id>:<bi> rows behind (the same-id destructive
      // rewrite keeps source_refs aligned only for surviving positions).
      const { error: delErr } = await supa
        .from("signature_evidence")
        .delete()
        .eq("user_id", user.id)
        .like("source_ref", `log:${log.id}:%`);
      if (delErr) console.warn("log-workout evidence cleanup failed:", delErr.message);
      if (evidenceRows.length > 0) {
        const { error: evErr } = await supa
          .from("signature_evidence")
          .upsert(evidenceRows, { onConflict: "user_id,source_ref" });
        if (evErr) console.warn("log-workout evidence upsert failed:", evErr.message);
      }
    } catch (e) {
      console.warn(
        "log-workout evidence ingestion skipped:",
        e instanceof Error ? e.message : e,
      );
    }

    // Background: compute metcon power (joules/watts) per metcon block and
    // write it onto the block row. Best-effort — never affects the response.
    if (ANTHROPIC_API_KEY && insertedBlocks.length > 0) {
      const apiKey = ANTHROPIC_API_KEY;
      const task = (async () => {
        for (let bi = 0; bi < blocks.length; bi++) {
          const block = blocks[bi];
          const blockId = insertedBlocks[bi]?.id;
          if (!blockId || block.type !== "metcon") continue;
          const metconInput: MetconBlockInput = {
            block_scheme: block.block_scheme ?? null,
            block_text: block.text ?? null,
            score: block.score ?? null,
            capped: block.capped ?? null,
            capped_reps: block.capped_reps ?? null,
            time_cap_seconds: block.time_cap_seconds ?? null,
            movements: (block.entries ?? [])
              .filter((e) => e.movement?.trim())
              .map((e) => {
                // A calorie movement logs its count in `reps` with
                // distance_unit='cal' as the only flag. Route it to
                // `calories` — work-calc's monostructural path needs the
                // calorie key; reps_total on a monostructural movement
                // computes nothing.
                const isCal = (e.distance_unit as string | null) === "cal";
                return {
                  movement: e.movement.trim(),
                  reps: isCal ? null : (e.reps ?? null),
                  weight: e.weight ?? null,
                  weight_unit: e.weight_unit ?? null,
                  distance: isCal ? null : (e.distance ?? null),
                  distance_unit: isCal ? null : (e.distance_unit ?? null),
                  calories: isCal ? (e.reps ?? e.distance ?? null) : null,
                };
              }),
          };
          try {
            const power = await computeMetconPower(metconInput, athlete, apiKey);
            if (power) {
              await supa
                .from("workout_log_blocks")
                .update({
                  joules: power.joules,
                  avg_power_watts: power.avg_power_watts,
                  avg_w_per_kg: power.avg_w_per_kg,
                  body_mass_kg: power.body_mass_kg,
                })
                .eq("id", blockId);
            }
          } catch (e) {
            console.error(`[log-workout] metcon power failed for block ${blockId}:`, e);
          }
        }
      })();
      EdgeRuntime.waitUntil(task);
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
