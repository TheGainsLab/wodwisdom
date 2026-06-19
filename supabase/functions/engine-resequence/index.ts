/**
 * engine-resequence — the Engine self-sequencer loop.
 *
 * Flow: gate (>= 10 completed Engine days) → conditioning diagnosis + day-type
 * catalogue + current phase → AI generates the upcoming sequence WITHIN each
 * day-type's parameter envelope → parse + deterministically validate → persist
 * each accepted day as an engine_workouts row and schedule it in
 * training_schedule.
 *
 * The day-types are a generative grammar: the AI chooses values inside each
 * envelope (the reason to use AI). A generated day shares the catalog
 * block_params shape, so the runner executes it unchanged.
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
  `You are given: (1) the athlete's conditioning diagnosis (energy-system mastery, weak roots, fatigue, ` +
  `calibration), (2) the day-type catalogue with each type's parameter envelope, and (3) the athlete's ` +
  `current phase and how many days to generate.\n\n` +
  `Choose day-types that serve the diagnosis: shore up lagging/weak energy systems, respect prerequisites, ` +
  `and ease total load when fatigue signals are present. For each chosen day, GENERATE concrete block ` +
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

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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
    const dryRun = body?.dry_run === true;
    const userId = user.id;

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

    // 3) Current phase (gates legal day-types) = phase of the highest completed catalog day.
    const { data: maxDay } = await supa
      .from("engine_workout_sessions")
      .select("program_day_number")
      .eq("user_id", userId).eq("completed", true)
      .not("program_day_number", "is", null)
      .order("program_day_number", { ascending: false }).limit(1).maybeSingle();
    let currentPhase = 1;
    if (maxDay?.program_day_number != null) {
      const { data: w } = await supa
        .from("engine_workouts")
        .select("phase")
        .eq("program_type", "main_5day")
        .eq("day_number", maxDay.program_day_number).maybeSingle();
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
        currentPhase,
        maxDays,
        summary: proposal.summary,
        accepted: result.accepted,
        errors: result.errors,
        persisted: 0,
      });
    }

    // 6) Persist accepted days as engine_workouts rows + schedule them.
    const programType = `gen:${userId}`;
    const { data: lastGen } = await supa
      .from("engine_workouts")
      .select("day_number")
      .eq("program_type", programType)
      .order("day_number", { ascending: false }).limit(1).maybeSingle();
    let nextDayNumber = ((lastGen?.day_number as number) ?? 0) + 1;

    const today = new Date().toISOString().slice(0, 10);
    const { data: lastSched } = await supa
      .from("training_schedule")
      .select("scheduled_date")
      .eq("user_id", userId).not("engine_workout_id", "is", null)
      .gte("scheduled_date", today)
      .order("scheduled_date", { ascending: false }).limit(1).maybeSingle();
    let cursor = lastSched?.scheduled_date ? addDays(lastSched.scheduled_date as string, 1) : addDays(today, 1);

    const scheduled: { day_type: string; date: string; reason: string }[] = [];
    const persistErrors: string[] = [];

    for (const day of result.accepted as ProposedDay[]) {
      try {
        const blocks = day.blocks;
        const { data: wrow, error: wErr } = await supa
          .from("engine_workouts")
          .insert({
            program_type: programType,
            day_number: nextDayNumber,
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

        const { error: sErr } = await supa
          .from("training_schedule")
          .insert({ user_id: userId, engine_workout_id: wrow.id, scheduled_date: cursor });
        if (sErr) throw new Error(sErr.message);

        scheduled.push({ day_type: day.day_type, date: cursor, reason: day.reason });
        nextDayNumber += 1;
        cursor = addDays(cursor, 1);
      } catch (e) {
        persistErrors.push(`${day.day_type}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    console.log(`[engine-resequence] user=${userId} phase=${currentPhase} scheduled=${scheduled.length} errors=${result.errors.length + persistErrors.length}`);

    return json({
      currentPhase,
      maxDays,
      summary: proposal.summary,
      persisted: scheduled.length,
      scheduled,
      validation_errors: result.errors,
      persist_errors: persistErrors,
    });
  } catch (e) {
    console.error("[engine-resequence] error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
