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
import {
  fetchTier4Bundle,
  type Tier4AllResultsEntry,
} from "../_shared/fetch-tier4-bundle.ts";

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

/**
 * Open-history ingestion: pull the linked athlete's career results from the
 * competition service and land each RX Open score as an open_linked ledger
 * row joined to its library signature by name. Idempotent via
 * (user_id, source_ref='open:<competition_workout_id>'); leaderboard-grade
 * percentiles carry no obs_noise_var override (the params default — the
 * repeat-measured per-score noise — applies). Returns rows upserted.
 */
async function ingestOpenHistory(
  supa: SupabaseClient,
  userId: string,
): Promise<{ upserted: number; skipped: number } | { error: string }> {
  const { data: ap } = await supa
    .from("athlete_profiles")
    .select("competition_athlete_id")
    .eq("user_id", userId)
    .maybeSingle();
  const competitorId = (ap as { competition_athlete_id: string | null } | null)
    ?.competition_athlete_id;
  if (!competitorId) return { error: "NOT_LINKED" };

  const bundle = await fetchTier4Bundle(competitorId, { include: ["all_results"] });
  const results = (bundle?.all_results ?? []) as Tier4AllResultsEntry[];
  if (results.length === 0) return { upserted: 0, skipped: 0 };

  // Library signatures by lowercased name ('open' source only).
  const { data: sigs } = await supa
    .from("workout_signatures")
    .select("id, name, evidence_hashes")
    .eq("source", "open");
  const sigByName = new Map<string, { id: string; hash: string }>();
  for (const s of (sigs ?? []) as Array<{ id: string; name: string; evidence_hashes: string[] | null }>) {
    sigByName.set(s.name.toLowerCase(), {
      id: s.id,
      hash: s.evidence_hashes?.[0] ?? `open_name_${s.name.toLowerCase()}`,
    });
  }

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of results) {
    // v1 cohort match: the model params are fitted on the RX Open general
    // field; scaled divisions join when cohort-specific discrimination ships.
    if (r.stage !== "open" || r.scaled_tier !== "rx" || !r.result?.valid) {
      skipped++;
      continue;
    }
    const pct = r.result.worldwide_percentile;
    if (typeof pct !== "number" || !Number.isFinite(pct)) {
      skipped++;
      continue;
    }
    const sig = sigByName.get(r.workout_name.toLowerCase());
    rows.push({
      user_id: userId,
      workout_hash: sig?.hash ?? `open_name_${r.workout_name.toLowerCase()}`,
      workout_signature_id: sig?.id ?? null,
      score_raw: {
        raw_score: r.result.raw_score,
        raw_score_text: r.result.raw_score_text,
        scoring_unit: r.result.scoring_unit,
        year: r.year,
        workout_name: r.workout_name,
      },
      percentile: Math.min(Math.max(pct, 0), 100),
      source: "open_linked",
      signature_version: null,
      cohort: "open_rx_general",
      // The Open runs Feb-Mar; month precision is all the aging curve needs.
      performed_at: `${r.year}-03-01`,
      source_ref: `open:${r.competition_workout_id}`,
    });
  }
  if (rows.length === 0) return { upserted: 0, skipped };
  const { error } = await supa
    .from("signature_evidence")
    .upsert(rows, { onConflict: "user_id,source_ref" });
  if (error) return { error: error.message };
  return { upserted: rows.length, skipped };
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

    // ── Optional: sync Open history into the ledger first ───────────────
    // Explicit opt-in (link/refresh flows pass it); the bundle fetch is a
    // cross-service call and the ledger is the durable copy.
    let openIngest: { upserted: number; skipped: number } | { error: string } | null = null;
    if (body.ingest_open === true) {
      openIngest = await ingestOpenHistory(supa, targetUserId);
    }

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
      open_ingest: openIngest,
    });
  } catch (e) {
    console.error("signature-profile-refit error:", e);
    return json({ error: "INTERNAL", detail: String(e) }, 500);
  }
});
