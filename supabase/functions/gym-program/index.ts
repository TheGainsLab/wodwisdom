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
import { GymJobReadError, type GymJobConfig, startGymJob } from "../_shared/cohort/start-gym-job.ts";

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
const ACTIVE = ["processing", "awaiting_approval"];

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
      console.log(JSON.stringify({ at: "gym-program", event: "start", key_fp: authResult.fingerprint, gym_id: gymId, job_id: result.job_id }));
      return json({ started: true, job_id: result.job_id, members_scaled: result.members_scaled }, 202);
    } catch (e) {
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
    if (!res || !res.ok) {
      const detail = res ? await res.text().catch(() => "") : "gym-generate unreachable";
      return json({ error: "approve_failed", detail: detail.slice(0, 300) }, 502);
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
    // A skeleton parked for review is safe to cancel outright. A still-processing
    // job can't be truly killed mid-LLM, but flipping status stops the worker's
    // next token-gated commit and clears the in-flight guard so a fresh start
    // proceeds. (The worker checks status==='processing' before each stage.)
    const { error: updErr } = await supa
      .from("gym_program_jobs")
      .update({ status: "failed", error: "discarded by owner", next_stage: null, stage: null, updated_at: new Date().toISOString() })
      .eq("id", job.id);
    if (updErr) return json({ error: "discard_failed", detail: updErr.message }, 500);
    console.log(JSON.stringify({ at: "gym-program", event: "discard", key_fp: authResult.fingerprint, gym_id: gymId, job_id: job.id }));
    return json({ discarded: true, job_id: job.id });
  }

  return json({ error: "invalid_request", detail: "action must be start|status|approve|discard" }, 400);
});
