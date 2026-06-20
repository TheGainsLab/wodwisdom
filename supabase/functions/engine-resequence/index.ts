/**
 * engine-resequence — the Engine self-sequencer loop.
 *
 * Flow: gate (>= 10 completed Engine days) → conditioning diagnosis + day-type
 * catalogue + current phase → AI generates the next week WITHIN each day-type's
 * parameter envelope → parse + deterministically validate → persist each accepted
 * day as an engine_workouts row and override the upcoming position
 * (engine_user_day_overrides) to point at it.
 *
 * The day-types are a generative grammar: the AI chooses values inside each
 * envelope (the reason to use AI). A generated day shares the catalog
 * block_params shape, so the runner executes it unchanged. Overriding the
 * WORKOUT CONTENT at a position leaves progression, access gating and the UI
 * (all position-based) untouched. current_day = highest completed + 1, so the
 * AI fills positions just ahead; positions beyond the generated week fall back
 * to the static catalog until the user finishes the week and the next run fills
 * them. Relies on sequential completion (athletes are counseled to it).
 *
 * Trigger: intended to run weekly per athlete once they've completed >= 10
 * Engine sessions. This function resequences one athlete; a thin cron wrapper
 * (follow-up) calls it on cadence. Pass { dry_run: true } to validate without
 * persisting.
 *
 * See docs/engine_self_sequencing_plan.md.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { callClaude } from "../_shared/call-claude.ts";
import { buildConditioningState } from "../_shared/conditioning-state.ts";
import { buildDayTypeCatalogue, loadDayTypeCatalogue } from "../_shared/engine-catalogue.ts";
import { parseProposal, type ProposedDay, validateProposal } from "../_shared/engine-sequence.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const MIN_COMPLETED_DAYS = 10; // loop starts after the athlete completes 10 Engine days

const SYSTEM_PROMPT =
  `You are the Engine conditioning sequencer. You personalise an athlete's UPCOMING conditioning by ` +
  `GENERATING training days within a fixed taxonomy — you never invent day-types or parameters outside ` +
  `their authored envelopes.\n\n` +
  `You are given: (1) the athlete's RAW conditioning signals (per-competency rolling ratios + recent ` +
  `trend, time-trial/calibration age, days since last session — no labels; you interpret them), ` +
  `(2) the day-type catalogue with each type's parameter envelope, and (3) the athlete's ` +
  `current phase and how many days to generate.\n\n` +
  `Read the signals and form your own judgment: which energy systems are behind, what's trending down, ` +
  `whether a layoff warrants re-baselining, which prerequisites are met. Then choose day-types that ` +
  `serve that judgment. For each chosen day, GENERATE concrete block ` +
  `parameters STRICTLY inside that day-type's envelope.\n\n` +
  `Rules:\n` +
  `- Only use day_types whose phase_requirement <= the athlete's current phase.\n` +
  `- Supply exactly block_count blocks, each an object with the same keys as the day-type's block_N_params.\n` +
  `- Durations are SECONDS. paceRange is [lo,hi] as a fraction of baseline and must sit inside the envelope's [min,max].\n` +
  `- Keep workProgression/paceProgression/restProgression EXACTLY as the envelope specifies. Use the exact ` +
  `rest keyword (e.g. one_third_work) when the envelope uses one.\n` +
  `- Stay within max_duration_minutes.\n\n` +
  `Output ONLY JSON, no prose, in this shape:\n` +
  `{"summary":"one-line rationale","days":[{"day_type":"<id>","reason":"<why this day>","blocks":[{ ...params... }]}]}`;

/** Rough total minutes for display: work (rounds×workDuration) + numeric rest per block. */
function estimateMinutes(blocks: Record<string, unknown>[]): number {
  let secs = 0;
  for (const b of blocks) {
    const rounds = typeof b.rounds === "number" ? b.rounds : 1;
    const work = typeof b.workDuration === "number" ? b.workDuration : 0;
    const rest = typeof b.restDuration === "number" ? b.restDuration : 0;
    secs += rounds * work + Math.max(0, rounds - 1) * rest;
  }
  return Math.round(secs / 60);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    // Safe by default during the verification phase: only writes when explicitly
    // told { dry_run: false }. The auto-trigger must pass dry_run:false.
    let dryRun = body?.dry_run !== false;
    const debug = body?.debug === true; // also echo the assembled prompt
    let userId = user.id;

    // Admin preview: an admin can run this for ANOTHER user to inspect what the
    // AI found and what it would change. This path never writes.
    if (body?.target_user_id && body.target_user_id !== user.id) {
      const { data: prof } = await supa.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (prof?.role !== "admin") return json({ error: "Forbidden" }, 403);
      userId = body.target_user_id as string;
      dryRun = true;
    }

    // 1) Gate: at least MIN_COMPLETED_DAYS completed Engine sessions.
    const { count: completed } = await supa
      .from("engine_workout_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("completed", true);
    if ((completed ?? 0) < MIN_COMPLETED_DAYS) {
      return json({ skipped: true, reason: `needs ${MIN_COMPLETED_DAYS} completed days, has ${completed ?? 0}` });
    }

    // 2) Diagnosis + catalogue (text for the prompt, rows for validation).
    const [diagnosis, catalogueText, catalogueRows] = await Promise.all([
      buildConditioningState(supa, userId),
      buildDayTypeCatalogue(supa),
      loadDayTypeCatalogue(supa),
    ]);
    if (!diagnosis) return json({ skipped: true, reason: "no conditioning diagnosis available" });

    // 3) Current position + phase. current_day = highest completed + 1 (sequential).
    //    Phase (gates legal day-types) = phase of the highest completed catalog day.
    const { data: maxDay } = await supa
      .from("engine_workout_sessions")
      .select("program_day_number")
      .eq("user_id", userId).eq("completed", true)
      .not("program_day_number", "is", null)
      .order("program_day_number", { ascending: false }).limit(1).maybeSingle();
    const highestCompleted = (maxDay?.program_day_number as number) ?? 0;
    const currentDay = highestCompleted + 1;
    let currentPhase = 1;
    if (highestCompleted > 0) {
      const { data: w } = await supa
        .from("engine_workouts")
        .select("phase")
        .eq("program_type", "main_5day")
        .eq("day_number", highestCompleted).maybeSingle();
      currentPhase = (w?.phase as number) ?? 1;
    }

    // 4) How many days to generate = a week at the athlete's cadence.
    const { data: prof } = await supa
      .from("athlete_profiles").select("engine_program_version").eq("user_id", userId).maybeSingle();
    const maxDays = String(prof?.engine_program_version ?? "5-day").includes("3") ? 3 : 5;

    // 5) Ask the AI to generate the upcoming sequence within the envelopes.
    const userContent =
      `${diagnosis}\n\n` +
      `ATHLETE CURRENT PHASE: ${currentPhase} (only day_types with phase_requirement <= ${currentPhase} are legal)\n` +
      `GENERATE THE NEXT ${maxDays} ENGINE DAYS.\n\n` +
      `${catalogueText}`;

    const raw = await callClaude({
      apiKey: ANTHROPIC_API_KEY!,
      system: SYSTEM_PROMPT,
      userContent,
      maxTokens: 4096,
    });

    const proposal = parseProposal(raw);
    if (!proposal) return json({ error: "AI returned unparseable output", raw }, 502);

    const result = validateProposal(proposal, catalogueRows, { currentPhase, maxDays });

    if (dryRun || result.accepted.length === 0) {
      return json({
        dry_run: dryRun,
        persisted: 0,
        currentDay,
        currentPhase,
        maxDays,
        summary: proposal.summary,
        // Full verification view: what the AI found (diagnosis), every day it
        // proposed, what passed the envelope validator, and why anything failed.
        diagnosis,
        proposed: proposal.days,
        accepted: result.accepted,
        validation_errors: result.errors,
        raw_ai_output: raw,
        ...(debug ? { prompt: userContent } : {}),
      });
    }

    // 6) Persist each accepted day as an engine_workouts row, then override the
    //    upcoming position (currentDay, +1, ...) to point at it. Pure content swap:
    //    progression/access/UI are position-based and untouched.
    const programType = `gen:${userId}`;
    const { data: lastGen } = await supa
      .from("engine_workouts")
      .select("day_number")
      .eq("program_type", programType)
      .order("day_number", { ascending: false }).limit(1).maybeSingle();
    let nextGenNumber = ((lastGen?.day_number as number) ?? 0) + 1;

    const placed: { position: number; day_type: string; reason: string }[] = [];
    const persistErrors: string[] = [];

    let position = currentDay;
    for (const day of result.accepted as ProposedDay[]) {
      try {
        const blocks = day.blocks;
        const { data: wrow, error: wErr } = await supa
          .from("engine_workouts")
          .insert({
            program_type: programType,
            day_number: nextGenNumber,
            day_type: day.day_type,
            phase: currentPhase,
            block_count: blocks.length,
            block_1_params: blocks[0] ?? null,
            block_2_params: blocks[1] ?? null,
            block_3_params: blocks[2] ?? null,
            block_4_params: blocks[3] ?? null,
            total_duration_minutes: estimateMinutes(blocks),
          })
          .select("id").single();
        if (wErr || !wrow) throw new Error(wErr?.message ?? "insert engine_workouts failed");

        // Upsert the position override (one row per user+position; re-runs replace).
        const { error: oErr } = await supa
          .from("engine_user_day_overrides")
          .upsert(
            { user_id: userId, sequence_position: position, engine_workout_id: wrow.id, reason: day.reason, updated_at: new Date().toISOString() },
            { onConflict: "user_id,sequence_position" },
          );
        if (oErr) throw new Error(oErr.message);

        placed.push({ position, day_type: day.day_type, reason: day.reason });
        nextGenNumber += 1;
        position += 1;
      } catch (e) {
        persistErrors.push(`pos ${position} ${day.day_type}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    console.log(`[engine-resequence] user=${userId} currentDay=${currentDay} phase=${currentPhase} placed=${placed.length} errors=${result.errors.length + persistErrors.length}`);

    return json({
      currentDay,
      currentPhase,
      maxDays,
      summary: proposal.summary,
      persisted: placed.length,
      placed,
      validation_errors: result.errors,
      persist_errors: persistErrors,
    });
  } catch (e) {
    console.error("[engine-resequence] error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
