/**
 * engine-resequence-cron — automatic, server-side trigger for the Engine
 * self-sequencer. Generation never depends on the athlete: this runs on a
 * schedule, finds athletes who have CONSUMED their current AI block, and
 * generates the next one in the background, ahead of them.
 *
 * Gated to opt-in users only: athlete_profiles.engine_ai_sequencing = true
 * (default false; Engine setup turns it on for new subscribers). Doubles as a
 * per-user kill-switch.
 *
 * "Block consumed" = the athlete has completed every position that currently
 * has an override (or skipped past the block). Pinned month-boundary time
 * trials sit below max override without their own override row, so we never
 * regenerate a block the athlete is still working through.
 *
 * SHAPE (2026-11-11, after the first real tick was lost):
 *   - AUTH: verify_jwt=false; X-Cron-Key = LIFECYCLE_CRON_KEY (the shared
 *     gate in _shared/cron-auth.ts), fail-closed. A stray POST costs paid
 *     Claude calls.
 *   - ACK THEN WORK: pg_net gives up after ~5s, and a tick that reaches a
 *     real generation takes minutes (150s/attempt on the AI). The handler
 *     answers 202 at once and runs the tick in EdgeRuntime.waitUntil, the
 *     same pattern as program generation. The per-athlete outcome goes to
 *     the function log as one JSON line (the response body is no longer the
 *     place to read it); generated overrides are the visible proof.
 *   - THE CAP COUNTS GENERATIONS, not athletes looked at. Gate skips and
 *     consumed-checks are free. (The old counter charged every runResequence
 *     call, so two month-one athletes ahead in the list starved every
 *     eligible athlete behind them, every tick.)
 *
 * Deploy: supabase functions deploy engine-resequence-cron
 * Schedule via pg_cron every 15 min with the X-Cron-Key header (see
 * docs/engine_self_sequencing_plan.md → Rollout / ops).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runResequence } from "../_shared/run-resequence.ts";
import { requireCronKey } from "../_shared/cron-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");

// Generations are serial and each carries a generous AI deadline (150s/attempt),
// so one tick can't safely run many. Cap GENERATIONS per tick; deferred users
// are picked up on the next 15-min tick — a rollout-day backlog drains within
// hours, and steady state rarely has more than a couple eligible per tick.
// Consumed-check queries and gate skips are cheap and never count.
const MAX_GENERATIONS_PER_TICK = 2;

/** Statuses from runResequence that did NOT reach the AI — free, uncounted. */
const UNCOUNTED = new Set(["skipped"]);

async function runTick(supa: SupabaseClient): Promise<void> {
  const results: Record<string, unknown>[] = [];
  let generations = 0;
  const t0 = Date.now();

  try {
    // Only athletes explicitly opted in.
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
        // Only a run that reached the AI spends the tick's budget. A gate skip
        // ("assessment month in progress", mapping-less, no diagnosis) costs
        // nothing and must not starve the athletes after it in the list.
        if (!UNCOUNTED.has(result.status)) generations += 1;
        results.push({ user: uid, action: result.status, persisted: result.persisted ?? 0, reason: result.reason });
      } catch (e) {
        // LOUD: this catch once swallowed every failure into a response JSON
        // nobody reads — hourly ticks looked healthy while generating nothing.
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[engine-resequence-cron] user=${uid} ERROR: ${msg}`);
        results.push({ user: uid, action: "error", error: msg });
      }
    }
  } catch (e) {
    console.error("[engine-resequence-cron] tick error:", e instanceof Error ? e.message : String(e));
  }

  // One summary line per tick, always — so a tick that did nothing says so —
  // plus the per-athlete outcomes as JSON. The response was acked before the
  // work began, so the log is where a tick is read.
  const counts: Record<string, number> = {};
  for (const r of results) counts[String(r.action)] = (counts[String(r.action)] ?? 0) + 1;
  console.log(
    `[engine-resequence-cron] tick done in ${Math.round((Date.now() - t0) / 1000)}s: processed=${results.length} generations=${generations} ` +
      Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" "),
  );
  console.log(`[engine-resequence-cron] results ${JSON.stringify(results)}`);
}

Deno.serve((req) => {
  const denied = requireCronKey(req, CRON_KEY);
  if (denied) return denied;

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  // Ack now, work after: pg_net's ~5s client timeout must never cut a
  // generation off. If the runtime has no waitUntil (local serve), run inline.
  // deno-lint-ignore no-explicit-any
  const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil as ((p: Promise<unknown>) => void) | undefined;
  const work = runTick(supa);
  if (waitUntil) waitUntil(work);
  else work.catch(() => {});

  return new Response(JSON.stringify({ accepted: true, note: "tick running in background; read the function log" }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
});
