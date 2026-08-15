/**
 * runResequence — the shared core of the Engine self-sequencer.
 *
 * One code path used by two callers:
 *   - engine-resequence (HTTP)        — admin dry-run preview / on-demand.
 *   - engine-resequence-cron (server) — automatic live generation, per eligible user.
 *
 * Flow: gate (>= MIN_COMPLETED_DAYS) -> diagnosis + catalogue + current phase ->
 * AI generates the non-pinned days of the block within each envelope -> parse +
 * validate -> (dry run returns the preview | persist accepted days as engine_workouts
 * rows + position overrides). Month-boundary time trials are pinned (left as the
 * catalog TT). Returns a plain object; the HTTP caller maps it to a response.
 *
 * See docs/engine_self_sequencing_plan.md.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callClaude } from "./call-claude.ts";
import { buildConditioningState } from "./conditioning-state.ts";
import { buildOtherTrainingLoadBlock } from "./athlete-activities.ts";
import { formatDayTypeCatalogue, loadDayTypeCatalogue } from "./engine-catalogue.ts";
import { computeAllowedDayTypes, parseProposal, type ProposedDay, validateProposal } from "./engine-sequence.ts";

export const MIN_COMPLETED_DAYS = 10; // loop starts after the athlete completes 10 Engine days

const SYSTEM_PROMPT =
  `You are the Engine conditioning sequencer. You personalise an athlete's UPCOMING conditioning by ` +
  `GENERATING training days within a fixed taxonomy — you never invent day-types or parameters outside ` +
  `their authored envelopes.\n\n` +
  `You are given: (1) the athlete's RAW conditioning signals (per-competency rolling ratios + recent ` +
  `trend, time-trial/calibration age, days since last session — no labels; you interpret them), ` +
  `(2) the day-type catalogue with each type's parameter envelope — it contains exactly the day-types ` +
  `available at this point in the athlete's program, (3) how many days to generate, (4) when present, ` +
  `ATHLETE CONTEXT — their age (factor recovery capacity into intensity placement and the hard/easy mix; ` +
  `weigh it against the actual signals, never as a rulebook) and their stated goal, and (5) when present, ` +
  `their OTHER TRAINING LOAD — ` +
  `real recent training Engine did not prescribe (program strength days, self-logged activities). ` +
  `That load draws on the same recovery budget: factor it into intensity and day-type placement, ` +
  `but never into day count — the program's length and cadence are fixed.\n\n` +
  `Read the signals and form your own judgment: which energy systems are behind, what's trending down, ` +
  `whether a layoff warrants re-baselining, which prerequisites are met. Then choose day-types that ` +
  `serve that judgment. For each chosen day, GENERATE concrete block ` +
  `parameters STRICTLY inside that day-type's envelope.\n\n` +
  `Intensity judgment — the key value you add: the rolling ratio is a SLOW smoother; if an athlete is ` +
  `consistently beating target you may set the pace where they actually are NOW rather than waiting weeks ` +
  `for it to catch up. BUT scale that confidence by the sample count: where a competency has a solid ` +
  `rolling history (n≈3-4) and a clear trend, set intensity decisively; where it is thin (n≈1, or no ` +
  `rolling data at all), stay conservative — pick a mid/standard intensity, don't jump on one session.\n\n` +
  `Recalibration: the athlete is automatically re-baselined by a scheduled monthly time trial, so you do ` +
  `NOT need to add one just to keep calibration fresh. Inserting your own time trial spends one of this ` +
  `block's training days, so only do it when the signals strongly suggest the current baseline no longer ` +
  `holds — e.g. a long layoff, a modality change, or recent paces that clearly contradict it — not merely ` +
  `because the baseline is aging.\n\n` +
  `Rules:\n` +
  `- Only use day_types from the catalogue below — it already contains exactly what is available at this ` +
  `point in the athlete's program.\n` +
  `- Supply exactly block_count blocks per day, in order. Emit ONLY the parameters where the envelope ` +
  `offers a real choice: a [min,max] range with min < max, or an Options list. Every fixed value — fixed ` +
  `strings/numbers, rest keywords, pinned [x,x] ranges, inherit_from_part_a sentinels, lookup tables — is ` +
  `filled in by the system; omit them. A block with no choices is just {}.\n` +
  `- Choose a SINGLE concrete value for each ranged scalar — never return a range where one value is ` +
  `expected (e.g. workDuration must be a number like 120, not [90,210]). Durations are SECONDS.\n` +
  `- Pace choices (paceRange/basePace/fluxPaceRange) are [lo,hi] fractions of baseline and must sit inside ` +
  `the envelope's [min,max].\n` +
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

export type ResequenceStatus = "skipped" | "preview" | "applied" | "unparseable" | "error";

export interface ResequenceResult {
  status: ResequenceStatus;
  [k: string]: unknown;
}

export interface RunResequenceOpts {
  dryRun: boolean;
  debug?: boolean;
}

/** The shared sequencer core. Pure of HTTP; returns a plain result object. */
export async function runResequence(
  supa: SupabaseClient,
  userId: string,
  opts: RunResequenceOpts,
): Promise<ResequenceResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const { dryRun, debug } = opts;

  // 1) Gate: at least MIN_COMPLETED_DAYS completed Engine sessions.
  const { count: completed } = await supa
    .from("engine_workout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("completed", true);
  if ((completed ?? 0) < MIN_COMPLETED_DAYS) {
    return { status: "skipped", reason: `needs ${MIN_COMPLETED_DAYS} completed days, has ${completed ?? 0}` };
  }

  // 2) Diagnosis + catalogue rows. The prompt's catalogue TEXT is formatted
  // later, after the month-availability pool is known — the model only ever
  // sees the day-types the program has unlocked.
  const [diagnosis, catalogueRows] = await Promise.all([
    buildConditioningState(supa, userId),
    loadDayTypeCatalogue(supa),
  ]);
  if (!diagnosis) return { status: "skipped", reason: "no conditioning diagnosis available" };

  // 3) Program + cadence. The athlete's program defines the position space:
  // specialty programs curate NON-consecutive catalog days via engine_program_mapping,
  // so "the next N positions" must come from the mapping, not currentDay+i.
  const { data: prof } = await supa
    .from("athlete_profiles")
    .select("engine_program_version, age, engine_goal")
    .eq("user_id", userId)
    .maybeSingle();
  const version = (prof?.engine_program_version as string) ?? "main_5day";
  const athleteAge = typeof prof?.age === "number" && prof.age > 0 ? prof.age : null;
  const athleteGoal = typeof prof?.engine_goal === "string" && prof.engine_goal.trim() !== ""
    ? prof.engine_goal.trim().slice(0, 500)
    : null;
  const { data: program } = await supa
    .from("engine_programs").select("days_per_week, name, description").eq("id", version).maybeSingle();
  const maxDays = (program?.days_per_week as number) ?? 5;

  // 3b) How far the athlete has progressed. program_day_number == the catalog
  // day_number; scope by program_version (a switch resets to that program's own
  // progress). What matters is the furthest SEQUENCE position reached ->
  // which days come next. Curated programs (hyrox/vo2) map NON-monotonic
  // catalog days, so "next" must be walked in program_sequence_order, never
  // by catalog day number.
  const { data: doneRows } = await supa
    .from("engine_workout_sessions")
    .select("program_day_number, sequence_position")
    .eq("user_id", userId).eq("completed", true).eq("program_version", version)
    .not("program_day_number", "is", null);
  const completedDays = new Set<number>((doneRows ?? []).map((r) => r.program_day_number as number));
  const highestCompleted = completedDays.size ? Math.max(...completedDays) : 0;
  const currentDay = highestCompleted + 1;

  // Full position<->catalog-day mapping for this program, in sequence order.
  // month is program-scoped (engine_program_mapping.month, NOT NULL since the
  // 20260418 backfill) — it drives the availability pool below.
  const { data: mapAll } = await supa
    .from("engine_program_mapping")
    .select("engine_workout_day_number, program_sequence_order, month")
    .eq("engine_program_id", version)
    .order("program_sequence_order", { ascending: true });
  const mapping = (mapAll ?? []).map((m) => ({
    day: m.engine_workout_day_number as number,
    seq: m.program_sequence_order as number,
    month: (m.month as number) ?? 1,
  }));

  // Furthest SEQUENCE position completed. sessions.sequence_position is the
  // exact record (sequence-identity migration); the catalog-day scan is the
  // fallback for rows written before it — earliest occurrence, which for
  // repeat programs (vo2max/hyrox schedule one catalog day at several
  // positions) deliberately under-credits rather than over-credits.
  let maxCompletedSeq = 0;
  for (const r of doneRows ?? []) {
    const seq = r.sequence_position as number | null;
    if (seq != null && seq > maxCompletedSeq) maxCompletedSeq = seq;
  }
  const seqRecorded = (doneRows ?? []).some((r) => r.sequence_position != null);
  if (!seqRecorded) {
    const credited = new Set<number>();
    for (const m of mapping) {
      if (completedDays.has(m.day) && !credited.has(m.day)) {
        credited.add(m.day);
        if (m.seq > maxCompletedSeq) maxCompletedSeq = m.seq;
      }
    }
  }

  // 3c) The next maxDays positions = the mapping rows AFTER that sequence
  // position, in sequence order — kept as {seq, day} pairs: seq is the
  // position identity (what overrides key on), day is the catalog content
  // reference (what TT pinning and phase read).
  let blockPairs = mapping.filter((m) => m.seq > maxCompletedSeq).slice(0, maxDays);
  // Fallback for a program with no mapping rows: consecutive positions
  // (identity assumption — only plain-catalog setups reach this).
  if (blockPairs.length === 0) {
    blockPairs = Array.from({ length: maxDays }, (_, i) => ({ seq: currentDay + i, day: currentDay + i }));
  }

  // 3d) Catalog day -> day_type for the whole authored catalog (720 rows,
  // two columns): one query serves TT pinning, the prescribed-slot baseline,
  // and the month-availability pool.
  const { data: catalogTypes } = await supa
    .from("engine_workouts")
    .select("day_number, day_type")
    .eq("program_type", "main_5day");
  const typeByDay = new Map<number, string>(
    (catalogTypes ?? []).map((w) => [w.day_number as number, w.day_type as string]),
  );

  // 3e) Month-availability pool — replaces phase gating. The program's own
  // curation is the unlock curve: legal day-types are the ones this program
  // maps at months <= the block's month (month of the furthest position being
  // generated — position-month, never the athlete's paid months_unlocked).
  // A mapping-less program (plain-catalog fallback above) gets the full
  // catalogue: it has no curation to define an unlock curve.
  const blockMonth = mapping.length > 0
    ? Math.max(1, ...blockPairs.map((p) => mapping.find((m) => m.seq === p.seq)?.month ?? 1))
    : 1;
  const allowedDayTypes = mapping.length > 0
    ? computeAllowedDayTypes(mapping, typeByDay, blockMonth)
    : new Set<string>(catalogueRows.map((r) => r.id));

  // 4) Pin month-boundary time trials (left as the catalog TT; AI fills the
  // rest). Day-typing is per catalog day; pinning is per POSITION, so a
  // repeated TT catalog day pins every position it occupies in the window.
  const ttPositions = blockPairs.filter((p) => typeByDay.get(p.day) === "time_trial").map((p) => p.seq);
  const aiPairs = blockPairs.filter((p) => typeByDay.get(p.day) !== "time_trial");
  const aiPositions = aiPairs.map((p) => p.seq);
  const daysToGenerate = aiPositions.length;
  if (daysToGenerate === 0) {
    return { status: "skipped", reason: "block is entirely pinned time trials", currentDay, pinned_time_trials: ttPositions };
  }

  // 5) Ask the AI to generate the non-pinned days of the block.
  const ttNote = ttPositions.length > 0
    ? `Note: a scheduled time trial (re-baseline) falls within this week and is handled separately — ` +
      `sequence your days assuming a recalibration occurs; do not generate a time trial yourself unless ` +
      `the signals clearly call for an extra one.\n`
    : "";

  // Goal/emphasis context: the program's stated purpose plus its OWN curated
  // day-type for each slot the AI is filling. The curation IS the program's
  // intent; without it the AI optimises only for current conditioning and
  // specialty programs (hyrox/vo2) come out generic. The curated day-type is a
  // baseline, not a lock — the AI adapts block params to the athlete's signals
  // and may substitute the day-type when the data clearly warrants. Either way
  // the result still passes availability + envelope validation downstream.
  const programGoal = program?.name
    ? `PROGRAM: ${program.name}${program.description ? ` — ${program.description}` : ""}\n` +
      `Bias your day-type choices toward this program's intent.\n`
    : "";

  // Athlete context — pure enrichment. Either line absent leaves the prompt
  // byte-identical to the pre-feature prompt; the sequencer owes a goal-less,
  // age-less athlete exactly its old behavior. Goal text is athlete-authored
  // free text: it steers judgment only — day-types, envelopes, cadence, and
  // validation are unchanged fences around whatever it says.
  const athleteContextLines: string[] = [];
  if (athleteAge != null) athleteContextLines.push(`ATHLETE: age ${athleteAge}`);
  if (athleteGoal) {
    athleteContextLines.push(
      `ATHLETE'S STATED GOAL: "${athleteGoal}"\n` +
        `Weigh day-type selection, modality emphasis, and intensity placement toward this goal where the ` +
        `signals permit. The program's intent is the frame; the goal refines within it — where they ` +
        `conflict, honor the program.`,
    );
  }
  const athleteContext = athleteContextLines.length > 0 ? athleteContextLines.join("\n") + "\n" : "";
  // Day-types are keyed by CATALOG day; walk the {seq, day} pairs.
  const prescribedSlots = aiPairs
    .map((p, i) => `  day ${i + 1}: program prescribes "${typeByDay.get(p.day) ?? "unspecified"}"`)
    .join("\n");
  const prescribedNote = prescribedSlots
    ? `PROGRAM-PRESCRIBED DAY-TYPES FOR THESE SLOTS (your baseline — keep each unless the ` +
      `athlete's signals clearly call for a substitute; adapt the block parameters to their state either way):\n` +
      `${prescribedSlots}\n`
    : "";

  // Gap #5 v1: the athlete's NON-Engine training load (program strength for
  // dual-product users, logged activities for roll-your-own athletes) —
  // advisory context for intensity/day-type judgment. Best-effort; "" when
  // there is nothing to report, leaving the prompt unchanged.
  const otherLoad = await buildOtherTrainingLoadBlock(supa, userId).catch((err) => {
    console.warn(`[run-resequence] other-load fetch failed for ${userId}:`, err);
    return "";
  });

  // The catalogue the model sees is pre-filtered to the availability pool —
  // it cannot propose a day-type it was never shown (the validator enforces
  // the same set as the second fence).
  const catalogueText = formatDayTypeCatalogue(
    catalogueRows.filter((r) => allowedDayTypes.has(r.id)),
  );

  const userContent =
    `${diagnosis}\n\n` +
    (otherLoad ? `${otherLoad}\n\n` : "") +
    programGoal +
    athleteContext +
    `PROGRAM MONTH: ${blockMonth} — the catalogue below contains exactly the day-types the program has ` +
    `made available through this month.\n` +
    `GENERATE THE NEXT ${daysToGenerate} ENGINE DAYS.\n` +
    prescribedNote +
    ttNote + `\n` +
    `${catalogueText}`;

  // Generous deadline: up to 5 days × 4 blocks of structured params is a big
  // generation, and this runs from a cron ahead of the athlete — latency is
  // worthless here. 2 × 150s + 3s backoff ≈ 303s, inside the ~400s edge wall.
  // No Haiku fallback: sequencing is a judgment seat — on failure we change
  // nothing (athlete keeps the curated day) and the next cron tick retries.
  const raw = await callClaude({
    apiKey: apiKey!,
    system: SYSTEM_PROMPT,
    userContent,
    maxTokens: 4096,
    timeoutMs: 150_000,
    fallbackToHaiku: false,
  });

  const proposal = parseProposal(raw);
  if (!proposal) return { status: "unparseable", error: "AI returned unparseable output", raw };

  const result = validateProposal(proposal, catalogueRows, { allowedDayTypes, maxDays: daysToGenerate });

  if (dryRun || result.accepted.length === 0) {
    return {
      status: "preview",
      dry_run: dryRun,
      persisted: 0,
      currentDay,
      month: blockMonth,
      allowed_day_types: Array.from(allowedDayTypes).sort(),
      maxDays,
      days_to_generate: daysToGenerate,
      pinned_time_trials: ttPositions,
      ai_positions: aiPositions,
      summary: proposal.summary,
      diagnosis,
      proposed: proposal.days,
      accepted: result.accepted,
      validation_errors: result.errors,
      raw_ai_output: raw,
      ...(debug ? { prompt: userContent } : {}),
    };
  }

  // 6) Persist accepted days as engine_workouts rows + position overrides.
  const programType = `gen:${userId}`;
  const { data: lastGen } = await supa
    .from("engine_workouts")
    .select("day_number")
    .eq("program_type", programType)
    .order("day_number", { ascending: false }).limit(1).maybeSingle();
  let nextGenNumber = ((lastGen?.day_number as number) ?? 0) + 1;

  const placed: { position: number; day_type: string; reason: string }[] = [];
  const persistErrors: string[] = [];

  const accepted = result.accepted as ProposedDay[];
  for (let i = 0; i < accepted.length && i < aiPositions.length; i++) {
    const day = accepted[i];
    const position = aiPositions[i];
    try {
      const blocks = day.blocks;
      const { data: wrow, error: wErr } = await supa
        .from("engine_workouts")
        .insert({
          program_type: programType,
          day_number: nextGenNumber,
          day_type: day.day_type,
          // For gen rows this column records the block's PROGRAM MONTH (the
          // availability pool it was generated under), not the retired phase.
          phase: blockMonth,
          block_count: blocks.length,
          block_1_params: blocks[0] ?? null,
          block_2_params: blocks[1] ?? null,
          block_3_params: blocks[2] ?? null,
          block_4_params: blocks[3] ?? null,
          total_duration_minutes: estimateMinutes(blocks),
        })
        .select("id").single();
      if (wErr || !wrow) throw new Error(wErr?.message ?? "insert engine_workouts failed");

      const { error: oErr } = await supa
        .from("engine_user_day_overrides")
        .upsert(
          { user_id: userId, program_version: version, sequence_position: position, engine_workout_id: wrow.id, reason: day.reason, updated_at: new Date().toISOString() },
          { onConflict: "user_id,program_version,sequence_position" },
        );
      if (oErr) throw new Error(oErr.message);

      placed.push({ position, day_type: day.day_type, reason: day.reason });
      nextGenNumber += 1;
    } catch (e) {
      persistErrors.push(`pos ${position} ${day.day_type}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`[run-resequence] user=${userId} currentDay=${currentDay} month=${blockMonth} placed=${placed.length} errors=${result.errors.length + persistErrors.length}`);

  return {
    status: "applied",
    currentDay,
    month: blockMonth,
    maxDays,
    summary: proposal.summary,
    persisted: placed.length,
    placed,
    pinned_time_trials: ttPositions,
    validation_errors: result.errors,
    persist_errors: persistErrors,
  };
}
