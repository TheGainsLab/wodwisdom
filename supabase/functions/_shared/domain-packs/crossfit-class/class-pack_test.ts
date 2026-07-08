// deno test supabase/functions/_shared/domain-packs/crossfit-class/class-pack_test.ts --allow-env --no-check
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  auditClassCoverage,
  CROSSFIT_CLASS_PACK,
  defaultClassFocusSplit,
} from "./index.ts";
import { CROSSFIT_PACK } from "../crossfit/index.ts";
import type { SkeletonOutput } from "../../v3-output-schema.ts";
import type { TrainingDesignInput } from "../../training-design-input.ts";

function day(dayNum: number, blockTypes: string[]) {
  // deno-lint-ignore no-explicit-any
  return { day_num: dayNum, day_intent: "t", block_types: blockTypes } as any;
}
function skeletonOf(days: unknown[]): SkeletonOutput {
  // deno-lint-ignore no-explicit-any
  return { month_plan: {}, weeks: [{ week_num: 1, weekly_intent: "build", days }] } as any;
}

Deno.test("class_coverage: the class day template passes; personal-training days fail", () => {
  const good = skeletonOf([
    day(1, ["warm-up", "strength", "metcon", "cool-down"]),
    day(2, ["warm-up", "skills", "metcon", "cool-down"]),
  ]);
  assertEquals(auditClassCoverage(good).passed, true);

  const bad = skeletonOf([
    day(1, ["warm-up", "skills", "strength", "accessory", "metcon", "cool-down"]), // both foci + accessory
    day(2, ["warm-up", "metcon", "cool-down"]), // no focus
    day(3, ["warm-up", "strength", "cool-down"]), // no metcon
  ]);
  const r = auditClassCoverage(bad);
  assertEquals(r.passed, false);
  assert(r.violations.some((v) => v.includes("BOTH strength and skills")));
  assert(r.violations.some((v) => v.includes("accessory blocks are not part")));
  assert(r.violations.some((v) => v.includes("neither a strength nor a skills")));
  assert(r.violations.some((v) => v.includes("missing required metcon")));
});

Deno.test("defaultClassFocusSplit: 2 skills days at 5-6 dpw, 1 below", () => {
  assertEquals(defaultClassFocusSplit(6), { strength_days: 4, skills_days: 2 });
  assertEquals(defaultClassFocusSplit(5), { strength_days: 3, skills_days: 2 });
  assertEquals(defaultClassFocusSplit(4), { strength_days: 3, skills_days: 1 });
  assertEquals(defaultClassFocusSplit(3), { strength_days: 2, skills_days: 1 });
});

Deno.test("class recap states the template + owner split + clock; base recap unchanged", () => {
  const tdi = {
    days_per_week: 6,
    session_length_minutes: 60,
    class_focus_split: { strength_days: 4, skills_days: 2 },
  // deno-lint-ignore no-explicit-any
  } as any as TrainingDesignInput;

  const recap = CROSSFIT_CLASS_PACK.writer.skeletonRuleRecap(6, tdi);
  assert(recap.includes("GROUP CLASS"), "class recap declares the context");
  assert(recap.includes("ONE focus block (strength OR skills"), "one focus block rule");
  assert(recap.includes("NO accessory blocks"), "no accessory rule");
  assert(recap.includes("4 strength-focus days and 2 skills-focus days"), "owner split stated");
  assert(recap.includes("cool-down is NOT counted"), "clock rule");

  // The base pack recap is byte-identical to the pre-seam pipeline string.
  const base = CROSSFIT_PACK.writer.skeletonRuleRecap(5, tdi);
  assert(base.includes("Every training day includes strength + accessory + metcon block types. Skills 2–4 days per week."));
  assert(base.includes("- Output exactly 4 weeks × 5 days. day_num is 1..5."));
  assert(!base.includes("GROUP CLASS"));
});

Deno.test("class pack inherits everything else from crossfit@3", () => {
  assertEquals(CROSSFIT_CLASS_PACK.id, "crossfit_class@1");
  assertEquals(CROSSFIT_CLASS_PACK.writer.skeletonSystemPrompt, CROSSFIT_PACK.writer.skeletonSystemPrompt);
  assertEquals(CROSSFIT_CLASS_PACK.audits.runHard, CROSSFIT_PACK.audits.runHard);
  assertEquals(CROSSFIT_CLASS_PACK.recovery, CROSSFIT_PACK.recovery);
  assertEquals(CROSSFIT_CLASS_PACK.scaling, CROSSFIT_PACK.scaling);
});
