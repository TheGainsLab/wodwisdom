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
        // Position + overrides are program-scoped (the athlete may have switched
        // programs; positions are reused across programs). Resolve their program.
        const { data: prof } = await supa
          .from("athlete_profiles").select("engine_program_version").eq("user_id", uid).maybeSingle();
        const version = (prof?.engine_program_version as string) ?? "main_5day";

        // "Block consumed" = the athlete has completed EVERY position that
        // currently has an override. Order-agnostic, so it's correct for curated
        // non-monotonic programs (hyrox/vo2) too — no catalog-day comparison. New
        // overrides written at the next block's positions are not yet completed, so
        // the cron won't regenerate until the athlete works through them.
        const { data: doneRows } = await supa
          .from("engine_workout_sessions")
          .select("program_day_number")
          .eq("user_id", uid).eq("completed", true).eq("program_version", version)
          .not("program_day_number", "is", null);
        const completed = new Set<number>((doneRows ?? []).map((r) => r.program_day_number as number));

        const { data: ovs } = await supa
          .from("engine_user_day_overrides")
          .select("sequence_position")
          .eq("user_id", uid).eq("program_version", version);
        const overridePositions = (ovs ?? []).map((o) => o.sequence_position as number);
        const blockConsumed = overridePositions.length === 0 ||
          overridePositions.every((p) => completed.has(p));

        if (!blockConsumed) {
          const remaining = overridePositions.filter((p) => !completed.has(p));
          results.push({ user: uid, action: "skip", reason: "block not consumed", remaining });
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
