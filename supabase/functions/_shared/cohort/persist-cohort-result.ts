/**
 * cohort/persist-cohort-result.ts — persist a cohort EngineGenerateResult.
 *
 * The ONE place the shared cohort program + per-member scaling land in the
 * Engine-owned tables (engine_cohort_programs + engine_member_scaling). Shared by
 * engine-generate (the on-demand HTTP path) and gym-cohort-cron (the monthly
 * regeneration path) so the two can't drift. Throws on failure, rolling back the
 * orphaned parent so a retry starts clean.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { EngineGenerateResult } from "../engine/contract.ts";

export async function persistCohortResult(
  supa: SupabaseClient,
  result: EngineGenerateResult,
): Promise<{ cohort_program_id: string }> {
  if (result.mode !== "cohort" || !result.scalings) {
    throw new Error("persistCohortResult: not a cohort result");
  }
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
    // Full Postgres error (code/details/hint) — operators need it the first time a
    // persist fails in production; .message alone drops the diagnostic fields.
    console.error("[persist-cohort-result] engine_cohort_programs insert failed:", progErr);
    throw new Error(`cohort program persist failed: ${progErr?.message ?? "no row"}`);
  }
  const cohortProgramId = (prog as { id: string }).id;

  const rows = result.scalings.map((s) => ({
    cohort_program_id: cohortProgramId,
    tenant_id: result.tenant_id,
    athlete_ref: s.athlete_ref,
    weight_unit: s.weight_unit,
    tier: s.tier,
    substitutions_pending: s.substitutions_pending,
    scaled_movements: s.scaled_movements,
  }));
  // An empty roster is legal (cohort still generates the shared program for F5) — no
  // scaling rows to write, and PostgREST rejects an empty insert payload.
  if (rows.length === 0) return { cohort_program_id: cohortProgramId };
  const { error: scalingErr } = await supa.from("engine_member_scaling").insert(rows);
  if (scalingErr) {
    console.error("[persist-cohort-result] engine_member_scaling insert failed:", scalingErr);
    // Roll back the orphaned parent so a retry starts clean (CASCADE clears any
    // partially-inserted scaling rows).
    await supa.from("engine_cohort_programs").delete().eq("id", cohortProgramId).then(() => {}, () => {});
    throw new Error(`member scaling persist failed: ${scalingErr.message}`);
  }
  return { cohort_program_id: cohortProgramId };
}
