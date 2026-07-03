/**
 * gym-cohort-cron — monthly regeneration of gym Engine Class cohort programs
 * (task #5). Reuses the monthly-cron pattern: verify_jwt=false, service-role,
 * called by pg_cron; no custom auth (intra-project).
 *
 * For the most-due active gym (last_generated_at null or 30d+ old): builds the
 * cohort envelope (buildGymCohortEnvelope) from its gym_cohort_configs row + the
 * movement vocabulary, builds the roster (buildCohortRoster) from its active
 * members' engine_intake, runs the Engine cohort pipeline in-process, and
 * persists via the shared persistCohortResult.
 *
 * WALL-CLOCK: cohort generation is ONE LLM program (~200s) + N deterministic
 * scalings. Processing ONE gym per invocation keeps it under the edge wall-clock;
 * schedule the cron frequently (e.g. hourly) so a fleet of gyms drains over time.
 * A resumable dispatcher (as generate-program-v3 uses) is the scale path — not
 * needed at pilot scale, flagged for later.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runEngineGeneration } from "../_shared/engine/run-engine.ts";
import { persistCohortResult } from "../_shared/cohort/persist-cohort-result.ts";
import {
  buildGymCohortEnvelope,
  type GymCohortConfig,
} from "../_shared/cohort/build-gym-cohort-envelope.ts";
import { buildCohortRoster, type CohortMemberIntake } from "../_shared/cohort/build-cohort-roster.ts";
import type { EngineGenerateRequest } from "../_shared/engine/contract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REGEN_AFTER_DAYS = 30;

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
}

Deno.serve(async (_req) => {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - REGEN_AFTER_DAYS * 86400_000).toISOString();

  // Most-due active gym (never-generated first). ONE per invocation (wall-clock).
  const { data: cfgs, error: cfgErr } = await supa
    .from("gym_cohort_configs")
    .select("gym_id, domain_pack, days_per_week, session_length_minutes, equipment, target_level, do_not_program, units, goal_text")
    .eq("active", true)
    .or(`last_generated_at.is.null,last_generated_at.lt.${cutoff}`)
    .order("last_generated_at", { ascending: true, nullsFirst: true })
    .limit(1);
  if (cfgErr) return json({ error: "config_query_failed", detail: cfgErr.message }, 500);
  if (!cfgs || cfgs.length === 0) return json({ message: "no gyms due" });

  const cfg = cfgs[0] as ConfigRow;

  try {
    // Movement vocabulary — the writer's allowed-movement set (audit rule #7).
    const { data: mv } = await supa.from("movements").select("display_name").order("display_name");
    const vocabulary = (mv ?? [])
      .map((r) => (r as { display_name: unknown }).display_name)
      .filter((s): s is string => typeof s === "string" && s.length > 0);

    // Roster = members who joined this gym AND hold an active engine_cohort grant.
    const { data: grants } = await supa
      .from("user_entitlements")
      .select("user_id")
      .eq("feature", "engine_cohort")
      .eq("granted_by", cfg.gym_id)
      .or("expires_at.is.null,expires_at.gt." + nowIso);
    const activeUserIds = new Set((grants ?? []).map((g) => (g as { user_id: string }).user_id));

    let members: CohortMemberIntake[] = [];
    if (activeUserIds.size > 0) {
      const { data: links } = await supa
        .from("member_gym_links")
        .select("user_id, engine_intake")
        .eq("gym_id", cfg.gym_id)
        .in("user_id", [...activeUserIds]);
      members = (links ?? []).map((l) => {
        const row = l as { user_id: string; engine_intake: Record<string, unknown> | null };
        const intake = row.engine_intake ?? {};
        return {
          athlete_ref: row.user_id,
          gender: (intake.gender as string | null) ?? null,
          bodyweight: (intake.bodyweight as number | null) ?? null,
          units: (intake.units as "lbs" | "kg" | null) ?? cfg.units,
          lifts: (intake.lifts as Record<string, number | null> | null) ?? null,
          do_not_program: (intake.do_not_program as string[] | null) ?? null,
        };
      });
    }

    const gymConfig: GymCohortConfig = {
      tenant_id: cfg.gym_id,
      days_per_week: cfg.days_per_week,
      session_length_minutes: cfg.session_length_minutes,
      equipment: cfg.equipment,
      target_level: cfg.target_level,
      do_not_program: cfg.do_not_program,
      units: cfg.units,
      goal_text: cfg.goal_text,
    };

    const envelope = buildGymCohortEnvelope(gymConfig, vocabulary, nowIso);
    const roster = buildCohortRoster(members, nowIso); // may be empty (shared program still generated, for F5)

    const req: EngineGenerateRequest = {
      tenant_id: cfg.gym_id,
      mode: "cohort",
      domain_pack: cfg.domain_pack,
      athletes: roster,
      cohort: {
        shared_payload: envelope.shared_payload,
        shared_training_design_input: envelope.shared_training_design_input,
      },
    };

    const result = await runEngineGeneration(req);
    const { cohort_program_id } = await persistCohortResult(supa, result);

    await supa.from("gym_cohort_configs").update({ last_generated_at: nowIso }).eq("gym_id", cfg.gym_id);

    return json({
      generated: true,
      gym_id: cfg.gym_id,
      cohort_program_id,
      members_scaled: roster.length,
      safety: result.programs[0]?.safety,
    });
  } catch (e) {
    console.error("[gym-cohort-cron]", cfg.gym_id, e);
    return json({ error: "generation_failed", gym_id: cfg.gym_id, detail: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
