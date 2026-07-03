/**
 * engine-generate — the standalone Engine API entrypoint (ENGINE_API_CONTRACT.md).
 *
 * POST body = EngineGenerateRequest: { tenant_id, mode, domain_pack, model_profile?,
 * corpus_scope?, athletes[], cohort? }. Runs the Engine (payload + coaching strategy
 * in → audited artifact out) and, for cohort mode, persists the shared program +
 * per-member scaling to the Engine-owned tables (F10 raw material).
 *
 * This is the seam the gym channel (F2/F3/F7) consumes. wodwisdom's own
 * generate-program-v3 uses the same pipeline via its resumable dispatcher; this is
 * the external-shaped door.
 *
 * v1 scope (flagged in the phase report, docs/portfolio/):
 *   - Auth: keys are compared in constant time (over SHA-256 digests) and bound to
 *     a tenant. ENGINE_SERVICE_KEY is the unrestricted internal/admin key (any
 *     tenant); ENGINE_CONSUMER_KEYS is an optional { key: tenant|tenant[] } map — a
 *     consumer key may ONLY write its bound tenant. The DB-backed consumer_keys
 *     registry + rate limiting (the data-service pattern) are Phase 4.
 *   - Runs SYNCHRONOUSLY and returns the result (no async job model here — the
 *     heavy resumable path lives in generate-program-v3). Batch/heavy adaptive
 *     runs can approach the edge wall-clock; the async job contract is a follow-up.
 *   - corpus_scope + model_profile are accepted but not yet threaded into the
 *     pipeline (RAG is baked into the payload upstream; the pipeline uses the
 *     default model profile). Reserved so callers don't change later.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createConsumerAuth } from "../_shared/consumer-auth.ts";
import { runEngineGeneration } from "../_shared/engine/run-engine.ts";
import type { EngineGenerateRequest } from "../_shared/engine/contract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Constant-time, tenant-bound consumer-key auth (shared with wholesale-grants).
// ENGINE_SERVICE_KEY = unrestricted internal/admin key (any tenant);
// ENGINE_CONSUMER_KEYS = optional { key: tenant|tenant[] } map — a consumer key
// may ONLY write its bound tenant(s). See _shared/consumer-auth.ts.
const auth = createConsumerAuth({
  serviceKey: Deno.env.get("ENGINE_SERVICE_KEY"),
  consumerKeysRaw: Deno.env.get("ENGINE_CONSUMER_KEYS"),
  label: "engine-generate",
});

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Auth — constant-time, tenant-bound. Admin key = any tenant; consumer key =
  // its bound tenant(s), enforced against the request's tenant_id below.
  if (!auth.configured()) {
    return json({ error: "config_missing_engine_key" }, 500);
  }
  const presentedKey = req.headers.get("x-service-key");
  if (!presentedKey) return json({ error: "forbidden" }, 401);
  const authz = await auth.authorizeKey(presentedKey);
  if (!authz) return json({ error: "forbidden" }, 401);

  let reqBody: EngineGenerateRequest;
  try {
    reqBody = await req.json() as EngineGenerateRequest;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ── Validate the contract envelope ─────────────────────────────────────────
  if (!reqBody.tenant_id || typeof reqBody.tenant_id !== "string") {
    return json({ error: "invalid_request", detail: "tenant_id required" }, 400);
  }
  if (reqBody.mode !== "adaptive" && reqBody.mode !== "cohort") {
    return json({ error: "invalid_request", detail: "mode must be adaptive|cohort" }, 400);
  }
  if (!reqBody.domain_pack || typeof reqBody.domain_pack !== "string") {
    return json({ error: "invalid_request", detail: "domain_pack required" }, 400);
  }
  if (!Array.isArray(reqBody.athletes) || reqBody.athletes.length === 0) {
    return json({ error: "invalid_request", detail: "athletes[] must be non-empty" }, 400);
  }

  // Tenant binding — a consumer key may only write its bound tenant(s).
  if (!auth.authorizes(authz, reqBody.tenant_id)) {
    return json({ error: "tenant_forbidden", detail: "key not authorized for tenant_id" }, 403);
  }

  // Every athlete needs a non-empty ref, and refs must be unique — a duplicate
  // ref would collide on engine_member_scaling's UNIQUE(cohort_program_id,
  // athlete_ref) and 500 AFTER the (paid) generation.
  const refs = reqBody.athletes.map((a) => a?.athlete_ref);
  if (refs.some((r) => !r || typeof r !== "string")) {
    return json({ error: "invalid_request", detail: "each athlete needs an athlete_ref" }, 400);
  }
  if (new Set(refs).size !== refs.length) {
    return json({ error: "invalid_request", detail: "duplicate athlete_ref in athletes[]" }, 400);
  }

  // Adaptive is single-athlete (a sequential batch would blow the edge wall-clock
  // and discard paid work). A roster goes through cohort mode.
  if (reqBody.mode === "adaptive" && reqBody.athletes.length > 1) {
    return json({ error: "invalid_request", detail: "adaptive mode is single-athlete; use cohort mode for a roster" }, 400);
  }

  // Cohort needs its shared spec up front — validate before burning an LLM call.
  if (reqBody.mode === "cohort") {
    const c = reqBody.cohort;
    if (!c || !c.shared_payload || !c.shared_training_design_input) {
      return json({ error: "invalid_request", detail: "cohort mode requires cohort.shared_payload + shared_training_design_input" }, 400);
    }
  }

  // Contract fields accepted but not yet threaded into the pipeline (Phase 2a).
  // Echo them back so a caller never assumes silent honoring — the corpus_scope
  // one is the white-label trap.
  const ignoredFields: string[] = [];
  if (reqBody.corpus_scope) ignoredFields.push("corpus_scope");
  if (reqBody.model_profile) ignoredFields.push("model_profile");
  if (reqBody.athletes.some((a) => a?.continuation)) ignoredFields.push("continuation");
  if (reqBody.corpus_scope?.include_baseline === false) {
    console.warn("[engine-generate] corpus_scope.include_baseline=false requested, but pure white-label (no baseline corpus) is not yet implemented; the baseline still applies (Phase 2a)");
  }

  // Structured request log (key fingerprint only — never the key itself).
  console.log(JSON.stringify({
    at: "engine-generate",
    event: "request",
    key_fp: await auth.fingerprint(presentedKey),
    scope: authz === "*" ? "admin" : "bound",
    tenant_id: reqBody.tenant_id,
    mode: reqBody.mode,
    domain_pack: reqBody.domain_pack,
    athletes: reqBody.athletes.length,
    ignored_fields: ignoredFields,
  }));

  try {
    const result = await runEngineGeneration(reqBody);

    // Cohort: persist the shared program + per-member scaling (Engine-owned tables).
    if (result.mode === "cohort" && result.scalings) {
      const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const shared = result.programs[0];
      const { data: prog, error: progErr } = await supa
        .from("engine_cohort_programs")
        .insert({
          tenant_id: result.tenant_id,
          domain_pack: result.domain_pack,
          shared_output: shared.output,
          skeleton: shared.skeleton,
          meta: { safety: shared.safety, residual_audit_failures: shared.residual_audit_failures },
        })
        .select("id")
        .single();
      if (progErr || !prog) {
        console.error("[engine-generate] cohort program persist failed:", progErr);
        return json({ error: "persist_failed", detail: progErr?.message }, 500);
      }
      const cohortProgramId = prog.id as string;

      const rows = result.scalings.map((s) => ({
        cohort_program_id: cohortProgramId,
        tenant_id: result.tenant_id,
        athlete_ref: s.athlete_ref,
        weight_unit: s.weight_unit,
        tier: s.tier,
        substitutions_pending: s.substitutions_pending,
        scaled_movements: s.scaled_movements,
      }));
      const { error: scalingErr } = await supa.from("engine_member_scaling").insert(rows);
      if (scalingErr) {
        // Roll back the orphaned parent so a retry starts clean (CASCADE clears
        // any partially-inserted scaling rows).
        console.error("[engine-generate] member scaling persist failed:", scalingErr);
        await supa.from("engine_cohort_programs").delete().eq("id", cohortProgramId)
          .then(() => {}, () => {});
        return json({ error: "persist_failed", detail: scalingErr.message }, 500);
      }

      // Return the id + a compact summary, not the full N scaling arrays (the
      // caller reads the rows back by cohort_program_id when it needs detail).
      return json({
        mode: result.mode,
        tenant_id: result.tenant_id,
        domain_pack: result.domain_pack,
        cohort_program_id: cohortProgramId,
        program: {
          safety: shared.safety,
          residual_audit_failures: shared.residual_audit_failures,
        },
        scaling_summary: result.scalings.map((s) => ({
          athlete_ref: s.athlete_ref,
          tier: s.tier,
          substitutions_pending: s.substitutions_pending,
          movements: s.scaled_movements.length,
        })),
        ignored_fields: ignoredFields,
      }, 200);
    }

    // Adaptive: return the audited artifact(s); the caller persists.
    return json({ ...result, ignored_fields: ignoredFields }, 200);
  } catch (err) {
    console.error("[engine-generate] generation failed:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return json({ error: "generation_failed", message }, 500);
  }
});
