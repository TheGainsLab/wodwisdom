import { assert, assertEquals } from "jsr:@std/assert";
import { pieceAsText, timeDomainTable } from "./metcon-dry-run-text.ts";

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
