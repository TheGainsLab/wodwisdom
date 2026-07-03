/**
 * gym-cohort-cron — regeneration of gym Engine Class cohort programs (task #5).
 *
 * Scheduled HOURLY by pg_cron so a fleet of gyms drains (the PER-GYM cadence is
 * monthly — regenerate when last_generated_at is null or 30d+ old). Each invocation
 * processes ONE gym (cohort generation is ~200s of LLM), then fire-and-forget
 * re-invokes itself so a burst of due gyms drains within a tick while each run stays
 * under the edge wall-clock.
 *
 * Per invocation, for the most-due eligible gym (claimed atomically):
 *   1. builds the cohort envelope (buildGymCohortEnvelope) from its gym_cohort_configs
 *      row + the movement vocabulary + a RAG methodology block,
 *   2. builds the roster (buildCohortRoster) from its active members' ONE PROFILE
 *      (athlete_profiles — Decision 1), NOT a per-surface intake copy,
 *   3. runs the Engine cohort pipeline in-process, persists via persistCohortResult,
 *   4. stamps success (last_generated_at) — or records a backoff on failure.
 *
 * SAFETY: every DB read is error-checked and ABORTS before the paid LLM run — a
 * failed read costs one retry, never a broken program stamped success + locked 30d.
 *
 * AUTH: verify_jwt=false (pg_cron can't mint a Supabase JWT), so the handler gates
 * itself on an X-Cron-Key header (GYM_COHORT_CRON_KEY). Unlike job-reaper, a stray
 * POST here is a paid LLM run + a duplicate program, so the endpoint is NOT open.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runEngineGeneration } from "../_shared/engine/run-engine.ts";
import { persistCohortResult } from "../_shared/cohort/persist-cohort-result.ts";
import { fetchVocabulary } from "../_shared/build-writer-payload.ts";
import { buildRagContext } from "../_shared/build-rag-context.ts";
import {
  buildGymCohortEnvelope,
  cohortReferenceLifts,
  type GymCohortConfig,
} from "../_shared/cohort/build-gym-cohort-envelope.ts";
import { buildCohortRoster, type CohortMemberIntake } from "../_shared/cohort/build-cohort-roster.ts";
import type { EngineGenerateRequest } from "../_shared/engine/contract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GYM_COHORT_CRON_KEY = Deno.env.get("GYM_COHORT_CRON_KEY");
const REGEN_AFTER_DAYS = 30;
const CLAIM_WINDOW_SECONDS = 900; // 15 min — longer than a generation; the dup guard.
// Exponential backoff for a failing gym: 30m, 1h, 2h, 4h … capped at 24h.
const BACKOFF_BASE_MS = 30 * 60_000;
const BACKOFF_CAP_MS = 24 * 60 * 60_000;

interface ConfigRow {
  gym_id: string;
  domain_pack: string;
  days_per_week: 3 | 4 | 5 | 6;
  session_length_minutes: number | null;
  equipment: string[];
  target_level: "beginner" | "intermediate" | "advanced";
  do_not_program: string[];
  units: "lbs" | "kg";
  goal_text: string | null;
  attempt_count: number;
}

interface InjuryConstraints {
  do_not_program?: string[] | null;
}

Deno.serve(async (req) => {
  // ── Auth: fail closed. A stray POST would cost a paid LLM run. ───────────────
  if (!GYM_COHORT_CRON_KEY) {
    return json({ error: "config_missing", detail: "GYM_COHORT_CRON_KEY not set" }, 500);
  }
  if (req.headers.get("x-cron-key") !== GYM_COHORT_CRON_KEY) {
    return json({ error: "forbidden" }, 401);
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const nowIso = new Date().toISOString();

  // ── Claim the most-due eligible gym atomically (dup-generation guard). ───────
  const { data: claimed, error: claimErr } = await supa.rpc("claim_due_gym_cohort", {
    p_regen_after_days: REGEN_AFTER_DAYS,
    p_claim_window_seconds: CLAIM_WINDOW_SECONDS,
  });
  if (claimErr) return json({ error: "claim_failed", detail: claimErr.message }, 500);
  const claimedRows = (claimed ?? []) as ConfigRow[];
  if (claimedRows.length === 0) return json({ message: "no gyms due" });
  const cfg = claimedRows[0];

  try {
    // ── Vocabulary — abort on a real read error (empty vocab burns 12 LLM passes). ─
    const { vocabulary, error: vocabErr } = await fetchVocabulary(supa, { onError: "signal" });
    if (vocabErr) throw new ReadError("movements", vocabErr);

    // ── Roster = members who joined this gym AND hold an active engine_cohort grant,
    //    with attributes sourced from the ONE PROFILE (athlete_profiles — Decision 1). ─
    const { data: grants, error: grantErr } = await supa
      .from("user_entitlements")
      .select("user_id")
      .eq("feature", "engine_cohort")
      .eq("granted_by", cfg.gym_id)
      .or("expires_at.is.null,expires_at.gt." + nowIso);
    if (grantErr) throw new ReadError("user_entitlements", grantErr.message);
    const grantedIds = new Set((grants ?? []).map((g) => (g as { user_id: string }).user_id));

    let members: CohortMemberIntake[] = [];
    let membersWithWeights = 0;
    if (grantedIds.size > 0) {
      const { data: links, error: linkErr } = await supa
        .from("member_gym_links")
        .select("user_id")
        .eq("gym_id", cfg.gym_id)
        .eq("status", "joined")
        .in("user_id", [...grantedIds]);
      if (linkErr) throw new ReadError("member_gym_links", linkErr.message);
      const rosterIds = (links ?? [])
        .map((l) => (l as { user_id: string }).user_id)
        .filter((id) => grantedIds.has(id));

      if (rosterIds.length > 0) {
        // ONE PROFILE: athlete attributes come from athlete_profiles, not a copy.
        const { data: profiles, error: profErr } = await supa
          .from("athlete_profiles")
          .select("user_id, gender, bodyweight, units, lifts, injuries_structured")
          .in("user_id", rosterIds);
        if (profErr) throw new ReadError("athlete_profiles", profErr.message);
        const byUser = new Map(
          (profiles ?? []).map((p) => [(p as { user_id: string }).user_id, p as Record<string, unknown>]),
        );

        members = rosterIds.map((userId) => {
          const p = byUser.get(userId);
          const lifts = (p?.lifts as Record<string, number | null> | null) ?? null;
          if (lifts && Object.values(lifts).some((v) => typeof v === "number" && v > 0)) membersWithWeights++;
          const injuries = p?.injuries_structured as InjuryConstraints | null;
          return {
            athlete_ref: userId,
            gender: (p?.gender as string | null) ?? null,
            bodyweight: (p?.bodyweight as number | null) ?? null,
            units: (p?.units as "lbs" | "kg" | null) ?? cfg.units,
            lifts,
            do_not_program: injuries?.do_not_program ?? null,
          };
        });
      }
    }

    // ── RAG methodology block for the reference class target (parity with retail). ─
    const rag = await buildRagContext(supa, cohortReferenceLifts(cfg.target_level, cfg.units), {});

    const gymConfig: GymCohortConfig = {
      days_per_week: cfg.days_per_week,
      session_length_minutes: cfg.session_length_minutes,
      equipment: cfg.equipment,
      target_level: cfg.target_level,
      do_not_program: cfg.do_not_program,
      units: cfg.units,
      goal_text: cfg.goal_text,
    };

    const envelope = buildGymCohortEnvelope(gymConfig, vocabulary, nowIso, { rag });
    const roster = buildCohortRoster(members, nowIso); // may be empty (shared program still generated, for F5)

    const engineReq: EngineGenerateRequest = {
      tenant_id: cfg.gym_id,
      mode: "cohort",
      domain_pack: cfg.domain_pack,
      athletes: roster,
      cohort: {
        shared_payload: envelope.shared_payload,
        shared_training_design_input: envelope.shared_training_design_input,
      },
    };

    const result = await runEngineGeneration(engineReq);
    const { cohort_program_id } = await persistCohortResult(supa, result);

    // ── Stamp success: reset the backoff so the gym waits a full cadence. ────────
    const { error: stampErr } = await supa
      .from("gym_cohort_configs")
      .update({ last_generated_at: nowIso, attempt_count: 0, next_attempt_at: null })
      .eq("gym_id", cfg.gym_id);
    if (stampErr) {
      // The generation succeeded + persisted; a failed stamp only risks an early
      // re-gen after the claim window — log loudly, don't fail the response.
      console.error("[gym-cohort-cron] success stamp failed:", cfg.gym_id, stampErr.message);
    }

    // ── Drain: re-invoke for the next due gym (fire-and-forget, one gym/tick budget). ─
    void selfReinvoke(req);

    return json({
      generated: true,
      gym_id: cfg.gym_id,
      cohort_program_id,
      members_scaled: roster.length,
      members_with_weights: membersWithWeights,
      safety: result.programs[0]?.safety,
    });
  } catch (e) {
    // Record a backoff so a persistently-failing gym rotates to the back of the
    // queue instead of starving the fleet head-of-line every tick.
    const backoffMs = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, cfg.attempt_count - 1), BACKOFF_CAP_MS);
    const nextAttemptIso = new Date(Date.now() + backoffMs).toISOString();
    await supa
      .from("gym_cohort_configs")
      .update({ next_attempt_at: nextAttemptIso })
      .eq("gym_id", cfg.gym_id)
      .then(() => {}, (err) => console.error("[gym-cohort-cron] backoff write failed:", err));

    const stage = e instanceof ReadError ? "read_failed" : "generation_failed";
    console.error("[gym-cohort-cron]", stage, cfg.gym_id, e);
    return json({ error: stage, gym_id: cfg.gym_id, detail: (e as Error).message, next_attempt_at: nextAttemptIso }, 500);
  }
});

/** A DB read failed — abort BEFORE any paid LLM work. */
class ReadError extends Error {
  constructor(table: string, detail: string) {
    super(`${table} read failed: ${detail}`);
    this.name = "ReadError";
  }
}

/** Fire-and-forget self re-invoke so a burst of due gyms drains within a tick. */
function selfReinvoke(req: Request): void {
  try {
    const url = new URL("/functions/v1/gym-cohort-cron", SUPABASE_URL).toString();
    // Don't await the body; a short timeout so a hung re-invoke can't wedge the run.
    fetch(url, {
      method: "POST",
      headers: { "X-Cron-Key": GYM_COHORT_CRON_KEY!, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
  } catch { /* best-effort drain */ }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
