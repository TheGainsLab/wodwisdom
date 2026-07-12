/**
 * cohort/load-latest-program.ts — the gym's CURRENT (live) program.
 *
 * Moved verbatim from _shared/engine-class/queries.ts in the Decision 11 class
 * sweep: this read serves the GYM PROGRAM GENERATION product (the portal review
 * desk / gym-program), not Engine Class, so it survives the sweep.
 *
 * NOT simply "newest row in engine_cohort_programs" — that would publish a
 * discarded draft. persistCohortResult inserts the program row inside the
 * saving stage BODY, before the fenced commit; so a job discarded mid-save
 * still leaves a program row behind. The fenced signal is
 * gym_program_jobs.cohort_program_id, which is written ONLY in the gated
 * complete commit (a discarded/superseded worker's commit no-ops). So the live
 * program is the one belonging to the newest COMPLETE job — publication depends
 * on the same fenced commit the review desk's approve drives.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WriterOutput } from "../v2-output-schema.ts";

export interface CohortProgram {
  id: string;
  shared_output: WriterOutput;
  created_at: string;
}

export async function loadLatestProgram(supa: SupabaseClient, gymId: string): Promise<CohortProgram | null> {
  const { data: jobRow, error: jobErr } = await supa
    .from("gym_program_jobs")
    .select("cohort_program_id")
    .eq("gym_id", gymId)
    .eq("status", "complete")
    .not("cohort_program_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobErr) throw new Error(`gym_program_jobs read failed: ${jobErr.message}`);
  const cohortProgramId = (jobRow as { cohort_program_id: string } | null)?.cohort_program_id;
  if (!cohortProgramId) return null;

  const { data, error } = await supa
    .from("engine_cohort_programs")
    .select("id, shared_output, created_at")
    .eq("id", cohortProgramId)
    .eq("tenant_id", gymId) // defense-in-depth: the program must belong to this gym
    .maybeSingle();
  if (error) throw new Error(`engine_cohort_programs read failed: ${error.message}`);
  return (data as CohortProgram | null) ?? null;
}
