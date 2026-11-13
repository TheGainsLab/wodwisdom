/**
 * weekly-programming-cron — fills the next week of every weekly program whose
 * previous week is consumed (weekly Programming PR 4, founder decisions
 * 2026-11-12/13).
 *
 * Each tick: for every program in weekly mode with an outline week, find the
 * lowest outline week W. It is due when the LAST DAY of week W-1 is logged
 * (or anything beyond it) — the week's last day is the gate; earlier days are
 * the athlete's to do or not. For each due program with no generation already
 * running for the athlete, kick a WEEK JOB on generate-program-v3
 * (service call, `{ program_id, fill_week: W }`). The job reads the stored
 * skeleton (re-planning it if the athlete's notes touch what it owns),
 * composes the week's metcons against the month so far, fills the week from
 * the logs and the notes, audits it, and replaces the outline rows.
 *
 * A failed job leaves the outline; the next tick tries again. Capped per tick
 * so a backlog drains over a few ticks rather than one long one.
 *
 * AUTH: verify_jwt=false; X-Cron-Key = LIFECYCLE_CRON_KEY (shared gate).
 * Ack-then-work like engine-resequence-cron (pg_net's ~5s timeout).
 * Schedule: pg_cron hourly (see docs/engine_self_sequencing_plan.md).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronKey } from "../_shared/cron-auth.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { nextWeekToFill } from "../_shared/weekly-fill.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");
const MAX_KICKS_PER_TICK = 5;

async function runTick(supa: SupabaseClient): Promise<void> {
  const t0 = Date.now();
  const results: Record<string, unknown>[] = [];
  let kicks = 0;
  try {
    const { data: programs } = await supa
      .from("programs")
      .select("id, user_id, generated_months")
      .eq("weekly_mode", true)
      .eq("committed", true);

    for (const prog of (programs ?? []) as Array<{ id: string; user_id: string; generated_months: number | null }>) {
      const pid = prog.id as string;
      try {
        const month = prog.generated_months || 1;
        const { data: days } = await supa
          .from("program_workouts")
          .select("id, week_num, day_num, status")
          .eq("program_id", pid)
          .eq("month_number", month);
        const rows = (days ?? []) as Array<{ id: string; week_num: number; day_num: number; status: string | null }>;
        const outlineWeeks = [...new Set(rows.filter((r) => r.status === "outline").map((r) => r.week_num))];
        if (outlineWeeks.length === 0) { results.push({ program: pid, action: "skip", reason: "no outline weeks" }); continue; }

        const writtenIds = rows.filter((r) => r.status !== "outline").map((r) => r.id);
        const { data: logs } = writtenIds.length
          ? await supa.from("workout_logs").select("source_id")
            .eq("user_id", prog.user_id).eq("source_type", "program").eq("status", "completed").in("source_id", writtenIds)
          : { data: [] };
        const loggedIds = new Set((logs ?? []).map((l) => l.source_id as string));
        const loggedDays = rows.filter((r) => loggedIds.has(r.id)).map((r) => ({ week: r.week_num, day: r.day_num }));
        const daysInWeek = (w: number) => Math.max(0, ...rows.filter((r) => r.week_num === w).map((r) => r.day_num));
        const due = nextWeekToFill(outlineWeeks, loggedDays, daysInWeek);
        if (due == null) { results.push({ program: pid, action: "skip", reason: "previous week not consumed", next_outline: Math.min(...outlineWeeks) }); continue; }

        if (kicks >= MAX_KICKS_PER_TICK) { results.push({ program: pid, action: "deferred", week: due }); continue; }
        const { data: active } = await supa
          .from("program_jobs").select("id").eq("user_id", prog.user_id).eq("status", "processing")
          .gte("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString()).limit(1).maybeSingle();
        if (active) { results.push({ program: pid, action: "skip", reason: "generation already running", job: active.id }); continue; }

        await supa.from("program_month_skeletons")
          .update({ last_fill_attempt_at: new Date().toISOString() })
          .eq("program_id", pid).eq("month_number", month);
        const resp = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/generate-program-v3`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
            "x-webhook-user-id": prog.user_id,
          },
          body: JSON.stringify({ program_id: pid, month_number: month, fill_week: due }),
        }, 15_000);
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          await supa.from("program_month_skeletons")
            .update({ last_fill_error: `kick ${resp.status}: ${JSON.stringify(body).slice(0, 200)}` })
            .eq("program_id", pid).eq("month_number", month);
          results.push({ program: pid, action: "error", week: due, status: resp.status, body });
          continue;
        }
        kicks += 1;
        results.push({ program: pid, action: "kicked", week: due, job: body.job_id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[weekly-programming-cron] program=${pid} ERROR: ${msg}`);
        results.push({ program: pid, action: "error", error: msg });
      }
    }
  } catch (e) {
    console.error("[weekly-programming-cron] tick error:", e instanceof Error ? e.message : String(e));
  }
  const counts: Record<string, number> = {};
  for (const r of results) counts[String(r.action)] = (counts[String(r.action)] ?? 0) + 1;
  console.log(
    `[weekly-programming-cron] tick done in ${Math.round((Date.now() - t0) / 1000)}s: programs=${results.length} kicks=${kicks} ` +
      Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" "),
  );
  console.log(`[weekly-programming-cron] results ${JSON.stringify(results)}`);
}

Deno.serve((req) => {
  const denied = requireCronKey(req, CRON_KEY);
  if (denied) return denied;
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
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
