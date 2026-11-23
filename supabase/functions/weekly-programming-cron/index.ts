/**
 * weekly-programming-cron — fills the next week of every weekly program whose
 * previous week is consumed (weekly Programming PR 4, founder decisions
 * 2026-11-12/13).
 *
 * Each tick: for every program in weekly mode, look at EVERY month that still
 * has an outline week, oldest month first (2026-11-23: only the newest month
 * used to be looked at, so outline weeks left behind in an older month were
 * never written), and in that month find the lowest outline week W. It is due
 * (founder decisions 2026-11-15) when EITHER
 *  - every day of week W-1 was trained: it has a workout log, in progress or
 *    completed, with at least one saved block (the shared rule in
 *    _shared/day-trained.ts) — saving one block is interacting with the day,
 *    and an interaction is a completion as far as the generator is concerned; or
 *  - 7 × (W-1) days have passed since the month was built (week 2 at day 7,
 *    week 3 at day 14, week 4 at day 21) — the whole month is delivered
 *    inside the payment window whatever the athlete does.
 * For each due program with no generation already running for the athlete,
 * kick a WEEK JOB on generate-program-v3
 * (service call, `{ program_id, fill_week: W }`). The job reads the stored
 * skeleton (re-planning it if the athlete's notes touch what it owns),
 * composes the week's metcons against the month so far, fills the week from
 * the logs and the notes, audits it, and replaces the outline rows.
 *
 * A failed job leaves the outline. Capped per tick so a backlog drains over a
 * few ticks rather than one long one. Programs are taken in turn (2026-11-23):
 * never attempted first, then the one attempted longest ago; and a month whose
 * week jobs keep failing backs off — 1h, 2h, 4h, 8h, then 24h between
 * attempts — so it cannot take a slot every hour. One week job per program
 * per tick. The picking is pure and tested: see pickMonthToFill, fillRetryAt
 * and orderForKicks in _shared/weekly-fill.ts.
 *
 * AUTH: verify_jwt=false; X-Cron-Key = LIFECYCLE_CRON_KEY (shared gate).
 * Ack-then-work like engine-resequence-cron (pg_net's ~5s timeout).
 * Schedule: pg_cron hourly (see docs/engine_self_sequencing_plan.md).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronKey } from "../_shared/cron-auth.ts";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";
import { loadMonthFillStates, orderForKicks, pickMonthToFill } from "../_shared/weekly-fill.ts";
import { checkEntitlement } from "../_shared/entitlements.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");
const MAX_KICKS_PER_TICK = 5;

interface Candidate {
  program: string;
  userId: string;
  month: number;
  week: number;
  gate: string;
  lastFillAttemptAt: string | null;
}

async function runTick(supa: SupabaseClient): Promise<void> {
  const t0 = Date.now();
  const results: Record<string, unknown>[] = [];
  let kicks = 0;
  try {
    const { data: programs } = await supa
      .from("programs")
      .select("id, user_id")
      .eq("weekly_mode", true)
      .eq("committed", true)
      .is("archived_at", null); // an archived program gets no new weeks (2026-11-21)

    // PASS 1 — what is due. One week per program: the earliest due outline
    // week of the earliest month that has one.
    const candidates: Candidate[] = [];
    for (const prog of (programs ?? []) as Array<{ id: string; user_id: string }>) {
      const pid = prog.id as string;
      try {
        // ACCESS: a week is only written for someone who can still use it.
        // Without this the clock gate kept writing weeks 2-4, at full
        // generation cost, for a subscriber who had left (found 2026-11-21).
        if (!(await checkEntitlement(supa, prog.user_id, "programming"))) {
          results.push({ program: pid, action: "skip", reason: "no programming access" });
          continue;
        }
        const pick = pickMonthToFill(await loadMonthFillStates(supa, pid, prog.user_id));
        if (pick.action === "skip") { results.push({ program: pid, action: "skip", reason: pick.reason, ...pick.detail }); continue; }
        candidates.push({ program: pid, userId: prog.user_id, month: pick.month, week: pick.week, gate: pick.reason, lastFillAttemptAt: pick.lastFillAttemptAt });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[weekly-programming-cron] program=${pid} ERROR: ${msg}`);
        results.push({ program: pid, action: "error", error: msg });
      }
    }

    // PASS 2 — kick, in turn: never attempted first, then longest ago.
    for (const c of orderForKicks(candidates)) {
      const pid = c.program;
      const month = c.month;
      const due = c.week;
      try {
        if (kicks >= MAX_KICKS_PER_TICK) { results.push({ program: pid, action: "deferred", month, week: due, gate: c.gate }); continue; }
        const { data: active } = await supa
          .from("program_jobs").select("id").eq("user_id", c.userId).eq("status", "processing")
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
            "x-webhook-user-id": c.userId,
          },
          body: JSON.stringify({ program_id: pid, month_number: month, fill_week: due }),
        }, 15_000);
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          await supa.from("program_month_skeletons")
            .update({ last_fill_error: `kick ${resp.status}: ${JSON.stringify(body).slice(0, 200)}` })
            .eq("program_id", pid).eq("month_number", month);
          results.push({ program: pid, action: "error", month, week: due, status: resp.status, body });
          continue;
        }
        kicks += 1;
        results.push({ program: pid, action: "kicked", month, week: due, gate: c.gate, job: body.job_id });
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
