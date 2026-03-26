/**
 * ailog-gap-analysis edge function
 *
 * Takes a program_id (external program), runs analyze-program's block analysis,
 * then cross-references against the athlete profile to produce personalized gap findings.
 *
 * Returns: { analysis, gaps }
 *   - analysis: standard program analysis (modal_balance, time_domains, etc.)
 *   - gaps: personalized gap findings (modality, time_domain, skills, strength, movements)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeBlocks, type BlockInput } from "../_shared/analyzer.ts";
import {
  buildMovementsContext,
  type MovementsRow,
} from "../_shared/build-movements-context.ts";
import { checkEntitlement } from "../_shared/entitlements.ts";
import { callClaude } from "../_shared/call-claude.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface AthleteProfile {
  lifts: Record<string, number>;
  skills: Record<string, string>;
  conditioning: Record<string, string>;
  bodyweight: number | null;
  gender: string | null;
  squat_level: string | null;
  bench_level: string | null;
  deadlift_level: string | null;
  snatch_level: string | null;
  clean_jerk_level: string | null;
}

interface GapFinding {
  category: "modality" | "time_domain" | "skill" | "strength" | "movement" | "conditioning";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

function computeGaps(
  analysis: ReturnType<typeof analyzeBlocks>,
  profile: AthleteProfile,
): GapFinding[] {
  const gaps: GapFinding[] = [];
  const { modal_balance, time_domains, not_programmed, movement_frequency } = analysis;

  // ── Modality balance gaps ──
  const totalModal = (modal_balance.Weightlifting || 0) + (modal_balance.Gymnastics || 0) + (modal_balance.Monostructural || 0);
  if (totalModal > 0) {
    const wPct = (modal_balance.Weightlifting || 0) / totalModal;
    const gPct = (modal_balance.Gymnastics || 0) / totalModal;
    const mPct = (modal_balance.Monostructural || 0) / totalModal;

    if (mPct < 0.1) {
      gaps.push({
        category: "modality",
        severity: "high",
        title: "No monostructural conditioning",
        detail: `Only ${Math.round(mPct * 100)}% of movements are monostructural (running, rowing, biking). Your cardiovascular base is not being developed.`,
      });
    } else if (mPct < 0.2) {
      gaps.push({
        category: "modality",
        severity: "medium",
        title: "Low monostructural volume",
        detail: `${Math.round(mPct * 100)}% monostructural is below the recommended 25-30%. Consider adding dedicated conditioning sessions.`,
      });
    }

    if (gPct < 0.1) {
      gaps.push({
        category: "modality",
        severity: "high",
        title: "No gymnastics work",
        detail: `Only ${Math.round(gPct * 100)}% gymnastics. Body control, pulling, and core work are missing.`,
      });
    } else if (gPct < 0.2) {
      gaps.push({
        category: "modality",
        severity: "medium",
        title: "Low gymnastics volume",
        detail: `${Math.round(gPct * 100)}% gymnastics is below recommended levels. Bodyweight skills need more attention.`,
      });
    }

    if (wPct > 0.6) {
      gaps.push({
        category: "modality",
        severity: "medium",
        title: "Weightlifting-heavy programming",
        detail: `${Math.round(wPct * 100)}% of movements are weightlifting. The program is barbell-dominant at the expense of other modalities.`,
      });
    }
  }

  // ── Time domain gaps ──
  const totalTD = (time_domains.short || 0) + (time_domains.medium || 0) + (time_domains.long || 0);
  if (totalTD > 0) {
    if ((time_domains.long || 0) === 0) {
      gaps.push({
        category: "time_domain",
        severity: "high",
        title: "No long-duration workouts",
        detail: "All metcons are under 15 minutes. Long time domain work (15-30+ min) builds aerobic capacity and pacing ability.",
      });
    }
    if ((time_domains.short || 0) / totalTD > 0.7) {
      gaps.push({
        category: "time_domain",
        severity: "medium",
        title: "Over-emphasis on short workouts",
        detail: `${Math.round(((time_domains.short || 0) / totalTD) * 100)}% of metcons are short (<8 min). Add medium and long efforts for better balance.`,
      });
    }
    if ((time_domains.medium || 0) === 0 && totalTD >= 3) {
      gaps.push({
        category: "time_domain",
        severity: "medium",
        title: "No medium-length workouts",
        detail: "Missing the 8-15 minute time domain. This range trains the transition between anaerobic and aerobic systems.",
      });
    }
  }

  // ── Skill progression gaps ──
  const skills = profile.skills || {};
  const programmedMovements = new Set(movement_frequency.map((m) => m.name));

  const SKILL_MOVEMENT_MAP: Record<string, string[]> = {
    ring_muscle_ups: ["ring muscle up", "muscle up"],
    bar_muscle_ups: ["bar muscle up"],
    hspu: ["handstand push up", "hspu", "strict handstand push up", "kipping handstand push up"],
    handstand_walk: ["handstand walk"],
    pistols: ["pistol", "pistol squat"],
    double_unders: ["double under"],
    rope_climb: ["rope climb", "legless rope climb"],
    pull_ups: ["pull up", "strict pull up", "kipping pull up", "chest to bar pull up"],
    toes_to_bar: ["toes to bar", "t2b"],
  };

  for (const [skill, level] of Object.entries(skills)) {
    if (level === "developing" || level === "cannot") {
      const relatedMovements = SKILL_MOVEMENT_MAP[skill] || [skill.replace(/_/g, " ")];
      const isProgrammed = relatedMovements.some((m) => programmedMovements.has(m));
      if (!isProgrammed) {
        gaps.push({
          category: "skill",
          severity: level === "cannot" ? "high" : "medium",
          title: `${skill.replace(/_/g, " ")} not being trained`,
          detail: `Your profile shows ${skill.replace(/_/g, " ")} as "${level}" but your gym doesn't program progressions for it.`,
        });
      }
    }
  }

  // ── Strength gaps ──
  const LIFT_LEVEL_MAP: Record<string, string | null> = {
    squat: profile.squat_level,
    bench: profile.bench_level,
    deadlift: profile.deadlift_level,
    snatch: profile.snatch_level,
    clean_jerk: profile.clean_jerk_level,
  };

  const LIFT_MOVEMENT_MAP: Record<string, string[]> = {
    squat: ["back squat", "front squat", "squat"],
    bench: ["bench press"],
    deadlift: ["deadlift"],
    snatch: ["snatch", "power snatch", "squat snatch", "hang snatch"],
    clean_jerk: ["clean", "power clean", "squat clean", "clean and jerk", "jerk", "push jerk", "split jerk"],
  };

  for (const [lift, level] of Object.entries(LIFT_LEVEL_MAP)) {
    if (level === "C") {
      const relatedMovements = LIFT_MOVEMENT_MAP[lift] || [lift.replace(/_/g, " ")];
      const liftFreq = movement_frequency
        .filter((m) => relatedMovements.some((rm) => m.name.includes(rm)))
        .reduce((sum, m) => sum + m.count, 0);

      if (liftFreq === 0) {
        gaps.push({
          category: "strength",
          severity: "high",
          title: `${lift.replace(/_/g, " ")} needs work but isn't programmed`,
          detail: `Your ${lift.replace(/_/g, " ")} is classified at level C but your gym doesn't include it in their programming.`,
        });
      } else if (liftFreq < 2) {
        gaps.push({
          category: "strength",
          severity: "medium",
          title: `${lift.replace(/_/g, " ")} under-programmed`,
          detail: `Your ${lift.replace(/_/g, " ")} is level C but only appears ${liftFreq}x in the program. Needs more frequency to progress.`,
        });
      }
    }
  }

  // ── Conditioning gaps (profile has benchmarks but no monostructural work) ──
  const conditioning = profile.conditioning || {};
  if (Object.keys(conditioning).length > 0 && (modal_balance.Monostructural || 0) < 2) {
    gaps.push({
      category: "conditioning",
      severity: "medium",
      title: "Conditioning benchmarks exist but no dedicated training",
      detail: "You have conditioning benchmarks in your profile but your gym rarely programs monostructural work. Your engine will stagnate.",
    });
  }

  // Sort by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return gaps;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Check AI Log entitlement
    const hasAccess = await checkEntitlement(supa, user.id, "ailog");
    if (!hasAccess) return json({ error: "AI Log subscription required" }, 403);

    const body = await req.json();
    const { program_id } = body;
    if (!program_id) return json({ error: "program_id required" }, 400);

    // Verify ownership and external source
    const { data: program } = await supa
      .from("programs")
      .select("id, user_id, source")
      .eq("id", program_id)
      .single();

    if (!program || program.user_id !== user.id) return json({ error: "Not found" }, 404);

    // Fetch workouts, blocks, movements, and profile in parallel
    const [workoutsRes, movementsRes, profileRes] = await Promise.all([
      supa
        .from("program_workouts")
        .select("id, week_num, day_num, sort_order")
        .eq("program_id", program_id)
        .order("sort_order"),
      supa
        .from("movements")
        .select("canonical_name, display_name, modality, category, aliases, competition_count"),
      supa
        .from("athlete_profiles")
        .select("lifts, skills, conditioning, bodyweight, gender, squat_level, bench_level, deadlift_level, snatch_level, clean_jerk_level")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const workouts = workoutsRes.data;
    if (!workouts?.length) return json({ error: "No workouts found" }, 404);

    const workoutIds = workouts.map((w: { id: string }) => w.id);
    const { data: blocks } = await supa
      .from("program_workout_blocks")
      .select("id, program_workout_id, block_type, block_order, block_text, parsed_tasks")
      .in("program_workout_id", workoutIds)
      .order("block_order");

    if (!blocks?.length) return json({ error: "No workout blocks found" }, 404);

    // Build analysis inputs
    const rows: MovementsRow[] = (movementsRes.data || []) as MovementsRow[];
    const movementsContext = buildMovementsContext(rows);

    const workoutLookup = new Map(
      workouts.map((w: { id: string; sort_order: number; week_num: number; day_num: number }) => [
        w.id,
        { sort_order: w.sort_order, week_num: w.week_num, day_num: w.day_num },
      ])
    );

    const blockInputs: BlockInput[] = blocks.map((b) => {
      const parent = workoutLookup.get(b.program_workout_id);
      return {
        block_type: b.block_type,
        block_text: b.block_text,
        parsed_tasks: b.parsed_tasks as Record<string, unknown>[] | null,
        sort_order: parent?.sort_order ?? 0,
        week_num: parent?.week_num,
        day_num: parent?.day_num,
      };
    });

    // Run standard analysis
    const gender = profileRes.data?.gender as string | null;
    const analysis = analyzeBlocks(blockInputs, movementsContext, gender);

    // Compute personalized gaps
    const profile: AthleteProfile = {
      lifts: (profileRes.data?.lifts as Record<string, number>) || {},
      skills: (profileRes.data?.skills as Record<string, string>) || {},
      conditioning: (profileRes.data?.conditioning as Record<string, string>) || {},
      bodyweight: profileRes.data?.bodyweight as number | null,
      gender,
      squat_level: profileRes.data?.squat_level as string | null,
      bench_level: profileRes.data?.bench_level as string | null,
      deadlift_level: profileRes.data?.deadlift_level as string | null,
      snatch_level: profileRes.data?.snatch_level as string | null,
      clean_jerk_level: profileRes.data?.clean_jerk_level as string | null,
    };

    const gaps = computeGaps(analysis, profile);

    // Generate AI summary if we have gaps
    let summary: string | null = null;
    if (gaps.length > 0 && ANTHROPIC_API_KEY) {
      const gapSummary = gaps.map((g) => `[${g.severity.toUpperCase()}] ${g.title}: ${g.detail}`).join("\n");
      summary = await callClaude({
        apiKey: ANTHROPIC_API_KEY,
        system: `You are a CrossFit coach analyzing a training program's gaps. Given a list of identified gaps, write a concise 2-3 sentence summary of the most important findings. Be direct and actionable. Do not use bullet points.`,
        userContent: gapSummary,
        maxTokens: 256,
      });
    }

    // Upsert analysis
    await supa
      .from("program_analyses")
      .upsert(
        {
          program_id,
          modal_balance: analysis.modal_balance,
          time_domains: analysis.time_domains,
          workout_structure: analysis.workout_structure,
          workout_formats: analysis.workout_formats,
          movement_frequency: analysis.movement_frequency,
          notices: analysis.notices,
          not_programmed: analysis.not_programmed,
          consecutive_overlaps: analysis.consecutive_overlaps,
          loading_ratio: analysis.loading_ratio,
          distinct_loads: analysis.distinct_loads,
          load_bands: analysis.load_bands,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "program_id" }
      );

    return json({ analysis, gaps, summary });
  } catch (err) {
    console.error("ailog-gap-analysis error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
