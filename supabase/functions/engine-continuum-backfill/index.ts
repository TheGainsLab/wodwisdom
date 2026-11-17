/**
 * engine-continuum-backfill — compute the continuum for Engine athletes from
 * data that already exists (Phase 0; docs/conditioning_continuum_phase0_plan.md).
 *
 * For each athlete: load completed sessions, time trials, the reference
 * curves and the prescriptions behind each session (catalog day, or the
 * sequencer's override at that position), compute the per-session values
 * (r, bout, sustain, evidence) with the pure module, replay the asymmetric
 * ratchet into the athlete's curve, and write both back:
 *   engine_workout_sessions.continuum_*   per session
 *   athlete_profiles.engine_curve          the curve, stamped computed_at + module version
 *
 * Idempotent: rerunning recomputes from scratch. A changed reference curve or
 * module version is picked up by a full rerun (spec §3.6: a refit replays everyone).
 * The compute lives in _shared/engine-continuum-io.ts; the sequencer and the
 * Coach refresh one athlete inline through the same module (Phase 1).
 *
 * Auth (either):
 *   - X-Cron-Key = LIFECYCLE_CRON_KEY   (pg_cron / service; verify_jwt=false)
 *   - an admin's JWT                    (profiles.role = 'admin')
 * Body: { user_id } | { email } | { all: true, stale_only?: boolean (default true) }
 *   One athlete runs synchronously and returns the result (including the
 *   prompt block, for inspection). `all` acks 202 and runs in the background;
 *   the per-athlete summary is one JSON line in the function log.
 *
 * Deploy: supabase functions deploy engine-continuum-backfill --no-verify-jwt
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { requireCronKey } from "../_shared/cron-auth.ts";
import { computeAthleteContinuum, curveIsFresh, loadCurves, type PdCurves } from "../_shared/engine-continuum-io.ts";
import { formatCurveForPrompt } from "../_shared/engine-continuum.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");

/** One athlete: compute (write unless dry run) and return the inspectable summary. */
async function computeAthlete(supa: SupabaseClient, userId: string, curves: PdCurves, opts: { write: boolean }) {
  const r = await computeAthleteContinuum(supa, userId, curves, opts);
  if (!r) return { user_id: userId, sessions: 0, skipped: "no sessions" };
  return {
    user_id: userId,
    sessions: r.sessions,
    evidence: r.evidence,
    flags: r.curve.flags,
    regions: r.regions,
    prompt_block: formatCurveForPrompt(r.curve, r.regions, r.trials),
    wrote: r.wrote,
  };
}

async function runAll(supa: SupabaseClient, curves: PdCurves, staleOnly: boolean): Promise<void> {
  const t0 = Date.now();
  // Every athlete with a completed session. PostgREST caps a response at
  // 1000 rows, so page through — the first run missed 9 athletes whose rows
  // all sat past the cap (2026-11-16).
  const idSet = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await supa.from("engine_workout_sessions").select("user_id").eq("completed", true).order("user_id").range(from, from + 999);
    if (error) throw new Error(`user list failed: ${error.message}`);
    for (const u of (page ?? []) as Array<{ user_id: string }>) idSet.add(u.user_id);
    if (!page || page.length < 1000) break;
  }
  const ids = [...idSet];
  let done = 0, skipped = 0, failed = 0;
  for (const uid of ids) {
    try {
      if (staleOnly && await curveIsFresh(supa, uid)) {
        skipped++;
        continue;
      }
      const r = await computeAthlete(supa, uid, curves, { write: true });
      done++;
      console.log(`[engine-continuum-backfill] ${JSON.stringify({ user: uid, sessions: r.sessions, evidence: (r as { evidence?: unknown }).evidence, flags: (r as { flags?: unknown }).flags })}`);
    } catch (e) {
      failed++;
      console.error(`[engine-continuum-backfill] user=${uid} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`[engine-continuum-backfill] all done in ${Math.round((Date.now() - t0) / 1000)}s: athletes=${ids.length} computed=${done} skipped=${skipped} failed=${failed}`);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth: cron key, else an admin's JWT.
  let authorized = requireCronKey(req, CRON_KEY) === null;
  if (!authorized) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (token) {
      const { data: userData } = await supa.auth.getUser(token);
      if (userData?.user) {
        const { data: caller } = await supa.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
        authorized = caller?.role === "admin";
      }
    }
  }
  if (!authorized) return json({ error: "forbidden" }, 403);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await req.json().catch(() => ({})) as { user_id?: string; email?: string; all?: boolean; stale_only?: boolean; dry_run?: boolean };
  const curves = await loadCurves(supa);
  if (Object.keys(curves).length === 0) return json({ error: "engine_pd_curves is empty — run the migration seed first" }, 500);

  try {
    if (body.all === true) {
      const work = runAll(supa, curves, body.stale_only !== false);
      // deno-lint-ignore no-explicit-any
      const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil as ((p: Promise<unknown>) => void) | undefined;
      if (waitUntil) waitUntil(work);
      else work.catch(() => {});
      return json({ accepted: true, note: "running in the background; per-athlete lines in the function log" }, 202);
    }
    let userId = typeof body.user_id === "string" ? body.user_id : null;
    if (!userId && typeof body.email === "string") {
      const { data: target } = await supa.from("profiles").select("id").eq("email", body.email.trim().toLowerCase()).maybeSingle();
      userId = target?.id ?? null;
    }
    if (!userId) return json({ error: "user_id, email, or all:true required" }, 400);
    const result = await computeAthlete(supa, userId, curves, { write: body.dry_run !== true });
    return json(result);
  } catch (e) {
    console.error("[engine-continuum-backfill]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
