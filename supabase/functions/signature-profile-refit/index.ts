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
  /** row-level vector (intake/benchmark rows); null = resolve via signature */
  discrimination: Record<string, number> | null;
}

async function loadEvidence(
  supa: SupabaseClient,
  userId: string,
  params_draft_inflation: number | undefined,
  DEFAULT_NOISE_VAR: number,
): Promise<{ observations: EvidenceObservation[]; skipped: number; sourceMix: Record<string, number> }> {
  const { data: rows, error } = await supa
    .from("signature_evidence")
    .select("id, workout_signature_id, percentile, obs_noise_var, source, performed_at, discrimination")
    .eq("user_id", userId)
    .order("performed_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`ledger read failed: ${error.message}`);

  const ledger = (rows ?? []) as LedgerRow[];
  const sigIds = [...new Set(ledger.map((r) => r.workout_signature_id).filter(Boolean))] as string[];
  const discById = new Map<string, { disc: Record<string, number>; approved: boolean }>();
  if (sigIds.length > 0) {
    const { data: sigs, error: sigErr } = await supa
      .from("workout_signatures")
      .select("id, discrimination, status")
      .in("id", sigIds);
    if (sigErr) throw new Error(`signatures read failed: ${sigErr.message}`);
    for (const s of sigs ?? []) {
      const row = s as { id: string; discrimination: Record<string, number> | null; status: string };
      if (row.discrimination) {
        discById.set(row.id, { disc: row.discrimination, approved: row.status === "approved" });
      }
    }
  }

  const now = Date.now();
  const observations: EvidenceObservation[] = [];
  const sourceMix: Record<string, number> = {};
  let skipped = 0;
  for (const r of ledger) {
    const sig = r.workout_signature_id ? discById.get(r.workout_signature_id) : undefined;
    // a row-level vector (intake/benchmark evidence) needs no signature and
    // no draft inflation — its noise is already set by the standards config
    const rowDisc = r.discrimination && Object.keys(r.discrimination).length > 0
      ? r.discrimination
      : undefined;
    if ((!sig && !rowDisc) || r.percentile === null) {
      skipped++;
      continue;
    }
    const yearsAgo = Math.max(
      0,
      Math.floor((now - new Date(r.performed_at).getTime()) / (365.25 * 24 * 3600 * 1000)),
    );
    // Per-row noise: structure-scored rows (logged_solo) arrive pre-widened
    // from ingest (log-workout writes the deliberate obs_noise_var=400
    // placeholder, sd ~20, until scorescale_acceptance measures the real
    // error); leaderboard-grade rows carry null and get the params default.
    // On top of that, a DRAFT signature's weighting is an unreviewed
    // instrument (judge-hardening rule): inflate its rows' noise so drafts
    // inform but cannot dominate a profile.
    const draftInflation = (params_draft_inflation ?? 3.0);
    const baseNoise = r.obs_noise_var !== null ? Number(r.obs_noise_var) : undefined;
    const approved = rowDisc ? true : sig!.approved;
    const obsNoiseVar = approved
      ? baseNoise
      : (baseNoise ?? DEFAULT_NOISE_VAR) * draftInflation;
    observations.push({
      percentile: Number(r.percentile),
      discrimination: rowDisc ?? sig!.disc,
      yearsAgo,
      obsNoiseVar,
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

  // Library signatures: join by competition_workout_id when the signature
  // carries it (exact), name as fallback (naming drift risk, hence second).
  const { data: sigs } = await supa
    .from("workout_signatures")
    .select("id, name, competition_workout_id, evidence_hashes")
    .eq("source", "open");
  type SigRow = { id: string; name: string; competition_workout_id: string | null; evidence_hashes: string[] | null };
  const keyOf = (s: SigRow) => ({
    id: s.id,
    hash: s.evidence_hashes?.find((h) => h.startsWith("open_name_")) ??
      s.evidence_hashes?.[0] ?? `open_name_${s.name.toLowerCase()}`,
  });
  const sigByCompId = new Map<string, { id: string; hash: string }>();
  const sigByName = new Map<string, { id: string; hash: string }>();
  for (const s of (sigs ?? []) as SigRow[]) {
    if (s.competition_workout_id) sigByCompId.set(s.competition_workout_id, keyOf(s));
    sigByName.set(s.name.toLowerCase(), keyOf(s));
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
    // Scale check (review item 3, 2026-11-02): worldwide_percentile is
    // computed within workout_id, and competition workout_ids are
    // division-specific (one id per gender/division/year) — verified during
    // the research phase: the 222k-score extraction joined on these ids and
    // produced within-gender scales (mean ~48 per gender; gate-wall
    // percentiles differ by gender on the same workout, impossible under a
    // pooled scale). With scaled_tier filtered to 'rx' above, this matches
    // the open_rx_general cohort the model params were fitted on.
    const pct = r.result.worldwide_percentile;
    if (typeof pct !== "number" || !Number.isFinite(pct)) {
      skipped++;
      continue;
    }
    const sig = sigByCompId.get(r.competition_workout_id) ??
      sigByName.get(r.workout_name.toLowerCase());
    const row: Record<string, unknown> = {
      user_id: userId,
      workout_hash: sig?.hash ?? `open_name_${r.workout_name.toLowerCase()}`,
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
    };
    // Only set the signature link when resolved: an unresolved re-ingest
    // must never null out a link the retroactive claim pass established.
    if (sig) row.workout_signature_id = sig.id;
    rows.push(row);
  }
  if (rows.length === 0) return { upserted: 0, skipped };
  // Two batches with homogeneous keys: PostgREST applies the union of
  // payload columns, so a mixed batch would write nulls into the linked rows.
  const withSig = rows.filter((r) => "workout_signature_id" in r);
  const withoutSig = rows.filter((r) => !("workout_signature_id" in r));
  for (const batch of [withSig, withoutSig]) {
    if (batch.length === 0) continue;
    const { error } = await supa
      .from("signature_evidence")
      .upsert(batch, { onConflict: "user_id,source_ref" });
    if (error) return { error: error.message };
  }
  return { upserted: rows.length, skipped };
}

// ---------------------------------------------------------------- intake

interface IntakeStandard {
  axes: Record<string, number>;
  noise_var: number;
  lower_is_better?: boolean;
  men: { p50: number; p95: number };
  women: { p50: number; p95: number };
}

interface IntakeStandards {
  lifts: Record<string, IntakeStandard>;
  conditioning: Record<string, IntakeStandard>;
  skill_gates: Record<string, string>;
  pct_clamp: [number, number];
}

/** "7:45" | "7.45"? no — mm:ss or raw seconds (number|string) → seconds */
function parseTimeSeconds(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v !== "string") return null;
  const t = v.trim();
  const mmss = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (mmss) {
    const [, a, b, c] = mmss;
    return c !== undefined
      ? Number(a) * 3600 + Number(b) * 60 + Number(c)
      : Number(a) * 60 + Number(b);
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function anchorsPct(
  value: number,
  std: IntakeStandard,
  gender: "men" | "women",
  clamp: [number, number],
): number {
  const { p50, p95 } = std[gender];
  const span = p95 - p50;
  if (span === 0) return 50;
  const pct = 50 + 45 * ((value - p50) / span);
  return Math.min(clamp[1], Math.max(clamp[0], pct));
}

/**
 * DORMANT — NO CALL PATH (founder ruling, 2026-11-03): the Signature is
 * built from performance data (Open, future metcon results); the Profile
 * is the athlete's self-reported intake. They stay COMPLETELY DISCONNECTED
 * until the integration is designed properly. This function and the
 * intake_standards_v1 params row are kept as the starting point for that
 * work. Open design questions recorded in the design doc: anchor-scale
 * calibration against the real RX Open field (linked-user regression);
 * correlated anchor error (shared per-source bias term, not independent
 * rows); the arbitration rule between direct-but-scale-uncertain
 * declarations and blended-but-validated performance inference; and the
 * reference-population framing of self-reported numbers.
 *
 * Original design: declared intake → ledger evidence + gate possession
 * (build item 2, 2026-11-03). Lifts enter as bodyweight-ratio percentiles against the
 * editorial anchors (near-pure strength/oly vectors — the per-athlete
 * oly-vs-powerlifting split the Open provably cannot make); conditioning
 * times enter with the transference discount as widened noise; the skills
 * checklist sets gate switches (none → lacks, any level → has).
 * Idempotent via source_ref='intake:<key>'. Editorial standards are a
 * params row, replaced per-metric as platform regressions gain power.
 */
async function ingestIntake(
  supa: SupabaseClient,
  userId: string,
): Promise<{ upserted: number; gates_set: number; skipped: number } | { error: string }> {
  const { data: stdRow } = await supa
    .from("signature_model_params")
    .select("params")
    .eq("key", "intake_standards_v1")
    .maybeSingle();
  if (!stdRow) return { error: "NO_STANDARDS" };
  const std = stdRow.params as IntakeStandards;

  const { data: prof } = await supa
    .from("athlete_profiles")
    .select("lifts, conditioning, skills, bodyweight, gender, units")
    .eq("user_id", userId)
    .maybeSingle();
  if (!prof) return { error: "NO_PROFILE" };
  const row = prof as {
    lifts: Record<string, unknown> | null;
    conditioning: Record<string, unknown> | null;
    skills: Record<string, unknown> | null;
    bodyweight: number | null;
    gender: string | null;
    units: string | null;
  };
  const g = row.gender?.toLowerCase();
  const gender: "men" | "women" | null = g === "men" || g === "male"
    ? "men"
    : g === "women" || g === "female"
    ? "women"
    : null;
  if (!gender) return { error: "NO_GENDER" }; // anchors are gendered; no guessing

  const today = new Date().toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  // --- lifts: bodyweight ratios (units cancel: lift and bw share units)
  const bw = typeof row.bodyweight === "number" && row.bodyweight > 0 ? row.bodyweight : null;
  for (const [key, cfg] of Object.entries(std.lifts)) {
    const raw = (row.lifts ?? {})[key];
    const lift = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
    if (lift === null || bw === null) {
      skipped++;
      continue;
    }
    const pct = anchorsPct(lift / bw, cfg, gender, std.pct_clamp);
    rows.push({
      user_id: userId,
      workout_hash: `intake_${key}`,
      score_raw: { metric: key, value: lift, bodyweight: bw, units: row.units ?? null },
      percentile: pct,
      discrimination: cfg.axes,
      obs_noise_var: cfg.noise_var,
      source: "intake_declaration",
      cohort: "open_rx_general",
      performed_at: today,
      source_ref: `intake:${key}`,
    });
  }

  // --- conditioning: times vs anchors, faster = higher
  for (const [key, cfg] of Object.entries(std.conditioning)) {
    const secs = parseTimeSeconds((row.conditioning ?? {})[key]);
    if (secs === null) {
      skipped++;
      continue;
    }
    const value = cfg.lower_is_better ? -secs : secs;
    const anchors = {
      ...cfg,
      men: cfg.lower_is_better ? { p50: -cfg.men.p50, p95: -cfg.men.p95 } : cfg.men,
      women: cfg.lower_is_better ? { p50: -cfg.women.p50, p95: -cfg.women.p95 } : cfg.women,
    };
    const pct = anchorsPct(value, anchors as IntakeStandard, gender, std.pct_clamp);
    rows.push({
      user_id: userId,
      workout_hash: `intake_${key}`,
      score_raw: { metric: key, seconds: secs },
      percentile: pct,
      discrimination: cfg.axes,
      obs_noise_var: cfg.noise_var,
      source: "intake_declaration",
      cohort: "open_rx_general",
      performed_at: today,
      source_ref: `intake:${key}`,
    });
  }

  if (rows.length > 0) {
    const { error } = await supa
      .from("signature_evidence")
      .upsert(rows, { onConflict: "user_id,source_ref" });
    if (error) return { error: error.message };
  }

  // --- skills checklist → gate switches (declared facts, full weight)
  const skills = (row.skills ?? {}) as Record<string, unknown>;
  const level = (k: string): string | null => {
    const v = skills[k];
    return typeof v === "string" ? v : null;
  };
  const gateRows: Record<string, unknown>[] = [];
  for (const [skillKey, movement] of Object.entries(std.skill_gates)) {
    let lvl: string | null;
    if (skillKey === "pull_ups_any") {
      const ls = ["strict_pull_ups", "kipping_pull_ups", "butterfly_pull_ups"].map(level);
      lvl = ls.some((l) => l && l !== "none") ? "intermediate" : ls.every((l) => l === null) ? null : "none";
    } else {
      lvl = level(skillKey);
    }
    if (lvl === null) continue; // unanswered = unknown, write nothing
    gateRows.push({
      user_id: userId,
      movement,
      status: lvl === "none" ? "lacks" : "has",
      source: "intake_declaration",
      observed_at: today,
      updated_at: new Date().toISOString(),
    });
  }
  if (gateRows.length > 0) {
    const { error } = await supa
      .from("athlete_gate_possession")
      .upsert(gateRows, { onConflict: "user_id,movement" });
    if (error) return { error: error.message };
  }

  return { upserted: rows.length, gates_set: gateRows.length, skipped };
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
    const { observations, skipped, sourceMix } = await loadEvidence(
      supa,
      targetUserId,
      (params as SignatureModelParams & { draft_noise_inflation?: number }).draft_noise_inflation,
      params.noise_var_pct,
    );
    const profile = fitProfile(observations, params);

    const limiterTop2 = profile.limiterRanked.slice(0, 2).map((axis) => ({
      axis,
      p: profile.limiterPosterior[axis],
    }));

    // ── Persist (only when there is evidence; the bare prior is not a
    //    profile worth storing, and zero-depth users read the prior live) ──
    let persisted = false;
    let fitLogId: string | null = null;
    if (observations.length > 0) {
      const fittedAt = new Date().toISOString();
      const vectorRows = params.axes.map((axis, i) => ({
        user_id: targetUserId,
        axis,
        mean_pct: profile.axes[axis].mean,
        sd_pct: profile.axes[axis].sd,
        // the prior sd THIS fit shrank from — the display computes
        // resolution against it (never against client-side constants)
        prior_sd_pct: Math.sqrt(Math.max(params.prior_cov_pct[i][i], 0)),
        n_evidence: observations.length,
        source_mix: sourceMix,
        model_params_key: paramsKey,
        fitted_at: fittedAt,
      }));
      const { error: upsertErr } = await supa
        .from("athlete_capability_vectors")
        .upsert(vectorRows, { onConflict: "user_id,axis" });
      if (upsertErr) return json({ error: "PERSIST_FAILED", detail: upsertErr.message }, 500);
      // The profile header: level + full ranked limiter posterior, so the
      // dial display reads storage, never a live refit.
      const { error: headerErr } = await supa
        .from("athlete_signature_profiles")
        .upsert({
          user_id: targetUserId,
          cohort: (params as SignatureModelParams & { cohort?: string }).cohort ?? "open_rx_general",
          level_mean: profile.level.mean,
          level_sd: profile.level.sd,
          limiter: profile.limiterRanked.map((axis) => ({
            axis,
            p: profile.limiterPosterior[axis],
          })),
          n_evidence: observations.length,
          model_params_key: paramsKey,
          fitted_at: fittedAt,
        }, { onConflict: "user_id" });
      if (headerErr) return json({ error: "PERSIST_FAILED", detail: headerErr.message }, 500);
      // Append-only research record (story-layer spec item 5): the fit log
      // accumulates every production fit for concordance capture and
      // params-version drift monitoring. Best-effort — never fails the fit.
      const { data: logRow, error: logErr } = await supa.from("signature_fit_log").insert({
        user_id: targetUserId,
        fitted_at: fittedAt,
        params_key: paramsKey,
        n_evidence: observations.length,
        level_mean: profile.level.mean,
        level_sd: profile.level.sd,
        axes: profile.axes,
        limiter: profile.limiterRanked.map((axis) => ({
          axis,
          p: profile.limiterPosterior[axis],
        })),
        source_mix: sourceMix,
      }).select("id").single();
      if (logErr) console.warn("fit-log append failed:", logErr.message);
      fitLogId = (logRow as { id: string } | null)?.id ?? null;
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
      fit_log_id: fitLogId,
      open_ingest: openIngest,
    });
  } catch (e) {
    console.error("signature-profile-refit error:", e);
    return json({ error: "INTERNAL", detail: String(e) }, 500);
  }
});
