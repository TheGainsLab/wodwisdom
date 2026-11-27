/**
 * metcon-variety-audits_test.ts
 *
 * What code counts about the composed metcons (rebuilt 2026-11-27): slot
 * coverage, formats, monostructural-only pieces, named benchmarks, one
 * machine per round-based piece, and a defined band on a barbell class.
 * Every count reads a field the composer set, never a movement's name.
 */

import { assert, assertEquals } from "jsr:@std/assert";
import type { ComposedMetcon, ComposedMetconMovement, MetconSlot } from "./metcon-composer.ts";
import {
  auditMetconVariety,
  formatMetconVarietyViolationsForRetry,
  repairComposerEmission,
  stripStructuralRestRows,
} from "./metcon-variety-audits.ts";

let dayCounter = 0;
type Row = string | ComposedMetconMovement;
function piece(movements: Row[], overrides: Partial<ComposedMetcon> = {}): ComposedMetcon {
  const idx = dayCounter++;
  return {
    week_num: Math.floor(idx / 3) % 4 + 1,
    day_num: (idx % 3) + 1,
    format: "amrap",
    block_scheme: "AMRAP 12",
    stated_duration_minutes: 12,
    movements: movements.map((m) => (typeof m === "string" ? { movement: m, prescription: "10" } : m)),
    stimulus_note: "Steady across all rounds.",
    monostructural: false,
    ...overrides,
  };
}
const row = (machine: ComposedMetconMovement["machine"], movement: string): ComposedMetconMovement => ({ movement, prescription: "12 cal", machine });
const bar = (movement: string, load_class: string, load_band: ComposedMetconMovement["load_band"] = "moderate"): ComposedMetconMovement =>
  ({ movement, prescription: "10", load_class, load_band });

/** A 12-piece month that meets every count. */
function goodMonth(): ComposedMetcon[] {
  dayCounter = 0;
  return [
    piece([row("row", "Row"), "Wall Ball", "Burpee"], { format: "rft" }),
    piece(["Dumbbell Snatch", "Box Jump Over"], { format: "amrap" }),
    piece([bar("Thruster", "thruster"), "Pull Up"], { format: "rep_scheme", block_scheme: "21-15-9 for time" }),
    piece([row("run", "Run"), "Kettlebell Swing"], { format: "intervals" }),
    piece([row("bike", "Bike"), "Wall Walk", "Sit Up"], { format: "amrap" }),
    piece([bar("Deadlift", "deadlift"), "Bar Facing Burpee"], { format: "rft" }),
    piece([row("row", "Row")], { format: "intervals", monostructural: true }),
    piece(["Burpee Box Jump Over", "Goblet Squat"], { format: "amrap" }),
    piece([row("run", "Run"), "Push Up", "Walking Lunge"], { format: "chipper" }),
    piece(["Kettlebell Swing", "Toes To Bar"], { format: "emom" }),
    piece(["Wall Ball", "Shuttle Run", row("bike", "Bike")], { format: "amrap" }),
    piece(["Dumbbell Thruster", "Double Under"], { format: "rft" }),
  ];
}
const slotsFor = (m: ComposedMetcon[]): MetconSlot[] =>
  m.map((p) => ({ week_num: p.week_num, day_num: p.day_num, time_domain: "medium", week_role: "build", day_context: {} }));

Deno.test("a month that meets every count passes", () => {
  const r = auditMetconVariety({ metcons: goodMonth() });
  assertEquals(r.violations, []);
  assertEquals(r.passed, true);
});

Deno.test("fewer than 3 formats and one format over half are counted", () => {
  const m = goodMonth().map((p) => ({ ...p, format: "amrap" as const }));
  const r = auditMetconVariety({ metcons: m });
  assert(r.violations.some((v) => v.includes("distinct format")));
  assert(r.violations.some((v) => v.includes("no format may exceed half")));
});

Deno.test("monostructural-only pieces are counted from the composer's own flag: 2 allowed, 0 for an Engine athlete", () => {
  const m = goodMonth();
  m[3] = { ...m[3], monostructural: true };
  assertEquals(auditMetconVariety({ metcons: m }).passed, true); // two is the budget
  m[4] = { ...m[4], monostructural: true };
  assert(auditMetconVariety({ metcons: m }).violations.some((v) => v.includes("budget is 2")));
  // An Engine athlete: none. Machines inside mixed pieces are untouched.
  const engine = auditMetconVariety({ metcons: goodMonth() }, { engineActive: true });
  assertEquals(engine.violations.length, 1);
  assert(engine.violations[0].includes("trains Engine"));
  const mixedOnly = goodMonth().map((p) => ({ ...p, monostructural: false }));
  assertEquals(auditMetconVariety({ metcons: mixedOnly }, { engineActive: true }).passed, true);
});

Deno.test("more than 2 named pieces are counted", () => {
  const m = goodMonth();
  for (const i of [0, 1, 2]) m[i] = { ...m[i], format: "named" };
  assert(auditMetconVariety({ metcons: m }).violations.some((v) => v.includes("named benchmark")));
});

Deno.test("one machine per round-based piece is counted from the machine field; a chipper may touch two", () => {
  const m = goodMonth();
  m[1] = piece([row("row", "Row"), row("bike", "Bike"), "Burpee"], { week_num: m[1].week_num, day_num: m[1].day_num, format: "amrap" });
  assert(auditMetconVariety({ metcons: m }).violations.some((v) => v.includes("2 machines (row, bike)")));
  const chipper = goodMonth();
  chipper[8] = piece([row("row", "Row"), row("run", "Run"), "Burpee"], { week_num: chipper[8].week_num, day_num: chipper[8].day_num, format: "chipper" });
  assertEquals(auditMetconVariety({ metcons: chipper }).passed, true);
});

Deno.test("no count reads a movement's name: machine words in a name with no machine field are not machines", () => {
  dayCounter = 0;
  // "Row" and "Bike" by name only (no machine field), and a name that merely contains a machine word.
  const m = goodMonth();
  m[1] = piece(["Row", "Bike", "Medicine Ball Throw"], { week_num: m[1].week_num, day_num: m[1].day_num });
  assertEquals(auditMetconVariety({ metcons: m }).passed, true);
  // A piece of machine-named rows is not "monostructural-only" unless the composer flagged it.
  const three = goodMonth();
  three[0] = piece(["Row"], { week_num: three[0].week_num, day_num: three[0].day_num, format: "rft" });
  three[1] = piece(["Run"], { week_num: three[1].week_num, day_num: three[1].day_num });
  assertEquals(auditMetconVariety({ metcons: three }).passed, true);
});

Deno.test("what is no longer counted: repeats, a movement in most pieces, no barbell at all", () => {
  dayCounter = 0;
  const formats = ["amrap", "rft", "emom", "intervals"] as const;
  const same = Array.from({ length: 12 }, (_, i) => piece(["Wall Ball", "Burpee"], { format: formats[i % 4] }));
  const r = auditMetconVariety({ metcons: same });
  assertEquals(r.violations, []);
  assertEquals(r.warnings, []);
});

Deno.test("a barbell load class needs a band that class defines; dumbbell, kettlebell and medicine ball need none", () => {
  const m = goodMonth();
  m[2] = piece([{ movement: "Thruster", prescription: "10", load_class: "thruster" }, "Pull Up"], { week_num: m[2].week_num, day_num: m[2].day_num, format: "rep_scheme" });
  assert(auditMetconVariety({ metcons: m }).violations.some((v) => v.includes('load_class "thruster" and no load_band')));
  const heavy = goodMonth();
  heavy[5] = piece([bar("Back Squat", "back_squat", "heavy")], { week_num: heavy[5].week_num, day_num: heavy[5].day_num, format: "rft" });
  assert(auditMetconVariety({ metcons: heavy }).violations.some((v) => v.includes("does not define")));
  const implement = goodMonth();
  implement[1] = piece([
    { movement: "Dumbbell Snatch", prescription: "10", load_class: "dumbbell", weight: 22.5 },
    { movement: "Kettlebell Swing", prescription: "15", load_class: "kettlebell", weight: 24 },
    { movement: "Wall Ball", prescription: "20", load_class: "medicine_ball" },
  ], { week_num: implement[1].week_num, day_num: implement[1].day_num });
  assertEquals(auditMetconVariety({ metcons: implement }).passed, true);
});

Deno.test("slot coverage: missing, doubled, and orphan slots are counted; a length outside the time domain is logged only", () => {
  const m = goodMonth();
  const slots = slotsFor(m);
  assertEquals(auditMetconVariety({ metcons: m }, { slots }).passed, true);

  const broken = m.slice(1); // drop W1D1
  broken.push({ ...m[1], week_num: 4, day_num: 7 }); // orphan slot
  const r = auditMetconVariety({ metcons: broken }, { slots });
  assert(r.violations.some((v) => v.includes("no composed metcon")));
  assert(r.violations.some((v) => v.includes("doesn't exist")));

  const slow = m.map((p, i) => (i === 0 ? { ...p, stated_duration_minutes: 20 } : p));
  const warned = auditMetconVariety({ metcons: slow }, { slots });
  assertEquals(warned.passed, true);
  assert(warned.warnings.some((w) => w.includes('"medium"')));
});

Deno.test("the send-back says pieces already written this month cannot be changed", () => {
  const msg = formatMetconVarietyViolationsForRetry(["Format \"amrap\" carries 4/5 pieces"]);
  assert(msg.includes("Pieces already written this month cannot be changed."));
  assert(msg.includes('Format "amrap" carries 4/5 pieces'));
});

Deno.test("structural Rest rows are stripped before legality can see them (2026-08-31 hard-fail)", () => {
  const m = goodMonth();
  m[1].movements.push({ movement: "Rest", prescription: "2:00" });
  m[3].movements.push({ movement: "Rest 90s", prescription: "" });
  const stripped = stripStructuralRestRows({ metcons: m });
  assertEquals(stripped, 2);
  assert(!m[1].movements.some((mv) => mv.movement === "Rest"));
  // A real movement containing "rest" as a substring is untouched.
  const wrestler = goodMonth();
  wrestler[0].movements.push({ movement: "Wrestler Squat", prescription: "10" });
  assertEquals(stripStructuralRestRows({ metcons: wrestler }), 0);
});

// ── Emission repair: malformed composer output must NEVER crash a stage ──
// (2026-08-31: a retry emission with a missing movements array crashed the
// metcons stage. The repair converts every malformation into dropped pieces
// that surface as slot-coverage findings.)

Deno.test("repair: piece with missing movements array is dropped, not crashed on (the production failure)", () => {
  const m = goodMonth() as unknown[];
  delete (m[4] as Record<string, unknown>).movements;
  const { output, repairs } = repairComposerEmission({ metcons: m });
  assertEquals(output.metcons.length, 11);
  assert(repairs.some((r) => r.includes("movements array missing")));
});

Deno.test("repair: missing metcons array, junk root, junk pieces, junk movement rows", () => {
  // No metcons at all
  const none = repairComposerEmission({});
  assertEquals(none.output.metcons, []);
  assert(none.repairs.length > 0);
  // Root not an object
  assertEquals(repairComposerEmission(null).output.metcons, []);
  assertEquals(repairComposerEmission("garbage").output.metcons, []);
  // Non-object piece + empty movements + malformed rows
  const mixed = repairComposerEmission({
    metcons: [
      "junk",
      { week_num: 1, day_num: 1, movements: [] },
      {
        week_num: 1,
        day_num: 2,
        format: "amrap",
        block_scheme: "AMRAP 12",
        stated_duration_minutes: 12,
        stimulus_note: "steady",
        monostructural: false,
        movements: [{ movement: "Burpee", prescription: "10" }, { notaMovement: true }, null],
      },
    ],
  });
  assertEquals(mixed.output.metcons.length, 1);
  assertEquals(mixed.output.metcons[0].movements.length, 1);
  assert(mixed.repairs.some((r) => r.includes("non-object piece")));
  assert(mixed.repairs.some((r) => r.includes("malformed movement row")));
});

Deno.test("repair: valid month passes through untouched", () => {
  const m = goodMonth();
  const { output, repairs } = repairComposerEmission({ metcons: m });
  assertEquals(output.metcons.length, 12);
  assertEquals(repairs, []);
  assertEquals(output.metcons[0].movements.length, m[0].movements.length);
});

Deno.test("no-throw guarantee: repair → strip → audit runs the full gauntlet on malformed input", () => {
  const malformed = {
    metcons: [
      { week_num: 1, day_num: 1 }, // no movements — the crash shape
      { week_num: 1, day_num: 2, movements: [{ movement: "Rest", prescription: "2:00" }] }, // all-Rest piece
      {
        week_num: 1,
        day_num: 3,
        movements: [{ movement: "Burpee", prescription: "10" }, { movement: "Rest 90s", prescription: "" }],
      },
      "garbage",
      null,
    ],
  };
  const { output } = repairComposerEmission(malformed);
  stripStructuralRestRows(output);
  // The all-Rest piece survives repair but strips to zero movements — the
  // audit must tolerate it (and full option surface must not throw).
  const slots: MetconSlot[] = [1, 2, 3].map((d) => ({
    week_num: 1,
    day_num: d,
    time_domain: "medium",
    week_role: "build",
    day_context: {},
  }));
  const r = auditMetconVariety(output, { slots, engineActive: true });
  // W1D1 was dropped by repair → slot coverage flags it. No exceptions anywhere.
  assert(r.violations.some((v) => v.includes("no composed metcon")));
});

Deno.test("strip: tolerates pieces with missing movements (post-repair this can't occur; standalone it must not crash)", () => {
  const weird = { metcons: [{ week_num: 1, day_num: 1 } as unknown as ComposedMetcon] };
  assertEquals(stripStructuralRestRows(weird), 0);
});

