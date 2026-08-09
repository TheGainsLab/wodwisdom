/**
 * run-shadow-pairs.ts — Stage 3 shadow test pair generator.
 *
 * Runs the ten pre-registered athletes through BOTH skeleton arms:
 *   enum arm     — the live skeleton writer, byte-identical call (Sonnet, TDI only)
 *   frontier arm — live prompt + frontier addendum, TDI + full CoachState document
 *
 * READ-ONLY against production: coach_states is read (cache hit expected); on a
 * miss the CoachState is generated IN MEMORY and never persisted. Nothing is
 * written to any table. Outputs land on local disk only.
 *
 * Usage (Deno; needs `brew install deno` if absent):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
 *   deno run --allow-net --allow-env --allow-read --allow-write \
 *     scripts/stage3-shadow/run-shadow-pairs.ts \
 *     --athletes=scripts/stage3-shadow/athletes.json \
 *     [--out=shadow-out] [--frontier-model=claude-opus-4-8]
 *
 * Output layout (see README.md for the blinding procedure):
 *   <out>/pair-NN/outline-A.md, outline-B.md, inputs.md   ← scorer packet
 *   <out>/pair-NN/machine.json                            ← arm-keyed, NOT for scorers
 *   <out>/assignment-key.json                             ← unblinding key, non-scorer holds it
 *   <out>/summary.md                                      ← machine-row roll-up
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildWriterPayload } from "../../supabase/functions/_shared/build-writer-payload.ts";
import {
  buildTrainingDesignInput,
  type TrainingDesignInput,
} from "../../supabase/functions/_shared/training-design-input.ts";
import {
  allowedReasonCodes,
  buildEmitCoachStateTool,
  COACH_STATE_BUILDER_VERSION,
  type CoachState,
  type CoachStateContent,
} from "../../supabase/functions/_shared/coach-state.ts";
import { COACH_STATE_SYSTEM_PROMPT } from "../../supabase/functions/_shared/coach-state-prompt.ts";
import { athleteModelEvidenceKeys } from "../../supabase/functions/_shared/athlete-model.ts";
import { MODELS } from "../../supabase/functions/_shared/model-profiles.ts";
import { callSkeletonWriter } from "../../supabase/functions/_shared/engine/pipeline.ts";
import { CROSSFIT_PACK } from "../../supabase/functions/_shared/domain-packs/crossfit/index.ts";
import { buildEmitSkeletonTool, type SkeletonOutput } from "../../supabase/functions/_shared/v3-output-schema.ts";
import type { WriterPayload } from "../../supabase/functions/_shared/build-writer-payload.ts";
import {
  crossCheckWithLiveInvariants,
  runMachineRows,
  summarizeMachineRows,
} from "../../supabase/functions/_shared/stage3-machine-rows.ts";
import {
  buildCoachStateDocumentBlock,
  buildFrontierSkeletonSystemPrompt,
} from "./frontier-skeleton-prompt.ts";

// ============================================================
// Args + env
// ============================================================

function arg(name: string, fallback?: string): string | undefined {
  const hit = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const ATHLETES_PATH = arg("athletes");
const OUT_DIR = arg("out", "shadow-out")!;
const FRONTIER_MODEL = arg("frontier-model", "claude-opus-4-8")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!ATHLETES_PATH) {
  console.error("Missing --athletes=<path to athletes.json>. See athletes.example.json.");
  Deno.exit(1);
}
if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.");
  Deno.exit(1);
}

interface AthleteSpec {
  user_id: string;
  category: string;
}

const athletes: AthleteSpec[] = JSON.parse(await Deno.readTextFile(ATHLETES_PATH));

// ============================================================
// CoachState — read-only load (cache hit expected; in-memory generation on
// miss, NEVER persisted)
// ============================================================

// deno-lint-ignore no-explicit-any
const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY) as any;

async function loadCoachStateReadOnly(userId: string, payload: WriterPayload): Promise<{ coachState: CoachState; source: string }> {
  const amVersion = payload.athlete_model.version;
  const { data: cached } = await supa
    .from("coach_states")
    .select("version, coach_state")
    .eq("user_id", userId)
    .eq("athlete_model_version", amVersion)
    .eq("coach_state_builder_version", COACH_STATE_BUILDER_VERSION)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cached) return { coachState: cached.coach_state as CoachState, source: `cache v${cached.version}` };

  // Miss (e.g. intake-only new athlete): generate in memory, do NOT persist.
  // Fable + reason shaping — matches the production judgment seat post-#649.
  const tool = buildEmitCoachStateTool(
    athleteModelEvidenceKeys(payload.athlete_model),
    allowedReasonCodes(payload),
  );
  const data = await callClaude({
    model: MODELS.fable,
    system: COACH_STATE_SYSTEM_PROMPT,
    tools: [tool],
    tool_choice: { type: "tool", name: "emit_coach_state" },
    userMessage: `ATHLETE PAYLOAD (JSON):\n${JSON.stringify(payload, null, 2)}`,
  });
  const content = extractToolInput(data, "emit_coach_state") as CoachStateContent;
  const coachState = {
    ...content,
    coach_state_builder_version: COACH_STATE_BUILDER_VERSION,
    version: 0, // shadow-only marker: never persisted
    athlete_model_version: amVersion,
  } as unknown as CoachState;
  return { coachState, source: "generated in-memory (not persisted)" };
}

// ============================================================
// Claude plumbing (frontier arm + in-memory CoachState)
// ============================================================

interface ClaudeCallOpts {
  model: string;
  system: string;
  // deno-lint-ignore no-explicit-any
  tools: any[];
  // deno-lint-ignore no-explicit-any
  tool_choice: any;
  userMessage: string;
}

// deno-lint-ignore no-explicit-any
async function callClaude(opts: ClaudeCallOpts): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 8000,
        stream: false,
        system: opts.system,
        tools: opts.tools,
        tool_choice: opts.tool_choice,
        messages: [{ role: "user", content: opts.userMessage }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (resp.ok) {
      const data = await resp.json();
      console.log(
        `    [${opts.model}] input=${data.usage?.input_tokens} output=${data.usage?.output_tokens}`,
      );
      return data;
    }
    const body = await resp.text().catch(() => "");
    if (attempt < 3 && (resp.status === 429 || resp.status >= 500)) {
      console.warn(`    transient ${resp.status}; retry ${attempt}/2`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    throw new Error(`Claude HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }
}

// deno-lint-ignore no-explicit-any
function extractToolInput(data: any, toolName: string): unknown {
  // deno-lint-ignore no-explicit-any
  const toolUse = (data.content ?? []).find((b: any) => b.type === "tool_use" && b.name === toolName);
  if (!toolUse?.input) throw new Error(`Response missing ${toolName} tool_use (stop_reason=${data.stop_reason})`);
  return toolUse.input;
}

/** Frontier arm: live prompt + addendum; TDI + full CoachState document. Same
 *  tool schema and rule recap as the live call — the deltas are the addendum,
 *  the document block, and the model. */
async function callFrontierSkeleton(tdi: TrainingDesignInput, coachState: CoachState): Promise<SkeletonOutput> {
  const daysPerWeek = tdi.days_per_week;
  const inputBlock = `TRAINING DESIGN INPUT (JSON — the FIXED plan to allocate):\n${JSON.stringify(tdi, null, 2)}`;
  const docBlock = buildCoachStateDocumentBlock(coachState);
  const ruleRecap = CROSSFIT_PACK.writer.skeletonRuleRecap(daysPerWeek, tdi);
  const data = await callClaude({
    model: FRONTIER_MODEL,
    system: buildFrontierSkeletonSystemPrompt(),
    tools: [buildEmitSkeletonTool(daysPerWeek)],
    tool_choice: { type: "tool", name: "emit_skeleton" },
    userMessage: `${inputBlock}\n\n${docBlock}\n\n${ruleRecap}`,
  });
  return extractToolInput(data, "emit_skeleton") as SkeletonOutput;
}

// ============================================================
// Scorer-packet rendering
// ============================================================

function renderOutline(skeleton: SkeletonOutput): string {
  const lines: string[] = [];
  const mp = skeleton.month_plan ?? ({} as SkeletonOutput["month_plan"]);
  lines.push(`## Month plan`);
  lines.push(`- Weekly arc: ${(mp.weekly_intent ?? []).join(" → ")}`);
  lines.push(`- Strength progression: ${mp.strength_progression ?? "—"}`);
  lines.push(`- Deload placement: ${mp.deload_placement ?? "—"}`);
  if (mp.programming_priorities) lines.push(`- Programming priorities: ${mp.programming_priorities}`);
  for (const wk of skeleton.weeks ?? []) {
    lines.push(``, `## Week ${wk.week_num} — ${wk.weekly_intent}`);
    for (const day of wk.days ?? []) {
      lines.push(``, `**Day ${day.day_num}** — ${day.day_intent}`);
      lines.push(`- Blocks: ${(day.block_types ?? []).join(", ")}`);
      if (day.primary_lift) lines.push(`- Strength: ${day.primary_lift} — ${day.strength_scheme ?? "—"}`);
      if (day.skill_focus) lines.push(`- Skills: ${day.skill_focus}`);
      if (day.metcon_focus) lines.push(`- Metcon: ${day.metcon_focus}`);
      const intents = (day.block_intents ?? [])
        .map((bi) => `${bi.block_type}→${bi.focus} (${bi.purpose}${bi.source_priority_rank ? ` r${bi.source_priority_rank}` : ""})`)
        .join(" · ");
      if (intents) lines.push(`- Declared intent: ${intents}`);
    }
  }
  return lines.join("\n");
}

function renderInputs(spec: AthleteSpec, tdi: TrainingDesignInput, coachState: CoachState): string {
  return [
    `# Pair inputs — ${spec.category}`,
    ``,
    `Both outlines were generated from the same locked plan below. One arm ALSO`,
    `received the full Coach State document. Score per the pre-registered rubric:`,
    `H1 nuance utilization (per outline, 1–5), H2 soft drift (quote required),`,
    `H3 coherence (per outline, 1–5).`,
    ``,
    `## Typed decisions (both arms — THE LOCKED PLAN)`,
    "```json",
    JSON.stringify(
      {
        priorities: tdi.priorities,
        maintain: tdi.maintain,
        deprioritize: tdi.deprioritize,
        recovery_stance: tdi.recovery_stance,
        strength_emphasis: tdi.strength_emphasis,
        days_per_week: tdi.days_per_week,
        session_length_minutes: tdi.session_length_minutes,
        do_not_program: tdi.do_not_program,
      },
      null,
      2,
    ),
    "```",
    ``,
    `## Full Coach State document (one arm only)`,
    "```json",
    JSON.stringify(coachState, null, 2),
    "```",
  ].join("\n");
}

// ============================================================
// Main
// ============================================================

interface KeyEntry {
  pair: number;
  user_id: string;
  category: string;
  A: "enum" | "frontier";
  B: "enum" | "frontier";
  coach_state_source: string;
}

await Deno.mkdir(OUT_DIR, { recursive: true });
const key: KeyEntry[] = [];
const summaryLines: string[] = [
  `# Stage 3 shadow run — machine-row summary`,
  ``,
  `Frontier model: ${FRONTIER_MODEL}`,
  ``,
  `| pair | category | enum arm | frontier arm | cross-check |`,
  `|---|---|---|---|---|`,
];

for (let i = 0; i < athletes.length; i++) {
  const spec = athletes[i];
  const pairNum = i + 1;
  const pairDir = `${OUT_DIR}/pair-${String(pairNum).padStart(2, "0")}`;
  await Deno.mkdir(pairDir, { recursive: true });
  console.log(`\n[pair ${pairNum}/${athletes.length}] ${spec.category} (${spec.user_id})`);

  const payload = await buildWriterPayload(supa, spec.user_id);
  const { coachState, source } = await loadCoachStateReadOnly(spec.user_id, payload);
  console.log(`  coach_state: ${source}`);

  const tdi = buildTrainingDesignInput(coachState, {
    days_per_week: payload.training_context.days_per_week,
    session_length_minutes: payload.training_context.session_length_minutes,
    equipment: payload.equipment,
    do_not_program: payload.training_context.injuries_structured?.do_not_program ?? [],
    vocabulary: payload.vocabulary,
    lifts: payload.lifts,
    previous_cycle: payload.previous_cycle,
  });

  console.log(`  enum arm (live call)…`);
  const enumSkeleton = await callSkeletonWriter(tdi, "", CROSSFIT_PACK);
  console.log(`  frontier arm…`);
  const frontierSkeleton = await callFrontierSkeleton(tdi, coachState);

  const enumRows = runMachineRows(enumSkeleton, tdi);
  const frontierRows = runMachineRows(frontierSkeleton, tdi);
  const crossNotes = [
    ...crossCheckWithLiveInvariants(enumSkeleton, tdi),
    ...crossCheckWithLiveInvariants(frontierSkeleton, tdi),
  ];

  // Blind assignment: coin flip which arm becomes label A.
  const enumIsA = Math.random() < 0.5;
  const outlines: Record<"A" | "B", SkeletonOutput> = {
    A: enumIsA ? enumSkeleton : frontierSkeleton,
    B: enumIsA ? frontierSkeleton : enumSkeleton,
  };
  key.push({
    pair: pairNum,
    user_id: spec.user_id,
    category: spec.category,
    A: enumIsA ? "enum" : "frontier",
    B: enumIsA ? "frontier" : "enum",
    coach_state_source: source,
  });

  await Deno.writeTextFile(`${pairDir}/outline-A.md`, `# Pair ${pairNum} — Outline A\n\n${renderOutline(outlines.A)}\n`);
  await Deno.writeTextFile(`${pairDir}/outline-B.md`, `# Pair ${pairNum} — Outline B\n\n${renderOutline(outlines.B)}\n`);
  await Deno.writeTextFile(`${pairDir}/inputs.md`, renderInputs(spec, tdi, coachState) + "\n");
  await Deno.writeTextFile(
    `${pairDir}/machine.json`,
    JSON.stringify(
      {
        pair: pairNum,
        user_id: spec.user_id,
        category: spec.category,
        enum: { rows: enumRows, skeleton: enumSkeleton },
        frontier: { rows: frontierRows, skeleton: frontierSkeleton },
        cross_check_notes: crossNotes,
        tdi,
      },
      null,
      2,
    ),
  );
  summaryLines.push(
    `| ${pairNum} | ${spec.category} | ${summarizeMachineRows(enumRows)} | ${summarizeMachineRows(frontierRows)} | ${crossNotes.length === 0 ? "ok" : `${crossNotes.length} note(s)`} |`,
  );
  console.log(`  machine: enum[${summarizeMachineRows(enumRows)}] frontier[${summarizeMachineRows(frontierRows)}]`);
}

await Deno.writeTextFile(`${OUT_DIR}/assignment-key.json`, JSON.stringify(key, null, 2));
await Deno.writeTextFile(`${OUT_DIR}/summary.md`, summaryLines.join("\n") + "\n");
console.log(`\nDone. Scorer packets in ${OUT_DIR}/pair-*/ — hand assignment-key.json to the non-scorer NOW (see README.md).`);
