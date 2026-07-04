/**
 * engine-class/queries.ts — the service-role DB reads shared by the F4/F5 edge
 * functions (view, log, leaderboard, entries, TV). Kept in one place so the cohort
 * program selection + entry/profile hydration can't drift between surfaces.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WriterOutput } from "../v2-output-schema.ts";
import type { LeaderboardEntry, ProfileInfo } from "./leaderboard.ts";

export interface CohortProgram {
  id: string;
  shared_output: WriterOutput;
  created_at: string;
}

/** The gym's CURRENT cohort program (latest by created_at). Null when none yet. */
export async function loadLatestProgram(supa: SupabaseClient, gymId: string): Promise<CohortProgram | null> {
  const { data, error } = await supa
    .from("engine_cohort_programs")
    .select("id, shared_output, created_at")
    .eq("tenant_id", gymId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`engine_cohort_programs read failed: ${error.message}`);
  const row = (data ?? [])[0] as CohortProgram | undefined;
  return row ?? null;
}

const PAGE = 1000; // PostgREST's default max-rows cap; page past it explicitly.

/** Leaderboard entries for a program, optionally narrowed to one (week, day). Pages
 *  through the full set with a stable ORDER BY id — an unordered + capped read silently
 *  truncates (season standings compute from a random subset; the moderation feed can't
 *  list some entries), so this loops .range() until a short page. */
export async function loadEntries(
  supa: SupabaseClient,
  gymId: string,
  cohortProgramId: string,
  week?: number,
  day?: number,
): Promise<LeaderboardEntry[]> {
  const out: LeaderboardEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supa
      .from("engine_class_results")
      .select("id, user_id, week_num, day_num, modality, score_type, score_display, score_sort, avg_power_watts, rx, workout_date, created_at")
      .eq("gym_id", gymId)
      .eq("cohort_program_id", cohortProgramId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (typeof week === "number") q = q.eq("week_num", week);
    if (typeof day === "number") q = q.eq("day_num", day);
    const { data, error } = await q;
    if (error) throw new Error(`engine_class_results read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      out.push({
        result_ref: row.id as string,
        user_id: row.user_id as string,
        week_num: row.week_num as number,
        day_num: row.day_num as number,
        modality: (row.modality as string | null) ?? null,
        score_type: row.score_type as string,
        score_display: row.score_display as string,
        score_sort: (row.score_sort as number | null) ?? null,
        avg_power_watts: (row.avg_power_watts as number | null) ?? null,
        rx: !!row.rx,
        workout_date: (row.workout_date as string | null) ?? null,
        logged_at: (row.created_at as string | null) ?? null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Hydrate the profile info the leaderboard needs (privacy flags + ONE PROFILE
 *  gender/bodyweight/units), keyed by user_id. */
export async function loadProfiles(supa: SupabaseClient, userIds: string[]): Promise<Map<string, ProfileInfo>> {
  const out = new Map<string, ProfileInfo>();
  if (userIds.length === 0) return out;
  const ids = [...new Set(userIds)];

  const [{ data: profs, error: pErr }, { data: aps, error: aErr }] = await Promise.all([
    supa.from("profiles").select("id, full_name, role, leaderboard_anonymous, leaderboard_excluded").in("id", ids),
    supa.from("athlete_profiles").select("user_id, gender, bodyweight, units").in("user_id", ids),
  ]);
  if (pErr) throw new Error(`profiles read failed: ${pErr.message}`);
  if (aErr) throw new Error(`athlete_profiles read failed: ${aErr.message}`);

  const apByUser = new Map((aps ?? []).map((a) => [(a as { user_id: string }).user_id, a as Record<string, unknown>]));
  for (const pr of profs ?? []) {
    const p = pr as Record<string, unknown>;
    const ap = apByUser.get(p.id as string);
    out.set(p.id as string, {
      full_name: (p.full_name as string | null) ?? null,
      leaderboard_anonymous: !!p.leaderboard_anonymous,
      leaderboard_excluded: !!p.leaderboard_excluded,
      role: (p.role as string | null) ?? null,
      gender: (ap?.gender as string | null) ?? null,
      bodyweight: (ap?.bodyweight as number | null) ?? null,
      units: (ap?.units as string | null) ?? null,
    });
  }
  return out;
}
