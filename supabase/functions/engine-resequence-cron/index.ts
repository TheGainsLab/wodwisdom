/**
 * engine-resequence-cron — automatic, server-side trigger for the Engine
 * self-sequencer. Generation never depends on the athlete: this runs on a
 * schedule, finds athletes who have CONSUMED their current AI block, and
 * generates the next one in the background, ahead of them.
 *
 * Gated to opt-in users only: athlete_profiles.engine_ai_sequencing = true
 * (default false). Switch on test athletes first, widen when confident. Doubles
 * as a per-user kill-switch.
 *
 * "Block consumed" = current_day (highest completed + 1) is past the user's
 * highest generated override position. That correctly skips pinned month-boundary
 * time trials (which sit below max override without their own override row), so we
 * never regenerate a block the athlete is still working through.
 *
 * Deploy: supabase functions deploy engine-resequence-cron
 * Schedule via pg_cron (e.g. every 15 min). verify_jwt=false in config.toml.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runResequence } from "../_shared/run-resequence.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results: Record<string, unknown>[] = [];

  try {
    // Only athletes explicitly opted in (test users first).
    const { data: flagged } = await supa
      .from("athlete_profiles")
      .select("user_id")
      .eq("engine_ai_sequencing", true);

    for (const row of flagged ?? []) {
      const uid = row.user_id as string;
      try {
        // current_day = highest completed program_day_number + 1
        const { data: maxDay } = await supa
          .from("engine_workout_sessions")
          .select("program_day_number")
          .eq("user_id", uid).eq("completed", true)
          .not("program_day_number", "is", null)
          .order("program_day_number", { ascending: false }).limit(1).maybeSingle();
        const currentDay = ((maxDay?.program_day_number as number) ?? 0) + 1;

        // highest generated override position
        const { data: maxOv } = await supa
          .from("engine_user_day_overrides")
          .select("sequence_position")
          .eq("user_id", uid)
          .order("sequence_position", { ascending: false }).limit(1).maybeSingle();
        const maxOverride = (maxOv?.sequence_position as number | undefined) ?? null;

        // Generate only when the current block is consumed.
        if (maxOverride !== null && currentDay <= maxOverride) {
          results.push({ user: uid, action: "skip", reason: "block not consumed", currentDay, maxOverride });
          continue;
        }

        const result = await runResequence(supa, uid, { dryRun: false });
        results.push({ user: uid, action: result.status, persisted: result.persisted ?? 0, reason: result.reason });
      } catch (e) {
        results.push({ user: uid, action: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[engine-resequence-cron] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
