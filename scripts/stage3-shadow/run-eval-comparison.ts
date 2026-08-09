/**
 * run-eval-comparison.ts — Stage 1: the free-eval side-by-side.
 *
 * Builds ONE athlete's real WriterPayload (read-only), then runs the identical
 * CoachState prompt + forced tool schema against each model in --models. Only
 * the model varies. NOTHING IS PERSISTED — the athlete's real eval and
 * coach_states rows are untouched; outputs land on local disk only.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
 *   deno run --allow-net --allow-env --allow-read --allow-write \
 *     scripts/stage3-shadow/run-eval-comparison.ts \
 *     --user=<uuid> \
 *     [--models=claude-sonnet-4-6,claude-opus-4-8,claude-fable-5] \
 *     [--out=eval-compare]
 *
 * Output: <out>/<user-prefix>/
 *   eval-<model>.md   ← the evaluation AS THE ATHLETE WOULD READ IT
 *                       (rendered via the same evaluationFromCoachState mapping
 *                       production uses)
 *   decisions.md      ← compact cross-model table of the INTERNAL decisions
 *                       (priorities+ranks+confidence, maintain, deprioritize,
 *                       recovery stance, strength emphasis) — shows whether the
 *                       models JUDGE differently or just WRITE differently
 *   raw-<model>.json  ← full CoachState content per model
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildWriterPayload } from "../../supabase/functions/_shared/build-writer-payload.ts";
import type { WriterPayload } from "../../supabase/functions/_shared/build-writer-payload.ts";
import {
  buildEmitCoachStateTool,
  evaluationFromCoachState,
  type CoachStateContent,
} from "../../supabase/functions/_shared/coach-state.ts";
import { COACH_STATE_SYSTEM_PROMPT } from "../../supabase/functions/_shared/coach-state-prompt.ts";
import { athleteModelEvidenceKeys } from "../../supabase/functions/_shared/athlete-model.ts";

// ============================================================
// Args + env
// ============================================================

function arg(name: string, fallback?: string): string | undefined {
  const hit = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const USER_ID = arg("user");
const OUT_ROOT = arg("out", "eval-compare")!;
const MODELS_ARG = arg("models", "claude-sonnet-4-6,claude-opus-4-8,claude-fable-5")!;
const MODEL_LIST = MODELS_ARG.split(",").map((m) => m.trim()).filter(Boolean);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!USER_ID) {
  console.error("Missing --user=<uuid> (the athlete's user ID, from the Supabase auth users page).");
  Deno.exit(1);
}
if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.");
  Deno.exit(1);
}

// ============================================================
// One CoachState call per model — same prompt, same tool, same payload
// ============================================================

async function callCoachStateWithModel(
  payload: WriterPayload,
  model: string,
): Promise<{ content: CoachStateContent; usage: { input?: number; output?: number } }> {
  const tool = buildEmitCoachStateTool(athleteModelEvidenceKeys(payload.athlete_model));
  const userMessage = `ATHLETE PAYLOAD (JSON):\n${JSON.stringify(payload, null, 2)}`;

  for (let attempt = 1; ; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        stream: false,
        system: COACH_STATE_SYSTEM_PROMPT,
        tools: [tool],
        tool_choice: { type: "tool", name: "emit_coach_state" },
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (resp.ok) {
      // deno-lint-ignore no-explicit-any
      const data: any = await resp.json();
      // deno-lint-ignore no-explicit-any
      const toolUse = (data.content ?? []).find((b: any) => b.type === "tool_use" && b.name === "emit_coach_state");
      if (!toolUse?.input) throw new Error(`[${model}] response missing emit_coach_state (stop_reason=${data.stop_reason})`);
      return {
        content: toolUse.input as CoachStateContent,
        usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens },
      };
    }
    const body = await resp.text().catch(() => "");
    if (attempt < 3 && (resp.status === 429 || resp.status >= 500)) {
      console.warn(`  [${model}] transient ${resp.status}; retry ${attempt}/2`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    throw new Error(`[${model}] Claude HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
}

// ============================================================
// Rendering
// ============================================================

/** The eval exactly as production maps it for the athlete-facing surface. */
function renderAthleteEval(model: string, cs: CoachStateContent): string {
  const ev = evaluationFromCoachState(cs);
  const lines: string[] = [
    `# Evaluation — ${model}`,
    ``,
    `## ${ev.headline_takeaway}`,
    ``,
    `### Strengths`,
    ...ev.strengths.map((s) => `- ${s}`),
    ``,
    `### Weaknesses & priorities`,
    ...ev.weaknesses_and_priorities.map((w) => `- ${w}`),
    ``,
    `### Analysis`,
    ev.detailed_analysis,
    ``,
    `### Recommendations`,
    ...ev.recommendations.map((r) => `- ${r}`),
  ];
  return lines.join("\n");
}

function renderDecisionsTable(results: Array<{ model: string; cs: CoachStateContent }>): string {
  const lines: string[] = [
    `# Internal decisions — cross-model comparison`,
    ``,
    `Same payload, same prompt, same schema — only the model differs. If the`,
    `rows match, the models judge alike and differ only in prose; if the rows`,
    `diverge, the models genuinely see the athlete differently.`,
    ``,
    `| decision | ${results.map((r) => r.model).join(" | ")} |`,
    `|---|${results.map(() => "---").join("|")}|`,
  ];
  const cell = (fn: (cs: CoachStateContent) => string) =>
    results.map((r) => fn(r.cs) || "—").join(" | ");

  const maxPriorities = Math.max(...results.map((r) => r.cs.priorities.length));
  for (let rank = 1; rank <= maxPriorities; rank++) {
    lines.push(
      `| priority #${rank} | ${cell((cs) => {
        const p = cs.priorities.find((x) => x.rank === rank);
        return p ? `${p.focus} (${p.confidence})` : "";
      })} |`,
    );
  }
  lines.push(`| maintain | ${cell((cs) => cs.maintain.map((m) => m.focus).join(", "))} |`);
  lines.push(`| deprioritize | ${cell((cs) => cs.deprioritize.map((d) => d.focus).join(", "))} |`);
  lines.push(`| recovery stance | ${cell((cs) => cs.recovery_posture.stance)} |`);
  lines.push(`| strength emphasis | ${cell((cs) => cs.strength_emphasis.value)} |`);
  return lines.join("\n");
}

// ============================================================
// Main
// ============================================================

// deno-lint-ignore no-explicit-any
const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY) as any;

console.log(`Building payload for ${USER_ID}…`);
const payload = await buildWriterPayload(supa, USER_ID);
console.log(
  `Payload ready (athlete_model v${payload.athlete_model.version}). Running ${MODEL_LIST.length} models…`,
);

const outDir = `${OUT_ROOT}/${USER_ID.slice(0, 8)}`;
await Deno.mkdir(outDir, { recursive: true });

const results: Array<{ model: string; cs: CoachStateContent }> = [];
for (const model of MODEL_LIST) {
  console.log(`  ${model}…`);
  const { content, usage } = await callCoachStateWithModel(payload, model);
  console.log(`    input=${usage.input} output=${usage.output}`);
  results.push({ model, cs: content });
  const slug = model.replace(/[^a-z0-9.-]+/gi, "-");
  await Deno.writeTextFile(`${outDir}/eval-${slug}.md`, renderAthleteEval(model, content) + "\n");
  await Deno.writeTextFile(`${outDir}/raw-${slug}.json`, JSON.stringify(content, null, 2));
}

await Deno.writeTextFile(`${outDir}/decisions.md`, renderDecisionsTable(results) + "\n");
console.log(`\nDone. Open ${outDir}/ — eval-<model>.md are the athlete-facing reads; decisions.md compares the judgments.`);
