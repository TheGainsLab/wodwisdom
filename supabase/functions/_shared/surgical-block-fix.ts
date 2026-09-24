/**
 * surgical-block-fix.ts
 *
 * Focused LLM call that rewrites ONE block in a writer's program output
 * to fix block-local audit violations. Cheaper than regenerating the whole
 * program (~30s vs ~3min) and preserves the writer's clean work.
 *
 * Anchor: the skeleton's metadata for the day (metcon_focus, primary_lift,
 * strength_scheme, skill_focus). The rewrite is constrained to that intent
 * so we don't drift from the design plan.
 *
 * Call from the v3 audit-failure dispatcher. The dispatcher classifies
 * failures by `kind` and routes block-local ones here.
 */

import type { BlockPrescription, WriterOutput } from "./v2-output-schema.ts";
import { buildEmitBlockTool } from "./v2-output-schema.ts";
import type { SkeletonOutput } from "./v3-output-schema.ts";
import type { WriterPayload } from "./build-writer-payload.ts";
import { MODELS } from "./model-profiles.ts";

const MODEL = MODELS.sonnet;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

interface ClaudeResponse {
  content?: Array<{ type: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const SURGICAL_SYSTEM_PROMPT = `You are revising a single block in a 4-week CrossFit training program. The structural skeleton has already decided the day's intent (block types, primary lift, metcon focus, skill focus). Your job is to rewrite ONE block to fix specific audit violations while honoring the skeleton's intent.

You will receive:
  - The skeleton's metadata for THIS day (the design contract)
  - The block as the writer originally emitted it
  - The audit violations that block triggered (verbatim — fix every one)
  - Slim athlete context (units, do-not-program list, key 1RMs)

You will emit: ONE corrected block via the \`emit_block\` tool, matching the same BlockPrescription schema the writer uses.

RULES (honor every one):
- Stay true to the skeleton's intent. If metcon_focus says "long aerobic chipper", the rewrite is still a long aerobic chipper — just one that fixes the violations.
- Time-domain match: if the skeleton's metcon_focus includes "short" / "medium" / "long" (or "aerobic" / "sprint" / "power"), the prescribed work MUST complete in that bucket. short = under 9 min, medium = 7-16 min, long = 14+ min. The audit will reject rewrites whose computed duration falls outside the bucket — when the violation message says "completes in ~X:XX" for a "long" focus, add MORE work (longer ladder like 50-40-30-20-10, more rounds, a 1500-2000m row leg, more bodyweight reps). For a "short" focus completing too slowly, trim volume.
- Honor injuries / do-not-program list.
- All weights in the athlete's units.
- Plate math: lbs → nearest 5, kg → nearest 2.5.
- Prescribed barbell weight ≤ relevant 1RM unless the scheme/notes say "1RM attempt" / "max attempt" / "new 1RM".
- At most one monostructural cardio modality (Row / Bike / Ski-erg / Run / Swim) per metcon. NEVER mix two even in a deload metcon.
- Barbell movements within a metcon share ONE load (DT-style complex OK; mixed loads NOT OK).
- Every movement in strength / accessory / metcon / skills must populate at least one of {sets, reps, rep_scheme, calories, weight, time_seconds, distance} > 0 — OR carry max_effort: true ("as many as possible in the remaining window": metcon blocks with a bounded clock only, LAST movement only, one per block, never in plain AMRAPs, and NO volume fields alongside it). rep_scheme, cal_scheme, distance_scheme, and calories are valid specifiers — do NOT strip them.
- Movements use display-name strings from the vocabulary list in the user message.
- Pick exactly ONE work specifier per movement: rep-counted → emit rep_scheme as the per-iteration breakdown ([21,15,9] for chipper, [15,15,15] for 3 RFT, [100] for single-pass, [10] for one AMRAP iteration); DO NOT set reps (code derives it from sum(rep_scheme)). distance-counted → distance + distance_unit with the PER-ROUND distance and sets = the rounds count in a multi-round block ("3 RFT: Row 250m" → distance 250, sets 3); unit is ONLY "ft" or "m", never yards (60 yd → 180 ft, prose included). calorie-counted (Cal Row, Cal Bike, Cal Ski-erg) → the calories field with the PER-ROUND calories, same convention ("4 rounds of 15 cal" → calories 15, sets 4) — NEVER the summed total across rounds. When per-round calories/distance VARY with the scheme ("21-15-9 cal bike"), emit cal_scheme [21,15,9] / distance_scheme + distance_unit, with the scalar and sets left null (code derives the total). NEVER encode calories as rep_scheme or scaling_note.
- scheme_format is REQUIRED and TYPED — you do not write a header sentence; code renders the athlete-facing header from scheme_format + the movement rows. Pick the format and fill only its fields: amrap→minutes; emom→minutes (+ stations as movement-index slots, minutes a multiple of the slot count, EVERY movement row assigned to a station — a slot may hold two movements back to back; rest_remainder); rft→rounds; for_time→rounds_pattern for 21-15-9 ladders (must equal the varying movement schemes exactly); intervals→rounds+work_seconds+rest_seconds (+amrap_each_interval); steady→pace_note; work_sets/straight_sets/complex→rest_seconds (+rest_seconds_max); work_up→nothing (the top-set row carries the target); rounds_ntf→rounds. Never emit block_scheme text.
- A rotating-station EMOM's minute count must be a multiple of its station count (3 stations → EMOM 12 or 15, never 14).

Output ONLY the corrected block. Do NOT explain, do NOT apologize, do NOT emit anything outside the tool call.`;

/** Pick the slice of the skeleton that matters for this day. */
function findSkeletonDay(skeleton: SkeletonOutput, weekNum: number, dayNum: number):
  | { day_intent?: string; primary_lift?: string; strength_scheme?: string; metcon_focus?: string; skill_focus?: string }
  | null {
  for (const week of skeleton.weeks ?? []) {
    if (week.week_num !== weekNum) continue;
    for (const day of week.days ?? []) {
      if (day.day_num === dayNum) return day;
    }
  }
  return null;
}

/** Build the per-call user message — skeleton intent + bad block + violations + slim athlete context. */
function buildSurgicalUserMessage(
  payload: WriterPayload,
  skeletonDay: ReturnType<typeof findSkeletonDay>,
  weekNum: number,
  dayNum: number,
  blockIndex: number,
  originalBlock: BlockPrescription,
  violations: string[],
): string {
  const slimAthlete = {
    units: payload.basics.units ?? "lbs",
    lifts: payload.lifts,
    do_not_program: payload.training_context.injuries_structured?.do_not_program ?? [],
    vocabulary: payload.vocabulary,
  };

  const violationBlock = violations.length > 0
    ? `AUDIT VIOLATIONS (your previous attempt at this block; fix every one):\n${violations.map((v) => `  - ${v}`).join("\n")}`
    : "AUDIT VIOLATIONS: none reported (regenerate the block following the rules).";

  return [
    `LOCATION: Week ${weekNum}, Day ${dayNum}, block index ${blockIndex}.`,
    "",
    `SKELETON INTENT FOR THIS DAY:\n${JSON.stringify(skeletonDay ?? {}, null, 2)}`,
    "",
    `ORIGINAL BLOCK (the writer's output that needs correction):\n${JSON.stringify(originalBlock, null, 2)}`,
    "",
    violationBlock,
    "",
    `ATHLETE CONTEXT (slim — for vocabulary, loads, do-not-program):\n${JSON.stringify(slimAthlete, null, 2)}`,
    "",
    "Emit the corrected block via the emit_block tool. Same block_type as the original unless the violation requires a type change. Honor the skeleton's intent.",
  ].join("\n");
}

/**
 * Run one surgical block rewrite. Returns the corrected block or null on
 * any failure (Anthropic error, malformed tool_use, etc.) — caller treats
 * null as "surgical didn't work, fall through to writer-retry."
 */
export async function surgicallyRewriteBlock(
  payload: WriterPayload,
  skeleton: SkeletonOutput,
  weekNum: number,
  dayNum: number,
  blockIndex: number,
  originalBlock: BlockPrescription,
  violations: string[],
): Promise<BlockPrescription | null> {
  if (!ANTHROPIC_API_KEY) {
    console.warn("[surgical-block-fix] ANTHROPIC_API_KEY not configured; skipping surgical");
    return null;
  }

  const units = (payload.basics.units ?? "lbs") as "lbs" | "kg";
  const sessionLengthMinutes = payload.training_context.session_length_minutes ?? null;
  const skeletonDay = findSkeletonDay(skeleton, weekNum, dayNum);
  const userMessage = buildSurgicalUserMessage(
    payload, skeletonDay, weekNum, dayNum, blockIndex, originalBlock, violations,
  );

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        stream: false,
        system: SURGICAL_SYSTEM_PROMPT,
        tools: [buildEmitBlockTool(units, sessionLengthMinutes)],
        tool_choice: { type: "tool", name: "emit_block" },
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`[surgical-block-fix] HTTP ${resp.status} for w${weekNum}d${dayNum}b${blockIndex}: ${body.slice(0, 300)}`);
      return null;
    }

    const data = (await resp.json()) as ClaudeResponse;
    const toolUse = (data.content ?? []).find(
      (b) => b.type === "tool_use" && b.name === "emit_block",
    );
    if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
      console.warn(
        `[surgical-block-fix] no emit_block tool_use for w${weekNum}d${dayNum}b${blockIndex}; stop_reason=${data.stop_reason}`,
      );
      return null;
    }
    console.log(
      `[surgical-block-fix] w${weekNum}d${dayNum}b${blockIndex} Claude usage: input=${data.usage?.input_tokens} output=${data.usage?.output_tokens}`,
    );
    return toolUse.input as BlockPrescription;
  } catch (err) {
    console.warn(`[surgical-block-fix] error for w${weekNum}d${dayNum}b${blockIndex}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Splice a corrected block back into the writer's output at its original
 * location. Mutates the output in place. Returns true on success, false
 * if the location couldn't be found (shouldn't happen unless the audit
 * referenced a stale path).
 */
export function spliceBlock(
  output: WriterOutput,
  weekNum: number,
  dayNum: number,
  blockIndex: number,
  newBlock: BlockPrescription,
): boolean {
  for (const week of output.weeks ?? []) {
    if (week.week_num !== weekNum) continue;
    for (const day of week.days ?? []) {
      if (day.day_num !== dayNum) continue;
      const blocks = day.blocks ?? [];
      if (blockIndex < 0 || blockIndex >= blocks.length) return false;
      blocks[blockIndex] = newBlock;
      return true;
    }
  }
  return false;
}
