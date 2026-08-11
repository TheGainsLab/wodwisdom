/**
 * compose-metcons.ts — harness for the month-sighted metcon composer.
 *
 * Reads a saved shadow-run skeleton (machine.json), derives the conditioning
 * slots from it, runs ONE composer call, then the set-level variety audit
 * (one retry on failure) — and writes the composed month + audit report.
 *
 * Slots are DERIVED from the existing skeleton (time domain parsed from
 * metcon_focus, intensity from weekly_intent, focus from block_intents), so
 * this runs against every machine.json already on disk — no skeleton
 * regeneration, no production writes. Model is a flag so the Sonnet-vs-Fable
 * composer test is two invocations of the same script.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
 *   [OPENAI_API_KEY=...] \
 *   deno run --allow-net --allow-env --allow-read --allow-write \
 *     scripts/stage3-shadow/compose-metcons.ts \
 *     --machine=shadow-out-nick2/pair-01/machine.json \
 *     [--arm=claude-fable-5] [--model=claude-sonnet-4-6]
 *
 * Output (next to machine.json):
 *   metcons-<model>.md / metcons-<model>.json
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  callMetconComposer,
  type ComposedMetcon,
  type MetconComposerInputs,
  type MetconSlot,
} from "../../supabase/functions/_shared/metcon-composer.ts";
import {
  auditMetconVariety,
  formatMetconVarietyViolationsForRetry,
  isBarbellMetconMovement,
} from "../../supabase/functions/_shared/metcon-variety-audits.ts";
import { buildStratifiedMetconExamples } from "../../supabase/functions/_shared/metcon-examples.ts";
import type { SkeletonOutput } from "../../supabase/functions/_shared/v3-output-schema.ts";

function arg(name: string, fallback?: string): string | undefined {
  const hit = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const MACHINE_PATH = arg("machine");
const ARM = arg("arm", "claude-fable-5")!;
const MODEL = arg("model", "claude-sonnet-4-6")!;

if (!MACHINE_PATH) {
  console.error("Missing --machine=<path to a pair's machine.json>");
  Deno.exit(1);
}
if (!Deno.env.get("ANTHROPIC_API_KEY")) {
  console.error("Set ANTHROPIC_API_KEY (plus SUPABASE_* and OPENAI_API_KEY for examples).");
  Deno.exit(1);
}

const machine = JSON.parse(await Deno.readTextFile(MACHINE_PATH));
const skeleton: SkeletonOutput = machine.arms?.[ARM]?.skeleton;
const tdi = machine.tdi;
if (!skeleton || !tdi) {
  console.error(`Arm "${ARM}" or tdi missing in ${MACHINE_PATH}. Arms: ${Object.keys(machine.arms ?? {}).join(", ")}`);
  Deno.exit(1);
}

// ── Derive slots from the existing skeleton ──
function parseTimeDomain(focus: string): "short" | "medium" | "long" {
  const f = focus.toLowerCase();
  const m = focus.match(/\((\d+)(?:\s*[-–—]\s*(\d+))?\s*min/i);
  if (m) {
    const upper = parseInt(m[2] ?? m[1], 10);
    if (upper <= 8) return "short";
    if (upper <= 15) return "medium";
    return "long";
  }
  if (f.includes("short")) return "short";
  if (f.includes("long")) return "long";
  return "medium";
}

const slots: MetconSlot[] = [];
for (const wk of skeleton.weeks ?? []) {
  for (const day of wk.days ?? []) {
    if (!(day.block_types ?? []).includes("metcon")) continue;
    const metconIntent = (day.block_intents ?? []).find((b) => b.block_type === "metcon");
    const accessory = (day.block_intents ?? [])
      .filter((b) => b.block_type === "accessory")
      .map((b) => b.focus);
    slots.push({
      week_num: wk.week_num,
      day_num: day.day_num,
      time_domain: parseTimeDomain(day.metcon_focus ?? ""),
      intensity: `${wk.weekly_intent}`,
      focus: metconIntent?.focus ?? "aerobic_capacity",
      day_context: {
        primary_lift: day.primary_lift,
        strength_scheme: day.strength_scheme,
        skill_focus: day.skill_focus,
        accessory_focuses: accessory,
      },
    });
  }
}
console.log(`Derived ${slots.length} conditioning slots from ${ARM} skeleton.`);

// ── Examples (soft-optional) ──
let examples = "";
if (Deno.env.get("SUPABASE_URL") && Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") && Deno.env.get("OPENAI_API_KEY")) {
  // deno-lint-ignore no-explicit-any
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) as any;
  examples = await buildStratifiedMetconExamples(supa);
  console.log(`Examples: ${examples ? `${examples.length} chars retrieved` : "none (retrieval empty)"}`);
} else {
  console.log("Examples: skipped (SUPABASE_*/OPENAI_API_KEY not all set)");
}

// ── Compose ──
const inputs: MetconComposerInputs = {
  slots,
  // Harness fallback: pre-v1.7 machine.json has no CoachState metcon_guidance.
  metcon_guidance: machine.metcon_guidance ??
    `Conditioning priorities by rank: ${(tdi.priorities ?? []).map((p: { focus: string; rank: number }) => `${p.rank}. ${p.focus}`).join(", ")}. Recovery stance: ${tdi.recovery_stance}.`,
  vocabulary: tdi.vocabulary ?? [],
  equipment: tdi.equipment ?? {},
  do_not_program: tdi.do_not_program ?? [],
  skills: machine.skills ?? {},
  lifts: tdi.lifts ?? {},
  conditioning_benchmarks: machine.conditioning_benchmarks ?? {},
  athlete_context: `${machine.category ?? ""}; session_length ${tdi.session_length_minutes ?? "?"} min; ${tdi.days_per_week} days/week`,
  previous_cycle_metcons: [],
  examples,
};

const banned = new Set((tdi.do_not_program ?? []).map((s: string) => s.toLowerCase()));
const barbellCapable = (tdi.equipment?.barbell ?? false) &&
  (tdi.vocabulary ?? []).some((v: string) => isBarbellMetconMovement(v) && !banned.has(v.toLowerCase()));

console.log(`Composing ${slots.length} metcons with ${MODEL} (barbell-capable: ${barbellCapable})…`);
let output = await callMetconComposer(inputs, { model: MODEL });
let audit = auditMetconVariety(output, { slots, barbellCapable });
let retried = false;
if (!audit.passed) {
  console.log(`  variety audit FAIL (${audit.violations.length}) — one retry:\n    ${audit.violations.join("\n    ")}`);
  retried = true;
  output = await callMetconComposer(inputs, {
    model: MODEL,
    retryViolations: formatMetconVarietyViolationsForRetry(audit.violations),
  });
  audit = auditMetconVariety(output, { slots, barbellCapable });
}
console.log(
  `  variety audit: ${audit.passed ? "PASS" : `FAIL (${audit.violations.length})`}${retried ? " (after retry)" : ""}` +
    `${audit.warnings.length ? ` · ${audit.warnings.length} warning(s)` : ""}`,
);

// ── Report ──
const byWeek = new Map<number, ComposedMetcon[]>();
for (const m of output.metcons) {
  byWeek.set(m.week_num, [...(byWeek.get(m.week_num) ?? []), m]);
}
const md: string[] = [
  `# Composed metcons — ${MODEL} (${machine.category ?? machine.user_id})`,
  ``,
  `${output.metcons.length} pieces · Variety audit: ${audit.passed ? "PASS" : "FAIL"}${retried ? " (after retry)" : ""}`,
  ``,
];
if (audit.violations.length) md.push(`## Violations`, ...audit.violations.map((v) => `- ${v}`), ``);
if (audit.warnings.length) md.push(`## Warnings`, ...audit.warnings.map((w) => `- ${w}`), ``);

// Set-level stats — the scorecard.
const freq = new Map<string, number>();
const formats = new Map<string, number>();
let barbellCount = 0;
for (const m of output.metcons) {
  formats.set(m.format, (formats.get(m.format) ?? 0) + 1);
  if (m.movements.some((mv) => isBarbellMetconMovement(mv.movement))) barbellCount++;
  for (const mv of new Set(m.movements.map((x) => x.movement))) {
    freq.set(mv, (freq.get(mv) ?? 0) + 1);
  }
}
md.push(`## Scorecard`);
md.push(`- Formats: ${[...formats.entries()].map(([f, c]) => `${f}×${c}`).join(" · ")}`);
md.push(`- Barbell-bearing pieces: ${barbellCount}/${output.metcons.length}`);
md.push(
  `- Movement spread (top 8): ${
    [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, c]) => `${m}×${c}`).join(" · ")
  }`,
);
md.push(``);

for (const [wk, pieces] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
  md.push(`## Week ${wk}`);
  for (const m of pieces.sort((a, b) => a.day_num - b.day_num)) {
    md.push(
      ``,
      `**Day ${m.day_num}** — ${m.block_scheme} _(${m.format}, ~${m.stated_duration_minutes} min${m.monostructural ? ", monostructural" : ""})_`,
    );
    for (const mv of m.movements) md.push(`- ${mv.movement} — ${mv.prescription}`);
    md.push(`> ${m.stimulus_note}`);
  }
  md.push(``);
}

const dir = MACHINE_PATH.replace(/\/[^/]+$/, "");
const slug = MODEL.replace(/[^a-z0-9.-]+/gi, "-");
await Deno.writeTextFile(`${dir}/metcons-${slug}.md`, md.join("\n") + "\n");
await Deno.writeTextFile(
  `${dir}/metcons-${slug}.json`,
  JSON.stringify({ user_id: machine.user_id, model: MODEL, slots, output, audit, retried }, null, 2),
);
console.log(`\nDone. Read ${dir}/metcons-${slug}.md`);
