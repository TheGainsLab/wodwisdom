/**
 * signature-profile-refit — fit (or refit) an athlete's capability profile
 * from their evidence ledger. The service wrapper around the pure model in
 * _shared/signature-profile-fit.ts (ported 1:1 from the validated research
 * pipeline; see the Workout Signatures design doc, 2026-11-02 entries).
 *
 * The contract the architecture rests on: signature_evidence rows are the
 * source of truth, athlete_capability_vectors is a recomputable summary.
 * This function IS the recompute — idempotent, safe to re-run any time the
 * ledger, the signatures, or the model parameters change.
 *
 * Auth: a logged-in athlete refits themself. An admin may pass user_id to
 * refit any athlete (ops/backfill path).
 *
 * Request (POST JSON), all fields optional:
 *   { "user_id": "<uuid>",            // admin only; default = caller
 *     "params_key": "open_rx_general_v1" }
 *
 * Response (200):
 *   {
 *     "level": { "mean": 61.2, "sd": 4.1 },
 *     "axes": { "<axis>": { "mean": -7.3, "sd": 9.8 }, ... },   // RELATIVE dials
 *     "limiter_top2": [ { "axis": "...", "p": 0.41 }, { ... } ],
 *     "n_evidence": 17,
 *     "n_skipped_unsigned": 2,   // ledger rows with no usable signature yet
 *     "params_key": "open_rx_general_v1",
 *     "persisted": true
 *   }
 *
 * With an empty ledger the response is the population prior (wide sds,
 * limiter = population distribution) and nothing is persisted — the
 * Bayesian-naming behavior the limiter validation requires at zero depth.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  type EvidenceObservation,
  fitProfile,
  type SignatureModelParams,
} from "../_shared/signature-profile-fit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_PARAMS_KEY = "open_rx_general_v1";

interface LedgerRow {
  id: string;
  workout_signature_id: string | null;
  percentile: number | null;
  obs_noise_var: number | null;
  source: string;
  performed_at: string;
}

async function loadEvidence(
  supa: SupabaseClient,
  userId: string,
): Promise<{ observations: EvidenceObservation[]; skipped: number; sourceMix: Record<string, number> }> {
  const { data: rows, error } = await supa
    .from("signature_evidence")
    .select("id, workout_signature_id, percentile, obs_noise_var, source, performed_at")
    .eq("user_id", userId)
    .order("performed_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`ledger read failed: ${error.message}`);

  const ledger = (rows ?? []) as LedgerRow[];
  const sigIds = [...new Set(ledger.map((r) => r.workout_signature_id).filter(Boolean))] as string[];
  const discById = new Map<string, Record<string, number>>();
  if (sigIds.length > 0) {
    const { data: sigs, error: sigErr } = await supa
      .from("workout_signatures")
      .select("id, discrimination, status")
      .in("id", sigIds);
    if (sigErr) throw new Error(`signatures read failed: ${sigErr.message}`);
    for (const s of sigs ?? []) {
      const row = s as { id: string; discrimination: Record<string, number> | null; status: string };
      // drafts are usable evidence but only approved rows at full weight is a
      // judge-hardening concern; v1: any signature with a discrimination vector
      if (row.discrimination) discById.set(row.id, row.discrimination);
    }
  }

  const now = Date.now();
  const observations: EvidenceObservation[] = [];
  const sourceMix: Record<string, number> = {};
  let skipped = 0;
  for (const r of ledger) {
    const disc = r.workout_signature_id ? discById.get(r.workout_signature_id) : undefined;
    if (!disc || r.percentile === null) {
      skipped++;
      continue;
    }
    const yearsAgo = Math.max(
      0,
      Math.floor((now - new Date(r.performed_at).getTime()) / (365.25 * 24 * 3600 * 1000)),
    );
    observations.push({
      percentile: Number(r.percentile),
      discrimination: disc,
      yearsAgo,
      obsNoiseVar: r.obs_noise_var !== null ? Number(r.obs_noise_var) : undefined,
    });
    sourceMix[r.source] = (sourceMix[r.source] ?? 0) + 1;
  }
  return { observations, skipped, sourceMix };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    // ── Auth ─────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "UNAUTHORIZED" }, 401);
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "UNAUTHORIZED" }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    let targetUserId = user.id;
    if (typeof body.user_id === "string" && body.user_id !== user.id) {
      const { data: profile } = await supa
        .from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (profile?.role !== "admin") return json({ error: "FORBIDDEN" }, 403);
      targetUserId = body.user_id;
    }

    // ── Model parameters ─────────────────────────────────────────────────
    const paramsKey = typeof body.params_key === "string" ? body.params_key : DEFAULT_PARAMS_KEY;
    const { data: paramsRow, error: paramsErr } = await supa
      .from("signature_model_params")
      .select("params")
      .eq("key", paramsKey)
      .maybeSingle();
    if (paramsErr || !paramsRow) return json({ error: "PARAMS_NOT_FOUND", key: paramsKey }, 400);
    const params = paramsRow.params as SignatureModelParams;

    // ── Evidence → fit ───────────────────────────────────────────────────
    const { observations, skipped, sourceMix } = await loadEvidence(supa, targetUserId);
    const profile = fitProfile(observations, params);

    const limiterTop2 = profile.limiterRanked.slice(0, 2).map((axis) => ({
      axis,
      p: profile.limiterPosterior[axis],
    }));

    // ── Persist (only when there is evidence; the bare prior is not a
    //    profile worth storing, and zero-depth users read the prior live) ──
    let persisted = false;
    if (observations.length > 0) {
      const fittedAt = new Date().toISOString();
      const vectorRows = params.axes.map((axis) => ({
        user_id: targetUserId,
        axis,
        mean_pct: profile.axes[axis].mean,
        sd_pct: profile.axes[axis].sd,
        n_evidence: observations.length,
        source_mix: sourceMix,
        model_params_key: paramsKey,
        fitted_at: fittedAt,
      }));
      const { error: upsertErr } = await supa
        .from("athlete_capability_vectors")
        .upsert(vectorRows, { onConflict: "user_id,axis" });
      if (upsertErr) return json({ error: "PERSIST_FAILED", detail: upsertErr.message }, 500);
      persisted = true;
    }

    return json({
      level: profile.level,
      axes: profile.axes,
      limiter_top2: limiterTop2,
      n_evidence: observations.length,
      n_skipped_unsigned: skipped,
      params_key: paramsKey,
      persisted,
    });
  } catch (e) {
    console.error("signature-profile-refit error:", e);
    return json({ error: "INTERNAL", detail: String(e) }, 500);
  }
});
