// Generator changes of 2026-11-26 (first of five): see more, rewrite less.
//  - a metcon with no estimate keeps the reason, and the save logs it;
//  - the metcon duration check logs only and never sends a block for a rewrite;
//  - a metcon being rewritten is shown its composed piece and keeps its purpose;
//  - the fit judge is told the movement list is for replacements only.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ALL_AUDITS, AUDIT_KIND, SOFT_AUDITS } from "./audits.ts";
import { classifyFailuresByKind, runAudits, runSoftAudits } from "./audit-runner.ts";
import { missingBenchmarkLines } from "./compute-block-benchmark.ts";
import { buildSurgicalUserMessage, SURGICAL_SYSTEM_PROMPT } from "./surgical-block-fix.ts";
import { applySurgicalFixes } from "./engine/pipeline.ts";
// deno-lint-ignore no-explicit-any
type Any = any;
const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

Deno.test("every metcon with no estimate is listed with its format and the reason", () => {
  const weeks = [{ week_num: 1, days: [
    { day_num: 1, blocks: [
      { block_type: "strength" },
      { block_type: "metcon", scheme_format: { format: "intervals" }, expected_benchmark: null, expected_benchmark_reason: "work_calc_404:movement_not_found" },
    ] },
    { day_num: 2, blocks: [{ block_type: "metcon", scheme_format: { format: "amrap" }, expected_benchmark: { median_score: "5+3" }, expected_benchmark_reason: null }] },
    { day_num: 3, blocks: [{ block_type: "metcon", expected_benchmark: null }] },
  ] }];
  assertEquals(missingBenchmarkLines(weeks), [
    "W1D1 block[1] (intervals): work_calc_404:movement_not_found",
    "W1D3 block[0] (no format): not computed",
  ]);
  assertEquals(missingBenchmarkLines([]), []);
});

Deno.test("the reason is kept when the estimate is computed, and logged at save under its own stage", () => {
  const src = read("./compute-block-benchmark.ts");
  assert(src.includes("const { bench: benchmark, reason } = await computeBlockBenchmarkExplained(block, gender);"));
  assert(src.includes('block.expected_benchmark_reason = benchmark ? null : (reason ?? "unknown");'));
  const gen = read("../generate-program-v3/index.ts");
  const saving = gen.slice(gen.indexOf("async function stageSaving("), gen.indexOf("async function runStage("));
  assert(saving.includes("missingBenchmarkLines(output.weeks ?? [])"));
  assert(saving.includes('stage: "benchmark_missing"'));
  // It is not a stored column: the save does not write it.
  assert(!read("./save-program-v3.ts").includes("expected_benchmark_reason"));
});

const SKELETON: Any = { weeks: [{ week_num: 1, days: [{ day_num: 1, metcon_focus: "short · build, high output · anaerobic_capacity" }] }] };
const LONG_METCON = (): Any => ({ month_plan: {}, weeks: [{ week_num: 1, days: [{ day_num: 1, blocks: [
  { block_type: "metcon", block_scheme: "For time", scheme_format: { format: "for_time" }, movements: [{ movement: "Row", distance: 5000, distance_unit: "m" }], expected_benchmark: { median_seconds: 1200 } },
] }] }] });

Deno.test("a metcon outside its time domain is logged and never sent for a rewrite", () => {
  const ctx = { output: LONG_METCON(), daysPerWeek: 1, lifts: {}, vocabulary: [], skeleton: SKELETON, expectedWeeks: 1 };
  // Not a hard audit: no failure, so no rewrite and no residual.
  const hard = runAudits(ctx);
  assertEquals(hard.all.some((r) => r.rule === "metcon_duration_matches_focus"), false);
  assertEquals(classifyFailuresByKind(hard.failures)["block-local"].some((f) => f.rule === "metcon_duration_matches_focus"), false);
  assertEquals((AUDIT_KIND as Record<string, string>).metcon_duration_matches_focus, undefined);
  // It is a log-only audit, and it still finds the mismatch.
  const soft = runSoftAudits(ctx);
  const found = soft.failures.find((f) => f.rule === "metcon_duration_matches_focus");
  assert(found && found.violations[0].includes("short bucket") && found.violations[0].includes("~20:00"));
  assertEquals(ALL_AUDITS.length + SOFT_AUDITS.length >= 2, true);
  // The save passes the plan to the log-only audits, or the check would see nothing.
  const gen = read("../generate-program-v3/index.ts");
  assert(/runSoftAudits\(\{[\s\S]{0,400}skeleton,\n\s*\}\)/.test(gen));
});

const COMPOSED: Any = {
  week_num: 1, day_num: 1, format: "amrap", block_scheme: "AMRAP 12", stated_duration_minutes: 12, monostructural: false,
  stimulus_note: "Sustained: unbroken wall balls through round three.",
  movements: [{ movement: "Wall Ball", prescription: "15 reps" }, { movement: "Row", prescription: "12 cal" }],
};
const BLOCK: Any = { block_type: "metcon", block_scheme: "AMRAP 12", movements: [{ movement: "Wall Ball", reps: 15 }, { movement: "Row" }] };
const PAYLOAD: Any = { basics: { units: "lbs" }, lifts: {}, vocabulary: ["Wall Ball", "Row"], training_context: {} };

Deno.test("a metcon being rewritten is shown its composed piece and told to change only what the check names", () => {
  const withPiece = buildSurgicalUserMessage(PAYLOAD, null, 1, 1, 0, BLOCK, ["required_fields: Row has no volume"], COMPOSED);
  assert(withPiece.includes("COMPOSED PIECE (the metcon as its composer designed it — keep it; change only what the violations name):"));
  assert(withPiece.includes("Sustained: unbroken wall balls through round three."));
  // A block that is not a composed metcon gets the message it always got.
  assert(!buildSurgicalUserMessage(PAYLOAD, null, 1, 1, 0, BLOCK, ["x"]).includes("COMPOSED PIECE"));
  assert(SURGICAL_SYSTEM_PROMPT.includes("It is NOT yours to redesign."));
  assert(SURGICAL_SYSTEM_PROMPT.includes("change ONLY what the audit violations name"));
  // The rewriter takes the time domain from the planner's field, and is not told a duration check rewrites.
  assert(SURGICAL_SYSTEM_PROMPT.includes("metcon_time_domain"));
  assert(!SURGICAL_SYSTEM_PROMPT.includes("long aerobic chipper"));
  assert(!SURGICAL_SYSTEM_PROMPT.includes("The audit will reject rewrites whose computed duration"));
});

Deno.test("the rewrite is handed the right composed piece, only for a metcon, and the composer's purpose stays on the block", async () => {
  const seen: Any[] = [];
  const pack: Any = { recovery: {
    surgicallyRewriteBlock: (_p: Any, _s: Any, w: number, d: number, i: number, b: Any, _v: Any, composed: Any) => {
      seen.push([w, d, i, composed?.block_scheme ?? null]);
      return Promise.resolve({ block_type: b.block_type, block_scheme: "", block_notes: "rewriter's own words", scheme_format: { format: b.block_type === "metcon" ? "amrap" : "straight_sets", minutes: 12 }, movements: b.movements });
    },
    spliceBlock: (out: Any, w: number, d: number, i: number, nb: Any) => { out.weeks[0].days[0].blocks[i] = nb; return w === 1 && d === 1; },
  } };
  const output: Any = { month_plan: {}, weeks: [{ week_num: 1, days: [{ day_num: 1, blocks: [
    { block_type: "strength", movements: [{ movement: "Back Squat", sets: 5, reps: 5 }] },
    { ...BLOCK },
  ] }] }] };
  const failures: Any = [{ rule: "required_fields", passed: false, violations: [
    "Week 1 Day 1 block[0] (strength): something", "Week 1 Day 1 block[1] (metcon): something",
  ] }];
  const other = { ...COMPOSED, day_num: 2, block_scheme: "OTHER DAY" };
  const r = await applySurgicalFixes(output, failures, PAYLOAD, { weeks: [] } as Any, pack, [other, COMPOSED]);
  assertEquals(r.rewritten, 2);
  assertEquals(seen, [[1, 1, 0, null], [1, 1, 1, "AMRAP 12"]]);
  const [strength, metcon] = output.weeks[0].days[0].blocks;
  assertEquals(strength.block_notes, "rewriter's own words");
  assertEquals([metcon.block_notes, metcon.stimulus_note], [COMPOSED.stimulus_note, COMPOSED.stimulus_note]);
  // The generator passes this month's composed metcons in.
  assert(read("../generate-program-v3/index.ts").includes('applySurgicalFixes(output, byKind["block-local"], payload, skeleton, PACK, rs.composedMetcons ?? [])'));
});
