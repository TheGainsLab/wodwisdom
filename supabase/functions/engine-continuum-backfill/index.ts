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
import { type CatalogEngineDay } from "../_shared/engine-block-resolve.ts";
import { prescriptionFromCatalog } from "../_shared/engine-continuum-prescription.ts";
import {
  type ContinuumSessionInput,
  CURVE_VERSION,
  formatCurveForPrompt,
  type PdCurvePoint,
  replayCurve,
  summarizeCurve,
  type TrialInput,
} from "../_shared/engine-continuum.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("LIFECYCLE_CRON_KEY");

interface SessionRow {
  id: string;
  user_id: string;
  date: string;
  day_type: string | null;
  modality: string | null;
  units: string | null;
  actual_pace: number | null;
  target_pace: number | null;
  workout_data: Record<string, unknown> | null;
  program_version: string | null;
  program_day: number | null;
  sequence_position: number | null;
  created_at: string;
}

async function loadCurves(supa: SupabaseClient): Promise<Record<string, PdCurvePoint[]>> {
  const { data } = await supa.from("engine_pd_curves").select("modality, units, r, seconds");
  const out: Record<string, PdCurvePoint[]> = {};
  for (const row of (data ?? []) as Array<{ modality: string; units: string; r: number; seconds: number }>) {
    const k = `${row.modality}|${row.units}`;
    (out[k] ??= []).push({ r: Number(row.r), seconds: Number(row.seconds) });
  }
  return out;
}

async function computeAthlete(supa: SupabaseClient, userId: string, curves: Record<string, PdCurvePoint[]>, opts: { write: boolean }) {
  const [{ data: sessRows }, { data: trialRows }, { data: ovRows }, { data: profile }] = await Promise.all([
    supa.from("engine_workout_sessions")
      .select("id, user_id, date, day_type, modality, units, actual_pace, target_pace, workout_data, program_version, program_day, sequence_position, created_at")
      .eq("user_id", userId).eq("completed", true).order("date").order("created_at"),
    supa.from("engine_time_trials").select("modality, units, calculated_rpm, date").eq("user_id", userId).not("calculated_rpm", "is", null),
    supa.from("engine_user_day_overrides").select("sequence_position, program_version, engine_workout_id").eq("user_id", userId),
    supa.from("athlete_profiles").select("user_id, engine_program_version, engine_curve").eq("user_id", userId).maybeSingle(),
  ]);
  const sessions = (sessRows ?? []) as SessionRow[];
  if (sessions.length === 0) return { user_id: userId, sessions: 0, skipped: "no sessions" };

  const trials: TrialInput[] = ((trialRows ?? []) as Array<{ modality: string; units: string | null; calculated_rpm: number; date: string }>)
    .map((t) => ({ modality: t.modality, units: t.units, pace: Number(t.calculated_rpm), date: t.date }));

  // Prescriptions: the sequencer's override at that position wins; else the
  // catalog day for the session's program. One batched read per kind.
  const overrideByKey = new Map<string, string>();
  for (const o of (ovRows ?? []) as Array<{ sequence_position: number; program_version: string; engine_workout_id: string }>) {
    overrideByKey.set(`${o.program_version}|${o.sequence_position}`, o.engine_workout_id);
  }
  const fallbackVersion = (profile as { engine_program_version?: string } | null)?.engine_program_version ?? "main_5day";
  const overrideIds = new Set<string>();
  const catalogKeys = new Set<string>();
  for (const s of sessions) {
    const version = s.program_version ?? fallbackVersion;
    const ov = s.sequence_position != null ? overrideByKey.get(`${version}|${s.sequence_position}`) : undefined;
    if (ov) overrideIds.add(ov);
    else if (s.program_day != null) catalogKeys.add(`${version}|${s.program_day}`);
  }
  const catalogByKey = new Map<string, CatalogEngineDay>();
  const versions = [...new Set([...catalogKeys].map((k) => k.split("|")[0]))];
  const days = [...new Set([...catalogKeys].map((k) => Number(k.split("|")[1])))];
  const SEL = "id, program_type, day_number, day_type, phase, month, block_count, set_rest_seconds, block_1_params, block_2_params, block_3_params, block_4_params, total_duration_minutes";
  if (versions.length && days.length) {
    const { data } = await supa.from("engine_workouts").select(SEL).in("program_type", versions).in("day_number", days);
    for (const w of (data ?? []) as Array<CatalogEngineDay & { id: string; program_type: string }>) catalogByKey.set(`${w.program_type}|${w.day_number}`, w);
  }
  const catalogById = new Map<string, CatalogEngineDay>();
  if (overrideIds.size) {
    const { data } = await supa.from("engine_workouts").select(SEL).in("id", [...overrideIds]);
    for (const w of (data ?? []) as Array<CatalogEngineDay & { id: string }>) catalogById.set(w.id, w);
  }

  const inputs: Array<ContinuumSessionInput & { id: string }> = sessions.map((s) => {
    const version = s.program_version ?? fallbackVersion;
    const ov = s.sequence_position != null ? overrideByKey.get(`${version}|${s.sequence_position}`) : undefined;
    const day = ov ? catalogById.get(ov) ?? null : s.program_day != null ? catalogByKey.get(`${version}|${s.program_day}`) ?? null : null;
    const wd = s.workout_data ?? {};
    const n = (k: string) => (typeof wd[k] === "number" ? (wd[k] as number) : null);
    return {
      id: s.id,
      date: s.date,
      day_type: s.day_type ?? "unknown",
      modality: s.modality ?? "unknown",
      units: s.units,
      actual_pace: s.actual_pace != null ? Number(s.actual_pace) : null,
      target_pace: s.target_pace != null ? Number(s.target_pace) : null,
      total_work_seconds: n("total_work_time"),
      total_rest_seconds: n("total_rest_time"),
      intervals: n("total_intervals"),
      prescription: prescriptionFromCatalog(day),
    };
  });

  const { curve, sessions: results } = replayCurve(inputs, trials, curves);
  const regions = summarizeCurve(curve, results);
  // replayCurve returns results in date order (stable), so pair them with the
  // inputs sorted the same way.
  const ordered = [...inputs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byId = new Map(ordered.map((inp, idx) => [inp.id, results[idx]]));

  const evidenceCounts: Record<string, number> = {};
  for (const r of results) evidenceCounts[r.evidence] = (evidenceCounts[r.evidence] ?? 0) + 1;

  if (opts.write) {
    const rows = sessions.map((s) => {
      const r = byId.get(s.id)!;
      return {
        id: s.id,
        user_id: s.user_id,
        date: s.date,
        continuum_r: r.r != null ? Number(r.r.toFixed(4)) : null,
        continuum_effort_s: r.effort_seconds != null ? Math.round(r.effort_seconds) : null,
        continuum_bout_s: r.bout_seconds != null ? Math.round(r.bout_seconds) : null,
        continuum_sustain: r.sustain != null ? Number(r.sustain.toFixed(4)) : null,
        continuum_evidence: r.evidence,
      };
    });
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supa.from("engine_workout_sessions").upsert(rows.slice(i, i + 200), { onConflict: "id" });
      if (error) throw new Error(`session write failed for ${userId}: ${error.message}`);
    }
    if (profile) {
      const { error } = await supa.from("athlete_profiles")
        .update({ engine_curve: { ...curve, computed_at: new Date().toISOString(), module_version: CURVE_VERSION } })
        .eq("user_id", userId);
      if (error) throw new Error(`curve write failed for ${userId}: ${error.message}`);
    }
  }

  return {
    user_id: userId,
    sessions: sessions.length,
    evidence: evidenceCounts,
    flags: curve.flags,
    regions,
    prompt_block: formatCurveForPrompt(curve, regions, trials),
    wrote: opts.write && !!profile,
  };
}

async function runAll(supa: SupabaseClient, curves: Record<string, PdCurvePoint[]>, staleOnly: boolean): Promise<void> {
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
      if (staleOnly) {
        const [{ data: prof }, { data: latest }] = await Promise.all([
          supa.from("athlete_profiles").select("engine_curve").eq("user_id", uid).maybeSingle(),
          supa.from("engine_workout_sessions").select("created_at").eq("user_id", uid).eq("completed", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const curve = (prof as { engine_curve?: { computed_at?: string; module_version?: number } } | null)?.engine_curve;
        if (curve?.computed_at && curve.module_version === CURVE_VERSION && latest?.created_at && latest.created_at <= curve.computed_at) {
          skipped++;
          continue;
        }
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
