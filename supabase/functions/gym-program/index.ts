/**
 * gym-program — the portal review desk's control door for the gym's main
 * program (the owner loop: draft → review the skeleton → approve → publish).
 *
 * On-demand counterpart to the scheduled gym-cohort-cron. Where the cron
 * generates straight through, this starts a generation with the owner-review
 * gate ON — the job parks at status='awaiting_approval' after the skeleton
 * stage, the owner reads the skeleton, and approval resumes the week-fills.
 * "Nothing reaches a member unsigned" (PROGRAMMING_STUDIO_DESIGN layer 1).
 *
 * Auth: tenant-bound consumer keys (the WHOLESALE family — same discipline and
 * keys as gym-cohort-config / wholesale-grants; a gym's key can only touch its
 * own gym_id). Server-to-server; the portal edge fn holds the key.
 *
 * POST { gym_id, action, ... }:
 *   start    -> build envelope+roster from the gym's config, create a PAUSED
 *               job, fire stage 1. Returns { job_id }. Guarded: one active job
 *               per gym. Needs a saved config (the brief) first.
 *   status   -> the gym's latest job: status, stage, skeleton_json, error,
 *               cohort_program_id. The review desk polls this.
 *   approve  -> resume the awaiting_approval job (owner signed the skeleton) →
 *               week-fills run. Delegates to gym-generate's approve path.
 *   discard  -> cancel the current draft (awaiting_approval or a stuck job) so
 *               a fresh start can proceed.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";
import { loadLatestProgram } from "../_shared/engine-class/queries.ts";
import {
  ACTIVE_JOB_STATUSES,
  GymJobConflictError,
  GymJobReadError,
  type GymJobConfig,
  startGymJob,
} from "../_shared/cohort/start-gym-job.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const auth = createConsumerAuth({
  serviceKey: Deno.env.get("WHOLESALE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("WHOLESALE_CONSUMER_KEYS"),
  label: "gym-program",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFIG_COLS =
  "gym_id, domain_pack, days_per_week, session_length_minutes, equipment, target_level, do_not_program, units, goal_text, strategy";
const JOB_COLS =
  "id, status, stage, next_stage, skeleton_json, error, cohort_program_id, result_json, created_at, updated_at";
const ACTIVE = [...ACTIVE_JOB_STATUSES];

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── Auth: constant-time, tenant-bound (the wholesale key family) ────────────
  if (!auth.configured()) return json({ error: "config_missing_wholesale_key" }, 500);
  const presentedKey = req.headers.get("x-service-key");
  if (!presentedKey) return json({ error: "forbidden" }, 401);
  const authResult = await auth.authorize(presentedKey);
  if (!authResult) return json({ error: "forbidden" }, 401);

  let body: { gym_id?: unknown; action?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const gymId = typeof body.gym_id === "string" ? body.gym_id : "";
  if (!UUID_RE.test(gymId)) return json({ error: "invalid_request", detail: "gym_id must be a uuid" }, 400);
  if (!auth.authorizes(authResult.authz, gymId)) {
    return json({ error: "tenant_forbidden", detail: "key not authorized for gym_id" }, 403);
  }
  const action = typeof body.action === "string" ? body.action : "";

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // The gym's latest job (the review desk shows one draft at a time).
  async function latestJob() {
    const { data, error } = await supa
      .from("gym_program_jobs")
      .select(JOB_COLS)
      .eq("gym_id", gymId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { data, error };
  }

  // ── status ──────────────────────────────────────────────────────────────────
  if (action === "status") {
    const { data, error } = await latestJob();
    if (error) return json({ error: "read_failed", detail: error.message }, 500);
    return json({ job: data ?? null });
  }

  // ── program ─────────────────────────────────────────────────────────────────
  // The gym's live written program (the desk's "read what you authored" view).
  // loadLatestProgram is the FENCED read — the newest COMPLETE job's program, so
  // a discarded/mid-flight draft never shows here. Fetched on demand (the full
  // shared_output is large — the poll loop uses `status`, not this).
  if (action === "program") {
    try {
      const program = await loadLatestProgram(supa, gymId);
      return json({ program });
    } catch (e) {
      return json({ error: "read_failed", detail: e instanceof Error ? e.message : "unknown" }, 500);
    }
  }

  // ── start ─────────────────────────────────────────────────────────────────
  if (action === "start") {
    // One active draft per gym — don't spawn a duplicate over a running or
    // awaiting-approval job.
    const { data: active, error: activeErr } = await supa
      .from("gym_program_jobs")
      .select("id, status")
      .eq("gym_id", gymId)
      .in("status", ACTIVE)
      .limit(1);
    if (activeErr) return json({ error: "read_failed", detail: activeErr.message }, 500);
    if ((active ?? []).length > 0) {
      return json({ error: "job_in_flight", job_id: active![0].id, status: active![0].status }, 409);
    }

    const { data: cfg, error: cfgErr } = await supa
      .from("gym_cohort_configs")
      .select(CONFIG_COLS)
      .eq("gym_id", gymId)
      .maybeSingle();
    if (cfgErr) return json({ error: "read_failed", detail: cfgErr.message }, 500);
    if (!cfg) return json({ error: "no_config", detail: "save the program brief before generating" }, 409);

    try {
      const result = await startGymJob(supa, cfg as GymJobConfig, {
        pauseAfterSkeleton: true,
        nowIso: new Date().toISOString(),
      });
      // Stamp the gym's claim marker so the hourly cron defers to this
      // owner-initiated draft (the active-job guard already blocks a duplicate;
      // this also keeps the cron from racing a fresh start within its window).
      await supa
        .from("gym_cohort_configs")
        .update({ last_attempt_at: new Date().toISOString() })
        .eq("gym_id", gymId)
        .then(() => {}, () => {});
      console.log(JSON.stringify({ at: "gym-program", event: "start", key_fp: authResult.fingerprint, gym_id: gymId, job_id: result.job_id }));
      return json({ started: true, job_id: result.job_id, members_scaled: result.members_scaled, members_with_weights: result.members_with_weights }, 202);
    } catch (e) {
      if (e instanceof GymJobConflictError) {
        return json({ error: "job_in_flight", detail: e.message }, 409);
      }
      const kind = e instanceof GymJobReadError ? "read_failed" : "start_failed";
      console.error("[gym-program] start", kind, gymId, e);
      return json({ error: kind, detail: (e as Error).message }, 500);
    }
  }

  // ── approve ───────────────────────────────────────────────────────────────
  if (action === "approve") {
    const { data: job, error } = await latestJob();
    if (error) return json({ error: "read_failed", detail: error.message }, 500);
    if (!job) return json({ error: "no_job" }, 409);
    if (job.status !== "awaiting_approval") {
      return json({ error: "not_awaiting_approval", detail: `job is '${job.status}'`, status: job.status }, 409);
    }
    // Delegate to gym-generate's approve path (the guarded status flip + resume)
    // using the service bearer, so the resume logic lives in one place.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/gym-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ approve_job_id: job.id }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res) return json({ error: "approve_failed", detail: "gym-generate unreachable" }, 502);
    if (!res.ok) {
      const out = await res.json().catch(() => ({})) as Record<string, unknown>;
      // Forward ONLY the meaningful 409 (not_awaiting_approval — the reaper or
      // another actor moved the job) so the desk can say "already handled".
      // Everything else — including a 401 from a misconfigured service bearer —
      // is our own server problem, not the owner's; collapse to 502 so the desk
      // never tells the owner their credentials are bad.
      if (res.status === 409) {
        return json({ error: out.error ?? "not_awaiting_approval", detail: out.detail ?? null }, 409);
      }
      console.error("[gym-program] approve delegate failed", res.status, out.error);
      return json({ error: "approve_failed", detail: "generation service error" }, 502);
    }
    console.log(JSON.stringify({ at: "gym-program", event: "approve", key_fp: authResult.fingerprint, gym_id: gymId, job_id: job.id }));
    return json({ approved: true, job_id: job.id }, 202);
  }

  // ── discard ───────────────────────────────────────────────────────────────
  if (action === "discard") {
    const { data: job, error } = await latestJob();
    if (error) return json({ error: "read_failed", detail: error.message }, 500);
    if (!job) return json({ error: "no_job" }, 409);
    if (!ACTIVE.includes(job.status)) {
      return json({ message: "nothing to discard", status: job.status });
    }
    // NULL the fencing token, not just the status. The worker's heartbeat and
    // final commit are gated on claim_token (NOT on status) — so a status-only
    // flip lets an in-flight stage commit straight over the discard (a discarded
    // skeleton would reappear at awaiting_approval). Nulling claim_token makes
    // the live stage's heartbeat fail (superseded → it bails) and its
    // commitGated match 0 rows (no-op); status='failed' then stops the NEXT
    // stage's claim (claim_gym_program_stage requires status='processing').
    // Compare-and-swap on ACTIVE so two concurrent discards can't both act.
    //
    // NOTE on the saving stage specifically: this does NOT un-publish. If the
    // saving stage is already mid-body, persistCohortResult has already inserted
    // the engine_cohort_programs row (the publish happens in the stage body,
    // before the gated commit). What the fencing DOES guarantee is that the
    // discarded job never stamps its own cohort_program_id / flips to complete —
    // and the member-facing read (loadLatestProgram) surfaces only the program
    // of the newest COMPLETE job, so a discarded-mid-save program never goes
    // live. The unsigned-publish guarantee lives at that read gate, not here.
    const { data: updated, error: updErr } = await supa
      .from("gym_program_jobs")
      .update({
        status: "failed",
        error: "discarded by owner",
        next_stage: null,
        stage: null,
        claim_token: null,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .in("status", ACTIVE)
      .select("id");
    if (updErr) return json({ error: "discard_failed", detail: updErr.message }, 500);
    if (!updated || updated.length === 0) {
      // Job left ACTIVE between our read and write (completed, or another
      // discard won). Nothing to do — report the current state.
      const { data: now } = await latestJob();
      return json({ message: "already resolved", status: now?.status ?? "unknown" });
    }
    console.log(JSON.stringify({ at: "gym-program", event: "discard", key_fp: authResult.fingerprint, gym_id: gymId, job_id: job.id }));
    return json({ discarded: true, job_id: job.id });
  }

  return json({ error: "invalid_request", detail: "action must be start|status|approve|discard" }, 400);
});
