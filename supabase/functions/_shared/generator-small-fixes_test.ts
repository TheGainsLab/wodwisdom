// deno test supabase/functions/_shared/generator-small-fixes_test.ts --no-check --allow-read
//
// Three small generator fixes (2026-11-24): the week-count check knows how
// many weeks to expect, the plate check ignores fixed implements, the repair
// step has a pass ceiling, and a re-planned month has cardio removed for an
// Engine member like a first build does.
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { auditDayCount, auditPlateMath } from "./audits.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const day = (n: number, movements: Any[] = []) => ({ day_num: n, blocks: [{ block_type: "strength", movements }] });
const week = (n: number, days = 3, movements: Any[] = []) => ({ week_num: n, days: Array.from({ length: days }, (_, i) => day(i + 1, movements)) });

Deno.test("a weekly job's one week is not reported as a missing month", () => {
  const out: Any = { weeks: [week(2)] };
  assertEquals(auditDayCount(out, 3, 1).violations, []);
  // A whole month is still held to four weeks, and a short one is still caught.
  assertEquals(auditDayCount(out, 3).violations, ["Output has 1 weeks; expected exactly 4."]);
  assertEquals(auditDayCount({ weeks: [week(1), week(2), week(3), week(4)] } as Any, 3).violations, []);
});

Deno.test("the plate check ignores a fixed implement and still flags an unloadable barbell weight", () => {
  const out: Any = { weeks: [week(1, 1, [
    { movement: "Kettlebell Swing", weight: 24, weight_unit: "kg", on_barbell: false },
    { movement: "Strict Press", weight: 49, weight_unit: "kg", on_barbell: true },
  ])] };
  const v = auditPlateMath(out).violations;
  assertEquals(v.length, 1);
  assertMatch(v[0], /Strict Press/);
});

Deno.test("the repair step has a pass ceiling, checked before each pass", async () => {
  const gen = await Deno.readTextFile(new URL("../generate-program-v3/index.ts", import.meta.url));
  assertMatch(gen, /export const MAX_SURGICAL_PASSES = \d+;/);
  const body = gen.slice(gen.indexOf("async function stageSurgical("));
  const ceiling = body.indexOf("if (pass > MAX_SURGICAL_PASSES)");
  assertEquals(ceiling > 0 && ceiling < body.indexOf("await applySurgicalFixes("), true);
});

Deno.test("a re-planned month has cardio removed for an Engine member before it is stored", async () => {
  const gen = await Deno.readTextFile(new URL("../generate-program-v3/index.ts", import.meta.url));
  const replan = gen.slice(gen.indexOf("const fresh = await generateSkeletonWithAudits(tdi, PACK, undefined, replanDoc);"));
  // Applied to every plan the planner returns for the re-plan (the first and the mix send-back).
  const strip = replan.indexOf("stripCardioBlocks(plan)");
  assertEquals(strip > 0 && strip < replan.indexOf('.update({ skeleton, replanned_at'), true);
  assertMatch(replan.slice(0, strip), /tdi\.cardio_allowed === false/);
  assertMatch(replan, /withMixCheck\(supa, job, rs, \{ skeleton: finish\(fresh\), tdi, doc: replanDoc, fromWeek: weekNum, finish \}\)/);
});

Deno.test("every job tells the check how many weeks to expect", async () => {
  const gen = await Deno.readTextFile(new URL("../generate-program-v3/index.ts", import.meta.url));
  assertEquals(/auditOutput\(output, payload, skeleton, PACK\)/.test(gen), false);
  assertEquals((gen.match(/auditOutput\(output, payload, skeleton, PACK, rs\.weekly \? 1 : 4\)/g) ?? []).length >= 5, true);
});
