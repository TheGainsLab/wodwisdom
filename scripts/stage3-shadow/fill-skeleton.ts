/**
 * fill-skeleton.ts — run the LIVE week-fill (Sonnet) over a saved shadow-test
 * skeleton, producing a complete 4-week program for the adherence read.
 *
 * No new skeleton generation: reads the winning arm's skeleton straight out of
 * a pair's machine.json. Read-only against production; program lands on disk.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
 *   COMPETITION_SERVICE_BASE_URL=... COMPETITION_SERVICE_KEY=... \
 *   deno run --allow-net --allow-env --allow-read --allow-write \
 *     scripts/stage3-shadow/fill-skeleton.ts \
 *     --machine=shadow-out/pair-01/machine.json \
 *     [--arm=claude-fable-5]
 *
 * Output (next to machine.json):
 *   program-<arm>.md    ← the filled program, human-readable
 *   program-<arm>.json  ← WriterOutput + live hard-audit results + adherence report
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildWriterPayload } from "../../supabase/functions/_shared/build-writer-payload.ts";
import { auditOutput, callWeekFill } from "../../supabase/functions/_shared/engine/pipeline.ts";
import { CROSSFIT_PACK } from "../../supabase/functions/_shared/domain-packs/crossfit/index.ts";
import type { SkeletonOutput } from "../../supabase/functions/_shared/v3-output-schema.ts";
import type { WeekPrescription, WriterOutput } from "../../supabase/functions/_shared/v2-output-schema.ts";

function arg(name: string, fallback?: string): string | undefined {
  const hit = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const MACHINE_PATH = arg("machine");
const ARM = arg("arm", "claude-fable-5")!;
/** Match the month the skeleton was generated as (see run-shadow-pairs --month). */
const MONTH = Math.max(1, parseInt(arg("month", "1")!, 10) || 1);
/** Composed-metcon handoff (2026-08 composer split): path to a compose-metcons
 *  output json. When given, each week's fill receives its composed pieces and
 *  transcribes them — the exact production handoff. */
const METCONS_PATH = arg("metcons");

if (!MACHINE_PATH) {
  console.error("Missing --machine=<path to a pair's machine.json>");
  Deno.exit(1);
}
for (const v of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]) {
  if (!Deno.env.get(v)) {
    console.error(`Set ${v} (plus COMPETITION_SERVICE_* for linked athletes).`);
    Deno.exit(1);
  }
}

const machine = JSON.parse(await Deno.readTextFile(MACHINE_PATH));
const userId: string = machine.user_id;
const skeleton: SkeletonOutput = machine.arms?.[ARM]?.skeleton;
if (!skeleton) {
  console.error(`Arm "${ARM}" not found in ${MACHINE_PATH}. Arms: ${Object.keys(machine.arms ?? {}).join(", ")}`);
  Deno.exit(1);
}

// deno-lint-ignore no-explicit-any
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) as any;

// deno-lint-ignore no-explicit-any
let composedMetcons: any[] = [];
if (METCONS_PATH) {
  const composed = JSON.parse(await Deno.readTextFile(METCONS_PATH));
  composedMetcons = composed.output?.metcons ?? composed.metcons ?? [];
  console.log(`Composed metcons: ${composedMetcons.length} pieces from ${METCONS_PATH}`);
}

console.log(`Filling ${ARM} skeleton for ${userId} (${machine.category ?? "?"})…`);
const payload = await buildWriterPayload(supa, userId, { monthNumber: MONTH, includeEvaluations: true });

const weeks: WeekPrescription[] = [];
for (let w = 1; w <= 4; w++) {
  console.log(`  week ${w}…`);
  const weekMetcons = composedMetcons.filter((m) => m.week_num === w);
  const week = await callWeekFill(payload, skeleton, w, weeks, "", CROSSFIT_PACK, weekMetcons);
  weeks.push(week);
}
const output: WriterOutput = { month_plan: skeleton.month_plan, weeks };

// LIVE hard audits — the production gate the filled program must clear.
const audit = auditOutput(output, payload, skeleton, CROSSFIT_PACK);
console.log(`  live hard audits: ${audit.passed ? "PASS" : `FAIL (${audit.failures.length} rule(s))`}`);

// ── Skeleton-adherence report (deterministic; the fill must EXECUTE the
//    skeleton — block types, primary lifts, metcon presence) ──
const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
const adherence: string[] = [];
for (const skWeek of skeleton.weeks ?? []) {
  const filled = weeks.find((w) => w.week_num === skWeek.week_num);
  for (const skDay of skWeek.days ?? []) {
    const fDay = filled?.days?.find((d) => d.day_num === skDay.day_num);
    const at = `W${skWeek.week_num}D${skDay.day_num}`;
    if (!fDay) {
      adherence.push(`${at}: missing from filled program.`);
      continue;
    }
    const filledTypes = new Set(fDay.blocks.map((b) => b.block_type));
    for (const bt of skDay.block_types ?? []) {
      if (!filledTypes.has(bt)) adherence.push(`${at}: skeleton block "${bt}" missing from fill.`);
    }
    if (skDay.primary_lift) {
      const strengthMovements = fDay.blocks
        .filter((b) => b.block_type === "strength")
        .flatMap((b) => b.movements ?? [])
        .map((m) => norm(m.movement));
      // Lenient: any word of the primary lift's normalized name appearing in a
      // strength movement counts (complex descriptions won't match verbatim).
      const lift = norm(skDay.primary_lift);
      const hit = strengthMovements.some((m) => m.includes(lift) || lift.includes(m) ||
        lift.split(" ").some((word) => word.length > 3 && m.includes(word)));
      if (!hit) adherence.push(`${at}: primary_lift "${skDay.primary_lift}" not found in strength block movements [${strengthMovements.join("; ")}].`);
    }
    const skHasMetcon = (skDay.block_types ?? []).includes("metcon");
    const fillMetcons = fDay.blocks.filter((b) => b.block_type === "metcon");
    if (skHasMetcon && fillMetcons.length === 0) adherence.push(`${at}: skeleton has a metcon; fill has none.`);
    if (!skHasMetcon && fillMetcons.length > 0) adherence.push(`${at}: fill invented a metcon the skeleton didn't declare.`);
    for (const mc of fillMetcons) {
      if (!mc.block_scheme) adherence.push(`${at}: metcon missing block_scheme.`);
    }
  }
}
console.log(`  skeleton adherence: ${adherence.length === 0 ? "clean" : `${adherence.length} note(s)`}`);

// ── Render ──
// deno-lint-ignore no-explicit-any
function fmtMovement(m: any): string {
  const parts: string[] = [];
  if (m.sets) parts.push(`${m.sets}×${m.reps ?? "?"}`);
  else if (m.rep_scheme?.length) parts.push(m.rep_scheme.join("-"));
  else if (m.reps) parts.push(`${m.reps} reps`);
  if (m.weight) parts.push(`@ ${m.weight}`);
  if (m.time_seconds) parts.push(`${m.time_seconds}s`);
  if (m.distance) parts.push(`${m.distance}${m.distance_unit ?? "m"}`);
  return `${m.movement}${parts.length ? " — " + parts.join(" ") : ""}`;
}

const md: string[] = [`# Filled program — ${ARM} skeleton (${machine.category ?? userId})`, ``];
md.push(`Live hard audits: ${audit.passed ? "PASS" : "FAIL"} · Skeleton adherence: ${adherence.length === 0 ? "clean" : adherence.length + " note(s)"}`, ``);
if (adherence.length > 0) {
  md.push(`## Adherence notes`, ...adherence.map((a) => `- ${a}`), ``);
}
// deno-lint-ignore no-explicit-any
if (!audit.passed) {
  md.push(`## Live audit failures`);
  // deno-lint-ignore no-explicit-any
  for (const f of audit.failures as any[]) {
    md.push(`- **${f.rule}**: ${(f.violations ?? []).slice(0, 6).join(" · ")}`);
  }
  md.push(``);
}
for (const week of weeks) {
  md.push(`## Week ${week.week_num}`);
  for (const day of week.days ?? []) {
    md.push(``, `### Day ${day.day_num}`);
    for (const block of day.blocks ?? []) {
      const label = block.block_label ? ` — ${block.block_label}` : "";
      const scheme = block.block_scheme ? ` (${block.block_scheme})` : "";
      md.push(`**${block.block_type}**${label}${scheme}`);
      // deno-lint-ignore no-explicit-any
      for (const m of (block as any).movements ?? []) md.push(`- ${fmtMovement(m)}`);
    }
  }
  md.push(``);
}

const dir = MACHINE_PATH.replace(/\/[^/]+$/, "");
const slug = ARM.replace(/[^a-z0-9.-]+/gi, "-");
await Deno.writeTextFile(`${dir}/program-${slug}.md`, md.join("\n") + "\n");
await Deno.writeTextFile(
  `${dir}/program-${slug}.json`,
  JSON.stringify({ user_id: userId, arm: ARM, output, audit, adherence }, null, 2),
);
console.log(`\nDone. Read ${dir}/program-${slug}.md`);
