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

// Generations are serial and each carries a generous AI deadline (150s/attempt),
// so one tick can't safely run many. Cap generations per tick; deferred users
// are picked up on the next 15-min tick — a rollout-day backlog drains within
// hours, and steady state rarely has more than a couple eligible per tick.
// Consumed-check queries are cheap and stay uncapped.
const MAX_GENERATIONS_PER_TICK = 2;

Deno.serve(async (_req) => {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results: Record<string, unknown>[] = [];
  let generations = 0;

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
        // Completed SEQUENCE positions (sequence-identity: sessions record
        // sequence_position; overrides key on true sequence positions).
        const { data: doneRows } = await supa
          .from("engine_workout_sessions")
          .select("sequence_position")
          .eq("user_id", uid).eq("completed", true).eq("program_version", version)
          .not("sequence_position", "is", null);
        const completedSeqs = new Set<number>((doneRows ?? []).map((r) => r.sequence_position as number));
        const maxCompletedSeq = completedSeqs.size ? Math.max(...completedSeqs) : 0;

        const { data: ovs } = await supa
          .from("engine_user_day_overrides")
          .select("sequence_position")
          .eq("user_id", uid).eq("program_version", version);
        const overridePositions = (ovs ?? []).map((o) => o.sequence_position as number);
        const maxOverrideSeq = overridePositions.length ? Math.max(...overridePositions) : 0;

        // "Consumed" two ways:
        //  - worked through: every overridden position completed; or
        //  - skipped through: the athlete's frontier has moved PAST the
        //    block's end. Athletes skip days (a normal behavior); treating
        //    skip as "still working through it" stalled the loop forever —
        //    the athlete silently fell out of AI sequencing.
        const workedThrough = overridePositions.length === 0 ||
          overridePositions.every((p) => completedSeqs.has(p));
        const skippedThrough = overridePositions.length > 0 && maxCompletedSeq > maxOverrideSeq;

        if (!workedThrough && !skippedThrough) {
          const remaining = overridePositions.filter((p) => !completedSeqs.has(p));
          results.push({ user: uid, action: "skip", reason: "block not consumed", remaining });
          continue;
        }

        // Tick cap: this athlete is eligible, but the tick's generation budget
        // is spent. Defer BEFORE the stale-override cleanup so the whole
        // consume-and-regenerate step happens atomically on a later tick.
        if (generations >= MAX_GENERATIONS_PER_TICK) {
          results.push({ user: uid, action: "deferred", reason: "tick generation cap reached" });
          continue;
        }

        // Skip-through: the uncompleted overrides are behind the athlete's
        // frontier — stale content written for an athlete-state that no longer
        // exists. Delete them (their pages revert to curated content);
        // completed-position overrides stay as the record of what was trained.
        if (skippedThrough && !workedThrough) {
          const stale = overridePositions.filter((p) => !completedSeqs.has(p));
          if (stale.length > 0) {
            await supa
              .from("engine_user_day_overrides")
              .delete()
              .eq("user_id", uid).eq("program_version", version)
              .in("sequence_position", stale);
          }
        }

        const result = await runResequence(supa, uid, { dryRun: false });
        generations += 1;
        results.push({ user: uid, action: result.status, persisted: result.persisted ?? 0, reason: result.reason });
      } catch (e) {
        // LOUD: this catch once swallowed every failure into a response JSON
        // nobody reads — hourly ticks looked healthy while generating nothing.
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[engine-resequence-cron] user=${uid} ERROR: ${msg}`);
        results.push({ user: uid, action: "error", error: msg });
      }
    }

    // One summary line per tick, always — so a tick that did nothing says so.
    const counts: Record<string, number> = {};
    for (const r of results) counts[String(r.action)] = (counts[String(r.action)] ?? 0) + 1;
    console.log(
      `[engine-resequence-cron] tick done: processed=${results.length} generations=${generations} ` +
        Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" "),
    );

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
