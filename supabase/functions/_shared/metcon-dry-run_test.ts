import { assert, assertEquals } from "jsr:@std/assert";
import { movementAsText, pieceAsText, planForBlock, timeDomainTable, weekAsText } from "./metcon-dry-run-text.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

Deno.test("the dry run saves nothing: it has no write to any table and no log row", () => {
  const src = Deno.readTextFileSync(new URL("../metcon-dry-run/index.ts", import.meta.url));
  for (const write of [".insert(", ".update(", ".upsert(", ".delete(", "logGenerationAudit", "saveProgramV3", "generateAndPersistCoachState", "buildWriterPayload("]) {
    assert(!src.includes(write), `the dry run calls ${write}`);
  }
  // It runs the same code a build runs.
  for (const shared of ["generateSkeletonWithAudits(", "auditSkeletonMetconMix(", "composeMetconsForSlots(", "buildComposerInputs(", "loadExampleBlock(supa)", "loadArticleBlock(supa, COMPOSER_ARTICLES)"]) {
    assert(src.includes(shared), `the dry run does not use ${shared}`);
  }
  // The movement list is read as it is today, not as the stored build had it.
  assert(src.includes("const listNow = await fetchVocabulary(supa);"));
  assert(src.includes("vocabulary_by_block: await fetchMovementsByBlock(supa)"));
  assert(src.includes('if (!isServiceRole(req.headers.get("Authorization"))) return json({ error: "service role only" }, 401);'));
});

Deno.test("the plan is shown as one line of time domains per week", () => {
  const d = (n: number, extra: Any) => ({ day_num: n, block_types: ["warm-up", "metcon"], ...extra });
  const plan: Any = { weeks: [
    { week_num: 1, weekly_intent: "build", days: [d(1, { metcon_time_domain: "short" }), d(2, { metcon_time_domain: "long" }), d(3, {}), { day_num: 4, block_types: ["active-recovery"] }] },
  ] };
  assertEquals(timeDomainTable(plan), ["Week 1 (build): D1 short · D2 long · D3 NONE"]);
});

Deno.test("a composed piece is shown as the member would read it, with each load", () => {
  const text = pieceAsText({
    week_num: 1, day_num: 2, format: "rft", block_scheme: "3 rounds for time", stated_duration_minutes: 9,
    stimulus_note: "Fast and unbroken.", monostructural: false,
    movements: [
      { movement: "Power Clean", prescription: "10", load_class: "clean", load_band: "moderate" },
      { movement: "Dumbbell Snatch", prescription: "12", load_class: "dumbbell", weight: 50 },
      { movement: "Wall Ball", prescription: "15", load_class: "medicine_ball" },
      { movement: "Row", prescription: "15 cal", machine: "row" },
    ],
  });
  assertEquals(text, [
    "W1D2 · rft · 9 min",
    "3 rounds for time",
    "  10 Power Clean (clean moderate)",
    "  12 Dumbbell Snatch (50 per dumbbell)",
    "  15 Wall Ball (medicine ball)",
    "  15 cal Row",
    "  Note: Fast and unbroken.",
  ].join("\n"));
});

Deno.test("the write step runs the real writer and none of what changes a week after it", () => {
  const src = Deno.readTextFileSync(new URL("../metcon-dry-run/index.ts", import.meta.url));
  assert(src.includes('const wk = await callWeekFill(build.payload, skeleton, week, priorWeeks, "", PACK, pieces);'));
  assert(src.includes("renderWeekSchemesInPlace(wk);"));
  for (const notRun of ["applySurgicalFixes", "recomputeBenchmarks", "applyProgrammaticFixes", "clampLoadSanity"]) {
    assert(!src.includes(notRun), `the write step runs ${notRun}`);
  }
});

Deno.test("a written week is shown block by block, with what the plan asked for beside it", () => {
  const skel: Any = { days: [{
    day_num: 1, day_intent: "heavy squat", primary_lift: "Back Squat", strength_scheme: "5x5 @75%", skill_focus: "Strict pull-up volume",
    metcon_time_domain: "short",
    block_intents: [{ block_type: "accessory", focus: "midline", purpose: "support" }, { block_type: "strength", focus: "powerlifting_strength", purpose: "develop", source_priority_rank: 1 }],
    block_minutes: [{ block_type: "strength", minutes: 20 }],
  }] };
  assertEquals(planForBlock(skel.days[0], "strength"), "Back Squat, 5x5 @75% · develop powerlifting_strength (priority 1) · 20 min");
  assertEquals(planForBlock(skel.days[0], "skills"), "Strict pull-up volume");
  assertEquals(planForBlock(skel.days[0], "accessory"), "support midline");
  assertEquals(planForBlock(skel.days[0], "metcon"), "short (composed before the writer)");
  assertEquals(planForBlock(skel.days[0], "warm-up"), "");
  assertEquals(movementAsText({ movement: "Back Squat", sets: 5, reps: 5, weight: 300, weight_unit: "lbs", target_pct_1rm: 75 }), "    Back Squat: 5 x 5 · @ 300 lbs · (75% of max)");
  assertEquals(movementAsText({ movement: "Rowing", calories: 12, scaling_note: "easy" }), "    Rowing: 12 cal  [easy]");
  assertEquals(movementAsText({ movement: "Plank" }), "    Plank: (no numbers)");
  const text = weekAsText({ week_num: 1, days: [{ day_num: 1, blocks: [
    { block_type: "strength", block_scheme: "5 x 5", movements: [{ movement: "Back Squat", sets: 5, reps: 5, weight: 300, weight_unit: "lbs" }] },
    { block_type: "metcon", block_scheme: "AMRAP 6", stimulus_note: "Fast.", movements: [{ movement: "Burpee", rep_scheme: [10] }] },
  ] }] }, skel);
  assertEquals(text, [
    "=== Week 1 Day 1 — plan: heavy squat",
    "  [strength]   (plan: Back Squat, 5x5 @75% · develop powerlifting_strength (priority 1) · 20 min)",
    "    5 x 5",
    "    Back Squat: 5 x 5 · @ 300 lbs",
    "  [metcon]   (plan: short (composed before the writer))",
    "    AMRAP 6",
    "    Burpee: reps 10",
    "    Note: Fast.",
  ].join("\n"));
});
