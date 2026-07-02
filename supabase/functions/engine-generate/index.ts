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
 *   - Auth is a single shared ENGINE_SERVICE_KEY (server-to-server). Per-consumer
 *     keys + rate limiting (the data-service pattern) are Phase 4.
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
import { runEngineGeneration } from "../_shared/engine/run-engine.ts";
import type { EngineGenerateRequest } from "../_shared/engine/contract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENGINE_SERVICE_KEY = Deno.env.get("ENGINE_SERVICE_KEY");

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Auth — shared service key (server-to-server; per-consumer keys are Phase 4).
  if (!ENGINE_SERVICE_KEY) return json({ error: "config_missing_engine_key" }, 500);
  if (req.headers.get("x-service-key") !== ENGINE_SERVICE_KEY) {
    return json({ error: "forbidden" }, 401);
  }

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
  if (reqBody.mode === "cohort" && !reqBody.cohort) {
    return json({ error: "invalid_request", detail: "cohort mode requires `cohort`" }, 400);
  }

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
        console.error("[engine-generate] member scaling persist failed:", scalingErr);
        return json({ error: "persist_failed", detail: scalingErr.message }, 500);
      }

      return json({ ...result, cohort_program_id: cohortProgramId }, 200);
    }

    // Adaptive: return the audited artifact(s); the caller persists.
    return json(result, 200);
  } catch (err) {
    console.error("[engine-generate] generation failed:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return json({ error: "generation_failed", message }, 500);
  }
});
